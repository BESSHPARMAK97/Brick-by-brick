/**
 * Источник праздничных дней Республики Казахстан.
 *
 * Праздники не зашиты в код: правила лежат в src/data/calendars/kz-rules.json,
 * годовые данные (Курбан айт, постановления о переносе) — в kz-YYYY.json
 * со статусом достоверности и датой обновления.
 */
import rules from '../../data/calendars/kz-rules.json';
import y2026 from '../../data/calendars/kz-2026.json';
import y2027 from '../../data/calendars/kz-2027.json';
import y2028 from '../../data/calendars/kz-2028.json';
import { makeDay, toDayNum, weekday, type DayNum, type ISODate } from '../dates';

export type CalendarDataStatus = 'confirmed' | 'secondary' | 'preliminary' | 'rule-only';

export interface FixedHolidayRule {
  month: number;
  day: number;
  name: string;
  transferable: boolean;
  sinceYear?: number;
  untilYear?: number;
  note?: string;
}

export interface DecreeTransfer {
  /** Выходной (суббота/воскресенье), который становится рабочим днём */
  workingDay: ISODate;
  /** День, который становится выходным */
  dayOff: ISODate;
  regimes: string[]; // ['5/2'] и т.п.
  act: string;
}

export interface YearCalendarData {
  jurisdiction: string;
  year: number;
  status: CalendarDataStatus;
  updatedAt: string;
  sources: string[];
  statusNote?: string;
  religiousHolidays: { date: ISODate; name: string; status: string }[];
  decreeTransfers: DecreeTransfer[];
}

export interface HolidayRules {
  jurisdiction: string;
  legalBasis: string;
  updatedAt: string;
  status: string;
  statusNote: string;
  transferRule: string;
  fixedHolidays: FixedHolidayRule[];
}

export type SpecialDayType = 'holiday' | 'transfer' | 'decree-off' | 'decree-work';

export interface SpecialDay {
  type: SpecialDayType;
  label: string;
}

export interface YearInfo {
  year: number;
  status: CalendarDataStatus;
  source: string;
  note?: string;
}

export class HolidaySource {
  private readonly years = new Map<number, YearCalendarData>();
  private readonly cache = new Map<string, Map<DayNum, SpecialDay>>();

  constructor(
    readonly rules: HolidayRules,
    yearData: YearCalendarData[],
  ) {
    for (const y of yearData) this.years.set(y.year, y);
  }

  yearInfo(year: number): YearInfo {
    const y = this.years.get(year);
    if (!y) {
      return {
        year,
        status: 'rule-only',
        source: 'Только постоянные праздники по Закону о праздниках; данных о Курбан айте и переносах нет',
        note: 'Курбан айт и постановления о переносе за этот год не учтены',
      };
    }
    return { year, status: y.status, source: y.sources.join('; '), note: y.statusNote };
  }

  /**
   * Праздники и переносы за год для заданного набора дней отдыха.
   * Перенос считается для конкретного режима: при 6/1 суббота рабочая,
   * поэтому праздник в субботу не порождает переноса.
   */
  forYear(year: number, restWeekdays: number[]): Map<DayNum, SpecialDay> {
    const key = `${year}|${[...restWeekdays].sort().join(',')}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = new Map<DayNum, SpecialDay>();
    const holidays: { day: DayNum; name: string; transferable: boolean }[] = [];
    for (const h of this.rules.fixedHolidays) {
      if (h.sinceYear !== undefined && year < h.sinceYear) continue;
      if (h.untilYear !== undefined && year > h.untilYear) continue;
      holidays.push({ day: makeDay(year, h.month - 1, h.day), name: h.name, transferable: h.transferable });
    }
    const data = this.years.get(year);
    for (const r of data?.religiousHolidays ?? []) {
      holidays.push({ day: toDayNum(r.date), name: r.name, transferable: false });
    }
    holidays.sort((a, b) => a.day - b.day);
    for (const h of holidays) result.set(h.day, { type: 'holiday', label: h.name });

    const rest = new Set(restWeekdays);
    for (const h of holidays) {
      if (!h.transferable || !rest.has(weekday(h.day))) continue;
      let d = h.day + 1;
      while (rest.has(weekday(d)) || result.has(d)) d++;
      result.set(d, { type: 'transfer', label: `Перенос выходного: ${h.name}` });
    }

    const regimeKey = restWeekdays.length === 2 ? '5/2' : restWeekdays.length === 1 ? '6/1' : 'other';
    for (const t of data?.decreeTransfers ?? []) {
      if (!t.regimes.includes(regimeKey)) continue;
      result.set(toDayNum(t.dayOff), { type: 'decree-off', label: `Перенос по постановлению: ${t.act}` });
      result.set(toDayNum(t.workingDay), { type: 'decree-work', label: `Рабочий день по постановлению: ${t.act}` });
    }

    this.cache.set(key, result);
    return result;
  }
}

export const KZ_HOLIDAYS = new HolidaySource(rules as HolidayRules, [
  y2026 as YearCalendarData,
  y2027 as YearCalendarData,
  y2028 as YearCalendarData,
]);
