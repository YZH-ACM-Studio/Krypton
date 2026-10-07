import type { Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Tdoc } from '../interface';
import { studentDirectory } from '../service/student-directory';
import { resolveStaffSchoolScope } from './staff-school-scope';

export interface ContestListParticipantScope {
    groupIds: readonly ObjectId[];
    schoolIds: readonly ObjectId[];
}

export type ContestListParticipantScopeInput = ContestListParticipantScope | 'ignore';

export interface ContestParticipantScopeDoc {
    participantScopeMode?: string | null;
    participantGroupIds?: readonly ObjectId[] | null;
    participantSchoolIds?: readonly ObjectId[] | null;
}

const NO_PARTICIPANT_SCOPE: ContestListParticipantScope = Object.freeze({
    groupIds: Object.freeze([]) as readonly ObjectId[],
    schoolIds: Object.freeze([]) as readonly ObjectId[],
});

function assignClause(groups: readonly string[]): Filter<Tdoc> {
    return { $or: [{ assign: { $in: [...groups] } }, { assign: { $size: 0 } }] };
}

function objectIdsFrom(raw: readonly unknown[] | null | undefined): ObjectId[] {
    if (!raw) return [];
    return raw.filter((id): id is ObjectId => id instanceof ObjectId);
}

function participantScopeClause(scope: ContestListParticipantScope): Filter<Tdoc> {
    const groupIds = [...scope.groupIds];
    const schoolIds = [...scope.schoolIds];
    return {
        $or: [
            { participantScopeMode: { $exists: false } },
            { participantScopeMode: 'none' },
            { participantScopeMode: 'groups', participantGroupIds: { $in: groupIds } },
            { participantScopeMode: 'schools', participantSchoolIds: { $in: schoolIds } },
        ],
    };
}

function resolveScopeInput(scope?: ContestListParticipantScopeInput | null): ContestListParticipantScope | 'ignore' {
    if (scope === 'ignore') return 'ignore';
    if (!scope) return NO_PARTICIPANT_SCOPE;
    return {
        groupIds: objectIdsFrom(scope.groupIds),
        schoolIds: objectIdsFrom(scope.schoolIds),
    };
}

function hitsParticipantScopeList(
    tdoc: Pick<Tdoc, 'participantScopeMode' | 'participantGroupIds' | 'participantSchoolIds'>,
    scope: ContestListParticipantScope,
): boolean {
    if (!tdoc.participantScopeMode || tdoc.participantScopeMode === 'none') return true;
    if (tdoc.participantScopeMode === 'groups') {
        const want = new Set((tdoc.participantGroupIds || []).map((id) => String(id)));
        return scope.groupIds.some((id) => want.has(String(id)));
    }
    if (tdoc.participantScopeMode === 'schools') {
        const schoolIds = new Set(scope.schoolIds.map((id) => id.toHexString()));
        return (tdoc.participantSchoolIds || []).some((id) => id instanceof ObjectId && schoolIds.has(id.toHexString()));
    }
    return false;
}

/** Session users copy settings only. `parentSchoolId` stays on the raw user document. */
export function parentSchoolIdsFromUser(user: unknown): ObjectId[] {
    if (!user || typeof user !== 'object') return [];
    const udoc = (user as { _udoc?: unknown })._udoc;
    if (!udoc || typeof udoc !== 'object') return [];
    const raw = (udoc as { parentSchoolId?: unknown }).parentSchoolId;
    return objectIdsFrom(Array.isArray(raw) ? raw : []);
}

function schoolIdSet(ids: readonly ObjectId[] | null | undefined): Set<string> {
    const found = new Set<string>();
    for (const id of ids || []) {
        if (id instanceof ObjectId) found.add(id.toHexString());
    }
    return found;
}

/**
 * View gate for school-scoped contests. Groups and unknown modes stay closed.
 * A missing student directory throws; it does not become "no schools".
 */
export async function contestVisibleByStaffSchoolScope(
    domainId: string,
    actor: { _id: number; parentSchoolId?: readonly unknown[] | null },
    tdoc: ContestParticipantScopeDoc,
): Promise<boolean> {
    if (tdoc.participantScopeMode !== 'schools') return false;
    if (!Number.isSafeInteger(actor._id) || actor._id <= 1) return false;
    const schoolIds = await resolveStaffSchoolScope(domainId, {
        _id: actor._id,
        parentSchoolId: objectIdsFrom(actor.parentSchoolId),
    });
    const want = schoolIdSet(tdoc.participantSchoolIds);
    return schoolIds.some((id) => want.has(id.toHexString()));
}

/**
 * Attend gate. Unscoped contests stay open. School and group contests require
 * the bound student record itself; parent schools and staff lists do not attend.
 */
export async function studentRecordHitsContestScope(
    domainId: string,
    uid: number,
    tdoc: ContestParticipantScopeDoc,
): Promise<boolean> {
    if (tdoc.participantScopeMode !== 'schools' && tdoc.participantScopeMode !== 'groups') return true;
    if (!Number.isSafeInteger(uid) || uid <= 1) return false;
    const student = await studentDirectory().findStudentByUserId(domainId, uid);
    if (!student) return false;
    if (tdoc.participantScopeMode === 'schools') {
        if (!(student.schoolId instanceof ObjectId)) return false;
        return schoolIdSet(tdoc.participantSchoolIds).has(student.schoolId.toHexString());
    }
    const want = schoolIdSet(tdoc.participantGroupIds);
    return (student.groupIds || []).some((id) => id instanceof ObjectId && want.has(id.toHexString()));
}

/** Contest list, home strip, and problem-bank filter. Missing `hidden` is listed. */
export function listAccessQuery(
    uid: number,
    groups: string[],
    canBrowseRestricted: boolean,
    scope?: ContestListParticipantScopeInput | null,
): Filter<Tdoc> {
    if (canBrowseRestricted) return {};
    const resolved = resolveScopeInput(scope);
    const publicFilter: Filter<Tdoc> =
        resolved === 'ignore'
            ? { hidden: { $ne: true }, ...assignClause(groups) }
            : {
                  hidden: { $ne: true },
                  $and: [assignClause(groups), participantScopeClause(resolved)],
              };
    return {
        $or: [{ owner: uid }, { maintainer: uid }, publicFilter],
    };
}

export function isListVisibleToUser(
    tdoc: Pick<Tdoc, 'owner' | 'maintainer' | 'assign' | 'hidden' | 'participantScopeMode' | 'participantGroupIds' | 'participantSchoolIds'>,
    uid: number,
    groups: readonly string[],
    canBrowseRestricted: boolean,
    scope?: ContestListParticipantScopeInput | null,
): boolean {
    if (canBrowseRestricted) return true;
    if (tdoc.owner === uid) return true;
    if ((tdoc.maintainer || []).includes(uid)) return true;
    if (tdoc.hidden === true) return false;
    if (tdoc.assign?.length && !tdoc.assign.some((name) => groups.includes(name))) return false;
    const resolved = resolveScopeInput(scope);
    if (resolved === 'ignore') return true;
    return hitsParticipantScopeList(tdoc, resolved);
}

export async function loadContestListParticipantScope(
    domainId: string,
    uid: number,
    parentSchoolIds?: readonly unknown[] | null,
): Promise<ContestListParticipantScope> {
    if (!Number.isSafeInteger(uid) || uid <= 1) return { groupIds: [], schoolIds: [] };
    const student = await studentDirectory().findStudentByUserId(domainId, uid);
    const schoolIds = await resolveStaffSchoolScope(domainId, {
        _id: uid,
        parentSchoolId: objectIdsFrom(parentSchoolIds),
    });
    return {
        groupIds: Array.isArray(student?.groupIds) ? student.groupIds.filter((id) => id instanceof ObjectId) : [],
        schoolIds,
    };
}

export async function resolveContestListParticipantScope(
    domainId: string,
    uid: number,
    canBrowseRestricted: boolean,
    parentSchoolIds?: readonly unknown[] | null,
): Promise<ContestListParticipantScopeInput> {
    if (canBrowseRestricted) return 'ignore';
    return loadContestListParticipantScope(domainId, uid, parentSchoolIds);
}
