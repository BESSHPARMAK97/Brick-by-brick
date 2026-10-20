import { useState } from 'react';
import { GROUP_NAMES } from '../../engine/catalog/library';
import { formatRu, toDayNum } from '../../engine/dates';
import type { ResourceKind, ResourceProfile } from '../../engine/types';
import type { ScreenProps } from '../App';
import { Field, NumberInput } from '../components/common';

const KIND_RU: Record<string, string> = {
  crane: 'Башенный кран', pump: 'Бетононасос', concrete: 'Поставка бетона', slabFormwork: 'Опалубка перекрытий',
  wallFormwork: 'Опалубка стен', front: 'Фронт работ', crew: 'Бригада',
};

export function Resources({ app }: ScreenProps) {
  const { input, setInput, calc } = app;
  const r = calc.result;
  const res = input.resources;
  return (
    <div>
      <div className="grid cols-2">
        <div className="card">
          <h2>Бригады</h2>
          <p className="muted small">«Бригад» — число бригад каждого профиля (у монолита: арматурщики, опалубщики, бетонщики). «На фронт» — сколько бригад можно поставить на одну операцию.</p>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Вид работ</th><th>Бригад</th><th>На фронт</th></tr></thead>
              <tbody>
                {input.workGroups.map((g) => (
                  <tr key={g}>
                    <td>{GROUP_NAMES[g]}</td>
                    <td style={{ width: 90 }}><NumberInput value={res.crews[g]} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.crews[g] = Math.round(v)))} /></td>
                    <td style={{ width: 90 }}><NumberInput value={res.crewsPerOperation[g]} min={1} max={4} step={1} onChange={(v) => v && setInput((d) => (d.resources.crewsPerOperation[g] = Math.round(v)))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Техника, оснастка, материалы</h2>
          <div className="grid cols-2">
            <Field label="Кранов на секцию"><NumberInput value={res.cranesPerSection} min={0} step={1} onChange={(v) => v !== null && setInput((d) => (d.resources.cranesPerSection = v))} /></Field>
            <Field label="Бетононасосов"><NumberInput value={res.pumps} min={0} step={1} onChange={(v) => v !== null && setInput((d) => (d.resources.pumps = Math.round(v)))} /></Field>
            <Field label="Поставка бетона, м³/сут"><NumberInput value={res.concreteSupplyM3PerDay} min={1} onChange={(v) => v && setInput((d) => (d.resources.concreteSupplyM3PerDay = v))} /></Field>
            <Field label="Видов работ на этаже одновременно"><NumberInput value={res.maxTradesPerFloor} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.maxTradesPerFloor = Math.round(v)))} /></Field>
            <Field label="Комплектов опалубки перекрытий" hint="на захватку"><NumberInput value={res.slabFormworkSets} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.slabFormworkSets = Math.round(v)))} /></Field>
            <Field label="Комплектов опалубки стен" hint="на захватку"><NumberInput value={res.wallFormworkSets} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.wallFormworkSets = Math.round(v)))} /></Field>
          </div>
        </div>
      </div>
      <Unavailability app={app} />
      <DeliveryConstraints app={app} />
      {r && (
        <div className="card">
          <h2>Загрузка ресурсов</h2>
          <p className="muted small">Столбцы — пиковая загрузка за неделю; красным — недели с ограничением доступности (окно недоступности).</p>
          <div className="grid cols-2">
            {r.resources.filter((p) => p.kind !== 'front' || p.peak > 0).map((p) => <ResourceChart key={p.id} p={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceChart({ p }: { p: ResourceProfile }) {
  const weeks: { used: number; cap: number; from: string }[] = [];
  for (let i = 0; i < p.usage.length; i += 7) {
    const chunk = p.usage.slice(i, i + 7);
    weeks.push({ used: Math.max(...chunk.map((c) => c.used)), cap: Math.min(...chunk.map((c) => c.capacity)), from: chunk[0].day });
  }
  const maxV = Math.max(p.capacity, ...weeks.map((w) => w.used), 0.0001);
  return (
    <div className="card" style={{ boxShadow: 'none' }}>
      <div className="row"><b className="small">{p.name}</b><div className="spacer" /><span className="badge">{p.peak}/{p.capacity} {p.unit}</span>{p.conflictsResolved > 0 && <span className="badge warn" title="Число раз, когда операция ожидала ресурс">конфликтов: {p.conflictsResolved}</span>}</div>
      <div className="hist" aria-label={`Загрузка ресурса ${p.name}`}>
        {weeks.map((w) => <div key={w.from} className={w.cap < p.capacity ? 'over' : ''} style={{ height: `${(w.used / maxV) * 100}%` }} title={`Неделя с ${formatRu(w.from)}: ${w.used} из ${w.cap}`} />)}
      </div>
    </div>
  );
}

function Unavailability({ app }: { app: ScreenProps['app'] }) {
  const { input, setInput } = app;
  const sections = input.buildings.flatMap((b) => b.sections.map((s) => ({ id: s.id, name: `${b.name}, ${s.name}` })));
  const [kind, setKind] = useState<ResourceKind | 'crew'>('crane');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState(input.startDate);
  const [to, setTo] = useState(input.startDate);
  const [reason, setReason] = useState('');
  const sectionKinds = ['crane', 'slabFormwork', 'wallFormwork'];
  return (
    <div className="card">
      <h2>Недоступность ресурсов</h2>
      <p className="muted small">Ремонт крана, отсутствие опалубки, перерыв в поставке бетона, отпуск бригады — операции, требующие ресурс, в этот период не выполняются.</p>
      <div className="grid cols-4">
        <Field label="Ресурс">
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as ResourceKind); setTarget(''); }}>
            {Object.entries(KIND_RU).filter(([k]) => k !== 'front').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label={kind === 'crew' ? 'Вид работ' : 'Секция'}>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{kind === 'crew' ? '— выберите —' : 'Все'}</option>
            {kind === 'crew' ? input.workGroups.map((g) => <option key={g} value={g}>{GROUP_NAMES[g]}</option>) : sectionKinds.includes(kind) ? sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : null}
          </select>
        </Field>
        <Field label="С"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="По"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder="Причина (например, ремонт крана)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn primary" disabled={!from || !to || toDayNum(to) < toDayNum(from) || (kind === 'crew' && !target)} onClick={() => setInput((d) => d.resources.unavailability.push({ kind, target: target || undefined, from, to, reason: reason || KIND_RU[kind] + ' недоступен' }))}>Добавить</button>
      </div>
      {input.resources.unavailability.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}><table className="t">
          <tbody>
            {input.resources.unavailability.map((u, i) => (
              <tr key={i}>
                <td>{KIND_RU[u.kind]}{u.target ? ` (${u.kind === 'crew' ? GROUP_NAMES[u.target] : sections.find((s) => s.id === u.target)?.name ?? u.target})` : ''}</td>
                <td className="num">{formatRu(u.from)} — {formatRu(u.to)}</td>
                <td>{u.reason}</td>
                <td><button className="btn small danger" onClick={() => setInput((d) => d.resources.unavailability.splice(i, 1))}>Удалить</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function DeliveryConstraints({ app }: { app: ScreenProps['app'] }) {
  const { input, setInput, calc } = app;
  const keys = calc.result ? [...new Map(calc.result.operations.filter((o) => o.kind === 'work').map((o) => [o.templateKey, o.name])).entries()] : [];
  const [key, setKey] = useState('');
  const [date, setDate] = useState(input.startDate);
  const [reason, setReason] = useState('');
  return (
    <div className="card">
      <h2>Поставки материалов (ограничение «не ранее»)</h2>
      <div className="grid cols-3">
        <Field label="Операция">
          <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">— выберите —</option>
            {keys.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </Field>
        <Field label="Материал на объекте не ранее"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Причина"><input className="input" value={reason} placeholder="Поставка оконных блоков" onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <button className="btn primary" style={{ marginTop: 8 }} disabled={!key || !date} onClick={() => setInput((d) => d.constraints.push({ templateKey: key, notBefore: date, reason: reason || 'Срок поставки материала' }))}>Добавить</button>
      {input.constraints.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}><table className="t">
          <tbody>
            {input.constraints.map((c, i) => (
              <tr key={i}><td>{keys.find(([k]) => k === c.templateKey)?.[1] ?? c.templateKey}</td><td className="num">не ранее {formatRu(c.notBefore)}</td><td>{c.reason}</td>
                <td><button className="btn small danger" onClick={() => setInput((d) => d.constraints.splice(i, 1))}>Удалить</button></td></tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
