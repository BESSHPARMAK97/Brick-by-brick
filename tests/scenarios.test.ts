/**
 * Обязательные сценарии (раздел 8 ТЗ). Каждый тест проверяет даты, зависимости,
 * ресурсы, резервы и пересчёт критического пути — инварианты в checkInvariants().
 */
import { describe, expect, it } from 'vitest';
import { WorkCalendar } from '../src/engine/calendar/workCalendar';
import { toDayNum, weekday } from '../src/engine/dates';
import { ALL_GROUPS } from '../src/engine/defaults';
import { cal, checkInvariants, op, ops, run } from './helpers';

const WINTER = '2026-11-16';
const SUMMER = '2027-05-17';

describe('1. Монолитный ЖК 15 этажей, старт зимой (Астана)', () => {
  const { input, result: r } = run({ startDate: WINTER });

  it('инварианты расписания соблюдены', () => checkInvariants(r, input));

  it('сеть включает фундамент, подвал и 15 этажей', () => {
    expect(ops(r, 'mono.slab.pour').length).toBe(16);
    expect(op(r, 'found.pour')).toBeTruthy();
  });

  it('зимние мероприятия добавлены перед бетонированием в зимний период', () => {
    const wp = op(r, 'mono.wall.winterprep', 0);
    expect(wp.start.startsWith('2026-12')).toBe(true);
    expect(wp.workShifts).toBeGreaterThan(0);
    expect(wp.winterApplied).toBe(true);
    expect(op(r, 'mono.wall.pour', 0).winterApplied).toBe(true);
  });

  it('выдерживание зимой рассчитано с температурой прогрева, а не по универсальной длительности', () => {
    const cure = op(r, 'mono.slab.cureStrip', 0);
    expect(cure.strength?.winter).toBe(true);
    expect(cure.strength!.temps.every((t) => t === input.technology.winterCuringTempC)).toBe(true);
    expect(cure.strength!.reachedFraction).toBeGreaterThanOrEqual(0.7);
    // EN 1992-1-1: при +15 °C до 70 % для s = 0.25 нужно > 6 эквивалентных… реальных суток
    expect(cure.calendarDays).toBeGreaterThanOrEqual(6);
  });

  it('объяснение даты содержит длительность, календарь, связь, резерв и источники', () => {
    const o = op(r, 'mono.wall.formwork', 5);
    const kinds = new Set(o.explanation.map((e) => e.kind));
    for (const k of ['duration', 'calendar', 'predecessor', 'float', 'source']) expect(kinds.has(k as never), k).toBe(true);
  });

  it('воспроизводимость: повторный расчёт даёт идентичный результат', () => {
    const again = run({ startDate: WINTER }).result;
    expect(again.meta.inputHash).toBe(r.meta.inputHash);
    expect(again.meta.resultHash).toBe(r.meta.resultHash);
    expect(again.operations).toEqual(r.operations);
  });
});

describe('2. Тот же объект, старт летом', () => {
  const { input, result: r } = run({ startDate: SUMMER });
  const winter = run({ startDate: WINTER }).result;

  it('инварианты расписания соблюдены', () => checkInvariants(r, input));

  it('летом зимние мероприятия не применяются (длительность 0)', () => {
    const wp = op(r, 'mono.wall.winterprep', 0);
    expect(wp.workShifts).toBe(0);
    expect(wp.calendarDays).toBe(0);
    expect(op(r, 'mono.wall.pour', 0).winterApplied).toBe(false);
  });

  it('летнее выдерживание идёт при температуре воздуха и короче зимнего с прогревом +15 °C', () => {
    const summerCure = op(r, 'mono.slab.cureStrip', 1);
    expect(summerCure.strength!.winter).toBe(false);
    expect(Math.min(...summerCure.strength!.temps)).toBeGreaterThan(15);
    const winterCure = op(winter, 'mono.slab.cureStrip', 0);
    expect(summerCure.calendarDays).toBeLessThan(winterCure.calendarDays);
  });

  it('при старте летом часть монолита всё равно попадает на зиму — она учитывается', () => {
    expect(r.operations.some((o) => o.kind === 'winterPrep' && o.workShifts > 0)).toBe(true);
  });
});

describe('3. Пересечение работ с официальными праздниками', () => {
  // Старт в марте 2027: Наурыз 21–23.03 (21 — вс → перенос на 24.03 при 6/1? нет: 22.03 — пн)
  const { input, result: r } = run({ startDate: '2027-03-15', workGroups: ['monolith'] });
  const main = new WorkCalendar('m', 'm', input.calendar);

  it('инварианты расписания соблюдены', () => checkInvariants(r, input));

  it('ни одна работа не выполняется в праздничные и перенесённые дни', () => {
    for (const o of r.operations.filter((x) => x.kind !== 'curing' && x.calendarDays > 0)) {
      expect(main.capacity(o.es)).toBeGreaterThan(0);
    }
    const spanning = r.operations.filter((o) => o.kind === 'work' && o.es <= toDayNum('2027-03-22') && o.ef > toDayNum('2027-03-22'));
    expect(spanning.length).toBeGreaterThan(0);
    for (const o of spanning) {
      expect(o.dayClasses.holiday).toBeGreaterThan(0);
      expect(o.workingDays).toBeLessThan(o.calendarDays);
      expect(o.explanation.some((e) => e.text.includes('Наурыз'))).toBe(true);
    }
  });

  it('набор прочности (технологический перерыв) идёт и в праздники', () => {
    const cures = r.operations.filter((o) => o.kind === 'curing' && o.es <= toDayNum('2027-03-22') && o.ef > toDayNum('2027-03-22'));
    for (const c of cures) expect(c.dayClasses.holiday).toBe(0);
  });
});

describe('4. Изменение режима с 5/2 на 6/1', () => {
  const five = run({ startDate: SUMMER, calendar: cal('5/2') });
  const six = run({ startDate: SUMMER, calendar: cal('6/1') });

  it('инварианты обоих вариантов соблюдены', () => {
    checkInvariants(five.result, five.input);
    checkInvariants(six.result, six.input);
  });

  it('при 5/2 работы не начинаются и не заканчиваются в субботу; при 6/1 — суббота рабочая', () => {
    for (const o of five.result.operations.filter((x) => x.kind !== 'curing' && x.calendarDays > 0)) {
      expect(weekday(o.es)).not.toBe(6);
      expect(weekday(o.ef - 1)).not.toBe(6);
    }
    expect(six.result.operations.some((o) => o.kind === 'work' && weekday(o.es) === 6)).toBe(true);
  });

  it('6/1 сокращает срок строительства', () => {
    expect(six.result.projectFinish < five.result.projectFinish).toBe(true);
  });
});

describe('5. Недоступность крана или опалубки', () => {
  const base = run({ startDate: SUMMER }).result;
  const crane = run({ startDate: SUMMER }, (i) => {
    i.resources.unavailability.push({ kind: 'crane', target: 'S1', from: '2027-08-02', to: '2027-08-31', reason: 'Ремонт крана' });
  });
  const formwork = run({ startDate: SUMMER }, (i) => {
    i.resources.unavailability.push({ kind: 'slabFormwork', target: 'S1', from: '2027-08-02', to: '2027-08-31', reason: 'Опалубка перекрытий на ремонте' });
  });

  it('инварианты соблюдены', () => {
    checkInvariants(crane.result, crane.input);
    checkInvariants(formwork.result, formwork.input);
  });

  it('в период недоступности крана крановые операции не выполняются', () => {
    const prof = crane.result.resources.find((x) => x.id === 'crane:S1')!;
    for (const u of prof.usage.filter((x) => x.day >= '2027-08-02' && x.day <= '2027-08-31')) {
      expect(u.capacity).toBe(0);
      expect(u.used).toBe(0);
    }
    expect(crane.result.projectFinish > base.projectFinish).toBe(true);
    const explained = crane.result.operations.some((o) => o.explanation.some((e) => e.kind === 'resource' && e.text.includes('Ремонт крана')));
    expect(explained).toBe(true);
  });

  it('недоступность опалубки сдвигает монтаж опалубки перекрытий и срок', () => {
    for (const o of ops(formwork.result, 'mono.slab.formwork')) {
      const overlaps = o.es <= toDayNum('2027-08-31') && o.ef > toDayNum('2027-08-02');
      expect(overlaps, o.id).toBe(false);
    }
    expect(formwork.result.projectFinish > base.projectFinish).toBe(true);
  });

  it('один комплект опалубки перекрытий вместо двух — оборачиваемость удлиняет цикл', () => {
    const one = run({ startDate: SUMMER }, (i) => (i.resources.slabFormworkSets = 1)).result;
    expect(one.projectFinish >= base.projectFinish).toBe(true);
    expect(one.links.some((l) => l.origin === 'turnover' && l.note?.includes('1 компл.'))).toBe(true);
  });
});

describe('6. Задержка поставки бетона', () => {
  const base = run({ startDate: SUMMER }).result;
  const delayed = run({ startDate: SUMMER }, (i) => {
    i.resources.unavailability.push({ kind: 'concrete', from: '2027-07-01', to: '2027-07-14', reason: 'Задержка поставки бетона (БСУ)' });
  });

  it('инварианты соблюдены', () => checkInvariants(delayed.result, delayed.input));

  it('в период задержки бетонирование не выполняется, срок сдвигается', () => {
    const prof = delayed.result.resources.find((x) => x.id === 'concrete')!;
    for (const u of prof.usage.filter((x) => x.day >= '2027-07-01' && x.day <= '2027-07-14')) expect(u.used).toBe(0);
    expect(delayed.result.projectFinish > base.projectFinish).toBe(true);
    const pour = delayed.result.operations.find((o) => o.templateKey.endsWith('.pour') && o.explanation.some((e) => e.text.includes('Задержка поставки бетона')));
    expect(pour).toBeTruthy();
    expect(pour!.waitDays).toBeGreaterThan(0);
  });

  it('ограничение «не ранее» (поставка материала) соблюдается и объясняется', () => {
    const c = run({ startDate: SUMMER }, (i) => {
      i.constraints.push({ templateKey: 'found.rebar', notBefore: '2027-06-07', reason: 'Поставка арматуры' });
    }).result;
    const o = op(c, 'found.rebar');
    expect(o.start >= '2027-06-07').toBe(true);
    expect(o.explanation.some((e) => e.kind === 'constraint' && e.text.includes('Поставка арматуры'))).toBe(true);
  });
});

describe('7. Изменение производительности бригады', () => {
  const base = run({ startDate: SUMMER }).result;
  const slow = run({ startDate: SUMMER }, (i) => (i.overrides['mono.wall.formwork'] = { productivity: 90, productivityStatus: 'confirmed' })).result;
  const fast = run({ startDate: SUMMER }, (i) => (i.overrides['mono.wall.formwork'] = { productivity: 360, productivityStatus: 'confirmed' })).result;

  it('длительность операции обратно пропорциональна выработке', () => {
    const b = op(base, 'mono.wall.formwork', 5).workShifts;
    expect(op(slow, 'mono.wall.formwork', 5).workShifts).toBeCloseTo(b * 2, 2);
    expect(op(fast, 'mono.wall.formwork', 5).workShifts).toBeCloseTo(b / 2, 2);
  });

  it('пересчитываются зависимые операции и срок; подтверждённая выработка помечена', () => {
    expect(slow.projectFinish > base.projectFinish).toBe(true);
    expect(fast.projectFinish <= base.projectFinish).toBe(true);
    expect(op(slow, 'mono.wall.formwork', 5).productivityStatus).toBe('confirmed');
    expect(slow.assumptions.find((a) => a.key === 'op:mono.wall.formwork')!.status).toBe('confirmed');
  });
});

describe('8. Добавление второй бригады', () => {
  it('вторая бригада штукатуров сокращает срок отделки (этажи идут параллельно)', () => {
    const one = run({ startDate: SUMMER, workGroups: ALL_GROUPS });
    const two = run({ startDate: SUMMER, workGroups: ALL_GROUPS }, (i) => (i.resources.crews.plaster_screed = 2));
    checkInvariants(two.result, two.input);
    const lastPlaster = (r: typeof one.result) => Math.max(...ops(r, 'ps.plaster').map((o) => o.ef));
    expect(lastPlaster(two.result)).toBeLessThan(lastPlaster(one.result));
    const prof = two.result.resources.find((x) => x.id === 'crew:plaster_screed:main')!;
    expect(prof.peak).toBe(2);
    expect(two.result.projectFinish <= one.result.projectFinish).toBe(true);
  });

  it('две бригады монолитчиков и 2 захватки — поточное выполнение быстрее', () => {
    const z2 = (crews: number) =>
      run({ startDate: SUMMER }, (i) => {
        i.buildings[0].sections[0].zonesPerFloor = 2;
        i.resources.crews.monolith = crews;
        i.resources.slabFormworkSets = 2;
      });
    const one = z2(1);
    const two = z2(2);
    checkInvariants(two.result, two.input);
    expect(two.result.projectFinish < one.result.projectFinish).toBe(true);
  });
});

describe('9. Изменение продолжительности технологического перерыва', () => {
  const base = run({ startDate: SUMMER }).result;

  it('повышение требуемой распалубочной прочности перекрытий удлиняет выдерживание', () => {
    const r = run({ startDate: SUMMER }, (i) => (i.technology.slabStripPercent = 100)).result;
    expect(op(r, 'mono.slab.cureStrip', 3).calendarDays).toBeGreaterThan(op(base, 'mono.slab.cureStrip', 3).calendarDays);
    expect(op(r, 'mono.slab.cureStrip', 3).strength!.requiredFraction).toBe(1);
  });

  it('повышение прочности допуска на перекрытие сдвигает следующий этаж и срок', () => {
    const r = run({ startDate: SUMMER }, (i) => (i.technology.walkStrengthMPa = 10)).result;
    expect(op(r, 'mono.slab.cureWalk', 3).calendarDays).toBeGreaterThan(op(base, 'mono.slab.cureWalk', 3).calendarDays);
    expect(r.projectFinish > base.projectFinish).toBe(true);
  });

  it('медленный цемент (s = 0.38) удлиняет перерывы', () => {
    const r = run({ startDate: SUMMER }, (i) => (i.technology.cementS = 0.38)).result;
    expect(op(r, 'mono.slab.cureStrip', 3).calendarDays).toBeGreaterThan(op(base, 'mono.slab.cureStrip', 3).calendarDays);
  });

  it('зимние мероприятия, учтённые в выработке, не добавляются повторно', () => {
    const r = run({ startDate: WINTER }, (i) => (i.technology.winterMeasuresIncludedInRates = true)).result;
    for (const o of ops(r, 'mono.wall.winterprep')) expect(o.calendarDays).toBe(0);
    expect(op(r, 'mono.wall.winterprep', 0).explanation.some((e) => e.text.includes('двойного учёта'))).toBe(true);
  });
});

describe('10. Отсутствие подтверждённых данных для отдельной операции', () => {
  it('сценарные значения явно помечены и снижают достоверность', () => {
    const r = run({ startDate: SUMMER }).result;
    const a = r.assumptions.find((x) => x.key === 'op:mono.wall.strip')!;
    expect(a.status).toBe('assumption');
    expect(a.source).toContain('не норматив');
    expect(r.confidence.level).toBe('low');
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.code === 'critical-assumptions')).toBe(true);
  });

  it('при полностью отсутствующих данных операция не рассчитывается, выдаётся ошибка, расчёт не падает', () => {
    const { input, result: r } = run({ startDate: SUMMER }, (i) => (i.overrides['mono.wall.strip'] = { productivity: null }));
    const o = op(r, 'mono.wall.strip', 3);
    expect(o.resolved).toBe(false);
    expect(o.calendarDays).toBe(0);
    expect(o.explanation.some((e) => e.text.includes('НЕ рассчитана'))).toBe(true);
    expect(r.warnings.some((w) => w.code === 'unresolved' && w.severity === 'error')).toBe(true);
    expect(r.confidence.level).toBe('low');
    checkInvariants(r, input);
  });

  it('подтверждение данных повышает уровень достоверности', () => {
    const base = run({ startDate: SUMMER }).result;
    const confirmedAll = run({ startDate: SUMMER }, (i) => {
      for (const o of base.operations) {
        if (o.kind === 'work' && o.productivity !== null) {
          i.overrides[o.templateKey] = { productivity: o.productivity, productivityStatus: 'confirmed', quantityPerZone: o.quantity, quantityStatus: 'project' };
        }
        if ((o.kind === 'inspection' || o.kind === 'winterPrep')) i.overrides[o.templateKey] = { durationShifts: o.workShifts || 0.5, durationStatus: 'confirmed' };
      }
      i.confirmedParams.push('technology.cementS', 'technology.concreteClassMPa');
    }).result;
    expect(confirmedAll.confidence.score).toBeGreaterThan(base.confidence.score);
  });
});
