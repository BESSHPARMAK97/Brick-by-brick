import type { DataStatus, Lag, LinkType, OpKind, Param, ResourceKind, WorkGroupId } from '../types';

export type OpLevel = 'foundation' | 'zone' | 'floor' | 'section';

/** Какие уровни (этажи) охватывает шаблон уровня zone/floor. */
export type FloorRange = 'all' | 'above' | 'basement';

/**
 * База для определения объёма:
 *  floorArea         — площадь этажа (на захватку делится на число захваток);
 *  roofArea          — площадь кровли (= площадь этажа);
 *  basementWallArea  — площадь стен подвала (по периметру);
 *  siteArea          — площадь благоустройства;
 *  fixed             — объём не определяется (длительность задаётся сменами).
 */
export type QuantityBasis = 'floorArea' | 'roofArea' | 'basementWallArea' | 'siteArea';

export interface QuantityRule {
  basis: QuantityBasis;
  /** Удельный показатель: единиц на 1 м² базы */
  ratio: number;
  status: DataStatus;
  source: string;
}

export interface EquipmentDemand {
  kind: ResourceKind;
  /** Единиц ресурса в смену. Для 'concrete' — объём укладки в смену (м³) рассчитывается автоматически. */
  units: number;
}

export interface ClimateRule {
  /** Минимальная ожидаемая среднесуточная температура воздуха, °C (null — нет ограничения) */
  minAirTemp: Param | null;
  /** Внутренние работы: ограничение снимается временным отоплением здания */
  indoor?: boolean;
  /** Наружные работы: ограничение снимается тепляками/укрытиями */
  external?: boolean;
  /** Крановые операции: остановка при ветре выше паспортного ограничения (по прогнозу) */
  craneWind?: boolean;
}

export type CuringTarget = 'verticalStrip' | 'slabStrip' | 'walk';

export interface OperationTemplate {
  key: string;
  name: string;
  group: WorkGroupId;
  /** Категория (конструктив) */
  category: string;
  /** Технологическая группа (этап цикла) */
  techGroup: string;
  kind: OpKind;
  level: OpLevel;
  floors?: FloorRange;
  unit: string;
  /** Метод определения объёма */
  quantity?: QuantityRule;
  /** Выработка: единиц на одну бригадо-смену */
  productivity?: Param;
  /** Для приёмок, испытаний, зимних мероприятий — длительность в сменах */
  durationShifts?: Param;
  /** trade — профиль бригады внутри вида работ (у каждого профиля свой пул бригад) */
  crew?: { composition: string; size: number; maxPerFront: number; trade?: string };
  equipment: EquipmentDemand[];
  /** Использует фронт работ этажа (ограничение одновременных видов работ) */
  usesFront?: boolean;
  climate?: ClimateRule;
  curing?: CuringTarget;
  /** Применимо только при условии (например, тип фасада) */
  onlyIf?: { facadeType?: 'wet' | 'ventilated' };
  qualityControl: string[];
  /** Допустимость параллельного выполнения */
  parallel: string;
  normSource: string;
}

export type LinkScope =
  | { kind: 'same' }
  /** Предшественник берётся с этажа (этаж последователя + offset) с ограничением диапазоном */
  | { kind: 'floorOffset'; offset: number; offsetParam?: 'masonryLagFloors' }
  | { kind: 'allFloors' }
  | { kind: 'topFloor' };

export interface TemplateLink {
  /** Альтернативы-предшественники: используется первая, чья группа работ выбрана */
  from: string[];
  to: string;
  type: LinkType;
  lag?: Lag;
  scope: LinkScope;
  origin: 'technology' | 'cross-group' | 'next-floor';
  note: string;
}

export interface WorkGroupTemplate {
  id: WorkGroupId;
  name: string;
  crewName: string;
  operations: OperationTemplate[];
  links: TemplateLink[];
}
