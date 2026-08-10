import { ObjectId } from 'mongodb';
import { ExamEventError, ExamEventType } from './exam-event';

export const EXAM_EVENT_PATCH_FIELDS = ['schoolId', 'title', 'type', 'contestId', 'startAt', 'endAt', 'collaboratorUids'] as const;

export interface ExamEventUpdatePatch {
    requestedFields: string[];
    schoolId?: ObjectId;
    title?: string;
    type?: ExamEventType;
    contestId?: ObjectId | null;
    startAt?: Date;
    endAt?: Date;
    collaboratorUids?: number[];
}

function parseDate(value: unknown, reason: string): Date {
    if (typeof value !== 'string' || !value) throw new ExamEventError(reason);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new ExamEventError(reason);
    return date;
}

export function parseExamEventUpdatePatch(value: unknown): ExamEventUpdatePatch {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamEventError('invalid_update');
    const body = value as Record<string, unknown>;
    const requestedFields = EXAM_EVENT_PATCH_FIELDS.filter((field) => Object.hasOwn(body, field));
    if (!requestedFields.length) throw new ExamEventError('empty_update');
    const patch: ExamEventUpdatePatch = { requestedFields };
    if (Object.hasOwn(body, 'schoolId')) {
        if (typeof body.schoolId !== 'string' || !ObjectId.isValid(body.schoolId)) throw new ExamEventError('invalid_school');
        patch.schoolId = new ObjectId(body.schoolId);
    }
    if (Object.hasOwn(body, 'title')) {
        if (typeof body.title !== 'string' || !body.title.trim()) throw new ExamEventError('invalid_title');
        patch.title = body.title;
    }
    if (Object.hasOwn(body, 'type')) {
        if (body.type !== 'krypton' && body.type !== 'external') throw new ExamEventError('invalid_type');
        patch.type = body.type;
    }
    if (Object.hasOwn(body, 'contestId')) {
        if (body.contestId === null || body.contestId === '') patch.contestId = null;
        else {
            if (typeof body.contestId !== 'string' || !ObjectId.isValid(body.contestId)) throw new ExamEventError('invalid_contest');
            patch.contestId = new ObjectId(body.contestId);
        }
    }
    if (Object.hasOwn(body, 'startAt')) patch.startAt = parseDate(body.startAt, 'invalid_start_at');
    if (Object.hasOwn(body, 'endAt')) patch.endAt = parseDate(body.endAt, 'invalid_end_at');
    if (Object.hasOwn(body, 'collaboratorUids')) {
        if (!Array.isArray(body.collaboratorUids)) throw new ExamEventError('invalid_collaborators');
        patch.collaboratorUids = body.collaboratorUids;
    }
    return patch;
}
