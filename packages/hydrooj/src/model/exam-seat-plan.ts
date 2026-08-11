import { createHash } from 'node:crypto';
import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';

export type ExamRosterSourceKind = 'contestAudience' | 'userbindGroups' | 'userbindSchool';
export type ExamRosterExclusionReason = 'duplicate_bound_user' | 'inactive_oj_user' | 'oj_user_not_found' | 'unbound_oj_account';

export interface ExamRosterSourceGroupFact {
    groupId: ObjectId;
    schoolId: ObjectId;
    name: string;
    archivedAt: Date | null;
    fingerprint: string;
}

export interface ExamRosterResolutionStudentFact {
    studentRecordId: ObjectId;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    groupIds: ObjectId[];
    boundUserId: number | null;
}

export interface ExamRosterResolutionSource {
    kind: ExamRosterSourceKind;
    schoolId: ObjectId;
    selectedGroupIds: ObjectId[];
    contestId: ObjectId | null;
    sourceFingerprint: string;
    groups: ExamRosterSourceGroupFact[];
    students: ExamRosterResolutionStudentFact[];
}

export interface ExamRosterUserState {
    uid: number;
    active: boolean;
}

export interface ExamRosterEntry {
    studentRecordId: ObjectId;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    boundUserId: number;
    sourceGroupIds: ObjectId[];
}

export interface ExamRosterExclusion {
    studentRecordId: ObjectId;
    schoolId: ObjectId;
    studentId: string;
    realName: string;
    boundUserId: number | null;
    reason: ExamRosterExclusionReason;
}

export interface ResolvedExamRoster {
    source: Omit<ExamRosterResolutionSource, 'students'>;
    entries: ExamRosterEntry[];
    exclusions: ExamRosterExclusion[];
    fingerprint: string;
}

export interface ExamRosterRevisionDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    schoolId: ObjectId;
    revision: number;
    auditRef: string;
    source: Omit<ExamRosterResolutionSource, 'students'>;
    entries: ExamRosterEntry[];
    exclusions: ExamRosterExclusion[];
    previousRevision: number | null;
    diff: {
        addedBoundUserIds: number[];
        removedBoundUserIds: number[];
    };
    counts: {
        total: number;
        included: number;
        excluded: number;
    };
    fingerprint: string;
    createdAt: Date;
    createdBy: number;
}

export interface ExamSeatPlanRosterRef {
    rosterId: ObjectId;
    revision: number;
    fingerprint: string;
}

export interface ExamSeatPlanDiagnostic {
    code: 'insufficient_seats';
    requiredSeatCount: number;
    availableSeatCount: number;
}

export interface ExamSeatPlanDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    schoolId: ObjectId;
    revision: number;
    auditRef: string;
    roster: ExamSeatPlanRosterRef | null;
    classroomId: ObjectId;
    layoutRevision: number;
    layoutFingerprint: string;
    candidateSeatIds: string[];
    diagnostics: ExamSeatPlanDiagnostic[];
    fingerprint: string;
    createdAt: Date;
    createdBy: number;
}

type RevisionCollection<T extends { _id: ObjectId }> = Pick<Collection<T>, 'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'insertOne'>;

export class ExamSeatPlanError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamSeatPlanError';
    }
}

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function assertDomainId(domainId: unknown): asserts domainId is string {
    if (typeof domainId !== 'string' || !domainId || domainId.length > 64) throw new TypeError('domainId is invalid');
}

function assertObjectId(value: unknown, field: string): asserts value is ObjectId {
    if (!(value instanceof ObjectId)) throw new TypeError(`${field} must be an ObjectId`);
}

function assertUid(uid: unknown, field = 'actorUid'): asserts uid is number {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid < 1) throw new TypeError(`${field} is invalid`);
}

function assertRevision(revision: unknown): asserts revision is number {
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('revision is invalid');
}

function assertFingerprint(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ExamSeatPlanError(`${field}_invalid`);
}

function exactObject(value: unknown, keys: string[], reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamSeatPlanError(reason);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) throw new ExamSeatPlanError(reason);
    return record;
}

function canonicalDate(value: unknown, field: string): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ExamSeatPlanError(`${field}_invalid`);
    return new Date(value);
}

function canonicalText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength) {
        throw new ExamSeatPlanError(`${field}_invalid`);
    }
    return value;
}

function canonicalObjectIds(values: unknown, field: string, maxLength = 500): ObjectId[] {
    if (!Array.isArray(values) || values.length > maxLength || values.some((value) => !(value instanceof ObjectId))) {
        throw new ExamSeatPlanError(`${field}_invalid`);
    }
    const result = values
        .map((value) => new ObjectId(value as ObjectId))
        .sort((left, right) => left.toHexString().localeCompare(right.toHexString()));
    if (new Set(result.map((value) => value.toHexString())).size !== result.length) throw new ExamSeatPlanError(`${field}_duplicate`);
    return result;
}

function canonicalGroupFacts(values: unknown, schoolId: ObjectId): ExamRosterSourceGroupFact[] {
    if (!Array.isArray(values) || values.length > 100) throw new ExamSeatPlanError('source_groups_invalid');
    const groups = values.map((value) => {
        const group = exactObject(value, ['archivedAt', 'fingerprint', 'groupId', 'name', 'schoolId'], 'source_group_invalid');
        assertObjectId(group.groupId, 'groupId');
        assertObjectId(group.schoolId, 'groupSchoolId');
        if (!group.schoolId.equals(schoolId)) throw new ExamSeatPlanError('source_group_school_mismatch');
        assertFingerprint(group.fingerprint, 'source_group_fingerprint');
        return {
            groupId: new ObjectId(group.groupId),
            schoolId: new ObjectId(group.schoolId),
            name: canonicalText(group.name, 'source_group_name', 120),
            archivedAt: group.archivedAt === null ? null : canonicalDate(group.archivedAt, 'source_group_archived_at'),
            fingerprint: group.fingerprint,
        };
    });
    groups.sort((left, right) => left.groupId.toHexString().localeCompare(right.groupId.toHexString()));
    if (new Set(groups.map((group) => group.groupId.toHexString())).size !== groups.length) throw new ExamSeatPlanError('source_group_duplicate');
    return groups;
}

function canonicalStudentFacts(values: unknown, schoolId: ObjectId): ExamRosterResolutionStudentFact[] {
    if (!Array.isArray(values) || values.length > 5000) throw new ExamSeatPlanError('source_students_invalid');
    const students = values.map((value) => {
        const student = exactObject(
            value,
            ['boundUserId', 'groupIds', 'realName', 'schoolId', 'studentId', 'studentRecordId'],
            'source_student_invalid',
        );
        assertObjectId(student.studentRecordId, 'studentRecordId');
        assertObjectId(student.schoolId, 'studentSchoolId');
        if (!student.schoolId.equals(schoolId)) throw new ExamSeatPlanError('source_student_school_mismatch');
        let boundUserId: number | null = null;
        if (student.boundUserId !== null) {
            assertUid(student.boundUserId, 'boundUserId');
            boundUserId = student.boundUserId;
        }
        return {
            studentRecordId: new ObjectId(student.studentRecordId),
            schoolId: new ObjectId(student.schoolId),
            studentId: canonicalText(student.studentId, 'student_id', 64),
            realName: canonicalText(student.realName, 'student_real_name', 32),
            groupIds: canonicalObjectIds(student.groupIds, 'student_group_ids', 100),
            boundUserId,
        };
    });
    students.sort((left, right) => left.studentRecordId.toHexString().localeCompare(right.studentRecordId.toHexString()));
    if (new Set(students.map((student) => student.studentRecordId.toHexString())).size !== students.length) {
        throw new ExamSeatPlanError('source_student_duplicate');
    }
    return students;
}

function canonicalResolutionSource(value: unknown, expectedSchoolId: ObjectId): ExamRosterResolutionSource {
    const source = exactObject(
        value,
        ['contestId', 'groups', 'kind', 'schoolId', 'selectedGroupIds', 'sourceFingerprint', 'students'],
        'roster_source_invalid',
    );
    if (typeof source.kind !== 'string' || !['contestAudience', 'userbindGroups', 'userbindSchool'].includes(source.kind)) {
        throw new ExamSeatPlanError('roster_source_kind_invalid');
    }
    assertObjectId(source.schoolId, 'sourceSchoolId');
    if (!source.schoolId.equals(expectedSchoolId)) throw new ExamSeatPlanError('roster_source_school_mismatch');
    const selectedGroupIds = canonicalObjectIds(source.selectedGroupIds, 'selected_group_ids', 100);
    if (source.kind === 'userbindGroups' && !selectedGroupIds.length) throw new ExamSeatPlanError('selected_group_ids_invalid');
    if (source.kind === 'userbindSchool' && selectedGroupIds.length) throw new ExamSeatPlanError('selected_group_ids_invalid');
    if (source.kind === 'contestAudience') {
        assertObjectId(source.contestId, 'contestId');
    } else if (source.contestId !== null) throw new ExamSeatPlanError('contest_id_invalid');
    assertFingerprint(source.sourceFingerprint, 'source_fingerprint');
    const groups = canonicalGroupFacts(source.groups, expectedSchoolId);
    if (
        selectedGroupIds.length &&
        (groups.length !== selectedGroupIds.length || groups.some((group, index) => !group.groupId.equals(selectedGroupIds[index])))
    ) {
        throw new ExamSeatPlanError('source_group_selection_mismatch');
    }
    return {
        kind: source.kind as ExamRosterSourceKind,
        schoolId: new ObjectId(source.schoolId),
        selectedGroupIds,
        contestId: source.contestId === null ? null : new ObjectId(source.contestId as ObjectId),
        sourceFingerprint: source.sourceFingerprint,
        groups,
        students: canonicalStudentFacts(source.students, expectedSchoolId),
    };
}

function sourceFingerprintFact(source: ExamRosterResolutionSource | Omit<ExamRosterResolutionSource, 'students'>) {
    return {
        kind: source.kind,
        schoolId: source.schoolId.toHexString(),
        selectedGroupIds: source.selectedGroupIds.map((id) => id.toHexString()),
        contestId: source.contestId?.toHexString() || null,
        sourceFingerprint: source.sourceFingerprint,
        groups: source.groups.map((group) => ({
            groupId: group.groupId.toHexString(),
            schoolId: group.schoolId.toHexString(),
            name: group.name,
            archivedAt: group.archivedAt?.toISOString() || null,
            fingerprint: group.fingerprint,
        })),
    };
}

function studentFingerprintFact(student: ExamRosterResolutionStudentFact) {
    return {
        studentRecordId: student.studentRecordId.toHexString(),
        schoolId: student.schoolId.toHexString(),
        studentId: student.studentId,
        realName: student.realName,
        groupIds: student.groupIds.map((id) => id.toHexString()),
        boundUserId: student.boundUserId,
    };
}

function resolutionSourceShapeFingerprint(source: ExamRosterResolutionSource): string {
    return sha256({ source: sourceFingerprintFact(source), students: source.students.map(studentFingerprintFact) });
}

function canonicalUserStates(values: ExamRosterUserState[], requestedUids: number[]): ExamRosterUserState[] {
    if (!Array.isArray(values)) throw new ExamSeatPlanError('user_states_invalid');
    const states = values.map((value) => {
        exactObject(value, ['active', 'uid'], 'user_state_invalid');
        assertUid(value.uid, 'userStateUid');
        if (typeof value.active !== 'boolean') throw new ExamSeatPlanError('user_state_invalid');
        return { uid: value.uid, active: value.active };
    });
    states.sort((left, right) => left.uid - right.uid);
    if (new Set(states.map((state) => state.uid)).size !== states.length) throw new ExamSeatPlanError('user_state_duplicate');
    const requested = [...requestedUids].sort((left, right) => left - right);
    if (states.some((state) => !requested.includes(state.uid))) throw new ExamSeatPlanError('user_state_unrequested');
    return states;
}

function userStatesFingerprint(states: ExamRosterUserState[]): string {
    return sha256(states);
}

export async function resolveStableExamRoster(input: {
    schoolId: ObjectId;
    loadSource(): Promise<ExamRosterResolutionSource>;
    loadUserStates(uids: number[]): Promise<ExamRosterUserState[]>;
}): Promise<ResolvedExamRoster> {
    assertObjectId(input.schoolId, 'schoolId');
    const firstSource = canonicalResolutionSource(await input.loadSource(), input.schoolId);
    const firstUids = Array.from(
        new Set(firstSource.students.flatMap((student) => (student.boundUserId === null ? [] : [student.boundUserId]))),
    ).sort((left, right) => left - right);
    const firstStates = canonicalUserStates(await input.loadUserStates(firstUids), firstUids);
    const secondSource = canonicalResolutionSource(await input.loadSource(), input.schoolId);
    const secondUids = Array.from(
        new Set(secondSource.students.flatMap((student) => (student.boundUserId === null ? [] : [student.boundUserId]))),
    ).sort((left, right) => left - right);
    const secondStates = canonicalUserStates(await input.loadUserStates(secondUids), secondUids);
    if (
        resolutionSourceShapeFingerprint(firstSource) !== resolutionSourceShapeFingerprint(secondSource) ||
        userStatesFingerprint(firstStates) !== userStatesFingerprint(secondStates)
    ) {
        throw new ExamSeatPlanError('roster_source_changed');
    }

    const stateByUid = new Map(secondStates.map((state) => [state.uid, state]));
    const boundCounts = new Map<number, number>();
    for (const student of secondSource.students) {
        if (student.boundUserId !== null) boundCounts.set(student.boundUserId, (boundCounts.get(student.boundUserId) || 0) + 1);
    }
    const entries: ExamRosterEntry[] = [];
    const exclusions: ExamRosterExclusion[] = [];
    for (const student of secondSource.students) {
        let reason: ExamRosterExclusionReason | null = null;
        if (student.boundUserId === null) reason = 'unbound_oj_account';
        else if (boundCounts.get(student.boundUserId)! > 1) reason = 'duplicate_bound_user';
        else if (!stateByUid.has(student.boundUserId)) reason = 'oj_user_not_found';
        else if (!stateByUid.get(student.boundUserId)!.active) reason = 'inactive_oj_user';
        if (reason) {
            exclusions.push({
                studentRecordId: new ObjectId(student.studentRecordId),
                schoolId: new ObjectId(student.schoolId),
                studentId: student.studentId,
                realName: student.realName,
                boundUserId: student.boundUserId,
                reason,
            });
            continue;
        }
        entries.push({
            studentRecordId: new ObjectId(student.studentRecordId),
            schoolId: new ObjectId(student.schoolId),
            studentId: student.studentId,
            realName: student.realName,
            boundUserId: student.boundUserId!,
            sourceGroupIds: student.groupIds
                .filter((groupId) => secondSource.selectedGroupIds.some((selected) => selected.equals(groupId)))
                .map((groupId) => new ObjectId(groupId))
                .sort((left, right) => left.toHexString().localeCompare(right.toHexString())),
        });
    }
    entries.sort(
        (left, right) =>
            left.boundUserId - right.boundUserId || left.studentRecordId.toHexString().localeCompare(right.studentRecordId.toHexString()),
    );
    exclusions.sort((left, right) => left.studentRecordId.toHexString().localeCompare(right.studentRecordId.toHexString()));
    const { students: _students, ...source } = secondSource;
    const fingerprint = sha256({
        source: sourceFingerprintFact(source),
        entries: entries.map((entry) => ({
            studentRecordId: entry.studentRecordId.toHexString(),
            schoolId: entry.schoolId.toHexString(),
            studentId: entry.studentId,
            realName: entry.realName,
            boundUserId: entry.boundUserId,
            sourceGroupIds: entry.sourceGroupIds.map((id) => id.toHexString()),
        })),
        exclusions: exclusions.map((exclusion) => ({
            studentRecordId: exclusion.studentRecordId.toHexString(),
            schoolId: exclusion.schoolId.toHexString(),
            studentId: exclusion.studentId,
            realName: exclusion.realName,
            boundUserId: exclusion.boundUserId,
            reason: exclusion.reason,
        })),
        userStates: secondStates,
    });
    return { source, entries, exclusions, fingerprint };
}

export function examRosterAuditRef(eventId: ObjectId, revision: number): string {
    return `exam-roster:${eventId.toHexString()}:${revision}`;
}

export function examSeatPlanAuditRef(eventId: ObjectId, revision: number): string {
    return `exam-seat-plan:${eventId.toHexString()}:${revision}`;
}

function entryFingerprintFact(entry: ExamRosterEntry) {
    return {
        studentRecordId: entry.studentRecordId.toHexString(),
        schoolId: entry.schoolId.toHexString(),
        studentId: entry.studentId,
        realName: entry.realName,
        boundUserId: entry.boundUserId,
        sourceGroupIds: entry.sourceGroupIds.map((id) => id.toHexString()),
    };
}

function exclusionFingerprintFact(exclusion: ExamRosterExclusion) {
    return {
        studentRecordId: exclusion.studentRecordId.toHexString(),
        schoolId: exclusion.schoolId.toHexString(),
        studentId: exclusion.studentId,
        realName: exclusion.realName,
        boundUserId: exclusion.boundUserId,
        reason: exclusion.reason,
    };
}

export function rosterDocumentFingerprint(doc: Omit<ExamRosterRevisionDoc, 'fingerprint'>): string {
    return sha256({
        rosterId: doc._id.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        eventRevision: doc.eventRevision,
        schoolId: doc.schoolId.toHexString(),
        revision: doc.revision,
        source: sourceFingerprintFact(doc.source),
        entries: doc.entries.map(entryFingerprintFact),
        exclusions: doc.exclusions.map(exclusionFingerprintFact),
        previousRevision: doc.previousRevision,
        diff: doc.diff,
        counts: doc.counts,
        auditRef: doc.auditRef,
        createdAt: doc.createdAt.toISOString(),
        createdBy: doc.createdBy,
    });
}

export function planDocumentFingerprint(doc: Omit<ExamSeatPlanDoc, 'fingerprint'>): string {
    return sha256({
        seatPlanId: doc._id.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        eventRevision: doc.eventRevision,
        schoolId: doc.schoolId.toHexString(),
        revision: doc.revision,
        roster: doc.roster
            ? { rosterId: doc.roster.rosterId.toHexString(), revision: doc.roster.revision, fingerprint: doc.roster.fingerprint }
            : null,
        classroomId: doc.classroomId.toHexString(),
        layoutRevision: doc.layoutRevision,
        layoutFingerprint: doc.layoutFingerprint,
        candidateSeatIds: doc.candidateSeatIds,
        diagnostics: doc.diagnostics,
        auditRef: doc.auditRef,
        createdAt: doc.createdAt.toISOString(),
        createdBy: doc.createdBy,
    });
}

export class ExamSeatPlanService {
    private indexesPromise?: Promise<void>;

    constructor(
        private readonly rosters: RevisionCollection<ExamRosterRevisionDoc>,
        private readonly seatPlans: RevisionCollection<ExamSeatPlanDoc>,
        private readonly now: () => Date = () => new Date(),
        private readonly idFactory: () => ObjectId = () => new ObjectId(),
    ) {}

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.rosters.createIndex({ domainId: 1, eventId: 1, revision: 1 }, { name: 'examRosterEventRevision', unique: true }),
            this.rosters.createIndex({ domainId: 1, eventId: 1, createdAt: -1 }, { name: 'examRosterEventCreated' }),
            this.seatPlans.createIndex({ domainId: 1, eventId: 1, revision: 1 }, { name: 'examSeatPlanEventRevision', unique: true }),
            this.seatPlans.createIndex({ domainId: 1, eventId: 1, createdAt: -1 }, { name: 'examSeatPlanEventCreated' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    private async latestRoster(domainId: string, eventId: ObjectId): Promise<ExamRosterRevisionDoc | null> {
        const rows = await this.rosters.find({ domainId, eventId }).sort({ revision: -1 }).limit(1).toArray();
        return rows[0] || null;
    }

    private async latestSeatPlan(domainId: string, eventId: ObjectId): Promise<ExamSeatPlanDoc | null> {
        const rows = await this.seatPlans.find({ domainId, eventId }).sort({ revision: -1 }).limit(1).toArray();
        return rows[0] || null;
    }

    async createRosterRevision(input: {
        domainId: string;
        eventId: ObjectId;
        eventRevision: number;
        schoolId: ObjectId;
        actorUid: number;
        resolved: ResolvedExamRoster;
    }): Promise<ExamRosterRevisionDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertRevision(input.eventRevision);
        assertObjectId(input.schoolId, 'schoolId');
        assertUid(input.actorUid);
        assertFingerprint(input.resolved.fingerprint, 'resolved_roster_fingerprint');
        const previous = await this.latestRoster(input.domainId, input.eventId);
        if (previous) assertExamRosterRevisionIntegrity(previous);
        const revision = (previous?.revision || 0) + 1;
        const currentUids = input.resolved.entries.map((entry) => entry.boundUserId);
        const previousUids = previous?.entries.map((entry) => entry.boundUserId) || [];
        const base = {
            domainId: input.domainId,
            eventId: new ObjectId(input.eventId),
            eventRevision: input.eventRevision,
            schoolId: new ObjectId(input.schoolId),
            revision,
            source: input.resolved.source,
            entries: input.resolved.entries,
            exclusions: input.resolved.exclusions,
            previousRevision: previous?.revision || null,
            diff: {
                addedBoundUserIds: currentUids.filter((uid) => !previousUids.includes(uid)).sort((left, right) => left - right),
                removedBoundUserIds: previousUids.filter((uid) => !currentUids.includes(uid)).sort((left, right) => left - right),
            },
            counts: {
                total: input.resolved.entries.length + input.resolved.exclusions.length,
                included: input.resolved.entries.length,
                excluded: input.resolved.exclusions.length,
            },
        };
        const canonicalDoc = {
            _id: this.idFactory(),
            ...base,
            auditRef: examRosterAuditRef(input.eventId, revision),
            createdAt: this.now(),
            createdBy: input.actorUid,
        };
        const doc: ExamRosterRevisionDoc = { ...canonicalDoc, fingerprint: rosterDocumentFingerprint(canonicalDoc) };
        assertExamRosterRevisionIntegrity(doc);
        try {
            await this.rosters.insertOne(doc);
        } catch (error) {
            if ((error as { code?: unknown })?.code === 11000) throw new ExamSeatPlanError('roster_revision_conflict');
            throw error;
        }
        return doc;
    }

    async createSeatPlan(input: {
        domainId: string;
        eventId: ObjectId;
        eventRevision: number;
        schoolId: ObjectId;
        actorUid: number;
        roster: ExamRosterRevisionDoc | null;
        classroomId: ObjectId;
        layoutRevision: number;
        layoutFingerprint: string;
        candidateSeatIds: string[];
        requireRoster: boolean;
    }): Promise<ExamSeatPlanDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertRevision(input.eventRevision);
        assertObjectId(input.schoolId, 'schoolId');
        assertObjectId(input.classroomId, 'classroomId');
        assertUid(input.actorUid);
        assertRevision(input.layoutRevision);
        assertFingerprint(input.layoutFingerprint, 'layout_fingerprint');
        if (input.requireRoster && !input.roster) throw new ExamSeatPlanError('roster_required');
        if (input.roster) {
            assertExamRosterRevisionIntegrity(input.roster);
            if (
                input.roster.domainId !== input.domainId ||
                !input.roster.eventId.equals(input.eventId) ||
                !input.roster.schoolId.equals(input.schoolId)
            ) {
                throw new ExamSeatPlanError('roster_identity_mismatch');
            }
        }
        if (!Array.isArray(input.candidateSeatIds) || input.candidateSeatIds.length > 500) throw new ExamSeatPlanError('candidate_seats_invalid');
        const candidateSeatIds = input.candidateSeatIds.map((value) => canonicalText(value, 'candidate_seat_id', 128)).sort();
        if (new Set(candidateSeatIds).size !== candidateSeatIds.length) throw new ExamSeatPlanError('candidate_seat_duplicate');
        const previous = await this.latestSeatPlan(input.domainId, input.eventId);
        if (previous) assertExamSeatPlanIntegrity(previous);
        const revision = (previous?.revision || 0) + 1;
        const requiredSeatCount = input.roster?.entries.length || 0;
        const diagnostics: ExamSeatPlanDiagnostic[] =
            requiredSeatCount > candidateSeatIds.length
                ? [{ code: 'insufficient_seats', requiredSeatCount, availableSeatCount: candidateSeatIds.length }]
                : [];
        const base = {
            domainId: input.domainId,
            eventId: new ObjectId(input.eventId),
            eventRevision: input.eventRevision,
            schoolId: new ObjectId(input.schoolId),
            revision,
            roster: input.roster
                ? { rosterId: new ObjectId(input.roster._id), revision: input.roster.revision, fingerprint: input.roster.fingerprint }
                : null,
            classroomId: new ObjectId(input.classroomId),
            layoutRevision: input.layoutRevision,
            layoutFingerprint: input.layoutFingerprint,
            candidateSeatIds,
            diagnostics,
        };
        const canonicalDoc = {
            _id: this.idFactory(),
            ...base,
            auditRef: examSeatPlanAuditRef(input.eventId, revision),
            createdAt: this.now(),
            createdBy: input.actorUid,
        };
        const doc: ExamSeatPlanDoc = { ...canonicalDoc, fingerprint: planDocumentFingerprint(canonicalDoc) };
        assertExamSeatPlanIntegrity(doc);
        try {
            await this.seatPlans.insertOne(doc);
        } catch (error) {
            if ((error as { code?: unknown })?.code === 11000) throw new ExamSeatPlanError('seat_plan_revision_conflict');
            throw error;
        }
        return doc;
    }

    async getRosterRevision(domainId: string, eventId: ObjectId, revision: number): Promise<ExamRosterRevisionDoc | null> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        assertRevision(revision);
        const roster = await this.rosters.findOne({ domainId, eventId, revision });
        if (roster) assertExamRosterRevisionIntegrity(roster);
        return roster;
    }

    async getSeatPlanRevision(domainId: string, eventId: ObjectId, revision: number): Promise<ExamSeatPlanDoc | null> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        assertRevision(revision);
        const plan = await this.seatPlans.findOne({ domainId, eventId, revision });
        if (plan) assertExamSeatPlanIntegrity(plan);
        return plan;
    }

    async assertEventSchoolChangeAllowed(domainId: string, eventId: ObjectId): Promise<void> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        const [roster, plan] = await Promise.all([this.rosters.findOne({ domainId, eventId }), this.seatPlans.findOne({ domainId, eventId })]);
        if (roster || plan) throw new ExamSeatPlanError('event_school_has_seat_facts');
    }

    listRosterRevisions(domainId: string, eventId: ObjectId) {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        return this.rosters.find({ domainId, eventId }).sort({ revision: -1 }).limit(100);
    }

    listSeatPlans(domainId: string, eventId: ObjectId) {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        return this.seatPlans.find({ domainId, eventId }).sort({ revision: -1 }).limit(100);
    }
}

function canonicalRosterEntry(value: unknown, schoolId: ObjectId): ExamRosterEntry {
    const entry = exactObject(
        value,
        ['boundUserId', 'realName', 'schoolId', 'sourceGroupIds', 'studentId', 'studentRecordId'],
        'roster_entry_invalid',
    );
    assertObjectId(entry.studentRecordId, 'studentRecordId');
    assertObjectId(entry.schoolId, 'entrySchoolId');
    if (!entry.schoolId.equals(schoolId)) throw new ExamSeatPlanError('roster_entry_school_mismatch');
    assertUid(entry.boundUserId, 'boundUserId');
    return {
        studentRecordId: new ObjectId(entry.studentRecordId),
        schoolId: new ObjectId(entry.schoolId),
        studentId: canonicalText(entry.studentId, 'student_id', 64),
        realName: canonicalText(entry.realName, 'student_real_name', 32),
        boundUserId: entry.boundUserId,
        sourceGroupIds: canonicalObjectIds(entry.sourceGroupIds, 'source_group_ids', 100),
    };
}

function canonicalRosterExclusion(value: unknown, schoolId: ObjectId): ExamRosterExclusion {
    const exclusion = exactObject(
        value,
        ['boundUserId', 'realName', 'reason', 'schoolId', 'studentId', 'studentRecordId'],
        'roster_exclusion_invalid',
    );
    assertObjectId(exclusion.studentRecordId, 'studentRecordId');
    assertObjectId(exclusion.schoolId, 'exclusionSchoolId');
    if (!exclusion.schoolId.equals(schoolId)) throw new ExamSeatPlanError('roster_exclusion_school_mismatch');
    let boundUserId: number | null = null;
    if (exclusion.boundUserId !== null) {
        assertUid(exclusion.boundUserId, 'boundUserId');
        boundUserId = exclusion.boundUserId;
    }
    if (
        typeof exclusion.reason !== 'string' ||
        !['duplicate_bound_user', 'inactive_oj_user', 'oj_user_not_found', 'unbound_oj_account'].includes(exclusion.reason)
    ) {
        throw new ExamSeatPlanError('roster_exclusion_reason_invalid');
    }
    return {
        studentRecordId: new ObjectId(exclusion.studentRecordId),
        schoolId: new ObjectId(exclusion.schoolId),
        studentId: canonicalText(exclusion.studentId, 'student_id', 64),
        realName: canonicalText(exclusion.realName, 'student_real_name', 32),
        boundUserId,
        reason: exclusion.reason as ExamRosterExclusionReason,
    };
}

export function assertExamRosterRevisionIntegrity(value: unknown): asserts value is ExamRosterRevisionDoc {
    const doc = exactObject(
        value,
        [
            '_id',
            'auditRef',
            'counts',
            'createdAt',
            'createdBy',
            'diff',
            'domainId',
            'entries',
            'eventId',
            'eventRevision',
            'exclusions',
            'fingerprint',
            'previousRevision',
            'revision',
            'schoolId',
            'source',
        ],
        'roster_document_invalid',
    );
    assertObjectId(doc._id, 'rosterId');
    assertObjectId(doc.eventId, 'eventId');
    assertRevision(doc.eventRevision);
    assertObjectId(doc.schoolId, 'schoolId');
    assertDomainId(doc.domainId);
    assertRevision(doc.revision);
    assertUid(doc.createdBy, 'createdBy');
    const createdAt = canonicalDate(doc.createdAt, 'created_at');
    if (doc.auditRef !== examRosterAuditRef(doc.eventId, doc.revision)) throw new ExamSeatPlanError('roster_audit_ref_invalid');
    assertFingerprint(doc.fingerprint, 'roster_fingerprint');
    const sourceRecord = { ...(doc.source as Record<string, unknown>), students: [] };
    const source = canonicalResolutionSource(sourceRecord, doc.schoolId);
    const { students: _students, ...storedSource } = source;
    const storedSchoolId = new ObjectId(doc.schoolId);
    if (!Array.isArray(doc.entries) || !Array.isArray(doc.exclusions)) throw new ExamSeatPlanError('roster_members_invalid');
    const entries = doc.entries.map((entry) => canonicalRosterEntry(entry, storedSchoolId));
    const exclusions = doc.exclusions.map((entry) => canonicalRosterExclusion(entry, storedSchoolId));
    const entryOrder = entries.map((entry) => `${entry.boundUserId.toString().padStart(16, '0')}\0${entry.studentRecordId.toHexString()}`);
    if ([...entryOrder].sort().some((item, index) => item !== entryOrder[index])) throw new ExamSeatPlanError('roster_entries_unsorted');
    const exclusionOrder = exclusions.map((entry) => entry.studentRecordId.toHexString());
    if ([...exclusionOrder].sort().some((item, index) => item !== exclusionOrder[index])) {
        throw new ExamSeatPlanError('roster_exclusions_unsorted');
    }
    const recordIds = [...entries, ...exclusions].map((entry) => entry.studentRecordId.toHexString());
    if (new Set(recordIds).size !== recordIds.length) throw new ExamSeatPlanError('roster_student_duplicate');
    if (new Set(entries.map((entry) => entry.boundUserId)).size !== entries.length) throw new ExamSeatPlanError('roster_bound_user_duplicate');
    if (
        entries.some((entry) => entry.sourceGroupIds.some((groupId) => !storedSource.selectedGroupIds.some((selected) => selected.equals(groupId))))
    ) {
        throw new ExamSeatPlanError('roster_entry_group_mismatch');
    }
    if (exclusions.some((entry) => (entry.reason === 'unbound_oj_account' ? entry.boundUserId !== null : entry.boundUserId === null))) {
        throw new ExamSeatPlanError('roster_exclusion_binding_mismatch');
    }
    const duplicateExclusions = exclusions.filter((entry) => entry.reason === 'duplicate_bound_user');
    if (duplicateExclusions.some((entry) => duplicateExclusions.filter((candidate) => candidate.boundUserId === entry.boundUserId).length < 2)) {
        throw new ExamSeatPlanError('roster_duplicate_diagnostic_invalid');
    }
    if (doc.previousRevision !== null && (!Number.isSafeInteger(doc.previousRevision) || doc.previousRevision !== doc.revision - 1)) {
        throw new ExamSeatPlanError('roster_previous_revision_invalid');
    }
    if (doc.revision === 1 && doc.previousRevision !== null) throw new ExamSeatPlanError('roster_previous_revision_invalid');
    if (doc.revision > 1 && doc.previousRevision === null) throw new ExamSeatPlanError('roster_previous_revision_invalid');
    const diff = exactObject(doc.diff, ['addedBoundUserIds', 'removedBoundUserIds'], 'roster_diff_invalid');
    for (const field of ['addedBoundUserIds', 'removedBoundUserIds'] as const) {
        if (!Array.isArray(diff[field]) || diff[field].some((uid) => !Number.isSafeInteger(uid) || Number(uid) < 1)) {
            throw new ExamSeatPlanError('roster_diff_invalid');
        }
        const values = (diff[field] as number[]).map(Number);
        if (new Set(values).size !== values.length || [...values].sort((left, right) => left - right).some((item, index) => item !== values[index])) {
            throw new ExamSeatPlanError('roster_diff_invalid');
        }
    }
    if ((diff.addedBoundUserIds as number[]).some((uid) => (diff.removedBoundUserIds as number[]).includes(uid))) {
        throw new ExamSeatPlanError('roster_diff_invalid');
    }
    const counts = exactObject(doc.counts, ['excluded', 'included', 'total'], 'roster_counts_invalid');
    if (counts.included !== entries.length || counts.excluded !== exclusions.length || counts.total !== entries.length + exclusions.length) {
        throw new ExamSeatPlanError('roster_counts_invalid');
    }
    const expectedFingerprint = rosterDocumentFingerprint({
        _id: doc._id,
        domainId: doc.domainId,
        eventId: doc.eventId,
        eventRevision: doc.eventRevision,
        schoolId: doc.schoolId,
        revision: doc.revision,
        source: storedSource,
        entries,
        exclusions,
        previousRevision: doc.previousRevision as number | null,
        diff: {
            addedBoundUserIds: (diff.addedBoundUserIds as number[]).map(Number),
            removedBoundUserIds: (diff.removedBoundUserIds as number[]).map(Number),
        },
        counts: { total: Number(counts.total), included: Number(counts.included), excluded: Number(counts.excluded) },
        auditRef: doc.auditRef,
        createdAt,
        createdBy: doc.createdBy,
    });
    if (doc.fingerprint !== expectedFingerprint) throw new ExamSeatPlanError('roster_fingerprint_mismatch');
}

export function assertExamSeatPlanIntegrity(value: unknown): asserts value is ExamSeatPlanDoc {
    const doc = exactObject(
        value,
        [
            '_id',
            'auditRef',
            'candidateSeatIds',
            'classroomId',
            'createdAt',
            'createdBy',
            'diagnostics',
            'domainId',
            'eventId',
            'eventRevision',
            'fingerprint',
            'layoutFingerprint',
            'layoutRevision',
            'revision',
            'roster',
            'schoolId',
        ],
        'seat_plan_document_invalid',
    );
    assertObjectId(doc._id, 'seatPlanId');
    assertObjectId(doc.eventId, 'eventId');
    assertRevision(doc.eventRevision);
    assertObjectId(doc.schoolId, 'schoolId');
    assertObjectId(doc.classroomId, 'classroomId');
    assertDomainId(doc.domainId);
    assertRevision(doc.revision);
    assertRevision(doc.layoutRevision);
    assertUid(doc.createdBy, 'createdBy');
    const createdAt = canonicalDate(doc.createdAt, 'created_at');
    if (doc.auditRef !== examSeatPlanAuditRef(doc.eventId, doc.revision)) throw new ExamSeatPlanError('seat_plan_audit_ref_invalid');
    assertFingerprint(doc.fingerprint, 'seat_plan_fingerprint');
    assertFingerprint(doc.layoutFingerprint, 'layout_fingerprint');
    let roster: ExamSeatPlanRosterRef | null = null;
    if (doc.roster !== null) {
        const ref = exactObject(doc.roster, ['fingerprint', 'revision', 'rosterId'], 'seat_plan_roster_invalid');
        assertObjectId(ref.rosterId, 'rosterId');
        assertRevision(ref.revision);
        assertFingerprint(ref.fingerprint, 'roster_fingerprint');
        roster = { rosterId: new ObjectId(ref.rosterId), revision: ref.revision, fingerprint: ref.fingerprint };
    }
    if (!Array.isArray(doc.candidateSeatIds) || doc.candidateSeatIds.length > 500) throw new ExamSeatPlanError('candidate_seats_invalid');
    const candidateSeatIds = doc.candidateSeatIds.map((seatId) => canonicalText(seatId, 'candidate_seat_id', 128));
    if (
        new Set(candidateSeatIds).size !== candidateSeatIds.length ||
        [...candidateSeatIds].sort().some((item, index) => item !== candidateSeatIds[index])
    ) {
        throw new ExamSeatPlanError('candidate_seats_invalid');
    }
    if (!Array.isArray(doc.diagnostics) || doc.diagnostics.length > 1) throw new ExamSeatPlanError('seat_plan_diagnostics_invalid');
    const diagnostics = doc.diagnostics.map((item) => {
        const diagnostic = exactObject(item, ['availableSeatCount', 'code', 'requiredSeatCount'], 'seat_plan_diagnostic_invalid');
        if (
            diagnostic.code !== 'insufficient_seats' ||
            !Number.isSafeInteger(diagnostic.requiredSeatCount) ||
            !Number.isSafeInteger(diagnostic.availableSeatCount) ||
            Number(diagnostic.requiredSeatCount) <= Number(diagnostic.availableSeatCount) ||
            Number(diagnostic.availableSeatCount) !== candidateSeatIds.length
        ) {
            throw new ExamSeatPlanError('seat_plan_diagnostic_invalid');
        }
        return {
            code: 'insufficient_seats' as const,
            requiredSeatCount: Number(diagnostic.requiredSeatCount),
            availableSeatCount: Number(diagnostic.availableSeatCount),
        };
    });
    if (diagnostics.length && !roster) throw new ExamSeatPlanError('seat_plan_diagnostic_invalid');
    const expectedFingerprint = planDocumentFingerprint({
        _id: doc._id,
        domainId: doc.domainId,
        eventId: doc.eventId,
        eventRevision: doc.eventRevision,
        schoolId: doc.schoolId,
        revision: doc.revision,
        roster,
        classroomId: doc.classroomId,
        layoutRevision: doc.layoutRevision,
        layoutFingerprint: doc.layoutFingerprint,
        candidateSeatIds,
        diagnostics,
        auditRef: doc.auditRef,
        createdAt,
        createdBy: doc.createdBy,
    });
    if (doc.fingerprint !== expectedFingerprint) throw new ExamSeatPlanError('seat_plan_fingerprint_mismatch');
}

export const examRosterRevisionColl = db.collection<ExamRosterRevisionDoc>('exam.rosterRevisions');
export const examSeatPlanColl = db.collection<ExamSeatPlanDoc>('exam.seatPlans');
export const examSeatPlanService = new ExamSeatPlanService(examRosterRevisionColl, examSeatPlanColl);

export async function apply(ctx: any): Promise<void> {
    await examSeatPlanService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [
            () => examRosterRevisionColl.deleteMany({ domainId }),
            () => examSeatPlanColl.deleteMany({ domainId }),
        ]);
    });
}

global.Hydro.model.examSeatPlan = { examRosterRevisionColl, examSeatPlanColl, examSeatPlanService };
