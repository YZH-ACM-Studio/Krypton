import type { School, StudentRecord } from './types';

export interface BoundStudentPublicView {
    bound: boolean;
    realName?: string;
    studentId?: string;
    enrollmentYear?: number | null;
    schoolName?: string | null;
}

export function buildBoundStudentView(
    student: StudentRecord | null,
    school: School | null,
    includeIdentity: boolean,
): BoundStudentPublicView {
    if (!student) return { bound: false };
    if (!includeIdentity) return { bound: true };
    return {
        bound: true,
        realName: student.realName,
        studentId: student.studentId,
        enrollmentYear: student.enrollmentYear ?? null,
        schoolName: school?.name ?? null,
    };
}

export function stripLegacyProfileIdentity<T extends Record<string, unknown>>(doc: T): T {
    const next = { ...doc };
    delete next.studentId;
    delete next.realName;
    delete next.school;
    return next;
}
