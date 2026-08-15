import { ObjectId } from 'mongodb';
import type { ExamEventDoc } from './exam-event';
import { endpointSeatBindingService } from './endpoint-seat-binding';
import { examClassroomService } from './exam-classroom';
import {
    assertExamSeatAssignmentIntegrity,
    examSeatIdentityKey,
    isExamSeatAssignmentV2,
    seatPlanMatchesAssignmentRoster,
} from './exam-seat-assignment';
import type { ExamSeatAssignmentV2Doc } from './exam-seat-assignment';
import { examSeatOperationalProfileService } from './exam-seat-operational-profile';
import { assertExamRosterCurrent, getExamContestAudienceState, inspectExamRosterDrift } from './exam-roster-resolver';
import type { ExamRosterDrift } from './exam-roster-resolver';
import {
    assertExamRosterRevisionIntegrity,
    assertExamSeatPlanIntegrity,
    ExamSeatPlanError,
    examSeatPlanService,
    isExamSeatPlanV2,
} from './exam-seat-plan';
import type { ExamSeatPlanV2Doc } from './exam-seat-plan';

export class ExamSeatAssignmentReadinessError extends TypeError {
    constructor(
        public readonly reason: 'assignment_reference_changed',
        public readonly stage:
            | 'assignment'
            | 'binding'
            | 'classroom'
            | 'contest_audience'
            | 'duplicate'
            | 'endpoint'
            | 'layout'
            | 'profile'
            | 'roster'
            | 'seat'
            | 'seat_disabled'
            | 'seat_plan',
        public readonly eventId: string,
        public readonly assignmentId: string,
        public readonly detail: {
            classroomId?: string;
            sourceSeatId?: string;
            uid?: number;
        } = {},
    ) {
        super(reason);
        this.name = 'ExamSeatAssignmentReadinessError';
    }
}

function changed(
    stage: ExamSeatAssignmentReadinessError['stage'],
    event: ExamEventDoc,
    assignment: ExamSeatAssignmentV2Doc,
    detail: ExamSeatAssignmentReadinessError['detail'] = {},
): never {
    throw new ExamSeatAssignmentReadinessError('assignment_reference_changed', stage, event._id.toHexString(), assignment._id.toHexString(), detail);
}

export interface CurrentExamSeatAssignmentV2Mapping {
    uid: number;
    studentRecordId: ObjectId;
    classroomId: ObjectId;
    sourceSeatId: string;
    seatKey: string;
    bindingId: ObjectId;
    bindingRevision: number;
    endpointId: string;
    facingChanged: boolean;
}

export interface CurrentExamSeatAssignmentV2Facts {
    mappings: CurrentExamSeatAssignmentV2Mapping[];
}

interface CurrentExamSeatState {
    bindingId: ObjectId;
    bindingRevision: number;
    endpointId: string;
    facing: string;
    enabled: boolean;
}

function sameClassrooms(assignment: ExamSeatAssignmentV2Doc, seatPlan: ExamSeatPlanV2Doc): boolean {
    if (assignment.classrooms.length !== seatPlan.classrooms.length) return false;
    return assignment.classrooms.every((classroom, index) => {
        const planClassroom = seatPlan.classrooms[index];
        return (
            classroom.classroomId.equals(planClassroom.classroomId) &&
            classroom.layoutRevision === planClassroom.layoutRevision &&
            classroom.layoutFingerprint === planClassroom.layoutFingerprint &&
            classroom.profileRevision === planClassroom.profileRevision &&
            classroom.profileFingerprint === planClassroom.profileFingerprint &&
            classroom.candidateSeatIds.length === planClassroom.candidateSeatIds.length &&
            classroom.candidateSeatIds.every((seatId, seatIndex) => seatId === planClassroom.candidateSeatIds[seatIndex])
        );
    });
}

async function loadFrozenRoots(event: ExamEventDoc, assignment: ExamSeatAssignmentV2Doc) {
    assertExamSeatAssignmentIntegrity(assignment);
    if (!isExamSeatAssignmentV2(assignment)) changed('assignment', event, assignment);
    if (
        assignment.domainId !== event.domainId ||
        !assignment.eventId.equals(event._id) ||
        !assignment.schoolId.equals(event.schoolId) ||
        assignment.eventRevision > event.revision
    ) {
        changed('assignment', event, assignment);
    }
    const [seatPlan, roster] = await Promise.all([
        examSeatPlanService.getSeatPlanRevision(event.domainId, event._id, assignment.seatPlan.revision),
        examSeatPlanService.getRosterRevision(event.domainId, event._id, assignment.roster.revision),
    ]);
    if (!seatPlan) changed('seat_plan', event, assignment);
    if (!roster) changed('roster', event, assignment);
    assertExamSeatPlanIntegrity(seatPlan);
    assertExamRosterRevisionIntegrity(roster);
    if (
        !isExamSeatPlanV2(seatPlan) ||
        seatPlan.domainId !== event.domainId ||
        !seatPlan.eventId.equals(event._id) ||
        !seatPlan.schoolId.equals(event.schoolId) ||
        seatPlan.revision !== assignment.seatPlan.revision ||
        !seatPlan._id.equals(assignment.seatPlan.seatPlanId) ||
        seatPlan.fingerprint !== assignment.seatPlan.fingerprint ||
        !sameClassrooms(assignment, seatPlan)
    ) {
        changed('seat_plan', event, assignment);
    }
    if (
        roster.domainId !== event.domainId ||
        !roster.eventId.equals(event._id) ||
        !roster.schoolId.equals(event.schoolId) ||
        roster.revision !== assignment.roster.revision ||
        !roster._id.equals(assignment.roster.rosterId) ||
        roster.fingerprint !== assignment.roster.fingerprint ||
        !seatPlanMatchesAssignmentRoster(seatPlan, assignment)
    ) {
        changed('roster', event, assignment);
    }
    return { seatPlan, roster };
}

async function loadCurrentClassroomSeatFacts(
    event: ExamEventDoc,
    assignment: ExamSeatAssignmentV2Doc,
    classroomRef: ExamSeatAssignmentV2Doc['classrooms'][number],
    requiredSeatKeys: Set<string>,
    assignedUidBySeat: Map<string, number>,
): Promise<Map<string, CurrentExamSeatState>> {
    const classroom = await examClassroomService.get(event.domainId, classroomRef.classroomId);
    if (!classroom || !classroom.schoolId.equals(event.schoolId) || classroom.layoutRevision !== classroomRef.layoutRevision) {
        changed('classroom', event, assignment, { classroomId: classroomRef.classroomId.toHexString() });
    }
    const layout = examClassroomService.layout(classroom, classroom.layoutRevision).snapshot;
    if (layout.fingerprint !== classroomRef.layoutFingerprint) {
        changed('layout', event, assignment, { classroomId: classroomRef.classroomId.toHexString() });
    }
    const profile = await examSeatOperationalProfileService.getCurrent(event.domainId, classroomRef.classroomId);
    if (
        !profile.schoolId.equals(event.schoolId) ||
        profile.layoutRevision !== classroomRef.layoutRevision ||
        profile.layoutFingerprint !== classroomRef.layoutFingerprint
    ) {
        changed('profile', event, assignment, { classroomId: classroomRef.classroomId.toHexString() });
    }
    const layoutBySeat = new Map(layout.seats.map((seat) => [seat.sourceSeatId, seat]));
    const profileBySeat = new Map(profile.entries.map((entry) => [entry.sourceSeatId, entry]));
    const bindings = await endpointSeatBindingService.listClassroomBindings(event.domainId, classroomRef.classroomId);
    const activeBindings = bindings.filter((binding) => binding.status === 'active' && binding.endpointId);
    if (
        new Set(activeBindings.map((binding) => binding.sourceSeatId)).size !== activeBindings.length ||
        new Set(activeBindings.map((binding) => binding.endpointId)).size !== activeBindings.length
    ) {
        changed('duplicate', event, assignment);
    }
    const bindingBySeat = new Map(activeBindings.map((binding) => [binding.sourceSeatId, binding]));
    const currentBySeat = new Map<string, CurrentExamSeatState>();
    for (const sourceSeatId of classroomRef.candidateSeatIds) {
        const seatKey = examSeatIdentityKey({ classroomId: classroomRef.classroomId, sourceSeatId });
        if (!requiredSeatKeys.has(seatKey)) continue;
        const layoutSeat = layoutBySeat.get(sourceSeatId);
        const profileSeat = profileBySeat.get(sourceSeatId);
        const binding = bindingBySeat.get(sourceSeatId);
        const detail = { classroomId: classroomRef.classroomId.toHexString(), sourceSeatId, uid: assignedUidBySeat.get(seatKey) };
        if (!layoutSeat || !profileSeat) changed('seat', event, assignment, detail);
        if (!binding) changed('binding', event, assignment, detail);
        if (!binding.endpointId) changed('endpoint', event, assignment, detail);
        currentBySeat.set(seatKey, {
            bindingId: new ObjectId(binding._id),
            bindingRevision: binding.revision,
            endpointId: binding.endpointId,
            facing: profileSeat.facing,
            enabled: profileSeat.enabled,
        });
    }
    return currentBySeat;
}

function currentMapping(
    event: ExamEventDoc,
    assignment: ExamSeatAssignmentV2Doc,
    mapping: ExamSeatAssignmentV2Doc['assignments'][number],
    frozenFacts: Map<string, ExamSeatAssignmentV2Doc['seatFacts'][number]>,
    currentBySeat: Map<string, CurrentExamSeatState>,
    participants: Map<number, ExamSeatAssignmentV2Doc['participants'][number]>,
): CurrentExamSeatAssignmentV2Mapping {
    const seatKey = examSeatIdentityKey(mapping.seat);
    const frozen = frozenFacts.get(seatKey);
    const current = currentBySeat.get(seatKey);
    const participant = participants.get(mapping.boundUserId);
    if (
        !frozen ||
        !current ||
        !participant ||
        !frozen.enabled ||
        frozen.bindingId === null ||
        frozen.bindingRevision === null ||
        frozen.endpointId === null ||
        !current.enabled ||
        !current.bindingId.equals(frozen.bindingId) ||
        current.bindingRevision !== frozen.bindingRevision ||
        current.endpointId !== frozen.endpointId
    ) {
        const detail = {
            classroomId: mapping.seat.classroomId.toHexString(),
            sourceSeatId: mapping.seat.sourceSeatId,
            uid: mapping.boundUserId,
        };
        if (!participant) changed('roster', event, assignment, detail);
        if (!frozen || !current) changed('seat', event, assignment, detail);
        if (!frozen.enabled || !current.enabled) changed('seat_disabled', event, assignment, detail);
        if (frozen.bindingId === null || frozen.bindingRevision === null || !current.bindingId.equals(frozen.bindingId)) {
            changed('binding', event, assignment, detail);
        }
        if (current.bindingRevision !== frozen.bindingRevision) changed('binding', event, assignment, detail);
        changed('endpoint', event, assignment, detail);
    }
    return {
        uid: mapping.boundUserId,
        studentRecordId: new ObjectId(participant.studentRecordId),
        classroomId: new ObjectId(mapping.seat.classroomId),
        sourceSeatId: mapping.seat.sourceSeatId,
        seatKey,
        bindingId: current.bindingId,
        bindingRevision: current.bindingRevision,
        endpointId: current.endpointId,
        facingChanged: current.facing !== frozen.facing,
    };
}

/**
 * Rechecks only the current facts bound to one already-issued v2 ticket. This
 * keeps 500 concurrent redemptions linear while retaining strict per-ticket
 * user, seat, binding, Endpoint and Contest validation at the caller.
 */
export async function loadCurrentExamSeatAssignmentV2TicketFact(
    event: ExamEventDoc,
    assignment: ExamSeatAssignmentV2Doc,
    uid: number,
): Promise<CurrentExamSeatAssignmentV2Mapping> {
    if (event.type === 'krypton' && (await getExamContestAudienceState(event)) !== 'fixed') {
        changed('contest_audience', event, assignment, { uid });
    }
    const { roster } = await loadFrozenRoots(event, assignment);
    if (event.type === 'krypton' && roster.source.kind !== 'contestAudience') {
        changed('roster', event, assignment, { uid });
    }
    const matches = assignment.assignments.filter((mapping) => mapping.boundUserId === uid);
    if (matches.length !== 1) changed('roster', event, assignment, { uid });
    const mapping = matches[0];
    const classroomRef = assignment.classrooms.find((classroom) => classroom.classroomId.equals(mapping.seat.classroomId));
    if (!classroomRef) {
        changed('classroom', event, assignment, {
            classroomId: mapping.seat.classroomId.toHexString(),
            sourceSeatId: mapping.seat.sourceSeatId,
            uid,
        });
    }
    const seatKey = examSeatIdentityKey(mapping.seat);
    const assignedUidBySeat = new Map([[seatKey, uid]]);
    const currentBySeat = await loadCurrentClassroomSeatFacts(event, assignment, classroomRef, new Set([seatKey]), assignedUidBySeat);
    return currentMapping(
        event,
        assignment,
        mapping,
        new Map(assignment.seatFacts.map((fact) => [examSeatIdentityKey(fact), fact])),
        currentBySeat,
        new Map(assignment.participants.map((participant) => [participant.boundUserId, participant])),
    );
}

export async function inspectCurrentExamSeatAssignmentV2Roster(event: ExamEventDoc, assignment: ExamSeatAssignmentV2Doc): Promise<ExamRosterDrift> {
    const { roster } = await loadFrozenRoots(event, assignment);
    if (event.type === 'krypton' && (await getExamContestAudienceState(event)) !== 'fixed') {
        return { changed: true, sourceChangedWithoutParticipantDiff: true, items: [] };
    }
    try {
        return await inspectExamRosterDrift(event, roster, assignment.participants);
    } catch (error) {
        if (error instanceof ExamSeatPlanError) changed('roster', event, assignment);
        throw error;
    }
}

/**
 * Rechecks only facts that can invalidate an already-published v2 assignment.
 * Facing changes are intentionally returned as a soft warning; this function
 * never rewrites or guesses a replacement seat.
 */
export async function loadCurrentExamSeatAssignmentV2Facts(
    event: ExamEventDoc,
    assignment: ExamSeatAssignmentV2Doc,
): Promise<CurrentExamSeatAssignmentV2Facts> {
    if (event.type === 'krypton' && (await getExamContestAudienceState(event)) !== 'fixed') {
        changed('contest_audience', event, assignment);
    }
    const { roster } = await loadFrozenRoots(event, assignment);
    if (event.type === 'krypton' && roster.source.kind !== 'contestAudience') {
        changed('roster', event, assignment);
    }
    try {
        await assertExamRosterCurrent(event, roster);
    } catch (error) {
        if (error instanceof ExamSeatPlanError) changed('roster', event, assignment);
        throw error;
    }

    const assignedSeatKeys = new Set(assignment.assignments.map((mapping) => examSeatIdentityKey(mapping.seat)));
    if (assignedSeatKeys.size !== assignment.assignments.length) changed('duplicate', event, assignment);
    const assignedUidBySeat = new Map(assignment.assignments.map((mapping) => [examSeatIdentityKey(mapping.seat), mapping.boundUserId]));
    const frozenFacts = new Map(assignment.seatFacts.map((fact) => [examSeatIdentityKey(fact), fact]));
    const participants = new Map(assignment.participants.map((participant) => [participant.boundUserId, participant]));
    const currentBySeat = new Map<string, CurrentExamSeatState>();
    const classroomFacts = await Promise.all(
        assignment.classrooms.map((classroomRef) =>
            loadCurrentClassroomSeatFacts(event, assignment, classroomRef, assignedSeatKeys, assignedUidBySeat),
        ),
    );
    for (const facts of classroomFacts) {
        for (const [seatKey, state] of facts) {
            if (currentBySeat.has(seatKey)) changed('duplicate', event, assignment);
            currentBySeat.set(seatKey, state);
        }
    }

    const mappings = assignment.assignments.map((mapping) => currentMapping(event, assignment, mapping, frozenFacts, currentBySeat, participants));
    mappings.sort((left, right) => left.uid - right.uid);
    if (
        new Set(mappings.map((mapping) => mapping.uid)).size !== mappings.length ||
        new Set(mappings.map((mapping) => mapping.bindingId.toHexString())).size !== mappings.length ||
        new Set(mappings.map((mapping) => mapping.endpointId)).size !== mappings.length
    ) {
        changed('duplicate', event, assignment);
    }
    return { mappings };
}
