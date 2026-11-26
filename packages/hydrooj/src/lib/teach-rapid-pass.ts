import { DEFAULT_RAPID_PASS_RULE, examAttemptsUsed, parseRapidPassRule, resolveExamPaperPids, STATUS, type RapidPassEvidence, type RapidPassRule } from '@hydrooj/common';
import { MongoServerError, ObjectId, type Collection, type Document } from 'mongodb';
import type { Tdoc } from '../interface';

interface Database {
    collection<T extends Document>(name: string): Collection<T>;
}

interface PolicyDoc {
    _id: { domainId: string; tid: ObjectId };
    rule: RapidPassRule;
    revision: number;
}

interface ReviewRound {
    roundNo: number;
    paperPids: number[];
    startedAt: Date;
    closedAt: Date | null;
    personalStart?: boolean;
}

interface Pass {
    pid: number;
    at: Date;
    individual: boolean;
}

function prefer(next: RapidPassEvidence, previous?: RapidPassEvidence): boolean {
    if (!previous) return true;
    if ((next.passed === next.total) !== (previous.passed === previous.total)) return next.passed === next.total;
    if (next.passed !== previous.passed) return next.passed > previous.passed;
    if (next.fromStart !== previous.fromStart) return next.fromStart;
    if (next.seconds !== previous.seconds) return next.seconds < previous.seconds;
    return next.roundNo < previous.roundNo;
}

export function analyzeRound(round: ReviewRound, passes: readonly Pass[], rule: RapidPassRule): RapidPassEvidence | undefined {
    const paper = new Set(round.paperPids);
    if (!rule.enabled || paper.size < rule.minProblems) return undefined;
    const start = round.startedAt.getTime();
    const end = Math.min(round.closedAt?.getTime() ?? Infinity, Date.now());
    if (!Number.isFinite(start) || Number.isNaN(end)) throw new TypeError('invalid review round clock');
    const window = rule.minutes * 60_000;
    const first = new Map<number, Pass>();
    for (const pass of passes) {
        const time = pass.at.getTime();
        if (!Number.isFinite(time)) throw new TypeError('invalid pass time');
        if (!paper.has(pass.pid) || time < start || time > end) continue;
        const previous = first.get(pass.pid);
        if (!previous || time < previous.at.getTime()) first.set(pass.pid, pass);
    }
    const sorted = [...first.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
    let best: RapidPassEvidence | undefined;
    function consider(passed: number, elapsed: number, fromStart: boolean) {
        if (passed < rule.minProblems) return;
        const signal = { roundNo: round.roundNo, passed, total: paper.size, seconds: Math.ceil(elapsed / 1000), fromStart };
        if (prefer(signal, best)) best = signal;
    }
    const early = sorted.filter((pass) => pass.at.getTime() - start <= window);
    if (round.personalStart !== false && early.length) consider(early.length, early[early.length - 1].at.getTime() - start, true);
    // A type-wide save or end-of-round code save timestamps several answers together.
    const individual = sorted.filter((pass) => pass.individual);
    let left = 0;
    for (let right = 0; right < individual.length; right++) {
        const time = individual[right].at.getTime();
        while (time - individual[left].at.getTime() > window) left++;
        consider(right - left + 1, time - individual[left].at.getTime(), false);
    }
    return best;
}

export async function loadRapidPassPolicy(db: Database, domainId: string, tid: ObjectId) {
    const stored = await db.collection<PolicyDoc>('contest.rapidPassPolicies').findOne({ _id: { domainId, tid } });
    if (!stored) return { rule: DEFAULT_RAPID_PASS_RULE, revision: 0 };
    if (!Number.isSafeInteger(stored.revision) || stored.revision < 1) throw new Error('invalid rapid pass policy revision');
    return { rule: parseRapidPassRule(stored.rule), revision: stored.revision };
}

export async function writeRapidPassPolicy(db: Database, domainId: string, tid: ObjectId, rule: RapidPassRule, revision: number) {
    const policies = db.collection<PolicyDoc>('contest.rapidPassPolicies');
    const _id = { domainId, tid };
    if (revision === 0) {
        try {
            await policies.insertOne({ _id, rule, revision: 1 });
            return true;
        } catch (error) {
            if (error instanceof MongoServerError && error.code === 11000) return false;
            throw error;
        }
    }
    return (await policies.updateOne({ _id, revision }, { $set: { rule }, $inc: { revision: 1 } })).matchedCount === 1;
}

export async function loadRapidPassEvidence(db: Database, domainId: string, tid: ObjectId, rule: RapidPassRule) {
    const signals: Record<string, RapidPassEvidence> = {};
    if (!rule.enabled) return signals;
    const rounds = await db.collection('contest.rounds').find({
        domainId, tid, participantKey: /^u:[1-9]\d*$/, [`paperPids.${rule.minProblems - 1}`]: { $exists: true },
        $or: [{ legacy: { $exists: false } }, { 'legacy.incompleteHistory': false, 'legacy.scoreLocked': false }],
    }).project<ReviewRound & { _id: ObjectId; participantKey: string; legacy?: { startedAtSource: string } }>({
        participantKey: 1, roundNo: 1, startedAt: 1, closedAt: 1, paperPids: 1, 'legacy.startedAtSource': 1,
    }).toArray();
    const roundIds = rounds.map((round) => round._id);
    if (!roundIds.length) return signals;
    const [answers, records] = await Promise.all([
        db.collection('contest.answers').find({
            domainId, roundId: { $in: roundIds },
            $or: [{ status: STATUS.STATUS_ACCEPTED }, { status: { $exists: false }, rawScore: { $gte: 100 } }],
        }).project<{ roundId: ObjectId; pid: number; acceptedAt: Date }>({ _id: 0, roundId: 1, pid: 1, acceptedAt: 1 }).toArray(),
        db.collection('record').aggregate<{
            _id: { roundId: ObjectId; uid: number; pid: number; individual: boolean }; at: Date;
        }>([
            { $match: { domainId, contest: tid, setRoundId: { $in: roundIds }, status: STATUS.STATUS_ACCEPTED,
                setAnswerVersion: { $exists: false }, judgeAt: { $type: 'date' } } },
            { $group: {
                _id: { roundId: '$setRoundId', uid: '$uid', pid: '$pid', individual: { $eq: [{ $type: '$setAutoSaveId' }, 'missing'] } },
                at: { $min: { $ifNull: ['$setAcceptedAt', { $toDate: '$_id' }] } },
            } },
        ]).toArray(),
    ]);
    const scope = new Map(rounds.map((round) => [round._id.toHexString(), { round, passes: [] as Pass[] }]));
    for (const row of answers) scope.get(row.roundId.toHexString())!.passes.push({ pid: row.pid, at: row.acceptedAt, individual: false });
    for (const { _id, at } of records) {
        const target = scope.get(_id.roundId.toHexString())!;
        if (target.round.participantKey !== `u:${_id.uid}`) throw new Error(`rapid_pass_record_owner_mismatch round=${_id.roundId}`);
        target.passes.push({ pid: _id.pid, at, individual: _id.individual });
    }
    for (const { round, passes } of scope.values()) {
        const signal = analyzeRound({ ...round, personalStart: !round.legacy || round.legacy.startedAtSource === 'status.startAt' }, passes, rule);
        const uid = round.participantKey.slice(2);
        if (signal && prefer(signal, signals[uid])) signals[uid] = signal;
    }
    return signals;
}

// Legacy exams retain only the latest paper and the record boundary of its attempt.
export async function loadLegacyRapidPassEvidence(db: Database, domainId: string, doc: Tdoc, contestDocType: number, rule: RapidPassRule) {
    const signals: Record<string, RapidPassEvidence> = {};
    if (!rule.enabled || doc.pids.length < rule.minProblems) return signals;
    const personalStart = doc.rule === 'exam' || (doc.duration ?? 0) > 0;
    const statuses = await db.collection('document.status').find({ domainId, docType: contestDocType, docId: doc.docId, attend: 1 })
        .project<{ uid: number; startAt?: Date; paperFinalizedAt?: Date; examAttemptsUsed?: number; examJournalAfter?: ObjectId; examPaperPids?: number[] }>({
            uid: 1, startAt: 1, paperFinalizedAt: 1, examAttemptsUsed: 1, examJournalAfter: 1, examPaperPids: 1,
        }).toArray();
    const byUid = new Map<number, { round: ReviewRound; floor?: ObjectId; passes: Pass[] }>();
    for (const status of statuses) {
        if (personalStart && !status.startAt) continue;
        const used = examAttemptsUsed(status);
        const roundNo = doc.rule === 'exam' ? Math.max(1, used + (status.paperFinalizedAt ? 0 : 1)) : 1;
        if (roundNo > 1 && !status.examJournalAfter) continue;
        const paperPids = resolveExamPaperPids(doc, status);
        if (paperPids.length < rule.minProblems) continue;
        byUid.set(status.uid, {
            round: { roundNo, paperPids, personalStart, startedAt: personalStart ? status.startAt! : doc.beginAt,
                closedAt: status.paperFinalizedAt ?? doc.endAt },
            floor: status.examJournalAfter, passes: [],
        });
    }
    if (!byUid.size) return signals;
    const records = db.collection('record').find({ domainId, contest: doc.docId, uid: { $in: [...byUid.keys()] },
        status: STATUS.STATUS_ACCEPTED, judgeAt: { $type: 'date' }, setRoundId: { $exists: false } })
        .project<{ _id: ObjectId; uid: number; pid: number; lang: string }>({ uid: 1, pid: 1, lang: 1 });
    for await (const record of records) {
        const target = byUid.get(record.uid)!;
        if (target.floor && record._id.toHexString() <= target.floor.toHexString()) continue;
        target.passes.push({ pid: record.pid, at: record._id.getTimestamp(), individual: Boolean(record.lang && record.lang !== '_') });
    }
    for (const [uid, { round, passes }] of byUid) {
        const signal = analyzeRound(round, passes, rule);
        if (signal) signals[uid] = signal;
    }
    return signals;
}
