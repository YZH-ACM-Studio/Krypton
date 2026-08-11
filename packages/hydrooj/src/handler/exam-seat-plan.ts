import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, localizedErrorText, OplogModel, param, PermissionError, Types, ValidationError } from 'hydrooj';
import { PERM } from '../model/builtin';
import { examClassroomService } from '../model/exam-classroom';
import { assertCanManageExamEvent, isExamInfrastructureAdmin } from '../model/exam-event-access';
import { withExamEventBoundary } from '../model/exam-event-boundary';
import { ExamEventDoc, examEventService } from '../model/exam-event';
import { ExamRosterSelection, resolveExamRosterForEvent } from '../model/exam-roster-resolver';
import {
    assertExamRosterRevisionIntegrity,
    assertExamSeatPlanIntegrity,
    ExamRosterRevisionDoc,
    ExamSeatPlanDoc,
    ExamSeatPlanError,
    examSeatPlanService,
} from '../model/exam-seat-plan';

const logger = new Logger('exam-seat-plan');

function exactBody(value: unknown, keys: string[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('body');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) throw new ValidationError('body');
}

function translate(error: unknown): never {
    if (!(error instanceof ExamSeatPlanError)) throw error;
    throw new ValidationError('examSeatPlan', null, localizedErrorText`Invalid request: ${error.reason}`);
}

function serializeSource(source: ExamRosterRevisionDoc['source']) {
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

function serializeRoster(roster: ExamRosterRevisionDoc, currentEventRevision: number) {
    return {
        rosterId: roster._id.toHexString(),
        eventId: roster.eventId.toHexString(),
        eventRevision: roster.eventRevision,
        staleEventRevision: roster.eventRevision !== currentEventRevision,
        schoolId: roster.schoolId.toHexString(),
        revision: roster.revision,
        auditRef: roster.auditRef,
        source: serializeSource(roster.source),
        entries: roster.entries.map((entry) => ({
            studentRecordId: entry.studentRecordId.toHexString(),
            schoolId: entry.schoolId.toHexString(),
            studentId: entry.studentId,
            realName: entry.realName,
            boundUserId: entry.boundUserId,
            sourceGroupIds: entry.sourceGroupIds.map((id) => id.toHexString()),
        })),
        exclusions: roster.exclusions.map((entry) => ({
            studentRecordId: entry.studentRecordId.toHexString(),
            schoolId: entry.schoolId.toHexString(),
            studentId: entry.studentId,
            realName: entry.realName,
            boundUserId: entry.boundUserId,
            reason: entry.reason,
        })),
        previousRevision: roster.previousRevision,
        diff: { ...roster.diff },
        counts: { ...roster.counts },
        fingerprint: roster.fingerprint,
        createdAt: roster.createdAt.toISOString(),
        createdBy: roster.createdBy,
    };
}

function serializePlan(plan: ExamSeatPlanDoc, currentEventRevision: number) {
    return {
        seatPlanId: plan._id.toHexString(),
        eventId: plan.eventId.toHexString(),
        eventRevision: plan.eventRevision,
        staleEventRevision: plan.eventRevision !== currentEventRevision,
        schoolId: plan.schoolId.toHexString(),
        revision: plan.revision,
        auditRef: plan.auditRef,
        roster: plan.roster
            ? { rosterId: plan.roster.rosterId.toHexString(), revision: plan.roster.revision, fingerprint: plan.roster.fingerprint }
            : null,
        classroomId: plan.classroomId.toHexString(),
        layoutRevision: plan.layoutRevision,
        layoutFingerprint: plan.layoutFingerprint,
        candidateSeatIds: [...plan.candidateSeatIds],
        diagnostics: plan.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        fingerprint: plan.fingerprint,
        createdAt: plan.createdAt.toISOString(),
        createdBy: plan.createdBy,
    };
}

abstract class ExamSeatPlanBaseHandler extends Handler {
    async prepare() {
        if (!this.user || this.user._id < 1) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
        if (!isExamInfrastructureAdmin(this.user)) {
            if (!this.user.hasPerm(PERM.PERM_CREATE_EXAM_EVENT)) throw new PermissionError(PERM.PERM_CREATE_EXAM_EVENT);
            if (!this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
                throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
            }
        }
        await Promise.all([examEventService.ensureIndexes(), examClassroomService.ensureIndexes(), examSeatPlanService.ensureIndexes()]);
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
}

class ExamSeatPlanCollectionHandler extends ExamSeatPlanBaseHandler {
    @param('eventId', Types.ObjectId)
    async get(_args: unknown, eventId: ObjectId) {
        const event = await this.event(eventId);
        const [rosters, plans] = await Promise.all([
            examSeatPlanService.listRosterRevisions(event.domainId, eventId).toArray(),
            examSeatPlanService.listSeatPlans(event.domainId, eventId).toArray(),
        ]);
        for (const roster of rosters) {
            assertExamRosterRevisionIntegrity(roster);
            if (!roster.schoolId.equals(event.schoolId)) throw new ExamSeatPlanError('roster_school_mismatch');
        }
        for (const plan of plans) {
            assertExamSeatPlanIntegrity(plan);
            if (!plan.schoolId.equals(event.schoolId)) throw new ExamSeatPlanError('seat_plan_school_mismatch');
            const classroom = await examClassroomService.get(event.domainId, plan.classroomId, true);
            if (!classroom || !classroom.schoolId.equals(plan.schoolId)) throw new ExamSeatPlanError('seat_plan_classroom_missing');
            const layout = examClassroomService.layout(classroom, plan.layoutRevision).snapshot;
            if (layout.fingerprint !== plan.layoutFingerprint) throw new ExamSeatPlanError('seat_plan_layout_drift');
            const seatIds = new Set(layout.seats.map((seat) => seat.sourceSeatId));
            if (plan.candidateSeatIds.some((seatId) => !seatIds.has(seatId))) throw new ExamSeatPlanError('seat_plan_seat_missing');
            if (plan.roster) {
                const roster = await examSeatPlanService.getRosterRevision(event.domainId, eventId, plan.roster.revision);
                if (!roster || !roster._id.equals(plan.roster.rosterId) || roster.fingerprint !== plan.roster.fingerprint) {
                    throw new ExamSeatPlanError('seat_plan_roster_missing');
                }
                const expectedDiagnostics =
                    roster.entries.length > plan.candidateSeatIds.length
                        ? [
                              {
                                  code: 'insufficient_seats',
                                  requiredSeatCount: roster.entries.length,
                                  availableSeatCount: plan.candidateSeatIds.length,
                              },
                          ]
                        : [];
                if (JSON.stringify(plan.diagnostics) !== JSON.stringify(expectedDiagnostics)) {
                    throw new ExamSeatPlanError('seat_plan_diagnostic_drift');
                }
            } else if (plan.diagnostics.length) {
                throw new ExamSeatPlanError('seat_plan_diagnostic_drift');
            }
        }
        this.response.body = {
            event: {
                eventId: event._id.toHexString(),
                revision: event.revision,
                type: event.type,
                lifecycle: event.lifecycle,
                schoolId: event.schoolId.toHexString(),
                contestId: event.contestId?.toHexString() || null,
            },
            rosterRevisions: rosters.map((roster) => serializeRoster(roster, event.revision)),
            seatPlans: plans.map((plan) => serializePlan(plan, event.revision)),
        };
    }

    @param('eventId', Types.ObjectId)
    @param('action', Types.Range(['createRoster', 'createSeatPlan']))
    @param('sourceKind', Types.Range(['contestAudience', 'userbindGroups', 'userbindSchool']), true)
    @param('groupIds', Types.ArrayOf(Types.ObjectId), true)
    @param('rosterRevision', Types.UnsignedInt, true)
    @param('classroomId', Types.ObjectId, true)
    @param('layoutRevision', Types.PositiveInt, true)
    @param('candidateSeatIds', Types.ArrayOf(Types.String), true)
    async post(
        _args: unknown,
        eventId: ObjectId,
        action: 'createRoster' | 'createSeatPlan',
        sourceKind?: 'contestAudience' | 'userbindGroups' | 'userbindSchool',
        groupIds: ObjectId[] = [],
        rosterRevision = 0,
        classroomId?: ObjectId,
        layoutRevision?: number,
        candidateSeatIds: string[] = [],
    ) {
        const domainId = String(this.domain._id);
        try {
            if (action === 'createRoster') {
                exactBody(this.request.body, ['action', 'groupIds', 'sourceKind']);
                if (!sourceKind) throw new ValidationError('sourceKind');
                const selection: ExamRosterSelection =
                    sourceKind === 'userbindGroups'
                        ? { kind: sourceKind, groupIds }
                        : sourceKind === 'contestAudience'
                          ? { kind: sourceKind }
                          : { kind: sourceKind };
                if (sourceKind !== 'userbindGroups' && groupIds.length) throw new ValidationError('groupIds');
                const roster = await withExamEventBoundary(domainId, eventId, async () => {
                    const current = await this.event(eventId);
                    this.assertWritableEvent(current);
                    const resolved = await resolveExamRosterForEvent(current, selection);
                    return examSeatPlanService.createRosterRevision({
                        domainId,
                        eventId,
                        eventRevision: current.revision,
                        schoolId: current.schoolId,
                        actorUid: this.user._id,
                        resolved,
                    });
                });
                await OplogModel.log(this, 'exam.roster.create', {
                    eventId,
                    eventRevision: roster.eventRevision,
                    rosterId: roster._id,
                    rosterRevision: roster.revision,
                    sourceKind: roster.source.kind,
                    includedCount: roster.counts.included,
                    excludedCount: roster.counts.excluded,
                    fingerprint: roster.fingerprint,
                });
                logger.info(
                    'Exam roster created event=%s eventRevision=%d rosterRevision=%d included=%d excluded=%d fingerprint=%s',
                    eventId.toHexString(),
                    roster.eventRevision,
                    roster.revision,
                    roster.counts.included,
                    roster.counts.excluded,
                    roster.fingerprint,
                );
                this.response.body = { rosterRevision: serializeRoster(roster, roster.eventRevision) };
                return;
            }

            exactBody(this.request.body, ['action', 'candidateSeatIds', 'classroomId', 'layoutRevision', 'rosterRevision']);
            if (!classroomId || !layoutRevision) throw new ValidationError('classroomId');
            const plan = await withExamEventBoundary(domainId, eventId, async () => {
                const current = await this.event(eventId);
                this.assertWritableEvent(current);
                const classroom = await examClassroomService.get(domainId, classroomId);
                if (!classroom || !classroom.schoolId.equals(current.schoolId)) throw new ExamSeatPlanError('classroom_school_mismatch');
                if (classroom.layoutRevision !== layoutRevision) throw new ExamSeatPlanError('layout_revision_changed');
                const layout = examClassroomService.layout(classroom, layoutRevision).snapshot;
                const seatIds = new Set(layout.seats.map((seat) => seat.sourceSeatId));
                if (candidateSeatIds.some((seatId) => !seatIds.has(seatId))) throw new ExamSeatPlanError('candidate_seat_missing');
                const roster = rosterRevision ? await examSeatPlanService.getRosterRevision(domainId, eventId, rosterRevision) : null;
                if (rosterRevision && !roster) throw new ExamSeatPlanError('roster_not_found');
                if (roster?.source.kind === 'contestAudience' && (!current.contestId || !roster.source.contestId?.equals(current.contestId))) {
                    throw new ExamSeatPlanError('roster_contest_changed');
                }
                return examSeatPlanService.createSeatPlan({
                    domainId,
                    eventId,
                    eventRevision: current.revision,
                    schoolId: current.schoolId,
                    actorUid: this.user._id,
                    roster,
                    classroomId,
                    layoutRevision,
                    layoutFingerprint: layout.fingerprint,
                    candidateSeatIds,
                    requireRoster: current.type === 'krypton',
                });
            });
            await OplogModel.log(this, 'exam.seat_plan.create', {
                eventId,
                eventRevision: plan.eventRevision,
                seatPlanId: plan._id,
                seatPlanRevision: plan.revision,
                rosterRevision: plan.roster?.revision || null,
                classroomId: plan.classroomId,
                layoutRevision: plan.layoutRevision,
                candidateSeatCount: plan.candidateSeatIds.length,
                diagnosticCodes: plan.diagnostics.map((diagnostic) => diagnostic.code),
                fingerprint: plan.fingerprint,
            });
            logger.info(
                'Exam seat plan created event=%s eventRevision=%d planRevision=%d rosterRevision=%s candidates=%d diagnostics=%s fingerprint=%s',
                eventId.toHexString(),
                plan.eventRevision,
                plan.revision,
                plan.roster?.revision || '-',
                plan.candidateSeatIds.length,
                plan.diagnostics.map((diagnostic) => diagnostic.code).join(',') || '-',
                plan.fingerprint,
            );
            this.response.body = { seatPlan: serializePlan(plan, plan.eventRevision) };
        } catch (error) {
            translate(error);
        }
    }
}

export async function apply(ctx: Context) {
    ctx.Route('exam_seat_plan_collection', '/api/admin/exam-events/:eventId/seat-plans', ExamSeatPlanCollectionHandler);
}
