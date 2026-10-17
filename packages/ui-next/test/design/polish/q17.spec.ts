// @vitest-environment node
import { describe, it } from 'vitest';
import { expectGateClean } from '../helpers.ts';

const PAGE = 'src/pages/contest-manage.tsx';

describe('q17 contest edit page layout above 1536px', () => {
  it('比赛管理页门禁零违规', () => {
    expectGateClean([PAGE]);
  });
});
