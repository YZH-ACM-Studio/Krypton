import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
    issuedPaperMaximum, paperMaximum, pointsForIssuedRound, type SetPaperPoints, planHandIn, planOfficialSave, planRoundStart, readStoredSetConfig, roundPassed, STATUS,
    roundPersonalEnd, roundTotal, selectRound, setRoundMessage, stableAnswerBody,
    type CodeAttempt, type OfficialAnswer, type ProblemKind, type SaveApply,
    type SavePlanItem, type SetSettings,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { Context } from '../context';
import { LocalizedErrorText, ValidationError } from '../error';
import type { RecordDoc, Tdoc } from '../interface';
import { parseProblemConfigObject } from '../lib/problem-config';
import { gradeSetAnswer } from '../lib/set-answer-grading';
import { judgedSetAttempts, hasPendingSetAttempts, answersWithManualGrades, setRecordAcceptedAt } from '../lib/set-judged-attempts';
import { withSetParticipantBoundary } from '../lib/set-participant-boundary';
import { loadPaperProblemFacts } from '../lib/set-paper-facts';
import { setProblemFact } from '../lib/set-problem-fact';
import type { SetResultVisibility } from '../lib/set-result-visibility';
import { countSetSubmission, includeRoundProblem, type ParticipantProblemCounts } from '../lib/set-scoreboard-stats';
import type { ReplayRound } from '../lib/virtual-contest-replay';
import { setParticipantProjection, setRoundDetail, type ScoredSetRound, type SetParticipantProjection } from '../lib/set-score-projection';
import * as contest from './contest';
import { isTeamBatchFinalizationPending } from './contest-participation';
import ProblemModel from './problem';
import record from './record';
import db from '../service/db';

const logger = new Logger('set-round');

export interface RoundDoc extends ScoredSetRound {
    domainId: string;
    tid: ObjectId;
    participantKey: string;
    openSlot?: string;
    scoreStartedAt?: Date;
    legacy?: {
        sourceRule: string;
        sourceStatusId: ObjectId;
        missingRounds: number;
        incompleteHistory: boolean;
        scoreLocked: boolean;
        incompleteReasons?: string[];
    };
}

interface StoredAnswer extends OfficialAnswer {
    domainId: string;
    roundId: ObjectId;
}

export interface OfficialSaveResult {
    changed: number[];
    unchanged: number[];
    versions: Record<number, number>;
}

export interface OfficialSaveRequest {
    domainId: string;
    tid: ObjectId;
    roundId: ObjectId;
    uid: number;
    contestTeamId?: ObjectId | null;
    kind: ProblemKind;
    operationId: string;
    items: readonly Pick<SavePlanItem, 'pid' | 'body' | 'baseVersion'>[];
}

interface AnswerOperationDoc {
    domainId: string;
    tid: ObjectId;
    roundId: ObjectId;
    participantKey: string;
    uid: number;
    contestTeamId?: ObjectId | null;
    operationId: string;
    kind: ProblemKind;
    fingerprint: string;
    acceptedAt: Date;
    state: 'pending' | 'complete';
    planned: SaveApply;
    result: OfficialSaveResult;
}

const rounds = db.collection<RoundDoc>('contest.rounds');
const answers = db.collection<StoredAnswer>('contest.answers');
const operations = db.collection<AnswerOperationDoc>('contest.answerOperations');

/** Read one contest's score history in batches. Replay needs scores and times, never answer bodies or source code. */
export async function loadReplayRounds(domainId: string, tid: ObjectId): Promise<Map<string, ReplayRound[]>> {
    const docs = await rounds.find({ domainId, tid }).sort({ roundNo: 1 }).toArray();
    const byRound = new Map<string, ReplayRound>();
    const byParticipant = new Map<string, ReplayRound[]>();
    for (const round of docs) {
        const history: ReplayRound = { round, attempts: [], answers: [] };
        byRound.set(round._id.toHexString(), history);
        const participant = byParticipant.get(round.participantKey) ?? [];
        participant.push(history);
        byParticipant.set(round.participantKey, participant);
    }
    const ids = docs.filter((round) => !round.legacy?.scoreLocked).map((round) => round._id);
    if (!ids.length) return byParticipant;
    const filter = { domainId, roundId: { $in: ids } };
    const [records, saved, changes] = await Promise.all([
        record.coll.find({ domainId, setRoundId: { $in: ids } }, { projection: {
            _id: 1, setRoundId: 1, pid: 1, status: 1, score: 1, judgeAt: 1, setAcceptedAt: 1, setAnswerVersion: 1,
        } }).toArray(),
        answers.find(filter, { projection: { roundId: 1, pid: 1, version: 1, rawScore: 1, acceptedAt: 1, status: 1, rid: 1 } }).toArray(),
        operations.find({ ...filter, tid, state: 'complete' }, { projection: { roundId: 1,
            'planned.changed.pid': 1, 'planned.changed.version': 1, 'planned.changed.rawScore': 1,
            'planned.changed.acceptedAt': 1, 'planned.changed.status': 1, 'planned.changed.rid': 1 } }).toArray(),
    ]);
    const roundRecords = new Map<string, typeof records>();
    for (const row of records) {
        const id = row.setRoundId!.toHexString();
        if (!roundRecords.has(id)) roundRecords.set(id, []);
        roundRecords.get(id)!.push(row);
    }
    // Migrated answers can predate the operation journal. Keep their proven version alongside later saves.
    for (const answer of saved) byRound.get(answer.roundId.toHexString())!.answers.push(answer);
    for (const operation of changes) byRound.get(operation.roundId.toHexString())!.answers.push(...operation.planned.changed);
    for (const [id, history] of byRound) {
        const rows = roundRecords.get(id) ?? [];
        history.attempts = judgedSetAttempts(rows);
        history.answers = answersWithManualGrades(history.answers, rows);
    }
    return byParticipant;
}

function chinese(message: string): LocalizedErrorText {
    const strings = [message] as unknown as TemplateStringsArray;
    Object.defineProperty(strings, 'raw', { value: [message] });
    return new LocalizedErrorText(strings, []);
}

function deny(code: string): never {
    throw new ValidationError('round', null, chinese(setRoundMessage(code)));
}

export function participantKey(uid: number, contestTeamId?: ObjectId | null): string {
    return contestTeamId ? `t:${contestTeamId.toHexString()}` : `u:${uid}`;
}

export async function listRounds(domainId: string, tid: ObjectId | ObjectId[], key: string): Promise<RoundDoc[]> {
    return rounds.find({ domainId, tid: Array.isArray(tid) ? { $in: tid } : tid, participantKey: key }).sort({ roundNo: 1 }).toArray();
}

/** Count a formal save or code submission even while its judge result is pending. */
export async function listSubmittedPids(domainId: string, ids: ObjectId[]): Promise<Map<string, Set<number>>> {
    const byRound = new Map<string, Set<number>>();
    if (!ids.length) return byRound;
    const [saved, submitted] = await Promise.all([
        answers.find({ domainId, roundId: { $in: ids } }).project<{ roundId: ObjectId; pid: number }>({ _id: 0, roundId: 1, pid: 1 }).toArray(),
        record.coll.aggregate<{ _id: { roundId: ObjectId; pid: number } }>([
            { $match: { domainId, setRoundId: { $in: ids } } },
            { $group: { _id: { roundId: '$setRoundId', pid: '$pid' } } },
        ]).toArray(),
    ]);
    for (const { roundId, pid } of [...saved, ...submitted.map((row) => row._id)]) {
        const id = roundId.toHexString();
        const pids = byRound.get(id) ?? new Set<number>();
        pids.add(pid);
        byRound.set(id, pids);
    }
    return byRound;
}

function operationScope(operation: Pick<AnswerOperationDoc, 'domainId' | 'tid' | 'roundId' | 'participantKey' | 'operationId'>) {
    return { domainId: operation.domainId, tid: operation.tid, roundId: operation.roundId,
        participantKey: operation.participantKey, operationId: operation.operationId };
}

function saveFingerprint(input: Pick<OfficialSaveRequest, 'kind' | 'items'>): string {
    return createHash('sha256').update(stableAnswerBody({ kind: input.kind,
        items: input.items.map(({ pid, body, baseVersion }) => ({ pid, body, baseVersion })) })).digest('hex');
}

/** Call under the participant boundary after a save fails; inspect only this exact request's acceptance metadata. */
export async function wasOfficialSaveAccepted(input: OfficialSaveRequest): Promise<boolean> {
    const operation = await operations.findOne({ domainId: input.domainId, tid: input.tid, roundId: input.roundId,
        participantKey: participantKey(input.uid, input.contestTeamId), operationId: input.operationId,
        kind: input.kind, fingerprint: saveFingerprint(input) }, { projection: { _id: 0, state: 1 } });
    if (!operation) return false;
    if (operation.state !== 'pending' && operation.state !== 'complete') throw new TypeError('set_answer_operation_invalid');
    return true;
}

/** Resume only an already accepted exact request. This never reads browser drafts. */
async function finishOperation(operation: AnswerOperationDoc): Promise<OfficialSaveResult> {
    if (operation.state === 'complete') return operation.result;
    await markRoundScoreDirty(operation.domainId, operation.tid, operation.roundId);
    for (const answer of operation.planned.changed) {
        if (operation.kind === 'subjective') {
            if (!answer.rid) throw new Error('set_answer_record_missing');
            await record.ensureManualSetAnswerRecord({ domainId: operation.domainId, tid: operation.tid,
                roundId: operation.roundId, uid: operation.uid, contestTeamId: operation.contestTeamId,
                pid: answer.pid, answerVersion: answer.version, operationId: operation.operationId,
                rid: new ObjectId(answer.rid), acceptedAt: answer.acceptedAt, body: answer.body });
        }
        const filter = { domainId: operation.domainId, roundId: operation.roundId, pid: answer.pid };
        const current = await answers.findOne(filter);
        if (current?.operationId === operation.operationId && current.version === answer.version
            && stableAnswerBody(current.body) === stableAnswerBody(answer.body)) continue;
        if ((current?.version ?? 0) !== answer.version - 1) deny('set_round_conflict');
        if (current) {
            const written = await answers.updateOne({ ...filter, version: current.version }, { $set: answer });
            if (written.matchedCount !== 1) deny('set_round_conflict');
        } else {
            try {
                await answers.insertOne({ ...answer, domainId: operation.domainId, roundId: operation.roundId });
            } catch (error) {
                if ((error as { code?: number }).code === 11000) deny('set_round_conflict');
                throw error;
            }
        }
    }
    const complete = await operations.updateOne({ ...operationScope(operation), state: 'pending' }, { $set: { state: 'complete' } });
    if (complete.matchedCount !== 1) deny('set_round_conflict');
    return operation.result;
}

async function finishPending(round: RoundDoc): Promise<boolean> {
    const pending = await operations.find({ domainId: round.domainId, tid: round.tid, roundId: round._id,
        participantKey: round.participantKey, state: 'pending' }).sort({ acceptedAt: 1 }).toArray();
    for (const operation of pending) await finishOperation(operation);
    return pending.length > 0;
}

async function settleInside(domainId: string, tid: ObjectId, key: string, settings: SetSettings, endAt: Date, now: Date) {
    const existing = await listRounds(domainId, tid, key);
    let changed = false;
    for (const round of existing) {
        if (await finishPending(round)) {
            round.scoreDirty = true;
            changed = true;
        }
        if (round.state !== 'open') continue;
        const deadline = roundPersonalEnd(settings, endAt, round.startedAt);
        if (now < deadline) continue;
        const result = await rounds.updateOne({ domainId, tid, _id: round._id, state: 'open' },
            { $set: { state: 'closed', closedAt: deadline, statusDirty: true }, $unset: { openSlot: '' } });
        if (result.matchedCount !== 1) deny('set_round_conflict');
        round.state = 'closed';
        round.closedAt = deadline;
        round.statusDirty = true;
        delete round.openSlot;
        changed = true;
        logger.info('problem set round expired domain=%s tid=%s key=%s round=%d', domainId, tid.toHexString(), key, round.roundNo);
    }
    return { existing, changed };
}

export async function settleParticipantRounds(domainId: string, tid: ObjectId, uid: number, contestTeamId?: ObjectId | null, now = new Date()): Promise<RoundDoc[]> {
    const key = participantKey(uid, contestTeamId);
    return withSetParticipantBoundary(domainId, tid, key, async () => {
        const tdoc = await contest.get(domainId, tid);
        const config = readStoredSetConfig(tdoc);
        const { existing, changed } = await settleInside(domainId, tid, key, config.settings, tdoc.endAt, now);
        const refresh = existing.filter((round) => !round.legacy?.scoreLocked
            && (round.scoreDirty || round.scoreRevision !== config.revision));
        await refreshScores(domainId, tdoc.score, config, refresh, tdoc.setPoints);
        if (changed || refresh.length || existing.some((round) => round.statusDirty)) {
            const selected = selectRound(config.settings, existing) as RoundDoc | null;
            await contest.persistSetParticipantStatus(domainId, tid, uid, contestTeamId, setParticipantProjection(selected, config.revision));
            await acknowledgeParticipantStatus(domainId, tid, uid, contestTeamId);
            for (const round of existing) round.statusDirty = false;
        }
        return existing;
    });
}

/** Clear only after the selected projection has reached its persistent participant status. */
export async function acknowledgeParticipantStatus(domainId: string, tid: ObjectId, uid: number,
    contestTeamId?: ObjectId | null): Promise<void> {
    const key = participantKey(uid, contestTeamId);
    await withSetParticipantBoundary(domainId, tid, key, async () => {
        const dirty = await rounds.find({ domainId, tid, participantKey: key, statusDirty: true }).toArray();
        for (const round of dirty) {
            const result = await rounds.updateOne({ domainId, tid, _id: round._id, statusDirty: true }, { $set: { statusDirty: false } });
            if (result.matchedCount !== 1) deny('set_round_conflict');
        }
    });
}

/** Reuse settled round totals; only interrupted writes and stale score revisions read judging facts. */
export async function readSettledParticipantStatus(domainId: string, tid: ObjectId, uid: number,
    contestTeamId?: ObjectId | null, now = new Date()): Promise<SetParticipantProjection> {
    return withSetParticipantBoundary(domainId, tid, participantKey(uid, contestTeamId), async () => {
        const config = readStoredSetConfig(await contest.get(domainId, tid));
        const existing = await settleParticipantRounds(domainId, tid, uid, contestTeamId, now);
        return setParticipantProjection(selectRound(config.settings, existing) as RoundDoc | null, config.revision);
    });
}

/** Mark before changing accepted facts so an interrupted projection can be repaired on the next read. */
export async function markRoundScoreDirty(domainId: string, tid: ObjectId, roundId: ObjectId): Promise<void> {
    const round = await rounds.findOne({ domainId, tid, _id: roundId });
    if (!round) deny('set_round_problem');
    await withSetParticipantBoundary(domainId, tid, round.participantKey, async () => {
        const result = await rounds.updateOne({ domainId, tid, _id: roundId }, { $set: { scoreDirty: true } });
        if (result.matchedCount !== 1) deny('set_round_conflict');
    });
}

/** Read the current paper without settling scores during an authorization or scoreboard projection. */
export async function readParticipantPaper(domainId: string, tid: ObjectId, uid: number, contestTeamId?: ObjectId | null): Promise<number[] | null> {
    const existing = await listRounds(domainId, tid, participantKey(uid, contestTeamId));
    const round = existing.find((value) => value.state === 'open') ?? existing.at(-1);
    return round ? [...round.paperPids] : null;
}

export async function readParticipantRound(domainId: string, tid: ObjectId, uid: number, contestTeamId?: ObjectId | null, roundId?: ObjectId): Promise<RoundDoc | null> {
    const existing = await settleParticipantRounds(domainId, tid, uid, contestTeamId);
    if (roundId) return existing.find((round) => round._id.equals(roundId)) ?? null;
    return existing.find((round) => round.state === 'open') ?? existing[existing.length - 1] ?? null;
}

export async function getOfficialAnswers(domainId: string, round: RoundDoc): Promise<OfficialAnswer[]> {
    if (round.domainId !== domainId) deny('set_round_problem');
    return answers.find({ domainId, roundId: round._id }).toArray();
}

export async function openOrResumeRound(input: {
    domainId: string; tid: ObjectId; uid: number; contestTeamId?: ObjectId | null;
    settings: SetSettings; beginAt: Date; endAt: Date; now: Date; issuedWithPaperPoints?: true;
    poolPids: number[]; poolKinds: ReadonlyMap<number, ProblemKind>; randomInt: (maxExclusive: number) => number;
}): Promise<RoundDoc> {
    const key = participantKey(input.uid, input.contestTeamId);
    return withSetParticipantBoundary(input.domainId, input.tid, key, async () => {
        const existing = await settleParticipantRounds(input.domainId, input.tid, input.uid, input.contestTeamId, input.now);
        const decision = planRoundStart(input.settings, { beginAt: input.beginAt, endAt: input.endAt, now: input.now }, existing,
            input.poolPids, input.poolKinds, input.randomInt);
        if (decision.action === 'deny') deny(decision.code);
        if (decision.action === 'resume') {
            const open = existing.find((round) => round.roundNo === decision.roundNo);
            if (!open) deny('set_round_closed');
            return open;
        }
        const doc: RoundDoc = {
            _id: new ObjectId(), domainId: input.domainId, tid: input.tid, participantKey: key,
            roundNo: decision.roundNo, state: 'open', startedAt: input.now, closedAt: null,
            ...(input.issuedWithPaperPoints ? { issuedWithPaperPoints: true } : {}),
            paperPids: decision.paperPids, total: 0, passed: false, detail: {}, accept: 0, penaltySeconds: 0, openSlot: key, scoreDirty: true,
        };
        await rounds.insertOne(doc);
        logger.info('problem set round opened domain=%s tid=%s key=%s round=%d problems=%d', input.domainId, input.tid.toHexString(), key, doc.roundNo, doc.paperPids.length);
        return doc;
    });
}

export async function saveOfficialKind(input: OfficialSaveRequest & {
    round: RoundDoc;
    settings: SetSettings; operationId: string; now: Date; finalEnd: Date;
}): Promise<OfficialSaveResult> {
    if (!input.operationId || !input.roundId.equals(input.round._id) || input.round.domainId !== input.domainId
        || !input.round.tid.equals(input.tid)) deny('set_round_conflict');
    const key = input.round.participantKey;
    if (key !== participantKey(input.uid, input.contestTeamId)) deny('set_round_conflict');
    const scope = { domainId: input.domainId, tid: input.tid, roundId: input.roundId,
        participantKey: key, operationId: input.operationId };
    const fingerprint = saveFingerprint(input);
    return withSetParticipantBoundary(input.domainId, input.tid, key, async () => {
        const stored = await operations.findOne({ domainId: input.domainId, operationId: input.operationId });
        if (stored) {
            if (!stored.tid.equals(input.tid) || !stored.roundId.equals(input.roundId) || stored.participantKey !== key
                || stored.kind !== input.kind || stored.fingerprint !== fingerprint) deny('set_round_conflict');
            return finishOperation(stored);
        }
        const round = await rounds.findOne({ _id: input.roundId, domainId: input.domainId, tid: input.tid, participantKey: key });
        if (!round || round.state !== 'open') deny('set_round_closed');
        if (round.legacy?.scoreLocked) throw new Error('set_round_legacy_score_locked');
        await finishPending(round);
        const tdoc = await contest.get(input.domainId, input.tid);
        const config = readStoredSetConfig(tdoc);
        if (config.publication !== 'published') deny('set_round_closed');
        const finalEnd = tdoc.endAt;
        const deadline = roundPersonalEnd(config.settings, finalEnd, round.startedAt);
        if (input.now >= deadline) deny('set_round_closed');
        if (!input.items.length || new Set(input.items.map((item) => item.pid)).size !== input.items.length) deny('set_round_problem');
        for (const item of input.items) {
            if (tdoc.setPoints?.[item.pid]?.excluded) throw new ValidationError('pid', null, chinese('这道题已从本卷剔除。'));
            if (!round.paperPids.includes(item.pid) || !Number.isSafeInteger(item.baseVersion) || item.baseVersion < 0) deny('set_round_problem');
            const pdoc = await ProblemModel.get(input.domainId, item.pid, undefined, true);
            if (!pdoc) deny('set_round_problem');
            const fact = setProblemFact({ ...pdoc, config: parseProblemConfigObject(pdoc) });
            if (fact.kind !== input.kind || fact.judged) deny('set_round_problem');
            gradeSetAnswer(pdoc, item.body);
        }
        const current = await getOfficialAnswers(input.domainId, round);
        const planned = planOfficialSave({ operationId: input.operationId, now: input.now, deadline,
            paperPids: round.paperPids, current, items: input.items.map((item) => ({ ...item, rawScore: 0 })) });
        if ('code' in planned) deny(planned.code);
        for (const answer of planned.changed) {
            const canonical = await ProblemModel.claimStructureLockForSubmission(input.domainId, answer.pid, true, input.uid);
            const fact = setProblemFact({ ...canonical, config: parseProblemConfigObject(canonical) });
            if (fact.kind !== input.kind || fact.judged) deny('set_round_problem');
            const grade = gradeSetAnswer(canonical, answer.body);
            answer.rawScore = grade.rawScore;
            answer.status = grade.status;
            answer.judgeResult = grade.judgeResult;
        }
        if (input.kind === 'subjective') {
            for (const answer of planned.changed) {
                answer.rid = new ObjectId().toHexString();
                answer.status = STATUS.STATUS_WAITING;
                answer.rawScore = 0;
            }
        }
        const versions = Object.fromEntries(current.filter((answer) => planned.unchanged.includes(answer.pid)).map((answer) => [answer.pid, answer.version]));
        for (const answer of planned.changed) versions[answer.pid] = answer.version;
        const result = { changed: planned.changed.map((answer) => answer.pid), unchanged: planned.unchanged, versions };
        await markRoundScoreDirty(input.domainId, input.tid, round._id);
        const acceptedAt = new Date(Math.max(Date.now(), input.now.getTime()));
        if (acceptedAt >= deadline) deny('set_round_closed');
        for (const answer of planned.changed) answer.acceptedAt = acceptedAt;
        const operation: AnswerOperationDoc = { ...scope, kind: input.kind, fingerprint,
            uid: input.uid, contestTeamId: input.contestTeamId,
            acceptedAt, state: 'pending', planned, result };
        await operations.insertOne(operation);
        try {
            await finishOperation(operation);
        } catch (error) {
            logger.error('problem set kind save incomplete domain=%s tid=%s round=%s operation=%s error=%s',
                input.domainId, input.tid.toHexString(), round._id.toHexString(), input.operationId,
                error instanceof Error ? error.message : String(error));
            throw error;
        }
        logger.info('problem set kind saved domain=%s tid=%s round=%s changed=%d unchanged=%d', input.domainId, input.tid.toHexString(), round._id.toHexString(), result.changed.length, result.unchanged.length);
        return result;
    });
}

/** A grade for an older manual Record stays historical and never changes a later saved answer. */
export async function applyManualAnswerGrade(domainId: string, tid: ObjectId, roundId: ObjectId,
    pid: number, rid: ObjectId, version: number, rawScore: number, status: number): Promise<boolean> {
    const round = await rounds.findOne({ domainId, tid, _id: roundId });
    if (!round) deny('set_round_problem');
    if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100 || !Number.isInteger(status)
        || !Number.isSafeInteger(version) || version < 1) throw new TypeError('set_answer_grade_invalid');
    return withSetParticipantBoundary(domainId, tid, round.participantKey, async () => {
        await markRoundScoreDirty(domainId, tid, roundId);
        const changed = await answers.updateOne({ domainId, roundId, pid, rid: rid.toHexString(), version },
            { $set: { rawScore, status } });
        logger.info('problem set manual grade domain=%s tid=%s round=%s pid=%d version=%d current=%s',
            domainId, tid.toHexString(), roundId.toHexString(), pid, version, String(changed.matchedCount === 1));
        return changed.matchedCount === 1;
    });
}

export async function handInRound(round: RoundDoc, settings: SetSettings, now: Date, finalEnd: Date): Promise<void> {
    return withSetParticipantBoundary(round.domainId, round.tid, round.participantKey, async () => {
        const current = await rounds.findOne({ domainId: round.domainId, tid: round.tid, _id: round._id, participantKey: round.participantKey });
        if (!current) deny('set_round_closed');
        if (current.state === 'closed') return;
        const deadline = roundPersonalEnd(settings, finalEnd, current.startedAt);
        const decision = planHandIn(settings, current.state, now, deadline);
        if (decision !== 'close') deny(decision);
        await finishPending(current);
        const closedAt = new Date(Math.min(now.getTime(), deadline.getTime()));
        const updated = await rounds.updateOne({ _id: current._id, state: 'open' },
            { $set: { state: 'closed', closedAt, statusDirty: true }, $unset: { openSlot: '' } });
        if (updated.matchedCount !== 1) deny('set_round_conflict');
        logger.info('problem set round closed domain=%s tid=%s round=%s', round.domainId, round.tid.toHexString(), round._id.toHexString());
    });
}

export async function findOpenRound(domainId: string, tid: ObjectId, uid: number, contestTeamId?: ObjectId | null): Promise<RoundDoc | null> {
    return (await settleParticipantRounds(domainId, tid, uid, contestTeamId)).find((round) => round.state === 'open') ?? null;
}

/** Binding is checked at the accepted submission time, separately from judge completion. */
export async function bindCodeSubmitToRound(domainId: string, tid: ObjectId, uid: number, pid: number,
    contestTeamId?: ObjectId | null, now = new Date()): Promise<{ roundId: ObjectId; acceptedAt: Date } | null> {
    const key = participantKey(uid, contestTeamId);
    return withSetParticipantBoundary(domainId, tid, key, async () => {
        const tdoc = await contest.get(domainId, tid);
        let config;
        try {
            config = readStoredSetConfig(tdoc);
        } catch (error) {
            if (error instanceof TypeError && error.message === 'set_config_missing') return null;
            throw error;
        }
        if (config.publication !== 'published') deny('set_round_closed');
        if (isTeamBatchFinalizationPending(tdoc)) throw new ValidationError('round', null, chinese('队伍还没有定版，不能开始。'));
        const { existing } = await settleInside(domainId, tid, key, config.settings, tdoc.endAt, now);
        const open = existing.find((round) => round.state === 'open');
        if (!open) deny('set_round_not_open');
        if (tdoc.setPoints?.[pid]?.excluded) throw new ValidationError('pid', null, chinese('这道题已从本卷剔除。'));
        if (!open.paperPids.includes(pid)) deny('set_round_problem');
        if (now < open.startedAt || now >= roundPersonalEnd(config.settings, tdoc.endAt, open.startedAt)) deny('set_round_closed');
        if (open.legacy?.scoreLocked) throw new Error('set_round_legacy_score_locked');
        await markRoundScoreDirty(domainId, tid, open._id);
        const acceptedAt = new Date(Math.max(Date.now(), now.getTime()));
        if (acceptedAt >= roundPersonalEnd(config.settings, tdoc.endAt, open.startedAt)) deny('set_round_closed');
        logger.info('problem set code submit bound domain=%s tid=%s uid=%d pid=%d round=%s', domainId, tid.toHexString(), uid, pid, open._id.toHexString());
        return { roundId: open._id, acceptedAt };
    });
}

async function isJudgedProblem(domainId: string, pid: number) {
    const pdoc = await ProblemModel.get(domainId, pid, ['problemKind', 'config'], true);
    if (!pdoc) throw new ValidationError('pid', null, chinese('题目不存在，不能计算这一轮成绩。'));
    return setProblemFact({ ...pdoc, config: parseProblemConfigObject(pdoc) }).judged;
}

async function scoreFacts(domainId: string, pids: readonly number[], score?: Record<number, number> | null,
    judgedByPid = new Map<number, Promise<boolean>>()) {
    const weights = new Map<number, number>();
    const codePids = new Set<number>();
    for (const pid of pids) {
        const weight = score?.[pid];
        weights.set(pid, typeof weight === 'number' ? weight : 100);
        let judged = judgedByPid.get(pid);
        if (!judged) {
            judged = isJudgedProblem(domainId, pid);
            judgedByPid.set(pid, judged);
        }
        if (await judged) codePids.add(pid);
    }
    return { weights, codePids };
}

async function refreshScores(domainId: string, score: Record<number, number> | null | undefined,
    config: ReturnType<typeof readStoredSetConfig>, refresh: readonly RoundDoc[], points?: SetPaperPoints) {
    const facts = await scoreFacts(domainId, [...new Set(refresh.flatMap((round) => round.paperPids))], score);
    for (const round of refresh) {
        const records = await record.coll.find({ domainId, setRoundId: round._id }).toArray();
        const current = await getOfficialAnswers(domainId, round);
        const graded = answersWithManualGrades(current, records);
        for (let index = 0; index < graded.length; index++) {
            if (graded[index].rawScore === current[index].rawScore && graded[index].status === current[index].status) continue;
            const answer = graded[index];
            const result = await answers.updateOne({ domainId, roundId: round._id, pid: answer.pid, rid: answer.rid, version: answer.version },
                { $set: { rawScore: answer.rawScore, status: answer.status } });
            if (result.matchedCount !== 1) deny('set_round_conflict');
            logger.info('problem set manual grade recovered domain=%s tid=%s round=%s pid=%d version=%d',
                domainId, round.tid.toHexString(), round._id.toHexString(), answer.pid, answer.version);
        }
        Object.assign(round, await writeRoundScore(round, config.settings, judgedSetAttempts(records), facts.weights, facts.codePids,
            config.revision, hasPendingSetAttempts(records.filter((r) => !points?.[r.pid]?.excluded), graded), points));
    }
}

export async function writeRoundScore(round: RoundDoc, settings: SetSettings, attempts: readonly CodeAttempt[], weights: ReadonlyMap<number, number>, codePids: ReadonlySet<number>, revision = round.scoreRevision ?? 0, judgePending = false, points?: SetPaperPoints): Promise<RoundDoc> {
    return withSetParticipantBoundary(round.domainId, round.tid, round.participantKey, async () => {
        if (round.legacy?.scoreLocked) throw new Error('set_round_legacy_score_locked');
        const rows = await getOfficialAnswers(round.domainId, round);
        const scored = roundTotal(settings, round.paperPids, rows, attempts, weights, codePids, round.scoreStartedAt ?? round.startedAt, pointsForIssuedRound(points, round));
        const update = { total: scored.total, ...(points && settings.codePolicy !== 'acm' ? { maxPoints: paperMaximum(points, round.paperPids) } : {}), passed: roundPassed(settings, scored.total), accept: scored.accept,
            penaltySeconds: scored.penaltySeconds, detail: setRoundDetail(scored), scoreRevision: revision,
            judgePending, scoreDirty: false, statusDirty: true };
        const written = await rounds.updateOne({ domainId: round.domainId, tid: round.tid, _id: round._id }, { $set: update });
        if (written.matchedCount !== 1) deny('set_round_conflict');
        return { ...round, ...update };
    });
}

/** Refresh the affected round before choosing a result; late judging stays attached to its original round. */
export async function projectParticipantStatus(domainId: string, tid: ObjectId, uid: number, contestTeamId?: ObjectId | null, changedRoundId?: ObjectId): Promise<SetParticipantProjection> {
    const key = participantKey(uid, contestTeamId);
    return withSetParticipantBoundary(domainId, tid, key, async () => {
        const tdoc = await contest.get(domainId, tid);
        const config = readStoredSetConfig(tdoc);
        const { existing } = await settleInside(domainId, tid, key, config.settings, tdoc.endAt, new Date());
        if (changedRoundId && !existing.some((round) => round._id.equals(changedRoundId))) deny('set_round_problem');
        const refresh = existing.filter((round) => !round.legacy?.scoreLocked
            && (!changedRoundId || round._id.equals(changedRoundId) || round.scoreDirty || round.scoreRevision !== config.revision));
        if (changedRoundId && existing.some((round) => round._id.equals(changedRoundId) && round.legacy?.scoreLocked)) {
            throw new Error('set_round_legacy_score_locked');
        }
        await refreshScores(domainId, tdoc.score, config, refresh, tdoc.setPoints);
        const selected = selectRound(config.settings, existing);
        const chosen = selected ? existing.find((round) => round.roundNo === selected.roundNo) ?? null : null;
        const projection = setParticipantProjection(chosen, config.revision);
        logger.info('problem set score projected domain=%s tid=%s key=%s round=%s total=%s', domainId, tid.toHexString(), key,
            String(chosen?.roundNo ?? 'none'), String(projection.score));
        return projection;
    });
}

export async function chosenRound(domainId: string, tid: ObjectId, key: string, settings: SetSettings): Promise<RoundDoc | null> {
    const existing = await listRounds(domainId, tid, key);
    const selected = selectRound(settings, existing);
    return selected ? existing.find((round) => round.roundNo === selected.roundNo) ?? null : null;
}

export interface SetScoreReadOptions {
    cutoff?: Date;
    visibility?: (round: RoundDoc, pid: number) => Pick<SetResultVisibility, 'score' | 'verdict'>;
}

type ScoreAnswer = Pick<OfficialAnswer, 'pid' | 'version' | 'acceptedAt' | 'rawScore' | 'status' | 'rid'>;

async function answersAt(round: RoundDoc, records: readonly RecordDoc[], cutoff: Date | undefined,
    verdictPids: ReadonlySet<number>, counts: ParticipantProblemCounts) {
    const current = await answers.find({ domainId: round.domainId, roundId: round._id },
        { projection: { pid: 1, version: 1, acceptedAt: 1, rawScore: 1, status: 1, rid: 1 } }).toArray();
    const byPid = new Map<number, ScoreAnswer>(current.filter((answer) => !cutoff || answer.acceptedAt <= cutoff)
        .map((answer) => [answer.pid, answer]));
    const versions = new Set<string>();
    const visit = (answer: ScoreAnswer) => {
        if (!verdictPids.has(answer.pid) || answer.rid) return; // Record-backed saves were counted with the submissions.
        const key = `${answer.pid}:${answer.version}`;
        if (versions.has(key)) return;
        versions.add(key);
        countSetSubmission(counts, answer.pid, answer.status ?? (answer.rawScore >= 100 ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER));
    };
    for (const answer of byPid.values()) visit(answer);
    // The current answer suffices unless a previous version can affect the frozen score or the submission counts.
    if (current.some((answer) => answer.version > 1 && ((cutoff && answer.acceptedAt > cutoff) || (!answer.rid && verdictPids.has(answer.pid))))) {
        const history = await operations.find({ domainId: round.domainId, tid: round.tid, roundId: round._id,
            participantKey: round.participantKey, state: 'complete', ...(cutoff ? { acceptedAt: { $lte: cutoff } } : {}) },
        { projection: { 'planned.changed.pid': 1, 'planned.changed.version': 1, 'planned.changed.acceptedAt': 1,
            'planned.changed.rawScore': 1, 'planned.changed.status': 1, 'planned.changed.rid': 1 } }).toArray();
        for (const operation of history) {
            for (const answer of operation.planned.changed) {
                visit(answer);
                if (cutoff && (byPid.get(answer.pid)?.version ?? 0) < answer.version) byPid.set(answer.pid, answer);
            }
        }
    }
    return answersWithManualGrades([...byPid.values()], records);
}

/** A locked migrated round keeps its original journal even when individual Records were lost. */
async function countLockedHistory(round: RoundDoc, next: RoundDoc | undefined, closedAt: Date | null, cutoff: Date | undefined,
    pids: Set<number>, counts: ParticipantProblemCounts) {
    if (!pids.size) return;
    const legacy = round.legacy!;
    const team = round.participantKey.startsWith('t:');
    const source = legacy.missingRounds === 0 && closedAt && legacy.sourceStatusId instanceof ObjectId
        ? await db.collection<{ journal?: { pid: number; rid: ObjectId; status: number }[] }>(team ? 'contest.teamStatuses' : 'document.status')
            .findOne({ _id: legacy.sourceStatusId, domainId: round.domainId, [team ? 'contestId' : 'docId']: round.tid },
                { projection: { 'journal.pid': 1, 'journal.rid': 1, 'journal.status': 1 } })
        : null;
    if (!source?.journal) {
        for (const pid of pids) includeRoundProblem(counts, pid, true, true);
        return;
    }
    const end = Math.min(+closedAt, cutoff ? +cutoff : Infinity);
    const nextSecond = next ? Math.floor(+next.startedAt / 1000) * 1000 : Infinity;
    const seen = new Map<string, number>();
    for (const entry of source.journal) {
        if (!pids.has(entry.pid)) continue;
        const time = +setRecordAcceptedAt(entry.rid, undefined);
        if (time > end || time > nextSecond) continue;
        // An ObjectId has second precision. Do not attribute an ambiguous next-round submission to this round.
        if (time === nextSecond) {
            includeRoundProblem(counts, entry.pid, true, true);
            continue;
        }
        const rid = entry.rid.toHexString();
        if (seen.has(rid)) throw new TypeError('set_scoreboard_duplicate_legacy_record');
        seen.set(rid, entry.pid);
        countSetSubmission(counts, entry.pid, entry.status);
    }
    for (const pid of pids) {
        const entry = round.detail?.[pid];
        if (entry && (!entry.rid || (+entry.rid.getTimestamp() <= end && seen.get(entry.rid.toHexString()) !== pid))) {
            includeRoundProblem(counts, pid, true, true);
        }
    }
}

/** Share paper metadata for one scoreboard request. Each participant's results still come from live, eligible records. */
function scoreRoundsForSet(tdoc: Tdoc, options: SetScoreReadOptions) {
    const { domainId, docId: tid } = tdoc;
    const config = readStoredSetConfig(tdoc);
    const loadFacts = async () => {
        const metadata = await loadPaperProblemFacts(ProblemModel, domainId, tdoc.pids);
        return {
            metadata,
            codePids: new Set([...metadata].filter(([, fact]) => fact.judged).map(([pid]) => pid)),
            weights: new Map(tdoc.pids.map((pid) => [pid, tdoc.score?.[pid] ?? 100])),
        };
    };
    let factLoad: ReturnType<typeof loadFacts> | undefined;
    return async (key: string) => {
        const existing = await listRounds(domainId, tid, key);
        if (!existing.length) return { ...setParticipantProjection(null, config.revision), problemStats: new Map() as ParticipantProblemCounts };
        const facts = await (factLoad ??= loadFacts());
        const publicRounds: RoundDoc[] = [];
        const problemStats: ParticipantProblemCounts = new Map();
        const viewAt = options.cutoff ?? new Date();
        for (const [index, round] of existing.entries()) {
            if (options.cutoff && round.startedAt > options.cutoff) continue;
            const closedAt = round.closedAt;
            if (config.settings.codePolicy !== 'acm') round.maxPoints = issuedPaperMaximum(tdoc, round, (pid) => facts.metadata.get(pid)?.rawMax);
            if (round.closedAt && round.closedAt > viewAt) {
                round.state = 'open';
                round.closedAt = null;
            }
            const deadline = roundPersonalEnd(config.settings, tdoc.endAt, round.startedAt);
            if (round.state === 'open' && viewAt >= deadline) {
                round.state = 'closed';
                round.closedAt = deadline;
            }
            const verdictPids = new Set<number>();
            const paperPids = round.paperPids.filter((pid) => {
                if (!round.legacy?.scoreLocked && tdoc.setPoints?.[pid]?.excluded) return false;
                const visibility = options.visibility?.(round, pid);
                const scored = !visibility || visibility.score || (config.settings.codePolicy === 'acm' && visibility.verdict);
                const countable = scored && (!visibility || visibility.verdict);
                if (countable) verdictPids.add(pid);
                includeRoundProblem(problemStats, pid, countable, (round.legacy?.missingRounds ?? 0) > 0);
                return scored;
            });
            if (round.legacy?.scoreLocked) {
                await countLockedHistory(round, existing[index + 1], closedAt, options.cutoff, verdictPids, problemStats);
                const detail = Object.fromEntries(Object.entries(round.detail ?? {}).filter(([pid, value]) =>
                    paperPids.includes(Number(pid)) && (!options.cutoff || (value.acceptedAt instanceof Date && value.acceptedAt <= options.cutoff))));
                const total = !options.cutoff && paperPids.length === round.paperPids.length ? round.total
                    : Object.values(detail).reduce((sum, item) => sum + item.score, 0);
                publicRounds.push({ ...round, paperPids, detail, total,
                    accept: config.settings.codePolicy === 'acm' ? total : 0,
                    penaltySeconds: config.settings.codePolicy === 'acm'
                        ? Object.values(detail).filter((item) => item.score === 1).reduce((sum, item) => sum + (item.penalty ?? 0) + (item.real ?? 0), 0) : 0 });
                continue;
            }
            const records = await record.coll.find({ domainId, setRoundId: round._id }, {
                projection: { _id: 1, pid: 1, status: 1, score: 1, judgeAt: 1, setAcceptedAt: 1, setAnswerVersion: 1, subtasks: 1 },
            }).toArray();
            for (const submission of records) {
                if (!verdictPids.has(submission.pid)) continue;
                if (options.cutoff && setRecordAcceptedAt(submission._id, submission.setAcceptedAt) > options.cutoff) continue;
                countSetSubmission(problemStats, submission.pid, submission.status);
            }
            const attempts = judgedSetAttempts(records).filter((attempt) => !options.cutoff || attempt.acceptedAt <= options.cutoff);
            const saved = await answersAt(round, records, options.cutoff, verdictPids, problemStats);
            const scored = roundTotal(config.settings, paperPids, saved, attempts,
                facts.weights, facts.codePids, round.scoreStartedAt ?? round.startedAt, pointsForIssuedRound(tdoc.setPoints, round));
            publicRounds.push({ ...round, paperPids, total: scored.total, accept: scored.accept,
                penaltySeconds: scored.penaltySeconds, detail: setRoundDetail(scored), scoreRevision: config.revision });
        }
        const selected = selectRound(config.settings, publicRounds);
        return { ...setParticipantProjection(selected, config.revision), problemStats };
    };
}

export function createParticipantScoreReader(tdoc: Tdoc, options: SetScoreReadOptions = {}) {
    const read = scoreRoundsForSet(tdoc, options);
    return (uid: number, contestTeamId?: ObjectId | null) => {
        const key = participantKey(uid, contestTeamId);
        return withSetParticipantBoundary(tdoc.domainId, tdoc.docId, key, () => read(key));
    };
}

export function readParticipantScore(domainId: string, tid: ObjectId, uid: number, contestTeamId?: ObjectId | null, options: SetScoreReadOptions = {}) {
    const key = participantKey(uid, contestTeamId);
    return withSetParticipantBoundary(domainId, tid, key, async () => scoreRoundsForSet(await contest.get(domainId, tid), options)(key));
}

export async function apply(ctx: Context) {
    await ctx.db.ensureIndexes(rounds,
        { key: { domainId: 1, tid: 1, participantKey: 1, roundNo: 1 }, unique: true, name: 'setRoundIdentity' },
        { key: { domainId: 1, tid: 1, openSlot: 1 }, unique: true, name: 'setRoundOpen', partialFilterExpression: { openSlot: { $exists: true } } });
    await ctx.db.ensureIndexes(answers, { key: { domainId: 1, roundId: 1, pid: 1 }, unique: true, name: 'setAnswerIdentity' });
    await ctx.db.ensureIndexes(operations,
        { key: { domainId: 1, kind: 1, state: 1 }, name: 'activityTextFill', partialFilterExpression: { kind: 'program_fill', state: 'complete' } },
        { key: { domainId: 1, operationId: 1 }, unique: true, name: 'setAnswerOperation' },
        { key: { domainId: 1, tid: 1, roundId: 1, participantKey: 1, acceptedAt: 1 }, name: 'setAnswerOperationRound' });
}

global.Hydro = global.Hydro || { model: {} } as typeof global.Hydro;
global.Hydro.model.setRound = {
    openOrResumeRound, saveOfficialKind, handInRound, writeRoundScore, chosenRound, findOpenRound, bindCodeSubmitToRound,
};
