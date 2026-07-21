import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { PermissionError, UserNotFoundError, ValidationError } from '../error';
import { PERM } from '../model/builtin';
import * as teamBatch from '../model/contest-team-batch';
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
    if (memberUids.some((uid) => !Number.isSafeInteger(uid) || uid <= 1)) throw new ValidationError('memberUids');
    return global.Hydro.model.contestTeam.normalizeMemberUids(memberUids);
}

function teamNameSearch(value: string): RegExp {
    const query = value.trim();
    if (!query || query.length > 64) throw new ValidationError('teamSearch');
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function publicBatch(batch: teamBatch.TeamBatchDoc) {
    return {
        batchId: batch.batchId,
        name: batch.name,
        description: batch.description,
        status: batch.status,
        revision: batch.revision,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        closedAt: batch.closedAt,
    };
}

function publicTeam(team: teamBatch.TeamBatchTeamDoc) {
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
    };
}

export class TeamBatchListHandler extends Handler {
    private domainId(): string {
        return String(this.domain?._id);
    }

    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, page = 1) {
        const [batches, pageCount, total] = await this.paginate(teamBatch.getMultiBatch(this.domainId()), page, 20);
        const summaries = await Promise.all(
            batches.map(async (batch) => {
                const [teamCount, memberCount, ownTeam, pendingInvites] = await Promise.all([
                    teamBatch.countBatchTeams(this.domainId(), batch.batchId),
                    teamBatch.countBatchMembers(this.domainId(), batch.batchId),
                    teamBatch.getTeamByMember(this.domainId(), batch.batchId, this.user._id),
                    batch.status === 'open'
                        ? teamBatch.inviteColl.countDocuments({
                              domainId: this.domainId(),
                              batchId: batch.batchId,
                              inviteeUid: this.user._id,
                              status: 'pending',
                          })
                        : Promise.resolve(0),
                ]);
                return {
                    ...publicBatch(batch),
                    teamCount,
                    memberCount,
                    ownTeam: ownTeam ? { teamId: ownTeam.teamId, name: ownTeam.name, captainUid: ownTeam.captainUid } : null,
                    pendingInviteCount: pendingInvites,
                };
            }),
        );
        this.response.template = 'team_batches.html';
        this.response.body = {
            batches: summaries,
            page,
            pageCount,
            total,
            capabilities: { canManage: teamBatch.canManageTeamBatches(this.user) },
        };
    }

    @param('name', Types.String)
    @param('description', Types.Content, true)
    async postCreate(_domainId: string, name: string, description = '') {
        const batch = await teamBatch.createBatch(this.domainId(), { user: this.user }, { name, description });
        this.response.redirect = this.url('team_batch_detail', { batchId: batch.batchId });
    }
}

export class TeamBatchDetailHandler extends Handler {
    batch: teamBatch.TeamBatchDoc;
    canManage = false;

    private domainId(): string {
        return String(this.domain?._id);
    }

    private actor(): teamBatch.TeamBatchActor {
        return { user: this.user };
    }

    private redirect(batchId: ObjectId) {
        this.response.redirect = this.url('team_batch_detail', { batchId });
    }

    private requireManager() {
        if (!this.canManage) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
    }

    @param('batchId', Types.ObjectId)
    async prepare(_domainId: string, batchId: ObjectId) {
        const batch = await teamBatch.getBatch(this.domainId(), batchId);
        if (!batch) throw new ValidationError('batchId');
        this.batch = batch;
        this.canManage = teamBatch.canManageTeamBatches(this.user);
    }

    private async searchEligibleUsers(batchId: ObjectId, query: string): Promise<PublicTeamUser[]> {
        const q = query.trim();
        if (!q) return [];
        if (q.length > 64) throw new ValidationError('search');
        const ownTeam = await teamBatch.getTeamByMember(this.domainId(), batchId, this.user._id);
        const canInvite =
            this.batch.status === 'open' &&
            ownTeam?.managementMode === 'self' &&
            ownTeam.captainUid === this.user._id &&
            ownTeam.memberUids.length < 3;
        if (!this.canManage && !canInvite) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);

        const candidates = (await user.getPrefixList(this.domainId(), q, 20)).filter((candidate) => candidate?._id > 1);
        const uids = Array.from(new Set(candidates.map((candidate) => candidate._id)));
        const assigned = uids.length ? await teamBatch.getMultiTeam(this.domainId(), batchId, { memberUids: { $in: uids } }).toArray() : [];
        const assignedUids = new Set(assigned.flatMap((team) => team.memberUids));
        const result: PublicTeamUser[] = [];
        for (const candidate of candidates) {
            if (assignedUids.has(candidate._id)) continue;
            try {
                await teamBatch.assertTeamBatchMemberEligibility(this.domainId(), candidate._id);
            } catch (error) {
                if (error instanceof PermissionError || error instanceof UserNotFoundError) continue;
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

    @param('batchId', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    @param('search', Types.String, true)
    @param('teamSearch', Types.String, true)
    async get(_domainId: string, batchId: ObjectId, page = 1, search = '', teamSearch = '') {
        if (this.request.json && search) {
            this.response.body = { users: await this.searchEligibleUsers(batchId, search) };
            return;
        }
        if (teamSearch && !this.canManage) throw new PermissionError(PERM.PERM_EDIT_CONTEST);

        const ownTeam = await teamBatch.getTeamByMember(this.domainId(), batchId, this.user._id);
        const pendingInvites =
            ownTeam || this.batch.status === 'closed'
                ? []
                : await teamBatch.getPendingInvitesForUser(this.domainId(), batchId, this.user._id).toArray();
        const inviteTeams = await Promise.all(pendingInvites.map((invite) => teamBatch.getTeam(this.domainId(), batchId, invite.teamId)));
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
                    this.batch.status === 'open' &&
                    !!team &&
                    team.managementMode === 'self' &&
                    team.revision === invite.teamRevision &&
                    team.memberUids.length < 3,
            };
        });

        let teams: teamBatch.TeamBatchTeamDoc[] = [];
        let teamPageCount = 1;
        let teamCount = 0;
        if (this.canManage) {
            const query = teamSearch ? { nameKey: { $regex: teamNameSearch(teamSearch) } } : {};
            [teams, teamPageCount, teamCount] = await this.paginate(teamBatch.getMultiTeam(this.domainId(), batchId, query), page, 20);
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
        let eligible = false;
        try {
            await teamBatch.assertTeamBatchMemberEligibility(this.domainId(), this.user._id);
            eligible = true;
        } catch (error) {
            if (!(error instanceof PermissionError) && !(error instanceof UserNotFoundError)) throw error;
        }
        const closed = this.batch.status === 'closed';
        this.response.template = 'team_batch_detail.html';
        this.response.body = {
            workspaceKind: 'batch',
            workspaceUrl: this.url('team_batch_detail', { batchId }),
            batch: publicBatch(this.batch),
            ownTeam: ownTeam ? publicTeam(ownTeam) : null,
            pendingInvites: invitationViews,
            users,
            capabilities: {
                canManage: this.canManage,
                canCreate: eligible && !closed && !ownTeam,
                canInvite: !closed && ownTeam?.managementMode === 'self' && ownTeam.captainUid === this.user._id && ownTeam.memberUids.length < 3,
                canEditOwn: !closed && !!ownTeam && (this.canManage || ownTeam.captainUid === this.user._id),
                canLeave: !closed && !!ownTeam && ownTeam.managementMode === 'self',
                canClose: this.canManage && !closed,
                canEmergencyEdit: false,
                started: closed,
            },
            teams: teams.map(publicTeam),
            teamPage: page,
            teamPageCount,
            teamCount,
            teamSearch: teamSearch.trim(),
        };
    }

    @param('batchId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    async postClose(_domainId: string, batchId: ObjectId, expectedRevision: number) {
        this.requireManager();
        await teamBatch.closeBatch(this.domainId(), batchId, expectedRevision, this.actor());
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('name', Types.String)
    @param('description', Types.Content, true)
    async postCreateSelf(_domainId: string, batchId: ObjectId, name: string, description = '') {
        await teamBatch.createTeam(this.domainId(), batchId, this.actor(), {
            name,
            description,
            captainUid: this.user._id,
            memberUids: [this.user._id],
            managementMode: 'self',
        });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    async postCreateSolo(_domainId: string, batchId: ObjectId) {
        await teamBatch.createTeam(this.domainId(), batchId, this.actor(), {
            name: `${this.user.uname} · 单人队`,
            description: '',
            captainUid: this.user._id,
            memberUids: [this.user._id],
            managementMode: 'self',
        });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('inviteeUid', Types.UnsignedInt)
    async postInvite(_domainId: string, batchId: ObjectId, inviteeUid: number) {
        const invite = await teamBatch.createInvite(this.domainId(), batchId, this.actor(), inviteeUid);
        const ownTeam = await teamBatch.getTeam(this.domainId(), batchId, invite.teamId);
        try {
            await message.send(
                1,
                inviteeUid,
                JSON.stringify({
                    message: 'You were invited to join team {0} in team batch {1}.',
                    params: [ownTeam?.name || 'Team', this.batch.name],
                    url: this.url('team_batch_detail', { batchId }),
                }),
                message.FLAG_I18N | message.FLAG_UNREAD,
            );
        } catch (error) {
            console.error(
                '[contest-team-batch] invitation persisted but notification failed',
                { domainId: this.domainId(), batchId, teamId: invite.teamId, inviteId: invite.inviteId, inviteeUid },
                error,
            );
            throw error;
        }
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('inviteId', Types.ObjectId)
    async postAcceptInvite(_domainId: string, batchId: ObjectId, inviteId: ObjectId) {
        await teamBatch.acceptInvite(this.domainId(), batchId, inviteId, this.actor());
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('inviteId', Types.ObjectId)
    async postDeclineInvite(_domainId: string, batchId: ObjectId, inviteId: ObjectId) {
        await teamBatch.declineInvite(this.domainId(), batchId, inviteId, this.actor());
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('name', Types.String)
    @param('description', Types.Content, true)
    async postUpdateInfo(_domainId: string, batchId: ObjectId, teamId: ObjectId, expectedRevision: number, name: string, description = '') {
        await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), { expectedRevision, name, description });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('captainUid', Types.UnsignedInt)
    async postTransferCaptain(_domainId: string, batchId: ObjectId, teamId: ObjectId, expectedRevision: number, captainUid: number) {
        await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), { expectedRevision, captainUid });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('memberUid', Types.UnsignedInt)
    async postRemoveMember(_domainId: string, batchId: ObjectId, teamId: ObjectId, expectedRevision: number, memberUid: number) {
        const team = await teamBatch.getTeam(this.domainId(), batchId, teamId);
        if (!team) throw new ValidationError('teamId');
        await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), {
            expectedRevision,
            memberUids: team.memberUids.filter((uid) => uid !== memberUid),
            captainUid: team.captainUid,
        });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    async postLeave(_domainId: string, batchId: ObjectId, teamId: ObjectId, expectedRevision: number) {
        const team = await teamBatch.getTeam(this.domainId(), batchId, teamId);
        if (!team || !team.memberUids.includes(this.user._id)) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
        if (team.memberUids.length === 1) {
            await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), { expectedRevision, active: false });
        } else {
            await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), {
                expectedRevision,
                memberUids: team.memberUids.filter((uid) => uid !== this.user._id),
                captainUid: team.captainUid,
            });
        }
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('name', Types.String)
    @param('description', Types.Content, true)
    @param('memberUids', Types.String)
    @param('captainUid', Types.UnsignedInt)
    async postCreateAdmin(_domainId: string, batchId: ObjectId, name: string, description: string, memberUids: string, captainUid: number) {
        this.requireManager();
        await teamBatch.createTeam(this.domainId(), batchId, this.actor(), {
            name,
            description,
            captainUid,
            memberUids: parseMemberUids(memberUids),
            managementMode: 'admin',
        });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('memberUids', Types.String)
    @param('captainUid', Types.UnsignedInt)
    @param('name', Types.String, true)
    @param('description', Types.Content, true)
    @param('managementMode', Types.Range(['self', 'admin']), true)
    async postUpdateAdmin(
        _domainId: string,
        batchId: ObjectId,
        teamId: ObjectId,
        expectedRevision: number,
        memberUids: string,
        captainUid: number,
        name: string = null,
        description: string = null,
        managementMode: teamBatch.TeamBatchManagementMode = null,
    ) {
        this.requireManager();
        await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), {
            expectedRevision,
            memberUids: parseMemberUids(memberUids),
            captainUid,
            name,
            description,
            managementMode,
        });
        this.redirect(batchId);
    }

    @param('batchId', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    async postDeactivate(_domainId: string, batchId: ObjectId, teamId: ObjectId, expectedRevision: number) {
        this.requireManager();
        await teamBatch.updateTeam(this.domainId(), batchId, teamId, this.actor(), { expectedRevision, active: false });
        this.redirect(batchId);
    }
}

export async function apply(ctx: Context) {
    ctx.Route('team_batches', '/teams', TeamBatchListHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('team_batch_detail', '/teams/:batchId', TeamBatchDetailHandler, PERM.PERM_VIEW_CONTEST);
}
