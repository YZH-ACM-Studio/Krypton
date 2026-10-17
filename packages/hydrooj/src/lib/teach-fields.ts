import { parseTeachType, type TeachType } from '@hydrooj/common';
import { ObjectId } from 'mongodb';

export interface TeachSchoolShared {
    sharedBy: number;
    sharedAt: Date;
}

export interface TeachCopiedFrom {
    type: TeachType;
    id: ObjectId;
    title: string;
    ownerUid: number;
    copiedBy: number;
    copiedAt: Date;
}

export interface ProblemSchoolBank {
    sharedBy: number;
    sharedAt: Date;
}

declare module '../interface' {
    interface Tdoc {
        /** Missing means the container is not shared inside the school. */
        schoolShared?: TeachSchoolShared;
        copiedFrom?: TeachCopiedFrom;
    }
    interface TrainingDoc {
        /** Missing means the container is not shared inside the school. */
        schoolShared?: TeachSchoolShared;
        copiedFrom?: TeachCopiedFrom;
    }
}

// ProblemDoc lives on the problem model, not as a mergeable interface in ../interface.
declare module '../model/problem' {
    interface ProblemDoc {
        /** Missing means the problem is not in the school bank. */
        schoolBank?: ProblemSchoolBank;
    }
}

const SCHOOL_SHARE_KEYS = ['sharedBy', 'sharedAt'] as const;
const COPIED_FROM_KEYS = ['copiedAt', 'copiedBy', 'id', 'ownerUid', 'title', 'type'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const names = Object.getOwnPropertyNames(value);
    return names.length === keys.length
        && Object.getOwnPropertySymbols(value).length === 0
        && keys.every((key) => Object.hasOwn(value, key));
}

function positiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validDate(value: unknown): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

function invalid(message: string): never {
    throw new TypeError(message);
}

function readShare(raw: unknown, message: string): TeachSchoolShared | null {
    if (raw === undefined) return null;
    if (!isPlainObject(raw) || !hasExactKeys(raw, SCHOOL_SHARE_KEYS)) invalid(message);
    const { sharedBy, sharedAt } = raw;
    if (!positiveSafeInteger(sharedBy) || !validDate(sharedAt)) invalid(message);
    return { sharedBy, sharedAt };
}

/** Missing field → null. Any other shape → TypeError('teach_school_shared_invalid'). */
export function readSchoolShared(raw: unknown): TeachSchoolShared | null {
    return readShare(raw, 'teach_school_shared_invalid');
}

/** Missing field → null. Any other shape → TypeError('problem_school_bank_invalid'). */
export function readProblemSchoolBank(raw: unknown): ProblemSchoolBank | null {
    return readShare(raw, 'problem_school_bank_invalid');
}

/** Missing field → null. Any other shape → TypeError('teach_copied_from_invalid'). */
export function readCopiedFrom(raw: unknown): TeachCopiedFrom | null {
    if (raw === undefined) return null;
    if (!isPlainObject(raw) || !hasExactKeys(raw, COPIED_FROM_KEYS)) invalid('teach_copied_from_invalid');
    const { type, id, title, ownerUid, copiedBy, copiedAt } = raw;
    if (!(id instanceof ObjectId) || typeof title !== 'string') invalid('teach_copied_from_invalid');
    if (!positiveSafeInteger(ownerUid) || !positiveSafeInteger(copiedBy) || !validDate(copiedAt)) invalid('teach_copied_from_invalid');
    let parsed: TeachType;
    try {
        parsed = parseTeachType(type);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') invalid('teach_copied_from_invalid');
        throw error;
    }
    return {
        type: parsed,
        id,
        title,
        ownerUid,
        copiedBy,
        copiedAt,
    };
}
