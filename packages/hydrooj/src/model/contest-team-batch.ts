import { createHash } from 'crypto';
import { ObjectId, type Filter } from 'mongodb';
import type { Context } from '../context';
import { ContestTeamConflictError, PermissionError, UserNotFoundError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import db from '../service/db';
import { PERM, PRIV } from './builtin';
import * as contest from './contest';
import * as contestTeam from './contest-team';
import { withContestTeamBoundary } from './contest-team-gate';
import * as document from './document';
import * as oplog from './oplog';
import UserModel, { type User } from './user';

export type TeamBatchStatus = 'open' | 'closed';
export type TeamBatchManagementMode = contestTeam.ContestTeamManagementMode;
export type TeamBatchInviteStatus = contestTeam.ContestTeamInviteStatus;

export interface TeamBatchDoc {
    _id: ObjectId;
    batchId: ObjectId;
    domainId: string;
    name: string;
    nameKey: string;
    description: string;
    status: TeamBatchStatus;
    revision: number;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
    closedAt?: Date;
    closedBy?: number;
    copiedFromBatchId?: ObjectId;
    firstSnapshotAt?: Date;
    firstSnapshotContestId?: ObjectId;
    firstSnapshotHash?: string;
}

export interface TeamBatchTeamDoc {
    _id: ObjectId;
    teamId: ObjectId;
    batchId: ObjectId;
    domainId: string;
    name: string;
    nameKey: string;
    description: string;
    captainUid: number;
    memberUids: number[];
    managementMode: TeamBatchManagementMode;
    revision: number;
    active: boolean;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
    deactivatedAt?: Date;
    deactivatedBy?: number;
}

export interface TeamBatchInviteDoc {
    _id: ObjectId;
    inviteId: ObjectId;
    batchId: ObjectId;
    teamId: ObjectId;
    domainId: string;
    inviterUid: number;
    inviteeUid: number;
    teamRevision: number;
    status: TeamBatchInviteStatus;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    resolvedBy?: number;
}

export interface TeamBatchActor {
    user: User;
    now?: Date;
}

export interface TeamBatchCreateInput {
    name: string;
    description?: string;
}

export interface TeamBatchCopyResult {
    batch: TeamBatchDoc;
    teamCount: number;
    memberCount: number;
}

export interface TeamBatchTeamCreateInput {
    name: string;
    description?: string;
    captainUid: number;
    memberUids: number[];
    managementMode: TeamBatchManagementMode;
}

export interface TeamBatchTeamUpdateInput {
    expectedRevision: number;
    name?: string;
    description?: string;
    captainUid?: number;
    memberUids?: number[];
    managementMode?: TeamBatchManagementMode;
    active?: boolean;
}

export interface TeamBatchSnapshotResult {
    batchId: ObjectId;
    contestId: ObjectId;
    snapshotHash: string;
    teamCount: number;
    memberCount: number;
    snapshotAt: Date;
    alreadyApplied: boolean;
}

export const batchColl = db.collection<TeamBatchDoc>('contest.teamBatches');
export const teamColl = db.collection<TeamBatchTeamDoc>('contest.teamBatchTeams');
export const inviteColl = db.collection<TeamBatchInviteDoc>('contest.teamBatchInvites');

const recordColl = db.collection<any>('record');

function conflict(reason: string): never {
    throw new ContestTeamConflictError(reason);
}

export function canManageTeamBatches(user: User): boolean {
    return user.hasPerm(PERM.PERM_CREATE_CONTEST) || user.hasPerm(PERM.PERM_EDIT_CONTEST) || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

function requireManager(actor: TeamBatchActor): void {
    if (!canManageTeamBatches(actor.user)) throw new PermissionError(PERM.PERM_CREATE_CONTEST);
}

export async function assertTeamBatchMemberEligibility(domainId: string, uid: number): Promise<void> {
    if (!Number.isSafeInteger(uid) || uid <= 1) throw new ValidationError('memberUids');
    const udoc = await UserModel.getById(domainId, uid);
    if (!udoc?._id) throw new UserNotFoundError(uid);
    if (!udoc.hasPerm(PERM.PERM_VIEW_CONTEST) || !udoc.hasPerm(PERM.PERM_ATTEND_CONTEST)) {
        throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
    }
}

async function assertBatchMembers(domainId: string, memberUids: number[]): Promise<void> {
    for (const uid of memberUids) await assertTeamBatchMemberEligibility(domainId, uid);
}

function duplicateConflict(error: any): never {
    if (error?.code !== 11000) throw error;
    const fields = Object.keys(error?.keyPattern || {});
    if (fields.includes('memberUids')) conflict('member_already_assigned');
    if (fields.includes('nameKey')) conflict('name_already_used');
    if (fields.includes('sourceBatchTeamId')) conflict('batch_snapshot_already_applied');
    conflict('unique_constraint');
}

const batchMutationTails = new Map<string, Promise<void>>();

/**
 * HydroOJ is a single application process on this site. A narrow in-process
 * tail prevents a close request from crossing a roster write without adding
 * a lease, worker, or persistent recovery protocol.
 */
async function withBatchMutation<T>(domainId: string, batchId: ObjectId, work: () => Promise<T>): Promise<T> {
    const key = `${domainId}:${batchId.toHexString()}`;
    const previous = batchMutationTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    batchMutationTails.set(key, current);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (batchMutationTails.get(key) === current) batchMutationTails.delete(key);
    }
}

async function audit(
    operation: string,
    data: {
        domainId: string;
        actorUid: number;
        batchId: ObjectId;
        teamId?: ObjectId;
        inviteId?: ObjectId;
        targetUids?: number[];
        fromRevision: number;
        toRevision: number;
        result: 'success' | 'rejected';
        reason?: string;
        contestId?: ObjectId;
        snapshotHash?: string;
        teamCount?: number;
        memberCount?: number;
        stage?: string;
        sourceBatchId?: ObjectId;
        sourceRevision?: number;
    },
): Promise<void> {
    await oplog.add({
        type: `contest.team-batch.${operation}`,
        operation,
        domainId: data.domainId,
        operator: data.actorUid,
        batchId: data.batchId,
        teamId: data.teamId,
        inviteId: data.inviteId,
        contestId: data.contestId,
        targetUids: data.targetUids || [],
        fromRevision: data.fromRevision,
        toRevision: data.toRevision,
        result: data.result,
        reason: data.reason,
        snapshotHash: data.snapshotHash,
        teamCount: data.teamCount,
        memberCount: data.memberCount,
        stage: data.stage,
        sourceBatchId: data.sourceBatchId,
        sourceRevision: data.sourceRevision,
        time: new Date(),
    });
}

async function auditRejected(operation: string, data: Omit<Parameters<typeof audit>[1], 'toRevision' | 'result'>, error: any): Promise<void> {
    try {
        await audit(operation, {
            ...data,
            toRevision: data.fromRevision,
            result: 'rejected',
            reason: String(error?.params?.[0] || error?.code || error?.name || 'Error'),
        });
    } catch (auditError) {
        console.error('[contest-team-batch] failed to audit rejected mutation', { operation, ...data }, auditError);
    }
}

async function auditSuccess(operation: string, data: Omit<Parameters<typeof audit>[1], 'result'>): Promise<void> {
    try {
        await audit(operation, { ...data, result: 'success' });
    } catch (auditError) {
        console.error('[contest-team-batch] committed mutation but success audit failed', { operation, ...data }, auditError);
    }
}

async function runPostCommitStep(operation: string, team: TeamBatchTeamDoc, actorUid: number, step: () => Promise<unknown>): Promise<void> {
    try {
        await step();
    } catch (error) {
        console.error(
            '[contest-team-batch] committed mutation post-commit step failed',
            {
                domainId: team.domainId,
                batchId: team.batchId,
                teamId: team.teamId,
                teamRevision: team.revision,
                actorUid,
                operation,
            },
            error,
        );
    }
}

async function loadBatch(domainId: string, batchId: ObjectId): Promise<TeamBatchDoc> {
    const batch = await batchColl.findOne({ domainId, batchId });
    if (!batch) conflict('batch_not_found');
    return batch;
}

async function loadOpenBatch(domainId: string, batchId: ObjectId): Promise<TeamBatchDoc> {
    const batch = await loadBatch(domainId, batchId);
    if (batch.status !== 'open') conflict('batch_closed');
    return batch;
}

async function touchOpenBatch(batch: TeamBatchDoc, now: Date): Promise<TeamBatchDoc> {
    // Reserve the parent revision before the child write. A failed child write
    // may consume one revision by design; this keeps a concurrent close from
    // succeeding and then accepting a late team or invitation.
    const updated = await batchColl.findOneAndUpdate(
        { domainId: batch.domainId, batchId: batch.batchId, status: 'open', revision: batch.revision },
        { $set: { updatedAt: now }, $inc: { revision: 1 } },
        { returnDocument: 'after' },
    );
    if (!updated) conflict('batch_revision_mismatch');
    return updated;
}

async function loadActiveTeam(domainId: string, batchId: ObjectId, teamId: ObjectId): Promise<TeamBatchTeamDoc> {
    const team = await teamColl.findOne({ domainId, batchId, teamId, active: true });
    if (!team) conflict('not_found_or_inactive');
    return team;
}

async function syncPendingInvites(team: TeamBatchTeamDoc, actorUid: number, now: Date, excludeInviteId?: ObjectId): Promise<void> {
    const filter = {
        domainId: team.domainId,
        batchId: team.batchId,
        teamId: team.teamId,
        status: { $in: ['pending', 'accepting'] as TeamBatchInviteStatus[] },
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

export async function createBatch(domainId: string, actor: TeamBatchActor, input: TeamBatchCreateInput): Promise<TeamBatchDoc> {
    requireManager(actor);
    const now = actor.now || new Date();
    const batchId = new ObjectId();
    const { name, nameKey } = contestTeam.normalizeTeamName(input.name);
    const description = contestTeam.normalizeTeamDescription(input.description);
    const doc: TeamBatchDoc = {
        _id: batchId,
        batchId,
        domainId,
        name,
        nameKey,
        description,
        status: 'open',
        revision: 1,
        createdBy: actor.user._id,
        createdAt: now,
        updatedAt: now,
    };
    try {
        await batchColl.insertOne(doc);
    } catch (error) {
        duplicateConflict(error);
    }
    await auditSuccess('create', {
        domainId,
        actorUid: actor.user._id,
        batchId,
        fromRevision: 0,
        toRevision: 1,
    });
    return doc;
}

async function cleanupFailedBatchCopy(
    domainId: string,
    sourceBatchId: ObjectId,
    targetBatchId: ObjectId,
    targetTeamIds: ObjectId[],
    writeError: unknown,
): Promise<void> {
    try {
        await Promise.all([
            teamColl.deleteMany({ domainId, batchId: targetBatchId, teamId: { $in: targetTeamIds } }),
            batchColl.deleteMany({ domainId, batchId: targetBatchId }),
        ]);
        const [remainingTeams, remainingBatches] = await Promise.all([
            teamColl.countDocuments({ domainId, batchId: targetBatchId }),
            batchColl.countDocuments({ domainId, batchId: targetBatchId }),
        ]);
        if (remainingTeams || remainingBatches) {
            throw new Error(`Batch copy cleanup left ${remainingTeams} teams and ${remainingBatches} batches`);
        }
    } catch (cleanupError) {
        console.error('[contest-team-batch] batch copy cleanup failed', {
            domainId,
            sourceBatchId,
            targetBatchId,
            targetTeamIds,
            writeError,
            cleanupError,
        });
        throw new Error(`Batch copy cleanup failed for ${targetBatchId.toHexString()}`, { cause: writeError });
    }
}

export async function copyBatch(
    domainId: string,
    sourceBatchId: ObjectId,
    actor: TeamBatchActor,
    input: TeamBatchCreateInput,
): Promise<TeamBatchCopyResult> {
    requireManager(actor);
    return await withBatchMutation(domainId, sourceBatchId, async () => {
        const sourceBatch = await loadBatch(domainId, sourceBatchId);
        const targetBatchId = new ObjectId();
        const auditBase = {
            domainId,
            actorUid: actor.user._id,
            batchId: targetBatchId,
            sourceBatchId,
            sourceRevision: sourceBatch.revision,
            fromRevision: 0,
        };
        let writeAttempted = false;
        let targetTeamIds: ObjectId[] = [];
        try {
            const { name, nameKey } = contestTeam.normalizeTeamName(input.name);
            const description = contestTeam.normalizeTeamDescription(input.description);
            if (await batchColl.findOne({ domainId, nameKey })) conflict('name_already_used');

            const sourceTeams = await teamColl.find({ domainId, batchId: sourceBatchId, active: true }).sort({ nameKey: 1, teamId: 1 }).toArray();
            const seenNames = new Set<string>();
            const seenMembers = new Set<number>();
            const now = actor.now || new Date();
            const targetTeams = sourceTeams.map((sourceTeam) => {
                if (!['self', 'admin'].includes(sourceTeam.managementMode)) conflict('source_team_invalid');
                const memberUids = contestTeam.validateTeamShape(sourceTeam.memberUids, sourceTeam.captainUid);
                if (memberUids.length !== sourceTeam.memberUids.length) conflict('source_team_invalid');
                const normalizedName = contestTeam.normalizeTeamName(sourceTeam.name);
                if (seenNames.has(normalizedName.nameKey)) conflict('source_team_invalid');
                seenNames.add(normalizedName.nameKey);
                for (const uid of memberUids) {
                    if (seenMembers.has(uid)) conflict('source_member_duplicated');
                    seenMembers.add(uid);
                }
                const teamId = new ObjectId();
                return {
                    _id: teamId,
                    teamId,
                    batchId: targetBatchId,
                    domainId,
                    name: normalizedName.name,
                    nameKey: normalizedName.nameKey,
                    description: contestTeam.normalizeTeamDescription(sourceTeam.description),
                    captainUid: sourceTeam.captainUid,
                    memberUids,
                    managementMode: sourceTeam.managementMode,
                    revision: 1,
                    active: true,
                    createdBy: actor.user._id,
                    createdAt: now,
                    updatedAt: now,
                } satisfies TeamBatchTeamDoc;
            });
            targetTeamIds = targetTeams.map((team) => team.teamId);
            const targetBatch: TeamBatchDoc = {
                _id: targetBatchId,
                batchId: targetBatchId,
                domainId,
                name,
                nameKey,
                description,
                status: 'open',
                revision: 1,
                createdBy: actor.user._id,
                createdAt: now,
                updatedAt: now,
                copiedFromBatchId: sourceBatchId,
            };

            writeAttempted = true;
            if (targetTeams.length) await teamColl.insertMany(targetTeams);
            await batchColl.insertOne(targetBatch);
            const result = {
                batch: targetBatch,
                teamCount: targetTeams.length,
                memberCount: targetTeams.reduce((total, team) => total + team.memberUids.length, 0),
            };
            await auditSuccess('copy', {
                ...auditBase,
                toRevision: 1,
                teamCount: result.teamCount,
                memberCount: result.memberCount,
            });
            return result;
        } catch (error) {
            let rejectedError = error;
            if (writeAttempted) {
                try {
                    await cleanupFailedBatchCopy(domainId, sourceBatchId, targetBatchId, targetTeamIds, error);
                } catch (cleanupError) {
                    rejectedError = cleanupError;
                }
            }
            await auditRejected('copy', auditBase, rejectedError);
            if ((rejectedError as any)?.code === 11000) duplicateConflict(rejectedError);
            throw rejectedError;
        }
    });
}

export async function closeBatch(domainId: string, batchId: ObjectId, expectedRevision: number, actor: TeamBatchActor): Promise<TeamBatchDoc> {
    requireManager(actor);
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadOpenBatch(domainId, batchId);
        const auditBase = { domainId, actorUid: actor.user._id, batchId, fromRevision: batch.revision };
        try {
            if (batch.revision !== expectedRevision) conflict('batch_revision_mismatch');
            const now = actor.now || new Date();
            const updated = await batchColl.findOneAndUpdate(
                { domainId, batchId, status: 'open', revision: expectedRevision },
                { $set: { status: 'closed', closedAt: now, closedBy: actor.user._id, updatedAt: now }, $inc: { revision: 1 } },
                { returnDocument: 'after' },
            );
            if (!updated) conflict('batch_revision_mismatch');
            await auditSuccess('close', { ...auditBase, toRevision: updated.revision });
            return updated;
        } catch (error) {
            await auditRejected('close', auditBase, error);
            throw error;
        }
    });
}

async function hasBatchUseEvidence(domainId: string, batch: TeamBatchDoc): Promise<boolean> {
    if (batch.firstSnapshotAt || batch.firstSnapshotContestId || batch.firstSnapshotHash) return true;
    const [contestBinding, snapshotTeam, snapshotAudit] = await Promise.all([
        document.coll.findOne({
            domainId,
            docType: document.TYPE_CONTEST,
            teamBatchId: batch.batchId,
        }),
        contestTeam.coll.findOne({ domainId, sourceBatchId: batch.batchId }),
        oplog.coll.findOne({
            type: 'contest.team-batch.snapshot',
            domainId,
            batchId: batch.batchId,
            result: 'success',
        }),
    ]);
    return !!contestBinding || !!snapshotTeam || !!snapshotAudit;
}

export async function canReopenBatch(domainId: string, batchId: ObjectId): Promise<boolean> {
    const batch = await batchColl.findOne({ domainId, batchId });
    return !!batch && batch.status === 'closed' && !(await hasBatchUseEvidence(domainId, batch));
}

export async function reopenBatch(domainId: string, batchId: ObjectId, expectedRevision: number, actor: TeamBatchActor): Promise<TeamBatchDoc> {
    requireManager(actor);
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadBatch(domainId, batchId);
        const auditBase = { domainId, actorUid: actor.user._id, batchId, fromRevision: batch.revision };
        try {
            if (batch.status !== 'closed') conflict('batch_must_be_closed');
            if (batch.revision !== expectedRevision) conflict('batch_revision_mismatch');
            if (await hasBatchUseEvidence(domainId, batch)) conflict('batch_already_used_copy_required');
            const now = actor.now || new Date();
            let updated: TeamBatchDoc | null;
            try {
                updated = await batchColl.findOneAndUpdate(
                    {
                        domainId,
                        batchId,
                        status: 'closed',
                        revision: expectedRevision,
                        firstSnapshotAt: { $exists: false },
                        firstSnapshotContestId: { $exists: false },
                        firstSnapshotHash: { $exists: false },
                    },
                    {
                        $set: { status: 'open', updatedAt: now },
                        $unset: { closedAt: '', closedBy: '' },
                        $inc: { revision: 1 },
                    },
                    { returnDocument: 'after' },
                );
            } catch (error) {
                duplicateConflict(error);
            }
            if (!updated) conflict('batch_revision_mismatch');
            await auditSuccess('reopen', { ...auditBase, toRevision: updated.revision });
            return updated;
        } catch (error) {
            await auditRejected('reopen', auditBase, error);
            throw error;
        }
    });
}

export async function createTeam(
    domainId: string,
    batchId: ObjectId,
    actor: TeamBatchActor,
    input: TeamBatchTeamCreateInput,
): Promise<TeamBatchTeamDoc> {
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadOpenBatch(domainId, batchId);
        const teamId = new ObjectId();
        const auditBase = {
            domainId,
            actorUid: actor.user._id,
            batchId,
            teamId,
            targetUids: Array.isArray(input.memberUids) ? input.memberUids : [],
            fromRevision: 0,
        };
        try {
            const manager = canManageTeamBatches(actor.user);
            if (!['self', 'admin'].includes(input.managementMode)) throw new ValidationError('managementMode');
            if (input.managementMode === 'admin' && !manager) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
            if (input.managementMode === 'self' && (input.captainUid !== actor.user._id || input.memberUids.length !== 1)) {
                throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
            }
            const memberUids = contestTeam.validateTeamShape(input.memberUids, input.captainUid);
            await assertBatchMembers(domainId, memberUids);
            const { name, nameKey } = contestTeam.normalizeTeamName(input.name);
            const description = contestTeam.normalizeTeamDescription(input.description);
            const now = actor.now || new Date();
            await touchOpenBatch(batch, now);
            const doc: TeamBatchTeamDoc = {
                _id: teamId,
                teamId,
                batchId,
                domainId,
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
                await teamColl.insertOne(doc);
            } catch (error) {
                duplicateConflict(error);
            }
            await auditSuccess('team-create', { ...auditBase, targetUids: memberUids, toRevision: 1 });
            return doc;
        } catch (error) {
            await auditRejected('team-create', auditBase, error);
            throw error;
        }
    });
}

export async function updateTeam(
    domainId: string,
    batchId: ObjectId,
    teamId: ObjectId,
    actor: TeamBatchActor,
    input: TeamBatchTeamUpdateInput,
): Promise<TeamBatchTeamDoc> {
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadOpenBatch(domainId, batchId);
        const current = await loadActiveTeam(domainId, batchId, teamId);
        const auditBase = {
            domainId,
            actorUid: actor.user._id,
            batchId,
            teamId,
            targetUids: [...current.memberUids],
            fromRevision: current.revision,
        };
        let outcome: { updated: TeamBatchTeamDoc; committedAt: Date };
        try {
            if (current.revision !== input.expectedRevision) conflict('revision_mismatch');
            const manager = canManageTeamBatches(actor.user);
            const changesRoster =
                input.memberUids !== undefined || input.captainUid !== undefined || input.managementMode !== undefined || input.active === false;
            const isCaptain = current.captainUid === actor.user._id;
            const isMember = current.memberUids.includes(actor.user._id);
            if (current.managementMode === 'admin' && !manager && changesRoster) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
            if (!manager && !isCaptain && (!changesRoster || !isMember)) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
            if (input.managementMode !== undefined && !['self', 'admin'].includes(input.managementMode)) {
                throw new ValidationError('managementMode');
            }
            if (input.managementMode !== undefined && !manager) throw new PermissionError(PERM.PERM_EDIT_CONTEST);

            const deactivating = input.active === false;
            const memberUids =
                input.memberUids === undefined
                    ? current.memberUids
                    : contestTeam.validateTeamShape(input.memberUids, input.captainUid ?? current.captainUid);
            const captainUid = input.captainUid ?? current.captainUid;
            contestTeam.validateTeamShape(memberUids, captainUid);
            if (!deactivating) await assertBatchMembers(domainId, memberUids);

            if (!manager && changesRoster) {
                if (current.managementMode === 'admin') throw new PermissionError(PERM.PERM_EDIT_CONTEST);
                const actorLeaving = !memberUids.includes(actor.user._id);
                if (actorLeaving && actor.user._id === current.captainUid && current.memberUids.length > 1) {
                    conflict('captain_must_transfer_before_leaving');
                }
                if (!isCaptain) {
                    const onlySelfRemoved =
                        current.memberUids.length === memberUids.length + 1 &&
                        !memberUids.includes(actor.user._id) &&
                        current.memberUids.every((uid) => uid === actor.user._id || memberUids.includes(uid));
                    if (!onlySelfRemoved) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
                } else if (memberUids.some((uid) => !current.memberUids.includes(uid))) {
                    conflict('new_member_requires_invitation');
                }
            }

            const now = actor.now || new Date();
            await touchOpenBatch(batch, now);
            const patch: Partial<TeamBatchTeamDoc> = { memberUids, captainUid, updatedAt: now };
            if (input.name !== undefined) Object.assign(patch, contestTeam.normalizeTeamName(input.name));
            if (input.description !== undefined) patch.description = contestTeam.normalizeTeamDescription(input.description);
            if (input.managementMode !== undefined) patch.managementMode = input.managementMode;
            if (input.active !== undefined) patch.active = input.active;
            if (deactivating) {
                patch.deactivatedAt = now;
                patch.deactivatedBy = actor.user._id;
            }
            let updated: TeamBatchTeamDoc;
            try {
                updated = await teamColl.findOneAndUpdate(
                    { domainId, batchId, teamId, active: true, revision: current.revision },
                    { $set: patch, $inc: { revision: 1 } },
                    { returnDocument: 'after' },
                );
            } catch (error) {
                duplicateConflict(error);
            }
            if (!updated) conflict('revision_mismatch');
            await auditSuccess('team-update', { ...auditBase, targetUids: memberUids, toRevision: updated.revision });
            outcome = { updated, committedAt: now };
        } catch (error) {
            await auditRejected('team-update', auditBase, error);
            throw error;
        }
        await runPostCommitStep('sync-invitations', outcome.updated, actor.user._id, () =>
            syncPendingInvites(outcome.updated, actor.user._id, outcome.committedAt),
        );
        return outcome.updated;
    });
}

export async function createInvite(domainId: string, batchId: ObjectId, actor: TeamBatchActor, inviteeUid: number): Promise<TeamBatchInviteDoc> {
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadOpenBatch(domainId, batchId);
        const team = await getTeamByMember(domainId, batchId, actor.user._id);
        const inviteId = new ObjectId();
        const auditBase = {
            domainId,
            actorUid: actor.user._id,
            batchId,
            teamId: team?.teamId,
            inviteId,
            targetUids: [inviteeUid],
            fromRevision: team?.revision || 0,
        };
        try {
            if (!team) conflict('team_required');
            if (team.managementMode !== 'self' || team.captainUid !== actor.user._id) {
                throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
            }
            if (team.memberUids.length >= 3) conflict('team_full');
            if (team.memberUids.includes(inviteeUid)) conflict('member_already_assigned');
            await assertTeamBatchMemberEligibility(domainId, inviteeUid);
            if (await getTeamByMember(domainId, batchId, inviteeUid)) conflict('member_already_assigned');
            const now = actor.now || new Date();
            await touchOpenBatch(batch, now);
            const existing = await inviteColl.findOne({ domainId, batchId, teamId: team.teamId, inviteeUid, status: 'pending' });
            if (existing) {
                const refreshed = await inviteColl.findOneAndUpdate(
                    { _id: existing._id, status: 'pending', teamRevision: existing.teamRevision },
                    { $set: { inviterUid: actor.user._id, teamRevision: team.revision, updatedAt: now } },
                    { returnDocument: 'after' },
                );
                if (!refreshed) conflict('invite_revision_mismatch');
                await auditSuccess('invite-create', {
                    ...auditBase,
                    inviteId: refreshed.inviteId,
                    toRevision: team.revision,
                });
                return refreshed;
            }
            const doc: TeamBatchInviteDoc = {
                _id: inviteId,
                inviteId,
                domainId,
                batchId,
                teamId: team.teamId,
                inviterUid: actor.user._id,
                inviteeUid,
                teamRevision: team.revision,
                status: 'pending',
                createdAt: now,
                updatedAt: now,
            };
            try {
                await inviteColl.insertOne(doc);
            } catch (error: any) {
                if (error?.code === 11000) conflict('invite_already_pending');
                throw error;
            }
            await auditSuccess('invite-create', { ...auditBase, toRevision: team.revision });
            return doc;
        } catch (error) {
            await auditRejected('invite-create', auditBase, error);
            throw error;
        }
    });
}

export async function declineInvite(domainId: string, batchId: ObjectId, inviteId: ObjectId, actor: TeamBatchActor): Promise<TeamBatchInviteDoc> {
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadOpenBatch(domainId, batchId);
        const invite = await inviteColl.findOne({ domainId, batchId, inviteId, status: 'pending' });
        if (!invite) conflict('invite_not_found_or_resolved');
        const auditBase = {
            domainId,
            actorUid: actor.user._id,
            batchId,
            teamId: invite.teamId,
            inviteId,
            targetUids: [actor.user._id],
            fromRevision: invite.teamRevision,
        };
        try {
            if (invite.inviteeUid !== actor.user._id) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
            const now = actor.now || new Date();
            await touchOpenBatch(batch, now);
            const updated = await inviteColl.findOneAndUpdate(
                { _id: invite._id, status: 'pending', inviteeUid: actor.user._id },
                { $set: { status: 'declined', resolvedAt: now, resolvedBy: actor.user._id, updatedAt: now } },
                { returnDocument: 'after' },
            );
            if (!updated) conflict('invite_not_found_or_resolved');
            await auditSuccess('invite-decline', { ...auditBase, toRevision: invite.teamRevision });
            return updated;
        } catch (error) {
            await auditRejected('invite-decline', auditBase, error);
            throw error;
        }
    });
}

export async function acceptInvite(domainId: string, batchId: ObjectId, inviteId: ObjectId, actor: TeamBatchActor): Promise<TeamBatchTeamDoc> {
    return await withBatchMutation(domainId, batchId, async () => {
        const batch = await loadOpenBatch(domainId, batchId);
        const invite = await inviteColl.findOne({ domainId, batchId, inviteId, status: 'pending' });
        if (!invite) conflict('invite_not_found_or_resolved');
        const auditBase = {
            domainId,
            actorUid: actor.user._id,
            batchId,
            teamId: invite.teamId,
            inviteId,
            targetUids: [actor.user._id],
            fromRevision: invite.teamRevision,
        };
        let outcome: { updated: TeamBatchTeamDoc; invite: TeamBatchInviteDoc; committedAt: Date };
        try {
            if (invite.inviteeUid !== actor.user._id) throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
            if (await getTeamByMember(domainId, batchId, actor.user._id)) conflict('member_already_assigned');
            await assertTeamBatchMemberEligibility(domainId, actor.user._id);
            const team = await loadActiveTeam(domainId, batchId, invite.teamId);
            if (team.managementMode !== 'self') conflict('invite_team_not_self_managed');
            if (team.revision !== invite.teamRevision) conflict('invite_revision_mismatch');
            if (team.memberUids.length >= 3) conflict('team_full');
            const now = actor.now || new Date();
            await touchOpenBatch(batch, now);
            const claimed = await inviteColl.findOneAndUpdate(
                { _id: invite._id, status: 'pending', inviteeUid: actor.user._id, teamRevision: team.revision },
                { $set: { status: 'accepting', updatedAt: now } },
                { returnDocument: 'after' },
            );
            if (!claimed) conflict('invite_not_found_or_resolved');
            const memberUids = contestTeam.validateTeamShape([...team.memberUids, actor.user._id], team.captainUid);
            let updated: TeamBatchTeamDoc;
            try {
                updated = await teamColl.findOneAndUpdate(
                    { domainId, batchId, teamId: team.teamId, active: true, revision: team.revision },
                    { $set: { memberUids, updatedAt: now }, $inc: { revision: 1 } },
                    { returnDocument: 'after' },
                );
            } catch (error) {
                await inviteColl.updateOne({ _id: invite._id, status: 'accepting' }, { $set: { status: 'pending', updatedAt: now } });
                duplicateConflict(error);
            }
            if (!updated) {
                await inviteColl.updateOne({ _id: invite._id, status: 'accepting' }, { $set: { status: 'pending', updatedAt: now } });
                conflict('revision_mismatch');
            }
            await auditSuccess('invite-accept', { ...auditBase, toRevision: updated.revision });
            outcome = { updated, invite, committedAt: now };
        } catch (error) {
            await auditRejected('invite-accept', auditBase, error);
            throw error;
        }
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
            if (finalized.modifiedCount !== 1) conflict('invite_finalize_failed');
        });
        await runPostCommitStep('supersede-other-invitations', outcome.updated, actor.user._id, () =>
            inviteColl.updateMany(
                {
                    domainId,
                    batchId,
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
            syncPendingInvites(outcome.updated, actor.user._id, outcome.committedAt, outcome.invite.inviteId),
        );
        return outcome.updated;
    });
}

export async function getBatch(domainId: string, batchId: ObjectId): Promise<TeamBatchDoc | null> {
    return await batchColl.findOne({ domainId, batchId });
}

export function getMultiBatch(domainId: string, query: Filter<TeamBatchDoc> = {}) {
    return batchColl.find({ ...query, domainId }).sort({ status: 1, updatedAt: -1, batchId: -1 });
}

export async function getTeam(domainId: string, batchId: ObjectId, teamId: ObjectId): Promise<TeamBatchTeamDoc | null> {
    return await teamColl.findOne({ domainId, batchId, teamId, active: true });
}

export async function getTeamByMember(domainId: string, batchId: ObjectId, uid: number): Promise<TeamBatchTeamDoc | null> {
    return await teamColl.findOne({ domainId, batchId, memberUids: uid, active: true });
}

export function getMultiTeam(domainId: string, batchId: ObjectId, query: Filter<TeamBatchTeamDoc> = {}) {
    return teamColl.find({ ...query, domainId, batchId, active: true }).sort({ nameKey: 1, teamId: 1 });
}

export function getPendingInvitesForUser(domainId: string, batchId: ObjectId, inviteeUid: number) {
    return inviteColl.find({ domainId, batchId, inviteeUid, status: 'pending' }).sort({ createdAt: -1, inviteId: -1 });
}

export async function countBatchTeams(domainId: string, batchId: ObjectId): Promise<number> {
    return await teamColl.countDocuments({ domainId, batchId, active: true });
}

export async function countBatchMembers(domainId: string, batchId: ObjectId): Promise<number> {
    const teams = await teamColl.find({ domainId, batchId, active: true }).project({ memberUids: 1 }).toArray();
    return teams.reduce((sum, team) => sum + team.memberUids.length, 0);
}

export async function listClosedBatches(domainId: string): Promise<Array<TeamBatchDoc & { teamCount: number; memberCount: number }>> {
    const batches = await batchColl.find({ domainId, status: 'closed' }).sort({ closedAt: -1, batchId: -1 }).toArray();
    return await Promise.all(
        batches.map(async (batch) => ({
            ...batch,
            teamCount: await countBatchTeams(domainId, batch.batchId),
            memberCount: await countBatchMembers(domainId, batch.batchId),
        })),
    );
}

function snapshotHash(batch: TeamBatchDoc, teams: TeamBatchTeamDoc[]): string {
    const canonical = {
        batchId: batch.batchId.toHexString(),
        revision: batch.revision,
        teams: teams.map((team) => ({
            sourceTeamId: team.teamId.toHexString(),
            name: team.name,
            description: team.description,
            captainUid: team.captainUid,
            memberUids: [...team.memberUids].sort((a, b) => a - b),
            managementMode: team.managementMode,
            revision: team.revision,
        })),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function contestEligibilityFingerprint(tdoc: Tdoc): string {
    const ids = (value: ObjectId[] | undefined) => (value || []).map((item) => item.toHexString()).sort();
    return JSON.stringify({
        rule: tdoc.rule,
        participationMode: contest.getParticipationMode(tdoc),
        participationRevision: tdoc.participationRevision,
        beginAt: tdoc.beginAt.toISOString(),
        assign: [...(tdoc.assign || [])].sort(),
        participantScopeMode: tdoc.participantScopeMode,
        participantSchoolIds: ids(tdoc.participantSchoolIds),
        participantGroupIds: ids(tdoc.participantGroupIds),
    });
}

function exactStoredField(field: keyof Tdoc, value: unknown): Record<string, unknown> {
    return value === undefined ? { [field]: { $exists: false } } : { [field]: value };
}

interface SnapshotTrace {
    stage: string;
}

async function cleanupSnapshot(domainId: string, contestId: ObjectId, snapshotId: ObjectId, expectedCount: number): Promise<void> {
    const result = await contestTeam.coll.deleteMany({ domainId, contestId, snapshotId });
    const remaining = await contestTeam.coll.countDocuments({ domainId, contestId, snapshotId });
    if (remaining) {
        console.error('[contest-team-batch] snapshot cleanup failed', {
            domainId,
            contestId,
            snapshotId,
            expectedCount,
            deletedCount: result.deletedCount,
            remaining,
        });
        conflict('batch_snapshot_cleanup_failed');
    }
}

function snapshotMemberConflict(batchId: ObjectId, team: TeamBatchTeamDoc, uid: number, stage: string, error: any): never {
    const cause = String(error?.params?.[0] || error?.code || error?.name || 'Error');
    throw new ContestTeamConflictError(
        `batch_snapshot_member_ineligible;batchId=${batchId};teamId=${team.teamId};uid=${uid};stage=${stage};cause=${cause}`,
    );
}

async function snapshotToContestUnlocked(
    domainId: string,
    contestId: ObjectId,
    batchId: ObjectId,
    actorUid: number,
    trace: SnapshotTrace,
): Promise<TeamBatchSnapshotResult> {
    trace.stage = 'target-load';
    const tdoc = await contest.get(domainId, contestId);
    if (!tdoc || contest.getParticipationMode(tdoc) !== 'team' || tdoc.rule !== 'acm') throw new ValidationError('teamBatchId');
    if (new Date() >= tdoc.beginAt) conflict('contest_started');
    if (await recordColl.countDocuments({ domainId, contest: contestId })) conflict('contest_has_records');

    trace.stage = 'source-load';
    const batch = await loadBatch(domainId, batchId);
    if (batch.status !== 'closed') conflict('batch_must_be_closed');
    const teams = await getMultiTeam(domainId, batchId).toArray();
    if (!teams.length) conflict('batch_has_no_teams');
    trace.stage = 'member-validation';
    for (const team of teams) {
        try {
            contestTeam.validateTeamShape(team.memberUids, team.captainUid);
        } catch (error) {
            snapshotMemberConflict(batchId, team, team.captainUid, 'team-shape', error);
        }
        for (const uid of team.memberUids) {
            try {
                await contestTeam.assertContestTeamRosterEligibility(domainId, tdoc, uid);
            } catch (error) {
                snapshotMemberConflict(batchId, team, uid, 'contest-eligibility', error);
            }
        }
    }
    const hash = snapshotHash(batch, teams);
    const memberCount = teams.reduce((sum, team) => sum + team.memberUids.length, 0);
    const existingBatchId = tdoc.teamBatchId ? new ObjectId(tdoc.teamBatchId) : null;
    if (existingBatchId) {
        if (!existingBatchId.equals(batchId) || tdoc.teamBatchSnapshotHash !== hash) conflict('contest_bound_to_different_batch_snapshot');
        const existingCount = await contestTeam.coll.countDocuments({
            domainId,
            contestId,
            sourceBatchId: batchId,
            active: true,
        });
        if (existingCount !== teams.length || tdoc.teamBatchSnapshotCount !== teams.length) conflict('batch_snapshot_incomplete');
        return {
            batchId,
            contestId,
            snapshotHash: hash,
            teamCount: teams.length,
            memberCount,
            snapshotAt: tdoc.teamBatchSnapshotAt,
            alreadyApplied: true,
        };
    }
    if (await contestTeam.coll.countDocuments({ domainId, contestId, active: true })) conflict('contest_already_has_teams');

    const snapshotId = new ObjectId();
    const snapshotAt = new Date();
    const docs: contestTeam.ContestTeamDoc[] = teams.map((source) => {
        const teamId = new ObjectId();
        return {
            _id: teamId,
            teamId,
            domainId,
            contestId,
            name: source.name,
            nameKey: source.nameKey,
            description: source.description,
            captainUid: source.captainUid,
            memberUids: [...source.memberUids],
            managementMode: source.managementMode,
            revision: 1,
            active: false,
            createdBy: actorUid,
            createdAt: snapshotAt,
            updatedAt: snapshotAt,
            sourceBatchId: batchId,
            sourceBatchTeamId: source.teamId,
            snapshotId,
            snapshotState: 'preparing',
        };
    });
    const auditBase = {
        domainId,
        actorUid,
        batchId,
        contestId,
        snapshotHash: hash,
        teamCount: docs.length,
        memberCount,
        fromRevision: batch.revision,
    };
    let usageMarkerClaimed = false;
    try {
        trace.stage = 'prepare-cleanup';
        await contestTeam.coll.deleteMany({ domainId, contestId, active: false, snapshotState: 'preparing' });
        trace.stage = 'prepare-insert';
        try {
            await contestTeam.coll.insertMany(docs, { ordered: true });
        } catch (error) {
            duplicateConflict(error);
        }
        const preparedCount = await contestTeam.coll.countDocuments({ domainId, contestId, snapshotId, active: false, snapshotState: 'preparing' });
        if (preparedCount !== docs.length) conflict('batch_snapshot_prepare_incomplete');

        trace.stage = 'target-recheck';
        const latestContest = await contest.get(domainId, contestId);
        if (
            !latestContest ||
            contestEligibilityFingerprint(latestContest) !== contestEligibilityFingerprint(tdoc) ||
            new Date() >= latestContest.beginAt
        ) {
            conflict('contest_eligibility_changed');
        }
        if (await recordColl.countDocuments({ domainId, contest: contestId })) conflict('contest_has_records');
        if (await contestTeam.coll.countDocuments({ domainId, contestId, active: true })) conflict('contest_already_has_teams');
        for (const team of teams) {
            for (const uid of team.memberUids) {
                try {
                    await contestTeam.assertContestTeamRosterEligibility(domainId, latestContest, uid);
                } catch (error) {
                    snapshotMemberConflict(batchId, team, uid, 'contest-eligibility-recheck', error);
                }
            }
        }

        trace.stage = 'source-recheck';
        const currentBatch = await batchColl.findOne({
            domainId,
            batchId,
            status: 'closed',
            revision: batch.revision,
        });
        if (!currentBatch) conflict('batch_revision_mismatch');
        if (!batch.firstSnapshotAt && !batch.firstSnapshotContestId && !batch.firstSnapshotHash) {
            const marker = await batchColl.updateOne(
                {
                    domainId,
                    batchId,
                    status: 'closed',
                    revision: batch.revision,
                    firstSnapshotAt: { $exists: false },
                    firstSnapshotContestId: { $exists: false },
                    firstSnapshotHash: { $exists: false },
                },
                {
                    $set: {
                        firstSnapshotAt: snapshotAt,
                        firstSnapshotContestId: contestId,
                        firstSnapshotHash: hash,
                    },
                },
            );
            if (marker.modifiedCount !== 1) conflict('batch_snapshot_usage_marker_changed');
            usageMarkerClaimed = true;
        }

        trace.stage = 'activation';
        let activated;
        try {
            activated = await contestTeam.coll.updateMany(
                { domainId, contestId, snapshotId, active: false, snapshotState: 'preparing' },
                { $set: { active: true, snapshotState: 'active', updatedAt: snapshotAt } },
            );
        } catch (error) {
            duplicateConflict(error);
        }
        if (activated.modifiedCount !== docs.length) conflict('batch_snapshot_activation_incomplete');

        trace.stage = 'binding-cas';
        const stored = await document.coll.updateOne(
            {
                domainId,
                docType: document.TYPE_CONTEST,
                docId: contestId,
                rule: 'acm',
                participationMode: 'team',
                beginAt: latestContest.beginAt,
                $and: [
                    { $or: [{ teamBatchId: { $exists: false } }, { teamBatchId: null }] },
                    exactStoredField('participationRevision', latestContest.participationRevision),
                    exactStoredField('assign', latestContest.assign),
                    exactStoredField('participantScopeMode', latestContest.participantScopeMode),
                    exactStoredField('participantSchoolIds', latestContest.participantSchoolIds),
                    exactStoredField('participantGroupIds', latestContest.participantGroupIds),
                ],
            },
            {
                $set: {
                    teamBatchId: batchId,
                    teamBatchSnapshotHash: hash,
                    teamBatchSnapshotAt: snapshotAt,
                    teamBatchSnapshotCount: docs.length,
                },
            },
        );
        if (stored.modifiedCount !== 1) conflict('contest_batch_binding_changed');
        trace.stage = 'complete';
        await auditSuccess('snapshot', { ...auditBase, stage: trace.stage, toRevision: batch.revision });
        return {
            batchId,
            contestId,
            snapshotHash: hash,
            teamCount: docs.length,
            memberCount,
            snapshotAt,
            alreadyApplied: false,
        };
    } catch (error) {
        const failedStage = trace.stage;
        trace.stage = 'cleanup';
        try {
            await cleanupSnapshot(domainId, contestId, snapshotId, docs.length);
            if (usageMarkerClaimed) {
                const markerCleanup = await batchColl.updateOne(
                    {
                        domainId,
                        batchId,
                        status: 'closed',
                        revision: batch.revision,
                        firstSnapshotAt: snapshotAt,
                        firstSnapshotContestId: contestId,
                        firstSnapshotHash: hash,
                    },
                    {
                        $unset: {
                            firstSnapshotAt: '',
                            firstSnapshotContestId: '',
                            firstSnapshotHash: '',
                        },
                    },
                );
                if (markerCleanup.modifiedCount !== 1) conflict('batch_snapshot_usage_marker_cleanup_failed');
            }
        } catch (cleanupError) {
            await auditRejected('snapshot', { ...auditBase, stage: trace.stage }, cleanupError);
            throw cleanupError;
        }
        trace.stage = failedStage;
        await auditRejected('snapshot', { ...auditBase, stage: failedStage }, error);
        throw error;
    }
}

export async function snapshotToContest(
    domainId: string,
    contestId: ObjectId,
    batchId: ObjectId,
    actorUid: number,
): Promise<TeamBatchSnapshotResult> {
    const trace: SnapshotTrace = { stage: 'queued' };
    return await withContestTeamBoundary(domainId, contestId, async () => {
        try {
            return await withBatchMutation(domainId, batchId, () => snapshotToContestUnlocked(domainId, contestId, batchId, actorUid, trace));
        } catch (error) {
            if (error && typeof error === 'object') {
                Object.assign(error, {
                    snapshotStage: trace.stage,
                    snapshotContext: { domainId, contestId, batchId, actorUid },
                });
            }
            throw error;
        }
    });
}

export async function apply(ctx: Context) {
    await ctx.db.ensureIndexes(
        batchColl,
        {
            key: { domainId: 1, nameKey: 1 },
            name: 'contestTeamBatchOpenName',
            unique: true,
            partialFilterExpression: { status: 'open' },
        },
        { key: { domainId: 1, status: 1, updatedAt: -1, batchId: -1 }, name: 'contestTeamBatchList' },
    );
    await ctx.db.ensureIndexes(
        teamColl,
        {
            key: { domainId: 1, batchId: 1, nameKey: 1 },
            name: 'contestTeamBatchTeamNameActive',
            unique: true,
            partialFilterExpression: { active: true },
        },
        {
            key: { domainId: 1, batchId: 1, memberUids: 1 },
            name: 'contestTeamBatchMemberActive',
            unique: true,
            partialFilterExpression: { active: true },
        },
        { key: { domainId: 1, batchId: 1, active: 1, nameKey: 1 }, name: 'contestTeamBatchTeamList' },
    );
    await ctx.db.ensureIndexes(
        inviteColl,
        {
            key: { domainId: 1, batchId: 1, teamId: 1, inviteeUid: 1 },
            name: 'contestTeamBatchInvitePendingUnique',
            unique: true,
            partialFilterExpression: { status: 'pending' },
        },
        { key: { domainId: 1, batchId: 1, inviteeUid: 1, status: 1, createdAt: -1 }, name: 'contestTeamBatchInviteeList' },
        { key: { domainId: 1, batchId: 1, teamId: 1, status: 1 }, name: 'contestTeamBatchInviteTeamList' },
    );
    await ctx.db.ensureIndexes(
        contestTeam.coll,
        {
            key: { domainId: 1, contestId: 1, sourceBatchId: 1, sourceBatchTeamId: 1 },
            name: 'contestTeamBatchSnapshotSource',
            unique: true,
            partialFilterExpression: { active: true, snapshotState: 'active' },
        },
        { key: { domainId: 1, contestId: 1, snapshotId: 1 }, name: 'contestTeamBatchSnapshotPrepare' },
    );
    ctx.on('domain/delete', async (domainId) => {
        await Promise.all([batchColl.deleteMany({ domainId }), teamColl.deleteMany({ domainId }), inviteColl.deleteMany({ domainId })]);
    });
}

global.Hydro.model.contestTeamBatch = {
    batchColl,
    teamColl,
    inviteColl,
    canManageTeamBatches,
    assertTeamBatchMemberEligibility,
    createBatch,
    copyBatch,
    closeBatch,
    canReopenBatch,
    reopenBatch,
    createTeam,
    updateTeam,
    createInvite,
    acceptInvite,
    declineInvite,
    getBatch,
    getMultiBatch,
    getTeam,
    getTeamByMember,
    getMultiTeam,
    getPendingInvitesForUser,
    countBatchTeams,
    countBatchMembers,
    listClosedBatches,
    snapshotToContest,
};
