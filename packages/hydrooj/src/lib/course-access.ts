import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import type { TrainingDoc } from '../interface';
import { PRIV } from '../model/builtin';
import { problemSetAccessService } from '../model/problem-set-access';

const logger = new Logger('course-access');

export async function courseUserGroupIds(domainId: string, uid: number): Promise<Set<string>> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (typeof userbind?.findStudentByUserId !== 'function') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    try {
        const student = await userbind.findStudentByUserId(domainId, uid);
        return new Set((student?.groupIds || []).map((g: ObjectId) => String(g)));
    } catch (error) {
        logger.error('Course user-group lookup failed domain=%s uid=%d error=%o', domainId, uid, error);
        throw error;
    }
}

export function isCourseHidden(tdoc: Pick<TrainingDoc, 'courseHidden'>): boolean {
    return tdoc.courseHidden === true;
}

export function courseVisibleTo(tdoc: TrainingDoc, myGroups: Set<string>, canManage: boolean): boolean {
    if (canManage) return true;
    if (isCourseHidden(tdoc)) return false;
    const groups = tdoc.courseGroupIds || [];
    if (!groups.length) return true;
    return groups.some((g) => myGroups.has(String(g)));
}

export async function courseAccessibleTo(domainId: string, uid: number, tdoc: TrainingDoc, myGroups: Set<string>, canManage: boolean): Promise<boolean> {
    if (canManage) return true;
    if (isCourseHidden(tdoc)) return false;
    if (courseVisibleTo(tdoc, myGroups, false)) return true;
    return problemSetAccessService.hasActiveEntitlement(domainId, uid, 'course', tdoc.docId);
}

export function canManageCourse(
    user: { own(doc: TrainingDoc): boolean; hasPerm(...perm: bigint[]): boolean; hasPriv(...priv: number[]): boolean },
    tdoc: TrainingDoc,
    PERM_EDIT_COURSE: bigint,
): boolean {
    return user.own(tdoc) || user.hasPerm(PERM_EDIT_COURSE) || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}
