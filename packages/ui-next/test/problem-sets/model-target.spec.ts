// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  studentSetRowView,
  type ContestRow,
  type PracticeRow,
  type RowView,
  type TeamRow,
} from '../../src/pages/problem-sets/model.ts';

const NOW_ISO = '2026-10-18T14:00:00+08:00';
const NOW = Date.parse(NOW_ISO);
const SAME_DAY_BEGIN = '2026-10-18T08:00:00+08:00';
const SAME_DAY_END = '2026-10-18T18:00:00+08:00';
const PERSONAL_END = '2026-10-18T15:40:00+08:00';
const STARTED = '2026-10-18T13:00:00+08:00';

const EXAM_HREF = '/contest/64b8000000000000000000a1';
const PRACTICE_HREF = '/problem-sets/64b8000000000000000000b1';
const TEAM_HREF = '/teams/batch-1';

function contestRow(overrides: Partial<ContestRow> & Pick<ContestRow, 'kind' | 'flavor'>): ContestRow {
  return {
    id: '64b8000000000000000000a1',
    title: '数据结构期中考试',
    href: EXAM_HREF,
    beginAt: SAME_DAY_BEGIN,
    endAt: SAME_DAY_END,
    dueAt: null,
    durationMinutes: null,
    startAt: null,
    personalEndAt: null,
    attended: false,
    clientRequired: false,
    team: false,
    problemCount: 20,
    progress: null,
    finalized: false,
    done: false,
    ...overrides,
  };
}

function practiceRow(overrides: Partial<PracticeRow> = {}): PracticeRow {
  return {
    kind: 'practice',
    description: '练习简介',
    enrolled: true,
    participantCount: 12,
    sourceLabels: ['课程'],
    stages: [{ id: 1, title: '阶段一', status: 'open' as const }],
    id: '64b8000000000000000000b1',
    title: 'PAT 甲级训练集',
    href: PRACTICE_HREF,
    stageCount: 3,
    problemCount: 120,
    doneCount: 0,
    sourceLabel: '全站公开',
    ...overrides,
  };
}

function teamRow(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    kind: 'team',
    id: 'batch-1',
    title: '2026 秋季校赛组队',
    href: TEAM_HREF,
    description: '',
    myState: 'none',
    inviteCount: 0,
    memberCount: null,
    ...overrides,
  };
}

function requireAction(view: RowView): NonNullable<RowView['action']> {
  expect(view.action).not.toBeNull();
  if (view.action === null) throw new TypeError('row action is missing');
  return view.action;
}

describe('problem list buttons target problems', () => {
  it('ends an in-progress paper button href with the problems section', () => {
    const row = contestRow({
      kind: 'exam',
      flavor: 'paper',
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      durationMinutes: 100,
      progress: { answered: 7 },
    });
    const action = requireAction(studentSetRowView(row, NOW));
    expect(action.label).toBe('继续作答');
    expect(action.href).toBe(`${row.href}?section=problems`);
    expect(action.href.endsWith('?section=problems')).toBe(true);
  });

  it('joins an existing query with an ampersand before the problems section', () => {
    const href = `${EXAM_HREF}?kept=1`;
    const row = contestRow({
      kind: 'exam',
      flavor: 'paper',
      href,
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      durationMinutes: 100,
      progress: { answered: 7 },
    });
    const action = requireAction(studentSetRowView(row, NOW));
    expect(action.label).toBe('继续作答');
    expect(action.href).toBe(`${href}&section=problems`);
  });

  it('keeps a view button href equal to the row href', () => {
    const row = contestRow({
      kind: 'exam',
      flavor: 'paper',
      finalized: true,
      done: true,
      startAt: STARTED,
      personalEndAt: PERSONAL_END,
      durationMinutes: 120,
      progress: { answered: 20 },
    });
    const action = requireAction(studentSetRowView(row, NOW));
    expect(action.label).toBe('查看');
    expect(action.href).toBe(row.href);
  });

  it('keeps a started practice continue href equal to the row href', () => {
    const row = practiceRow({
      stageCount: 4,
      problemCount: 3,
      doneCount: 2,
      sourceLabel: '用户组',
    });
    const action = requireAction(studentSetRowView(row, NOW));
    expect(action.label).toBe('继续');
    expect(action.href).toBe(row.href);
  });

  it('leaves a team row button href equal to the row href', () => {
    const row = teamRow();
    const action = requireAction(studentSetRowView(row, NOW));
    expect(action.label).toBe('去组队');
    expect(action.href).toBe(row.href);
  });
});
