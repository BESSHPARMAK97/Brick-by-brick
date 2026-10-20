/** Быстрый прогон движка: летний/зимний старт, только монолит и полный цикл. */
import { ALL_GROUPS, calculateSchedule, createDefaultInput } from '../src/engine';

const cases = [
  ['Монолит, старт летом', '2027-05-17', ['monolith']],
  ['Монолит, старт зимой', '2026-11-16', ['monolith']],
  ['Полный цикл, старт зимой', '2026-11-16', ALL_GROUPS],
] as const;

for (const [label, start, groups] of cases) {
  const t0 = performance.now();
  const r = calculateSchedule(createDefaultInput({ startDate: start, workGroups: [...groups] }));
  const ms = Math.round(performance.now() - t0);
  console.log(`${label}: ${r.operations.length} операций, ${r.projectStart} → ${r.projectFinish} (${r.durationCalendarDays} кал. дн.), критических ${r.criticalPath.length}, достоверность ${r.confidence.level}, ${ms} мс`);
  for (const w of r.warnings.filter((x) => x.severity !== 'info')) console.log(`  [${w.severity}] ${w.text}`);
}
