import { Collection, Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { Context } from '../context';
import { effectiveProblemKind } from '@hydrooj/common';
import { localizedErrorText, ForbiddenError, NotFoundError, ValidationError } from '../error';
import type { RecordDoc, Tdoc } from '../interface';
import {
    buildVirtualContestSnapshot,
    evaluateVirtualContestEligibility,
    isVirtualAttemptOpen,
    isVirtualContestScoreFrozen,
    officialAttemptBlocksNewStart,
    ridCreatedDuringVirtualAttempt,
    syntheticVirtualContestDoc,
    virtualAttemptWindow,
    type VirtualContestAttemptStatus,
    type VirtualContestSnapshot,
} from '../lib/virtual-contest';
import db from '../service/db';
import { PERM, PRIV } from './builtin';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import problem from './problem';

const logger = new Logger('virtual-contest');

export interface VirtualContestJournalEntry {
    rid: ObjectId;
    pid: number;
    status: number;
    score: number;
    subtasks?: RecordDoc['subtasks'];
    lang?: string;
}

export interface VirtualContestAttemptDoc {
    _id: ObjectId;
    domainId: string;
    sourceContestId: ObjectId;
    uid: number;
    status: VirtualContestAttemptStatus;
    startAt: Date;
    endAt: Date;
    endedAt: Date | null;
    cancelledAt: Date | null;
    voidedAt: Date | null;
    firstRecordAt: Date | null;
    snapshot: VirtualContestSnapshot;
    journal: VirtualContestJournalEntry[];
    accept?: number;
    time?: number;
    score?: number;
    penaltyScore?: number;
    detail?: Record<string, unknown>;
    display?: Record<string, unknown>;
    rev: number;
    createdAt: Date;
}

export interface VirtualContestActor {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

type AttemptCollection = Pick<
    Collection<VirtualContestAttemptDoc>,
    'createIndex' | 'find' | 'findOne' | 'insertOne' | 'updateOne' | 'findOneAndUpdate' | 'deleteMany'
>;

export interface VirtualContestServiceOptions {
    attempts: AttemptCollection;
    now?: () => Date;
    idFactory?: () => ObjectId;
    loadContest?: (domainId: string, tid: ObjectId) => Promise<Tdoc>;
    loadProblems?: (domainId: string, pids: number[]) => Promise<Array<{ docId: number; problemKind?: string; config?: unknown }>>;
    scoreAttempt?: (tdoc: Tdoc, journal: VirtualContestJournalEntry[]) => Record<string, unknown>;
}

function journalOf(attempt: VirtualContestAttemptDoc): VirtualContestJournalEntry[] {
    return [...(attempt.journal || [])].sort((left, right) => left.rid.getTimestamp().getTime() - right.rid.getTimestamp().getTime());
}

async function defaultLoadContest(domainId: string, tid: ObjectId): Promise<Tdoc> {
    const contest = global.Hydro?.model?.contest;
    if (typeof contest?.get !== 'function') throw new TypeError('contest.get is unavailable');
    return contest.get(domainId, tid);
}

function defaultScoreAttempt(tdoc: Tdoc, journal: VirtualContestJournalEntry[]): Record<string, unknown> {
    const contest = global.Hydro?.model?.contest;
    const rule = contest?.RULES?.[tdoc.rule];
    if (typeof rule?.stat !== 'function') throw new TypeError(`virtual contest rule ${tdoc.rule} has no stat`);
    return rule.stat(tdoc, journal);
}

export function canManageVirtualContest(user: VirtualContestActor, tdoc: Pick<Tdoc, 'owner'>): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (user.hasPerm(PERM.PERM_EDIT_CONTEST)) return true;
    return user.own(tdoc);
}

export class VirtualContestService {
    private readonly attempts: AttemptCollection;
    private readonly now: () => Date;
    private readonly idFactory: () => ObjectId;
    private readonly loadContest: (domainId: string, tid: ObjectId) => Promise<Tdoc>;
    private readonly loadProblems: (domainId: string, pids: number[]) => Promise<Array<{ docId: number; problemKind?: string; config?: unknown }>>;
    private readonly scoreAttempt: (tdoc: Tdoc, journal: VirtualContestJournalEntry[]) => Record<string, unknown>;
    private indexesPromise?: Promise<void>;

    constructor(options: VirtualContestServiceOptions) {
        this.attempts = options.attempts;
        this.now = options.now || (() => new Date());
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.loadContest = options.loadContest || defaultLoadContest;
        this.loadProblems =
            options.loadProblems ||
            (async (domainId, pids) => {
                const dict = await problem.getList(domainId, pids, true, false, ['docId', 'problemKind', 'config'], true);
                return Object.values(dict || {});
            });
        this.scoreAttempt = options.scoreAttempt || defaultScoreAttempt;
    }

    async ensureIndexes(): Promise<void> {
        if (!this.indexesPromise) {
            this.indexesPromise = Promise.all([
                this.attempts.createIndex(
                    { domainId: 1, sourceContestId: 1, uid: 1 },
                    {
                        name: 'virtualAttemptActiveIdentity',
                        unique: true,
                        partialFilterExpression: { status: 'active' },
                    },
                ),
                this.attempts.createIndex({ domainId: 1, sourceContestId: 1, status: 1, endAt: 1 }, { name: 'virtualAttemptBoard' }),
                this.attempts.createIndex({ domainId: 1, uid: 1, createdAt: -1 }, { name: 'virtualAttemptUser' }),
            ])
                .then(() => undefined)
                .catch((error) => {
                    this.indexesPromise = undefined;
                    logger.error('Virtual contest index verification failed error=%o', error);
                    throw error;
                });
        }
        await this.indexesPromise;
    }

    async inspectEligibility(domainId: string, sourceContestId: ObjectId, now = this.now(), attended = false) {
        const tdoc = await this.loadContest(domainId, sourceContestId);
        const problems = await this.loadProblems(domainId, tdoc.pids || []);
        const loaded = new Set(problems.map((pdoc) => pdoc.docId));
        const missingProblems = (tdoc.pids || []).some((pid) => !loaded.has(pid));
        const hasSubjective = problems.some((pdoc) => effectiveProblemKind(pdoc) === 'subjective');
        const eligibility = evaluateVirtualContestEligibility(tdoc, {
            now,
            hasSubjective,
            hasManualGrade: hasSubjective,
            missingProblems,
            attended,
        });
        return { tdoc, eligibility, problems };
    }

    async getAttempt(domainId: string, attemptId: ObjectId): Promise<VirtualContestAttemptDoc> {
        return this.settle(await this.loadAttempt(domainId, attemptId));
    }

    async getOfficialAttempt(domainId: string, sourceContestId: ObjectId, uid: number): Promise<VirtualContestAttemptDoc | null> {
        await this.ensureIndexes();
        const rows = await this.attempts.find({ domainId, sourceContestId, uid } as Filter<VirtualContestAttemptDoc>).toArray();
        const official = rows.find((row) => officialAttemptBlocksNewStart(row.status));
        return official ? this.settle(official) : null;
    }

    async listByContest(domainId: string, sourceContestId: ObjectId): Promise<VirtualContestAttemptDoc[]> {
        await this.ensureIndexes();
        const rows = await this.attempts.find({ domainId, sourceContestId } as Filter<VirtualContestAttemptDoc>).toArray();
        rows.sort((left, right) => {
            const created = left.createdAt.getTime() - right.createdAt.getTime();
            if (created !== 0) return created;
            return left._id.toHexString().localeCompare(right._id.toHexString());
        });
        return Promise.all(rows.map((row) => this.settle(row)));
    }

    async start(input: { domainId: string; sourceContestId: ObjectId; uid: number; attended?: boolean }): Promise<VirtualContestAttemptDoc> {
        await this.ensureIndexes();
        const now = this.now();
        const { tdoc, eligibility } = await this.inspectEligibility(input.domainId, input.sourceContestId, now, input.attended === true);
        if (!eligibility.allowed) {
            logger.warn(
                'Virtual contest start rejected domain=%s contest=%s uid=%d reason=%s stage=start result=rejected',
                input.domainId,
                input.sourceContestId,
                input.uid,
                eligibility.reason || 'unknown',
            );
            throw new ValidationError('tid', null, localizedErrorText`该比赛不支持虚拟参赛`);
        }
        const existing = await this.getOfficialAttempt(input.domainId, input.sourceContestId, input.uid);
        if (existing) throw new ValidationError('tid', null, localizedErrorText`每人每场只能有一次正式虚拟参赛`);
        const snapshot = buildVirtualContestSnapshot(tdoc);
        const window = virtualAttemptWindow(now, snapshot.durationMs);
        const attempt: VirtualContestAttemptDoc = {
            _id: this.idFactory(),
            domainId: input.domainId,
            sourceContestId: input.sourceContestId,
            uid: input.uid,
            status: 'active',
            startAt: window.startAt,
            endAt: window.endAt,
            endedAt: null,
            cancelledAt: null,
            voidedAt: null,
            firstRecordAt: null,
            snapshot,
            journal: [],
            rev: 1,
            createdAt: now,
        };
        try {
            await this.attempts.insertOne(attempt);
        } catch (error) {
            const confirmed = await this.getOfficialAttempt(input.domainId, input.sourceContestId, input.uid);
            if (confirmed) throw new ValidationError('tid', null, localizedErrorText`每人每场只能有一次正式虚拟参赛`);
            throw error;
        }
        logger.info(
            'Virtual contest started domain=%s contest=%s uid=%d attempt=%s durationMs=%d stage=start result=success',
            input.domainId,
            input.sourceContestId,
            input.uid,
            attempt._id,
            snapshot.durationMs,
        );
        return attempt;
    }

    async cancel(input: { domainId: string; attemptId: ObjectId; uid: number }): Promise<VirtualContestAttemptDoc> {
        const current = await this.getAttempt(input.domainId, input.attemptId);
        if (current.uid !== input.uid) throw new ForbiddenError(localizedErrorText`没有虚拟参赛管理权限`);
        if (current.status !== 'active') throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛已结束`);
        if (current.firstRecordAt) throw new ValidationError('attempt', null, localizedErrorText`已有提交后不能取消虚拟参赛`);
        const result = await this.attempts.findOneAndUpdate(
            { _id: current._id, status: 'active', firstRecordAt: null, rev: current.rev },
            { $set: { status: 'cancelled', cancelledAt: this.now(), rev: current.rev + 1 } },
            { returnDocument: 'after' },
        );
        if (!result) throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛状态已变化`);
        logger.info(
            'Virtual contest cancelled domain=%s contest=%s uid=%d attempt=%s stage=cancel result=success',
            current.domainId,
            current.sourceContestId,
            current.uid,
            current._id,
        );
        return result;
    }

    async end(input: { domainId: string; attemptId: ObjectId; actor: VirtualContestActor; uid?: number }): Promise<VirtualContestAttemptDoc> {
        const current = await this.getAttempt(input.domainId, input.attemptId);
        if (current.status !== 'active') return current;
        const isSelf = input.uid != null && current.uid === input.uid;
        if (!isSelf) {
            const tdoc = await this.loadContest(current.domainId, current.sourceContestId);
            if (!canManageVirtualContest(input.actor, tdoc)) throw new ForbiddenError(localizedErrorText`没有虚拟参赛管理权限`);
        }
        return this.transitionEnded(current);
    }

    async voidAttempt(input: {
        domainId: string;
        attemptId: ObjectId;
        actor: VirtualContestActor;
        confirmation: string;
    }): Promise<VirtualContestAttemptDoc> {
        const current = await this.getAttempt(input.domainId, input.attemptId);
        const tdoc = await this.loadContest(current.domainId, current.sourceContestId);
        if (!canManageVirtualContest(input.actor, tdoc)) throw new ForbiddenError(localizedErrorText`没有虚拟参赛管理权限`);
        const expected = `VOID-VP:${current._id.toHexString()}:${current.rev}`;
        if (input.confirmation !== expected) throw new ValidationError('confirmation', null, localizedErrorText`确认后才能重新开放虚拟参赛资格`);
        if (current.status === 'voided') return current;
        const result = await this.attempts.findOneAndUpdate(
            { _id: current._id, rev: current.rev, status: { $in: ['active', 'ended'] } },
            { $set: { status: 'voided', voidedAt: this.now(), endedAt: current.endedAt || this.now(), rev: current.rev + 1 } },
            { returnDocument: 'after' },
        );
        if (!result) throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛状态已变化`);
        logger.info(
            'Virtual contest voided domain=%s contest=%s uid=%d attempt=%s actor=%d stage=void result=success',
            current.domainId,
            current.sourceContestId,
            current.uid,
            current._id,
            input.actor._id,
        );
        return result;
    }

    async markFirstRecord(input: { domainId: string; attemptId: ObjectId; uid: number; pid: number }): Promise<VirtualContestAttemptDoc> {
        for (let attempt = 0; attempt < 8; attempt++) {
            const current = await this.assertActiveForUser(input.domainId, input.attemptId, input.uid, input.pid);
            if (current.firstRecordAt) return current;
            const result = await this.attempts.findOneAndUpdate(
                { _id: current._id, status: 'active', firstRecordAt: null, rev: current.rev },
                { $set: { firstRecordAt: this.now(), rev: current.rev + 1 } },
                { returnDocument: 'after' },
            );
            if (result) return result;
        }
        const confirmed = await this.getAttempt(input.domainId, input.attemptId);
        if (confirmed.firstRecordAt) return confirmed;
        throw new Error(`virtual contest first-record CAS failed: ${input.domainId}/${input.attemptId}`);
    }

    async assertActiveForUser(domainId: string, attemptId: ObjectId, uid: number, pid?: number): Promise<VirtualContestAttemptDoc> {
        const current = await this.getAttempt(domainId, attemptId);
        if (current.uid !== uid) throw new ForbiddenError(localizedErrorText`没有虚拟参赛管理权限`);
        if (!isVirtualAttemptOpen(current, this.now())) throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛已结束`);
        if (pid != null && !current.snapshot.pids.includes(pid)) {
            throw new ValidationError('pid', null, localizedErrorText`题目不属于该虚拟参赛快照`);
        }
        return current;
    }

    async updateStatus(input: {
        domainId: string;
        attemptId: ObjectId;
        uid: number;
        rid: ObjectId;
        pid: number;
        result: Partial<RecordDoc>;
    }): Promise<VirtualContestAttemptDoc> {
        for (let attempt = 0; attempt < 8; attempt++) {
            const current = await this.loadAttempt(input.domainId, input.attemptId);
            if (current.uid !== input.uid) throw new ForbiddenError(localizedErrorText`没有虚拟参赛管理权限`);
            if (current.status === 'cancelled' || current.status === 'voided') {
                throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛已结束`);
            }
            if (!current.snapshot.pids.includes(input.pid)) {
                throw new ValidationError('pid', null, localizedErrorText`题目不属于该虚拟参赛快照`);
            }
            const alreadyInJournal = journalOf(current).some((entry) => String(entry.rid) === String(input.rid));
            const inWindow = ridCreatedDuringVirtualAttempt(input.rid, current);
            if (!alreadyInJournal && !inWindow) {
                throw new ValidationError('attempt', null, localizedErrorText`虚拟参赛已结束`);
            }
            const now = this.now();
            const shouldEnd = current.status === 'active' && now.getTime() >= current.endAt.getTime();
            const journal = journalOf(current).filter((entry) => String(entry.rid) !== String(input.rid));
            journal.push({
                rid: input.rid,
                pid: input.pid,
                status: input.result.status || 0,
                score: input.result.score || 0,
                subtasks: input.result.subtasks,
                lang: input.result.lang,
            });
            const synthetic = syntheticVirtualContestDoc({
                domainId: current.domainId,
                sourceContestId: current.sourceContestId,
                snapshot: current.snapshot,
                startAt: current.startAt,
                endAt: current.endAt,
                unlocked: current.status === 'ended' || shouldEnd || !isVirtualContestScoreFrozen(current, now),
            });
            const stats = this.scoreAttempt(synthetic, journal);
            const result = await this.attempts.findOneAndUpdate(
                { _id: current._id, rev: current.rev, status: current.status },
                {
                    $set: {
                        journal,
                        ...stats,
                        firstRecordAt: current.firstRecordAt || now,
                        rev: current.rev + 1,
                        ...(shouldEnd ? { status: 'ended' as const, endedAt: now } : {}),
                    },
                },
                { returnDocument: 'after' },
            );
            if (result) {
                logger.info(
                    'Virtual contest status updated domain=%s contest=%s uid=%d attempt=%s rid=%s pid=%d ended=%s stage=status result=success',
                    current.domainId,
                    current.sourceContestId,
                    current.uid,
                    current._id,
                    input.rid,
                    input.pid,
                    shouldEnd,
                );
                return result;
            }
        }
        throw new Error(`virtual contest status CAS failed: ${input.domainId}/${input.attemptId}`);
    }

    boardAttempts(attempts: VirtualContestAttemptDoc[], opts: { includeActive: boolean; onlyUid?: number }): VirtualContestAttemptDoc[] {
        return attempts.filter((attempt) => {
            if (attempt.status === 'cancelled' || attempt.status === 'voided') return false;
            if (attempt.status === 'active') return opts.includeActive && (opts.onlyUid == null || attempt.uid === opts.onlyUid);
            return true;
        });
    }

    private async loadAttempt(domainId: string, attemptId: ObjectId): Promise<VirtualContestAttemptDoc> {
        await this.ensureIndexes();
        const current = await this.attempts.findOne({ _id: attemptId, domainId });
        if (!current) throw new NotFoundError(localizedErrorText`虚拟参赛`);
        return current;
    }

    private async settle(attempt: VirtualContestAttemptDoc): Promise<VirtualContestAttemptDoc> {
        if (attempt.status !== 'active') return attempt;
        if (this.now().getTime() < attempt.endAt.getTime()) return attempt;
        return this.transitionEnded(attempt);
    }

    private async transitionEnded(current: VirtualContestAttemptDoc, depth = 0): Promise<VirtualContestAttemptDoc> {
        const endedAt = this.now();
        const synthetic = syntheticVirtualContestDoc({
            domainId: current.domainId,
            sourceContestId: current.sourceContestId,
            snapshot: current.snapshot,
            startAt: current.startAt,
            endAt: current.endAt,
            unlocked: true,
        });
        const stats = this.scoreAttempt(synthetic, journalOf(current));
        const result = await this.attempts.findOneAndUpdate(
            { _id: current._id, status: 'active', rev: current.rev },
            { $set: { status: 'ended', endedAt, ...stats, rev: current.rev + 1 } },
            { returnDocument: 'after' },
        );
        if (result) {
            logger.info(
                'Virtual contest ended domain=%s contest=%s uid=%d attempt=%s stage=end result=success',
                current.domainId,
                current.sourceContestId,
                current.uid,
                current._id,
            );
            return result;
        }
        const confirmed = await this.attempts.findOne({ _id: current._id, domainId: current.domainId });
        if (!confirmed) throw new NotFoundError(localizedErrorText`虚拟参赛`);
        if (confirmed.status === 'active' && this.now().getTime() >= confirmed.endAt.getTime()) {
            if (depth >= 8) throw new Error(`virtual contest settle CAS failed: ${current.domainId}/${current._id}`);
            return this.transitionEnded(confirmed, depth + 1);
        }
        return confirmed;
    }
}

export const virtualAttemptColl = db.collection<VirtualContestAttemptDoc>('virtual.attempts');
export const virtualContestService = new VirtualContestService({ attempts: virtualAttemptColl });

export async function apply(ctx: Context): Promise<void> {
    await virtualContestService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [() => virtualAttemptColl.deleteMany({ domainId })]);
    });
}

global.Hydro.model.virtualContest = {
    virtualContestService,
    canManageVirtualContest,
};
