import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const hydroRoot = resolve(root, '../hydrooj/src');

describe('p1.17 pre-contest team batch workspace contracts', () => {
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
    expect(list).to.include('<TeamDialogContent');
    expect(list).not.to.include('<DialogContent');
    expect(workspace).to.include("const isBatch = data.workspaceKind === 'batch'");
    expect(workspace).to.include("operation: 'close'");
    expect(workspace).to.include('expectedRevision: Number(batch.revision || 0)');
    expect(workspace).to.include('<ConfirmDialog action={confirmAction}');
    expect(workspace).not.to.include('window.confirm');
    expect(workspace).not.to.include('window.alert');
  });

  it('copies a batch through the canonical model and the shared team dialog', () => {
    const handler = readFileSync(resolve(hydroRoot, 'handler/contest-team-batch.ts'), 'utf8');
    const model = readFileSync(resolve(hydroRoot, 'model/contest-team-batch.ts'), 'utf8');
    const workspace = readFileSync(resolve(root, 'src/pages/contest-teams.tsx'), 'utf8');
    expect(handler).to.include('teamBatch.copyBatch(this.domainId(), batchId');
    expect(handler).to.include('canCopy: this.canManage');
    expect(handler).to.include('teamBatch.countBatchTeams(this.domainId(), batchId)');
    expect(handler).to.include('batchTeamCount,');
    expect(model).to.include('copiedFromBatchId: sourceBatchId');
    expect(model).to.include('if (targetTeams.length) await teamColl.insertMany(targetTeams)');
    expect(model.indexOf('teamColl.insertMany(targetTeams)')).to.be.lessThan(model.indexOf('batchColl.insertOne(targetBatch)'));
    expect(workspace).to.include('title="复制组队批次"');
    expect(workspace).to.include('name="operation" value="copy"');
    expect(workspace).to.include('Number(data.batchTeamCount || 0)');
    expect(workspace).to.include('Number(data.memberCount || 0)');
    expect(workspace).to.include('邀请、历史记录、关闭状态和比赛快照不会复制');
  });

  it('only offers a confirmed reopen when the server proves the closed batch was never used', () => {
    const handler = readFileSync(resolve(hydroRoot, 'handler/contest-team-batch.ts'), 'utf8');
    const model = readFileSync(resolve(hydroRoot, 'model/contest-team-batch.ts'), 'utf8');
    const workspace = readFileSync(resolve(root, 'src/pages/contest-teams.tsx'), 'utf8');
    expect(handler).to.include('teamBatch.canReopenBatch(this.domainId(), batchId)');
    expect(handler).to.include('teamBatch.reopenBatch(this.domainId(), batchId, expectedRevision');
    expect(model).to.include("conflict('batch_already_used_copy_required')");
    expect(model).to.include('return await withBatchMutation(domainId, batchId');
    expect(workspace).to.include("operation: 'reopen'");
    expect(workspace).to.include('若批次已生成过比赛快照，服务端会拒绝并要求改用复制');
  });

  it('pre-binds open or closed batches and finalizes only through the canonical snapshot model', () => {
    const editor = readFileSync(resolve(root, 'src/pages/contest-manage.tsx'), 'utf8');
    const contestHandler = readFileSync(resolve(hydroRoot, 'handler/contest.ts'), 'utf8');
    const model = readFileSync(resolve(hydroRoot, 'model/contest-team-batch.ts'), 'utf8');
    expect(editor).to.include('name="plannedTeamBatchId"');
    expect(editor).to.include('teamBatches.map');
    expect(editor).to.include('不预绑定批次');
    expect(editor).to.include('value="finalize_team_batch"');
    expect(contestHandler).to.include('contestTeamBatch.listBatches');
    expect(contestHandler).to.include('contestTeamBatch.setContestPlannedBatch');
    expect(contestHandler).to.include('contestTeamBatch.writeCreatedContestPlannedBatch');
    expect(contestHandler).to.include('contestTeamBatch.clearContestTeamBatchPointers');
    expect(contestHandler).to.include('contestTeamBatch.finalizePlannedBatchToContest');
    expect(contestHandler).not.to.include('contestTeamBatch.snapshotToContest(authoritativeDomainId');
    expect(contestHandler).not.to.include('requestedPlannedTeamBatchId ? { plannedTeamBatchId: requestedPlannedTeamBatchId }');
    expect(contestHandler).not.to.include('document.set(authoritativeDomainId, document.TYPE_CONTEST, tid, undefined');
    expect(model).to.include("batch.status !== 'closed'");
    expect(model).to.include('plannedTeamBatchId: batchId');
    expect(model).to.include("$unset: { plannedTeamBatchId: '' }");
    expect(model).to.include("snapshotState: 'preparing'");
    expect(model).to.include("snapshotState: 'active'");
    expect(model).to.include('sourceBatchTeamId: source.teamId');
    expect(model).to.include("partialFilterExpression: { active: true, snapshotState: 'active' }");
    expect(model).to.include('withContestTeamBoundary(domainId, contestId');
  });

  it('runs a manager-gated manual readiness check without polling or automatic repair', () => {
    const editor = readFileSync(resolve(root, 'src/pages/contest-manage.tsx'), 'utf8');
    const contestHandler = readFileSync(resolve(hydroRoot, 'handler/contest.ts'), 'utf8');
    const model = readFileSync(resolve(hydroRoot, 'model/contest-team-batch.ts'), 'utf8');
    expect(editor).to.include("operation: 'check_team_readiness'");
    expect(editor).to.include('只读检查已保存配置');
    expect(editor).to.include('teamReadiness.canFinalize');
    expect(editor).not.to.include('setInterval(');
    expect(contestHandler).to.include('contestTeamBatch.checkContestReadiness');
    expect(contestHandler).to.include('canManageTeamBatches ? contestTeamBatch.listBatches');
    expect(model).to.include('export async function checkContestReadiness');
    expect(model).to.include('requireManager(actor)');
    expect(model).to.include("blockCodes: items.filter((item) => item.level === 'block')");
    expect(model).not.to.include('clientInstalled');
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
    for (const file of ['contest.ts', 'contest-team.ts', 'contest-team-status.ts', 'contest-team-code.ts']) {
      const source = readFileSync(resolve(hydroRoot, `model/${file}`), 'utf8');
      expect(source).not.to.include('contest-team-batch');
      expect(source).not.to.include('contest.teamBatch');
    }
    const vigilIntegration = readFileSync(resolve(hydroRoot, 'handler/vigil-integration.ts'), 'utf8');
    expect(vigilIntegration).not.to.include('contest-team-batch');
    expect(vigilIntegration).not.to.include('contest.teamBatch');
    const vigil = readFileSync(resolve(root, '../krypton-vigilguard/src/handler.ts'), 'utf8');
    expect(vigil).not.to.include('contest-team-batch');
    expect(vigil).not.to.include('contest.teamBatch');
  });
});
