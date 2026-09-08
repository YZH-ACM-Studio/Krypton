import { describe, expect, it } from 'vitest';
import {
  LADDER_DETAIL_COLUMNS,
  awardHasEditableExamScore,
  emptyAwardTally,
  isIcpcEcType,
  isIcpcRegularType,
  isRankboardStatsMode,
  mergeAwardTally,
  rankboardTableRows,
  rowMatchesAwardFilter,
  shouldShowLadderDetails,
  tallyAwards,
  withoutLadderKeys,
  type AwardTypeLike,
} from '../src/pages/rankboard/award-display.ts';

const types: AwardTypeLike[] = [
  { key: 'icpc_gold', name: 'ICPC-金奖', order: 10 },
  { key: 'icpc_silver', name: 'ICPC-银奖', order: 20 },
  { key: 'icpc_bronze', name: 'ICPC-铜奖', order: 30 },
  { key: 'icpc_ec_gold', name: 'ICPC-EC-金奖', order: 40 },
  { key: 'icpc_ec_silver', name: 'ICPC-EC-银奖', order: 50 },
  { key: 'icpc_ec_bronze', name: 'ICPC-EC-铜奖', order: 60 },
  { key: 'ladder_team_special', name: '天梯赛-团队特等奖', order: 160 },
  { key: 'ladder_team_1', name: '天梯赛-团队一等奖', order: 170 },
];

const typeMap = new Map(types.map((type) => [type.key, type]));

describe('rankboard award display', () => {
  it('does not treat ICPC-EC medals as regular ICPC medals', () => {
    expect(isIcpcEcType(types[3])).to.equal(true);
    expect(isIcpcRegularType(types[3])).to.equal(false);
    expect(isIcpcRegularType({ key: 'custom', name: 'ICPC-金奖' })).to.equal(true);
    expect(isIcpcRegularType({ key: 'custom', name: 'ICPC-EC-金奖' })).to.equal(false);
    expect(isIcpcEcType({ key: 'custom', name: 'ICPC-EC-金奖' })).to.equal(true);
  });

  it('splits regional and EC bronze as 1（+1） and keeps unmatched metals at 0（+1）', () => {
    const bronzeAndEc = tallyAwards([{ type: 'icpc_bronze' }, { type: 'icpc_ec_bronze' }], typeMap);
    expect(bronzeAndEc.icpc.bronze).to.deep.equal({ regular: 1, extra: 1 });
    const onlyEc = tallyAwards([{ type: 'icpc_ec_bronze' }], typeMap);
    expect(onlyEc.icpc.bronze).to.deep.equal({ regular: 0, extra: 1 });
    const silverAndEcBronze = tallyAwards([{ type: 'icpc_silver' }, { type: 'icpc_ec_bronze' }], typeMap);
    expect(silverAndEcBronze.icpc.silver).to.deep.equal({ regular: 1, extra: 0 });
    expect(silverAndEcBronze.icpc.bronze).to.deep.equal({ regular: 0, extra: 1 });
  });

  it('keeps 天梯赛 aggregated until a detail option or the detail toggle is on', () => {
    expect(shouldShowLadderDetails(new Set(), false, types)).to.equal(false);
    expect(shouldShowLadderDetails(new Set(['icpc_gold']), false, types)).to.equal(false);
    expect(shouldShowLadderDetails(new Set(['ladder_team_1']), false, types)).to.equal(true);
    expect(shouldShowLadderDetails(new Set(), true, types)).to.equal(true);
    expect(LADDER_DETAIL_COLUMNS).to.have.length(7);
  });

  it('lets the 天梯赛 parent filter all ladder awards without selecting detail keys', () => {
    const awards = [{ type: 'ladder_team_special' }, { type: 'icpc_gold' }];
    expect(rowMatchesAwardFilter(awards, new Set(), true, typeMap)).to.equal(true);
    expect(rowMatchesAwardFilter(awards, new Set(['icpc_silver']), false, typeMap)).to.equal(false);
    expect(rowMatchesAwardFilter(awards, new Set(['icpc_gold']), false, typeMap)).to.equal(true);
    expect(rowMatchesAwardFilter([{ type: 'ladder_team_special' }], new Set(['ladder_team_1']), false, typeMap)).to.equal(false);
    expect(rowMatchesAwardFilter([{ type: 'ladder_team_1' }], new Set(['ladder_team_1']), false, typeMap)).to.equal(true);
  });

  it('drops ladder child keys when the parent is used so detail columns stay collapsed', () => {
    const next = withoutLadderKeys(new Set(['ladder_team_1', 'icpc_gold']), ['ladder_team_1', 'ladder_team_special']);
    expect([...next]).to.deep.equal(['icpc_gold']);
    expect(shouldShowLadderDetails(next, false, types)).to.equal(false);
  });

  it('lets admins edit exam scores on PAT and 天梯赛个人 awards only', () => {
    expect(awardHasEditableExamScore('pat_a')).to.equal(true);
    expect(awardHasEditableExamScore('ladder_individual_1')).to.equal(true);
    expect(awardHasEditableExamScore('ladder_team_1')).to.equal(false);
    expect(awardHasEditableExamScore('icpc_gold')).to.equal(false);
  });

  it('puts every filtered row into the table and sums medal columns in stats mode', () => {
    expect(
      isRankboardStatsMode({
        typeFilterSize: 1,
        ladderGroupSelected: false,
        schoolFilter: 'all',
        yearFilter: 'all',
        search: '',
      }),
    ).to.equal(true);
    expect(
      isRankboardStatsMode({
        typeFilterSize: 0,
        ladderGroupSelected: false,
        schoolFilter: 'all',
        yearFilter: 'all',
        search: '',
      }),
    ).to.equal(false);
    const rows = [{ rank: 1 }, { rank: 4 }, { rank: 2 }];
    expect(rankboardTableRows(rows, false).map((row) => row.rank)).to.deep.equal([4]);
    expect(rankboardTableRows(rows, true).map((row) => row.rank)).to.deep.equal([1, 4, 2]);
    const gold = tallyAwards([{ type: 'icpc_gold' }, { type: 'icpc_ec_gold' }], typeMap);
    const moreGold = tallyAwards([{ type: 'icpc_gold' }], typeMap);
    expect(mergeAwardTally(gold, moreGold).icpc.gold).to.deep.equal({ regular: 2, extra: 1 });
    expect(mergeAwardTally(emptyAwardTally(), gold).icpc.gold).to.deep.equal({ regular: 1, extra: 1 });
  });
});
