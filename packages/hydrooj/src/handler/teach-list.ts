import { escapeRegExp } from 'lodash';
import { type Filter, ObjectId } from 'mongodb';
import { TEACH_TYPES, teachPath, teachTypeOfContestRule, type TeachType } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { localizeError, localizedErrorText, PermissionError, ValidationError } from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { canCreateTeachType, type TeachActor } from '../lib/teach-access';
import {
    TEACH_LIST_PAGE_SIZE,
    teachListRow,
    teachSharedRow,
    type TeachListPayload,
    type TeachListRow,
    type TeachListScope,
    type TeachListStatusFilter,
    type TeachListTypeFilter,
    type TeachSharedRow,
} from '../lib/teach-list';
import { withProblemSetKind } from '../lib/training-kind';
import { serializeContestRow } from '../lib/student-sets';
import { loadPracticeCardsForDocuments } from '../lib/practice-list';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import * as document from '../model/document';
import * as training from '../model/training';
import user from '../model/user';
import { Handler } from '../service/server';
import { studentDirectory, type StudentDirectoryGroup, type StudentDirectorySchool } from '../service/student-directory';

const logger = new Logger('teach-list');
const DELETED_OWNER = '已删除的用户';

const OI_RULES = ['oi', 'ioi', 'strictioi', 'ledo'] as const;
const LIST_SCOPES = ['mine', 'shared', 'all'] as const;
const LIST_TYPES = ['all', 'practice', 'homework', 'exam', 'contest', 'quiz'] as const;
const LIST_STATUSES = ['all', 'upcoming', 'running', 'ended', 'open'] as const;
const MAX_PAGE = 1_000_000;
const CALENDAR_MAX_SPAN_MS = 42 * 24 * 60 * 60 * 1000;

type ContestTeachType = 'homework' | 'exam' | 'acm' | 'oi';

function calendarRange(args: Record<string, unknown>, domainId: string, uid: number): { from: Date; to: Date } {
    const from = typeof args.from === 'string' ? Date.parse(args.from) : Number.NaN;
    const to = typeof args.to === 'string' ? Date.parse(args.to) : Number.NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > CALENDAR_MAX_SPAN_MS) {
        logger.info('teacher calendar rejected domain=%s uid=%d stage=range', domainId, uid);
        invalid('from', localizedErrorText`请选择有效的日历日期范围，最多 42 天。`);
    }
    return { from: new Date(from), to: new Date(to) };
}

function invalid(field: string, detail: ReturnType<typeof localizedErrorText>): never {
    throw new ValidationError(field, null, detail);
}

function readChoice<T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
    field: string,
    detail: ReturnType<typeof localizedErrorText>,
): T {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    invalid(field, detail);
}

function readQueryText(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') invalid('q', localizedErrorText`搜索词无效。`);
    return value;
}

function readPage(value: unknown): number {
    if (value === undefined || value === null || value === '') return 1;
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof text !== 'string' || !/^[1-9][0-9]*$/.test(text)) invalid('page', localizedErrorText`页码必须是正整数。`);
    const page = Number(text);
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) invalid('page', localizedErrorText`页码必须是正整数。`);
    return page;
}

function readCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        invalid('count', localizedErrorText`题目集数量无效。`);
    }
    return value;
}

function canSeeAllTeach(actor: TeachActor): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || actor.hasPerm(PERM.PERM_EDIT_CONTEST)
        || actor.hasPerm(PERM.PERM_EDIT_HOMEWORK)
        || actor.hasPerm(PERM.PERM_EDIT_TRAINING);
}

function canOpenTeachList(actor: TeachActor): boolean {
    return canSeeAllTeach(actor) || TEACH_TYPES.some((type) => canCreateTeachType(actor, type));
}

function canCreateMap(actor: TeachActor): Record<TeachType, boolean> {
    const admin = actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
    return {
        practice: admin,
        homework: canCreateTeachType(actor, 'homework'),
        exam: canCreateTeachType(actor, 'exam'),
        acm: admin,
        oi: admin,
    };
}

function contestTypesFor(scope: TeachListScope, actor: TeachActor): ContestTeachType[] {
    if (scope === 'mine') return ['homework', 'exam', 'acm', 'oi'];
    if (scope === 'shared') return (['homework', 'exam', 'acm', 'oi'] as const).filter((type) => canCreateTeachType(actor, type));
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return ['homework', 'exam', 'acm', 'oi'];
    const types: ContestTeachType[] = [];
    if (actor.hasPerm(PERM.PERM_EDIT_HOMEWORK)) types.push('homework');
    if (actor.hasPerm(PERM.PERM_EDIT_CONTEST)) types.push('exam', 'acm', 'oi');
    return types;
}

function rulesForContestTypes(types: readonly ContestTeachType[]): string[] {
    const rules: string[] = [];
    for (const type of types) {
        if (type === 'homework') rules.push('homework');
        else if (type === 'exam') rules.push('exam', 'contest');
        else if (type === 'acm') rules.push('acm');
        else rules.push(...OI_RULES);
    }
    return rules;
}

function practiceVisible(scope: TeachListScope, actor: TeachActor): boolean {
    if (scope === 'mine') return true;
    if (scope === 'shared') return canCreateTeachType(actor, 'practice');
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_EDIT_TRAINING);
}

function purposeClause(type: TeachListTypeFilter): Record<string, unknown> {
    if (type === 'all') return {};
    // The course picker and existing links use quiz for homework plus exams.
    const purposes = type === 'quiz' ? ['homework', 'exam'] : [type];
    const legacyRules = type === 'contest' ? ['acm', ...OI_RULES] : purposes;
    return { $or: [
        { 'setConfig.purpose': { $in: purposes } },
        { setConfig: { $exists: false }, rule: { $in: legacyRules } },
    ] };
}

function titleClause(q: string): Record<string, unknown> {
    if (!q) return {};
    return { title: { $regex: escapeRegExp(q), $options: 'i' } };
}

function windowClause(status: TeachListStatusFilter, now: Date): Record<string, unknown> {
    if (status === 'upcoming') return { $or: [{ beginAt: { $gt: now } }, { 'setConfig.publication': 'draft' }] };
    if (status === 'running') return { beginAt: { $lte: now }, endAt: { $gt: now }, 'setConfig.publication': { $ne: 'draft' } };
    if (status === 'ended') return { beginAt: { $lte: now }, endAt: { $lte: now }, 'setConfig.publication': { $ne: 'draft' } };
    return {};
}

function scopeClause(scope: TeachListScope, uid: number): Record<string, unknown> {
    // Contest mine includes maintainers. Practice mine is owner-only and does not use this clause.
    if (scope === 'mine') return { $or: [{ owner: uid }, { maintainer: uid }] };
    if (scope === 'shared') return { owner: { $ne: uid }, 'schoolShared.sharedAt': { $exists: true } };
    return {};
}

function contestFilter(
    scope: TeachListScope,
    uid: number,
    status: TeachListStatusFilter,
    q: string,
    now: Date,
    rules: readonly string[],
    allowContestPurpose: boolean,
    type: TeachListTypeFilter,
): Filter<Tdoc> | null {
    if (!rules.length || status === 'open' || type === 'practice') return null;
    const choices: Record<string, unknown>[] = [{ rule: { $in: rules.filter((rule) => rule !== 'contest') } }];
    if (rules.includes('contest')) choices.push({ rule: 'contest', 'setConfig.purpose': 'contest' });
    return {
        ...scopeClause(scope, uid),
        ...titleClause(q),
        $and: [
            windowClause(status, now),
            purposeClause(type),
            { $or: choices },
            ...(!allowContestPurpose ? [{ $or: [{ setConfig: { $exists: false } }, { 'setConfig.purpose': { $in: ['homework', 'exam'] } }] }] : []),
        ],
    } as Filter<Tdoc>;
}

function practiceFilter(
    scope: TeachListScope,
    uid: number,
    status: TeachListStatusFilter,
    q: string,
    include: boolean,
): Filter<TrainingDoc> | null {
    if (!include || (status !== 'all' && status !== 'open')) return null;
    const filter: Record<string, unknown> = { ...titleClause(q) };
    if (scope === 'mine') filter.owner = uid;
    if (scope === 'shared') {
        filter.owner = { $ne: uid };
        filter['schoolShared.sharedAt'] = { $exists: true };
    }
    return withProblemSetKind(filter) as Filter<TrainingDoc>;
}

async function countContests(domainId: string, filter: Filter<Tdoc> | null): Promise<number> {
    if (!filter) return 0;
    return readCount(await contest.count(domainId, filter));
}

async function countPractices(domainId: string, filter: Filter<TrainingDoc> | null): Promise<number> {
    if (!filter) return 0;
    return readCount(await training.count(domainId, filter));
}

function idHex(value: unknown): string {
    if (value instanceof ObjectId) return value.toHexString();
    invalid('_id', localizedErrorText`题目集编号无效。`);
}

function newestPage(docs: Array<Tdoc | TrainingDoc>, page: number): Array<Tdoc | TrainingDoc> {
    const sorted = [...docs].sort((left, right) => {
        const leftId = idHex(left._id);
        const rightId = idHex(right._id);
        if (leftId === rightId) return 0;
        return leftId < rightId ? 1 : -1;
    });
    const start = (page - 1) * TEACH_LIST_PAGE_SIZE;
    return sorted.slice(start, start + TEACH_LIST_PAGE_SIZE);
}

function indexNames<T extends { _id: unknown; domainId: string; name: unknown }>(
    rows: readonly T[],
    domainId: string,
    field: string,
    detail: ReturnType<typeof localizedErrorText>,
): Map<string, string> {
    const names = new Map<string, string>();
    for (const row of rows) {
        if (row.domainId !== domainId) continue;
        if (!(row._id instanceof ObjectId)) invalid(field, detail);
        if (typeof row.name !== 'string' || !row.name) invalid(field, detail);
        const key = row._id.toHexString();
        if (names.has(key)) invalid(field, detail);
        names.set(key, row.name);
    }
    return names;
}

async function loadDirectories(domainId: string): Promise<{ groupNames: Map<string, string>; schoolNames: Map<string, string> }> {
    const directory = studentDirectory();
    const [groups, schools] = await Promise.all([
        directory.listUserGroups(domainId),
        directory.listSchools(domainId),
    ]);
    if (!Array.isArray(groups) || !Array.isArray(schools)) invalid('audience', localizedErrorText`题目集的受众数据无效。`);
    return {
        groupNames: indexNames<StudentDirectoryGroup>(groups, domainId, 'groups', localizedErrorText`用户组数据无效。`),
        schoolNames: indexNames<StudentDirectorySchool>(schools, domainId, 'schools', localizedErrorText`学校数据无效。`),
    };
}

async function ownerNames(domainId: string, docs: ReadonlyArray<{ owner: number }>): Promise<Map<number, string>> {
    const uids = [...new Set(docs.map((doc) => doc.owner))].filter((uid) => typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0);
    const names = new Map<number, string>();
    if (!uids.length) return names;
    const listed = await user.getList(domainId, uids);
    for (const uid of uids) {
        const udoc = listed[uid];
        // getList substitutes defaultUser (_id 0, uname "Unknown User") for a deleted account.
        if (udoc && udoc._id === uid && typeof udoc.uname === 'string' && udoc.uname) {
            names.set(uid, udoc.uname);
            continue;
        }
        logger.info('teach list owner missing domain=%s uid=%d', domainId, uid);
        names.set(uid, DELETED_OWNER);
    }
    return names;
}

async function participantCount(domainId: string, doc: Tdoc | TrainingDoc): Promise<number> {
    const practice = doc.docType === document.TYPE_TRAINING;
    const count = await document.countStatus(
        domainId,
        practice ? document.TYPE_TRAINING : document.TYPE_CONTEST,
        practice ? { docId: doc.docId, enroll: 1 } : { docId: doc.docId, attend: 1 },
    );
    return readCount(count);
}

class TeachListHandler extends Handler {
    async get(raw: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('query', localizedErrorText`查询参数无效。`);
        const args = raw as Record<string, unknown>;
        const scope = readChoice(args.scope, LIST_SCOPES, 'mine', 'scope', localizedErrorText`查询范围无效。`);
        const type = readChoice(args.type, LIST_TYPES, 'all', 'type', localizedErrorText`题目集类型筛选无效。`);
        const status = readChoice(args.status, LIST_STATUSES, 'all', 'status', localizedErrorText`题目集状态筛选无效。`);
        const q = readQueryText(args.q);
        const page = readPage(args.page);
        const actor = this.user;
        if (!canOpenTeachList(actor)) throw localizeError(new PermissionError(), '你不能查看题目集。');
        if (scope === 'all' && !canSeeAllTeach(actor)) throw localizeError(new PermissionError(), '你不能查看全部题目集。');

        const domainId = String(this.domain?._id ?? '');
        if (!domainId) invalid('domainId', localizedErrorText`域无效。`);
        const uid = actor._id;
        if (typeof uid !== 'number' || !Number.isSafeInteger(uid)) invalid('uid', localizedErrorText`用户无效。`);
        const now = new Date();
        const visibleRules = rulesForContestTypes(contestTypesFor(scope, actor));
        const allowContestPurpose = scope !== 'shared' || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        if (args.view !== undefined && args.view !== '') {
            if (args.view !== 'calendar') invalid('view', localizedErrorText`题目集视图无效。`);
            const { from, to } = calendarRange(args, domainId, uid);
            const filter = contestFilter(scope, uid, status, q, now, visibleRules, allowContestPurpose, type);
            const docs = filter ? await contest.getMulti(domainId, {
                $and: [filter, { beginAt: { $lt: to }, endAt: { $gt: from } }],
            }).sort({ beginAt: 1, docId: 1 }).toArray() : [];
            this.response.body = {
                view: 'calendar',
                from: from.toISOString(),
                to: to.toISOString(),
                rows: docs.map((doc) => {
                    const containerType = teachTypeOfContestRule(doc.rule);
                    const id = doc.docId.toHexString();
                    const href = scope === 'shared' ? `/teach/new?copy=${containerType}:${id}` : teachPath(containerType, id);
                    return {
                        ...serializeContestRow({ tdoc: doc, tsdoc: null, href, draftCount: null, now }),
                        teacherAction: scope === 'shared' ? 'copy' : 'manage',
                    };
                }),
            };
            return;
        }
        const showPractice = practiceVisible(scope, actor);
        const countPractice = practiceFilter(scope, uid, status, q, showPractice);
        const [practiceTotal, homeworkTotal, examTotal, contestTotal] = await Promise.all([
            countPractices(domainId, countPractice),
            countContests(domainId, contestFilter(scope, uid, status, q, now, visibleRules, allowContestPurpose, 'homework')),
            countContests(domainId, contestFilter(scope, uid, status, q, now, visibleRules, allowContestPurpose, 'exam')),
            countContests(domainId, contestFilter(scope, uid, status, q, now, visibleRules, allowContestPurpose, 'contest')),
        ]);
        const typeCounts = {
            all: practiceTotal + homeworkTotal + examTotal + contestTotal,
            practice: practiceTotal,
            homework: homeworkTotal,
            exam: examTotal,
            contest: contestTotal,
        };
        const total = type === 'quiz' ? homeworkTotal + examTotal : typeCounts[type];
        const pageCount = Math.max(1, Math.ceil(total / TEACH_LIST_PAGE_SIZE));
        // The newest K rows overall sit inside the newest K of each collection.
        const limit = Math.min(page * TEACH_LIST_PAGE_SIZE, total);
        const listContest = contestFilter(scope, uid, status, q, now, visibleRules, allowContestPurpose, type);
        const listPractice = practiceFilter(scope, uid, status, q, showPractice && (type === 'all' || type === 'practice'));
        const [contestDocs, practiceDocs] = limit === 0
            ? [[], []] as [Tdoc[], TrainingDoc[]]
            : await Promise.all([
                listContest ? contest.getMulti(domainId, listContest).sort({ _id: -1 }).limit(limit).toArray() : [],
                listPractice ? training.getMulti(domainId, listPractice).sort({ _id: -1 }).limit(limit).toArray() : [],
            ]);
        const pageDocs = newestPage([...contestDocs, ...practiceDocs], page);
        const payload = await this.payload(domainId, actor, scope, type, status, q, page, pageCount, total, typeCounts, now, pageDocs);
        this.response.template = 'teach_main.html';
        this.response.body = payload;
    }

    private async payload(
        domainId: string,
        actor: TeachActor,
        scope: TeachListScope,
        type: TeachListTypeFilter,
        status: TeachListStatusFilter,
        q: string,
        page: number,
        pageCount: number,
        total: number,
        typeCounts: TeachListPayload['typeCounts'],
        now: Date,
        pageDocs: Array<Tdoc | TrainingDoc>,
    ): Promise<TeachListPayload> {
        const canCreate = canCreateMap(actor);
        const base = {
            scope,
            canSeeAll: canSeeAllTeach(actor),
            filter: { type, status, q },
            typeCounts,
            page,
            pageCount,
            total,
            canCreate,
            ...(type === 'practice' ? {
                practiceCards: await loadPracticeCardsForDocuments(
                    domainId,
                    actor,
                    pageDocs.filter((doc): doc is TrainingDoc => doc.docType === document.TYPE_TRAINING),
                    scope === 'shared' ? '学校共享' : '管理',
                    (id) => scope === 'shared' ? `/teach/new?copy=practice:${id}` : teachPath('practice', id),
                ),
            } : {}),
        };
        if (scope === 'shared') {
            const names = await ownerNames(domainId, pageDocs);
            const sharedRows: TeachSharedRow[] = pageDocs.map((doc) => teachSharedRow(doc, {
                ownerName: names.get(doc.owner) || DELETED_OWNER,
            }));
            return { ...base, rows: [], sharedRows };
        }
        const directories = pageDocs.length ? await loadDirectories(domainId) : { groupNames: new Map<string, string>(), schoolNames: new Map<string, string>() };
        const counts = await Promise.all(pageDocs.map((doc) => participantCount(domainId, doc)));
        const rows: TeachListRow[] = pageDocs.map((doc, index) => teachListRow(doc, {
            actor,
            now,
            participantCount: counts[index],
            groupNames: directories.groupNames,
            schoolNames: directories.schoolNames,
        }));
        return { ...base, rows, sharedRows: [] };
    }
}

export async function apply(ctx: { Route: (name: string, path: string, HandlerClass: typeof TeachListHandler, priv: number) => void }) {
    ctx.Route('teach_main', '/teach', TeachListHandler, PRIV.PRIV_USER_PROFILE);
}
