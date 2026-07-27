import { ObjectId, type Filter } from 'mongodb';
import type { Context } from '../context';
import { ContestTeamConflictError, NotAssignedError, PermissionError, UserNotFoundError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import bus from '../service/bus';
import db from '../service/db';
import { notifyTeamRoleChangeOnVigil } from '../service/vigil-bridge';
import { PERM, PRIV } from './builtin';
import * as contest from './contest';
import { withContestTeamBoundary } from './contest-team-gate';
import * as oplog from './oplog';
import UserModel, { type User } from './user';

export type ContestTeamManagementMode = 'self' | 'admin';
export type ContestTeamInviteStatus = 'pending' | 'accepting' | 'accepted' | 'declined' | 'cancelled' | 'superseded';

export interface ContestTeamDoc {
    _id: ObjectId;
    domainId: string;
    contestId: ObjectId;
    teamId: ObjectId;
    name: string;
    nameKey: string;
    description: string;
    captainUid: number;
    memberUids: number[];
    managementMode: ContestTeamManagementMode;
    revision: number;
    active: boolean;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
    deactivatedAt?: Date;
    deactivatedBy?: number;
    deactivationReason?: 'participation_mode_changed' | 'team_closed';
    /** Optional provenance for a P1.17 pre-contest batch snapshot. */
    sourceBatchId?: ObjectId;
    sourceBatchTeamId?: ObjectId;
    snapshotId?: ObjectId;
    snapshotState?: 'preparing' | 'active';
    /** Request-local warning; never persisted. */
    vigilRoleSyncWarning?: string;
}

export interface ContestTeamActor {
    user: User;
    now?: Date;
    emergencyConfirmation?: string;
}

export interface ContestTeamInviteDoc {
    _id: ObjectId;
    inviteId: ObjectId;
    domainId: string;
    contestId: ObjectId;
    teamId: ObjectId;
    inviterUid: number;
    inviteeUid: number;
    teamRevision: number;
    status: ContestTeamInviteStatus;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    resolvedBy?: number;
}

export interface ContestTeamCreateInput {
    name: string;
    description?: string;
    captainUid: number;
    memberUids: number[];
    managementMode: ContestTeamManagementMode;
}

export interface ContestTeamUpdateInput {
    expectedRevision: number;
    name?: string;
    description?: string;
    captainUid?: number;
    memberUids?: number[];
    managementMode?: ContestTeamManagementMode;
    active?: boolean;
}

export type ContestTeamExamModeRole = 'captain' | 'member' | 'admin_preview';

export interface ContestTeamExamModeContext {
    teamId: string | null;
    teamRole: ContestTeamExamModeRole;
    teamInfo: {
        teamId: string;
        name: string;
        captainUid: number;
        memberUids: number[];
        revision: number;
    } | null;
    canBrowseProblems: boolean;
    canViewTeamRecords: boolean;
    canEditCode: boolean;
    canRun: boolean;
    canSubmit: boolean;
    canUseVirtualPrint: boolean;
}

export const coll = db.collection<ContestTeamDoc>('contest.teams');
export const inviteColl = db.collection<ContestTeamInviteDoc>('contest.teamInvites');

function teamConflict(reason: string): never {
    throw new ContestTeamConflictError(reason);
}

function normalizeText(value: unknown): string {
    const normalized = String(value ?? '').normalize('NFKC');
    if (/\p{Cc}/u.test(normalized)) throw new ValidationError('teamText', null, 'Control characters are not allowed.');
    return normalized.replace(/\s+/g, ' ').trim();
}

type VigilLockoutCacheInvalidator = (domainId?: string, uid?: number) => void;

export function requireVigilLockoutCacheInvalidator(): VigilLockoutCacheInvalidator {
    const invalidateLockoutCache = (global as any).Hydro?.model?.vigilguard?.invalidateLockoutCache;
    if (typeof invalidateLockoutCache !== 'function') {
        throw new TypeError('Vigil lockout cache invalidation service is unavailable.');
    }
    return invalidateLockoutCache;
}

export function normalizeTeamName(value: unknown): { name: string; nameKey: string } {
    const name = normalizeText(value);
    if (!name || name.length > 64) throw new ValidationError('name', null, 'Team name must contain 1-64 characters.');
    return { name, nameKey: name.toLocaleLowerCase('en-US') };
}

export function normalizeTeamDescription(value: unknown): string {
    const description = normalizeText(value);
    if (description.length > 500) throw new ValidationError('description', null, 'Team description must not exceed 500 characters.');
    return description;
}

export function normalizeMemberUids(value: number[]): number[] {
    const memberUids = Array.from(new Set((value || []).map(Number)));
    if (memberUids.some((uid) => !Number.isSafeInteger(uid) || uid <= 0)) throw new ValidationError('memberUids');
    if (memberUids.length < 1 || memberUids.length > 3) throw new ValidationError('memberUids', null, 'A team must have 1-3 members.');
    return memberUids.sort((a, b) => a - b);
}

export function validateTeamShape(memberUids: number[], captainUid: number): number[] {
    const normalized = normalizeMemberUids(memberUids);
    if (!Number.isSafeInteger(captainUid) || !normalized.includes(captainUid)) {
        throw new ValidationError('captainUid', null, 'The captain must be exactly one current team member.');
    }
    return normalized;
}

export function emergencyTeamConfirmation(teamId: ObjectId, revision: number): string {
    return `TEAM-EMERGENCY:${teamId.toHexString()}:${revision}`;
}

export function canManageContestTeams(actor: User, tdoc: Tdoc): boolean {
    return actor.own(tdoc, PERM.PERM_EDIT_CONTEST_SELF) || actor.hasPerm(PERM.PERM_EDIT_CONTEST) || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

/**
 * Build the team-only Exam Mode bootstrap from the current durable roster.
 * The handler decides whether the request is an administrator preview; this
 * helper deliberately derives every capability from that fact plus the
 * roster, never from request parameters or client state.
 */
export function buildExamModeTeamContext(team: ContestTeamDoc | null, uid: number, adminPreview = false): ContestTeamExamModeContext {
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new ValidationError('uid');
    if (!adminPreview && (!team || !team.active || !team.memberUids.includes(uid))) teamConflict('active_team_required');

    const role: ContestTeamExamModeRole = adminPreview ? 'admin_preview' : team?.captainUid === uid ? 'captain' : 'member';
    const captainCanWrite = role === 'captain';
    return {
        teamId: team?.teamId.toHexString() || null,
        teamRole: role,
        teamInfo: team
            ? {
                  teamId: team.teamId.toHexString(),
                  name: team.name,
                  captainUid: team.captainUid,
                  memberUids: [...team.memberUids],
                  revision: team.revision,
              }
            : null,
        canBrowseProblems: true,
        canViewTeamRecords: true,
        canEditCode: captainCanWrite,
        canRun: captainCanWrite,
        canSubmit: captainCanWrite,
        canUseVirtualPrint: captainCanWrite,
    };
}

function started(tdoc: Tdoc, now: Date): boolean {
    return now.getTime() >= tdoc.beginAt.getTime();
}

async function assertTeamContest(domainId: string, contestId: ObjectId): Promise<Tdoc> {
    const tdoc = await contest.get(domainId, contestId);
    if (contest.getParticipationMode(tdoc) !== 'team' || tdoc.rule !== 'acm') {
        throw new ValidationError('participationMode', null, 'Teams are only available for team-mode ACM contests.');
    }
    if (tdoc.plannedTeamBatchId && !tdoc.teamBatchId) teamConflict('team_batch_not_finalized');
    return tdoc;
}

async function assertContestTeamBaseEligibility(domainId: string, tdoc: Tdoc, uid: number): Promise<void> {
    const udoc = await UserModel.getById(domainId, uid);
    if (!udoc || !udoc._id) throw new UserNotFoundError(uid);
    if (!udoc.hasPerm(PERM.PERM_VIEW_CONTEST) || !udoc.hasPerm(PERM.PERM_ATTEND_CONTEST)) {
        throw new NotAssignedError('contest', tdoc.docId);
    }

    if (tdoc.assign?.length) {
        const groups = await UserModel.listGroup(domainId, uid);
        if (!tdoc.assign.some((name) => groups.some((group) => group.name === name))) throw new NotAssignedError('contest', tdoc.docId);
    }
    if (tdoc.participantScopeMode && !['none', 'schools', 'groups'].includes(tdoc.participantScopeMode)) {
        throw new ValidationError('participantScopeMode');
    }
    if (contest.hasParticipantScope(tdoc)) {
        const vigilguard = (global as any).Hydro?.model?.vigilguard;
        if (!vigilguard?.hitsParticipantScope) {
            throw new ValidationError('participantScopeMode', null, 'Participant scope service is unavailable.');
        }
        if (!(await vigilguard.hitsParticipantScope(domainId, tdoc, uid))) throw new NotAssignedError('contest', tdoc.docId);
    }
}

/**
 * Eligibility used while materializing a closed pre-contest roster. Invite
 * codes are entry credentials, not a population scope, and cannot have been
 * redeemed before a newly-created contest exists.
 */
export async function assertContestTeamRosterEligibility(domainId: string, tdoc: Tdoc, uid: number): Promise<void> {
    await assertContestTeamBaseEligibility(domainId, tdoc, uid);
}

export async function assertContestTeamEligibility(domainId: string, tdoc: Tdoc, uid: number): Promise<void> {
    await assertContestTeamBaseEligibility(domainId, tdoc, uid);
    if (tdoc._code) {
        const tsdoc = await contest.getStatus(domainId, tdoc.docId, uid);
        if (!tsdoc?.attend) throw new NotAssignedError('contest', tdoc.docId);
    }
}

async function assertMembersEligible(domainId: string, tdoc: Tdoc, memberUids: number[]): Promise<void> {
    for (const uid of memberUids) await assertContestTeamEligibility(domainId, tdoc, uid);
}

function duplicateConflict(error: any): never {
    if (error?.code !== 11000) throw error;
    const fields = Object.keys(error?.keyPattern || {});
    if (fields.includes('memberUids')) teamConflict('member_already_assigned');
    if (fields.includes('nameKey')) teamConflict('name_already_used');
    teamConflict('unique_constraint');
}

interface TeamAuditData {
    operation: string;
    domainId: string;
    contestId: ObjectId;
    teamId: ObjectId;
    actorUid: number;
    targetUids: number[];
    fromRevision: number;
    toRevision?: number;
    result?: 'success' | 'rejected';
    reason?: string;
}

async function audit(data: TeamAuditData & { toRevision: number; result: 'success' | 'rejected' }): Promise<void> {
    await oplog.add({
        type: `contest.team.${data.operation}`,
        operation: data.operation,
        domainId: data.domainId,
        operator: data.actorUid,
        contestId: data.contestId,
        teamId: data.teamId,
        targetUids: data.targetUids || [],
        fromRevision: data.fromRevision,
        toRevision: data.toRevision,
        result: data.result,
        reason: data.reason,
        time: new Date(),
    });
}

async function auditedMutation<T>(data: TeamAuditData, mutation: () => Promise<T>, revisionOf: (result: T) => number): Promise<T> {
    let result: T;
    try {
        result = await mutation();
    } catch (error: any) {
        try {
            await audit({
                ...data,
                toRevision: data.fromRevision,
                result: 'rejected',
                reason: String(error?.params?.[0] || error?.code || error?.name || 'Error'),
            });
        } catch (auditError) {
            console.error(
                '[contest-team] failed to audit rejected mutation',
                { domainId: data.domainId, contestId: data.contestId, teamId: data.teamId, actorUid: data.actorUid, operation: data.operation },
                auditError,
            );
        }
        throw error;
    }
    try {
        await audit({ ...data, toRevision: revisionOf(result), result: 'success' });
    } catch (auditError) {
        console.error(
            '[contest-team] mutation committed but success audit failed',
            { domainId: data.domainId, contestId: data.contestId, teamId: data.teamId, actorUid: data.actorUid, operation: data.operation },
            auditError,
        );
    }
    return result;
}

export async function createTeam(
    domainId: string,
    contestId: ObjectId,
    actor: ContestTeamActor,
    input: ContestTeamCreateInput,
): Promise<ContestTeamDoc> {
    const invalidateLockoutCache = requireVigilLockoutCacheInvalidator();
    const teamId = new ObjectId();
    const auditData: TeamAuditData = {
        operation: 'create',
        domainId,
        contestId,
        teamId,
        actorUid: actor.user._id,
        targetUids: Array.isArray(input?.memberUids) ? input.memberUids.filter((uid) => Number.isSafeInteger(uid)) : [],
        fromRevision: 0,
    };
    return await withContestTeamBoundary(domainId, contestId, async () => {
        const created = await auditedMutation(
            auditData,
            async () => {
                const now = actor.now || new Date();
                const tdoc = await assertTeamContest(domainId, contestId);
                const admin = canManageContestTeams(actor.user, tdoc);
                if (started(tdoc, now)) throw new ContestTeamConflictError('contest_started');
                if (!['self', 'admin'].includes(input.managementMode)) throw new ValidationError('managementMode');
                if (input.managementMode === 'admin' && !admin) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
                if (input.managementMode === 'self' && (input.captainUid !== actor.user._id || input.memberUids.length !== 1)) {
                    throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
                }
                const memberUids = validateTeamShape(input.memberUids, input.captainUid);
                auditData.targetUids = memberUids;
                await assertMembersEligible(domainId, tdoc, memberUids);
                const { name, nameKey } = normalizeTeamName(input.name);
                const description = normalizeTeamDescription(input.description);
                const doc: ContestTeamDoc = {
                    _id: teamId,
                    domainId,
                    contestId,
                    teamId,
                    name,
                    nameKey,
                    description,
                    captainUid: input.captainUid,
                    memberUids,
                    managementMode: input.managementMode,
                    revision: 1,
                    active: true,
                    createdBy: actor.user._id,
                    createdAt: now,
                    updatedAt: now,
                };
                try {
                    await coll.insertOne(doc);
                } catch (error) {
                    duplicateConflict(error);
                }
                try {
                    const currentContest = await contest.get(domainId, contestId);
                    const finalNow = actor.now || new Date();
                    if (
                        contest.getParticipationMode(currentContest) !== 'team' ||
                        currentContest.rule !== 'acm' ||
                        (currentContest.participationRevision ?? 0) !== (tdoc.participationRevision ?? 0)
                    ) {
                        teamConflict('participation_mode_changed');
                    }
                    if (started(currentContest, finalNow)) teamConflict('contest_started');
                    await assertMembersEligible(domainId, currentContest, memberUids);
                } catch (error) {
                    const deactivatedAt = actor.now || new Date();
                    await coll.updateOne(
                        { domainId, contestId, teamId, active: true },
                        {
                            $set: {
                                active: false,
                                updatedAt: deactivatedAt,
                                deactivatedAt,
                                deactivatedBy: actor.user._id,
                                deactivationReason: 'team_closed',
                            },
                            $inc: { revision: 1 },
                        },
                    );
                    throw error;
                }
                return doc;
            },
            (team) => team.revision,
        );
        invalidateLockoutCache(domainId);
        return created;
    });
}

async function loadActiveTeam(domainId: string, contestId: ObjectId, teamId: ObjectId): Promise<ContestTeamDoc> {
    const team = await coll.findOne({ domainId, contestId, teamId, active: true });
    if (!team) teamConflict('not_found_or_inactive');
    return team;
}

async function findActiveTeamByMember(domainId: string, contestId: ObjectId, uid: number): Promise<ContestTeamDoc | null> {
    return await coll.findOne({ domainId, contestId, memberUids: uid, active: true });
}

function authorizeMutation(
    tdoc: Tdoc,
    team: ContestTeamDoc,
    actor: ContestTeamActor,
    changesRoster: boolean,
): { admin: boolean; emergency: boolean } {
    const now = actor.now || new Date();
    const admin = canManageContestTeams(actor.user, tdoc);
    const emergency = started(tdoc, now);
    if (emergency) {
        if (!admin || actor.emergencyConfirmation !== emergencyTeamConfirmation(team.teamId, team.revision)) {
            throw new ContestTeamConflictError('emergency_confirmation_required');
        }
        return { admin, emergency: true };
    }
    if (team.managementMode === 'admin' && !admin && changesRoster) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
    if (!admin) {
        const isCaptain = team.captainUid === actor.user._id;
        const isSelfLeave = changesRoster && team.memberUids.includes(actor.user._id);
        if (!isCaptain && !isSelfLeave) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
    }
    return { admin, emergency: false };
}

export async function updateTeam(
    domainId: string,
    contestId: ObjectId,
    teamId: ObjectId,
    actor: ContestTeamActor,
    input: ContestTeamUpdateInput,
): Promise<ContestTeamDoc> {
    const invalidateLockoutCache = requireVigilLockoutCacheInvalidator();
    const auditData: TeamAuditData = {
        operation: 'update',
        domainId,
        contestId,
        teamId,
        actorUid: actor.user._id,
        targetUids: Array.isArray(input?.memberUids) ? input.memberUids.filter((uid) => Number.isSafeInteger(uid)) : [],
        fromRevision: Number.isSafeInteger(input?.expectedRevision) ? input.expectedRevision : 0,
    };
    const outcome = await withContestTeamBoundary(domainId, contestId, async () => {
        const committed = await auditedMutation(
            auditData,
            async () => {
                const tdoc = await assertTeamContest(domainId, contestId);
                const current = await loadActiveTeam(domainId, contestId, teamId);
                auditData.fromRevision = current.revision;
                auditData.targetUids = [...current.memberUids];
                if (current.revision !== input.expectedRevision) teamConflict('revision_mismatch');
                const changesRoster =
                    input.memberUids !== undefined || input.captainUid !== undefined || input.managementMode !== undefined || input.active === false;
                if (started(tdoc, actor.now || new Date())) auditData.operation = 'emergency-update';
                const { admin, emergency } = authorizeMutation(tdoc, current, actor, changesRoster);
                if (input.managementMode !== undefined && !['self', 'admin'].includes(input.managementMode)) {
                    throw new ValidationError('managementMode');
                }
                if (input.managementMode !== undefined && !admin) throw new PermissionError(PERM.PERM_EDIT_CONTEST);

                const memberUids =
                    input.memberUids === undefined ? current.memberUids : validateTeamShape(input.memberUids, input.captainUid ?? current.captainUid);
                const captainUid = input.captainUid ?? current.captainUid;
                validateTeamShape(memberUids, captainUid);
                auditData.targetUids = memberUids;
                const deactivating = input.active === false;
                if (changesRoster && !deactivating) await assertMembersEligible(domainId, tdoc, memberUids);

                if (!admin && changesRoster) {
                    if (input.active === false && current.managementMode === 'admin') throw new PermissionError(PERM.PERM_EDIT_CONTEST);
                    const actorLeaving = !memberUids.includes(actor.user._id);
                    if (actorLeaving && actor.user._id === current.captainUid && current.memberUids.length > 1) {
                        teamConflict('captain_must_transfer_before_leaving');
                    }
                    if (actor.user._id !== current.captainUid) {
                        const onlySelfRemoved =
                            current.memberUids.length === memberUids.length + 1 &&
                            !memberUids.includes(actor.user._id) &&
                            current.memberUids.every((uid) => uid === actor.user._id || memberUids.includes(uid));
                        if (!onlySelfRemoved) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
                    } else if (memberUids.some((uid) => !current.memberUids.includes(uid))) {
                        teamConflict('new_member_requires_invitation');
                    }
                }

                const patch: Partial<ContestTeamDoc> = {
                    memberUids,
                    captainUid,
                    updatedAt: actor.now || new Date(),
                };
                if (input.name !== undefined) Object.assign(patch, normalizeTeamName(input.name));
                if (input.description !== undefined) patch.description = normalizeTeamDescription(input.description);
                if (input.managementMode !== undefined) patch.managementMode = input.managementMode;
                if (input.active !== undefined) patch.active = input.active;
                if (
                    emergency &&
                    (input.name !== undefined || input.description !== undefined || input.managementMode !== undefined || input.active !== undefined)
                ) {
                    teamConflict('contest_started');
                }
                if (patch.active === false && current.managementMode === 'admin' && !admin) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
                if (patch.active === false && emergency && !admin) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
                const roleChanged =
                    current.captainUid !== captainUid ||
                    current.memberUids.join(',') !== memberUids.join(',') ||
                    (input.active !== undefined && current.active !== input.active);
                const before = { ...current, memberUids: [...current.memberUids] };

                const latestContest = await contest.get(domainId, contestId);
                const finalNow = actor.now || new Date();
                if (
                    contest.getParticipationMode(latestContest) !== 'team' ||
                    latestContest.rule !== 'acm' ||
                    (latestContest.participationRevision ?? 0) !== (tdoc.participationRevision ?? 0)
                ) {
                    teamConflict('participation_mode_changed');
                }
                if (started(latestContest, finalNow) && !emergency) teamConflict('contest_started');
                if (!deactivating) await assertMembersEligible(domainId, latestContest, memberUids);
                let updated: ContestTeamDoc;
                try {
                    updated = await coll.findOneAndUpdate(
                        { domainId, contestId, teamId, active: true, revision: current.revision },
                        { $set: patch, $inc: { revision: 1 } },
                        { returnDocument: 'after' },
                    );
                } catch (error) {
                    duplicateConflict(error);
                }
                if (!updated) teamConflict('revision_mismatch');
                return { updated, roleChanged, before, emergency };
            },
            (result) => result.updated.revision,
        );
        if (committed.roleChanged) invalidateLockoutCache(domainId);
        return committed;
    });
    await runPostCommitStep('sync-invitations', outcome.updated, actor.user._id, () =>
        syncPendingInvitesAfterTeamMutation(outcome.updated, actor.user._id, actor.now || new Date()),
    );
    if (outcome.roleChanged) {
        await refreshTeamRoleSessionsAfterCommit(outcome.before, outcome.updated, actor.user._id);
        await runPostCommitStep('publish-role-change', outcome.updated, actor.user._id, async () =>
            bus.broadcast('contest/team-role-change', {
                before: outcome.before,
                after: outcome.updated,
                actorUid: actor.user._id,
                emergency: outcome.emergency,
            }),
        );
    }
    return outcome.updated;
}

async function refreshTeamRoleSessionsAfterCommit(before: ContestTeamDoc, after: ContestTeamDoc, actorUid: number): Promise<void> {
    try {
        const refreshRoles = (global as any).Hydro?.model?.vigilguard?.refreshActiveTeamSessionRoles;
        if (typeof refreshRoles !== 'function') throw new Error('Vigil team-session role refresh service is unavailable.');
        const refreshed = await refreshRoles(before, after);
        if ((refreshed.updated || 0) + (refreshed.invalidated || 0) === 0) return;
        await notifyTeamRoleChangeOnVigil({
            domainId: after.domainId,
            contestId: after.contestId.toHexString(),
            teamId: after.teamId.toHexString(),
            teamRevision: after.revision,
            affectedUids: Array.from(new Set([...before.memberUids, ...after.memberUids])),
            actorUid,
        });
    } catch (error: any) {
        after.vigilRoleSyncWarning = error?.message || String(error);
        console.error(
            '[contest-team] roster committed but Vigil role refresh failed',
            {
                domainId: after.domainId,
                contestId: after.contestId,
                teamId: after.teamId,
                teamRevision: after.revision,
                actorUid,
            },
            error,
        );
    }
}

async function runPostCommitStep(operation: string, team: ContestTeamDoc, actorUid: number, step: () => Promise<unknown>): Promise<void> {
    try {
        await step();
    } catch (error) {
        console.error(
            '[contest-team] committed mutation post-commit step failed',
            {
                domainId: team.domainId,
                contestId: team.contestId,
                teamId: team.teamId,
                teamRevision: team.revision,
                actorUid,
                operation,
            },
            error,
        );
    }
}

async function syncPendingInvitesAfterTeamMutation(team: ContestTeamDoc, actorUid: number, now: Date, excludeInviteId?: ObjectId): Promise<void> {
    const filter = {
        domainId: team.domainId,
        contestId: team.contestId,
        teamId: team.teamId,
        status: { $in: ['pending', 'accepting'] as ContestTeamInviteStatus[] },
        ...(excludeInviteId ? { inviteId: { $ne: excludeInviteId } } : {}),
    };
    if (!team.active || team.managementMode !== 'self' || team.memberUids.length >= 3) {
        await inviteColl.updateMany(filter, {
            $set: { status: 'cancelled', resolvedAt: now, resolvedBy: actorUid, updatedAt: now },
        });
        return;
    }
    await inviteColl.updateMany(filter, { $set: { teamRevision: team.revision, updatedAt: now } });
}

interface InviteAuditData {
    operation: 'invite-create' | 'invite-accept' | 'invite-decline';
    domainId: string;
    contestId: ObjectId;
    inviteId: ObjectId;
    actorUid: number;
    targetUids: number[];
    fromRevision: number;
    teamId?: ObjectId;
}

async function auditInvite(data: InviteAuditData & { toRevision: number; result: 'success' | 'rejected'; reason?: string }): Promise<void> {
    await oplog.add({
        type: `contest.team.${data.operation}`,
        operation: data.operation,
        domainId: data.domainId,
        operator: data.actorUid,
        contestId: data.contestId,
        teamId: data.teamId,
        inviteId: data.inviteId,
        targetUids: data.targetUids,
        fromRevision: data.fromRevision,
        toRevision: data.toRevision,
        result: data.result,
        reason: data.reason,
        time: new Date(),
    });
}

async function auditedInviteMutation<T>(data: InviteAuditData, mutation: () => Promise<T>, revisionOf: (result: T) => number): Promise<T> {
    let result: T;
    try {
        result = await mutation();
    } catch (error: any) {
        try {
            await auditInvite({
                ...data,
                toRevision: data.fromRevision,
                result: 'rejected',
                reason: String(error?.params?.[0] || error?.code || error?.name || 'Error'),
            });
        } catch (auditError) {
            console.error(
                '[contest-team] failed to audit rejected invitation mutation',
                {
                    domainId: data.domainId,
                    contestId: data.contestId,
                    teamId: data.teamId,
                    inviteId: data.inviteId,
                    actorUid: data.actorUid,
                    operation: data.operation,
                },
                auditError,
            );
        }
        throw error;
    }
    try {
        await auditInvite({ ...data, toRevision: revisionOf(result), result: 'success' });
    } catch (auditError) {
        console.error(
            '[contest-team] invitation mutation committed but success audit failed',
            {
                domainId: data.domainId,
                contestId: data.contestId,
                teamId: data.teamId,
                inviteId: data.inviteId,
                actorUid: data.actorUid,
                operation: data.operation,
            },
            auditError,
        );
    }
    return result;
}

function assertInviteWindow(tdoc: Tdoc, now: Date): void {
    if (started(tdoc, now)) teamConflict('contest_started');
}

async function loadPendingInvite(domainId: string, contestId: ObjectId, inviteId: ObjectId): Promise<ContestTeamInviteDoc> {
    const invite = await inviteColl.findOne({ domainId, contestId, inviteId, status: 'pending' });
    if (!invite) teamConflict('invite_not_found_or_resolved');
    return invite;
}

export async function createInvite(
    domainId: string,
    contestId: ObjectId,
    actor: ContestTeamActor,
    inviteeUid: number,
): Promise<ContestTeamInviteDoc> {
    const inviteId = new ObjectId();
    const auditData: InviteAuditData = {
        operation: 'invite-create',
        domainId,
        contestId,
        inviteId,
        actorUid: actor.user._id,
        targetUids: [inviteeUid],
        fromRevision: 0,
    };
    return await withContestTeamBoundary(domainId, contestId, async () =>
        auditedInviteMutation(
            auditData,
            async () => {
                if (!Number.isSafeInteger(inviteeUid) || inviteeUid <= 0) throw new ValidationError('inviteeUid');
                const now = actor.now || new Date();
                const tdoc = await assertTeamContest(domainId, contestId);
                assertInviteWindow(tdoc, now);
                const team = await findActiveTeamByMember(domainId, contestId, actor.user._id);
                if (!team) teamConflict('team_required');
                auditData.teamId = team.teamId;
                auditData.fromRevision = team.revision;
                if (team.managementMode !== 'self' || team.captainUid !== actor.user._id) {
                    throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
                }
                if (team.memberUids.length >= 3) teamConflict('team_full');
                if (team.memberUids.includes(inviteeUid)) teamConflict('member_already_assigned');
                await assertContestTeamEligibility(domainId, tdoc, inviteeUid);
                if (await findActiveTeamByMember(domainId, contestId, inviteeUid)) teamConflict('member_already_assigned');

                const [latestContest, latestTeam] = await Promise.all([
                    contest.get(domainId, contestId),
                    loadActiveTeam(domainId, contestId, team.teamId),
                ]);
                const finalNow = actor.now || new Date();
                if (
                    contest.getParticipationMode(latestContest) !== 'team' ||
                    latestContest.rule !== 'acm' ||
                    (latestContest.participationRevision ?? 0) !== (tdoc.participationRevision ?? 0)
                ) {
                    teamConflict('participation_mode_changed');
                }
                assertInviteWindow(latestContest, finalNow);
                if (latestTeam.revision !== team.revision) teamConflict('revision_mismatch');
                if (latestTeam.memberUids.length >= 3) teamConflict('team_full');
                await assertContestTeamEligibility(domainId, latestContest, inviteeUid);
                if (await findActiveTeamByMember(domainId, contestId, inviteeUid)) teamConflict('member_already_assigned');

                const existing = await inviteColl.findOne({
                    domainId,
                    contestId,
                    teamId: team.teamId,
                    inviteeUid,
                    status: 'pending',
                });
                if (existing) {
                    auditData.inviteId = existing.inviteId;
                    const refreshed = await inviteColl.findOneAndUpdate(
                        { _id: existing._id, status: 'pending', teamRevision: existing.teamRevision },
                        {
                            $set: {
                                inviterUid: actor.user._id,
                                teamRevision: latestTeam.revision,
                                updatedAt: finalNow,
                            },
                        },
                        { returnDocument: 'after' },
                    );
                    if (!refreshed) teamConflict('invite_revision_mismatch');
                    return refreshed;
                }
                const doc: ContestTeamInviteDoc = {
                    _id: inviteId,
                    inviteId,
                    domainId,
                    contestId,
                    teamId: team.teamId,
                    inviterUid: actor.user._id,
                    inviteeUid,
                    teamRevision: latestTeam.revision,
                    status: 'pending',
                    createdAt: finalNow,
                    updatedAt: finalNow,
                };
                try {
                    await inviteColl.insertOne(doc);
                } catch (error: any) {
                    if (error?.code === 11000) teamConflict('invite_already_pending');
                    throw error;
                }
                return doc;
            },
            (invite) => invite.teamRevision,
        ),
    );
}

export async function declineInvite(
    domainId: string,
    contestId: ObjectId,
    inviteId: ObjectId,
    actor: ContestTeamActor,
): Promise<ContestTeamInviteDoc> {
    const auditData: InviteAuditData = {
        operation: 'invite-decline',
        domainId,
        contestId,
        inviteId,
        actorUid: actor.user._id,
        targetUids: [actor.user._id],
        fromRevision: 0,
    };
    return await withContestTeamBoundary(domainId, contestId, async () =>
        auditedInviteMutation(
            auditData,
            async () => {
                const now = actor.now || new Date();
                const tdoc = await assertTeamContest(domainId, contestId);
                assertInviteWindow(tdoc, now);
                const invite = await loadPendingInvite(domainId, contestId, inviteId);
                auditData.teamId = invite.teamId;
                auditData.fromRevision = invite.teamRevision;
                if (invite.inviteeUid !== actor.user._id) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
                const updated = await inviteColl.findOneAndUpdate(
                    { _id: invite._id, status: 'pending', inviteeUid: actor.user._id },
                    { $set: { status: 'declined', resolvedAt: now, resolvedBy: actor.user._id, updatedAt: now } },
                    { returnDocument: 'after' },
                );
                if (!updated) teamConflict('invite_not_found_or_resolved');
                return updated;
            },
            (invite) => invite.teamRevision,
        ),
    );
}

async function restoreInviteClaim(invite: ContestTeamInviteDoc, now: Date): Promise<void> {
    const currentTeam = await coll.findOne({
        domainId: invite.domainId,
        contestId: invite.contestId,
        teamId: invite.teamId,
        active: true,
    });
    const canRemainPending = !!currentTeam && currentTeam.managementMode === 'self' && currentTeam.memberUids.length < 3;
    const restored = await inviteColl.updateOne(
        { _id: invite._id, status: 'accepting', inviteeUid: invite.inviteeUid },
        canRemainPending
            ? {
                  $set: { status: 'pending', teamRevision: currentTeam.revision, updatedAt: now },
                  $unset: { resolvedAt: '', resolvedBy: '' },
              }
            : { $set: { status: 'cancelled', resolvedAt: now, updatedAt: now } },
    );
    if (restored.modifiedCount === 1) return;
    const resolved = await inviteColl.findOne({ _id: invite._id });
    if (!resolved || resolved.status === 'accepting') teamConflict('invite_claim_restore_failed');
}

export async function acceptInvite(domainId: string, contestId: ObjectId, inviteId: ObjectId, actor: ContestTeamActor): Promise<ContestTeamDoc> {
    const invalidateLockoutCache = requireVigilLockoutCacheInvalidator();
    const auditData: InviteAuditData = {
        operation: 'invite-accept',
        domainId,
        contestId,
        inviteId,
        actorUid: actor.user._id,
        targetUids: [actor.user._id],
        fromRevision: 0,
    };
    const outcome = await withContestTeamBoundary(domainId, contestId, async () => {
        const committed = await auditedInviteMutation(
            auditData,
            async () => {
                const now = actor.now || new Date();
                const tdoc = await assertTeamContest(domainId, contestId);
                assertInviteWindow(tdoc, now);
                const invite = await loadPendingInvite(domainId, contestId, inviteId);
                auditData.teamId = invite.teamId;
                auditData.fromRevision = invite.teamRevision;
                if (invite.inviteeUid !== actor.user._id) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
                if (await findActiveTeamByMember(domainId, contestId, actor.user._id)) teamConflict('member_already_assigned');
                const current = await loadActiveTeam(domainId, contestId, invite.teamId);
                if (current.managementMode !== 'self') teamConflict('invite_team_not_self_managed');
                if (current.revision !== invite.teamRevision) teamConflict('invite_revision_mismatch');
                if (current.memberUids.length >= 3) teamConflict('team_full');
                await assertContestTeamEligibility(domainId, tdoc, actor.user._id);

                const claimed = await inviteColl.findOneAndUpdate(
                    {
                        _id: invite._id,
                        status: 'pending',
                        inviteeUid: actor.user._id,
                        teamRevision: current.revision,
                    },
                    { $set: { status: 'accepting', updatedAt: now } },
                    { returnDocument: 'after' },
                );
                if (!claimed) teamConflict('invite_not_found_or_resolved');

                let teamUpdated = false;
                try {
                    const [latestContest, latestTeam] = await Promise.all([
                        contest.get(domainId, contestId),
                        loadActiveTeam(domainId, contestId, current.teamId),
                    ]);
                    const finalNow = actor.now || new Date();
                    if (
                        contest.getParticipationMode(latestContest) !== 'team' ||
                        latestContest.rule !== 'acm' ||
                        (latestContest.participationRevision ?? 0) !== (tdoc.participationRevision ?? 0)
                    ) {
                        teamConflict('participation_mode_changed');
                    }
                    assertInviteWindow(latestContest, finalNow);
                    if (latestTeam.revision !== current.revision) teamConflict('revision_mismatch');
                    if (latestTeam.memberUids.length >= 3) teamConflict('team_full');
                    if (await findActiveTeamByMember(domainId, contestId, actor.user._id)) teamConflict('member_already_assigned');
                    await assertContestTeamEligibility(domainId, latestContest, actor.user._id);
                    const memberUids = validateTeamShape([...latestTeam.memberUids, actor.user._id], latestTeam.captainUid);
                    let updated: ContestTeamDoc;
                    try {
                        updated = await coll.findOneAndUpdate(
                            { domainId, contestId, teamId: latestTeam.teamId, active: true, revision: latestTeam.revision },
                            { $set: { memberUids, updatedAt: finalNow }, $inc: { revision: 1 } },
                            { returnDocument: 'after' },
                        );
                    } catch (error) {
                        duplicateConflict(error);
                    }
                    if (!updated) teamConflict('revision_mismatch');
                    teamUpdated = true;

                    return { before: current, updated, invite, committedAt: finalNow };
                } catch (error) {
                    if (!teamUpdated) await restoreInviteClaim(invite, actor.now || new Date());
                    throw error;
                }
            },
            (result) => result.updated.revision,
        );
        invalidateLockoutCache(domainId);
        return committed;
    });
    await runPostCommitStep('finalize-accepted-invitation', outcome.updated, actor.user._id, async () => {
        const finalized = await inviteColl.updateOne(
            { _id: outcome.invite._id, status: 'accepting', inviteeUid: actor.user._id },
            {
                $set: {
                    status: 'accepted',
                    resolvedAt: outcome.committedAt,
                    resolvedBy: actor.user._id,
                    updatedAt: outcome.committedAt,
                },
            },
        );
        if (finalized.modifiedCount !== 1) teamConflict('invite_finalize_failed');
    });
    await runPostCommitStep('supersede-other-invitations', outcome.updated, actor.user._id, () =>
        inviteColl.updateMany(
            {
                domainId,
                contestId,
                inviteeUid: actor.user._id,
                status: { $in: ['pending', 'accepting'] },
                inviteId: { $ne: outcome.invite.inviteId },
            },
            {
                $set: {
                    status: 'superseded',
                    resolvedAt: outcome.committedAt,
                    resolvedBy: actor.user._id,
                    updatedAt: outcome.committedAt,
                },
            },
        ),
    );
    await runPostCommitStep('sync-invitations', outcome.updated, actor.user._id, () =>
        syncPendingInvitesAfterTeamMutation(outcome.updated, actor.user._id, outcome.committedAt, outcome.invite.inviteId),
    );
    await refreshTeamRoleSessionsAfterCommit(outcome.before, outcome.updated, actor.user._id);
    await runPostCommitStep('publish-role-change', outcome.updated, actor.user._id, async () =>
        bus.broadcast('contest/team-role-change', {
            before: outcome.before,
            after: outcome.updated,
            actorUid: actor.user._id,
            emergency: false,
        }),
    );
    return outcome.updated;
}

export function getPendingInvitesForUser(domainId: string, contestId: ObjectId, inviteeUid: number) {
    return inviteColl.find({ domainId, contestId, inviteeUid, status: 'pending' }).sort({ createdAt: -1, inviteId: -1 });
}

export async function getTeam(domainId: string, contestId: ObjectId, teamId: ObjectId): Promise<ContestTeamDoc | null> {
    return await withContestTeamBoundary(domainId, contestId, () => coll.findOne({ domainId, contestId, teamId, active: true }));
}

export async function getTeamByMember(domainId: string, contestId: ObjectId, uid: number): Promise<ContestTeamDoc | null> {
    return await withContestTeamBoundary(domainId, contestId, () => findActiveTeamByMember(domainId, contestId, uid));
}

export async function listTeams(domainId: string, contestId: ObjectId, query: Filter<ContestTeamDoc> = {}): Promise<ContestTeamDoc[]> {
    return await withContestTeamBoundary(domainId, contestId, () =>
        coll
            .find({ ...query, domainId, contestId, active: true })
            .sort({ nameKey: 1, teamId: 1 })
            .toArray(),
    );
}

export async function paginateTeams(
    domainId: string,
    contestId: ObjectId,
    query: Filter<ContestTeamDoc>,
    page: number,
    pageSize: number,
): Promise<[ContestTeamDoc[], number, number]> {
    return await withContestTeamBoundary(domainId, contestId, () =>
        db.paginate(coll.find({ ...query, domainId, contestId, active: true }).sort({ nameKey: 1, teamId: 1 }), page, pageSize),
    );
}

export async function countActiveTeams(domainId: string, contestId: ObjectId): Promise<number> {
    return await withContestTeamBoundary(domainId, contestId, () => coll.countDocuments({ domainId, contestId, active: true }));
}

export async function apply(ctx: Context) {
    await ctx.db.ensureIndexes(
        coll,
        {
            key: { domainId: 1, contestId: 1, nameKey: 1 },
            name: 'contestTeamNameActive',
            unique: true,
            partialFilterExpression: { active: true },
        },
        {
            key: { domainId: 1, contestId: 1, memberUids: 1 },
            name: 'contestTeamMemberActive',
            unique: true,
            partialFilterExpression: { active: true },
        },
        { key: { domainId: 1, contestId: 1, active: 1, nameKey: 1 }, name: 'contestTeamList' },
    );
    await ctx.db.ensureIndexes(
        inviteColl,
        {
            key: { domainId: 1, contestId: 1, teamId: 1, inviteeUid: 1 },
            name: 'contestTeamInvitePendingUnique',
            unique: true,
            partialFilterExpression: { status: 'pending' },
        },
        { key: { domainId: 1, contestId: 1, inviteeUid: 1, status: 1, createdAt: -1 }, name: 'contestTeamInviteeList' },
        { key: { domainId: 1, contestId: 1, teamId: 1, status: 1 }, name: 'contestTeamInviteTeamList' },
    );
    ctx.on('domain/delete', async (domainId) => {
        await Promise.all([coll.deleteMany({ domainId }), inviteColl.deleteMany({ domainId })]);
    });
    ctx.on('contest/del', async (domainId, contestId) => {
        await withContestTeamBoundary(domainId, contestId, async () => {
            const now = new Date();
            await Promise.all([
                coll.updateMany(
                    { domainId, contestId, active: true },
                    {
                        $set: { active: false, deactivatedAt: now, deactivationReason: 'team_closed', updatedAt: now },
                        $inc: { revision: 1 },
                    },
                ),
                inviteColl.updateMany(
                    { domainId, contestId, status: { $in: ['pending', 'accepting'] } },
                    { $set: { status: 'cancelled', resolvedAt: now, updatedAt: now } },
                ),
            ]);
        });
    });
}

global.Hydro.model.contestTeam = {
    coll,
    requireVigilLockoutCacheInvalidator,
    normalizeTeamName,
    normalizeTeamDescription,
    normalizeMemberUids,
    validateTeamShape,
    canManageContestTeams,
    buildExamModeTeamContext,
    createTeam,
    updateTeam,
    createInvite,
    acceptInvite,
    declineInvite,
    getPendingInvitesForUser,
    getTeam,
    getTeamByMember,
    listTeams,
    paginateTeams,
    countActiveTeams,
    assertContestTeamEligibility,
    assertContestTeamRosterEligibility,
    emergencyTeamConfirmation,
    inviteColl,
};
