import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

describe('problem solution edit and vote contracts', () => {
  const page = source('packages/ui-next/src/pages/problem-manage.tsx');
  const handler = source('packages/hydrooj/src/handler/problem.ts');
  const model = source('packages/hydrooj/src/model/solution.ts');
  const vote = source('packages/hydrooj/src/lib/solution-vote.ts');

  it('lets owners edit after create and toggles the same vote off', () => {
    expect(page).to.include('value="edit_solution"');
    expect(page).to.include('canEdit');
    expect(page).to.include('pssdict');
    expect(page).to.include("aria-label={userVote === 1 ? '取消点赞' : '点赞'}");
    expect(handler).to.include('PERM.PERM_EDIT_PROBLEM_SOLUTION_SELF');
    expect(handler).to.include('canCreateSolution');
    expect(handler).to.include('canVoteSolution');
    expect(handler).to.include('user_vote: psdoc.userVote');
    expect(model).to.include('nextSolutionVote');
    expect(vote).to.include('previous === clicked ? 0 : clicked');
  });
});
