/**
 * Technology Engine: развёртывание шаблонов в сеть операций.
 *
 * Объект → Корпус → Секция → Этаж (уровень) → Захватка → Вид работ → Операция.
 * Уровни: подземные этажи 1−b … 0, надземные 1 … N, фундаментная плита — отдельный уровень.
 */
import { WORK_LIBRARY, findTemplate } from '../catalog/library';
import type { OperationTemplate, TemplateLink } from '../catalog/types';
import type {
  BuildingInput,
  DataStatus,
  Lag,
  LinkType,
  Param,
  ProjectInput,
  ResolvedLink,
  SectionInput,
  WorkGroupId,
} from '../types';

export interface Demand {
  resourceId: string;
  units: number;
  /** Ед. на смену, пересчитывается по фактически отработанной доле дня */
  perShift: boolean;
}

export interface NetworkOp {
  id: string;
  template: OperationTemplate;
  building: BuildingInput;
  section: SectionInput;
  floor: number | null; // null — на секцию
  zone: number | null;
  /** Порядковый номер захватки в секции (для оборачиваемости опалубки) */
  seq: number | null;
  locationLabel: string;
  quantity: number | null;
  quantityStatus: DataStatus;
  quantitySource: string;
  productivity: Param | null;
  durationShiftsParam: Param | null;
  crews: number;
  crewSize: number;
  /** Смен бригады при назначенном числе бригад */
  workShifts: number;
  resolved: boolean;
  calendarId: string;
  demands: Demand[];
  minAirTemp: Param | null;
  climateNote: string | null;
  craneWind: boolean;
  notBefore: { day: string; reason: string }[];
  warnings: string[];
  order: number;
}

export interface Network {
  ops: NetworkOp[];
  links: ResolvedLink[];
  byId: Map<string, NetworkOp>;
}

const LEVEL_TAG = (floor: number | null, foundation: boolean) =>
  foundation ? 'FND' : floor === null ? 'SEC' : `L${floor < 0 ? 'm' + -floor : String(floor).padStart(2, '0')}`;

export function floorLabel(floor: number | null, section: SectionInput): string {
  if (floor === null) return '';
  if (floor === -section.basementFloors) return 'Фундамент';
  if (floor <= 0) return section.basementFloors > 1 ? `Подвал ${1 - floor}` : 'Подвал';
  return `Этаж ${floor}`;
}

function floorsFor(t: OperationTemplate, s: SectionInput): number[] {
  const out: number[] = [];
  const lo = t.floors === 'above' ? 1 : 1 - s.basementFloors;
  const hi = t.floors === 'basement' ? 0 : s.floors;
  for (let f = lo; f <= hi; f++) out.push(f);
  return out;
}

function basisValue(basis: string, s: SectionInput): number {
  switch (basis) {
    case 'floorArea':
    case 'roofArea':
      return s.floorArea;
    case 'basementWallArea':
      // Периметр квадратного плана × высота 3 м × число подземных этажей (сценарная оценка)
      return 4 * Math.sqrt(s.floorArea) * 3 * Math.max(1, s.basementFloors);
    case 'siteArea':
      return 2 * s.floorArea;
    default:
      return 0;
  }
}

export function groupCalendarId(input: ProjectInput, g: WorkGroupId): string {
  return input.groupCalendars[g] ? `grp:${g}` : 'main';
}

export function buildNetwork(input: ProjectInput): Network {
  const selected = new Set(input.workGroups);
  const ops: NetworkOp[] = [];
  const byId = new Map<string, NetworkOp>();
  /** key → sectionId → ops */
  const index = new Map<string, Map<string, NetworkOp[]>>();
  const tech = input.technology;
  let order = 0;

  const add = (op: NetworkOp) => {
    ops.push(op);
    byId.set(op.id, op);
    let m = index.get(op.template.key);
    if (!m) index.set(op.template.key, (m = new Map()));
    let arr = m.get(op.section.id);
    if (!arr) m.set(op.section.id, (arr = []));
    arr.push(op);
  };

  for (const b of input.buildings) {
    for (const s of b.sections) {
      for (const g of WORK_LIBRARY) {
        if (!selected.has(g.id)) continue;
        for (const t of g.operations) {
          if (t.onlyIf?.facadeType && t.onlyIf.facadeType !== tech.facadeType) continue;
          const instances: { floor: number | null; zone: number | null; seq: number | null }[] = [];
          if (t.level === 'foundation') instances.push({ floor: -s.basementFloors, zone: null, seq: null });
          else if (t.level === 'section') instances.push({ floor: null, zone: null, seq: null });
          else {
            let seq = 0;
            for (const f of floorsFor(t, s)) {
              if (t.level === 'floor') instances.push({ floor: f, zone: null, seq: null });
              else for (let z = 1; z <= s.zonesPerFloor; z++) instances.push({ floor: f, zone: z, seq: seq++ });
            }
          }
          for (const inst of instances) add(makeOp(input, b, s, t, inst, order++));
        }
      }
    }
  }

  const links: ResolvedLink[] = [];
  const seen = new Set<string>();
  const pushLink = (l: ResolvedLink) => {
    if (l.from === l.to) return;
    const k = `${l.from}>${l.to}>${l.type}>${l.lag.value}${l.lag.unit}`;
    if (seen.has(k)) return;
    seen.add(k);
    links.push(l);
  };

  const allLinks: TemplateLink[] = WORK_LIBRARY.filter((g) => selected.has(g.id)).flatMap((g) => g.links);
  for (const tl of allLinks) {
    const targets = index.get(tl.to);
    if (!targets) continue;
    for (const [sectionId, targetOps] of targets) {
      for (const to of targetOps) {
        for (const fromKey of tl.from) {
          const ft = findTemplate(fromKey);
          if (!ft || !selected.has(ft.group)) continue;
          const candidates = index.get(fromKey)?.get(sectionId) ?? [];
          const preds = resolvePreds(tl, ft, to, candidates, input);
          if (preds.length === 0) continue;
          for (const p of preds) {
            pushLink({
              from: p.id, to: to.id, type: tl.type as LinkType, lag: (tl.lag ?? { value: 0, unit: 'work' }) as Lag,
              origin: tl.origin, note: tl.note,
            });
          }
          break; // первая подходящая альтернатива
        }
      }
    }
  }

  // Оборачиваемость комплектов опалубки: распалубка захватки p → монтаж на захватке p + N
  for (const b of input.buildings) {
    for (const s of b.sections) {
      const turnover = (stripKey: string, formKey: string, sets: number, label: string) => {
        const strips = index.get(stripKey)?.get(s.id) ?? [];
        const forms = index.get(formKey)?.get(s.id) ?? [];
        const formBySeq = new Map(forms.map((o) => [o.seq, o]));
        for (const st of strips) {
          const target = formBySeq.get((st.seq ?? 0) + sets);
          if (target) {
            pushLink({
              from: st.id, to: target.id, type: 'FS', lag: { value: 0, unit: 'work' }, origin: 'turnover',
              note: `Оборачиваемость: ${label} (${sets} компл.) освобождается после распалубки`,
            });
          }
        }
      };
      if (selected.has('monolith')) {
        turnover('mono.slab.strip', 'mono.slab.formwork', Math.max(1, input.resources.slabFormworkSets), 'опалубка перекрытий');
        turnover('mono.wall.strip', 'mono.wall.formwork', Math.max(1, input.resources.wallFormworkSets), 'опалубка стен');
      }
    }
  }

  return { ops, links, byId };
}

function resolvePreds(
  tl: TemplateLink,
  ft: OperationTemplate,
  to: NetworkOp,
  candidates: NetworkOp[],
  input: ProjectInput,
): NetworkOp[] {
  if (candidates.length === 0) return [];
  const s = to.section;
  const sc = tl.scope;
  if (ft.level === 'foundation') {
    // Фундамент → только самый нижний уровень последователя
    if (to.floor === null || to.template.level === 'foundation') return candidates;
    const lowest = 1 - s.basementFloors;
    return to.floor === lowest || to.template.level === 'section' ? candidates : [];
  }
  if (ft.level === 'section') return candidates;

  let floorWanted: number | null = null;
  switch (sc.kind) {
    case 'allFloors':
      return candidates;
    case 'topFloor':
      floorWanted = s.floors;
      break;
    case 'same':
      floorWanted = to.floor;
      break;
    case 'floorOffset': {
      const extra = sc.offsetParam === 'masonryLagFloors' ? input.technology.masonryLagFloors : 0;
      if (to.floor === null) floorWanted = sc.offset + extra;
      else {
        floorWanted = to.floor + sc.offset + extra;
        const top = Math.max(...candidates.map((c) => c.floor ?? -Infinity));
        if (floorWanted > top) floorWanted = top;
      }
      break;
    }
  }
  if (floorWanted === null) return [];
  return candidates.filter((c) => {
    if (c.floor !== floorWanted) return false;
    if (to.zone !== null && c.zone !== null) return c.zone === to.zone;
    return true;
  });
}

function makeOp(
  input: ProjectInput,
  b: BuildingInput,
  s: SectionInput,
  t: OperationTemplate,
  inst: { floor: number | null; zone: number | null; seq: number | null },
  order: number,
): NetworkOp {
  const ov = input.overrides[t.key] ?? {};
  const warnings: string[] = [];
  const isFoundation = t.level === 'foundation';
  const zones = t.level === 'zone' ? s.zonesPerFloor : 1;
  const id = `${b.id}.${s.id}.${LEVEL_TAG(inst.floor, isFoundation)}${inst.zone !== null ? `.Z${inst.zone}` : ''}.${t.key}`;

  const parts = [b.name, s.name];
  if (isFoundation) parts.push('Фундаментная плита');
  else if (inst.floor !== null) parts.push(floorLabel(inst.floor, s));
  if (inst.zone !== null && s.zonesPerFloor > 1) parts.push(`Захватка ${inst.zone}`);

  // Объём
  let quantity: number | null = null;
  let quantityStatus: DataStatus = 'missing';
  let quantitySource = '';
  if (ov.quantityPerZone !== undefined && ov.quantityPerZone !== null) {
    quantity = ov.quantityPerZone;
    quantityStatus = ov.quantityStatus ?? 'project';
    quantitySource = 'Задано пользователем (ВОР/проект)';
  } else if (t.quantity) {
    quantity = round3((basisValue(t.quantity.basis, s) * t.quantity.ratio) / zones);
    quantityStatus = t.quantity.status;
    quantitySource = `${t.quantity.source}: ${t.quantity.ratio} ${t.unit}/м² × ${basisValue(t.quantity.basis, s).toFixed(0)} м²${zones > 1 ? ` ÷ ${zones} захв.` : ''}`;
  }

  // Выработка / длительность
  let productivity: Param | null = t.productivity ?? null;
  if (ov.productivity !== undefined) {
    productivity = ov.productivity === null
      ? { value: null, unit: t.productivity?.unit, status: 'missing', source: 'Данные отсутствуют (очищено пользователем)' }
      : { value: ov.productivity, unit: t.productivity?.unit, status: ov.productivityStatus ?? 'confirmed', source: 'Задано пользователем' };
  }
  let durationShiftsParam: Param | null = t.durationShifts ?? null;
  if (ov.durationShifts !== undefined) {
    durationShiftsParam = ov.durationShifts === null
      ? { value: null, unit: 'смен', status: 'missing', source: 'Данные отсутствуют (очищено пользователем)' }
      : { value: ov.durationShifts, unit: 'смен', status: ov.durationStatus ?? 'confirmed', source: 'Задано пользователем' };
  }

  const pool = input.resources.crews[t.group] ?? 0;
  const needsCrew = !!t.crew && t.kind !== 'inspection' && t.kind !== 'curing';
  let crews = 0;
  if (needsCrew) {
    const per = Math.max(1, input.resources.crewsPerOperation[t.group] ?? 1);
    crews = Math.max(1, Math.min(per, t.crew!.maxPerFront, Math.max(1, pool)));
  }

  let workShifts = 0;
  let resolved = true;
  if (t.kind === 'work') {
    if (t.quantity || ov.quantityPerZone != null) {
      if (quantity === null || productivity?.value == null || productivity.value <= 0) {
        resolved = false;
        warnings.push('Нет данных о выработке или объёме — длительность не рассчитана');
      } else {
        workShifts = quantity / productivity.value / Math.max(1, crews);
      }
    } else if (durationShiftsParam) {
      if (durationShiftsParam.value == null) {
        resolved = false;
        warnings.push('Нет данных о длительности — длительность не рассчитана');
      } else workShifts = durationShiftsParam.value;
    }
  } else if (t.kind === 'inspection' || t.kind === 'winterPrep') {
    if (durationShiftsParam?.value == null) {
      resolved = false;
      warnings.push('Нет данных о длительности — длительность не рассчитана');
    } else workShifts = durationShiftsParam.value;
  }
  workShifts = round3(workShifts);

  // Ресурсы
  const demands: Demand[] = [];
  if (needsCrew) demands.push({ resourceId: `crew:${t.group}:${t.crew!.trade ?? 'main'}`, units: crews, perShift: false });
  for (const e of t.equipment) {
    if (e.kind === 'crane') demands.push({ resourceId: `crane:${s.id}`, units: e.units, perShift: false });
    else if (e.kind === 'pump') demands.push({ resourceId: 'pump', units: e.units, perShift: false });
    else if (e.kind === 'concrete' && quantity && workShifts > 0)
      demands.push({ resourceId: 'concrete', units: round3(quantity / workShifts), perShift: true });
    else if (e.kind === 'wallFormwork') demands.push({ resourceId: `wallFormwork:${s.id}`, units: e.units, perShift: false });
    else if (e.kind === 'slabFormwork') demands.push({ resourceId: `slabFormwork:${s.id}`, units: e.units, perShift: false });
  }
  if (t.usesFront && inst.floor !== null) demands.push({ resourceId: `front:${s.id}:${inst.floor}`, units: 1, perShift: false });

  // Климат
  let minAirTemp: Param | null = t.climate?.minAirTemp ?? null;
  if (ov.minAirTemp !== undefined) {
    minAirTemp = ov.minAirTemp === null ? null : { value: ov.minAirTemp, unit: '°C', status: 'confirmed', source: 'Задано пользователем' };
  }
  let climateNote: string | null = null;
  if (minAirTemp && t.climate?.indoor && input.technology.temporaryHeating) {
    climateNote = `Ограничение t ≥ ${minAirTemp.value} °C снято: принято временное отопление здания (тепловой контур)`;
    minAirTemp = null;
  } else if (minAirTemp && t.climate?.external && input.technology.enclosureForExternalWorks) {
    climateNote = `Ограничение t ≥ ${minAirTemp.value} °C снято: приняты тепляки/укрытия`;
    minAirTemp = null;
  }

  const notBefore = input.constraints
    .filter((c) => c.templateKey === t.key && (!c.sectionId || c.sectionId === s.id))
    .map((c) => ({ day: c.notBefore, reason: c.reason }));

  return {
    id,
    template: t,
    building: b,
    section: s,
    floor: inst.floor,
    zone: inst.zone,
    seq: inst.seq,
    locationLabel: parts.join(' / '),
    quantity,
    quantityStatus,
    quantitySource,
    productivity,
    durationShiftsParam,
    crews,
    crewSize: t.crew?.size ?? 0,
    workShifts,
    resolved,
    calendarId: t.kind === 'curing' ? 'continuous' : groupCalendarId(input, t.group),
    demands,
    minAirTemp,
    climateNote,
    craneWind: !!t.climate?.craneWind,
    notBefore,
    warnings,
    order,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Поиск цикла (DFS). Возвращает путь цикла или null. */
export function findCycle(ids: string[], links: { from: string; to: string }[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const l of links) adj.get(l.from)?.push(l.to);
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (u: string): string[] | null => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(v)), v];
      if (c === 0) {
        const r = visit(v);
        if (r) return r;
      }
    }
    stack.pop();
    color.set(u, 2);
    return null;
  };
  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) {
      const r = visit(id);
      if (r) return r;
    }
  }
  return null;
}
