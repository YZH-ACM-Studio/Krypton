import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { evaluateSelfTeamName } from '../src/lib/contest-team-form';

const workspace = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

describe('P1.12 team assembly workspace contracts', () => {
  const handler = source('packages/hydrooj/src/handler/contest-team.ts');
  const model = source('packages/hydrooj/src/model/contest-team.ts');
  const page = source('packages/ui-next/src/pages/contest-teams.tsx');
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const contests = source('packages/ui-next/src/pages/contests.tsx');

  it('registers a refresh-safe route and a dedicated page instead of GenericPage', () => {
    expect(handler).to.include("ctx.Route('contest_teams', '/contest/:tid/teams'");
    expect(handler).to.include("this.response.template = 'contest_teams.html'");
    expect(resolver).to.include("import { ContestTeamsPage } from '@/pages/contest-teams'");
    expect(resolver).to.include("'contest_teams.html': ContestTeamsPage");
    expect(sidebar).to.include("'contest_teams.html'");
    expect(contests).to.include('teamWorkspaceUrl');
    expect(contests).to.include('管理我的队伍');
  });

  it('keeps ordinary bootstrap scoped to the current team and targeted invitations', () => {
    expect(handler).to.include('getTeamByMember(this.domainId(), tid, this.user._id)');
    expect(handler).to.include('getPendingInvitesForUser(this.domainId(), tid, this.user._id)');
    expect(handler).to.match(/if \(this\.canManage\)[\s\S]*?contestTeam\.paginateTeams/);
    expect(handler).to.include('_id: uid');
    expect(handler).to.include('uname: rawUsers[uid]?.uname');
    expect(handler).to.include('displayName: rawUsers[uid]?.displayName');
    expect(handler).not.to.match(/(?:mail|studentId|studentRecord|schoolId):\s*rawUsers/);
  });

  it('enforces eligibility, final membership uniqueness, stable invites and start-time freezing on the server', () => {
    expect(model).to.include('await assertContestTeamEligibility(domainId, latestContest, inviteeUid)');
    expect(model).to.include('await assertContestTeamEligibility(domainId, latestContest, actor.user._id)');
    expect(model).to.include("partialFilterExpression: { status: 'pending' }");
    expect(model).to.include('partialFilterExpression: { active: true }');
    expect(model).to.include("status: 'accepting'");
    expect(model).to.include("status: 'superseded'");
    expect(model).to.include("teamConflict('contest_started')");
    expect(handler).to.include("team.managementMode === 'self'");
  });

  it('uses server pagination and revision-bound emergency confirmation without a presence subsystem', () => {
    expect(handler).to.include('contestTeam.paginateTeams(this.domainId(), tid, teamQuery, page, 20)');
    expect(handler).to.include('nameKey: { $regex: teamNameSearch(teamSearch) }');
    expect(page).to.include('name="teamSearch"');
    expect(handler).to.include('emergencyTeamConfirmation(team.teamId, team.revision)');
    expect(page).to.include('高风险赛中调整');
    expect(page).to.include('已有成绩绑定稳定 teamId，不会转移或重算');
    expect(handler).not.to.match(/presence|onlineUsers|socketPresence/i);
  });

  it('provides all required self and admin operations through branded dialogs', () => {
    for (const operation of [
      'create_self',
      'create_solo',
      'invite',
      'accept_invite',
      'decline_invite',
      'update_info',
      'transfer_captain',
      'remove_member',
      'leave',
      'create_admin',
      'update_admin',
      'deactivate',
    ]) {
      expect(page, `missing operation ${operation}`).to.include(operation);
    }
    expect(page).to.include('<Dialog');
    expect(page).to.include('<ConfirmDialog');
    expect(page).not.to.match(/window\.(?:alert|confirm)|\balert\(|\bconfirm\(/);
  });

  it('uses a polished self-team dialog with inline validation instead of the native required bubble', () => {
    const start = page.indexOf('<Dialog open={createSelfOpen}');
    const end = page.indexOf('<Dialog open={adminCreateOpen}', start);
    const dialog = page.slice(start, end);
    expect(dialog).to.include('method="post"');
    expect(dialog).to.include('name="operation" value="create_self"');
    expect(dialog).to.include('name="name"');
    expect(dialog).to.include('name="description"');
    expect(dialog).to.include('noValidate');
    expect(dialog).to.include('onSubmit={handleCreateSelfSubmit}');
    expect(dialog).to.include('role="dialog"');
    expect(dialog).to.include('aria-modal="true"');
    expect(dialog).to.include('overflow-y-auto overscroll-contain');
    expect(dialog).not.to.include('placeholder="1–64 个字符"');
  });

  it('blocks the native post only for empty and whitespace-only self-team names', () => {
    expect(evaluateSelfTeamName('')).to.deep.equal({ error: '请输入队伍名称', preventSubmit: true });
    expect(evaluateSelfTeamName('   \t')).to.deep.equal({ error: '请输入队伍名称', preventSubmit: true });
    expect(evaluateSelfTeamName('  Null Pointers  ')).to.deep.equal({ error: '', preventSubmit: false });
    expect(page).to.match(/if \(!nameValidation\.preventSubmit\)[\s\S]*?return;[\s\S]*?event\.preventDefault\(\)/);
  });

  it('keeps an invitation persisted when notification delivery fails and logs the exact identifiers', () => {
    const persist = handler.indexOf('contestTeam.createInvite');
    const notify = handler.indexOf('message.send', persist);
    const observableFailure = handler.indexOf("'[contest-team] invitation persisted but notification failed'", notify);
    expect(persist).to.be.greaterThan(-1);
    expect(notify).to.be.greaterThan(persist);
    expect(observableFailure).to.be.greaterThan(notify);
    expect(handler.slice(observableFailure, observableFailure + 420)).to.include('inviteId: invite.inviteId');
  });
});
