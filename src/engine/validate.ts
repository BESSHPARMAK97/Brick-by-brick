import { toDayNum } from './dates';
import type { CalendarSettings, ProjectInput } from './types';

/** Проверка исходных данных. Возвращает список ошибок (пустой — данные корректны). */
export function validateInput(input: ProjectInput): string[] {
  const errors: string[] = [];
  const dateOk = (d: string, label: string) => {
    try {
      toDayNum(d);
    } catch {
      errors.push(`${label}: некорректная дата «${d}»`);
    }
  };
  if (input.objectType !== 'residential') errors.push('Поддерживается тип объекта: многоквартирный ЖК');
  if (input.city !== 'astana') errors.push('Климатические данные загружены только для Астаны');
  dateOk(input.startDate, 'Дата начала');
  if (input.deadline) dateOk(input.deadline, 'Директивный срок');
  if (input.workGroups.length === 0) errors.push('Не выбран ни один вид работ');
  if (input.buildings.length === 0 || input.buildings.every((b) => b.sections.length === 0)) errors.push('Не задано ни одной секции');
  const ids = new Set<string>();
  for (const b of input.buildings) {
    for (const s of b.sections) {
      if (ids.has(s.id)) errors.push(`Повторяющийся идентификатор секции «${s.id}»`);
      ids.add(s.id);
      if (!Number.isInteger(s.floors) || s.floors < 1 || s.floors > 100) errors.push(`${s.name}: число этажей должно быть от 1 до 100`);
      if (!Number.isInteger(s.basementFloors) || s.basementFloors < 0 || s.basementFloors > 5) errors.push(`${s.name}: подземных этажей 0…5`);
      if (!Number.isInteger(s.zonesPerFloor) || s.zonesPerFloor < 1 || s.zonesPerFloor > 8) errors.push(`${s.name}: захваток на этаж 1…8`);
      if (!(s.floorArea > 0)) errors.push(`${s.name}: площадь этажа должна быть больше 0`);
      if (!(s.slabSpanM > 0)) errors.push(`${s.name}: пролёт перекрытия должен быть больше 0`);
    }
  }
  const checkCal = (c: CalendarSettings, label: string) => {
    if (!(c.shiftsPerDay >= 1 && c.shiftsPerDay <= 3)) errors.push(`${label}: смен в сутки 1…3`);
    if (!(c.shiftHours > 0 && c.shiftHours <= 12)) errors.push(`${label}: продолжительность смены 1…12 ч`);
    if (c.regime === 'custom' && (c.restWeekdays ?? []).length >= 7) errors.push(`${label}: в неделе нет рабочих дней`);
    c.extraWorking.forEach((d) => dateOk(d, `${label}: рабочий день`));
    c.extraNonWorking.forEach((d) => dateOk(d, `${label}: нерабочий день`));
  };
  checkCal(input.calendar, 'Основной календарь');
  for (const [g, c] of Object.entries(input.groupCalendars)) if (c) checkCal(c, `Календарь «${g}»`);
  const r = input.resources;
  for (const g of input.workGroups) {
    if (!((r.crews[g] ?? 0) >= 1)) errors.push(`Не задано ни одной бригады для вида работ «${g}»`);
  }
  if (input.workGroups.includes('monolith')) {
    if (!(r.cranesPerSection >= 0.1)) errors.push('Для монолитных работ нужен хотя бы один кран на секцию');
    if (!(r.pumps >= 1)) errors.push('Для бетонирования нужен хотя бы один бетононасос');
    if (!(r.concreteSupplyM3PerDay > 0)) errors.push('Поставка бетона должна быть больше 0 м³/сут');
    if (!(r.slabFormworkSets >= 1) || !(r.wallFormworkSets >= 1)) errors.push('Нужен хотя бы один комплект опалубки стен и перекрытий');
  }
  if (!(r.maxTradesPerFloor >= 1)) errors.push('Фронт работ на этаже: минимум 1 вид работ');
  for (const u of r.unavailability) {
    dateOk(u.from, 'Недоступность ресурса (с)');
    dateOk(u.to, 'Недоступность ресурса (по)');
  }
  for (const c of input.constraints) dateOk(c.notBefore, `Ограничение «${c.templateKey}»`);
  const t = input.technology;
  if (!(t.concreteClassMPa >= 7.5 && t.concreteClassMPa <= 100)) errors.push('Класс бетона: 7,5…100 МПа');
  if (!(t.cementS >= 0.1 && t.cementS <= 0.5)) errors.push('Коэффициент s цемента: 0,1…0,5');
  if (t.slabStripPercent !== null && !(t.slabStripPercent > 0 && t.slabStripPercent <= 100)) errors.push('Распалубочная прочность перекрытий: 1…100 %');
  if (!(t.winterCuringTempC > 0 && t.winterCuringTempC <= 60)) errors.push('Температура прогрева бетона: +1…+60 °C');
  if (!(t.masonryLagFloors >= 0)) errors.push('Отставание кладки не может быть отрицательным');
  if (!(t.projectBufferDays >= 0)) errors.push('Резерв на риски не может быть отрицательным');
  return errors;
}
