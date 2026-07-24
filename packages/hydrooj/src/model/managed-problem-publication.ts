import { Logger } from '@hydrooj/utils';
import { ManagedProblemMetadataConflictError } from '../error';
import type { ProblemDoc } from '../interface';
import type { ObjectId } from 'mongodb';
import db from '../service/db';
import * as document from './document';
import type { ManagedSourceMeta, ManagedTrainingPlacement } from './managed-problem-authoring';

const logger = new Logger('managed-problem-publication');

export interface ManagedPublicationClaim {
    requestId: string;
    actor: number;
    operation: string;
    capability: 'publish';
}

export interface ManagedProblemPublicationCommit {
    domainId: string;
    docId: number;
    claim: ManagedPublicationClaim;
    title: string;
    difficulty: number;
    tags: string[];
    knowledgeMapId: ObjectId;
    knowledgeNodeIds: ObjectId[];
    sourceMeta: ManagedSourceMeta;
    managedAuthoring: NonNullable<ProblemDoc['managedAuthoring']>;
    expectedMetadataStatus: 'draft' | 'confirmed';
    expectedStructureRevision: number;
    /** Defaults to false so existing publication callers remain public. */
    finalHidden?: boolean;
    pendingTrainingPlacement?: ManagedTrainingPlacement;
}

/**
 * The visibility CAS committed, but Mongo session cleanup failed afterwards.
 * Callers must continue publication finalization with the committed document
 * and report the incomplete persistence cleanup instead of retrying publish.
 */
export class ManagedProblemPublicationCommittedError extends Error {
    constructor(
        readonly pdoc: ProblemDoc,
        cause: unknown,
    ) {
        super(`managed publication committed but session finalization failed: ${pdoc.domainId}/${pdoc.docId}`, { cause });
        this.name = 'ManagedProblemPublicationCommittedError';
    }
}

function transactionCapable(): boolean {
    const topology = (db as any).client?.topology?.description?.type;
    return topology === 'ReplicaSetWithPrimary' || topology === 'ReplicaSetNoPrimary' || topology === 'Sharded';
}

function claimedDraftFilter(input: ManagedProblemPublicationCommit) {
    return {
        domainId: input.domainId,
        docType: document.TYPE_PROBLEM,
        docId: input.docId,
        problemKind: 'programming',
        authoringMode: 'managed',
        hidden: true,
        archivedAt: { $exists: false },
        structureRevision: input.expectedStructureRevision,
        // A first submission locks the evaluated structure, not visibility.
        // Initial publication still requires an unlocked draft; a previously
        // confirmed problem may be re-published without discarding that lock.
        ...(input.expectedMetadataStatus === 'draft' ? { structureLockedAt: { $exists: false } } : {}),
        'managedAuthoring.metadataStatus': input.expectedMetadataStatus,
        'aclWriteClaim.requestId': input.claim.requestId,
        'aclWriteClaim.actor': input.claim.actor,
        'aclWriteClaim.operation': input.claim.operation,
        'aclWriteClaim.capability': input.claim.capability,
        'aclWriteClaim.state': 'active',
    };
}

function publicationUpdate(input: ManagedProblemPublicationCommit) {
    return {
        $set: {
            title: input.title,
            difficulty: input.difficulty,
            tag: input.tags,
            knowledgeMapId: input.knowledgeMapId,
            knowledgeNodeIds: input.knowledgeNodeIds,
            sourceMeta: input.sourceMeta,
            managedAuthoring: input.managedAuthoring,
            hidden: input.finalHidden === true,
        },
        $unset: {
            pidNamespaceReview: '',
        },
    };
}

async function attachToTraining(input: ManagedProblemPublicationCommit, session?: any): Promise<void> {
    const placement = input.pendingTrainingPlacement;
    if (!placement) return;
    try {
        const result = await document.coll.updateOne(
            {
                domainId: input.domainId,
                docType: document.TYPE_TRAINING,
                docId: placement.trainingId,
                kind: { $ne: 'course' },
                dag: { $elemMatch: { _id: placement.chapterId, pids: { $nin: [input.docId, String(input.docId)] } } },
                'dag.pids': { $nin: [input.docId, String(input.docId)] },
            },
            { $addToSet: { 'dag.$.pids': input.docId } } as any,
            session ? { session } : undefined,
        );
        if (result.modifiedCount !== 1) {
            throw new ManagedProblemMetadataConflictError('待挂训练章节已删除或题目已重复');
        }
    } catch (error) {
        if (error instanceof ManagedProblemMetadataConflictError || session) throw error;
        let state;
        try {
            state = await readTrainingChapter(input);
        } catch (confirmationError) {
            logger.error(
                'Managed publish training attach outcome unknown domain=%s pid=%d training=%s chapter=%d stage=attach-confirm error=%o confirmationError=%o',
                input.domainId,
                input.docId,
                placement.trainingId,
                placement.chapterId,
                error,
                confirmationError,
            );
            return compensateTraining(
                input,
                new Error(
                    `managed publication training attach outcome is unknown: ${input.domainId}/${input.docId}/${placement.trainingId}/${placement.chapterId}`,
                    { cause: confirmationError },
                ),
            );
        }
        if (state.exists && state.containsProblem) {
            logger.warn(
                'Managed publish training attach confirmed after write error domain=%s pid=%d training=%s chapter=%d stage=attach-confirm',
                input.domainId,
                input.docId,
                placement.trainingId,
                placement.chapterId,
            );
            return;
        }
        throw error;
    }
}

async function readTrainingChapter(input: ManagedProblemPublicationCommit): Promise<{ exists: boolean; containsProblem: boolean }> {
    const placement = input.pendingTrainingPlacement;
    if (!placement) return { exists: false, containsProblem: false };
    const training = await document.coll.findOne(
        {
            domainId: input.domainId,
            docType: document.TYPE_TRAINING,
            docId: placement.trainingId,
            kind: { $ne: 'course' },
        },
        { projection: { dag: 1 } },
    );
    const chapter = Array.isArray(training?.dag) ? training.dag.find((candidate) => candidate?._id === placement.chapterId) : null;
    return {
        exists: !!chapter,
        containsProblem: !!chapter && Array.isArray(chapter.pids) && chapter.pids.map(Number).includes(input.docId),
    };
}

async function compensateTraining(input: ManagedProblemPublicationCommit, publicationError: unknown): Promise<never> {
    const placement = input.pendingTrainingPlacement;
    if (!placement) throw publicationError;
    let compensationError: unknown;
    try {
        const result = await document.coll.updateOne(
            {
                domainId: input.domainId,
                docType: document.TYPE_TRAINING,
                docId: placement.trainingId,
                kind: { $ne: 'course' },
                dag: { $elemMatch: { _id: placement.chapterId, pids: { $in: [input.docId, String(input.docId)] } } },
            },
            { $pull: { 'dag.$.pids': { $in: [input.docId, String(input.docId)] } } } as any,
        );
        if (result.modifiedCount === 1) throw publicationError;
        const state = await readTrainingChapter(input);
        if (state.exists && !state.containsProblem) throw publicationError;
        compensationError = new Error('training chapter disappeared or retained the problem during compensation');
    } catch (error) {
        if (error === publicationError) throw error;
        compensationError = error;
        try {
            const state = await readTrainingChapter(input);
            if (state.exists && !state.containsProblem) throw publicationError;
        } catch (confirmationError) {
            if (confirmationError === publicationError) throw confirmationError;
            compensationError = new Error(`compensation verification failed: ${String(confirmationError)}`, { cause: compensationError });
        }
    }
    logger.error(
        'Managed publish compensation failed domain=%s pid=%d training=%s chapter=%d stage=compensate publicationError=%o compensationError=%o',
        input.domainId,
        input.docId,
        placement.trainingId,
        placement.chapterId,
        publicationError,
        compensationError,
    );
    throw new Error(
        `managed publication compensation failed: pid=${input.docId} training=${placement.trainingId} chapter=${placement.chapterId} stage=compensate`,
        { cause: compensationError },
    );
}

async function updateProblem(input: ManagedProblemPublicationCommit, session?: any): Promise<ProblemDoc | null> {
    return document.coll.findOneAndUpdate(claimedDraftFilter(input), publicationUpdate(input), {
        returnDocument: 'after',
        ...(session ? { session } : {}),
    }) as Promise<ProblemDoc | null>;
}

async function confirmPublished(input: ManagedProblemPublicationCommit): Promise<ProblemDoc | null> {
    return document.coll.findOne({
        domainId: input.domainId,
        docType: document.TYPE_PROBLEM,
        docId: input.docId,
        hidden: input.finalHidden === true,
        title: input.title,
        difficulty: input.difficulty,
        tag: input.tags,
        knowledgeMapId: input.knowledgeMapId,
        knowledgeNodeIds: input.knowledgeNodeIds,
        authoringMode: 'managed',
        'managedAuthoring.metadataStatus': 'confirmed',
        'managedAuthoring.approvedBy': input.managedAuthoring.approvedBy,
        'managedAuthoring.approvedAt': input.managedAuthoring.approvedAt,
        structureRevision: input.expectedStructureRevision,
        'aclWriteClaim.requestId': input.claim.requestId,
        'aclWriteClaim.actor': input.claim.actor,
        'aclWriteClaim.operation': input.claim.operation,
        'aclWriteClaim.capability': input.claim.capability,
        'aclWriteClaim.state': 'active',
    }) as Promise<ProblemDoc | null>;
}

async function confirmAfterWriteError(input: ManagedProblemPublicationCommit, writeError: unknown): Promise<ProblemDoc | null> {
    try {
        const confirmed = await confirmPublished(input);
        if (confirmed) {
            logger.warn(
                'Managed publish confirmed after write error domain=%s pid=%d requestId=%s stage=problem-confirm error=%o',
                input.domainId,
                input.docId,
                input.claim.requestId,
                writeError,
            );
        }
        return confirmed;
    } catch (confirmationError) {
        logger.error(
            'Managed publish outcome unknown domain=%s pid=%d requestId=%s stage=problem-confirm error=%o confirmationError=%o',
            input.domainId,
            input.docId,
            input.claim.requestId,
            writeError,
            confirmationError,
        );
        throw new Error(`managed publication outcome is unknown: ${input.domainId}/${input.docId}/${input.claim.requestId}`, {
            cause: confirmationError,
        });
    }
}

async function commitWithTransaction(input: ManagedProblemPublicationCommit): Promise<ProblemDoc> {
    const session = (db as any).client.startSession();
    let published: ProblemDoc | null = null;
    let transactionFailed = false;
    let transactionError: unknown;
    try {
        await session.withTransaction(async () => {
            await attachToTraining(input, session);
            published = await updateProblem(input, session);
            if (!published) throw new Error(`managed publication CAS failed: ${input.domainId}/${input.docId}`);
        });
    } catch (error) {
        try {
            const confirmed = await confirmAfterWriteError(input, error);
            if (confirmed) published = confirmed;
            else {
                transactionFailed = true;
                transactionError = error;
            }
        } catch (confirmationError) {
            transactionFailed = true;
            transactionError = confirmationError;
        }
    }
    let sessionFinalizationError: unknown;
    try {
        await session.endSession();
    } catch (error) {
        sessionFinalizationError = error;
    }
    if (transactionFailed) {
        if (sessionFinalizationError) {
            logger.error(
                'Managed publish transaction and session finalization both failed domain=%s pid=%d requestId=%s stage=session-finalization transactionError=%o sessionError=%o',
                input.domainId,
                input.docId,
                input.claim.requestId,
                transactionError,
                sessionFinalizationError,
            );
        }
        throw transactionError;
    }
    if (sessionFinalizationError) {
        if (published) throw new ManagedProblemPublicationCommittedError(published, sessionFinalizationError);
        throw sessionFinalizationError;
    }
    if (!published) throw new Error(`managed publication transaction returned without a committed document: ${input.domainId}/${input.docId}`);
    return published;
}

async function commitWithCompensation(input: ManagedProblemPublicationCommit): Promise<ProblemDoc> {
    await attachToTraining(input);
    let published: ProblemDoc | null;
    try {
        published = await updateProblem(input);
    } catch (error) {
        const confirmed = await confirmAfterWriteError(input, error);
        if (confirmed) return confirmed;
        return compensateTraining(input, error);
    }
    if (published) return published;
    return compensateTraining(input, new Error(`managed publication CAS failed: ${input.domainId}/${input.docId}`));
}

async function commitProblemOnly(input: ManagedProblemPublicationCommit): Promise<ProblemDoc> {
    try {
        const published = await updateProblem(input);
        if (published) return published;
    } catch (error) {
        const confirmed = await confirmAfterWriteError(input, error);
        if (confirmed) return confirmed;
        throw error;
    }
    throw new Error(`managed publication CAS failed: ${input.domainId}/${input.docId}`);
}

/** Commit only metadata/training visibility; ACL cleanup and audit remain in the caller's single publish service. */
export async function commitManagedProblemPublication(input: ManagedProblemPublicationCommit): Promise<ProblemDoc> {
    if (input.claim.operation !== 'managed-review-publish') {
        throw new TypeError(`managed publication requires managed-review-publish claim, received ${input.claim.operation}`);
    }
    const usesTransaction = !!input.pendingTrainingPlacement && transactionCapable();
    logger.info(
        'Managed publish persistence start domain=%s pid=%d requestId=%s training=%s chapter=%s finalHidden=%s transaction=%s stage=commit',
        input.domainId,
        input.docId,
        input.claim.requestId,
        input.pendingTrainingPlacement?.trainingId,
        input.pendingTrainingPlacement?.chapterId,
        input.finalHidden === true,
        usesTransaction,
    );
    const published = !input.pendingTrainingPlacement
        ? await commitProblemOnly(input)
        : usesTransaction
          ? await commitWithTransaction(input)
          : await commitWithCompensation(input);
    logger.info(
        'Managed publish persistence complete domain=%s pid=%d requestId=%s training=%s chapter=%s finalHidden=%s stage=committed',
        input.domainId,
        input.docId,
        input.claim.requestId,
        input.pendingTrainingPlacement?.trainingId,
        input.pendingTrainingPlacement?.chapterId,
        input.finalHidden === true,
    );
    return published;
}
