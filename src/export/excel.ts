/**
 * Экспорт ГПР в Excel (.xlsx): таблица операций с диаграммой Ганта по неделям,
 * допущения, предупреждения, ресурсы, сведения о расчёте (версии, хэши, источники).
 */
import type ExcelJS from 'exceljs';
import { GROUP_NAMES } from '../engine/catalog/library';
import { statusLabel } from '../engine/calculate';
import { formatRu, fromDayNum, toDayNum, weekday } from '../engine/dates';
import type { ProjectInput, ScheduleResult } from '../engine/types';

const KIND_RU: Record<string, string> = {
  work: 'Работа',
  curing: 'Техн. перерыв',
  inspection: 'Приёмка/контроль',
  winterPrep: 'Зимние мероприятия',
  milestone: 'Веха',
  buffer: 'Резерв',
};

export async function buildWorkbook(result: ScheduleResult, input: ProjectInput): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const Excel = (mod as unknown as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS);
  const wb = new Excel.Workbook();
  wb.creator = 'Universal Construction Schedule Engine';
  wb.created = new Date(0); // детерминированные метаданные
  wb.modified = new Date(0);

  // ── Лист ГПР ──
  const ws = wb.addWorksheet('ГПР', { views: [{ state: 'frozen', xSplit: 5, ySplit: 2 }] });
  const cols = [
    ['№', 6], ['Вид работ', 18], ['Операция', 44], ['Местоположение', 30], ['Тип', 14],
    ['Ед.', 6], ['Объём', 9], ['Выработка, ед./смену', 11], ['Бригад', 7], ['Смен', 7],
    ['Начало', 11], ['Окончание', 11], ['Кал. дн.', 7], ['Раб. дн.', 7],
    ['Позднее начало', 11], ['Общий резерв, раб. дн.', 9], ['Своб. резерв', 8], ['Критическая', 9], ['Статус данных', 22],
  ] as const;
  const start = toDayNum(result.projectStart);
  const end = toDayNum(result.projectFinishWithBuffer) + 1;
  const weekStart = start - ((weekday(start) + 6) % 7); // понедельник
  const weeks: number[] = [];
  for (let d = weekStart; d < end; d += 7) weeks.push(d);

  ws.getRow(1).values = [`${input.name} — ГПР. Старт ${formatRu(result.projectStart)}, окончание ${formatRu(result.projectFinish)}${result.projectFinishWithBuffer !== result.projectFinish ? ` (с резервом ${formatRu(result.projectFinishWithBuffer)})` : ''}. Достоверность: ${result.confidence.level}`];
  ws.getRow(1).font = { bold: true, size: 12 };
  const header = ws.getRow(2);
  cols.forEach(([name, width], i) => {
    header.getCell(i + 1).value = name;
    ws.getColumn(i + 1).width = width;
  });
  weeks.forEach((w, i) => {
    const c = header.getCell(cols.length + 1 + i);
    c.value = formatRu(w).slice(0, 5);
    ws.getColumn(cols.length + 1 + i).width = 3.2;
    c.alignment = { textRotation: 90 };
  });
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'middle' };
  header.height = 48;

  result.operations.forEach((o, idx) => {
    const row = ws.getRow(idx + 3);
    const status = o.kind === 'work'
      ? `выработка: ${statusLabel(o.productivityStatus)}; объём: ${statusLabel(o.quantityStatus)}`
      : o.kind === 'curing' ? 'расчёт по модели прочности' : '';
    row.values = [
      idx + 1, GROUP_NAMES[o.group], o.name, o.locationLabel, KIND_RU[o.kind] ?? o.kind,
      o.unit, o.quantity ?? '', o.productivity ?? '', o.crews || '', o.workShifts || '',
      formatRu(o.start), formatRu(o.finish), o.calendarDays, o.workingDays,
      formatRu(o.ls), o.totalFloat, o.freeFloat, o.critical ? 'да' : '', o.resolved ? status : 'НЕ РАССЧИТАНО: нет данных',
    ];
    if (o.critical) row.getCell(3).font = { bold: true, color: { argb: 'FFB42318' } };
    if (!o.resolved) row.getCell(19).font = { bold: true, color: { argb: 'FFB42318' } };
    const fill = o.critical ? 'FFE5484D' : o.kind === 'curing' ? 'FFB5B2BC' : 'FF3E63DD';
    weeks.forEach((w, i) => {
      const overlaps = o.calendarDays > 0 ? o.es < w + 7 && o.ef > w : o.es >= w && o.es < w + 7;
      if (overlaps) row.getCell(cols.length + 1 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };

  // ── Допущения ──
  const wa = wb.addWorksheet('Допущения');
  wa.columns = [
    { header: 'Параметр', width: 50 }, { header: 'Значение', width: 22 }, { header: 'Статус', width: 30 },
    { header: 'Влияет на крит. путь', width: 12 }, { header: 'Смен на крит. пути', width: 12 }, { header: 'Источник', width: 70 },
  ];
  for (const a of result.assumptions) wa.addRow([a.label, a.value, statusLabel(a.status), a.affectsCritical ? 'да' : '', a.impactShifts || '', a.source]);
  wa.getRow(1).font = { bold: true };

  // ── Предупреждения ──
  const ww = wb.addWorksheet('Риски и предупреждения');
  ww.columns = [{ header: 'Уровень', width: 12 }, { header: 'Описание', width: 120 }, { header: 'Операций', width: 10 }];
  const sev: Record<string, string> = { error: 'Ошибка', warning: 'Внимание', info: 'Инфо' };
  for (const w of result.warnings) ww.addRow([sev[w.severity], w.text, w.opIds?.length ?? '']);
  ww.getRow(1).font = { bold: true };

  // ── Ресурсы ──
  const wr = wb.addWorksheet('Ресурсы');
  wr.columns = [{ header: 'Ресурс', width: 50 }, { header: 'Доступно', width: 10 }, { header: 'Ед.', width: 12 }, { header: 'Пик загрузки', width: 12 }, { header: 'Разрешено конфликтов', width: 14 }];
  for (const r of result.resources) wr.addRow([r.name, r.capacity, r.unit, r.peak, r.conflictsResolved]);
  wr.getRow(1).font = { bold: true };

  // ── Сведения ──
  const wi = wb.addWorksheet('Сведения о расчёте');
  wi.columns = [{ header: 'Параметр', width: 36 }, { header: 'Значение', width: 110 }];
  wi.addRow(['Версия движка', result.meta.engineVersion]);
  wi.addRow(['Версия правил', result.meta.rulesetVersion]);
  wi.addRow(['Хэш исходных данных', result.meta.inputHash]);
  wi.addRow(['Хэш результата', result.meta.resultHash]);
  wi.addRow(['Климат', result.meta.climateSource]);
  for (const c of result.meta.calendarData) wi.addRow([`Календарь ${c.year}`, `${c.status}: ${c.source}`]);
  wi.addRow(['Достоверность', `${result.confidence.level} — ${result.confidence.explanation}`]);
  wi.addRow(['Период', `${fromDayNum(start)} — ${result.projectFinish}`]);
  wi.getRow(1).font = { bold: true };

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
