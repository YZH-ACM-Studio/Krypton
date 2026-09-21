import { ObjectId } from 'mongodb';
import type { CourseExamRosterFact } from './course-exam-roster';

export const PRACTICE_ROSTER_ENROLL_LIMIT = 1000;

export interface PracticeRosterMemberPayload {
    uid: number;
    uname: string;
    realName: string;
    studentId: string;
    groups: string[];
    groupIds: string[];
    done: number;
    total: number;
    completedPids: number[];
    exam?: CourseExamRosterFact;
}

export interface PracticeRosterProblemPayload {
    pid: number;
    title: string;
    pidLabel: string;
}

export interface PracticeRosterStudentRecord {
    realName?: string;
    studentId?: string;
    schoolId?: ObjectId | string;
    groupIds?: Array<ObjectId | string>;
    boundUserId?: number | null;
}

export interface PracticeRosterGroupCatalogEntry {
    id: string;
    name: string;
    schoolId?: string;
    archivedAt?: Date | string | null;
}

function namedPracticeRosterGroup(groupNameById: ReadonlyMap<string, string>, groupId: string): string | null {
    const name = groupNameById.get(groupId);
    if (typeof name !== 'string' || name.length === 0) return null;
    return name;
}

export function projectPracticeRosterGroups(input: {
    groupIds: readonly string[];
    groupNameById: ReadonlyMap<string, string>;
    audienceGroupIds?: readonly string[];
    studentSchoolId?: string | null;
    groupCatalogById?: ReadonlyMap<string, PracticeRosterGroupCatalogEntry>;
}): { groupIds: string[]; groups: string[] } {
    const audienceFilter = input.audienceGroupIds && input.audienceGroupIds.length > 0
        ? new Set(input.audienceGroupIds.map((groupId) => String(groupId)))
        : null;
    const studentSchoolId = typeof input.studentSchoolId === 'string' && input.studentSchoolId.length > 0
        ? input.studentSchoolId
        : null;
    const groupIds: string[] = [];
    const groups: string[] = [];
    for (const groupId of input.groupIds) {
        const name = namedPracticeRosterGroup(input.groupNameById, groupId);
        if (name === null) continue;
        if (audienceFilter) {
            if (!audienceFilter.has(groupId)) continue;
        } else if (input.groupCatalogById) {
            const catalog = input.groupCatalogById.get(groupId);
            if (catalog?.archivedAt) continue;
            if (studentSchoolId && String(catalog?.schoolId) !== String(studentSchoolId)) continue;
        }
        groupIds.push(groupId);
        groups.push(name);
    }
    return { groupIds, groups };
}

export function serializePracticeRosterProblems(
    pids: readonly number[],
    pdict: Record<string, { title?: string; pid?: string | number; docId?: number } | undefined>,
): PracticeRosterProblemPayload[] {
    return pids.map((pid) => {
        const problem = pdict[String(pid)] || pdict[pid];
        const pidLabel = problem?.pid != null ? String(problem.pid) : `P${pid}`;
        return {
            pid,
            title: problem?.title || pidLabel,
            pidLabel,
        };
    });
}

export function assemblePracticeRosterMembers(input: {
    memberUids: readonly number[];
    udict: Record<number, { uname?: string } | undefined>;
    students: Record<string, PracticeRosterStudentRecord | undefined>;
    groupNameById: ReadonlyMap<string, string>;
    completedPidsByUid: ReadonlyMap<number, ReadonlySet<number>>;
    total: number;
    examFactsByUid?: ReadonlyMap<number, CourseExamRosterFact>;
    audienceGroupIds?: readonly string[];
    groupCatalogById?: ReadonlyMap<string, PracticeRosterGroupCatalogEntry>;
}): PracticeRosterMemberPayload[] {
    return input.memberUids.map((uid) => {
        const student = input.students[String(uid)];
        const { groupIds, groups } = projectPracticeRosterGroups({
            groupIds: (student?.groupIds || []).map((groupId) => String(groupId)),
            groupNameById: input.groupNameById,
            audienceGroupIds: input.audienceGroupIds,
            studentSchoolId: student?.schoolId == null ? null : String(student.schoolId),
            groupCatalogById: input.groupCatalogById,
        });
        const completedPids = [...(input.completedPidsByUid.get(uid) || [])]
            .filter((pid) => Number.isSafeInteger(pid) && pid > 0)
            .sort((a, b) => a - b);
        const exam = input.examFactsByUid?.get(uid);
        if (input.examFactsByUid && !exam) {
            throw new TypeError(`missing course exam roster fact for uid=${uid}`);
        }
        return {
            uid,
            uname: input.udict[uid]?.uname || `UID ${uid}`,
            realName: student?.realName || '',
            studentId: student?.studentId || '',
            groupIds,
            groups,
            done: completedPids.length,
            total: input.total,
            completedPids,
            ...(exam ? { exam } : {}),
        };
    });
}

export function uniqueBoundUserIds(students: readonly PracticeRosterStudentRecord[]): number[] {
    const uids = new Set<number>();
    for (const student of students) {
        if (!Number.isSafeInteger(student.boundUserId) || Number(student.boundUserId) <= 1) continue;
        uids.add(Number(student.boundUserId));
    }
    return [...uids];
}
