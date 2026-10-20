/**
 * Climate Engine.
 *
 * Три независимых слоя:
 *  1. Климатическая статистика (нормы 1991–2020) — для долгосрочного планирования.
 *     Среднесуточная температура дня интерполируется линейно между серединами месяцев.
 *     Это ОЖИДАЕМОЕ значение, а не прогноз конкретного дня.
 *  2. Оперативный прогноз (снимок, сохранённый во входных данных) — заменяет статистику
 *     на даты прогноза. Снимок хранится во входных данных, поэтому расчёт воспроизводим.
 *  3. Технологические ограничения операций (minAirTemp, ветер) — задаются в каталоге работ.
 */
import astana from '../../data/climate/astana.json';
import { dayOfMonth, daysInMonth, makeDay, monthOf, toDayNum, yearOf, type DayNum } from '../dates';
import type { ForecastDay, ForecastSnapshot, StrongWindInput } from '../types';

export interface MonthlyNormal {
  tMax: number;
  tMean: number;
  tMin: number;
  precipMm: number;
}

export interface ClimateNormals {
  city: string;
  cityName: string;
  lat: number;
  lon: number;
  period: string;
  source: string;
  status: string;
  note: string;
  monthly: MonthlyNormal[];
  strongWindDays: { status: string; note: string; values: (number | null)[] };
}

export interface DayWeather {
  tMean: number;
  tMin: number;
  tMax: number;
  windMaxMs: number | null;
  source: 'climate' | 'forecast';
}

export const ASTANA_NORMALS = astana as ClimateNormals;

export class ClimateEngine {
  private readonly forecast = new Map<DayNum, ForecastDay>();
  private readonly cache = new Map<DayNum, DayWeather>();

  constructor(
    readonly normals: ClimateNormals,
    forecast: ForecastSnapshot | null,
    readonly strongWind: StrongWindInput | null,
  ) {
    for (const f of forecast?.days ?? []) this.forecast.set(toDayNum(f.date), f);
  }

  get hasForecast(): boolean {
    return this.forecast.size > 0;
  }

  /** Ожидаемая погода дня: прогноз (если есть) или климатическая норма. */
  weather(d: DayNum): DayWeather {
    const c = this.cache.get(d);
    if (c) return c;
    const f = this.forecast.get(d);
    let w: DayWeather;
    if (f) {
      w = { tMean: (f.tMin + f.tMax) / 2, tMin: f.tMin, tMax: f.tMax, windMaxMs: f.windMaxMs, source: 'forecast' };
    } else {
      w = {
        tMean: this.interp(d, 'tMean'),
        tMin: this.interp(d, 'tMin'),
        tMax: this.interp(d, 'tMax'),
        windMaxMs: null,
        source: 'climate',
      };
    }
    this.cache.set(d, w);
    return w;
  }

  /** Линейная интерполяция между серединами месяцев. */
  private interp(d: DayNum, key: 'tMean' | 'tMin' | 'tMax'): number {
    const y = yearOf(d);
    const m = monthOf(d);
    const mid = (yy: number, mm: number) => makeDay(yy, mm, 1) + (daysInMonth(yy, mm) - 1) / 2;
    const thisMid = mid(y, m);
    let m2: number, y2: number;
    if (d >= thisMid) {
      m2 = (m + 1) % 12;
      y2 = m === 11 ? y + 1 : y;
    } else {
      m2 = (m + 11) % 12;
      y2 = m === 0 ? y - 1 : y;
    }
    const otherMid = mid(y2, m2);
    const a = this.normals.monthly[m][key];
    const b = this.normals.monthly[m2][key];
    const w = (d - thisMid) / (otherMid - thisMid);
    return Math.round((a + (b - a) * w) * 10) / 10;
  }

  /**
   * Зимние условия бетонирования (СП 70.13330.2012, п. 5.11.1; СП РК 5.03-107-2013):
   * ожидаемая среднесуточная температура наружного воздуха ниже +5 °C
   * и минимальная суточная температура ниже 0 °C.
   */
  isWinterConcreting(d: DayNum): boolean {
    const w = this.weather(d);
    return w.tMean < 5 && w.tMin < 0;
  }

  /** Ожидаемое число дней с ветром выше ограничения крана в месяце (если пользователь задал данные). */
  strongWindDaysInMonth(d: DayNum): number | null {
    const v = this.strongWind?.values[monthOf(d)];
    return v === undefined ? null : v;
  }

  /** Доля «ветреных» дней в месяце даты d (для климатического резерва). */
  strongWindShare(d: DayNum): number | null {
    const n = this.strongWindDaysInMonth(d);
    if (n === null) return null;
    return Math.min(1, n / daysInMonth(yearOf(d), monthOf(d)));
  }
}

export function dayLabelSource(w: DayWeather): string {
  return w.source === 'forecast' ? 'прогноз' : 'климатическая норма';
}

/** Используется в UI для подписи дня (например, «15-е»). */
export function dayOfMonthLabel(d: DayNum): string {
  return `${dayOfMonth(d)}`;
}
