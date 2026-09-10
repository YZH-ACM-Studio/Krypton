import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Collection, ObjectId } from 'mongodb';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import type { ExamSeatDisabledReason, ExamSeatFacing } from './exam-seat-operational-profile';
import type { EndpointSeatBindingDoc } from './endpoint-seat-binding';
import {
    ExamRosterRevisionDoc,
    ExamSeatPlanClassroomRef,
    ExamSeatPlanV1Doc,
    ExamSeatPlanV2Doc,
    isExamSeatPlanV2,
} from './exam-seat-plan';
import { allocateExamSeatsSpatially } from './exam-seat-spatial-allocation';

export const EXAM_SEAT_ASSIGNMENT_ALGORITHM = 'hmac-sha256-fisher-yates-v1' as const;
export const EXAM_SEAT_ASSIGNMENT_V2_ALGORITHM = 'spatial-best-effort-v1' as const;
const EXAM_SEAT_ASSIGNMENT_V2_READER_MAX_RISK_EDGES = 10_000;

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

export type ExamSeatAssignmentV2Diagnostic =
    | ExamSeatAssignmentDiagnostic
    | {
          code: 'seat_skipped';
          seats: Array<{ seat: ExamSeatIdentity; reason: 'disabled' | 'layout_status' | 'unbound' }>;
      };

export interface ExamSeatAssignmentConstraints {
    mode: ExamSeatAssignmentMode;
    lockedAssignments: ExamSeatAssignmentMapping[];
    manualAssignments: ExamSeatAssignmentMapping[];
}

export interface ExamSeatAssignmentV1Doc {
    _id: ObjectId;
    schemaVersion?: never;
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

export interface ExamSeatIdentity {
    classroomId: ObjectId;
    sourceSeatId: string;
}

export interface ExamSeatAssignmentV2Mapping {
    boundUserId: number;
    seat: ExamSeatIdentity;
}

export type ExamSeatAssignmentStrategy = 'maximizeSpacing' | 'minimizeClassrooms';

export interface ExamSeatAssignmentParticipantFact {
    boundUserId: number;
    studentRecordId: ObjectId;
    studentId: string;
    teamId: string | null;
    teamRole: 'captain' | 'member' | null;
}

export interface ExamSeatAssignmentV2SeatFact extends ExamSeatIdentity {
    label: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    rotation: number;
    layoutStatus: string;
    enabled: boolean;
    facing: ExamSeatFacing;
    disabledReason: ExamSeatDisabledReason | null;
    bindingId: ObjectId | null;
    bindingRevision: number | null;
    endpointId: string | null;
    endpointOnline: boolean | null;
}

export interface ExamSeatAssignmentRiskEdge {
    left: ExamSeatIdentity;
    right: ExamSeatIdentity;
    distance: number;
    reason: 'perpendicular_facing' | 'same_facing' | 'unset_facing';
}

export interface ExamSeatAssignmentV2Explanation {
    classrooms: Array<{ classroomId: ObjectId; assignedCount: number; eligibleSeatCount: number }>;
    highRiskEdges: ExamSeatAssignmentRiskEdge[];
    mediumRiskEdges: ExamSeatAssignmentRiskEdge[];
    splitTeamIds: string[];
    skippedSeats: Array<{ seat: ExamSeatIdentity; reason: 'disabled' | 'layout_status' | 'unbound' }>;
    offlineSeats: ExamSeatIdentity[];
    unsetFacingSeats: ExamSeatIdentity[];
}

export interface ExamSeatAssignmentV2Doc {
    _id: ObjectId;
    schemaVersion: 2;
    domainId: string;
    eventId: ObjectId;
    eventRevision: number;
    schoolId: ObjectId;
    revision: number;
    auditRef: string;
    seatPlan: { seatPlanId: ObjectId; revision: number; fingerprint: string };
    roster: { rosterId: ObjectId; revision: number; fingerprint: string };
    classrooms: ExamSeatPlanClassroomRef[];
    participants: ExamSeatAssignmentParticipantFact[];
    seatFacts: ExamSeatAssignmentV2SeatFact[];
    constraints: {
        strategy: ExamSeatAssignmentStrategy;
        lockedAssignments: ExamSeatAssignmentV2Mapping[];
        manualAssignments: ExamSeatAssignmentV2Mapping[];
    };
    seed: string;
    algorithmVersion: typeof EXAM_SEAT_ASSIGNMENT_V2_ALGORITHM;
    assignments: ExamSeatAssignmentV2Mapping[];
    explanation: ExamSeatAssignmentV2Explanation;
    previousRevision: number | null;
    fingerprint: string;
    createdAt: Date;
    createdBy: number;
}

export function seatPlanMatchesAssignmentRoster(
    seatPlan: Pick<ExamSeatPlanV2Doc, 'roster'>,
    assignment: Pick<ExamSeatAssignmentV2Doc, 'roster'>,
): boolean {
    return Boolean(
        seatPlan.roster &&
        seatPlan.roster.rosterId.equals(assignment.roster.rosterId) &&
        seatPlan.roster.revision === assignment.roster.revision &&
        seatPlan.roster.fingerprint === assignment.roster.fingerprint,
    );
}

export function seatFactMatchesBindingHistory(
    domainId: string,
    schoolId: ObjectId,
    fact: ExamSeatAssignmentV2SeatFact,
    binding: EndpointSeatBindingDoc | null,
): boolean {
    if (fact.bindingId === null) {
        return fact.bindingRevision === null && fact.endpointId === null && binding === null;
    }
    if (
        !binding ||
        !binding._id.equals(fact.bindingId) ||
        binding.domainId !== domainId ||
        !binding.schoolId.equals(schoolId) ||
        !binding.classroomId.equals(fact.classroomId) ||
        binding.sourceSeatId !== fact.sourceSeatId ||
        fact.bindingRevision === null
    ) {
        return false;
    }
    const history = binding.history[fact.bindingRevision - 1];
    return Boolean(
        history &&
        history.revision === fact.bindingRevision &&
        (history.action === 'bind' || history.action === 'replace') &&
        history.endpointId === fact.endpointId,
    );
}

export type ExamSeatAssignmentRevisionDoc = ExamSeatAssignmentV1Doc | ExamSeatAssignmentV2Doc;

export function isExamSeatAssignmentV2(assignment: ExamSeatAssignmentRevisionDoc): assignment is ExamSeatAssignmentV2Doc {
    return assignment.schemaVersion === 2;
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

export type ExamSeatAssignmentV2BuildResult =
    | { ok: false; diagnostics: ExamSeatAssignmentV2Diagnostic[] }
    | {
          ok: true;
          participants: ExamSeatAssignmentParticipantFact[];
          seatFacts: ExamSeatAssignmentV2SeatFact[];
          constraints: ExamSeatAssignmentV2Doc['constraints'];
          assignments: ExamSeatAssignmentV2Mapping[];
          explanation: ExamSeatAssignmentV2Explanation;
          diagnostics: ExamSeatAssignmentV2Diagnostic[];
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
    seatPlan: ExamSeatPlanV1Doc;
    seatFacts: ExamAssignmentSeatFact[];
    mode: ExamSeatAssignmentMode;
    seed: string;
    lockedAssignments: ExamSeatAssignmentMapping[];
    manualAssignments: ExamSeatAssignmentMapping[];
}): ExamSeatAssignmentBuildResult {
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

export type ExamSeatAssignmentWithoutFingerprint = Omit<ExamSeatAssignmentV1Doc, 'fingerprint'> | Omit<ExamSeatAssignmentV2Doc, 'fingerprint'>;

function seatIdentityFingerprintFact(seat: ExamSeatIdentity) {
    return { classroomId: seat.classroomId.toHexString(), sourceSeatId: seat.sourceSeatId };
}

function v2MappingFingerprintFact(row: ExamSeatAssignmentV2Mapping) {
    return { boundUserId: row.boundUserId, seat: seatIdentityFingerprintFact(row.seat) };
}

export function assignmentDocumentFingerprint(doc: ExamSeatAssignmentWithoutFingerprint): string {
    const common = {
        _id: doc._id.toHexString(),
        domainId: doc.domainId,
        eventId: doc.eventId.toHexString(),
        eventRevision: doc.eventRevision,
        schoolId: doc.schoolId.toHexString(),
        revision: doc.revision,
        auditRef: doc.auditRef,
        seatPlan: { seatPlanId: doc.seatPlan.seatPlanId.toHexString(), revision: doc.seatPlan.revision, fingerprint: doc.seatPlan.fingerprint },
        roster: { rosterId: doc.roster.rosterId.toHexString(), revision: doc.roster.revision, fingerprint: doc.roster.fingerprint },
        seed: doc.seed,
        algorithmVersion: doc.algorithmVersion,
        previousRevision: doc.previousRevision,
        createdAt: doc.createdAt.toISOString(),
        createdBy: doc.createdBy,
    };
    if ('seatFacts' in doc) {
        return sha256({
            schemaVersion: 2,
            ...common,
            classrooms: doc.classrooms.map((classroom) => ({
                classroomId: classroom.classroomId.toHexString(),
                layoutRevision: classroom.layoutRevision,
                layoutFingerprint: classroom.layoutFingerprint,
                profileRevision: classroom.profileRevision,
                profileFingerprint: classroom.profileFingerprint,
                candidateSeatIds: classroom.candidateSeatIds,
            })),
            participants: doc.participants.map((participant) => ({
                boundUserId: participant.boundUserId,
                studentRecordId: participant.studentRecordId.toHexString(),
                studentId: participant.studentId,
                teamId: participant.teamId,
                teamRole: participant.teamRole,
            })),
            seatFacts: doc.seatFacts.map((seat) => ({
                ...seatIdentityFingerprintFact(seat),
                label: seat.label,
                x: seat.x,
                y: seat.y,
                width: seat.width,
                height: seat.height,
                rotation: seat.rotation,
                layoutStatus: seat.layoutStatus,
                enabled: seat.enabled,
                facing: seat.facing,
                disabledReason: seat.disabledReason,
                bindingId: seat.bindingId?.toHexString() || null,
                bindingRevision: seat.bindingRevision,
                endpointId: seat.endpointId,
                endpointOnline: seat.endpointOnline,
            })),
            constraints: {
                strategy: doc.constraints.strategy,
                lockedAssignments: doc.constraints.lockedAssignments.map(v2MappingFingerprintFact),
                manualAssignments: doc.constraints.manualAssignments.map(v2MappingFingerprintFact),
            },
            assignments: doc.assignments.map(v2MappingFingerprintFact),
            explanation: explanationFingerprintFact(doc.explanation),
        });
    }
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

function assertExamSeatAssignmentV1Integrity(value: unknown): asserts value is ExamSeatAssignmentV1Doc {
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
    const canonical: Omit<ExamSeatAssignmentV1Doc, 'fingerprint'> = {
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

function canonicalSeatIdentity(value: unknown, field = 'seat_identity'): ExamSeatIdentity {
    const seat = exactObject(value, ['classroomId', 'sourceSeatId'], `${field}_invalid`);
    assertObjectId(seat.classroomId, 'classroomId');
    return { classroomId: new ObjectId(seat.classroomId), sourceSeatId: canonicalText(seat.sourceSeatId, 'source_seat_id') };
}

function seatIdentityKey(seat: ExamSeatIdentity): string {
    return `${seat.classroomId.toHexString()}\u0000${seat.sourceSeatId}`;
}

export function examSeatIdentityKey(seat: ExamSeatIdentity): string {
    return seatIdentityKey(seat);
}

function sameSeatIdentity(left: ExamSeatIdentity, right: ExamSeatIdentity): boolean {
    return left.classroomId.equals(right.classroomId) && left.sourceSeatId === right.sourceSeatId;
}

function canonicalV2Mapping(value: unknown): ExamSeatAssignmentV2Mapping {
    const row = exactObject(value, ['boundUserId', 'seat'], 'assignment_mapping_invalid');
    assertUid(row.boundUserId, 'boundUserId');
    return { boundUserId: row.boundUserId, seat: canonicalSeatIdentity(row.seat) };
}

function canonicalV2Mappings(value: unknown, field: string): ExamSeatAssignmentV2Mapping[] {
    if (!Array.isArray(value) || value.length > 500) throw new ExamSeatAssignmentError(`${field}_invalid`);
    return value.map(canonicalV2Mapping).sort((left, right) => left.boundUserId - right.boundUserId);
}

function sameV2Mapping(left: ExamSeatAssignmentV2Mapping, right: ExamSeatAssignmentV2Mapping | undefined): boolean {
    return !!right && left.boundUserId === right.boundUserId && sameSeatIdentity(left.seat, right.seat);
}

function canonicalV2Classroom(value: unknown): ExamSeatPlanClassroomRef {
    const classroom = exactObject(
        value,
        ['candidateSeatIds', 'classroomId', 'layoutFingerprint', 'layoutRevision', 'profileFingerprint', 'profileRevision'],
        'assignment_classroom_invalid',
    );
    assertObjectId(classroom.classroomId, 'classroomId');
    assertRevision(classroom.layoutRevision, 'layoutRevision');
    if (!Number.isSafeInteger(classroom.profileRevision) || Number(classroom.profileRevision) < 0) {
        throw new ExamSeatAssignmentError('assignment_profile_revision_invalid');
    }
    assertFingerprint(classroom.layoutFingerprint, 'layout_fingerprint');
    assertFingerprint(classroom.profileFingerprint, 'profile_fingerprint');
    if (!Array.isArray(classroom.candidateSeatIds) || !classroom.candidateSeatIds.length || classroom.candidateSeatIds.length > 500) {
        throw new ExamSeatAssignmentError('assignment_seats_invalid');
    }
    const candidateSeatIds = classroom.candidateSeatIds.map((seatId) => canonicalText(seatId, 'source_seat_id'));
    if (
        new Set(candidateSeatIds).size !== candidateSeatIds.length ||
        [...candidateSeatIds].sort(canonicalCompare).some((seatId, index) => seatId !== candidateSeatIds[index])
    ) {
        throw new ExamSeatAssignmentError('assignment_seats_invalid');
    }
    return {
        classroomId: new ObjectId(classroom.classroomId),
        layoutRevision: classroom.layoutRevision,
        layoutFingerprint: classroom.layoutFingerprint,
        profileRevision: Number(classroom.profileRevision),
        profileFingerprint: classroom.profileFingerprint,
        candidateSeatIds,
    };
}

function canonicalParticipant(value: unknown): ExamSeatAssignmentParticipantFact {
    const participant = exactObject(value, ['boundUserId', 'studentId', 'studentRecordId', 'teamId', 'teamRole'], 'assignment_participant_invalid');
    assertUid(participant.boundUserId, 'boundUserId');
    assertObjectId(participant.studentRecordId, 'studentRecordId');
    const studentId = canonicalText(participant.studentId, 'student_id', 128);
    if (participant.teamId === null) {
        if (participant.teamRole !== null) throw new ExamSeatAssignmentError('assignment_participant_invalid');
        return {
            boundUserId: participant.boundUserId,
            studentRecordId: new ObjectId(participant.studentRecordId),
            studentId,
            teamId: null,
            teamRole: null,
        };
    }
    const teamId = canonicalText(participant.teamId, 'team_id', 128);
    if (participant.teamRole !== 'captain' && participant.teamRole !== 'member') {
        throw new ExamSeatAssignmentError('assignment_participant_invalid');
    }
    return {
        boundUserId: participant.boundUserId,
        studentRecordId: new ObjectId(participant.studentRecordId),
        studentId,
        teamId,
        teamRole: participant.teamRole,
    };
}

function finiteNumber(value: unknown, field: string, minimum = -1_000_000, maximum = 1_000_000): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new ExamSeatAssignmentError(`${field}_invalid`);
    }
    return value;
}

function isStringEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && allowed.includes(value as T);
}

function canonicalV2SeatFact(value: unknown): ExamSeatAssignmentV2SeatFact {
    const seat = exactObject(
        value,
        [
            'bindingId',
            'bindingRevision',
            'classroomId',
            'disabledReason',
            'enabled',
            'endpointId',
            'endpointOnline',
            'facing',
            'height',
            'label',
            'layoutStatus',
            'rotation',
            'sourceSeatId',
            'width',
            'x',
            'y',
        ],
        'assignment_seat_fact_invalid',
    );
    const identity = canonicalSeatIdentity({ classroomId: seat.classroomId, sourceSeatId: seat.sourceSeatId });
    if (
        typeof seat.enabled !== 'boolean' ||
        !isStringEnum<ExamSeatFacing>(seat.facing, ['down', 'left', 'right', 'unset', 'up'])
    ) {
        throw new ExamSeatAssignmentError('assignment_seat_fact_invalid');
    }
    let disabledReason: ExamSeatDisabledReason | null = null;
    if (seat.enabled) {
        if (seat.disabledReason !== null) throw new ExamSeatAssignmentError('assignment_seat_fact_invalid');
    } else {
        if (
            !isStringEnum<ExamSeatDisabledReason>(seat.disabledReason, [
                'client_incompatible',
                'computer_failure',
                'manual_reserve',
                'physical_seat_unavailable',
            ])
        ) {
            throw new ExamSeatAssignmentError('assignment_seat_fact_invalid');
        }
        disabledReason = seat.disabledReason;
    }
    const nullBinding = seat.bindingId === null && seat.bindingRevision === null && seat.endpointId === null && seat.endpointOnline === null;
    const completeBinding =
        seat.bindingId instanceof ObjectId &&
        Number.isSafeInteger(seat.bindingRevision) &&
        Number(seat.bindingRevision) >= 1 &&
        typeof seat.endpointId === 'string' &&
        (typeof seat.endpointOnline === 'boolean' || seat.endpointOnline === null);
    if (!nullBinding && !completeBinding) throw new ExamSeatAssignmentError('assignment_seat_binding_fact_invalid');
    const width = seat.width === null ? null : finiteNumber(seat.width, 'seat_width', Number.MIN_VALUE);
    const height = seat.height === null ? null : finiteNumber(seat.height, 'seat_height', Number.MIN_VALUE);
    if ((width === null) !== (height === null)) throw new ExamSeatAssignmentError('assignment_seat_geometry_invalid');
    return {
        ...identity,
        label: canonicalText(seat.label, 'seat_label', 128),
        x: finiteNumber(seat.x, 'seat_x'),
        y: finiteNumber(seat.y, 'seat_y'),
        width,
        height,
        rotation: finiteNumber(seat.rotation, 'seat_rotation', -360, 360),
        layoutStatus: canonicalText(seat.layoutStatus, 'seat_status', 64),
        enabled: seat.enabled,
        facing: seat.facing,
        disabledReason,
        bindingId: seat.bindingId === null ? null : new ObjectId(seat.bindingId as ObjectId),
        bindingRevision: seat.bindingRevision as number | null,
        endpointId: seat.endpointId === null ? null : canonicalText(seat.endpointId, 'endpoint_id', 128),
        endpointOnline: seat.endpointOnline as boolean | null,
    };
}

function canonicalRiskEdge(value: unknown): ExamSeatAssignmentRiskEdge {
    const edge = exactObject(value, ['distance', 'left', 'reason', 'right'], 'assignment_risk_edge_invalid');
    if (
        !isStringEnum<ExamSeatAssignmentRiskEdge['reason']>(edge.reason, [
            'perpendicular_facing',
            'same_facing',
            'unset_facing',
        ])
    ) {
        throw new ExamSeatAssignmentError('assignment_risk_edge_invalid');
    }
    const left = canonicalSeatIdentity(edge.left);
    const right = canonicalSeatIdentity(edge.right);
    if (canonicalCompare(seatIdentityKey(left), seatIdentityKey(right)) >= 0) throw new ExamSeatAssignmentError('assignment_risk_edge_invalid');
    return { left, right, distance: finiteNumber(edge.distance, 'risk_distance', 0), reason: edge.reason };
}

function canonicalExplanation(value: unknown, classrooms: ExamSeatPlanClassroomRef[]): ExamSeatAssignmentV2Explanation {
    const explanation = exactObject(
        value,
        ['classrooms', 'highRiskEdges', 'mediumRiskEdges', 'offlineSeats', 'skippedSeats', 'splitTeamIds', 'unsetFacingSeats'],
        'assignment_explanation_invalid',
    );
    if (!Array.isArray(explanation.classrooms) || explanation.classrooms.length !== classrooms.length) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    const classroomRows = explanation.classrooms.map((item) => {
        const row = exactObject(item, ['assignedCount', 'classroomId', 'eligibleSeatCount'], 'assignment_explanation_invalid');
        assertObjectId(row.classroomId, 'classroomId');
        if (
            !Number.isSafeInteger(row.assignedCount) ||
            Number(row.assignedCount) < 0 ||
            !Number.isSafeInteger(row.eligibleSeatCount) ||
            Number(row.eligibleSeatCount) < Number(row.assignedCount)
        ) {
            throw new ExamSeatAssignmentError('assignment_explanation_invalid');
        }
        return {
            classroomId: new ObjectId(row.classroomId),
            assignedCount: Number(row.assignedCount),
            eligibleSeatCount: Number(row.eligibleSeatCount),
        };
    });
    if (classroomRows.some((row, index) => !row.classroomId.equals(classrooms[index].classroomId))) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    const edgeList = (input: unknown, field: string): ExamSeatAssignmentRiskEdge[] => {
        if (!Array.isArray(input) || input.length > EXAM_SEAT_ASSIGNMENT_V2_READER_MAX_RISK_EDGES) {
            throw new ExamSeatAssignmentError('assignment_explanation_invalid');
        }
        const edges = input.map(canonicalRiskEdge);
        const keys = edges.map((edge) => `${seatIdentityKey(edge.left)}\u0001${seatIdentityKey(edge.right)}\u0001${edge.reason}`);
        if (new Set(keys).size !== keys.length || [...keys].sort(canonicalCompare).some((key, index) => key !== keys[index])) {
            throw new ExamSeatAssignmentError(`${field}_invalid`);
        }
        return edges;
    };
    const seatList = (input: unknown, field: string): ExamSeatIdentity[] => {
        if (!Array.isArray(input) || input.length > 500) throw new ExamSeatAssignmentError('assignment_explanation_invalid');
        const seats = input.map((item) => canonicalSeatIdentity(item));
        const keys = seats.map(seatIdentityKey);
        if (new Set(keys).size !== keys.length || [...keys].sort(canonicalCompare).some((key, index) => key !== keys[index])) {
            throw new ExamSeatAssignmentError(`${field}_invalid`);
        }
        return seats;
    };
    if (!Array.isArray(explanation.splitTeamIds) || explanation.splitTeamIds.length > 500) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    const splitTeamIds = explanation.splitTeamIds.map((teamId) => canonicalText(teamId, 'team_id', 128));
    if (
        new Set(splitTeamIds).size !== splitTeamIds.length ||
        [...splitTeamIds].sort(canonicalCompare).some((teamId, index) => teamId !== splitTeamIds[index])
    ) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    if (!Array.isArray(explanation.skippedSeats) || explanation.skippedSeats.length > 500) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    const skippedSeats = explanation.skippedSeats.map((item) => {
        const row = exactObject(item, ['reason', 'seat'], 'assignment_explanation_invalid');
        if (!isStringEnum(row.reason, ['disabled', 'layout_status', 'unbound'] as const)) {
            throw new ExamSeatAssignmentError('assignment_explanation_invalid');
        }
        return { seat: canonicalSeatIdentity(row.seat), reason: row.reason };
    });
    const skippedKeys = skippedSeats.map((item) => seatIdentityKey(item.seat));
    if (
        new Set(skippedKeys).size !== skippedKeys.length ||
        [...skippedKeys].sort(canonicalCompare).some((key, index) => key !== skippedKeys[index])
    ) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    return {
        classrooms: classroomRows,
        highRiskEdges: edgeList(explanation.highRiskEdges, 'assignment_high_risk_edges'),
        mediumRiskEdges: edgeList(explanation.mediumRiskEdges, 'assignment_medium_risk_edges'),
        splitTeamIds,
        skippedSeats,
        offlineSeats: seatList(explanation.offlineSeats, 'assignment_offline_seats'),
        unsetFacingSeats: seatList(explanation.unsetFacingSeats, 'assignment_unset_facing_seats'),
    };
}

function v2MappingConflictReasons(rows: ExamSeatAssignmentV2Mapping[]): string[] {
    const reasons: string[] = [];
    if (new Set(rows.map((row) => row.boundUserId)).size !== rows.length) reasons.push('duplicate_uid');
    if (new Set(rows.map((row) => seatIdentityKey(row.seat))).size !== rows.length) reasons.push('duplicate_seat');
    return reasons;
}

function mergeFixedV2Mappings(
    lockedAssignments: ExamSeatAssignmentV2Mapping[],
    manualAssignments: ExamSeatAssignmentV2Mapping[],
): ExamSeatAssignmentV2Mapping[] {
    const fixed = new Map<number, ExamSeatAssignmentV2Mapping>();
    for (const mapping of [...lockedAssignments, ...manualAssignments]) fixed.set(mapping.boundUserId, mapping);
    return [...fixed.values()].sort((left, right) => left.boundUserId - right.boundUserId);
}

function explanationFingerprintFact(explanation: ExamSeatAssignmentV2Explanation) {
    return {
        classrooms: explanation.classrooms.map((classroom) => ({
            classroomId: classroom.classroomId.toHexString(),
            assignedCount: classroom.assignedCount,
            eligibleSeatCount: classroom.eligibleSeatCount,
        })),
        highRiskEdges: explanation.highRiskEdges.map((edge) => ({
            left: seatIdentityFingerprintFact(edge.left),
            right: seatIdentityFingerprintFact(edge.right),
            distance: edge.distance,
            reason: edge.reason,
        })),
        mediumRiskEdges: explanation.mediumRiskEdges.map((edge) => ({
            left: seatIdentityFingerprintFact(edge.left),
            right: seatIdentityFingerprintFact(edge.right),
            distance: edge.distance,
            reason: edge.reason,
        })),
        splitTeamIds: explanation.splitTeamIds,
        skippedSeats: explanation.skippedSeats.map((item) => ({ seat: seatIdentityFingerprintFact(item.seat), reason: item.reason })),
        offlineSeats: explanation.offlineSeats.map(seatIdentityFingerprintFact),
        unsetFacingSeats: explanation.unsetFacingSeats.map(seatIdentityFingerprintFact),
    };
}

export function buildExamSeatAssignmentV2(input: {
    roster: ExamRosterRevisionDoc;
    seatPlan: ExamSeatPlanV2Doc;
    participants: ExamSeatAssignmentParticipantFact[];
    seatFacts: ExamSeatAssignmentV2SeatFact[];
    strategy: ExamSeatAssignmentStrategy;
    seed: string;
    lockedAssignments: ExamSeatAssignmentV2Mapping[];
    manualAssignments: ExamSeatAssignmentV2Mapping[];
}): ExamSeatAssignmentV2BuildResult {
    if (!isExamSeatPlanV2(input.seatPlan)) throw new ExamSeatAssignmentError('assignment_v2_plan_required');
    if (
        !input.seatPlan.roster ||
        !input.seatPlan.roster.rosterId.equals(input.roster._id) ||
        input.seatPlan.roster.revision !== input.roster.revision ||
        input.seatPlan.roster.fingerprint !== input.roster.fingerprint
    ) {
        throw new ExamSeatAssignmentError('assignment_roster_plan_mismatch');
    }
    if (input.strategy !== 'maximizeSpacing' && input.strategy !== 'minimizeClassrooms') {
        throw new ExamSeatAssignmentError('assignment_strategy_invalid');
    }
    const seed = canonicalSeed(input.seed);
    if (!Array.isArray(input.participants) || input.participants.length > 500) {
        throw new ExamSeatAssignmentError('assignment_participants_invalid');
    }
    const participants = input.participants.map(canonicalParticipant).sort((left, right) => left.boundUserId - right.boundUserId);
    if (
        participants.length !== input.roster.entries.length ||
        participants.some((participant, index) => {
            const entry = input.roster.entries[index];
            return (
                !entry ||
                participant.boundUserId !== entry.boundUserId ||
                !participant.studentRecordId.equals(entry.studentRecordId) ||
                participant.studentId !== entry.studentId
            );
        }) ||
        new Set(participants.map((participant) => participant.boundUserId)).size !== participants.length ||
        new Set(participants.map((participant) => participant.studentRecordId.toHexString())).size !== participants.length
    ) {
        throw new ExamSeatAssignmentError('assignment_participant_roster_mismatch');
    }
    const teams = new Map<string, ExamSeatAssignmentParticipantFact[]>();
    for (const participant of participants) {
        if (participant.teamId === null) continue;
        const members = teams.get(participant.teamId) || [];
        members.push(participant);
        teams.set(participant.teamId, members);
    }
    if (
        [...teams.values()].some(
            (members) => members.length > 3 || members.filter((member) => member.teamRole === 'captain').length !== 1,
        )
    ) {
        throw new ExamSeatAssignmentError('assignment_team_invalid');
    }

    const classrooms = input.seatPlan.classrooms.map(canonicalV2Classroom);
    const expectedSeatKeys = classrooms.flatMap((classroom) =>
        classroom.candidateSeatIds.map((sourceSeatId) => seatIdentityKey({ classroomId: classroom.classroomId, sourceSeatId })),
    );
    if (!Array.isArray(input.seatFacts) || input.seatFacts.length !== expectedSeatKeys.length) {
        throw new ExamSeatAssignmentError('assignment_seat_facts_invalid');
    }
    const seatFacts = input.seatFacts.map(canonicalV2SeatFact);
    const seatKeys = seatFacts.map(seatIdentityKey);
    const endpointIds = seatFacts.flatMap((seat) => (seat.endpointId === null ? [] : [seat.endpointId]));
    const bindingIds = seatFacts.flatMap((seat) => (seat.bindingId === null ? [] : [seat.bindingId.toHexString()]));
    if (
        expectedSeatKeys.some((key, index) => key !== seatKeys[index]) ||
        new Set(seatKeys).size !== seatKeys.length ||
        new Set(endpointIds).size !== endpointIds.length ||
        new Set(bindingIds).size !== bindingIds.length
    ) {
        throw new ExamSeatAssignmentError('assignment_seat_facts_invalid');
    }

    const lockedAssignments = canonicalV2Mappings(input.lockedAssignments, 'locked_assignments');
    const manualAssignments = canonicalV2Mappings(input.manualAssignments, 'manual_assignments');
    const participantUids = new Set(participants.map((participant) => participant.boundUserId));
    const eligibleSeats = new Set(
        seatFacts
            .filter(
                (seat) =>
                    seat.enabled &&
                    ['active', 'empty'].includes(seat.layoutStatus) &&
                    seat.bindingId !== null &&
                    seat.endpointId !== null,
            )
            .map(seatIdentityKey),
    );
    const constraintReasons = [
        ...v2MappingConflictReasons(lockedAssignments),
        ...v2MappingConflictReasons(manualAssignments),
    ];
    if (lockedAssignments.some((mapping) => !participantUids.has(mapping.boundUserId))) constraintReasons.push('locked_uid_missing');
    if (lockedAssignments.some((mapping) => !eligibleSeats.has(seatIdentityKey(mapping.seat)))) {
        constraintReasons.push('locked_seat_unavailable');
    }
    if (manualAssignments.some((mapping) => !participantUids.has(mapping.boundUserId))) constraintReasons.push('manual_uid_missing');
    if (manualAssignments.some((mapping) => !eligibleSeats.has(seatIdentityKey(mapping.seat)))) {
        constraintReasons.push('manual_seat_unavailable');
    }
    const lockedByUid = new Map(lockedAssignments.map((mapping) => [mapping.boundUserId, mapping]));
    if (
        manualAssignments.some((mapping) => {
            const locked = lockedByUid.get(mapping.boundUserId);
            return locked && !sameV2Mapping(locked, mapping);
        })
    ) {
        constraintReasons.push('locked_manual_mismatch');
    }
    const fixedAssignments = mergeFixedV2Mappings(lockedAssignments, manualAssignments);
    if (new Set(fixedAssignments.map((mapping) => seatIdentityKey(mapping.seat))).size !== fixedAssignments.length) {
        constraintReasons.push('duplicate_fixed_seat');
    }
    const skippedSeats = seatFacts
        .flatMap((seat) => {
            if (
                seat.enabled &&
                ['active', 'empty'].includes(seat.layoutStatus) &&
                seat.bindingId !== null &&
                seat.endpointId !== null
            ) {
                return [];
            }
            const reason = !seat.enabled ? 'disabled' : !['active', 'empty'].includes(seat.layoutStatus) ? 'layout_status' : 'unbound';
            return [{ seat: { classroomId: seat.classroomId, sourceSeatId: seat.sourceSeatId }, reason }] as Array<{
                seat: ExamSeatIdentity;
                reason: 'disabled' | 'layout_status' | 'unbound';
            }>;
        })
        .sort((left, right) => canonicalCompare(seatIdentityKey(left.seat), seatIdentityKey(right.seat)));
    const diagnostics: ExamSeatAssignmentV2Diagnostic[] = [];
    if (participants.length > eligibleSeats.size) {
        diagnostics.push({ code: 'insufficient_seats', requiredSeatCount: participants.length, availableSeatCount: eligibleSeats.size });
    }
    const reasons = [...new Set(constraintReasons)].sort(canonicalCompare);
    if (reasons.length) diagnostics.push({ code: 'constraint_conflict', reasons });
    if (diagnostics.length) {
        return { ok: false, diagnostics: skippedSeats.length ? [{ code: 'seat_skipped', seats: skippedSeats }, ...diagnostics] : diagnostics };
    }

    const allocation = allocateExamSeatsSpatially({
        classrooms,
        participants,
        seatFacts,
        strategy: input.strategy,
        seed,
        fixedAssignments,
    });
    return {
        ok: true,
        participants,
        seatFacts,
        constraints: { strategy: input.strategy, lockedAssignments, manualAssignments },
        assignments: allocation.assignments,
        explanation: allocation.explanation,
        diagnostics,
    };
}

function assertExamSeatAssignmentV2Integrity(value: unknown): asserts value is ExamSeatAssignmentV2Doc {
    const doc = exactObject(
        value,
        [
            '_id',
            'algorithmVersion',
            'assignments',
            'auditRef',
            'classrooms',
            'constraints',
            'createdAt',
            'createdBy',
            'domainId',
            'eventId',
            'eventRevision',
            'explanation',
            'fingerprint',
            'participants',
            'previousRevision',
            'revision',
            'roster',
            'schemaVersion',
            'schoolId',
            'seatFacts',
            'seatPlan',
            'seed',
        ],
        'assignment_document_invalid',
    );
    if (doc.schemaVersion !== 2) throw new ExamSeatAssignmentError('assignment_schema_version_invalid');
    assertObjectId(doc._id, 'assignmentId');
    assertDomainId(doc.domainId);
    assertObjectId(doc.eventId, 'eventId');
    assertRevision(doc.eventRevision, 'eventRevision');
    assertObjectId(doc.schoolId, 'schoolId');
    assertRevision(doc.revision);
    assertFingerprint(doc.fingerprint, 'assignment_fingerprint');
    assertUid(doc.createdBy, 'createdBy');
    const createdAt = canonicalDate(doc.createdAt, 'created_at');
    if (doc.auditRef !== examSeatAssignmentAuditRef(doc.eventId, doc.revision)) throw new ExamSeatAssignmentError('assignment_audit_ref_invalid');
    if (doc.algorithmVersion !== EXAM_SEAT_ASSIGNMENT_V2_ALGORITHM) throw new ExamSeatAssignmentError('assignment_algorithm_invalid');
    const seed = canonicalSeed(doc.seed);
    const seatPlan = exactObject(doc.seatPlan, ['fingerprint', 'revision', 'seatPlanId'], 'assignment_seat_plan_invalid');
    assertObjectId(seatPlan.seatPlanId, 'seatPlanId');
    assertRevision(seatPlan.revision, 'seatPlanRevision');
    assertFingerprint(seatPlan.fingerprint, 'seat_plan_fingerprint');
    const roster = exactObject(doc.roster, ['fingerprint', 'revision', 'rosterId'], 'assignment_roster_invalid');
    assertObjectId(roster.rosterId, 'rosterId');
    assertRevision(roster.revision, 'rosterRevision');
    assertFingerprint(roster.fingerprint, 'roster_fingerprint');
    if (!Array.isArray(doc.classrooms) || !doc.classrooms.length || doc.classrooms.length > 100) {
        throw new ExamSeatAssignmentError('assignment_classrooms_invalid');
    }
    const classrooms = doc.classrooms.map(canonicalV2Classroom);
    if (new Set(classrooms.map((classroom) => classroom.classroomId.toHexString())).size !== classrooms.length) {
        throw new ExamSeatAssignmentError('assignment_classroom_duplicate');
    }
    const expectedSeatKeys = classrooms.flatMap((classroom) =>
        classroom.candidateSeatIds.map((sourceSeatId) => seatIdentityKey({ classroomId: classroom.classroomId, sourceSeatId })),
    );
    if (!expectedSeatKeys.length || expectedSeatKeys.length > 500 || new Set(expectedSeatKeys).size !== expectedSeatKeys.length) {
        throw new ExamSeatAssignmentError('assignment_seats_invalid');
    }
    if (!Array.isArray(doc.participants) || doc.participants.length > 500) {
        throw new ExamSeatAssignmentError('assignment_participants_invalid');
    }
    const participants = doc.participants.map(canonicalParticipant).sort((left, right) => left.boundUserId - right.boundUserId);
    if (
        new Set(participants.map((participant) => participant.boundUserId)).size !== participants.length ||
        new Set(participants.map((participant) => participant.studentRecordId.toHexString())).size !== participants.length ||
        participants.some(
            (participant, index) => participant.boundUserId !== (doc.participants as ExamSeatAssignmentParticipantFact[])[index]?.boundUserId,
        )
    ) {
        throw new ExamSeatAssignmentError('assignment_participants_invalid');
    }
    const participantTeams = new Map<string, ExamSeatAssignmentParticipantFact[]>();
    for (const participant of participants) {
        if (participant.teamId === null) continue;
        const members = participantTeams.get(participant.teamId) || [];
        members.push(participant);
        participantTeams.set(participant.teamId, members);
    }
    if (
        [...participantTeams.values()].some(
            (members) => members.length > 3 || members.filter((member) => member.teamRole === 'captain').length !== 1,
        )
    ) {
        throw new ExamSeatAssignmentError('assignment_team_invalid');
    }
    if (!Array.isArray(doc.seatFacts) || doc.seatFacts.length !== expectedSeatKeys.length) {
        throw new ExamSeatAssignmentError('assignment_seat_facts_invalid');
    }
    const seatFacts = doc.seatFacts.map(canonicalV2SeatFact);
    const seatKeys = seatFacts.map(seatIdentityKey);
    if (seatKeys.some((key, index) => key !== expectedSeatKeys[index]) || new Set(seatKeys).size !== seatKeys.length) {
        throw new ExamSeatAssignmentError('assignment_seat_facts_invalid');
    }
    const endpointIds = seatFacts.flatMap((seat) => (seat.endpointId ? [seat.endpointId] : []));
    if (new Set(endpointIds).size !== endpointIds.length) throw new ExamSeatAssignmentError('assignment_endpoint_duplicate');
    const bindingIds = seatFacts.flatMap((seat) => (seat.bindingId ? [seat.bindingId.toHexString()] : []));
    if (new Set(bindingIds).size !== bindingIds.length) throw new ExamSeatAssignmentError('assignment_binding_duplicate');
    const constraints = exactObject(doc.constraints, ['lockedAssignments', 'manualAssignments', 'strategy'], 'assignment_constraints_invalid');
    if (constraints.strategy !== 'maximizeSpacing' && constraints.strategy !== 'minimizeClassrooms') {
        throw new ExamSeatAssignmentError('assignment_strategy_invalid');
    }
    const lockedAssignments = canonicalV2Mappings(constraints.lockedAssignments, 'locked_assignments');
    const manualAssignments = canonicalV2Mappings(constraints.manualAssignments, 'manual_assignments');
    const assignments = canonicalV2Mappings(doc.assignments, 'assignments');
    for (const [stored, canonicalRows] of [
        [constraints.lockedAssignments, lockedAssignments],
        [constraints.manualAssignments, manualAssignments],
        [doc.assignments, assignments],
    ] as const) {
        if (
            !Array.isArray(stored) ||
            stored.length !== canonicalRows.length ||
            canonicalRows.some((row, index) => !sameV2Mapping(row, stored[index] as ExamSeatAssignmentV2Mapping | undefined))
        ) {
            throw new ExamSeatAssignmentError('assignment_mapping_invalid');
        }
    }
    const participantUids = participants.map((participant) => participant.boundUserId);
    const assignmentUids = assignments.map((assignment) => assignment.boundUserId);
    const assignmentSeatKeys = assignments.map((assignment) => seatIdentityKey(assignment.seat));
    const mappingSetIsUnique = (mappings: ExamSeatAssignmentV2Mapping[]) =>
        new Set(mappings.map((mapping) => mapping.boundUserId)).size === mappings.length &&
        new Set(mappings.map((mapping) => seatIdentityKey(mapping.seat))).size === mappings.length;
    const factBySeat = new Map(seatFacts.map((seat) => [seatIdentityKey(seat), seat]));
    const assignmentByUid = new Map(assignments.map((assignment) => [assignment.boundUserId, assignment]));
    if (
        JSON.stringify(participantUids) !== JSON.stringify(assignmentUids) ||
        new Set(assignmentSeatKeys).size !== assignmentSeatKeys.length ||
        !mappingSetIsUnique(lockedAssignments) ||
        !mappingSetIsUnique(manualAssignments) ||
        assignments.some((assignment) => {
            const seat = factBySeat.get(seatIdentityKey(assignment.seat));
            return !seat || !seat.enabled || !['active', 'empty'].includes(seat.layoutStatus) || !seat.bindingId || !seat.endpointId;
        }) ||
        lockedAssignments.some((locked) => !sameV2Mapping(locked, assignmentByUid.get(locked.boundUserId))) ||
        manualAssignments.some((manual) => !sameV2Mapping(manual, assignmentByUid.get(manual.boundUserId)))
    ) {
        throw new ExamSeatAssignmentError('assignment_mapping_invalid');
    }
    const explanation = canonicalExplanation(doc.explanation, classrooms);
    const assignedSeatSet = new Set(assignmentSeatKeys);
    const explanationSeatKeys = [
        ...explanation.skippedSeats.map((item) => seatIdentityKey(item.seat)),
        ...explanation.offlineSeats.map(seatIdentityKey),
        ...explanation.unsetFacingSeats.map(seatIdentityKey),
    ];
    const highRiskPairs = new Set(explanation.highRiskEdges.map((edge) => `${seatIdentityKey(edge.left)}\u0001${seatIdentityKey(edge.right)}`));
    const riskEdges = [...explanation.highRiskEdges, ...explanation.mediumRiskEdges];
    if (
        explanation.classrooms.reduce((sum, classroom) => sum + classroom.assignedCount, 0) !== assignments.length ||
        explanationSeatKeys.some((key) => !factBySeat.has(key)) ||
        riskEdges.some((edge) => !assignedSeatSet.has(seatIdentityKey(edge.left)) || !assignedSeatSet.has(seatIdentityKey(edge.right))) ||
        explanation.mediumRiskEdges.some((edge) => highRiskPairs.has(`${seatIdentityKey(edge.left)}\u0001${seatIdentityKey(edge.right)}`)) ||
        explanation.classrooms.some((classroom) => {
            const classroomId = classroom.classroomId.toHexString();
            const assignedCount = assignments.filter((assignment) => assignment.seat.classroomId.toHexString() === classroomId).length;
            const eligibleSeatCount = seatFacts.filter(
                (seat) =>
                    seat.classroomId.toHexString() === classroomId &&
                    seat.enabled &&
                    ['active', 'empty'].includes(seat.layoutStatus) &&
                    seat.bindingId !== null &&
                    seat.endpointId !== null,
            ).length;
            return classroom.assignedCount !== assignedCount || classroom.eligibleSeatCount !== eligibleSeatCount;
        })
    ) {
        throw new ExamSeatAssignmentError('assignment_explanation_invalid');
    }
    if (doc.previousRevision !== null && doc.previousRevision !== doc.revision - 1) {
        throw new ExamSeatAssignmentError('assignment_previous_revision_invalid');
    }
    if ((doc.revision === 1) !== (doc.previousRevision === null)) throw new ExamSeatAssignmentError('assignment_previous_revision_invalid');
    const canonical: Omit<ExamSeatAssignmentV2Doc, 'fingerprint'> = {
        _id: new ObjectId(doc._id),
        schemaVersion: 2,
        domainId: doc.domainId,
        eventId: new ObjectId(doc.eventId),
        eventRevision: doc.eventRevision,
        schoolId: new ObjectId(doc.schoolId),
        revision: doc.revision,
        auditRef: doc.auditRef,
        seatPlan: { seatPlanId: new ObjectId(seatPlan.seatPlanId), revision: seatPlan.revision, fingerprint: seatPlan.fingerprint },
        roster: { rosterId: new ObjectId(roster.rosterId), revision: roster.revision, fingerprint: roster.fingerprint },
        classrooms,
        participants,
        seatFacts,
        constraints: { strategy: constraints.strategy, lockedAssignments, manualAssignments },
        seed,
        algorithmVersion: EXAM_SEAT_ASSIGNMENT_V2_ALGORITHM,
        assignments,
        explanation,
        previousRevision: doc.previousRevision as number | null,
        createdAt,
        createdBy: doc.createdBy,
    };
    if (doc.fingerprint !== assignmentDocumentFingerprint(canonical)) throw new ExamSeatAssignmentError('assignment_fingerprint_mismatch');
}

export function assertExamSeatAssignmentIntegrity(value: unknown): asserts value is ExamSeatAssignmentRevisionDoc {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'schemaVersion')) {
        assertExamSeatAssignmentV2Integrity(value);
        return;
    }
    assertExamSeatAssignmentV1Integrity(value);
}

export function assertExamSeatAssignmentV2AlgorithmResult(assignment: ExamSeatAssignmentV2Doc): void {
    const rebuilt = allocateExamSeatsSpatially({
        classrooms: assignment.classrooms,
        participants: assignment.participants,
        seatFacts: assignment.seatFacts,
        strategy: assignment.constraints.strategy,
        seed: assignment.seed,
        fixedAssignments: mergeFixedV2Mappings(
            assignment.constraints.lockedAssignments,
            assignment.constraints.manualAssignments,
        ),
    });
    if (
        rebuilt.assignments.length !== assignment.assignments.length ||
        rebuilt.assignments.some((mapping, index) => !sameV2Mapping(mapping, assignment.assignments[index])) ||
        JSON.stringify(explanationFingerprintFact(rebuilt.explanation)) !==
            JSON.stringify(explanationFingerprintFact(assignment.explanation))
    ) {
        throw new ExamSeatAssignmentError('assignment_algorithm_result_mismatch');
    }
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
        seatPlan: ExamSeatPlanV1Doc;
        seatFacts: ExamAssignmentSeatFact[];
        mode: ExamSeatAssignmentMode;
        seed: string;
        lockedAssignments: ExamSeatAssignmentMapping[];
        manualAssignments: ExamSeatAssignmentMapping[];
    }): Promise<{ assignment: ExamSeatAssignmentV1Doc | null; diagnostics: ExamSeatAssignmentDiagnostic[] }> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertRevision(input.eventRevision, 'eventRevision');
        assertObjectId(input.schoolId, 'schoolId');
        assertUid(input.actorUid, 'actorUid');
        if (!Number.isSafeInteger(input.expectedPreviousRevision) || input.expectedPreviousRevision < 0) {
            throw new TypeError('expectedPreviousRevision is invalid');
        }
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
        if (previous && isExamSeatAssignmentV2(previous)) throw new ExamSeatAssignmentError('assignment_v2_writer_required');
        if ((previous?.revision || 0) !== input.expectedPreviousRevision) {
            throw new ExamSeatAssignmentError('assignment_revision_conflict');
        }
        if (previous && (!previous.schoolId.equals(input.schoolId) || previous.eventRevision > input.eventRevision)) {
            throw new ExamSeatAssignmentError('assignment_history_identity_mismatch');
        }
        const createdAt = canonicalDate(this.now(), 'now');
        const revision = (previous?.revision || 0) + 1;
        const canonical: Omit<ExamSeatAssignmentV1Doc, 'fingerprint'> = {
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
        const assignment: ExamSeatAssignmentV1Doc = { ...canonical, fingerprint: assignmentDocumentFingerprint(canonical) };
        try {
            await this.assignments.insertOne(assignment);
        } catch (error) {
            if (duplicateKey(error)) throw new ExamSeatAssignmentError('assignment_revision_conflict');
            throw error;
        }
        return { assignment, diagnostics: built.diagnostics };
    }

    async createRevisionV2(input: {
        domainId: string;
        eventId: ObjectId;
        eventRevision: number;
        schoolId: ObjectId;
        actorUid: number;
        expectedPreviousRevision: number;
        roster: ExamRosterRevisionDoc;
        seatPlan: ExamSeatPlanV2Doc;
        participants: ExamSeatAssignmentParticipantFact[];
        seatFacts: ExamSeatAssignmentV2SeatFact[];
        strategy: ExamSeatAssignmentStrategy;
        seed: string;
        lockedAssignments: ExamSeatAssignmentV2Mapping[];
        manualAssignments: ExamSeatAssignmentV2Mapping[];
    }): Promise<{ assignment: ExamSeatAssignmentV2Doc | null; diagnostics: ExamSeatAssignmentV2Diagnostic[] }> {
        assertDomainId(input.domainId);
        assertObjectId(input.eventId, 'eventId');
        assertRevision(input.eventRevision, 'eventRevision');
        assertObjectId(input.schoolId, 'schoolId');
        assertUid(input.actorUid, 'actorUid');
        if (!Number.isSafeInteger(input.expectedPreviousRevision) || input.expectedPreviousRevision < 0) {
            throw new TypeError('expectedPreviousRevision is invalid');
        }
        if (!isExamSeatPlanV2(input.seatPlan)) throw new ExamSeatAssignmentError('assignment_v2_plan_required');
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
        const built = buildExamSeatAssignmentV2(input);
        if (!built.ok) return { assignment: null, diagnostics: built.diagnostics };
        const previous = await this.latestRevision(input.domainId, input.eventId);
        if ((previous?.revision || 0) !== input.expectedPreviousRevision) {
            throw new ExamSeatAssignmentError('assignment_revision_conflict');
        }
        if (previous && (!previous.schoolId.equals(input.schoolId) || previous.eventRevision > input.eventRevision)) {
            throw new ExamSeatAssignmentError('assignment_history_identity_mismatch');
        }
        const createdAt = canonicalDate(this.now(), 'now');
        const revision = (previous?.revision || 0) + 1;
        const canonical: Omit<ExamSeatAssignmentV2Doc, 'fingerprint'> = {
            _id: this.idFactory(),
            schemaVersion: 2,
            domainId: input.domainId,
            eventId: new ObjectId(input.eventId),
            eventRevision: input.eventRevision,
            schoolId: new ObjectId(input.schoolId),
            revision,
            auditRef: examSeatAssignmentAuditRef(input.eventId, revision),
            seatPlan: { seatPlanId: new ObjectId(input.seatPlan._id), revision: input.seatPlan.revision, fingerprint: input.seatPlan.fingerprint },
            roster: { rosterId: new ObjectId(input.roster._id), revision: input.roster.revision, fingerprint: input.roster.fingerprint },
            classrooms: input.seatPlan.classrooms.map((classroom) => ({
                classroomId: new ObjectId(classroom.classroomId),
                layoutRevision: classroom.layoutRevision,
                layoutFingerprint: classroom.layoutFingerprint,
                profileRevision: classroom.profileRevision,
                profileFingerprint: classroom.profileFingerprint,
                candidateSeatIds: [...classroom.candidateSeatIds],
            })),
            participants: built.participants,
            seatFacts: built.seatFacts,
            constraints: built.constraints,
            seed: canonicalSeed(input.seed),
            algorithmVersion: EXAM_SEAT_ASSIGNMENT_V2_ALGORITHM,
            assignments: built.assignments,
            explanation: built.explanation,
            previousRevision: previous?.revision || null,
            createdAt,
            createdBy: input.actorUid,
        };
        const assignment: ExamSeatAssignmentV2Doc = { ...canonical, fingerprint: assignmentDocumentFingerprint(canonical) };
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
        if (isExamSeatAssignmentV2(assignment)) assertExamSeatAssignmentV2AlgorithmResult(assignment);
        const current = await this.getPublication(input.domainId, input.eventId);
        if ((current?.revision || 0) !== input.expectedPublicationRevision) {
            throw new ExamSeatAssignmentError('assignment_publication_conflict');
        }
        const revision = input.expectedPublicationRevision + 1;
        const updatedAt = canonicalDate(this.now(), 'now');
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
