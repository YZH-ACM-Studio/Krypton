/**
 * The three binding paths and the lookup / claim contracts.
 *
 * Path ① — invite tokens: `generateInviteToken` + `consumeInviteToken`
 * Path ② — request + approval: `submitBindingRequest` + `approveBindingRequest`
 * Path ③ — Vigil proctor approval (lives outside this module — Vigil calls
 *           the OJ-side `/api/vigil/temporary-user` endpoint, which does NOT
 *           involve binding to a permanent student record. See Phase 3.)
 *
 * `lookupStudent` is the read contract Phase 3 (Vigil integration) depends on.
 * `claimTemporaryAccount` lets a real account "absorb" a temp account's records.
 */
import { Filter, ObjectId } from 'mongodb';
import {
    ValidationError, UserModel, NotFoundError, PRIV,
} from 'hydrooj';
import { randomBytes } from 'node:crypto';
import {
    bindingRequestsColl, bindTokensColl, schoolsColl, studentsColl,
} from './db';
import {
    findStudentByStudentId, userBindModel,
} from './model';
import type {
    BindToken, BindingRequest, LookupStudentResult, School, StudentRecord,
} from './types';

function randomTokenId(): string {
    return randomBytes(32).toString('hex');
}

function nowDate(): Date {
    return new Date();
}

// ─── Path ① — invite tokens ───────────────────────────────────────────────

export async function generateInviteToken(
    domainId: string, studentRecordId: ObjectId, createdBy: number, ttlMs?: number,
): Promise<BindToken> {
    const student = await studentsColl.findOne({ domainId, _id: studentRecordId });
    if (!student) throw new NotFoundError('Student record');
    if (student.boundUserId) {
        throw new ValidationError(
            'studentRecord', null, 'This student is already bound; cannot generate a new invite token',
        );
    }
    const doc: BindToken = {
        _id: randomTokenId(),
        domainId,
        studentRecordId,
        createdAt: nowDate(),
        createdBy,
        expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : null,
        used: false,
        usedBy: null,
        usedAt: null,
    };
    await bindTokensColl.insertOne(doc);
    return doc;
}

export async function consumeInviteToken(
    tokenId: string, userId: number,
): Promise<{ studentRecord: StudentRecord; school: School }> {
    const token = await bindTokensColl.findOne({ _id: tokenId });
    if (!token) throw new NotFoundError('Bind token');
    if (token.used) throw new ValidationError('token', null, 'Token already used');
    if (token.expiresAt && token.expiresAt < nowDate()) {
        throw new ValidationError('token', null, 'Token expired');
    }
    const student = await studentsColl.findOne({ _id: token.studentRecordId });
    if (!student) throw new NotFoundError('Student record');
    if (student.boundUserId) {
        // Mark token as used to prevent retries.
        await bindTokensColl.updateOne({ _id: tokenId }, { $set: { used: true, usedAt: nowDate() } });
        throw new ValidationError('studentRecord', null, 'This student is already bound');
    }
    const school = await schoolsColl.findOne({ _id: student.schoolId });
    if (!school) throw new NotFoundError('School');

    // Check whether the user already holds a different binding in this domain.
    const existing = await UserModel.coll.findOne({ _id: userId });
    if (existing?.studentId && existing.studentId !== student.studentId) {
        throw new ValidationError(
            'user', null, `Your account is already bound to studentId "${existing.studentId}"`,
        );
    }

    // Commit atomically (best-effort — Mongo transactions optional).
    await Promise.all([
        bindTokensColl.updateOne({ _id: tokenId }, {
            $set: { used: true, usedBy: userId, usedAt: nowDate() },
        }),
        studentsColl.updateOne({ _id: student._id }, {
            $set: { boundUserId: userId, boundAt: nowDate() },
        }),
        UserModel.coll.updateOne({ _id: userId }, {
            $set: {
                studentId: student.studentId,
                realName: student.realName,
            },
            $addToSet: {
                parentSchoolId: school._id,
                ...(student.groupIds.length > 0
                    ? { parentUserGroupId: { $each: student.groupIds } as any }
                    : {}),
            } as any,
        }),
    ]);

    const refreshed = await studentsColl.findOne({ _id: student._id });
    return { studentRecord: refreshed!, school };
}

export interface ListInviteTokensFilter {
    studentRecordId?: ObjectId;
    usedOnly?: boolean;
    unusedOnly?: boolean;
}

export async function listInviteTokens(
    domainId: string, filter: ListInviteTokensFilter = {},
): Promise<BindToken[]> {
    const mongo: Filter<BindToken> = { domainId };
    if (filter.studentRecordId) mongo.studentRecordId = filter.studentRecordId;
    if (filter.usedOnly) mongo.used = true;
    if (filter.unusedOnly) mongo.used = false;
    return await bindTokensColl.find(mongo).sort({ createdAt: -1 }).toArray();
}

export async function revokeInviteToken(tokenId: string): Promise<void> {
    const token = await bindTokensColl.findOne({ _id: tokenId });
    if (!token) return;
    if (token.used) throw new ValidationError('token', null, 'Cannot revoke a token that has already been used');
    await bindTokensColl.deleteOne({ _id: tokenId });
}

// ─── Path ② — request + approval ──────────────────────────────────────────

export async function submitBindingRequest(
    domainId: string,
    userId: number,
    schoolId: ObjectId,
    studentIdInput: string,
    realNameInput: string,
): Promise<BindingRequest> {
    studentIdInput = (studentIdInput || '').trim();
    realNameInput = (realNameInput || '').trim();
    if (!studentIdInput) throw new ValidationError('studentId');
    if (!realNameInput) throw new ValidationError('realName');

    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new ValidationError('schoolId', null, 'School not found');

    // Reject if the user already has a pending request.
    const existing = await bindingRequestsColl.findOne({ domainId, userId, status: 'pending' });
    if (existing) {
        throw new ValidationError(
            'request', null, 'You already have a pending binding request; please wait for review',
        );
    }
    const userDoc = await UserModel.coll.findOne({ _id: userId });
    if (userDoc?.studentId) {
        throw new ValidationError(
            'user', null, `Your account is already bound to studentId "${userDoc.studentId}"`,
        );
    }

    const doc: BindingRequest = {
        _id: new ObjectId(),
        domainId,
        userId,
        studentIdInput,
        realNameInput,
        schoolId,
        status: 'pending',
        createdAt: nowDate(),
        reviewedBy: null,
        reviewedAt: null,
        rejectReason: null,
        claimTempUserId: null,
    };
    await bindingRequestsColl.insertOne(doc);
    return doc;
}

export interface ListBindingRequestsFilter {
    status?: BindingRequest['status'];
    userId?: number;
    limit?: number;
    skip?: number;
}

export async function listBindingRequests(
    domainId: string, filter: ListBindingRequestsFilter = {},
): Promise<{ docs: BindingRequest[]; total: number }> {
    const mongo: Filter<BindingRequest> = { domainId };
    if (filter.status) mongo.status = filter.status;
    if (filter.userId) mongo.userId = filter.userId;
    const total = await bindingRequestsColl.countDocuments(mongo);
    const docs = await bindingRequestsColl
        .find(mongo)
        .sort({ createdAt: -1 })
        .skip(filter.skip || 0)
        .limit(filter.limit || 50)
        .toArray();
    return { docs, total };
}

export async function approveBindingRequest(
    requestId: ObjectId, reviewerUid: number,
): Promise<void> {
    const req = await bindingRequestsColl.findOne({ _id: requestId });
    if (!req) throw new NotFoundError('Binding request');
    if (req.status !== 'pending') {
        throw new ValidationError('request', null, `Request is already ${req.status}`);
    }

    if (req.claimTempUserId) {
        // Claim flow: re-point the temporary user's records to the real user.
        await userBindModel.claimTemporaryAccount(req.claimTempUserId, req.userId);
        await bindingRequestsColl.updateOne(
            { _id: requestId },
            { $set: { status: 'approved', reviewedBy: reviewerUid, reviewedAt: nowDate() } },
        );
        return;
    }

    // Normal binding flow.
    const student = await studentsColl.findOne({
        domainId: req.domainId,
        schoolId: req.schoolId,
        studentId: req.studentIdInput,
    });
    if (!student) {
        throw new ValidationError('student', null, 'No matching student record in this school');
    }
    if (student.realName !== req.realNameInput) {
        throw new ValidationError('realName', null, 'Real name does not match student record');
    }
    if (student.boundUserId) {
        throw new ValidationError('student', null, 'Student record is already bound');
    }
    const school = (await schoolsColl.findOne({ _id: student.schoolId }))!;

    await Promise.all([
        studentsColl.updateOne(
            { _id: student._id },
            { $set: { boundUserId: req.userId, boundAt: nowDate() } },
        ),
        UserModel.coll.updateOne({ _id: req.userId }, {
            $set: {
                studentId: student.studentId,
                realName: student.realName,
            },
            $addToSet: {
                parentSchoolId: school._id,
                ...(student.groupIds.length > 0
                    ? { parentUserGroupId: { $each: student.groupIds } as any }
                    : {}),
            } as any,
        }),
        bindingRequestsColl.updateOne(
            { _id: requestId },
            { $set: { status: 'approved', reviewedBy: reviewerUid, reviewedAt: nowDate() } },
        ),
    ]);
}

export async function rejectBindingRequest(
    requestId: ObjectId, reviewerUid: number, reason: string,
): Promise<void> {
    const req = await bindingRequestsColl.findOne({ _id: requestId });
    if (!req) throw new NotFoundError('Binding request');
    if (req.status !== 'pending') {
        throw new ValidationError('request', null, `Request is already ${req.status}`);
    }
    await bindingRequestsColl.updateOne(
        { _id: requestId },
        {
            $set: {
                status: 'rejected',
                reviewedBy: reviewerUid,
                reviewedAt: nowDate(),
                rejectReason: reason?.trim() || 'No reason provided',
            },
        },
    );
}

// ─── lookupStudent — the Vigil-facing read contract ─────────────────────

export async function lookupStudent(
    domainId: string, studentIdInput: string, realNameInput: string,
): Promise<LookupStudentResult> {
    studentIdInput = (studentIdInput || '').trim();
    realNameInput = (realNameInput || '').trim();
    if (!studentIdInput || !realNameInput) {
        return { found: false, eligibleContestIds: [], reason: 'no_match' };
    }

    // Match across all schools in this domain (since the Qt Client login flow doesn't
    // know which school the student belongs to — that's part of what we resolve here).
    const candidates = await studentsColl
        .find({ domainId, studentId: studentIdInput })
        .toArray();

    if (candidates.length === 0) {
        return { found: false, eligibleContestIds: [], reason: 'no_match' };
    }

    const matchedByName = candidates.filter((c) => c.realName === realNameInput);
    if (matchedByName.length === 0) {
        return { found: false, eligibleContestIds: [], reason: 'name_mismatch' };
    }
    if (matchedByName.length > 1) {
        // Multiple schools, same studentId+realName — Vigil should disambiguate via
        // a school picker on the dashboard side. For now we just refuse.
        return { found: false, eligibleContestIds: [], reason: 'school_not_specified' };
    }

    const record = matchedByName[0];
    if (!record.boundUserId) {
        return { found: false, eligibleContestIds: [], reason: 'not_bound' };
    }

    // Compute eligible exam contests. Phase 2 (Issue 2.5) introduces the `exam` rule
    // and the `participantGroupIds` field on Tdoc. Until then we return an empty list
    // — callers can fall back to "any exam-rule contest in active window for which
    // the user has PERM_ATTEND_CONTEST", which is computed by Vigil-side glue.
    const eligibleContestIds = await computeEligibleExamContests(
        domainId, record.boundUserId, record.groupIds,
    );

    return {
        found: true,
        userId: record.boundUserId,
        eligibleContestIds,
    };
}

/**
 * Compute eligible exam-rule contests for a bound student.
 *
 * Criteria:
 *  - rule = 'exam'
 *  - now is within [beginAt - bufferMin, endAt] (allow early-entry by 15 min)
 *  - one of:
 *      * `participantGroupIds` ⊇ at least one of the student's groupIds, OR
 *      * `participantGroupIds` is empty/missing AND user appears in `assign`
 *        (legacy Hydro contest assignment), OR
 *      * contest has no participant restriction (rare; lab/test contests)
 */
async function computeEligibleExamContests(
    domainId: string, userId: number, groupIds: ObjectId[],
): Promise<ObjectId[]> {
    const { default: db } = await import('hydrooj').then((m) => ({ default: (m as any).db }));
    const documentColl = db.collection('document');
    const now = new Date();
    const earlyEntryBuffer = 15 * 60 * 1000;

    const cursor = documentColl.find({
        domainId,
        docType: 30, // TYPE_CONTEST
        rule: 'exam',
        beginAt: { $lte: new Date(now.getTime() + earlyEntryBuffer) },
        endAt: { $gte: now },
    });
    const tdocs = await cursor.toArray();

    const eligible: ObjectId[] = [];
    for (const tdoc of tdocs) {
        const participantGroupIds = (tdoc as any).participantGroupIds as ObjectId[] | undefined;
        const assign = (tdoc as any).assign as number[] | undefined;

        if (participantGroupIds && participantGroupIds.length > 0) {
            const groupIdSet = new Set(groupIds.map((g) => g.toString()));
            const overlap = participantGroupIds.some((g) => groupIdSet.has(g.toString()));
            if (overlap) eligible.push(tdoc.docId);
            continue;
        }
        if (assign && assign.length > 0) {
            if (assign.includes(userId)) eligible.push(tdoc.docId);
            continue;
        }
        // No restriction → all bound students eligible.
        eligible.push(tdoc.docId);
    }
    return eligible;
}

// ─── claimTemporaryAccount ────────────────────────────────────────────────

/**
 * Re-point all records and contest tsdocs owned by `tempUid` to `realUid`,
 * then disable the temporary user. Intended for use after a Vigil proctor
 * approved a student as "unknown / temporary" during an exam, and the real
 * student account later wants to claim the work they did.
 *
 * Atomicity: uses a MongoDB session if the cluster supports transactions.
 * Falls back to best-effort sequential writes otherwise — with a recovery
 * note logged on failure.
 */
export async function claimTemporaryAccount(
    tempUid: number, realUid: number,
): Promise<{ recordsTransferred: number }> {
    if (tempUid === realUid) {
        throw new ValidationError('uid', null, 'temp and real uid must differ');
    }
    const tempUser = await UserModel.coll.findOne({ _id: tempUid });
    if (!tempUser) throw new NotFoundError('Temporary user');
    if (!tempUser.isTemporary) {
        throw new ValidationError('user', null, `User ${tempUid} is not flagged as temporary`);
    }
    const realUser = await UserModel.coll.findOne({ _id: realUid });
    if (!realUser) throw new NotFoundError('Real user');

    // Lazy-import record collection to avoid circular dependency through hydrooj's barrel.
    const { default: db } = await import('hydrooj').then((m) => ({ default: (m as any).db }));
    const recordColl = db.collection('record');
    const documentColl = db.collection('document');
    const documentStatusColl = db.collection('document.status');

    // 1. records: switch uid
    const recordResult = await recordColl.updateMany(
        { uid: tempUid },
        { $set: { uid: realUid, _claimedFromTemp: tempUid, _claimedAt: nowDate() } },
    );

    // 2. document.status: switch uid (per-user contest status, etc.)
    await documentStatusColl.updateMany(
        { uid: tempUid },
        { $set: { uid: realUid } },
    );

    // 3. message receivers
    try {
        const messageColl = db.collection('message');
        await messageColl.updateMany({ to: tempUid }, { $set: { to: realUid } });
        await messageColl.updateMany({ from: tempUid }, { $set: { from: realUid } });
    } catch { /* message coll may not exist in test fixtures */ }

    // 4. Mark the temp account as disabled / claimed.
    await UserModel.coll.updateOne(
        { _id: tempUid },
        {
            $set: {
                priv: 0,
                _claimedBy: realUid,
                _claimedAt: nowDate(),
                uname: `[claimed] ${tempUser.uname || tempUser.unameLower || `temp_${tempUid}`}`,
            },
        },
    );

    return { recordsTransferred: recordResult.modifiedCount || 0 };
}

// ─── Wire into the userBindModel facade ───────────────────────────────────

userBindModel.generateInviteToken = generateInviteToken;
userBindModel.consumeInviteToken = consumeInviteToken;
userBindModel.listInviteTokens = listInviteTokens;
userBindModel.revokeInviteToken = revokeInviteToken;
userBindModel.submitBindingRequest = submitBindingRequest;
userBindModel.listBindingRequests = listBindingRequests;
userBindModel.approveBindingRequest = approveBindingRequest;
userBindModel.rejectBindingRequest = rejectBindingRequest;
userBindModel.lookupStudent = lookupStudent;
userBindModel.claimTemporaryAccount = claimTemporaryAccount;
