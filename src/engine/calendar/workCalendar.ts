/**
 * Рабочий календарь: режим недели, смены, праздники, переносы, ручные исключения.
 * Ёмкость дня выражена в сменах (0 … shiftsPerDay, с учётом сокращённых дней).
 */
import { toDayNum, weekday, yearOf, type DayNum } from '../dates';
import type { CalendarSettings } from '../types';
import { HolidaySource, KZ_HOLIDAYS } from './holidays';

export type DayType = 'work' | 'weekend' | 'holiday' | 'transfer' | 'extra-off' | 'extra-work' | 'shortened';

export interface DayInfo {
  capacity: number;
  type: DayType;
  label: string;
}

export function restWeekdaysFor(settings: CalendarSettings): number[] {
  switch (settings.regime) {
    case '5/2':
      return [6, 0];
    case '6/1':
      return [0];
    case '7/0':
      return [];
    case 'custom':
      return [...(settings.restWeekdays ?? [0])];
  }
}

export interface Calendar {
  readonly id: string;
  readonly name: string;
  readonly continuous: boolean;
  info(d: DayNum): DayInfo;
  capacity(d: DayNum): number;
}

export class WorkCalendar implements Calendar {
  readonly continuous = false;
  private readonly rest: Set<number>;
  private readonly restList: number[];
  private readonly extraOff: Set<DayNum>;
  private readonly extraWork: Set<DayNum>;
  private readonly cache = new Map<DayNum, DayInfo>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly settings: CalendarSettings,
    private readonly holidays: HolidaySource = KZ_HOLIDAYS,
  ) {
    this.restList = restWeekdaysFor(settings);
    this.rest = new Set(this.restList);
    this.extraOff = new Set(settings.extraNonWorking.map(toDayNum));
    this.extraWork = new Set(settings.extraWorking.map(toDayNum));
  }

  private special(d: DayNum) {
    if (!this.settings.observeHolidays) return undefined;
    return this.holidays.forYear(yearOf(d), this.restList).get(d);
  }

  info(d: DayNum): DayInfo {
    const c = this.cache.get(d);
    if (c) return c;
    const res = this.compute(d);
    this.cache.set(d, res);
    return res;
  }

  private compute(d: DayNum): DayInfo {
    const full = this.settings.shiftsPerDay;
    if (this.extraWork.has(d)) return { capacity: full, type: 'extra-work', label: 'Рабочий день (решение подрядчика)' };
    if (this.extraOff.has(d)) return { capacity: 0, type: 'extra-off', label: 'Нерабочий день (решение подрядчика)' };
    const sp = this.special(d);
    if (sp?.type === 'decree-work') return { capacity: full, type: 'work', label: sp.label };
    if (sp?.type === 'holiday') return { capacity: 0, type: 'holiday', label: sp.label };
    if (sp?.type === 'transfer' || sp?.type === 'decree-off') return { capacity: 0, type: 'transfer', label: sp.label };
    if (this.rest.has(weekday(d))) return { capacity: 0, type: 'weekend', label: 'Выходной день' };
    const sh = this.settings.preHolidayShorteningHours;
    if (sh > 0 && this.settings.shiftHours > 0) {
      const next = this.special(d + 1);
      if (next?.type === 'holiday') {
        const cap = Math.max(0, full - Math.min(sh, this.settings.shiftHours) / this.settings.shiftHours);
        return { capacity: cap, type: 'shortened', label: `Предпраздничный день (−${sh} ч)` };
      }
    }
    return { capacity: full, type: 'work', label: 'Рабочий день' };
  }

  capacity(d: DayNum): number {
    return this.info(d).capacity;
  }
}

/** Непрерывное время (технологические перерывы: набор прочности идёт и в выходные). */
export class ContinuousCalendar implements Calendar {
  readonly id = 'continuous';
  readonly name = 'Непрерывное время (24/7)';
  readonly continuous = true;
  info(): DayInfo {
    return { capacity: 1, type: 'work', label: 'Календарные сутки' };
  }
  capacity(): number {
    return 1;
  }
}

export const CONTINUOUS = new ContinuousCalendar();
