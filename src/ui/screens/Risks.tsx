import type { ScreenProps } from '../App';
import { CONFIDENCE_CLS, CONFIDENCE_RU, StatusBadge } from '../components/common';

const SEV = { error: 'Ошибка', warning: 'Внимание', info: 'Инфо' } as const;

export function Risks({ app, openOp }: ScreenProps) {
  const r = app.calc.result;
  if (!r) return <div className="empty">Нет расчёта.</div>;
  const byId = new Map(r.operations.map((o) => [o.id, o]));
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <div>
      <div className="card">
        <h2>Уровень достоверности: <span className={`badge ${CONFIDENCE_CLS[r.confidence.level]}`}>{CONFIDENCE_RU[r.confidence.level]}</span></h2>
        <p>{r.confidence.explanation}</p>
        <p className="muted small">Чтобы повысить достоверность — подтвердите выработку и объёмы операций критического пути (шаг «Уточнения» или «Шаблоны»).</p>
      </div>
      <div className="card">
        <h2>Риски и предупреждения</h2>
        {[...r.warnings].sort((a, b) => order[a.severity] - order[b.severity]).map((w, i) => (
          <div key={i} className={`alert ${w.severity}`}>
            <b>{SEV[w.severity]}:</b> {w.text}
            {w.opIds && w.opIds.length > 0 && (
              <details className="small" style={{ marginTop: 4 }}>
                <summary>Операции ({w.opIds.length})</summary>
                {w.opIds.slice(0, 40).map((id) => {
                  const o = byId.get(id);
                  return o ? <div key={id}><a href="#" onClick={(e) => { e.preventDefault(); openOp(o); }}>{o.name}</a> <span className="muted">{o.locationLabel}</span></div> : null;
                })}
              </details>
            )}
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Исходные допущения</h2>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Параметр</th><th>Значение</th><th>Статус</th><th>Крит. путь</th><th>Источник</th></tr></thead>
            <tbody>
              {r.assumptions.map((a) => (
                <tr key={a.key}><td>{a.label}</td><td>{a.value}</td><td><StatusBadge status={a.status} /></td><td>{a.affectsCritical ? `да${a.impactShifts ? `, ${a.impactShifts} смен` : ''}` : ''}</td><td className="small muted">{a.source}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card small muted">
        <div>Движок {r.meta.engineVersion}, правила {r.meta.rulesetVersion}. Хэш исходных данных <span className="mono">{r.meta.inputHash}</span>, результата <span className="mono">{r.meta.resultHash}</span>.</div>
        <div>Климат: {r.meta.climateSource}</div>
      </div>
    </div>
  );
}
