// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  EXAM_CREATE_DEFAULTS,
  EXAM_CREATE_WALL_CLOCK_HOURS,
  examHiddenFlags,
  initialContestEditRule,
  readCreateExamRuleQuery,
} from '../src/pages/contest-edit-exam-defaults.ts';

describe('readCreateExamRuleQuery', () => {
  it('is true only when rule=exam', () => {
    expect(readCreateExamRuleQuery('?rule=exam')).to.equal(true);
    expect(readCreateExamRuleQuery('rule=exam')).to.equal(true);
    expect(readCreateExamRuleQuery('?rule=exam&from=create')).to.equal(true);
    expect(readCreateExamRuleQuery('?rule=acm')).to.equal(false);
    expect(readCreateExamRuleQuery('?rule=Exam')).to.equal(false);
    expect(readCreateExamRuleQuery('?foo=exam')).to.equal(false);
    expect(readCreateExamRuleQuery('')).to.equal(false);
    expect(readCreateExamRuleQuery()).to.equal(false);
  });
});

describe('initialContestEditRule', () => {
  it('keeps a non-empty persisted rule', () => {
    expect(initialContestEditRule('homework', '?rule=exam')).to.equal('homework');
    expect(initialContestEditRule('exam')).to.equal('exam');
    expect(initialContestEditRule('acm', '?rule=exam')).to.equal('acm');
  });

  it('falls back to the create query, otherwise acm', () => {
    expect(initialContestEditRule(undefined, '?rule=exam')).to.equal('exam');
    expect(initialContestEditRule('', '?rule=exam')).to.equal('exam');
    expect(initialContestEditRule(null, '?rule=exam')).to.equal('exam');
    expect(initialContestEditRule(undefined, '?rule=acm')).to.equal('acm');
    expect(initialContestEditRule(undefined)).to.equal('acm');
  });
});

describe('examHiddenFlags', () => {
  const persisted = {
    rated: true,
    autoHide: true,
    allowViewCode: true,
    allowVirtual: true,
    keepScoreboardHidden: true,
    allowPrint: true,
    vigilEnabled: true,
    entryMode: 'client_required' as const,
  };

  it('uses create defaults and ignores tdoc on create', () => {
    expect(examHiddenFlags(persisted, false)).to.deep.equal({
      ...EXAM_CREATE_DEFAULTS,
      allowVirtual: false,
    });
  });

  it('persists edit flags and leaves allowVirtual null when missing', () => {
    expect(examHiddenFlags(persisted, true)).to.deep.equal({
      rated: true,
      autoHide: true,
      allowViewCode: true,
      allowVirtual: true,
      keepScoreboardHidden: true,
      allowPrint: true,
      vigilEnabled: true,
      entryMode: 'client_required',
      participationMode: 'individual',
    });
    expect(examHiddenFlags({ allowVirtual: false }, true).allowVirtual).to.equal(false);
    expect(examHiddenFlags({}, true).allowVirtual).to.equal(null);
    expect(examHiddenFlags({ entryMode: 'open' }, true)).to.deep.include({
      rated: false,
      autoHide: false,
      allowViewCode: false,
      allowVirtual: null,
      keepScoreboardHidden: false,
      allowPrint: false,
      vigilEnabled: false,
      entryMode: 'open',
      participationMode: 'individual',
    });
  });
});

describe('EXAM_CREATE_WALL_CLOCK_HOURS', () => {
  it('is 2', () => {
    expect(EXAM_CREATE_WALL_CLOCK_HOURS).to.equal(2);
  });
});
