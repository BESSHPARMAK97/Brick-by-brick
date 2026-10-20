# Как добавить вид работ или операцию

Каталог — `src/engine/catalog/library.ts`, типы — `src/engine/catalog/types.ts`.

## 1. Операция

```ts
{
  key: 'facade.scaffold',            // уникальный ключ: <группа>.<операция>
  name: 'Монтаж строительных лесов',
  group: 'facade',                   // WorkGroupId
  category: 'Фасад',                 // конструктив
  techGroup: 'Подготовка фронта',    // этап технологии
  kind: 'work',                      // work | curing | inspection | winterPrep
  level: 'floor',                    // foundation | zone | floor | section
  floors: 'above',                   // all | above | basement (для zone/floor)
  unit: 'м²',
  quantity: ratio('floorArea', 0.55),          // метод определения объёма (сценарий)
  productivity: assume(120, 'м²/смену'),       // выработка на бригадо-смену (сценарий!)
  crew: { composition: 'Монтажники лесов, 4 чел.', size: 4, maxPerFront: 1 },
  equipment: [{ kind: 'crane', units: 0.2 }],  // доля крана в смену
  usesFront: true,                             // занимает фронт этажа
  climate: { minAirTemp: null, external: true, craneWind: true },
  qualityControl: ['Акт приёмки лесов'],
  parallel: 'Да, по этажам',
  normSource: 'Источник нормы или пометка «сценарий»',
}
```

Правила:

* **Не вводите выдуманные нормативы.** Если подтверждённого значения нет — используйте `assume(...)`
  (статус `assumption`): движок пометит параметр, понизит достоверность и задаст вопрос пользователю.
  Нормативный статус (`normative`) — только с ссылкой на документ (СП, СН РК, паспорт оборудования).
* Для приёмок/испытаний задавайте `durationShifts` вместо объёма и выработки.
* Технологический перерыв с набором прочности — `kind: 'curing'` и `curing: 'verticalStrip' | 'slabStrip' | 'walk'`;
  длительность рассчитывается моделью прочности.
* Ограничение, снимаемое временным отоплением, — `climate.indoor: true`; тепляками — `climate.external: true`.

## 2. Связи

```ts
{ from: ['masonry.walls', 'mono.slab.strip'], to: 'facade.scaffold', type: 'FS',
  scope: { kind: 'same' }, origin: 'cross-group', note: 'Леса — после кладки наружных стен' }
```

* `from` — альтернативы: используется первая, чей вид работ выбран (если кладки нет — после распалубки).
* `scope`: `same` (тот же этаж/захватка), `floorOffset` (этаж + смещение), `allFloors`, `topFloor`.
* `lag`: `{ value, unit: 'work' | 'calendar' }` — технологический перерыв в календарных днях не прерывается выходными.
* Циклы запрещены: расчёт завершится ошибкой с путём цикла.

## 3. Новый вид работ

1. Добавьте идентификатор в `WorkGroupId` (`src/engine/types.ts`) и в `ALL_GROUPS` (`src/engine/defaults.ts`).
2. Добавьте группу в `WORK_LIBRARY` с операциями и связями.
3. Добавьте тест в `tests/` (например, что операции появились, связи соблюдены — `checkInvariants`).
4. Увеличьте `RULESET_VERSION` в `src/engine/calculate.ts` — изменение правил меняет результаты.

## 4. Календарь нового года

Создайте `src/data/calendars/kz-YYYY.json` (Курбан айт, постановления о переносе, источники, статус)
и подключите в `src/engine/calendar/holidays.ts`. Пока официального календаря нет — статус `preliminary`.
Постоянные праздники меняются только в `kz-rules.json` (с `sinceYear`/`untilYear`).
