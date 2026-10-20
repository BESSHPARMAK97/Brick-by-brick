import { useState } from 'react';
import { WORK_LIBRARY } from '../../engine/catalog/library';
import type { OperationTemplate } from '../../engine/catalog/types';
import { defaultCalendar } from '../../engine/defaults';
import type { CalendarRegime, CalendarSettings, DataStatus, OperationOverride, WorkGroupId } from '../../engine/types';
import type { ScreenProps } from '../App';
import { Field, NumberInput, StatusBadge } from '../components/common';

const TABS = ['Операции и выработка', 'Технология', 'Календари'] as const;

export function Templates(props: ScreenProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  return (
    <div>
      <div className="steps">{TABS.map((t) => <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === TABS[0] && <OperationsTab {...props} />}
      {tab === TABS[1] && <TechnologyTab {...props} />}
      {tab === TABS[2] && <CalendarsTab {...props} />}
    </div>
  );
}

const STATUSES: { v: DataStatus; l: string }[] = [
  { v: 'assumption', l: 'сценарий' }, { v: 'confirmed', l: 'подтверждено' }, { v: 'project', l: 'по проекту' }, { v: 'normative', l: 'норматив' },
];

function OperationsTab({ app }: ScreenProps) {
  const { input, setInput } = app;
  const [group, setGroup] = useState<WorkGroupId>(input.workGroups[0] ?? 'monolith');
  const g = WORK_LIBRARY.find((x) => x.id === group)!;
  const ov = (k: string): OperationOverride => input.overrides[k] ?? {};
  const setOv = (k: string, patch: Partial<OperationOverride>) => setInput((d) => {
    const next = { ...(d.overrides[k] ?? {}), ...patch };
    for (const key of Object.keys(next) as (keyof OperationOverride)[]) if (next[key] === undefined) delete next[key];
    if (Object.keys(next).length) d.overrides[k] = next;
    else delete d.overrides[k];
  });
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        {WORK_LIBRARY.map((x) => (
          <button key={x.id} className={`btn small ${x.id === group ? 'primary' : ''}`} onClick={() => setGroup(x.id)}>
            {x.name}{!input.workGroups.includes(x.id) && ' (не выбран)'}
          </button>
        ))}
      </div>
      <div className="alert warning small">
        Значения со статусом «сценарий» — <b>не нормативы</b>. Укажите фактическую выработку бригады или норму с источником и смените статус.
        Объём «на захватку» из ВОР заменяет удельный показатель.
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Операция</th><th>Ед.</th><th>Выработка / длительность</th><th>Статус</th><th>Объём на захватку (ВОР)</th><th>Мин. t воздуха, °C</th><th>Бригада / техника</th></tr>
          </thead>
          <tbody>
            {g.operations.map((t) => <OpRow key={t.key} t={t} ov={ov(t.key)} setOv={(p) => setOv(t.key, p)} />)}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3>Технологические связи шаблона «{g.name}»</h3>
        <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Предшественник (альтернативы)</th><th>Тип</th><th>Последователь</th><th>Условие</th></tr></thead>
          <tbody>
            {g.links.map((l, i) => (
              <tr key={i}>
                <td className="small">{l.from.map((k) => nameOf(k)).join(' → иначе ')}</td>
                <td>{l.type}{l.lag ? ` ${l.lag.value > 0 ? '+' : ''}${l.lag.value} ${l.lag.unit === 'work' ? 'раб.' : 'кал.'} дн.` : ''}</td>
                <td className="small">{nameOf(l.to)}</td>
                <td className="small muted">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="muted small">Изменение структуры шаблонов (новые операции и связи) — в коде каталога, см. docs/ADDING_WORKS.md.</p>
      </div>
    </div>
  );
}

function nameOf(key: string) {
  for (const g of WORK_LIBRARY) for (const o of g.operations) if (o.key === key) return o.name;
  return key;
}

function OpRow({ t, ov, setOv }: { t: OperationTemplate; ov: OperationOverride; setOv: (p: Partial<OperationOverride>) => void }) {
  const isDuration = !t.productivity && !!t.durationShifts;
  const value = isDuration ? (ov.durationShifts !== undefined ? ov.durationShifts : t.durationShifts?.value ?? null) : (ov.productivity !== undefined ? ov.productivity : t.productivity?.value ?? null);
  const status: DataStatus = isDuration
    ? (ov.durationShifts === null ? 'missing' : ov.durationStatus ?? (ov.durationShifts !== undefined ? 'confirmed' : t.durationShifts?.status ?? 'missing'))
    : (ov.productivity === null ? 'missing' : ov.productivityStatus ?? (ov.productivity !== undefined ? 'confirmed' : t.productivity?.status ?? 'missing'));
  const hasValue = !!(t.productivity || t.durationShifts);
  const minT = ov.minAirTemp !== undefined ? ov.minAirTemp : t.climate?.minAirTemp?.value ?? null;
  return (
    <tr>
      <td>
        <div>{t.name}</div>
        <div className="muted small">{t.techGroup}{t.kind === 'curing' ? ' · рассчитывается по модели прочности' : ''}</div>
      </td>
      <td>{t.unit || '—'}</td>
      <td style={{ minWidth: 150 }}>
        {hasValue ? (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <NumberInput value={value} min={0} allowEmpty onChange={(v) => setOv(isDuration ? { durationShifts: v, durationStatus: v === null ? 'missing' : status === 'missing' ? 'assumption' : status } : { productivity: v, productivityStatus: v === null ? 'missing' : status === 'missing' ? 'assumption' : status })} />
            <span className="small muted">{isDuration ? 'смен' : t.productivity?.unit}</span>
          </div>
        ) : <span className="muted small">—</span>}
      </td>
      <td>
        {hasValue ? (
          <select className="input" value={status} onChange={(e) => {
            const s = e.target.value as DataStatus;
            setOv(isDuration ? { durationShifts: value, durationStatus: s } : { productivity: value, productivityStatus: s });
          }}>
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            {status === 'missing' && <option value="missing">нет данных</option>}
          </select>
        ) : <StatusBadge status="normative" />}
        {(ov.productivity !== undefined || ov.durationShifts !== undefined) && <button className="btn small" style={{ marginTop: 4 }} onClick={() => setOv({ productivity: undefined, productivityStatus: undefined, durationShifts: undefined, durationStatus: undefined })}>Сбросить</button>}
      </td>
      <td style={{ minWidth: 120 }}>
        {t.quantity ? (
          <>
            <NumberInput value={ov.quantityPerZone ?? null} allowEmpty min={0} onChange={(v) => setOv({ quantityPerZone: v ?? undefined, quantityStatus: v === null ? undefined : 'project' })} />
            <div className="muted small">иначе {t.quantity.ratio} {t.unit}/м²</div>
          </>
        ) : '—'}
      </td>
      <td style={{ minWidth: 90 }}>
        {t.climate ? <NumberInput value={minT} allowEmpty onChange={(v) => setOv({ minAirTemp: v })} /> : '—'}
      </td>
      <td className="small muted">{t.crew ? `${t.crew.composition}` : '—'}{t.equipment.length ? `; ${t.equipment.map((e) => e.kind).join(', ')}` : ''}</td>
    </tr>
  );
}

function TechnologyTab({ app }: ScreenProps) {
  const { input, setInput } = app;
  const t = input.technology;
  const confirmed = new Set(input.confirmedParams);
  const Confirm = ({ k }: { k: string }) => (
    <label className="check small"><input type="checkbox" checked={confirmed.has(k)} onChange={(e) => setInput((d) => {
      d.confirmedParams = e.target.checked ? [...new Set([...d.confirmedParams, k])] : d.confirmedParams.filter((x) => x !== k);
    })} />подтверждено</label>
  );
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Бетон и набор прочности</h2>
        <div className="grid cols-2">
          <Field label="Класс бетона B, МПа" hint={<Confirm k="technology.concreteClassMPa" />}><NumberInput value={t.concreteClassMPa} min={7.5} max={100} onChange={(v) => v && setInput((d) => (d.technology.concreteClassMPa = v))} /></Field>
          <Field label="Цемент (коэффициент s, EN 1992-1-1)" hint={<Confirm k="technology.cementS" />}>
            <select className="input" value={t.cementS} onChange={(e) => setInput((d) => (d.technology.cementS = Number(e.target.value)))}>
              <option value={0.2}>0,20 — быстротвердеющий</option><option value={0.25}>0,25 — нормальный</option><option value={0.38}>0,38 — медленный</option>
            </select>
          </Field>
          <Field label="Распалубка стен, МПа" hint="СП 70.13330, табл. 5.11: 0,2–0,3"><NumberInput value={t.verticalStripMPa} min={0.1} onChange={(v) => v && setInput((d) => (d.technology.verticalStripMPa = v))} /></Field>
          <Field label="Распалубка перекрытий, %" hint="Пусто — по пролёту (70 % / 80 %); меньше — только по ППР с переопиранием"><NumberInput value={t.slabStripPercent} allowEmpty min={1} max={100} onChange={(v) => setInput((d) => (d.technology.slabStripPercent = v))} /></Field>
          <Field label="Допуск людей и опалубки выше, МПа" hint="СП 70.13330: не менее 1,5"><NumberInput value={t.walkStrengthMPa} min={0.5} onChange={(v) => v && setInput((d) => (d.technology.walkStrengthMPa = v))} /></Field>
          <Field label="Температура бетона зимой, °C" hint={<Confirm k="technology.winterCuringTempC" />}><NumberInput value={t.winterCuringTempC} min={1} max={60} onChange={(v) => v && setInput((d) => (d.technology.winterCuringTempC = v))} /></Field>
        </div>
        <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={t.winterMeasuresIncludedInRates} onChange={(e) => setInput((d) => (d.technology.winterMeasuresIncludedInRates = e.target.checked))} />Зимние мероприятия уже учтены в выработке (не добавлять отдельно)</label>
      </div>
      <div className="card">
        <h2>Организация работ</h2>
        <div className="grid cols-2">
          <Field label="Отставание кладки от монолита, этажей" hint={<Confirm k="technology.masonryLagFloors" />}><NumberInput value={t.masonryLagFloors} min={0} step={1} onChange={(v) => v !== null && setInput((d) => (d.technology.masonryLagFloors = Math.round(v)))} /></Field>
          <Field label="Тип фасада">
            <select className="input" value={t.facadeType} onChange={(e) => setInput((d) => (d.technology.facadeType = e.target.value as 'wet' | 'ventilated'))}>
              <option value="ventilated">Навесной вентилируемый</option><option value="wet">«Мокрый» (СФТК)</option>
            </select>
          </Field>
          <Field label="Резерв на риски, раб. дн."><NumberInput value={t.projectBufferDays} min={0} step={1} onChange={(v) => v !== null && setInput((d) => (d.technology.projectBufferDays = Math.round(v)))} /></Field>
        </div>
        <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={t.temporaryHeating} onChange={(e) => setInput((d) => (d.technology.temporaryHeating = e.target.checked))} />Временное отопление здания (внутренние «мокрые» работы зимой)</label>
        <label className="check"><input type="checkbox" checked={t.enclosureForExternalWorks} onChange={(e) => setInput((d) => (d.technology.enclosureForExternalWorks = e.target.checked))} />Тепляки/укрытия для наружных работ (фасад, кровля, гидроизоляция)</label>
      </div>
    </div>
  );
}

function CalendarEditor({ value, onChange }: { value: CalendarSettings; onChange: (c: CalendarSettings) => void }) {
  const set = (p: Partial<CalendarSettings>) => onChange({ ...value, ...p });
  return (
    <div className="grid cols-3">
      <Field label="Режим">
        <select className="input" value={value.regime} onChange={(e) => set({ regime: e.target.value as CalendarRegime, restWeekdays: e.target.value === 'custom' ? value.restWeekdays ?? [0] : undefined })}>
          <option value="5/2">5/2</option><option value="6/1">6/1</option><option value="7/0">7/0</option><option value="custom">Индивидуальный</option>
        </select>
      </Field>
      <Field label="Смен в сутки">
        <select className="input" value={value.shiftsPerDay} onChange={(e) => set({ shiftsPerDay: Number(e.target.value) })}>
          <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
        </select>
      </Field>
      <Field label="Смена, ч"><NumberInput value={value.shiftHours} min={1} max={12} onChange={(v) => v && set({ shiftHours: v })} /></Field>
      {value.regime === 'custom' && (
        <Field label="Выходные дни">
          <div className="row">
            {['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'].map((w, i) => (
              <label key={w} className="check small"><input type="checkbox" checked={(value.restWeekdays ?? []).includes(i)} onChange={(e) => set({ restWeekdays: e.target.checked ? [...(value.restWeekdays ?? []), i] : (value.restWeekdays ?? []).filter((x) => x !== i) })} />{w}</label>
            ))}
          </div>
        </Field>
      )}
      <Field label="Предпраздничное сокращение, ч" hint="0 — не применяется; применимость проверить по ТК РК/колдоговору"><NumberInput value={value.preHolidayShorteningHours} min={0} max={8} onChange={(v) => v !== null && set({ preHolidayShorteningHours: v })} /></Field>
      <label className="check small"><input type="checkbox" checked={value.observeHolidays} onChange={(e) => set({ observeHolidays: e.target.checked })} />Соблюдать праздничные дни РК</label>
    </div>
  );
}

function CalendarsTab({ app }: ScreenProps) {
  const { input, setInput } = app;
  return (
    <div>
      <div className="card">
        <h2>Основной календарь</h2>
        <CalendarEditor value={input.calendar} onChange={(c) => setInput((d) => (d.calendar = c))} />
      </div>
      <div className="card">
        <h2>Календари подрядчиков по видам работ</h2>
        <p className="muted small">По умолчанию вид работ использует основной календарь. Включите отдельный календарь, если у подрядчика другой режим.</p>
        {WORK_LIBRARY.filter((g) => input.workGroups.includes(g.id)).map((g) => {
          const own = input.groupCalendars[g.id];
          return (
            <div key={g.id} className="card" style={{ boxShadow: 'none' }}>
              <label className="check"><input type="checkbox" checked={!!own} onChange={(e) => setInput((d) => {
                if (e.target.checked) d.groupCalendars[g.id] = { ...defaultCalendar(), ...d.calendar };
                else delete d.groupCalendars[g.id];
              })} /><b>{g.name}</b></label>
              {own && <div style={{ marginTop: 8 }}><CalendarEditor value={own} onChange={(c) => setInput((d) => (d.groupCalendars[g.id] = c))} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
