/**
 * Course-chapter pointer for file collections.
 *
 * Collect requests optionally store `courseRef: { courseId, chapterId }`.
 * This is a live query against `collect.requests`, not a TrainingNode field.
 */
import { ObjectId } from 'hydrooj';
import type { Filter } from 'mongodb';
import { requestsColl } from './db';
import type { CollectRequestDoc, CollectRequestStatus } from './types';

export interface CourseCollectRequestView {
    _id: string;
    title: string;
    dueAt: string;
    status: CollectRequestStatus;
    chapterId: number;
}

export interface ListByCourseChapterOptions {
    includeDraft?: boolean;
}

function canonicalObjectId(value: ObjectId | string, field: string): ObjectId {
    const hex = typeof value === 'string' ? value : typeof value.toHexString === 'function' ? value.toHexString() : '';
    if (!hex || !ObjectId.isValid(hex) || new ObjectId(hex).toHexString() !== hex.toLowerCase()) {
        throw new TypeError(`${field} must be a canonical ObjectId`);
    }
    return new ObjectId(hex);
}

function visibleStatuses(includeDraft: boolean): CollectRequestStatus[] {
    return includeDraft ? ['draft', 'published', 'closed'] : ['published', 'closed'];
}

function serializeCourseCollectRequest(doc: CollectRequestDoc, expectedChapterId: number): CourseCollectRequestView {
    const courseRef = doc.courseRef;
    if (!courseRef) throw new TypeError(`collect request ${String(doc._id)} is missing courseRef`);
    if (courseRef.chapterId !== expectedChapterId) {
        throw new TypeError(`collect request ${String(doc._id)} chapterId mismatch expected=${expectedChapterId} actual=${courseRef.chapterId}`);
    }
    if (!(doc.dueAt instanceof Date) || Number.isNaN(doc.dueAt.getTime())) {
        throw new TypeError(`collect request ${String(doc._id)} has invalid dueAt`);
    }
    if (typeof doc.title !== 'string' || !doc.title) {
        throw new TypeError(`collect request ${String(doc._id)} has empty title`);
    }
    const status = doc.status;
    if (status !== 'draft' && status !== 'published' && status !== 'closed' && status !== 'archived') {
        throw new TypeError(`collect request ${String(doc._id)} has invalid status`);
    }
    return {
        _id: doc._id.toHexString(),
        title: doc.title,
        dueAt: doc.dueAt.toISOString(),
        status,
        chapterId: courseRef.chapterId,
    };
}

export async function listByCourseChapter(
    domainId: string,
    courseId: ObjectId | string,
    chapterId: number,
    options: ListByCourseChapterOptions = {},
): Promise<CourseCollectRequestView[]> {
    if (typeof domainId !== 'string' || !domainId) throw new TypeError('domainId is required');
    if (!Number.isSafeInteger(chapterId)) throw new TypeError('chapterId must be a safe integer');
    const courseObjectId = canonicalObjectId(courseId, 'courseId');
    const includeDraft = options.includeDraft === true;
    const filter: Filter<CollectRequestDoc> = {
        domainId,
        'courseRef.courseId': courseObjectId,
        'courseRef.chapterId': chapterId,
        status: { $in: visibleStatuses(includeDraft) },
    };
    const docs = await requestsColl
        .find(filter)
        .sort({ dueAt: 1, _id: 1 })
        .project<CollectRequestDoc>({
            _id: 1,
            title: 1,
            dueAt: 1,
            status: 1,
            courseRef: 1,
        })
        .toArray();
    return docs.map((doc) => serializeCourseCollectRequest(doc, chapterId));
}
