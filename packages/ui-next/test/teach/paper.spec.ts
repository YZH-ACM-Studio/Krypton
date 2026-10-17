// @vitest-environment node
// A static import fails collection while src/pages/teach/paper.ts is absent.
import { describe, expect, it } from 'vitest';
import type { ProblemKind, TeachType } from '@hydrooj/common';

const paperLoaders = import.meta.glob('../../src/pages/teach/paper.ts');
const PAPER_SOURCE = 'src/pages/teach/paper.ts';

const KIND_ORDER: readonly ProblemKind[] = [
  'true_false',
  'single',
  'multi',
  'blank',
  'program_fill',
  'subjective',
  'function',
  'programming',
];

const DEFAULT_SCORES: Record<ProblemKind, number> = {
  true_false: 2,
  single: 2,
  multi: 4,
  blank: 2,
  program_fill: 10,
  function: 10,
  programming: 20,
  subjective: 10,
};

interface TeachPaperProblemInput {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number | null;
  hidden: boolean;
  mine: boolean;
  difficulty: number | null;
}

interface TeachStageInput {
  id: number;
  title: string;
  requireIds: number[];
  pids: number[];
}

interface TeachPaperInput {
  problems: TeachPaperProblemInput[];
  stages: TeachStageInput[] | null;
  examPaperQuotas: Partial<Record<ProblemKind, number>> | null;
}

interface TeachContainerRef {
  type: TeachType;
  rule: string;
}

interface PaperItem {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number | null;
  hidden: boolean;
  stageId: number | null;
}

interface PaperStage {
  id: number;
  title: string;
  requireIds: number[];
}

interface PaperState {
  type: TeachType;
  rule: string;
  items: PaperItem[];
  stages: PaperStage[] | null;
  draw: boolean;
  quotas: Partial<Record<ProblemKind, number>>;
}

interface PaperTarget {
  beforeDocId: number | null;
  stageId: number | null;
}

interface PaperIssue {
  kind: ProblemKind | null;
  issue: 'quota_exceeds_pool' | 'mixed_scores_in_draw' | 'quota_invalid';
}

interface SavedStage {
  id: number;
  title: string;
  requireIds: number[];
  pids: number[];
}

interface PaperApi {
  defaultKindScore: Readonly<Record<ProblemKind, number>>;
  paperFromPayload: (paper: TeachPaperInput, container: TeachContainerRef) => PaperState;
  paperIsScored: (state: PaperState) => boolean;
  normalizePaper: (state: PaperState) => PaperState;
  paperPids: (state: PaperState) => number[];
  paperScores: (state: PaperState) => Record<number, number> | null;
  paperQuotas: (state: PaperState) => Partial<Record<ProblemKind, number>> | null;
  paperStagesForSave: (state: PaperState) => SavedStage[];
  paperNumbering: (state: PaperState) => Map<number, string>;
  paperFullScore: (state: PaperState) => number | null;
  paperSummary: (state: PaperState) => string;
  paperIssues: (state: PaperState) => PaperIssue[];
  insertItems: (state: PaperState, items: PaperItem[], target: PaperTarget) => PaperState;
  moveItem: (state: PaperState, docId: number, target: PaperTarget) => PaperState;
  removeItem: (state: PaperState, docId: number) => PaperState;
  setItemScore: (state: PaperState, docId: number, score: number) => PaperState;
  setGroupScore: (state: PaperState, kind: ProblemKind, score: number) => PaperState;
  setQuota: (state: PaperState, kind: ProblemKind, count: number) => PaperState;
  setDraw: (state: PaperState, on: boolean) => PaperState;
  defaultScoreFor: (state: PaperState, kind: ProblemKind) => number | null;
  paperChangeCount: (base: PaperState, next: PaperState) => number;
}

const nowhere: PaperTarget = { beforeDocId: null, stageId: null };

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

function moduleLoader(loaders: object, source: string): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(loaders)) {
    if (!key.endsWith(source)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadModule(loaders: object, source: string): Promise<object> {
  const load = moduleLoader(loaders, source);
  expect(typeof load, `${source} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${source} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${source} must be a module`);
  return imported;
}

function readScoreTable(value: unknown): Readonly<Record<ProblemKind, number>> {
  expect(typeof value, 'DEFAULT_KIND_SCORE').toBe('object');
  if (typeof value !== 'object' || value === null) throw new TypeError('DEFAULT_KIND_SCORE must be an object');
  return value as Readonly<Record<ProblemKind, number>>;
}

async function loadPaper(): Promise<PaperApi> {
  const paper = await loadModule(paperLoaders, PAPER_SOURCE);
  return {
    defaultKindScore: readScoreTable(readField(paper, 'DEFAULT_KIND_SCORE')),
    paperFromPayload: asFunction<PaperApi['paperFromPayload']>(readField(paper, 'paperFromPayload'), 'paperFromPayload'),
    paperIsScored: asFunction<PaperApi['paperIsScored']>(readField(paper, 'paperIsScored'), 'paperIsScored'),
    normalizePaper: asFunction<PaperApi['normalizePaper']>(readField(paper, 'normalizePaper'), 'normalizePaper'),
    paperPids: asFunction<PaperApi['paperPids']>(readField(paper, 'paperPids'), 'paperPids'),
    paperScores: asFunction<PaperApi['paperScores']>(readField(paper, 'paperScores'), 'paperScores'),
    paperQuotas: asFunction<PaperApi['paperQuotas']>(readField(paper, 'paperQuotas'), 'paperQuotas'),
    paperStagesForSave: asFunction<PaperApi['paperStagesForSave']>(readField(paper, 'paperStagesForSave'), 'paperStagesForSave'),
    paperNumbering: asFunction<PaperApi['paperNumbering']>(readField(paper, 'paperNumbering'), 'paperNumbering'),
    paperFullScore: asFunction<PaperApi['paperFullScore']>(readField(paper, 'paperFullScore'), 'paperFullScore'),
    paperSummary: asFunction<PaperApi['paperSummary']>(readField(paper, 'paperSummary'), 'paperSummary'),
    paperIssues: asFunction<PaperApi['paperIssues']>(readField(paper, 'paperIssues'), 'paperIssues'),
    insertItems: asFunction<PaperApi['insertItems']>(readField(paper, 'insertItems'), 'insertItems'),
    moveItem: asFunction<PaperApi['moveItem']>(readField(paper, 'moveItem'), 'moveItem'),
    removeItem: asFunction<PaperApi['removeItem']>(readField(paper, 'removeItem'), 'removeItem'),
    setItemScore: asFunction<PaperApi['setItemScore']>(readField(paper, 'setItemScore'), 'setItemScore'),
    setGroupScore: asFunction<PaperApi['setGroupScore']>(readField(paper, 'setGroupScore'), 'setGroupScore'),
    setQuota: asFunction<PaperApi['setQuota']>(readField(paper, 'setQuota'), 'setQuota'),
    setDraw: asFunction<PaperApi['setDraw']>(readField(paper, 'setDraw'), 'setDraw'),
    defaultScoreFor: asFunction<PaperApi['defaultScoreFor']>(readField(paper, 'defaultScoreFor'), 'defaultScoreFor'),
    paperChangeCount: asFunction<PaperApi['paperChangeCount']>(readField(paper, 'paperChangeCount'), 'paperChangeCount'),
  };
}

function problem(
  docId: number,
  kind: ProblemKind,
  score: number | null,
  hidden = false,
): TeachPaperProblemInput {
  return {
    docId,
    pid: `P${docId}`,
    title: `题目 ${docId}`,
    kind,
    score,
    hidden,
    mine: docId % 2 === 0,
    difficulty: null,
  };
}

function incoming(
  docId: number,
  kind: ProblemKind,
  score: number | null = null,
  stageId: number | null = null,
): PaperItem {
  return {
    docId,
    pid: `P${docId}`,
    title: `题目 ${docId}`,
    kind,
    score,
    hidden: false,
    stageId,
  };
}

function makePaper(
  api: PaperApi,
  type: TeachType,
  rule: string,
  problems: TeachPaperProblemInput[],
  stages: TeachStageInput[] | null = null,
  quotas: Partial<Record<ProblemKind, number>> | null = null,
): PaperState {
  return api.paperFromPayload({
    problems,
    stages,
    examPaperQuotas: quotas,
  }, { type, rule });
}

function docIds(state: PaperState): number[] {
  return state.items.map((item) => item.docId);
}

function itemOf(state: PaperState, docId: number): PaperItem {
  const found = state.items.find((item) => item.docId === docId);
  expect(found, `missing doc ${docId}`).toBeTruthy();
  if (!found) throw new TypeError(`missing doc ${docId}`);
  return found;
}

function numbering(api: PaperApi, state: PaperState): Map<number, string> {
  const labels = api.paperNumbering(state);
  expect(labels, 'paperNumbering').toBeInstanceOf(Map);
  if (!(labels instanceof Map)) throw new TypeError('paperNumbering must return a Map');
  return labels;
}

function issueKeys(issues: PaperIssue[]): string[] {
  return issues.map((issue) => `${issue.kind ?? 'null'}:${issue.issue}`).sort();
}

function expectRangeError(run: () => unknown, message: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RangeError);
    if (!(error instanceof RangeError)) throw new TypeError('expected RangeError');
    expect(error.message).toBe(message);
    return;
  }
  throw new Error(`expected RangeError ${message}`);
}

function summary(parts: string[]): string {
  return parts.join(' \u00B7 ');
}

describe('teach paper model', () => {
  it('exports the default kind scores', async () => {
    const api = await loadPaper();

    expect(api.defaultKindScore).toEqual(DEFAULT_SCORES);
    const empty = makePaper(api, 'exam', 'exam', []);
    for (const kind of KIND_ORDER) {
      expect(api.defaultScoreFor(empty, kind), kind).toBe(DEFAULT_SCORES[kind]);
    }
  });

  it('scores homework, exam, and oi rules but not acm, practice, or ledo', async () => {
    const api = await loadPaper();
    const one = [problem(1, 'programming', 10)];

    expect(api.paperIsScored(makePaper(api, 'homework', 'homework', one))).toBe(true);
    expect(api.paperIsScored(makePaper(api, 'exam', 'exam', one))).toBe(true);
    expect(api.paperIsScored(makePaper(api, 'oi', 'oi', one))).toBe(true);
    expect(api.paperIsScored(makePaper(api, 'oi', 'ioi', one))).toBe(true);
    expect(api.paperIsScored(makePaper(api, 'oi', 'strictioi', one))).toBe(true);
    expect(api.paperIsScored(makePaper(api, 'acm', 'acm', one))).toBe(false);
    expect(api.paperIsScored(makePaper(api, 'practice', 'practice', one))).toBe(false);
    expect(api.paperIsScored(makePaper(api, 'oi', 'ledo', one))).toBe(false);
  });

  it('keeps payload order and derives draw, quotas, and practice stage ids', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'programming', 20, true),
      problem(2, 'single', 5),
    ], null, { single: 2 });

    expect(docIds(exam)).toEqual([1, 2]);
    expect(itemOf(exam, 1).hidden).toBe(true);
    expect(itemOf(exam, 1).stageId).toBeNull();
    expect(itemOf(exam, 2).score).toBe(5);
    expect(exam.draw).toBe(true);
    expect(exam.quotas).toEqual({ single: 2 });
    expect(exam.stages).toBeNull();

    const closed = makePaper(api, 'exam', 'exam', [problem(1, 'single', 2)], null, null);
    expect(closed.draw).toBe(false);
    expect(closed.quotas).toEqual({});

    const practice = makePaper(api, 'practice', 'practice', [
      problem(1, 'programming', null),
      problem(2, 'single', null),
    ], [
      { id: 1, title: '基础', requireIds: [], pids: [2] },
      { id: 2, title: '进阶', requireIds: [1], pids: [1] },
    ]);
    expect(docIds(practice)).toEqual([1, 2]);
    expect(itemOf(practice, 1).stageId).toBe(2);
    expect(itemOf(practice, 2).stageId).toBe(1);
    expect(practice.draw).toBe(false);
    expect(practice.stages).toEqual([
      { id: 1, title: '基础', requireIds: [] },
      { id: 2, title: '进阶', requireIds: [1] },
    ]);
  });

  it('sorts grouped kinds and practice stages without shuffling equals', async () => {
    const api = await loadPaper();
    const grouped = makePaper(api, 'exam', 'exam', [
      problem(1, 'programming', 20),
      problem(2, 'single', 2),
      problem(3, 'programming', 20),
    ]);

    expect(docIds(grouped)).toEqual([1, 2, 3]);
    expect(docIds(api.normalizePaper(grouped))).toEqual([2, 1, 3]);

    const practice = makePaper(api, 'practice', 'practice', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
      problem(3, 'programming', null),
    ], [
      { id: 2, title: '后写', requireIds: [], pids: [2, 3] },
      { id: 1, title: '先写', requireIds: [], pids: [1] },
    ]);
    expect(docIds(practice)).toEqual([1, 2, 3]);
    expect(docIds(api.normalizePaper(practice))).toEqual([2, 3, 1]);
    expect(itemOf(api.normalizePaper(practice), 2).stageId).toBe(2);
    expect(itemOf(api.normalizePaper(practice), 1).stageId).toBe(1);
  });

  it('inserts a true-false into an exam ahead of later kinds and scores it 2', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 5),
      problem(2, 'programming', 20),
    ]);
    const next = api.insertItems(exam, [incoming(3, 'true_false')], nowhere);

    expect(docIds(next)).toEqual([3, 1, 2]);
    expect(itemOf(next, 3).score).toBe(2);
    expect(itemOf(next, 3).kind).toBe('true_false');
    expect(itemOf(next, 1).score).toBe(5);
    expect(itemOf(next, 2).score).toBe(20);
    const labels = numbering(api, next);
    expect(labels.get(3)).toBe('1');
    expect(labels.get(1)).toBe('2');
    expect(labels.get(2)).toBe('3');
  });

  it('defaults a new homework single to the existing single score', async () => {
    const api = await loadPaper();
    const homework = makePaper(api, 'homework', 'homework', [problem(1, 'single', 5)]);

    expect(api.defaultScoreFor(homework, 'single')).toBe(5);
    expect(api.defaultScoreFor(homework, 'programming')).toBe(20);
    const next = api.insertItems(homework, [incoming(2, 'single')], nowhere);

    expect(docIds(next)).toEqual([1, 2]);
    expect(itemOf(next, 2).score).toBe(5);
    expect(itemOf(next, 1).score).toBe(5);
  });

  it('inserts an acm problem with a null score and letters A B C', async () => {
    const api = await loadPaper();
    const acm = makePaper(api, 'acm', 'acm', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
    ]);
    const next = api.insertItems(acm, [incoming(3, 'programming')], nowhere);

    expect(docIds(next)).toEqual([1, 2, 3]);
    expect(next.items.map((item) => item.score)).toEqual([null, null, null]);
    const labels = numbering(api, next);
    expect(labels.get(1)).toBe('A');
    expect(labels.get(2)).toBe('B');
    expect(labels.get(3)).toBe('C');
    expect(api.paperSummary(next)).toBe(summary(['共 3 道', 'A\u2013C']));
    expect(api.paperFullScore(next)).toBeNull();
  });

  it('appends a practice problem to stage 2 and numbers the whole paper', async () => {
    const api = await loadPaper();
    const stages: TeachStageInput[] = [
      { id: 1, title: '基础', requireIds: [], pids: [1] },
      { id: 2, title: '进阶', requireIds: [1], pids: [2, 3] },
    ];
    const practice = makePaper(api, 'practice', 'practice', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
      problem(3, 'single', null),
    ], stages);
    const next = api.insertItems(practice, [incoming(4, 'programming')], {
      beforeDocId: null,
      stageId: 2,
    });

    expect(docIds(next)).toEqual([1, 2, 3, 4]);
    expect(itemOf(next, 4).stageId).toBe(2);
    expect(itemOf(next, 4).score).toBeNull();
    expect(next.items.filter((item) => item.stageId === 2).map((item) => item.docId)).toEqual([2, 3, 4]);
    const labels = numbering(api, next);
    expect(labels.get(1)).toBe('1');
    expect(labels.get(2)).toBe('2');
    expect(labels.get(3)).toBe('3');
    expect(labels.get(4)).toBe('4');
    expect(api.paperSummary(next)).toBe(summary(['共 4 道', '2 个阶段']));
    expect(api.paperStagesForSave(next)).toEqual([
      { id: 1, title: '基础', requireIds: [], pids: [1] },
      { id: 2, title: '进阶', requireIds: [1], pids: [2, 3, 4] },
    ]);
    expect(api.paperFullScore(next)).toBeNull();
  });

  it('leaves a single at the end of its group when moved before a programming problem', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 5),
      problem(2, 'single', 5),
      problem(3, 'programming', 20),
    ]);
    const moved = api.moveItem(exam, 1, { beforeDocId: 3, stageId: null });

    expect(docIds(moved)).toEqual([2, 1, 3]);
    expect(itemOf(moved, 1).kind).toBe('single');
    expect(itemOf(moved, 1).score).toBe(5);
    expect(docIds(moved).slice(0, 2)).toEqual([2, 1]);

    const reordered = api.moveItem(exam, 2, { beforeDocId: 1, stageId: null });
    expect(docIds(reordered)).toEqual([2, 1, 3]);

    const flat = makePaper(api, 'acm', 'acm', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
      problem(3, 'programming', null),
    ]);
    expect(docIds(api.moveItem(flat, 3, { beforeDocId: 1, stageId: null }))).toEqual([3, 1, 2]);
    expect(docIds(api.moveItem(flat, 1, nowhere))).toEqual([2, 3, 1]);
  });

  it('flags mixed draw scores and a quota larger than the pool', async () => {
    const api = await loadPaper();
    const mixed = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'single', 4),
    ], null, { single: 2 });

    expect(mixed.draw).toBe(true);
    expect(issueKeys(api.paperIssues(mixed))).toEqual(['single:mixed_scores_in_draw']);
    expect(api.paperFullScore(mixed)).toBeNull();
    expect(api.paperSummary(mixed)).toBe(summary(['题库 3 道', '每人 2 道', '满分 \u2014']));

    const exceeded = api.setQuota(mixed, 'single', 4);
    expect(issueKeys(api.paperIssues(exceeded))).toEqual([
      'single:mixed_scores_in_draw',
      'single:quota_exceeds_pool',
    ]);
    expect(api.paperFullScore(exceeded)).toBeNull();
    expect(api.paperChangeCount(mixed, exceeded)).toBe(1);

    const uniform = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'single', 2),
    ], null, { single: 2 });
    expect(api.paperIssues(uniform)).toEqual([]);
    expect(api.paperFullScore(uniform)).toBe(4);
    expect(api.paperSummary(uniform)).toBe(summary(['题库 3 道', '每人 2 道', '满分 4']));

    const closed = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 4),
    ], null, null);
    expect(api.paperIssues(closed)).toEqual([]);
    expect(api.paperFullScore(closed)).toBe(6);
    expect(api.paperSummary(closed)).toBe(summary(['共 2 道', '满分 6']));
  });

  it('returns exam draw quotas only for kinds that have questions and a positive quota', async () => {
    const api = await loadPaper();
    const drawn = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'single', 2),
      problem(4, 'true_false', 2),
    ], null, { single: 2, true_false: 0 });

    expect(api.paperQuotas(drawn)).toEqual({ single: 2 });
    expect(api.paperIssues(drawn)).toEqual([]);
    expect(api.paperFullScore(drawn)).toBe(4);
    expect(api.paperSummary(drawn)).toBe(summary(['题库 4 道', '每人 2 道', '满分 4']));

    const off = makePaper(api, 'exam', 'exam', drawn.items.map((item) => problem(item.docId, item.kind, item.score)), null, null);
    expect(off.draw).toBe(false);
    expect(api.paperQuotas(off)).toBeNull();

    const cleared = api.setQuota(drawn, 'single', 0);
    expect(api.paperQuotas(cleared)).toBeNull();
    expect(issueKeys(api.paperIssues(cleared))).toEqual(['null:quota_invalid']);
    expect(api.paperFullScore(cleared)).toBe(0);

    const homework = makePaper(api, 'homework', 'homework', [problem(1, 'single', 5)], null, { single: 2 });
    expect(homework.draw).toBe(true);
    expect(api.paperQuotas(homework)).toBeNull();
    expect(api.paperIssues(homework)).toEqual([]);
    expect(api.paperSummary(homework)).toBe(summary(['共 1 道', '满分 5']));
  });

  it('counts one added problem, one score change, and one reorder as 3', async () => {
    const api = await loadPaper();
    const base = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
    ]);
    const added = api.insertItems(base, [incoming(3, 'programming')], nowhere);
    const rescored = api.setItemScore(added, 1, 5);
    const reordered = api.moveItem(rescored, 1, nowhere);

    expect(docIds(added)).toEqual([1, 2, 3]);
    expect(api.paperChangeCount(base, added)).toBe(1);
    expect(api.paperChangeCount(base, rescored)).toBe(2);
    expect(docIds(reordered)).toEqual([2, 1, 3]);
    expect(itemOf(reordered, 1).score).toBe(5);
    expect(itemOf(reordered, 2).score).toBe(2);
    expect(itemOf(reordered, 3).score).toBe(20);
    expect(api.paperChangeCount(base, reordered)).toBe(3);
    expect(api.paperChangeCount(base, base)).toBe(0);
    expect(api.paperChangeCount(reordered, reordered)).toBe(0);

    const removed = api.removeItem(reordered, 3);
    expect(docIds(removed)).toEqual([2, 1]);
    expect(api.paperChangeCount(reordered, removed)).toBe(1);

    const quotaBase = makePaper(api, 'exam', 'exam', [problem(1, 'single', 2)], null, { single: 1 });
    expect(api.paperChangeCount(quotaBase, api.setQuota(quotaBase, 'single', 1))).toBe(0);
    const stopped = api.setDraw(quotaBase, false);
    expect(stopped.draw).toBe(false);
    expect(stopped.quotas).toEqual({ single: 1 });
    expect(api.paperQuotas(stopped)).toBeNull();
    expect(api.paperIssues(stopped)).toEqual([]);
    expect(api.paperChangeCount(quotaBase, stopped)).toBe(1);
    expect(api.paperQuotas(api.setDraw(stopped, true))).toEqual({ single: 1 });
  });

  it('rejects an item score of 0', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [problem(1, 'single', 2)]);

    expectRangeError(() => {
      api.setItemScore(exam, 1, 0);
    }, 'paper_score_invalid');
    expect(itemOf(exam, 1).score).toBe(2);
  });

  it('accepts scores from 1 through 1000 and rejects other numbers', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'programming', 20),
    ]);

    expect(itemOf(api.setItemScore(exam, 1, 1), 1).score).toBe(1);
    expect(itemOf(api.setItemScore(exam, 1, 1000), 1).score).toBe(1000);
    const grouped = api.setGroupScore(exam, 'single', 8);
    expect(itemOf(grouped, 1).score).toBe(8);
    expect(itemOf(grouped, 2).score).toBe(8);
    expect(itemOf(grouped, 3).score).toBe(20);
    expect(api.paperChangeCount(exam, grouped)).toBe(2);
    expect(itemOf(api.setGroupScore(exam, 'single', 1000), 2).score).toBe(1000);

    for (const score of [0, 1001, 1.5, -1, Number.NaN]) {
      expectRangeError(() => {
        api.setItemScore(exam, 1, score);
      }, 'paper_score_invalid');
      expectRangeError(() => {
        api.setGroupScore(exam, 'single', score);
      }, 'paper_score_invalid');
    }
  });

  it('rejects an invalid quota and treats 0 as do not draw', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
    ], null, { single: 2 });

    expect(api.paperQuotas(api.setQuota(exam, 'single', 0))).toBeNull();
    expect(api.setQuota(exam, 'single', 0).quotas.single).toBe(0);
    for (const count of [-1, 1.5, Number.NaN]) {
      expectRangeError(() => {
        api.setQuota(exam, 'single', count);
      }, 'paper_quota_invalid');
    }
    expect(exam.quotas).toEqual({ single: 2 });
  });

  it('draws every occupied kind when draw is turned on with empty quotas', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'programming', 20),
    ]);

    expect(exam.draw).toBe(false);
    expect(exam.quotas).toEqual({});
    const drawn = api.setDraw(exam, true);

    expect(drawn.draw).toBe(true);
    expect(drawn.quotas).toEqual({ single: 2, programming: 1 });
    expect(api.paperQuotas(drawn)).toEqual({ single: 2, programming: 1 });
    expect(api.paperIssues(drawn)).toEqual([]);
    expect(api.paperFullScore(drawn)).toBe(24);
    expect(api.paperSummary(drawn)).toBe(summary(['题库 3 道', '每人 3 道', '满分 24']));
    expect(api.paperChangeCount(exam, drawn)).toBe(3);
  });

  it('sums full scores and formats the summary from the paper rules', async () => {
    const api = await loadPaper();

    expect(api.paperSummary(makePaper(api, 'exam', 'exam', []))).toBe('还没有题目');
    expect(api.paperSummary(makePaper(api, 'practice', 'practice', [], [
      { id: 1, title: '基础', requireIds: [], pids: [] },
    ]))).toBe('还没有题目');
    expect(api.paperSummary(makePaper(api, 'acm', 'acm', []))).toBe('还没有题目');
    expect(api.paperFullScore(makePaper(api, 'exam', 'exam', []))).toBe(0);
    expect(api.paperFullScore(makePaper(api, 'acm', 'acm', []))).toBeNull();

    const homework = makePaper(api, 'homework', 'homework', [
      problem(1, 'single', 5),
      problem(2, 'programming', 20),
    ]);
    expect(api.paperFullScore(homework)).toBe(25);
    expect(api.paperSummary(homework)).toBe(summary(['共 2 道', '满分 25']));

    const oi = makePaper(api, 'oi', 'oi', [
      problem(1, 'programming', 30),
      problem(2, 'programming', 70),
    ]);
    expect(api.paperFullScore(oi)).toBe(100);
    expect(api.paperSummary(oi)).toBe(summary(['共 2 道', '满分 100']));
    expect(numbering(api, oi).get(1)).toBe('A');
    expect(numbering(api, oi).get(2)).toBe('B');

    const ledo = makePaper(api, 'oi', 'ledo', [problem(1, 'programming', 100)]);
    expect(api.paperFullScore(ledo)).toBeNull();

    const oneStage = makePaper(api, 'practice', 'practice', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
    ], [
      { id: 1, title: '基础', requireIds: [], pids: [1, 2] },
    ]);
    expect(api.paperSummary(oneStage)).toBe('共 2 道');
    expect(api.paperScores(oneStage)).toBeNull();
    expect(api.paperScores(makePaper(api, 'acm', 'acm', [problem(1, 'programming', null)]))).toBeNull();
  });

  it('numbers a flat paper A through Z and then AA AB', async () => {
    const api = await loadPaper();
    const problems = Array.from({ length: 28 }, (_, index) => problem(index + 1, 'programming', null));
    const acm = makePaper(api, 'acm', 'acm', problems);
    const labels = numbering(api, acm);

    expect(labels.size).toBe(28);
    expect(labels.get(1)).toBe('A');
    expect(labels.get(26)).toBe('Z');
    expect(labels.get(27)).toBe('AA');
    expect(labels.get(28)).toBe('AB');
    expect(api.paperSummary(acm)).toBe(summary(['共 28 道', 'A\u2013AB']));
  });

  it('places inserted problems by kind, stage, and skipped doc id', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'programming', 20),
    ]);

    const beforeSame = api.insertItems(exam, [incoming(4, 'single')], { beforeDocId: 1, stageId: null });
    expect(docIds(beforeSame)).toEqual([4, 1, 2, 3]);
    expect(itemOf(beforeSame, 4).score).toBe(2);

    const otherKind = api.insertItems(exam, [incoming(5, 'programming')], { beforeDocId: 1, stageId: null });
    expect(docIds(otherKind)).toEqual([1, 2, 3, 5]);

    const kept = api.insertItems(exam, [incoming(6, 'true_false', 7)], nowhere);
    expect(itemOf(kept, 6).score).toBe(7);

    const skipped = api.insertItems(exam, [incoming(7, 'single'), incoming(1, 'programming', 99)], nowhere);
    expect(docIds(skipped)).toEqual([1, 2, 7, 3]);
    expect(itemOf(skipped, 1).kind).toBe('single');
    expect(itemOf(skipped, 1).score).toBe(2);
    expect(itemOf(skipped, 7).score).toBe(2);
    expect(api.paperChangeCount(exam, skipped)).toBe(1);
    expect(api.paperChangeCount(exam, api.insertItems(exam, [incoming(1, 'programming', 99)], nowhere))).toBe(0);

    const flat = makePaper(api, 'oi', 'strictioi', [
      problem(1, 'programming', 10),
      problem(2, 'programming', 20),
      problem(3, 'programming', 30),
    ]);
    expect(docIds(api.insertItems(flat, [incoming(4, 'function', 15)], { beforeDocId: 2, stageId: null }))).toEqual([1, 4, 2, 3]);
    expect(api.paperFullScore(api.insertItems(flat, [incoming(4, 'function', 15)], nowhere))).toBe(75);

    const stages: TeachStageInput[] = [
      { id: 1, title: '基础', requireIds: [], pids: [1] },
      { id: 2, title: '进阶', requireIds: [1], pids: [2] },
    ];
    const practice = makePaper(api, 'practice', 'practice', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
    ], stages);
    const intoFirst = api.insertItems(practice, [incoming(3, 'programming')], { beforeDocId: 1, stageId: null });
    expect(docIds(intoFirst)).toEqual([3, 1, 2]);
    expect(itemOf(intoFirst, 3).stageId).toBe(1);

    const stageWins = api.insertItems(practice, [incoming(4, 'programming')], { beforeDocId: 2, stageId: 1 });
    expect(docIds(stageWins)).toEqual([1, 4, 2]);
    expect(itemOf(stageWins, 4).stageId).toBe(1);

    const lastStage = api.insertItems(practice, [incoming(5, 'programming')], nowhere);
    expect(docIds(lastStage)).toEqual([1, 2, 5]);
    expect(itemOf(lastStage, 5).stageId).toBe(2);

    const movedStage = api.moveItem(practice, 1, { beforeDocId: null, stageId: 2 });
    expect(docIds(movedStage)).toEqual([2, 1]);
    expect(itemOf(movedStage, 1).stageId).toBe(2);
  });

  it('counts a stage-only move that keeps the doc id order', async () => {
    const api = await loadPaper();
    const stages: TeachStageInput[] = [
      { id: 1, title: '基础', requireIds: [], pids: [1, 2] },
      { id: 2, title: '进阶', requireIds: [1], pids: [] },
    ];
    const practice = makePaper(api, 'practice', 'practice', [
      problem(1, 'programming', null),
      problem(2, 'programming', null),
    ], stages);
    const moved = api.moveItem(practice, 2, { beforeDocId: null, stageId: 2 });

    expect(docIds(practice)).toEqual([1, 2]);
    expect(docIds(moved)).toEqual([1, 2]);
    expect(itemOf(moved, 1).stageId).toBe(1);
    expect(itemOf(moved, 2).stageId).toBe(2);
    expect(api.paperStagesForSave(moved)).toEqual([
      { id: 1, title: '基础', requireIds: [], pids: [1] },
      { id: 2, title: '进阶', requireIds: [1], pids: [2] },
    ]);
    expect(api.paperChangeCount(practice, moved)).toBe(1);
  });

  it('saves pids and scores from the normalized paper', async () => {
    const api = await loadPaper();
    const exam = api.normalizePaper(makePaper(api, 'exam', 'exam', [
      problem(1, 'programming', 20),
      problem(2, 'single', 5),
    ]));

    expect(api.paperPids(exam)).toEqual([2, 1]);
    expect(api.paperScores(exam)).toEqual({ 2: 5, 1: 20 });
    expect(api.paperScores(makePaper(api, 'homework', 'homework', [problem(8, 'blank', 2)]))).toEqual({ 8: 2 });

    const scoredAcm = api.setItemScore(makePaper(api, 'acm', 'acm', [problem(1, 'programming', null)]), 1, 10);
    expect(itemOf(scoredAcm, 1).score).toBe(10);
    expect(api.paperFullScore(scoredAcm)).toBeNull();
    expect(api.paperSummary(scoredAcm)).toBe(summary(['共 1 道', 'A\u2013A']));
  });

  it('treats an empty quota object as drawing with no per-kind quotas', async () => {
    const api = await loadPaper();
    const drawn = makePaper(api, 'exam', 'exam', [problem(1, 'single', 2)], null, {});

    expect(drawn.draw).toBe(true);
    expect(drawn.quotas).toEqual({});
    expect(api.paperQuotas(drawn)).toBeNull();
    expect(issueKeys(api.paperIssues(drawn))).toEqual(['null:quota_invalid']);
  });

  it('keeps saved quotas when draw is turned off and back on', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
      problem(3, 'single', 2),
    ], null, { single: 1 });
    const stopped = api.setDraw(exam, false);
    const again = api.setDraw(stopped, true);

    expect(stopped.draw).toBe(false);
    expect(stopped.quotas).toEqual({ single: 1 });
    expect(again.draw).toBe(true);
    expect(again.quotas).toEqual({ single: 1 });
    expect(api.paperQuotas(again)).toEqual({ single: 1 });
    expect(api.paperFullScore(again)).toBe(2);
    expect(api.paperSummary(again)).toBe(summary(['题库 3 道', '每人 1 道', '满分 2']));
    expect(api.paperIssues(again)).toEqual([]);
  });

  it('ignores a positive quota on a kind that has no questions', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
    ], null, { single: 1, programming: 5 });

    expect(api.paperQuotas(exam)).toEqual({ single: 1 });
    expect(issueKeys(api.paperIssues(exam))).toEqual(['programming:quota_exceeds_pool']);
    const parts = api.paperSummary(exam).split(' \u00B7 ');
    expect(parts[0]).toBe('题库 2 道');
    expect(parts[1]).toBe('每人 1 道');
  });

  it('does not treat the only positive quota on an empty kind as quota_invalid', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', 2),
      problem(2, 'single', 2),
    ], null, { programming: 2 });

    expect(issueKeys(api.paperIssues(exam))).toEqual(['programming:quota_exceeds_pool']);
  });

  it('defaults a new oi problem to 100 even when that kind already has a score', async () => {
    const api = await loadPaper();
    const oi = makePaper(api, 'oi', 'oi', [problem(1, 'programming', 30)]);
    const ioi = makePaper(api, 'oi', 'ioi', []);
    const strict = makePaper(api, 'oi', 'strictioi', [problem(1, 'function', 40)]);
    const ledo = makePaper(api, 'oi', 'ledo', [problem(1, 'programming', 100)]);

    expect(api.defaultScoreFor(oi, 'programming')).toBe(100);
    expect(api.defaultScoreFor(oi, 'function')).toBe(100);
    expect(api.defaultScoreFor(ioi, 'programming')).toBe(100);
    expect(api.defaultScoreFor(strict, 'function')).toBe(100);
    expect(api.defaultScoreFor(ledo, 'programming')).toBeNull();

    const inserted = api.insertItems(oi, [incoming(2, 'function')], nowhere);
    expect(docIds(inserted)).toEqual([1, 2]);
    expect(itemOf(inserted, 1).score).toBe(30);
    expect(itemOf(inserted, 2).score).toBe(100);
  });

  it('does not report quota_invalid when a drawn exam has no questions', async () => {
    const api = await loadPaper();
    const drawn = api.setDraw(makePaper(api, 'exam', 'exam', []), true);

    expect(drawn.draw).toBe(true);
    expect(drawn.quotas).toEqual({});
    expect(drawn.items).toEqual([]);
    expect(api.paperIssues(drawn)).toEqual([]);
    expect(api.paperQuotas(drawn)).toBeNull();
    expect(api.paperSummary(drawn)).toBe('还没有题目');
  });

  it('counts filling in a missing score as one score change', async () => {
    const api = await loadPaper();
    const exam = makePaper(api, 'exam', 'exam', [
      problem(1, 'single', null),
      problem(2, 'single', 2),
    ]);
    const scored = api.setItemScore(exam, 1, 5);

    expect(docIds(scored)).toEqual([1, 2]);
    expect(itemOf(scored, 1).score).toBe(5);
    expect(itemOf(scored, 2).score).toBe(2);
    expect(api.paperChangeCount(exam, scored)).toBe(1);
  });
});
