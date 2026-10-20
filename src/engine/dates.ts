/**
 * Работа с датами без часовых поясов.
 *
 * Внутри движка дата — это целое число дней от 1970-01-01 (UTC), «DayNum».
 * Момент времени — граница суток: t = d означает «начало дня d».
 * Операция, выполняемая в дни d..e, имеет start = d, finish = e + 1.
 * Это исключает ошибки «плюс/минус один день» и делает расчёт детерминированным.
 */

export type ISODate = string; // 'YYYY-MM-DD'
export type DayNum = number;

const MS_PER_DAY = 86_400_000;

export function toDayNum(iso: ISODate): DayNum {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Некорректная дата: "${iso}" (ожидается ГГГГ-ММ-ДД)`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = Math.round(ms / MS_PER_DAY);
  if (fromDayNum(d) !== iso) throw new Error(`Несуществующая дата: "${iso}"`);
  return d;
}

export function fromDayNum(d: DayNum): ISODate {
  const dt = new Date(d * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const da = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** 0 = воскресенье … 6 = суббота (как Date.getUTCDay). */
export function weekday(d: DayNum): number {
  return (((d + 4) % 7) + 7) % 7; // 1970-01-01 — четверг
}

export function yearOf(d: DayNum): number {
  return new Date(d * MS_PER_DAY).getUTCFullYear();
}

/** Месяц 0..11 */
export function monthOf(d: DayNum): number {
  return new Date(d * MS_PER_DAY).getUTCMonth();
}

export function dayOfMonth(d: DayNum): number {
  return new Date(d * MS_PER_DAY).getUTCDate();
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function makeDay(year: number, month0: number, day: number): DayNum {
  return Math.round(Date.UTC(year, month0, day) / MS_PER_DAY);
}

/** Формат ДД.ММ.ГГГГ для интерфейса и объяснений. */
export function formatRu(d: DayNum | ISODate): string {
  const iso = typeof d === 'number' ? fromDayNum(d) : d;
  const [y, m, dd] = iso.split('-');
  return `${dd}.${m}.${y}`;
}

export const WEEKDAY_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const MONTH_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
