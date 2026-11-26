import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { arch, availableParallelism, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BSON, MongoClient, ObjectId, type Collection, type Db, type Document, type Filter } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createDraftConfig, RECALC_CONCURRENCY, STATUS, type SetConfig } from '@hydrooj/common';
import { recalcSetScores, type RecalcCollection } from '../src/lib/set-recalc';
import { withSetParticipantBoundary } from '../src/lib/set-participant-boundary';
import type { SetParticipantProjection } from '../src/lib/set-score-projection';
import type { RoundDoc } from '../src/model/set-round';

const STUDENTS = 500;
const ROUNDS = 3;
const CODE_PROBLEMS = 20;
const OBJECTIVE_PROBLEMS = 20;
const ATTEMPTS = 5;
const INSERT_BATCH = 5000;
const DOMAIN_ID = 'isolated-set-benchmark';
const CONCURRENT_UID = 500;
const CONCURRENT_SCORE = 90;
const PROBLEMS = CODE_PROBLEMS + OBJECTIVE_PROBLEMS;
const PAPER = Array.from({ length: PROBLEMS }, (_, index) => index + 1);
const CODE_PIDS = new Set(PAPER.filter((pid) => pid <= CODE_PROBLEMS));
const STARTED = new Date(Date.now() - 3 * 3_600_000);
const CLOSED = new Date(STARTED.getTime() + 3_600_000);
const OUTPUT = mkdtempSync(join(tmpdir(), 'krypton-set-recalc-'));
const REPORT = join(OUTPUT, 'recalc.json');

interface Stats {
    operations: number;
    active: number;
    peak: number;
}
interface Measurement {
    name: string;
    elapsedMs: number;
    recalcElapsedMs: number;
    databaseCommands: number;
    databasePeakInFlight: number;
    collectionOperations: number;
    peakRecalcConcurrency: number;
    commandNames: Record<string, number>;
    processPeakRssBytes: number;
}

function timings(runs: readonly Measurement[]) {
    const samplesMs = runs.map((run) => run.elapsedMs);
    const sorted = [...samplesMs].sort((a, b) => a - b);
    return { n: sorted.length, method: 'nearest-rank', samplesMs,
        p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}
function enter(stats: Stats) {
    stats.operations++;
    stats.active++;
    stats.peak = Math.max(stats.peak, stats.active);
}
function watch(collection: Collection<Document>, stats: Stats, beforeRead?: (filter: Document) => void): RecalcCollection {
    return {
        find(filter) {
            return { toArray: async () => {
                enter(stats);
                try {
                    beforeRead?.(filter);
                    return await collection.find(filter).toArray();
                } finally { stats.active--; }
            } };
        },
        async updateOne(filter, update) {
            enter(stats);
            try {
                return await collection.updateOne(filter, update);
            } finally { stats.active--; }
        },
    };
}

function bestCodeScore(roundNo: number, pid: number): number {
    return pid === 1 ? roundNo * 10 : 10;
}
function acceptedAt(roundNo: number, pid: number, attempt = ATTEMPTS - 1): Date {
    return new Date(STARTED.getTime() + roundNo * 100_000 + pid * 1000 + attempt * 100);
}

/** Load the production round model against this process's fresh MongoDB only. */
function loadRoundModel(db: Db, tid: ObjectId) {
    const previous = new Map<string, NodeModule | undefined>();
    const stub = (path: string, exports: unknown) => {
        const id = require.resolve(path);
        previous.set(id, require.cache[id]);
        require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
    };
    const statuses = db.collection('document.status');
    stub('../src/service/db.ts', { __esModule: true, default: { collection: (name: string) => db.collection(name) } });
    stub('../src/model/contest.ts', {
        get: async (domainId: string, contestId: ObjectId) => {
            assert.equal(domainId, DOMAIN_ID);
            assert.ok(contestId.equals(tid));
            const doc = await db.collection('document').findOne({ domainId, docType: 30, docId: tid });
            assert.ok(doc);
            return doc;
        },
        persistSetParticipantStatus: async (domainId: string, contestId: ObjectId, uid: number,
            teamId: ObjectId | null | undefined, projection: SetParticipantProjection) => {
            assert.equal(teamId == null, true);
            const result = await statuses.updateOne({ domainId, docType: 30, docId: contestId, uid }, { $set: projection });
            assert.equal(result.matchedCount, 1);
        },
    });
    stub('../src/model/contest-participation.ts', { isTeamBatchFinalizationPending: () => false });
    stub('../src/model/problem.ts', { __esModule: true, default: {
        get: async (domainId: string, pid: number) => {
            assert.equal(domainId, DOMAIN_ID);
            assert.ok(PAPER.includes(pid));
            return pid <= CODE_PROBLEMS ? { problemKind: 'programming', config: { type: 'default' } }
                : { problemKind: 'single', config: { type: 'objective', answers: { main: ['A', 100] } } };
        },
    } });
    stub('../src/model/record.ts', { __esModule: true, default: { coll: db.collection('record') } });
    try {
        return require('../src/model/set-round.ts') as typeof import('../src/model/set-round');
    } finally {
        for (const [id, original] of previous) {
            if (original) require.cache[id] = original;
            else delete require.cache[id];
        }
    }
}

async function digest(db: Db, scopes: ReadonlyArray<{ name: string; filter: Filter<Document> }>) {
    const hash = createHash('sha256');
    let count = 0;
    for (const { name, filter } of scopes) {
        hash.update(name);
        for await (const doc of db.collection(name).find(filter).sort({ _id: 1 })) {
            hash.update(BSON.serialize(doc));
            count++;
        }
    }
    return { count, sha256: hash.digest('hex') };
}

async function main() {
    // Downloads stay disabled. A supplied binary or the existing local installation/cache is required.
    process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
    const systemBinary = process.env.SET_RECALC_MONGO_BINARY
        ?? (existsSync('/opt/homebrew/bin/mongod') ? '/opt/homebrew/bin/mongod' : undefined);
    const dbName = `set_recalc_${randomUUID().replaceAll('-', '')}`;
    let server: MongoMemoryServer | undefined;
    let client: MongoClient | undefined;
    const report: Record<string, unknown> = { ok: false, database: dbName, output: REPORT,
        hardware: { os: platform(), release: release(), architecture: arch(), cpuModels: [...new Set(cpus().map((cpu) => cpu.model))],
            logicalCpus: cpus().length, availableParallelism: availableParallelism(), ramBytes: totalmem(), node: process.version },
        batching: { seedInsertBatchSize: INSERT_BATCH, recalcWriteBatchSize: 1, recalcWorkers: RECALC_CONCURRENCY,
            recalcWriteMethod: 'updateOne' } };
    try {
        server = await MongoMemoryServer.create({ binary: { systemBinary }, instance: { dbName } });
        const uri = server.getUri(dbName);
        const endpoint = new URL(uri);
        assert.equal(endpoint.hostname, '127.0.0.1');
        assert.notEqual(endpoint.port, '27017');
        client = new MongoClient(uri, { monitorCommands: true, directConnection: true });
        await client.connect();
        const db = client.db(dbName);
        assert.equal(await db.listCollections().toArray().then((rows) => rows.length), 0);
        Object.assign(report, { isolatedPort: Number(endpoint.port), mongoVersion: (await db.admin().buildInfo()).version });
        const contests = db.collection<Document>('document');
        const statuses = db.collection<Document>('document.status');
        const rounds = db.collection<Document>('contest.rounds');
        const answers = db.collection<Document>('contest.answers');
        const records = db.collection<Document>('record');
        const tid = new ObjectId();
        const otherTid = new ObjectId();
        const config: SetConfig = createDraftConfig('homework');
        config.publication = 'published';
        config.settings.retake.extra = ROUNDS - 1;
        config.settings.retake.passScore = 400;
        await contests.insertMany([
            { domainId: DOMAIN_ID, docType: 30, docId: tid, title: 'benchmark', pids: PAPER,
                beginAt: STARTED, endAt: CLOSED, setConfig: config, score: {} },
            { domainId: DOMAIN_ID, docType: 30, docId: otherTid, title: 'control', untouched: ['control'] },
        ]);
        const targetRounds: RoundDoc[] = [];
        const statusDocs: Document[] = [];
        const bestRecords = new Map<string, ObjectId>();
        let raceRecordId: ObjectId | undefined;
        for (let uid = 1; uid <= STUDENTS; uid++) {
            statusDocs.push({ domainId: DOMAIN_ID, docType: 30, docId: tid, uid, score: -1,
                journal: [{ preserved: true }], startAt: STARTED });
            for (let roundNo = 1; roundNo <= ROUNDS; roundNo++) {
                targetRounds.push({ _id: new ObjectId(), domainId: DOMAIN_ID, tid, participantKey: `u:${uid}`,
                    roundNo, state: 'closed', startedAt: STARTED, closedAt: CLOSED,
                    paperPids: PAPER, total: -1, passed: false });
            }
        }
        await statuses.insertMany(statusDocs);
        await rounds.insertMany(targetRounds);
        let answerBatch: Document[] = [];
        let recordBatch: Document[] = [];
        for (const round of targetRounds) {
            const uid = Number(round.participantKey.slice(2));
            for (const pid of PAPER) {
                if (pid > CODE_PROBLEMS) {
                    answerBatch.push({ domainId: DOMAIN_ID, roundId: round._id, pid, version: 1,
                        operationId: 'seed', acceptedAt: acceptedAt(round.roundNo, pid), body: { main: 'B' },
                        rawScore: 5, status: STATUS.STATUS_WRONG_ANSWER, judgeResult: { main: 'partial' } });
                    if (answerBatch.length >= INSERT_BATCH) {
                        await answers.insertMany(answerBatch);
                        answerBatch = [];
                    }
                    continue;
                }
                for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
                    const rid = new ObjectId();
                    recordBatch.push({ _id: rid, domainId: DOMAIN_ID, contest: tid, setRoundId: round._id, uid, pid,
                        score: bestCodeScore(round.roundNo, pid) * (attempt + 1) / ATTEMPTS,
                        status: STATUS.STATUS_WRONG_ANSWER, setAcceptedAt: acceptedAt(round.roundNo, pid, attempt),
                        judgeAt: new Date(CLOSED.getTime() + 60_000) });
                    if (attempt === ATTEMPTS - 1) bestRecords.set(`${uid}:${round.roundNo}:${pid}`, rid);
                    if (uid === CONCURRENT_UID && round.roundNo === 1 && pid === 1 && attempt === ATTEMPTS - 1) raceRecordId = rid;
                    if (recordBatch.length >= INSERT_BATCH) {
                        await records.insertMany(recordBatch);
                        recordBatch = [];
                    }
                }
            }
        }
        if (answerBatch.length) await answers.insertMany(answerBatch);
        if (recordBatch.length) await records.insertMany(recordBatch);
        assert.ok(raceRecordId);
        const controlRound = new ObjectId();
        await rounds.insertOne({ domainId: DOMAIN_ID, tid: otherTid, participantKey: 'u:1', _id: controlRound, total: 777 });
        await statuses.insertOne({ domainId: DOMAIN_ID, docType: 30, docId: otherTid, uid: 1, score: 777 });
        await answers.insertOne({ domainId: DOMAIN_ID, roundId: controlRound, pid: 1, rawScore: 777 });
        await records.insertOne({ domainId: DOMAIN_ID, contest: otherTid, setRoundId: controlRound, uid: 1, pid: 1, score: 777 });
        const model = loadRoundModel(db, tid);
        await model.apply({ db: { ensureIndexes: async (collection: Collection<Document>, ...indexes: Document[]) => {
            await collection.createIndexes(indexes as Parameters<Collection<Document>['createIndexes']>[0]);
        } } } as Parameters<typeof model.apply>[0]);
        // These are the production lookup indexes, not benchmark-only natural-scan shortcuts.
        await records.createIndex({ domainId: 1, setRoundId: 1 }, { name: 'setRoundRecords', partialFilterExpression: { setRoundId: { $exists: true } } });
        await statuses.createIndex({ domainId: 1, docType: 1, docId: 1, uid: 1 });
        await contests.createIndex({ domainId: 1, docType: 1, docId: 1 });
        const officialFacts = await answers.countDocuments({ roundId: { $ne: controlRound } })
            + await records.countDocuments({ contest: tid });
        assert.equal(officialFacts, STUDENTS * ROUNDS * (CODE_PROBLEMS * ATTEMPTS + OBJECTIVE_PROBLEMS));
        const controlScopes = [
            { name: 'document', filter: { docId: otherTid } }, { name: 'document.status', filter: { docId: otherTid } },
            { name: 'contest.rounds', filter: { tid: otherTid } }, { name: 'contest.answers', filter: { roundId: controlRound } },
            { name: 'record', filter: { contest: otherTid } },
        ];
        const rawScopes = [
            { name: 'contest.answers', filter: { roundId: { $ne: controlRound } } },
            { name: 'record', filter: { contest: tid, _id: { $ne: raceRecordId } } },
        ];
        const controlBefore = await digest(db, controlScopes);
        const rawBefore = await digest(db, rawScopes);
        let activeMeasurement: { db: Stats; names: Record<string, number> } | null = null;
        const commands = new Map<number, NonNullable<typeof activeMeasurement>>();
        client.on('commandStarted', (event) => {
            if (!activeMeasurement || event.databaseName !== dbName) return;
            enter(activeMeasurement.db);
            activeMeasurement.names[event.commandName] = (activeMeasurement.names[event.commandName] ?? 0) + 1;
            commands.set(event.requestId, activeMeasurement);
        });
        const completed = (event: { requestId: number }) => {
            const measurement = commands.get(event.requestId);
            if (measurement) measurement.db.active--;
            commands.delete(event.requestId);
        };
        client.on('commandSucceeded', completed);
        client.on('commandFailed', completed);
        const logs: string[] = [];
        const trace: string[] = [];
        const racedRound = targetRounds.find((round) => round.participantKey === `u:${CONCURRENT_UID}` && round.roundNo === 1)!;
        const verify = async (weights: Record<number, number>, raced: boolean) => {
            const actualRounds = await rounds.find({ domainId: DOMAIN_ID, tid }).sort({ participantKey: 1, roundNo: 1 }).toArray();
            const actualStatuses = await statuses.find({ domainId: DOMAIN_ID, docId: tid }).toArray();
            assert.equal(actualRounds.length, STUDENTS * ROUNDS);
            assert.equal(actualStatuses.length, STUDENTS);
            const byUid = new Map<number, Document[]>();
            for (const actual of actualRounds) {
                const uid = Number(actual.participantKey.slice(2));
                let expectedTotal = 0;
                for (const pid of PAPER) {
                    const code = pid <= CODE_PROBLEMS;
                    const raw = code ? raced && uid === CONCURRENT_UID && actual.roundNo === 1 && pid === 1
                        ? CONCURRENT_SCORE : bestCodeScore(actual.roundNo, pid) : 5;
                    const expected = raw * (weights[pid] ?? 100) / 100;
                    expectedTotal += expected;
                    const detail = actual.detail[pid];
                    assert.equal(detail.pid, pid);
                    assert.equal(detail.score, expected, `${uid}/${actual.roundNo}/${pid} score`);
                    assert.equal(detail.status, STATUS.STATUS_WRONG_ANSWER);
                    assert.equal(detail.acceptedAt.getTime(), acceptedAt(actual.roundNo, pid).getTime());
                    if (code) assert.ok(detail.rid.equals(bestRecords.get(`${uid}:${actual.roundNo}:${pid}`)));
                }
                assert.equal(Object.keys(actual.detail).length, PROBLEMS);
                assert.equal(actual.total, expectedTotal);
                assert.equal(actual.passed, expectedTotal >= 400);
                assert.equal(actual.accept, 0);
                assert.equal(actual.penaltySeconds, 0);
                assert.equal(actual.judgePending, false);
                assert.equal(actual.scoreDirty, false);
                assert.equal(actual.statusDirty, false);
                assert.equal(actual.scoreRevision, config.revision);
                byUid.set(uid, [...byUid.get(uid) ?? [], actual]);
            }
            for (const status of actualStatuses) {
                const candidates = byUid.get(status.uid)!;
                const selected = candidates.reduce((best, round) => round.total > best.total ? round : best);
                assert.equal(status.score, selected.total);
                assert.equal(status.setRoundNo, selected.roundNo);
                assert.ok(status.setRoundId.equals(selected._id));
                assert.equal(status.setRoundClosedAt.getTime(), CLOSED.getTime());
                assert.equal(status.setScoreRevision, config.revision);
                assert.deepEqual(status.detail, selected.detail);
                assert.deepEqual(status.display, selected.detail);
                assert.equal(status.setJudgePending, false);
                assert.equal(status.accept, 0);
                assert.equal(status.time, 0);
                assert.deepEqual(status.journal, [{ preserved: true }]);
                assert.equal(status.startAt.getTime(), STARTED.getTime());
            }
            assert.deepEqual(await digest(db, controlScopes), controlBefore);
            assert.deepEqual(await digest(db, rawScopes), rawBefore);
            assert.equal((await contests.findOne({ docId: tid }))?.statusRecalcToken, undefined);
            return { rounds: actualRounds.length, statuses: actualStatuses.length, detailCells: actualRounds.length * PROBLEMS,
                raceSelectedRound: actualStatuses.find((status) => status.uid === CONCURRENT_UID)!.setRoundNo };
        };
        let judgeApplied = false;
        const run = async (name: string, changedPids: number[], weights: Record<number, number>, race: boolean,
            options: { sameRevision?: boolean; failStatus?: boolean } = {}) => {
            if (!options.sameRevision) {
                config.revision++;
                await contests.updateOne({ docId: tid }, { $set: { setConfig: config, score: weights } });
            }
            const stats: Stats = { operations: 0, active: 0, peak: 0 };
            const metric = { db: { operations: 0, active: 0, peak: 0 }, names: {} as Record<string, number> };
            let token: string | undefined;
            let statusFailureInjected = false;
            let releaseJudge!: () => void;
            let triggerSeen = false;
            let bulkParticipantFinished = false;
            const pendingAcks = new Set(targetRounds.filter((round) => round.participantKey === `u:${CONCURRENT_UID}`)
                .map((round) => round._id.toHexString()));
            const trigger = new Promise<void>((resolve) => { releaseJudge = resolve; });
            // Started outside the recalculation's AsyncLocalStorage context: this must wait for its lock.
            const judgeTask = race ? (async () => {
                await trigger;
                trace.push('judge-request-queued');
                await withSetParticipantBoundary(DOMAIN_ID, tid, `u:${CONCURRENT_UID}`, async () => {
                    assert.equal(bulkParticipantFinished, true, 'judge must wait until bulk score and status writes finish');
                    trace.push('judge-participant-lock-acquired');
                    await model.markRoundScoreDirty(DOMAIN_ID, tid, racedRound._id);
                    const update = await records.updateOne({ _id: raceRecordId }, { $set: { score: CONCURRENT_SCORE, judgeAt: new Date() } });
                    assert.equal(update.matchedCount, 1);
                    const projected = await model.projectParticipantStatus(DOMAIN_ID, tid, CONCURRENT_UID, undefined, racedRound._id);
                    const statusWritten = await statuses.updateOne({ domainId: DOMAIN_ID, docType: 30, docId: tid, uid: CONCURRENT_UID },
                        { $set: projected });
                    assert.equal(statusWritten.matchedCount, 1);
                    await model.acknowledgeParticipantStatus(DOMAIN_ID, tid, CONCURRENT_UID);
                    judgeApplied = true;
                    trace.push('judge-status-persisted');
                });
            })() : null;
            const judgeResult = judgeTask ? Promise.allSettled([judgeTask]) : null;
            const baseRounds = watch(rounds, stats);
            const baseContests = watch(contests, stats);
            const baseStatuses = watch(statuses, stats);
            const collections = {
                contests: { find: baseContests.find, updateOne: async (filter: Document, update: Document) => {
                    if (typeof update.$set?.statusRecalcToken === 'string') token = update.$set.statusRecalcToken;
                    return baseContests.updateOne(filter, update);
                } },
                statuses: { find: baseStatuses.find, updateOne: async (filter: Document, update: Document) => {
                    if (options.failStatus && !statusFailureInjected && filter.uid === 137) {
                        statusFailureInjected = true;
                        throw new Error('benchmark_status_write_failure');
                    }
                    return baseStatuses.updateOne(filter, update);
                } },
                answers: watch(answers, stats),
                records: watch(records, stats, (filter) => {
                    if (!race || triggerSeen || !(filter.setRoundId instanceof ObjectId) || !filter.setRoundId.equals(racedRound._id)) return;
                    triggerSeen = true;
                    trace.push('bulk-participant-read');
                    releaseJudge();
                }),
                rounds: {
                    find: baseRounds.find,
                    updateOne: async (filter: Document, update: Document) => {
                        const result = await baseRounds.updateOne(filter, update);
                        if (race && filter.participantKey === `u:${CONCURRENT_UID}` && update.$set?.statusDirty === false) {
                            assert.equal(pendingAcks.delete(filter._id.toHexString()), true);
                            if (pendingAcks.size === 0) {
                                bulkParticipantFinished = true;
                                trace.push('bulk-participant-status-acknowledged');
                            }
                        }
                        return result;
                    },
                },
            };
            activeMeasurement = metric;
            const started = performance.now();
            let recalcElapsedMs = 0;
            try {
                const recalc = recalcSetScores({ domainId: DOMAIN_ID, tid, changedPids, score: weights, codePids: CODE_PIDS,
                    collections, logger: { info: (message) => logs.push(message), error: (message) => logs.push(message) },
                    expectedRevision: config.revision });
                if (options.failStatus) await assert.rejects(recalc, /benchmark_status_write_failure/);
                else await recalc;
                recalcElapsedMs = performance.now() - started;
                assert.equal(race ? triggerSeen : true, true);
                if (judgeResult) {
                    const [result] = await judgeResult;
                    if (result.status === 'rejected') throw result.reason;
                }
            } finally {
                activeMeasurement = null;
            }
            const measurement: Measurement = { name, elapsedMs: Math.round(performance.now() - started),
                recalcElapsedMs: Math.round(recalcElapsedMs), databaseCommands: metric.db.operations,
                databasePeakInFlight: metric.db.peak, collectionOperations: stats.operations,
                peakRecalcConcurrency: stats.peak, commandNames: metric.names,
                processPeakRssBytes: process.resourceUsage().maxRSS * 1024 };
            assert.ok(measurement.peakRecalcConcurrency <= RECALC_CONCURRENCY);
            // The independent judge owns one additional sequential database operation.
            assert.ok(measurement.databasePeakInFlight <= RECALC_CONCURRENCY + (race ? 1 : 0));
            assert.equal(stats.active, 0);
            assert.equal(metric.db.active, 0);
            assert.ok(token);
            if (options.failStatus) {
                assert.equal(statusFailureInjected, true);
                const failedContest = await contests.findOne({ docId: tid });
                assert.equal(failedContest?.statusRecalcToken, token);
                assert.equal(failedContest?.setConfig.revision, config.revision);
                assert.equal(await rounds.countDocuments({ domainId: DOMAIN_ID, tid, participantKey: 'u:137', statusDirty: true }), ROUNDS);
                assert.notEqual((await statuses.findOne({ docId: tid, uid: 137 }))?.setScoreRevision, config.revision);
                assert.deepEqual(await digest(db, controlScopes), controlBefore);
                assert.deepEqual(await digest(db, rawScopes), rawBefore);
                return { ...measurement, revision: config.revision, weights, token, rejected: true, verified: null };
            }
            return { ...measurement, revision: config.revision, weights, token, rejected: false, verified: await verify(weights, judgeApplied) };
        };
        const single = [];
        for (const weight of [200, 180, 220]) single.push(await run(`single-weight-${weight}`, [1], { 1: weight }, false));
        assert.equal(single[2].verified.raceSelectedRound, 3);
        const batch = [];
        for (const index of [0, 1, 2]) {
            batch.push(await run(`three-weights-${index + 1}${index === 2 ? '-with-judge-writeback' : ''}`, [1, 2, 21],
                { 1: 160 + index * 20, 2: 140 + index * 10, 21: 180 + index * 20 }, index === 2));
        }
        assert.equal(batch[2].verified.raceSelectedRound, 1);
        const retryWeights = { 1: 210, 2: 170, 21: 230 };
        const rejected = await run('status-write-failure', [1, 2, 21], retryWeights, false, { failStatus: true });
        const recovered = await run('same-revision-status-recovery', [1, 2, 21], retryWeights, false, { sameRevision: true });
        assert.equal(rejected.revision, recovered.revision);
        assert.notEqual(rejected.token, recovered.token);
        assert.deepEqual(trace, ['bulk-participant-read', 'judge-request-queued', 'bulk-participant-status-acknowledged',
            'judge-participant-lock-acquired', 'judge-status-persisted']);
        Object.assign(report, { ok: true, mongo: true, isolatedPort: Number(endpoint.port), students: STUDENTS,
            roundsPerStudent: ROUNDS, officialFacts, codeRecords: STUDENTS * ROUNDS * CODE_PROBLEMS * ATTEMPTS,
            officialAnswers: STUDENTS * ROUNDS * OBJECTIVE_PROBLEMS, concurrencyCap: RECALC_CONCURRENCY,
            runs: [...single, ...batch], latency: { singleWeight: timings(single), threeWeights: timings(batch) },
            failureRecovery: { rejected, recovered, sameRevision: true, failureTokenRetained: true,
                retryUsesFreshToken: true, finalTokenCleared: true, dirtyTargetRoundsBeforeRetry: ROUNDS },
            concurrentJudgeTrace: trace, controls: controlBefore, unchangedFacts: rawBefore, logs });
    } catch (error) {
        Object.assign(report, { error: error instanceof Error ? error.stack : String(error) });
        process.exitCode = 1;
    } finally {
        const cleanupErrors: string[] = [];
        try {
            if (client) await client.close();
        } catch (error) {
            cleanupErrors.push(error instanceof Error ? error.message : String(error));
        }
        try {
            if (server) await server.stop();
        } catch (error) {
            cleanupErrors.push(error instanceof Error ? error.message : String(error));
        }
        report.cleanedUp = cleanupErrors.length === 0;
        report.processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
        if (cleanupErrors.length) {
            report.cleanupErrors = cleanupErrors;
            report.ok = false;
            process.exitCode = 1;
        }
        writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
        console.log(JSON.stringify({ ok: report.ok, report: REPORT, officialFacts: report.officialFacts,
            hardware: report.hardware, processPeakRssBytes: report.processPeakRssBytes, latency: report.latency,
            failureRecovery: report.failureRecovery, error: report.error }));
    }
}

void main();
