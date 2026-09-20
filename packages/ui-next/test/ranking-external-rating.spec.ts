// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankingShowsExternalRatingColumns } from '../src/pages/ranking-external-rating.ts';

const rankingPage = readFileSync(resolve(import.meta.dirname, '../src/pages/ranking.tsx'), 'utf8');

describe('ranking external rating columns', () => {
  it('keeps CF and Nowcoder columns when this page has no public scores', () => {
    expect(
      rankingShowsExternalRatingColumns({
        page: 2,
        udocs: [{ _id: 101 }, { _id: 102 }],
        externalRatingByUid: { '101': {}, '102': {} },
      }),
    ).to.equal(true);
  });

  it('hides the columns when ranking inject did not run', () => {
    expect(rankingShowsExternalRatingColumns({})).to.equal(false);
    expect(rankingShowsExternalRatingColumns({ page: 1, udocs: [{ _id: 2, codeforces: 3301 }] })).to.equal(false);
    expect(rankingShowsExternalRatingColumns({ externalRatingByUid: null })).to.equal(false);
    expect(rankingShowsExternalRatingColumns({ externalRatingByUid: [] })).to.equal(false);
    expect(rankingShowsExternalRatingColumns(null)).to.equal(false);
  });

  it('does not infer column visibility from current-page occupancy', () => {
    expect(rankingPage).to.include('rankingShowsExternalRatingColumns(data)');
    expect(rankingPage).not.to.include('visibleUsers.some');
    expect(rankingPage).not.to.include('hasCfRatingColumn');
    expect(rankingPage).not.to.include('hasNowcoderRatingColumn');
  });
});
