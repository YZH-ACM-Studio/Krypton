import { createRequestId } from '@/lib/request-id';
import type { SetWorkspace } from './model';

export interface EndCodeDraft {
  pid: number;
  code: string;
  lang: string;
  autoSaveId: string;
}
const prefix = 'set-end-save:';
function key(ws: SetWorkspace): string {
  if (!ws.officialRound) throw new Error('没有可保存的正式轮次。');
  return `${prefix}${ws.tid}:${ws.officialRound.id}`;
}
export function readEndCodeDrafts(ws: SetWorkspace, storage: Storage = sessionStorage): EndCodeDraft[] {
  const raw = storage.getItem(key(ws));
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('结束前代码草稿格式无效。');
  return value.map((row: unknown) => {
    if (
      !row ||
      typeof row !== 'object' ||
      !('pid' in row) ||
      !('code' in row) ||
      !('lang' in row) ||
      !('autoSaveId' in row) ||
      typeof row.pid !== 'number' ||
      !Number.isSafeInteger(row.pid) ||
      typeof row.code !== 'string' ||
      typeof row.lang !== 'string' ||
      typeof row.autoSaveId !== 'string'
    ) { throw new Error('结束前代码草稿内容无效。'); }
    return { pid: row.pid, code: row.code, lang: row.lang, autoSaveId: row.autoSaveId };
  });
}
export function rememberEndCode(ws: SetWorkspace, pid: number, code: string, lang: string, storage: Storage = sessionStorage) {
  if (!ws.rules?.autoSaveBeforeEnd || !ws.officialRound || !ws.action.canSubmit) return;
  const rows = readEndCodeDrafts(ws, storage);
  const prior = rows.find((row) => row.pid === pid);
  if (prior?.code === code && prior.lang === lang) return;
  storage.setItem(key(ws), JSON.stringify([...rows.filter((row) => row.pid !== pid), { pid, code, lang, autoSaveId: createRequestId() }]));
}
export function endCodeRequestId(ws: SetWorkspace, pid: number, code: string, lang: string): string | undefined {
  if (!ws.rules?.autoSaveBeforeEnd) return undefined;
  rememberEndCode(ws, pid, code, lang);
  return readEndCodeDrafts(ws).find((row) => row.pid === pid && row.code === code && row.lang === lang)?.autoSaveId;
}
export function acknowledgeEndCode(ws: SetWorkspace, pid: number, code: string, lang: string, storage: Storage = sessionStorage) {
  if (!ws.rules?.autoSaveBeforeEnd || !ws.officialRound) return;
  const rows = readEndCodeDrafts(ws, storage);
  storage.setItem(key(ws), JSON.stringify(rows.filter((row) => row.pid !== pid || row.code !== code || row.lang !== lang)));
}
export function endSaveDue(ws: SetWorkspace, now: number): boolean {
  if (!ws.rules?.autoSaveBeforeEnd || !ws.officialRound || !ws.action.canSubmit || ws.phase !== 'answering') return false;
  const end = Date.parse(ws.window.personalEndAt ?? ws.window.endAt);
  return now >= end - 30_000 && now < end;
}
export async function saveEndCodeDrafts(ws: SetWorkspace, post: (url: string, body: Record<string, unknown>, message: string) => Promise<unknown>) {
  if (!ws.officialRound || !ws.urls.submitCode) return;
  const visible = new Map(ws.groups.flatMap((group) => group.items.map((item) => [item.pid, item] as const)));
  for (const row of readEndCodeDrafts(ws)) {
    const item = visible.get(row.pid);
    if (!item) throw new Error('代码草稿不属于当前试卷，请刷新核对。');
    let filled = row.code.trim().length > 0;
    if (filled && (item.kind === 'function' || item.kind === 'program_fill')) {
      const regions: unknown = JSON.parse(row.code);
      if (!regions || typeof regions !== 'object' || Array.isArray(regions) || Object.values(regions).some((value) => typeof value !== 'string')) { throw new Error('代码作答区格式无效。'); }
      filled = Object.values(regions).some((value: string) => value.trim().length > 0);
    }
    if (!filled) {
      acknowledgeEndCode(ws, row.pid, row.code, row.lang);
      continue;
    }
    const result = await post(
      ws.urls.submitCode.replace('__PID__', encodeURIComponent(String(row.pid))),
      { code: row.code, lang: row.lang, autoSaveId: row.autoSaveId, roundId: ws.officialRound.id },
      '结束前保存代码失败。',
    );
    if (!result || typeof result !== 'object' || !('rid' in result) || typeof result.rid !== 'string') throw new Error('保存代码响应缺少提交记录。');
    acknowledgeEndCode(ws, row.pid, row.code, row.lang);
  }
}
