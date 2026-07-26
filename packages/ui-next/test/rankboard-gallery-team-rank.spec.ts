import { describe, expect, it } from 'vitest';
import { formatGalleryTeamRank } from '../src/pages/rankboard/gallery-team-rank.ts';

describe('rankboard gallery team-rank presentation', () => {
  it('formats every ICPC team-rank state and rejects contradictory data', () => {
    expect(formatGalleryTeamRank('confirmed', 42)).to.equal('队伍排名 #42');
    expect(formatGalleryTeamRank('missing', null)).to.equal('队伍排名待补充');
    expect(formatGalleryTeamRank('conflict', null)).to.equal('队伍排名待核对');

    expect(() => formatGalleryTeamRank('confirmed', null)).to.throw('confirmed rank must be a positive integer');
    expect(() => formatGalleryTeamRank('missing', 42)).to.throw('missing rank must not carry a value');
    expect(() => formatGalleryTeamRank('conflict', 42)).to.throw('conflict rank must not carry a value');
  });
});
