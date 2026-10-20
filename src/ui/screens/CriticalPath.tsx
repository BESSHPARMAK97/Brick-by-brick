import { useState } from 'react';
import { GROUP_NAMES } from '../../engine/catalog/library';
import { formatRu } from '../../engine/dates';
import type { ScreenProps } from '../App';
import { Kpi } from '../components/common';

export function CriticalPath({ app, openOp }: ScreenProps) {
  const r = app.calc.result;
  const [mode, setMode] = useState<'driving' | 'all'>('driving');
  if (!r) return <div className="empty">Нет расчёта.</div>;
  const byId = new Map(r.operations.map((o) => [o.id, o]));
  const ids = mode === 'driving' ? r.drivingPath : r.criticalPath;
  const list = ids.map((id) => byId.get(id)!).filter((o) => o.calendarDays > 0 || !o.resolved);
  const byGroup = new Map<string, number>();
  for (const o of r.criticalPath.map((id) => byId.get(id)!)) byGroup.set(o.group, (byGroup.get(o.group) ?? 0) + o.calendarDays);
  const curing = list.filter((o) => o.kind === 'curing').reduce((s, o) => s + o.calendarDays, 0);
  const waits = list.reduce((s, o) => s + o.waitDays, 0);
  return (
    <div>
      <div className="grid cols-4">
        <Kpi label="Критических операций" value={r.criticalPath.length} sub="общий резерв = 0" />
        <Kpi label="Ведущая цепочка" value={r.drivingPath.length} sub="от окончания назад по определяющим связям" />
        <Kpi label="Техн. перерывы в цепочке" value={`${curing} кал. дн.`} sub="набор прочности" />
        <Kpi label="Ожидание ресурсов" value={`${waits} кал. дн.`} sub="организационный простой" />
      </div>
      <div className="card">
        <h3>Доля видов работ на критическом пути (кал. дн.)</h3>
        <div className="row">{[...byGroup].map(([g, d]) => <span key={g} className="badge accent">{GROUP_NAMES[g]}: {d}</span>)}</div>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={`btn small ${mode === 'driving' ? 'primary' : ''}`} onClick={() => setMode('driving')}>Ведущая цепочка</button>
        <button className={`btn small ${mode === 'all' ? 'primary' : ''}`} onClick={() => setMode('all')}>Все критические операции</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: '65vh' }}>
        <table className="t">
          <thead><tr><th>#</th><th>Операция</th><th>Место</th><th>Начало</th><th>Окончание</th><th className="num">Дн.</th><th>Что определяет начало</th></tr></thead>
          <tbody>
            {list.map((o, i) => {
              const driver = o.explanation.find((e) => e.kind === 'resource') ?? o.explanation.find((e) => e.kind === 'predecessor' || e.kind === 'constraint');
              return (
                <tr key={o.id} className="clickable crit" onClick={() => openOp(o)}>
                  <td className="num">{i + 1}</td>
                  <td>{o.name}{o.kind === 'curing' && <> <span className="badge">перерыв</span></>}</td>
                  <td className="small">{o.locationLabel.split(' / ').slice(2).join(' / ')}</td>
                  <td className="num">{formatRu(o.start)}</td>
                  <td className="num">{formatRu(o.finish)}</td>
                  <td className="num">{o.calendarDays}</td>
                  <td className="small muted">{driver?.text.slice(0, 140)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
