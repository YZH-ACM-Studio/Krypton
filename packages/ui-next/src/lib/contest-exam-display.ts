import { getScoreColor } from '@hydrooj/common';

export interface ScoreboardDisplayCell {
  type?: string;
  raw?: unknown;
}

export function scoreboardScoreColor(percentage: unknown): string | undefined {
  if (percentage === null || percentage === undefined || percentage === '') return undefined;
  const numeric = Number(percentage);
  if (!Number.isFinite(numeric)) return undefined;
  return getScoreColor(Math.min(100, Math.max(0, numeric)));
}

export interface ContestProblemStatusDisplay {
  label: string;
  title: string;
  code: 'pending' | 'pass' | 'fail' | 'progress' | 'ignored';
}

export interface PersonalPracticeStatusSnapshot {
  status: unknown;
  phase: 'before' | 'after' | 'other';
}

const STATUS_DISPLAY: Record<number, ContestProblemStatusDisplay> = {
  0: { label: '等待中', title: 'Waiting', code: 'pending' },
  1: { label: 'AC', title: 'Accepted', code: 'pass' },
  2: { label: 'WA', title: 'Wrong Answer', code: 'fail' },
  3: { label: 'TLE', title: 'Time Limit Exceeded', code: 'fail' },
  4: { label: 'MLE', title: 'Memory Limit Exceeded', code: 'fail' },
  5: { label: 'OLE', title: 'Output Limit Exceeded', code: 'fail' },
  6: { label: 'RE', title: 'Runtime Error', code: 'fail' },
  7: { label: 'CE', title: 'Compile Error', code: 'fail' },
  8: { label: 'SE', title: 'System Error', code: 'fail' },
  9: { label: 'IGN', title: 'Cancelled', code: 'ignored' },
  10: { label: '未知错误', title: 'Unknown Error', code: 'fail' },
  11: { label: 'HK', title: 'Hacked', code: 'fail' },
  12: { label: 'MG', title: 'Manual Graded', code: 'pass' },
  20: { label: '评测中', title: 'Running', code: 'progress' },
  21: { label: '编译中', title: 'Compiling', code: 'progress' },
  22: { label: '已获取', title: 'Fetched', code: 'progress' },
  30: { label: 'IGN', title: 'Ignored', code: 'ignored' },
  31: { label: 'FE', title: 'Format Error', code: 'ignored' },
  32: { label: 'Hack 成功', title: 'Hack Successful', code: 'pass' },
  33: { label: 'Hack 失败', title: 'Hack Unsuccessful', code: 'fail' },
};

export function getContestProblemStatus(status: unknown): ContestProblemStatusDisplay | null {
  if (status === null || status === undefined || status === '') return null;
  const value = Number(status);
  if (!Number.isInteger(value)) {
    return { label: '状态异常', title: `Invalid contest status: ${String(status)}`, code: 'fail' };
  }
  return STATUS_DISPLAY[value] || { label: `未知 ${value}`, title: `Unknown contest status: ${value}`, code: 'fail' };
}

export function getPersonalPracticeStatus(snapshot: PersonalPracticeStatusSnapshot | null | undefined): ContestProblemStatusDisplay | null {
  if (!snapshot) return null;
  const display = getContestProblemStatus(snapshot.status);
  if (!display || display.code !== 'pass') return display;
  if (snapshot.phase === 'before') {
    return {
      ...display,
      label: '个人已通过（赛前）',
      title: 'Accepted before this contest',
    };
  }
  return {
    ...display,
    label: '已通过',
  };
}

export function postContestProblemEntryUrl(input: {
  rule: string;
  clientRequired: boolean;
  practiceSupported: boolean;
  practiceOpen: boolean;
  ended: boolean;
  detailUrl: string;
  contestId: string;
}): string {
  if (input.rule === 'exam') return `/exam-mode/${encodeURIComponent(input.contestId)}`;
  if (input.clientRequired && (!input.practiceSupported || !input.ended || !input.practiceOpen)) {
    return `/exam-mode/${encodeURIComponent(input.contestId)}`;
  }
  return `${input.detailUrl}/problems`;
}

export function canSubmitProblemMode(mode: unknown): boolean {
  return mode === 'normal' || mode === 'contest' || mode === 'correction';
}

export function scoreboardParticipantColumn(header: ScoreboardDisplayCell[], teamMode: boolean): number {
  const userColumn = header.findIndex((cell) => cell.type === 'user');
  if (userColumn >= 0) return userColumn;
  return teamMode && header.length > 1 ? 1 : -1;
}

export function scoreboardRowMatches(row: ScoreboardDisplayCell[], participantColumn: number, participantId: unknown): boolean {
  if (participantColumn < 0 || participantId === null || participantId === undefined) return false;
  const rowId = row[participantColumn]?.raw;
  return rowId !== null && rowId !== undefined && String(rowId) === String(participantId);
}

export function prioritizeCurrentScoreboardRows<T extends ScoreboardDisplayCell[]>(
  rows: T[],
  participantColumn: number,
  participantId: unknown,
): T[] {
  const own: T[] = [];
  const others: T[] = [];
  for (const row of rows) {
    (scoreboardRowMatches(row, participantColumn, participantId) ? own : others).push(row);
  }
  return own.length ? [...own, ...others] : rows;
}
