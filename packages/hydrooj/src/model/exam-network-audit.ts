import { ObjectId } from 'mongodb';
import { Logger } from '../logger';
import {
    ExamNetworkConfigError,
    ExamPolicyTemplateDoc,
    ExamTargetAssignmentDoc,
    examTargetSourcesFingerprint,
} from './exam-network-config';
import { ExamNetworkPolicyError } from './exam-network-policy';

const logger = new Logger('exam-network-audit');

export interface ExamNetworkAuditContext {
    domainId: string;
    actorUid: number;
    operateIp?: string;
    path?: string;
    referer?: string;
    userAgent?: string;
}

export interface ExamNetworkAuditInput {
    eventId: ObjectId;
    entityKind: 'config' | 'policyTemplate' | 'targetAssignment';
    entityId: ObjectId;
    auditRef: string;
    expectedRevision: number | null;
    observedRevision: number | null;
    targetRevision: number;
    fingerprint?: string;
    targetCount?: number;
}

export interface ExamNetworkAuditResult {
    revision: number;
    auditRef: string;
}

export interface ExamNetworkAuditStore {
    add(data: Record<string, unknown> & { type: string }): Promise<ObjectId>;
    updateOne(filter: { _id: ObjectId }, update: { $set: Record<string, unknown> }): Promise<{ matchedCount: number }>;
}

export function policyTemplateAuditFacts(action: 'archive' | 'publish' | 'saveDraft', template: ExamPolicyTemplateDoc) {
    const published = template.revisions.find((revision) => revision.revision === template.latestPublishedRevision);
    if (action === 'publish' && !published) throw new Error(`Published policy revision is missing: ${template._id.toHexString()}`);
    return {
        schoolId: template.schoolId,
        fingerprint: action === 'publish' ? published!.fingerprint : template.draft.fingerprint,
        publishedRevision: template.latestPublishedRevision || null,
    };
}

export function targetAssignmentAuditFacts(action: 'publish' | 'saveDraft', assignment: ExamTargetAssignmentDoc) {
    if (action === 'saveDraft') {
        return {
            schoolId: assignment.schoolId,
            sourceFingerprint: examTargetSourcesFingerprint(assignment.draft.sources),
            sourceCount: assignment.draft.sources.reduce((count, source) => count + source.ids.length, 0),
            publishedRevision: assignment.latestPublishedRevision || null,
        };
    }
    const published = assignment.revisions.find((revision) => revision.revision === assignment.latestPublishedRevision);
    if (!published) throw new Error(`Published target revision is missing: ${assignment._id.toHexString()}`);
    return {
        schoolId: assignment.schoolId,
        targetCount: published.targetCount,
        fingerprint: published.targetFingerprint,
        publishedRevision: assignment.latestPublishedRevision || null,
    };
}

function productionAuditStore(): ExamNetworkAuditStore {
    const oplog = require('./oplog') as typeof import('./oplog');
    return {
        add: (data) => oplog.add(data),
        updateOne: (filter, update) => oplog.coll.updateOne(filter, update),
    };
}

function safeFailure(error: unknown) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        ...(error instanceof ExamNetworkConfigError || error instanceof ExamNetworkPolicyError ? { reason: error.reason } : {}),
    };
}

export async function runAuditedExamNetworkMutation<T extends ExamNetworkAuditResult>(
    context: ExamNetworkAuditContext,
    operation: string,
    input: ExamNetworkAuditInput,
    work: () => Promise<T>,
    resultFacts: (result: T) => Record<string, unknown>,
    store: ExamNetworkAuditStore = productionAuditStore(),
): Promise<T> {
    const auditId = await store.add({
        type: `exam.network.${operation}`,
        time: new Date(),
        domainId: context.domainId,
        operator: context.actorUid,
        operateIp: context.operateIp,
        path: context.path,
        referer: context.referer,
        ua: context.userAgent,
        eventId: input.eventId,
        entityKind: input.entityKind,
        entityId: input.entityId,
        auditRef: input.auditRef,
        expectedRevision: input.expectedRevision,
        observedRevision: input.observedRevision,
        targetRevision: input.targetRevision,
        fingerprint: input.fingerprint,
        targetCount: input.targetCount,
        result: 'started',
    });
    let result: T;
    try {
        result = await work();
    } catch (error) {
        try {
            const finalized = await store.updateOne(
                { _id: auditId },
                { $set: { result: 'failed', error: safeFailure(error), finishedAt: new Date() } },
            );
            if (finalized.matchedCount !== 1) throw new Error(`Exam network audit ${input.auditRef} is missing`);
        } catch (auditError) {
            throw new AggregateError([error, auditError], `Exam network mutation and audit finalization failed: ${input.auditRef}`);
        }
        throw error;
    }
    if (result.revision !== input.targetRevision || result.auditRef !== input.auditRef) {
        logger.error(
            'Exam network identity mismatch event=%s entity=%s audit=%s expectedRevision=%d actualRevision=%d actualAudit=%s',
            input.eventId.toHexString(),
            input.entityId.toHexString(),
            input.auditRef,
            input.targetRevision,
            result.revision,
            result.auditRef,
        );
        const identityError = new Error(`Exam network mutation returned an unexpected identity: ${input.auditRef}`);
        const finalized = await store.updateOne(
            { _id: auditId },
            { $set: { result: 'failed', error: safeFailure(identityError), finishedAt: new Date() } },
        );
        if (finalized.matchedCount !== 1) {
            throw new AggregateError([identityError, new Error(`Exam network audit ${input.auditRef} is missing`)], identityError.message);
        }
        throw identityError;
    }
    const finalized = await store.updateOne({ _id: auditId }, { $set: { result: 'success', finishedAt: new Date(), ...resultFacts(result) } });
    if (finalized.matchedCount !== 1) {
        logger.error('Exam network audit finalization missing event=%s audit=%s', input.eventId.toHexString(), input.auditRef);
        throw new Error(`Exam network audit ${input.auditRef} is missing`);
    }
    return result;
}
