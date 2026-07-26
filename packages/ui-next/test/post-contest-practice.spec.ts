import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSubmitProblemMode, getPersonalPracticeStatus, postContestProblemEntryUrl } from '../src/lib/contest-exam-display';

describe('post-contest practice UI semantics', () => {
  it('distinguishes pre-contest accepted work from post-contest practice', () => {
    expect(getPersonalPracticeStatus({ status: 1, phase: 'before' })).to.include({
      label: '个人已通过（赛前）',
      code: 'pass',
    });
    expect(getPersonalPracticeStatus({ status: 1, phase: 'after' })).to.include({
      label: '已通过',
      code: 'pass',
    });
    expect(getPersonalPracticeStatus({ status: 2, phase: 'after' })).to.include({
      label: 'WA',
      code: 'fail',
    });
  });

  it('uses the normal problem list after supported client-required contests reopen', () => {
    expect(
      postContestProblemEntryUrl({
        rule: 'acm',
        clientRequired: true,
        practiceSupported: true,
        practiceOpen: true,
        ended: true,
        detailUrl: '/contest/abc',
        contestId: 'abc',
      }),
    ).to.equal('/contest/abc/problems');
  });

  it('preserves the exam-mode entry route for paper exams', () => {
    expect(
      postContestProblemEntryUrl({
        rule: 'exam',
        clientRequired: true,
        practiceSupported: false,
        practiceOpen: true,
        ended: true,
        detailUrl: '/contest/abc',
        contestId: 'abc',
      }),
    ).to.equal('/exam-mode/abc');
  });

  it('keeps a running client-required contest in the client workspace', () => {
    expect(
      postContestProblemEntryUrl({
        rule: 'acm',
        clientRequired: true,
        practiceSupported: true,
        practiceOpen: false,
        ended: false,
        detailUrl: '/contest/abc',
        contestId: 'abc',
      }),
    ).to.equal('/exam-mode/abc');
  });

  it('only renders submission controls in normal, live-contest, and correction modes', () => {
    expect(canSubmitProblemMode('normal')).to.equal(true);
    expect(canSubmitProblemMode('contest')).to.equal(true);
    expect(canSubmitProblemMode('correction')).to.equal(true);
    expect(canSubmitProblemMode('view')).to.equal(false);
    expect(canSubmitProblemMode('none')).to.equal(false);
  });

  it('keeps correction authorization in the submit URL while personalizing record streams', () => {
    const root = resolve(import.meta.dirname, '..');
    const page = readFileSync(resolve(root, 'src/pages/problem-detail.tsx'), 'utf8');
    const template = readFileSync(resolve(root, '../ui-default/templates/problem_detail.html'), 'utf8');
    const recordPage = readFileSync(resolve(root, 'src/pages/records.tsx'), 'utf8');
    const recordTemplate = readFileSync(resolve(root, '../ui-default/templates/record_detail.html'), 'utf8');
    const sidebar = readFileSync(resolve(root, '../ui-default/templates/partials/problem_sidebar_contest.html'), 'utf8');
    const paperHandler = readFileSync(resolve(root, '../hydrooj/src/handler/paper.ts'), 'utf8');
    expect(page).to.include('const recordContextTid = tid');
    expect(page).to.include('const recordPracticeScope = postContestPracticeActive || undefined');
    expect(page).to.include('practice: recordPracticeScope');
    expect(page).to.include('const submitUrl = ');
    const contestQueryInterpolation = `${String.fromCharCode(36)}{contestQS}`;
    expect(page).to.include(`/submit${contestQueryInterpolation}`);
    expect(template).to.include('{% elif tdoc and postContestPracticeActive %}');
    expect(template).to.include("url('problem_submit', pid=pdoc.docId, query={tid:tdoc.docId})");
    expect(template).to.include("query={fullStatus:'true', pid:pdoc.docId, tid:tdoc.docId, practice:1}");
    expect(recordPage).to.include('postContestPracticeRecordAccess');
    expect(recordPage).to.include('practice: postContestPracticeRecordAccess');
    expect(recordPage).to.include('const downloadUrl = buildUrlWithQuery(recordUrl, { download: true })');
    expect(recordTemplate).to.include('"&tid=" + practiceTid + "&practice=1"');
    expect(sidebar).to.include("query={tid:tdoc.docId} if mode=='contest' or postContestPracticeActive else {}");
    expect(paperHandler).to.include('redirectEndedProgrammingWorkspace');
    expect(paperHandler).to.include("handler.url('contest_problemlist', { tid })");
  });
});
