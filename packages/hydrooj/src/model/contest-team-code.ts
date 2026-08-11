import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { Context } from '../context';
import { localizedErrorText, ContestTeamConflictError, PermissionError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { parseProblemConfigObject } from '../lib/problem-config';
import db from '../service/db';
import * as contest from './contest';
import * as contestTeam from './contest-team';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import ProblemModel, { type ProblemDoc } from './problem';
import * as setting from './setting';
import type { User } from './user';

export const MAX_TEAM_CODE_BYTES = 256 * 1024;
export const MAX_TEAM_CODE_SNAPSHOTS_PER_RECIPIENT = 50;

export interface TeamCodeSnapshotDoc {
    _id: ObjectId;
    domainId: string;
    contestId: ObjectId;
    teamId: ObjectId;
    teamRevision: number;
    targetUid: number;
    senderUid: number;
    problemId: number;
    pid: string;
    title: string;
    language: string;
    code: string;
    clientVersion: string;
    sequence: number;
    createdAt: Date;
    notifiedAt?: Date;
    openedAt?: Date;
}

export interface TeamCodeSnapshotCounterDoc {
    _id: string;
    sequence: number;
}

export interface CreateTeamCodeSnapshotsInput {
    problemId: number;
    targetUids: number[];
    language: string;
    code: string;
}

export interface TeamCodeSessionProof {
    clientVersion: string;
}

export type AssertTeamCodeSession = (team: contestTeam.ContestTeamDoc) => Promise<TeamCodeSessionProof>;

export type TeamCodeSnapshotState = 'pending' | 'saved' | 'opened';

export const coll = db.collection<TeamCodeSnapshotDoc>('contest.teamCodeSnapshots');
export const counterColl = db.collection<TeamCodeSnapshotCounterDoc>('contest.teamCodeSnapshotCounters');

function reject(reason: string): never {
    throw new ContestTeamConflictError(reason);
}

function contestIsActive(tdoc: Tdoc, now: Date): boolean {
    return now.getTime() >= tdoc.beginAt.getTime() && now.getTime() < tdoc.endAt.getTime();
}

function normalizeTargets(targetUids: number[]): number[] {
    if (!Array.isArray(targetUids)) throw new ValidationError('targetUids');
    const normalized = [...new Set(targetUids.map(Number))];
    if (normalized.length < 1 || normalized.length > 2 || normalized.some((uid) => !Number.isSafeInteger(uid) || uid <= 0)) {
        throw new ValidationError('targetUids', null, localizedErrorText`Select one or two current teammates.`);
    }
    return normalized.sort((left, right) => left - right);
}

export function teamCodeAuditMetadata(code: unknown): { codeLength: number; codeHash: string } {
    if (typeof code !== 'string') return { codeLength: 0, codeHash: '' };
    return {
        codeLength: Buffer.byteLength(code, 'utf8'),
        codeHash: createHash('sha256').update(code, 'utf8').digest('hex'),
    };
}

function validateProblemAndSource(
    tdoc: Tdoc,
    pdoc: ProblemDoc | null,
    problemId: number,
    languageInput: string,
    code: unknown,
): { pdoc: ProblemDoc; language: string; code: string } {
    if (!Number.isSafeInteger(problemId) || problemId <= 0 || !tdoc.pids?.includes(problemId) || !pdoc || pdoc.docId !== problemId) {
        throw new ValidationError('problemId', null, localizedErrorText`The problem is not part of this contest.`);
    }
    const language = String(languageInput || '').trim();
    const config = parseProblemConfigObject(pdoc);
    const configuredLanguages = Array.isArray(config?.langs) && config.langs.length ? config.langs : null;
    const contestLanguages = Array.isArray(tdoc.langs) && tdoc.langs.length ? tdoc.langs : null;
    const runtimeLanguage = setting.langs[language];
    if (
        !language ||
        language.length > 64 ||
        !runtimeLanguage ||
        runtimeLanguage.disabled ||
        (configuredLanguages && !configuredLanguages.includes(language)) ||
        (contestLanguages && !contestLanguages.includes(language))
    ) {
        throw new ValidationError('language', null, localizedErrorText`The selected language is not allowed for this problem.`);
    }
    if (typeof code !== 'string' || !code.length) throw new ValidationError('code', null, localizedErrorText`The current editor buffer is empty.`);
    if (Buffer.byteLength(code, 'utf8') > MAX_TEAM_CODE_BYTES) {
        throw new ValidationError('code', null, localizedErrorText`The current editor buffer exceeds ${MAX_TEAM_CODE_BYTES} bytes.`);
    }
    return { pdoc, language, code };
}

function validateTeamAuthority(
    tdoc: Tdoc,
    team: contestTeam.ContestTeamDoc | null,
    senderUid: number,
    targets: number[],
    now: Date,
): contestTeam.ContestTeamDoc {
    if (contest.getParticipationMode(tdoc) !== 'team' || tdoc.rule !== 'acm') reject('team_acm_required');
    if (!contestIsActive(tdoc, now)) reject('contest_not_active');
    if (!team?.active || team.captainUid !== senderUid || !team.memberUids.includes(senderUid)) {
        throw new PermissionError('team_captain');
    }
    if (targets.includes(senderUid) || targets.some((uid) => !team.memberUids.includes(uid) || uid === team.captainUid)) {
        throw new ValidationError('targetUids', null, localizedErrorText`Every target must be a current non-captain teammate.`);
    }
    return team;
}

async function nextSequence(domainId: string, contestId: ObjectId, teamId: ObjectId): Promise<number> {
    const key = `${domainId}:${contestId.toHexString()}:${teamId.toHexString()}`;
    const updated = await counterColl.findOneAndUpdate({ _id: key }, { $inc: { sequence: 1 } }, { upsert: true, returnDocument: 'after' });
    if (!updated || !Number.isSafeInteger(updated.sequence) || updated.sequence <= 0) {
        throw new Error(`Failed to allocate team code sequence for ${domainId}/${contestId}/${teamId}.`);
    }
    return updated.sequence;
}

async function trimRecipient(domainId: string, contestId: ObjectId, teamId: ObjectId, targetUid: number): Promise<void> {
    const overflow = await coll
        .find({ domainId, contestId, teamId, targetUid })
        .sort({ createdAt: -1, _id: -1 })
        .skip(MAX_TEAM_CODE_SNAPSHOTS_PER_RECIPIENT)
        .project({ _id: 1 })
        .toArray();
    if (overflow.length) await coll.deleteMany({ _id: { $in: overflow.map((doc) => doc._id) } });
}

function sameTeamRevision(left: contestTeam.ContestTeamDoc, right: contestTeam.ContestTeamDoc | null): boolean {
    return (
        !!right?.active &&
        left.teamId.equals(right.teamId) &&
        left.revision === right.revision &&
        left.captainUid === right.captainUid &&
        left.memberUids.length === right.memberUids.length &&
        left.memberUids.every((uid) => right.memberUids.includes(uid))
    );
}

/**
 * Persist the captain's current editor buffer once per selected recipient.
 * Validation is completed for every target before allocation/insertion. A
 * post-insert roster/config check removes the just-created rows if authority
 * changed concurrently, keeping a stale captain or target from retaining a
 * readable snapshot.
 */
export async function createSnapshots(
    domainId: string,
    contestId: ObjectId,
    sender: User,
    input: CreateTeamCodeSnapshotsInput,
    assertSession: AssertTeamCodeSession,
    now = new Date(),
): Promise<TeamCodeSnapshotDoc[]> {
    const targets = normalizeTargets(input?.targetUids);
    const [tdoc, team, pdoc] = await Promise.all([
        contest.get(domainId, contestId),
        contestTeam.getTeamByMember(domainId, contestId, sender._id),
        ProblemModel.get(domainId, input?.problemId, ['domainId', 'docId', 'pid', 'title', 'config']),
    ]);
    const authoritativeTeam = validateTeamAuthority(tdoc, team, sender._id, targets, now);
    const source = validateProblemAndSource(tdoc, pdoc, input?.problemId, input?.language, input?.code);
    const session = await assertSession(authoritativeTeam);
    const clientVersion = String(session?.clientVersion || '').trim();
    if (!clientVersion || clientVersion.length > 64) throw new ValidationError('clientVersion');

    const sequence = await nextSequence(domainId, contestId, authoritativeTeam.teamId);
    const docs = targets.map<TeamCodeSnapshotDoc>((targetUid) => ({
        _id: new ObjectId(),
        domainId,
        contestId,
        teamId: authoritativeTeam.teamId,
        teamRevision: authoritativeTeam.revision,
        targetUid,
        senderUid: sender._id,
        problemId: source.pdoc.docId,
        pid: source.pdoc.pid || String(source.pdoc.docId),
        title: source.pdoc.title,
        language: source.language,
        code: source.code,
        clientVersion,
        sequence,
        createdAt: now,
    }));
    await coll.insertMany(docs);

    try {
        const [currentContest, currentTeam, currentProblem] = await Promise.all([
            contest.get(domainId, contestId),
            contestTeam.getTeam(domainId, contestId, authoritativeTeam.teamId),
            ProblemModel.get(domainId, input.problemId, ['domainId', 'docId', 'pid', 'title', 'config']),
        ]);
        if (!sameTeamRevision(authoritativeTeam, currentTeam)) reject('team_revision_changed');
        validateTeamAuthority(currentContest, currentTeam, sender._id, targets, new Date());
        validateProblemAndSource(currentContest, currentProblem, input.problemId, input.language, input.code);
    } catch (error) {
        await coll.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } });
        throw error;
    }

    await Promise.all(targets.map((targetUid) => trimRecipient(domainId, contestId, authoritativeTeam.teamId, targetUid)));
    return docs;
}

function assertSnapshotAccess(snapshot: TeamCodeSnapshotDoc, team: contestTeam.ContestTeamDoc | null, viewer: User, admin: boolean): void {
    if (admin) return;
    if (!team?.active || !team.teamId.equals(snapshot.teamId) || !team.memberUids.includes(viewer._id)) {
        throw new PermissionError('team_code_snapshot');
    }
    if (viewer._id !== snapshot.senderUid && viewer._id !== snapshot.targetUid) throw new PermissionError('team_code_snapshot');
}

export async function getAccessible(domainId: string, contestId: ObjectId, snapshotId: ObjectId, viewer: User): Promise<TeamCodeSnapshotDoc | null> {
    const [tdoc, snapshot] = await Promise.all([contest.get(domainId, contestId), coll.findOne({ _id: snapshotId, domainId, contestId })]);
    if (!snapshot) return null;
    const admin = contestTeam.canManageContestTeams(viewer, tdoc);
    const team = admin ? null : await contestTeam.getTeamByMember(domainId, contestId, viewer._id);
    assertSnapshotAccess(snapshot, team, viewer, admin);
    return snapshot;
}

export async function openAccessible(
    domainId: string,
    contestId: ObjectId,
    snapshotId: ObjectId,
    viewer: User,
    now = new Date(),
): Promise<TeamCodeSnapshotDoc | null> {
    const snapshot = await getAccessible(domainId, contestId, snapshotId, viewer);
    if (!snapshot || viewer._id !== snapshot.targetUid || snapshot.openedAt) return snapshot;
    return (
        (await coll.findOneAndUpdate(
            { _id: snapshot._id, domainId, contestId, targetUid: viewer._id, openedAt: { $exists: false } },
            { $set: { openedAt: now } },
            { returnDocument: 'after' },
        )) || (await getAccessible(domainId, contestId, snapshotId, viewer))
    );
}

export async function listAccessible(
    domainId: string,
    contestId: ObjectId,
    viewer: User,
    limit = MAX_TEAM_CODE_SNAPSHOTS_PER_RECIPIENT,
    admin = false,
): Promise<TeamCodeSnapshotDoc[]> {
    const team = admin ? null : await contestTeam.getTeamByMember(domainId, contestId, viewer._id);
    if (!admin && !team?.active) throw new PermissionError('team_code_snapshot');
    return await coll
        .find({
            domainId,
            contestId,
            ...(admin ? {} : { teamId: team!.teamId, $or: [{ senderUid: viewer._id }, { targetUid: viewer._id }] }),
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(Math.max(1, Math.min(MAX_TEAM_CODE_SNAPSHOTS_PER_RECIPIENT, limit)))
        .toArray();
}

export async function markNotified(snapshotId: ObjectId, targetUid: number, now = new Date()): Promise<boolean> {
    const result = await coll.updateOne({ _id: snapshotId, targetUid }, { $set: { notifiedAt: now } });
    return result.modifiedCount === 1;
}

export function snapshotState(snapshot: Pick<TeamCodeSnapshotDoc, 'openedAt' | 'notifiedAt'>): TeamCodeSnapshotState {
    if (snapshot.openedAt) return 'opened';
    if (snapshot.notifiedAt) return 'saved';
    return 'pending';
}

export async function apply(ctx: Context) {
    await ctx.db.ensureIndexes(
        coll,
        {
            key: { domainId: 1, contestId: 1, targetUid: 1, createdAt: -1, _id: -1 },
            name: 'contestTeamCodeRecipientList',
        },
        {
            key: { domainId: 1, contestId: 1, senderUid: 1, createdAt: -1, _id: -1 },
            name: 'contestTeamCodeSenderList',
        },
        {
            key: { domainId: 1, contestId: 1, teamId: 1, targetUid: 1, sequence: 1 },
            name: 'contestTeamCodeRecipientSequence',
            unique: true,
        },
    );
    ctx.on('domain/delete', async (domainId) => {
        await settleDomainCleanupOperations(domainId, [
            () => coll.deleteMany({ domainId }),
            () => counterColl.deleteMany({ _id: { $regex: `^${domainId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:` } }),
        ]);
    });
    ctx.on('contest/del', async (domainId, contestId) => {
        await Promise.all([
            coll.deleteMany({ domainId, contestId }),
            counterColl.deleteMany({ _id: { $regex: `^${domainId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${contestId.toHexString()}:` } }),
        ]);
    });
}

global.Hydro.model.contestTeamCode = {
    MAX_TEAM_CODE_BYTES,
    MAX_TEAM_CODE_SNAPSHOTS_PER_RECIPIENT,
    coll,
    counterColl,
    teamCodeAuditMetadata,
    createSnapshots,
    getAccessible,
    openAccessible,
    listAccessible,
    markNotified,
    snapshotState,
};
