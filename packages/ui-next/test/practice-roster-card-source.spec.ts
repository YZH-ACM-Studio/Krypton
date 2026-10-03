import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = resolve(import.meta.dirname, '..');

function source(relativePath: string): string {
  return readFileSync(resolve(pkg, relativePath), 'utf8');
}

describe('practice roster card source', () => {
  const roster = source('src/components/practice-roster.tsx');

  it('uses an all-students select label, empty default matrix, and an eight-chip gate', () => {
    expect(roster).to.include('全部学生');
    expect(roster).not.to.include('全部组');
    expect(roster).to.match(
      /groupFilter\s*\?\s*columns\.filter\(\(column\)\s*=>\s*column\.id\s*===\s*groupFilter\)\s*:\s*\[\]/,
    );
    expect(roster).to.include('columns.length <= 8');
  });

  it('keeps the roster title, search, class-group header, and both-axis table scroll', () => {
    expect(roster).to.include('参加名单');
    expect(roster.match(/<ScrollArea\b[^>]+orientation="both"/g)?.length, 'both roster tables').to.equal(2);
    expect(roster).to.include('176 + matrixColumns.length * 96');
    expect(roster).to.include('placeholder="搜索用户名/姓名/学号/班级"');
    expect(roster).to.include('班级组');
  });
});
