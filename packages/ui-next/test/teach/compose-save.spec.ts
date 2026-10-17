// @vitest-environment node
// A static import fails collection while src/pages/teach/compose/save.ts is absent.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { parseContestSnapshot, parseHomeworkSnapshot, parsePracticeSnapshot } from '../../src/pages/teach/legacy-forms';
import { paperIssues, paperQuotas, paperScores } from '../../src/pages/teach/paper';
import type { PaperItem, PaperStage, PaperState } from '../../src/pages/teach/paper';

const transport = vi.hoisted(() => ({
  getJson: vi.fn<(path: string, fallback: string) => Promise<unknown>>(),
  postForm: vi.fn<(path: string, body: URLSearchParams, fallback: string) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../src/pages/teach/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pages/teach/api')>();
  return {
    ...actual,
    getJson: transport.getJson,
    postForm: transport.postForm,
  };
});

const saveLoaders = import.meta.glob('../../src/pages/teach/compose/save.ts');
const SAVE_SOURCE = 'src/pages/teach/compose/save.ts';
const ROUTE_ID = 'route-id';
const SNAPSHOT_ID = 'snapshot-doc';
const BLOCKED = '试卷还有问题没解决，不能保存';
const SERVER_ERROR = '标题不能为空';

type PaperIssueCode = 'quota_exceeds_pool' | 'mixed_scores_in_draw' | 'quota_invalid';

interface SaveApi {
  saveComposition: (args: { type: TeachType; id: string; current: PaperState }) => Promise<void>;
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

async function loadSave(): Promise<SaveApi> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(saveLoaders)) {
    if (key.endsWith(SAVE_SOURCE)) load = candidate;
  }
  expect(typeof load, `${SAVE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SAVE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${SAVE_SOURCE} must be a module`);
  return {
    saveComposition: asFunction<SaveApi['saveComposition']>(readField(imported, 'saveComposition'), 'saveComposition'),
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

function paperState(
  type: TeachType,
  rule: string,
  items: PaperItem[],
  draw = false,
  quotas: Partial<Record<ProblemKind, number>> = {},
  stages: PaperStage[] | null = null,
): PaperState {
  return {
    type,
    rule,
    items,
    stages,
    draw,
    quotas,
  };
}

function contestPayload(rule: string, quotas: Record<string, number> | null): Record<string, unknown> {
  const tdoc: Record<string, unknown> = {
    _id: SNAPSHOT_ID,
    title: '期末卷',
    content: '闭卷',
    rule,
    pids: [8, 9],
    score: { 8: 10, 9: 20 },
    rated: true,
  };
  if (quotas) tdoc.examPaperQuotas = quotas;
  return {
    page_name: 'contest_edit',
    inviteCode: 'invite-1',
    duration: 3,
    beginAt: '2026-10-16T06:30:00.000Z',
    participationRevision: 4,
    activeTeamCount: 0,
    recordCount: 1,
    canAutoHideProblems: false,
    canManageTeamBatches: false,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
    scopeSchools: [],
    scopeGroups: [],
    pids: '8,9',
    tdoc,
  };
}

function homeworkPayload(): Record<string, unknown> {
  return {
    page_name: 'homework_edit',
    extensionDays: 1,
    dateBeginText: '2026-10-17',
    timeBeginText: '08:00',
    datePenaltyText: '2026-10-24',
    timePenaltyText: '23:59',
    penaltyRules: { 1: 0.9 },
    scopeGroups: [],
    participantScopeMode: 'groups',
    participantGroupIds: ['g1'],
    pids: [8, 9],
    tdoc: {
      _id: SNAPSHOT_ID,
      title: '函数作业',
      content: '写出过程',
      pids: [8, 9],
      score: { 8: 1, 9: 2 },
      rated: false,
      maintainer: [7],
      assign: ['class-a'],
      langs: ['py.py3'],
    },
  };
}

function practicePayload(): Record<string, unknown> {
  return {
    page_name: 'problem_set_edit',
    groups: [],
    audience: { public: false, groupIds: ['g1'] },
    dag: [
      { _id: 1, title: '旧阶段', requireNids: [], pids: [9] },
    ],
    tdoc: {
      _id: SNAPSHOT_ID,
      title: '循环练习',
      content: '说明',
      description: '简介',
      pin: false,
    },
  };
}

function callAt(calls: ReadonlyArray<ReadonlyArray<unknown>>, index: number): ReadonlyArray<unknown> {
  const call = calls[index];
  expect(call, `call ${index}`).toBeTruthy();
  if (!call) throw new TypeError(`missing call ${index}`);
  return call;
}

function requiredParam(body: URLSearchParams, name: string): string {
  const value = body.get(name);
  expect(value, name).not.toBeNull();
  if (value === null) throw new TypeError(`missing ${name}`);
  return value;
}

function postedForm(): { path: string; body: URLSearchParams } {
  expect(transport.getJson).toHaveBeenCalledTimes(1);
  expect(transport.postForm).toHaveBeenCalledTimes(1);
  const getOrder = transport.getJson.mock.invocationCallOrder[0];
  const postOrder = transport.postForm.mock.invocationCallOrder[0];
  expect(getOrder).toBeLessThan(postOrder ?? 0);
  const fetched = callAt(transport.getJson.mock.calls, 0);
  const posted = callAt(transport.postForm.mock.calls, 0);
  expect(typeof fetched[0]).toBe('string');
  expect(posted[1]).toBeInstanceOf(URLSearchParams);
  expect(posted[2]).toBe('保存失败');
  if (typeof fetched[0] !== 'string' || !(posted[1] instanceof URLSearchParams) || typeof posted[0] !== 'string') {
    throw new TypeError('save request');
  }
  expect(posted[0]).toBe(fetched[0]);
  return { path: posted[0], body: posted[1] };
}

function allowSave(payload: unknown): void {
  transport.getJson.mockResolvedValue(payload);
  transport.postForm.mockResolvedValue({});
}

async function rejectedError(run: () => Promise<void>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new TypeError('expected an Error');
    return error;
  }
  throw new Error('expected the save to fail');
}

describe('compose save', () => {
  beforeEach(() => {
    transport.getJson.mockReset();
    transport.postForm.mockReset();
  });

  it('posts an acm paper in the new order without exam scores', async () => {
    const payload = contestPayload('acm', null);
    const parsed = parseContestSnapshot(payload);
    expect(parsed.state.pids).toEqual([8, 9]);
    expect(parsed.state.scores).toEqual({ 8: 10, 9: 20 });
    const current = paperState('acm', 'acm', [
      item(21, 'programming', null),
      item(8, 'function', null),
    ]);
    expect(paperIssues(current)).toEqual([]);
    allowSave(payload);
    const save = await loadSave();

    await save.saveComposition({ type: 'acm', id: ROUTE_ID, current });

    const { path, body } = postedForm();
    expect(path).toBe(`/contest/${ROUTE_ID}/edit`);
    expect(body.get('pids')).toBe('21,8');
    expect(body.has('examScores')).toBe(false);
    expect(body.get('title')).toBe('期末卷');
    expect(body.get('code')).toBe('invite-1');
    expect(body.get('rule')).toBe('acm');
  });

  it('posts oi exam scores as json from the paper', async () => {
    const payload = contestPayload('oi', null);
    expect(parseContestSnapshot(payload).state.scores).toEqual({ 8: 10, 9: 20 });
    const current = paperState('oi', 'oi', [
      item(21, 'programming', 30),
      item(8, 'programming', 70),
    ]);
    expect(paperScores(current)).toEqual({ 21: 30, 8: 70 });
    expect(paperIssues(current)).toEqual([]);
    allowSave(payload);
    const save = await loadSave();

    await save.saveComposition({ type: 'oi', id: ROUTE_ID, current });

    const { path, body } = postedForm();
    expect(path).toBe(`/contest/${ROUTE_ID}/edit`);
    expect(body.get('pids')).toBe('21,8');
    expect(JSON.parse(requiredParam(body, 'examScores'))).toEqual({ 21: 30, 8: 70 });
    expect(body.get('title')).toBe('期末卷');
    expect(body.get('rule')).toBe('oi');
  });

  it('posts exam draw quotas and an empty quota when draw is off', async () => {
    const payload = contestPayload('exam', { single: 9 });
    expect(parseContestSnapshot(payload).state.examPaperQuotas).toEqual({ single: 9 });
    const items = [item(11, 'single', 2), item(12, 'single', 2)];
    const drawn = paperState('exam', 'exam', items, true, { single: 2, true_false: 0 });
    const closed = paperState('exam', 'exam', items, false, { single: 2 });
    expect(paperQuotas(drawn)).toEqual({ single: 2 });
    expect(paperQuotas(closed)).toBeNull();
    expect(paperIssues(drawn)).toEqual([]);
    expect(paperIssues(closed)).toEqual([]);
    const save = await loadSave();

    allowSave(payload);
    await save.saveComposition({ type: 'exam', id: ROUTE_ID, current: drawn });
    const drawnPost = postedForm();
    expect(drawnPost.path).toBe(`/contest/${ROUTE_ID}/edit`);
    expect(drawnPost.body.get('pids')).toBe('11,12');
    expect(drawnPost.body.get('examPaperQuotas')).toBe('{"single":2}');
    expect(JSON.parse(requiredParam(drawnPost.body, 'examScores'))).toEqual({ 11: 2, 12: 2 });

    transport.getJson.mockClear();
    transport.postForm.mockClear();
    allowSave(payload);
    await save.saveComposition({ type: 'exam', id: ROUTE_ID, current: closed });
    const closedPost = postedForm();
    expect(closedPost.path).toBe(`/contest/${ROUTE_ID}/edit`);
    expect(closedPost.body.get('examPaperQuotas')).toBe('');
    expect(closedPost.body.get('pids')).toBe('11,12');
  });

  it('posts homework problem scores as json', async () => {
    const payload = homeworkPayload();
    const parsed = parseHomeworkSnapshot(payload);
    expect(parsed.state.pids).toEqual([8, 9]);
    expect(parsed.state.scores).toEqual({ 8: 1, 9: 2 });
    const current = paperState('homework', 'homework', [
      item(31, 'single', 5),
      item(32, 'blank', 8),
    ]);
    expect(paperScores(current)).toEqual({ 31: 5, 32: 8 });
    expect(paperIssues(current)).toEqual([]);
    allowSave(payload);
    const save = await loadSave();

    await save.saveComposition({ type: 'homework', id: ROUTE_ID, current });

    const { path, body } = postedForm();
    expect(path).toBe(`/homework/${ROUTE_ID}/edit`);
    expect(body.get('pids')).toBe('31,32');
    expect(JSON.parse(requiredParam(body, 'problemScores'))).toEqual({ 31: 5, 32: 8 });
    expect(body.get('title')).toBe('函数作业');
    expect(body.get('maintainer')).toBe('7');
  });

  it('posts practice stage pids in the dag', async () => {
    const payload = practicePayload();
    const parsed = parsePracticeSnapshot(payload);
    expect(parsed.state.stages.map((stage) => stage.pids)).toEqual([[9]]);
    const stages: PaperStage[] = [
      { id: 1, title: '基础', requireIds: [] },
      { id: 2, title: '提高', requireIds: [1] },
    ];
    const current = paperState('practice', 'practice', [
      item(3, 'programming', null, 1),
      item(4, 'function', null, 2),
      item(5, 'programming', null, 1),
    ], false, {}, stages);
    expect(paperIssues(current)).toEqual([]);
    allowSave(payload);
    const save = await loadSave();

    await save.saveComposition({ type: 'practice', id: ROUTE_ID, current });

    const { path, body } = postedForm();
    expect(path).toBe(`/problem-sets/${ROUTE_ID}/edit`);
    expect(JSON.parse(requiredParam(body, 'dag'))).toEqual([
      { _id: 1, title: '基础', requireNids: [], pids: [3, 5] },
      { _id: 2, title: '提高', requireNids: [1], pids: [4] },
    ]);
    expect(body.get('title')).toBe('循环练习');
    expect(body.get('audienceGroupIds')).toBe('g1');
  });

  it('refuses to post while the paper still has issues', async () => {
    const cases: Array<{ issue: PaperIssueCode; current: PaperState }> = [
      {
        issue: 'quota_exceeds_pool',
        current: paperState('exam', 'exam', [item(11, 'single', 2)], true, { single: 4 }),
      },
      {
        issue: 'mixed_scores_in_draw',
        current: paperState('exam', 'exam', [item(11, 'single', 2), item(12, 'single', 4)], true, { single: 2 }),
      },
      {
        issue: 'quota_invalid',
        current: paperState('exam', 'exam', [item(11, 'single', 2)], true, { single: 0 }),
      },
    ];
    for (const entry of cases) {
      expect(paperIssues(entry.current).some((issue) => issue.issue === entry.issue), entry.issue).toBe(true);
    }
    const save = await loadSave();

    for (const entry of cases) {
      transport.getJson.mockClear();
      transport.postForm.mockClear();
      const error = await rejectedError(() => save.saveComposition({ type: 'exam', id: ROUTE_ID, current: entry.current }));
      expect(Object.getPrototypeOf(error), entry.issue).toBe(Error.prototype);
      expect(error.message, entry.issue).toBe(BLOCKED);
      expect(transport.getJson, entry.issue).not.toHaveBeenCalled();
      expect(transport.postForm, entry.issue).not.toHaveBeenCalled();
    }
  });

  it('throws the server message when the post fails', async () => {
    const payload = contestPayload('acm', null);
    const current = paperState('acm', 'acm', [item(21, 'programming', null)]);
    expect(paperIssues(current)).toEqual([]);
    transport.getJson.mockResolvedValue(payload);
    transport.postForm.mockRejectedValue(new Error(SERVER_ERROR));
    const save = await loadSave();

    const error = await rejectedError(() => save.saveComposition({ type: 'acm', id: ROUTE_ID, current }));

    expect(error.message).toBe(SERVER_ERROR);
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect(transport.getJson).toHaveBeenCalledTimes(1);
    expect(transport.postForm).toHaveBeenCalledTimes(1);
    const posted = callAt(transport.postForm.mock.calls, 0);
    expect(posted[0]).toBe(`/contest/${ROUTE_ID}/edit`);
    expect(posted[2]).toBe('保存失败');
  });
});
