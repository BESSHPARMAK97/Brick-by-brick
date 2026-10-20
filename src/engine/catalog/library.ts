/**
 * Work Catalog — библиотека строительных работ и технологических шаблонов.
 *
 * ВАЖНО: все значения выработки и удельных объёмов ниже — СЦЕНАРНЫЕ ПАРАМЕТРЫ
 * (status: 'assumption'). Это не нормативы. Они нужны, чтобы движок мог построить
 * предварительный график, и должны быть заменены фактической выработкой подрядчика,
 * данными ВОР или нормами (ГЭСН/ЕНиР/НРР РК) с привязкой к составу бригады.
 * Нормативные ссылки (status: 'normative') даны только там, где требование
 * действительно установлено нормативным документом.
 *
 * Как добавить новый вид работ — см. docs/ADDING_WORKS.md.
 */
import type { DataStatus, Param } from '../types';
import type { OperationTemplate, QuantityRule, TemplateLink, WorkGroupTemplate } from './types';

const SCENARIO = 'Сценарное значение (не норматив) — заменить фактической выработкой или нормой с указанием источника';
const RATIO_SRC = 'Удельный показатель на 1 м² (сценарий) — заменить объёмом из ВОР/проекта';

function assume(value: number, unit: string, note?: string): Param {
  return { value, unit, status: 'assumption', source: SCENARIO, note };
}
function shifts(value: number, note: string, status: DataStatus = 'assumption'): Param {
  return { value, unit: 'смен', status, source: status === 'assumption' ? SCENARIO : note, note };
}
function ratio(basis: QuantityRule['basis'], r: number): QuantityRule {
  return { basis, ratio: r, status: 'assumption', source: RATIO_SRC };
}
function minTemp(value: number, status: DataStatus, source: string): Param {
  return { value, unit: '°C', status, source };
}

const MANUFACTURER = 'Требование технической документации материала (типовое значение; уточнить по ТУ/паспорту применяемого материала)';
const INDOOR_5 = minTemp(5, 'assumption', `${MANUFACTURER}. Внутренние «мокрые» процессы — при t ≥ +5 °C в помещении`);

/* ───────────────────────────── Монолит ───────────────────────────── */

const REBAR_CREW = { composition: 'Бригада арматурщиков, 8 чел.', size: 8, maxPerFront: 2, trade: 'rebar' };
const FORM_CREW = { composition: 'Бригада опалубщиков, 10 чел.', size: 10, maxPerFront: 2, trade: 'formwork' };
const CONCRETE_CREW = { composition: 'Звено бетонщиков, 6 чел.', size: 6, maxPerFront: 1, trade: 'concrete' };
const CRANE_WIND = { minAirTemp: null, craneWind: true } as const;

const monolithOps: OperationTemplate[] = [
  // Фундаментная плита
  {
    key: 'found.prep', name: 'Подготовка основания фундаментной плиты', group: 'monolith', category: 'Фундамент',
    techGroup: 'Подготовка фронта', kind: 'work', level: 'foundation', unit: 'м²',
    quantity: ratio('floorArea', 1.0), productivity: assume(400, 'м²/смену'), crew: CONCRETE_CREW, equipment: [],
    qualityControl: ['Акт освидетельствования основания', 'Геодезическая исполнительная схема'],
    parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'found.rebar', name: 'Армирование фундаментной плиты', group: 'monolith', category: 'Фундамент',
    techGroup: 'Армирование', kind: 'work', level: 'foundation', unit: 'т',
    quantity: ratio('floorArea', 0.1), productivity: assume(4, 'т/смену'), crew: REBAR_CREW,
    equipment: [{ kind: 'crane', units: 0.3 }], climate: CRANE_WIND,
    qualityControl: ['Входной контроль арматуры', 'АОСР на армирование'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'found.inspect', name: 'Приёмка армирования фундаментной плиты (АОСР)', group: 'monolith', category: 'Фундамент',
    techGroup: 'Приёмка', kind: 'inspection', level: 'foundation', unit: '',
    durationShifts: shifts(0.5, 'Освидетельствование скрытых работ'), equipment: [],
    qualityControl: ['АОСР', 'Разрешение на бетонирование'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'found.winterprep', name: 'Зимние мероприятия перед бетонированием плиты', group: 'monolith', category: 'Фундамент',
    techGroup: 'Зимнее бетонирование', kind: 'winterPrep', level: 'foundation', unit: '',
    durationShifts: shifts(1, 'Утепление, укладка греющего провода/подготовка прогрева'), crew: CONCRETE_CREW, equipment: [],
    qualityControl: ['Отогрев основания и арматуры', 'Технологическая карта прогрева (ППР)'],
    parallel: 'Нет', normSource: 'СП 70.13330.2012, п. 5.11 (зимние условия); объём мероприятий — по ППР',
  },
  {
    key: 'found.pour', name: 'Бетонирование фундаментной плиты', group: 'monolith', category: 'Фундамент',
    techGroup: 'Бетонирование', kind: 'work', level: 'foundation', unit: 'м³',
    quantity: ratio('floorArea', 0.8), productivity: assume(150, 'м³/смену'), crew: CONCRETE_CREW,
    equipment: [{ kind: 'pump', units: 1 }, { kind: 'concrete', units: 0 }],
    qualityControl: ['Контроль подвижности смеси', 'Отбор образцов', 'Журнал бетонных работ'],
    parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'found.cureWalk', name: 'Набор прочности плиты до допуска нагрузки (1,5 МПа)', group: 'monolith', category: 'Фундамент',
    techGroup: 'Уход за бетоном', kind: 'curing', level: 'foundation', unit: '', curing: 'walk', equipment: [],
    qualityControl: ['Журнал ухода за бетоном', 'Температурный лист (зимой)'], parallel: 'Технологический перерыв', normSource: 'СП 70.13330.2012',
  },
  // Типовой цикл этажа / захватки
  {
    key: 'mono.prep', name: 'Подготовка фронта, геодезическая разбивка', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Подготовка фронта', kind: 'work', level: 'zone', floors: 'all', unit: 'м²',
    quantity: ratio('floorArea', 1.0), productivity: assume(1500, 'м²/смену'),
    crew: { composition: 'Геодезист + 2 монтажника', size: 3, maxPerFront: 1, trade: 'survey' }, equipment: [],
    qualityControl: ['Разбивочная схема осей'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.wall.rebar', name: 'Армирование стен и колонн', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Армирование', kind: 'work', level: 'zone', floors: 'all', unit: 'т',
    quantity: ratio('floorArea', 0.022), productivity: assume(3, 'т/смену'), crew: REBAR_CREW,
    equipment: [{ kind: 'crane', units: 0.3 }], climate: CRANE_WIND,
    qualityControl: ['Входной контроль арматуры', 'Контроль защитного слоя'], parallel: 'Опалубка стен может начинаться через 1 раб. день', normSource: SCENARIO,
  },
  {
    key: 'mono.wall.formwork', name: 'Установка опалубки стен и колонн', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Опалубка', kind: 'work', level: 'zone', floors: 'all', unit: 'м²',
    quantity: ratio('floorArea', 1.6), productivity: assume(180, 'м²/смену'), crew: FORM_CREW,
    equipment: [{ kind: 'crane', units: 0.5 }, { kind: 'wallFormwork', units: 1 }], climate: CRANE_WIND,
    qualityControl: ['Геодезический контроль вертикальности'], parallel: 'Совмещается с армированием (SS+1, FF)', normSource: SCENARIO,
  },
  {
    key: 'mono.wall.inspect', name: 'Приёмка опалубки и армирования стен (АОСР)', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Приёмка', kind: 'inspection', level: 'zone', floors: 'all', unit: '',
    durationShifts: shifts(0.5, 'Освидетельствование скрытых работ'), equipment: [],
    qualityControl: ['АОСР на армирование', 'Акт приёмки опалубки', 'Разрешение на бетонирование'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.wall.winterprep', name: 'Зимние мероприятия: укрытие, прогрев стен', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Зимнее бетонирование', kind: 'winterPrep', level: 'zone', floors: 'all', unit: '',
    durationShifts: shifts(0.5, 'Утепление опалубки, подключение прогрева'), crew: FORM_CREW, equipment: [],
    qualityControl: ['Технологическая карта прогрева', 'Температурный лист'], parallel: 'Нет',
    normSource: 'СП 70.13330.2012, п. 5.11 (зимние условия); объём мероприятий — по ППР',
  },
  {
    key: 'mono.wall.pour', name: 'Бетонирование стен и колонн', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Бетонирование', kind: 'work', level: 'zone', floors: 'all', unit: 'м³',
    quantity: ratio('floorArea', 0.18), productivity: assume(100, 'м³/смену'), crew: CONCRETE_CREW,
    equipment: [{ kind: 'pump', units: 1 }, { kind: 'concrete', units: 0 }],
    qualityControl: ['Отбор образцов', 'Журнал бетонных работ'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.wall.cure', name: 'Набор распалубочной прочности стен', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Уход за бетоном', kind: 'curing', level: 'zone', floors: 'all', unit: '', curing: 'verticalStrip', equipment: [],
    qualityControl: ['Журнал ухода за бетоном', 'Температурный лист (зимой)'], parallel: 'Технологический перерыв',
    normSource: 'СП 70.13330.2012, табл. 5.11: вертикальные конструкции — 0,2–0,3 МПа из условия сохранения формы',
  },
  {
    key: 'mono.wall.strip', name: 'Распалубка стен и колонн', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Распалубка', kind: 'work', level: 'zone', floors: 'all', unit: 'м²',
    quantity: ratio('floorArea', 1.6), productivity: assume(400, 'м²/смену'), crew: FORM_CREW,
    equipment: [{ kind: 'crane', units: 0.5 }], climate: CRANE_WIND,
    qualityControl: ['Осмотр поверхности, геодезическая съёмка'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.slab.formwork', name: 'Установка опалубки перекрытия', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Опалубка', kind: 'work', level: 'zone', floors: 'all', unit: 'м²',
    quantity: ratio('floorArea', 0.85), productivity: assume(220, 'м²/смену'), crew: FORM_CREW,
    equipment: [{ kind: 'crane', units: 0.5 }, { kind: 'slabFormwork', units: 1 }], climate: CRANE_WIND,
    qualityControl: ['Нивелировка опалубки'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.slab.rebar', name: 'Армирование перекрытия', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Армирование', kind: 'work', level: 'zone', floors: 'all', unit: 'т',
    quantity: ratio('floorArea', 0.024), productivity: assume(3.5, 'т/смену'), crew: REBAR_CREW,
    equipment: [{ kind: 'crane', units: 0.3 }], climate: CRANE_WIND,
    qualityControl: ['Контроль защитного слоя', 'Закладные детали ИС'], parallel: 'Совмещается с опалубкой (SS+1, FF)', normSource: SCENARIO,
  },
  {
    key: 'mono.slab.inspect', name: 'Приёмка опалубки и армирования перекрытия (АОСР)', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Приёмка', kind: 'inspection', level: 'zone', floors: 'all', unit: '',
    durationShifts: shifts(0.5, 'Освидетельствование скрытых работ'), equipment: [],
    qualityControl: ['АОСР', 'Разрешение на бетонирование'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.slab.winterprep', name: 'Зимние мероприятия: укрытие, прогрев перекрытия', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Зимнее бетонирование', kind: 'winterPrep', level: 'zone', floors: 'all', unit: '',
    durationShifts: shifts(0.5, 'Укладка греющего провода, утепление'), crew: FORM_CREW, equipment: [],
    qualityControl: ['Технологическая карта прогрева', 'Температурный лист'], parallel: 'Нет',
    normSource: 'СП 70.13330.2012, п. 5.11 (зимние условия); объём мероприятий — по ППР',
  },
  {
    key: 'mono.slab.pour', name: 'Бетонирование перекрытия', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Бетонирование', kind: 'work', level: 'zone', floors: 'all', unit: 'м³',
    quantity: ratio('floorArea', 0.2), productivity: assume(120, 'м³/смену'), crew: CONCRETE_CREW,
    equipment: [{ kind: 'pump', units: 1 }, { kind: 'concrete', units: 0 }],
    qualityControl: ['Отбор образцов', 'Журнал бетонных работ'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'mono.slab.cureWalk', name: 'Набор прочности перекрытия до 1,5 МПа (допуск людей и опалубки выше)', group: 'monolith',
    category: 'Монолитный каркас', techGroup: 'Уход за бетоном', kind: 'curing', level: 'zone', floors: 'all', unit: '',
    curing: 'walk', equipment: [], qualityControl: ['Журнал ухода за бетоном'], parallel: 'Технологический перерыв',
    normSource: 'СП 70.13330.2012: движение людей и установка опалубки вышележащих конструкций — при прочности не менее 1,5 МПа',
  },
  {
    key: 'mono.slab.cureStrip', name: 'Набор распалубочной прочности перекрытия', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Уход за бетоном', kind: 'curing', level: 'zone', floors: 'all', unit: '', curing: 'slabStrip', equipment: [],
    qualityControl: ['Журнал ухода за бетоном', 'Температурный лист (зимой)'], parallel: 'Технологический перерыв (идёт параллельно работам выше)',
    normSource: 'СП 70.13330.2012, табл. 5.11: пролёт ≤ 6 м — 70 %, > 6 м — 80 % проектной прочности (или по ППР с переопиранием)',
  },
  {
    key: 'mono.slab.check', name: 'Контроль прочности перед распалубкой', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Контроль прочности', kind: 'inspection', level: 'zone', floors: 'all', unit: '',
    durationShifts: shifts(0, 'Неразрушающий контроль в день распалубки'), equipment: [],
    qualityControl: ['Протокол испытаний (НК или образцы)', 'Разрешение на распалубку'], parallel: 'Нет',
    normSource: 'ГОСТ 18105 (контроль прочности); длительность — сценарий',
  },
  {
    key: 'mono.slab.strip', name: 'Распалубка перекрытия, перестановка оснастки', group: 'monolith', category: 'Монолитный каркас',
    techGroup: 'Распалубка', kind: 'work', level: 'zone', floors: 'all', unit: 'м²',
    quantity: ratio('floorArea', 0.85), productivity: assume(350, 'м²/смену'), crew: FORM_CREW,
    equipment: [{ kind: 'crane', units: 0.3 }], climate: CRANE_WIND,
    qualityControl: ['Осмотр поверхности', 'Переопирание (по ППР)'], parallel: 'Нет', normSource: SCENARIO,
  },
];

const ss1 = { value: 1, unit: 'work' } as const;

const monolithLinks: TemplateLink[] = [
  { from: ['found.prep'], to: 'found.rebar', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Армирование по подготовленному основанию' },
  { from: ['found.rebar'], to: 'found.inspect', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Приёмка после армирования' },
  { from: ['found.inspect'], to: 'found.winterprep', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Зимние мероприятия перед бетонированием' },
  { from: ['found.winterprep'], to: 'found.pour', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Бетонирование после приёмки' },
  { from: ['found.pour'], to: 'found.cureWalk', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Уход за бетоном начинается сразу' },
  { from: ['found.cureWalk'], to: 'mono.prep', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Начало работ на плите после 1,5 МПа' },

  { from: ['mono.prep'], to: 'mono.wall.rebar', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Армирование по разбивке' },
  { from: ['mono.wall.rebar'], to: 'mono.wall.formwork', type: 'SS', lag: ss1, scope: { kind: 'same' }, origin: 'technology', note: 'Допустимое совмещение: опалубка через 1 раб. день после начала армирования' },
  { from: ['mono.wall.rebar'], to: 'mono.wall.formwork', type: 'FF', scope: { kind: 'same' }, origin: 'technology', note: 'Опалубка не может закончиться раньше армирования' },
  { from: ['mono.wall.formwork'], to: 'mono.wall.inspect', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Приёмка перед бетонированием' },
  { from: ['mono.wall.inspect'], to: 'mono.wall.winterprep', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Зимние мероприятия (при необходимости)' },
  { from: ['mono.wall.winterprep'], to: 'mono.wall.pour', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Бетонирование после приёмки' },
  { from: ['mono.wall.pour'], to: 'mono.wall.cure', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Уход за бетоном' },
  { from: ['mono.wall.cure'], to: 'mono.wall.strip', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Распалубка после достижения прочности' },
  { from: ['mono.wall.strip'], to: 'mono.slab.formwork', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Опалубка перекрытия опирается на стены' },
  { from: ['mono.slab.formwork'], to: 'mono.slab.rebar', type: 'SS', lag: ss1, scope: { kind: 'same' }, origin: 'technology', note: 'Допустимое совмещение: армирование через 1 раб. день' },
  { from: ['mono.slab.formwork'], to: 'mono.slab.rebar', type: 'FF', scope: { kind: 'same' }, origin: 'technology', note: 'Армирование не раньше окончания опалубки' },
  { from: ['mono.slab.rebar'], to: 'mono.slab.inspect', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Приёмка перед бетонированием' },
  { from: ['mono.slab.inspect'], to: 'mono.slab.winterprep', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Зимние мероприятия (при необходимости)' },
  { from: ['mono.slab.winterprep'], to: 'mono.slab.pour', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Бетонирование после приёмки' },
  { from: ['mono.slab.pour'], to: 'mono.slab.cureWalk', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Уход за бетоном' },
  { from: ['mono.slab.pour'], to: 'mono.slab.cureStrip', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Набор распалубочной прочности' },
  { from: ['mono.slab.cureStrip'], to: 'mono.slab.check', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Подтверждение прочности' },
  { from: ['mono.slab.check'], to: 'mono.slab.strip', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Распалубка по разрешению' },
  { from: ['mono.slab.cureWalk'], to: 'mono.prep', type: 'FS', scope: { kind: 'floorOffset', offset: -1 }, origin: 'next-floor', note: 'Следующий этаж — после набора 1,5 МПа перекрытием' },
];

/* ───────────────────────────── Прочие группы ───────────────────────────── */

const masonryOps: OperationTemplate[] = [
  {
    key: 'masonry.walls', name: 'Кладка наружных стен и перегородок', group: 'masonry', category: 'Кладка',
    techGroup: 'Кладка', kind: 'work', level: 'floor', floors: 'above', unit: 'м³',
    quantity: ratio('floorArea', 0.12), productivity: assume(6, 'м³/смену'),
    crew: { composition: 'Звено каменщиков, 5 чел.', size: 5, maxPerFront: 2 },
    equipment: [{ kind: 'crane', units: 0.25 }], usesFront: true,
    climate: { minAirTemp: null },
    qualityControl: ['Контроль перевязки и армирования кладки', 'Зимой — способ кладки по ППР (противоморозные добавки)'],
    parallel: 'Несколько этажей параллельно при наличии бригад', normSource: SCENARIO,
  },
];
const masonryLinks: TemplateLink[] = [
  {
    from: ['mono.slab.strip'], to: 'masonry.walls', type: 'FS', scope: { kind: 'floorOffset', offset: 0, offsetParam: 'masonryLagFloors' },
    origin: 'cross-group', note: 'Кладка — после распалубки перекрытия с отставанием от монолита (параметр «отставание кладки»)',
  },
];

const facadeOps: OperationTemplate[] = [
  {
    key: 'facade.windows', name: 'Монтаж оконных блоков (тепловой контур)', group: 'facade', category: 'Фасад',
    techGroup: 'Заполнение проёмов', kind: 'work', level: 'floor', floors: 'above', unit: 'м²',
    quantity: ratio('floorArea', 0.15), productivity: assume(25, 'м²/смену'),
    crew: { composition: 'Монтажники окон, 4 чел.', size: 4, maxPerFront: 1 }, equipment: [], usesFront: true,
    qualityControl: ['Контроль монтажного шва'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
  {
    key: 'facade.wet', name: 'Фасад: утепление и тонкослойная штукатурка (СФТК)', group: 'facade', category: 'Фасад',
    techGroup: 'Отделка фасада', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', onlyIf: { facadeType: 'wet' },
    quantity: ratio('floorArea', 0.55), productivity: assume(30, 'м²/смену'),
    crew: { composition: 'Фасадчики, 6 чел.', size: 6, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: minTemp(5, 'assumption', MANUFACTURER), external: true },
    qualityControl: ['Контроль анкеровки', 'Температура нанесения по ТУ материала'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
  {
    key: 'facade.vent', name: 'Фасад: навесная вентилируемая система', group: 'facade', category: 'Фасад',
    techGroup: 'Отделка фасада', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', onlyIf: { facadeType: 'ventilated' },
    quantity: ratio('floorArea', 0.55), productivity: assume(25, 'м²/смену'),
    crew: { composition: 'Фасадчики, 6 чел.', size: 6, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: null, external: true },
    qualityControl: ['Испытание анкеров на вырыв', 'Контроль подсистемы'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
];
const facadeLinks: TemplateLink[] = [
  { from: ['masonry.walls', 'mono.slab.strip'], to: 'facade.windows', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Окна — после кладки наружных стен' },
  { from: ['facade.windows'], to: 'facade.wet', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Фасад — после монтажа окон (примыкания)' },
  { from: ['facade.windows'], to: 'facade.vent', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Фасад — после монтажа окон (примыкания)' },
];

const roofOps: OperationTemplate[] = [
  {
    key: 'roof.vapor', name: 'Кровля: пароизоляция', group: 'roofing', category: 'Кровля', techGroup: 'Кровельный пирог',
    kind: 'work', level: 'section', unit: 'м²', quantity: ratio('roofArea', 1), productivity: assume(300, 'м²/смену'),
    crew: { composition: 'Кровельщики, 5 чел.', size: 5, maxPerFront: 1 }, equipment: [{ kind: 'crane', units: 0.2 }],
    climate: { minAirTemp: null, external: true, craneWind: true },
    qualityControl: ['Контроль нахлёстов'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'roof.insulation', name: 'Кровля: утеплитель и уклонообразующий слой', group: 'roofing', category: 'Кровля', techGroup: 'Кровельный пирог',
    kind: 'work', level: 'section', unit: 'м²', quantity: ratio('roofArea', 1), productivity: assume(200, 'м²/смену'),
    crew: { composition: 'Кровельщики, 5 чел.', size: 5, maxPerFront: 1 }, equipment: [{ kind: 'crane', units: 0.2 }],
    climate: { minAirTemp: null, external: true, craneWind: true },
    qualityControl: ['Контроль уклонов'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'roof.screed', name: 'Кровля: армированная стяжка', group: 'roofing', category: 'Кровля', techGroup: 'Кровельный пирог',
    kind: 'work', level: 'section', unit: 'м²', quantity: ratio('roofArea', 1), productivity: assume(120, 'м²/смену'),
    crew: { composition: 'Кровельщики, 5 чел.', size: 5, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: minTemp(5, 'assumption', MANUFACTURER), external: true },
    qualityControl: ['Прочность стяжки перед гидроизоляцией'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'roof.membrane', name: 'Кровля: наплавляемая гидроизоляция', group: 'roofing', category: 'Кровля', techGroup: 'Кровельный пирог',
    kind: 'work', level: 'section', unit: 'м²', quantity: ratio('roofArea', 1), productivity: assume(150, 'м²/смену'),
    crew: { composition: 'Кровельщики, 5 чел.', size: 5, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: minTemp(-15, 'assumption', MANUFACTURER), external: true },
    qualityControl: ['Контроль приклейки', 'Пролив/испытание'], parallel: 'Нет', normSource: SCENARIO,
  },
];
const roofLinks: TemplateLink[] = [
  { from: ['masonry.walls', 'mono.slab.strip'], to: 'roof.vapor', type: 'FS', scope: { kind: 'topFloor' }, origin: 'cross-group', note: 'Кровля — после перекрытия и парапетов верхнего этажа' },
  { from: ['roof.vapor'], to: 'roof.insulation', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Последовательность кровельного пирога' },
  { from: ['roof.insulation'], to: 'roof.screed', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Последовательность кровельного пирога' },
  { from: ['roof.screed'], to: 'roof.membrane', type: 'FS', lag: { value: 3, unit: 'calendar' }, scope: { kind: 'same' }, origin: 'technology', note: 'Технологический перерыв на набор прочности стяжки (сценарий 3 сут.)' },
];

const waterproofingOps: OperationTemplate[] = [
  {
    key: 'wp.foundation', name: 'Вертикальная гидроизоляция стен подземной части', group: 'waterproofing', category: 'Гидроизоляция',
    techGroup: 'Гидроизоляция', kind: 'work', level: 'section', unit: 'м²', quantity: ratio('basementWallArea', 1),
    productivity: assume(80, 'м²/смену'), crew: { composition: 'Изолировщики, 4 чел.', size: 4, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: minTemp(5, 'assumption', MANUFACTURER), external: true },
    qualityControl: ['АОСР на гидроизоляцию'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'wp.wetrooms', name: 'Гидроизоляция санузлов', group: 'waterproofing', category: 'Гидроизоляция',
    techGroup: 'Гидроизоляция', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 0.12),
    productivity: assume(40, 'м²/смену'), crew: { composition: 'Изолировщики, 2 чел.', size: 2, maxPerFront: 1 }, equipment: [], usesFront: true,
    climate: { minAirTemp: INDOOR_5, indoor: true },
    qualityControl: ['Пролив, АОСР'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
];
const waterproofingLinks: TemplateLink[] = [
  {
    from: ['mono.wall.strip', 'found.cureWalk'], to: 'wp.foundation', type: 'FS', scope: { kind: 'floorOffset', offset: 0 },
    origin: 'cross-group', note: 'Гидроизоляция после распалубки стен подземной части (уровень 0)',
  },
  { from: ['ps.screed', 'mep.rough', 'masonry.walls', 'mono.slab.strip'], to: 'wp.wetrooms', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Гидроизоляция санузлов — по стяжке' },
];

const mepOps: OperationTemplate[] = [
  {
    key: 'mep.rough', name: 'Инженерные системы: черновой монтаж (ВК, ОВ, ЭО, СС)', group: 'mep', category: 'Инженерные системы',
    techGroup: 'Черновой монтаж', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 1),
    productivity: assume(60, 'м²/смену'), crew: { composition: 'Монтажники ИС, 8 чел.', size: 8, maxPerFront: 2 }, equipment: [], usesFront: true,
    qualityControl: ['Гидравлические испытания стояков', 'АОСР на скрытую проводку'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
  {
    key: 'mep.finish', name: 'Инженерные системы: чистовой монтаж', group: 'mep', category: 'Инженерные системы',
    techGroup: 'Чистовой монтаж', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 1),
    productivity: assume(120, 'м²/смену'), crew: { composition: 'Монтажники ИС, 8 чел.', size: 8, maxPerFront: 2 }, equipment: [], usesFront: true,
    qualityControl: ['Проверка работоспособности приборов'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
  {
    key: 'mep.tests', name: 'Испытания и пусконаладка инженерных систем секции', group: 'mep', category: 'Инженерные системы',
    techGroup: 'Испытания', kind: 'work', level: 'section', unit: '', durationShifts: shifts(5, 'Испытания/ПНР'),
    crew: { composition: 'Наладчики, 4 чел.', size: 4, maxPerFront: 1 }, equipment: [],
    qualityControl: ['Акты испытаний', 'Протоколы ПНР'], parallel: 'Нет', normSource: SCENARIO,
  },
];
const mepLinks: TemplateLink[] = [
  { from: ['masonry.walls', 'mono.slab.strip'], to: 'mep.rough', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Черновой монтаж ИС — после кладки' },
  { from: ['floor.finish', 'paint.finish', 'tile.finish', 'ps.screed', 'mep.rough'], to: 'mep.finish', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Чистовой монтаж — после чистовой отделки' },
  { from: ['mep.finish'], to: 'mep.tests', type: 'FS', scope: { kind: 'allFloors' }, origin: 'technology', note: 'Испытания после монтажа на всех этажах' },
];

const plasterOps: OperationTemplate[] = [
  {
    key: 'ps.plaster', name: 'Штукатурка стен (механизированная)', group: 'plaster_screed', category: 'Отделка',
    techGroup: 'Штукатурка', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 2.2),
    productivity: assume(120, 'м²/смену'), crew: { composition: 'Штукатуры, 6 чел. + станция', size: 6, maxPerFront: 1 }, equipment: [], usesFront: true,
    climate: { minAirTemp: INDOOR_5, indoor: true },
    qualityControl: ['Контроль плоскостности'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
  {
    key: 'ps.screed', name: 'Стяжка пола', group: 'plaster_screed', category: 'Отделка',
    techGroup: 'Стяжка', kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 0.85),
    productivity: assume(150, 'м²/смену'), crew: { composition: 'Звено стяжки, 5 чел.', size: 5, maxPerFront: 1 }, equipment: [], usesFront: true,
    climate: { minAirTemp: INDOOR_5, indoor: true },
    qualityControl: ['Контроль горизонтальности', 'Влажность перед покрытием'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
];
const plasterLinks: TemplateLink[] = [
  { from: ['mep.rough', 'masonry.walls', 'mono.slab.strip'], to: 'ps.plaster', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Штукатурка — после чернового монтажа ИС' },
  { from: ['facade.windows'], to: 'ps.plaster', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Мокрые процессы — после закрытия теплового контура (окна)' },
  { from: ['ps.plaster'], to: 'ps.screed', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'Стяжка после штукатурки' },
];

const tilingOps: OperationTemplate[] = [
  {
    key: 'tile.finish', name: 'Плиточные работы (санузлы)', group: 'tiling', category: 'Отделка', techGroup: 'Облицовка',
    kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 0.12), productivity: assume(15, 'м²/смену'),
    crew: { composition: 'Плиточники, 3 чел.', size: 3, maxPerFront: 2 }, equipment: [], usesFront: true,
    climate: { minAirTemp: INDOOR_5, indoor: true }, qualityControl: ['Контроль швов и плоскостности'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
];
const tilingLinks: TemplateLink[] = [
  { from: ['wp.wetrooms', 'ps.screed', 'mep.rough', 'masonry.walls', 'mono.slab.strip'], to: 'tile.finish', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Плитка — после гидроизоляции санузлов' },
];

const paintingOps: OperationTemplate[] = [
  {
    key: 'paint.finish', name: 'Малярные работы (шпатлёвка, окраска)', group: 'painting', category: 'Отделка', techGroup: 'Окраска',
    kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 2.5), productivity: assume(150, 'м²/смену'),
    crew: { composition: 'Маляры, 6 чел.', size: 6, maxPerFront: 1 }, equipment: [], usesFront: true,
    climate: { minAirTemp: INDOOR_5, indoor: true }, qualityControl: ['Контроль качества поверхности'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
];
const paintingLinks: TemplateLink[] = [
  { from: ['tile.finish', 'ps.screed', 'ps.plaster', 'mep.rough', 'masonry.walls', 'mono.slab.strip'], to: 'paint.finish', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Окраска — после плиточных и штукатурных работ' },
];

const flooringOps: OperationTemplate[] = [
  {
    key: 'floor.finish', name: 'Устройство чистовых полов', group: 'flooring', category: 'Отделка', techGroup: 'Полы',
    kind: 'work', level: 'floor', floors: 'above', unit: 'м²', quantity: ratio('floorArea', 0.8), productivity: assume(100, 'м²/смену'),
    crew: { composition: 'Укладчики, 4 чел.', size: 4, maxPerFront: 1 }, equipment: [], usesFront: true,
    climate: { minAirTemp: INDOOR_5, indoor: true }, qualityControl: ['Влажность основания', 'Ровность покрытия'], parallel: 'Да, по этажам', normSource: SCENARIO,
  },
];
const flooringLinks: TemplateLink[] = [
  { from: ['paint.finish', 'tile.finish', 'ps.screed', 'mep.rough', 'masonry.walls', 'mono.slab.strip'], to: 'floor.finish', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Чистовые полы — после окраски' },
];

const landscapingOps: OperationTemplate[] = [
  {
    key: 'land.backfill', name: 'Обратная засыпка пазух котлована', group: 'landscaping', category: 'Благоустройство', techGroup: 'Земляные работы',
    kind: 'work', level: 'section', unit: 'м³', quantity: ratio('floorArea', 1.0), productivity: assume(300, 'м³/смену'),
    crew: { composition: 'Экскаватор + каток + 3 чел.', size: 3, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: minTemp(0, 'assumption', 'Засыпка мёрзлым грунтом не допускается (СП 45.13330); порог — сценарий, уточнить по ППР'), external: true },
    qualityControl: ['Коэффициент уплотнения'], parallel: 'Нет', normSource: SCENARIO,
  },
  {
    key: 'land.main', name: 'Благоустройство: покрытия, озеленение, МАФ', group: 'landscaping', category: 'Благоустройство', techGroup: 'Благоустройство',
    kind: 'work', level: 'section', unit: 'м²', quantity: ratio('siteArea', 1.0), productivity: assume(200, 'м²/смену'),
    crew: { composition: 'Дорожная бригада, 8 чел.', size: 8, maxPerFront: 1 }, equipment: [],
    climate: { minAirTemp: minTemp(5, 'assumption', 'Асфальтобетон и озеленение — тёплый период (уточнить по ТУ/СП 78.13330)'), external: true },
    qualityControl: ['Исполнительная съёмка'], parallel: 'Нет', normSource: SCENARIO,
  },
];
const landscapingLinks: TemplateLink[] = [
  { from: ['wp.foundation', 'mono.wall.strip', 'found.cureWalk'], to: 'land.backfill', type: 'FS', scope: { kind: 'floorOffset', offset: 0 }, origin: 'cross-group', note: 'Засыпка — после гидроизоляции подземной части' },
  { from: ['facade.wet', 'facade.vent', 'masonry.walls', 'mono.slab.strip'], to: 'land.main', type: 'FS', scope: { kind: 'allFloors' }, origin: 'cross-group', note: 'Благоустройство — после фасада (демонтаж лесов)' },
  { from: ['roof.membrane'], to: 'land.main', type: 'FS', scope: { kind: 'same' }, origin: 'cross-group', note: 'Благоустройство — после кровли' },
  { from: ['land.backfill'], to: 'land.main', type: 'FS', scope: { kind: 'same' }, origin: 'technology', note: 'После обратной засыпки' },
];

export const WORK_LIBRARY: WorkGroupTemplate[] = [
  { id: 'monolith', name: 'Монолитные работы', crewName: 'Бригада монолитчиков', operations: monolithOps, links: monolithLinks },
  { id: 'masonry', name: 'Кладочные работы', crewName: 'Звено каменщиков', operations: masonryOps, links: masonryLinks },
  { id: 'facade', name: 'Фасадные работы', crewName: 'Фасадная бригада', operations: facadeOps, links: facadeLinks },
  { id: 'roofing', name: 'Кровля', crewName: 'Кровельщики', operations: roofOps, links: roofLinks },
  { id: 'waterproofing', name: 'Гидроизоляция', crewName: 'Изолировщики', operations: waterproofingOps, links: waterproofingLinks },
  { id: 'mep', name: 'Инженерные системы', crewName: 'Монтажники ИС', operations: mepOps, links: mepLinks },
  { id: 'plaster_screed', name: 'Штукатурка и стяжка', crewName: 'Штукатуры', operations: plasterOps, links: plasterLinks },
  { id: 'tiling', name: 'Плиточные работы', crewName: 'Плиточники', operations: tilingOps, links: tilingLinks },
  { id: 'painting', name: 'Малярные работы', crewName: 'Маляры', operations: paintingOps, links: paintingLinks },
  { id: 'flooring', name: 'Устройство полов', crewName: 'Укладчики полов', operations: flooringOps, links: flooringLinks },
  { id: 'landscaping', name: 'Благоустройство', crewName: 'Дорожная бригада', operations: landscapingOps, links: landscapingLinks },
];

export const GROUP_NAMES: Record<string, string> = Object.fromEntries(WORK_LIBRARY.map((g) => [g.id, g.name]));

export function findTemplate(key: string): OperationTemplate | undefined {
  for (const g of WORK_LIBRARY) for (const o of g.operations) if (o.key === key) return o;
  return undefined;
}
