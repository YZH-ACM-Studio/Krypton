/**
 * MongoDB collection references and index setup for krypton-userbind.
 *
 * Collection naming convention: `userbind.<entity>` — `.` separator marks
 * the package namespace; same convention used by other Hydro plugins
 * (e.g., `vjudge.account`).
 */
import { db } from 'hydrooj';
import type {
    BindToken,
    BindingRequest,
    School,
    StudentRecord,
    UserGroup,
} from './types';

export const schoolsColl = db.collection<School>('userbind.schools');
export const userGroupsColl = db.collection<UserGroup>('userbind.user_groups');
export const studentsColl = db.collection<StudentRecord>('userbind.students');
export const bindTokensColl = db.collection<BindToken>('userbind.bind_tokens');
export const bindingRequestsColl = db.collection<BindingRequest>('userbind.binding_requests');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;

    await Promise.all([
        schoolsColl.createIndex({ domainId: 1, name: 1 }, { unique: true }),

        userGroupsColl.createIndex(
            { domainId: 1, schoolId: 1, name: 1 },
            { unique: true },
        ),
        userGroupsColl.createIndex({ domainId: 1, schoolId: 1 }),

        studentsColl.createIndex(
            { domainId: 1, schoolId: 1, studentId: 1 },
            { unique: true },
        ),
        studentsColl.createIndex({ domainId: 1, boundUserId: 1 }),
        studentsColl.createIndex({ domainId: 1, groupIds: 1 }),
        studentsColl.createIndex({ domainId: 1, studentId: 1, realName: 1 }),

        bindTokensColl.createIndex({ domainId: 1, studentRecordId: 1 }),
        bindTokensColl.createIndex({ used: 1, expiresAt: 1 }),

        bindingRequestsColl.createIndex({ domainId: 1, status: 1, createdAt: -1 }),
        bindingRequestsColl.createIndex({ domainId: 1, userId: 1 }),
    ]);
}
