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
    entityKind: 'config' | 'execution' | 'policyTemplate' | 'targetAssignment';
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
    };
}

function safeFailure(error: unknown) {
    return {
        name: error instanceof Error ? error.name : 'Error',
        ...(error instanceof ExamNetworkConfigError || error instanceof ExamNetworkPolicyError ? { reason: error.reason } : {}),
    };
}

function examNetworkAuditPayload(context: ExamNetworkAuditContext, operation: string, input: ExamNetworkAuditInput) {
    return {
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
    };
}

async function writeExamNetworkAudit(
    store: ExamNetworkAuditStore,
    data: Record<string, unknown> & { type: string },
    eventId: ObjectId,
    auditRef: string,
    stage: 'success' | 'failed',
): Promise<void> {
    try {
        await store.add(data);
    } catch (auditError) {
        logger.error(
            'Exam network audit write failed event=%s audit=%s stage=%s %s',
            eventId.toHexString(),
            auditRef,
            stage,
            auditError instanceof Error ? auditError.stack || auditError.message : String(auditError),
        );
    }
}

export async function runAuditedExamNetworkMutation<T extends ExamNetworkAuditResult>(
    context: ExamNetworkAuditContext,
    operation: string,
    input: ExamNetworkAuditInput,
    work: () => Promise<T>,
    resultFacts: (result: T) => Record<string, unknown>,
    store: ExamNetworkAuditStore = productionAuditStore(),
): Promise<T> {
    let result: T;
    try {
        result = await work();
    } catch (error) {
        await writeExamNetworkAudit(
            store,
            {
                ...examNetworkAuditPayload(context, operation, input),
                result: 'failed',
                error: safeFailure(error),
                finishedAt: new Date(),
            },
            input.eventId,
            input.auditRef,
            'failed',
        );
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
        throw new Error(`Exam network mutation returned an unexpected identity: ${input.auditRef}`);
    }
    await writeExamNetworkAudit(
        store,
        {
            ...examNetworkAuditPayload(context, operation, input),
            result: 'success',
            finishedAt: new Date(),
            ...resultFacts(result),
        },
        input.eventId,
        input.auditRef,
        'success',
    );
    return result;
}
