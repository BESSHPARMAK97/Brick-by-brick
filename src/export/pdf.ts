/**
 * Экспорт ГПР в PDF (pdfmake, шрифт Roboto с кириллицей).
 * buildPdfDefinition — чистая функция (проверяется тестами),
 * downloadPdf — загрузка в браузере (библиотека подгружается по требованию).
 */
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { GROUP_NAMES } from '../engine/catalog/library';
import { formatRu, toDayNum } from '../engine/dates';
import type { ProjectInput, ScheduleResult } from '../engine/types';

const LEVEL_RU = { high: 'высокая', medium: 'средняя', low: 'низкая' } as const;

export function buildPdfDefinition(result: ScheduleResult, input: ProjectInput, opts: { onlyCritical?: boolean } = {}): TDocumentDefinitions {
  const start = toDayNum(result.projectStart);
  const end = toDayNum(result.projectFinish) + 1;
  const span = Math.max(1, end - start);
  const ops = (opts.onlyCritical ? result.operations.filter((o) => o.critical) : result.operations).filter((o) => o.calendarDays > 0 || !o.resolved);
  const BAR_W = 180;

  const bar = (es: number, ef: number, critical: boolean, curing: boolean): Content => {
    const x = ((es - start) / span) * BAR_W;
    const w = Math.max(1.5, ((Math.max(ef, es + 0.3) - es) / span) * BAR_W);
    return {
      canvas: [
        { type: 'rect', x: 0, y: 1, w: BAR_W, h: 6, color: '#f1f1f4' },
        { type: 'rect', x, y: 1, w, h: 6, color: critical ? '#e5484d' : curing ? '#9e9aa8' : '#3e63dd' },
      ],
    };
  };

  const body: Content[][] = [[
    { text: '№', style: 'th' }, { text: 'Операция', style: 'th' }, { text: 'Место', style: 'th' },
    { text: 'Начало', style: 'th' }, { text: 'Оконч.', style: 'th' }, { text: 'Дн.', style: 'th' },
    { text: 'Резерв', style: 'th' }, { text: `${formatRu(result.projectStart)} — ${formatRu(result.projectFinish)}`, style: 'th' },
  ]];
  ops.forEach((o, i) => {
    body.push([
      { text: String(i + 1) },
      { text: `${o.name}${o.resolved ? '' : ' [НЕТ ДАННЫХ]'}`, bold: o.critical, color: o.critical ? '#b42318' : undefined },
      { text: o.locationLabel.split(' / ').slice(2).join(' / ') || o.locationLabel },
      { text: formatRu(o.start) },
      { text: formatRu(o.finish) },
      { text: String(o.calendarDays) },
      { text: String(o.totalFloat) },
      bar(o.es, o.ef, o.critical, o.kind === 'curing'),
    ]);
  });

  const sev: Record<string, string> = { error: 'Ошибка', warning: 'Внимание', info: 'Инфо' };
  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [24, 28, 24, 28],
    defaultStyle: { font: 'Roboto', fontSize: 7 },
    styles: { h1: { fontSize: 14, bold: true }, h2: { fontSize: 10, bold: true, margin: [0, 8, 0, 4] }, th: { bold: true, fillColor: '#eeeeee' } },
    info: { title: `ГПР — ${input.name}`, creator: 'Universal Construction Schedule Engine' },
    footer: (page: number, pages: number) => ({
      text: `Движок ${result.meta.engineVersion}, правила ${result.meta.rulesetVersion}, исходные данные #${result.meta.inputHash} · стр. ${page}/${pages}`,
      fontSize: 6, margin: [24, 8, 24, 0], color: '#777777',
    }),
    content: [
      { text: `ГПР: ${input.name}`, style: 'h1' },
      {
        text: `Город: Астана · Виды работ: ${input.workGroups.map((g) => GROUP_NAMES[g]).join(', ')} · Старт ${formatRu(result.projectStart)} · Окончание ${formatRu(result.projectFinish)}${result.projectFinishWithBuffer !== result.projectFinish ? ` (с резервом на риски ${formatRu(result.projectFinishWithBuffer)})` : ''} · ${result.durationCalendarDays} кал. дн. · Достоверность: ${LEVEL_RU[result.confidence.level]} (${Math.round(result.confidence.score * 100)} %)`,
        margin: [0, 4, 0, 4],
      },
      { text: 'Предупреждения и риски', style: 'h2' },
      { ul: result.warnings.map((w) => `${sev[w.severity]}: ${w.text}`) },
      { text: opts.onlyCritical ? 'Критический путь' : 'График операций', style: 'h2' },
      {
        table: { headerRows: 1, widths: [18, '*', 120, 44, 44, 22, 26, BAR_W], body },
        layout: 'lightHorizontalLines',
      },
      { text: 'Допущения, требующие подтверждения', style: 'h2', pageBreak: 'before' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 90, 110, 260],
          body: [
            [{ text: 'Параметр', style: 'th' }, { text: 'Значение', style: 'th' }, { text: 'Статус', style: 'th' }, { text: 'Источник', style: 'th' }],
            ...result.assumptions.filter((a) => a.status === 'assumption' || a.status === 'missing').map((a) => [a.label, a.value, a.status === 'missing' ? 'нет данных' : 'сценарий', a.source]),
          ],
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };
}

export async function downloadPdf(result: ScheduleResult, input: ProjectInput, filename: string, opts: { onlyCritical?: boolean } = {}) {
  const pdfMakeMod = await import('pdfmake/build/pdfmake');
  const vfsMod = await import('pdfmake/build/vfs_fonts');
  const pdfMake = (pdfMakeMod as unknown as { default: typeof import('pdfmake') }).default ?? pdfMakeMod;
  const vfs = (vfsMod as unknown as { default: Record<string, string> }).default ?? vfsMod;
  pdfMake.addVirtualFileSystem(vfs);
  const blob = await (pdfMake.createPdf(buildPdfDefinition(result, input, opts)) as unknown as { getBlob(): Promise<Blob> }).getBlob();
  triggerDownload(blob, filename);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
