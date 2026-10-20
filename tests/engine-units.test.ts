import { describe, expect, it } from 'vitest';
import { calculateSchedule, EngineError } from '../src/engine/calculate';
import { ASTANA_NORMALS, ClimateEngine } from '../src/engine/climate/climate';
import { ageIncrement, computeCuring, relativeStrength, slabStripPercentBySpan } from '../src/engine/climate/concrete';
import { toDayNum } from '../src/engine/dates';
import { createDefaultInput } from '../src/engine/defaults';
import { hashObject } from '../src/engine/hash';
import { findCycle } from '../src/engine/schedule/network';

describe('Модель набора прочности (EN 1992-1-1)', () => {
  it('β_cc(28) = 1, при +20 °C эквивалентный возраст ≈ реальному', () => {
    expect(relativeStrength(28, 0.25)).toBeCloseTo(1, 6);
    expect(ageIncrement(20)).toBeCloseTo(1, 2);
    expect(ageIncrement(0)).toBe(0);
    expect(ageIncrement(-5)).toBe(0);
  });
  it('70 % при +20 °C и s = 0.25 — 5 суток; при +5 °C дольше', () => {
    const at = (t: number) => computeCuring({ requirement: { kind: 'percent', value: 70, label: '' }, concreteClassMPa: 25, cementS: 0.25, tempForDay: () => t });
    expect(at(20).days).toBe(5);
    expect(at(5).days).toBeGreaterThan(at(20).days);
  });
  it('при отрицательной температуре без прогрева прочность не набирается (ограничение 90 сут.)', () => {
    const r = computeCuring({ requirement: { kind: 'percent', value: 50, label: '' }, concreteClassMPa: 25, cementS: 0.25, tempForDay: () => -10 });
    expect(r.capped).toBe(true);
  });
  it('распалубочная прочность перекрытий по пролёту (СП 70.13330, табл. 5.11)', () => {
    expect(slabStripPercentBySpan(6)).toBe(70);
    expect(slabStripPercentBySpan(7.2)).toBe(80);
  });
});

describe('Climate Engine', () => {
  const c = new ClimateEngine(ASTANA_NORMALS, null, null);
  it('середина января — климатическая норма, зимние условия бетонирования', () => {
    const w = c.weather(toDayNum('2027-01-16'));
    expect(w.tMean).toBeCloseTo(-14.5, 0);
    expect(w.source).toBe('climate');
    expect(c.isWinterConcreting(toDayNum('2027-01-16'))).toBe(true);
    expect(c.isWinterConcreting(toDayNum('2027-07-16'))).toBe(false);
  });
  it('прогноз заменяет норму на свои даты', () => {
    const f = new ClimateEngine(ASTANA_NORMALS, { source: 'test', fetchedAt: '2027-01-01', days: [{ date: '2027-01-16', tMin: 2, tMax: 8, windMaxMs: 20, precipMm: 0 }] }, null);
    expect(f.weather(toDayNum('2027-01-16')).tMean).toBe(5);
    expect(f.isWinterConcreting(toDayNum('2027-01-16'))).toBe(false);
  });
  it('прогноз ветра останавливает крановые операции', () => {
    const base = createDefaultInput({ startDate: '2027-06-01' });
    const r0 = calculateSchedule(base);
    const firstCrane = r0.operations.find((o) => o.templateKey === 'found.rebar')!;
    const windy = calculateSchedule({
      ...base,
      forecast: { source: 'test', fetchedAt: '2027-05-30', days: [{ date: firstCrane.start, tMin: 10, tMax: 20, windMaxMs: 25, precipMm: 0 }] },
    });
    const o = windy.operations.find((x) => x.templateKey === 'found.rebar')!;
    expect(o.start === firstCrane.start ? o.dayClasses.climate : 1).toBeGreaterThan(0);
  });
});

describe('Граф работ и исходные данные', () => {
  it('находит цикл', () => {
    expect(findCycle(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }])).toEqual(['a', 'b', 'c', 'a']);
    expect(findCycle(['a', 'b'], [{ from: 'a', to: 'b' }])).toBeNull();
  });
  it('некорректные данные отклоняются с понятной ошибкой', () => {
    const bad = createDefaultInput({ startDate: '2027-02-30' });
    expect(() => calculateSchedule(bad)).toThrow(EngineError);
    try {
      calculateSchedule(bad);
    } catch (e) {
      expect((e as EngineError).details?.join(' ')).toContain('Дата начала');
    }
  });
  it('хэш не зависит от порядка ключей', () => {
    expect(hashObject({ a: 1, b: [1, 2] })).toBe(hashObject({ b: [1, 2], a: 1 }));
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });
  it('директивный срок раньше расчётного даёт отрицательные резервы и ошибку', () => {
    const r = calculateSchedule(createDefaultInput({ startDate: '2027-06-01', deadline: '2028-01-01' }));
    expect(r.warnings.some((w) => w.code === 'deadline')).toBe(true);
    expect(r.operations.some((o) => o.totalFloat < 0)).toBe(true);
  });
  it('резерв на риски отодвигает окончание с буфером, но не даты операций', () => {
    const a = calculateSchedule(createDefaultInput({ startDate: '2027-06-01' }));
    const inp = createDefaultInput({ startDate: '2027-06-01' });
    inp.technology.projectBufferDays = 20;
    const b = calculateSchedule(inp);
    expect(b.projectFinish).toBe(a.projectFinish);
    expect(b.projectFinishWithBuffer > a.projectFinishWithBuffer).toBe(true);
  });
  it('несколько секций и корпусов: у каждой секции свой кран, бригады общие', () => {
    const inp = createDefaultInput({ startDate: '2027-06-01' });
    inp.buildings.push({ id: 'B2', name: 'Корпус 2', sections: [{ id: 'S2', name: 'Секция 1', floors: 9, basementFloors: 1, zonesPerFloor: 1, floorArea: 500, slabSpanM: 6 }] });
    const r = calculateSchedule(inp);
    expect(r.resources.some((x) => x.id === 'crane:S2')).toBe(true);
    expect(r.operations.filter((o) => o.sectionId === 'S2').length).toBeGreaterThan(0);
  });
});
