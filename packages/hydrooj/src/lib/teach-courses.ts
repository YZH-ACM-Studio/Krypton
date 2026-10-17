import { escapeRegExp } from 'lodash';
import { type Filter, ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError, type LocalizedErrorText } from '../error';
import type { TrainingDoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import { isCourseHidden } from './course-visibility';
import { courseKindClause, isCourseKind } from './training-kind';

export const TEACH_COURSE_LIST_LIMIT = 200;

export type TeachCourseScope = 'mine' | 'all';
export type TeachCourseRole = 'owner' | 'maintainer' | 'admin';

export interface TeachCourseRow {
    id: string;
    title: string;
    term: string;
    hidden: boolean;
    groupNames: string[];
    chapterCount: number;
    videoCount: number;
    problemCount: number;
    boundStudentCount: number | null;
    role: TeachCourseRole;
    createdAt: string;
}

export interface TeachCourseListPayload {
    scope: TeachCourseScope;
    canSeeAll: boolean;
    canCreate: boolean;
    q: string;
    rows: TeachCourseRow[];
}

export interface TeachCourseActor {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

const SCOPES = ['mine', 'all'] as const;

function invalid(field: string, detail: LocalizedErrorText): never {
    throw new ValidationError(field, null, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readTeachCourseScope(value: unknown): TeachCourseScope {
    if (value === undefined || value === null || value === '') return 'mine';
    if (typeof value === 'string' && (SCOPES as readonly string[]).includes(value)) return value as TeachCourseScope;
    invalid('scope', localizedErrorText`查询范围无效。`);
}

export function readTeachCourseQuery(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') invalid('q', localizedErrorText`搜索词无效。`);
    return value;
}

export function canSeeAllCourses(actor: TeachCourseActor): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_EDIT_COURSE);
}

export function canCreateCourse(actor: TeachCourseActor): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_CREATE_COURSE);
}

function titleTermClause(q: string): Filter<TrainingDoc> | null {
    if (!q) return null;
    const pattern = { $regex: escapeRegExp(q), $options: 'i' };
    return { $or: [{ title: pattern }, { term: pattern }] };
}

export function teachCourseListFilter(scope: TeachCourseScope, uid: number, q: string): Filter<TrainingDoc> {
    const clauses: Filter<TrainingDoc>[] = [courseKindClause()];
    if (scope === 'mine') clauses.push({ $or: [{ owner: uid }, { maintainer: uid }] });
    const search = titleTermClause(q);
    if (search) clauses.push(search);
    if (clauses.length === 1) return clauses[0];
    return { $and: clauses };
}

export function teachCourseManagedFilter(uid: number): Filter<TrainingDoc> {
    return {
        ...courseKindClause(),
        $or: [{ owner: uid }, { maintainer: uid }],
    };
}

export function courseGroupIdsOf(raw: unknown): ObjectId[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) invalid('courseGroupIds', localizedErrorText`课程的班级无效。`);
    const ids: ObjectId[] = [];
    for (const item of raw) {
        if (!(item instanceof ObjectId)) invalid('courseGroupIds', localizedErrorText`课程的班级无效。`);
        ids.push(item);
    }
    return ids;
}

function readObjectId(value: unknown, field: string): ObjectId {
    if (!(value instanceof ObjectId)) invalid(field, localizedErrorText`课程编号无效。`);
    return value;
}

function readTitle(value: unknown): string {
    if (typeof value !== 'string') invalid('title', localizedErrorText`课程标题无效。`);
    return value;
}

function readTerm(value: unknown): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') invalid('term', localizedErrorText`课程学期无效。`);
    return value;
}

function readOwner(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        invalid('owner', localizedErrorText`课程的所有者无效。`);
    }
    return value;
}

function readMaintainers(value: unknown): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) invalid('maintainer', localizedErrorText`课程的维护者无效。`);
    const uids: number[] = [];
    for (const uid of value) {
        if (typeof uid !== 'number' || !Number.isSafeInteger(uid)) invalid('maintainer', localizedErrorText`课程的维护者无效。`);
        uids.push(uid);
    }
    return uids;
}

function readPid(value: unknown): number {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
    }
    invalid('pids', localizedErrorText`课程题目数据无效。`);
}

function addPids(raw: unknown, ids: Set<number>): void {
    if (raw === undefined || raw === null) return;
    if (!Array.isArray(raw)) invalid('pids', localizedErrorText`课程题目数据无效。`);
    for (const item of raw) ids.add(readPid(item));
}

function confirmedVideos(raw: unknown): number {
    if (raw === undefined || raw === null) return 0;
    if (!Array.isArray(raw)) invalid('videos', localizedErrorText`课程视频数据无效。`);
    let count = 0;
    for (const item of raw) {
        if (!isRecord(item)) invalid('videos', localizedErrorText`课程视频数据无效。`);
        if (item.confirmed === true) count += 1;
        else if (item.confirmed !== false && item.confirmed !== undefined) invalid('videos', localizedErrorText`课程视频数据无效。`);
    }
    return count;
}

function chapterStats(raw: unknown): { chapterCount: number; videoCount: number; problemCount: number } {
    if (!Array.isArray(raw)) invalid('dag', localizedErrorText`课程章节数据无效。`);
    const pids = new Set<number>();
    let videoCount = 0;
    for (const chapter of raw) {
        if (!isRecord(chapter)) invalid('dag', localizedErrorText`课程章节数据无效。`);
        videoCount += confirmedVideos(chapter.videos);
        addPids(chapter.pids, pids);
        if (chapter.sections === undefined || chapter.sections === null) continue;
        if (!Array.isArray(chapter.sections)) invalid('sections', localizedErrorText`课程章节数据无效。`);
        for (const section of chapter.sections) {
            if (!isRecord(section)) invalid('sections', localizedErrorText`课程章节数据无效。`);
            videoCount += confirmedVideos(section.videos);
            addPids(section.pids, pids);
        }
    }
    return { chapterCount: raw.length, videoCount, problemCount: pids.size };
}

function roleOf(actorId: number, owner: number, maintainers: readonly number[]): TeachCourseRole {
    if (owner === actorId) return 'owner';
    if (maintainers.includes(actorId)) return 'maintainer';
    return 'admin';
}

export function teachCourseRow(
    doc: TrainingDoc,
    actorId: number,
    groupNames: ReadonlyMap<string, string>,
    boundStudentCount: number | null,
): TeachCourseRow {
    if (!isCourseKind(doc.kind)) invalid('kind', localizedErrorText`课程类型无效。`);
    const owner = readOwner(doc.owner);
    const maintainers = readMaintainers(doc.maintainer);
    const stats = chapterStats(doc.dag);
    const groupIds = courseGroupIdsOf(doc.courseGroupIds);
    const names = groupIds.map((id) => {
        const name = groupNames.get(id.toHexString());
        if (!name) invalid('courseGroupIds', localizedErrorText`课程的班级无效。`);
        return name;
    });
    if (names.length === 0) {
        if (boundStudentCount !== null) throw new TypeError('teach_course_student_count');
    } else if (typeof boundStudentCount !== 'number' || !Number.isSafeInteger(boundStudentCount) || boundStudentCount < 0) {
        invalid('boundStudentCount', localizedErrorText`课程的学生人数无效。`);
    }
    return {
        id: readObjectId(doc.docId, 'docId').toHexString(),
        title: readTitle(doc.title),
        term: readTerm(doc.term),
        hidden: isCourseHidden(doc),
        groupNames: names,
        chapterCount: stats.chapterCount,
        videoCount: stats.videoCount,
        problemCount: stats.problemCount,
        boundStudentCount,
        role: roleOf(actorId, owner, maintainers),
        createdAt: readObjectId(doc._id, '_id').getTimestamp().toISOString(),
    };
}
