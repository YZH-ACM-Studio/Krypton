import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { ContestNotFoundError, NotAssignedError, PermissionError, UserNotFoundError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { PERM } from '../model/builtin';
import * as contest from '../model/contest';
import * as contestTeam from '../model/contest-team';
import message from '../model/message';
import user from '../model/user';
import { Handler, param, Types } from '../service/server';

interface PublicTeamUser {
    _id: number;
    uname: string;
    displayName: string;
}

function parseMemberUids(value: string): number[] {
    const tokens = String(value || '')
        .split(/[\s,;，]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    const memberUids = tokens.map((item) => Number(item));
    if (memberUids.some((uid) => !Number.isSafeInteger(uid) || uid <= 0)) throw new ValidationError('memberUids');
    return contestTeam.normalizeMemberUids(memberUids);
}

function publicContest(tdoc: Tdoc) {
    return {
        docId: tdoc.docId,
        title: tdoc.title,
        rule: tdoc.rule,
        beginAt: tdoc.beginAt,
        endAt: tdoc.endAt,
        participationMode: contest.getParticipationMode(tdoc),
        participationRevision: tdoc.participationRevision ?? 0,
    };
}

function publicTeam(team: contestTeam.ContestTeamDoc, includeEmergencyConfirmation = false) {
    return {
        teamId: team.teamId,
        name: team.name,
        description: team.description,
        captainUid: team.captainUid,
        memberUids: team.memberUids,
        managementMode: team.managementMode,
        revision: team.revision,
        active: team.active,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        ...(includeEmergencyConfirmation ? { emergencyConfirmation: contestTeam.emergencyTeamConfirmation(team.teamId, team.revision) } : {}),
    };
}

function eligibilityRejection(error: unknown): boolean {
    return error instanceof NotAssignedError || error instanceof UserNotFoundError;
}

function teamNameSearch(value: string): RegExp {
    const query = value.trim();
    if (!query || query.length > 64) throw new ValidationError('teamSearch');
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

export class ContestTeamsHandler extends Handler {
    tdoc: Tdoc;
    canManage = false;

    private domainId(): string {
        return String(this.domain?._id);
    }

    private redirectToTeams(tid: ObjectId) {
        this.response.redirect = this.url('contest_teams', { tid });
    }

    private actor(emergencyConfirmation = ''): contestTeam.ContestTeamActor {
        return { user: this.user, emergencyConfirmation };
    }

    private requireManager() {
        if (!this.canManage) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
    }

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        this.tdoc = await contest.get(this.domainId(), tid);
        if (!this.tdoc || contest.getParticipationMode(this.tdoc) !== 'team' || this.tdoc.rule !== 'acm') {
            throw new ContestNotFoundError(this.domainId(), tid);
        }
        this.canManage = contestTeam.canManageContestTeams(this.user, this.tdoc);
        if (!this.canManage) {
            this.checkPerm(PERM.PERM_VIEW_CONTEST);
            this.checkPerm(PERM.PERM_ATTEND_CONTEST);
            await contestTeam.assertContestTeamEligibility(this.domainId(), this.tdoc, this.user._id);
        }
    }

    private async searchEligibleUsers(tid: ObjectId, query: string): Promise<PublicTeamUser[]> {
        const q = query.trim();
        if (!q) return [];
        if (q.length > 64) throw new ValidationError('search');
        const ownTeam = await contestTeam.getTeamByMember(this.domainId(), tid, this.user._id);
        const beforeStart = new Date() < this.tdoc.beginAt;
        const canInvite = beforeStart && ownTeam?.managementMode === 'self' && ownTeam.captainUid === this.user._id && ownTeam.memberUids.length < 3;
        if (!this.canManage && !canInvite) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);

        const candidates = (await user.getPrefixList(this.domainId(), q, 20)).filter((candidate) => candidate?._id > 1);
        const uids = Array.from(new Set(candidates.map((candidate) => candidate._id)));
        const assigned = uids.length ? await contestTeam.getMultiTeam(this.domainId(), tid, { memberUids: { $in: uids } }).toArray() : [];
        const assignedUids = new Set(assigned.flatMap((team) => team.memberUids));
        const result: PublicTeamUser[] = [];
        for (const candidate of candidates) {
            if (assignedUids.has(candidate._id)) continue;
            try {
                await contestTeam.assertContestTeamEligibility(this.domainId(), this.tdoc, candidate._id);
            } catch (error) {
                if (eligibilityRejection(error)) continue;
                throw error;
            }
            result.push({
                _id: candidate._id,
                uname: candidate.uname,
                displayName: candidate.displayName || candidate.uname,
            });
        }
        return result;
    }

    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    @param('search', Types.String, true)
    @param('teamSearch', Types.String, true)
    async get(_domainId: string, tid: ObjectId, page = 1, search = '', teamSearch = '') {
        if (this.request.json && search) {
            this.response.body = { users: await this.searchEligibleUsers(tid, search) };
            return;
        }
        if (teamSearch && !this.canManage) throw new PermissionError(PERM.PERM_EDIT_CONTEST);

        const ownTeam = await contestTeam.getTeamByMember(this.domainId(), tid, this.user._id);
        const pendingInvites = ownTeam ? [] : await contestTeam.getPendingInvitesForUser(this.domainId(), tid, this.user._id).toArray();
        const inviteTeams = await Promise.all(pendingInvites.map((invite) => contestTeam.getTeam(this.domainId(), tid, invite.teamId)));
        const invitationViews = pendingInvites.map((invite, index) => {
            const team = inviteTeams[index];
            return {
                inviteId: invite.inviteId,
                teamId: invite.teamId,
                teamName: team?.name || '已失效队伍',
                inviterUid: invite.inviterUid,
                teamRevision: invite.teamRevision,
                currentRevision: team?.revision ?? null,
                memberUids: team?.memberUids || [],
                captainUid: team?.captainUid ?? null,
                createdAt: invite.createdAt,
                canAccept:
                    !!team &&
                    team.managementMode === 'self' &&
                    team.revision === invite.teamRevision &&
                    team.memberUids.length < 3 &&
                    new Date() < this.tdoc.beginAt,
            };
        });

        let teams: contestTeam.ContestTeamDoc[] = [];
        let teamPageCount = 1;
        let teamCount = 0;
        if (this.canManage) {
            const teamQuery = teamSearch ? { nameKey: { $regex: teamNameSearch(teamSearch) } } : {};
            [teams, teamPageCount, teamCount] = await this.paginate(contestTeam.getMultiTeam(this.domainId(), tid, teamQuery), page, 20);
        }

        const allUids = new Set<number>();
        if (ownTeam) ownTeam.memberUids.forEach((uid) => allUids.add(uid));
        for (const invitation of invitationViews) {
            allUids.add(invitation.inviterUid);
            invitation.memberUids.forEach((uid) => allUids.add(uid));
        }
        for (const team of teams) team.memberUids.forEach((uid) => allUids.add(uid));
        const rawUsers = allUids.size ? await user.getListForRender(this.domainId(), [...allUids], false) : {};
        const users = Object.fromEntries(
            [...allUids].map((uid) => [
                String(uid),
                {
                    _id: uid,
                    uname: rawUsers[uid]?.uname || `UID ${uid}`,
                    displayName: rawUsers[uid]?.displayName || rawUsers[uid]?.uname || `UID ${uid}`,
                } satisfies PublicTeamUser,
            ]),
        );
        const started = new Date() >= this.tdoc.beginAt;
        this.response.template = 'contest_teams.html';
        this.response.body = {
            tdoc: publicContest(this.tdoc),
            ownTeam: ownTeam ? publicTeam(ownTeam, this.canManage) : null,
            pendingInvites: invitationViews,
            users,
            capabilities: {
                canManage: this.canManage,
                canCreate: !started && !ownTeam,
                canInvite: !started && ownTeam?.managementMode === 'self' && ownTeam.captainUid === this.user._id && ownTeam.memberUids.length < 3,
                canEditOwn: !started && !!ownTeam && (this.canManage || ownTeam.captainUid === this.user._id),
                canLeave: !started && !!ownTeam && ownTeam.managementMode === 'self',
                started,
            },
            teams: teams.map((team) => publicTeam(team, true)),
            teamPage: page,
            teamPageCount,
            teamCount,
            teamSearch: teamSearch.trim(),
        };
    }

    @param('tid', Types.ObjectId)
    @param('name', Types.String)
    @param('description', Types.Content, true)
    async postCreateSelf(_domainId: string, tid: ObjectId, name: string, description = '') {
        await contestTeam.createTeam(this.domainId(), tid, this.actor(), {
            name,
            description,
            captainUid: this.user._id,
            memberUids: [this.user._id],
            managementMode: 'self',
        });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    async postCreateSolo(_domainId: string, tid: ObjectId) {
        await contestTeam.createTeam(this.domainId(), tid, this.actor(), {
            name: `${this.user.uname} · 单人队`,
            description: '',
            captainUid: this.user._id,
            memberUids: [this.user._id],
            managementMode: 'self',
        });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('inviteeUid', Types.UnsignedInt)
    async postInvite(_domainId: string, tid: ObjectId, inviteeUid: number) {
        const invite = await contestTeam.createInvite(this.domainId(), tid, this.actor(), inviteeUid);
        const ownTeam = await contestTeam.getTeam(this.domainId(), tid, invite.teamId);
        try {
            await message.send(
                1,
                inviteeUid,
                JSON.stringify({
                    message: 'You were invited to join team {0} for contest {1}.',
                    params: [ownTeam?.name || 'Team', this.tdoc.title],
                    url: this.url('contest_teams', { tid }),
                }),
                message.FLAG_I18N | message.FLAG_UNREAD,
            );
        } catch (error) {
            console.error(
                '[contest-team] invitation persisted but notification failed',
                { domainId: this.domainId(), contestId: tid, teamId: invite.teamId, inviteId: invite.inviteId, inviteeUid },
                error,
            );
            throw error;
        }
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('inviteId', Types.ObjectId)
    async postAcceptInvite(_domainId: string, tid: ObjectId, inviteId: ObjectId) {
        await contestTeam.acceptInvite(this.domainId(), tid, inviteId, this.actor());
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('inviteId', Types.ObjectId)
    async postDeclineInvite(_domainId: string, tid: ObjectId, inviteId: ObjectId) {
        await contestTeam.declineInvite(this.domainId(), tid, inviteId, this.actor());
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('name', Types.String)
    @param('description', Types.Content, true)
    async postUpdateInfo(_domainId: string, tid: ObjectId, teamId: ObjectId, expectedRevision: number, name: string, description = '') {
        await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(), { expectedRevision, name, description });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('captainUid', Types.UnsignedInt)
    async postTransferCaptain(_domainId: string, tid: ObjectId, teamId: ObjectId, expectedRevision: number, captainUid: number) {
        await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(), { expectedRevision, captainUid });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('memberUid', Types.UnsignedInt)
    async postRemoveMember(_domainId: string, tid: ObjectId, teamId: ObjectId, expectedRevision: number, memberUid: number) {
        const team = await contestTeam.getTeam(this.domainId(), tid, teamId);
        if (!team) throw new ValidationError('teamId');
        await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(), {
            expectedRevision,
            memberUids: team.memberUids.filter((uid) => uid !== memberUid),
            captainUid: team.captainUid,
        });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    async postLeave(_domainId: string, tid: ObjectId, teamId: ObjectId, expectedRevision: number) {
        const team = await contestTeam.getTeam(this.domainId(), tid, teamId);
        if (!team || !team.memberUids.includes(this.user._id)) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
        if (team.memberUids.length === 1) {
            await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(), { expectedRevision, active: false });
        } else {
            await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(), {
                expectedRevision,
                memberUids: team.memberUids.filter((uid) => uid !== this.user._id),
                captainUid: team.captainUid,
            });
        }
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('name', Types.String)
    @param('description', Types.Content, true)
    @param('memberUids', Types.String)
    @param('captainUid', Types.UnsignedInt)
    async postCreateAdmin(_domainId: string, tid: ObjectId, name: string, description: string, memberUids: string, captainUid: number) {
        this.requireManager();
        await contestTeam.createTeam(this.domainId(), tid, this.actor(), {
            name,
            description,
            captainUid,
            memberUids: parseMemberUids(memberUids),
            managementMode: 'admin',
        });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('memberUids', Types.String)
    @param('captainUid', Types.UnsignedInt)
    @param('name', Types.String, true)
    @param('description', Types.Content, true)
    @param('managementMode', Types.Range(['self', 'admin']), true)
    @param('emergencyConfirmation', Types.String, true)
    async postUpdateAdmin(
        _domainId: string,
        tid: ObjectId,
        teamId: ObjectId,
        expectedRevision: number,
        memberUids: string,
        captainUid: number,
        name: string = null,
        description: string = null,
        managementMode: contestTeam.ContestTeamManagementMode = null,
        emergencyConfirmation = '',
    ) {
        this.requireManager();
        const started = new Date() >= this.tdoc.beginAt;
        if (started && (name !== null || description !== null || managementMode !== null)) {
            throw new ValidationError('contestStartedImmutableFields');
        }
        await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(emergencyConfirmation), {
            expectedRevision,
            memberUids: parseMemberUids(memberUids),
            captainUid,
            ...(started ? {} : { name, description, managementMode }),
        });
        this.redirectToTeams(tid);
    }

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    async postDeactivate(_domainId: string, tid: ObjectId, teamId: ObjectId, expectedRevision: number) {
        this.requireManager();
        await contestTeam.updateTeam(this.domainId(), tid, teamId, this.actor(), { expectedRevision, active: false });
        this.redirectToTeams(tid);
    }
}

export async function apply(ctx: Context) {
    ctx.Route('contest_teams', '/contest/:tid/teams', ContestTeamsHandler, PERM.PERM_VIEW_CONTEST);
}
