import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeEndCode,
  endCodeRequestId,
  endSaveDue,
  readEndCodeDrafts,
  rememberEndCode,
  saveEndCodeDrafts,
} from '../../src/pages/set-workspace/end-save';
import type { SetWorkspace } from '../../src/pages/set-workspace/model';

function workspace(): SetWorkspace {
  return {
    kind: 'paper',
    flavor: 'paper',
    tid: 'set-1',
    title: '考试',
    description: '',
    mode: 'browser',
    phase: 'answering',
    locked: null,
    numbering: 'pta',
    rules: { autoSaveBeforeEnd: true, prohibitCodePaste: false, showDifficulty: false, discussion: false },
    officialRound: { id: 'round-1', roundNo: 1, startedAt: '2099-01-01T10:00:00Z', closedAt: null },
    window: {
      beginAt: '2099-01-01T10:00:00Z',
      endAt: '2099-01-01T12:00:00Z',
      personalEndAt: '2099-01-01T11:00:00Z',
      startAt: '2099-01-01T10:00:00Z',
      durationMinutes: 60,
      dueAt: null,
      lockAt: null,
    },
    groups: [
      {
        kind: 'programming',
        no: 1,
        name: '编程',
        scoreEach: 100,
        items: [{ pid: 1, label: '1-1', title: '题', kind: 'programming', score: 100, state: 'empty', submits: 0, lastScore: null }],
      },
    ],
    totals: { problemCount: 1, maxScore: 100, answered: 0, score: null, accepted: null, showScore: false },
    verdictVisible: false,
    objectiveVerdictVisible: false,
    team: null,
    paper: null,
    announcements: [],
    clarifications: [],
    info: [],
    student: { name: '学生', studentId: null },
    action: { canStart: false, canFinalize: true, canAttend: false, canUnrank: false, canSubmit: true, attended: true, canRetake: false },
    urls: {
      back: null,
      manage: null,
      overview: '/paper/set-1',
      problem: null,
      submit: null,
      pretest: null,
      submitCode: '/paper/set-1/submit/__PID__',
      recordDetail: '/record/__RID__',
      records: '/record',
      ranking: null,
      clarify: null,
      print: null,
      start: null,
      attend: null,
      draftList: null,
      draftUpsert: null,
      submitKind: null,
      lockKind: null,
      finalize: null,
      virtual: null,
      practice: null,
      teamProblem: null,
    },
  };
}
beforeEach(() => sessionStorage.clear());

describe('optional end-of-round code saving', () => {
  it('uses the personal deadline, excludes the deadline itself and does nothing when disabled', () => {
    const ws = workspace();
    expect(endSaveDue(ws, Date.parse('2099-01-01T10:59:29Z'))).toBe(false);
    expect(endSaveDue(ws, Date.parse('2099-01-01T10:59:30Z'))).toBe(true);
    expect(endSaveDue(ws, Date.parse('2099-01-01T11:00:00Z'))).toBe(false);
    ws.rules!.autoSaveBeforeEnd = false;
    rememberEndCode(ws, 1, 'answer', 'cc');
    expect(readEndCodeDrafts(ws)).toEqual([]);
    expect(endSaveDue(ws, Date.parse('2099-01-01T10:59:59Z'))).toBe(false);
  });

  it('shares an idempotency key with manual submission and reuses it after uncertain results over HTTP', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ws = workspace();
    rememberEndCode(ws, 1, 'answer', 'cc');
    const id = endCodeRequestId(ws, 1, 'answer', 'cc');
    const post = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ rid: 'record-1' });
    await expect(saveEndCodeDrafts(ws, post)).rejects.toThrow('offline');
    await saveEndCodeDrafts(ws, post);
    expect(post.mock.calls[0][1]).toEqual({ code: 'answer', lang: 'cc', roundId: 'round-1', autoSaveId: id });
    expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
    expect(readEndCodeDrafts(ws)).toEqual([]);
  });

  it('does not erase edits made in flight or submit an already acknowledged draft', async () => {
    const ws = workspace();
    rememberEndCode(ws, 1, 'first', 'cc');
    const first = readEndCodeDrafts(ws)[0];
    rememberEndCode(ws, 1, 'second', 'cc');
    acknowledgeEndCode(ws, 1, 'first', 'cc');
    expect(readEndCodeDrafts(ws)[0]).toMatchObject({ code: 'second' });
    expect(readEndCodeDrafts(ws)[0].autoSaveId).not.toBe(first.autoSaveId);
    acknowledgeEndCode(ws, 1, 'second', 'cc');
    const post = vi.fn();
    await saveEndCodeDrafts(ws, post);
    expect(post).not.toHaveBeenCalled();
  });

  it('skips blank buffers, rejects foreign questions and retains drafts on malformed responses', async () => {
    const ws = workspace();
    const post = vi.fn().mockResolvedValue({ rid: 'record-1' });
    rememberEndCode(ws, 1, '  ', 'cc');
    await saveEndCodeDrafts(ws, post);
    expect(post).not.toHaveBeenCalled();
    rememberEndCode(ws, 1, 'answer', 'cc');
    post.mockResolvedValue({ ok: true });
    await expect(saveEndCodeDrafts(ws, post)).rejects.toThrow('提交记录');
    expect(readEndCodeDrafts(ws)).toHaveLength(1);
    sessionStorage.clear();
    rememberEndCode(ws, 2, 'foreign', 'cc');
    post.mockClear();
    await expect(saveEndCodeDrafts(ws, post)).rejects.toThrow('当前试卷');
    expect(post).not.toHaveBeenCalled();
  });

  it('handles empty structured regions and keeps rounds separate', async () => {
    const ws = workspace();
    ws.groups[0].items[0].kind = 'function';
    rememberEndCode(ws, 1, '{"region":""}', 'cc');
    const post = vi.fn();
    await saveEndCodeDrafts(ws, post);
    expect(post).not.toHaveBeenCalled();
    rememberEndCode(ws, 1, '{"region":"return 1;"}', 'cc');
    ws.officialRound!.id = 'round-2';
    expect(readEndCodeDrafts(ws)).toEqual([]);
  });
});
