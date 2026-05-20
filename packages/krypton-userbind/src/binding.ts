/**
 * The three binding paths and the lookup / claim contracts.
 *
 * Path ① — invite tokens. Three flavors (BindTokenKind):
 *   - student     : one-shot, points at a StudentRecord, direct bind
 *   - school      : shared, points at a School, "fill studentId+realName → match roster"
 *   - user_group  : shared, points at a UserGroup, same as school + auto-join group
 *
 * Path ② — request + approval: `submitBindingRequest` + `approveBindingRequest`
 *           When triggered from a school/user_group token's "no_match" branch,
 *           BindingRequest.sourceTokenId + .targetUserGroupId are populated
 *           so the approval handler can auto-join after creating the record.
 *
 * Path ③ — Vigil proctor approval (lives outside this module — Vigil calls
 *           the OJ-side `/api/vigil/temporary-user` endpoint).
 *
 * `lookupStudent` is the read contract Phase 3 (Vigil integration) depends on.
 * `claimTemporaryAccount` lets a real account "absorb" a temp account's records.
 */
import type { Filter } from 'mongodb';
import {
    ObjectId, ValidationError, UserModel, NotFoundError, PRIV,
} from 'hydrooj';
import { randomBytes } from 'node:crypto';
import {
    bindingRequestsColl, bindTokensColl, schoolsColl, studentsColl, userGroupsColl,
} from './db';
import {
    findStudentByStudentId, userBindModel,
} from './model';
import type {
    BindToken, BindTokenKind, BindingRequest, LookupStudentResult,
    RosterLookupOutcome, School, SchoolBindToken, StudentBindToken, StudentRecord,
    UserGroup, UserGroupBindToken,
} from './types';

function randomTokenId(): string {
    return randomBytes(32).toString('hex');
}

function nowDate(): Date {
    return new Date();
}

// ─── Path ① — invite tokens: generation ───────────────────────────────────

export async function generateStudentInviteToken(
    domainId: string, studentRecordId: ObjectId, createdBy: number, ttlMs?: number,
): Promise<StudentBindToken> {
    const student = await studentsColl.findOne({ domainId, _id: studentRecordId });
    if (!student) throw new NotFoundError('Student record');
    if (student.boundUserId) {
        throw new ValidationError(
            'studentRecord', null, 'This student is already bound; cannot generate a new invite token',
        );
    }
    const doc: StudentBindToken = {
        _id: randomTokenId(),
        domainId,
        kind: 'student',
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

export async function generateSchoolInviteToken(
    domainId: string, schoolId: ObjectId, createdBy: number, ttlMs?: number,
): Promise<SchoolBindToken> {
    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new NotFoundError('School');
    const doc: SchoolBindToken = {
        _id: randomTokenId(),
        domainId,
        kind: 'school',
        schoolId,
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

export async function generateUserGroupInviteToken(
    domainId: string, userGroupId: ObjectId, createdBy: number, ttlMs?: number,
): Promise<UserGroupBindToken> {
    const group = await userGroupsColl.findOne({ domainId, _id: userGroupId });
    if (!group) throw new NotFoundError('UserGroup');
    const doc: UserGroupBindToken = {
        _id: randomTokenId(),
        domainId,
        kind: 'user_group',
        userGroupId,
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

// ─── Path ① — invite tokens: inspection ───────────────────────────────────

/** Fetch a token by id without consuming. Throws if invalid/expired. */
export async function getInviteToken(tokenId: string): Promise<BindToken> {
    const token = await bindTokensColl.findOne({ _id: tokenId });
    if (!token) throw new NotFoundError('Bind token');
    if (token.expiresAt && token.expiresAt < nowDate()) {
        throw new ValidationError('token', null, 'Token expired');
    }
    if (token.kind === 'student' && token.used) {
        throw new ValidationError('token', null, 'Token already used');
    }
    return token as BindToken;
}

/**
 * Look up the (signed-in) user against a school's student roster, given studentId + realName.
 * Used by `school` and `user_group` token landing flows.
 */
export async function rosterLookup(
    domainId: string, schoolId: ObjectId, studentIdInput: string, realNameInput: string,
    callerUid: number,
): Promise<RosterLookupOutcome> {
    const record = await studentsColl.findOne({
        domainId, schoolId,
        studentId: studentIdInput.trim(),
        realName: realNameInput.trim(),
    });
    if (!record) return { kind: 'no_match' };
    if (!record.boundUserId) return { kind: 'matched_unbound', studentRecord: record };
    if (record.boundUserId === callerUid) return { kind: 'matched_self', studentRecord: record };
    return { kind: 'matched_other', boundToUid: record.boundUserId };
}

// ─── Path ① — invite tokens: consumption ──────────────────────────────────

export async function consumeStudentInviteToken(
    tokenId: string, userId: number,
): Promise<{ studentRecord: StudentRecord; school: School }> {
    const token = await bindTokensColl.findOne({ _id: tokenId, kind: 'student' });
    if (!token) throw new NotFoundError('Bind token');
    if (token.used) throw new ValidationError('token', null, 'Token already used');
    if (token.expiresAt && token.expiresAt < nowDate()) {
        throw new ValidationError('token', null, 'Token expired');
    }
    const studentRecordId = (token as StudentBindToken).studentRecordId;
    const student = await studentsColl.findOne({ _id: studentRecordId });
    if (!student) throw new NotFoundError('Student record');
    if (student.boundUserId) {
        await bindTokensColl.updateOne({ _id: tokenId }, { $set: { used: true, usedAt: nowDate() } });
        throw new ValidationError('studentRecord', null, 'This student is already bound');
    }
    const school = await schoolsColl.findOne({ _id: student.schoolId });
    if (!school) throw new NotFoundError('School');

    const existing = await UserModel.coll.findOne({ _id: userId });
    if (existing?.studentId && existing.studentId !== student.studentId) {
        throw new ValidationError(
            'user', null, `Your account is already bound to studentId "${existing.studentId}"`,
        );
    }

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

/** Consume a school-kind token after a successful roster match. Binds + sets school. */
export async function bindMatchedStudent(
    record: StudentRecord, userId: number, extraGroupId?: ObjectId,
): Promise<{ studentRecord: StudentRecord; school: School }> {
    if (record.boundUserId && record.boundUserId !== userId) {
        throw new ValidationError('studentRecord', null, 'Already bound to another user');
    }
    const existingUser = await UserModel.coll.findOne({ _id: userId });
    if (existingUser?.studentId && existingUser.studentId !== record.studentId) {
        throw new ValidationError(
            'user', null, `Your account is already bound to studentId "${existingUser.studentId}"`,
        );
    }
    const school = await schoolsColl.findOne({ _id: record.schoolId });
    if (!school) throw new NotFoundError('School');

    const groupIdsToAdd = [...record.groupIds];
    if (extraGroupId && !groupIdsToAdd.some((g) => g.equals(extraGroupId))) {
        groupIdsToAdd.push(extraGroupId);
    }
    await Promise.all([
        // Bind student record to the user (idempotent if already bound to same user).
        studentsColl.updateOne({ _id: record._id }, {
            $set: { boundUserId: userId, boundAt: nowDate() },
            $addToSet: extraGroupId ? { groupIds: extraGroupId as any } : {} as any,
        }),
        UserModel.coll.updateOne({ _id: userId }, {
            $set: { studentId: record.studentId, realName: record.realName },
            $addToSet: {
                parentSchoolId: school._id,
                ...(groupIdsToAdd.length > 0
                    ? { parentUserGroupId: { $each: groupIdsToAdd } as any }
                    : {}),
            } as any,
        }),
    ]);
    const refreshed = await studentsColl.findOne({ _id: record._id });
    return { studentRecord: refreshed!, school };
}

/**
 * Consume a user_group-kind token for a user who already has a matching student record.
 * (i.e. roster matched 'matched_self'.) Just adds the group to user + student.
 */
export async function joinUserGroup(
    userId: number, studentRecord: StudentRecord, userGroupId: ObjectId,
): Promise<void> {
    await Promise.all([
        studentsColl.updateOne(
            { _id: studentRecord._id },
            { $addToSet: { groupIds: userGroupId as any } },
        ),
        UserModel.coll.updateOne(
            { _id: userId },
            { $addToSet: { parentUserGroupId: userGroupId as any } },
        ),
    ]);
}

/**
 * Legacy entry point preserved for callers still on the old single-kind API.
 * Routes to `consumeStudentInviteToken` for kind='student' tokens; rejects others.
 */
export async function consumeInviteToken(
    tokenId: string, userId: number,
): Promise<{ studentRecord: StudentRecord; school: School }> {
    const token = await bindTokensColl.findOne({ _id: tokenId });
    if (!token) throw new NotFoundError('Bind token');
    if (token.kind && token.kind !== 'student') {
        throw new ValidationError(
            'token', null,
            'This invite link requires the new landing flow; visit it in a browser instead.',
        );
    }
    return await consumeStudentInviteToken(tokenId, userId);
}

export interface ListInviteTokensFilter {
    studentRecordId?: ObjectId;
    schoolId?: ObjectId;
    userGroupId?: ObjectId;
    kind?: BindTokenKind;
    usedOnly?: boolean;
    unusedOnly?: boolean;
}

export async function listInviteTokens(
    domainId: string, filter: ListInviteTokensFilter = {},
): Promise<BindToken[]> {
    const mongo: Filter<BindToken> = { domainId } as any;
    if (filter.studentRecordId) (mongo as any).studentRecordId = filter.studentRecordId;
    if (filter.schoolId) (mongo as any).schoolId = filter.schoolId;
    if (filter.userGroupId) (mongo as any).userGroupId = filter.userGroupId;
    if (filter.kind) (mongo as any).kind = filter.kind;
    if (filter.usedOnly) (mongo as any).used = true;
    if (filter.unusedOnly) (mongo as any).used = false;
    return await bindTokensColl.find(mongo).sort({ createdAt: -1 }).toArray() as BindToken[];
}

export async function revokeInviteToken(tokenId: string): Promise<void> {
    const token = await bindTokensColl.findOne({ _id: tokenId });
    if (!token) return;
    await bindTokensColl.deleteOne({ _id: tokenId });
}

// ─── Path ② — binding requests ────────────────────────────────────────────

export interface SubmitBindingRequestOpts {
    sourceTokenId?: string;
    targetUserGroupId?: ObjectId;
    claimTempUserId?: number;
}

export async function submitBindingRequest(
    domainId: string, userId: number, schoolId: ObjectId,
    studentIdInput: string, realNameInput: string,
    opts: SubmitBindingRequestOpts = {},
): Promise<BindingRequest> {
    studentIdInput = (studentIdInput || '').trim();
    realNameInput = (realNameInput || '').trim();
    if (!studentIdInput || !realNameInput) {
        throw new ValidationError('input', null, 'studentId and realName are required');
    }
    const school = await schoolsColl.findOne({ domainId, _id: schoolId });
    if (!school) throw new NotFoundError('School');

    // Reject if the same user already has a *pending* request.
    const pending = await bindingRequestsColl.findOne({
        domainId, userId, status: 'pending',
    });
    if (pending) {
        throw new ValidationError(
            'request', null,
            'You already have a pending binding application. Please wait for the admin review.',
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
        sourceTokenId: opts.sourceTokenId || null,
        targetUserGroupId: opts.targetUserGroupId || null,
        claimTempUserId: opts.claimTempUserId ?? null,
    };
    await bindingRequestsColl.insertOne(doc);
    return doc;
}

export interface ListBindingRequestsFilter {
    status?: BindingRequest['status'];
    userId?: number;
    schoolId?: ObjectId;
    limit?: number;
    skip?: number;
}

export async function listBindingRequests(
    domainId: string, filter: ListBindingRequestsFilter = {},
): Promise<{ docs: BindingRequest[]; total: number }> {
    const mongo: Filter<BindingRequest> = { domainId };
    if (filter.status) mongo.status = filter.status;
    if (filter.userId !== undefined) mongo.userId = filter.userId;
    if (filter.schoolId) mongo.schoolId = filter.schoolId;
    const total = await bindingRequestsColl.countDocuments(mongo);
    const docs = await bindingRequestsColl.find(mongo)
        .sort({ createdAt: -1 })
        .skip(filter.skip || 0)
        .limit(filter.limit || 30)
        .toArray();
    return { docs, total };
}

export async function getBindingRequest(id: ObjectId): Promise<BindingRequest | null> {
    return await bindingRequestsColl.findOne({ _id: id });
}

export async function approveBindingRequest(
    requestId: ObjectId, reviewerUid: number,
): Promise<void> {
    const req = await bindingRequestsColl.findOne({ _id: requestId });
    if (!req) throw new NotFoundError('BindingRequest');
    if (req.status !== 'pending') {
        throw new ValidationError('status', null, `Request is already ${req.status}`);
    }

    // Locate or create the student record.
    let record = await studentsColl.findOne({
        domainId: req.domainId, schoolId: req.schoolId, studentId: req.studentIdInput,
    });
    if (!record) {
        // Create a fresh record under the named school.
        record = {
            _id: new ObjectId(),
            domainId: req.domainId,
            schoolId: req.schoolId,
            studentId: req.studentIdInput,
            realName: req.realNameInput,
            groupIds: [],
            boundUserId: null,
            boundAt: null,
            createdAt: nowDate(),
            createdBy: reviewerUid,
        };
        await studentsColl.insertOne(record);
    } else if (record.realName !== req.realNameInput) {
        // Existing record found but name differs — flag for the admin
        throw new ValidationError(
            'realName', null,
            `Found existing record with studentId ${req.studentIdInput} but different realName "${record.realName}"; resolve manually.`,
        );
    } else if (record.boundUserId && record.boundUserId !== req.userId) {
        throw new ValidationError(
            'studentRecord', null,
            `Student record already bound to another uid (${record.boundUserId}).`,
        );
    }

    // Special path: claim temp user — instead of binding the requester user,
    // we transfer ownership of the temp uid's data to the requester. We delegate
    // to userBindModel.claimTemporaryAccount.
    if (req.claimTempUserId) {
        await userBindModel.claimTemporaryAccount(req.claimTempUserId, req.userId);
    } else {
        // Bind record to the requesting user, auto-join targetUserGroupId if set.
        await bindMatchedStudent(record, req.userId, req.targetUserGroupId || undefined);
    }

    await bindingRequestsColl.updateOne(
        { _id: requestId },
        { $set: { status: 'approved', reviewedBy: reviewerUid, reviewedAt: nowDate() } },
    );
}

export async function rejectBindingRequest(
    requestId: ObjectId, reviewerUid: number, reason: string,
): Promise<void> {
    const trimmed = (reason || '').trim();
    if (!trimmed) {
        throw new ValidationError('reason', null, 'Reject reason is required');
    }
    const req = await bindingRequestsColl.findOne({ _id: requestId });
    if (!req) throw new NotFoundError('BindingRequest');
    if (req.status !== 'pending') {
        throw new ValidationError('status', null, `Request is already ${req.status}`);
    }
    await bindingRequestsColl.updateOne(
        { _id: requestId },
        {
            $set: {
                status: 'rejected', reviewedBy: reviewerUid,
                reviewedAt: nowDate(), rejectReason: trimmed,
            },
        },
    );
}

// ─── Lookup contract (Phase 3 — Vigil integration) ────────────────────────

export async function lookupStudent(
    domainId: string, studentIdInput: string, realNameInput: string,
): Promise<LookupStudentResult> {
    const sid = (studentIdInput || '').trim();
    const name = (realNameInput || '').trim();
    if (!sid || !name) return { found: false, eligibleContestIds: [], reason: 'no_match' };

    const records = await studentsColl.find({
        domainId, studentId: sid, realName: name,
    }).toArray();
    if (records.length === 0) return { found: false, eligibleContestIds: [], reason: 'no_match' };

    const bound = records.find((r) => !!r.boundUserId);
    if (!bound) return { found: false, eligibleContestIds: [], reason: 'not_bound' };

    // Eligible contests come from userBindModel.computeEligibleExamContests
    // (added below; kept simple here for the import shape).
    const eligibleContestIds = await userBindModel.computeEligibleExamContests(
        domainId, bound.boundUserId!,
    );
    return { found: true, userId: bound.boundUserId!, eligibleContestIds };
}

// ─── Eligible exam contests for a user (Phase 3 — Vigil integration) ──────

export async function computeEligibleExamContests(
    domainId: string, uid: number,
): Promise<ObjectId[]> {
    // We delegate to the contest model. This is a thin helper used by lookupStudent.
    // For now: list all exam-rule contests in this domain — Vigil expects a hint set,
    // not a strict permission filter (permission gating is done at handler layer).
    const { default: contest } = await import('hydrooj/src/model/contest');
    const cursor = (contest as any).getMulti(domainId, { rule: 'exam' });
    const tdocs = await cursor.toArray();
    return tdocs.map((t: any) => t._id);
}

// ─── Claim temporary account (Task 2 / Phase 1.6) ─────────────────────────

export async function claimTemporaryAccount(
    tempUid: number, realUid: number,
): Promise<{ recordsTransferred: number }> {
    const tempUser = await UserModel.coll.findOne({ _id: tempUid });
    if (!tempUser) throw new NotFoundError('Temp user');
    if (!(tempUser as any).isTemporary) {
        throw new ValidationError('user', null, 'Source UID is not a temporary account');
    }
    // Reassign all the temp user's records to the real user.
    const db = (await import('hydrooj')).default || (await import('hydrooj'));
    let recordsTransferred = 0;
    try {
        const RecordModel: any = (db as any).RecordModel || (db as any).model?.record;
        if (RecordModel?.coll) {
            const res = await RecordModel.coll.updateMany(
                { uid: tempUid }, { $set: { uid: realUid } },
            );
            recordsTransferred = res.modifiedCount || 0;
        }
    } catch (e: any) {
        // RecordModel might not be exposed in all builds; best-effort.
    }
    // Mark temp user as claimed (we don't delete to preserve audit trail).
    await UserModel.coll.updateOne(
        { _id: tempUid },
        { $set: { isTemporary: true, claimedBy: realUid, claimedAt: nowDate() } as any },
    );
    return { recordsTransferred };
}

/**
 * Find candidate temp users that match the given studentId+realName.
 * Used by the 2-step claim form.
 */
export async function findClaimCandidates(
    domainId: string, studentIdInput: string, realNameInput: string,
): Promise<Array<{ uid: number; uname: string; createdAt: Date; schoolId: ObjectId | null }>> {
    const sid = (studentIdInput || '').trim();
    const name = (realNameInput || '').trim();
    if (!sid || !name) return [];
    // Temporary users are stored in UserModel with isTemporary=true; their studentId/realName
    // are populated by Vigil at temp-account creation time.
    const users = await UserModel.coll.find({
        isTemporary: true,
        studentId: sid,
        realName: name,
    } as any).limit(20).toArray();
    return users.map((u: any) => ({
        uid: u._id,
        uname: u.uname,
        createdAt: u._rtime || new Date(0),
        schoolId: Array.isArray(u.parentSchoolId) && u.parentSchoolId[0] ? u.parentSchoolId[0] : null,
    }));
}

// ─── Wire into the facade ─────────────────────────────────────────────────

userBindModel.generateInviteToken = generateStudentInviteToken as any;
userBindModel.generateStudentInviteToken = generateStudentInviteToken;
userBindModel.generateSchoolInviteToken = generateSchoolInviteToken;
userBindModel.generateUserGroupInviteToken = generateUserGroupInviteToken;
userBindModel.consumeInviteToken = consumeInviteToken;
userBindModel.consumeStudentInviteToken = consumeStudentInviteToken;
userBindModel.bindMatchedStudent = bindMatchedStudent;
userBindModel.joinUserGroup = joinUserGroup;
userBindModel.getInviteToken = getInviteToken;
userBindModel.rosterLookup = rosterLookup;
userBindModel.listInviteTokens = listInviteTokens;
userBindModel.revokeInviteToken = revokeInviteToken;
userBindModel.submitBindingRequest = submitBindingRequest;
userBindModel.listBindingRequests = listBindingRequests;
userBindModel.getBindingRequest = getBindingRequest;
userBindModel.approveBindingRequest = approveBindingRequest;
userBindModel.rejectBindingRequest = rejectBindingRequest;
userBindModel.lookupStudent = lookupStudent;
userBindModel.computeEligibleExamContests = computeEligibleExamContests;
userBindModel.claimTemporaryAccount = claimTemporaryAccount;
userBindModel.findClaimCandidates = findClaimCandidates;
