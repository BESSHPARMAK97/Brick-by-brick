/**
 * Resource Engine: пулы ресурсов, окна недоступности, учёт загрузки по дням.
 */
import { GROUP_NAMES } from '../catalog/library';
import { toDayNum, type DayNum } from '../dates';
import type { ProjectInput, ResourceKind, WorkGroupId } from '../types';

export interface ResourcePool {
  id: string;
  name: string;
  kind: ResourceKind | 'crew';
  unit: string;
  baseCapacity: number;
  windows: { from: DayNum; to: DayNum; reason: string }[];
}

export class ResourceLedger {
  private readonly usage = new Map<string, Map<DayNum, number>>();
  readonly conflicts = new Map<string, number>();

  constructor(readonly pools: Map<string, ResourcePool>) {}

  capacity(id: string, d: DayNum): number {
    const p = this.pools.get(id);
    if (!p) return Infinity;
    for (const w of p.windows) if (d >= w.from && d <= w.to) return 0;
    return p.baseCapacity;
  }

  windowAt(id: string, d: DayNum): string | null {
    const p = this.pools.get(id);
    if (!p) return null;
    for (const w of p.windows) if (d >= w.from && d <= w.to) return w.reason;
    return null;
  }

  used(id: string, d: DayNum): number {
    return this.usage.get(id)?.get(d) ?? 0;
  }

  fits(id: string, d: DayNum, units: number): boolean {
    return this.used(id, d) + units <= this.capacity(id, d) + 1e-9;
  }

  add(id: string, d: DayNum, units: number) {
    let m = this.usage.get(id);
    if (!m) this.usage.set(id, (m = new Map()));
    m.set(d, (m.get(d) ?? 0) + units);
  }

  noteConflict(id: string) {
    this.conflicts.set(id, (this.conflicts.get(id) ?? 0) + 1);
  }

  days(id: string): Map<DayNum, number> {
    return this.usage.get(id) ?? new Map();
  }
}

const TRADE_NAMES: Record<string, string> = {
  rebar: 'арматурщики',
  formwork: 'опалубщики',
  concrete: 'бетонщики',
  survey: 'геодезия/подготовка',
};

export function buildPools(input: ProjectInput, usedIds: Set<string>): Map<string, ResourcePool> {
  const pools = new Map<string, ResourcePool>();
  const r = input.resources;
  const win = (kind: ResourceKind | 'crew', target?: string) =>
    r.unavailability
      .filter((u) => u.kind === kind && (!u.target || u.target === target))
      .map((u) => ({ from: toDayNum(u.from), to: toDayNum(u.to), reason: u.reason }));

  const sectionName = new Map<string, string>();
  for (const b of input.buildings) for (const s of b.sections) sectionName.set(s.id, `${b.name}, ${s.name}`);

  for (const id of usedIds) {
    const [kind, a, b] = id.split(':');
    switch (kind) {
      case 'crew': {
        const g = a as WorkGroupId;
        const trade = b && b !== 'main' ? ` — ${TRADE_NAMES[b] ?? b}` : '';
        pools.set(id, { id, name: `Бригады: ${GROUP_NAMES[g] ?? g}${trade}`, kind: 'crew', unit: 'бригад', baseCapacity: Math.max(0, r.crews[g] ?? 0), windows: win('crew', g) });
        break;
      }
      case 'crane':
        pools.set(id, { id, name: `Башенный кран — ${sectionName.get(a) ?? a}`, kind: 'crane', unit: 'кранов', baseCapacity: r.cranesPerSection, windows: win('crane', a) });
        break;
      case 'pump':
        pools.set(id, { id, name: 'Бетононасосы', kind: 'pump', unit: 'шт.', baseCapacity: r.pumps, windows: win('pump') });
        break;
      case 'concrete':
        pools.set(id, { id, name: 'Поставка бетона', kind: 'concrete', unit: 'м³/сут', baseCapacity: r.concreteSupplyM3PerDay, windows: win('concrete') });
        break;
      case 'wallFormwork':
        pools.set(id, { id, name: `Опалубка стен — ${sectionName.get(a) ?? a}`, kind: 'wallFormwork', unit: 'компл.', baseCapacity: r.wallFormworkSets, windows: win('wallFormwork', a) });
        break;
      case 'slabFormwork':
        pools.set(id, { id, name: `Опалубка перекрытий — ${sectionName.get(a) ?? a}`, kind: 'slabFormwork', unit: 'компл.', baseCapacity: r.slabFormworkSets, windows: win('slabFormwork', a) });
        break;
      case 'front':
        pools.set(id, { id, name: `Фронт работ: ${sectionName.get(a) ?? a}, уровень ${b}`, kind: 'front', unit: 'видов работ', baseCapacity: r.maxTradesPerFloor, windows: [] });
        break;
    }
  }
  return pools;
}
