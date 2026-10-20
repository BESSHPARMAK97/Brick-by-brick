/**
 * Модель набора прочности бетона.
 *
 * Не используется универсальная длительность «выдерживания». Продолжительность
 * технологического перерыва рассчитывается из:
 *  - требуемой прочности (по проекту / СП 70.13330.2012 табл. 5.11 / СП РК 5.03-107-2013);
 *  - класса бетона и типа цемента (коэффициент s);
 *  - температуры бетона в каждые сутки (климат/прогноз или температура прогрева зимой).
 *
 * Формулы (EN 1992-1-1:2004, принят в РК как СП РК EN 1992-1-1):
 *  - эквивалентный возраст (Приложение B, ф. B.10):
 *        t_T = Σ exp(−(4000 / (273 + T_i) − 13.65)) · Δt_i
 *  - относительная прочность (п. 3.1.2, ф. 3.2):
 *        β_cc(t) = exp( s · (1 − √(28 / t_T)) )
 *
 * Ограничения модели: β_cc — отношение к 28-суточной прочности при +20 °C, принимается
 * равным доле проектной прочности. При T ≤ 0 °C набор прочности не учитывается
 * (замерзание воды недопустимо — требуются зимние мероприятия). Для договорных
 * сроков калибровать по данным лаборатории (кривая набора прочности для конкретного состава).
 */

export interface CuringRequirement {
  kind: 'percent' | 'mpa';
  value: number;
  label: string;
}

export interface CuringInput {
  requirement: CuringRequirement;
  concreteClassMPa: number;
  cementS: number;
  /** Температура бетона по суткам, начиная с первых суток выдерживания. */
  tempForDay: (i: number) => number;
  minDays?: number;
  maxDays?: number;
}

export interface CuringResult {
  days: number;
  requiredFraction: number;
  reachedFraction: number;
  equivalentAgeDays: number;
  temps: number[];
  capped: boolean;
}

export function ageIncrement(tempC: number): number {
  if (tempC <= 0) return 0;
  return Math.exp(-(4000 / (273 + tempC) - 13.65));
}

export function relativeStrength(equivalentAgeDays: number, s: number): number {
  if (equivalentAgeDays <= 0) return 0;
  return Math.exp(s * (1 - Math.sqrt(28 / equivalentAgeDays)));
}

export function requiredFraction(req: CuringRequirement, classMPa: number): number {
  return req.kind === 'percent' ? req.value / 100 : req.value / classMPa;
}

export function computeCuring(inp: CuringInput): CuringResult {
  const need = requiredFraction(inp.requirement, inp.concreteClassMPa);
  const minDays = inp.minDays ?? 1;
  const maxDays = inp.maxDays ?? 90;
  let age = 0;
  const temps: number[] = [];
  for (let i = 0; i < maxDays; i++) {
    const t = inp.tempForDay(i);
    temps.push(t);
    age += ageIncrement(t);
    const r = relativeStrength(age, inp.cementS);
    if (i + 1 >= minDays && r >= need - 1e-9) {
      return { days: i + 1, requiredFraction: need, reachedFraction: r, equivalentAgeDays: age, temps, capped: false };
    }
  }
  return {
    days: maxDays,
    requiredFraction: need,
    reachedFraction: relativeStrength(age, inp.cementS),
    equivalentAgeDays: age,
    temps,
    capped: true,
  };
}

/** Распалубочная прочность перекрытий по СП 70.13330.2012, табл. 5.11 (по пролёту). */
export function slabStripPercentBySpan(spanM: number): number {
  return spanM <= 6 ? 70 : 80;
}
