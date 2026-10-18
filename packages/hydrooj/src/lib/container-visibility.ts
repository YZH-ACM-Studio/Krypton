import { type Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { ContestNotFoundError } from '../error';
import type { Tdoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import { teachCourseManagedFilter } from './teach-courses';

type TrainingCourseQuery = {
    getMulti: (domainId: string, filter: unknown) => {
        project: <T>(projection: unknown) => { toArray: () => Promise<T[]> };
    };
};

let trainingModule: TrainingCourseQuery | undefined;

function trainingCourses(): TrainingCourseQuery {
    trainingModule ??= require('../model/training') as TrainingCourseQuery;
    return trainingModule;
}

// Resolve while a handler harness can still stub this import. Without an app
// bus the real model throws ReferenceError; keep the file loadable and retry later.
try {
    trainingModule = require('../model/training') as TrainingCourseQuery;
} catch (error) {
    trainingModule = undefined;
    if (!(error instanceof ReferenceError)) throw error;
}

const logger = new Logger('container-visibility');

export interface ContainerVisibilityActor {
    _id: number;
    own(doc: { owner: number; maintainer?: number[] }): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

/**
 * 'all'：PRIV_EDIT_SYSTEM；或 rule==='homework' 时 PERM_EDIT_HOMEWORK | PERM_VIEW_HIDDEN_HOMEWORK，
 *        其它 rule 时 PERM_EDIT_CONTEST | PERM_VIEW_HIDDEN_CONTEST。
 * 'teacher'：不是 'all'，且有 PERM_CREATE_CONTEST | PERM_CREATE_HOMEWORK | PERM_CREATE_TRAINING 之一。
 * 'student'：其余。
 */
export type ContainerViewerClass = 'all' | 'teacher' | 'student';

export function contestViewerClass(actor: ContainerVisibilityActor, rule: string): ContainerViewerClass {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return 'all';
    const seesAll =
        rule === 'homework'
            ? actor.hasPerm(PERM.PERM_EDIT_HOMEWORK) || actor.hasPerm(PERM.PERM_VIEW_HIDDEN_HOMEWORK)
            : actor.hasPerm(PERM.PERM_EDIT_CONTEST) || actor.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST);
    if (seesAll) return 'all';
    if (actor.hasPerm(PERM.PERM_CREATE_CONTEST) || actor.hasPerm(PERM.PERM_CREATE_HOMEWORK) || actor.hasPerm(PERM.PERM_CREATE_TRAINING)) {
        return 'teacher';
    }
    return 'student';
}

export interface TeacherContainerScope {
    uid: number;
    /** 自己是 owner 或 maintainer 的课程里，dag[].tids 与 courseExam.contestId 的 docId hex，去重。 */
    courseContestIds: ReadonlySet<string>;
}

interface CourseContestSource {
    dag?: { tids?: unknown[] }[];
    courseExam?: { contestId?: unknown };
}

export async function loadTeacherContainerScope(domainId: string, uid: number): Promise<TeacherContainerScope> {
    const rows = await trainingCourses()
        .getMulti(domainId, teachCourseManagedFilter(uid))
        .project<CourseContestSource>({ dag: 1, courseExam: 1 })
        .toArray();
    const courseContestIds = new Set<string>();
    for (const row of rows) {
        for (const chapter of row.dag ?? []) {
            const tids = Array.isArray(chapter?.tids) ? chapter.tids : [];
            for (const tid of tids) {
                if (tid instanceof ObjectId) courseContestIds.add(tid.toHexString());
            }
        }
        const contestId = row.courseExam?.contestId;
        if (contestId instanceof ObjectId) courseContestIds.add(contestId.toHexString());
    }
    return { uid, courseContestIds };
}

/** 纯函数：owner===uid 或 maintainer 含 uid；rule 为 exam/homework 且 docId 在 courseContestIds 里也可见。 */
export function teacherSeesContest(scope: TeacherContainerScope, tdoc: Pick<Tdoc, 'docId' | 'owner' | 'maintainer' | 'rule'>): boolean {
    if (tdoc.owner === scope.uid || (tdoc.maintainer ?? []).includes(scope.uid)) return true;
    if (tdoc.rule !== 'exam' && tdoc.rule !== 'homework') return false;
    return scope.courseContestIds.has(tdoc.docId.toHexString());
}

function objectIdsFromHex(ids: ReadonlySet<string>): ObjectId[] {
    const out: ObjectId[] = [];
    for (const hex of ids) {
        if (typeof hex !== 'string' || !/^[0-9a-f]{24}$/.test(hex)) continue;
        out.push(new ObjectId(hex));
    }
    return out;
}

export function teacherContestFilter(scope: TeacherContainerScope): Filter<Tdoc> {
    const or: Filter<Tdoc>[] = [{ owner: scope.uid }, { maintainer: scope.uid }];
    const ids = objectIdsFromHex(scope.courseContestIds);
    if (ids.length > 0) {
        or.push({
            rule: { $in: ['exam', 'homework'] },
            docId: { $in: ids },
        });
    }
    return { $or: or };
}

export async function decideContainerVisibility(domainId: string, tdoc: Tdoc, actor: ContainerVisibilityActor): Promise<'bypass' | 'student'> {
    const viewer = contestViewerClass(actor, tdoc.rule);
    if (viewer === 'student') return 'student';
    if (viewer === 'all' || actor.own(tdoc)) return 'bypass';
    const scope = await loadTeacherContainerScope(domainId, actor._id);
    if (teacherSeesContest(scope, tdoc)) return 'bypass';
    logger.info('container visibility domain=%s uid=%d id=%s stage=decide result=deny', domainId, actor._id, tdoc.docId.toHexString());
    throw new ContestNotFoundError(domainId, tdoc.docId);
}
