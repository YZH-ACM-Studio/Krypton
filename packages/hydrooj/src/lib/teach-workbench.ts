import { ObjectId } from 'mongodb';
import {
    contestProblemScoreWeight,
    effectiveProblemKind,
    readExamAttemptLimit,
    readExamPaperQuotas,
    readExamPassScore,
    STATUS,
    teachStatusOf,
    TEACH_SCORED_CONTEST_RULES,
    type ProblemKind,
    type TeachStatus,
    type TeachType,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, ValidationError } from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import { canManageTeamBatches } from '../model/contest-team-batch';
import { coll as teamStatusColl } from '../model/contest-team-status';
import { listKnowledgeMindmapOptions } from '../model/managed-problem-authoring';
import problem, { type ProblemDoc } from '../model/problem';
import record from '../model/record';
import * as training from '../model/training';
import user, { type User } from '../model/user';
import { studentDirectory } from '../service/student-directory';
import { problemSetAudienceOf } from './problem-set-audience';
import type { TeachDoc } from './teach-access';
import { readCopiedFrom, readSchoolShared } from './teach-fields';

const logger = new Logger('teach-workbench');

export interface TeachAudienceSummary {
    mode: 'all' | 'groups' | 'schools' | 'redeem_only';
    groupNames: string[];
    schoolNames: string[];
    boundStudentCount: number | null;
}

export interface TeachLinks {
    studentView: string;
    scoreboard: string | null;
    manage: string | null;
    users: string | null;
    clarification: string | null;
    grading: string | null;
    teams: string | null;
    balloon: string | null;
    print: string | null;
    code: string | null;
    files: string;
    redemption: string | null;
}

export interface TeachContainerSummary {
    type: TeachType;
    id: string;
    rule: string;
    title: string;
    status: TeachStatus;
    beginAt: string | null;
    endAt: string | null;
    durationMinutes: number | null;
    penaltySince: string | null;
    lockAt: string | null;
    audience: TeachAudienceSummary;
    owner: { uid: number; name: string };
    maintainers: Array<{ uid: number; name: string }>;
    createdAt: string;
    schoolShared: { sharedAt: string; sharedByName: string } | null;
    copiedFrom: { type: TeachType; id: string; title: string; ownerName: string } | null;
    examPassScore: number | null;
    examAttemptLimit: number | null;
    participationMode: 'individual' | 'team';
    vigilEnabled: boolean;
    entryMode: 'open' | 'client_required';
    links: TeachLinks;
}

export interface TeachPaperProblem {
    docId: number;
    pid: string;
    title: string;
    kind: ProblemKind;
    score: number | null;
    hidden: boolean;
    mine: boolean;
    difficulty: number | null;
}

export interface TeachPaperStage {
    id: number;
    title: string;
    requireIds: number[];
    pids: number[];
}

export interface TeachPaper {
    problems: TeachPaperProblem[];
    stages: TeachPaperStage[] | null;
    examPaperQuotas: Partial<Record<ProblemKind, number>> | null;
}

export interface TeachProblemStat {
    docId: number;
    accepted: number;
    attempted: number;
}

export interface TeachStats {
    participantCount: number;
    startedCount: number | null;
    finalizedCount: number | null;
    submittedCount: number | null;
    recordCount: number | null;
    audienceCount: number | null;
    problemStats: TeachProblemStat[] | null;
}

export interface TeachCapabilities {
    canDelete: boolean;
    canShare: boolean;
    canGrade: boolean;
    canManageTeamBatches: boolean;
    isSystemAdmin: boolean;
    canPin: boolean;
}

export interface TeachWorkbenchPayload {
    container: TeachContainerSummary;
    paper: TeachPaper;
    stats: TeachStats;
    capabilities: TeachCapabilities;
}

export interface TeachKnowledgeOption {
    id: string;
    mapId: string;
    label: string;
}

export interface TeachComposePayload {
    container: TeachContainerSummary;
    paper: TeachPaper;
    examStartedCount: number;
    knowledgeOptions: TeachKnowledgeOption[];
    canCreateObjective: boolean;
}

const GRADE_RULES = new Set(['exam', 'homework', 'oi']);
const DELETED_USER_NAME = '已删除的用户';
const DELETED_GROUP_NAME = '已删除的用户组';
const DELETED_SCHOOL_NAME = '已删除的学校';
const PAPER_PROJECTION: Array<keyof ProblemDoc> = [...problem.PROJECTION_CONTEST_LIST, 'problemKind', 'hidden', 'owner', 'difficulty'];
const STATUS_PROJECTION = {
    uid: 1,
    attend: 1,
    startAt: 1,
    paperFinalizedAt: 1,
    journal: 1,
    enroll: 1,
};

function invalid(field: string, text: ReturnType<typeof localizedErrorText>): never {
    throw new ValidationError(field, null, text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rethrowType(error: unknown, codes: readonly string[], field: string, text: ReturnType<typeof localizedErrorText>): never {
    if (error instanceof TypeError && codes.includes(error.message)) invalid(field, text);
    throw error;
}

function positiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readDate(raw: unknown, field: string): Date {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    if (typeof raw === 'string') {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    invalid(field, localizedErrorText`题目集的时间无效。`);
}

function readOptionalDate(raw: unknown, field: string): Date | null {
    if (raw == null) return null;
    return readDate(raw, field);
}

function readTitle(raw: unknown): string {
    if (typeof raw !== 'string') invalid('title', localizedErrorText`题目集标题无效。`);
    return raw;
}

function readOwnerUid(raw: unknown): number {
    if (!positiveInt(raw)) invalid('owner', localizedErrorText`题目集的所有者无效。`);
    return raw;
}

function readMaintainerUids(raw: unknown): number[] {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.some((uid) => !positiveInt(uid))) invalid('maintainer', localizedErrorText`维护者数据无效。`);
    return raw.slice();
}

function readPids(raw: unknown): number[] {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.some((pid) => !positiveInt(pid))) invalid('pids', localizedErrorText`题目列表无效。`);
    return raw.slice();
}

function readDurationMinutes(type: TeachType, duration: unknown): number | null {
    if (type === 'practice') return null;
    if (duration == null || duration === 0) return null;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) invalid('duration', localizedErrorText`个人限时无效。`);
    const minutes = Math.round(duration * 60);
    if (!Number.isSafeInteger(minutes) || minutes <= 0) invalid('duration', localizedErrorText`个人限时无效。`);
    return minutes;
}

function containerIdOf(doc: TeachDoc): ObjectId {
    if (doc._id instanceof ObjectId) return doc._id;
    invalid('id', localizedErrorText`题目集不存在。`);
}

function readStages(raw: unknown): TeachPaperStage[] {
    if (!Array.isArray(raw)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
    return raw.map((node) => {
        if (!isRecord(node)) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        const { _id: id, title, requireNids, pids } = node;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof title !== 'string') {
            invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        }
        if (!Array.isArray(requireNids) || requireNids.some((item) => typeof item !== 'number' || !Number.isSafeInteger(item))) {
            invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        }
        if (!Array.isArray(pids) || pids.some((item) => !positiveInt(item))) invalid('dag', localizedErrorText`练习的阶段数据无效。`);
        return { id, title, requireIds: requireNids.slice(), pids: pids.slice() };
    });
}

function readObjectIds(raw: unknown, field: string): ObjectId[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) invalid(field, localizedErrorText`题目集引用的范围无效。`);
    const seen = new Set<string>();
    const ids: ObjectId[] = [];
    for (const item of raw) {
        const id = item instanceof ObjectId
            ? item
            : typeof item === 'string' && /^[0-9a-f]{24}$/i.test(item)
                ? new ObjectId(item)
                : null;
        if (!id) invalid(field, localizedErrorText`题目集引用的范围无效。`);
        const hex = id.toHexString();
        if (seen.has(hex)) continue;
        seen.add(hex);
        ids.push(id);
    }
    return ids;
}

function scopeMode(raw: unknown): 'all' | 'groups' | 'schools' {
    if (raw === 'groups' || raw === 'schools') return raw;
    if (raw == null || raw === 'none') return 'all';
    invalid('participantScopeMode', localizedErrorText`参赛范围无效。`);
}

function readEntry(doc: { vigilEnabled?: unknown; entryMode?: unknown }): { vigilEnabled: boolean; entryMode: 'open' | 'client_required' } {
    if (doc.vigilEnabled !== undefined && typeof doc.vigilEnabled !== 'boolean') invalid('vigilEnabled', localizedErrorText`入场方式数据无效。`);
    if (doc.entryMode !== undefined && doc.entryMode !== 'open' && doc.entryMode !== 'client_required') {
        invalid('entryMode', localizedErrorText`入场方式数据无效。`);
    }
    return {
        vigilEnabled: doc.vigilEnabled === true,
        entryMode: doc.entryMode === 'client_required' ? 'client_required' : 'open',
    };
}

function readExamLimits(type: TeachType, doc: { examPassScore?: unknown; examAttemptLimit?: unknown }): { examPassScore: number | null; examAttemptLimit: number | null } {
    if (type !== 'exam') return { examPassScore: null, examAttemptLimit: null };
    try {
        return { examPassScore: readExamPassScore(doc), examAttemptLimit: readExamAttemptLimit(doc) };
    } catch (error) {
        rethrowType(error, ['exam_pass_score_invalid', 'exam_attempt_limit_invalid'], 'examPassScore', localizedErrorText`考试的及格线或作答次数无效。`);
    }
}

function readQuotas(type: TeachType, raw: unknown): Partial<Record<ProblemKind, number>> | null {
    if (type !== 'exam') return null;
    try {
        return readExamPaperQuotas(raw);
    } catch (error) {
        rethrowType(error, ['exam_paper_quotas_invalid'], 'examPaperQuotas', localizedErrorText`抽题设置无效。`);
    }
}

function scoreFor(type: TeachType, rule: string, score: unknown, docId: number): number | null {
    if (type === 'practice' || rule === 'acm' || rule === 'ledo') return null;
    if (type === 'homework' || TEACH_SCORED_CONTEST_RULES.includes(rule)) return contestProblemScoreWeight({ score }, docId);
    return null;
}

function canCreateRedemption(actor: User): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_CREATE_REDEMPTION_CODE);
}

function canDeleteContainer(actor: User, type: TeachType, doc: TeachDoc): boolean {
    if (type === 'practice') {
        return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
            || actor.hasPerm(PERM.PERM_EDIT_TRAINING)
            || (actor.own(doc) && actor.hasPerm(PERM.PERM_EDIT_TRAINING_SELF));
    }
    if (type === 'homework') return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.own(doc) || actor.hasPerm(PERM.PERM_EDIT_HOMEWORK);
    return doc.owner === actor._id || actor.hasPerm(PERM.PERM_EDIT_CONTEST) || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

function linksFor(
    type: TeachType,
    rule: string,
    id: string,
    actor: User,
    ownerUid: number,
    participationMode: 'individual' | 'team',
): TeachLinks {
    const contestPage = type === 'exam' || type === 'acm' || type === 'oi';
    const programmingContest = type === 'acm' || type === 'oi';
    const base = `/contest/${id}`;
    let studentView = base;
    let scoreboard: string | null = `${base}/scoreboard`;
    let files = `${base}/management`;
    if (type === 'practice') {
        studentView = `/problem-sets/${id}`;
        scoreboard = null;
        files = `/problem-sets/${id}/file`;
    } else if (type === 'homework') {
        studentView = `/homework/${id}`;
        scoreboard = `/homework/${id}/scoreboard`;
        files = `/homework/${id}/file`;
    }
    const grading = GRADE_RULES.has(rule) && (ownerUid === actor._id || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM))
        ? `/manage/grading/${id}`
        : null;
    return {
        studentView,
        scoreboard,
        manage: contestPage ? `${base}/management` : null,
        users: contestPage ? `${base}/user` : null,
        clarification: contestPage ? `${base}/clarification` : null,
        grading,
        teams: type === 'acm' && participationMode === 'team' ? `${base}/teams` : null,
        balloon: programmingContest ? `${base}/balloon` : null,
        print: programmingContest ? `${base}/print` : null,
        code: programmingContest ? `${base}/code` : null,
        files,
        redemption: type === 'practice' && canCreateRedemption(actor) ? '/manage/redemption-codes' : null,
    };
}

async function namesFor(domainId: string, uids: readonly number[]): Promise<Map<number, string>> {
    const unique = [...new Set(uids)];
    const listed = unique.length ? await user.getList(domainId, unique) : {};
    const names = new Map<number, string>();
    for (const uid of unique) {
        const found = listed[uid];
        // getList substitutes defaultUser (_id 0, uname "Unknown User") for a deleted account.
        if (found && found._id === uid && typeof found.uname === 'string' && found.uname) {
            names.set(uid, found.uname);
            continue;
        }
        logger.error('Teach workbench user missing domain=%s uid=%d', domainId, uid);
        names.set(uid, DELETED_USER_NAME);
    }
    return names;
}

function nameOf(names: Map<number, string>, uid: number): string {
    const name = names.get(uid);
    if (!name) invalid('owner', localizedErrorText`题目集引用的用户不存在。`);
    return name;
}

async function groupNames(domainId: string, ids: readonly ObjectId[]): Promise<string[]> {
    if (!ids.length) return [];
    const groups = await studentDirectory().listUserGroups(domainId);
    const byId = new Map(groups.map((group) => [group._id.toHexString(), group.name]));
    return ids.map((id) => {
        const name = byId.get(id.toHexString());
        if (typeof name === 'string' && name) return name;
        logger.error('Teach workbench group missing domain=%s group=%s', domainId, id.toHexString());
        return DELETED_GROUP_NAME;
    });
}

async function schoolNames(domainId: string, ids: readonly ObjectId[]): Promise<string[]> {
    return Promise.all(ids.map(async (id) => {
        const school = await studentDirectory().getSchool(domainId, id);
        if (school && typeof school.name === 'string' && school.name) return school.name;
        logger.error('Teach workbench school missing domain=%s school=%s', domainId, id.toHexString());
        return DELETED_SCHOOL_NAME;
    }));
}

async function boundCount(domainId: string, ids: readonly ObjectId[]): Promise<number> {
    if (!ids.length) return 0;
    const students = await studentDirectory().findBoundStudentsByGroupIds(domainId, [...ids]);
    return students.length;
}

async function audienceFor(domainId: string, type: TeachType, doc: TeachDoc): Promise<TeachAudienceSummary> {
    if (type === 'practice') {
        let audience: { public: boolean; groupIds: string[] };
        try {
            audience = problemSetAudienceOf(doc as TrainingDoc);
        } catch (error) {
            logger.error('Teach workbench audience rejected domain=%s id=%s error=%o', domainId, String(doc._id), error);
            invalid('problemSetAudience', localizedErrorText`练习的参与范围无效。`);
        }
        if (audience.public) return { mode: 'all', groupNames: [], schoolNames: [], boundStudentCount: null };
        if (!audience.groupIds.length) return { mode: 'redeem_only', groupNames: [], schoolNames: [], boundStudentCount: null };
        const ids = readObjectIds(audience.groupIds, 'problemSetAudience');
        const [names, count] = await Promise.all([groupNames(domainId, ids), boundCount(domainId, ids)]);
        return { mode: 'groups', groupNames: names, schoolNames: [], boundStudentCount: count };
    }
    const contestDoc = doc as Tdoc;
    const mode = scopeMode(contestDoc.participantScopeMode);
    if (mode === 'all') return { mode: 'all', groupNames: [], schoolNames: [], boundStudentCount: null };
    if (mode === 'groups') {
        const ids = readObjectIds(contestDoc.participantGroupIds, 'participantGroupIds');
        const [names, count] = await Promise.all([groupNames(domainId, ids), boundCount(domainId, ids)]);
        return { mode: 'groups', groupNames: names, schoolNames: [], boundStudentCount: count };
    }
    const ids = readObjectIds(contestDoc.participantSchoolIds, 'participantSchoolIds');
    return { mode: 'schools', groupNames: [], schoolNames: await schoolNames(domainId, ids), boundStudentCount: null };
}

/** Structured problems created by a teacher omit `pid`. The problem page shows `P{docId}` for that shape. */
function displayedProblemPid(docId: number, raw: unknown): string {
    if (typeof raw === 'string' && raw !== '') return raw;
    if (raw == null || raw === '') return `P${docId}`;
    invalid('pids', localizedErrorText`题目数据无效。`);
}

function readProblemRow(docId: number, raw: unknown, actorId: number): TeachPaperProblem | null {
    if (!isRecord(raw) || raw.docId !== docId) return null;
    if (typeof raw.title !== 'string') invalid('pids', localizedErrorText`题目数据无效。`);
    const pid = displayedProblemPid(docId, raw.pid);
    let kind: ProblemKind;
    try {
        kind = effectiveProblemKind({ problemKind: raw.problemKind });
    } catch (error) {
        if (error instanceof TypeError) {
            logger.error('Teach workbench problem kind rejected docId=%d', docId);
            invalid('problemKind', localizedErrorText`题目的题型无效。`);
        }
        throw error;
    }
    if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') invalid('hidden', localizedErrorText`题目的隐藏状态无效。`);
    if (raw.owner !== undefined && !positiveInt(raw.owner)) invalid('owner', localizedErrorText`题目的所有者无效。`);
    let difficulty: number | null;
    if (raw.difficulty == null) difficulty = null;
    else if (typeof raw.difficulty === 'number' && Number.isFinite(raw.difficulty)) difficulty = raw.difficulty;
    else invalid('difficulty', localizedErrorText`题目的难度无效。`);
    return {
        docId,
        pid,
        title: raw.title,
        kind,
        score: null,
        hidden: raw.hidden === true,
        mine: raw.owner === actorId,
        difficulty,
    };
}

function deletedProblem(docId: number, score: number | null): TeachPaperProblem {
    return {
        docId,
        pid: '',
        title: '（题目已删除）',
        kind: 'programming',
        score,
        hidden: true,
        mine: false,
        difficulty: null,
    };
}

async function paperProblems(
    domainId: string,
    type: TeachType,
    rule: string,
    containerId: string,
    pids: readonly number[],
    score: unknown,
    actorId: number,
): Promise<TeachPaperProblem[]> {
    // indexByDocIdOnly keeps a missing docId absent. The default filler would look like a real problem.
    const listed = pids.length
        ? await problem.getList(domainId, [...pids], true, false, PAPER_PROJECTION, true)
        : {};
    return pids.map((docId) => {
        const weight = scoreFor(type, rule, score, docId);
        const row = readProblemRow(docId, listed[docId], actorId);
        if (row) {
            row.score = weight;
            return row;
        }
        logger.error('Teach workbench problem missing domain=%s id=%s docId=%d', domainId, containerId, docId);
        return deletedProblem(docId, weight);
    });
}

interface AttemptFacts {
    submitted: boolean;
    accepted: Set<number>;
    attempted: Set<number>;
}

interface PersonFacts extends AttemptFacts {
    attend: boolean;
    enroll: boolean;
    started: boolean;
    finalized: boolean;
}

function blankPerson(): PersonFacts {
    return {
        attend: false,
        enroll: false,
        started: false,
        finalized: false,
        submitted: false,
        accepted: new Set(),
        attempted: new Set(),
    };
}

function readJournal(raw: unknown): Array<{ pid: number; status: number }> | null {
    if (raw == null) return null;
    if (!Array.isArray(raw)) invalid('journal', localizedErrorText`提交记录无效。`);
    return raw.map((entry) => {
        if (!isRecord(entry) || !positiveInt(entry.pid) || typeof entry.status !== 'number' || !Number.isSafeInteger(entry.status)) {
            invalid('journal', localizedErrorText`提交记录无效。`);
        }
        return { pid: entry.pid, status: entry.status };
    });
}

function factsFromJournal(journal: Array<{ pid: number; status: number }> | null): AttemptFacts {
    const accepted = new Set<number>();
    const attempted = new Set<number>();
    if (!journal?.length) return { submitted: false, accepted, attempted };
    for (const entry of journal) {
        attempted.add(entry.pid);
        if (entry.status === STATUS.STATUS_ACCEPTED) accepted.add(entry.pid);
    }
    return { submitted: true, accepted, attempted };
}

async function loadStatusRows(domainId: string, type: TeachType, id: ObjectId): Promise<unknown[]> {
    const cursor = type === 'practice'
        ? training.getMultiStatus(domainId, { docId: id })
        : contest.getMultiStatus(domainId, { docId: id });
    return cursor.project(STATUS_PROJECTION).toArray();
}

function collectPeople(rows: readonly unknown[]): Map<number, PersonFacts> {
    const people = new Map<number, PersonFacts>();
    for (const raw of rows) {
        if (!isRecord(raw) || !positiveInt(raw.uid)) invalid('uid', localizedErrorText`题目集的参与记录无效。`);
        const facts = people.get(raw.uid) ?? blankPerson();
        if (raw.attend === 1) facts.attend = true;
        if (raw.enroll === 1) facts.enroll = true;
        if (readOptionalDate(raw.startAt, 'startAt')) facts.started = true;
        if (readOptionalDate(raw.paperFinalizedAt, 'paperFinalizedAt')) facts.finalized = true;
        const attempt = factsFromJournal(readJournal(raw.journal));
        if (attempt.submitted) {
            facts.submitted = true;
            for (const pid of attempt.attempted) facts.attempted.add(pid);
            for (const pid of attempt.accepted) facts.accepted.add(pid);
        }
        people.set(raw.uid, facts);
    }
    return people;
}

function countWhere(people: Map<number, PersonFacts>, pick: (facts: PersonFacts) => boolean): number {
    let count = 0;
    for (const facts of people.values()) if (pick(facts)) count += 1;
    return count;
}

function problemStatsFor(pids: readonly number[], units: readonly AttemptFacts[]): TeachProblemStat[] {
    const seen = new Set<number>();
    const stats: TeachProblemStat[] = [];
    for (const docId of pids) {
        if (seen.has(docId)) continue;
        seen.add(docId);
        let accepted = 0;
        let attempted = 0;
        for (const facts of units) {
            if (facts.attempted.has(docId)) attempted += 1;
            if (facts.accepted.has(docId)) accepted += 1;
        }
        stats.push({ docId, accepted, attempted });
    }
    return stats;
}

/** Team journals live on contest.teamStatuses. Each document is one counter, never a member uid. */
async function loadTeamAttemptFacts(domainId: string, contestId: ObjectId): Promise<AttemptFacts[]> {
    const rows: unknown[] = await teamStatusColl.find({ domainId, contestId }).project({ journal: 1 }).toArray();
    return rows.map((raw) => {
        if (!isRecord(raw)) invalid('journal', localizedErrorText`提交记录无效。`);
        return factsFromJournal(readJournal(raw.journal));
    });
}

async function statsFor(
    domainId: string,
    type: TeachType,
    id: ObjectId,
    pids: readonly number[],
    personalLimit: boolean,
    audienceCount: number | null,
    participationMode: 'individual' | 'team',
): Promise<TeachStats> {
    const people = collectPeople(await loadStatusRows(domainId, type, id));
    const practice = type === 'practice';
    const teamFacts = !practice && participationMode === 'team' ? await loadTeamAttemptFacts(domainId, id) : [];
    const submittedCount = practice
        ? null
        : countWhere(people, (facts) => facts.submitted) + teamFacts.filter((facts) => facts.submitted).length;
    return {
        participantCount: countWhere(people, (facts) => (practice ? facts.enroll : facts.attend)),
        startedCount: type === 'exam' || (type === 'homework' && personalLimit) ? countWhere(people, (facts) => facts.started) : null,
        finalizedCount: type === 'exam' ? countWhere(people, (facts) => facts.finalized) : null,
        submittedCount,
        recordCount: practice ? null : await record.coll.countDocuments({ domainId, contest: id }),
        audienceCount,
        problemStats: practice ? null : problemStatsFor(pids, [...people.values(), ...teamFacts]),
    };
}

function windowOf(type: TeachType, doc: Tdoc): { status: TeachStatus; beginAt: string | null; endAt: string | null } {
    if (type === 'practice') return { status: teachStatusOf({ type }, new Date()), beginAt: null, endAt: null };
    const beginAt = readDate(doc.beginAt, 'beginAt');
    const endAt = readDate(doc.endAt, 'endAt');
    try {
        return { status: teachStatusOf({ type, beginAt, endAt }, new Date()), beginAt: beginAt.toISOString(), endAt: endAt.toISOString() };
    } catch (error) {
        rethrowType(error, ['teach_window_invalid'], 'beginAt', localizedErrorText`题目集的开放时间无效。`);
    }
}

function readShared(raw: unknown): ReturnType<typeof readSchoolShared> {
    try {
        return readSchoolShared(raw);
    } catch (error) {
        rethrowType(error, ['teach_school_shared_invalid'], 'schoolShared', localizedErrorText`学校共享数据无效。`);
    }
}

function readCopied(raw: unknown): ReturnType<typeof readCopiedFrom> {
    try {
        return readCopiedFrom(raw);
    } catch (error) {
        rethrowType(error, ['teach_copied_from_invalid'], 'copiedFrom', localizedErrorText`复制来源数据无效。`);
    }
}

export async function buildTeachWorkbenchPayload(domainId: string, actor: User, type: TeachType, doc: TeachDoc): Promise<TeachWorkbenchPayload> {
    const id = containerIdOf(doc);
    const idText = id.toHexString();
    const contestDoc = doc as Tdoc;
    const rule = type === 'practice' ? 'problem_set' : contestDoc.rule;
    if (typeof rule !== 'string' || !rule) invalid('rule', localizedErrorText`题目集的赛制无效。`);
    const title = readTitle(doc.title);
    const ownerUid = readOwnerUid(doc.owner);
    const maintainerUids = readMaintainerUids(doc.maintainer);
    const stages = type === 'practice' ? readStages((doc as TrainingDoc).dag) : null;
    const pids = stages ? stages.flatMap((stage) => stage.pids) : readPids(contestDoc.pids);
    const durationMinutes = readDurationMinutes(type, type === 'practice' ? null : contestDoc.duration);
    const opened = windowOf(type, contestDoc);
    const limits = readExamLimits(type, contestDoc);
    const entry = readEntry(contestDoc);
    const participationMode = type === 'practice' ? 'individual' as const : contest.getParticipationMode(contestDoc);
    const shared = readShared(doc.schoolShared);
    const copied = readCopied(doc.copiedFrom);
    const nameUids = [ownerUid, ...maintainerUids];
    if (shared) nameUids.push(shared.sharedBy);
    if (copied) nameUids.push(copied.ownerUid);
    const [names, audience, problems] = await Promise.all([
        namesFor(domainId, nameUids),
        audienceFor(domainId, type, doc),
        paperProblems(domainId, type, rule, idText, pids, contestDoc.score, actor._id),
    ]);
    const stats = await statsFor(domainId, type, id, pids, durationMinutes !== null, audience.boundStudentCount, participationMode);
    const links = linksFor(type, rule, idText, actor, ownerUid, participationMode);
    const payload: TeachWorkbenchPayload = {
        container: {
            type,
            id: idText,
            rule,
            title,
            status: opened.status,
            beginAt: opened.beginAt,
            endAt: opened.endAt,
            durationMinutes,
            penaltySince: type === 'homework' ? readOptionalDate(contestDoc.penaltySince, 'penaltySince')?.toISOString() ?? null : null,
            lockAt: type === 'acm' || type === 'oi' ? readOptionalDate(contestDoc.lockAt, 'lockAt')?.toISOString() ?? null : null,
            audience,
            owner: { uid: ownerUid, name: nameOf(names, ownerUid) },
            maintainers: maintainerUids.map((uid) => ({ uid, name: nameOf(names, uid) })),
            createdAt: id.getTimestamp().toISOString(),
            schoolShared: shared ? { sharedAt: shared.sharedAt.toISOString(), sharedByName: nameOf(names, shared.sharedBy) } : null,
            copiedFrom: copied
                ? { type: copied.type, id: copied.id.toHexString(), title: copied.title, ownerName: nameOf(names, copied.ownerUid) }
                : null,
            examPassScore: limits.examPassScore,
            examAttemptLimit: limits.examAttemptLimit,
            participationMode,
            vigilEnabled: entry.vigilEnabled,
            entryMode: entry.entryMode,
            links,
        },
        paper: { problems, stages, examPaperQuotas: readQuotas(type, contestDoc.examPaperQuotas) },
        stats,
        capabilities: {
            canDelete: canDeleteContainer(actor, type, doc),
            canShare: ownerUid === actor._id || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            canGrade: links.grading !== null,
            canManageTeamBatches: canManageTeamBatches(actor),
            isSystemAdmin: actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
            canPin: type === 'practice' && actor.hasPerm(PERM.PERM_PIN_TRAINING),
        },
    };
    logger.info(
        'Teach workbench domain=%s uid=%d type=%s id=%s problems=%d participants=%d result=ok',
        domainId,
        actor._id,
        type,
        idText,
        problems.length,
        stats.participantCount,
    );
    return payload;
}

export async function buildTeachComposePayload(domainId: string, actor: User, type: TeachType, doc: TeachDoc): Promise<TeachComposePayload> {
    const [workbench, options] = await Promise.all([
        buildTeachWorkbenchPayload(domainId, actor, type, doc),
        listKnowledgeMindmapOptions(),
    ]);
    return {
        container: workbench.container,
        paper: workbench.paper,
        examStartedCount: type === 'exam' ? workbench.stats.startedCount ?? 0 : 0,
        knowledgeOptions: options.map((option) => ({ id: option.id, mapId: option.mapId, label: option.label })),
        canCreateObjective: problem.canCreateAllProblemKinds(actor),
    };
}
