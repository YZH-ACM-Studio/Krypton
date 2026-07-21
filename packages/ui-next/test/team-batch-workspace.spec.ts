import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const hydroRoot = resolve(root, '../hydrooj/src');

describe('P1.17 pre-contest team batch workspace contracts', () => {
  it('registers a normal sidebar workspace with dedicated refresh-safe routes', () => {
    const handler = readFileSync(resolve(hydroRoot, 'handler/contest-team-batch.ts'), 'utf8');
    const resolver = readFileSync(resolve(root, 'src/pages/resolver.tsx'), 'utf8');
    const sidebar = readFileSync(resolve(root, 'src/components/layout/sidebar.tsx'), 'utf8');
    expect(handler).to.include("ctx.Route('team_batches', '/teams'");
    expect(handler).to.include("ctx.Route('team_batch_detail', '/teams/:batchId'");
    expect(handler).to.include("this.response.template = 'team_batches.html'");
    expect(handler).to.include("this.response.template = 'team_batch_detail.html'");
    expect(resolver).to.include("'team_batches.html': TeamBatchesPage");
    expect(resolver).to.include("'team_batch_detail.html': ContestTeamsPage");
    expect(sidebar).to.include("label: '队伍', href: '/teams'");
  });

  it('keeps ordinary responses scoped to the current user and manager listing server-paginated', () => {
    const handler = readFileSync(resolve(hydroRoot, 'handler/contest-team-batch.ts'), 'utf8');
    expect(handler).to.include('getTeamByMember(this.domainId(), batchId, this.user._id)');
    expect(handler).to.include('getPendingInvitesForUser(this.domainId(), batchId, this.user._id)');
    expect(handler).to.include('if (this.canManage)');
    expect(handler).to.include('await this.paginate(teamBatch.getMultiTeam');
    expect(handler).to.include('getPublicTeamUsers(this.domainId(), [...allUids])');
    expect(handler).to.include('searchPublicTeamUsers(this.domainId(), q, 20)');
    expect(handler).to.include('!Number.isSafeInteger(uid) || uid <= 1');
    expect(handler).not.to.include('.filter((uid) => Number.isFinite(uid))');
    expect(handler).not.to.include('JSON.stringify(teams)');
  });

  it('uses the existing branded team workspace and a custom irreversible close confirmation', () => {
    const list = readFileSync(resolve(root, 'src/pages/team-batches.tsx'), 'utf8');
    const workspace = readFileSync(resolve(root, 'src/pages/contest-teams.tsx'), 'utf8');
    expect(list).to.include('队伍中心');
    expect(list).to.include('新建组队批次');
    expect(workspace).to.include("const isBatch = data.workspaceKind === 'batch'");
    expect(workspace).to.include("operation: 'close'");
    expect(workspace).to.include('expectedRevision: Number(batch.revision || 0)');
    expect(workspace).to.include('<ConfirmDialog action={confirmAction}');
    expect(workspace).not.to.include('window.confirm');
    expect(workspace).not.to.include('window.alert');
  });

  it('offers only closed batches for team contests and binds through the canonical snapshot model', () => {
    const editor = readFileSync(resolve(root, 'src/pages/contest-manage.tsx'), 'utf8');
    const contestHandler = readFileSync(resolve(hydroRoot, 'handler/contest.ts'), 'utf8');
    const model = readFileSync(resolve(hydroRoot, 'model/contest-team-batch.ts'), 'utf8');
    expect(editor).to.include('name="teamBatchId"');
    expect(editor).to.include('closedTeamBatches.map');
    expect(editor).to.include('不使用赛前批次');
    expect(contestHandler).to.include('contestTeamBatch.listClosedBatches');
    expect(contestHandler).to.include('contestTeamBatch.snapshotToContest');
    expect(model).to.include("batch.status !== 'closed'");
    expect(model).to.include("snapshotState: 'preparing'");
    expect(model).to.include("snapshotState: 'active'");
    expect(model).to.include('sourceBatchTeamId: source.teamId');
    expect(model).to.include("partialFilterExpression: { active: true, snapshotState: 'active' }");
    expect(model).to.include('withContestTeamBoundary(domainId, contestId');
  });

  it('shares one application-visible boundary with ordinary contest teams and runtime readers', () => {
    const teamModel = readFileSync(resolve(hydroRoot, 'model/contest-team.ts'), 'utf8');
    const contestModel = readFileSync(resolve(hydroRoot, 'model/contest.ts'), 'utf8');
    expect(teamModel).to.include('withContestTeamBoundary(domainId, contestId');
    expect(teamModel).to.include('export async function paginateTeams');
    expect(teamModel).to.include('export async function listTeams');
    expect(contestModel).to.include('withContestTeamBoundary(domainId, tid');
    expect(contestModel).to.include('withContestTeamBoundary(tdoc.domainId, tdoc.docId');
  });

  it('does not make contest scoring, submission or Vigil runtime paths depend on batch collections', () => {
    for (const file of ['contest-team-status.ts', 'contest-team-code.ts']) {
      const source = readFileSync(resolve(hydroRoot, `model/${file}`), 'utf8');
      expect(source).not.to.include('contest-team-batch');
      expect(source).not.to.include('contest.teamBatch');
    }
    const vigil = readFileSync(resolve(root, '../krypton-vigilguard/src/handler.ts'), 'utf8');
    expect(vigil).not.to.include('contest-team-batch');
    expect(vigil).not.to.include('contest.teamBatch');
  });
});
