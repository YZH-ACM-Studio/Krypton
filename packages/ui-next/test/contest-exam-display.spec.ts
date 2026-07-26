// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canSubmitProblemMode,
  getContestProblemStatus,
  getPersonalPracticeStatus,
  postContestProblemEntryUrl,
  prioritizeCurrentScoreboardRows,
  type ScoreboardDisplayCell,
  scoreboardParticipantColumn,
  scoreboardRowMatches,
} from '../src/lib/contest-exam-display.ts';

describe('getContestProblemStatus', () => {
  it('returns null for null, undefined, and empty string', () => {
    expect(getContestProblemStatus(null)).to.equal(null);
    expect(getContestProblemStatus(undefined)).to.equal(null);
    expect(getContestProblemStatus('')).to.equal(null);
  });

  it('treats status zero as waiting rather than missing', () => {
    expect(getContestProblemStatus(0)).to.deep.equal({ label: '等待中', title: 'Waiting', code: 'pending' });
  });

  it('maps well-known verdicts to label, title, and code', () => {
    expect(getContestProblemStatus(1)).to.deep.equal({ label: 'AC', title: 'Accepted', code: 'pass' });
    expect(getContestProblemStatus(2)).to.deep.equal({ label: 'WA', title: 'Wrong Answer', code: 'fail' });
    expect(getContestProblemStatus(7)?.code).to.equal('fail');
    expect(getContestProblemStatus(12)?.code).to.equal('pass');
    expect(getContestProblemStatus(20)).to.deep.equal({ label: '评测中', title: 'Running', code: 'progress' });
    expect(getContestProblemStatus(30)?.code).to.equal('ignored');
    expect(getContestProblemStatus(32)?.code).to.equal('pass');
  });

  it('coerces numeric strings before lookup', () => {
    expect(getContestProblemStatus('2')).to.deep.equal({ label: 'WA', title: 'Wrong Answer', code: 'fail' });
  });

  it('flags non-integer input as an invalid status', () => {
    expect(getContestProblemStatus(1.5)).to.deep.equal({
      label: '状态异常',
      title: 'Invalid contest status: 1.5',
      code: 'fail',
    });
    expect(getContestProblemStatus('abc')).to.deep.equal({
      label: '状态异常',
      title: 'Invalid contest status: abc',
      code: 'fail',
    });
  });

  it('renders unknown integer codes with the numeric value', () => {
    expect(getContestProblemStatus(99)).to.deep.equal({
      label: '未知 99',
      title: 'Unknown contest status: 99',
      code: 'fail',
    });
    expect(getContestProblemStatus(-1)?.label).to.equal('未知 -1');
  });
});

describe('getPersonalPracticeStatus', () => {
  it('returns null for missing snapshots and missing statuses', () => {
    expect(getPersonalPracticeStatus(null)).to.equal(null);
    expect(getPersonalPracticeStatus(undefined)).to.equal(null);
    expect(getPersonalPracticeStatus({ status: null, phase: 'before' })).to.equal(null);
  });

  it('passes non-pass verdicts through untouched regardless of phase', () => {
    expect(getPersonalPracticeStatus({ status: 2, phase: 'before' }))
      .to.deep.equal({ label: 'WA', title: 'Wrong Answer', code: 'fail' });
    expect(getPersonalPracticeStatus({ status: 20, phase: 'after' })?.code).to.equal('progress');
  });

  it('relabels pre-contest passes with the pre-contest wording', () => {
    expect(getPersonalPracticeStatus({ status: 1, phase: 'before' })).to.deep.equal({
      label: '个人已通过（赛前）',
      title: 'Accepted before this contest',
      code: 'pass',
    });
  });

  it('relabels other passes but keeps the original title', () => {
    expect(getPersonalPracticeStatus({ status: 1, phase: 'after' }))
      .to.deep.equal({ label: '已通过', title: 'Accepted', code: 'pass' });
    expect(getPersonalPracticeStatus({ status: 1, phase: 'other' })?.label).to.equal('已通过');
  });

  it('applies the same relabeling to every pass-coded verdict', () => {
    expect(getPersonalPracticeStatus({ status: 12, phase: 'before' })?.title).to.equal('Accepted before this contest');
    expect(getPersonalPracticeStatus({ status: 12, phase: 'after' })?.label).to.equal('已通过');
  });

  it('does not mutate the shared status table', () => {
    getPersonalPracticeStatus({ status: 1, phase: 'before' });
    expect(getContestProblemStatus(1)).to.deep.equal({ label: 'AC', title: 'Accepted', code: 'pass' });
  });
});

describe('postContestProblemEntryUrl', () => {
  const base = {
    rule: 'acm',
    clientRequired: false,
    practiceSupported: true,
    practiceOpen: true,
    ended: true,
    detailUrl: '/contest/abc',
    contestId: 'abc',
  };

  it('always routes exam-rule contests into exam mode', () => {
    expect(postContestProblemEntryUrl({ ...base, rule: 'exam', clientRequired: false, ended: false }))
      .to.equal('/exam-mode/abc');
  });

  it('uri-encodes the contest id', () => {
    expect(postContestProblemEntryUrl({ ...base, rule: 'exam', contestId: 'a b/c' }))
      .to.equal('/exam-mode/a%20b%2Fc');
  });

  it('keeps client-required contests in exam mode until practice is available', () => {
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true, practiceSupported: false }))
      .to.equal('/exam-mode/abc');
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true, ended: false }))
      .to.equal('/exam-mode/abc');
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true, practiceOpen: false }))
      .to.equal('/exam-mode/abc');
  });

  it('routes client-required contests to problems once ended with open practice', () => {
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true })).to.equal('/contest/abc/problems');
  });

  it('routes ordinary contests straight to the problems page', () => {
    expect(postContestProblemEntryUrl({ ...base, ended: false, practiceOpen: false }))
      .to.equal('/contest/abc/problems');
  });
});

describe('canSubmitProblemMode', () => {
  it('allows the three submitting modes', () => {
    expect(canSubmitProblemMode('normal')).to.equal(true);
    expect(canSubmitProblemMode('contest')).to.equal(true);
    expect(canSubmitProblemMode('correction')).to.equal(true);
  });

  it('rejects everything else', () => {
    expect(canSubmitProblemMode('view')).to.equal(false);
    expect(canSubmitProblemMode('')).to.equal(false);
    expect(canSubmitProblemMode(undefined)).to.equal(false);
    expect(canSubmitProblemMode(null)).to.equal(false);
  });
});

describe('scoreboardParticipantColumn', () => {
  it('prefers an explicit user-typed column', () => {
    const header: ScoreboardDisplayCell[] = [{ type: 'rank' }, { type: 'total' }, { type: 'user' }];
    expect(scoreboardParticipantColumn(header, false)).to.equal(2);
    expect(scoreboardParticipantColumn(header, true)).to.equal(2);
  });

  it('recognizes a user column at index zero', () => {
    expect(scoreboardParticipantColumn([{ type: 'user' }], false)).to.equal(0);
  });

  it('falls back to column one only for team mode with enough columns', () => {
    const header: ScoreboardDisplayCell[] = [{ type: 'rank' }, { type: 'team' }];
    expect(scoreboardParticipantColumn(header, true)).to.equal(1);
    expect(scoreboardParticipantColumn(header, false)).to.equal(-1);
    expect(scoreboardParticipantColumn([{ type: 'rank' }], true)).to.equal(-1);
    expect(scoreboardParticipantColumn([], true)).to.equal(-1);
  });
});

describe('scoreboardRowMatches', () => {
  const row: ScoreboardDisplayCell[] = [{ type: 'rank', raw: 1 }, { type: 'user', raw: 42 }];

  it('matches on stringified equality of the raw cell value', () => {
    expect(scoreboardRowMatches(row, 1, 42)).to.equal(true);
    expect(scoreboardRowMatches(row, 1, '42')).to.equal(true);
    expect(scoreboardRowMatches(row, 1, 43)).to.equal(false);
  });

  it('accepts a participant id of zero', () => {
    expect(scoreboardRowMatches([{ raw: 0 }], 0, 0)).to.equal(true);
  });

  it('rejects unusable columns and ids', () => {
    expect(scoreboardRowMatches(row, -1, 42)).to.equal(false);
    expect(scoreboardRowMatches(row, 1, null)).to.equal(false);
    expect(scoreboardRowMatches(row, 1, undefined)).to.equal(false);
  });

  it('rejects rows with missing cells or empty raw values', () => {
    expect(scoreboardRowMatches(row, 5, 42)).to.equal(false);
    expect(scoreboardRowMatches([{ type: 'user' }], 0, 42)).to.equal(false);
    expect(scoreboardRowMatches([{ raw: null }], 0, 'null')).to.equal(false);
  });
});

describe('prioritizeCurrentScoreboardRows', () => {
  const rowFor = (id: number): ScoreboardDisplayCell[] => [{ type: 'rank' }, { type: 'user', raw: id }];

  it('moves matching rows to the front, keeping both groups in order', () => {
    const rows = [rowFor(1), rowFor(2), rowFor(3), rowFor(2)];
    expect(prioritizeCurrentScoreboardRows(rows, 1, 2))
      .to.deep.equal([rowFor(2), rowFor(2), rowFor(1), rowFor(3)]);
  });

  it('returns the original array reference when nothing matches', () => {
    const rows = [rowFor(1), rowFor(3)];
    expect(prioritizeCurrentScoreboardRows(rows, 1, 99)).to.equal(rows);
    expect(prioritizeCurrentScoreboardRows(rows, -1, 1)).to.equal(rows);
    expect(prioritizeCurrentScoreboardRows(rows, 1, null)).to.equal(rows);
  });

  it('handles empty scoreboards', () => {
    const rows: ScoreboardDisplayCell[][] = [];
    expect(prioritizeCurrentScoreboardRows(rows, 1, 1)).to.equal(rows);
  });
});
