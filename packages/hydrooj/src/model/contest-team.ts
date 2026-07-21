import { ObjectId, type Filter } from 'mongodb';
import type { Context } from '../context';
import { ContestTeamConflictError, NotAssignedError, PermissionError, UserNotFoundError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import bus from '../service/bus';
import db from '../service/db';
import { PERM, PRIV } from './builtin';
import * as contest from './contest';
import * as oplog from './oplog';
import UserModel, { type User } from './user';

export type ContestTeamManagementMode = 'self' | 'admin';

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
}

export interface ContestTeamActor {
    user: User;
    now?: Date;
    emergencyConfirmation?: string;
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
    active?: boolean;
}

export const coll = db.collection<ContestTeamDoc>('contest.teams');

function teamConflict(reason: string): never {
    throw new ContestTeamConflictError(reason);
}

function normalizeText(value: unknown): string {
    const normalized = String(value ?? '').normalize('NFKC');
    if (/\p{Cc}/u.test(normalized)) throw new ValidationError('teamText', null, 'Control characters are not allowed.');
    return normalized.replace(/\s+/g, ' ').trim();
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

function isContestManager(actor: User, tdoc: Tdoc): boolean {
    return actor.own(tdoc, PERM.PERM_EDIT_CONTEST_SELF) || actor.hasPerm(PERM.PERM_EDIT_CONTEST) || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

function started(tdoc: Tdoc, now: Date): boolean {
    return now.getTime() >= tdoc.beginAt.getTime();
}

async function assertTeamContest(domainId: string, contestId: ObjectId): Promise<Tdoc> {
    const tdoc = await contest.get(domainId, contestId);
    if (contest.getParticipationMode(tdoc) !== 'team' || tdoc.rule !== 'acm') {
        throw new ValidationError('participationMode', null, 'Teams are only available for team-mode ACM contests.');
    }
    return tdoc;
}

export async function assertContestTeamEligibility(domainId: string, tdoc: Tdoc, uid: number): Promise<void> {
    const udoc = await UserModel.getById(domainId, uid);
    if (!udoc || !udoc._id) throw new UserNotFoundError(uid);

    if (tdoc.assign?.length) {
        const groups = await UserModel.listGroup(domainId, uid);
        if (!tdoc.assign.some((name) => groups.some((group) => group.name === name))) throw new NotAssignedError('contest', tdoc.docId);
    }
    if (tdoc._code) {
        const tsdoc = await contest.getStatus(domainId, tdoc.docId, uid);
        if (!tsdoc?.attend) throw new NotAssignedError('contest', tdoc.docId);
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
    await audit({ ...data, toRevision: revisionOf(result), result: 'success' });
    return result;
}

export async function createTeam(
    domainId: string,
    contestId: ObjectId,
    actor: ContestTeamActor,
    input: ContestTeamCreateInput,
): Promise<ContestTeamDoc> {
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
    return await auditedMutation(
        auditData,
        async () => {
            const now = actor.now || new Date();
            const tdoc = await assertTeamContest(domainId, contestId);
            const admin = isContestManager(actor.user, tdoc);
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
}

async function loadActiveTeam(domainId: string, contestId: ObjectId, teamId: ObjectId): Promise<ContestTeamDoc> {
    const team = await coll.findOne({ domainId, contestId, teamId, active: true });
    if (!team) teamConflict('not_found_or_inactive');
    return team;
}

function authorizeMutation(
    tdoc: Tdoc,
    team: ContestTeamDoc,
    actor: ContestTeamActor,
    changesRoster: boolean,
): { admin: boolean; emergency: boolean } {
    const now = actor.now || new Date();
    const admin = isContestManager(actor.user, tdoc);
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
    const auditData: TeamAuditData = {
        operation: 'update',
        domainId,
        contestId,
        teamId,
        actorUid: actor.user._id,
        targetUids: Array.isArray(input?.memberUids) ? input.memberUids.filter((uid) => Number.isSafeInteger(uid)) : [],
        fromRevision: Number.isSafeInteger(input?.expectedRevision) ? input.expectedRevision : 0,
    };
    const outcome = await auditedMutation(
        auditData,
        async () => {
            const tdoc = await assertTeamContest(domainId, contestId);
            const current = await loadActiveTeam(domainId, contestId, teamId);
            auditData.fromRevision = current.revision;
            auditData.targetUids = [...current.memberUids];
            if (current.revision !== input.expectedRevision) teamConflict('revision_mismatch');
            const changesRoster = input.memberUids !== undefined || input.captainUid !== undefined || input.active === false;
            if (started(tdoc, actor.now || new Date())) auditData.operation = 'emergency-update';
            const { admin, emergency } = authorizeMutation(tdoc, current, actor, changesRoster);

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
            if (input.active !== undefined) patch.active = input.active;
            if (emergency && (input.name !== undefined || input.description !== undefined || input.active !== undefined)) {
                teamConflict('contest_started');
            }
            if (patch.active === false && current.managementMode === 'admin' && !admin) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
            if (patch.active === false && emergency && !admin) throw new PermissionError(PERM.PERM_EDIT_CONTEST);
            const roleChanged = current.captainUid !== captainUid || current.memberUids.join(',') !== memberUids.join(',');
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
    if (outcome.roleChanged) {
        await bus.parallel('contest/team-role-change', {
            before: outcome.before,
            after: outcome.updated,
            actorUid: actor.user._id,
            emergency: outcome.emergency,
        });
    }
    return outcome.updated;
}

export async function getTeam(domainId: string, contestId: ObjectId, teamId: ObjectId): Promise<ContestTeamDoc | null> {
    return await coll.findOne({ domainId, contestId, teamId, active: true });
}

export async function getTeamByMember(domainId: string, contestId: ObjectId, uid: number): Promise<ContestTeamDoc | null> {
    return await coll.findOne({ domainId, contestId, memberUids: uid, active: true });
}

export function getMultiTeam(domainId: string, contestId: ObjectId, query: Filter<ContestTeamDoc> = {}) {
    return coll.find({ ...query, domainId, contestId, active: true }).sort({ nameKey: 1, teamId: 1 });
}

export async function countActiveTeams(domainId: string, contestId: ObjectId): Promise<number> {
    return await coll.countDocuments({ domainId, contestId, active: true });
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
    ctx.on('domain/delete', (domainId) => coll.deleteMany({ domainId }));
    ctx.on('contest/del', (domainId, contestId) =>
        coll.updateMany(
            { domainId, contestId, active: true },
            {
                $set: { active: false, deactivatedAt: new Date(), deactivationReason: 'team_closed', updatedAt: new Date() },
                $inc: { revision: 1 },
            },
        ),
    );
}

global.Hydro.model.contestTeam = {
    coll,
    normalizeTeamName,
    normalizeTeamDescription,
    normalizeMemberUids,
    validateTeamShape,
    createTeam,
    updateTeam,
    getTeam,
    getTeamByMember,
    getMultiTeam,
    countActiveTeams,
    assertContestTeamEligibility,
    emergencyTeamConfirmation,
};
