import { describe, expect, it } from 'vitest';
import kz2026 from '../src/data/calendars/kz-2026.json';
import { KZ_HOLIDAYS } from '../src/engine/calendar/holidays';
import { WorkCalendar } from '../src/engine/calendar/workCalendar';
import { fromDayNum, toDayNum, weekday } from '../src/engine/dates';
import { cal } from './helpers';

function nonWorkingWeekdays(c: WorkCalendar, year: number, rest: number[] = [0, 6]): string[] {
  const out: string[] = [];
  for (let d = toDayNum(`${year}-01-01`); d <= toDayNum(`${year}-12-31`); d++) {
    const i = c.info(d);
    if (i.capacity === 0 && !rest.includes(weekday(d))) out.push(fromDayNum(d));
  }
  return out;
}

describe('Calendar Engine — Казахстан', () => {
  it('2026, пятидневка: совпадает с опубликованным производственным календарём', () => {
    const c = new WorkCalendar('main', 'Основной', cal('5/2'));
    expect(nonWorkingWeekdays(c, 2026)).toEqual(kz2026.expected['5/2']);
  });

  it('2026, шестидневка: переносы только с воскресений (8.03→9.03, 22.03→24.03, 25.10→26.10)', () => {
    const c = new WorkCalendar('main', 'Основной', cal('6/1'));
    const days = nonWorkingWeekdays(c, 2026, [0]);
    expect(days).toContain('2026-03-09');
    expect(days).toContain('2026-03-24');
    expect(days).toContain('2026-10-26');
    // 21.03 (сб) — сам праздник, перенос не порождает → 25.03 рабочий
    expect(days).toContain('2026-03-21');
    expect(days).not.toContain('2026-03-25');
    // 9.05 (сб) — праздник; 11.05 при 6/1 рабочий
    expect(days).toContain('2026-05-09');
    expect(days).not.toContain('2026-05-11');
  });

  it('30 августа 2026 не праздник (перенос Дня Конституции), 15 марта 2027 — праздник', () => {
    const c = new WorkCalendar('main', 'Основной', cal('5/2'));
    expect(c.info(toDayNum('2026-08-31')).capacity).toBe(1);
    expect(c.info(toDayNum('2027-03-15')).type).toBe('holiday');
  });

  it('религиозные праздники не переносятся: 7.01.2029 (вс) не даёт переноса', () => {
    const c = new WorkCalendar('main', 'Основной', cal('5/2'));
    expect(c.info(toDayNum('2029-01-08')).capacity).toBe(1);
  });

  it('статусы данных: 2026 — вторичный источник, 2027 — предварительно, 2030 — только правила', () => {
    expect(KZ_HOLIDAYS.yearInfo(2026).status).toBe('secondary');
    expect(KZ_HOLIDAYS.yearInfo(2027).status).toBe('preliminary');
    expect(KZ_HOLIDAYS.yearInfo(2030).status).toBe('rule-only');
  });

  it('ручные исключения и предпраздничное сокращение', () => {
    const c = new WorkCalendar('m', 'm', cal('5/2', {
      extraWorking: ['2026-03-21'], extraNonWorking: ['2026-03-02'], preHolidayShorteningHours: 1,
    }));
    expect(c.info(toDayNum('2026-03-21')).capacity).toBe(1);
    expect(c.info(toDayNum('2026-03-02')).capacity).toBe(0);
    expect(c.info(toDayNum('2026-12-15')).capacity).toBeCloseTo(7 / 8);
  });

  it('режим 7/0 без праздников — все дни рабочие', () => {
    const c = new WorkCalendar('m', 'm', cal('7/0', { observeHolidays: false, shiftsPerDay: 2 }));
    expect(c.capacity(toDayNum('2026-01-01'))).toBe(2);
  });
});
