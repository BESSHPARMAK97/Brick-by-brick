import { useEffect, type ReactNode } from 'react';
import type { DataStatus } from '../../engine/types';

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

export function NumberInput(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      aria-label={props.ariaLabel}
      value={props.value ?? ''}
      min={props.min}
      max={props.max}
      step={props.step ?? 'any'}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          if (props.allowEmpty) props.onChange(null);
          return;
        }
        const v = Number(raw);
        if (Number.isFinite(v)) props.onChange(v);
      }}
    />
  );
}

const STATUS: Record<DataStatus, { label: string; cls: string }> = {
  confirmed: { label: 'подтверждено', cls: 'ok' },
  project: { label: 'по проекту', cls: 'ok' },
  normative: { label: 'норматив', cls: 'accent' },
  assumption: { label: 'сценарий', cls: 'warn' },
  missing: { label: 'нет данных', cls: 'critical' },
};

export function StatusBadge({ status }: { status: DataStatus }) {
  const s = STATUS[status];
  return <span className={`badge ${s.cls}`} title={status === 'assumption' ? 'Сценарное значение — не норматив, требует подтверждения' : undefined}>{s.label}</span>;
}

export function Drawer(props: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    if (!props.open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={props.onClose} />
      <aside className="drawer" role="dialog" aria-label={props.title}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{props.title}</h2>
          <div className="spacer" />
          <button className="btn small" onClick={props.onClose} aria-label="Закрыть">✕</button>
        </div>
        {props.children}
      </aside>
    </>
  );
}

export function Kpi(props: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card kpi">
      <span className="label">{props.label}</span>
      <span className="value">{props.value}</span>
      {props.sub && <span className="sub">{props.sub}</span>}
    </div>
  );
}

export const CONFIDENCE_RU = { high: 'высокая', medium: 'средняя', low: 'низкая' } as const;
export const CONFIDENCE_CLS = { high: 'ok', medium: 'warn', low: 'critical' } as const;

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined) return '—';
  return (Math.round(x * 10 ** digits) / 10 ** digits).toLocaleString('ru-RU');
}

export const CAL_STATUS_RU: Record<string, string> = {
  confirmed: 'подтверждён',
  secondary: 'сверен по вторичным источникам',
  preliminary: 'предварительный',
  'rule-only': 'только постоянные праздники',
};
