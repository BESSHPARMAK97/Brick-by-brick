import { useMemo, useState } from 'react';
import { formatRu } from '../../engine/dates';
import { compareScenarios, compareSnapshots, type Comparison } from '../../storage/projectStore';
import type { ScreenProps } from '../App';
import { CONFIDENCE_RU, Kpi } from '../components/common';

export function Scenarios({ app }: ScreenProps) {
  const { store, project, scenario } = app;
  const baseline = project.scenarios.find((s) => s.id === project.baselineScenarioId)!;
  const [compareId, setCompareId] = useState<string>(scenario.id !== baseline.id ? scenario.id : project.scenarios.find((s) => s.id !== baseline.id)?.id ?? '');
  const other = project.scenarios.find((s) => s.id === compareId);
  const scenarioCmp = useMemo(() => {
    if (!other || other.id === baseline.id) return null;
    try {
      return compareScenarios(baseline, other);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [baseline, other]);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const versions = store.versions(project.id);
  const [va, setVa] = useState<string>('');
  const [vb, setVb] = useState<string>('');
  const vCmp = useMemo(() => {
    const a = versions.find((v) => v.id === va);
    const b = versions.find((v) => v.id === vb);
    return a && b ? compareSnapshots(a, b) : null;
  }, [versions, va, vb]);
  const scenarioName = (id: string) => project.scenarios.find((s) => s.id === id)?.name ?? 'удалён';

  return (
    <div>
      <div className="card">
        <h2>Сценарии проекта</h2>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Сценарий</th><th>Создан</th><th></th></tr></thead>
            <tbody>
              {project.scenarios.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input className="input" style={{ maxWidth: 260 }} value={s.name} onChange={(e) => { store.renameScenario(project.id, s.id, e.target.value); app.refresh(); }} aria-label="Название сценария" />
                    {s.id === baseline.id && <span className="badge accent" style={{ marginLeft: 6 }}>базовый</span>}
                    {s.id === scenario.id && <span className="badge ok" style={{ marginLeft: 6 }}>активный</span>}
                  </td>
                  <td className="small muted">{new Date(s.createdAt).toLocaleString('ru-RU')}</td>
                  <td>
                    <div className="row">
                      {s.id !== scenario.id && <button className="btn small" onClick={() => { store.setActiveScenario(project.id, s.id); app.refresh(); }}>Сделать активным</button>}
                      <button className="btn small" onClick={() => { const n = store.addScenario(project.id, s.id, `${s.name} — копия`); setCompareId(n.id); app.refresh(); }}>Копировать</button>
                      {s.id !== baseline.id && (pendingDelete === s.id ? (
                        <>
                          <button className="btn small danger" onClick={() => { store.deleteScenario(project.id, s.id); setPendingDelete(null); app.refresh(); }}>Да, удалить</button>
                          <button className="btn small" onClick={() => setPendingDelete(null)}>Отмена</button>
                        </>
                      ) : <button className="btn small danger" onClick={() => setPendingDelete(s.id)}>Удалить</button>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>Редактирование (мастер, шаблоны, ресурсы) применяется к активному сценарию.</p>
      </div>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Базовый vs альтернативный</h2>
          <div className="spacer" />
          <select className="input" style={{ maxWidth: 260 }} value={compareId} onChange={(e) => setCompareId(e.target.value)}>
            <option value="">— выберите сценарий —</option>
            {project.scenarios.filter((s) => s.id !== baseline.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {typeof scenarioCmp === 'string' && <div className="alert error">{scenarioCmp}</div>}
        {scenarioCmp && typeof scenarioCmp !== 'string' && <ComparisonView c={scenarioCmp} aLabel={baseline.name} bLabel={other!.name} />}
        {!other && <p className="muted">Создайте копию сценария, измените параметры и сравните результат.</p>}
      </div>

      <div className="card">
        <h2>Журнал версий графика</h2>
        <p className="muted small">Версия сохраняется автоматически при каждом пересчёте с изменёнными данными (до 50 последних). Выберите две версии для сравнения.</p>
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="t">
            <thead><tr><th>A</th><th>B</th><th>Дата</th><th>Сценарий</th><th>Окончание</th><th className="num">Дн.</th><th>Достоверность</th><th>Хэш данных</th></tr></thead>
            <tbody>
              {[...versions].reverse().map((v) => (
                <tr key={v.id}>
                  <td><input type="radio" name="va" checked={va === v.id} onChange={() => setVa(v.id)} aria-label="Версия A" /></td>
                  <td><input type="radio" name="vb" checked={vb === v.id} onChange={() => setVb(v.id)} aria-label="Версия B" /></td>
                  <td className="small">{new Date(v.createdAt).toLocaleString('ru-RU')}</td>
                  <td className="small">{scenarioName(v.scenarioId)}</td>
                  <td className="num">{formatRu(v.projectFinish)}</td>
                  <td className="num">{v.durationCalendarDays}</td>
                  <td>{CONFIDENCE_RU[v.confidence as keyof typeof CONFIDENCE_RU] ?? v.confidence}</td>
                  <td className="mono">{v.inputHash.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {vCmp && <div style={{ marginTop: 10 }}><ComparisonView c={vCmp} aLabel="Версия A" bLabel="Версия B" /></div>}
      </div>
    </div>
  );
}

function ComparisonView({ c, aLabel, bLabel }: { c: Comparison; aLabel: string; bLabel: string }) {
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div style={{ marginTop: 10 }}>
      <div className="grid cols-4">
        <Kpi label={`Окончание: ${aLabel}`} value={formatRu(c.finishA)} sub={`${c.durationA} кал. дн.`} />
        <Kpi label={`Окончание: ${bLabel}`} value={formatRu(c.finishB)} sub={`${c.durationB} кал. дн.`} />
        <Kpi label="Сдвиг окончания" value={<span style={{ color: c.finishShiftDays > 0 ? 'var(--critical)' : c.finishShiftDays < 0 ? 'var(--ok)' : undefined }}>{sign(c.finishShiftDays)} дн.</span>} />
        <Kpi label="Изменено операций" value={c.changedOps.length} sub={`стали критическими: ${c.becameCritical}, вышли из крит.: ${c.leftCritical}`} />
      </div>
      {c.inputChanges.length > 0 && (
        <details open>
          <summary className="small"><b>Изменённые исходные данные ({c.inputChanges.length})</b></summary>
          <ul className="small mono" style={{ paddingLeft: 18 }}>{c.inputChanges.slice(0, 50).map((x) => <li key={x} style={{ overflowWrap: 'anywhere' }}>{x}</li>)}</ul>
        </details>
      )}
      {c.changedOps.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="t">
            <thead><tr><th>Операция</th><th>Начало A → B</th><th>Окончание A → B</th><th className="num">Сдвиг</th><th>Крит.</th></tr></thead>
            <tbody>
              {c.changedOps.slice(0, 300).map((o) => (
                <tr key={o.id}>
                  <td className="small">{o.name}</td>
                  <td className="num small">{o.startA ? formatRu(o.startA) : '—'} → {o.startB ? formatRu(o.startB) : '—'}</td>
                  <td className="num small">{o.finishA ? formatRu(o.finishA) : '—'} → {o.finishB ? formatRu(o.finishB) : '—'}</td>
                  <td className="num">{o.shiftFinishDays === null ? '—' : sign(o.shiftFinishDays)}</td>
                  <td className="small">{o.criticalA ? 'да' : 'нет'} → {o.criticalB ? 'да' : 'нет'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
