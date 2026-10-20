import type { CalendarSettings } from '../src/engine/types';

export function cal(regime: CalendarSettings['regime'], extra: Partial<CalendarSettings> = {}): CalendarSettings {
  return {
    regime,
    shiftsPerDay: 1,
    shiftHours: 8,
    observeHolidays: true,
    preHolidayShorteningHours: 0,
    extraNonWorking: [],
    extraWorking: [],
    ...extra,
  };
}

import { expect } from 'vitest';
import { WorkCalendar } from '../src/engine/calendar/workCalendar';
import { calculateSchedule } from '../src/engine/calculate';
import { createDefaultInput } from '../src/engine/defaults';
import type { ProjectInput, ScheduleResult, ScheduledOperation } from '../src/engine/types';

export function run(patch: Partial<ProjectInput> = {}, mutate?: (i: ProjectInput) => void) {
  const input = createDefaultInput(patch);
  mutate?.(input);
  return { input, result: calculateSchedule(input) };
}

export function ops(r: ScheduleResult, key: string, floor?: number): ScheduledOperation[] {
  return r.operations.filter((o) => o.templateKey === key && (floor === undefined || o.floor === floor));
}

export function op(r: ScheduleResult, key: string, floor?: number): ScheduledOperation {
  const found = ops(r, key, floor);
  if (found.length !== 1) throw new Error(`Ожидалась одна операция ${key}/${floor}, найдено ${found.length}`);
  return found[0];
}

/** Проверка инвариантов расписания: связи, календарь, ресурсы, резервы. */
export function checkInvariants(r: ScheduleResult, input: ProjectInput) {
  const byId = new Map(r.operations.map((o) => [o.id, o]));
  const main = new WorkCalendar('main', 'main', input.calendar);
  // 1. Связи соблюдены (лаги в рабочих днях ≥ календарных, поэтому проверка консервативна)
  for (const l of r.links) {
    const p = byId.get(l.from)!;
    const s = byId.get(l.to)!;
    const lag = Math.max(0, l.lag.value);
    if (l.type === 'FS') expect(s.es, `${l.from} → ${l.to}`).toBeGreaterThanOrEqual(p.ef + lag);
    if (l.type === 'SS') expect(s.es, `${l.from} →SS ${l.to}`).toBeGreaterThanOrEqual(p.es + lag);
    if (l.type === 'FF') expect(s.ef, `${l.from} →FF ${l.to}`).toBeGreaterThanOrEqual(p.ef + lag);
  }
  // 2. Работы начинаются и заканчиваются в рабочие дни своего календаря
  for (const o of r.operations) {
    expect(o.ef).toBeGreaterThanOrEqual(o.es);
    expect(o.lf).toBeGreaterThanOrEqual(o.ls);
    if (o.calendarId === 'main' && o.calendarDays > 0 && o.kind !== 'curing') {
      expect(main.capacity(o.es), `${o.id} start ${o.start}`).toBeGreaterThan(0);
      expect(main.capacity(o.ef - 1), `${o.id} finish ${o.finish}`).toBeGreaterThan(0);
    }
    if (!input.deadline) expect(o.totalFloat, o.id).toBeGreaterThanOrEqual(0);
    expect(o.critical).toBe(o.totalFloat <= 0);
    expect(o.freeFloat).toBeLessThanOrEqual(Math.max(0, o.totalFloat));
  }
  // 3. Загрузка ресурсов не превышает доступность
  for (const res of r.resources) {
    for (const u of res.usage) expect(u.used, `${res.id} ${u.day}`).toBeLessThanOrEqual(u.capacity + 1e-6);
  }
  // 4. Критический путь — последовательность критических операций, заканчивающаяся в конце проекта
  expect(r.criticalPath.length).toBeGreaterThan(0);
  for (const id of r.criticalPath) expect(byId.get(id)!.totalFloat).toBeLessThanOrEqual(0);
  expect(r.criticalPath.some((id) => byId.get(id)!.finish === r.projectFinish)).toBe(true);
  // Ведущая цепочка заканчивается последней операцией и идёт по возрастанию дат
  const dp = r.drivingPath.map((id) => byId.get(id)!);
  expect(dp[dp.length - 1].finish).toBe(r.projectFinish);
  for (let i = 1; i < dp.length; i++) expect(dp[i].es).toBeGreaterThanOrEqual(dp[i - 1].es);
}
