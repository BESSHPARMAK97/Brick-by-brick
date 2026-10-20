import { describe, expect, it } from 'vitest';
import { calculateSchedule } from '../src/engine/calculate';
import { createDefaultInput } from '../src/engine/defaults';
import { buildWorkbook } from '../src/export/excel';
import { buildPdfDefinition } from '../src/export/pdf';
import { compareScenarios, compareSnapshots, MemoryStore, ProjectStore } from '../src/storage/projectStore';

describe('Журнал версий и сценарии', () => {
  it('версия сохраняется при изменении и не дублируется без изменений; сравнение показывает сдвиг', () => {
    const store = new ProjectStore(new MemoryStore());
    const p = store.createProject(createDefaultInput({ startDate: '2027-05-17' }));
    const sc = p.scenarios[0];
    const r1 = calculateSchedule(sc.input);
    expect(store.recordVersion(p.id, sc.id, sc.input, r1)).not.toBeNull();
    expect(store.recordVersion(p.id, sc.id, sc.input, r1)).toBeNull();
    const changed = { ...sc.input, calendar: { ...sc.input.calendar, regime: '5/2' as const } };
    store.updateScenarioInput(p.id, sc.id, changed);
    const r2 = calculateSchedule(changed);
    store.recordVersion(p.id, sc.id, changed, r2);
    const [v1, v2] = store.versions(p.id);
    const cmp = compareSnapshots(v1, v2);
    expect(cmp.finishShiftDays).toBeGreaterThan(0);
    expect(cmp.changedOps.length).toBeGreaterThan(0);
    expect(cmp.inputChanges).toContain('calendar.regime: "6/1" → "5/2"');
  });

  it('альтернативный сценарий копирует исходные данные и сравнивается с базовым', () => {
    const store = new ProjectStore(new MemoryStore());
    const p = store.createProject(createDefaultInput({ startDate: '2027-05-17' }));
    const alt = store.addScenario(p.id, p.scenarios[0].id, 'Две смены');
    alt.input.calendar.shiftsPerDay = 2;
    store.updateScenarioInput(p.id, alt.id, alt.input);
    const cmp = compareScenarios(p.scenarios[0], store.activeProject!.scenarios[1]);
    expect(cmp.finishShiftDays).toBeLessThan(0);
    expect(() => store.deleteScenario(p.id, p.baselineScenarioId)).toThrow();
  });

  it('состояние переживает перезагрузку хранилища', () => {
    const kv = new MemoryStore();
    const a = new ProjectStore(kv);
    a.createProject(createDefaultInput({ name: 'Тест' }));
    const b = new ProjectStore(kv);
    expect(b.activeProject?.name).toBe('Тест');
  });
});

describe('Экспорт', () => {
  const input = createDefaultInput({ startDate: '2027-05-17' });
  const result = calculateSchedule(input);

  it('Excel: создаётся книга с листами ГПР, допущения, риски, ресурсы, сведения', async () => {
    const buf = await buildWorkbook(result, input);
    expect(buf.byteLength).toBeGreaterThan(10_000);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['ГПР', 'Допущения', 'Риски и предупреждения', 'Ресурсы', 'Сведения о расчёте']);
    expect(wb.getWorksheet('ГПР')!.rowCount).toBe(result.operations.length + 2);
  });

  it('PDF: описание документа содержит все операции и предупреждения', () => {
    const def = buildPdfDefinition(result, input);
    const json = JSON.stringify(def.content);
    expect(json).toContain('График операций');
    expect(json).toContain(result.operations[0].name);
    const crit = buildPdfDefinition(result, input, { onlyCritical: true });
    expect(JSON.stringify(crit.content)).toContain('Критический путь');
  });

  it('PDF: реальная генерация файла (pdfmake, кириллица)', async () => {
    const pdfmake = (await import('pdfmake')).default as unknown as {
      setFonts(f: unknown): void;
      createPdf(d: unknown): { getBuffer(): Promise<Buffer> };
    };
    const dir = new URL('../node_modules/pdfmake/build/fonts/Roboto/', import.meta.url).pathname;
    pdfmake.setFonts({ Roboto: { normal: dir + 'Roboto-Regular.ttf', bold: dir + 'Roboto-Medium.ttf', italics: dir + 'Roboto-Italic.ttf', bolditalics: dir + 'Roboto-MediumItalic.ttf' } });
    const buf = await pdfmake.createPdf(buildPdfDefinition(result, input, { onlyCritical: true })).getBuffer();
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  }, 30_000);
});
