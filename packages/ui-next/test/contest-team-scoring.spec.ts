import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

describe('P1.13 team scoring and record-access contracts', () => {
  const contestModel = source('packages/hydrooj/src/model/contest.ts');
  const contestHandler = source('packages/hydrooj/src/handler/contest.ts');
  const recordHandler = source('packages/hydrooj/src/handler/record.ts');
  const contestsPage = source('packages/ui-next/src/pages/contests.tsx');
  const managePage = source('packages/ui-next/src/pages/contest-manage.tsx');
  const rating = source('packages/hydrooj/src/script/rating.ts');

  it('aggregates the default, HTML, CSV and Ghost views by stable team identity', () => {
    expect(contestModel).to.include('getTeamScoreboardEntries');
    expect(contestModel).to.include('getTeamScoreboard.call(this, tdoc, config, pdict)');
    expect(contestModel).to.include("columns[1] = { type: 'string'");
    expect(contestHandler).to.include("if (contest.getParticipationMode(tdoc) === 'team')");
    expect(contestHandler).to.include('contest.getTeamScoreboardEntries(tdoc)');
    expect(contestHandler).to.match(/`@teams \$\{entries\.length\}`/);
    expect(contestHandler).to.include('toCSV(');
  });

  it('uses teams for live problem statistics, management participant counts and balloons', () => {
    expect(contestHandler).to.include("contestTeamId: { $type: 'objectId' }");
    expect(contestHandler).to.include("liveStatsParticipantUnit = teamMode ? 'team' : 'user'");
    expect(contestHandler).to.include("participantUnit: contest.getParticipationMode(this.tdoc) === 'team' ? 'team' : 'user'");
    expect(contestHandler).to.include('teamDict: Object.fromEntries');
    expect(contestModel).to.match(/const identityKey = contestTeamId \? `t:\$\{contestTeamId\.toHexString\(\)\}` : `u:\$\{uid\}`/);
    expect(contestModel).to.match(/identityIndexed: true/);
    expect(contestModel).to.match(/name: 'contestBalloonIdentityV2'/);
    expect(contestModel).to.match(/partialFilterExpression: \{ identityIndexed: true \}/);
    expect(managePage).to.include("data.liveStatsParticipantUnit === 'team' ? '队' : '人'");
    expect(managePage).to.include('team?.name || u?.uname');
  });

  it('shows team semantics while retaining the true actor on record rows', () => {
    expect(contestsPage).to.include("title={isTeam ? '本队提交' : '我的提交'}");
    expect(contestsPage).to.include("{isTeam ? '本队成绩' : '我的成绩'}");
    expect(managePage).to.include("teamMode ? '本队提交' : '我的提交'");
    expect(contestHandler).to.include('this.response.body.rdocs.map((rdoc: any) => rdoc.uid)');
  });

  it('grants records to current team members and revokes long-lived connections after roster changes', () => {
    expect(recordHandler).to.include('canAccessCurrentTeamRecord');
    expect(recordHandler).to.include("@subscribe('contest/team-role-change')");
    expect(recordHandler).to.include("this.close(4003, 'Team record access revoked')");
    expect(recordHandler).to.include('q.contestTeamId = team.teamId');
    expect(recordHandler).to.include('rdoc.contestTeamId.equals(this.teamId)');
    expect(recordHandler.match(/else this\.checkPerm\(PERM\.PERM_VIEW_RECORD\);/g)).to.have.length(2);
  });

  it('logs team submission authorization rejections without logging source code', () => {
    expect(contestModel).to.include('Team submission authorization denied domain=%s contest=%s team=%s actor=%d');
    expect(contestModel).to.include('operation=record.create result=rejected reason=%s');
  });

  it('explicitly excludes team contests from personal rating calculation', () => {
    expect(rating).to.include("participationMode: { $ne: 'team' }");
  });
});
