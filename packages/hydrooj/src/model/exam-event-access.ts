import { ObjectId } from 'mongodb';
import { PermissionError, ValidationError } from '../error';
import { PERM, PRIV } from './builtin';
import type { ExamEventDoc } from './exam-event';

export interface ExamEventActor {
    _id: number;
    parentSchoolId?: ObjectId[];
    hasPerm(permission: bigint): boolean;
    hasPriv(privilege: number): boolean;
}

export function isExamInfrastructureAdmin(actor: ExamEventActor): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || actor.hasPerm(PERM.PERM_MANAGE_EXAM_INFRASTRUCTURE);
}

function requireUserbind() {
    const userbind = global.Hydro.model.userbind;
    if (!userbind || typeof userbind.getSchool !== 'function' || typeof userbind.findStudentByUserId !== 'function') {
        throw new TypeError('userbind school bridge is unavailable');
    }
    return userbind;
}

export async function resolveExamEventSchoolScope(domainId: string, actor: ExamEventActor): Promise<ObjectId[]> {
    const userbind = requireUserbind();
    const values: ObjectId[] = [];
    for (const schoolId of actor.parentSchoolId || []) {
        if (schoolId instanceof ObjectId) values.push(schoolId);
    }
    const student = await userbind.findStudentByUserId(domainId, actor._id);
    if (student?.schoolId instanceof ObjectId) values.push(student.schoolId);
    const unique = Array.from(new Map(values.map((schoolId) => [schoolId.toHexString(), schoolId])).values());
    const existing = await Promise.all(unique.map(async (schoolId) => ((await userbind.getSchool(domainId, schoolId)) ? schoolId : null)));
    return existing.filter((schoolId): schoolId is ObjectId => schoolId !== null);
}

export async function assertExamEventSchoolAccess(domainId: string, schoolId: ObjectId, actor: ExamEventActor): Promise<void> {
    const userbind = requireUserbind();
    if (!(await userbind.getSchool(domainId, schoolId))) throw new ValidationError('schoolId');
    if (isExamInfrastructureAdmin(actor)) return;
    if (!actor.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
    const schoolIds = await resolveExamEventSchoolScope(domainId, actor);
    if (!schoolIds.some((candidate) => candidate.equals(schoolId))) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
}

export async function assertCanManageExamEvent(domainId: string, event: ExamEventDoc, actor: ExamEventActor): Promise<void> {
    if (event.domainId !== domainId) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
    if (!isExamInfrastructureAdmin(actor)) {
        if (!actor.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (event.ownerUid !== actor._id && !event.collaboratorUids.includes(actor._id)) {
            throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        }
        await assertExamEventSchoolAccess(domainId, event.schoolId, actor);
    }
    if (event.contestId) await assertExamEventContestAccess(domainId, event.contestId, actor);
}

export async function assertExamEventCollaborators(
    domainId: string,
    schoolId: ObjectId,
    ownerUid: number,
    collaboratorUids: number[],
): Promise<void> {
    for (const uid of [ownerUid, ...collaboratorUids]) {
        const principal = await global.Hydro.model.user.getById(domainId, uid);
        if (!principal) throw new ValidationError(uid === ownerUid ? 'ownerUid' : 'collaboratorUids');
        if (isExamInfrastructureAdmin(principal)) continue;
        if (!principal.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) throw new ValidationError(uid === ownerUid ? 'ownerUid' : 'collaboratorUids');
        const schoolIds = await resolveExamEventSchoolScope(domainId, principal);
        if (!schoolIds.some((candidate) => candidate.equals(schoolId))) {
            throw new ValidationError(uid === ownerUid ? 'ownerUid' : 'collaboratorUids');
        }
    }
}

export async function assertExamEventContestAccess(domainId: string, contestId: ObjectId, actor: ExamEventActor): Promise<void> {
    const contest = await global.Hydro.model.contest.get(domainId, contestId);
    if (isExamInfrastructureAdmin(actor) || actor.hasPerm(PERM.PERM_EDIT_CONTEST)) return;
    if (actor.hasPerm(PERM.PERM_EDIT_CONTEST_SELF) && (contest.owner === actor._id || contest.maintainer?.includes(actor._id))) return;
    throw new PermissionError(PERM.PERM_EDIT_CONTEST_SELF);
}
