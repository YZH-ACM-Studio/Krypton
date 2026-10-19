// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');

function source(filePath: string) {
  return readFileSync(resolve(workspaceRoot, filePath), 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start >= 0, `missing ${startMarker}`).to.equal(true);
  expect(end > start, `missing ${endMarker} after ${startMarker}`).to.equal(true);
  return text.slice(start, end);
}

describe('student sets template registration', () => {
  const pageMap = sliceBetween(
    source('packages/ui-next/src/pages/resolver.tsx'),
    'const PAGE_MAP',
    'export function PageResolver',
  );

  it('maps student_sets.html to StudentSetsPage', () => {
    expect(pageMap).to.include("'student_sets.html': StudentSetsPage");
  });

  it('maps team_batch_manage.html to ContestTeamsPage', () => {
    expect(pageMap).to.include("'team_batch_manage.html': ContestTeamsPage");
  });

  it('maps team_batch_detail.html to TeamBatchStudentPage', () => {
    expect(pageMap).to.include("'team_batch_detail.html': TeamBatchStudentPage");
  });

  it('keeps problem_set_main.html mapped to ProblemSetPage', () => {
    expect(pageMap).to.include("'problem_set_main.html': ProblemSetPage");
  });
});
