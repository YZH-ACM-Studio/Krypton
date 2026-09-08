/**
 * MongoDB collection refs + index setup.
 *
 * Naming: `collect.<entity>` (dot-separator = plugin namespace, matches
 * other Hydro plugins like `userbind.students` and `vjudge.account`).
 */
import { db } from 'hydrooj';
import type { CollectFileDoc, CollectRequestDoc, CollectSubmissionDoc } from './types';

export const requestsColl = db.collection<CollectRequestDoc>('collect.requests');
export const submissionsColl = db.collection<CollectSubmissionDoc>('collect.submissions');
export const filesColl = db.collection<CollectFileDoc>('collect.files');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;

    await Promise.all([
        requestsColl.createIndex({ domainId: 1, status: 1, dueAt: 1 }),
        requestsColl.createIndex({ domainId: 1, ownerUid: 1 }),
        requestsColl.createIndex({ domainId: 1, schoolId: 1 }),
        requestsColl.createIndex({ domainId: 1, groupIds: 1 }),
        requestsColl.createIndex({ domainId: 1, 'courseRef.courseId': 1 }),

        // One row per user per request covers both draft and submitted, so
        // uniqueness is a full unique — not a partial. Mongo partial indexes
        // cannot use $exists:false / $ne / $not / $or.
        submissionsColl.createIndex({ domainId: 1, requestId: 1, uid: 1 }, { unique: true }),

        filesColl.createIndex({ domainId: 1, requestId: 1, uid: 1, createdAt: -1 }),
        filesColl.createIndex({ domainId: 1, fileId: 1 }, { unique: true }),
        filesColl.createIndex({ storagePath: 1 }, { unique: true }),
    ]);
}
