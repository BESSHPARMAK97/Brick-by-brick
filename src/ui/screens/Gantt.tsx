import { useMemo, useState } from 'react';
import { WorkCalendar } from '../../engine/calendar/workCalendar';
import { dayOfMonth, formatRu, fromDayNum, monthOf, MONTH_RU, toDayNum, yearOf } from '../../engine/dates';
import type { ScreenProps } from '../App';
import { applyFilter, FilterBar, useOpFilter } from './Operations';

const ZOOMS = [
  { id: 'day', label: 'Дни', px: 18 },
  { id: 'week', label: 'Недели', px: 5 },
  { id: 'month', label: 'Месяцы', px: 1.6 },
] as const;

const ROW = 22;
const HEADER = 40;

export function Gantt({ app, openOp }: ScreenProps) {
  const [f, set] = useOpFilter();
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]['id']>('week');
  const [labelW, setLabelW] = useState(300);
  const r = app.calc.result;
  const list = useMemo(() => (r ? applyFilter(r.operations, f) : []), [r, f]);
  const cal = useMemo(() => new WorkCalendar('main', 'main', app.input.calendar), [app.input.calendar]);
  if (!r) return <div className="empty">Нет расчёта.</div>;

  const px = ZOOMS.find((z) => z.id === zoom)!.px;
  const start = toDayNum(r.projectStart);
  const end = toDayNum(r.projectFinishWithBuffer) + 1;
  const days = end - start;
  const W = labelW + days * px + 20;
  const H = HEADER + list.length * ROW + 10;
  const x = (d: number) => labelW + (d - start) * px;

  // Шкала: месяцы и дни (в режиме «дни») или недели
  const months: { d: number; label: string }[] = [];
  for (let d = start; d < end; d++) if (d === start || dayOfMonth(d) === 1) months.push({ d, label: `${MONTH_RU[monthOf(d)].slice(0, 3)} ${yearOf(d)}` });
  const nonWorking: { d: number; holiday: boolean }[] = [];
  if (px >= 5) for (let d = start; d < end; d++) {
    const i = cal.info(d);
    if (i.capacity === 0) nonWorking.push({ d, holiday: i.type === 'holiday' || i.type === 'transfer' });
  }
  const linksShown = zoom === 'day' && list.length <= 200;
  const rowOf = new Map(list.map((o, i) => [o.id, i]));

  return (
    <div>
      <FilterBar f={f} set={set} app={app} />
      <div className="row" style={{ marginBottom: 8 }}>
        {ZOOMS.map((z) => <button key={z.id} className={`btn small ${zoom === z.id ? 'primary' : ''}`} onClick={() => setZoom(z.id)}>{z.label}</button>)}
        <button className="btn small" onClick={() => setLabelW(labelW === 300 ? 140 : 300)}>{labelW === 300 ? 'Узкие подписи' : 'Широкие подписи'}</button>
        <div className="legend">
          <span style={{ ['--sw' as string]: 'var(--accent)' }}>работа</span>
          <span style={{ ['--sw' as string]: 'var(--critical)' }}>критическая</span>
          <span style={{ ['--sw' as string]: 'var(--curing)' }}>технологический перерыв</span>
          <span style={{ ['--sw' as string]: 'var(--holiday)' }}>праздник/перенос</span>
        </div>
      </div>
      <div className="gantt-wrap gantt">
        <svg width={W} height={H} role="img" aria-label="Диаграмма Ганта">
          {nonWorking.map(({ d, holiday }) => (
            <rect key={d} x={x(d)} y={HEADER} width={px} height={H - HEADER} fill={holiday ? 'var(--holiday)' : 'var(--weekend)'} opacity={0.7} />
          ))}
          {months.map((m) => (
            <g key={m.d}>
              <line x1={x(m.d)} x2={x(m.d)} y1={0} y2={H} stroke="var(--border)" />
              <text x={x(m.d) + 3} y={14}>{m.label}</text>
            </g>
          ))}
          {zoom === 'day' && Array.from({ length: days }, (_, i) => (
            <text key={i} x={x(start + i) + px / 2} y={32} textAnchor="middle" style={{ fontSize: 9 }} fill="var(--muted)">{dayOfMonth(start + i)}</text>
          ))}
          <line x1={0} x2={W} y1={HEADER - 1} y2={HEADER - 1} stroke="var(--border)" />
          {r.projectFinishWithBuffer !== r.projectFinish && (
            <rect x={x(toDayNum(r.projectFinish) + 1)} y={HEADER} width={(toDayNum(r.projectFinishWithBuffer) - toDayNum(r.projectFinish)) * px} height={H - HEADER} fill="var(--warn-weak)" opacity={0.6}>
              <title>Резерв на риски</title>
            </rect>
          )}
          {linksShown && r.links.map((l, i) => {
            const a = rowOf.get(l.from);
            const b = rowOf.get(l.to);
            if (a === undefined || b === undefined) return null;
            const p = list[a];
            const s = list[b];
            const x1 = x(l.type === 'SS' || l.type === 'SF' ? p.es : p.ef);
            const x2 = x(l.type === 'FF' || l.type === 'SF' ? s.ef : s.es);
            const y1 = HEADER + a * ROW + ROW / 2;
            const y2 = HEADER + b * ROW + ROW / 2;
            return <path key={i} d={`M${x1},${y1} H${x1 + 4} V${y2} H${x2}`} fill="none" stroke={l.origin === 'resource' ? 'var(--warn)' : 'var(--muted)'} strokeWidth={0.7} opacity={0.6} />;
          })}
          {list.map((o, i) => {
            const y = HEADER + i * ROW;
            const bx = x(o.es);
            const bw = Math.max(o.calendarDays * px, 0);
            const color = !o.resolved ? 'var(--warn)' : o.critical ? 'var(--critical)' : o.kind === 'curing' ? 'var(--curing)' : 'var(--accent)';
            return (
              <g key={o.id} style={{ cursor: 'pointer' }} onClick={() => openOp(o)}>
                <rect x={0} y={y} width={W} height={ROW} fill="transparent" />
                {o.ls > o.es && <rect x={x(o.ef)} y={y + ROW / 2 - 1} width={Math.max(0, (o.lf - o.ef) * px)} height={2} fill="var(--border)"><title>Резерв {o.totalFloat} раб. дн.</title></rect>}
                {bw > 0 ? (
                  <rect x={bx} y={y + 5} width={Math.max(bw, 1.5)} height={ROW - 10} rx={3} fill={color}>
                    <title>{`${o.name}\n${o.locationLabel}\n${formatRu(o.start)} — ${formatRu(o.finish)} (${o.calendarDays} кал. дн.)\nРезерв: ${o.totalFloat} раб. дн.`}</title>
                  </rect>
                ) : (
                  <path d={`M${bx},${y + 5} l5,6 l-5,6 l-5,-6 z`} fill={color}><title>{`${o.name} (веха) ${formatRu(o.start)}`}</title></path>
                )}
                <rect x={0} y={y} width={labelW - 4} height={ROW} fill="var(--surface)" />
                <text x={6} y={y + 15}>
                  {truncate(`${shortLoc(o.locationLabel)} · ${o.name}`, Math.floor(labelW / 6.2))}
                </text>
              </g>
            );
          })}
          <line x1={labelW - 4} x2={labelW - 4} y1={0} y2={H} stroke="var(--border)" />
          <text x={6} y={14} style={{ fontWeight: 600 }}>Операция</text>
          <text x={6} y={32} fill="var(--muted)" style={{ fontSize: 10 }}>{fromDayNum(start)} — {fromDayNum(end - 1)}</text>
        </svg>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>Тонкая линия после полосы — общий резерв. Связи показываются в масштабе «Дни» (до 200 строк). Нажмите на полосу для объяснения.</p>
    </div>
  );
}

function shortLoc(s: string) {
  const parts = s.split(' / ').slice(2);
  return parts.join(' ').replace('Этаж ', 'Эт.').replace('Захватка ', 'З').replace('Фундаментная плита', 'Фунд.') || 'Секция';
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
