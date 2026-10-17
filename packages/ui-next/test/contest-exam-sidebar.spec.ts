// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiRoot = resolve(import.meta.dirname, '..');

function source(relative: string) {
  return readFileSync(resolve(uiRoot, relative), 'utf8');
}

function sourceHits(dir: string, pattern: RegExp, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      sourceHits(full, pattern, hits);
      continue;
    }
    if (!/\.[jt]sx?$/.test(entry.name)) continue;
    if (pattern.test(readFileSync(full, 'utf8'))) hits.push(full.slice(uiRoot.length + 1));
  }
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).to.be.at.least(0);
  expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
  return text.slice(start, end);
}

describe('contest exam sidebar', () => {
  it('hides balloon from managementItems when tdoc.rule is exam', () => {
    const page = source('src/pages/contest-manage.tsx');
    const items = sliceBetween(page, 'function managementItems(', 'return items.filter');
    const balloon = sliceBetween(items, "key: 'balloon'", "key: 'print'");
    expect(balloon).to.include('show: !isExamRule(tdoc.rule)');
  });

  it('hides balloon from the contest detail sidebar when exam', () => {
    const page = source('src/pages/contests.tsx');
    const balloon = sliceBetween(page, 'canManageContest && !isExam', '打印题面');
    expect(balloon).to.include(['$', '{detailUrl}/balloon'].join(''));
  });

  it('routes exam contest_detail onto the exam landing and omits balloon there', () => {
    const contests = source('src/pages/contests.tsx');
    const exam = source('src/pages/contest-exam-detail.tsx');
    expect(contests).to.match(/isExamRule\(data\.tdoc\?\.rule\)[\s\S]{0,80}ExamContestDetailPage/);
    expect(exam).not.to.include('/balloon');
    expect(exam).to.include('报名考试');
    expect(exam).to.include('postContestProblemEntryUrl');
    expect(exam).to.include("rule: 'exam'");
    expect(exam).not.to.include('参加比赛');
    expect(exam).not.to.include('打星参赛');
  });

  it('does not mention ContestEditAcmForm or contest-edit-exam under src', () => {
    const hits: string[] = [];
    sourceHits(resolve(uiRoot, 'src'), /ContestEditAcmForm|contest-edit-exam/, hits);
    expect(hits).to.deep.equal([]);
  });

  it('routes exam contest_manage onto exam chrome and omits balloon there', () => {
    const manage = source('src/pages/contest-manage.tsx');
    const exam = source('src/pages/contest-exam-manage.tsx');
    const switcher = sliceBetween(manage, 'export function ContestManagePage()', 'function ContestAcmManagePage(');
    expect(switcher).to.include('isExamRule(tdoc.rule)');
    expect(switcher).to.include('ExamContestManagePage');
    const chrome = sliceBetween(manage, 'function ContestManagementChrome(', 'const items = managementItems(');
    expect(chrome).to.include('isExamRule(tdoc.rule)');
    expect(chrome).to.include('ExamManagementChrome');
    expect(exam).not.to.include('/balloon');
    expect(exam).to.include('考试管理');
    expect(exam).to.include('考生名单');
    expect(exam).not.to.include('参赛选手');
    expect(exam).not.to.include('提交统计');
    expect(exam).not.to.include('比赛管理');
  });
});
