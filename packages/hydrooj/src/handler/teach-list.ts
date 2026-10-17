import { escapeRegExp } from 'lodash';
import { type Filter, ObjectId } from 'mongodb';
import { TEACH_TYPES, type TeachType } from '@hydrooj/common';
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
const QUIZ_RULES = ['homework', 'exam'] as const;
const LIST_SCOPES = ['mine', 'shared', 'all'] as const;
const LIST_TYPES = ['all', 'practice', 'quiz', 'acm', 'oi'] as const;
const LIST_STATUSES = ['all', 'upcoming', 'running', 'ended', 'open'] as const;
const MAX_PAGE = 1_000_000;

type ContestTeachType = 'homework' | 'exam' | 'acm' | 'oi';

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
    return {
        practice: canCreateTeachType(actor, 'practice'),
        homework: canCreateTeachType(actor, 'homework'),
        exam: canCreateTeachType(actor, 'exam'),
        acm: canCreateTeachType(actor, 'acm'),
        oi: canCreateTeachType(actor, 'oi'),
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
        else if (type === 'exam') rules.push('exam');
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

function rulesForList(type: TeachListTypeFilter, visible: readonly string[]): string[] {
    if (type === 'practice') return [];
    if (type === 'all') return [...visible];
    if (type === 'quiz') return visible.filter((rule) => (QUIZ_RULES as readonly string[]).includes(rule));
    if (type === 'acm') return visible.filter((rule) => rule === 'acm');
    return visible.filter((rule) => (OI_RULES as readonly string[]).includes(rule));
}

function titleClause(q: string): Record<string, unknown> {
    if (!q) return {};
    return { title: { $regex: escapeRegExp(q), $options: 'i' } };
}

function windowClause(status: TeachListStatusFilter, now: Date): Record<string, unknown> {
    if (status === 'upcoming') return { beginAt: { $gt: now } };
    if (status === 'running') return { beginAt: { $lte: now }, endAt: { $gt: now } };
    if (status === 'ended') return { beginAt: { $lte: now }, endAt: { $lte: now } };
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
): Filter<Tdoc> | null {
    if (!rules.length || status === 'open') return null;
    return {
        ...scopeClause(scope, uid),
        ...windowClause(status, now),
        ...titleClause(q),
        rule: { $in: [...rules] },
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
        const showPractice = practiceVisible(scope, actor);
        const countPractice = practiceFilter(scope, uid, status, q, showPractice);
        const countQuiz = contestFilter(scope, uid, status, q, now, visibleRules.filter((rule) => (QUIZ_RULES as readonly string[]).includes(rule)));
        const countAcm = contestFilter(scope, uid, status, q, now, visibleRules.filter((rule) => rule === 'acm'));
        const countOi = contestFilter(scope, uid, status, q, now, visibleRules.filter((rule) => (OI_RULES as readonly string[]).includes(rule)));
        const [practiceTotal, quizTotal, acmTotal, oiTotal] = await Promise.all([
            countPractices(domainId, countPractice),
            countContests(domainId, countQuiz),
            countContests(domainId, countAcm),
            countContests(domainId, countOi),
        ]);
        const typeCounts = {
            all: practiceTotal + quizTotal + acmTotal + oiTotal,
            practice: practiceTotal,
            quiz: quizTotal,
            acm: acmTotal,
            oi: oiTotal,
        };
        const total = type === 'all' ? typeCounts.all : typeCounts[type];
        const pageCount = Math.max(1, Math.ceil(total / TEACH_LIST_PAGE_SIZE));
        // The newest K rows overall sit inside the newest K of each collection.
        const limit = Math.min(page * TEACH_LIST_PAGE_SIZE, total);
        const listContest = contestFilter(scope, uid, status, q, now, rulesForList(type, visibleRules));
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
