import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, PermissionError, ValidationError } from '../error';
import { PRIV } from '../model/builtin';
import * as oplog from '../model/oplog';
import {
    canManagePracticeContainer,
    issuePracticeContext,
    loadPracticeContainer,
    requiredPracticeManagePermission,
} from '../model/practice-integrity-access';
import {
    canonicalPracticePolicy,
    PracticeIntegrityConflictError,
    practiceIntegrityService,
    type PracticeContainerKind,
    type PracticeIntegrityRevisionDoc,
    type PracticeScopeKind,
} from '../model/practice-integrity';
import { Handler, param, Types } from '../service/server';

const logger = new Logger('practice-integrity');

function canonicalContainerKind(value: string): PracticeContainerKind {
    if (value !== 'course' && value !== 'problemSet') throw new ValidationError('containerKind', null, localizedErrorText`无效的真实性训练容器`);
    return value;
}

function canonicalScopeKind(value: string): PracticeScopeKind {
    if (value !== 'chapter' && value !== 'stage') throw new ValidationError('scopeKind', null, localizedErrorText`无效的真实性训练范围`);
    return value;
}

function serializeRevision(revision: PracticeIntegrityRevisionDoc | null) {
    if (!revision) return null;
    return {
        containerKind: revision.containerKind,
        containerId: revision.containerId.toHexString(),
        revision: revision.revision,
        state: revision.state,
        ...(revision.draftVersion === undefined ? {} : { draftVersion: revision.draftVersion }),
        policy: revision.policy,
        createdAt: revision.createdAt.toISOString(),
        updatedAt: revision.updatedAt.toISOString(),
        ...(revision.publishedAt ? { publishedAt: revision.publishedAt.toISOString() } : {}),
    };
}

function conflictAsValidation(error: unknown): never {
    if (error instanceof PracticeIntegrityConflictError) {
        throw new ValidationError('expectedDraftVersion', null, localizedErrorText`真实性策略草稿已变化，请刷新后重试`);
    }
    throw error;
}

function logPolicyFailure(
    operation: 'draft-save' | 'publish',
    domainId: string,
    actorUid: number,
    containerKind: PracticeContainerKind,
    containerId: ObjectId,
    error: unknown,
): void {
    const reason = error instanceof PracticeIntegrityConflictError ? error.reason : error instanceof Error ? error.name : 'unknown';
    logger.warn(
        'Practice integrity policy rejected domain=%s actor=%d container=%s/%s stage=%s reason=%s result=rejected',
        domainId,
        actorUid,
        containerKind,
        containerId,
        operation,
        reason,
    );
}

class PracticeIntegrityPolicyHandler extends Handler {
    @param('containerKind', Types.String)
    @param('containerId', Types.ObjectId)
    async get(_args: unknown, containerKindRaw: string, containerId: ObjectId) {
        const domainId = String(this.domain?._id);
        const containerKind = canonicalContainerKind(containerKindRaw);
        const tdoc = await loadPracticeContainer(domainId, containerKind, containerId);
        if (!canManagePracticeContainer(this.user, tdoc, containerKind)) {
            throw new PermissionError(requiredPracticeManagePermission(this.user, tdoc, containerKind));
        }
        const state = await practiceIntegrityService.getPolicyState(domainId, containerKind, containerId);
        this.response.body = { published: serializeRevision(state.published), draft: serializeRevision(state.draft) };
    }

    @param('containerKind', Types.String)
    @param('containerId', Types.ObjectId)
    @param('prohibitExternalCodeInjection', Types.Boolean)
    @param('removeIndependentSubmitForm', Types.Boolean)
    @param('antiAiCopyInjection', Types.Boolean)
    @param('expectedDraftVersion', Types.UnsignedInt)
    async postSave(
        _args: unknown,
        containerKindRaw: string,
        containerId: ObjectId,
        prohibitExternalCodeInjection: boolean,
        removeIndependentSubmitForm: boolean,
        antiAiCopyInjection: boolean,
        expectedDraftVersion: number,
    ) {
        const domainId = String(this.domain?._id);
        const containerKind = canonicalContainerKind(containerKindRaw);
        const tdoc = await loadPracticeContainer(domainId, containerKind, containerId);
        if (!canManagePracticeContainer(this.user, tdoc, containerKind)) {
            throw new PermissionError(requiredPracticeManagePermission(this.user, tdoc, containerKind));
        }
        try {
            const draft = await practiceIntegrityService.saveDraft({
                domainId,
                containerKind,
                containerId,
                policy: canonicalPracticePolicy({ prohibitExternalCodeInjection, removeIndependentSubmitForm, antiAiCopyInjection }),
                actorUid: this.user._id,
                expectedDraftVersion,
            });
            await oplog.log(this, 'practice.integrity.draft.save', {
                containerKind,
                containerId,
                revision: draft.revision,
                draftVersion: draft.draftVersion,
            });
            logger.info(
                'Practice integrity draft saved domain=%s actor=%d container=%s/%s revision=%d draftVersion=%d stage=draft-save result=success',
                domainId,
                this.user._id,
                containerKind,
                containerId,
                draft.revision,
                draft.draftVersion,
            );
            this.response.body = { draft: serializeRevision(draft) };
        } catch (error) {
            logPolicyFailure('draft-save', domainId, this.user._id, containerKind, containerId, error);
            conflictAsValidation(error);
        }
    }

    @param('containerKind', Types.String)
    @param('containerId', Types.ObjectId)
    @param('expectedDraftVersion', Types.PositiveInt)
    async postPublish(_args: unknown, containerKindRaw: string, containerId: ObjectId, expectedDraftVersion: number) {
        const domainId = String(this.domain?._id);
        const containerKind = canonicalContainerKind(containerKindRaw);
        const tdoc = await loadPracticeContainer(domainId, containerKind, containerId);
        if (!canManagePracticeContainer(this.user, tdoc, containerKind)) {
            throw new PermissionError(requiredPracticeManagePermission(this.user, tdoc, containerKind));
        }
        try {
            const published = await practiceIntegrityService.publishDraft({
                domainId,
                containerKind,
                containerId,
                actorUid: this.user._id,
                expectedDraftVersion,
            });
            await oplog.log(this, 'practice.integrity.publish', {
                containerKind,
                containerId,
                revision: published.revision,
            });
            logger.info(
                'Practice integrity policy published domain=%s actor=%d container=%s/%s revision=%d stage=publish result=success',
                domainId,
                this.user._id,
                containerKind,
                containerId,
                published.revision,
            );
            this.response.body = { published: serializeRevision(published) };
        } catch (error) {
            logPolicyFailure('publish', domainId, this.user._id, containerKind, containerId, error);
            conflictAsValidation(error);
        }
    }
}

class PracticeContextHandler extends Handler {
    @param('containerKind', Types.String)
    @param('containerId', Types.ObjectId)
    @param('scopeKind', Types.String)
    @param('scopeId', Types.PositiveInt)
    @param('pid', Types.PositiveInt)
    @param('preview', Types.Boolean, true)
    async postIssue(
        _args: unknown,
        containerKindRaw: string,
        containerId: ObjectId,
        scopeKindRaw: string,
        scopeId: number,
        pid: number,
        preview = false,
    ) {
        const domainId = String(this.domain?._id);
        let containerKind: PracticeContainerKind | 'invalid' = 'invalid';
        let scopeKind: PracticeScopeKind | 'invalid' = 'invalid';
        let rejectionReason = 'user-profile-required';
        try {
            this.checkPriv(PRIV.PRIV_USER_PROFILE);
            rejectionReason = 'invalid-container-kind';
            containerKind = canonicalContainerKind(containerKindRaw);
            rejectionReason = 'invalid-scope-kind';
            scopeKind = canonicalScopeKind(scopeKindRaw);
            rejectionReason = 'context-access-denied';
            const issued = await issuePracticeContext({
                domainId,
                user: this.user,
                handler: this,
                target: { containerKind, containerId, scopeKind, scopeId },
                pid,
                mode: preview ? 'preview' : 'student',
                setRejectionReason: (reason) => {
                    rejectionReason = reason;
                },
            });
            if (!issued.controlled) {
                this.response.body = { controlled: false };
                return;
            }
            const { selected, context } = issued;
            const contextId = context._id.toHexString();
            logger.info(
                'Practice context issued domain=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d revisions=%o stage=issue result=success',
                domainId,
                contextId,
                this.user._id,
                selected.identity.containerKind,
                selected.identity.containerId,
                selected.identity.scopeKind,
                selected.identity.scopeId,
                pid,
                context.revisions.map((revision) => `${revision.containerKind}:${revision.containerId.toHexString()}:${revision.revision}`),
            );
            this.response.body = {
                controlled: true,
                contextId,
                expiresAt: context.expiresAt.toISOString(),
                policy: context.policy,
                mode: context.mode,
                revisions: context.revisions.map((revision) => ({
                    containerKind: revision.containerKind,
                    containerId: revision.containerId.toHexString(),
                    scopeKind: revision.scopeKind,
                    scopeId: revision.scopeId,
                    revision: revision.revision,
                })),
            };
        } catch (error) {
            logger.warn(
                'Practice context rejected domain=%s uid=%d container=%s/%s scope=%s/%d pid=%d reason=%s stage=issue result=rejected',
                domainId,
                this.user._id,
                containerKind,
                containerId,
                scopeKind,
                scopeId,
                pid,
                rejectionReason,
            );
            throw error;
        }
    }
}

export async function apply(ctx: any) {
    ctx.Route('practice_integrity_policy', '/practice-integrity/:containerKind/:containerId', PracticeIntegrityPolicyHandler);
    ctx.Route('practice_context', '/practice-context', PracticeContextHandler);
}
