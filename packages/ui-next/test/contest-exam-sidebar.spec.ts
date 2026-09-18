// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiRoot = resolve(import.meta.dirname, '..');

function source(relative: string) {
  return readFileSync(resolve(uiRoot, relative), 'utf8');
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
    expect(balloon).to.include("show: String(tdoc.rule) !== 'exam'");
  });

  it('hides balloon from the contest detail sidebar when exam', () => {
    const page = source('src/pages/contests.tsx');
    const balloon = sliceBetween(page, 'canManageContest && !isExam', '打印题面');
    expect(balloon).to.include('${detailUrl}/balloon');
  });

  it('uses 创建考试 and 编辑考试 copy when contest-edit-exam.tsx exists', () => {
    const examPath = resolve(uiRoot, 'src/pages/contest-edit-exam.tsx');
    if (!existsSync(examPath)) return;
    const exam = readFileSync(examPath, 'utf8');
    expect(exam).to.include('创建考试');
    expect(exam).to.include('编辑考试');
  });
});
