import { ObjectId, ProblemContributionConflictError } from 'hydrooj';
import type { ProblemContributionAction, ProblemContributionDoc, ProblemContributionScope, ProblemContributionStatus } from './types';
import { contributionsColl } from './db';
import { mongoAclRepository } from './repository';

const SCOPES = new Set<ProblemContributionScope>(['data', 'tag']);
const STATUSES = new Set<ProblemContributionStatus>(['pending', 'completed']);

function requireScope(scope: ProblemContributionScope): ProblemContributionScope {
    if (!SCOPES.has(scope)) throw new TypeError(`unknown problem contribution scope: ${scope}`);
    return scope;
}

function requireRequestId(requestId: string): string {
    const value = requestId?.trim();
    if (!value) throw new TypeError('problem contribution requestId is required');
    return value;
}

function requireActor(actor: number, field: string): number {
    if (!Number.isSafeInteger(actor) || actor <= 0) throw new TypeError(`${field} must be a positive integer`);
    return actor;
}

async function assertContributionAdminClaim(
    domainId: string,
    pid: number,
    actor: number,
    operation: 'contribution-assign' | 'contribution-revoke',
    writeClaimRequestId: string,
): Promise<void> {
    const claim = await mongoAclRepository.getProblemWriteClaim(domainId, pid);
    if (
        !claim ||
        claim.requestId !== writeClaimRequestId ||
        claim.actor !== actor ||
        claim.operation !== operation ||
        claim.capability !== 'contributions' ||
        claim.state !== 'active'
    ) {
        throw new Error(`problem contribution mutation requires an active ${operation} claim for ${domainId}/${pid}`);
    }
}

async function assertContributionStatusClaim(
    domainId: string,
    pid: number,
    actor: number,
    uid: number,
    scope: ProblemContributionScope,
    writeClaimRequestId: string,
): Promise<void> {
    const claim = await mongoAclRepository.getProblemWriteClaim(domainId, pid);
    const expectedCapability = actor === uid ? scope : 'contributions';
    if (
        !claim ||
        claim.requestId !== writeClaimRequestId ||
        claim.actor !== actor ||
        claim.operation !== 'contribution-status' ||
        claim.capability !== expectedCapability ||
        claim.state !== 'active'
    ) {
        throw new Error(`problem contribution status mutation requires an active ${expectedCapability} claim for ${domainId}/${pid}`);
    }
}

async function readIdentity(domainId: string, pid: number, uid: number, scope: ProblemContributionScope) {
    return contributionsColl.findOne({ domainId, pid, uid, scope });
}

function isSameActionReplay(current: ProblemContributionDoc, requestId: string, action: ProblemContributionAction): boolean {
    const matching = current.history.filter((entry) => entry.requestId === requestId);
    if (!matching.length) {
        if (current.lastRequestId === requestId) throw new ProblemContributionConflictError(current.pid);
        return false;
    }
    if (matching.some((entry) => entry.action !== action)) throw new ProblemContributionConflictError(current.pid);
    return true;
}

async function mutateExisting(
    current: ProblemContributionDoc,
    requestId: string,
    update: Record<string, unknown>,
    history: ProblemContributionDoc['history'][number],
): Promise<ProblemContributionDoc> {
    if (isSameActionReplay(current, requestId, history.action)) return current;
    const result = await contributionsColl.findOneAndUpdate(
        { _id: current._id, lastRequestId: current.lastRequestId },
        {
            $set: { ...update, lastRequestId: requestId },
            $push: { history },
        },
        { returnDocument: 'after' },
    );
    if (result) return result;
    const latest = await contributionsColl.findOne({ _id: current._id });
    if (latest && isSameActionReplay(latest, requestId, history.action)) return latest;
    throw new ProblemContributionConflictError(current.pid);
}

export async function assignContribution(input: {
    domainId: string;
    pid: number;
    uid: number;
    scope: ProblemContributionScope;
    actor: number;
    note?: string;
    requestId: string;
    writeClaimRequestId: string;
    now?: Date;
}): Promise<ProblemContributionDoc> {
    const scope = requireScope(input.scope);
    const actor = requireActor(input.actor, 'actor');
    const uid = requireActor(input.uid, 'uid');
    const requestId = requireRequestId(input.requestId);
    await assertContributionAdminClaim(input.domainId, input.pid, actor, 'contribution-assign', input.writeClaimRequestId);
    const now = input.now || new Date();
    const note = (input.note || '').trim();
    const current = await readIdentity(input.domainId, input.pid, uid, scope);
    const history = { action: 'assigned' as const, result: 'success' as const, actor, at: now, requestId, ...(note ? { note } : {}) };
    if (current) {
        return mutateExisting(
            current,
            requestId,
            {
                active: true,
                status: 'pending',
                note,
                assignedBy: actor,
                assignedAt: now,
                updatedBy: actor,
                updatedAt: now,
            },
            history,
        );
    }
    const created: ProblemContributionDoc = {
        _id: new ObjectId(),
        domainId: input.domainId,
        pid: input.pid,
        uid,
        scope,
        active: true,
        status: 'pending',
        note,
        assignedBy: actor,
        assignedAt: now,
        updatedBy: actor,
        updatedAt: now,
        lastRequestId: requestId,
        history: [history],
    };
    try {
        await contributionsColl.insertOne(created);
        return created;
    } catch (error: any) {
        if (error?.code !== 11000) throw error;
        const raced = await readIdentity(input.domainId, input.pid, uid, scope);
        if (!raced) throw error;
        return mutateExisting(
            raced,
            requestId,
            {
                active: true,
                status: 'pending',
                note,
                assignedBy: actor,
                assignedAt: now,
                updatedBy: actor,
                updatedAt: now,
            },
            history,
        );
    }
}

export async function revokeContribution(input: {
    domainId: string;
    pid: number;
    uid: number;
    scope: ProblemContributionScope;
    actor: number;
    requestId: string;
    writeClaimRequestId: string;
    now?: Date;
}): Promise<ProblemContributionDoc> {
    const scope = requireScope(input.scope);
    const actor = requireActor(input.actor, 'actor');
    const uid = requireActor(input.uid, 'uid');
    const requestId = requireRequestId(input.requestId);
    await assertContributionAdminClaim(input.domainId, input.pid, actor, 'contribution-revoke', input.writeClaimRequestId);
    const current = await readIdentity(input.domainId, input.pid, uid, scope);
    if (!current) throw new ProblemContributionConflictError(input.pid);
    const now = input.now || new Date();
    return mutateExisting(
        current,
        requestId,
        { active: false, updatedBy: actor, updatedAt: now },
        { action: 'revoked', result: 'success', actor, at: now, requestId },
    );
}

export async function setContributionStatus(input: {
    domainId: string;
    pid: number;
    uid: number;
    scope: ProblemContributionScope;
    status: ProblemContributionStatus;
    actor: number;
    requestId: string;
    writeClaimRequestId: string;
    now?: Date;
}): Promise<ProblemContributionDoc> {
    const scope = requireScope(input.scope);
    if (!STATUSES.has(input.status)) throw new TypeError(`unknown problem contribution status: ${input.status}`);
    const actor = requireActor(input.actor, 'actor');
    const uid = requireActor(input.uid, 'uid');
    const requestId = requireRequestId(input.requestId);
    await assertContributionStatusClaim(input.domainId, input.pid, actor, uid, scope, input.writeClaimRequestId);
    const current = await readIdentity(input.domainId, input.pid, uid, scope);
    if (!current || !current.active) throw new ProblemContributionConflictError(input.pid);
    const now = input.now || new Date();
    const completed = input.status === 'completed';
    return mutateExisting(
        current,
        requestId,
        {
            status: input.status,
            updatedBy: actor,
            updatedAt: now,
            ...(completed ? { lastCompletedAt: now, ...(current.firstCompletedAt ? {} : { firstCompletedAt: now }) } : {}),
        },
        { action: completed ? 'completed' : 'reopened', result: 'success', actor, at: now, requestId },
    );
}

export async function listContributionsForProblem(domainId: string, pid: number): Promise<ProblemContributionDoc[]> {
    return contributionsColl.find({ domainId, pid }).sort({ scope: 1, active: -1, status: 1, assignedAt: -1 }).toArray();
}

export async function listContributionsForUser(domainId: string, uid: number): Promise<ProblemContributionDoc[]> {
    if (!uid) return [];
    return contributionsColl.find({ domainId, uid }).sort({ status: 1, assignedAt: -1 }).toArray();
}

export async function loadActiveContributionPids(
    domainId: string,
    uid: number,
): Promise<{
    dataContributionPids: Set<number>;
    tagContributionPids: Set<number>;
}> {
    if (!uid) return { dataContributionPids: new Set(), tagContributionPids: new Set() };
    const rows = await contributionsColl.find({ domainId, uid, active: true }).project({ pid: 1, scope: 1 }).toArray();
    return {
        dataContributionPids: new Set(rows.filter((row) => row.scope === 'data').map((row) => row.pid)),
        tagContributionPids: new Set(rows.filter((row) => row.scope === 'tag').map((row) => row.pid)),
    };
}

export async function listCompletedDataContributorUids(domainId: string, pid: number): Promise<number[]> {
    const rows = await contributionsColl
        .find({ domainId, pid, scope: 'data', firstCompletedAt: { $exists: true } })
        .project({ uid: 1, firstCompletedAt: 1 })
        .sort({ firstCompletedAt: 1, uid: 1 })
        .toArray();
    return [...new Set(rows.map((row) => row.uid))];
}

export async function clearContributionsForProblem(domainId: string, pid: number): Promise<number> {
    const result = await contributionsColl.deleteMany({ domainId, pid });
    return result.deletedCount;
}
