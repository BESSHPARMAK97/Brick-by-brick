import { useState } from 'react';
import type { ProjectInput, ScheduleResult } from '../engine/types';
import { buildWorkbook } from '../export/excel';
import { downloadPdf, triggerDownload } from '../export/pdf';

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Имя файла латиницей: некоторые браузеры заменяют нелатинские имена загрузок на «download». */
export function safeName(s: string) {
  return [...s.toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('').replace(/[^a-z0-9.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project';
}

export default function ExportMenu({ result, input }: { result: ScheduleResult; input: ProjectInput }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `GPR_${safeName(input.name)}_${result.projectStart}`;
  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <button className="btn" disabled={!!busy} onClick={() => run('xlsx', async () => {
        const buf = await buildWorkbook(result, input);
        triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`);
      })}>{busy === 'xlsx' ? 'Готовлю…' : 'Excel'}</button>
      <button className="btn" disabled={!!busy} onClick={() => run('pdf', () => downloadPdf(result, input, `${base}.pdf`))}>{busy === 'pdf' ? 'Готовлю…' : 'PDF'}</button>
      <button className="btn" disabled={!!busy} onClick={() => run('pdfc', () => downloadPdf(result, input, `${base}_critical.pdf`, { onlyCritical: true }))}>{busy === 'pdfc' ? 'Готовлю…' : 'PDF: крит. путь'}</button>
      {error && <span className="badge critical" title={error}>Ошибка экспорта</span>}
    </>
  );
}
