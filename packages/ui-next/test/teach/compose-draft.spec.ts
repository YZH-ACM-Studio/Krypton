// @vitest-environment node
// A static import fails collection while src/pages/teach/compose/draft.ts is absent.
import { describe, expect, it } from 'vitest';
import { TEACH_ALLOWED_KINDS } from '@hydrooj/common';
import type { ProblemKind, TeachStatus, TeachType } from '@hydrooj/common';
import {
  insertItems,
  moveItem,
  paperChangeCount,
  paperFromPayload,
  removeItem,
  setDraw,
  setGroupScore,
  setItemScore,
  setQuota,
} from '../../src/pages/teach/paper';
import type { PaperItem, PaperState, PaperTarget } from '../../src/pages/teach/paper';

const draftLoaders = import.meta.glob('../../src/pages/teach/compose/draft.ts');
const DRAFT_SOURCE = 'src/pages/teach/compose/draft.ts';
const nowhere: PaperTarget = { beforeDocId: null, stageId: null };

interface ComposeState {
  base: PaperState;
  current: PaperState;
  activeKind: ProblemKind | null;
  locked: boolean;
  selection: number[];
}

type ComposeAction =
  | { type: 'add'; items: PaperItem[]; target: PaperTarget }
  | { type: 'move'; docId: number; target: PaperTarget }
  | { type: 'remove'; docId: number }
  | { type: 'setItemScore'; docId: number; score: number }
  | { type: 'setGroupScore'; kind: ProblemKind; score: number }
  | { type: 'setQuota'; kind: ProblemKind; count: number }
  | { type: 'setDraw'; on: boolean }
  | { type: 'setActiveKind'; kind: ProblemKind }
  | { type: 'unlock' }
  | { type: 'select'; docId: number; on: boolean }
  | { type: 'clearSelection' }
  | { type: 'discard' }
  | { type: 'saved'; paper: PaperState };

interface DraftApi {
  initialComposeState: (paper: PaperState, status: TeachStatus) => ComposeState;
  composeReducer: (state: ComposeState, action: ComposeAction) => ComposeState;
  landedKindsOutsideActive: (prev: ComposeState, next: ComposeState) => ProblemKind[];
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

async function loadDraft(): Promise<DraftApi> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(draftLoaders)) {
    if (key.endsWith(DRAFT_SOURCE)) load = candidate;
  }
  expect(typeof load, `${DRAFT_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${DRAFT_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${DRAFT_SOURCE} must be a module`);
  return {
    initialComposeState: asFunction<DraftApi['initialComposeState']>(readField(imported, 'initialComposeState'), 'initialComposeState'),
    composeReducer: asFunction<DraftApi['composeReducer']>(readField(imported, 'composeReducer'), 'composeReducer'),
    landedKindsOutsideActive: asFunction<DraftApi['landedKindsOutsideActive']>(readField(imported, 'landedKindsOutsideActive'), 'landedKindsOutsideActive'),
  };
}

function problem(docId: number, kind: ProblemKind, score: number | null) {
  return {
    docId,
    pid: `P${docId}`,
    title: `题目 ${docId}`,
    kind,
    score,
    hidden: false,
    mine: true,
    difficulty: null,
  };
}

function item(docId: number, kind: ProblemKind, score: number | null, stageId: number | null = null): PaperItem {
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
  type: TeachType,
  rule: string,
  problems: ReturnType<typeof problem>[],
  stages: Array<{ id: number; title: string; requireIds: number[]; pids: number[] }> | null = null,
  quotas: Partial<Record<ProblemKind, number>> | null = null,
): PaperState {
  return paperFromPayload({
    problems,
    stages,
    examPaperQuotas: quotas,
  }, { type, rule });
}

function docIds(state: PaperState): number[] {
  return state.items.map((entry) => entry.docId);
}

function examPaper(): PaperState {
  return makePaper('exam', 'exam', [
    problem(1, 'single', 2),
    problem(2, 'single', 2),
    problem(3, 'programming', 20),
  ], null, { single: 2, programming: 1 });
}

function composeOf(paper: PaperState, activeKind: ProblemKind | null, current: PaperState = paper): ComposeState {
  return {
    base: paper,
    current,
    activeKind,
    locked: false,
    selection: [],
  };
}

function withItems(state: ComposeState, items: PaperItem[]): ComposeState {
  return {
    ...state,
    current: {
      ...state.current,
      items,
    },
  };
}

function expectApplied(api: DraftApi, state: ComposeState, action: ComposeAction, nextPaper: PaperState): ComposeState {
  const next = api.composeReducer(state, action);
  expect(next.current, action.type).toEqual(nextPaper);
  expect(next.base, action.type).toEqual(state.base);
  expect(next.activeKind, action.type).toBe(state.activeKind);
  expect(next.locked, action.type).toBe(state.locked);
  expect(next.selection, action.type).toEqual(state.selection);
  return next;
}

describe('compose draft', () => {
  it('locks a running or ended exam and ignores add until unlock', async () => {
    const api = await loadDraft();
    const paper = examPaper();
    const extra = item(9, 'true_false', null);

    for (const status of ['running', 'ended'] as const) {
      const state = api.initialComposeState(paper, status);
      expect(state.locked, status).toBe(true);
      expect(state.selection, status).toEqual([]);
      expect(state.current, status).toEqual(state.base);
      expect(paperChangeCount(state.base, state.current), status).toBe(0);
      expect(api.composeReducer(state, { type: 'add', items: [extra], target: nowhere }), status).toBe(state);

      const unlocked = api.composeReducer(state, { type: 'unlock' });
      expect(unlocked.locked, status).toBe(false);
      expect(unlocked.current, status).toEqual(state.current);
      expect(unlocked.base, status).toEqual(state.base);
      const after = api.composeReducer(unlocked, { type: 'add', items: [extra], target: nowhere });
      expect(after.current, status).toEqual(insertItems(unlocked.current, [extra], nowhere));
      expect(after.base, status).toEqual(state.base);
      expect(docIds(after.current), status).toContain(9);
    }
  });

  it('keeps the kind tab and bank selection usable while locked', async () => {
    const api = await loadDraft();
    const paper = examPaper();
    const locked = api.initialComposeState(paper, 'running');
    const ignored: ComposeAction[] = [
      { type: 'move', docId: 1, target: { beforeDocId: 2, stageId: null } },
      { type: 'remove', docId: 1 },
      { type: 'setItemScore', docId: 1, score: 9 },
      { type: 'setGroupScore', kind: 'single', score: 9 },
      { type: 'setQuota', kind: 'single', count: 1 },
      { type: 'setDraw', on: false },
      { type: 'discard' },
      { type: 'saved', paper: { ...paper, items: [] } },
    ];
    for (const action of ignored) {
      expect(api.composeReducer(locked, action), action.type).toBe(locked);
    }

    const selected = api.composeReducer(
      api.composeReducer(locked, { type: 'select', docId: 100, on: true }),
      { type: 'select', docId: 101, on: true },
    );
    expect(selected.locked).toBe(true);
    expect(selected.selection).toEqual([100, 101]);
    expect(selected.current).toEqual(locked.current);
    expect(api.composeReducer(selected, { type: 'select', docId: 100, on: true }).selection).toEqual([100, 101]);
    expect(api.composeReducer(selected, { type: 'select', docId: 100, on: false }).selection).toEqual([101]);
    expect(api.composeReducer(selected, { type: 'discard' })).toBe(selected);

    const retabbed = api.composeReducer(selected, { type: 'setActiveKind', kind: 'programming' });
    expect(retabbed.activeKind).toBe('programming');
    expect(retabbed.locked).toBe(true);
    expect(retabbed.selection).toEqual([100, 101]);
    expect(retabbed.current).toEqual(selected.current);
    expect(api.composeReducer(retabbed, { type: 'clearSelection' }).selection).toEqual([]);
  });

  it('picks the first occupied kind, and the first allowed kind when a grouped paper is empty', async () => {
    const api = await loadDraft();
    const programmingFirst = makePaper('exam', 'exam', [
      problem(3, 'programming', 20),
      problem(1, 'single', 2),
    ]);
    const occupied = api.initialComposeState(programmingFirst, 'upcoming');
    expect(programmingFirst.items[0]?.kind).toBe('programming');
    expect(occupied.locked).toBe(false);
    expect(occupied.activeKind).toBe('single');

    const emptyExam = api.initialComposeState(makePaper('exam', 'exam', []), 'upcoming');
    const emptyHomework = api.initialComposeState(makePaper('homework', 'homework', []), 'upcoming');
    expect(emptyExam.activeKind).toBe(TEACH_ALLOWED_KINDS.exam[0]);
    expect(emptyExam.activeKind).toBe('true_false');
    expect(emptyHomework.activeKind).toBe(TEACH_ALLOWED_KINDS.homework[0]);
    expect(emptyHomework.locked).toBe(false);

    const acm = api.initialComposeState(makePaper('acm', 'acm', [problem(1, 'programming', null)]), 'running');
    const practice = api.initialComposeState(makePaper('practice', 'practice', [problem(1, 'programming', null)], [
      { id: 1, title: '基础', requireIds: [], pids: [1] },
    ]), 'open');
    expect(acm.activeKind).toBeNull();
    expect(acm.locked).toBe(true);
    expect(practice.activeKind).toBeNull();
    expect(practice.locked).toBe(false);
  });

  it('keeps the active kind when the added problem belongs to another group', async () => {
    const api = await loadDraft();
    const paper = makePaper('exam', 'exam', [problem(1, 'single', 2)]);
    const state = api.initialComposeState(paper, 'upcoming');
    expect(state.activeKind).toBe('single');
    const extra = item(9, 'programming', null);
    const next = api.composeReducer(state, { type: 'add', items: [extra], target: nowhere });
    expect(next.activeKind).toBe('single');
    expect(next.current).toEqual(insertItems(state.current, [extra], nowhere));
    expect(next.current.items.some((entry) => entry.docId === 9 && entry.kind === 'programming')).toBe(true);
  });

  it('applies paper edits through the paper model and discard clears the count', async () => {
    const api = await loadDraft();
    const paper = examPaper();
    let state = api.initialComposeState(paper, 'upcoming');
    expect(state.base).toEqual(paper);
    expect(state.current).toEqual(paper);

    const extra = item(9, 'true_false', null);
    state = expectApplied(api, state, { type: 'add', items: [extra], target: nowhere }, insertItems(state.current, [extra], nowhere));
    expect(state.activeKind).toBe('single');
    const moveTarget: PaperTarget = { beforeDocId: 1, stageId: null };
    state = expectApplied(api, state, { type: 'move', docId: 2, target: moveTarget }, moveItem(state.current, 2, moveTarget));
    state = expectApplied(api, state, { type: 'remove', docId: 3 }, removeItem(state.current, 3));
    state = expectApplied(api, state, { type: 'setItemScore', docId: 1, score: 6 }, setItemScore(state.current, 1, 6));
    state = expectApplied(api, state, { type: 'setGroupScore', kind: 'single', score: 4 }, setGroupScore(state.current, 'single', 4));
    state = expectApplied(api, state, { type: 'setQuota', kind: 'single', count: 1 }, setQuota(state.current, 'single', 1));
    state = expectApplied(api, state, { type: 'setDraw', on: false }, setDraw(state.current, false));

    const selected = api.composeReducer(state, { type: 'select', docId: 100, on: true });
    expect(selected.selection).toEqual([100]);
    expect(paperChangeCount(selected.base, selected.current)).toBeGreaterThan(0);
    const restored = api.composeReducer(selected, { type: 'discard' });
    expect(paperChangeCount(restored.base, restored.current)).toBe(0);
    expect(restored.current).toEqual(restored.base);
    expect(restored.base).toEqual(paper);
    expect(restored.selection).toEqual([]);
    expect(restored.activeKind).toBe('single');
    expect(restored.locked).toBe(false);
  });

  it('adds a practice problem into the requested stage', async () => {
    const api = await loadDraft();
    const stages = [
      { id: 1, title: '基础', requireIds: [], pids: [3] },
      { id: 2, title: '提高', requireIds: [1], pids: [] },
    ];
    const paper = makePaper('practice', 'practice', [problem(3, 'programming', null)], stages);
    const state = api.initialComposeState(paper, 'open');
    const extra = item(4, 'function', null);
    const target: PaperTarget = { beforeDocId: null, stageId: 2 };
    const next = api.composeReducer(state, { type: 'add', items: [extra], target });
    expect(next.activeKind).toBeNull();
    expect(next.current).toEqual(insertItems(state.current, [extra], target));
    expect(next.current.items.find((entry) => entry.docId === 4)?.stageId).toBe(2);
  });

  it('returns the same state when a score or quota is out of range', async () => {
    const api = await loadDraft();
    const state = api.initialComposeState(examPaper(), 'upcoming');
    expect(state.locked).toBe(false);
    const rejected: ComposeAction[] = [
      { type: 'setItemScore', docId: 1, score: 0 },
      { type: 'setItemScore', docId: 1, score: 1.5 },
      { type: 'setGroupScore', kind: 'single', score: 1001 },
      { type: 'setQuota', kind: 'single', count: -1 },
      { type: 'setQuota', kind: 'programming', count: 1.5 },
    ];
    for (const action of rejected) {
      expect(api.composeReducer(state, action), action.type).toBe(state);
    }
    const scored = api.composeReducer(state, { type: 'setItemScore', docId: 1, score: 6 });
    expect(scored).not.toBe(state);
    expect(scored.current).toEqual(setItemScore(state.current, 1, 6));
  });

  it('replaces the base and the current paper when the draft is saved', async () => {
    const api = await loadDraft();
    const paper = examPaper();
    const state = api.initialComposeState(paper, 'upcoming');
    const extra = item(9, 'true_false', null);
    const dirty = api.composeReducer(state, { type: 'add', items: [extra], target: nowhere });
    expect(paperChangeCount(dirty.base, dirty.current)).toBeGreaterThan(0);
    const replacement: PaperState = {
      ...dirty.current,
      draw: false,
      quotas: { single: 1 },
    };
    const saved = api.composeReducer(dirty, { type: 'saved', paper: replacement });
    expect(saved.base).toEqual(replacement);
    expect(saved.current).toEqual(replacement);
    expect(paperChangeCount(saved.base, saved.current)).toBe(0);
    expect(saved.current.draw).toBe(false);
  });

  it('reports kinds that landed outside the active tab', async () => {
    const api = await loadDraft();
    const paper = examPaper();
    const prev = composeOf(paper, 'single');
    const programming = item(9, 'programming', 20);
    const anotherProgramming = item(10, 'programming', 20);
    const single = item(11, 'single', 2);

    expect(api.landedKindsOutsideActive(prev, withItems(prev, [...paper.items, programming, anotherProgramming]))).toEqual(['programming']);
    expect(api.landedKindsOutsideActive(prev, withItems(prev, [...paper.items, single, programming]))).toEqual(['programming']);
    expect(api.landedKindsOutsideActive(prev, withItems(prev, [...paper.items, single]))).toEqual([]);
    expect(api.landedKindsOutsideActive(prev, withItems(prev, [...paper.items].reverse()))).toEqual([]);
    expect(api.landedKindsOutsideActive(prev, prev)).toEqual([]);
  });
});
