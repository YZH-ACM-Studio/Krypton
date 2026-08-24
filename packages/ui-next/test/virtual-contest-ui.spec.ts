import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('P4.3 virtual contest UI', () => {
  it('keeps start-virtual and post-contest practice as separate entries', () => {
    const contests = readFileSync(resolve(root, 'src/pages/contests.tsx'), 'utf8');
    expect(contests).to.include('开始虚拟参赛');
    expect(contests).to.include('赛后补题入口');
    expect(contests).to.include('与赛后补题分开');
    expect(contests).to.include('/virtual');
    const page = readFileSync(resolve(root, 'src/pages/virtual-contest.tsx'), 'utf8');
    expect(page).to.include('不启动考试客户端');
    expect(page).to.include('virtual=1');
    expect(page).to.include('?tid=${encodeURIComponent(tid)}&virtual=1');
    expect(page).to.include('?tid=${encodeURIComponent(tid)}');
    expect(page).to.include('继续赛后练习');
    expect(page).to.include('这是普通浏览器里的自律计时训练');
    expect(page).to.include('不能当作防作弊');
  });

  it('keeps VP submit, records, and remaining time on the isolated problem page', () => {
    const detail = readFileSync(resolve(root, 'src/pages/problem-detail.tsx'), 'utf8');
    expect(detail).to.include('?tid=${tid}&virtual=1');
    expect(detail).to.include('virtual: virtualContestActive');
    expect(detail).to.include('虚拟参赛');
    expect(detail).to.include('virtualRemainingMs');
    expect(detail).not.to.include('强防作弊');
    const submit = readFileSync(resolve(root, 'src/pages/problem-submit.tsx'), 'utf8');
    expect(submit).to.include('?tid=${tid}&virtual=1');
    const records = readFileSync(resolve(root, 'src/pages/records.tsx'), 'utf8');
    expect(records).to.include("virtual: virtualRecords ? '1' : ''");
    expect(records).to.include('name="virtual"');
    expect(records).to.include('data.virtualAttemptOpen === true');
    expect(records).to.include('virtual: virtualRecords');
    expect(records).to.include('virtual: virtualAttemptOpen');
    expect(records).to.include('virtual: true');
  });
});
