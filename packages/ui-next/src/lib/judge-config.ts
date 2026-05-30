/**
 * Judge config (config.yaml) parsing, serializing, validation, and helpers
 * for the problem-config UI rewrite.
 *
 * Hydro's judge config supports both a flat `cases` list and grouped
 * `subtasks`, plus per-case time/memory overrides, dependency `if`,
 * checker/interactor configuration, and language whitelists. This module
 * models all of that as structured state, with a best-effort round-trip
 * to YAML.
 */

import * as YAML from 'yaml';

/* ────────────────────────────────────────────────────────────────── */
/*  Types                                                             */
/* ────────────────────────────────────────────────────────────────── */

export type ProblemType =
  | 'default'
  | 'objective'
  | 'submit_answer'
  | 'interactive'
  | 'communication'
  | 'fill_function';

export type CheckerType =
  | 'default'
  | 'strict'
  | 'float'
  | 'lemon'
  | 'syzoj'
  | 'testlib'
  | 'custom';

export type ScoreMode = 'sum' | 'min' | 'max';

export interface JudgeCase {
  input: string;
  output: string;
  time?: string;
  memory?: string;
}

export interface JudgeSubtask {
  /** numeric id; we assign sequentially when serializing if absent */
  id?: number;
  score?: number;
  type?: ScoreMode;
  time?: string;
  memory?: string;
  /** dependency: ids of subtasks that must pass first */
  if?: number[];
  cases: JudgeCase[];
}

export interface JudgeConfig {
  type: ProblemType;
  time?: string;
  memory?: string;
  checker?: string;
  checker_type?: CheckerType | string;
  /** for checker_type='float' */
  float_relative?: number;
  float_absolute?: number;
  /** default score aggregation when no subtasks defined */
  score?: ScoreMode;
  /** allowed languages (empty = all) */
  langs?: string[];

  // Interactive / communication
  interactor?: string;
  user?: string;
  manager?: string;

  // Submit answer
  filename?: string;

  /**
   * Per-language multipliers Hydro actually consumes.
   * The UI shows ABSOLUTE values per language but persists rates here so
   * the upstream judge runtime doesn't have to change.
   */
  time_limit_rate?: Record<string, number>;
  memory_limit_rate?: Record<string, number>;

  // The actual problem data — only ONE of cases/subtasks is used by hydrojudge.
  cases?: JudgeCase[];
  subtasks?: JudgeSubtask[];
}

/* ────────────────────────────────────────────────────────────────── */
/*  Time / memory parsing & formatting                                 */
/* ────────────────────────────────────────────────────────────────── */

/** Parse a hydro time string ('1s', '1500ms', '0.5s') → milliseconds, or null. */
export function parseTimeMS(input: string | undefined | null): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  // Allow bare numbers; default unit ms
  const m = s.match(/^(-?\d*\.?\d+)\s*(ms|s|seconds?|second|secs?|sec)?$/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2] || 'ms';
  if (unit === 'ms') return Math.round(value);
  return Math.round(value * 1000);
}

/** Parse a hydro memory string ('256m', '512k', '1g') → megabytes (float), or null. */
export function parseMemoryMB(input: string | undefined | null): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(-?\d*\.?\d+)\s*(b|k|kb|m|mb|g|gb)?$/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2] || 'mb';
  if (unit === 'b') return value / (1024 * 1024);
  if (unit === 'k' || unit === 'kb') return value / 1024;
  if (unit === 'g' || unit === 'gb') return value * 1024;
  return value; // m / mb
}

/** Format milliseconds as a human-friendly Hydro time string. */
export function formatTime(ms: number | null | undefined, preferUnit?: 'ms' | 's'): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (preferUnit === 'ms') return `${Math.round(ms)}ms`;
  if (preferUnit === 's') return `${(ms / 1000).toString()}s`;
  if (ms < 1000 || ms % 1000 !== 0) return `${Math.round(ms)}ms`;
  return `${ms / 1000}s`;
}

/** Format megabytes as a Hydro memory string. */
export function formatMemory(mb: number | null | undefined, preferUnit?: 'k' | 'm' | 'g'): string {
  if (mb == null || !Number.isFinite(mb)) return '';
  if (preferUnit === 'k') return `${Math.round(mb * 1024)}k`;
  if (preferUnit === 'g') return `${(mb / 1024).toString()}g`;
  if (preferUnit === 'm') return `${Math.round(mb)}m`;
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}g`;
  if (mb < 1 && mb > 0) return `${Math.round(mb * 1024)}k`;
  return `${Math.round(mb)}m`;
}

/**
 * Split a Hydro time string into `{ value: number, unit: 'ms' | 's' }`
 * for the dual-input picker. Empty/invalid → `{ value: '', unit: 's' }`.
 */
export function splitTime(input: string | undefined | null): { value: string; unit: 'ms' | 's' } {
  if (!input) return { value: '', unit: 's' };
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?\d*\.?\d+)\s*(ms|s)?$/);
  if (!m) return { value: '', unit: 's' };
  const unit = (m[2] === 'ms' ? 'ms' : 's') as 'ms' | 's';
  return { value: m[1], unit };
}

/** Split a Hydro memory string into `{ value, unit: 'k'|'m'|'g' }`. */
export function splitMemory(input: string | undefined | null): { value: string; unit: 'k' | 'm' | 'g' } {
  if (!input) return { value: '', unit: 'm' };
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?\d*\.?\d+)\s*(b|k|kb|m|mb|g|gb)?$/);
  if (!m) return { value: '', unit: 'm' };
  const unit = m[2] === 'k' || m[2] === 'kb' ? 'k'
    : m[2] === 'g' || m[2] === 'gb' ? 'g'
      : 'm';
  return { value: m[1], unit };
}

export function joinTime(value: string, unit: 'ms' | 's'): string | undefined {
  if (!value.trim()) return undefined;
  return `${value}${unit}`;
}

export function joinMemory(value: string, unit: 'k' | 'm' | 'g'): string | undefined {
  if (!value.trim()) return undefined;
  return `${value}${unit}`;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Parsing                                                           */
/* ────────────────────────────────────────────────────────────────── */

export function parseJudgeConfig(yaml: string): { config: JudgeConfig; error?: string } {
  if (!yaml.trim()) {
    return { config: emptyConfig() };
  }
  try {
    const raw = YAML.parse(yaml);
    if (!raw || typeof raw !== 'object') return { config: emptyConfig() };
    const config: JudgeConfig = {
      type: (raw.type || 'default') as ProblemType,
      time: typeof raw.time === 'string' ? raw.time : raw.time != null ? String(raw.time) : undefined,
      memory: typeof raw.memory === 'string' ? raw.memory : raw.memory != null ? String(raw.memory) : undefined,
      checker: raw.checker || undefined,
      checker_type: raw.checker_type || undefined,
      score: raw.score && ['sum', 'min', 'max'].includes(raw.score) ? raw.score : undefined,
      langs: Array.isArray(raw.langs) ? raw.langs.map(String) : undefined,
      interactor: raw.interactor || undefined,
      user: raw.user || undefined,
      manager: raw.manager || undefined,
      filename: raw.filename || undefined,
    };
    if (typeof raw.float_relative === 'number') config.float_relative = raw.float_relative;
    if (typeof raw.float_absolute === 'number') config.float_absolute = raw.float_absolute;
    if (raw.time_limit_rate && typeof raw.time_limit_rate === 'object') {
      const map: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.time_limit_rate)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) map[k] = n;
      }
      if (Object.keys(map).length) config.time_limit_rate = map;
    }
    if (raw.memory_limit_rate && typeof raw.memory_limit_rate === 'object') {
      const map: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.memory_limit_rate)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) map[k] = n;
      }
      if (Object.keys(map).length) config.memory_limit_rate = map;
    }
    if (Array.isArray(raw.cases)) config.cases = raw.cases.map(normalizeCase).filter(Boolean) as JudgeCase[];
    if (Array.isArray(raw.subtasks)) {
      config.subtasks = raw.subtasks.map((s: any, i: number) => normalizeSubtask(s, i + 1)).filter(Boolean) as JudgeSubtask[];
    }
    return { config };
  } catch (err: any) {
    return { config: emptyConfig(), error: err?.message || String(err) };
  }
}

function normalizeCase(raw: any): JudgeCase | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw.input || raw.in || '';
  const output = raw.output || raw.out || '';
  if (!input && !output) return null;
  const c: JudgeCase = { input: String(input), output: String(output) };
  if (raw.time != null) c.time = String(raw.time);
  if (raw.memory != null) c.memory = String(raw.memory);
  return c;
}

function normalizeSubtask(raw: any, fallbackId: number): JudgeSubtask | null {
  if (!raw || typeof raw !== 'object') return null;
  const cases = Array.isArray(raw.cases) ? raw.cases.map(normalizeCase).filter(Boolean) as JudgeCase[] : [];
  const out: JudgeSubtask = {
    id: typeof raw.id === 'number' ? raw.id : fallbackId,
    cases,
  };
  if (typeof raw.score === 'number') out.score = raw.score;
  if (raw.type && ['min', 'sum', 'max'].includes(raw.type)) out.type = raw.type;
  if (raw.time != null) out.time = String(raw.time);
  if (raw.memory != null) out.memory = String(raw.memory);
  if (Array.isArray(raw.if)) out.if = raw.if.map(Number).filter(Number.isFinite);
  return out;
}

export function emptyConfig(): JudgeConfig {
  return { type: 'default' };
}

/* ────────────────────────────────────────────────────────────────── */
/*  Serializing                                                       */
/* ────────────────────────────────────────────────────────────────── */

export function serializeJudgeConfig(config: JudgeConfig, opts?: { preserveSource?: string }): string {
  const obj: Record<string, any> = {};
  if (config.type && config.type !== 'default') obj.type = config.type;
  if (config.time) obj.time = config.time;
  if (config.memory) obj.memory = config.memory;
  if (config.score) obj.score = config.score;
  if (config.checker_type) obj.checker_type = config.checker_type;
  if (config.checker) obj.checker = config.checker;
  if (typeof config.float_relative === 'number') obj.float_relative = config.float_relative;
  if (typeof config.float_absolute === 'number') obj.float_absolute = config.float_absolute;
  if (config.interactor) obj.interactor = config.interactor;
  if (config.user) obj.user = config.user;
  if (config.manager) obj.manager = config.manager;
  if (config.filename) obj.filename = config.filename;
  if (config.langs && config.langs.length > 0) obj.langs = config.langs;
  if (config.time_limit_rate && Object.keys(config.time_limit_rate).length > 0) {
    obj.time_limit_rate = config.time_limit_rate;
  }
  if (config.memory_limit_rate && Object.keys(config.memory_limit_rate).length > 0) {
    obj.memory_limit_rate = config.memory_limit_rate;
  }

  if (config.subtasks && config.subtasks.length > 0) {
    obj.subtasks = config.subtasks.map((s, i) => {
      const out: Record<string, any> = { id: s.id ?? i + 1 };
      if (typeof s.score === 'number') out.score = s.score;
      if (s.type) out.type = s.type;
      if (s.time) out.time = s.time;
      if (s.memory) out.memory = s.memory;
      if (s.if && s.if.length > 0) out.if = s.if;
      out.cases = s.cases.map(caseToObj);
      return out;
    });
  } else if (config.cases && config.cases.length > 0) {
    obj.cases = config.cases.map(caseToObj);
  }

  // Default type='default' is implicit; only emit when non-default for terseness.
  if (Object.keys(obj).length === 0) obj.type = config.type;

  // If we have an original yaml source and only top-level scalars changed,
  // try a partial rewrite to keep comments. For structural changes (cases /
  // subtasks rewritten) we fall through to full serialization.
  if (opts?.preserveSource) {
    try {
      const doc = YAML.parseDocument(opts.preserveSource);
      const oldTop = doc.toJS() || {};
      const structuralChange =
        JSON.stringify(oldTop.cases || []) !== JSON.stringify(obj.cases || []) ||
        JSON.stringify(oldTop.subtasks || []) !== JSON.stringify(obj.subtasks || []);
      if (!structuralChange) {
        // Update only scalar fields in-place; preserve comments.
        const scalarKeys = [
          'type', 'time', 'memory', 'score', 'checker', 'checker_type',
          'float_relative', 'float_absolute', 'interactor', 'user', 'manager',
          'filename', 'langs',
        ];
        for (const k of scalarKeys) {
          if (obj[k] !== undefined && oldTop[k] !== obj[k]) {
            doc.set(k, obj[k]);
          } else if (obj[k] === undefined && oldTop[k] !== undefined) {
            doc.delete(k);
          }
        }
        return doc.toString();
      }
    } catch { /* fall through to full serialize */ }
  }
  return YAML.stringify(obj, { lineWidth: 0 });
}

function caseToObj(c: JudgeCase): Record<string, any> {
  const o: Record<string, any> = { input: c.input, output: c.output };
  if (c.time) o.time = c.time;
  if (c.memory) o.memory = c.memory;
  return o;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Auto-pair detection                                               */
/* ────────────────────────────────────────────────────────────────── */

export interface PairResult {
  pairs: JudgeCase[];
  unpairedInputs: string[];
  unpairedOutputs: string[];
  /** files that don't look like input/output at all (checker, interactor, …) */
  others: string[];
}

const INPUT_EXTS = ['.in', '.input', '.txt'];
const OUTPUT_EXTS = ['.out', '.ans', '.output', '.txt'];

/**
 * Heuristic auto-pair: for each file, decide if it's an input or output,
 * then look up the matching pair.
 *
 * Rules:
 *   1.in    → 1.out / 1.ans
 *   test1.in → test1.out / test1.ans
 *   input01.txt → output01.txt
 *   data1.in → data1.out / data1.ans
 *   foo.in   → foo.out / foo.ans
 *
 * Files containing "checker", "interactor", "manager", "validator" in their
 * basename are excluded from the input/output pool.
 */
export function autoPair(filenames: string[]): PairResult {
  const others: string[] = [];
  const inputs = new Map<string, string>(); // stem -> filename
  const outputs = new Map<string, string>();

  for (const f of filenames) {
    const lower = f.toLowerCase();
    if (/(?:^|\/)(?:config\.yaml|config\.yml)$/i.test(f)) {
      others.push(f);
      continue;
    }
    if (/(?:checker|interactor|manager|validator|user)\./i.test(lower)) {
      others.push(f);
      continue;
    }
    const cls = classify(f);
    if (cls.kind === 'input') {
      // Don't overwrite if a more specific match already claimed this stem.
      if (!inputs.has(cls.stem)) inputs.set(cls.stem, f);
    } else if (cls.kind === 'output') {
      if (!outputs.has(cls.stem)) outputs.set(cls.stem, f);
    } else {
      others.push(f);
    }
  }

  const pairs: JudgeCase[] = [];
  const stems = new Set([...inputs.keys(), ...outputs.keys()]);
  const sortedStems = [...stems].sort(naturalStemCompare);
  const usedInputs = new Set<string>();
  const usedOutputs = new Set<string>();
  for (const stem of sortedStems) {
    const i = inputs.get(stem);
    const o = outputs.get(stem);
    if (i && o) {
      pairs.push({ input: i, output: o });
      usedInputs.add(i);
      usedOutputs.add(o);
    }
  }

  const unpairedInputs = [...inputs.values()].filter((f) => !usedInputs.has(f));
  const unpairedOutputs = [...outputs.values()].filter((f) => !usedOutputs.has(f));
  return { pairs, unpairedInputs, unpairedOutputs, others };
}

/** Classify a filename as input/output/other and return the stem for pairing. */
export function classify(filename: string): { kind: 'input' | 'output' | 'other'; stem: string } {
  const base = filename.replace(/^.*\//, '');
  const lower = base.toLowerCase();

  // Match common patterns
  // 1.in → stem=1
  const m1 = lower.match(/^(.*?)\.(in|input)$/);
  if (m1) return { kind: 'input', stem: normalizeStem(m1[1]) };
  const m2 = lower.match(/^(.*?)\.(out|ans|output)$/);
  if (m2) return { kind: 'output', stem: normalizeStem(m2[1]) };

  // input01.txt / output01.txt
  const m3 = lower.match(/^input(.*?)\.[\w]+$/);
  if (m3) return { kind: 'input', stem: normalizeStem(m3[1]) };
  const m4 = lower.match(/^output(.*?)\.[\w]+$/);
  if (m4) return { kind: 'output', stem: normalizeStem(m4[1]) };

  // data1.in / data1.out (covered by m1/m2)
  return { kind: 'other', stem: '' };
}

function normalizeStem(s: string): string {
  // Strip common prefixes like "data" / "test" / "case" before the number.
  return s.replace(/^(data|test|case)[-_]?/i, '').replace(/^[-_]+|[-_]+$/g, '');
}

/** Natural sort so "test10" comes after "test2". */
function naturalStemCompare(a: string, b: string): number {
  const re = /(\d+)/g;
  const aParts = a.split(re);
  const bParts = b.split(re);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const pa = aParts[i] ?? '';
    const pb = bParts[i] ?? '';
    const na = Number(pa);
    const nb = Number(pb);
    if (Number.isFinite(na) && Number.isFinite(nb) && pa.match(/^\d+$/) && pb.match(/^\d+$/)) {
      if (na !== nb) return na - nb;
    } else if (pa !== pb) {
      return pa.localeCompare(pb);
    }
  }
  return 0;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Validation                                                        */
/* ────────────────────────────────────────────────────────────────── */

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  message: string;
  /** which subtask id is affected (optional) */
  subtaskId?: number;
}

export function validateConfig(config: JudgeConfig, fileSet: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const referencedFiles = new Set<string>();
  if (config.checker) referencedFiles.add(config.checker);
  if (config.interactor) referencedFiles.add(config.interactor);
  if (config.user) referencedFiles.add(config.user);
  if (config.manager) referencedFiles.add(config.manager);

  const checkCases = (cases: JudgeCase[], stid?: number) => {
    for (const c of cases) {
      if (c.input && !fileSet.has(c.input)) {
        issues.push({ level: 'error', message: `输入文件不存在: ${c.input}`, subtaskId: stid });
      }
      if (c.output && !fileSet.has(c.output)) {
        issues.push({ level: 'error', message: `输出文件不存在: ${c.output}`, subtaskId: stid });
      }
      if (c.input) referencedFiles.add(c.input);
      if (c.output) referencedFiles.add(c.output);
    }
  };

  if (config.subtasks && config.subtasks.length > 0) {
    let totalScore = 0;
    const ids = new Set<number>();
    for (const st of config.subtasks) {
      if (st.id != null) {
        if (ids.has(st.id)) issues.push({ level: 'warning', message: `重复的 subtask id: ${st.id}` });
        ids.add(st.id);
      }
      if (st.cases.length === 0) {
        issues.push({ level: 'warning', message: `Subtask ${st.id ?? '?'} 没有测试用例`, subtaskId: st.id });
      }
      checkCases(st.cases, st.id);
      if (typeof st.score === 'number') totalScore += st.score;
    }
    // Cycle / unknown dep detection
    for (const st of config.subtasks) {
      if (!st.if) continue;
      for (const dep of st.if) {
        if (!ids.has(dep)) {
          issues.push({ level: 'error', message: `Subtask ${st.id} 依赖未知 subtask ${dep}`, subtaskId: st.id });
        }
      }
    }
    if (config.subtasks.length > 0 && hasCycle(config.subtasks)) {
      issues.push({ level: 'error', message: 'Subtask 依赖存在循环' });
    }
    if (totalScore > 0 && totalScore !== 100) {
      issues.push({ level: 'warning', message: `总分为 ${totalScore}，不是 100` });
    }
  } else if (config.cases && config.cases.length > 0) {
    checkCases(config.cases);
  } else if (config.type === 'default' || !config.type) {
    issues.push({ level: 'warning', message: '尚未配置测试用例' });
  }

  if (config.checker_type === 'float' && config.float_relative == null && config.float_absolute == null) {
    issues.push({ level: 'warning', message: 'Float checker 未指定误差精度' });
  }
  if (config.type === 'interactive' && !config.interactor) {
    issues.push({ level: 'error', message: '交互题缺少 interactor 文件' });
  }
  if (config.type === 'communication' && (!config.user || !config.manager)) {
    issues.push({ level: 'error', message: '通信题需要 user 与 manager 文件' });
  }

  return issues;
}

function hasCycle(subtasks: JudgeSubtask[]): boolean {
  const byId = new Map<number, JudgeSubtask>();
  for (const s of subtasks) if (s.id != null) byId.set(s.id, s);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<number, number>();
  for (const id of byId.keys()) color.set(id, WHITE);
  function dfs(id: number): boolean {
    color.set(id, GRAY);
    const node = byId.get(id);
    for (const dep of node?.if || []) {
      const c = color.get(dep);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }
  for (const id of byId.keys()) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Manipulation helpers                                              */
/* ────────────────────────────────────────────────────────────────── */

export function assignSequentialIds(subtasks: JudgeSubtask[]): JudgeSubtask[] {
  return subtasks.map((s, i) => ({ ...s, id: s.id ?? i + 1 }));
}

/** Build a flat pool of all cases (across cases / subtasks). Used when
 *  switching between flat and grouped modes. */
export function flattenCases(config: JudgeConfig): JudgeCase[] {
  if (config.subtasks && config.subtasks.length > 0) {
    return config.subtasks.flatMap((s) => s.cases);
  }
  return config.cases || [];
}
