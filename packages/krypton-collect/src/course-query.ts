/**
 * Course pointer for file collections.
 *
 * Collect requests optionally store `courseRef: { courseId }` (whole course)
 * or `courseRef: { courseId, chapterId }` (one chapter).
 * This is a live query against `collect.requests`, not a TrainingNode field.
 */
import { ObjectId } from 'hydrooj';
import type { Filter } from 'mongodb';
import { canViewCollect } from './auth';
import { requestsColl } from './db';
import { isAudienceMember } from './model';
import type { CollectRequestDoc, CollectRequestStatus } from './types';

export interface CourseCollectRequestView {
    _id: string;
    title: string;
    dueAt: string;
    status: CollectRequestStatus;
    chapterId: number | null;
}

export interface ListByCourseChapterOptions {
    includeDraft?: boolean;
    viewer?: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean };
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

function serializeCourseCollectRequest(doc: CollectRequestDoc, expectedChapterId?: number): CourseCollectRequestView {
    const courseRef = doc.courseRef;
    if (!courseRef) throw new TypeError(`collect request ${String(doc._id)} is missing courseRef`);
    if (expectedChapterId !== undefined && courseRef.chapterId !== expectedChapterId) {
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
        chapterId: typeof courseRef.chapterId === 'number' ? courseRef.chapterId : null,
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
    const viewer = options.viewer;
    const includeDraft = options.includeDraft === true && !!viewer;
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
            ownerUid: 1,
            collaboratorUids: 1,
            schoolId: 1,
            groupIds: 1,
        })
        .toArray();
    const visible = docs.filter((doc) => doc.status !== 'draft' || (viewer && canViewCollect(viewer, {
        ownerUid: doc.ownerUid,
        collaboratorUids: doc.collaboratorUids || [],
    })));
    // includeDraft is the manager path: show every chapter request. Students
    // (viewer + published/closed) only see live-audience rows. No viewer keeps
    // the published/closed list unchanged.
    if (includeDraft || !viewer) {
        return visible.map((doc) => serializeCourseCollectRequest(doc, chapterId));
    }
    const allowed: CollectRequestDoc[] = [];
    for (const doc of visible) {
        if (await isAudienceMember(domainId, viewer._id, doc)) allowed.push(doc);
    }
    return allowed.map((doc) => serializeCourseCollectRequest(doc, chapterId));
}

export async function listByCourse(
    domainId: string,
    courseId: ObjectId | string,
    options: ListByCourseChapterOptions = {},
): Promise<CourseCollectRequestView[]> {
    if (typeof domainId !== 'string' || !domainId) throw new TypeError('domainId is required');
    const courseObjectId = canonicalObjectId(courseId, 'courseId');
    const viewer = options.viewer;
    const includeDraft = options.includeDraft === true && !!viewer;
    const filter: Filter<CollectRequestDoc> = {
        domainId,
        'courseRef.courseId': courseObjectId,
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
            ownerUid: 1,
            collaboratorUids: 1,
            schoolId: 1,
            groupIds: 1,
        })
        .toArray();
    const visible = docs.filter((doc) => doc.status !== 'draft' || (viewer && canViewCollect(viewer, {
        ownerUid: doc.ownerUid,
        collaboratorUids: doc.collaboratorUids || [],
    })));
    if (includeDraft || !viewer) {
        return visible.map((doc) => serializeCourseCollectRequest(doc));
    }
    const allowed: CollectRequestDoc[] = [];
    for (const doc of visible) {
        if (await isAudienceMember(domainId, viewer._id, doc)) allowed.push(doc);
    }
    return allowed.map((doc) => serializeCourseCollectRequest(doc));
}

export async function existsByCourse(domainId: string, courseId: ObjectId | string): Promise<boolean> {
    if (typeof domainId !== 'string' || !domainId) throw new TypeError('domainId is required');
    const courseObjectId = canonicalObjectId(courseId, 'courseId');
    const doc = await requestsColl.findOne(
        { domainId, 'courseRef.courseId': courseObjectId },
        { projection: { _id: 1 } },
    );
    return Boolean(doc);
}

export async function existsRequiringCourseExam(domainId: string, courseId: ObjectId | string): Promise<boolean> {
    if (typeof domainId !== 'string' || !domainId) throw new TypeError('domainId is required');
    const courseObjectId = canonicalObjectId(courseId, 'courseId');
    const doc = await requestsColl.findOne(
        {
            domainId,
            'courseRef.courseId': courseObjectId,
            requireCourseExamComplete: true,
            status: { $in: ['draft', 'published', 'closed'] },
        },
        { projection: { _id: 1 } },
    );
    return Boolean(doc);
}
