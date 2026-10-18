import { escapeRegExp } from 'lodash';
import { type Filter, ObjectId } from 'mongodb';
import { isExamPaperFinalized, isExamPaperStarted, studentContestProblemPids } from '@hydrooj/common';
import { ValidationError } from '../error';
import type { Tdoc } from '../interface';
import {
    contestViewerClass,
    loadTeacherContainerScope,
    teacherContestFilter,
    type ContainerViewerClass,
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
    flavorOf,
    pickDefaultTab,
    serializeContestRow,
    sortRunning,
    sortUpcoming,
    type ContestFlavor,
    type ContestRow,
    type ContestRowStatus,
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
import { getDraftsForUser } from '../model/paper-draft';
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
    kind: 'exam' | 'homework';
    id: string;
    flavor: ContestFlavor;
    title: string;
    href: string;
    endAt: string;
    result:
        | { kind: 'absent' }
        | { kind: 'hidden' }
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

interface EndedStatus extends ContestRowStatus {
    penaltyScore?: number;
    accept?: number;
    score?: number;
}

function registeredContestRules(): string[] {
    const rules = contest.RULES as Record<string, unknown> | undefined;
    if (!rules) throw new TypeError('contest.RULES is unavailable');
    return CONTEST_RULES.filter((rule) => Object.hasOwn(rules, rule));
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

function didParticipate(tdoc: Tdoc, tsdoc: EndedStatus | null): boolean {
    if (!tsdoc) return false;
    const started = tsdoc.startAt instanceof Date && !Number.isNaN(tsdoc.startAt.getTime());
    if (tdoc.rule === 'exam') return started;
    if (typeof tdoc.duration === 'number' && tdoc.duration > 0) return started;
    return tsdoc.attend === 1;
}

function finiteOrThrow(value: unknown, field: string): number | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${field} must be a finite number`);
    return value;
}

function selfRecordVisible(actor: StudentSetsActor, tdoc: Tdoc): boolean {
    const show = contest.canShowSelfRecord as
        | ((this: { user: StudentSetsActor }, doc: Tdoc) => boolean)
        | undefined;
    if (typeof show !== 'function') throw new TypeError('contest.canShowSelfRecord is unavailable');
    return show.call({ user: actor }, tdoc);
}

function endedResult(actor: StudentSetsActor, tdoc: Tdoc, tsdoc: EndedStatus | null): EndedRow['result'] {
    if (!didParticipate(tdoc, tsdoc)) return { kind: 'absent' };
    if (!selfRecordVisible(actor, tdoc)) return { kind: 'hidden' };
    if (flavorOf(tdoc.rule) === 'acm') return { kind: 'accepted', accepted: finiteOrThrow(tsdoc?.accept, 'accept') ?? 0 };
    const raw = tdoc.rule === 'homework'
        ? (finiteOrThrow(tsdoc?.penaltyScore, 'penaltyScore') ?? finiteOrThrow(tsdoc?.score, 'score'))
        : finiteOrThrow(tsdoc?.score, 'score');
    return { kind: 'score', score: raw ?? 0 };
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
    const contestClass = contestViewerClass(actor, 'acm');
    const homeworkClass = contestViewerClass(actor, 'homework');
    const contestRules = registeredContestRules();
    let teacherScopePromise: Promise<TeacherContainerScope> | undefined;
    const teacherScope = () => {
        teacherScopePromise ??= loadTeacherContainerScope(domainId, actor._id);
        return teacherScopePromise;
    };
    let contestStudentFilter: Promise<Filter<Tdoc>> | undefined;
    let homeworkStudentFilter: Promise<Filter<Tdoc>> | undefined;
    const visibility = async (viewer: ContainerViewerClass, kind: 'contest' | 'homework'): Promise<Filter<Tdoc>> => {
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
    const loadDocs = async (kind: 'contest' | 'homework', window: 'open' | 'ended', type: EndedType): Promise<Tdoc[]> => {
        const rules = kind === 'homework' ? ['homework'] : contestRules;
        if (kind === 'contest' && type === 'homework') return [];
        if (kind === 'homework' && type === 'exam') return [];
        if (!rules.length) return [];
        const viewer = kind === 'homework' ? homeworkClass : contestClass;
        const filter: Filter<Tdoc> = {
            ...ruleClause(rules),
            ...(window === 'open' ? { endAt: { $gt: now } } : { endAt: { $lte: now }, ...titleClause(q) }),
            ...(await visibility(viewer, kind)),
        };
        return contest.getMulti(domainId, filter).toArray();
    };
    const openDocs = [
        ...(await loadDocs('contest', 'open', 'all')),
        ...(await loadDocs('homework', 'open', 'all')),
    ];
    const openStatus = await contest.getListStatus(
        domainId,
        actor._id,
        openDocs.map((tdoc) => tdoc.docId),
    ) as Record<string, ContestRowStatus | null | undefined>;
    const draftCounts = new Map<string, number | null>();
    await Promise.all(openDocs.map(async (tdoc) => {
        const id = tdoc.docId.toHexString();
        const tsdoc = openStatus[id] ?? null;
        if (tdoc.rule !== 'exam' || !isExamPaperStarted(tsdoc) || isExamPaperFinalized(tsdoc)) {
            draftCounts.set(id, null);
            return;
        }
        const visible = new Set(studentContestProblemPids(tdoc, tsdoc));
        const drafts = await getDraftsForUser(domainId, tdoc.docId, actor._id);
        let count = 0;
        for (const draft of drafts) {
            if (visible.has(draft.pid)) count += 1;
        }
        draftCounts.set(id, count);
    }));
    const openRows = openDocs.map((tdoc) => {
        const id = tdoc.docId.toHexString();
        return serializeContestRow({
            tdoc,
            tsdoc: openStatus[id] ?? null,
            href: tdoc.rule === 'homework' ? hrefs.homework(id) : hrefs.contest(id),
            draftCount: draftCounts.get(id) ?? null,
            now,
        });
    });
    const contestRunning = openRows.filter((row) => classifyWindow(new Date(row.beginAt), new Date(row.endAt), now) === 'running');
    const contestUpcoming = openRows.filter((row) => classifyWindow(new Date(row.beginAt), new Date(row.endAt), now) === 'upcoming');
    const teams = contestClass === 'teacher' ? [] : await loadTeamRows(domainId, actor._id, hrefs);
    const runningRows = sortRunning([...teams, ...contestRunning], now);
    const upcomingRows = sortUpcoming(contestUpcoming);
    const practiceArgs = {
        pageSize: practicePageSize,
        hrefFor: hrefs.practice,
        buildScopedProgress,
    };
    const practiceCount = await loadPracticeList(domainId, actor, { q: '', page: 1, ...practiceArgs });
    const counts: StudentSetCounts = {
        running: runningRows.length,
        upcoming: upcomingRows.length,
        practice: practiceCount.total,
    };
    const tab = requestedTab ?? pickDefaultTab(counts);
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
        const endedStatus = await contest.getListStatus(
            domainId,
            actor._id,
            pageDocs.map((tdoc) => tdoc.docId),
        ) as Record<string, EndedStatus | null | undefined>;
        return {
            tab,
            counts,
            rows: [],
            practice: null,
            ended: {
                rows: pageDocs.map((tdoc) => {
                    const id = tdoc.docId.toHexString();
                    const flavor = flavorOf(tdoc.rule);
                    return {
                        kind: flavor === 'homework' ? 'homework' : 'exam',
                        id,
                        flavor,
                        title: tdoc.title,
                        href: tdoc.rule === 'homework' ? hrefs.homework(id) : hrefs.contest(id),
                        endAt: tdoc.endAt.toISOString(),
                        result: endedResult(actor, tdoc, endedStatus[id] ?? null),
                    };
                }),
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
