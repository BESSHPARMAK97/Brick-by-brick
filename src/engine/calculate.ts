/**
 * Точка входа расчётного движка: ProjectInput → ScheduleResult.
 * Чистая функция: одинаковые входные данные и версия правил дают одинаковый результат.
 */
import { GROUP_NAMES } from './catalog/library';
import { KZ_HOLIDAYS } from './calendar/holidays';
import { CONTINUOUS, WorkCalendar, type Calendar } from './calendar/workCalendar';
import { ASTANA_NORMALS, ClimateEngine } from './climate/climate';
import { formatRu, fromDayNum, toDayNum, yearOf, type DayNum } from './dates';
import { hashObject } from './hash';
import { buildNetwork, findCycle, type NetworkOp } from './schedule/network';
import { buildPools, ResourceLedger } from './schedule/resources';
import {
  backwardPass,
  capacityOf,
  EngineError,
  forwardPass,
  shiftTime,
  topoOrder,
  type Runtime,
  type SchedulerContext,
} from './schedule/scheduler';
import {
  RELIABLE_STATUSES,
  type AssumptionRecord,
  type DataStatus,
  type DayClassCount,
  type EngineWarning,
  type ExplanationFactor,
  type ProjectInput,
  type ResolvedLink,
  type ResourceProfile,
  type ScheduledOperation,
  type ScheduleResult,
} from './types';
import { validateInput } from './validate';

export const ENGINE_VERSION = '1.0.0';
/** Версия правил: каталог работ, шаблоны технологии, календарные и климатические данные. */
export const RULESET_VERSION = '2026.10-r1';

export { EngineError };

const STATUS_RU: Record<DataStatus, string> = {
  confirmed: 'подтверждено',
  project: 'по проекту',
  normative: 'норматив',
  assumption: 'сценарий — требует подтверждения',
  missing: 'нет данных',
};

export function statusLabel(s: DataStatus): string {
  return STATUS_RU[s];
}

const fmt = (x: number, digits = 2) => {
  const r = Math.round(x * 10 ** digits) / 10 ** digits;
  return String(r).replace('.', ',');
};

const regimeLabel = (c: WorkCalendar) =>
  `${c.settings.regime === 'custom' ? 'индивидуальный' : c.settings.regime}, ${c.settings.shiftsPerDay} см. × ${c.settings.shiftHours} ч`;

export function calculateSchedule(input: ProjectInput): ScheduleResult {
  const errors = validateInput(input);
  if (errors.length) throw new EngineError('Исходные данные некорректны', errors);

  const net = buildNetwork(input);
  const cycle = findCycle(net.ops.map((o) => o.id), net.links);
  if (cycle) throw new EngineError('Обнаружена циклическая зависимость работ', cycle);

  // Календари
  const calendars = new Map<string, Calendar>();
  const mainCal = new WorkCalendar('main', 'Основной календарь', input.calendar);
  calendars.set('main', mainCal);
  calendars.set('continuous', CONTINUOUS);
  for (const [g, c] of Object.entries(input.groupCalendars)) {
    if (c) calendars.set(`grp:${g}`, new WorkCalendar(`grp:${g}`, `Календарь: ${GROUP_NAMES[g] ?? g}`, c));
  }

  const climate = new ClimateEngine(ASTANA_NORMALS, input.forecast, input.strongWind);
  const projectStart = toDayNum(input.startDate);
  const ctx: SchedulerContext = { input, climate, mainCal, projectStart };

  const rts: Runtime[] = net.ops.map((op) => {
    const cal = calendars.get(op.calendarId)!;
    return {
      op, cal, floatCal: cal.continuous ? mainCal : cal, elapsed: cal.continuous,
      es: 0, ef: 0, days: [], shiftsUsed: [], need: 0, winter: false,
      driver: { type: 'projectStart' }, startBound: 0, snappedBound: 0, resourceDelay: null,
      ls: 0, lf: 0, totalFloat: 0, freeFloat: 0, scheduled: false,
    };
  });

  // Пулы ресурсов и проверка достаточности
  const usedIds = new Set(net.ops.flatMap((o) => o.demands.map((d) => d.resourceId)));
  const pools = buildPools(input, usedIds);
  for (const op of net.ops) {
    for (const d of op.demands) {
      const pool = pools.get(d.resourceId);
      if (pool && !d.perShift && d.units > pool.baseCapacity + 1e-9) {
        throw new EngineError(`Операции «${op.template.name}» требуется ${d.units} ед. ресурса «${pool.name}», доступно ${pool.baseCapacity}`);
      }
    }
  }

  // 1) Без ресурсов → приоритеты
  const topo = topoOrder(rts, net.links);
  forwardPass(topo, net.links, ctx, { useResources: false, priority: new Map(topo.map((r, i) => [r.op.id, i])) });
  const endUnconstrained = Math.max(projectStart, ...rts.map((r) => r.ef));
  backwardPass(topo, net.links, ctx, endUnconstrained);
  const priority = new Map(rts.map((r) => [r.op.id, r.ls]));

  // 2) С ресурсами
  const ledger = new ResourceLedger(pools);
  const { order, resourceLinks } = forwardPass(rts, net.links, ctx, { useResources: true, ledger, priority });
  const allLinks: ResolvedLink[] = [...net.links, ...resourceLinks];
  const projectEnd = Math.max(projectStart, ...rts.map((r) => r.ef));
  const lateEnd = input.deadline ? toDayNum(input.deadline) + 1 : projectEnd;
  backwardPass(order, allLinks, ctx, lateEnd);

  const byId = new Map(rts.map((r) => [r.op.id, r]));
  const criticalIds = new Set(rts.filter((r) => r.totalFloat <= 0).map((r) => r.op.id));

  // Критический путь: операции с нулевым (или отрицательным) общим резервом в хронологическом порядке
  const criticalPath = [...rts]
    .filter((r) => criticalIds.has(r.op.id))
    .sort((a, b) => a.es - b.es || a.ef - b.ef || a.op.order - b.op.order)
    .map((r) => r.op.id);
  // Ведущая цепочка: от последней операции назад по определяющим связям и ресурсам.
  // Обрывается на ограничении «не ранее» или окне недоступности ресурса.
  const drivingPath: string[] = [];
  {
    let cur: Runtime | undefined = [...rts]
      .filter((r) => r.ef === projectEnd)
      .sort((a, b) => b.op.order - a.op.order)[0];
    const visited = new Set<string>();
    while (cur && !visited.has(cur.op.id)) {
      visited.add(cur.op.id);
      drivingPath.push(cur.op.id);
      let next: Runtime | undefined;
      if (cur.resourceDelay && cur.es > cur.snappedBound) next = cur.resourceDelay.blockerId ? byId.get(cur.resourceDelay.blockerId) : undefined;
      else if (cur.driver.type === 'link') next = byId.get(cur.driver.link.from);
      cur = next;
    }
    drivingPath.reverse();
  }

  const warnings: EngineWarning[] = [];
  const operations = order
    .slice()
    .sort((a, b) => a.es - b.es || a.op.order - b.op.order)
    .map((rt) => toScheduled(rt, ctx, byId, criticalIds.has(rt.op.id)));

  // Ресурсные профили
  const resources: ResourceProfile[] = [];
  for (const pool of [...pools.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const usage: ResourceProfile['usage'] = [];
    let peak = 0;
    const m = ledger.days(pool.id);
    for (let d = projectStart; d < projectEnd; d++) {
      const used = Math.round((m.get(d) ?? 0) * 1000) / 1000;
      const cap = ledger.capacity(pool.id, d);
      peak = Math.max(peak, used);
      usage.push({ day: fromDayNum(d), used, capacity: cap });
    }
    resources.push({
      id: pool.id, name: pool.name, kind: pool.kind, capacity: pool.baseCapacity, unit: pool.unit,
      usage, peak, conflictsResolved: ledger.conflicts.get(pool.id) ?? 0,
    });
  }

  // Предупреждения
  collectWarnings(warnings, input, rts, operations, climate, projectStart, projectEnd, resources, criticalIds, lateEnd);

  const assumptions = collectAssumptions(input, rts, criticalIds);
  const confidence = computeConfidence(rts, criticalIds, input, projectStart, projectEnd);
  const questions = buildQuestions(input, assumptions, rts, criticalIds);

  const finishWithBuffer = input.technology.projectBufferDays > 0
    ? shiftTime(projectEnd, { value: input.technology.projectBufferDays, unit: 'work' }, mainCal)
    : projectEnd;

  const years: number[] = [];
  for (let y = yearOf(projectStart); y <= yearOf(Math.max(projectStart, finishWithBuffer - 1)); y++) years.push(y);

  const result: ScheduleResult = {
    meta: {
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      inputHash: hashObject({ input, ruleset: RULESET_VERSION }),
      resultHash: '',
      calendarData: years.map((y) => {
        const i = KZ_HOLIDAYS.yearInfo(y);
        return { year: y, status: i.status, source: i.source };
      }),
      climateSource: `${ASTANA_NORMALS.source} (${ASTANA_NORMALS.period})${input.forecast ? `; прогноз: ${input.forecast.source}, загружен ${input.forecast.fetchedAt}` : ''}`,
    },
    projectStart: fromDayNum(projectStart),
    projectFinish: fromDayNum(Math.max(projectStart, projectEnd - 1)),
    projectFinishWithBuffer: fromDayNum(Math.max(projectStart, finishWithBuffer - 1)),
    durationCalendarDays: projectEnd - projectStart,
    operations,
    links: allLinks,
    criticalPath,
    drivingPath,
    resources,
    warnings,
    assumptions,
    confidence,
    questions,
  };
  result.meta.resultHash = hashObject(operations.map((o) => [o.id, o.es, o.ef, o.ls, o.lf, o.totalFloat]));
  return result;
}

/* ─────────────────────────── Операция → результат с объяснением ─────────────────────────── */

function classifyDays(rt: Runtime, ctx: SchedulerContext): { counts: DayClassCount; holidays: string[] } {
  const counts: DayClassCount = { working: 0, weekend: 0, holiday: 0, transfer: 0, climate: 0, extra: 0 };
  const holidays: string[] = [];
  if (rt.elapsed) {
    counts.working = rt.ef - rt.es;
    return { counts, holidays };
  }
  for (let d = rt.es; d < rt.ef; d++) {
    const info = rt.cal.info(d);
    if (info.capacity > 0) {
      if (capacityOf(rt, ctx, d) > 0) counts.working++;
      else counts.climate++;
    } else if (info.type === 'weekend') counts.weekend++;
    else if (info.type === 'holiday') {
      counts.holiday++;
      holidays.push(`${formatRu(d)} — ${info.label}`);
    } else if (info.type === 'transfer') {
      counts.transfer++;
      holidays.push(`${formatRu(d)} — ${info.label}`);
    } else counts.extra++;
  }
  return { counts, holidays };
}

function describeGap(rt: Runtime, ctx: SchedulerContext, from: number, to: number): string {
  const parts: string[] = [];
  let climateDays = 0;
  for (let d = from; d < to; d++) {
    const info = rt.cal.info(d);
    if (info.capacity > 0) {
      if (capacityOf(rt, ctx, d) <= 0) climateDays++;
    } else parts.push(`${formatRu(d)} ${info.label.toLowerCase()}`);
  }
  if (climateDays) parts.push(`${climateDays} дн. — климатическое ограничение`);
  return parts.slice(0, 6).join('; ') + (parts.length > 6 ? `; … ещё ${parts.length - 6}` : '');
}

function toScheduled(rt: Runtime, ctx: SchedulerContext, byId: Map<string, Runtime>, critical: boolean): ScheduledOperation {
  const op = rt.op;
  const t = op.template;
  const ex: ExplanationFactor[] = [];
  const warnings = [...op.warnings];
  const tech = ctx.input.technology;

  // 1. Длительность
  if (t.kind === 'curing' && rt.strength) {
    const s = rt.strength;
    ex.push({
      kind: 'strength',
      text: `Технологический перерыв ${s.days} сут. (непрерывное время): требуемая прочность ${s.requiredLabel} = ${fmt(s.requiredFraction * 100, 1)} % от R28; достигнуто ${fmt(s.reachedFraction * 100, 1)} % при эквивалентном возрасте ${fmt(s.equivalentAgeDays, 2)} сут. Бетон B${tech.concreteClassMPa}, s = ${tech.cementS}. Температуры по суткам: ${s.temps.map((x) => fmt(x, 1)).join('; ')} °C. Модель: EN 1992-1-1 ф. 3.2 + прил. B (эквивалентный возраст).`,
    });
    if (s.winter) ex.push({ kind: 'winter', text: `Зимние условия: в сутки с ожидаемой t ср < +5 °C и t мин < 0 °C принята температура бетона +${tech.winterCuringTempC} °C (прогрев/термос по ППР).` });
    if (s.capped) warnings.push('Требуемая прочность не достигнута за 90 суток — проверьте параметры бетона и зимние мероприятия');
  } else if (t.kind === 'winterPrep') {
    if (rt.need > 0) ex.push({ kind: 'winter', text: `Зимние условия бетонирования на дату начала: добавлены мероприятия ${fmt(rt.need)} смены (${op.durationShiftsParam?.source ?? ''}).` });
    else if (rt.winter && tech.winterMeasuresIncludedInRates) ex.push({ kind: 'winter', text: 'Зимние условия, но мероприятия уже учтены в выработке — отдельно не добавлены (исключение двойного учёта).' });
    else ex.push({ kind: 'winter', text: 'Зимние условия бетонирования не ожидаются — мероприятия не требуются (длительность 0).' });
  } else if (!op.resolved) {
    ex.push({ kind: 'warning', text: 'Длительность НЕ рассчитана: отсутствуют данные о выработке/объёме/длительности. Введите значение в «Шаблонах».' });
  } else if (op.quantity !== null && op.productivity?.value) {
    ex.push({
      kind: 'duration',
      text: `Объём ${fmt(op.quantity)} ${t.unit} (${statusLabel(op.quantityStatus)}) ÷ выработка ${fmt(op.productivity.value)} ${op.productivity.unit ?? ''} (${statusLabel(op.productivity.status)}) ÷ ${op.crews} бригад(ы) = ${fmt(rt.need)} смены.`,
    });
  } else if (op.durationShiftsParam?.value != null) {
    ex.push({ kind: 'duration', text: `Длительность ${fmt(op.durationShiftsParam.value)} смены (${statusLabel(op.durationShiftsParam.status)}).` });
  }
  if (rt.winter && t.techGroup === 'Бетонирование') {
    ex.push({ kind: 'winter', text: 'Бетонирование в зимних условиях (СП 70.13330.2012, п. 5.11): перед ним в сеть включены зимние мероприятия, выдерживание — с прогревом.' });
  }

  // 2. Календарь
  const { counts, holidays } = classifyDays(rt, ctx);
  if (!rt.elapsed && rt.ef > rt.es) {
    const cal = rt.cal as WorkCalendar;
    let text = `Календарь «${cal.name}» (${regimeLabel(cal)}). Период ${formatRu(rt.es)}–${formatRu(rt.ef - 1)}: ${rt.ef - rt.es} кал. дн., из них рабочих ${counts.working}`;
    if (counts.weekend) text += `, выходных ${counts.weekend}`;
    if (counts.holiday) text += `, праздничных ${counts.holiday}`;
    if (counts.transfer) text += `, перенесённых выходных ${counts.transfer}`;
    if (counts.climate) text += `, климатических остановок ${counts.climate}`;
    if (counts.extra) text += `, прочих нерабочих ${counts.extra}`;
    text += '.';
    if (holidays.length) text += ` Праздники/переносы: ${holidays.join('; ')}.`;
    ex.push({ kind: 'calendar', text });
  }

  // 3. Что определило раннее начало
  const d = rt.driver;
  if (d.type === 'projectStart') ex.push({ kind: 'predecessor', text: `Раннее начало определено датой старта работ ${formatRu(ctx.projectStart)}.` });
  else if (d.type === 'constraint') ex.push({ kind: 'constraint', text: `Ограничение «не ранее ${formatRu(d.day)}»: ${d.reason}.` });
  else {
    const p = byId.get(d.link.from)!;
    const lag = d.link.lag.value ? `, лаг ${d.link.lag.value > 0 ? '+' : ''}${d.link.lag.value} ${d.link.lag.unit === 'work' ? 'раб.' : 'кал.'} дн.` : '';
    const pd = d.link.type === 'FS' || d.link.type === 'FF' ? `окончание ${formatRu(Math.max(p.es, p.ef - 1))}` : `начало ${formatRu(p.es)}`;
    ex.push({ kind: 'predecessor', text: `Определяющая связь ${d.link.type}${lag} от «${p.op.template.name}» (${p.op.locationLabel}; ${pd}). ${d.link.note ?? ''}`.trim() });
  }
  if (!rt.elapsed && rt.snappedBound > rt.startBound) {
    ex.push({ kind: 'calendar', text: `Начало сдвинуто с ${formatRu(rt.startBound)} на ${formatRu(rt.snappedBound)}: ${describeGap(rt, ctx, rt.startBound, rt.snappedBound)}.` });
  }
  let waitDays = 0;
  if (rt.resourceDelay && rt.es > rt.snappedBound) {
    waitDays = rt.es - rt.snappedBound;
    const rd = rt.resourceDelay;
    const blocker = rd.blockerId ? byId.get(rd.blockerId) : null;
    const reason = rd.window
      ? `ресурс недоступен: ${rd.window}`
      : blocker
        ? `ресурс занят операцией «${blocker.op.template.name}» (${blocker.op.locationLabel}) до ${formatRu(blocker.ef - 1)}`
        : 'ресурс занят другими операциями';
    ex.push({ kind: 'resource', text: `Ожидание ресурса «${rd.resourceId}» ${waitDays} кал. дн. (организационный простой): ${reason}.` });
  }

  // 4. Климат
  if (op.minAirTemp?.value != null) {
    ex.push({ kind: 'climate', text: `Климатическое ограничение: ожидаемая среднесуточная t ≥ ${op.minAirTemp.value} °C (${statusLabel(op.minAirTemp.status)}; ${op.minAirTemp.source}). Оценка по ${ctx.climate.hasForecast ? 'прогнозу (в пределах его дат) и ' : ''}климатической норме, не прогноз конкретного дня.` });
  }
  if (op.craneWind && ctx.climate.hasForecast) ex.push({ kind: 'climate', text: `Крановая операция: остановка при прогнозе ветра > ${ctx.input.craneWindLimitMs} м/с.` });
  if (op.climateNote) ex.push({ kind: 'climate', text: op.climateNote });

  // 5. Резервы
  ex.push({
    kind: 'float',
    text: `Позднее начало ${formatRu(rt.ls)}, позднее окончание ${formatRu(Math.max(rt.ls, rt.lf - 1))}. Общий резерв ${rt.totalFloat} раб. дн., свободный ${rt.freeFloat} раб. дн.${critical ? ' Операция на критическом пути.' : ''}`,
  });

  // 6. Источники
  const src: string[] = [];
  if (op.quantitySource) src.push(`Объём: ${op.quantitySource}`);
  if (op.productivity) src.push(`Выработка: ${op.productivity.source}`);
  src.push(`Норма/обоснование: ${t.normSource}`);
  ex.push({ kind: 'source', text: src.join('. ') });

  if (op.productivity && !RELIABLE_STATUSES.includes(op.productivity.status)) warnings.push('Выработка — сценарное значение, требует подтверждения');
  if (op.quantity !== null && !RELIABLE_STATUSES.includes(op.quantityStatus)) warnings.push('Объём определён по удельному показателю — уточните по ВОР');
  for (const w of warnings) ex.push({ kind: 'warning', text: w });

  return {
    id: op.id,
    templateKey: t.key,
    name: t.name,
    group: t.group,
    category: t.category,
    kind: t.kind,
    buildingId: op.building.id,
    sectionId: op.section.id,
    floor: t.level === 'foundation' ? -op.section.basementFloors : op.floor,
    zone: op.zone,
    locationLabel: op.locationLabel,
    unit: t.unit,
    quantity: op.quantity,
    quantityStatus: op.quantityStatus,
    productivity: op.productivity?.value ?? null,
    productivityStatus: op.productivity?.status ?? 'missing',
    productivitySource: op.productivity?.source ?? '',
    crews: op.crews,
    crewSize: op.crewSize,
    workShifts: Math.round(rt.need * 1000) / 1000,
    resolved: op.resolved,
    calendarId: op.calendarId,
    es: rt.es,
    ef: rt.ef,
    ls: rt.ls,
    lf: rt.lf,
    start: fromDayNum(rt.es),
    finish: fromDayNum(rt.ef > rt.es ? rt.ef - 1 : rt.es),
    calendarDays: rt.ef - rt.es,
    workingDays: counts.working,
    totalFloat: rt.totalFloat,
    freeFloat: rt.freeFloat,
    critical,
    waitDays,
    dayClasses: counts,
    strength: rt.strength,
    winterApplied: rt.winter && (t.kind !== 'winterPrep' || rt.need > 0),
    explanation: ex,
    warnings,
    resourceDemands: op.demands.map((x) => ({ resourceId: x.resourceId, units: x.units })),
    qualityControl: t.qualityControl,
  };
}

/* ─────────────────────────── Предупреждения и риски ─────────────────────────── */

function collectWarnings(
  out: EngineWarning[],
  input: ProjectInput,
  rts: Runtime[],
  ops: ScheduledOperation[],
  climate: ClimateEngine,
  start: DayNum,
  end: DayNum,
  resources: ResourceProfile[],
  critical: Set<string>,
  lateEnd: number,
) {
  for (let y = yearOf(start); y <= yearOf(Math.max(start, end - 1)); y++) {
    const info = KZ_HOLIDAYS.yearInfo(y);
    if (info.status === 'preliminary') out.push({ code: 'calendar-preliminary', severity: 'warning', text: `Календарь ${y} г. — ПРЕДВАРИТЕЛЬНЫЙ: ${info.note ?? ''}` });
    else if (info.status === 'rule-only') out.push({ code: 'calendar-rule-only', severity: 'warning', text: `Календарь ${y} г.: учтены только постоянные праздники. ${info.note ?? ''}` });
    else if (info.status === 'secondary') out.push({ code: 'calendar-secondary', severity: 'info', text: `Календарь ${y} г. сверен по вторичным источникам (${info.source}). Для договорных сроков сверьте с adilet.zan.kz.` });
  }

  const unresolved = ops.filter((o) => !o.resolved);
  if (unresolved.length) {
    out.push({ code: 'unresolved', severity: 'error', text: `Для ${unresolved.length} операций нет данных для расчёта длительности — они показаны с нулевой длительностью и ДОЛЖНЫ быть уточнены.`, opIds: unresolved.map((o) => o.id) });
  }

  const unconfirmedCrit = ops.filter((o) => o.critical && o.kind === 'work' && o.resolved && !RELIABLE_STATUSES.includes(o.productivityStatus));
  if (unconfirmedCrit.length) {
    const keys = [...new Set(unconfirmedCrit.map((o) => o.name))];
    out.push({ code: 'critical-assumptions', severity: 'warning', text: `На критическом пути ${unconfirmedCrit.length} операций со сценарной выработкой (${keys.slice(0, 5).join('; ')}${keys.length > 5 ? '…' : ''}). Подтвердите фактическую выработку.`, opIds: unconfirmedCrit.map((o) => o.id) });
  }

  const winterPours = ops.filter((o) => o.winterApplied && o.kind === 'work');
  if (winterPours.length) {
    out.push({ code: 'winter-concreting', severity: 'info', text: `Бетонирование в зимних условиях: ${winterPours.length} операций. Требуются ППР/техкарта прогрева, контроль температуры, подтверждение прочности до распалубки.`, opIds: winterPours.map((o) => o.id) });
  }

  const capped = ops.filter((o) => o.strength?.capped);
  if (capped.length) out.push({ code: 'curing-capped', severity: 'error', text: `Для ${capped.length} операций требуемая прочность не достигается за 90 суток.`, opIds: capped.map((o) => o.id) });

  const paused = ops.filter((o) => o.dayClasses.climate > 0);
  if (paused.length) out.push({ code: 'climate-paused', severity: 'warning', text: `${paused.length} операций приостанавливаются из-за климатических ограничений (по климатической норме). Рассмотрите тепляки/временное отопление или перенос.`, opIds: paused.map((o) => o.id) });

  const delayedByClimate = rts.filter((r) => !r.elapsed && r.snappedBound > r.startBound && hasClimateGap(r, r.startBound, r.snappedBound, input, climate));
  if (delayedByClimate.length) out.push({ code: 'climate-delayed', severity: 'warning', text: `${delayedByClimate.length} операций ожидают допустимого климатического окна.`, opIds: delayedByClimate.map((r) => r.op.id) });

  for (const r of resources) {
    if (r.conflictsResolved > 0) out.push({ code: 'resource-conflict', severity: 'info', text: `Ресурс «${r.name}»: обнаружено и разрешено конфликтов совмещения — ${r.conflictsResolved} (операции сдвинуты).` });
  }
  const waits = ops.filter((o) => o.waitDays > 0 && o.critical);
  if (waits.length) out.push({ code: 'resource-wait-critical', severity: 'warning', text: `${waits.length} критических операций ожидают ресурс (организационный простой ${waits.reduce((s, o) => s + o.waitDays, 0)} кал. дн. суммарно).`, opIds: waits.map((o) => o.id) });

  if (climate.hasForecast) out.push({ code: 'forecast', severity: 'info', text: 'В пределах дат прогноза климатическая норма заменена прогнозом погоды (снимок сохранён в исходных данных).' });
  else out.push({ code: 'climate-stats', severity: 'info', text: 'Сезонные ограничения оценены по климатической норме 1991–2020 (среднемноголетние значения), а не по прогнозу.' });

  const craneCrit = rts.filter((r) => r.op.craneWind && critical.has(r.op.id));
  if (craneCrit.length) {
    if (!input.strongWind) {
      out.push({ code: 'wind-data-missing', severity: 'info', text: 'Нет статистики дней с ветром выше ограничения крана — климатический резерв по ветру не рассчитан. Введите данные Казгидромета или используйте оперативный прогноз.' });
    } else {
      let expected = 0;
      for (const r of craneCrit) for (const d of r.days) expected += climate.strongWindShare(d) ?? 0;
      out.push({ code: 'wind-reserve', severity: 'warning', text: `Ожидаемые потери крановых операций критического пути из-за ветра ≈ ${fmt(expected, 1)} раб. дн. (статистика, не включено в даты). Рекомендуется учесть в резерве на риски.` });
    }
  }

  if (input.technology.temporaryHeating && input.workGroups.some((g) => ['plaster_screed', 'tiling', 'painting', 'flooring', 'waterproofing'].includes(g))) {
    out.push({ code: 'temp-heating', severity: 'info', text: 'Внутренние «мокрые» процессы зимой рассчитаны с допущением временного отопления (нужны тепловой контур, источник тепла, затраты).' });
  }
  if (lateEnd < end) {
    const neg = ops.filter((o) => o.totalFloat < 0);
    out.push({ code: 'deadline', severity: 'error', text: `Директивный срок ${formatRu(lateEnd - 1)} не выдерживается: расчётное окончание ${formatRu(end - 1)}. Операций с отрицательным резервом: ${neg.length}.`, opIds: neg.map((o) => o.id) });
  }
}

function hasClimateGap(r: Runtime, from: number, to: number, input: ProjectInput, climate: ClimateEngine): boolean {
  const ctx: SchedulerContext = { input, climate, mainCal: r.cal, projectStart: from };
  for (let d = from; d < to; d++) if (r.cal.capacity(d) > 0 && capacityOf(r, ctx, d) <= 0) return true;
  return false;
}

/* ─────────────────────────── Допущения, достоверность, вопросы ─────────────────────────── */

const TECH_META: { key: string; label: string; get: (i: ProjectInput) => string; status: DataStatus; source: string }[] = [
  { key: 'technology.concreteClassMPa', label: 'Класс бетона', get: (i) => `B${i.technology.concreteClassMPa}`, status: 'assumption', source: 'Принять по проекту (КЖ)' },
  { key: 'technology.cementS', label: 'Коэффициент s (тип цемента)', get: (i) => String(i.technology.cementS), status: 'assumption', source: 'EN 1992-1-1, п. 3.1.2 — выбрать по паспорту цемента' },
  { key: 'technology.verticalStripMPa', label: 'Прочность распалубки стен', get: (i) => `${i.technology.verticalStripMPa} МПа`, status: 'normative', source: 'СП 70.13330.2012, табл. 5.11 (0,2–0,3 МПа)' },
  { key: 'technology.slabStripPercent', label: 'Прочность распалубки перекрытий', get: (i) => (i.technology.slabStripPercent === null ? 'по пролёту: 70 % / 80 %' : `${i.technology.slabStripPercent} %`), status: 'normative', source: 'СП 70.13330.2012, табл. 5.11; иное — по ППР с переопиранием' },
  { key: 'technology.walkStrengthMPa', label: 'Прочность для движения людей / опалубки выше', get: (i) => `${i.technology.walkStrengthMPa} МПа`, status: 'normative', source: 'СП 70.13330.2012' },
  { key: 'technology.winterCuringTempC', label: 'Температура бетона при зимнем выдерживании', get: (i) => `+${i.technology.winterCuringTempC} °C`, status: 'assumption', source: 'По ППР / техкарте прогрева' },
  { key: 'technology.masonryLagFloors', label: 'Отставание кладки от монолита', get: (i) => `${i.technology.masonryLagFloors} эт.`, status: 'assumption', source: 'По ППР (безопасность работ под монтажным горизонтом)' },
  { key: 'resources.slabFormworkSets', label: 'Комплектов опалубки перекрытий', get: (i) => String(i.resources.slabFormworkSets), status: 'assumption', source: 'Уточнить у подрядчика' },
  { key: 'resources.wallFormworkSets', label: 'Комплектов опалубки стен', get: (i) => String(i.resources.wallFormworkSets), status: 'assumption', source: 'Уточнить у подрядчика' },
  { key: 'resources.concreteSupplyM3PerDay', label: 'Поставка бетона', get: (i) => `${i.resources.concreteSupplyM3PerDay} м³/сут`, status: 'assumption', source: 'Договор поставки / мощность БСУ' },
];

function collectAssumptions(input: ProjectInput, rts: Runtime[], critical: Set<string>): AssumptionRecord[] {
  const res: AssumptionRecord[] = [];
  const confirmed = new Set(input.confirmedParams);
  const byKey = new Map<string, Runtime[]>();
  for (const r of rts) {
    const arr = byKey.get(r.op.template.key) ?? [];
    arr.push(r);
    byKey.set(r.op.template.key, arr);
  }
  for (const [key, list] of byKey) {
    const op = list[0].op;
    const critShifts = list.filter((r) => critical.has(r.op.id)).reduce((s, r) => s + (r.elapsed ? 0 : r.need), 0);
    const p = op.productivity ?? op.durationShiftsParam;
    if (p) {
      res.push({
        key: `op:${key}`,
        label: `${op.template.name}: ${op.productivity ? 'выработка' : 'длительность'}`,
        value: p.value === null ? '—' : `${fmt(p.value)} ${p.unit ?? ''}`,
        status: p.status,
        source: p.source,
        affectsCritical: critShifts > 0,
        impactShifts: Math.round(critShifts * 10) / 10,
      });
    }
    if (op.template.quantity && op.quantityStatus !== 'project' && op.quantityStatus !== 'confirmed') {
      res.push({
        key: `qty:${key}`,
        label: `${op.template.name}: объём`,
        value: `${op.template.quantity.ratio} ${op.template.unit}/м²`,
        status: op.quantityStatus,
        source: op.template.quantity.source,
        affectsCritical: critShifts > 0,
        impactShifts: Math.round(critShifts * 10) / 10,
      });
    }
  }
  for (const g of input.workGroups) {
    const k = `resources.crews.${g}`;
    const crit = rts.filter((r) => r.op.template.group === g && critical.has(r.op.id)).reduce((s, r) => s + (r.elapsed ? 0 : r.need), 0);
    res.push({
      key: k, label: `Бригад: ${GROUP_NAMES[g]}`, value: String(input.resources.crews[g]),
      status: confirmed.has(k) ? 'confirmed' : 'assumption', source: 'Уточнить у подрядчика',
      affectsCritical: crit > 0, impactShifts: Math.round(crit * 10) / 10,
    });
  }
  const mono = input.workGroups.includes('monolith');
  for (const m of TECH_META) {
    if (!mono && (m.key.startsWith('technology.') && m.key !== 'technology.masonryLagFloors' || m.key.includes('Formwork') || m.key.includes('concrete'))) continue;
    res.push({
      key: m.key, label: m.label, value: m.get(input),
      status: confirmed.has(m.key) ? 'confirmed' : m.status, source: m.source,
      affectsCritical: mono, impactShifts: 0,
    });
  }
  return res.sort((a, b) => Number(b.affectsCritical) - Number(a.affectsCritical) || b.impactShifts - a.impactShifts || a.key.localeCompare(b.key));
}

function computeConfidence(rts: Runtime[], critical: Set<string>, input: ProjectInput, start: DayNum, end: DayNum): ScheduleResult['confidence'] {
  let total = 0;
  let reliable = 0;
  const confirmed = new Set(input.confirmedParams);
  const curingReliable = confirmed.has('technology.cementS') && confirmed.has('technology.concreteClassMPa');
  for (const r of rts) {
    if (!critical.has(r.op.id)) continue;
    const w = r.need;
    if (w <= 0) continue;
    total += w;
    if (r.elapsed) {
      if (curingReliable) reliable += w;
      continue;
    }
    if (!r.op.resolved) continue;
    const p = r.op.productivity ?? r.op.durationShiftsParam;
    const pOk = p ? RELIABLE_STATUSES.includes(p.status) : true;
    const qOk = r.op.quantity === null || RELIABLE_STATUSES.includes(r.op.quantityStatus);
    if (pOk && qOk) reliable += w;
  }
  const score = total > 0 ? reliable / total : 0;
  let level: 'high' | 'medium' | 'low' = score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
  let calNote = '';
  for (let y = yearOf(start); y <= yearOf(Math.max(start, end - 1)); y++) {
    const s = KZ_HOLIDAYS.yearInfo(y).status;
    if (s === 'preliminary' || s === 'rule-only') {
      if (level === 'high') level = 'medium';
      calNote = ' Календарь части лет предварительный.';
    }
  }
  if (rts.some((r) => !r.op.resolved)) level = 'low';
  return {
    level,
    score: Math.round(score * 100) / 100,
    explanation: `Доля длительности критического пути, обоснованной подтверждёнными/проектными/нормативными данными: ${Math.round(score * 100)} %.${calNote}`,
  };
}

function buildQuestions(
  input: ProjectInput,
  assumptions: AssumptionRecord[],
  rts: Runtime[],
  critical: Set<string>,
): ScheduleResult['questions'] {
  const q: ScheduleResult['questions'] = [];
  const confirmed = new Set(input.confirmedParams);
  const crewQ = assumptions
    .filter((a) => a.key.startsWith('resources.crews.') && a.affectsCritical && !confirmed.has(a.key))
    .sort((a, b) => b.impactShifts - a.impactShifts)
    .slice(0, 3);
  for (const a of crewQ) {
    const g = a.key.split('.')[2];
    q.push({ key: a.key, text: `Сколько бригад работает на виде работ «${GROUP_NAMES[g]}»?`, reason: `Влияет на критический путь (${a.impactShifts} смен).` });
  }
  const topProd = assumptions.filter((a) => a.key.startsWith('op:') && a.affectsCritical && a.status === 'assumption').slice(0, 3);
  for (const a of topProd) {
    const name = a.label.replace(/: (выработка|длительность)$/, '');
    q.push({ key: a.key, text: `Подтвердите фактическую ${a.label.endsWith('выработка') ? 'выработку' : 'длительность'} «${name}». Сейчас: ${a.value} (сценарий).`, reason: `На критическом пути: ${a.impactShifts} смен.` });
  }
  if (input.workGroups.includes('monolith') && !confirmed.has('resources.slabFormworkSets')) {
    const turnoverCrit = rts.some((r) => critical.has(r.op.id) && r.op.template.key === 'mono.slab.formwork' && r.driver.type === 'link' && r.driver.link.origin === 'turnover');
    q.push({ key: 'resources.slabFormworkSets', text: 'Сколько комплектов опалубки перекрытий будет на объекте?', reason: turnoverCrit ? 'Оборачиваемость опалубки ограничивает критический путь.' : 'Определяет оборачиваемость опалубки.' });
  }
  const winterOps = rts.some((r) => r.winter);
  if (winterOps && !confirmed.has('technology.winterCuringTempC')) {
    q.push({ key: 'technology.winterCuringTempC', text: 'Какой способ зимнего бетонирования предусмотрен ППР (температура выдерживания)?', reason: 'Работы попадают на зимний период; определяет длительность набора прочности.' });
  }
  if (input.calendar.shiftsPerDay === 1 && !confirmed.has('calendar.shiftsPerDay')) {
    q.push({ key: 'calendar.shiftsPerDay', text: 'Разрешена ли работа во 2-ю смену?', reason: 'Сокращает длительность трудоёмких операций.' });
  }
  if (input.workGroups.includes('monolith') && !confirmed.has('technology.concreteClassMPa')) {
    q.push({ key: 'technology.concreteClassMPa', text: 'Какой класс бетона и цемент предусмотрены проектом?', reason: 'Определяют скорость набора прочности.' });
  }
  return q;
}

export type { NetworkOp };
