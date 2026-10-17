import { ObjectId } from 'mongodb';
import { localizeError, localizedErrorText, PermissionError, ValidationError, type LocalizedErrorText } from '../error';
import type { TrainingDoc } from '../interface';
import {
    canCreateCourse,
    canSeeAllCourses,
    courseGroupIdsOf,
    readTeachCourseQuery,
    readTeachCourseScope,
    TEACH_COURSE_LIST_LIMIT,
    teachCourseListFilter,
    teachCourseManagedFilter,
    teachCourseRow,
    type TeachCourseActor,
    type TeachCourseListPayload,
    type TeachCourseRow,
} from '../lib/teach-courses';
import { PRIV } from '../model/builtin';
import * as training from '../model/training';
import { Handler } from '../service/server';
import { studentDirectory } from '../service/student-directory';

function invalid(field: string, detail: LocalizedErrorText): never {
    throw new ValidationError(field, null, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argsOf(raw: unknown): Record<string, unknown> {
    if (!isRecord(raw)) invalid('query', localizedErrorText`查询参数无效。`);
    return raw;
}

function domainIdOf(handler: Handler): string {
    const domainId = handler.domain?._id;
    if (typeof domainId !== 'string' || !domainId) invalid('domainId', localizedErrorText`域无效。`);
    return domainId;
}

function actorOf(handler: Handler): TeachCourseActor {
    const actor = handler.user as TeachCourseActor | undefined;
    if (!actor || typeof actor._id !== 'number' || !Number.isSafeInteger(actor._id) || actor._id <= 0) {
        invalid('user', localizedErrorText`用户无效。`);
    }
    if (typeof actor.hasPerm !== 'function' || typeof actor.hasPriv !== 'function') invalid('user', localizedErrorText`用户无效。`);
    return actor;
}

function readCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        invalid('count', localizedErrorText`课程数量无效。`);
    }
    return value;
}

function indexGroupNames(rows: unknown, domainId: string): Map<string, string> {
    if (!Array.isArray(rows)) invalid('groups', localizedErrorText`课程的班级无效。`);
    const names = new Map<string, string>();
    for (const row of rows) {
        if (!isRecord(row)) invalid('groups', localizedErrorText`课程的班级无效。`);
        if (row.domainId !== domainId) continue;
        if (!(row._id instanceof ObjectId)) invalid('groups', localizedErrorText`课程的班级无效。`);
        if (typeof row.name !== 'string' || !row.name) invalid('groups', localizedErrorText`课程的班级无效。`);
        const key = row._id.toHexString();
        if (names.has(key)) invalid('groups', localizedErrorText`课程的班级无效。`);
        names.set(key, row.name);
    }
    return names;
}

async function boundStudentCount(domainId: string, groupIds: readonly ObjectId[]): Promise<number> {
    const students = await studentDirectory().findBoundStudentsByGroupIds(domainId, [...groupIds]);
    if (!Array.isArray(students)) invalid('boundStudentCount', localizedErrorText`课程的学生人数无效。`);
    return students.length;
}

async function rowsOf(domainId: string, actorId: number, docs: readonly TrainingDoc[]): Promise<TeachCourseRow[]> {
    const groupIds = docs.map((doc) => courseGroupIdsOf(doc.courseGroupIds));
    const needsDirectory = groupIds.some((ids) => ids.length > 0);
    const [directory, counts] = await Promise.all([
        needsDirectory ? studentDirectory().listUserGroups(domainId).then((groups) => indexGroupNames(groups, domainId)) : Promise.resolve(new Map<string, string>()),
        Promise.all(groupIds.map((ids) => (ids.length ? boundStudentCount(domainId, ids) : Promise.resolve(null)))),
    ]);
    return docs.map((doc, index) => teachCourseRow(doc, actorId, directory, counts[index]));
}

class TeachCoursesHandler extends Handler {
    async get(raw: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const args = argsOf(raw);
        const scope = readTeachCourseScope(args.scope);
        const q = readTeachCourseQuery(args.q);
        const actor = actorOf(this);
        const domainId = domainIdOf(this);
        const canSeeAll = canSeeAllCourses(actor);
        const canCreate = canCreateCourse(actor);
        if (scope === 'all' && !canSeeAll) throw localizeError(new PermissionError(), '你不能查看全部课程。');
        if (!canCreate && !canSeeAll) {
            const managed = readCount(await training.count(domainId, teachCourseManagedFilter(actor._id)));
            if (managed === 0) throw localizeError(new PermissionError(), '你不能查看课程。');
        }
        const docs = await training.getMulti(domainId, teachCourseListFilter(scope, actor._id, q)).sort({ _id: -1 }).limit(TEACH_COURSE_LIST_LIMIT).toArray();
        const payload: TeachCourseListPayload = {
            scope,
            canSeeAll,
            canCreate,
            q,
            rows: await rowsOf(domainId, actor._id, docs),
        };
        this.response.template = 'teach_courses.html';
        this.response.body = payload;
    }
}

export async function apply(ctx: { Route: (name: string, path: string, HandlerClass: typeof TeachCoursesHandler, priv: number) => void }) {
    ctx.Route('teach_courses', '/teach/courses', TeachCoursesHandler, PRIV.PRIV_USER_PROFILE);
}
