import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProblemRecordsHref } from '../src/pages/problem-detail.tsx';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

describe('exam shell problem submit and records', () => {
  it('keeps a contest problem record list inside the exam path', () => {
    expect(
      buildProblemRecordsHref({
        recordsBase: '/exam-mode/6a85208aa896bb67934b3bf7/record',
        docId: 42,
        pid: 'P0042',
        uidOrName: 7,
      }),
    ).to.equal('/exam-mode/6a85208aa896bb67934b3bf7/record?pid=42&uidOrName=7');
  });

  it('serves the submit page and record list from the exam shell', () => {
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    const contest = source('packages/ui-next/src/pages/exam-mode/contest.tsx');
    const detail = source('packages/ui-next/src/pages/problem-detail.tsx');
    const submit = source('packages/ui-next/src/pages/problem-submit.tsx');
    const records = source('packages/ui-next/src/pages/records.tsx');
    const problem = source('packages/hydrooj/src/handler/problem.ts');

    expect(paper).to.include("ctx.Route('exam_mode_problem_submit', '/exam-mode/:tid/problem/:pid/submit'");
    expect(paper).to.include("ctx.Route('exam_mode_record_list', '/exam-mode/:tid/record'");
    expect(paper).to.include('submit: `/exam-mode/${tid}/problem/__PID__/submit`');
    expect(paper).to.include('records: `/exam-mode/${tid}/record`');
    expect(contest).to.include("case 'problem_submit.html':");
    expect(contest).to.include("case 'record_main.html':");
    expect(detail).to.include('const examSubmitHref');
    expect(detail).to.include('title="我的状态"');
    expect(detail).to.include('contestSelfDisplay.label');
    expect(detail).to.include('examShell={examMode?.enabled === true}');
    expect(source('packages/ui-next/src/components/krypton-ide.tsx')).to.include('examShell: true');
    expect(problem).to.include('contestSelfStatus');
    expect(detail).to.include('examSubmitHref || independentSubmitUrl');
    expect(detail).not.to.include('!examMode?.enabled && !ideOnlySubmit');
    expect(submit).to.include("form.append('examShell', '1')");
    expect(submit).to.include('window.location.href = examRecord || json.url || (ridText ? replaceRouteTokens(bs.urls.recordDetail, { RID: ridText }) : \'\')');
    expect(records).to.include('const listUrl = examRecordsUrl || bs.urls.records');
    expect(records).to.include('action={listUrl}');
    expect(problem).to.include('`/exam-mode/${examShellTid}/record/${ridText}`');
  });

  it('says the exam has not started when problem ids are withheld', () => {
    const paper = source('packages/hydrooj/src/handler/paper.ts');
    const workspace = source('packages/ui-next/src/pages/exam-mode/workspace.tsx');
    expect(paper).to.include('problemsHiddenBeforeStart: hideProblemsBeforeStart');
    expect(paper).to.include('problemStatusByPid');
    expect(paper).to.include('RecordDetailHandler.prepare clears tdoc');
    expect(workspace).to.include('problemStatusByPid');
    expect(workspace).to.include('考试还没开始，所以现在没有题目。');
    expect(workspace).to.include("problemsHiddenBeforeStart ? '考试还没开始，所以现在没有题目。' : '该比赛没有题目'");
  });
});
