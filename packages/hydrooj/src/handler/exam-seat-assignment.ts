import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, localizedErrorText, OplogModel, param, PermissionError, Types, ValidationError } from 'hydrooj';
import { PERM } from '../model/builtin';
import { examClassroomService } from '../model/exam-classroom';
import {
    ExamAssignmentSeatFact,
    ExamSeatAssignmentError,
    ExamSeatAssignmentMapping,
    ExamSeatAssignmentRevisionDoc,
    ExamSeatAssignmentV2Doc,
    assertExamSeatAssignmentIntegrity,
    buildExamSeatAssignment,
    examSeatAssignmentService,
    isExamSeatAssignmentV2,
    seatFactMatchesBindingHistory,
    seatPlanMatchesAssignmentRoster,
} from '../model/exam-seat-assignment';
import { ExamEventDoc, examEventService } from '../model/exam-event';
import { assertCanManageExamEvent, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { endpointSeatBindingService } from '../model/endpoint-seat-binding';
import { examSeatOperationalProfileService } from '../model/exam-seat-operational-profile';
import { ExamRosterRevisionDoc, ExamSeatPlanError, ExamSeatPlanV1Doc, examSeatPlanService, isExamSeatPlanV2 } from '../model/exam-seat-plan';
import { preflightExamNetworkOnVigil } from '../service/vigil-bridge';

const logger = new Logger('exam-seat-assignment');

function exactBody(value: unknown, keys: string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('body');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) throw new ValidationError('body');
}

function translate(error: unknown): never {
    if (error instanceof ExamSeatAssignmentError || error instanceof ExamSeatPlanError) {
        throw new ValidationError('examSeatAssignment', null, localizedErrorText`Invalid request: ${error.reason}`);
    }
    throw error;
}

function requestMappings(value: unknown): ExamSeatAssignmentMapping[] {
    if (!Array.isArray(value) || value.length > 500) throw new ValidationError('mappings');
    return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('mappings');
        const row = item as Record<string, unknown>;
        if (
            Object.keys(row).length !== 2 ||
            !Object.hasOwn(row, 'boundUserId') ||
            !Object.hasOwn(row, 'sourceSeatId') ||
            typeof row.boundUserId !== 'number' ||
            !Number.isSafeInteger(row.boundUserId) ||
            row.boundUserId <= 1 ||
            typeof row.sourceSeatId !== 'string' ||
            !row.sourceSeatId.trim() ||
            row.sourceSeatId !== row.sourceSeatId.trim() ||
            row.sourceSeatId.length > 128
        ) {
            throw new ValidationError('mappings');
        }
        return { boundUserId: row.boundUserId, sourceSeatId: row.sourceSeatId };
    });
}

function serializeAssignment(assignment: ExamSeatAssignmentRevisionDoc, publishedRevision: number | null) {
    const common = {
        assignmentId: assignment._id.toHexString(),
        schemaVersion: isExamSeatAssignmentV2(assignment) ? 2 : 1,
        eventRevision: assignment.eventRevision,
        schoolId: assignment.schoolId.toHexString(),
        revision: assignment.revision,
        auditRef: assignment.auditRef,
        seatPlan: {
            seatPlanId: assignment.seatPlan.seatPlanId.toHexString(),
            revision: assignment.seatPlan.revision,
            fingerprint: assignment.seatPlan.fingerprint,
        },
        roster: {
            rosterId: assignment.roster.rosterId.toHexString(),
            revision: assignment.roster.revision,
            fingerprint: assignment.roster.fingerprint,
        },
        algorithmVersion: assignment.algorithmVersion,
        seed: assignment.seed,
        previousRevision: assignment.previousRevision,
        fingerprint: assignment.fingerprint,
        published: assignment.revision === publishedRevision,
        createdAt: assignment.createdAt.toISOString(),
        createdBy: assignment.createdBy,
    };
    if (isExamSeatAssignmentV2(assignment)) {
        const seat = (value: { classroomId: ObjectId; sourceSeatId: string }) => ({
            classroomId: value.classroomId.toHexString(),
            sourceSeatId: value.sourceSeatId,
        });
        return {
            ...common,
            classrooms: assignment.classrooms.map((classroom) => ({
                classroomId: classroom.classroomId.toHexString(),
                layoutRevision: classroom.layoutRevision,
                layoutFingerprint: classroom.layoutFingerprint,
                profileRevision: classroom.profileRevision,
                profileFingerprint: classroom.profileFingerprint,
                candidateSeatIds: [...classroom.candidateSeatIds],
            })),
            participants: assignment.participants.map((participant) => ({
                ...participant,
                studentRecordId: participant.studentRecordId.toHexString(),
            })),
            seatFacts: assignment.seatFacts.map((fact) => ({
                ...fact,
                classroomId: fact.classroomId.toHexString(),
                bindingId: fact.bindingId?.toHexString() || null,
            })),
            constraints: {
                strategy: assignment.constraints.strategy,
                lockedAssignments: assignment.constraints.lockedAssignments.map((row) => ({ boundUserId: row.boundUserId, seat: seat(row.seat) })),
                manualAssignments: assignment.constraints.manualAssignments.map((row) => ({ boundUserId: row.boundUserId, seat: seat(row.seat) })),
            },
            assignments: assignment.assignments.map((row) => ({ boundUserId: row.boundUserId, seat: seat(row.seat) })),
            explanation: {
                classrooms: assignment.explanation.classrooms.map((row) => ({ ...row, classroomId: row.classroomId.toHexString() })),
                highRiskEdges: assignment.explanation.highRiskEdges.map((edge) => ({ ...edge, left: seat(edge.left), right: seat(edge.right) })),
                mediumRiskEdges: assignment.explanation.mediumRiskEdges.map((edge) => ({ ...edge, left: seat(edge.left), right: seat(edge.right) })),
                splitTeamIds: [...assignment.explanation.splitTeamIds],
                skippedSeats: assignment.explanation.skippedSeats.map((row) => ({ reason: row.reason, seat: seat(row.seat) })),
                offlineSeats: assignment.explanation.offlineSeats.map(seat),
                unsetFacingSeats: assignment.explanation.unsetFacingSeats.map(seat),
            },
        };
    }
    return {
        ...common,
        classroomId: assignment.classroomId.toHexString(),
        layoutRevision: assignment.layoutRevision,
        layoutFingerprint: assignment.layoutFingerprint,
        candidateSeatIds: [...assignment.candidateSeatIds],
        eligibleSeatIds: [...assignment.eligibleSeatIds],
        constraints: {
            mode: assignment.constraints.mode,
            lockedAssignments: assignment.constraints.lockedAssignments.map((row) => ({ ...row })),
            manualAssignments: assignment.constraints.manualAssignments.map((row) => ({ ...row })),
        },
        assignments: assignment.assignments.map((row) => ({ ...row })),
        diagnostics: assignment.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
}

interface AssignmentSource {
    seatPlan: ExamSeatPlanV1Doc;
    roster: ExamRosterRevisionDoc;
    seatFacts: ExamAssignmentSeatFact[];
    seats: Array<{
        sourceSeatId: string;
        label: string;
        x: number;
        y: number;
        width?: number;
        height?: number;
        rotation: number;
        status: string;
        bindingId: string | null;
        bindingRevision: number | null;
        endpointId: string | null;
    }>;
}

interface AssignmentDisplaySource {
    schemaVersion: 1 | 2;
    seatPlanRevision: number;
    seats: Array<{
        classroomId: string;
        sourceSeatId: string;
        label: string;
        x: number;
        y: number;
        width?: number;
        height?: number;
        rotation: number;
        status: string;
        bindingId: string | null;
        bindingRevision: number | null;
        endpointId: string | null;
    }>;
}

function sameClassroomRefs(left: ExamSeatAssignmentV2Doc['classrooms'], right: ExamSeatAssignmentV2Doc['classrooms']): boolean {
    return (
        left.length === right.length &&
        left.every(
            (classroom, index) =>
                classroom.classroomId.equals(right[index].classroomId) &&
                classroom.layoutRevision === right[index].layoutRevision &&
                classroom.layoutFingerprint === right[index].layoutFingerprint &&
                classroom.profileRevision === right[index].profileRevision &&
                classroom.profileFingerprint === right[index].profileFingerprint &&
                JSON.stringify(classroom.candidateSeatIds) === JSON.stringify(right[index].candidateSeatIds),
        )
    );
}

abstract class ExamSeatAssignmentBaseHandler extends Handler {
    async prepare() {
        if (!this.user || this.user._id < 1) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user)) {
            if (!this.user.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
            if (!this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
                throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
            }
        }
        await Promise.all([
            examEventService.ensureIndexes(),
            examClassroomService.ensureIndexes(),
            examSeatPlanService.ensureIndexes(),
            examSeatAssignmentService.ensureIndexes(),
            endpointSeatBindingService.ensureIndexes(),
        ]);
    }

    protected async event(eventId: ObjectId): Promise<ExamEventDoc> {
        const domainId = String(this.domain._id);
        const event = await examEventService.get(domainId, eventId);
        if (!event) throw new ValidationError('eventId');
        if (!['krypton', 'external'].includes(event.type) || !['draft', 'scheduled', 'archived'].includes(event.lifecycle)) {
            throw new ValidationError('eventId', null, localizedErrorText`Invalid request: ${'event_canonical_invalid'}`);
        }
        await assertCanManageExamEvent(domainId, event, this.user);
        if (!isExamInfrastructureAdmin(this.user) && !this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
            throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
        }
        return event;
    }

    protected assertWritableEvent(event: ExamEventDoc): void {
        if (event.lifecycle === 'archived') throw new ValidationError('eventId', null, localizedErrorText`Invalid request: ${'event_archived'}`);
    }

    protected async rosterGroups(event: ExamEventDoc): Promise<Array<{ groupId: string; name: string }>> {
        const userbind = global.Hydro.model.userbind;
        if (!userbind || typeof userbind.listUserGroups !== 'function') throw new ExamSeatAssignmentError('userbind_group_resolver_unavailable');
        const groups = await userbind.listUserGroups(event.domainId, event.schoolId);
        return groups
            .map((group) => {
                if (
                    !(group._id instanceof ObjectId) ||
                    group.domainId !== event.domainId ||
                    !(group.schoolId instanceof ObjectId) ||
                    !group.schoolId.equals(event.schoolId) ||
                    typeof group.name !== 'string' ||
                    !group.name.trim() ||
                    group.name !== group.name.trim() ||
                    group.name.length > 128 ||
                    (group.archivedAt !== undefined && group.archivedAt !== null && !(group.archivedAt instanceof Date))
                ) {
                    throw new ExamSeatAssignmentError('userbind_group_canonical_invalid');
                }
                return group.archivedAt ? null : { groupId: group._id.toHexString(), name: group.name };
            })
            .filter((group): group is { groupId: string; name: string } => group !== null)
            .sort((left, right) => (left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0));
    }

    protected async source(event: ExamEventDoc, seatPlanRevision: number, requireCurrentLayout = true): Promise<AssignmentSource> {
        const domainId = String(this.domain._id);
        const seatPlan = await examSeatPlanService.getSeatPlanRevision(domainId, event._id, seatPlanRevision);
        if (!seatPlan || !seatPlan.schoolId.equals(event.schoolId) || !seatPlan.roster) throw new ExamSeatAssignmentError('seat_plan_not_found');
        if (isExamSeatPlanV2(seatPlan)) throw new ExamSeatAssignmentError('seat_plan_v2_writer_required');
        const roster = await examSeatPlanService.getRosterRevision(domainId, event._id, seatPlan.roster.revision);
        if (
            !roster ||
            !roster._id.equals(seatPlan.roster.rosterId) ||
            roster.fingerprint !== seatPlan.roster.fingerprint ||
            !roster.schoolId.equals(event.schoolId)
        ) {
            throw new ExamSeatAssignmentError('assignment_roster_missing');
        }
        const classroom = await examClassroomService.get(domainId, seatPlan.classroomId, !requireCurrentLayout);
        if (!classroom || !classroom.schoolId.equals(event.schoolId)) throw new ExamSeatAssignmentError('assignment_classroom_missing');
        if (requireCurrentLayout && classroom.layoutRevision !== seatPlan.layoutRevision) {
            throw new ExamSeatAssignmentError('layout_revision_changed');
        }
        const layout = examClassroomService.layout(classroom, seatPlan.layoutRevision).snapshot;
        if (layout.fingerprint !== seatPlan.layoutFingerprint) throw new ExamSeatAssignmentError('layout_fingerprint_changed');
        const layoutSeats = new Map(layout.seats.map((seat) => [seat.sourceSeatId, seat]));
        if (seatPlan.candidateSeatIds.some((seatId) => !layoutSeats.has(seatId))) throw new ExamSeatAssignmentError('candidate_seat_missing');
        const bindings = await endpointSeatBindingService.listClassroomBindings(domainId, seatPlan.classroomId);
        const bindingBySeat = new Map(bindings.map((binding) => [binding.sourceSeatId, binding]));
        const seats = seatPlan.candidateSeatIds.map((sourceSeatId) => {
            const seat = layoutSeats.get(sourceSeatId)!;
            const binding = bindingBySeat.get(sourceSeatId);
            const active = binding && binding.status === 'active' && binding.endpointId ? binding : null;
            return {
                ...seat,
                bindingId: active?._id.toHexString() || null,
                bindingRevision: active?.revision || null,
                endpointId: active?.endpointId || null,
            };
        });
        return {
            seatPlan,
            roster,
            seatFacts: seats.map((seat) => ({
                sourceSeatId: seat.sourceSeatId,
                status: seat.status,
                bindingId: seat.bindingId ? new ObjectId(seat.bindingId) : null,
                bindingRevision: seat.bindingRevision,
                endpointId: seat.endpointId,
            })),
            seats,
        };
    }

    protected async assertStoredReferences(event: ExamEventDoc, assignment: ExamSeatAssignmentRevisionDoc): Promise<void> {
        if (isExamSeatAssignmentV2(assignment)) {
            await this.assertStoredV2References(event, assignment);
            return;
        }
        const source = await this.source(event, assignment.seatPlan.revision, false);
        const rosterUids = source.roster.entries.map((entry) => entry.boundUserId).sort((left, right) => left - right);
        const assignedUids = assignment.assignments.map((row) => row.boundUserId).sort((left, right) => left - right);
        if (
            !assignment.schoolId.equals(event.schoolId) ||
            assignment.eventRevision > event.revision ||
            !source.seatPlan._id.equals(assignment.seatPlan.seatPlanId) ||
            source.seatPlan.fingerprint !== assignment.seatPlan.fingerprint ||
            !source.roster._id.equals(assignment.roster.rosterId) ||
            source.roster.fingerprint !== assignment.roster.fingerprint ||
            !source.seatPlan.classroomId.equals(assignment.classroomId) ||
            source.seatPlan.layoutRevision !== assignment.layoutRevision ||
            source.seatPlan.layoutFingerprint !== assignment.layoutFingerprint ||
            JSON.stringify(source.seatPlan.candidateSeatIds) !== JSON.stringify(assignment.candidateSeatIds) ||
            JSON.stringify(rosterUids) !== JSON.stringify(assignedUids)
        ) {
            throw new ExamSeatAssignmentError('assignment_reference_drift');
        }
    }

    protected async assertV1WriterEnabled(domainId: string, eventId: ObjectId): Promise<ExamSeatAssignmentRevisionDoc | null> {
        const [latestSeatPlan, latestAssignment] = await Promise.all([
            examSeatPlanService.latestSeatPlanRevision(domainId, eventId),
            examSeatAssignmentService.latestRevision(domainId, eventId),
        ]);
        if ((latestSeatPlan && isExamSeatPlanV2(latestSeatPlan)) || (latestAssignment && isExamSeatAssignmentV2(latestAssignment))) {
            throw new ExamSeatAssignmentError('assignment_v2_writer_required');
        }
        return latestAssignment;
    }

    private async assertStoredV2References(event: ExamEventDoc, assignment: ExamSeatAssignmentV2Doc): Promise<void> {
        const domainId = String(this.domain._id);
        const [seatPlan, roster] = await Promise.all([
            examSeatPlanService.getSeatPlanRevision(domainId, event._id, assignment.seatPlan.revision),
            examSeatPlanService.getRosterRevision(domainId, event._id, assignment.roster.revision),
        ]);
        if (
            !seatPlan ||
            !isExamSeatPlanV2(seatPlan) ||
            !roster ||
            !assignment.schoolId.equals(event.schoolId) ||
            assignment.eventRevision > event.revision ||
            !seatPlan.schoolId.equals(event.schoolId) ||
            !seatPlan._id.equals(assignment.seatPlan.seatPlanId) ||
            seatPlan.fingerprint !== assignment.seatPlan.fingerprint ||
            !seatPlanMatchesAssignmentRoster(seatPlan, assignment) ||
            !roster.schoolId.equals(event.schoolId) ||
            !roster._id.equals(assignment.roster.rosterId) ||
            roster.fingerprint !== assignment.roster.fingerprint ||
            !sameClassroomRefs(seatPlan.classrooms, assignment.classrooms)
        ) {
            throw new ExamSeatAssignmentError('assignment_reference_drift');
        }
        const rosterByUid = new Map(roster.entries.map((entry) => [entry.boundUserId, entry]));
        if (
            assignment.participants.length !== roster.entries.length ||
            assignment.participants.some((participant) => {
                const entry = rosterByUid.get(participant.boundUserId);
                return !entry || !entry.studentRecordId.equals(participant.studentRecordId) || entry.studentId !== participant.studentId;
            })
        ) {
            throw new ExamSeatAssignmentError('assignment_reference_drift');
        }
        const seatFacts = new Map(assignment.seatFacts.map((fact) => [`${fact.classroomId.toHexString()}\u0000${fact.sourceSeatId}`, fact]));
        for (const classroomRef of assignment.classrooms) {
            const classroom = await examClassroomService.get(domainId, classroomRef.classroomId, true);
            if (!classroom || !classroom.schoolId.equals(event.schoolId)) throw new ExamSeatAssignmentError('assignment_reference_drift');
            const layout = examClassroomService.layout(classroom, classroomRef.layoutRevision).snapshot;
            if (layout.fingerprint !== classroomRef.layoutFingerprint) throw new ExamSeatAssignmentError('assignment_reference_drift');
            const profile = await examSeatOperationalProfileService.getRevision(
                domainId,
                classroomRef.classroomId,
                classroomRef.layoutRevision,
                classroomRef.profileRevision,
            );
            if (!profile || profile.fingerprint !== classroomRef.profileFingerprint || !profile.schoolId.equals(event.schoolId)) {
                throw new ExamSeatAssignmentError('assignment_reference_drift');
            }
            const layoutBySeat = new Map(layout.seats.map((seat) => [seat.sourceSeatId, seat]));
            const profileBySeat = new Map(profile.entries.map((entry) => [entry.sourceSeatId, entry]));
            const bindings = await endpointSeatBindingService.listClassroomBindings(domainId, classroomRef.classroomId);
            const bindingById = new Map(bindings.map((binding) => [binding._id.toHexString(), binding]));
            for (const sourceSeatId of classroomRef.candidateSeatIds) {
                const layoutSeat = layoutBySeat.get(sourceSeatId);
                const profileSeat = profileBySeat.get(sourceSeatId);
                const fact = seatFacts.get(`${classroomRef.classroomId.toHexString()}\u0000${sourceSeatId}`);
                const binding = fact?.bindingId ? bindingById.get(fact.bindingId.toHexString()) : null;
                if (
                    !layoutSeat ||
                    !profileSeat ||
                    !fact ||
                    fact.label !== layoutSeat.label ||
                    fact.x !== layoutSeat.x ||
                    fact.y !== layoutSeat.y ||
                    (fact.width ?? null) !== (layoutSeat.width ?? null) ||
                    (fact.height ?? null) !== (layoutSeat.height ?? null) ||
                    fact.rotation !== layoutSeat.rotation ||
                    fact.layoutStatus !== layoutSeat.status ||
                    fact.enabled !== profileSeat.enabled ||
                    fact.facing !== profileSeat.facing ||
                    fact.disabledReason !== profileSeat.disabledReason ||
                    !seatFactMatchesBindingHistory(domainId, event.schoolId, fact, binding || null)
                ) {
                    throw new ExamSeatAssignmentError('assignment_reference_drift');
                }
            }
        }
    }

    protected displaySourceFromV2(assignment: ExamSeatAssignmentV2Doc): AssignmentDisplaySource {
        return {
            schemaVersion: 2,
            seatPlanRevision: assignment.seatPlan.revision,
            seats: assignment.seatFacts.map((fact) => ({
                classroomId: fact.classroomId.toHexString(),
                sourceSeatId: fact.sourceSeatId,
                label: fact.label,
                x: fact.x,
                y: fact.y,
                ...(fact.width === null ? {} : { width: fact.width }),
                ...(fact.height === null ? {} : { height: fact.height }),
                rotation: fact.rotation,
                status: fact.layoutStatus,
                bindingId: fact.bindingId?.toHexString() || null,
                bindingRevision: fact.bindingRevision,
                endpointId: fact.endpointId,
            })),
        };
    }

    protected displaySourceFromV1(source: AssignmentSource): AssignmentDisplaySource {
        return {
            schemaVersion: 1,
            seatPlanRevision: source.seatPlan.revision,
            seats: source.seats.map((seat) => ({ ...seat, classroomId: source.seatPlan.classroomId.toHexString() })),
        };
    }
}

class ExamSeatAssignmentCollectionHandler extends ExamSeatAssignmentBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const event = await this.event(eventId);
        const domainId = String(this.domain._id);
        const [assignments, publication, seatPlans, rosterGroups, classrooms] = await Promise.all([
            examSeatAssignmentService.listRevisions(domainId, eventId).toArray(),
            examSeatAssignmentService.getPublication(domainId, eventId),
            examSeatPlanService.listSeatPlans(domainId, eventId).toArray(),
            this.rosterGroups(event),
            examClassroomService.listDomain(domainId, false, 500).toArray(),
        ]);
        for (const assignment of assignments) {
            assertExamSeatAssignmentIntegrity(assignment);
            await this.assertStoredReferences(event, assignment);
        }
        if (publication) {
            const published = await examSeatAssignmentService.getRevision(domainId, eventId, publication.assignment.revision);
            if (
                !published ||
                !published._id.equals(publication.assignment.assignmentId) ||
                published.fingerprint !== publication.assignment.fingerprint
            ) {
                throw new ExamSeatAssignmentError('assignment_publication_reference_drift');
            }
            if (!assignments.some((assignment) => assignment._id.equals(published._id))) await this.assertStoredReferences(event, published);
        }
        let latestSeatPlanState: 'current' | 'layout-drift' | 'not-ready' = 'not-ready';
        let latestPlanSource: AssignmentSource | null = null;
        if (seatPlans[0]?.roster) {
            const latestPlan = seatPlans[0];
            if (isExamSeatPlanV2(latestPlan)) {
                const currentFacts = await Promise.all(
                    latestPlan.classrooms.map(async (classroomRef) => {
                        const classroom = await examClassroomService.get(domainId, classroomRef.classroomId);
                        if (
                            !classroom ||
                            !classroom.schoolId.equals(event.schoolId) ||
                            classroom.layoutRevision !== classroomRef.layoutRevision ||
                            examClassroomService.layout(classroom).snapshot.fingerprint !== classroomRef.layoutFingerprint
                        ) {
                            return false;
                        }
                        const profile = await examSeatOperationalProfileService.getCurrent(domainId, classroomRef.classroomId);
                        return profile.revision === classroomRef.profileRevision && profile.fingerprint === classroomRef.profileFingerprint;
                    }),
                );
                latestSeatPlanState = currentFacts.every(Boolean) ? 'current' : 'layout-drift';
            } else {
                latestPlanSource = await this.source(event, latestPlan.revision, false);
                const activeClassroom = await examClassroomService.get(domainId, latestPlanSource.seatPlan.classroomId);
                latestSeatPlanState =
                    activeClassroom &&
                    activeClassroom.schoolId.equals(event.schoolId) &&
                    activeClassroom.layoutRevision === latestPlanSource.seatPlan.layoutRevision
                        ? 'current'
                        : 'layout-drift';
            }
        }
        let currentSource: AssignmentDisplaySource | null = null;
        if (assignments.length) {
            currentSource = isExamSeatAssignmentV2(assignments[0])
                ? this.displaySourceFromV2(assignments[0])
                : this.displaySourceFromV1(await this.source(event, assignments[0].seatPlan.revision, false));
        } else if (latestPlanSource) currentSource = this.displaySourceFromV1(latestPlanSource);
        const endpointIds = currentSource?.seats.flatMap((seat) => (seat.endpointId ? [seat.endpointId] : [])) || [];
        let endpointPreflight: { state: 'available' | 'not-required' | 'unavailable'; items: unknown[] };
        if (!endpointIds.length) endpointPreflight = { state: 'not-required', items: [] };
        else {
            try {
                endpointPreflight = { state: 'available', items: await preflightExamNetworkOnVigil(endpointIds) };
            } catch (error) {
                logger.warn(
                    'Exam seat assignment live status unavailable event=%s stage=preflight reason=%s',
                    eventId.toHexString(),
                    error instanceof Error ? error.name : 'unknown_error',
                );
                endpointPreflight = { state: 'unavailable', items: [] };
            }
        }
        this.response.body = {
            assignments: assignments.map((assignment) => serializeAssignment(assignment, publication?.assignment.revision || null)),
            publication: publication
                ? {
                      revision: publication.revision,
                      assignmentId: publication.assignment.assignmentId.toHexString(),
                      assignmentRevision: publication.assignment.revision,
                      assignmentFingerprint: publication.assignment.fingerprint,
                      updatedAt: publication.updatedAt.toISOString(),
                      updatedBy: publication.updatedBy,
                  }
                : null,
            source: currentSource,
            endpointPreflight,
            latestSeatPlanState,
            rosterGroups,
            classrooms: classrooms
                .filter((classroom) => classroom.schoolId.equals(event.schoolId))
                .map((classroom) => ({
                    classroomId: classroom._id.toHexString(),
                    name: classroom.name,
                    layoutRevision: classroom.layoutRevision,
                    seatCount: examClassroomService.layout(classroom, classroom.layoutRevision).snapshot.seats.length,
                })),
        };
    }

    @param('eventId', Types.ObjectId)
    @param('action', Types.Range(['adjust', 'generate', 'publish', 'rerandomize']))
    @param('mode', Types.Range(['random', 'studentId']), true)
    @param('seatPlanRevision', Types.PositiveInt, true)
    @param('baseAssignmentRevision', Types.PositiveInt, true)
    @param('assignmentRevision', Types.PositiveInt, true)
    @param('expectedPublicationRevision', Types.UnsignedInt, true)
    @param('lockedUids', Types.NumericArray, true)
    @param('mappings', Types.Any, true)
    async post(
        _args: unknown,
        eventId: ObjectId,
        action: 'adjust' | 'generate' | 'publish' | 'rerandomize',
        mode?: 'random' | 'studentId',
        seatPlanRevision = 0,
        baseAssignmentRevision = 0,
        assignmentRevision = 0,
        expectedPublicationRevision = 0,
        lockedUids: number[] = [],
        mappings: unknown = [],
    ) {
        const domainId = String(this.domain._id);
        try {
            if (action === 'publish') {
                exactBody(this.request.body, ['action', 'assignmentRevision', 'expectedPublicationRevision']);
                const publication = await withExamEventBoundary(domainId, eventId, async () => {
                    const current = await this.event(eventId);
                    this.assertWritableEvent(current);
                    await this.assertV1WriterEnabled(domainId, eventId);
                    const assignment = await examSeatAssignmentService.getRevision(domainId, eventId, assignmentRevision);
                    if (!assignment) throw new ExamSeatAssignmentError('assignment_not_found');
                    if (isExamSeatAssignmentV2(assignment)) throw new ExamSeatAssignmentError('assignment_v2_writer_required');
                    const source = await this.source(current, assignment.seatPlan.revision);
                    if (
                        !source.seatPlan._id.equals(assignment.seatPlan.seatPlanId) ||
                        source.seatPlan.fingerprint !== assignment.seatPlan.fingerprint ||
                        !source.roster._id.equals(assignment.roster.rosterId) ||
                        source.roster.fingerprint !== assignment.roster.fingerprint
                    ) {
                        throw new ExamSeatAssignmentError('assignment_reference_drift');
                    }
                    const rebuilt = buildExamSeatAssignment({
                        roster: source.roster,
                        seatPlan: source.seatPlan,
                        seatFacts: source.seatFacts,
                        mode: assignment.constraints.mode,
                        seed: assignment.seed,
                        lockedAssignments: assignment.constraints.lockedAssignments,
                        manualAssignments: assignment.constraints.manualAssignments,
                    });
                    if (
                        !rebuilt.ok ||
                        JSON.stringify(rebuilt.assignments) !== JSON.stringify(assignment.assignments) ||
                        JSON.stringify(rebuilt.eligibleSeatIds) !== JSON.stringify(assignment.eligibleSeatIds) ||
                        JSON.stringify(rebuilt.diagnostics) !== JSON.stringify(assignment.diagnostics)
                    ) {
                        throw new ExamSeatAssignmentError('assignment_source_changed');
                    }
                    return examSeatAssignmentService.publishRevision({
                        domainId,
                        eventId,
                        assignmentRevision,
                        expectedPublicationRevision,
                        actorUid: this.user._id,
                    });
                });
                await OplogModel.log(this, 'exam.seat_assignment.publish', {
                    eventId,
                    publicationRevision: publication.revision,
                    assignmentRevision: publication.assignment.revision,
                    assignmentFingerprint: publication.assignment.fingerprint,
                });
                logger.info(
                    'Exam seat assignment published event=%s publicationRevision=%d assignmentRevision=%d fingerprint=%s',
                    eventId.toHexString(),
                    publication.revision,
                    publication.assignment.revision,
                    publication.assignment.fingerprint,
                );
                this.response.body = { publicationRevision: publication.revision, assignmentRevision: publication.assignment.revision };
                return;
            }

            let created: Awaited<ReturnType<typeof examSeatAssignmentService.createRevision>>;
            if (action === 'generate') {
                exactBody(this.request.body, ['action', 'mode', 'seatPlanRevision']);
                if (!mode || !seatPlanRevision) throw new ValidationError('seatPlanRevision');
                created = await withExamEventBoundary(domainId, eventId, async () => {
                    const current = await this.event(eventId);
                    this.assertWritableEvent(current);
                    const latest = await this.assertV1WriterEnabled(domainId, eventId);
                    const source = await this.source(current, seatPlanRevision);
                    let inheritedLocks: ExamSeatAssignmentMapping[] = [];
                    if (latest) {
                        if (isExamSeatAssignmentV2(latest)) throw new ExamSeatAssignmentError('assignment_v2_writer_required');
                        if (
                            latest.seatPlan.seatPlanId.equals(source.seatPlan._id) &&
                            latest.seatPlan.revision === source.seatPlan.revision &&
                            latest.seatPlan.fingerprint === source.seatPlan.fingerprint
                        ) {
                            inheritedLocks = latest.constraints.lockedAssignments;
                        }
                    }
                    return examSeatAssignmentService.createRevision({
                        domainId,
                        eventId,
                        eventRevision: current.revision,
                        schoolId: current.schoolId,
                        actorUid: this.user._id,
                        expectedPreviousRevision: latest?.revision || 0,
                        roster: source.roster,
                        seatPlan: source.seatPlan,
                        seatFacts: source.seatFacts,
                        mode,
                        seed: latest?.seed || examSeatAssignmentService.newSeed(),
                        lockedAssignments: inheritedLocks,
                        manualAssignments: [],
                    });
                });
            } else {
                if (!baseAssignmentRevision) throw new ValidationError('baseAssignmentRevision');
                if (action === 'adjust') exactBody(this.request.body, ['action', 'baseAssignmentRevision', 'lockedUids', 'mappings']);
                else exactBody(this.request.body, ['action', 'baseAssignmentRevision']);
                created = await withExamEventBoundary(domainId, eventId, async () => {
                    const current = await this.event(eventId);
                    this.assertWritableEvent(current);
                    await this.assertV1WriterEnabled(domainId, eventId);
                    const base = await examSeatAssignmentService.getRevision(domainId, eventId, baseAssignmentRevision);
                    if (!base) throw new ExamSeatAssignmentError('assignment_not_found');
                    if (isExamSeatAssignmentV2(base)) throw new ExamSeatAssignmentError('assignment_v2_writer_required');
                    const source = await this.source(current, base.seatPlan.revision);
                    if (
                        !source.seatPlan._id.equals(base.seatPlan.seatPlanId) ||
                        source.seatPlan.fingerprint !== base.seatPlan.fingerprint ||
                        !source.roster._id.equals(base.roster.rosterId) ||
                        source.roster.fingerprint !== base.roster.fingerprint
                    ) {
                        throw new ExamSeatAssignmentError('assignment_reference_drift');
                    }
                    let lockedAssignments: ExamSeatAssignmentMapping[];
                    let manualAssignments: ExamSeatAssignmentMapping[];
                    let seed: string;
                    let nextMode = base.constraints.mode;
                    if (action === 'adjust') {
                        if (lockedUids.some((uid) => !Number.isSafeInteger(uid) || uid <= 1) || new Set(lockedUids).size !== lockedUids.length) {
                            throw new ValidationError('lockedUids');
                        }
                        manualAssignments = requestMappings(mappings);
                        const manualByUid = new Map(manualAssignments.map((row) => [row.boundUserId, row]));
                        lockedAssignments = lockedUids.map((uid) => {
                            const row = manualByUid.get(uid);
                            if (!row) throw new ValidationError('lockedUids');
                            return row;
                        });
                        seed = base.seed;
                    } else {
                        lockedAssignments = base.constraints.lockedAssignments;
                        manualAssignments = [];
                        seed = examSeatAssignmentService.newSeed();
                        nextMode = 'random';
                    }
                    return examSeatAssignmentService.createRevision({
                        domainId,
                        eventId,
                        eventRevision: current.revision,
                        schoolId: current.schoolId,
                        actorUid: this.user._id,
                        expectedPreviousRevision: baseAssignmentRevision,
                        roster: source.roster,
                        seatPlan: source.seatPlan,
                        seatFacts: source.seatFacts,
                        mode: nextMode,
                        seed,
                        lockedAssignments,
                        manualAssignments,
                    });
                });
            }
            if (created.assignment) {
                await OplogModel.log(this, 'exam.seat_assignment.create', {
                    eventId,
                    assignmentRevision: created.assignment.revision,
                    seatPlanRevision: created.assignment.seatPlan.revision,
                    rosterRevision: created.assignment.roster.revision,
                    assignmentCount: created.assignment.assignments.length,
                    lockedCount: created.assignment.constraints.lockedAssignments.length,
                    diagnosticCodes: created.assignment.diagnostics.map((diagnostic) => diagnostic.code),
                    fingerprint: created.assignment.fingerprint,
                });
                logger.info(
                    'Exam seat assignment created event=%s revision=%d assignments=%d locked=%d diagnostics=%s fingerprint=%s',
                    eventId.toHexString(),
                    created.assignment.revision,
                    created.assignment.assignments.length,
                    created.assignment.constraints.lockedAssignments.length,
                    created.assignment.diagnostics.map((diagnostic) => diagnostic.code).join(',') || '-',
                    created.assignment.fingerprint,
                );
            } else {
                logger.info(
                    'Exam seat assignment blocked event=%s diagnostics=%s',
                    eventId.toHexString(),
                    created.diagnostics.map((diagnostic) => diagnostic.code).join(','),
                );
            }
            this.response.body = {
                assignment: created.assignment ? serializeAssignment(created.assignment, null) : null,
                diagnostics: created.diagnostics.map((diagnostic) => ({ ...diagnostic })),
            };
        } catch (error) {
            translate(error);
        }
    }
}

class ExamSeatAssignmentClassroomSourceHandler extends ExamSeatAssignmentBaseHandler {
    @param('eventId', Types.ObjectId)
    @param('classroomId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId, classroomId: ObjectId) {
        const event = await this.event(eventId);
        const domainId = String(this.domain._id);
        const classroom = await examClassroomService.get(domainId, classroomId);
        if (!classroom || !classroom.schoolId.equals(event.schoolId)) throw new ValidationError('classroomId');
        const layout = examClassroomService.layout(classroom, classroom.layoutRevision).snapshot;
        const bindings = await endpointSeatBindingService.listClassroomBindings(domainId, classroomId);
        const activeBySeat = new Map(
            bindings.filter((binding) => binding.status === 'active' && binding.endpointId).map((binding) => [binding.sourceSeatId, binding]),
        );
        this.response.body = {
            classroomId: classroom._id.toHexString(),
            layoutRevision: classroom.layoutRevision,
            layoutFingerprint: layout.fingerprint,
            seats: layout.seats.map((seat) => {
                const binding = activeBySeat.get(seat.sourceSeatId);
                return {
                    sourceSeatId: seat.sourceSeatId,
                    label: seat.label,
                    status: seat.status,
                    bindingId: binding?._id.toHexString() || null,
                    bindingRevision: binding?.revision || null,
                    endpointId: binding?.endpointId || null,
                };
            }),
        };
    }
}

class ExamSeatAssignmentPageHandler extends ExamSeatAssignmentBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        await this.event(eventId);
        this.response.template = 'admin_exam_seats.html';
        this.response.body = { eventId: eventId.toHexString(), canManage: true };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('exam_seat_assignment_collection', '/api/admin/exam-events/:eventId/seat-assignments', ExamSeatAssignmentCollectionHandler);
    ctx.Route(
        'exam_seat_assignment_classroom_source',
        '/api/admin/exam-events/:eventId/seat-assignment-classrooms/:classroomId',
        ExamSeatAssignmentClassroomSourceHandler,
    );
    ctx.Route('exam_seat_assignment_page', '/admin/exam-infrastructure/events/:eventId/seats', ExamSeatAssignmentPageHandler);
}
