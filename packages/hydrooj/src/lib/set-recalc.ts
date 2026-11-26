import { randomUUID } from 'node:crypto';
import { ObjectId, type Document } from 'mongodb';
import {
    RECALC_CONCURRENCY, readStoredSetConfig, roundPassed, roundTotal, selectRound,
    paperMaximum, pointsForIssuedRound, type SetPaperPoints, type OfficialAnswer,
} from '@hydrooj/common';
import { judgedSetAttempts, hasPendingSetAttempts, answersWithManualGrades } from './set-judged-attempts';
import { withSetParticipantBoundary } from './set-participant-boundary';
import { setParticipantProjection, setRoundDetail, type ScoredSetRound } from './set-score-projection';

export interface RecalcCollection {
    find(filter: Document): { toArray(): Promise<unknown[]> };
    updateOne(filter: Document, update: Document): Promise<{ matchedCount: number }>;
}

interface Round extends ScoredSetRound {
    participantKey: string;
    scoreStartedAt?: Date;
    legacy?: { scoreLocked?: boolean };
}

export interface SetRecalcInput {
    domainId: string;
    tid: ObjectId;
    changedPids: readonly number[];
    score: Readonly<Record<number, number>>;
    points?: SetPaperPoints;
    codePids: ReadonlySet<number> | (() => Promise<ReadonlySet<number>>);
    collections: {
        contests: RecalcCollection;
        statuses: RecalcCollection;
        rounds: RecalcCollection;
        answers: RecalcCollection;
        records: RecalcCollection;
        teamStatuses?: RecalcCollection;
    };
    logger: { info(message: string): void; error(message: string): void };
    now?: Date;
    expectedRevision?: number;
}

function participantOf(key: string): { kind: 'user'; uid: number } | { kind: 'team'; teamId: ObjectId } {
    const user = /^u:([1-9]\d*)$/.exec(key);
    if (user) {
        const uid = Number(user[1]);
        if (!Number.isSafeInteger(uid)) throw new Error('set_recalc_participant_invalid');
        return { kind: 'user', uid };
    }
    if (/^t:[0-9a-fA-F]{24}$/.test(key)) return { kind: 'team', teamId: new ObjectId(key.slice(2)) };
    throw new Error('set_recalc_participant_invalid');
}

export async function recalcSetScores(input: SetRecalcInput): Promise<void> {
    const started = Date.now();
    const token = randomUUID();
    const { domainId, tid, collections: c } = input;
    const scope = { domainId, tid };
    const contestFilter = { domainId, docType: 30, docId: tid };
    let roundCount = 0;
    const progress = { failed: false, lockedRounds: 0 };
    const summary = () => `lockedRounds=${progress.lockedRounds} domain=${domainId} tid=${tid.toHexString()} changedPids=${input.changedPids.length} rounds=${roundCount} durationMs=${Date.now() - started}`;
    const assertCurrent = async () => {
        const current = await c.contests.find({ ...contestFilter, statusRecalcToken: token }).toArray();
        if (!current.length) throw new Error('set_recalc_superseded');
        if (input.expectedRevision !== undefined && readStoredSetConfig(current[0]).revision !== input.expectedRevision) {
            throw new Error('set_recalc_superseded');
        }
    };
    try {
        const marked = await c.contests.updateOne(contestFilter, { $set: { statusRecalcToken: token } });
        if (marked.matchedCount !== 1) throw new Error('set_recalc_contest_missing');
        const affected = await c.rounds.find({ ...scope, paperPids: { $in: input.changedPids } }).toArray() as Round[];
        roundCount = affected.length;
        const participants = [...new Set(affected.map((round) => round.participantKey))];
        for (const key of participants) participantOf(key);
        if (participants.some((key) => key.startsWith('t:')) && !input.collections.teamStatuses) {
            throw new Error('set_recalc_team_status_missing');
        }
        const teamStatuses = input.collections.teamStatuses as RecalcCollection;
        if (participants.length) {
            const codePids = typeof input.codePids === 'function' ? await input.codePids() : input.codePids;
            const weights = new Map(Object.entries(input.score).map(([pid, weight]) => [Number(pid), weight]));
            let cursor = 0;
            const worker = async () => {
                try {
                    while (!progress.failed && cursor < participants.length) {
                        const key = participants[cursor++];
                        const who = participantOf(key);
                        await withSetParticipantBoundary(domainId, tid, key, async () => {
                            await assertCurrent();
                            const [contest] = await c.contests.find(contestFilter).toArray();
                            const config = readStoredSetConfig(contest);
                            if (input.expectedRevision !== undefined && config.revision !== input.expectedRevision) throw new Error('set_recalc_superseded');
                            const { settings } = config;
                            const rounds = await c.rounds.find({ ...scope, participantKey: key }).toArray() as Round[];
                            for (const round of rounds) {
                                if (!round.paperPids.some((pid) => input.changedPids.includes(pid)) && !round.scoreDirty
                                    && round.scoreRevision === config.revision) continue;
                                if (round.legacy?.scoreLocked) {
                                    progress.lockedRounds++;
                                    continue;
                                }
                                const answers = await c.answers.find({ domainId, roundId: round._id }).toArray() as OfficialAnswer[];
                                const records = await c.records.find({ domainId, setRoundId: round._id }).toArray();
                                const graded = answersWithManualGrades(answers, records);
                                for (let index = 0; index < graded.length; index++) {
                                    const answer = graded[index];
                                    if (answer.rawScore === answers[index].rawScore && answer.status === answers[index].status) continue;
                                    await assertCurrent();
                                    const synced = await c.answers.updateOne({ domainId, roundId: round._id, pid: answer.pid,
                                        rid: answer.rid, version: answer.version }, { $set: { rawScore: answer.rawScore, status: answer.status } });
                                    if (synced.matchedCount !== 1) throw new Error('set_recalc_answer_conflict');
                                }
                                const scored = roundTotal(settings, round.paperPids, graded, judgedSetAttempts(records), weights, codePids,
                                    round.scoreStartedAt ?? round.startedAt, pointsForIssuedRound(input.points, round));
                                const projection = {
                                    total: scored.total, ...(input.points && settings.codePolicy !== 'acm' ? { maxPoints: paperMaximum(input.points, round.paperPids) } : {}), passed: roundPassed(settings, scored.total),
                                    accept: scored.accept, penaltySeconds: scored.penaltySeconds,
                                    detail: setRoundDetail(scored), scoreRevision: config.revision,
                                    judgePending: hasPendingSetAttempts(records.filter((r) => !input.points?.[(r as { pid: number }).pid]?.excluded), graded),
                                    scoreDirty: false,
                                    statusDirty: true,
                                };
                                await assertCurrent();
                                if (progress.failed) return;
                                const updated = await c.rounds.updateOne({ ...scope, _id: round._id, participantKey: key }, { $set: projection });
                                if (updated.matchedCount !== 1) throw new Error('set_recalc_round_missing');
                                Object.assign(round, projection);
                            }
                            const selected = selectRound(settings, rounds);
                            const chosen = selected && rounds.find((round) => round.roundNo === selected.roundNo);
                            if (!chosen) throw new Error('set_recalc_round_missing');
                            await assertCurrent();
                            if (progress.failed) return;
                            const projection = setParticipantProjection(chosen, config.revision);
                            const updated = who.kind === 'user'
                                ? await c.statuses.updateOne({ domainId, docType: 30, docId: tid, uid: who.uid }, { $set: projection })
                                : await teamStatuses.updateOne({ domainId, contestId: tid, teamId: who.teamId }, { $set: projection });
                            if (updated.matchedCount !== 1) throw new Error('set_recalc_status_missing');
                            for (const round of rounds.filter((entry) => entry.statusDirty)) {
                                await assertCurrent();
                                const acknowledged = await c.rounds.updateOne({ ...scope, _id: round._id, participantKey: key },
                                    { $set: { statusDirty: false } });
                                if (acknowledged.matchedCount !== 1) throw new Error('set_recalc_round_missing');
                            }
                        });
                    }
                } catch (error) {
                    progress.failed = true;
                    throw error;
                }
            };
            const results = await Promise.allSettled(Array.from({ length: RECALC_CONCURRENCY }, worker));
            for (const result of results) if (result.status === 'rejected') throw result.reason;
        }
        await assertCurrent();
        const cleared = await c.contests.updateOne({ ...contestFilter, statusRecalcToken: token }, { $unset: { statusRecalcToken: '' } });
        if (cleared.matchedCount !== 1) throw new Error('set_recalc_superseded');
        input.logger.info(`set score recalc complete ${summary()}`);
    } catch (error) {
        input.logger.error(`set score recalc failed ${summary()} error=${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
