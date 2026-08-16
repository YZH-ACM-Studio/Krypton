/**
 * Competitive Companion / CPH payload for public problem samples.
 *
 * Competitive Companion's Hydro parser only auto-matches a hardcoded domain
 * list and scrapes ui-default selectors. This module:
 *   1. Builds the same JSON Task shape CPH listens for on :27121
 *   2. Posts it as a simple (non-preflight) request so an HTTPS/HTTP OJ
 *      page can reach localhost without CORS
 *   3. Builds a whole-contest batch only for individual ACM/IOI contests
 *   4. Maps a local CPH source file onto the existing `/p/:pid/submit` POST
 *
 * Exam Mode must not call these helpers. CPH's own Submit button only queues
 * Codeforces / CSES / Kattis; this site cannot poll that queue from a web
 * page (CORS + CF-only gate), so submit-back is a same-origin FormData POST.
 */

import { fetchHydroResponse, readHydroResponseError } from './error-presenter';
import { parseMemoryMB, parseTimeMS } from './judge-config';
import { extractSamples } from './samples';

export const CPH_PORT = 27121;

/** Same default listeners Competitive Companion fans out to. */
export const COMPANION_PORTS = [27121, 1327, 4244, 6174, 10042, 10043, 10045] as const;

export const COMPANION_CONTEST_RULES = ['acm', 'ioi', 'strictioi'] as const;

export const COMPANION_SUBMIT_MAX_BYTES = 2 * 1024 * 1024;

export interface CompanionTest {
  input: string;
  output: string;
}

export interface CompanionBatch {
  id: number;
  size: number;
}

export interface CompanionTask {
  name: string;
  group: string;
  url: string;
  interactive: boolean;
  memoryLimit: number;
  timeLimit: number;
  tests: CompanionTest[];
  testType: 'single';
  input: { type: 'stdin' };
  output: { type: 'stdout' };
  languages: { java: { mainClass: string; taskClass: string } };
  batch?: CompanionBatch;
}

export type CompanionContestDenial = 'exam_mode' | 'team' | 'rule' | 'empty';

export type CompanionContestEligibility =
  | { allowed: true }
  | { allowed: false; reason: CompanionContestDenial; message: string };

export interface CompanionContestProblemRef {
  letter: string;
  title: string;
  href: string;
}

export interface CompanionSkip {
  letter: string;
  reason: string;
}

const BLOCKED_PROBLEM_KINDS = new Set(['subjective', 'objective', 'program_fill', 'function']);
const BLOCKED_CONFIG_TYPES = new Set(['objective', 'submit_answer', 'program_fill', 'function']);

const EXTENSION_LANG_PREFERENCE: Record<string, string[]> = {
  cpp: ['cc.cc17', 'cc.cc20', 'cc.cc14', 'cc.cc11', 'cc'],
  cc: ['cc.cc17', 'cc.cc20', 'cc.cc14', 'cc.cc11', 'cc'],
  cxx: ['cc.cc17', 'cc.cc20', 'cc.cc14', 'cc.cc11', 'cc'],
  c: ['c'],
  py: ['py.py3', 'py.pypy3', 'py'],
  java: ['java'],
  js: ['js'],
  mjs: ['js'],
  go: ['go'],
  rs: ['rs'],
  rb: ['rb'],
  hs: ['hs'],
  cs: ['cs'],
  kt: ['kt.jvm', 'kt'],
  pas: ['pas'],
  php: ['php'],
  sh: ['bash'],
};

/** CPH stores Codeforces compiler ids; used when a file name is unavailable. */
const CPH_LANGUAGE_ID_FAMILY: Record<number, string> = {
  43: 'c',
  50: 'cpp',
  54: 'cpp',
  61: 'cpp',
  73: 'cpp',
  80: 'cpp',
  89: 'cpp',
  7: 'py',
  31: 'py',
  70: 'py',
  36: 'java',
  60: 'java',
  87: 'java',
  32: 'go',
  49: 'rs',
  9: 'cs',
  34: 'js',
  55: 'js',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function javaTaskClassFromName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_ -]/g, '');
  let taskClass = '';
  let nextCapital = true;
  for (const char of cleaned) {
    const isLetter = /[a-z]/i.test(char);
    const isDigit = /[0-9]/.test(char);
    if (isLetter || (isDigit && taskClass.length > 0)) {
      taskClass += nextCapital ? char.toUpperCase() : char;
      nextCapital = false;
    } else {
      nextCapital = true;
    }
  }
  return taskClass || 'Task';
}

export function companionProblemName(pid: string, title: string): string {
  const id = pid.trim();
  const heading = title.trim() || id || 'Problem';
  if (!id || heading === id || heading.startsWith(`#${id}`)) return heading;
  return `#${id}. ${heading}`;
}

export function contestProblemLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`contest problem index is not a non-negative integer: ${String(index)}`);
  let n = index + 1;
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

export function companionContestName(letter: string, title: string): string {
  const heading = title.trim() || letter.trim() || 'Problem';
  const prefix = letter.trim();
  if (!prefix) return heading;
  if (heading === prefix || heading.startsWith(`${prefix}.`)) return heading;
  return `${prefix}. ${heading}`;
}

export function companionContestEligibility(input: {
  rule?: unknown;
  participationMode?: unknown;
  examModeEnabled?: unknown;
  problemCount?: unknown;
}): CompanionContestEligibility {
  if (input.examModeEnabled === true) {
    return { allowed: false, reason: 'exam_mode', message: '考试壳不能把题目发到本机 CPH' };
  }
  if (input.participationMode === 'team') {
    return { allowed: false, reason: 'team', message: '团队赛不能整场导入 CPH' };
  }
  if (typeof input.rule !== 'string' || !COMPANION_CONTEST_RULES.includes(input.rule as (typeof COMPANION_CONTEST_RULES)[number])) {
    return { allowed: false, reason: 'rule', message: '只有个人 ACM / IOI 赛可以整场导入 CPH' };
  }
  if (input.problemCount !== undefined && (typeof input.problemCount !== 'number' || !Number.isInteger(input.problemCount) || input.problemCount < 1)) {
    return { allowed: false, reason: 'empty', message: '这场比赛没有可导入的题目' };
  }
  return { allowed: true };
}

function withTrailingNewline(text: string): string {
  if (!text) return '';
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function companionTimeLimitMs(value: unknown, fallback = 1000): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  const parsed = parseTimeMS(value == null ? null : String(value));
  return parsed && parsed > 0 ? parsed : fallback;
}

export function companionMemoryLimitMb(value: unknown, fallback = 256): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.max(1, Math.floor(value));
  const parsed = parseMemoryMB(value == null ? null : String(value));
  return parsed && parsed > 0 ? Math.max(1, Math.floor(parsed)) : fallback;
}

export function createCompanionBatch(size: number, id: number = Date.now()): CompanionBatch {
  if (!Number.isInteger(size) || size < 1) throw new Error(`companion batch size must be a positive integer: ${String(size)}`);
  return { id, size };
}

export function buildCompanionTask(input: {
  name: string;
  group?: string;
  url: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: CompanionTest[];
  interactive?: boolean;
  batch?: CompanionBatch;
}): CompanionTask {
  const name = input.name.trim() || 'Problem';
  const timeLimit = Number.isFinite(input.timeLimitMs) && input.timeLimitMs > 0 ? Math.floor(input.timeLimitMs) : 1000;
  const memoryLimit = Number.isFinite(input.memoryLimitMb) && input.memoryLimitMb > 0 ? Math.floor(input.memoryLimitMb) : 256;
  const task: CompanionTask = {
    name,
    group: (input.group || 'Krypton').trim() || 'Krypton',
    url: input.url,
    interactive: input.interactive === true,
    memoryLimit,
    timeLimit,
    tests: input.tests.map((test) => ({
      input: withTrailingNewline(test.input),
      output: withTrailingNewline(test.output),
    })),
    testType: 'single',
    input: { type: 'stdin' },
    output: { type: 'stdout' },
    languages: {
      java: {
        mainClass: 'Main',
        taskClass: javaTaskClassFromName(name),
      },
    },
  };
  if (input.batch) task.batch = input.batch;
  return task;
}

export function companionPostUrl(host: string, port: number): string {
  return `http://${host}:${port}/`;
}

export async function sendCompanionTask(task: CompanionTask, fetchImpl?: typeof fetch): Promise<number> {
  const body = JSON.stringify(task);
  const init: RequestInit = {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body,
  };
  const post = (url: string) =>
    fetchImpl ? fetchImpl(url, init) : fetchHydroResponse(url, init, '本机没有收到题目');
  const attempts = COMPANION_PORTS.flatMap((port) =>
    ['127.0.0.1', 'localhost'].map((host) =>
      post(companionPostUrl(host, port)).then(
        () => true,
        () => false,
      ),
    ),
  );
  const settled = await Promise.all(attempts);
  const accepted = settled.filter(Boolean).length;
  if (accepted === 0) throw new Error('本机没有收到题目。请先打开 VS Code 里的 CPH。');
  return accepted;
}

export async function sendCompanionTasks(tasks: CompanionTask[], fetchImpl?: typeof fetch): Promise<number> {
  if (tasks.length === 0) throw new Error('没有可发送的题目');
  let accepted = 0;
  for (const task of tasks) {
    accepted += await sendCompanionTask(task, fetchImpl);
  }
  return accepted;
}

function samplesFromStructuredView(view: unknown): CompanionTest[] {
  const root = asRecord(view);
  const examples = asRecord(root?.examples);
  const items = examples?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const row = asRecord(item);
    return {
      input: row?.inputEmpty === true ? '' : readString(row?.input),
      output: row?.outputEmpty === true ? '' : readString(row?.output),
    };
  });
}

function isBlockedProgrammingProblem(kind: string, type: string): boolean {
  return BLOCKED_PROBLEM_KINDS.has(kind) || BLOCKED_CONFIG_TYPES.has(type);
}

export function companionTaskFromProblemPage(input: {
  payload: unknown;
  url: string;
  letter?: string;
  group?: string;
  batch?: CompanionBatch;
}): { ok: true; task: CompanionTask } | { ok: false; reason: string } {
  const payload = asRecord(input.payload);
  if (!payload) return { ok: false, reason: '题目响应不是对象' };
  const examMode = asRecord(payload.examMode);
  if (examMode?.enabled === true) return { ok: false, reason: '考试壳题目不能导入 CPH' };
  const pdoc = asRecord(payload.pdoc);
  if (!pdoc) return { ok: false, reason: '题目响应缺少题面' };
  const kind = readString(pdoc.problemKind);
  const configValue = pdoc.config;
  if (typeof configValue === 'string') return { ok: false, reason: '题目配置未解析，不能导入' };
  const config = asRecord(configValue) || {};
  const type = readString(config.type) || 'default';
  if (isBlockedProgrammingProblem(kind, type)) return { ok: false, reason: '非编程题不能导入 CPH' };
  const title = readString(pdoc.title) || readString(pdoc.pid) || String(pdoc.docId || 'Problem');
  const name = input.letter ? companionContestName(input.letter, title) : companionProblemName(readString(pdoc.pid) || String(pdoc.docId || ''), title);
  const structured = samplesFromStructuredView(pdoc.programmingStatementView);
  const tests = structured.length > 0 ? structured : extractSamples(pdoc.content as string | Record<string, string> | null | undefined);
  return {
    ok: true,
    task: buildCompanionTask({
      name,
      group: input.group,
      url: input.url,
      timeLimitMs: companionTimeLimitMs(config.time ?? config.timeMin),
      memoryLimitMb: companionMemoryLimitMb(config.memory ?? config.memoryMin),
      tests,
      interactive: type === 'interactive' || type === 'communication',
      batch: input.batch,
    }),
  };
}

export async function fetchCompanionProblemPayload(href: string, fetchImpl?: typeof fetch): Promise<unknown> {
  const init: RequestInit = {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  const response = fetchImpl ? await fetchImpl(href, init) : await fetchHydroResponse(href, init, '题目加载失败');
  if (!response.ok) throw new Error(await readHydroResponseError(response, '题目加载失败'));
  return response.json();
}

export async function importContestCompanionTasks(
  input: {
    eligibility: CompanionContestEligibility;
    contestTitle: string;
    origin: string;
    problems: CompanionContestProblemRef[];
  },
  fetchProblem: (href: string) => Promise<unknown> = fetchCompanionProblemPayload,
): Promise<{ tasks: CompanionTask[]; skipped: CompanionSkip[] }> {
  if (!input.eligibility.allowed) throw new Error(input.eligibility.message);
  if (input.problems.length === 0) throw new Error('这场比赛没有可导入的题目');
  const group = `Krypton - ${input.contestTitle.trim() || 'Contest'}`;
  const built: CompanionTask[] = [];
  const skipped: CompanionSkip[] = [];
  const pending: Array<{ letter: string; result: { ok: true; task: CompanionTask } | { ok: false; reason: string } }> = [];
  for (const problem of input.problems) {
    const payload = await fetchProblem(problem.href);
    const result = companionTaskFromProblemPage({
      payload,
      url: new URL(problem.href, input.origin).href,
      letter: problem.letter,
      group,
    });
    if (!result.ok && result.reason === '考试壳题目不能导入 CPH') throw new Error(result.reason);
    pending.push({ letter: problem.letter, result });
  }
  const importable = pending.filter((item) => item.result.ok);
  if (importable.length === 0) {
    const first = pending[0];
    throw new Error(first && !first.result.ok ? `没有可导入的编程题（${first.result.reason}）` : '没有可导入的编程题');
  }
  const batch = createCompanionBatch(importable.length);
  for (const item of pending) {
    if (!item.result.ok) {
      skipped.push({ letter: item.letter, reason: item.result.reason });
      continue;
    }
    built.push({ ...item.result.task, batch });
  }
  return { tasks: built, skipped };
}

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function pickPreferredLang(candidates: string[], allowedLangs: string[]): string | null {
  const allowed = allowedLangs.filter((lang) => lang && lang !== '_');
  const pool = allowed.length > 0 ? allowed : candidates;
  for (const candidate of candidates) {
    const exact = pool.find((lang) => lang === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const family = pool.find((lang) => lang === candidate || lang.startsWith(`${candidate}.`) || (candidate.startsWith(`${lang}.`) && lang.length > 0));
    if (family) return family;
    const prefix = candidate.includes('.') ? candidate.slice(0, candidate.indexOf('.')) : candidate;
    const prefixed = pool.find((lang) => lang === prefix || lang.startsWith(`${prefix}.`));
    if (prefixed) return prefixed;
  }
  return null;
}

export function mapCompanionLanguage(input: { filename?: string; languageId?: number; allowedLangs: string[] }): { lang: string } | { reason: string } {
  if (input.allowedLangs.includes('_') && input.allowedLangs.length === 1) {
    return { reason: '这道题不是编程提交，不能从 CPH 回传' };
  }
  const extension = input.filename ? extensionOf(input.filename) : '';
  const fromFile = extension ? EXTENSION_LANG_PREFERENCE[extension] : undefined;
  const family = input.languageId != null ? CPH_LANGUAGE_ID_FAMILY[input.languageId] : undefined;
  const fromId = family ? EXTENSION_LANG_PREFERENCE[family] : undefined;
  const candidates = fromFile || fromId;
  if (!candidates) return { reason: '无法从文件名识别语言，请手动选择' };
  const lang = pickPreferredLang(candidates, input.allowedLangs);
  if (!lang) return { reason: '这道题不允许该语言' };
  return { lang };
}

export function sameOriginCompanionUrl(raw: string, origin: string): string {
  const target = new URL(raw, origin);
  if (target.origin !== new URL(origin).origin) throw new Error('提交响应包含非本站地址');
  return `${target.pathname}${target.search}${target.hash}`;
}

export async function readCompanionSourceFile(file: File, maxBytes = COMPANION_SUBMIT_MAX_BYTES): Promise<string> {
  if (file.size > maxBytes) throw new Error(`源码超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB，拒绝提交`);
  const text = await file.text();
  if (!text.trim()) throw new Error('源码文件是空的');
  return text;
}

export async function submitCompanionSolution(
  input: {
    submitUrl: string;
    lang: string;
    code: string;
    origin: string;
    tid?: string;
    practiceContextId?: string;
  },
  fetchImpl?: typeof fetch,
): Promise<{ rid?: string; url: string }> {
  if (!input.lang.trim()) throw new Error('请选择提交语言');
  if (!input.code.trim()) throw new Error('作答内容不能为空');
  const form = new FormData();
  form.append('lang', input.lang);
  form.append('code', input.code);
  if (input.tid) form.append('tid', input.tid);
  if (input.practiceContextId) form.append('practiceContextId', input.practiceContextId);
  const init: RequestInit = {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    redirect: 'manual',
  };
  const response = fetchImpl
    ? await fetchImpl(input.submitUrl, init)
    : await fetchHydroResponse(input.submitUrl, init, '回传提交失败');
  if (!response.ok && response.status !== 0) {
    throw new Error(await readHydroResponseError(response, '回传提交失败'));
  }
  if (response.status === 200) {
    const payload: unknown = await response.json().catch(() => null);
    const body = asRecord(payload) || {};
    if (typeof body.url === 'string' && body.url.trim()) {
      return { rid: typeof body.rid === 'string' ? body.rid : undefined, url: sameOriginCompanionUrl(body.url, input.origin) };
    }
    if (typeof body.rid === 'string' && body.rid.trim()) {
      return { rid: body.rid, url: sameOriginCompanionUrl(`/record/${body.rid}`, input.origin) };
    }
  }
  throw new Error('提交已发出，但响应里没有记录地址');
}
