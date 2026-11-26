import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { BSON, MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import {
    assertExamPaperPoolSatisfiesQuotas,
    assertSetCombination,
    LEGACY_CONTEST_RULES,
    parseFrozenExamPaperPids,
    mapLegacyContest,
    proveLegacyRound,
    roundPassed,
    roundTotal,
    stableAnswerBody,
    STATUS,
    type CodeAttempt,
    type LegacyContestRule,
    type OfficialAnswer,
    type ProblemKind,
    type SetProblemFact,
    type SetConfig,
} from '@hydrooj/common';
import { judgedSetAttempts } from './set-judged-attempts';
import { setProblemFact } from './set-problem-fact';

export const SET_MIGRATE_COLLECTIONS = [
    'document', 'document.status', 'record', 'vigil.paper_draft',
    'contest.teams', 'contest.teamStatuses', 'contest.rounds', 'contest.answers', 'contest.answerOperations',
] as const;
export type MigrationCollection = typeof SET_MIGRATE_COLLECTIONS[number];
export type MigrationSnapshot = Record<MigrationCollection, Document[]>;
export interface MigrationScope { domainId: string; tids: ObjectId[] }
export interface MigrationMutation { collection: MigrationCollection; id: ObjectId; before: Document | null; after: Document }
export interface MigrationDiagnostic { tid: string; participantKey?: string; code: string }
export interface MigrationParticipant {
    tid: string;
    participantKey: string;
    roundNo: number;
    missingRounds: number;
    scoreLocked: boolean;
    total: number;
}
export interface MigratePlan {
    schemaVersion: 1;
    databaseName: string;
    connectionFingerprint: string;
    scope: MigrationScope;
    now: Date;
    diagnostics: MigrationDiagnostic[];
    participants: MigrationParticipant[];
    mutations: MigrationMutation[];
    protected: Record<MigrationCollection, { count: number; hash: string }>;
    fingerprint: string;
}
export interface MigrateStore {
    databaseName: string;
    connectionFingerprint: string;
    snapshot(): Promise<MigrationSnapshot>;
    compareAndSwap(mutation: MigrationMutation): Promise<boolean>;
}
export interface MigrationGates {
    fingerprint: string;
    confirm: string;
    backupConfirmed: string;
    serviceStopped: boolean;
}

function fail(code: string): never { throw new TypeError(code); }
function object(value: unknown, field: string): Document {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`set_migrate_invalid_${field}`);
    return value as Document;
}
function number(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`set_migrate_invalid_${field}`);
    return value;
}
function oid(value: unknown, field: string): ObjectId {
    if (!(value instanceof ObjectId)) fail(`set_migrate_invalid_${field}`);
    return value;
}
function sameId(left: unknown, right: ObjectId): boolean { return left instanceof ObjectId && left.equals(right); }
function ids(value: unknown, field: string): number[] {
    if (!Array.isArray(value) || value.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
        || new Set(value).size !== value.length) fail(`set_migrate_invalid_${field}`);
    return value;
}
function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
    return value;
}
export function migrationHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(ordered(BSON.EJSON.serialize(value, { relaxed: false })))).digest('hex');
}
function same(left: unknown, right: unknown): boolean { return migrationHash(left) === migrationHash(right); }
function deterministicId(...scope: string[]): ObjectId { return new ObjectId(migrationHash(scope).slice(0, 24)); }
function collectionFacts(rows: Document[]): { count: number; hash: string } {
    return { count: rows.length, hash: migrationHash(rows.map((row) => migrationHash(row)).sort()) };
}
function protectedFacts(snapshot: MigrationSnapshot, mutations: readonly MigrationMutation[]): MigratePlan['protected'] {
    return Object.fromEntries(SET_MIGRATE_COLLECTIONS.map((collection) => {
        const targets = new Set(mutations.filter((item) => item.collection === collection).map((item) => item.id.toHexString()));
        return [collection, collectionFacts(snapshot[collection].filter((row) => !(row._id instanceof ObjectId) || !targets.has(row._id.toHexString())))];
    })) as MigratePlan['protected'];
}
export function migrationFingerprint(plan: Omit<MigratePlan, 'fingerprint'> | MigratePlan): string {
    const { fingerprint: _fingerprint, ...body } = plan as MigratePlan;
    return migrationHash(body);
}
function mutation(collection: MigrationCollection, before: Document | null, after: Document): MigrationMutation {
    return { collection, id: oid(after._id, '_id'), before, after };
}
function inContest(row: Document, domainId: string, tid: ObjectId, field: string): boolean {
    return row.domainId === domainId && sameId(row[field], tid);
}
function uniqueBy(rows: Document[], key: (row: Document) => string, label: string): Map<string, Document> {
    const result = new Map<string, Document>();
    for (const row of rows) {
        const value = key(row);
        if (result.has(value)) fail(`set_migrate_duplicate_${label}:${value}`);
        result.set(value, row);
    }
    return result;
}
function recordTime(row: Document): Date { return oid(row._id, 'record_id').getTimestamp(); }
function parsedConfig(doc: Document): Document {
    let config: unknown;
    try {
        config = typeof doc.config === 'string' ? yaml.load(doc.config) : doc.config;
    } catch (cause) {
        throw new TypeError(`set_migrate_problem_config_parse_invalid:${doc.docId}`, { cause });
    }
    return object(config, 'problem_config');
}
function officialBody(record: Document, kind: string): unknown {
    if (typeof record.code !== 'string') fail('set_migrate_official_body_missing');
    if (kind === 'subjective') return { main: record.code };
    let body: unknown;
    try {
        body = kind === 'program_fill' ? JSON.parse(record.code) : yaml.load(record.code);
    } catch (cause) {
        throw new TypeError(`set_migrate_official_body_parse_invalid:${record._id}`, { cause });
    }
    const answer = object(body, 'official_body');
    if (Object.values(answer).some((value) => typeof value !== 'string' && (!Array.isArray(value) || !value.every((part) => typeof part === 'string')))) {
        fail('set_migrate_official_body_invalid');
    }
    return answer;
}

function equivalentScore(left: number, right: number, terms = 1): boolean {
    // Legacy and current scoring multiply/divide and sum in different orders.
    return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * Math.max(1, terms) * 4;
}

/** Legacy displayed totals use three different fields; normalize once, retaining the source field in provenance. */
function historicalScore(contest: Document, status: Document, pids: number[], hasFacts: boolean) {
    const rule = contest.rule as LegacyContestRule;
    const sourceScoreField = rule === 'homework' ? 'penaltyScore' : rule === 'acm' ? 'accept' : 'score';
    const rawDetail = status.detail === undefined && !hasFacts ? {} : object(status.detail, 'status_detail');
    const total = status[sourceScoreField] === undefined && !hasFacts ? 0 : number(status[sourceScoreField], `status_${sourceScoreField}`);
    const detail: Record<number, Document> = {};
    for (const [key, value] of Object.entries(rawDetail)) {
        const item = object(value, 'status_detail_item');
        const pid = Number(key);
        if (!pids.includes(pid) || item.pid !== pid) fail('set_migrate_detail_pid_conflict');
        const statusCode = number(item.status, 'detail_status');
        const weight = contest.score?.[pid] || 100;
        const score = rule === 'acm' ? Number(statusCode === STATUS.STATUS_ACCEPTED)
            : rule === 'homework' ? number(item.penaltyScore, 'detail_penaltyScore')
                : rule === 'ledo' ? (number(item.penaltyScore, 'detail_penaltyScore') * weight) / 100
                    : (number(item.score, 'detail_score') * weight) / 100;
        const rid = oid(item.rid, 'detail_rid');
        detail[pid] = { pid, score, status: statusCode, rid, acceptedAt: rid.getTimestamp() };
        if (rule === 'acm') {
            detail[pid].penalty = number(item.penalty, 'detail_penalty');
            detail[pid].real = number(item.real, 'detail_real');
        }
    }
    if (!equivalentScore(Object.values(detail).reduce((sum, item) => sum + item.score, 0), total, pids.length)) fail('set_migrate_stored_score_detail_conflict');
    const accept = rule === 'acm' ? total : 0;
    const penaltySeconds = rule === 'acm' ? (status.time === undefined && !hasFacts ? 0 : number(status.time, 'status_time')) : 0;
    if (rule === 'acm' && Object.values(detail).reduce((sum, item) => sum + (item.score ? item.penalty + item.real : 0), 0) !== penaltySeconds) {
        fail('set_migrate_stored_penalty_conflict');
    }
    return { total, detail, accept, penaltySeconds, sourceScoreField };
}

function planParticipant(
    snapshot: MigrationSnapshot, contest: Document, config: SetConfig, status: Document,
    key: string, allRecords: Document[], statusCollection: 'document.status' | 'contest.teamStatuses', now: Date,
): { mutations: MigrationMutation[]; participant?: MigrationParticipant } {
    const tid = oid(contest.docId, 'contest_docId');
    const pool = ids(contest.pids, 'contest_pids');
    const journal: Document[] = status.journal === undefined ? [] : Array.isArray(status.journal)
        ? status.journal.map((row) => object(row, 'journal')) : fail('set_migrate_invalid_journal');
    const floor = status.examJournalAfter;
    if (floor !== undefined) oid(floor, 'examJournalAfter');
    const currentRecords = allRecords.filter((row) => !floor || oid(row._id, 'record_id').toHexString() > floor.toHexString());
    const hasFacts = currentRecords.length > 0 || journal.length > 0 || Object.keys(status.detail ?? {}).length > 0
        || ['score', 'penaltyScore', 'accept', 'time'].some((field) => status[field] !== undefined && number(status[field], `status_${field}`) !== 0);
    const proof = proveLegacyRound({
        rule: contest.rule, beginAt: contest.beginAt, endAt: contest.endAt, now,
        startAt: status.startAt, finalizedAt: status.paperFinalizedAt, attemptsUsed: status.examAttemptsUsed,
        personalLimitHours: config.settings.personalLimit.hours, hasOfficialFacts: hasFacts, hasJournalFloor: floor instanceof ObjectId,
    });
    if (!proof) return { mutations: [] };
    const pids = config.settings.draw.enabled && config.settings.draw.quotas
        ? parseFrozenExamPaperPids(status.examPaperPids, config.settings.draw.quotas) : pool;
    if (pids.some((pid) => !pool.includes(pid))) fail('set_migrate_paper_outside_pool');
    const roundId = deterministicId('set-round-v1', contest.domainId, tid.toHexString(), key, String(proof.roundNo));
    const history = historicalScore(contest, status, pids, hasFacts);
    const recordsById = uniqueBy(currentRecords, (row) => oid(row._id, 'record_id').toHexString(), 'record');
    const journalById = uniqueBy(journal, (row) => oid(row.rid, 'journal_rid').toHexString(), 'journal');
    const incompleteReasons = new Set<string>();
    for (const item of journal) {
        if (floor && oid(item.rid, 'journal_rid').toHexString() <= floor.toHexString()) fail('set_migrate_journal_before_floor');
        const record = recordsById.get(item.rid.toHexString());
        if (!record) {
            incompleteReasons.add('missing_record');
            continue;
        }
        // Older exam writers left pid-0 waiting placeholders after grading. Keep the
        // stored grade locked; migration must not silently repair historical marks.
        if (contest.rule === 'exam' && item.pid === 0 && item.status === STATUS.STATUS_WAITING && item.score === 0
            && item.subtasks == null && item.lang == null && item.manual !== true
            && !Object.values(history.detail).some((detail) => detail.rid.equals(item.rid))) {
            incompleteReasons.add('exam_waiting_placeholder');
            continue;
        }
        // Strict IOI's legacy stat mutates journal entries into accumulated subtask scores.
        // ACM journals retain verdicts; their raw points and subtasks were not used.
        if (record.pid !== item.pid || (contest.rule !== 'strictioi' && (record.status !== item.status
            || (contest.rule !== 'acm' && (record.score !== item.score || !same(record.subtasks ?? {}, item.subtasks ?? {})))))) {
            fail('set_migrate_record_journal_conflict');
        }
    }
    for (const item of Object.values(history.detail)) if (!recordsById.has(item.rid.toHexString())) incompleteReasons.add('missing_record');
    const mutations: MigrationMutation[] = [];
    const attempts: CodeAttempt[] = [];
    const answers: OfficialAnswer[] = [];
    const unboundRecordIds = new Set<string>();
    const codePids = new Set<number>();
    const weights = new Map<number, number>();
    const problemByPid = uniqueBy(snapshot.document.filter((row) => row.domainId === contest.domainId && row.docType === 10 && pids.includes(row.docId)), (row) => String(row.docId), 'problem');
    const facts = new Map<number, ReturnType<typeof setProblemFact>>();
    for (const pid of pids) {
        const problem = problemByPid.get(String(pid));
        if (!problem) fail(`set_migrate_problem_missing:${pid}`);
        const fact = setProblemFact({ ...problem, config: problem.problemKind === 'program_fill' ? parsedConfig(problem) : problem.config });
        facts.set(pid, fact);
        if (fact.judged) codePids.add(pid);
        weights.set(pid, contest.score?.[pid] === undefined ? 100 : number(contest.score[pid], 'problem_weight'));
    }
    for (const record of currentRecords) {
        if (!Number.isSafeInteger(record.pid) || record.pid <= 0) fail('set_migrate_record_pid_invalid');
        if (record.setRoundId !== undefined || record.setAcceptedAt !== undefined
            || record.setAnswerVersion !== undefined || record.setAnswerOperationId !== undefined) fail('set_migrate_record_already_bound');
        if (!journalById.has(record._id.toHexString())) fail('set_migrate_record_missing_from_journal');
        const manualPending = record.manualPending === true && facts.get(record.pid)?.kind === 'subjective'
            && record.status === STATUS.STATUS_WAITING && record.score === 0 && record.manualGrade === undefined;
        if (record.manualPending && !manualPending) fail('set_migrate_manual_pending_invalid');
        if (!manualPending && [STATUS.STATUS_WAITING, STATUS.STATUS_JUDGING, STATUS.STATUS_COMPILING, STATUS.STATUS_FETCHED].includes(record.status)) {
            fail('set_migrate_pending_record');
        }
        const acceptedAt = recordTime(record);
        number(record.score, 'record_score');
        number(record.status, 'record_status');
        if (acceptedAt.getTime() < Math.floor(contest.beginAt.getTime() / 1000) * 1000 && proof.state === 'closed' && contest.rule !== 'exam'
            && config.settings.personalLimit.hours === null && status.startAt instanceof Date
            && Math.floor(status.startAt.getTime() / 1000) * 1000 <= acceptedAt.getTime()) {
            // The current schedule cannot prove the window of these older submissions.
            // Keep their original rows and score without inventing a new start time.
            incompleteReasons.add('record_before_current_window');
            unboundRecordIds.add(record._id.toHexString());
            continue;
        }
        if (acceptedAt.getTime() < Math.floor(proof.startedAt.getTime() / 1000) * 1000 || acceptedAt > now
            || (proof.closedAt && acceptedAt > proof.closedAt)) fail('set_migrate_record_time_conflict');
        if (!pids.includes(record.pid)) {
            if (config.settings.draw.enabled) fail('set_migrate_record_outside_paper');
            // Removed historical questions have no provable place in today's paper.
            // Preserve these Records unchanged and lock the closed stored result.
            incompleteReasons.add('record_outside_paper');
            unboundRecordIds.add(record._id.toHexString());
            continue;
        }
        if (codePids.has(record.pid)) {
            const eligible = judgedSetAttempts([record]);
            if (!eligible.length && record.status !== STATUS.STATUS_CANCELED) incompleteReasons.add('missing_judge_completion');
            attempts.push(...eligible);
        }
        mutations.push(mutation('record', record, { ...record, setRoundId: roundId, setAcceptedAt: acceptedAt }));
    }
    for (const [pid, fact] of facts) {
        if (fact.judged) continue;
        const selected = history.detail[pid];
        if (!selected) continue;
        const selectedRecord = recordsById.get(selected.rid.toHexString());
        if (!selectedRecord) {
            incompleteReasons.add('missing_record');
            continue;
        }
        if (unboundRecordIds.has(selectedRecord._id.toHexString())) continue;
        const submitted = currentRecords.filter((record) => record.pid === pid && record.status !== STATUS.STATUS_CANCELED
            && !unboundRecordIds.has(record._id.toHexString()))
            .sort((a, b) => a._id.toHexString().localeCompare(b._id.toHexString()));
        // The new manual-save answer is the current formal body. A frozen or best-only
        // legacy detail cannot silently replace a later, different formal submission.
        if (!submitted.length || !selectedRecord._id.equals(submitted[submitted.length - 1]._id)) fail('set_migrate_official_selection_not_latest');
        const historyRecords = config.settings.codePolicy === 'highest'
            ? submitted.filter((record, index) => index === 0 || submitted.slice(0, index).every((older) => older.score < record.score))
            : submitted;
        if (!historyRecords[historyRecords.length - 1]?._id.equals(selectedRecord._id)) fail('set_migrate_official_selection_ambiguous');
        for (const [index, record] of historyRecords.entries()) {
            const version = index + 1;
            const operationId = `migration:${roundId.toHexString()}:${pid}:${record._id.toHexString()}`;
            const answer: OfficialAnswer = {
                pid, body: officialBody(record, fact.kind), rawScore: record.score, status: record.status, rid: record._id.toHexString(),
                acceptedAt: recordTime(record), version, operationId,
            };
            const recordChange = mutations.find((item) => item.collection === 'record' && item.id.equals(record._id));
            if (!recordChange) fail('set_migrate_answer_record_missing');
            recordChange.after.setAnswerVersion = version;
            recordChange.after.setAnswerOperationId = operationId;
            const fingerprint = createHash('sha256').update(stableAnswerBody({ kind: fact.kind,
                items: [{ pid, body: answer.body, baseVersion: version - 1 }] })).digest('hex');
            mutations.push(mutation('contest.answerOperations', null, {
                _id: deterministicId('set-answer-operation-v1', operationId),
                domainId: contest.domainId, tid, roundId, participantKey: key, uid: record.uid,
                operationId, kind: fact.kind, fingerprint, acceptedAt: answer.acceptedAt, state: 'complete',
                planned: { changed: [answer], unchanged: [] }, result: { changed: [pid], unchanged: [], versions: { [pid]: version } },
            }));
            if (record._id.equals(selectedRecord._id)) {
                answers.push(answer);
                mutations.push(mutation('contest.answers', null, {
                    _id: deterministicId('set-answer-v1', roundId.toHexString(), String(pid)),
                    domainId: contest.domainId, roundId, ...answer,
                }));
            }
        }
    }
    const complete = incompleteReasons.size === 0;
    if (!complete && proof.state === 'open') fail('set_migrate_open_round_incomplete');
    if (complete) {
        const score = roundTotal(config.settings, pids, answers, attempts, weights, codePids, contest.rule === 'acm' ? contest.beginAt : proof.startedAt);
        if (!equivalentScore(score.total, history.total, pids.length) || score.accept !== history.accept || score.penaltySeconds !== history.penaltySeconds
            || score.problems.some((problem) => !equivalentScore(problem.score, history.detail[problem.pid]?.score ?? 0))) {
            fail('set_migrate_score_not_equivalent');
        }
    }
    const round: Document = {
        _id: roundId, domainId: contest.domainId, tid, participantKey: key,
        roundNo: proof.roundNo, state: proof.state, startedAt: proof.startedAt, closedAt: proof.closedAt,
        ...(proof.state === 'open' ? { openSlot: key } : {}),
        ...(contest.rule === 'acm' ? { scoreStartedAt: contest.beginAt } : {}),
        paperPids: pids, total: history.total, detail: history.detail, accept: history.accept,
        judgePending: answers.some((answer) => answer.status === STATUS.STATUS_WAITING),
        penaltySeconds: history.penaltySeconds, scoreRevision: config.revision, passed: roundPassed(config.settings, history.total),
        legacy: {
            sourceRule: contest.rule, sourceStatusId: status._id, sourceScoreField: history.sourceScoreField,
            startedAtSource: proof.startedAtSource, missingRounds: proof.missingRounds,
            incompleteHistory: !complete, scoreLocked: !complete,
            ...(complete ? {} : { incompleteReasons: [...incompleteReasons].sort() }),
        },
    };
    mutations.push(mutation('contest.rounds', null, round));
    mutations.push(mutation(statusCollection, status, {
        ...status,
        setRoundId: roundId, setRoundNo: proof.roundNo, setRoundClosedAt: proof.closedAt, setScoreRevision: config.revision,
        score: history.total, accept: history.accept, time: history.penaltySeconds, detail: history.detail, display: { ...history.detail },
    }));
    return {
        mutations,
        participant: { tid: tid.toHexString(), participantKey: key, roundNo: proof.roundNo, missingRounds: proof.missingRounds, scoreLocked: !complete, total: history.total },
    };
}

/** Reads real source rows. A diagnostic makes the entire plan non-applicable. */
export function planMigration(snapshot: MigrationSnapshot, scope: MigrationScope, identity: Pick<MigrateStore, 'databaseName' | 'connectionFingerprint'>, now: Date): MigratePlan {
    if (!scope.domainId || !scope.tids.length || new Set(scope.tids.map((tid) => oid(tid, 'tid').toHexString())).size !== scope.tids.length) fail('set_migrate_scope_invalid');
    const plan: MigratePlan = {
        schemaVersion: 1, databaseName: identity.databaseName, connectionFingerprint: identity.connectionFingerprint, scope, now,
        diagnostics: [], participants: [], mutations: [],
        protected: {} as MigratePlan['protected'], fingerprint: '',
    };
    for (const tid of scope.tids) {
        try {
            const contests = snapshot.document.filter((row) => row.docType === 30 && inContest(row, scope.domainId, tid, 'docId'));
            if (contests.length !== 1) fail('set_migrate_contest_missing_or_duplicate');
            const contest = contests[0];
            if (!LEGACY_CONTEST_RULES.includes(contest.rule)) fail('set_legacy_rule_unknown');
            if (contest.setConfig !== undefined) fail('set_migrate_config_already_present');
            if (snapshot['contest.rounds'].some((row) => inContest(row, scope.domainId, tid, 'tid'))) fail('set_migrate_rounds_already_present');
            const config = mapLegacyContest(contest);
            if (!(contest.beginAt instanceof Date) || !(contest.endAt instanceof Date) || !Number.isFinite(contest.beginAt.getTime())
                || !Number.isFinite(contest.endAt.getTime()) || contest.beginAt >= contest.endAt) fail('set_migrate_invalid_window');
            const pool = ids(contest.pids, 'contest_pids');
            const poolKinds = new Map<number, ProblemKind>();
            const poolFacts: SetProblemFact[] = [];
            for (const pid of pool) {
                const problems = snapshot.document.filter((row) => row.domainId === contest.domainId && row.docType === 10 && row.docId === pid);
                if (problems.length !== 1) fail(`set_migrate_problem_missing_or_duplicate:${pid}`);
                const problem = problems[0];
                const fact = setProblemFact({ ...problem, config: problem.problemKind === 'program_fill' ? parsedConfig(problem) : problem.config });
                poolKinds.set(pid, fact.kind);
                poolFacts.push(fact);
                if (contest.score?.[pid] !== undefined && number(contest.score[pid], 'problem_weight') <= 0) fail('set_migrate_legacy_weight_unmapped');
            }
            assertSetCombination(config.settings, poolFacts);
            if (config.settings.draw.enabled && config.settings.draw.quotas) assertExamPaperPoolSatisfiesQuotas(pool, poolKinds, config.settings.draw.quotas);
            const isTeam = contest.participationMode === 'team';
            if (isTeam && contest.rule !== 'acm') fail('set_migrate_team_rule_invalid');
            const statusCollection = isTeam ? 'contest.teamStatuses' : 'document.status';
            const statuses = snapshot[statusCollection].filter((row) => inContest(row, scope.domainId, tid, isTeam ? 'contestId' : 'docId') && (isTeam || row.docType === 30));
            const keyFor = (row: Document) => isTeam ? `t:${oid(row.teamId, 'teamId').toHexString()}` : `u:${number(row.uid, 'uid')}`;
            const byKey = uniqueBy(statuses, keyFor, 'participant');
            const records = snapshot.record.filter((row) => inContest(row, scope.domainId, tid, 'contest'));
            for (const record of records) {
                const key = isTeam ? `t:${oid(record.contestTeamId, 'contestTeamId').toHexString()}` : `u:${number(record.uid, 'uid')}`;
                if (!byKey.has(key)) fail(`set_migrate_record_status_missing:${key}`);
            }
            for (const [key, status] of byKey) {
                try {
                    if (isTeam) {
                        const teams = snapshot['contest.teams'].filter((team) => inContest(team, scope.domainId, tid, 'contestId') && sameId(team.teamId, status.teamId));
                        if (teams.length !== 1) fail('set_migrate_team_missing_or_duplicate');
                    }
                    const participantRecords = records.filter((row) => isTeam ? sameId(row.contestTeamId, status.teamId) : row.uid === status.uid);
                    const result = planParticipant(snapshot, contest, config, status, key, participantRecords, statusCollection, now);
                    plan.mutations.push(...result.mutations);
                    if (result.participant) plan.participants.push(result.participant);
                } catch (error) {
                    plan.diagnostics.push({ tid: tid.toHexString(), participantKey: key, code: error instanceof Error ? error.message : String(error) });
                }
            }
            // Activate canonical config only after all records, answers, rounds and statuses are in place.
            plan.mutations.push(mutation('document', contest, { ...contest, setConfig: config }));
        } catch (error) {
            plan.diagnostics.push({ tid: tid.toHexString(), code: error instanceof Error ? error.message : String(error) });
        }
    }
    const seen = new Set<string>();
    for (const item of plan.mutations) {
        const key = `${item.collection}:${item.id.toHexString()}`;
        if (seen.has(key)) plan.diagnostics.push({ tid: '', code: `set_migrate_duplicate_target:${key}` });
        seen.add(key);
        if (!item.before && snapshot[item.collection].some((row) => sameId(row._id, item.id))) plan.diagnostics.push({ tid: '', code: `set_migrate_target_exists:${key}` });
    }
    plan.protected = protectedFacts(snapshot, plan.mutations);
    plan.fingerprint = migrationFingerprint(plan);
    return plan;
}

export function assertMigrationPlan(plan: MigratePlan): void {
    if (Number(plan.schemaVersion) !== 1 || migrationFingerprint(plan) !== plan.fingerprint) fail('set_migrate_fingerprint_invalid');
    if (plan.diagnostics.length) fail('set_migrate_plan_has_diagnostics');
}
async function inspectState(store: MigrateStore, plan: MigratePlan, afterOnly: boolean) {
    assertMigrationPlan(plan);
    if (store.databaseName !== plan.databaseName || store.connectionFingerprint !== plan.connectionFingerprint) fail('set_migrate_connection_mismatch');
    const snapshot = await store.snapshot();
    if (!same(protectedFacts(snapshot, plan.mutations), plan.protected)) fail('set_migrate_non_target_changed');
    const indexes = new Map(SET_MIGRATE_COLLECTIONS.map((collection) => [collection,
        uniqueBy(snapshot[collection].filter((row) => row._id instanceof ObjectId), (row) => row._id.toHexString(), 'target'),
    ]));
    for (const item of plan.mutations) {
        const current = indexes.get(item.collection)!.get(item.id.toHexString()) ?? null;
        if (!same(current, item.after) && (afterOnly || !same(current, item.before))) fail(`set_migrate_target_changed:${item.collection}:${item.id.toHexString()}`);
    }
    return indexes;
}
export async function applyMigration(store: MigrateStore, plan: MigratePlan, gates: MigrationGates): Promise<{ written: number; kept: number }> {
    assertMigrationPlan(plan);
    if (gates.serviceStopped !== true || gates.backupConfirmed !== plan.fingerprint || gates.fingerprint !== plan.fingerprint
        || gates.confirm !== `APPLY:set-migrate:${plan.databaseName}:${plan.fingerprint}`) fail('set_migrate_confirmation_required');
    const current = await inspectState(store, plan, false);
    let written = 0;
    let kept = 0;
    for (const item of plan.mutations) {
        const existing = current.get(item.collection)!.get(item.id.toHexString()) ?? null;
        if (same(existing, item.after)) {
            kept += 1;
            continue;
        }
        if (!await store.compareAndSwap(item)) fail(`set_migrate_cas_failed:${item.collection}:${item.id.toHexString()}`);
        written += 1;
    }
    await verifyMigration(store, plan);
    return { written, kept };
}
export async function verifyMigration(store: MigrateStore, plan: MigratePlan): Promise<{ targets: number; participants: number }> {
    await inspectState(store, plan, true);
    return { targets: plan.mutations.length, participants: plan.participants.length };
}

export function assertMigrationConnection(uri: string, databaseName: string): string {
    if (!uri || !databaseName || !/^[A-Za-z0-9_-]+$/.test(databaseName) || ['admin', 'config', 'local'].includes(databaseName)) fail('set_migrate_database_invalid');
    const parsed = new URL(uri);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || decodeURIComponent(parsed.pathname) !== `/${databaseName}`) fail('set_migrate_explicit_database_required');
    return migrationHash({ uri, databaseName });
}
export function mongoMigrateStore(db: Db, connectionFingerprint: string): MigrateStore {
    return {
        databaseName: db.databaseName, connectionFingerprint,
        async snapshot() {
            return Object.fromEntries(await Promise.all(SET_MIGRATE_COLLECTIONS.map(async (name) => [name, await db.collection(name).find({}).toArray()]))) as MigrationSnapshot;
        },
        async compareAndSwap(item) {
            const collection = db.collection(item.collection);
            if (!item.before) {
                try {
                    await collection.insertOne(item.after);
                    return true;
                } catch (error) {
                    if ((error as { code?: number }).code === 11000) return false;
                    throw error;
                }
            }
            const result = await collection.replaceOne({ _id: item.id, $expr: { $eq: ['$$ROOT', { $literal: item.before }] } }, item.after);
            return result.matchedCount === 1;
        },
    };
}
export async function connectMigrationStore(uri: string, databaseName: string): Promise<MigrateStore & { close(): Promise<void> }> {
    const connectionFingerprint = assertMigrationConnection(uri, databaseName);
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
    } catch (error) {
        await client.close();
        throw error;
    }
    return { ...mongoMigrateStore(client.db(databaseName), connectionFingerprint), close: () => client.close() };
}
