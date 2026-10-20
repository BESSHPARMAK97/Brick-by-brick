import { useMemo, useState } from 'react';
import { KZ_HOLIDAYS } from '../../engine/calendar/holidays';
import { WorkCalendar } from '../../engine/calendar/workCalendar';
import { ASTANA_NORMALS, ClimateEngine } from '../../engine/climate/climate';
import { daysInMonth, formatRu, fromDayNum, makeDay, MONTH_RU, monthOf, toDayNum, weekday, yearOf } from '../../engine/dates';
import type { ForecastSnapshot } from '../../engine/types';
import type { ScreenProps } from '../App';
import { CAL_STATUS_RU, Field } from '../components/common';

export function CalendarView({ app }: ScreenProps) {
  const { input, setInput, calc } = app;
  const [status, setStatus] = useState<string | null>(null);
  const cal = useMemo(() => new WorkCalendar('main', 'main', input.calendar), [input.calendar]);
  const climate = useMemo(() => new ClimateEngine(ASTANA_NORMALS, input.forecast, input.strongWind), [input.forecast, input.strongWind]);
  const start = toDayNum(input.startDate);
  const end = calc.result ? toDayNum(calc.result.projectFinishWithBuffer) : start + 365;
  const months: { y: number; m: number }[] = [];
  for (let y = yearOf(start), m = monthOf(start); y < yearOf(end) || (y === yearOf(end) && m <= monthOf(end)); m === 11 ? (y++, (m = 0)) : m++) months.push({ y, m });
  const years = [...new Set(months.map((x) => x.y))];

  const holidays: { d: number; label: string; type: string }[] = [];
  for (let d = start; d <= end; d++) {
    const i = cal.info(d);
    if (i.type === 'holiday' || i.type === 'transfer' || i.type === 'extra-off' || i.type === 'shortened') holidays.push({ d, label: i.label, type: i.type });
  }

  const loadForecast = async () => {
    setStatus('Загрузка прогноза…');
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${ASTANA_NORMALS.lat}&longitude=${ASTANA_NORMALS.lon}&daily=temperature_2m_max,temperature_2m_min,wind_gusts_10m_max,precipitation_sum&wind_speed_unit=ms&timezone=auto&forecast_days=16`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const days = (j.daily.time as string[]).map((date, i) => ({
        date,
        tMin: j.daily.temperature_2m_min[i],
        tMax: j.daily.temperature_2m_max[i],
        windMaxMs: j.daily.wind_gusts_10m_max[i],
        precipMm: j.daily.precipitation_sum[i] ?? 0,
      })).filter((d) => [d.tMin, d.tMax, d.windMaxMs].every((v) => typeof v === 'number'));
      const snap: ForecastSnapshot = { source: 'Open-Meteo (open-meteo.com), порывы ветра на 10 м', fetchedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), days };
      setInput((d) => (d.forecast = snap));
      setStatus(`Прогноз загружен: ${days.length} дн.`);
    } catch (e) {
      setStatus(`Не удалось загрузить прогноз: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div>
      <div className="grid cols-2">
        <div className="card">
          <h2>Календарь РК</h2>
          {years.map((y) => {
            const i = KZ_HOLIDAYS.yearInfo(y);
            const ok = i.status === 'confirmed' || i.status === 'secondary';
            return <div key={y} className="small" style={{ marginBottom: 4 }}><b>{y}:</b> <span className={`badge ${ok ? 'ok' : 'warn'}`}>{CAL_STATUS_RU[i.status]}</span> <span className="muted">{i.source}</span></div>;
          })}
          <p className="muted small">{KZ_HOLIDAYS.rules.transferRule}</p>
          <p className="muted small">Основание: {KZ_HOLIDAYS.rules.legalBasis}. Данные обновлены: {KZ_HOLIDAYS.rules.updatedAt}.</p>
        </div>
        <div className="card">
          <h2>Погода и климат</h2>
          <p className="small">Долгосрочное планирование — по климатической норме {ASTANA_NORMALS.period} ({ASTANA_NORMALS.source}). Для оперативной корректировки загрузите прогноз: он заменит норму на свои даты и остановит крановые работы при ветре &gt; {input.craneWindLimitMs} м/с.</p>
          <div className="row">
            {import.meta.env.VITE_SANDBOXED === '1'
              ? <span className="small muted">Загрузка прогноза доступна в локальной версии (в опубликованной странице внешние запросы закрыты).</span>
              : <button className="btn primary" onClick={loadForecast}>Загрузить прогноз на 16 дней</button>}
            {input.forecast && <button className="btn" onClick={() => setInput((d) => (d.forecast = null))}>Убрать прогноз</button>}
          </div>
          {status && <p className="small" style={{ marginTop: 6 }}>{status}</p>}
          {input.forecast && <p className="small muted">Снимок: {input.forecast.source}, {input.forecast.fetchedAt}, {input.forecast.days.length} дн. Сохраняется в исходных данных — расчёт воспроизводим.</p>}
          <div className="grid cols-2" style={{ marginTop: 8 }}>
            <Field label="Ограничение крана по ветру, м/с" hint="По паспорту крана">
              <input className="input" type="number" value={input.craneWindLimitMs} min={5} max={30} onChange={(e) => Number(e.target.value) > 0 && setInput((d) => (d.craneWindLimitMs = Number(e.target.value)))} />
            </Field>
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="small">Статистика дней с сильным ветром (ввод пользователя)</summary>
            <p className="muted small">{ASTANA_NORMALS.strongWindDays.note}</p>
            <div className="grid cols-4">
              {MONTH_RU.map((name, m) => (
                <Field key={m} label={name}>
                  <input className="input" type="number" min={0} max={31} value={input.strongWind?.values[m] ?? ''} onChange={(e) => setInput((d) => {
                    const vals = d.strongWind?.values ?? Array(12).fill(null);
                    vals[m] = e.target.value === '' ? null : Number(e.target.value);
                    d.strongWind = vals.every((v: number | null) => v === null) ? null : { values: vals, source: 'Введено пользователем' };
                  })} />
                </Field>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="card">
        <h2>Нерабочие дни в периоде строительства</h2>
        {holidays.length === 0 ? <p className="muted">Нет.</p> : (
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="t"><tbody>
              {holidays.map((h) => <tr key={h.d}><td className="num">{formatRu(h.d)}</td><td>{h.label}</td></tr>)}
            </tbody></table>
          </div>
        )}
        <h3 style={{ marginTop: 10 }}>Собственные исключения подрядчика</h3>
        <DateListEditor label="Дополнительные нерабочие дни" values={input.calendar.extraNonWorking} onChange={(v) => setInput((d) => (d.calendar.extraNonWorking = v))} />
        <DateListEditor label="Дополнительные рабочие дни (например, рабочая суббота)" values={input.calendar.extraWorking} onChange={(v) => setInput((d) => (d.calendar.extraWorking = v))} />
      </div>

      <div className="legend" style={{ margin: '8px 0' }}>
        <span style={{ ['--sw' as string]: 'var(--surface)' }}>рабочий</span>
        <span style={{ ['--sw' as string]: 'var(--weekend)' }}>выходной</span>
        <span style={{ ['--sw' as string]: 'var(--holiday)' }}>праздник/перенос</span>
        <span style={{ ['--sw' as string]: 'var(--accent)' }}>• зимние условия бетонирования</span>
      </div>
      <div className="calendar-months">
        {months.map(({ y, m }) => {
          const first = makeDay(y, m, 1);
          const offset = (weekday(first) + 6) % 7;
          const n = daysInMonth(y, m);
          const norm = ASTANA_NORMALS.monthly[m];
          return (
            <div key={`${y}-${m}`} className="card month">
              <h3>{MONTH_RU[m]} {y}</h3>
              <div className="muted small" style={{ marginBottom: 4 }}>t ср {norm.tMean} °C, t мин {norm.tMin} °C</div>
              <div className="month-grid">
                {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w) => <div key={w} className="wd">{w}</div>)}
                {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: n }, (_, i) => {
                  const d = first + i;
                  const info = cal.info(d);
                  const w = climate.weather(d);
                  const cls = info.capacity > 0 ? 'work' : info.type === 'holiday' || info.type === 'transfer' ? 'holiday' : 'weekend';
                  return (
                    <div key={i} className={`day ${cls} ${climate.isWinterConcreting(d) ? 'winter' : ''}`} title={`${formatRu(d)}: ${info.label}. Ожидаемая t ср ${w.tMean} °C (${w.source === 'forecast' ? 'прогноз' : 'норма'})`}>
                      {i + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Сегодня: {fromDayNum(Math.floor(Date.now() / 86_400_000))}</p>
    </div>
  );
}

function DateListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [v, setV] = useState('');
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="small muted">{label}</div>
      <div className="row">
        <input className="input" type="date" style={{ maxWidth: 180 }} value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn small" disabled={!v || values.includes(v)} onClick={() => { onChange([...values, v].sort()); setV(''); }}>Добавить</button>
        {values.map((d) => <span key={d} className="badge">{formatRu(d)} <a href="#" onClick={(e) => { e.preventDefault(); onChange(values.filter((x) => x !== d)); }}>✕</a></span>)}
      </div>
    </div>
  );
}
