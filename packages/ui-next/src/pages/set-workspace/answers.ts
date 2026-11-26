import type { WsDraft } from './model';

export const SAVE_HAS_NEW_EDITS = '本次答案已保存，后续修改尚未保存，请再次点击保存。';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the server's confirmed non-acceptance allows a failed operation to be discarded. */
export function saveRejection(raw: Record<string, unknown>): string | null {
  if (raw.accepted !== false) return null;
  if (!isRecord(raw.error) || typeof raw.error.message !== 'string' || raw.error.message.trim() === '') throw new TypeError('保存拒绝响应缺少原因。');
  return raw.error.message;
}

export function validateSaveItems(items: readonly { body: Record<string, string | string[]> }[]): void {
  if (items.length < 1 || items.length > 200) throw new Error('一次只能保存 1 至 200 道题。');
  if (items.some((item) => JSON.stringify(item.body).length > 128 * 1024)) throw new Error('答案内容过长，请缩短后再保存。');
}

function parseAnswerValue(value: unknown, path: string): string | string[] {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.slice();
  throw new TypeError(`${path} must be a string or a list of strings`);
}

function parseAnswerRecord(value: unknown, path: string): Record<string, string | string[]> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  const answers: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    answers[key] = parseAnswerValue(item, `${path}.${key}`);
  }
  return answers;
}

function parseSubmitted(record: Record<string, unknown>, path: string): Record<string, string | string[]> | null {
  if (!Object.hasOwn(record, 'submittedAnswers') || record.submittedAnswers === null) return null;
  return parseAnswerRecord(record.submittedAnswers, `${path}.submittedAnswers`);
}

function parsePid(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a pid`);
  }
  return value;
}

/** Missing or null `answers` is a code-only paper draft. A present but illegal value fails the whole list. */
function parseDraftAnswers(record: Record<string, unknown>, path: string): Record<string, string | string[]> | null {
  if (!Object.hasOwn(record, 'answers') || record.answers === null) return null;
  return parseAnswerRecord(record.answers, `${path}.answers`);
}

export function parseDraftList(raw: unknown): Map<number, WsDraft> {
  if (!isRecord(raw)) throw new TypeError('draft list must be an object');
  if (!Array.isArray(raw.drafts)) throw new TypeError('draft list is missing drafts');
  const drafts = new Map<number, WsDraft>();
  raw.drafts.forEach((item, index) => {
    const path = `drafts.${index}`;
    if (!isRecord(item)) throw new TypeError(`${path} must be an object`);
    const pid = parsePid(item.pid, `${path}.pid`);
    if (drafts.has(pid)) throw new TypeError(`${path}.pid is duplicated`);
    const version = item.version;
    if (version !== undefined && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)) throw new TypeError(`${path}.version is invalid`);
    const score = item.score;
    if (score !== undefined && score !== null && (typeof score !== 'number' || !Number.isFinite(score))) throw new TypeError(`${path}.score is invalid`);
    let judgeResult: WsDraft['judgeResult'];
    if (item.judgeResult !== undefined && item.judgeResult !== null) {
      if (!isRecord(item.judgeResult)) throw new TypeError(`${path}.judgeResult is invalid`);
      judgeResult = {};
      for (const [key, value] of Object.entries(item.judgeResult)) {
        if (value !== 'correct' && value !== 'wrong' && value !== 'partial') throw new TypeError(`${path}.judgeResult is invalid`);
        judgeResult[key] = value;
      }
    }
    drafts.set(pid, {
      ...(version !== undefined ? { version } : {}),
      ...(score !== undefined ? { score } : {}),
      ...(judgeResult !== undefined ? { judgeResult } : {}),
      answers: parseDraftAnswers(item, path),
      submittedAnswers: parseSubmitted(item, path),
    });
  });
  return drafts;
}
