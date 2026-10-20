import { GROUP_NAMES } from '../engine/catalog/library';
import { formatRu } from '../engine/dates';
import type { ScheduledOperation, ScheduleResult } from '../engine/types';
import { fmtNum, StatusBadge } from './components/common';

const KIND_LABEL: Record<string, string> = {
  duration: 'Исходная продолжительность',
  calendar: 'Календарь',
  predecessor: 'Влияние предшествующих операций',
  resource: 'Ограничение ресурсов',
  constraint: 'Ограничение по дате',
  climate: 'Климат',
  winter: 'Зимние условия',
  strength: 'Набор прочности',
  float: 'Резервы',
  source: 'Источники данных',
  warning: 'Предупреждение',
};

export function Explain({ op, result, onOpen }: { op: ScheduledOperation; result: ScheduleResult; onOpen: (o: ScheduledOperation) => void }) {
  const preds = result.links.filter((l) => l.to === op.id);
  const succs = result.links.filter((l) => l.from === op.id);
  const byId = new Map(result.operations.map((o) => [o.id, o]));
  return (
    <div>
      <h3>{op.name}</h3>
      <p className="muted small">{op.locationLabel} · {GROUP_NAMES[op.group]}</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="badge accent">{formatRu(op.start)} — {formatRu(op.finish)}</span>
        <span className="badge">{op.calendarDays} кал. дн. / {op.workingDays} раб.</span>
        {op.critical ? <span className="badge critical">критическая</span> : <span className="badge">резерв {op.totalFloat} раб. дн.</span>}
        {op.waitDays > 0 && <span className="badge warn">простой {op.waitDays} дн.</span>}
        {op.winterApplied && <span className="badge accent">зима</span>}
        {!op.resolved && <span className="badge critical">нет данных</span>}
      </div>
      {op.kind === 'work' && (
        <div className="grid cols-2 small" style={{ marginBottom: 10 }}>
          <div>Объём: <b>{fmtNum(op.quantity)} {op.unit}</b> <StatusBadge status={op.quantityStatus} /></div>
          <div>Выработка: <b>{fmtNum(op.productivity)}</b> <StatusBadge status={op.productivityStatus} /></div>
          <div>Бригад: <b>{op.crews}</b> (по {op.crewSize} чел.)</div>
          <div>Смен: <b>{fmtNum(op.workShifts)}</b></div>
        </div>
      )}
      {op.explanation.map((e, i) => (
        <div key={i} className={`explain-item ${e.kind}`}>
          <div className="k">{KIND_LABEL[e.kind] ?? e.kind}</div>
          <div>{e.text}</div>
        </div>
      ))}
      {op.qualityControl.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>Приёмка и контроль качества</h3>
          <ul className="small" style={{ paddingLeft: 18, marginTop: 0 }}>{op.qualityControl.map((q) => <li key={q}>{q}</li>)}</ul>
        </>
      )}
      <h3 style={{ marginTop: 12 }}>Связи</h3>
      <LinkList title="Предшественники" ids={preds.map((l) => ({ id: l.from, label: `${l.type}${l.lag.value ? ` ${l.lag.value > 0 ? '+' : ''}${l.lag.value}${l.lag.unit === 'work' ? 'р' : 'к'}д` : ''}`, origin: l.origin }))} byId={byId} onOpen={onOpen} />
      <LinkList title="Последователи" ids={succs.map((l) => ({ id: l.to, label: l.type, origin: l.origin }))} byId={byId} onOpen={onOpen} />
      <p className="muted small mono" style={{ marginTop: 12 }}>ID: {op.id}</p>
    </div>
  );
}

const ORIGIN: Record<string, string> = {
  technology: 'технология', 'cross-group': 'фронт работ', turnover: 'оборачиваемость', resource: 'ресурс', 'next-floor': 'следующий этаж',
};

function LinkList(props: { title: string; ids: { id: string; label: string; origin: string }[]; byId: Map<string, ScheduledOperation>; onOpen: (o: ScheduledOperation) => void }) {
  if (!props.ids.length) return null;
  return (
    <div className="small" style={{ marginBottom: 8 }}>
      <div className="muted">{props.title}:</div>
      {props.ids.map(({ id, label, origin }) => {
        const o = props.byId.get(id);
        if (!o) return null;
        return (
          <div key={id + label} className="row" style={{ gap: 6 }}>
            <span className="badge">{label}</span>
            <span className="badge">{ORIGIN[origin] ?? origin}</span>
            <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(o); }}>{o.name}</a>
            <span className="muted">{o.locationLabel.split(' / ').slice(2).join(' / ')}</span>
          </div>
        );
      })}
    </div>
  );
}
