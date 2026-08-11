import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import { assertExamRosterRevisionIntegrity, assertExamSeatPlanIntegrity, ExamRosterRevisionDoc, ExamSeatPlanDoc } from './exam-seat-plan';

export const EXAM_SEAT_ASSIGNMENT_ALGORITHM = 'hmac-sha256-fisher-yates-v1' as const;

export type ExamSeatAssignmentMode = 'random' | 'studentId';

export interface ExamAssignmentSeatFact {
    sourceSeatId: string;
    status: string;
    bindingId: ObjectId | null;
    bindingRevision: number | null;
    endpointId: string | null;
}

export interface ExamSeatAssignmentMapping {
    boundUserId: number;
    sourceSeatId: string;
}

export type ExamSeatAssignmentDiagnostic =
    | { code: 'seat_disabled' | 'seat_status_invalid' | 'seat_unbound'; sourceSeatIds: string[] }
    | { code: 'insufficient_seats'; requiredSeatCount: number; availableSeatCount: number }
    | { code: 'constraint_conflict'; reasons: string[] };

export interface ExamSeatAssignmentConstraints {
    mode: ExamSeatAssignmentMode;
    lockedAssignments: ExamSeatAssignmentMapping[];
    manualAssignments: ExamSeatAssignmentMapping[];
}

export interface ExamSeatAssignmentRevisionDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    schoolId: ObjectId;
    revision: number;
    auditRef: string;
    seatPlan: { seatPlanId: ObjectId; revision: number; fingerprint: string };
    roster: { rosterId: ObjectId; revision: number; fingerprint: string };
    classroomId: ObjectId;
    layoutRevision: number;
    layoutFingerprint: string;
    candidateSeatIds: string[];
    eligibleSeatIds: string[];
    constraints: ExamSeatAssignmentConstraints;
    seed: string;
    algorithmVersion: typeof EXAM_SEAT_ASSIGNMENT_ALGORITHM;
    assignments: ExamSeatAssignmentMapping[];
    diagnostics: ExamSeatAssignmentDiagnostic[];
    previousRevision: number | null;
    fingerprint: string;
    createdAt: Date;
    createdBy: number;
}

export interface ExamSeatAssignmentPublicationDoc {
    _id: ObjectId;
    domainId: string;
    eventId: ObjectId;
    revision: number;
    assignment: { assignmentId: ObjectId; revision: number; fingerprint: string };
    auditRef: string;
    fingerprint: string;
    updatedAt: Date;
    updatedBy: number;
}

export type ExamSeatAssignmentBuildResult =
    | { ok: false; diagnostics: ExamSeatAssignmentDiagnostic[] }
    | {
          ok: true;
          assignments: ExamSeatAssignmentMapping[];
          constraints: ExamSeatAssignmentConstraints;
          diagnostics: ExamSeatAssignmentDiagnostic[];
          eligibleSeatIds: string[];
      };

type AssignmentCollection<T extends { _id: ObjectId }> = Pick<
    Collection<T>,
    'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'insertOne' | 'replaceOne'
>;

export class ExamSeatAssignmentError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamSeatAssignmentError';
    }
}

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function exactObject(value: unknown, keys: string[], reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamSeatAssignmentError(reason);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
        throw new ExamSeatAssignmentError(reason);
    }
    return record;
}

function assertDomainId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value || value.length > 64) throw new TypeError('domainId is invalid');
}

function assertObjectId(value: unknown, field: string): asserts value is ObjectId {
    if (!(value instanceof ObjectId)) throw new TypeError(`${field} must be an ObjectId`);
}

function assertRevision(value: unknown, field = 'revision'): asserts value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} is invalid`);
}

function assertUid(value: unknown, field = 'uid'): asserts value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 1) throw new TypeError(`${field} is invalid`);
}

function assertFingerprint(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new ExamSeatAssignmentError(`${field}_invalid`);
}

function canonicalText(value: unknown, field: string, maximum = 128): string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum) {
        throw new ExamSeatAssignmentError(`${field}_invalid`);
    }
    return value;
}

function canonicalCompare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalDate(value: unknown, field: string): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ExamSeatAssignmentError(`${field}_invalid`);
    return new Date(value);
}

function canonicalMapping(value: unknown): ExamSeatAssignmentMapping {
    const row = exactObject(value, ['boundUserId', 'sourceSeatId'], 'assignment_mapping_invalid');
    assertUid(row.boundUserId, 'boundUserId');
    return { boundUserId: row.boundUserId, sourceSeatId: canonicalText(row.sourceSeatId, 'source_seat_id') };
}

function canonicalMappings(value: unknown, field: string, maximum = 500): ExamSeatAssignmentMapping[] {
    if (!Array.isArray(value) || value.length > maximum) throw new ExamSeatAssignmentError(`${field}_invalid`);
    return value.map(canonicalMapping).sort((left, right) => left.boundUserId - right.boundUserId);
}

function mappingConflictReasons(rows: ExamSeatAssignmentMapping[]): string[] {
    const reasons: string[] = [];
    if (new Set(rows.map((row) => row.boundUserId)).size !== rows.length) reasons.push('duplicate_uid');
    if (new Set(rows.map((row) => row.sourceSeatId)).size !== rows.length) reasons.push('duplicate_seat');
    return reasons;
}

function canonicalSeatFacts(values: ExamAssignmentSeatFact[], candidateSeatIds: string[]): ExamAssignmentSeatFact[] {
    if (!Array.isArray(values) || values.length !== candidateSeatIds.length) throw new ExamSeatAssignmentError('seat_facts_mismatch');
    const rows = values.map((value) => {
        const row = exactObject(value, ['bindingId', 'bindingRevision', 'endpointId', 'sourceSeatId', 'status'], 'seat_fact_invalid');
        const sourceSeatId = canonicalText(row.sourceSeatId, 'source_seat_id');
        const status = canonicalText(row.status, 'seat_status', 64);
        const nullBinding = row.bindingId === null && row.bindingRevision === null && row.endpointId === null;
        const completeBinding = row.bindingId instanceof ObjectId && row.endpointId !== null && row.bindingRevision !== null;
        if (!nullBinding && !completeBinding) throw new ExamSeatAssignmentError('seat_binding_fact_invalid');
        if (completeBinding) {
            assertRevision(row.bindingRevision, 'bindingRevision');
            canonicalText(row.endpointId, 'endpoint_id', 128);
        }
        return {
            sourceSeatId,
            status,
            bindingId: row.bindingId === null ? null : new ObjectId(row.bindingId as ObjectId),
            bindingRevision: row.bindingRevision as number | null,
            endpointId: row.endpointId as string | null,
        };
    });
    rows.sort((left, right) => canonicalCompare(left.sourceSeatId, right.sourceSeatId));
    if (
        new Set(rows.map((row) => row.sourceSeatId)).size !== rows.length ||
        rows.some((row, index) => row.sourceSeatId !== candidateSeatIds[index])
    ) {
        throw new ExamSeatAssignmentError('seat_facts_mismatch');
    }
    return rows;
}

function randomBelow(seed: string, stream: string, counter: { value: number }, limit: number): number {
    if (limit < 1 || !Number.isSafeInteger(limit)) throw new TypeError('shuffle limit is invalid');
    const ceiling = 0x1_0000_0000 - (0x1_0000_0000 % limit);
    while (true) {
        const digest = createHmac('sha256', Buffer.from(seed, 'hex')).update(`${stream}:${counter.value++}`).digest();
        const value = digest.readUInt32BE(0);
        if (value < ceiling) return value % limit;
    }
}

function shuffle<T>(values: T[], seed: string, stream: string): T[] {
    const result = [...values];
    const counter = { value: 0 };
    for (let index = result.length - 1; index > 0; index--) {
        const other = randomBelow(seed, stream, counter, index + 1);
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}

function canonicalSeed(seed: unknown): string {
    if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/.test(seed)) throw new ExamSeatAssignmentError('assignment_seed_invalid');
    return seed;
}

export function buildExamSeatAssignment(input: {
    roster: ExamRosterRevisionDoc;
    seatPlan: ExamSeatPlanDoc;
    seatFacts: ExamAssignmentSeatFact[];
    mode: ExamSeatAssignmentMode;
    seed: string;
    lockedAssignments: ExamSeatAssignmentMapping[];
    manualAssignments: ExamSeatAssignmentMapping[];
}): ExamSeatAssignmentBuildResult {
    assertExamRosterRevisionIntegrity(input.roster);
    assertExamSeatPlanIntegrity(input.seatPlan);
    if (
        !input.seatPlan.roster ||
        !input.seatPlan.roster.rosterId.equals(input.roster._id) ||
        input.seatPlan.roster.revision !== input.roster.revision ||
        input.seatPlan.roster.fingerprint !== input.roster.fingerprint
    ) {
        throw new ExamSeatAssignmentError('assignment_roster_plan_mismatch');
    }
    if (input.mode !== 'random' && input.mode !== 'studentId') throw new ExamSeatAssignmentError('assignment_mode_invalid');
    const seed = canonicalSeed(input.seed);
    const seatFacts = canonicalSeatFacts(input.seatFacts, input.seatPlan.candidateSeatIds);
    const lockedAssignments = canonicalMappings(input.lockedAssignments, 'locked_assignments');
    const manualAssignments = canonicalMappings(input.manualAssignments, 'manual_assignments');
    const diagnostics: ExamSeatAssignmentDiagnostic[] = [];
    const disabled = seatFacts.filter((seat) => seat.status === 'disabled').map((seat) => seat.sourceSeatId);
    const invalidStatus = seatFacts.filter((seat) => !['active', 'disabled', 'empty'].includes(seat.status)).map((seat) => seat.sourceSeatId);
    const unbound = seatFacts.filter((seat) => seat.status !== 'disabled' && seat.bindingId === null).map((seat) => seat.sourceSeatId);
    if (disabled.length) diagnostics.push({ code: 'seat_disabled', sourceSeatIds: disabled });
    if (invalidStatus.length) diagnostics.push({ code: 'seat_status_invalid', sourceSeatIds: invalidStatus });
    if (unbound.length) diagnostics.push({ code: 'seat_unbound', sourceSeatIds: unbound });
    const eligibleSeatIds = seatFacts
        .filter((seat) => ['active', 'empty'].includes(seat.status) && seat.bindingId !== null)
        .map((seat) => seat.sourceSeatId);
    if (input.roster.entries.length > eligibleSeatIds.length) {
        diagnostics.push({
            code: 'insufficient_seats',
            requiredSeatCount: input.roster.entries.length,
            availableSeatCount: eligibleSeatIds.length,
        });
    }
    const rosterUids = new Set(input.roster.entries.map((entry) => entry.boundUserId));
    const eligibleSeats = new Set(eligibleSeatIds);
    const constraintReasons = [...mappingConflictReasons(lockedAssignments), ...mappingConflictReasons(manualAssignments)];
    if (lockedAssignments.some((row) => !rosterUids.has(row.boundUserId))) constraintReasons.push('locked_uid_missing');
    if (lockedAssignments.some((row) => !eligibleSeats.has(row.sourceSeatId))) constraintReasons.push('locked_seat_unavailable');
    if (manualAssignments.length) {
        if (manualAssignments.length !== input.roster.entries.length) constraintReasons.push('manual_mapping_incomplete');
        if (manualAssignments.some((row) => !rosterUids.has(row.boundUserId))) constraintReasons.push('manual_uid_missing');
        if (manualAssignments.some((row) => !eligibleSeats.has(row.sourceSeatId))) constraintReasons.push('manual_seat_unavailable');
        const manualByUid = new Map(manualAssignments.map((row) => [row.boundUserId, row.sourceSeatId]));
        if (lockedAssignments.some((row) => manualByUid.get(row.boundUserId) !== row.sourceSeatId)) {
            constraintReasons.push('locked_manual_mismatch');
        }
    }
    const uniqueReasons = [...new Set(constraintReasons)].sort();
    if (uniqueReasons.length) diagnostics.push({ code: 'constraint_conflict', reasons: uniqueReasons });
    if (invalidStatus.length || input.roster.entries.length > eligibleSeatIds.length || uniqueReasons.length) return { ok: false, diagnostics };

    let assignments: ExamSeatAssignmentMapping[];
    if (manualAssignments.length) assignments = manualAssignments;
    else {
        const lockedUids = new Set(lockedAssignments.map((row) => row.boundUserId));
        const lockedSeats = new Set(lockedAssignments.map((row) => row.sourceSeatId));
        let students = input.roster.entries.filter((entry) => !lockedUids.has(entry.boundUserId));
        let seats = eligibleSeatIds.filter((seatId) => !lockedSeats.has(seatId));
        if (input.mode === 'random') {
            students = shuffle(
                [...students].sort((left, right) => left.boundUserId - right.boundUserId),
                seed,
                'students',
            );
            seats = shuffle([...seats].sort(canonicalCompare), seed, 'seats');
        } else {
            students = [...students].sort((left, right) => canonicalCompare(left.studentId, right.studentId) || left.boundUserId - right.boundUserId);
            seats = [...seats].sort(canonicalCompare);
        }
        assignments = [
            ...lockedAssignments,
            ...students.map((entry, index) => ({ boundUserId: entry.boundUserId, sourceSeatId: seats[index] })),
        ].sort((left, right) => left.boundUserId - right.boundUserId);
    }
    if (assignments.length !== input.roster.entries.length || mappingConflictReasons(assignments).length) {
        return { ok: false, diagnostics: [...diagnostics, { code: 'constraint_conflict', reasons: ['result_not_bijective'] }] };
    }
    return {
        ok: true,
        assignments,
        constraints: { mode: input.mode, lockedAssignments, manualAssignments },
        diagnostics,
        eligibleSeatIds,
    };
}

export function examSeatAssignmentAuditRef(eventId: ObjectId, revision: number): string {
    return `exam-seat-assignment:${eventId.toHexString()}:${revision}`;
}

export function examSeatAssignmentPublicationAuditRef(eventId: ObjectId, revision: number): string {
    return `exam-seat-assignment-publication:${eventId.toHexString()}:${revision}`;
}

function mappingFingerprintFact(row: ExamSeatAssignmentMapping) {
    return { boundUserId: row.boundUserId, sourceSeatId: row.sourceSeatId };
}

function diagnosticFingerprintFact(diagnostic: ExamSeatAssignmentDiagnostic) {
    return { ...diagnostic };
}

function assignmentDocumentFingerprint(doc: Omit<ExamSeatAssignmentRevisionDoc, 'fingerprint'>): string {
    return sha256({
        _id: doc._id.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        eventRevision: doc.eventRevision,
        schoolId: doc.schoolId.toHexString(),
        revision: doc.revision,
        auditRef: doc.auditRef,
        seatPlan: { seatPlanId: doc.seatPlan.seatPlanId.toHexString(), revision: doc.seatPlan.revision, fingerprint: doc.seatPlan.fingerprint },
        roster: { rosterId: doc.roster.rosterId.toHexString(), revision: doc.roster.revision, fingerprint: doc.roster.fingerprint },
        classroomId: doc.classroomId.toHexString(),
        layoutRevision: doc.layoutRevision,
        layoutFingerprint: doc.layoutFingerprint,
        candidateSeatIds: doc.candidateSeatIds,
        eligibleSeatIds: doc.eligibleSeatIds,
        constraints: {
            mode: doc.constraints.mode,
            lockedAssignments: doc.constraints.lockedAssignments.map(mappingFingerprintFact),
            manualAssignments: doc.constraints.manualAssignments.map(mappingFingerprintFact),
        },
        seed: doc.seed,
        algorithmVersion: doc.algorithmVersion,
        assignments: doc.assignments.map(mappingFingerprintFact),
        diagnostics: doc.diagnostics.map(diagnosticFingerprintFact),
        previousRevision: doc.previousRevision,
        createdAt: doc.createdAt.toISOString(),
        createdBy: doc.createdBy,
    });
}

function publicationDocumentFingerprint(doc: Omit<ExamSeatAssignmentPublicationDoc, 'fingerprint'>): string {
    return sha256({
        _id: doc._id.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        revision: doc.revision,
        assignment: {
            assignmentId: doc.assignment.assignmentId.toHexString(),
            revision: doc.assignment.revision,
            fingerprint: doc.assignment.fingerprint,
        },
        auditRef: doc.auditRef,
        updatedAt: doc.updatedAt.toISOString(),
        updatedBy: doc.updatedBy,
    });
}

function canonicalDiagnostic(value: unknown): ExamSeatAssignmentDiagnostic {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
    const code = (value as Record<string, unknown>).code;
    if (code === 'insufficient_seats') {
        const row = exactObject(value, ['availableSeatCount', 'code', 'requiredSeatCount'], 'assignment_diagnostic_invalid');
        if (
            !Number.isSafeInteger(row.requiredSeatCount) ||
            !Number.isSafeInteger(row.availableSeatCount) ||
            Number(row.requiredSeatCount) <= Number(row.availableSeatCount)
        ) {
            throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
        }
        return { code, requiredSeatCount: Number(row.requiredSeatCount), availableSeatCount: Number(row.availableSeatCount) };
    }
    if (code === 'constraint_conflict') {
        const row = exactObject(value, ['code', 'reasons'], 'assignment_diagnostic_invalid');
        if (!Array.isArray(row.reasons) || row.reasons.some((reason) => typeof reason !== 'string' || !reason)) {
            throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
        }
        const reasons = [...(row.reasons as string[])].sort();
        if (new Set(reasons).size !== reasons.length || reasons.some((reason, index) => reason !== row.reasons[index])) {
            throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
        }
        return { code, reasons };
    }
    if (code === 'seat_disabled' || code === 'seat_status_invalid' || code === 'seat_unbound') {
        const row = exactObject(value, ['code', 'sourceSeatIds'], 'assignment_diagnostic_invalid');
        if (!Array.isArray(row.sourceSeatIds)) throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
        const sourceSeatIds = (row.sourceSeatIds as unknown[]).map((seatId) => canonicalText(seatId, 'source_seat_id')).sort();
        if (!sourceSeatIds.length || new Set(sourceSeatIds).size !== sourceSeatIds.length) {
            throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
        }
        return { code, sourceSeatIds };
    }
    throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
}

export function assertExamSeatAssignmentIntegrity(value: unknown): asserts value is ExamSeatAssignmentRevisionDoc {
    const doc = exactObject(
        value,
        [
            '_id',
            'algorithmVersion',
            'assignments',
            'auditRef',
            'candidateSeatIds',
            'classroomId',
            'constraints',
            'createdAt',
            'createdBy',
            'diagnostics',
            'domainId',
            'eligibleSeatIds',
            'eventId',
            'eventRevision',
            'fingerprint',
            'layoutFingerprint',
            'layoutRevision',
            'previousRevision',
            'revision',
            'roster',
            'schoolId',
            'seatPlan',
            'seed',
        ],
        'assignment_document_invalid',
    );
    assertObjectId(doc._id, 'assignmentId');
    assertDomainId(doc.domainId);
    assertObjectId(doc.eventId, 'eventId');
    assertRevision(doc.eventRevision, 'eventRevision');
    assertObjectId(doc.schoolId, 'schoolId');
    assertRevision(doc.revision);
    assertObjectId(doc.classroomId, 'classroomId');
    assertRevision(doc.layoutRevision, 'layoutRevision');
    assertFingerprint(doc.layoutFingerprint, 'layout_fingerprint');
    assertFingerprint(doc.fingerprint, 'assignment_fingerprint');
    assertUid(doc.createdBy, 'createdBy');
    const createdAt = canonicalDate(doc.createdAt, 'created_at');
    if (doc.auditRef !== examSeatAssignmentAuditRef(doc.eventId, doc.revision)) throw new ExamSeatAssignmentError('assignment_audit_ref_invalid');
    if (doc.algorithmVersion !== EXAM_SEAT_ASSIGNMENT_ALGORITHM) throw new ExamSeatAssignmentError('assignment_algorithm_invalid');
    const seed = canonicalSeed(doc.seed);
    const seatPlan = exactObject(doc.seatPlan, ['fingerprint', 'revision', 'seatPlanId'], 'assignment_seat_plan_invalid');
    assertObjectId(seatPlan.seatPlanId, 'seatPlanId');
    assertRevision(seatPlan.revision, 'seatPlanRevision');
    assertFingerprint(seatPlan.fingerprint, 'seat_plan_fingerprint');
    const roster = exactObject(doc.roster, ['fingerprint', 'revision', 'rosterId'], 'assignment_roster_invalid');
    assertObjectId(roster.rosterId, 'rosterId');
    assertRevision(roster.revision, 'rosterRevision');
    assertFingerprint(roster.fingerprint, 'roster_fingerprint');
    if (!Array.isArray(doc.candidateSeatIds) || !Array.isArray(doc.eligibleSeatIds)) {
        throw new ExamSeatAssignmentError('assignment_seats_invalid');
    }
    const candidateSeatIds = doc.candidateSeatIds.map((seatId) => canonicalText(seatId, 'candidate_seat_id'));
    const eligibleSeatIds = doc.eligibleSeatIds.map((seatId) => canonicalText(seatId, 'eligible_seat_id'));
    for (const seats of [candidateSeatIds, eligibleSeatIds]) {
        if (new Set(seats).size !== seats.length || [...seats].sort().some((seatId, index) => seatId !== seats[index])) {
            throw new ExamSeatAssignmentError('assignment_seats_invalid');
        }
    }
    if (eligibleSeatIds.some((seatId) => !candidateSeatIds.includes(seatId))) throw new ExamSeatAssignmentError('assignment_seats_invalid');
    const constraints = exactObject(doc.constraints, ['lockedAssignments', 'manualAssignments', 'mode'], 'assignment_constraints_invalid');
    if (constraints.mode !== 'random' && constraints.mode !== 'studentId') throw new ExamSeatAssignmentError('assignment_mode_invalid');
    const lockedAssignments = canonicalMappings(constraints.lockedAssignments, 'locked_assignments');
    const manualAssignments = canonicalMappings(constraints.manualAssignments, 'manual_assignments');
    const assignments = canonicalMappings(doc.assignments, 'assignments');
    for (const [stored, canonicalRows] of [
        [constraints.lockedAssignments, lockedAssignments],
        [constraints.manualAssignments, manualAssignments],
        [doc.assignments, assignments],
    ] as const) {
        if (
            !Array.isArray(stored) ||
            stored.length !== canonicalRows.length ||
            canonicalRows.some((row, index) => !sameMapping(row, stored[index] as ExamSeatAssignmentMapping | undefined))
        ) {
            throw new ExamSeatAssignmentError('assignment_mapping_invalid');
        }
    }
    if (
        mappingConflictReasons(lockedAssignments).length ||
        mappingConflictReasons(manualAssignments).length ||
        mappingConflictReasons(assignments).length ||
        assignments.some((row) => !eligibleSeatIds.includes(row.sourceSeatId)) ||
        lockedAssignments.some(
            (row) => !assignments.some((assigned) => assigned.boundUserId === row.boundUserId && assigned.sourceSeatId === row.sourceSeatId),
        ) ||
        (manualAssignments.length && !manualAssignments.every((row, index) => sameMapping(row, assignments[index])))
    ) {
        throw new ExamSeatAssignmentError('assignment_mapping_invalid');
    }
    if (!Array.isArray(doc.diagnostics)) throw new ExamSeatAssignmentError('assignment_diagnostics_invalid');
    const diagnostics = doc.diagnostics.map(canonicalDiagnostic);
    if (JSON.stringify(diagnostics) !== JSON.stringify(doc.diagnostics)) {
        throw new ExamSeatAssignmentError('assignment_diagnostics_invalid');
    }
    if (diagnostics.some((diagnostic) => diagnostic.code === 'constraint_conflict' || diagnostic.code === 'insufficient_seats')) {
        throw new ExamSeatAssignmentError('assignment_blocking_diagnostic_invalid');
    }
    if (doc.previousRevision !== null && doc.previousRevision !== doc.revision - 1) {
        throw new ExamSeatAssignmentError('assignment_previous_revision_invalid');
    }
    if ((doc.revision === 1) !== (doc.previousRevision === null)) throw new ExamSeatAssignmentError('assignment_previous_revision_invalid');
    const canonical: Omit<ExamSeatAssignmentRevisionDoc, 'fingerprint'> = {
        _id: new ObjectId(doc._id),
        domainId: doc.domainId,
        eventId: new ObjectId(doc.eventId),
        eventRevision: doc.eventRevision,
        schoolId: new ObjectId(doc.schoolId),
        revision: doc.revision,
        auditRef: doc.auditRef,
        seatPlan: { seatPlanId: new ObjectId(seatPlan.seatPlanId), revision: seatPlan.revision, fingerprint: seatPlan.fingerprint },
        roster: { rosterId: new ObjectId(roster.rosterId), revision: roster.revision, fingerprint: roster.fingerprint },
        classroomId: new ObjectId(doc.classroomId),
        layoutRevision: doc.layoutRevision,
        layoutFingerprint: doc.layoutFingerprint,
        candidateSeatIds,
        eligibleSeatIds,
        constraints: { mode: constraints.mode, lockedAssignments, manualAssignments },
        seed,
        algorithmVersion: EXAM_SEAT_ASSIGNMENT_ALGORITHM,
        assignments,
        diagnostics,
        previousRevision: doc.previousRevision as number | null,
        createdAt,
        createdBy: doc.createdBy,
    };
    if (doc.fingerprint !== assignmentDocumentFingerprint(canonical)) throw new ExamSeatAssignmentError('assignment_fingerprint_mismatch');
}

function sameMapping(left: ExamSeatAssignmentMapping, right: ExamSeatAssignmentMapping | undefined): boolean {
    return !!right && left.boundUserId === right.boundUserId && left.sourceSeatId === right.sourceSeatId;
}

export function assertExamSeatAssignmentPublicationIntegrity(value: unknown): asserts value is ExamSeatAssignmentPublicationDoc {
    const doc = exactObject(
        value,
        ['_id', 'assignment', 'auditRef', 'domainId', 'eventId', 'fingerprint', 'revision', 'updatedAt', 'updatedBy'],
        'assignment_publication_invalid',
    );
    assertObjectId(doc._id, 'publicationId');
    assertDomainId(doc.domainId);
    assertObjectId(doc.eventId, 'eventId');
    assertRevision(doc.revision);
    assertUid(doc.updatedBy, 'updatedBy');
    const updatedAt = canonicalDate(doc.updatedAt, 'updated_at');
    const assignment = exactObject(doc.assignment, ['assignmentId', 'fingerprint', 'revision'], 'assignment_publication_invalid');
    assertObjectId(assignment.assignmentId, 'assignmentId');
    assertRevision(assignment.revision, 'assignmentRevision');
    assertFingerprint(assignment.fingerprint, 'assignment_fingerprint');
    assertFingerprint(doc.fingerprint, 'publication_fingerprint');
    if (doc.auditRef !== examSeatAssignmentPublicationAuditRef(doc.eventId, doc.revision)) {
        throw new ExamSeatAssignmentError('assignment_publication_audit_ref_invalid');
    }
    const canonical: Omit<ExamSeatAssignmentPublicationDoc, 'fingerprint'> = {
        _id: new ObjectId(doc._id),
        domainId: doc.domainId,
        eventId: new ObjectId(doc.eventId),
        revision: doc.revision,
        assignment: { assignmentId: new ObjectId(assignment.assignmentId), revision: assignment.revision, fingerprint: assignment.fingerprint },
        auditRef: doc.auditRef,
        updatedAt,
        updatedBy: doc.updatedBy,
    };
    if (doc.fingerprint !== publicationDocumentFingerprint(canonical)) {
        throw new ExamSeatAssignmentError('assignment_publication_fingerprint_mismatch');
    }
}

function duplicateKey(error: unknown): boolean {
    return (error as { code?: unknown })?.code === 11000;
}

export class ExamSeatAssignmentService {
    constructor(
        private readonly assignments: AssignmentCollection<ExamSeatAssignmentRevisionDoc>,
        private readonly publications: AssignmentCollection<ExamSeatAssignmentPublicationDoc>,
        private readonly now: () => Date = () => new Date(),
        private readonly idFactory: () => ObjectId = () => new ObjectId(),
        private readonly seedFactory: () => string = () => randomBytes(32).toString('hex'),
    ) {}

    async ensureIndexes(): Promise<void> {
        await Promise.all([
            this.assignments.createIndex({ domainId: 1, eventId: 1, revision: 1 }, { name: 'examSeatAssignmentRevision', unique: true }),
            this.assignments.createIndex({ domainId: 1, classroomId: 1, layoutRevision: 1 }, { name: 'examSeatAssignmentClassroom' }),
            this.publications.createIndex({ domainId: 1, eventId: 1 }, { name: 'examSeatAssignmentPublicationEvent', unique: true }),
        ]);
    }

    newSeed(): string {
        return canonicalSeed(this.seedFactory());
    }

    async createRevision(input: {
        domainId: string;
        eventId: ObjectId;
        eventRevision: number;
        schoolId: ObjectId;
        actorUid: number;
        expectedPreviousRevision: number;
        roster: ExamRosterRevisionDoc;
        seatPlan: ExamSeatPlanDoc;
        seatFacts: ExamAssignmentSeatFact[];
        mode: ExamSeatAssignmentMode;
        seed: string;
        lockedAssignments: ExamSeatAssignmentMapping[];
        manualAssignments: ExamSeatAssignmentMapping[];
    }): Promise<{ assignment: ExamSeatAssignmentRevisionDoc | null; diagnostics: ExamSeatAssignmentDiagnostic[] }> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertRevision(input.eventRevision, 'eventRevision');
        assertObjectId(input.schoolId, 'schoolId');
        assertUid(input.actorUid, 'actorUid');
        if (!Number.isSafeInteger(input.expectedPreviousRevision) || input.expectedPreviousRevision < 0) {
            throw new TypeError('expectedPreviousRevision is invalid');
        }
        assertExamRosterRevisionIntegrity(input.roster);
        assertExamSeatPlanIntegrity(input.seatPlan);
        if (
            input.roster.domainId !== input.domainId ||
            input.seatPlan.domainId !== input.domainId ||
            !input.roster.eventId.equals(input.eventId) ||
            !input.seatPlan.eventId.equals(input.eventId) ||
            !input.roster.schoolId.equals(input.schoolId) ||
            !input.seatPlan.schoolId.equals(input.schoolId)
        ) {
            throw new ExamSeatAssignmentError('assignment_identity_mismatch');
        }
        const built = buildExamSeatAssignment(input);
        if (!built.ok) return { assignment: null, diagnostics: built.diagnostics };
        const previous = await this.latestRevision(input.domainId, input.eventId);
        if (previous) assertExamSeatAssignmentIntegrity(previous);
        if ((previous?.revision || 0) !== input.expectedPreviousRevision) {
            throw new ExamSeatAssignmentError('assignment_revision_conflict');
        }
        if (previous && (!previous.schoolId.equals(input.schoolId) || previous.eventRevision > input.eventRevision)) {
            throw new ExamSeatAssignmentError('assignment_history_identity_mismatch');
        }
        const createdAt = canonicalDate(this.now(), 'now');
        const earliestCreatedAt = Math.max(input.roster.createdAt.getTime(), input.seatPlan.createdAt.getTime(), previous?.createdAt.getTime() || 0);
        if (createdAt.getTime() < earliestCreatedAt) throw new ExamSeatAssignmentError('assignment_clock_rollback');
        const revision = (previous?.revision || 0) + 1;
        const canonical: Omit<ExamSeatAssignmentRevisionDoc, 'fingerprint'> = {
            _id: this.idFactory(),
            domainId: input.domainId,
            eventId: new ObjectId(input.eventId),
            eventRevision: input.eventRevision,
            schoolId: new ObjectId(input.schoolId),
            revision,
            auditRef: examSeatAssignmentAuditRef(input.eventId, revision),
            seatPlan: { seatPlanId: new ObjectId(input.seatPlan._id), revision: input.seatPlan.revision, fingerprint: input.seatPlan.fingerprint },
            roster: { rosterId: new ObjectId(input.roster._id), revision: input.roster.revision, fingerprint: input.roster.fingerprint },
            classroomId: new ObjectId(input.seatPlan.classroomId),
            layoutRevision: input.seatPlan.layoutRevision,
            layoutFingerprint: input.seatPlan.layoutFingerprint,
            candidateSeatIds: [...input.seatPlan.candidateSeatIds],
            eligibleSeatIds: built.eligibleSeatIds,
            constraints: built.constraints,
            seed: canonicalSeed(input.seed),
            algorithmVersion: EXAM_SEAT_ASSIGNMENT_ALGORITHM,
            assignments: built.assignments,
            diagnostics: built.diagnostics,
            previousRevision: previous?.revision || null,
            createdAt,
            createdBy: input.actorUid,
        };
        const assignment: ExamSeatAssignmentRevisionDoc = { ...canonical, fingerprint: assignmentDocumentFingerprint(canonical) };
        assertExamSeatAssignmentIntegrity(assignment);
        try {
            await this.assignments.insertOne(assignment);
        } catch (error) {
            if (duplicateKey(error)) throw new ExamSeatAssignmentError('assignment_revision_conflict');
            throw error;
        }
        return { assignment, diagnostics: built.diagnostics };
    }

    async publishRevision(input: {
        domainId: string;
        eventId: ObjectId;
        assignmentRevision: number;
        expectedPublicationRevision: number;
        actorUid: number;
    }): Promise<ExamSeatAssignmentPublicationDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertRevision(input.assignmentRevision, 'assignmentRevision');
        if (!Number.isSafeInteger(input.expectedPublicationRevision) || input.expectedPublicationRevision < 0) {
            throw new TypeError('expectedPublicationRevision is invalid');
        }
        assertUid(input.actorUid, 'actorUid');
        const assignment = await this.getRevision(input.domainId, input.eventId, input.assignmentRevision);
        if (!assignment) throw new ExamSeatAssignmentError('assignment_not_found');
        const current = await this.getPublication(input.domainId, input.eventId);
        if ((current?.revision || 0) !== input.expectedPublicationRevision) {
            throw new ExamSeatAssignmentError('assignment_publication_conflict');
        }
        const revision = input.expectedPublicationRevision + 1;
        const updatedAt = canonicalDate(this.now(), 'now');
        if (updatedAt.getTime() < Math.max(assignment.createdAt.getTime(), current?.updatedAt.getTime() || 0)) {
            throw new ExamSeatAssignmentError('assignment_clock_rollback');
        }
        const canonical: Omit<ExamSeatAssignmentPublicationDoc, 'fingerprint'> = {
            _id: current ? new ObjectId(current._id) : this.idFactory(),
            domainId: input.domainId,
            eventId: new ObjectId(input.eventId),
            revision,
            assignment: { assignmentId: new ObjectId(assignment._id), revision: assignment.revision, fingerprint: assignment.fingerprint },
            auditRef: examSeatAssignmentPublicationAuditRef(input.eventId, revision),
            updatedAt,
            updatedBy: input.actorUid,
        };
        const target: ExamSeatAssignmentPublicationDoc = { ...canonical, fingerprint: publicationDocumentFingerprint(canonical) };
        assertExamSeatAssignmentPublicationIntegrity(target);
        try {
            if (!current) await this.publications.insertOne(target);
            else {
                const replaced = await this.publications.replaceOne(current, target);
                if (replaced.matchedCount !== 1) throw new ExamSeatAssignmentError('assignment_publication_conflict');
            }
        } catch (error) {
            if (duplicateKey(error)) throw new ExamSeatAssignmentError('assignment_publication_conflict');
            throw error;
        }
        return target;
    }

    async getRevision(domainId: string, eventId: ObjectId, revision: number): Promise<ExamSeatAssignmentRevisionDoc | null> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        assertRevision(revision);
        const doc = await this.assignments.findOne({ domainId, eventId, revision });
        if (doc) assertExamSeatAssignmentIntegrity(doc);
        return doc;
    }

    async latestRevision(domainId: string, eventId: ObjectId): Promise<ExamSeatAssignmentRevisionDoc | null> {
        const docs = await this.assignments.find({ domainId, eventId }).sort({ revision: -1 }).limit(1).toArray();
        const doc = docs[0] || null;
        if (doc) assertExamSeatAssignmentIntegrity(doc);
        return doc;
    }

    listRevisions(domainId: string, eventId: ObjectId) {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        return this.assignments.find({ domainId, eventId }).sort({ revision: -1 }).limit(100);
    }

    async getPublication(domainId: string, eventId: ObjectId): Promise<ExamSeatAssignmentPublicationDoc | null> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        const doc = await this.publications.findOne({ domainId, eventId });
        if (doc) assertExamSeatAssignmentPublicationIntegrity(doc);
        return doc;
    }

    async assertEventSchoolChangeAllowed(domainId: string, eventId: ObjectId): Promise<void> {
        assertDomainId(domainId);
        assertObjectId(eventId, 'eventId');
        if (await this.assignments.findOne({ domainId, eventId })) throw new ExamSeatAssignmentError('event_school_has_assignment_facts');
    }
}

export const examSeatAssignmentColl = db.collection<ExamSeatAssignmentRevisionDoc>('exam.seatAssignments');
export const examSeatAssignmentPublicationColl = db.collection<ExamSeatAssignmentPublicationDoc>('exam.seatAssignmentPublications');
export const examSeatAssignmentService = new ExamSeatAssignmentService(examSeatAssignmentColl, examSeatAssignmentPublicationColl);

export async function apply(ctx: any): Promise<void> {
    await examSeatAssignmentService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [
            () => examSeatAssignmentColl.deleteMany({ domainId }),
            () => examSeatAssignmentPublicationColl.deleteMany({ domainId }),
        ]);
    });
}

global.Hydro.model.examSeatAssignment = {
    examSeatAssignmentColl,
    examSeatAssignmentPublicationColl,
    examSeatAssignmentService,
};
