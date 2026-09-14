import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { Logger } from '@hydrooj/utils';
import db from '../service/db';
import { applyCourseVideoHeartbeat, type CoverageRange, type HeartbeatInput, isCourseVideoComplete } from '../lib/course-video';

const logger = new Logger('course-video-progress');

export interface CourseVideoProgressDoc {
    _id: ObjectId;
    domainId: string;
    courseId: ObjectId;
    videoId: string;
    contentRevision: number;
    uid: number;
    ranges: CoverageRange[];
    coverageMs: number;
    maxRate: number;
    seekForwardAttempts: number;
    lastPosition: number;
    lastWatchedAt: Date;
    completedAt?: Date;
}

export const courseVideoProgressColl = db.collection<CourseVideoProgressDoc>('course.videoProgress');

export async function loadProgress(
    domainId: string,
    courseId: ObjectId,
    videoId: string,
    contentRevision: number,
    uid: number,
): Promise<CourseVideoProgressDoc | null> {
    return courseVideoProgressColl.findOne({ domainId, courseId, videoId, contentRevision, uid });
}

export async function loadCourseProgress(
    domainId: string,
    courseId: ObjectId,
    uids: number[],
): Promise<CourseVideoProgressDoc[]> {
    if (!uids.length) return [];
    return courseVideoProgressColl.find({ domainId, courseId, uid: { $in: uids } }).toArray();
}

export async function loadUserCourseProgress(domainId: string, courseId: ObjectId, uid: number): Promise<CourseVideoProgressDoc[]> {
    return courseVideoProgressColl.find({ domainId, courseId, uid }).toArray();
}

export async function deleteCourseVideoProgress(domainId: string, courseId: ObjectId): Promise<void> {
    await courseVideoProgressColl.deleteMany({ domainId, courseId });
}

export async function applyProgressHeartbeat(input: {
    domainId: string;
    courseId: ObjectId;
    videoId: string;
    contentRevision: number;
    uid: number;
    durationMs: number;
    heartbeat: HeartbeatInput;
}): Promise<CourseVideoProgressDoc> {
    const existing = await loadProgress(input.domainId, input.courseId, input.videoId, input.contentRevision, input.uid);
    const applied = applyCourseVideoHeartbeat(
        {
            ranges: existing?.ranges || [],
            maxRate: existing?.maxRate || 1,
            seekForwardAttempts: existing?.seekForwardAttempts || 0,
            lastPosition: existing?.lastPosition || 0,
            completedAt: existing?.completedAt,
        },
        input.heartbeat,
        input.durationMs,
    );
    const coverageMs = Math.round(applied.coverageSeconds * 1000);
    const complete = applied.complete || isCourseVideoComplete(applied.ranges, input.durationMs);
    const completedAt = existing?.completedAt || (complete ? applied.completedAt || new Date() : undefined);
    const now = new Date();
    const _id = existing?._id || new ObjectId();
    const doc: CourseVideoProgressDoc = {
        _id,
        domainId: input.domainId,
        courseId: input.courseId,
        videoId: input.videoId,
        contentRevision: input.contentRevision,
        uid: input.uid,
        ranges: applied.ranges,
        coverageMs,
        maxRate: applied.maxRate,
        seekForwardAttempts: applied.seekForwardAttempts,
        lastPosition: applied.lastPosition,
        lastWatchedAt: now,
        ...(completedAt ? { completedAt } : {}),
    };
    await courseVideoProgressColl.replaceOne({ _id }, doc, { upsert: true });
    if (!existing?.completedAt && doc.completedAt) {
        logger.info(
            'Course video completed domain=%s course=%s video=%s rev=%d uid=%d coverageMs=%d stage=complete result=success',
            input.domainId,
            input.courseId,
            input.videoId,
            input.contentRevision,
            input.uid,
            coverageMs,
        );
    }
    return doc;
}

export function coverageRatio(coverageMs: number, durationMs: number): number {
    if (!durationMs) return 0;
    return Math.min(1, coverageMs / durationMs);
}

export async function ensureIndexes(): Promise<void> {
    await db.ensureIndexes(
        courseVideoProgressColl,
        { key: { domainId: 1, courseId: 1, videoId: 1, contentRevision: 1, uid: 1 }, name: 'unique_watch', unique: true },
        { key: { domainId: 1, courseId: 1, uid: 1 }, name: 'course_uid' },
    );
}

export async function apply(ctx: Context): Promise<void> {
    await ensureIndexes();
    ctx.on('domain/delete', (domainId: string) => courseVideoProgressColl.deleteMany({ domainId }));
}
