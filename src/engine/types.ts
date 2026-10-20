import type { ISODate } from './dates';

/* ───────────────────────── Статус достоверности данных ───────────────────────── */

/**
 * confirmed   — подтверждено пользователем (фактическая выработка, решение по проекту);
 * project     — взято из проектной документации / ВОР;
 * normative   — ссылка на нормативный документ (СП, СН РК, паспорт оборудования);
 * assumption  — сценарный параметр, требует подтверждения (НЕ норматив);
 * missing     — данных нет.
 */
export type DataStatus = 'confirmed' | 'project' | 'normative' | 'assumption' | 'missing';

export interface Param<T = number> {
  value: T | null;
  unit?: string;
  status: DataStatus;
  source: string;
  note?: string;
}

export const RELIABLE_STATUSES: DataStatus[] = ['confirmed', 'project', 'normative'];

/* ───────────────────────── Календарь ───────────────────────── */

export type CalendarRegime = '5/2' | '6/1' | '7/0' | 'custom';

export interface CalendarSettings {
  regime: CalendarRegime;
  /** Для custom: дни отдыха (0 = вс … 6 = сб). */
  restWeekdays?: number[];
  shiftsPerDay: number;
  shiftHours: number;
  /** Соблюдать праздничные дни РК (для непрерывного режима можно отключить по приказу). */
  observeHolidays: boolean;
  /** Сокращение рабочего дня накануне праздника, ч. По умолчанию 0 — применимость проверить по ТК РК/колдоговору. */
  preHolidayShorteningHours: number;
  extraNonWorking: ISODate[];
  extraWorking: ISODate[];
}

/* ───────────────────────── Работы ───────────────────────── */

export type WorkGroupId =
  | 'monolith'
  | 'masonry'
  | 'facade'
  | 'roofing'
  | 'waterproofing'
  | 'mep'
  | 'plaster_screed'
  | 'tiling'
  | 'painting'
  | 'flooring'
  | 'landscaping';

export type ResourceKind = 'crane' | 'pump' | 'concrete' | 'slabFormwork' | 'wallFormwork' | 'front';

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Lag {
  value: number;
  unit: 'work' | 'calendar';
}

/* ───────────────────────── Исходные данные проекта ───────────────────────── */

export interface SectionInput {
  id: string;
  name: string;
  floors: number;
  basementFloors: number;
  zonesPerFloor: number;
  /** Площадь типового этажа (в осях), м² */
  floorArea: number;
  /** Пролёт перекрытий, м — влияет на распалубочную прочность (СП 70.13330, табл. 5.11) */
  slabSpanM: number;
}

export interface BuildingInput {
  id: string;
  name: string;
  sections: SectionInput[];
}

export interface ResourceUnavailability {
  kind: ResourceKind | 'crew';
  /** Для crew — группа работ; для крана/опалубки — id секции (пусто = все). */
  target?: string;
  from: ISODate;
  to: ISODate;
  reason: string;
}

export interface ResourceSettings {
  crews: Record<WorkGroupId, number>;
  /** Сколько бригад из пула назначается на одну операцию (не больше фронта работ). */
  crewsPerOperation: Record<WorkGroupId, number>;
  cranesPerSection: number;
  pumps: number;
  /** Поставка бетона, м³/сутки (завод/договор). */
  concreteSupplyM3PerDay: number;
  slabFormworkSets: number;
  wallFormworkSets: number;
  /** Ограничение числа одновременных видов отделочных работ на одном этаже (фронт). */
  maxTradesPerFloor: number;
  unavailability: ResourceUnavailability[];
}

export interface TechnologySettings {
  /** Класс бетона по прочности, МПа (B25 → 25) */
  concreteClassMPa: number;
  /** Коэффициент s по EN 1992-1-1 (3.2): 0.20 — CEM 42.5R/52.5; 0.25 — CEM 32.5R/42.5N; 0.38 — CEM 32.5N */
  cementS: number;
  /** Прочность для распалубки вертикальных конструкций, МПа */
  verticalStripMPa: number;
  /** Прочность для распалубки перекрытий, % от проектной; null — по пролёту (70 % / 80 %) */
  slabStripPercent: number | null;
  /** Прочность, допускающая движение людей и установку опалубки выше, МПа */
  walkStrengthMPa: number;
  /** Температура бетона при прогреве/термосе в зимних условиях, °C */
  winterCuringTempC: number;
  /** Зимние мероприятия уже учтены в выработке — не добавлять отдельно */
  winterMeasuresIncludedInRates: boolean;
  /** Отставание кладки от монолита, этажей */
  masonryLagFloors: number;
  facadeType: 'wet' | 'ventilated';
  /** Временное отопление внутри здания (снимает температурный запрет на внутренние «мокрые» процессы) */
  temporaryHeating: boolean;
  /** Тепляки/укрытия для фасада и кровли (снимает температурный запрет) */
  enclosureForExternalWorks: boolean;
  /** Резерв на риски проекта (буфер), рабочих дней */
  projectBufferDays: number;
}

/** Переопределения параметров шаблона операции пользователем. */
export interface OperationOverride {
  productivity?: number | null;
  productivityStatus?: DataStatus;
  durationShifts?: number | null;
  durationStatus?: DataStatus;
  crewSize?: number;
  minAirTemp?: number | null;
  /** Количество на захватку, если задано пользователем (из ВОР) */
  quantityPerZone?: number | null;
  quantityStatus?: DataStatus;
}

export interface DateConstraint {
  /** Ключ шаблона операции (например, 'facade.windows') */
  templateKey: string;
  /** Опционально: id секции */
  sectionId?: string;
  notBefore: ISODate;
  reason: string;
}

export interface ForecastDay {
  date: ISODate;
  tMin: number;
  tMax: number;
  windMaxMs: number;
  precipMm: number;
}

export interface ForecastSnapshot {
  source: string;
  fetchedAt: string;
  days: ForecastDay[];
}

export interface StrongWindInput {
  /** Ожидаемое число дней в месяце с ветром выше паспортного ограничения крана (по данным пользователя) */
  values: (number | null)[];
  source: string;
}

export interface ProjectInput {
  schemaVersion: 1;
  name: string;
  objectType: 'residential';
  city: 'astana';
  startDate: ISODate;
  workGroups: WorkGroupId[];
  buildings: BuildingInput[];
  calendar: CalendarSettings;
  groupCalendars: Partial<Record<WorkGroupId, CalendarSettings>>;
  resources: ResourceSettings;
  technology: TechnologySettings;
  overrides: Record<string, OperationOverride>;
  constraints: DateConstraint[];
  forecast: ForecastSnapshot | null;
  strongWind: StrongWindInput | null;
  /** Директивный срок — для расчёта отрицательных резервов */
  deadline: ISODate | null;
  /** Ограничение крана по ветру, м/с (паспорт крана) */
  craneWindLimitMs: number;
  /** Ключи параметров ресурсов/технологии, подтверждённых пользователем (например, 'resources.crews.monolith') */
  confirmedParams: string[];
}

/* ───────────────────────── Результат расчёта ───────────────────────── */

export type OpKind = 'work' | 'curing' | 'inspection' | 'winterPrep' | 'milestone' | 'buffer';

export interface DayClassCount {
  working: number;
  weekend: number;
  holiday: number;
  transfer: number;
  climate: number;
  extra: number;
}

export interface StrengthTrace {
  requiredLabel: string;
  requiredFraction: number;
  reachedFraction: number;
  days: number;
  winter: boolean;
  temps: number[];
  equivalentAgeDays: number;
  capped: boolean;
}

export interface ExplanationFactor {
  kind:
    | 'duration'
    | 'calendar'
    | 'predecessor'
    | 'resource'
    | 'constraint'
    | 'climate'
    | 'winter'
    | 'strength'
    | 'float'
    | 'source'
    | 'warning';
  text: string;
}

export interface ScheduledOperation {
  id: string;
  templateKey: string;
  name: string;
  group: WorkGroupId;
  category: string;
  kind: OpKind;
  buildingId: string;
  sectionId: string;
  floor: number | null; // 0 — подвал/фундамент (−1 — фундаментная плита), null — на секцию целиком
  zone: number | null;
  locationLabel: string;
  unit: string;
  quantity: number | null;
  quantityStatus: DataStatus;
  productivity: number | null;
  productivityStatus: DataStatus;
  productivitySource: string;
  crews: number;
  crewSize: number;
  workShifts: number; // смен бригады (трудоёмкость в бригадо-сменах / число бригад)
  resolved: boolean; // false — длительность не рассчитана из-за отсутствия данных
  calendarId: string;
  /** Время в DayNum-границах (см. dates.ts) */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  start: ISODate;
  finish: ISODate; // последний день работы (для вех = дата вехи)
  calendarDays: number;
  workingDays: number;
  totalFloat: number; // рабочих дней календаря операции
  freeFloat: number;
  critical: boolean;
  waitDays: number; // организационный простой (ресурсы/поставки) в календарных днях
  dayClasses: DayClassCount;
  strength?: StrengthTrace;
  winterApplied: boolean;
  explanation: ExplanationFactor[];
  warnings: string[];
  resourceDemands: { resourceId: string; units: number }[];
  qualityControl: string[];
}

export interface ResolvedLink {
  from: string;
  to: string;
  type: LinkType;
  lag: Lag;
  origin: 'technology' | 'cross-group' | 'turnover' | 'resource' | 'next-floor';
  note?: string;
  resourceId?: string;
}

export interface ResourceProfile {
  id: string;
  name: string;
  kind: ResourceKind | 'crew';
  capacity: number;
  unit: string;
  /** usage по дням от projectStart */
  usage: { day: ISODate; used: number; capacity: number }[];
  peak: number;
  conflictsResolved: number;
}

export type WarningSeverity = 'info' | 'warning' | 'error';

export interface EngineWarning {
  code: string;
  severity: WarningSeverity;
  text: string;
  opIds?: string[];
}

export interface AssumptionRecord {
  key: string;
  label: string;
  value: string;
  status: DataStatus;
  source: string;
  affectsCritical: boolean;
  impactShifts: number;
}

export interface ScheduleResult {
  meta: {
    engineVersion: string;
    rulesetVersion: string;
    inputHash: string;
    resultHash: string;
    calendarData: { year: number; status: string; source: string }[];
    climateSource: string;
  };
  projectStart: ISODate;
  projectFinish: ISODate; // без буфера
  projectFinishWithBuffer: ISODate;
  durationCalendarDays: number;
  operations: ScheduledOperation[];
  links: ResolvedLink[];
  /** Операции с нулевым общим резервом (хронологически) */
  criticalPath: string[];
  /** Ведущая цепочка от окончания проекта назад по определяющим связям */
  drivingPath: string[];
  resources: ResourceProfile[];
  warnings: EngineWarning[];
  assumptions: AssumptionRecord[];
  confidence: { level: 'high' | 'medium' | 'low'; score: number; explanation: string };
  questions: { key: string; text: string; reason: string }[];
}
