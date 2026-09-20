import type { Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Tdoc } from '../interface';
import { studentDirectory } from '../service/student-directory';

export interface ContestListParticipantScope {
    groupIds: readonly ObjectId[];
    schoolId: ObjectId | null;
}

export type ContestListParticipantScopeInput = ContestListParticipantScope | 'ignore';

const NO_PARTICIPANT_SCOPE: ContestListParticipantScope = Object.freeze({
    groupIds: Object.freeze([]) as readonly ObjectId[],
    schoolId: null,
});

function assignClause(groups: readonly string[]): Filter<Tdoc> {
    return { $or: [{ assign: { $in: [...groups] } }, { assign: { $size: 0 } }] };
}

function participantScopeClause(scope: ContestListParticipantScope): Filter<Tdoc> {
    const groupIds = [...scope.groupIds];
    const schoolIds = scope.schoolId ? [scope.schoolId] : [];
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
        groupIds: scope.groupIds || [],
        schoolId: scope.schoolId instanceof ObjectId ? scope.schoolId : null,
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
        if (!(scope.schoolId instanceof ObjectId)) return false;
        const schoolId = String(scope.schoolId);
        return (tdoc.participantSchoolIds || []).some((id) => String(id) === schoolId);
    }
    return false;
}

/** Student list/home/problem-bank filter. Missing `hidden` is listed. */
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

export async function loadContestListParticipantScope(domainId: string, uid: number): Promise<ContestListParticipantScope> {
    if (!Number.isSafeInteger(uid) || uid <= 1) return { groupIds: [], schoolId: null };
    const student = await studentDirectory().findStudentByUserId(domainId, uid);
    if (!student) return { groupIds: [], schoolId: null };
    return {
        groupIds: Array.isArray(student.groupIds) ? student.groupIds.filter((id) => id instanceof ObjectId) : [],
        schoolId: student.schoolId instanceof ObjectId ? student.schoolId : null,
    };
}

export async function resolveContestListParticipantScope(
    domainId: string,
    uid: number,
    canBrowseRestricted: boolean,
): Promise<ContestListParticipantScopeInput> {
    if (canBrowseRestricted) return 'ignore';
    return loadContestListParticipantScope(domainId, uid);
}
