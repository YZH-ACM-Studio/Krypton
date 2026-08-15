import { ObjectId } from 'mongodb';
import * as contestModel from './contest';
import * as contestTeam from './contest-team';
import { PERM } from './builtin';
import { examClassroomService } from './exam-classroom';
import { ExamPreloginPreparation } from './exam-prelogin';
import { compileExamPreloginPreparation, ExamPreloginEndpointPreflight } from './exam-prelogin-resolver';
import { assertExamSeatAssignmentIntegrity, examSeatAssignmentService, isExamSeatAssignmentV2 } from './exam-seat-assignment';
import type { ExamPreloginTicketDoc } from './exam-prelogin';
import type { ExamEventDoc } from './exam-event';
import { endpointSeatBindingService } from './endpoint-seat-binding';
import { assertExamRosterRevisionIntegrity, assertExamSeatPlanIntegrity, examSeatPlanService, isExamSeatPlanV2 } from './exam-seat-plan';
import UserModel from './user';

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function contestEligibility(event: ExamEventDoc, uid: number, observedAt: Date): Promise<{ uid: number; eligible: boolean; reason?: string }> {
    if (event.type !== 'krypton' || !event.contestId) return { uid, eligible: false, reason: 'external_workspace_unavailable' };
    try {
        const contest = await contestModel.get(event.domainId, event.contestId);
        const contestId = contest.docId || contest._id;
        const loginBefore = contest.clientLoginBlockBeforeMinutes ?? 60;
        if (
            (contest.participationMode !== undefined && contest.participationMode !== 'individual' && contest.participationMode !== 'team') ||
            (contest._code !== undefined && typeof contest._code !== 'string') ||
            (contest.assign !== undefined && !Array.isArray(contest.assign))
        ) {
            return { uid, eligible: false, reason: 'contest_audience_invalid' };
        }
        const assign = (contest.assign ?? []) as unknown[];
        if (
            assign.some((name) => typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 64) ||
            new Set(assign).size !== assign.length
        ) {
            return { uid, eligible: false, reason: 'contest_audience_invalid' };
        }
        if (
            contest.domainId !== event.domainId ||
            !(contestId instanceof ObjectId) ||
            !contestId.equals(event.contestId) ||
            contest.vigilEnabled !== true ||
            contest.entryMode !== 'client_required' ||
            !(contest.beginAt instanceof Date) ||
            !Number.isFinite(contest.beginAt.getTime()) ||
            !(contest.endAt instanceof Date) ||
            !Number.isFinite(contest.endAt.getTime()) ||
            !Number.isSafeInteger(loginBefore) ||
            loginBefore < 0 ||
            loginBefore > 24 * 60 ||
            observedAt < new Date(contest.beginAt.getTime() - loginBefore * 60_000) ||
            observedAt >= contest.endAt
        ) {
            return { uid, eligible: false, reason: 'contest_not_enterable' };
        }
        const status = await contestModel.getStatus(event.domainId, event.contestId, uid);
        if (contestModel.isClientFinished(status)) return { uid, eligible: false, reason: 'contest_already_finished' };
        if (contestModel.getParticipationMode(contest) === 'team') {
            if (contestModel.isTeamBatchFinalizationPending(contest)) {
                return { uid, eligible: false, reason: 'team_batch_not_finalized' };
            }
            try {
                await contestTeam.assertContestTeamEligibility(event.domainId, contest, uid);
            } catch (error) {
                return { uid, eligible: false, reason: error instanceof Error ? error.message : 'active_team_required' };
            }
            const team = await contestTeam.getTeamByMember(event.domainId, event.contestId, uid);
            if (!team || !team.active || !team.memberUids.includes(uid)) {
                return { uid, eligible: false, reason: 'active_team_required' };
            }
        } else {
            const user = await UserModel.getById(event.domainId, uid);
            if (!user?._id || !user.hasPerm(PERM.PERM_VIEW_CONTEST) || !user.hasPerm(PERM.PERM_ATTEND_CONTEST)) {
                return { uid, eligible: false, reason: 'contest_permission_changed' };
            }
            if (assign.length) {
                const groups = await UserModel.listGroup(event.domainId, uid);
                if (!assign.some((name) => groups.some((group) => group.name === name))) {
                    return { uid, eligible: false, reason: 'contest_assign_changed' };
                }
            }
            const vigilguard = (
                global.Hydro.model as typeof global.Hydro.model & {
                    vigilguard?: { hitsParticipantScope?: (domainId: string, contest: unknown, uid: number) => Promise<boolean> };
                }
            ).vigilguard;
            if (!vigilguard || typeof vigilguard.hitsParticipantScope !== 'function') {
                return { uid, eligible: false, reason: 'participant_scope_resolver_unavailable' };
            }
            if (!(await vigilguard.hitsParticipantScope(event.domainId, contest, uid))) {
                return { uid, eligible: false, reason: 'contest_scope_changed' };
            }
            if (contest._code && status?.attend !== 1) return { uid, eligible: false, reason: 'contest_not_attended' };
        }
        return { uid, eligible: true };
    } catch (error) {
        return { uid, eligible: false, reason: error instanceof Error ? error.message : 'contest_not_enterable' };
    }
}

export async function loadExamPreloginPreparation(
    event: ExamEventDoc,
    assignmentRevision: number,
    preflightEndpoints: ExamPreloginEndpointPreflight,
    observedAt = new Date(),
): Promise<ExamPreloginPreparation> {
    if (!Number.isSafeInteger(assignmentRevision) || assignmentRevision < 1) throw new TypeError('assignmentRevision is invalid');
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) throw new TypeError('observedAt is invalid');
    const [assignment, publication] = await Promise.all([
        examSeatAssignmentService.getRevision(event.domainId, event._id, assignmentRevision),
        examSeatAssignmentService.getPublication(event.domainId, event._id),
    ]);
    if (!assignment) throw new TypeError('exam_prelogin_assignment_not_found');
    assertExamSeatAssignmentIntegrity(assignment);
    if (isExamSeatAssignmentV2(assignment)) throw new TypeError('exam_prelogin_assignment_v2_not_enabled');
    if (
        !publication ||
        !publication.assignment.assignmentId.equals(assignment._id) ||
        publication.assignment.revision !== assignment.revision ||
        publication.assignment.fingerprint !== assignment.fingerprint
    ) {
        throw new TypeError('exam_prelogin_assignment_not_published');
    }
    const [seatPlan, roster, classroom, bindings] = await Promise.all([
        examSeatPlanService.getSeatPlanRevision(event.domainId, event._id, assignment.seatPlan.revision),
        examSeatPlanService.getRosterRevision(event.domainId, event._id, assignment.roster.revision),
        examClassroomService.get(event.domainId, assignment.classroomId),
        endpointSeatBindingService.listClassroomBindings(event.domainId, assignment.classroomId),
    ]);
    if (!seatPlan || !roster || !classroom) throw new TypeError('exam_prelogin_assignment_reference_changed');
    assertExamSeatPlanIntegrity(seatPlan);
    if (isExamSeatPlanV2(seatPlan)) throw new TypeError('exam_prelogin_assignment_reference_changed');
    assertExamRosterRevisionIntegrity(roster);
    const rosterUids = roster.entries.map((entry) => entry.boundUserId).sort((left, right) => left - right);
    const assignmentUids = assignment.assignments.map((entry) => entry.boundUserId).sort((left, right) => left - right);
    if (
        !assignment.schoolId.equals(event.schoolId) ||
        assignment.eventRevision > event.revision ||
        !seatPlan._id.equals(assignment.seatPlan.seatPlanId) ||
        seatPlan.fingerprint !== assignment.seatPlan.fingerprint ||
        !roster._id.equals(assignment.roster.rosterId) ||
        roster.fingerprint !== assignment.roster.fingerprint ||
        !seatPlan.classroomId.equals(assignment.classroomId) ||
        seatPlan.layoutRevision !== assignment.layoutRevision ||
        seatPlan.layoutFingerprint !== assignment.layoutFingerprint ||
        !sameStrings(seatPlan.candidateSeatIds, assignment.candidateSeatIds) ||
        !sameStrings(rosterUids.map(String), assignmentUids.map(String)) ||
        !classroom.schoolId.equals(event.schoolId) ||
        classroom.layoutRevision !== assignment.layoutRevision
    ) {
        throw new TypeError('exam_prelogin_assignment_reference_changed');
    }
    const currentLayout = examClassroomService.layout(classroom, classroom.layoutRevision).snapshot;
    if (currentLayout.fingerprint !== assignment.layoutFingerprint) throw new TypeError('exam_prelogin_assignment_reference_changed');
    const rosterByUid = new Map(roster.entries.map((entry) => [entry.boundUserId, entry]));
    const userbind = global.Hydro.model.userbind;
    if (!userbind || typeof userbind.findStudentByUserId !== 'function') throw new TypeError('userbind student resolver is unavailable');
    const assignments = assignment.assignments.map((entry) => {
        const rosterEntry = rosterByUid.get(entry.boundUserId);
        if (!rosterEntry) throw new TypeError('exam_prelogin_assignment_reference_changed');
        return { uid: entry.boundUserId, studentRecordId: rosterEntry.studentRecordId, sourceSeatId: entry.sourceSeatId };
    });
    const [studentRows, eligibilityRows] = await Promise.all([
        Promise.all(
            assignments.map(async (entry) => {
                const student = (await userbind.findStudentByUserId(event.domainId, entry.uid)) as {
                    _id?: unknown;
                    schoolId?: unknown;
                    boundUserId?: unknown;
                } | null;
                const current = student?.boundUserId === entry.uid;
                return {
                    uid: entry.uid,
                    studentRecordId: current && student?._id instanceof ObjectId ? student._id : null,
                    schoolId: current && student?.schoolId instanceof ObjectId ? student.schoolId : null,
                };
            }),
        ),
        Promise.all(assignments.map((entry) => contestEligibility(event, entry.uid, observedAt))),
    ]);
    const activeBindings = bindings.flatMap((binding) =>
        binding.status === 'active' && binding.endpointId
            ? [
                  {
                      sourceSeatId: binding.sourceSeatId,
                      bindingId: binding._id,
                      bindingRevision: binding.revision,
                      endpointId: binding.endpointId,
                      schoolId: binding.schoolId,
                  },
              ]
            : [],
    );
    const bindingsBySeat = new Map(activeBindings.map((binding) => [binding.sourceSeatId, binding]));
    const subjects = assignments
        .flatMap((assignmentEntry) => {
            const binding = bindingsBySeat.get(assignmentEntry.sourceSeatId);
            return binding
                ? [
                      {
                          endpointId: binding.endpointId,
                          uid: assignmentEntry.uid,
                          contestId: event.contestId?.toHexString() || null,
                      },
                  ]
                : [];
        })
        .sort((left, right) => left.uid - right.uid || compareText(left.endpointId, right.endpointId));
    const endpointIds = subjects.map((subject) => subject.endpointId).sort(compareText);
    const uniqueEndpointIds = [...new Set(endpointIds)];
    const readiness = subjects.length ? await preflightEndpoints(subjects) : [];
    if (
        readiness.length !== uniqueEndpointIds.length ||
        new Set(readiness.map((item) => item.endpointId)).size !== readiness.length ||
        readiness.some((item) => !uniqueEndpointIds.includes(item.endpointId))
    ) {
        throw new TypeError('exam_prelogin_endpoint_preflight_identity_mismatch');
    }
    const workspace =
        event.type === 'krypton' && event.contestId
            ? ({ kind: 'contest', contestId: event.contestId.toHexString(), path: `/exam-mode/${event.contestId.toHexString()}` } as const)
            : null;
    return compileExamPreloginPreparation({
        domainId: event.domainId,
        eventId: event._id,
        eventRevision: event.revision,
        eventType: event.type,
        eventLifecycle: event.lifecycle,
        eventEndAt: event.endAt,
        schoolId: event.schoolId,
        assignment: { assignmentId: assignment._id, revision: assignment.revision, fingerprint: assignment.fingerprint },
        publicationRevision: publication.revision,
        workspace,
        assignments,
        students: studentRows,
        bindings: activeBindings,
        contestEligibility: eligibilityRows,
        endpointFacts: readiness.map((item) => ({
            endpointId: item.endpointId,
            online: item.online,
            serviceVersion: item.serviceVersion,
            protocolVersion: item.protocolVersion,
            capabilities: item.capabilities,
            activeSessionId: item.activeSessionId,
        })),
        observedAt,
    });
}

export async function validateExamPreloginTicketCurrent(
    event: ExamEventDoc,
    ticket: ExamPreloginTicketDoc,
    expectedPreparationFingerprint: string,
    preflightEndpoints: ExamPreloginEndpointPreflight,
    observedAt = new Date(),
): Promise<void> {
    if (
        event.domainId !== ticket.domainId ||
        !event._id.equals(ticket.eventId) ||
        event.revision !== ticket.eventRevision ||
        !/^[a-f0-9]{64}$/.test(expectedPreparationFingerprint)
    ) {
        throw new TypeError('exam_prelogin_activity_changed');
    }
    const preparation = await loadExamPreloginPreparation(event, ticket.assignment.revision, preflightEndpoints, observedAt);
    if (
        preparation.fingerprint !== expectedPreparationFingerprint ||
        !preparation.assignment.assignmentId.equals(ticket.assignment.assignmentId) ||
        preparation.assignment.revision !== ticket.assignment.revision ||
        preparation.assignment.fingerprint !== ticket.assignment.fingerprint ||
        preparation.publicationRevision !== ticket.publicationRevision ||
        preparation.workspace === null ||
        JSON.stringify(preparation.workspace) !== JSON.stringify(ticket.workspace)
    ) {
        throw new TypeError('exam_prelogin_activity_changed');
    }
    const item = preparation.items.find((candidate) => candidate.uid === ticket.uid);
    if (
        !item ||
        !item.ready ||
        !item.studentRecordId.equals(ticket.studentRecordId) ||
        item.sourceSeatId !== ticket.sourceSeatId ||
        !item.bindingId?.equals(ticket.bindingId) ||
        item.bindingRevision !== ticket.bindingRevision ||
        item.endpointId !== ticket.endpointId
    ) {
        throw new TypeError('exam_prelogin_activity_changed');
    }
}

export async function validateExamPreloginTicketsCurrent(
    event: ExamEventDoc,
    tickets: ExamPreloginTicketDoc[],
    preflightEndpoints: ExamPreloginEndpointPreflight,
    observedAt = new Date(),
): Promise<Record<string, string | null>> {
    if (!tickets.length || tickets.length > 500) throw new TypeError('exam_prelogin_ticket_set_invalid');
    const retryByEndpoint = new Map(
        tickets
            .filter((ticket) => ticket.state === 'redeemed')
            .map((ticket) => [ticket.endpointId, { batchId: ticket.batchId.toHexString(), ticketId: ticket._id.toHexString() }]),
    );
    if (
        new Set(tickets.map((ticket) => ticket.endpointId)).size !== tickets.length ||
        new Set(tickets.map((ticket) => ticket._id.toHexString())).size !== tickets.length
    ) {
        throw new TypeError('exam_prelogin_ticket_set_invalid');
    }
    const resumeSessions = Object.fromEntries(tickets.map((ticket) => [ticket._id.toHexString(), null])) as Record<string, string | null>;
    const scopedPreflight: ExamPreloginEndpointPreflight = async (subjects) => {
        const readiness = await preflightEndpoints(
            subjects.map((subject) => {
                const retry = retryByEndpoint.get(subject.endpointId);
                return retry ? { ...subject, retry } : subject;
            }),
        );
        return readiness.map((item) => {
            const retry = retryByEndpoint.get(item.endpointId);
            if (item.resumableSessionId !== null) {
                if (!retry || item.activeSessionId !== item.resumableSessionId) {
                    throw new TypeError('exam_prelogin_resume_session_invalid');
                }
                resumeSessions[retry.ticketId] = item.resumableSessionId;
                return { ...item, activeSessionId: null };
            }
            return item;
        });
    };
    const reference = tickets[0];
    if (
        tickets.some(
            (ticket) =>
                event.domainId !== ticket.domainId ||
                !event._id.equals(ticket.eventId) ||
                event.revision !== ticket.eventRevision ||
                !ticket.batchId.equals(reference.batchId) ||
                !ticket.assignment.assignmentId.equals(reference.assignment.assignmentId) ||
                ticket.assignment.revision !== reference.assignment.revision ||
                ticket.assignment.fingerprint !== reference.assignment.fingerprint ||
                ticket.publicationRevision !== reference.publicationRevision ||
                JSON.stringify(ticket.workspace) !== JSON.stringify(reference.workspace),
        )
    ) {
        throw new TypeError('exam_prelogin_activity_changed');
    }
    const preparation = await loadExamPreloginPreparation(event, reference.assignment.revision, scopedPreflight, observedAt);
    if (
        !preparation.assignment.assignmentId.equals(reference.assignment.assignmentId) ||
        preparation.assignment.revision !== reference.assignment.revision ||
        preparation.assignment.fingerprint !== reference.assignment.fingerprint ||
        preparation.publicationRevision !== reference.publicationRevision ||
        preparation.workspace === null ||
        JSON.stringify(preparation.workspace) !== JSON.stringify(reference.workspace)
    ) {
        throw new TypeError('exam_prelogin_activity_changed');
    }
    for (const ticket of tickets) {
        const item = preparation.items.find((candidate) => candidate.uid === ticket.uid);
        if (
            !item ||
            !item.ready ||
            !item.studentRecordId.equals(ticket.studentRecordId) ||
            item.sourceSeatId !== ticket.sourceSeatId ||
            !item.bindingId?.equals(ticket.bindingId) ||
            item.bindingRevision !== ticket.bindingRevision ||
            item.endpointId !== ticket.endpointId
        ) {
            throw new TypeError('exam_prelogin_activity_changed');
        }
    }
    return resumeSessions;
}
