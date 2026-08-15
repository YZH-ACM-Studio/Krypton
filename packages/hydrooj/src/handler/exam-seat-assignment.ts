import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, localizedErrorText, OplogModel, param, PermissionError, Types, ValidationError } from 'hydrooj';
import { PERM } from '../model/builtin';
import { examClassroomService } from '../model/exam-classroom';
import {
    ExamAssignmentSeatFact,
    ExamSeatAssignmentError,
    ExamSeatAssignmentParticipantFact,
    ExamSeatAssignmentRevisionDoc,
    ExamSeatAssignmentStrategy,
    ExamSeatAssignmentV2Doc,
    ExamSeatAssignmentV2Mapping,
    ExamSeatAssignmentV2SeatFact,
    assertExamSeatAssignmentIntegrity,
    examSeatAssignmentService,
    isExamSeatAssignmentV2,
    seatFactMatchesBindingHistory,
    seatPlanMatchesAssignmentRoster,
} from '../model/exam-seat-assignment';
import * as contestModel from '../model/contest';
import { listTeams as listContestTeams } from '../model/contest-team';
import { ExamEventDoc, examEventService } from '../model/exam-event';
import { assertCanManageExamEvent, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { endpointSeatBindingService } from '../model/endpoint-seat-binding';
import { examSeatOperationalProfileService } from '../model/exam-seat-operational-profile';
import { assertExamContestAudienceRosterCurrent, getExamContestAudienceState, resolveExamRosterForEvent } from '../model/exam-roster-resolver';
import {
    ExamRosterRevisionDoc,
    ExamSeatPlanError,
    ExamSeatPlanV1Doc,
    ExamSeatPlanV2Doc,
    examSeatPlanService,
    isExamSeatPlanV2,
} from '../model/exam-seat-plan';
import { classifyVigilBridgeFailure, preflightExamNetworkOnVigil } from '../service/vigil-bridge';

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

function requestV2Mappings(value: unknown): ExamSeatAssignmentV2Mapping[] {
    if (!Array.isArray(value) || value.length > 500) throw new ValidationError('mappings');
    return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('mappings');
        const row = item as Record<string, unknown>;
        const seat = row.seat;
        if (
            Object.keys(row).length !== 2 ||
            !Object.hasOwn(row, 'boundUserId') ||
            !Object.hasOwn(row, 'seat') ||
            typeof row.boundUserId !== 'number' ||
            !Number.isSafeInteger(row.boundUserId) ||
            row.boundUserId <= 1 ||
            !seat ||
            typeof seat !== 'object' ||
            Array.isArray(seat)
        ) {
            throw new ValidationError('mappings');
        }
        const seatRow = seat as Record<string, unknown>;
        if (
            Object.keys(seatRow).length !== 2 ||
            !Object.hasOwn(seatRow, 'classroomId') ||
            !Object.hasOwn(seatRow, 'sourceSeatId') ||
            typeof seatRow.classroomId !== 'string' ||
            !ObjectId.isValid(seatRow.classroomId) ||
            new ObjectId(seatRow.classroomId).toHexString() !== seatRow.classroomId ||
            typeof seatRow.sourceSeatId !== 'string' ||
            !seatRow.sourceSeatId.trim() ||
            seatRow.sourceSeatId !== seatRow.sourceSeatId.trim() ||
            seatRow.sourceSeatId.length > 128
        ) {
            throw new ValidationError('mappings');
        }
        return {
            boundUserId: row.boundUserId,
            seat: { classroomId: new ObjectId(seatRow.classroomId), sourceSeatId: seatRow.sourceSeatId },
        };
    });
}

function serializeDiagnostic(diagnostic: Record<string, unknown>): Record<string, unknown> {
    if (diagnostic.code !== 'seat_skipped') return { ...diagnostic };
    const seats = diagnostic.seats;
    if (!Array.isArray(seats)) throw new ExamSeatAssignmentError('assignment_diagnostic_invalid');
    return {
        code: 'seat_skipped',
        seats: seats.map((item) => {
            const row = item as { reason: string; seat: { classroomId: ObjectId; sourceSeatId: string } };
            return {
                reason: row.reason,
                seat: { classroomId: row.seat.classroomId.toHexString(), sourceSeatId: row.seat.sourceSeatId },
            };
        }),
    };
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

interface AssignmentV2Source {
    seatPlan: ExamSeatPlanV2Doc;
    roster: ExamRosterRevisionDoc;
    participants: ExamSeatAssignmentParticipantFact[];
    seatFacts: ExamSeatAssignmentV2SeatFact[];
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

    private async participants(event: ExamEventDoc, roster: ExamRosterRevisionDoc): Promise<ExamSeatAssignmentParticipantFact[]> {
        const base = roster.entries.map((entry) => ({
            boundUserId: entry.boundUserId,
            studentRecordId: new ObjectId(entry.studentRecordId),
            studentId: entry.studentId,
            teamId: null,
            teamRole: null,
        })) satisfies ExamSeatAssignmentParticipantFact[];
        if (roster.source.kind === 'contestAudience') {
            if (event.type !== 'krypton' || !event.contestId || !roster.source.contestId?.equals(event.contestId)) {
                throw new ExamSeatAssignmentError('assignment_roster_source_changed');
            }
        }
        if (event.type !== 'krypton' || !event.contestId) return base;
        const contest = await contestModel.get(event.domainId, event.contestId);
        const contestId = contest.docId || contest._id;
        if (contest.domainId !== event.domainId || !(contestId instanceof ObjectId) || !contestId.equals(event.contestId)) {
            throw new ExamSeatAssignmentError('assignment_contest_identity_mismatch');
        }
        if (contestModel.getParticipationMode(contest) !== 'team') return base;
        if (contest.rule !== 'acm' || (contest.plannedTeamBatchId && !contest.teamBatchId) || roster.source.kind !== 'contestAudience') {
            throw new ExamSeatAssignmentError('assignment_team_roster_invalid');
        }
        const currentRosterBeforeTeams = await resolveExamRosterForEvent(event, { kind: 'contestAudience' });
        const storedEntries = roster.entries.map((entry) => [entry.boundUserId, entry.studentRecordId.toHexString(), entry.studentId]);
        const teams = await listContestTeams(event.domainId, event.contestId);
        const currentRosterAfterTeams = await resolveExamRosterForEvent(event, { kind: 'contestAudience' });
        for (const currentRoster of [currentRosterBeforeTeams, currentRosterAfterTeams]) {
            const currentEntries = currentRoster.entries.map((entry) => [entry.boundUserId, entry.studentRecordId.toHexString(), entry.studentId]);
            if (
                roster.source.sourceFingerprint !== currentRoster.source.sourceFingerprint ||
                JSON.stringify(storedEntries) !== JSON.stringify(currentEntries)
            ) {
                throw new ExamSeatAssignmentError('assignment_roster_source_changed');
            }
        }
        const teamByUid = new Map<number, { teamId: string; role: 'captain' | 'member' }>();
        for (const team of teams) {
            if (
                !(team.teamId instanceof ObjectId) ||
                !Array.isArray(team.memberUids) ||
                team.memberUids.length < 1 ||
                team.memberUids.length > 3 ||
                !team.memberUids.includes(team.captainUid)
            ) {
                throw new ExamSeatAssignmentError('assignment_team_roster_invalid');
            }
            for (const uid of team.memberUids) {
                if (!Number.isSafeInteger(uid) || uid <= 1 || teamByUid.has(uid)) {
                    throw new ExamSeatAssignmentError('assignment_team_roster_invalid');
                }
                teamByUid.set(uid, { teamId: team.teamId.toHexString(), role: uid === team.captainUid ? 'captain' : 'member' });
            }
        }
        if (teamByUid.size !== base.length || base.some((participant) => !teamByUid.has(participant.boundUserId))) {
            throw new ExamSeatAssignmentError('assignment_team_roster_invalid');
        }
        return base.map((participant) => {
            const team = teamByUid.get(participant.boundUserId)!;
            return { ...participant, teamId: team.teamId, teamRole: team.role };
        });
    }

    protected async sourceV2(event: ExamEventDoc, seatPlanRevision: number): Promise<AssignmentV2Source> {
        const domainId = String(this.domain._id);
        if (event.type === 'krypton' && (await getExamContestAudienceState(event)) !== 'fixed') {
            throw new ExamSeatAssignmentError('assignment_roster_source_changed');
        }
        const seatPlan = await examSeatPlanService.getSeatPlanRevision(domainId, event._id, seatPlanRevision);
        if (!seatPlan || !isExamSeatPlanV2(seatPlan) || !seatPlan.schoolId.equals(event.schoolId) || !seatPlan.roster) {
            throw new ExamSeatAssignmentError('seat_plan_v2_not_found');
        }
        const roster = await examSeatPlanService.getRosterRevision(domainId, event._id, seatPlan.roster.revision);
        if (
            !roster ||
            !roster._id.equals(seatPlan.roster.rosterId) ||
            roster.fingerprint !== seatPlan.roster.fingerprint ||
            !roster.schoolId.equals(event.schoolId)
        ) {
            throw new ExamSeatAssignmentError('assignment_roster_missing');
        }
        await assertExamContestAudienceRosterCurrent(event, roster);
        const seatFactsByClassroom = await Promise.all(
            seatPlan.classrooms.map(async (classroomRef) => {
                const classroom = await examClassroomService.get(domainId, classroomRef.classroomId);
                if (!classroom || !classroom.schoolId.equals(event.schoolId) || classroom.layoutRevision !== classroomRef.layoutRevision) {
                    throw new ExamSeatAssignmentError('layout_revision_changed');
                }
                const layout = examClassroomService.layout(classroom, classroom.layoutRevision).snapshot;
                if (layout.fingerprint !== classroomRef.layoutFingerprint) throw new ExamSeatAssignmentError('layout_fingerprint_changed');
                const profile = await examSeatOperationalProfileService.getCurrent(domainId, classroomRef.classroomId);
                if (
                    !profile.schoolId.equals(event.schoolId) ||
                    profile.layoutRevision !== classroomRef.layoutRevision ||
                    profile.layoutFingerprint !== classroomRef.layoutFingerprint ||
                    profile.revision !== classroomRef.profileRevision ||
                    profile.fingerprint !== classroomRef.profileFingerprint
                ) {
                    throw new ExamSeatAssignmentError('seat_profile_revision_changed');
                }
                const layoutBySeat = new Map(layout.seats.map((seat) => [seat.sourceSeatId, seat]));
                const profileBySeat = new Map(profile.entries.map((entry) => [entry.sourceSeatId, entry]));
                const bindings = await endpointSeatBindingService.listClassroomBindings(domainId, classroomRef.classroomId);
                const bindingBySeat = new Map(
                    bindings.filter((binding) => binding.status === 'active' && binding.endpointId).map((binding) => [binding.sourceSeatId, binding]),
                );
                return classroomRef.candidateSeatIds.map((sourceSeatId): ExamSeatAssignmentV2SeatFact => {
                    const seat = layoutBySeat.get(sourceSeatId);
                    const entry = profileBySeat.get(sourceSeatId);
                    if (!seat || !entry) throw new ExamSeatAssignmentError('candidate_seat_missing');
                    const binding = bindingBySeat.get(sourceSeatId);
                    return {
                        classroomId: new ObjectId(classroomRef.classroomId),
                        sourceSeatId,
                        label: seat.label,
                        x: seat.x,
                        y: seat.y,
                        width: seat.width ?? null,
                        height: seat.height ?? null,
                        rotation: seat.rotation,
                        layoutStatus: seat.status,
                        enabled: entry.enabled,
                        facing: entry.facing,
                        disabledReason: entry.disabledReason,
                        bindingId: binding ? new ObjectId(binding._id) : null,
                        bindingRevision: binding?.revision || null,
                        endpointId: binding?.endpointId || null,
                        endpointOnline: null,
                    };
                });
            }),
        );
        const seatFacts = seatFactsByClassroom.flat();
        const endpointIds = seatFacts.flatMap((fact) => (fact.endpointId ? [fact.endpointId] : []));
        if (new Set(endpointIds).size !== endpointIds.length) throw new ExamSeatAssignmentError('assignment_endpoint_duplicate');
        let onlineByEndpoint = new Map<string, boolean>();
        if (endpointIds.length) {
            try {
                const items = await preflightExamNetworkOnVigil(endpointIds);
                onlineByEndpoint = new Map(items.map((item) => [item.endpointId, item.online]));
            } catch (error) {
                const failure = classifyVigilBridgeFailure(error);
                logger.warn(
                    'Exam seat assignment v2 live status unavailable event=%s stage=source reason=%s errorName=%s httpStatus=%s',
                    event._id.toHexString(),
                    failure.reason,
                    failure.errorName,
                    failure.httpStatus ?? '-',
                );
            }
        }
        return {
            seatPlan,
            roster,
            participants: await this.participants(event, roster),
            seatFacts: seatFacts.map((fact) => ({
                ...fact,
                endpointOnline: fact.endpointId ? (onlineByEndpoint.get(fact.endpointId) ?? null) : null,
            })),
        };
    }

    protected assertCurrentV2Source(assignment: ExamSeatAssignmentV2Doc, source: AssignmentV2Source): void {
        const comparableSeat = (fact: ExamSeatAssignmentV2SeatFact) => ({ ...fact, endpointOnline: null });
        if (
            !source.seatPlan._id.equals(assignment.seatPlan.seatPlanId) ||
            source.seatPlan.fingerprint !== assignment.seatPlan.fingerprint ||
            !source.roster._id.equals(assignment.roster.rosterId) ||
            source.roster.fingerprint !== assignment.roster.fingerprint ||
            JSON.stringify(source.participants) !== JSON.stringify(assignment.participants) ||
            JSON.stringify(source.seatFacts.map(comparableSeat)) !== JSON.stringify(assignment.seatFacts.map(comparableSeat))
        ) {
            throw new ExamSeatAssignmentError('assignment_reference_drift');
        }
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
                const failure = classifyVigilBridgeFailure(error);
                logger.warn(
                    'Exam seat assignment live status unavailable event=%s stage=preflight reason=%s errorName=%s httpStatus=%s',
                    eventId.toHexString(),
                    failure.reason,
                    failure.errorName,
                    failure.httpStatus ?? '-',
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
    @param('action', Types.Range(['adjust', 'adjustV2', 'generate', 'generateV2', 'publish', 'rerandomize', 'rerandomizeV2']))
    @param('mode', Types.Range(['random', 'studentId']), true)
    @param('strategy', Types.Range(['maximizeSpacing', 'minimizeClassrooms']), true)
    @param('seatPlanRevision', Types.PositiveInt, true)
    @param('expectedPreviousRevision', Types.UnsignedInt, true)
    @param('baseAssignmentRevision', Types.PositiveInt, true)
    @param('assignmentRevision', Types.PositiveInt, true)
    @param('expectedPublicationRevision', Types.UnsignedInt, true)
    @param('lockedUids', Types.NumericArray, true)
    @param('mappings', Types.Any, true)
    async post(
        _args: unknown,
        eventId: ObjectId,
        action: 'adjust' | 'adjustV2' | 'generate' | 'generateV2' | 'publish' | 'rerandomize' | 'rerandomizeV2',
        _mode?: 'random' | 'studentId',
        strategy?: ExamSeatAssignmentStrategy,
        seatPlanRevision = 0,
        expectedPreviousRevision = 0,
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
                    const [assignment, latestAssignment, latestPlan] = await Promise.all([
                        examSeatAssignmentService.getRevision(domainId, eventId, assignmentRevision),
                        examSeatAssignmentService.latestRevision(domainId, eventId),
                        examSeatPlanService.latestSeatPlanRevision(domainId, eventId),
                    ]);
                    if (!assignment) throw new ExamSeatAssignmentError('assignment_not_found');
                    if (!isExamSeatAssignmentV2(assignment)) throw new ExamSeatAssignmentError('assignment_v2_writer_required');
                    if (
                        !latestAssignment ||
                        !isExamSeatAssignmentV2(latestAssignment) ||
                        !latestAssignment._id.equals(assignment._id) ||
                        latestAssignment.revision !== assignment.revision ||
                        latestAssignment.fingerprint !== assignment.fingerprint ||
                        !latestPlan ||
                        !isExamSeatPlanV2(latestPlan) ||
                        !latestPlan._id.equals(assignment.seatPlan.seatPlanId) ||
                        latestPlan.revision !== assignment.seatPlan.revision ||
                        latestPlan.fingerprint !== assignment.seatPlan.fingerprint
                    ) {
                        throw new ExamSeatAssignmentError('assignment_v2_not_current');
                    }
                    const source = await this.sourceV2(current, assignment.seatPlan.revision);
                    this.assertCurrentV2Source(assignment, source);
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

            if (action === 'generateV2' || action === 'adjustV2' || action === 'rerandomizeV2') {
                let created: Awaited<ReturnType<typeof examSeatAssignmentService.createRevisionV2>>;
                if (action === 'generateV2') {
                    exactBody(this.request.body, ['action', 'expectedPreviousRevision', 'seatPlanRevision', 'strategy']);
                    if (!strategy || !seatPlanRevision) throw new ValidationError('seatPlanRevision');
                    created = await withExamEventBoundary(domainId, eventId, async () => {
                        const current = await this.event(eventId);
                        this.assertWritableEvent(current);
                        const [latestPlan, latest] = await Promise.all([
                            examSeatPlanService.latestSeatPlanRevision(domainId, eventId),
                            examSeatAssignmentService.latestRevision(domainId, eventId),
                        ]);
                        if (!latestPlan || !isExamSeatPlanV2(latestPlan) || latestPlan.revision !== seatPlanRevision) {
                            throw new ExamSeatAssignmentError('seat_plan_v2_not_current');
                        }
                        if ((latest?.revision || 0) !== expectedPreviousRevision) {
                            throw new ExamSeatAssignmentError('assignment_revision_conflict');
                        }
                        const source = await this.sourceV2(current, seatPlanRevision);
                        const samePlan = Boolean(
                            latest &&
                            isExamSeatAssignmentV2(latest) &&
                            latest.seatPlan.seatPlanId.equals(source.seatPlan._id) &&
                            latest.seatPlan.revision === source.seatPlan.revision &&
                            latest.seatPlan.fingerprint === source.seatPlan.fingerprint,
                        );
                        return examSeatAssignmentService.createRevisionV2({
                            domainId,
                            eventId,
                            eventRevision: current.revision,
                            schoolId: current.schoolId,
                            actorUid: this.user._id,
                            expectedPreviousRevision,
                            roster: source.roster,
                            seatPlan: source.seatPlan,
                            participants: source.participants,
                            seatFacts: source.seatFacts,
                            strategy,
                            seed: samePlan && latest && isExamSeatAssignmentV2(latest) ? latest.seed : examSeatAssignmentService.newSeed(),
                            lockedAssignments: samePlan && latest && isExamSeatAssignmentV2(latest) ? latest.constraints.lockedAssignments : [],
                            manualAssignments: [],
                        });
                    });
                } else {
                    if (!baseAssignmentRevision) throw new ValidationError('baseAssignmentRevision');
                    if (action === 'adjustV2') exactBody(this.request.body, ['action', 'baseAssignmentRevision', 'lockedUids', 'mappings']);
                    else exactBody(this.request.body, ['action', 'baseAssignmentRevision']);
                    created = await withExamEventBoundary(domainId, eventId, async () => {
                        const current = await this.event(eventId);
                        this.assertWritableEvent(current);
                        const [base, latestPlan] = await Promise.all([
                            examSeatAssignmentService.getRevision(domainId, eventId, baseAssignmentRevision),
                            examSeatPlanService.latestSeatPlanRevision(domainId, eventId),
                        ]);
                        if (!base || !isExamSeatAssignmentV2(base)) throw new ExamSeatAssignmentError('assignment_v2_not_found');
                        if (
                            !latestPlan ||
                            !isExamSeatPlanV2(latestPlan) ||
                            !latestPlan._id.equals(base.seatPlan.seatPlanId) ||
                            latestPlan.revision !== base.seatPlan.revision ||
                            latestPlan.fingerprint !== base.seatPlan.fingerprint
                        ) {
                            throw new ExamSeatAssignmentError('seat_plan_v2_not_current');
                        }
                        const source = await this.sourceV2(current, base.seatPlan.revision);
                        this.assertCurrentV2Source(base, source);
                        let lockedAssignments: ExamSeatAssignmentV2Mapping[];
                        let manualAssignments: ExamSeatAssignmentV2Mapping[];
                        let seed: string;
                        if (action === 'adjustV2') {
                            if (lockedUids.some((uid) => !Number.isSafeInteger(uid) || uid <= 1) || new Set(lockedUids).size !== lockedUids.length) {
                                throw new ValidationError('lockedUids');
                            }
                            manualAssignments = requestV2Mappings(mappings);
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
                        }
                        return examSeatAssignmentService.createRevisionV2({
                            domainId,
                            eventId,
                            eventRevision: current.revision,
                            schoolId: current.schoolId,
                            actorUid: this.user._id,
                            expectedPreviousRevision: baseAssignmentRevision,
                            roster: source.roster,
                            seatPlan: source.seatPlan,
                            participants: source.participants,
                            seatFacts: source.seatFacts,
                            strategy: base.constraints.strategy,
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
                        diagnosticCodes: created.diagnostics.map((diagnostic) => diagnostic.code),
                        fingerprint: created.assignment.fingerprint,
                    });
                    logger.info(
                        'Exam seat assignment v2 created event=%s revision=%d assignments=%d locked=%d diagnostics=%s fingerprint=%s',
                        eventId.toHexString(),
                        created.assignment.revision,
                        created.assignment.assignments.length,
                        created.assignment.constraints.lockedAssignments.length,
                        created.diagnostics.map((diagnostic) => diagnostic.code).join(',') || '-',
                        created.assignment.fingerprint,
                    );
                } else {
                    logger.info(
                        'Exam seat assignment v2 blocked event=%s diagnostics=%s',
                        eventId.toHexString(),
                        created.diagnostics.map((diagnostic) => diagnostic.code).join(','),
                    );
                }
                this.response.body = {
                    assignment: created.assignment ? serializeAssignment(created.assignment, null) : null,
                    diagnostics: created.diagnostics.map((diagnostic) => serializeDiagnostic(diagnostic as unknown as Record<string, unknown>)),
                };
                return;
            }

            throw new ExamSeatAssignmentError('assignment_v2_writer_required');
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
