import { calculateSchedule, createDefaultInput, ALL_GROUPS } from '../src/engine';
for (const [label, start, groups] of [['summer mono', '2027-05-03', ['monolith']], ['winter mono', '2026-11-16', ['monolith']], ['winter all', '2026-11-16', ALL_GROUPS]] as const) {
  const t0 = Date.now();
  const r = calculateSchedule(createDefaultInput({ startDate: start, workGroups: [...groups] }));
  console.log(label, 'ops', r.operations.length, 'finish', r.projectFinish, 'days', r.durationCalendarDays, 'crit', r.criticalPath.length, 'conf', r.confidence.level, r.confidence.score, Date.now() - t0, 'ms');
  for (const w of r.warnings) console.log('  ', w.severity, w.text.slice(0, 140));
}
const r = calculateSchedule(createDefaultInput({ startDate: '2026-11-16' }));
for (const o of r.operations.filter(o => o.floor !== null && o.floor <= 1).slice(0, 30)) console.log(o.start, o.finish, o.calendarDays, o.totalFloat, o.critical ? 'C' : ' ', o.locationLabel, '|', o.name);
const o = r.operations.find(o => o.templateKey === 'mono.slab.cureStrip' && o.floor === 3)!;
console.log(o.explanation.map(e => e.kind + ': ' + e.text).join('\n'));
