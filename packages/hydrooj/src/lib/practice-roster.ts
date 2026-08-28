import { ObjectId } from 'mongodb';

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
}

export interface PracticeRosterProblemPayload {
    pid: number;
    title: string;
    pidLabel: string;
}

export interface PracticeRosterStudentRecord {
    realName?: string;
    studentId?: string;
    groupIds?: Array<ObjectId | string>;
    boundUserId?: number | null;
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
}): PracticeRosterMemberPayload[] {
    return input.memberUids.map((uid) => {
        const student = input.students[String(uid)];
        const groupIds = (student?.groupIds || []).map((groupId) => String(groupId));
        const completedPids = [...(input.completedPidsByUid.get(uid) || [])]
            .filter((pid) => Number.isSafeInteger(pid) && pid > 0)
            .sort((a, b) => a - b);
        return {
            uid,
            uname: input.udict[uid]?.uname || `UID ${uid}`,
            realName: student?.realName || '',
            studentId: student?.studentId || '',
            groupIds,
            groups: groupIds.map((groupId) => input.groupNameById.get(groupId)).filter((name): name is string => Boolean(name)),
            done: completedPids.length,
            total: input.total,
            completedPids,
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
