import { escapeRegExp } from 'lodash';
import { type Filter, ObjectId } from 'mongodb';
import { readStoredSetConfig, roundPersonalEnd, selectRound, type SetConfig } from '@hydrooj/common';
import { ValidationError } from '../error';
import type { Tdoc } from '../interface';
import {
    contestViewerClass,
    loadTeacherContainerScope,
    teacherContestFilter,
    type TeacherContainerScope,
} from './container-visibility';
import {
    listAccessQuery,
    parentSchoolIdsFromUser,
    resolveContestListParticipantScope,
} from './contest-list-access';
import {
    loadPracticeList,
    type PracticeProgressBuilder,
    type PracticeRow,
} from './practice-list';
import {
    classifyWindow,
    configuredFlavor,
    pickDefaultTab,
    serializeContestRow,
    sortRunning,
    sortUpcoming,
    type ContestFlavor,
    type ContestRow,
    type StudentSetCounts,
    type StudentSetsTab,
    type TeamRow,
} from './student-sets';
import { canBrowseAssignRestrictedContests } from '../handler/contest';
import {
    buildHomeworkListAccessFilter,
    getHomeworkUserGroupIds,
    participantGroupObjectIds,
} from '../model/homework-access';
import * as contest from '../model/contest';
import { getMultiBatch, getPendingInvitesForUser, getTeamByMember } from '../model/contest-team-batch';
import { getParticipationMode, isTeamBatchFinalizationPending } from '../model/contest-participation';
import { getTeamByMember as getContestTeamByMember } from '../model/contest-team';
import { withContestTeamBoundary } from '../model/contest-team-gate';
import { listRounds, listSubmittedPids, participantKey, type RoundDoc } from '../model/set-round';
import { setPermissionsFor } from './set-permissions';
import { canShowFormalSetScore } from './set-round-score-visible';
import user from '../model/user';

const CONTEST_RULES = ['exam', 'acm', 'oi', 'ioi', 'strictioi', 'ledo'] as const;
const ENDED_PAGE_SIZE = 20;
const TABS: readonly StudentSetsTab[] = ['running', 'upcoming', 'practice', 'ended'];
const ENDED_TYPES = ['all', 'exam', 'homework'] as const;

type EndedType = (typeof ENDED_TYPES)[number];

export interface StudentSetsActor {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
    own: (doc: { owner: number; maintainer?: number[] }) => boolean;
}

export interface StudentSetsQuery {
    tab?: unknown;
    page?: unknown;
    q?: unknown;
    type?: unknown;
    practicePageSize?: number;
}

export interface StudentSetHrefs {
    contest: (tid: string) => string;
    homework: (tid: string) => string;
    practice: (tid: string) => string;
    team: (batchId: string) => string;
}

export interface EndedRow {
    purpose: SetConfig['purpose'];
    kind: 'exam' | 'homework';
    id: string;
    flavor: ContestFlavor;
    title: string;
    href: string;
    endAt: string;
    result:
        | { kind: 'absent' }
        | { kind: 'hidden' }
        | { kind: 'pending' }
        | { kind: 'score'; score: number }
        | { kind: 'accepted'; accepted: number };
}

export interface StudentSetsBody {
    tab: StudentSetsTab;
    counts: StudentSetCounts;
    rows: Array<ContestRow | PracticeRow | TeamRow>;
    practice: { page: number; pageCount: number; q: string } | null;
    ended: {
        rows: EndedRow[];
        page: number;
        pageCount: number;
        total: number;
        type: EndedType;
        q: string;
    } | null;
}

function registeredContestRules(): string[] {
    const rules = contest.RULES as Record<string, unknown> | undefined;
    if (!rules) throw new TypeError('contest.RULES is unavailable');
    return ['contest', ...CONTEST_RULES.filter((rule) => Object.hasOwn(rules, rule))];
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw new ValidationError(field);
    return value as T;
}

function normalizeQueryText(value: unknown): string {
    if (value == null) return '';
    if (typeof value !== 'string') throw new ValidationError('q');
    const trimmed = value.trim();
    if (trimmed.length > 64) throw new ValidationError('q');
    return trimmed;
}

function normalizePage(value: unknown): number {
    if (value == null || value === '') return 1;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new ValidationError('page');
    return value;
}

function titleClause(q: string): Filter<Tdoc> {
    if (!q) return {};
    return { title: { $regex: new RegExp(escapeRegExp(q), 'i') } };
}

function ruleClause(rules: readonly string[]): Filter<Tdoc> {
    return rules.length === 1 ? { rule: rules[0] } : { rule: { $in: [...rules] } };
}

/** Drafts and documents without a configuration stay out of student lists. */
function publishedSetClause(): Filter<Tdoc> {
    return { 'setConfig.publication': 'published' };
}

async function endedResult(tdoc: Tdoc, config: SetConfig, rounds: RoundDoc[], uid: number, now: Date): Promise<EndedRow['result']> {
    // The deadline closes an attempt even if the student has not revisited the workspace.
    const closed = rounds.map((round) => round.state === 'closed' ? round : {
        ...round, state: 'closed' as const, closedAt: roundPersonalEnd(config.settings, tdoc.endAt, round.startedAt),
    });
    const chosen = selectRound(config.settings, closed);
    if (!chosen) return { kind: 'absent' };
    if (!await canShowFormalSetScore(tdoc, config, chosen, uid, now)) return { kind: 'hidden' };
    const candidates = config.settings.retake.pick === 'last_round' ? [chosen] : closed;
    if (candidates.some((round) => !round.legacy?.scoreLocked && (round.scoreDirty || tdoc.statusRecalcToken))) return { kind: 'pending' };
    if (config.settings.codePolicy === 'acm') {
        if (!Number.isSafeInteger(chosen.accept) || chosen.accept < 0) throw new TypeError(`set_round_accept_invalid: ${tdoc.domainId}/${tdoc.docId}/${chosen.roundNo}`);
        return { kind: 'accepted', accepted: chosen.accept };
    }
    if (!Number.isFinite(chosen.total)) throw new TypeError(`set_round_total_invalid: ${tdoc.domainId}/${tdoc.docId}/${chosen.roundNo}`);
    return { kind: 'score', score: chosen.total };
}

function batchTitle(batch: { name?: unknown; title?: unknown }): string {
    // TeamBatchDoc stores the label in `name`. Row payloads call it `title`.
    if (typeof batch.name === 'string') return batch.name;
    if (typeof batch.title === 'string') return batch.title;
    throw new TypeError('batch name must be a string');
}

function compareEnded(left: Tdoc, right: Tdoc): number {
    const byEnd = right.endAt.getTime() - left.endAt.getTime();
    if (byEnd !== 0) return byEnd;
    const leftId = left.docId.toHexString();
    const rightId = right.docId.toHexString();
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    return 0;
}

function compareCalendar(left: Tdoc, right: Tdoc): number {
    const byBegin = left.beginAt.getTime() - right.beginAt.getTime();
    if (byBegin !== 0) return byBegin;
    if (typeof left.title !== 'string' || typeof right.title !== 'string') throw new TypeError('title must be a string');
    if (left.title < right.title) return -1;
    if (left.title > right.title) return 1;
    const leftId = left.docId.toHexString();
    const rightId = right.docId.toHexString();
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    return 0;
}

function requireInstant(value: Date, field: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${field} must be a Date`);
    return value;
}

function studentSetVisibility(domainId: string, actor: StudentSetsActor) {
    const contestClass = contestViewerClass(actor, 'acm');
    const homeworkClass = contestViewerClass(actor, 'homework');
    let teacherScopePromise: Promise<TeacherContainerScope> | undefined;
    const teacherScope = () => {
        teacherScopePromise ??= loadTeacherContainerScope(domainId, actor._id);
        return teacherScopePromise;
    };
    let contestStudentFilter: Promise<Filter<Tdoc>> | undefined;
    let homeworkStudentFilter: Promise<Filter<Tdoc>> | undefined;
    const filterFor = async (kind: 'contest' | 'homework'): Promise<Filter<Tdoc>> => {
        const viewer = kind === 'homework' ? homeworkClass : contestClass;
        if (viewer === 'all') return {};
        if (viewer === 'teacher') return teacherContestFilter(await teacherScope());
        if (kind === 'homework') {
            homeworkStudentFilter ??= (async () => {
                const groups = (await user.listGroup(domainId, actor._id)).map((group) => group.name);
                const participantGroups = participantGroupObjectIds(await getHomeworkUserGroupIds(domainId, actor._id));
                return buildHomeworkListAccessFilter(actor._id, groups, participantGroups);
            })();
            return homeworkStudentFilter;
        }
        contestStudentFilter ??= (async () => {
            const canBrowse = canBrowseAssignRestrictedContests(actor);
            const groups = (await user.listGroup(domainId, canBrowse ? undefined : actor._id)).map((group) => group.name);
            const participantScope = await resolveContestListParticipantScope(
                domainId,
                actor._id,
                canBrowse,
                parentSchoolIdsFromUser(actor),
            );
            return listAccessQuery(actor._id, groups, canBrowse, participantScope);
        })();
        return contestStudentFilter;
    };
    return { contestClass, filterFor };
}

async function participantRounds(domainId: string, uid: number, docs: readonly Tdoc[]): Promise<Map<string, RoundDoc[]>> {
    const bySet = new Map<string, RoundDoc[]>();
    const individuals = docs.filter((doc) => getParticipationMode(doc) === 'individual').map((doc) => doc.docId);
    if (individuals.length) {
        for (const round of await listRounds(domainId, individuals, participantKey(uid))) {
            const id = round.tid.toHexString();
            const entries = bySet.get(id) ?? [];
            entries.push(round);
            bySet.set(id, entries);
        }
    }
    await Promise.all(docs.filter((doc) => getParticipationMode(doc) === 'team' && !isTeamBatchFinalizationPending(doc)).map((doc) =>
        withContestTeamBoundary(domainId, doc.docId, async () => {
            const team = await getContestTeamByMember(domainId, doc.docId, uid);
            if (team) bySet.set(doc.docId.toHexString(), await listRounds(domainId, doc.docId, participantKey(uid, team.teamId)));
        })));
    return bySet;
}

async function serializeVisibleContests(
    domainId: string,
    uid: number,
    docs: readonly Tdoc[],
    hrefs: StudentSetHrefs,
    now: Date,
): Promise<ContestRow[]> {
    if (!docs.length) return [];
    const [registrations, rounds] = await Promise.all([
        contest.getMultiStatus(domainId, { uid, attend: 1, docId: { $in: docs.map((doc) => doc.docId) } })
            .project<{ docId: ObjectId }>({ _id: 0, docId: 1 }).toArray(),
        participantRounds(domainId, uid, docs),
    ]);
    const registered = new Set(registrations.map((status) => status.docId.toHexString()));
    const current = new Map([...rounds].map(([id, entries]) => [id, entries.find((entry) => entry.state === 'open') ?? entries.at(-1)]));
    const submitted = await listSubmittedPids(domainId, [...current.values()].flatMap((round) => round ? [round._id] : []));
    return Promise.all(docs.map(async (tdoc) => {
        const id = tdoc.docId.toHexString();
        const round = current.get(id);
        const attended = getParticipationMode(tdoc) === 'team' ? rounds.has(id) : registered.has(id);
        const permissions = await setPermissionsFor(tdoc, uid);
        return serializeContestRow({
            tdoc, tsdoc: attended ? { attend: 1 } : null, currentRound: round,
            submittedPids: round && submitted.get(round._id.toHexString()),
            problemAccess: permissions?.afterEnd === false && now >= tdoc.endAt ? 'hidden' : permissions?.problems,
            href: tdoc.rule === 'homework' ? hrefs.homework(id) : hrefs.contest(id),
            draftCount: null, now,
        });
    }));
}

export interface StudentCalendarRange {
    from: Date;
    to: Date;
}

export interface StudentCalendarBody {
    view: 'calendar';
    from: string;
    to: string;
    rows: ContestRow[];
}

export async function loadStudentCalendar(
    domainId: string,
    actor: StudentSetsActor,
    range: StudentCalendarRange,
    hrefs: StudentSetHrefs,
    now: Date,
): Promise<StudentCalendarBody> {
    requireInstant(now, 'now');
    const from = requireInstant(range.from, 'from');
    const to = requireInstant(range.to, 'to');
    const visibility = studentSetVisibility(domainId, actor);
    const contestRules = registeredContestRules();
    const overlap = { beginAt: { $lt: to }, endAt: { $gt: from } };
    const contestDocs = await contest.getMulti(domainId, {
        ...ruleClause(contestRules),
        ...overlap,
        ...publishedSetClause(),
        ...(await visibility.filterFor('contest')),
    }).toArray();
    const homeworkDocs = await contest.getMulti(domainId, {
        ...ruleClause(['homework']),
        ...overlap,
        ...publishedSetClause(),
        ...(await visibility.filterFor('homework')),
    }).toArray();
    const docs = [...contestDocs, ...homeworkDocs].sort(compareCalendar);
    return {
        view: 'calendar',
        from: from.toISOString(),
        to: to.toISOString(),
        rows: await serializeVisibleContests(domainId, actor._id, docs, hrefs, now),
    };
}

export async function loadStudentSets(
    domainId: string,
    actor: StudentSetsActor,
    query: StudentSetsQuery,
    hrefs: StudentSetHrefs,
    now: Date,
    buildScopedProgress?: PracticeProgressBuilder,
): Promise<StudentSetsBody> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now must be a Date');
    const requestedTab = optionalEnum(query.tab, TABS, 'tab');
    const endedType = optionalEnum(query.type, ENDED_TYPES, 'type') ?? 'all';
    const q = normalizeQueryText(query.q);
    const page = normalizePage(query.page);
    const practicePageSize = query.practicePageSize;
    const visibility = studentSetVisibility(domainId, actor);
    const contestRules = registeredContestRules();
    const loadDocs = async (kind: 'contest' | 'homework', window: 'open' | 'ended', type: EndedType): Promise<Tdoc[]> => {
        const rules = kind === 'homework' ? ['homework'] : contestRules;
        const filter: Filter<Tdoc> = {
            ...ruleClause(rules),
            ...publishedSetClause(),
            ...(type === 'all' ? {} : { 'setConfig.purpose': type === 'exam' ? { $in: ['exam', 'contest'] } : 'homework' }),
            ...(window === 'open' ? { endAt: { $gt: now } } : { endAt: { $lte: now }, ...titleClause(q) }),
            ...(await visibility.filterFor(kind)),
        };
        return contest.getMulti(domainId, filter).toArray();
    };
    const openDocs = [
        ...(await loadDocs('contest', 'open', 'all')),
        ...(await loadDocs('homework', 'open', 'all')),
    ];
    const openRows = await serializeVisibleContests(domainId, actor._id, openDocs, hrefs, now);
    const contestRunning = openRows.filter((row) => classifyWindow(new Date(row.beginAt), new Date(row.endAt), now) === 'running');
    const contestUpcoming = openRows.filter((row) => classifyWindow(new Date(row.beginAt), new Date(row.endAt), now) === 'upcoming');
    const teams = visibility.contestClass === 'teacher' ? [] : await loadTeamRows(domainId, actor._id, hrefs);
    const runningRows = sortRunning([...teams, ...contestRunning], now);
    const upcomingRows = sortUpcoming(contestUpcoming);
    const practiceArgs = {
        pageSize: practicePageSize,
        hrefFor: hrefs.practice,
        buildScopedProgress,
    };
    const counts = { running: runningRows.length, upcoming: upcomingRows.length, practice: 0 };
    const tab = requestedTab ?? pickDefaultTab(counts);
    const firstPracticePage = tab === 'practice' && q === '' && page === 1;
    const practiceCount = await loadPracticeList(domainId, actor, { q: '', page: 1, ...practiceArgs, countOnly: !firstPracticePage });
    counts.practice = practiceCount.total;
    if (tab === 'practice') {
        const practicePage = q === '' && page === 1
            ? practiceCount
            : await loadPracticeList(domainId, actor, { q, page, ...practiceArgs });
        return {
            tab,
            counts,
            rows: practicePage.rows,
            practice: { page: practicePage.page, pageCount: practicePage.pageCount, q },
            ended: null,
        };
    }
    if (tab === 'ended') {
        const endedDocs = [
            ...(await loadDocs('contest', 'ended', endedType)),
            ...(await loadDocs('homework', 'ended', endedType)),
        ].sort(compareEnded);
        const pageCount = Math.max(1, Math.ceil(endedDocs.length / ENDED_PAGE_SIZE));
        const pageDocs = endedDocs.slice((page - 1) * ENDED_PAGE_SIZE, page * ENDED_PAGE_SIZE);
        const rounds = await participantRounds(domainId, actor._id, pageDocs);
        return {
            tab,
            counts,
            rows: [],
            practice: null,
            ended: {
                rows: await Promise.all(pageDocs.map(async (tdoc): Promise<EndedRow> => {
                    const id = tdoc.docId.toHexString();
                    const config = readStoredSetConfig(tdoc);
                    const flavor = configuredFlavor(config);
                    return {
                        kind: flavor === 'homework' ? 'homework' : 'exam',
                        purpose: config.purpose,
                        id,
                        flavor,
                        title: tdoc.title,
                        href: tdoc.rule === 'homework' ? hrefs.homework(id) : hrefs.contest(id),
                        endAt: tdoc.endAt.toISOString(),
                        result: await endedResult(tdoc, config, rounds.get(id) ?? [], actor._id, now),
                    };
                })),
                page,
                pageCount,
                total: endedDocs.length,
                type: endedType,
                q,
            },
        };
    }
    return {
        tab,
        counts,
        rows: tab === 'running' ? runningRows : upcomingRows,
        practice: null,
        ended: null,
    };
}

async function loadTeamRows(domainId: string, uid: number, hrefs: StudentSetHrefs): Promise<TeamRow[]> {
    const batches = await getMultiBatch(domainId, { status: 'open' }).toArray();
    return Promise.all(batches.map(async (batch) => {
        if (!(batch.batchId instanceof ObjectId)) throw new TypeError('batchId must be an ObjectId');
        if (typeof batch.description !== 'string') throw new TypeError('batch description must be a string');
        const [team, invites] = await Promise.all([
            getTeamByMember(domainId, batch.batchId, uid),
            getPendingInvitesForUser(domainId, batch.batchId, uid).toArray(),
        ]);
        const id = batch.batchId.toHexString();
        return {
            kind: 'team',
            id,
            title: batchTitle(batch),
            href: hrefs.team(id),
            description: batch.description,
            myState: team ? 'joined' : invites.length > 0 ? 'invited' : 'none',
            inviteCount: invites.length,
            memberCount: team ? team.memberUids.length : null,
        };
    }));
}
