import { useMemo, useState } from 'react';
import { GROUP_NAMES } from '../../engine/catalog/library';
import { formatRu } from '../../engine/dates';
import type { ScheduledOperation, WorkGroupId } from '../../engine/types';
import type { ScreenProps } from '../App';
import { fmtNum, StatusBadge } from '../components/common';

export interface OpFilter {
  group: WorkGroupId | 'all';
  section: string;
  onlyCritical: boolean;
  hideZero: boolean;
  search: string;
}

export function useOpFilter(): [OpFilter, (f: Partial<OpFilter>) => void] {
  const [f, setF] = useState<OpFilter>({ group: 'all', section: 'all', onlyCritical: false, hideZero: true, search: '' });
  return [f, (p) => setF((x) => ({ ...x, ...p }))];
}

export function applyFilter(ops: ScheduledOperation[], f: OpFilter) {
  const q = f.search.trim().toLowerCase();
  return ops.filter((o) =>
    (f.group === 'all' || o.group === f.group) &&
    (f.section === 'all' || o.sectionId === f.section) &&
    (!f.onlyCritical || o.critical) &&
    (!f.hideZero || o.calendarDays > 0 || !o.resolved) &&
    (!q || o.name.toLowerCase().includes(q) || o.locationLabel.toLowerCase().includes(q)));
}

export function FilterBar({ f, set, app }: { f: OpFilter; set: (p: Partial<OpFilter>) => void; app: ScreenProps['app'] }) {
  const sections = app.input.buildings.flatMap((b) => b.sections.map((s) => ({ id: s.id, name: `${b.name}, ${s.name}` })));
  return (
    <div className="row" style={{ marginBottom: 10 }}>
      <input className="input" style={{ maxWidth: 220 }} placeholder="Поиск: операция, этаж…" value={f.search} onChange={(e) => set({ search: e.target.value })} />
      <select className="input" style={{ maxWidth: 200 }} value={f.group} onChange={(e) => set({ group: e.target.value as OpFilter['group'] })}>
        <option value="all">Все виды работ</option>
        {app.input.workGroups.map((g) => <option key={g} value={g}>{GROUP_NAMES[g]}</option>)}
      </select>
      {sections.length > 1 && (
        <select className="input" style={{ maxWidth: 200 }} value={f.section} onChange={(e) => set({ section: e.target.value })}>
          <option value="all">Все секции</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <label className="check small"><input type="checkbox" checked={f.onlyCritical} onChange={(e) => set({ onlyCritical: e.target.checked })} />Только критические</label>
      <label className="check small"><input type="checkbox" checked={f.hideZero} onChange={(e) => set({ hideZero: e.target.checked })} />Скрыть нулевые</label>
    </div>
  );
}

export function Operations({ app, openOp }: ScreenProps) {
  const [f, set] = useOpFilter();
  const r = app.calc.result;
  const list = useMemo(() => (r ? applyFilter(r.operations, f) : []), [r, f]);
  if (!r) return <div className="empty">Нет расчёта.</div>;
  return (
    <div>
      <FilterBar f={f} set={set} app={app} />
      <p className="muted small">Показано {list.length} из {r.operations.length}. Нажмите на строку — «Почему рассчитана эта дата?».</p>
      <div className="table-wrap" style={{ maxHeight: '70vh' }}>
        <table className="t">
          <thead>
            <tr>
              <th>Операция</th><th>Место</th><th>Начало</th><th>Окончание</th><th className="num">Кал. дн.</th><th className="num">Смен</th>
              <th className="num">Резерв</th><th>Данные</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className={`clickable ${o.critical ? 'crit' : ''}`} onClick={() => openOp(o)}>
                <td>
                  {o.name}
                  {o.critical && <> <span className="badge critical">крит.</span></>}
                  {o.winterApplied && <> <span className="badge accent">зима</span></>}
                  {o.waitDays > 0 && <> <span className="badge warn">ожидание {o.waitDays} дн.</span></>}
                </td>
                <td className="small">{o.locationLabel.split(' / ').slice(1).join(' / ')}</td>
                <td className="num">{formatRu(o.start)}</td>
                <td className="num">{formatRu(o.finish)}</td>
                <td className="num">{o.calendarDays}</td>
                <td className="num">{o.kind === 'curing' ? '—' : fmtNum(o.workShifts, 1)}</td>
                <td className="num">{o.totalFloat}</td>
                <td>{!o.resolved ? <span className="badge critical">нет данных</span> : o.kind === 'work' ? <StatusBadge status={o.productivityStatus} /> : o.kind === 'curing' ? <span className="badge accent">модель прочности</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
