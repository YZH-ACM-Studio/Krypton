import { ObjectId } from 'mongodb';
import { Logger } from '../logger';
import { ExamEventDoc, ExamEventError, examEventAuditRef } from './exam-event';

const logger = new Logger('exam-event-audit');

export interface ExamEventAuditContext {
    actorUid: number;
    domainId: string;
    operateIp?: string;
    path?: string;
    referer?: string;
    userAgent?: string;
}

export interface ExamEventAuditInput {
    eventId: ObjectId;
    expectedRevision: number | null;
    observedRevision: number | null;
    targetRevision: number;
    requestedFields: string[];
    before: ExamEventDoc | null;
}

export interface ExamEventAuditStore {
    add(data: Record<string, unknown> & { type: string }): Promise<ObjectId>;
    updateOne(filter: { _id: ObjectId }, update: { $set: Record<string, unknown> }): Promise<{ matchedCount: number }>;
}

export const AUDITED_EVENT_FIELDS = [
    'schoolId',
    'title',
    'type',
    'contestId',
    'lifecycle',
    'startAt',
    'endAt',
    'ownerUid',
    'collaboratorUids',
] as const;

function eventAuditSnapshot(event: ExamEventDoc) {
    return {
        schoolId: event.schoolId.toHexString(),
        title: event.title,
        type: event.type,
        contestId: event.contestId?.toHexString() || null,
        lifecycle: event.lifecycle,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        ownerUid: event.ownerUid,
        collaboratorUids: [...event.collaboratorUids],
    };
}

function changedEventFields(before: ExamEventDoc | null, after: ExamEventDoc): string[] {
    if (!before) return [...AUDITED_EVENT_FIELDS];
    const beforeSnapshot = eventAuditSnapshot(before);
    const afterSnapshot = eventAuditSnapshot(after);
    return AUDITED_EVENT_FIELDS.filter((field) => JSON.stringify(beforeSnapshot[field]) !== JSON.stringify(afterSnapshot[field]));
}

function safeAuditFailure(error: unknown) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        ...(error instanceof ExamEventError ? { reason: error.reason } : {}),
    };
}

function productionAuditStore(): ExamEventAuditStore {
    const oplog = require('./oplog') as typeof import('./oplog');
    return {
        add: (data) => oplog.add(data),
        updateOne: (filter, update) => oplog.coll.updateOne(filter, update),
    };
}

export async function runAuditedExamEventMutation(
    context: ExamEventAuditContext,
    operation: 'create' | 'update' | 'schedule' | 'archive',
    input: ExamEventAuditInput,
    work: () => Promise<ExamEventDoc>,
    store: ExamEventAuditStore = productionAuditStore(),
): Promise<ExamEventDoc> {
    const auditRef = examEventAuditRef(input.eventId, input.targetRevision);
    const auditId = await store.add({
        type: `exam.event.${operation}`,
        time: new Date(),
        domainId: context.domainId,
        operator: context.actorUid,
        operateIp: context.operateIp,
        path: context.path,
        referer: context.referer,
        ua: context.userAgent,
        eventId: input.eventId,
        expectedRevision: input.expectedRevision,
        observedRevision: input.observedRevision,
        targetRevision: input.targetRevision,
        auditRef,
        requestedFields: [...input.requestedFields],
        before: input.before ? eventAuditSnapshot(input.before) : null,
        result: 'started',
    });
    let event: ExamEventDoc;
    try {
        event = await work();
    } catch (error) {
        try {
            const finalized = await store.updateOne(
                { _id: auditId },
                { $set: { result: 'failed', finishedAt: new Date(), error: safeAuditFailure(error) } },
            );
            if (finalized.matchedCount !== 1) throw new Error(`ExamEvent audit ${auditRef} is missing while finalizing failure`);
        } catch (auditError) {
            throw new AggregateError([error, auditError], `ExamEvent mutation and audit finalization failed: ${auditRef}`);
        }
        throw error;
    }
    if (event.revision !== input.targetRevision || event.auditRef !== auditRef) {
        logger.error(
            'ExamEvent mutation identity mismatch event=%s audit=%s expectedRevision=%d actualRevision=%d actualAudit=%s stage=success',
            input.eventId.toHexString(),
            auditRef,
            input.targetRevision,
            event.revision,
            event.auditRef,
        );
        throw new Error(`ExamEvent mutation returned an unexpected revision identity: ${auditRef}`);
    }
    const finalized = await store.updateOne(
        { _id: auditId },
        {
            $set: {
                result: 'success',
                finishedAt: new Date(),
                changedFields: changedEventFields(input.before, event),
                after: eventAuditSnapshot(event),
            },
        },
    );
    if (finalized.matchedCount !== 1) {
        logger.error('ExamEvent audit finalization missing event=%s audit=%s stage=success', input.eventId.toHexString(), auditRef);
        throw new Error(`ExamEvent audit ${auditRef} is missing while finalizing success`);
    }
    return event;
}
