import { LRUCache } from 'lru-cache';
import { ObjectId, type Collection } from 'mongodb';
import { effectiveProblemKind, roundPersonalEnd, type SetProblemFact } from '@hydrooj/common';
import { rankingDay } from '@hydrooj/common/activity-ranking';
import { STATUS } from '@hydrooj/common/status';
import { Logger } from '@hydrooj/utils';
import type { Tdoc, TrainingDoc } from '../interface';
import { publicFirstSolves } from '../lib/activity-ranking';
import { SUPERADMIN_UID } from '../lib/admin-account';
import { allowsPostContestView } from '../lib/contest-correction';
import { effectiveLockoutWindow } from '../lib/contest-lockout';
import { courseVisibleTo } from '../lib/course-visibility';
import { parseProblemConfigObject } from '../lib/problem-config';
import { problemSetAudienceOf } from '../lib/problem-set-audience';
import { setProblemFact } from '../lib/set-problem-fact';
import { storedSetConfigOrNull } from '../lib/set-publication';
import { getSetResultVisibility } from '../lib/set-result-visibility';
import { isCourseKind, isProblemSetKind } from '../lib/training-kind';
import db from '../service/db';
import { RULES } from './contest';
import { TYPE_CONTEST, TYPE_PROBLEM, TYPE_TRAINING } from './document';
import record from './record';
import type { RoundDoc } from './set-round';

const logger = new Logger('activity-ranking');
const codeKinds = ['programming', 'function', 'program_fill'];
const noGroups = new Set<string>();

interface Origin {
    uid: number;
    pid: number;
    contest?: ObjectId;
    round?: ObjectId;
    practice?: ObjectId;
    practiceScopes?: { containerId: ObjectId; scopeId: number }[];
}

interface Candidate extends Origin { at: Date; savedAnswer?: boolean }
type Paper = Pick<RoundDoc, '_id' | 'tid' | 'participantKey' | 'startedAt' | 'closedAt'>;

/** Keep the earliest AC per source until visibility is known. A private earlier AC must never mask a public one. */
export async function firstAcceptedCandidates(domainId: string, records: Pick<Collection, 'aggregate'>, operations: Pick<Collection, 'aggregate'>, sentinels: ObjectId[]) {
    const [judged, saved] = await Promise.all([
        records.aggregate<Candidate>([
            { $match: { domainId, status: STATUS.STATUS_ACCEPTED, uid: { $gt: SUPERADMIN_UID }, contest: { $nin: sentinels },
                virtualAttemptId: null, sourceContestId: null, contestTeamId: null, hackTarget: null,
                $or: [{ practiceContext: { $exists: false } },
                    { 'practiceContext.mode': 'student', 'practiceContext.containerId': { $type: 'objectId' } }] } },
            { $group: { _id: { uid: '$uid', pid: '$pid', contest: '$contest', round: '$setRoundId',
                practice: '$practiceContext.containerId', practiceScopes: { $map: { input: '$practiceContext.targets', as: 'target',
                    in: { containerId: '$$target.containerId', scopeId: '$$target.scopeId' } } } },
                at: { $min: { $ifNull: ['$setAcceptedAt', { $toDate: '$_id' }] } } } },
            { $replaceWith: { $mergeObjects: ['$_id', { at: '$at' }] } },
        ], { allowDiskUse: true }).toArray(),
        // Text-mode program fill has an official save history. Imported entries with a rid follow the rejudgeable Record above.
        operations.aggregate<Candidate>([
            { $match: { domainId, kind: 'program_fill', state: 'complete', uid: { $gt: SUPERADMIN_UID }, contestTeamId: null } },
            { $project: { uid: 1, tid: 1, roundId: 1, 'planned.changed.pid': 1, 'planned.changed.rid': 1,
                'planned.changed.status': 1, 'planned.changed.acceptedAt': 1 } },
            { $unwind: '$planned.changed' },
            { $match: { 'planned.changed.status': STATUS.STATUS_ACCEPTED, 'planned.changed.rid': null } },
            { $group: { _id: { uid: '$uid', pid: '$planned.changed.pid', contest: '$tid', round: '$roundId' },
                at: { $min: '$planned.changed.acceptedAt' } } },
            { $replaceWith: { $mergeObjects: ['$_id', { at: '$at', savedAnswer: true }] } },
        ], { allowDiskUse: true }).toArray(),
    ]);
    return [...judged, ...saved];
}

async function loadCandidates(domainId: string) {
    const updatedAt = new Date();
    const items = await firstAcceptedCandidates(domainId, record.coll, db.collection('contest.answerOperations'),
        [record.RECORD_PRETEST, record.RECORD_GENERATE, record.RECORD_VERIFY]);
    logger.info('Activity ranking domain=%s sources=%d durationMs=%d', domainId, items.length, Date.now() - +updatedAt);
    return { items, updatedAt };
}

// Only candidate facts are cached. Publication, membership and access restrictions are read on every request.
const cache = new LRUCache<string, ReturnType<typeof loadCandidates>>({ max: 12, ttl: 55_000 });

function candidates(domainId: string) {
    const existing = cache.get(domainId);
    if (existing) return existing;
    const pending = loadCandidates(domainId);
    cache.set(domainId, pending);
    pending.catch(() => { if (cache.peek(domainId) === pending) cache.delete(domainId); });
    return pending;
}

function publicContest(tdoc: Tdoc, now: Date) {
    const config = storedSetConfigOrNull(tdoc);
    // Homework entry is group-bound even on legacy documents with no stored group IDs.
    if ((config?.purpose ?? tdoc.rule) === 'homework' || tdoc.hidden || tdoc._code || tdoc.assign?.length
        || (tdoc.participantScopeMode && tdoc.participantScopeMode !== 'none') || tdoc.participationMode === 'team'
        || !(tdoc.beginAt instanceof Date) || !(tdoc.endAt instanceof Date)
        || now < tdoc.beginAt || (now >= tdoc.endAt && !allowsPostContestView(tdoc))) return null;
    const lockout = effectiveLockoutWindow(tdoc);
    if (lockout && now < lockout.blockEnd) return null;
    let savedAnswersVisible: boolean;
    if (!config) {
        const rule = RULES[tdoc.rule];
        if (!rule) throw new TypeError('activity_ranking_unknown_contest_rule');
        savedAnswersVisible = rule.showScoreboard(tdoc, now);
        if (!savedAnswersVisible && !rule.showRecord(tdoc, now)) return null;
    } else {
        const { settings } = config;
        if (config.publication !== 'published') return null;
        const policy = settings.authorization;
        const permissions = policy ? [policy.defaults, ...policy.groups] : [];
        if (policy) {
            // A matching group's permissions replace the defaults, including when the group is more restricted.
            if (!permissions.every((p) => p.problems !== 'hidden' && p.records !== 'self'
                && (now < tdoc.endAt || p.afterEnd))) return null;
        } else if (settings.scoreboard === 'off' || now < tdoc.endAt || (tdoc.lockAt && !tdoc.unlocked && now >= tdoc.lockAt)) return null;
        // A text answer without a Record has no public submission-list entry. Its result must also be open on the set's board.
        savedAnswersVisible = permissions.every((p) => p.scoreboard) && (settings.scoreboard === 'live'
            || (settings.scoreboard === 'after_end' && now >= tdoc.endAt) || (settings.scoreboard === 'during_only' && now < tdoc.endAt));
    }
    return { tdoc, settings: config?.settings, pids: new Set(tdoc.pids), savedAnswersVisible };
}

function publicPractice(doc: TrainingDoc, scopeId?: number) {
    if (doc.hidden) return false;
    if (isCourseKind(doc.kind)) {
        if (!courseVisibleTo(doc, noGroups, false)) return false;
    } else if (!isProblemSetKind(doc.kind) || !problemSetAudienceOf(doc).public) return false;
    if (scopeId === undefined) return true;
    const stage = doc.dag?.find((node) => node._id === scopeId);
    return !!stage && !stage.requireNids?.length;
}

function ids(values: Iterable<ObjectId | undefined>) {
    const result = new Map<string, ObjectId>();
    for (const id of values) if (id) result.set(id.toHexString(), id);
    return [...result.values()];
}

const contestFields = { docId: 1, rule: 1, setConfig: 1, setPoints: 1, pids: 1, beginAt: 1, endAt: 1, hidden: 1,
    assign: 1, participantScopeMode: 1, _code: 1, participationMode: 1, lockAt: 1, unlocked: 1, examShowVerdict: 1,
    keepScoreboardHidden: 1, entryMode: 1, clientLoginBlockBeforeMinutes: 1, clientLoginBlockAfterMinutes: 1, allowPostContestView: 1 };

export async function resolvePublicActivity(domainId: string, items: Candidate[], now: Date, documents: Collection, rounds: Collection) {
    if (!items.length) return new Map<number, Map<number, number>>();
    const pids = [...new Set(items.map((item) => item.pid))];
    const contests = ids(items.map((item) => item.contest));
    const roundIds = ids(items.map((item) => item.round));
    const practices = ids(items.flatMap((item) => [item.practice, ...(item.practiceScopes ?? []).map((s) => s.containerId)]));
    const [problems, sets, training, papers] = await Promise.all([
        documents.aggregate<{ docId: number; problemKind?: string; config?: unknown }>([
            { $match: { domainId, docType: TYPE_PROBLEM, docId: { $in: pids }, hidden: { $ne: true }, archivedAt: null, 'aclMutationLocks.0': { $exists: false },
                $or: [{ problemKind: { $in: codeKinds } }, { problemKind: { $exists: false } }] } },
            { $project: { docId: 1, problemKind: 1, config: { $cond: [{ $eq: ['$problemKind', 'program_fill'] }, '$config', '$$REMOVE'] } } },
        ]).toArray(),
        contests.length ? documents.find({ domainId, docType: TYPE_CONTEST, docId: { $in: contests } }).project<Tdoc>(contestFields).toArray() : [],
        practices.length || contests.length ? documents.find({ domainId, docType: TYPE_TRAINING,
            $or: [{ docId: { $in: practices } }, { 'courseExam.contestId': { $in: contests } }] }).project<TrainingDoc>({
            docId: 1, kind: 1, courseHidden: 1, courseGroupIds: 1, problemSetAudience: 1, hidden: 1,
            'courseExam.contestId': 1, 'dag._id': 1, 'dag.requireNids': 1,
        }).toArray() : new Array<TrainingDoc>(),
        roundIds.length ? rounds.find({ domainId, _id: { $in: roundIds } })
            .project<Paper>({ tid: 1, participantKey: 1, startedAt: 1, closedAt: 1 }).toArray() : new Array<Paper>(),
    ]);
    const problemFacts = new Map<number, SetProblemFact>(problems.map((p) => [p.docId,
        p.problemKind === 'program_fill' ? setProblemFact({ ...p, config: parseProblemConfigObject(p) }) : { kind: effectiveProblemKind(p), judged: true }]));
    const trainingById = new Map(training.map((t) => [String(t.docId), t]));
    const courseExams = new Set(training.flatMap((t) => t.courseExam ? [String(t.courseExam.contestId)] : []));
    const setById = new Map(sets.filter((t) => !courseExams.has(String(t.docId))).map((t) => [String(t.docId), publicContest(t, now)]));
    const paperById = new Map(papers.map((p) => [String(p._id), p]));
    function* eligible() {
        for (const item of items) {
            const fact = problemFacts.get(item.pid);
            if (!fact) continue;
            if (!(item.at instanceof Date) || !Number.isFinite(+item.at)) throw new Error(`activity_ranking_invalid_submit_time: ${domainId}/${item.uid}/${item.pid}`);
            if (item.at > now) continue;
            if (item.practice) {
                const doc = trainingById.get(String(item.practice));
                if (!doc || !publicPractice(doc) || !item.practiceScopes?.length || !item.practiceScopes.every((s) => {
                    const target = trainingById.get(String(s.containerId));
                    return target && publicPractice(target, s.scopeId);
                })) continue;
            }
            if (item.contest) {
                const set = setById.get(String(item.contest));
                if (!set || !set.pids.has(item.pid) || set.tdoc.setPoints?.[item.pid]?.excluded) continue;
                if (item.savedAnswer && (!set.savedAnswersVisible || fact.kind !== 'program_fill' || fact.judged)) continue;
                const { tdoc, settings } = set;
                if (tdoc.lockAt && !tdoc.unlocked && now >= tdoc.lockAt && item.at >= tdoc.lockAt) continue;
                const paper = item.round && paperById.get(String(item.round));
                if (item.round && (!paper || !paper.tid.equals(item.contest) || paper.participantKey !== `u:${item.uid}`)) continue;
                if (settings) {
                    const deadline = paper && !paper.closedAt ? roundPersonalEnd(settings, tdoc.endAt, paper.startedAt) : null;
                    const closedAt = paper?.closedAt ?? (deadline && deadline <= now ? deadline : null);
                    if (!getSetResultVisibility(settings, fact, { endAt: tdoc.endAt, roundClosedAt: closedAt, now }).verdict) continue;
                }
            } else if (item.round) continue;
            yield { uid: item.uid, pid: item.pid, day: rankingDay(item.at) };
        }
    }
    return publicFirstSolves(eligible());
}

export async function readPublicActivity(domainId: string) {
    const { items, updatedAt } = await candidates(domainId);
    const users = await resolvePublicActivity(domainId, items, new Date(), db.collection('document'), db.collection('contest.rounds'));
    return { users, updatedAt };
}
