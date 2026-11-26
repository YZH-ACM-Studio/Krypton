import type { Collection } from 'mongodb';
import type { StudentRecord } from './types';

export const studentNumberPatterns = {
    undergraduate: /^\d{9}$/,
    postgraduate: /^(?:19|20)\d{8}$/,
};
export type StudentLevel = keyof typeof studentNumberPatterns;

export function deriveEnrollmentYear(studentId: string): number | null {
    if (studentNumberPatterns.undergraduate.test(studentId)) return 2000 + Number(studentId.slice(0, 2));
    if (studentNumberPatterns.postgraduate.test(studentId)) return Number(studentId.slice(0, 4));
    return null;
}

/** Only replace the year produced by the former two-digit rule. */
export async function correctPostgraduateYears(students: Collection<StudentRecord>): Promise<number> {
    const previousYear = { $add: [2000, { $toInt: { $substrBytes: ['$studentId', 0, 2] } }] };
    const actualYear = { $toInt: { $substrBytes: ['$studentId', 0, 4] } };
    const result = await students.updateMany(
        {
            studentId: studentNumberPatterns.postgraduate,
            enrollmentYear: { $in: [2019, 2020] },
        },
        [{ $set: { enrollmentYear: { $cond: [{ $eq: ['$enrollmentYear', previousYear] }, actualYear, '$enrollmentYear'] } } }],
    );
    return result.modifiedCount;
}
