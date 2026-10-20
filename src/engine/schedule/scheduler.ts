/**
 * Schedule Engine — детерминированный расчёт ГПР.
 *
 * 1. Проверка ацикличности сети.
 * 2. Прямой проход без ресурсов (топологический порядок) + обратный проход →
 *    приоритеты (позднее начало) для ресурсного планирования.
 * 3. Последовательная схема генерации расписания (serial SGS) с учётом:
 *    связей FS/SS/FF/SF с лагами (рабочие/календарные дни), календарей операций,
 *    климатических окон, ограничений «не ранее», пулов ресурсов и окон их недоступности.
 *    Операции не прерываются ради ресурсов (non-preemptive), но приостанавливаются
 *    в нерабочие и климатически недопустимые дни.
 * 4. Ресурсные связи: если операция сдвинута из-за ресурса, фиксируется операция,
 *    освободившая ресурс (как в методе «ресурсно-критического пути»).
 * 5. Обратный проход по технологическим и ресурсным связям → поздние сроки,
 *    общий и свободный резервы, критический путь.
 *
 * Время — границы суток (см. dates.ts). Длительности технологических перерывов
 * (набор прочности) зависят от даты начала и рассчитываются в прямом проходе;
 * в обратном проходе используются длительности из прямого прохода.
 */
import type { Calendar } from '../calendar/workCalendar';
import type { ClimateEngine } from '../climate/climate';
import { computeCuring, slabStripPercentBySpan, type CuringRequirement } from '../climate/concrete';
import { toDayNum, type DayNum } from '../dates';
import type { Lag, ProjectInput, ResolvedLink, StrengthTrace } from '../types';
import type { NetworkOp } from './network';
import type { ResourceLedger } from './resources';

export const MAX_SEARCH_DAYS = 365 * 4;
const EPS = 1e-9;

export class EngineError extends Error {
  constructor(message: string, readonly details?: string[]) {
    super(message);
    this.name = 'EngineError';
  }
}

export type Driver =
  | { type: 'projectStart' }
  | { type: 'constraint'; reason: string; day: DayNum }
  | { type: 'link'; link: ResolvedLink };

export interface ResourceDelay {
  resourceId: string;
  blockerId: string | null;
  window: string | null;
  fromDay: DayNum;
}

export interface Runtime {
  op: NetworkOp;
  cal: Calendar;
  /** Календарь для пересчёта резервов в рабочие дни */
  floatCal: Calendar;
  elapsed: boolean;
  // результаты прямого прохода
  es: number;
  ef: number;
  days: DayNum[];
  shiftsUsed: number[];
  need: number; // смен (для перерывов — суток)
  winter: boolean;
  strength?: StrengthTrace;
  driver: Driver;
  startBound: number; // max по связям/ограничениям (до учёта календаря)
  snappedBound: number; // с учётом календаря/климата
  resourceDelay: ResourceDelay | null;
  // обратный проход
  ls: number;
  lf: number;
  totalFloat: number;
  freeFloat: number;
  scheduled: boolean;
}

export interface SchedulerContext {
  input: ProjectInput;
  climate: ClimateEngine;
  mainCal: Calendar;
  projectStart: DayNum;
}

/* ───────────── Календарные операции ───────────── */

export function capacityOf(rt: Runtime, ctx: SchedulerContext, d: DayNum): number {
  const c = rt.cal.capacity(d);
  if (c <= 0) return 0;
  return climateAllowed(rt.op, ctx, d) ? c : 0;
}

export function climateAllowed(op: NetworkOp, ctx: SchedulerContext, d: DayNum): boolean {
  if (op.minAirTemp && op.minAirTemp.value !== null) {
    if (ctx.climate.weather(d).tMean < op.minAirTemp.value) return false;
  }
  if (op.craneWind) {
    const w = ctx.climate.weather(d).windMaxMs;
    if (w !== null && w > ctx.input.craneWindLimitMs) return false;
  }
  return true;
}

/** Сдвиг момента t на lag: рабочие дни — по календарю cal (без климата), календарные — как есть. */
export function shiftTime(t: number, lag: Lag, cal: Calendar): number {
  if (lag.value === 0) return t;
  if (lag.unit === 'calendar' || cal.continuous) return t + lag.value;
  let d = t;
  let n = Math.abs(lag.value);
  let guard = 0;
  if (lag.value > 0) {
    while (n > 0) {
      if (cal.capacity(d) > 0) n--;
      d++;
      if (++guard > MAX_SEARCH_DAYS) throw new EngineError('Не удалось отсчитать лаг: в календаре нет рабочих дней');
    }
    return d;
  }
  while (n > 0) {
    d--;
    if (cal.capacity(d) > 0) n--;
    if (++guard > MAX_SEARCH_DAYS) throw new EngineError('Не удалось отсчитать лаг: в календаре нет рабочих дней');
  }
  return d;
}

/** Число рабочих дней в [a, b) (отрицательное, если b < a). */
export function workDaysBetween(cal: Calendar, a: number, b: number): number {
  if (a === b) return 0;
  const sign = b > a ? 1 : -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let n = 0;
  for (let d = lo; d < hi; d++) if (cal.capacity(d) > 0) n++;
  return sign * n;
}

/* ───────────── Набор прочности ───────────── */

function curingRequirement(rt: Runtime, ctx: SchedulerContext): CuringRequirement {
  const tech = ctx.input.technology;
  switch (rt.op.template.curing) {
    case 'verticalStrip':
      return { kind: 'mpa', value: tech.verticalStripMPa, label: `${tech.verticalStripMPa} МПа (распалубка вертикальных конструкций)` };
    case 'walk':
      return { kind: 'mpa', value: tech.walkStrengthMPa, label: `${tech.walkStrengthMPa} МПа (движение людей, опалубка выше)` };
    case 'slabStrip':
    default: {
      const pct = tech.slabStripPercent ?? slabStripPercentBySpan(rt.op.section.slabSpanM);
      const basis = tech.slabStripPercent === null ? `по пролёту ${rt.op.section.slabSpanM} м` : 'задано пользователем';
      return { kind: 'percent', value: pct, label: `${pct} % проектной прочности (${basis})` };
    }
  }
}

function placeCuring(rt: Runtime, ctx: SchedulerContext, t: number) {
  const tech = ctx.input.technology;
  const req = curingRequirement(rt, ctx);
  let winter = false;
  const res = computeCuring({
    requirement: req,
    concreteClassMPa: tech.concreteClassMPa,
    cementS: tech.cementS,
    minDays: 1,
    maxDays: 90,
    tempForDay: (i) => {
      const d = t + i;
      if (ctx.climate.isWinterConcreting(d)) {
        winter = true;
        return tech.winterCuringTempC;
      }
      return ctx.climate.weather(d).tMean;
    },
  });
  const days: DayNum[] = [];
  for (let i = 0; i < res.days; i++) days.push(t + i);
  const trace: StrengthTrace = {
    requiredLabel: req.label,
    requiredFraction: res.requiredFraction,
    reachedFraction: res.reachedFraction,
    days: res.days,
    winter,
    temps: res.temps,
    equivalentAgeDays: res.equivalentAgeDays,
    capped: res.capped,
  };
  return { es: t, ef: t + res.days, days, shiftsUsed: days.map(() => 1), need: res.days, winter, strength: trace };
}

/* ───────────── Размещение операции ───────────── */

interface Placement {
  es: number;
  ef: number;
  days: DayNum[];
  shiftsUsed: number[];
  need: number;
  winter: boolean;
  strength?: StrengthTrace;
}

function firstWorkDay(rt: Runtime, ctx: SchedulerContext, t: number): number {
  let d = t;
  let guard = 0;
  while (capacityOf(rt, ctx, d) <= 0) {
    d++;
    if (++guard > MAX_SEARCH_DAYS) {
      throw new EngineError(
        `Операция «${rt.op.template.name}» (${rt.op.locationLabel}) не может быть выполнена: нет допустимых рабочих дней в течение ${MAX_SEARCH_DAYS} суток (календарь или климатическое ограничение)`,
      );
    }
  }
  return d;
}

function needFor(rt: Runtime, ctx: SchedulerContext, t: number): { need: number; winter: boolean } {
  const tpl = rt.op.template;
  if (tpl.kind === 'winterPrep') {
    if (rt.op.workShifts <= 0) return { need: 0, winter: false };
    const d = firstWorkDay(rt, ctx, t);
    const winter = ctx.climate.isWinterConcreting(d);
    if (!winter || ctx.input.technology.winterMeasuresIncludedInRates) return { need: 0, winter };
    return { need: rt.op.workShifts, winter };
  }
  if (tpl.techGroup === 'Бетонирование' && tpl.kind === 'work') {
    const d = rt.op.workShifts > 0 ? firstWorkDay(rt, ctx, t) : t;
    return { need: rt.op.workShifts, winter: ctx.climate.isWinterConcreting(d) };
  }
  return { need: rt.op.resolved ? rt.op.workShifts : 0, winter: false };
}

export function place(rt: Runtime, ctx: SchedulerContext, t: number): Placement {
  if (rt.elapsed) return placeCuring(rt, ctx, t);
  const { need, winter } = needFor(rt, ctx, t);
  return placeWork(rt, ctx, t, need, winter);
}

function placeWork(rt: Runtime, ctx: SchedulerContext, t: number, need: number, winter: boolean): Placement {
  if (need <= EPS) return { es: t, ef: t, days: [], shiftsUsed: [], need: 0, winter };
  const start = firstWorkDay(rt, ctx, t);
  const days: DayNum[] = [];
  const shiftsUsed: number[] = [];
  let acc = 0;
  let d = start;
  let guard = 0;
  for (;;) {
    const c = capacityOf(rt, ctx, d);
    if (c > 0) {
      const use = Math.min(c, need - acc);
      days.push(d);
      shiftsUsed.push(use);
      acc += use;
      if (acc >= need - EPS) break;
    }
    d++;
    if (++guard > MAX_SEARCH_DAYS) throw new EngineError(`Операция «${rt.op.template.name}» не укладывается в горизонт расчёта`);
  }
  return { es: start, ef: d + 1, days, shiftsUsed, need, winter };
}

/** Размещение с фиксированной потребностью (для обратного прохода и свободного резерва). */
export function finishFromStart(rt: Runtime, ctx: SchedulerContext, t: number): number {
  if (rt.elapsed) return t + rt.need;
  return placeWork(rt, ctx, t, rt.need, rt.winter).ef;
}

export function startFromFinish(rt: Runtime, ctx: SchedulerContext, lf: number): number {
  if (rt.elapsed) return lf - rt.need;
  if (rt.need <= EPS) return lf;
  let acc = 0;
  let d = lf - 1;
  let guard = 0;
  for (;;) {
    const c = capacityOf(rt, ctx, d);
    if (c > 0) {
      acc += c;
      if (acc >= rt.need - EPS) return d;
    }
    d--;
    if (++guard > MAX_SEARCH_DAYS) throw new EngineError(`Обратный проход: операция «${rt.op.template.name}» не укладывается в горизонт`);
  }
}

/** Последний момент окончания ≤ lf, совпадающий с концом рабочего дня. */
function snapFinishBack(rt: Runtime, ctx: SchedulerContext, lf: number): number {
  if (rt.elapsed || rt.need <= EPS) return lf;
  let d = lf - 1;
  let guard = 0;
  while (capacityOf(rt, ctx, d) <= 0) {
    d--;
    if (++guard > MAX_SEARCH_DAYS) return lf;
  }
  return d + 1;
}

/* ───────────── Прямой проход ───────────── */

interface ForwardOptions {
  useResources: boolean;
  ledger?: ResourceLedger;
  priority?: Map<string, number>;
}

export function topoOrder(rts: Runtime[], links: ResolvedLink[]): Runtime[] {
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const r of rts) {
    indeg.set(r.op.id, 0);
    out.set(r.op.id, []);
  }
  for (const l of links) {
    indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1);
    out.get(l.from)!.push(l.to);
  }
  const byId = new Map(rts.map((r) => [r.op.id, r]));
  const ready = rts.filter((r) => indeg.get(r.op.id) === 0).sort((a, b) => a.op.order - b.op.order);
  const res: Runtime[] = [];
  while (ready.length) {
    const r = ready.shift()!;
    res.push(r);
    for (const v of out.get(r.op.id)!) {
      const n = indeg.get(v)! - 1;
      indeg.set(v, n);
      if (n === 0) {
        const vr = byId.get(v)!;
        let i = 0;
        while (i < ready.length && ready[i].op.order < vr.op.order) i++;
        ready.splice(i, 0, vr);
      }
    }
  }
  if (res.length !== rts.length) throw new EngineError('Сеть содержит цикл — расчёт невозможен');
  return res;
}

interface Bounds {
  sb: number;
  driver: Driver;
  fb: number;
  fDriver: Driver | null;
  snapped: number;
}

function computeBounds(rt: Runtime, incoming: ResolvedLink[], byId: Map<string, Runtime>, ctx: SchedulerContext): Bounds {
  let sb = ctx.projectStart;
  let driver: Driver = { type: 'projectStart' };
  let fb = -Infinity;
  let fDriver: Driver | null = null;
  for (const c of rt.op.notBefore) {
    const d = toDayNum(c.day);
    if (d > sb) {
      sb = d;
      driver = { type: 'constraint', reason: c.reason, day: d };
    }
  }
  for (const l of incoming) {
    const b = linkBound(l, byId.get(l.from)!, rt, ctx);
    if (b.start !== undefined && b.start > sb) {
      sb = b.start;
      driver = { type: 'link', link: l };
    }
    if (b.finish !== undefined && b.finish > fb) {
      fb = b.finish;
      fDriver = { type: 'link', link: l };
    }
  }
  return { sb, driver, fb, fDriver, snapped: place(rt, ctx, sb).es };
}

/** Размещение не ранее t с учётом ограничения на окончание (FF/SF). */
function placeRespectingFinish(rt: Runtime, ctx: SchedulerContext, t: number, fb: number): { p: Placement; finishDriven: boolean } {
  let p = place(rt, ctx, t);
  let finishDriven = false;
  let guard = 0;
  while (p.ef < fb) {
    finishDriven = true;
    t = p.days.length === 0 ? fb : p.es + 1;
    p = place(rt, ctx, t);
    if (++guard > MAX_SEARCH_DAYS) throw new EngineError(`Операция «${rt.op.template.name}»: не удаётся выполнить ограничение на окончание`);
  }
  return { p, finishDriven };
}

function commit(rt: Runtime, p: Placement, bounds: Bounds, finishDriven: boolean, opts: ForwardOptions) {
  if (opts.useResources && opts.ledger) {
    for (let i = 0; i < p.days.length; i++) {
      for (const dm of rt.op.demands) {
        opts.ledger.add(dm.resourceId, p.days[i], dm.perShift ? dm.units * p.shiftsUsed[i] : dm.units);
      }
    }
  }
  rt.es = p.es;
  rt.ef = p.ef;
  rt.days = p.days;
  rt.shiftsUsed = p.shiftsUsed;
  rt.need = p.need;
  rt.winter = p.winter;
  rt.strength = p.strength;
  rt.startBound = bounds.sb;
  rt.snappedBound = bounds.snapped;
  rt.driver = finishDriven && bounds.fDriver ? bounds.fDriver : bounds.driver;
  rt.scheduled = true;
}

/**
 * Прямой проход.
 *  - без ресурсов: в топологическом порядке (точный метод критического пути);
 *  - с ресурсами: параллельная схема генерации (по времени): в каждый момент t
 *    готовые к началу операции рассматриваются в порядке приоритета (наименьшее позднее
 *    начало из расчёта без ресурсов) и начинаются, если ресурсы свободны на весь
 *    период выполнения; иначе ожидают освобождения ресурса.
 */
export function forwardPass(
  rts: Runtime[],
  links: ResolvedLink[],
  ctx: SchedulerContext,
  opts: ForwardOptions,
): { order: Runtime[]; resourceLinks: ResolvedLink[] } {
  const byId = new Map(rts.map((r) => [r.op.id, r]));
  const incoming = new Map<string, ResolvedLink[]>();
  const outgoing = new Map<string, ResolvedLink[]>();
  for (const r of rts) {
    incoming.set(r.op.id, []);
    outgoing.set(r.op.id, []);
    r.scheduled = false;
    r.resourceDelay = null;
  }
  for (const l of links) {
    incoming.get(l.to)!.push(l);
    outgoing.get(l.from)!.push(l);
  }
  const order: Runtime[] = [];
  const resourceLinks: ResolvedLink[] = [];

  if (!opts.useResources) {
    for (const rt of topoOrder(rts, links)) {
      const bounds = computeBounds(rt, incoming.get(rt.op.id)!, byId, ctx);
      const { p, finishDriven } = placeRespectingFinish(rt, ctx, bounds.sb, bounds.fb);
      commit(rt, p, bounds, finishDriven, opts);
      order.push(rt);
    }
    return { order, resourceLinks };
  }

  const ledger = opts.ledger!;
  const remaining = new Map(rts.map((r) => [r.op.id, incoming.get(r.op.id)!.length]));
  const ready = new Map<string, { rt: Runtime; bounds: Bounds; conflict: { resourceId: string; day: DayNum } | null }>();
  const makeReady = (rt: Runtime) => ready.set(rt.op.id, { rt, bounds: computeBounds(rt, incoming.get(rt.op.id)!, byId, ctx), conflict: null });
  for (const r of rts) if (remaining.get(r.op.id) === 0) makeReady(r);
  const usersOf = new Map<string, Runtime[]>();
  const prio = (r: Runtime) => opts.priority?.get(r.op.id) ?? 0;
  const cmp = (a: Runtime, b: Runtime) => prio(a) - prio(b) || a.op.order - b.op.order;

  let t = ctx.projectStart;
  let guard = 0;
  while (ready.size) {
    if (++guard > MAX_SEARCH_DAYS * 50) throw new EngineError('Ресурсный расчёт не сходится: проверьте окна недоступности ресурсов');
    const candidates = [...ready.values()].filter((c) => c.bounds.sb <= t).sort((a, b) => cmp(a.rt, b.rt));
    let progress = false;
    for (const c of candidates) {
      const rt = c.rt;
      const { p, finishDriven } = placeRespectingFinish(rt, ctx, Math.max(t, c.bounds.sb), c.bounds.fb);
      const conflict = p.days.length ? findConflict(rt, p, ledger) : null;
      if (conflict) {
        ledger.noteConflict(conflict.resourceId);
        c.conflict = conflict;
        continue;
      }
      commit(rt, p, c.bounds, finishDriven, opts);
      if (c.conflict && p.es > c.bounds.snapped) {
        const rd: ResourceDelay = {
          resourceId: c.conflict.resourceId,
          blockerId: null,
          window: ledger.windowAt(c.conflict.resourceId, c.conflict.day),
          fromDay: c.bounds.snapped,
        };
        if (!rd.window) {
          let blocker: Runtime | null = null;
          for (const u of usersOf.get(rd.resourceId) ?? []) {
            if (u.ef > p.es) continue;
            if (!blocker || u.ef > blocker.ef || (u.ef === blocker.ef && u.op.order > blocker.op.order)) blocker = u;
          }
          if (blocker) {
            rd.blockerId = blocker.op.id;
            resourceLinks.push({
              from: blocker.op.id, to: rt.op.id, type: 'FS', lag: { value: 0, unit: 'work' }, origin: 'resource',
              resourceId: rd.resourceId, note: 'Ресурсная связь: ресурс освобождается предшественником',
            });
          }
        }
        rt.resourceDelay = rd;
      }
      for (const dm of rt.op.demands) {
        let arr = usersOf.get(dm.resourceId);
        if (!arr) usersOf.set(dm.resourceId, (arr = []));
        arr.push(rt);
      }
      ready.delete(rt.op.id);
      order.push(rt);
      progress = true;
      for (const l of outgoing.get(rt.op.id)!) {
        const n = remaining.get(l.to)! - 1;
        remaining.set(l.to, n);
        if (n === 0) makeReady(byId.get(l.to)!);
      }
    }
    if (progress) continue;
    // Следующий момент принятия решения
    let next = Infinity;
    for (const c of ready.values()) {
      if (c.bounds.sb > t) next = Math.min(next, c.bounds.sb);
      else next = Math.min(next, t + 1);
    }
    t = next;
  }
  if (order.length !== rts.length) throw new EngineError('Сеть содержит цикл — расчёт невозможен');
  return { order, resourceLinks };
}

function linkBound(l: ResolvedLink, pred: Runtime, succ: Runtime, ctx: SchedulerContext): { start?: number; finish?: number } {
  const cal = succ.elapsed ? ctx.mainCal : succ.cal;
  switch (l.type) {
    case 'FS':
      return { start: shiftTime(pred.ef, l.lag, cal) };
    case 'SS':
      return { start: shiftTime(pred.es, l.lag, cal) };
    case 'FF':
      return { finish: shiftTime(pred.ef, l.lag, cal) };
    case 'SF':
      return { finish: shiftTime(pred.es, l.lag, cal) };
  }
}

function findConflict(rt: Runtime, p: Placement, ledger: ResourceLedger): { resourceId: string; day: DayNum } | null {
  for (let i = 0; i < p.days.length; i++) {
    for (const dm of rt.op.demands) {
      const units = dm.perShift ? dm.units * p.shiftsUsed[i] : dm.units;
      if (!ledger.fits(dm.resourceId, p.days[i], units)) return { resourceId: dm.resourceId, day: p.days[i] };
    }
  }
  return null;
}

/* ───────────── Обратный проход ───────────── */

export function backwardPass(order: Runtime[], links: ResolvedLink[], ctx: SchedulerContext, projectEnd: number) {
  const outgoing = new Map<string, ResolvedLink[]>();
  for (const r of order) outgoing.set(r.op.id, []);
  for (const l of links) outgoing.get(l.from)?.push(l);
  const byId = new Map(order.map((r) => [r.op.id, r]));

  const boundsFor = (rt: Runtime, useLate: boolean): number => {
    let lfB = projectEnd;
    let lsB = Infinity;
    for (const l of outgoing.get(rt.op.id)!) {
      const s = byId.get(l.to)!;
      const cal = s.elapsed ? ctx.mainCal : s.cal;
      const neg: Lag = { value: -l.lag.value, unit: l.lag.unit };
      const sStart = useLate ? s.ls : s.es;
      const sFinish = useLate ? s.lf : s.ef;
      switch (l.type) {
        case 'FS':
          lfB = Math.min(lfB, shiftTime(sStart, neg, cal));
          break;
        case 'FF':
          lfB = Math.min(lfB, shiftTime(sFinish, neg, cal));
          break;
        case 'SS':
          lsB = Math.min(lsB, shiftTime(sStart, neg, cal));
          break;
        case 'SF':
          lsB = Math.min(lsB, shiftTime(sFinish, neg, cal));
          break;
      }
    }
    if (lsB !== Infinity) lfB = Math.min(lfB, finishFromStart(rt, ctx, lsB));
    return lfB;
  };

  for (let i = order.length - 1; i >= 0; i--) {
    const rt = order[i];
    const lf = snapFinishBack(rt, ctx, boundsFor(rt, true));
    rt.lf = lf;
    rt.ls = startFromFinish(rt, ctx, lf);
  }
  for (const rt of order) {
    rt.totalFloat = workDaysBetween(rt.floatCal, rt.es, rt.ls);
    const freeLf = boundsFor(rt, false);
    rt.freeFloat = Math.max(0, workDaysBetween(rt.floatCal, rt.ef, freeLf));
    if (rt.freeFloat > rt.totalFloat) rt.freeFloat = Math.max(0, rt.totalFloat);
  }
}
