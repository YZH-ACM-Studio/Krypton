import child from 'child_process';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { Entry, ZipReader } from '@zip.js/zip.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { isEqual, keyBy, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { parseProblemKind, ProblemConfigFile, type ProblemKind, ProblemType } from '@hydrooj/common';
import { extractZip, Logger, size, streamToBuffer } from '@hydrooj/utils/lib/utils';
import { Context } from '../context';
import {
    FileUploadError,
    ManagedProblemMetadataConflictError,
    NotFoundError,
    PermissionError,
    ProblemIsReferencedError,
    ProblemNotFoundError,
    ProblemStructureConflictError,
    ProblemTagConflictError,
    ValidationError,
} from '../error';
import type { Document, ProblemDict, ProblemStatusDoc, User } from '../interface';
import { copyProblemStorageFiles } from '../lib/problem-clone';
import { isProblemConfigFilename, parseProblemConfigObject } from '../lib/problem-config';
import { normalizeProblemTestdataUpload } from '../lib/problem-testdata-upload';
import { parseConfig } from '../lib/testdataConfig';
import bus from '../service/bus';
import db from '../service/db';
import { ArrayKeys, MaybeArray, NumberKeys, Projection } from '../typeutils';
import { buildProjection } from '../utils';
import { PERM, STATUS } from './builtin';
import {
    assertCodeEvaluationFileMutation,
    assertCodeEvaluationLifecyclePatch,
    assertCodeEvaluationMappingsExist,
    assertCodeEvaluationStatusInvariant,
    assertCodeEvaluationStatusTransition,
    assertProblemReadyForUse as assertCodeEvaluationProblemReady,
    type CodeEvaluationFileMutation,
    isCodeEvaluationProblem,
    normalizeCodeEvaluationCreationStatus,
    normalizeCodeEvaluationDraftConfig,
} from './code-evaluation-lifecycle';
import * as document from './document';
import DomainModel from './domain';
import * as OplogModel from './oplog';
import {
    acquireProblemWriteClaim,
    assertProblemAclDomain as assertProblemAclDomainAccess,
    assertProblemBankSelection as assertProblemBankSelectionAccess,
    buildProblemBankScope as buildProblemBankScopeAccess,
    canArchiveProblem as canArchiveProblemAccess,
    canAuthorProblem as canAuthorProblemAccess,
    canBrowseProblemBank as canBrowseProblemBankAccess,
    canCloneProblem as canCloneProblemAccess,
    canDeleteProblem as canDeleteProblemAccess,
    canEditProblemContent as canEditProblemContentAccess,
    canEditProblemMetadata as canEditProblemMetadataAccess,
    canManageProblemCollaborators as canManageProblemCollaboratorsAccess,
    canManageProblemMaintainers as canManageProblemMaintainersAccess,
    canMaintainProblem as canMaintainProblemAccess,
    canPublishProblem as canPublishProblemAccess,
    canUseProblemWriteCapability,
    canViewProblem,
    clearProblemWriteClaim,
    commitProblemWriteClaimUpdate,
    isProblemBankAdmin as isProblemBankAdminAccess,
    markProblemWriteClaimError,
    normalizeProblemFileListSnapshot,
    problemDataSnapshotFilter,
    type ProblemFileListSnapshot,
    type ProblemTestdataMutation,
    problemWriteCapabilityAllows,
    problemWriteClaimAllowsTestdataMutation,
    PROBLEM_ACL_INTERNAL_FIELDS,
    type ProblemAclUser,
    type ProblemWriteCapability,
    type ProblemWriteClaim,
    readStableEditableProblem,
    readStableMaintainableProblem,
    readStableViewableProblem,
    readStableViewableProblems,
    refreshProblemAcl as refreshProblemAclAccess,
} from './problem-access';
import {
    assertStructureRevision,
    cloneStructuredProblemForLanguage,
    completePersistedProblemCreate,
    findProblemReferences,
    hasStartedProblemContainer,
    normalizeStructuredProblemConfig,
    PROBLEM_STRUCTURAL_FIELDS,
    problemCreateChangedFields,
    problemEditAuditedFields,
    problemReferenceCount,
    structuredProblemConfigForEditor,
    structuredProblemUsesTestdata,
} from './problem-lifecycle';
import {
    ensureManagedProblemAuthoringIndexes,
    materializeKnowledgeMindmapTags,
    type ManagedProblemDraftInput,
    prepareManagedProblemDraft,
    prepareManagedProblemPublication,
    previewProgrammingTagNormalization,
    reserveManagedProblemPid,
} from './managed-problem-authoring';
import { isCanonicalManagedSourceTag } from './managed-problem-source';
import { managedProblemPatchCapability } from './managed-problem-patch';
import { commitManagedProblemPublication } from './managed-problem-publication';
import RecordModel from './record';
import SolutionModel from './solution';
import storage from './storage';
import {
    assertNoCanonicalProblemPrimitiveMutation,
    canonicalizeStructuredKnowledgePatch,
    DEDICATED_STRUCTURED_PROBLEM_KINDS,
} from './structured-problem-metadata';
import SystemModel from './system';

export interface ProblemDoc extends Document {}
export type Field = keyof ProblemDoc;

const logger = new Logger('problem');

type CodeEvaluationReadySnapshot = Pick<
    ProblemDoc,
    'domainId' | 'docId' | 'pid' | 'problemKind' | 'codeEvaluationStatus' | 'structureRevision' | 'config' | 'data'
>;

function assertProblemReadyForUseWithTrace(pdoc: CodeEvaluationReadySnapshot, context: { actor?: number; stage: string }): void {
    try {
        assertCodeEvaluationProblemReady(pdoc, context);
    } catch (error) {
        logger.warn(
            'Code evaluation ready gate rejected domain=%s pid=%s docId=%d problemKind=%s actor=%s stage=%s structureRevision=%s result=denied error=%o',
            pdoc.domainId,
            pdoc.pid || '-',
            pdoc.docId,
            pdoc.problemKind || 'programming',
            context.actor ?? '-',
            context.stage,
            pdoc.structureRevision ?? '-',
            error,
        );
        throw error;
    }
}

function assertCodeEvaluationMappingsExistWithTrace(
    pdoc: CodeEvaluationReadySnapshot,
    config: unknown,
    context: { actor?: number; stage: string },
): void {
    try {
        assertCodeEvaluationMappingsExist(config, pdoc.data, true);
    } catch (error) {
        logger.warn(
            'Code evaluation mapping rejected domain=%s pid=%s docId=%d problemKind=%s actor=%s stage=%s structureRevision=%s result=denied error=%o',
            pdoc.domainId,
            pdoc.pid || '-',
            pdoc.docId,
            pdoc.problemKind || 'programming',
            context.actor ?? '-',
            context.stage,
            pdoc.structureRevision ?? '-',
            error,
        );
        throw error;
    }
}

function assertCodeEvaluationFileMutationWithTrace(
    pdoc: CodeEvaluationReadySnapshot,
    mutation: CodeEvaluationFileMutation,
    context: { actor?: number; stage: string },
): void {
    try {
        assertCodeEvaluationFileMutation(pdoc, mutation);
    } catch (error) {
        logger.warn(
            'Code evaluation file mutation rejected domain=%s pid=%s docId=%d problemKind=%s actor=%s stage=%s structureRevision=%s result=denied mutation=%o error=%o',
            pdoc.domainId,
            pdoc.pid || '-',
            pdoc.docId,
            pdoc.problemKind || 'programming',
            context.actor ?? '-',
            context.stage,
            pdoc.structureRevision ?? '-',
            mutation,
            error,
        );
        throw error;
    }
}

function assertCodeEvaluationLifecyclePatchWithTrace(
    pdoc: CodeEvaluationReadySnapshot,
    $set: Record<string, unknown>,
    $unset: Record<string, unknown>,
    context: { actor?: number; operation: string; stage: string; physicalTestdataMutation?: boolean },
): void {
    try {
        assertCodeEvaluationLifecyclePatch(pdoc, $set, $unset, context.operation, {
            physicalTestdataMutation: context.physicalTestdataMutation,
        });
    } catch (error) {
        logger.warn(
            'Code evaluation lifecycle patch rejected domain=%s pid=%s docId=%d problemKind=%s actor=%s stage=%s structureRevision=%s result=denied fields=%o error=%o',
            pdoc.domainId,
            pdoc.pid || '-',
            pdoc.docId,
            pdoc.problemKind || 'programming',
            context.actor ?? '-',
            context.stage,
            pdoc.structureRevision ?? '-',
            [...Object.keys($set), ...Object.keys($unset)],
            error,
        );
        throw error;
    }
}

function managedValidationContext(sourceMeta: unknown, pendingTrainingPlacement: unknown) {
    const source = sourceMeta && typeof sourceMeta === 'object' && !Array.isArray(sourceMeta) ? (sourceMeta as Record<string, unknown>) : {};
    const placement =
        pendingTrainingPlacement && typeof pendingTrainingPlacement === 'object' && !Array.isArray(pendingTrainingPlacement)
            ? (pendingTrainingPlacement as Record<string, unknown>)
            : {};
    const trainingId = placement.trainingId;
    return {
        template: typeof source.template === 'string' ? source.template : undefined,
        trainingId: trainingId instanceof ObjectId ? trainingId.toHexString() : typeof trainingId === 'string' ? trainingId : undefined,
        chapterId: Number.isSafeInteger(placement.chapterId) ? Number(placement.chapterId) : undefined,
    };
}

function sortable(source: string, namespaces: Record<string, string>) {
    const [namespace, pid] = source.includes('-') ? source.split('-') : ['default', source];
    return ((namespaces ? `${namespaces[namespace]}-` : '') + pid).replace(/(\d+)/g, (str) =>
        str.length >= 6 ? str : '0'.repeat(6 - str.length) + str,
    );
}

function isStructuralPatch($set: Record<string, unknown>, $unset: Record<string, unknown> = {}) {
    return [...Object.keys($set), ...Object.keys($unset)].some((field) => PROBLEM_STRUCTURAL_FIELDS.has(field));
}

function touchesProgrammingTagPair($set: Record<string, unknown>, $unset: Record<string, unknown> = {}) {
    return [...Object.keys($set), ...Object.keys($unset)].some(
        (field) => field === 'tag' || field.startsWith('tag.') || field === 'knowledgeNodeIds' || field.startsWith('knowledgeNodeIds.'),
    );
}

function publishesProblemPatch($set: Record<string, unknown>, $unset: Record<string, unknown> = {}): boolean {
    return $set.hidden === false || Object.keys($unset).some((field) => field === 'hidden' || field.startsWith('hidden.'));
}

async function readActiveProblemWriteClaim(
    domainId: string,
    pid: number,
    requestId: string,
    actor: number,
    operation: string,
    capability: ProblemWriteCapability,
): Promise<ProblemWriteClaim | null> {
    const pdoc = await document.coll.findOne(
        {
            domainId,
            docType: document.TYPE_PROBLEM,
            docId: pid,
            'aclWriteClaim.requestId': requestId,
            'aclWriteClaim.actor': actor,
            'aclWriteClaim.operation': operation,
            'aclWriteClaim.capability': capability,
            'aclWriteClaim.state': 'active',
        },
        { projection: { aclWriteClaim: 1 } },
    );
    return pdoc?.aclWriteClaim ? ({ domainId, pid, ...pdoc.aclWriteClaim } as ProblemWriteClaim) : null;
}

async function auditManagedClaimPatchDenied(
    claim: ProblemWriteClaim,
    guard: ReturnType<typeof managedProblemPatchCapability>,
    phase: 'request' | 'after-hook',
): Promise<void> {
    logger.warn(
        'Managed claim patch rejected domain=%s pid=%d actor=%d operation=%s phase=%s claimCapability=%s requiredCapability=%s fields=%o result=denied',
        claim.domainId,
        claim.pid,
        claim.actor,
        claim.operation,
        phase,
        claim.capability,
        guard.capability,
        guard.requestedFields,
    );
    await OplogModel.add({
        type: 'problem.managed.write.denied',
        domainId: claim.domainId,
        operator: claim.actor,
        problemId: claim.pid,
        operation: claim.operation,
        phase,
        capability: claim.capability,
        requiredCapability: guard.capability,
        changedFields: guard.requestedFields,
        result: 'denied',
        time: new Date(),
    } as any);
}

function assertPublishableProblem(input: {
    domainId: string;
    docId: number;
    publicPid?: string;
    actor?: number;
    problemKind?: unknown;
    codeEvaluationStatus?: unknown;
    structureRevision?: unknown;
    config: unknown;
    data?: Array<{ name: string }>;
}) {
    assertProblemReadyForUseWithTrace(
        {
            domainId: input.domainId,
            docId: input.docId,
            pid: input.publicPid || '',
            problemKind: input.problemKind as any,
            codeEvaluationStatus: input.codeEvaluationStatus as any,
            structureRevision: input.structureRevision as any,
            config: input.config as any,
            data: (input.data || []) as any,
        },
        { actor: input.actor, stage: 'publish' },
    );
}

async function prepareManagedPublish(claim: ProblemWriteClaim): Promise<void> {
    const permits = (global.Hydro?.model as any)?.permits;
    if (typeof permits?.listForProblem !== 'function' || typeof permits?.clearVerifiersForProblem !== 'function') {
        throw new TypeError('managed publish permit services are unavailable');
    }
    await OplogModel.add({
        type: 'problem.managed.publish',
        domainId: claim.domainId,
        operator: claim.actor,
        problemId: claim.pid,
        action: 'publish',
        result: 'attempt',
        requestId: claim.requestId,
        time: new Date(),
    } as any);
    const rows = await permits.listForProblem(claim.domainId, claim.pid);
    const verifierUids = [...new Set<number>(rows.filter((row: any) => row.role === 'verifier').map((row: any) => row.uid))].sort((a, b) => a - b);
    for (const targetUid of verifierUids) {
        await OplogModel.add({
            type: 'problem.permit.revoke',
            domainId: claim.domainId,
            operator: claim.actor,
            problemId: claim.pid,
            targetUid,
            role: 'verifier',
            action: 'publish-clear',
            result: 'attempt',
            requestId: claim.requestId,
            time: new Date(),
        } as any);
    }
    const removed = await permits.clearVerifiersForProblem(claim.domainId, claim.pid, {
        requestId: `${claim.requestId}:clear-verifiers`,
        actor: claim.actor,
        writeClaimRequestId: claim.requestId,
    });
    for (const targetUid of verifierUids) {
        await OplogModel.add({
            type: 'problem.permit.revoke',
            domainId: claim.domainId,
            operator: claim.actor,
            problemId: claim.pid,
            targetUid,
            role: 'verifier',
            action: 'publish-clear',
            result: 'success',
            requestId: claim.requestId,
            time: new Date(),
        } as any);
    }
    logger.info(
        'Managed publish verifier cleanup domain=%s pid=%d actor=%d role=verifier action=publish-clear targets=%o removed=%d result=success',
        claim.domainId,
        claim.pid,
        claim.actor,
        verifierUids,
        removed,
    );
}

function revisionClaimFilter(claim: ProblemWriteClaim, expectedStructureRevision: number) {
    return {
        domainId: claim.domainId,
        docType: document.TYPE_PROBLEM,
        docId: claim.pid,
        'aclWriteClaim.requestId': claim.requestId,
        'aclWriteClaim.actor': claim.actor,
        'aclWriteClaim.operation': claim.operation,
        'aclWriteClaim.capability': claim.capability,
        'aclWriteClaim.state': 'active',
        structureRevision: expectedStructureRevision,
        structureLockedAt: { $exists: false },
    };
}

function findOverrideContent(dir: string, base: string) {
    if (!fs.existsSync(dir)) return null;
    let files = fs.readdirSync(dir);
    if (files.includes(`${base}.md`)) return fs.readFileSync(path.join(dir, `${base}.md`), 'utf8');
    if (files.includes(`${base}.pdf`)) return `@[PDF](file://${base}.pdf)`;
    const languages = {};
    files = files.filter((i) => new RegExp(`^${base}(?:_|.)([a-zA-Z_]+)\\.(md|pdf)$`).test(i));
    if (!files.length) return null;
    for (const file of files) {
        const match = file.match(`^${base}(?:_|.)([a-zA-Z_]+)\\.(md|pdf)$`);
        const lang = match[1];
        const ext = match[2];
        if (ext === 'pdf') languages[lang] = `@[PDF](file://${file})`;
        else languages[lang] = fs.readFileSync(path.join(dir, file), 'utf8');
    }
    return JSON.stringify(languages);
}

interface ProblemImportOptions {
    preferredPrefix?: string;
    progress?: any;
    override?: boolean;
    operator?: number;
    delSource?: boolean;
    hidden?: boolean;
}

interface ProblemCreateOptions {
    difficulty?: number;
    hidden?: boolean;
    reference?: { domainId: string; pid: number };
    problemKind: ProblemKind;
    structuredConfig?: unknown;
    authoringMode?: 'managed';
    sourceMeta?: ProblemDoc['sourceMeta'];
    managedAuthoring?: ProblemDoc['managedAuthoring'];
    knowledgeNodeIds?: ProblemDoc['knowledgeNodeIds'];
    codeEvaluationStatus?: 'draft';
}

interface ProblemCreateHooks {
    /** Called with the exact insert identity before document hooks or Mongo. */
    onAllocated?: (docId: number, documentId: ObjectId) => void;
    /** Called immediately after the ProblemDoc insert, before events/audit. */
    onPersisted?: (docId: number) => void;
}

const PROJECTION_BASE: Field[] = ['_id', 'domainId', 'docType', 'docId', 'pid', 'owner', 'title'];

export class ProblemModel {
    static PROJECTION_CONTEST_LIST: Field[] = [...PROJECTION_BASE, 'config'];

    static PROJECTION_LIST: Field[] = [
        ...PROJECTION_BASE,
        'nSubmit',
        'nAccept',
        'difficulty',
        'tag',
        'hidden',
        'stats',
        'problemKind',
        'codeEvaluationStatus',
        'structureRevision',
        'structureLockedAt',
        'structureLockReason',
        'archivedAt',
        'archivedBy',
        'archiveReason',
        'authoringMode',
    ];

    static PROJECTION_CONTEST_DETAIL: Field[] = [
        ...ProblemModel.PROJECTION_CONTEST_LIST,
        'content',
        'html',
        'data',
        'additional_file',
        'reference',
        'maintainer',
    ];

    static PROJECTION_PUBLIC: Field[] = [
        ...ProblemModel.PROJECTION_LIST,
        'content',
        'html',
        'data',
        'config',
        'additional_file',
        'reference',
        'maintainer',
        // 原赛通过率：只进 PUBLIC 不进 LIST——RecordDetailHandler 等以
        // PROJECTION_LIST 取 pdoc 的路径在比赛进行中会原样回传 pdoc，
        // 放进 LIST 会把难度提示漏给赛中考生（对抗审查发现）。
        // 消费点（训练详情/题目详情）都走 PUBLIC；比赛/考试上下文的
        // 剥离见 handler/problem.ts 与 handler/paper.ts。
        'origStat',
    ];

    /** Internal fields exposed only after the stable editor ACL read. */
    static PROJECTION_MANAGED_EDITOR: Field[] = [...ProblemModel.PROJECTION_PUBLIC, 'sourceMeta', 'managedAuthoring', 'knowledgeNodeIds'];

    /** Internal summary fields for the ACL-scoped problem bank and admin review. */
    static PROJECTION_MANAGED_BANK: Field[] = [...ProblemModel.PROJECTION_LIST, 'sourceMeta', 'managedAuthoring'];

    static isProblemBankAdmin(user: ProblemAclUser) {
        return isProblemBankAdminAccess(user);
    }

    static assertProblemAclDomain(user: ProblemAclUser, authoritativeDomainId: string) {
        return assertProblemAclDomainAccess(user, authoritativeDomainId);
    }

    static canBrowseProblemBank(user: ProblemAclUser) {
        return canBrowseProblemBankAccess(user);
    }

    static refreshProblemAcl(user: ProblemAclUser, authoritativeDomainId: string) {
        return refreshProblemAclAccess(user, authoritativeDomainId);
    }

    static buildProblemBankScope(user: ProblemAclUser) {
        return buildProblemBankScopeAccess(user);
    }

    static canMaintainProblem(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canMaintainProblemAccess(user, pdoc);
    }

    static canAuthorProblem(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canAuthorProblemAccess(user, pdoc);
    }

    static canEditProblemContent(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canEditProblemContentAccess(user, pdoc);
    }

    static canEditProblemMetadata(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canEditProblemMetadataAccess(user, pdoc);
    }

    static canManageProblemCollaborators(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canManageProblemCollaboratorsAccess(user, pdoc);
    }

    static canManageProblemMaintainers(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canManageProblemMaintainersAccess(user, pdoc);
    }

    static canPublishProblem(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canPublishProblemAccess(user, pdoc);
    }

    static canArchiveProblem(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canArchiveProblemAccess(user, pdoc);
    }

    static canDeleteProblem(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canDeleteProblemAccess(user, pdoc);
    }

    static canCloneProblem(user: ProblemAclUser, pdoc: ProblemDoc) {
        return canCloneProblemAccess(user, pdoc);
    }

    static assertProblemReadyForUse(pdoc: ProblemDoc, context: { actor?: number; stage: string }) {
        return assertProblemReadyForUseWithTrace(pdoc, context);
    }

    static assertProblemBankSelection(domainId: string, pids: number[], user: ProblemAclUser, grandfatheredPids: number[] = []) {
        return assertProblemBankSelectionAccess(domainId, pids, user, grandfatheredPids);
    }

    static default = {
        _id: new ObjectId(),
        domainId: 'system',
        docType: document.TYPE_PROBLEM,
        docId: 0,
        pid: '',
        owner: 1,
        title: '*',
        content: '',
        html: false,
        nSubmit: 0,
        nAccept: 0,
        tag: [],
        data: [],
        additional_file: [],
        stats: {},
        hidden: true,
        config: '',
        difficulty: 0,
    };

    static deleted = {
        _id: new ObjectId(),
        domainId: 'system',
        docType: document.TYPE_PROBLEM,
        docId: -1,
        pid: null,
        owner: 1,
        title: '*',
        content: 'Deleted Problem',
        html: false,
        nSubmit: 0,
        nAccept: 0,
        tag: [],
        data: [],
        additional_file: [],
        stats: {},
        hidden: true,
        config: '',
        difficulty: 0,
    };

    static async add(
        domainId: string,
        pid: string = '',
        title: string,
        content: string,
        owner: number,
        tag: string[] = [],
        meta: ProblemCreateOptions = {} as ProblemCreateOptions,
        hooks: ProblemCreateHooks = {},
    ) {
        const [doc] = await ProblemModel.getMulti(domainId, {})
            .withReadPreference('primary')
            .sort({ docId: -1 })
            .limit(1)
            .project({ docId: 1 })
            .toArray();
        const result = await ProblemModel.addWithId(domainId, (doc?.docId || 0) + 1, pid, title, content, owner, tag, meta, hooks);
        return result;
    }

    static async addWithId(
        domainId: string,
        docId: number,
        pid: string = '',
        title: string,
        content: string,
        owner: number,
        tag: string[] = [],
        meta: ProblemCreateOptions = {} as ProblemCreateOptions,
        hooks: ProblemCreateHooks = {},
    ) {
        const ddoc = await DomainModel.get(domainId);
        const problemKind = parseProblemKind(meta?.problemKind);
        const codeEvaluationStatus = normalizeCodeEvaluationCreationStatus((meta as unknown as Record<string, unknown>).codeEvaluationStatus);
        const originalCreateTags = [...tag];
        if (problemKind === 'programming' && codeEvaluationStatus !== undefined) {
            throw new ValidationError('codeEvaluationStatus', null, '编程题不能设置结构化代码评测状态');
        }
        const args: Partial<ProblemDoc> = {
            title,
            tag,
            hidden: true,
            problemKind,
            structureRevision: 1,
            nSubmit: 0,
            nAccept: 0,
            sort: sortable(pid || `P${docId}`, ddoc?.namespaces),
            data: [],
            additional_file: [],
        };
        if (pid) args.pid = pid;
        if (meta.difficulty) args.difficulty = meta.difficulty;
        if (meta.reference) args.reference = meta.reference;
        if (meta.authoringMode) args.authoringMode = meta.authoringMode;
        if (meta.sourceMeta) args.sourceMeta = meta.sourceMeta;
        if (meta.managedAuthoring) args.managedAuthoring = meta.managedAuthoring;
        if (problemKind === 'programming' && meta.knowledgeNodeIds !== undefined) {
            args.knowledgeNodeIds = meta.knowledgeNodeIds;
        }
        if (problemKind !== 'programming') {
            args.knowledgeNodeIds = meta.knowledgeNodeIds ?? [];
            try {
                args.config = (
                    codeEvaluationStatus === 'draft'
                        ? normalizeCodeEvaluationDraftConfig(problemKind, meta.structuredConfig)
                        : normalizeStructuredProblemConfig(problemKind, meta.structuredConfig)
                ) as any;
                if (codeEvaluationStatus) args.codeEvaluationStatus = codeEvaluationStatus;
                assertCodeEvaluationStatusInvariant(problemKind, args.config, args.codeEvaluationStatus);
            } catch (error) {
                logger.error('Structured problem create rejected domain=%s pid=%d kind=%s revision=1 error=%o', domainId, docId, problemKind, error);
                throw error;
            }
            await canonicalizeStructuredKnowledgePatch(
                { problemKind },
                args,
                {},
                { domainId, pid: docId, actor: owner, operation: 'create' },
                'request',
                { requireKnowledgePair: true },
            );
        }
        await bus.parallel('problem/before-add', domainId, content, owner, docId, args);
        if (args.problemKind !== problemKind) throw new ValidationError('problemKind');
        if (args.codeEvaluationStatus !== codeEvaluationStatus) {
            throw new ValidationError('codeEvaluationStatus', null, '创建钩子不能改变代码评测生命周期状态');
        }
        if (args.hidden !== true) throw new ValidationError('hidden', null, '创建钩子不能公开尚未完成创建流程的题目');
        assertCodeEvaluationStatusInvariant(problemKind, args.config, args.codeEvaluationStatus);
        await canonicalizeStructuredKnowledgePatch(
            { problemKind, tag: originalCreateTags },
            args,
            {},
            { domainId, pid: docId, actor: owner, operation: 'create' },
            'after-hook',
            { requireKnowledgePair: problemKind !== 'programming' || meta.knowledgeNodeIds !== undefined },
        );
        const result = await document.add(domainId, content, owner, document.TYPE_PROBLEM, docId, null, null, args, {
            onPrepared: (prepared) => hooks.onAllocated?.(docId, prepared._id),
        });
        args.content = content;
        args.owner = owner;
        args.docType = document.TYPE_PROBLEM;
        args.domainId = domainId;
        return completePersistedProblemCreate(
            result,
            hooks.onPersisted,
            async () => {
                await bus.emit('problem/add', args, result);
            },
            () =>
                OplogModel.add({
                    type: 'problem.create',
                    domainId,
                    operator: owner,
                    problemId: result,
                    problemKind,
                    revision: 1,
                    changedFields: problemCreateChangedFields(problemKind, {
                        pid: args.pid,
                        difficulty: args.difficulty,
                        reference: args.reference,
                        authoringMode: args.authoringMode,
                        sourceMeta: args.sourceMeta,
                        managedAuthoring: args.managedAuthoring,
                        knowledgeNodeIds: args.knowledgeNodeIds,
                        codeEvaluationStatus: args.codeEvaluationStatus,
                    }),
                    time: new Date(),
                } as any),
        );
    }

    /**
     * Create one hidden managed programming draft and grant its creator the
     * canonical direct author role. The draft is removed synchronously if the
     * ACL grant cannot be completed; callers never receive an unowned draft.
     */
    static async createManagedProgrammingDraft(
        domainId: string,
        input: ManagedProblemDraftInput,
        creator: number,
        actorUser?: ProblemAclUser,
    ): Promise<{ docId: number; pid: string }> {
        if (
            input.authorUid !== undefined &&
            Number(input.authorUid) !== creator &&
            (!actorUser || actorUser._id !== creator || !ProblemModel.isProblemBankAdmin(actorUser))
        ) {
            throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        }
        let prepared: Awaited<ReturnType<typeof prepareManagedProblemDraft>>;
        try {
            prepared = await prepareManagedProblemDraft(domainId, input);
        } catch (error) {
            const validation = managedValidationContext(input.sourceMeta, input.pendingTrainingPlacement);
            logger.warn(
                'Managed draft validation rejected domain=%s actor=%d template=%o training=%o chapter=%o stage=create-validate error=%o',
                domainId,
                creator,
                validation.template,
                validation.trainingId,
                validation.chapterId,
                error,
            );
            throw error;
        }
        const publicPid = await reserveManagedProblemPid(domainId, prepared.sourceMeta);
        const authorUid = prepared.authorUid || creator;
        let docId: number | null = null;
        let documentId: ObjectId | null = null;
        let authorAssignmentClaim: ProblemWriteClaim | null = null;
        let authorAssignmentClaimRequestId: string | undefined;
        try {
            docId = await ProblemModel.createProblemByKind(
                'programming',
                domainId,
                publicPid,
                `待审核 · ${prepared.workingTitle}`,
                prepared.content,
                creator,
                prepared.tags,
                {
                    difficulty: prepared.difficulty,
                    authoringMode: 'managed',
                    sourceMeta: prepared.sourceMeta,
                    managedAuthoring: {
                        workingTitle: prepared.workingTitle,
                        selectedMindmapNodeIds: prepared.selectedMindmapNodeIds,
                        metadataStatus: 'draft',
                        ...(prepared.pendingTrainingPlacement ? { pendingTrainingPlacement: prepared.pendingTrainingPlacement } : {}),
                    },
                },
                {
                    onAllocated: (allocatedDocId, allocatedDocumentId) => {
                        docId = allocatedDocId;
                        documentId = allocatedDocumentId;
                    },
                    onPersisted: (persistedDocId) => {
                        docId = persistedDocId;
                    },
                },
            );
            const permits = (global.Hydro?.model as any)?.permits;
            await OplogModel.add({
                type: 'problem.permit.grant',
                domainId,
                operator: creator,
                problemId: docId,
                targetUids: [authorUid],
                role: 'author',
                action: 'grant',
                source: 'managed-draft-create',
                result: 'attempt',
                time: new Date(),
            } as any);
            if (authorUid === creator) {
                if (typeof permits?.bootstrapManagedDraftAuthor !== 'function') {
                    throw new TypeError('permits.bootstrapManagedDraftAuthor is unavailable');
                }
                await permits.bootstrapManagedDraftAuthor(domainId, docId, creator, {
                    requestId: `managed-draft-create:${domainId}:${docId}:${creator}`,
                    note: 'managed draft creator',
                });
            } else {
                if (typeof permits?.bootstrapManagedDraftAuthorForAdmin !== 'function') {
                    throw new TypeError('permits.bootstrapManagedDraftAuthorForAdmin is unavailable');
                }
                authorAssignmentClaimRequestId = `problem-write:managed-draft-author-assignment:${domainId}:${docId}:${creator}:${new ObjectId().toHexString()}`;
                authorAssignmentClaim = await ProblemModel.beginAuthorizedWriteClaim(domainId, docId, actorUser!, 'managed-draft-author-assignment', {
                    capability: 'publish',
                    requestId: authorAssignmentClaimRequestId,
                });
                await permits.bootstrapManagedDraftAuthorForAdmin(domainId, docId, authorUid, creator, {
                    requestId: `managed-draft-admin-create:${domainId}:${docId}:${creator}:${authorUid}`,
                    note: 'administrator pre-created managed draft',
                    writeClaimRequestId: authorAssignmentClaim.requestId,
                });
                if (!(await clearProblemWriteClaim(authorAssignmentClaim))) {
                    throw new Error(`problem write claim ownership lost before clear: ${authorAssignmentClaim.requestId}`);
                }
                authorAssignmentClaim = null;
                authorAssignmentClaimRequestId = undefined;
            }
            logger.info(
                'Managed draft created domain=%s pid=%d publicPid=%s actor=%d author=%d role=author action=grant result=success',
                domainId,
                docId,
                publicPid,
                creator,
                authorUid,
            );
            return { docId, pid: publicPid };
        } catch (error) {
            logger.error(
                'Managed draft create failed domain=%s pid=%s publicPid=%s actor=%d author=%d stage=create-or-author-grant error=%o',
                domainId,
                docId,
                publicPid,
                creator,
                authorUid,
                error,
            );
            if (docId !== null && documentId) {
                let persisted: ProblemDoc | null;
                try {
                    persisted = await document.coll.findOne(
                        {
                            _id: documentId,
                            domainId,
                            docType: document.TYPE_PROBLEM,
                            docId,
                            pid: publicPid,
                            owner: creator,
                            authoringMode: 'managed',
                        },
                        { projection: { _id: 1 } },
                    );
                } catch (confirmationError) {
                    logger.error(
                        'Managed draft create outcome unknown domain=%s pid=%d publicPid=%s actor=%d author=%d documentId=%s stage=persist-confirm createError=%o confirmationError=%o',
                        domainId,
                        docId,
                        publicPid,
                        creator,
                        authorUid,
                        documentId,
                        error,
                        confirmationError,
                    );
                    throw new Error(
                        `managed draft creation outcome is unknown: domain=${domainId} pid=${docId} publicPid=${publicPid} stage=persist-confirm`,
                        { cause: new AggregateError([error, confirmationError]) },
                    );
                }
                if (!persisted) throw error;
                try {
                    const cleanupManagedDraftCreation = (global.Hydro?.model as any)?.permits?.cleanupManagedDraftCreation;
                    if (typeof cleanupManagedDraftCreation !== 'function') {
                        throw new TypeError('permits.cleanupManagedDraftCreation is unavailable');
                    }
                    const cleanup = await cleanupManagedDraftCreation(domainId, docId, creator, {
                        requestId: `managed-draft-create-cleanup:${domainId}:${docId}:${creator}`,
                        authorUid,
                        documentId,
                        publicPid,
                        owner: creator,
                        writeClaimRequestId: authorAssignmentClaimRequestId,
                    });
                    await ProblemModel.deleteProblemDocumentUnchecked(domainId, docId, {
                        kind: 'managed-draft-creation-cleanup',
                        creator,
                        owner: creator,
                        documentId,
                        publicPid,
                        writeClaimRequestId: cleanup.writeClaimRequestId,
                    });
                } catch (cleanupError) {
                    if (authorAssignmentClaim || authorAssignmentClaimRequestId) {
                        try {
                            const claimToMark =
                                authorAssignmentClaim ||
                                (await readActiveProblemWriteClaim(
                                    domainId,
                                    docId,
                                    authorAssignmentClaimRequestId!,
                                    creator,
                                    'managed-draft-author-assignment',
                                    'publish',
                                ));
                            const marked = claimToMark ? await markProblemWriteClaimError(claimToMark, cleanupError) : false;
                            if (!marked) {
                                logger.error(
                                    'Managed draft cleanup claim vanished domain=%s pid=%d actor=%d requestId=%s',
                                    domainId,
                                    docId,
                                    creator,
                                    authorAssignmentClaimRequestId || authorAssignmentClaim?.requestId,
                                );
                            }
                        } catch (markerError) {
                            logger.error(
                                'Managed draft cleanup failed and claim ERROR marker failed domain=%s pid=%d actor=%d requestId=%s markerError=%o',
                                domainId,
                                docId,
                                creator,
                                authorAssignmentClaimRequestId || authorAssignmentClaim?.requestId,
                                markerError,
                            );
                        }
                    }
                    logger.error(
                        'Managed draft cleanup failed domain=%s pid=%d actor=%d createError=%o cleanupError=%o',
                        domainId,
                        docId,
                        creator,
                        error,
                        cleanupError,
                    );
                    throw new Error(`managed draft creation failed and cleanup failed: ${domainId}/${docId}`, {
                        cause: cleanupError,
                    });
                }
            }
            throw error;
        }
    }

    /** The only service allowed to confirm metadata, attach training, and expose a managed draft. */
    static async publishManagedProgrammingProblem(input: {
        domainId: string;
        docId: number;
        formalTitle: string;
        difficulty: number;
        actor: number;
        user: ProblemAclUser;
    }): Promise<ProblemDoc> {
        const formalTitle = input.formalTitle.trim();
        if (!formalTitle) throw new ValidationError('formalTitle');
        if (!Number.isSafeInteger(input.difficulty) || input.difficulty < 0 || input.difficulty > 10) {
            throw new ValidationError('difficulty');
        }
        if (input.user._id !== input.actor || !ProblemModel.isProblemBankAdmin(input.user)) {
            throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
        }
        let finalization: {
            requestId: string;
            publicPid: string;
            approvedAt: Date;
            trainingId?: ObjectId;
            chapterId?: number;
        } | null = null;
        const published = await ProblemModel.withAuthorizedWriteClaim(
            input.domainId,
            input.docId,
            input.user,
            'managed-review-publish',
            async (claim) => {
                const pdoc = await document.coll.findOne(
                    {
                        domainId: input.domainId,
                        docType: document.TYPE_PROBLEM,
                        docId: input.docId,
                        'aclWriteClaim.requestId': claim.requestId,
                        'aclWriteClaim.actor': claim.actor,
                        'aclWriteClaim.operation': claim.operation,
                        'aclWriteClaim.capability': 'publish',
                        'aclWriteClaim.state': 'active',
                    },
                    {
                        projection: {
                            domainId: 1,
                            docId: 1,
                            pid: 1,
                            problemKind: 1,
                            authoringMode: 1,
                            hidden: 1,
                            archivedAt: 1,
                            sourceMeta: 1,
                            managedAuthoring: 1,
                            config: 1,
                            data: 1,
                            structureRevision: 1,
                        },
                    },
                );
                if (
                    !pdoc ||
                    pdoc.problemKind !== 'programming' ||
                    pdoc.authoringMode !== 'managed' ||
                    pdoc.hidden !== true ||
                    pdoc.archivedAt ||
                    !['draft', 'confirmed'].includes(pdoc.managedAuthoring?.metadataStatus || '')
                ) {
                    throw new ManagedProblemMetadataConflictError('题目不再是可发布的托管草稿');
                }
                let prepared: Awaited<ReturnType<typeof prepareManagedProblemPublication>>;
                try {
                    prepared = await prepareManagedProblemPublication(input.domainId, pdoc);
                } catch (error) {
                    const validation = managedValidationContext(pdoc.sourceMeta, pdoc.managedAuthoring?.pendingTrainingPlacement);
                    logger.warn(
                        'Managed publish validation rejected domain=%s pid=%d publicPid=%s actor=%d template=%o training=%o chapter=%o stage=publish-validate error=%o',
                        input.domainId,
                        input.docId,
                        pdoc.pid,
                        input.actor,
                        validation.template,
                        validation.trainingId,
                        validation.chapterId,
                        error,
                    );
                    throw error;
                }
                assertPublishableProblem({
                    domainId: input.domainId,
                    docId: input.docId,
                    publicPid: pdoc.pid,
                    actor: input.actor,
                    problemKind: pdoc.problemKind,
                    codeEvaluationStatus: pdoc.codeEvaluationStatus,
                    structureRevision: pdoc.structureRevision,
                    config: pdoc.config,
                    data: pdoc.data,
                });
                await prepareManagedPublish(claim);
                const approvedAt = new Date();
                const managedAuthoring: NonNullable<ProblemDoc['managedAuthoring']> = {
                    workingTitle: pdoc.managedAuthoring.workingTitle,
                    selectedMindmapNodeIds: prepared.selectedMindmapNodeIds,
                    metadataStatus: 'confirmed',
                    approvedBy: input.actor,
                    approvedAt,
                };
                const committed = await commitManagedProblemPublication({
                    domainId: input.domainId,
                    docId: input.docId,
                    claim: { requestId: claim.requestId, actor: claim.actor, operation: claim.operation, capability: 'publish' },
                    title: formalTitle,
                    difficulty: input.difficulty,
                    tags: prepared.tags,
                    sourceMeta: prepared.sourceMeta,
                    managedAuthoring,
                    expectedMetadataStatus: pdoc.managedAuthoring.metadataStatus,
                    pendingTrainingPlacement: prepared.pendingTrainingPlacement,
                });
                finalization = {
                    requestId: claim.requestId,
                    publicPid: pdoc.pid,
                    approvedAt,
                    trainingId: prepared.pendingTrainingPlacement?.trainingId,
                    chapterId: prepared.pendingTrainingPlacement?.chapterId,
                };
                return committed;
            },
            { capability: 'publish' },
        );
        if (!finalization) throw new Error(`managed publication finalization context missing: ${input.domainId}/${input.docId}`);
        const context = finalization as NonNullable<typeof finalization>;
        try {
            await OplogModel.add({
                type: 'problem.managed.publish',
                domainId: input.domainId,
                operator: input.actor,
                problemId: input.docId,
                action: 'publish',
                result: 'success',
                requestId: context.requestId,
                formalTitle,
                difficulty: input.difficulty,
                approvedAt: context.approvedAt,
                trainingId: context.trainingId,
                chapterId: context.chapterId,
                time: new Date(),
            } as any);
            await bus.emit('problem/edit', published, context.requestId);
        } catch (error) {
            logger.error(
                'Managed publish committed but finalization failed domain=%s pid=%d publicPid=%s actor=%d requestId=%s training=%s chapter=%s approvedAt=%s stage=finalize error=%o',
                input.domainId,
                input.docId,
                context.publicPid,
                input.actor,
                context.requestId,
                context.trainingId,
                context.chapterId,
                context.approvedAt.toISOString(),
                error,
            );
            throw new Error(`managed publication committed but finalization failed: ${input.domainId}/${input.docId}/${context.requestId}`, {
                cause: error,
            });
        }
        logger.info(
            'Managed publish succeeded domain=%s pid=%d publicPid=%s actor=%d requestId=%s training=%s chapter=%s result=success',
            input.domainId,
            input.docId,
            context.publicPid,
            input.actor,
            context.requestId,
            context.trainingId,
            context.chapterId,
        );
        return published;
    }

    static createProblemByKind(
        kind: ProblemKind,
        domainId: string,
        pid: string,
        title: string,
        content: string,
        owner: number,
        tag: string[] = [],
        options: Omit<ProblemCreateOptions, 'problemKind'> = {},
        hooks: ProblemCreateHooks = {},
    ) {
        return ProblemModel.add(
            domainId,
            pid,
            title,
            content,
            owner,
            tag,
            {
                ...options,
                problemKind: parseProblemKind(kind),
            },
            hooks,
        );
    }

    private static async materializeStartedContainerLock(domainId: string, pid: number): Promise<boolean> {
        if (!(await hasStartedProblemContainer(domainId, pid))) return false;
        const now = new Date();
        await document.coll.updateOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
                problemKind: { $exists: true },
                structureLockedAt: { $exists: false },
            },
            {
                $set: {
                    structureLockedAt: now,
                    structureLockReason: 'container_started',
                },
                $inc: { structureRevision: 1 },
            },
        );
        return true;
    }

    /** Deny programming-tag preview and normalization once the lifecycle structure is no longer writable. */
    static async assertProgrammingTagNormalizationUnlocked(domainId: string, pid: number): Promise<void> {
        const pdoc = await document.coll.findOne(
            { domainId, docType: document.TYPE_PROBLEM, docId: pid },
            { projection: { problemKind: 1, authoringMode: 1, structureLockedAt: 1, archivedAt: 1 } },
        );
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        const problemKind = pdoc.problemKind === undefined ? 'programming' : parseProblemKind(pdoc.problemKind);
        if (problemKind !== 'programming' || pdoc.authoringMode === 'managed') {
            throw new ValidationError('problemKind', null, '只有普通编程题可以规范化历史标签');
        }
        if (pdoc.archivedAt || pdoc.structureLockedAt || (await ProblemModel.materializeStartedContainerLock(domainId, pid))) {
            throw new ProblemStructureConflictError(pid);
        }
    }

    static async applyProgrammingTagNormalization(input: {
        domainId: string;
        pid: number;
        user: ProblemAclUser;
        selectedNodeIds: unknown;
        previewFingerprint: string;
    }) {
        return ProblemModel.withAuthorizedWriteClaim(
            input.domainId,
            input.pid,
            input.user,
            'programming-tag-normalize',
            async (claim) => {
                const current = await document.coll.findOne(
                    {
                        domainId: input.domainId,
                        docType: document.TYPE_PROBLEM,
                        docId: input.pid,
                        'aclWriteClaim.requestId': claim.requestId,
                        'aclWriteClaim.actor': claim.actor,
                        'aclWriteClaim.operation': claim.operation,
                        'aclWriteClaim.capability': claim.capability,
                        'aclWriteClaim.state': 'active',
                    },
                    {
                        projection: {
                            domainId: 1,
                            docId: 1,
                            pid: 1,
                            problemKind: 1,
                            authoringMode: 1,
                            tag: 1,
                            knowledgeNodeIds: 1,
                            structureRevision: 1,
                            structureLockedAt: 1,
                            archivedAt: 1,
                        },
                    },
                );
                if (!current) throw new Error(`problem write claim ownership lost before tag normalization: ${claim.requestId}`);
                const problemKind = current.problemKind === undefined ? 'programming' : parseProblemKind(current.problemKind);
                if (problemKind !== 'programming' || current.authoringMode === 'managed') {
                    throw new ValidationError('problemKind', null, '只有普通编程题可以规范化历史标签');
                }
                if (
                    current.archivedAt ||
                    current.structureLockedAt ||
                    (await ProblemModel.materializeStartedContainerLock(input.domainId, input.pid))
                ) {
                    throw new ProblemStructureConflictError(input.pid);
                }
                const preview = await previewProgrammingTagNormalization({
                    domainId: input.domainId,
                    docId: input.pid,
                    structureRevision: current.structureRevision,
                    currentTags: current.tag || [],
                    selectedNodeIds: input.selectedNodeIds,
                });
                if (preview.fingerprint !== input.previewFingerprint) {
                    logger.warn(
                        'Programming tag normalization rejected domain=%s pid=%s docId=%d actor=%d stage=confirm result=stale-preview oldTagCount=%d sourceTagCount=%d selectedNodeCount=%d addedTagCount=%d removedTagCount=%d revision=%s',
                        input.domainId,
                        current.pid || `P${current.docId}`,
                        current.docId,
                        input.user._id,
                        current.tag?.length || 0,
                        preview.sourceTags.length,
                        preview.selectedNodeIds.length,
                        preview.addedTags.length,
                        preview.removedTags.length,
                        current.structureRevision ?? 'legacy',
                    );
                    throw new ProblemTagConflictError(input.pid);
                }
                let result: ProblemDoc;
                try {
                    result = await ProblemModel.editWithClaim(
                        claim,
                        { tag: preview.nextTags, knowledgeNodeIds: preview.selectedNodeIds },
                        {},
                        { expectedStructureRevision: current.structureRevision, expectedTag: current.tag || [] },
                    );
                } catch (error) {
                    if (!(error instanceof ValidationError)) throw error;
                    const conflict = new ProblemTagConflictError(input.pid);
                    Object.defineProperty(conflict, 'cause', { value: error, configurable: true });
                    throw conflict;
                }
                logger.info(
                    'Programming tag normalization succeeded domain=%s pid=%s docId=%d actor=%d stage=commit result=success oldTagCount=%d sourceTagCount=%d selectedNodeCount=%d addedTagCount=%d removedTagCount=%d revision=%s sourceTags=%o addedTags=%o removedTags=%o',
                    input.domainId,
                    current.pid || `P${current.docId}`,
                    current.docId,
                    input.user._id,
                    current.tag?.length || 0,
                    preview.sourceTags.length,
                    preview.selectedNodeIds.length,
                    preview.addedTags.length,
                    preview.removedTags.length,
                    current.structureRevision ?? 'legacy',
                    preview.sourceTags,
                    preview.addedTags,
                    preview.removedTags,
                );
                return { pdoc: result, preview };
            },
            { capability: 'maintain' },
        );
    }

    static async claimStructureLockForSubmission(domainId: string, pid: number, lockStructure = true, actor?: number): Promise<ProblemDoc> {
        const projection = {
            domainId: 1,
            docId: 1,
            pid: 1,
            problemKind: 1,
            codeEvaluationStatus: 1,
            config: 1,
            data: 1,
            reference: 1,
            structureRevision: 1,
            structureLockedAt: 1,
        } as const;
        const pdoc = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
            },
            { projection },
        );
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        assertProblemReadyForUseWithTrace(pdoc as ProblemDoc, { actor, stage: 'record-create' });
        let source: ProblemDoc | null = null;
        if (pdoc.reference) {
            source = (await document.coll.findOne(
                {
                    domainId: pdoc.reference.domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: pdoc.reference.pid,
                },
                { projection },
            )) as ProblemDoc | null;
            if (!source) throw new ProblemNotFoundError(pdoc.reference.domainId, pdoc.reference.pid);
            assertProblemReadyForUseWithTrace(source, { actor, stage: 'record-create-reference' });
        }
        const claimLock = async (snapshot: ProblemDoc) => {
            if (!lockStructure || snapshot.problemKind === undefined || snapshot.structureLockedAt) return;
            parseProblemKind(snapshot.problemKind);
            assertStructureRevision(snapshot.structureRevision);
            const result = await document.coll.updateOne(
                {
                    domainId: snapshot.domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: snapshot.docId,
                    structureRevision: snapshot.structureRevision,
                    structureLockedAt: { $exists: false },
                    aclWriteClaim: { $exists: false },
                },
                {
                    $set: {
                        structureLockedAt: new Date(),
                        structureLockReason: 'first_submission',
                    },
                    $inc: { structureRevision: 1 },
                },
            );
            if (result.matchedCount === 1) return;
            const current = await document.coll.findOne(
                {
                    domainId: snapshot.domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: snapshot.docId,
                },
                { projection: { structureLockedAt: 1 } },
            );
            if (!current?.structureLockedAt) throw new ProblemStructureConflictError(snapshot.docId);
        };
        await claimLock(pdoc as ProblemDoc);
        if (source) await claimLock(source);
        return source || (pdoc as ProblemDoc);
    }

    private static async editAuthorizedWithSnapshot(input: {
        domainId: string;
        pid: number;
        user: ProblemAclUser;
        operation: string;
        $set: Partial<ProblemDoc>;
        expectedProblemKind: ProblemKind;
        expectedStructureRevision?: number;
        validateSnapshot?: (before: ProblemDoc, nextConfig: unknown) => void;
    }): Promise<{ before: ProblemDoc; result: ProblemDoc; auditedFields: string[] }> {
        const auditedFields = problemEditAuditedFields(input.$set as Record<string, unknown>);
        return ProblemModel.withAuthorizedWriteClaim(input.domainId, input.pid, input.user, input.operation, async (claim) => {
            const projection = Object.fromEntries(
                [
                    ...new Set([
                        ...auditedFields,
                        'domainId',
                        'docId',
                        'pid',
                        'problemKind',
                        'codeEvaluationStatus',
                        'structureRevision',
                        'config',
                        'data',
                    ]),
                ].map((field) => [field, 1]),
            );
            const before = (await document.coll.findOne(
                {
                    domainId: input.domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: input.pid,
                    'aclWriteClaim.requestId': claim.requestId,
                    'aclWriteClaim.actor': claim.actor,
                    'aclWriteClaim.operation': claim.operation,
                    'aclWriteClaim.capability': claim.capability,
                    'aclWriteClaim.state': 'active',
                },
                { projection },
            )) as ProblemDoc | null;
            if (!before) {
                throw new Error(`problem write claim ownership lost before snapshot: ${claim.requestId}`);
            }
            if (parseProblemKind(before.problemKind) !== input.expectedProblemKind) {
                throw new ValidationError('problemKind');
            }
            const hasConfigUpdate = input.$set.config !== undefined;
            const existingConfig = parseProblemConfigObject(before) as any;
            const nextConfig = hasConfigUpdate ? (input.$set.config as any) : existingConfig;
            if (hasConfigUpdate && ['program_fill', 'function'].includes(input.expectedProblemKind)) {
                const existingEditor = structuredProblemConfigForEditor(input.expectedProblemKind, existingConfig).main as any;
                const nextEditor = structuredProblemConfigForEditor(input.expectedProblemKind, nextConfig).main as any;
                if (input.expectedProblemKind === 'program_fill' && existingEditor.mode !== nextEditor.mode) {
                    throw new ValidationError('mode', null, '程序填空模式创建后不可修改');
                }
                if (existingEditor.mode !== 'text' && existingEditor.lang && existingEditor.lang !== nextEditor.lang) {
                    throw new ValidationError('lang', null, '评测语言创建后不可修改');
                }
            }
            input.validateSnapshot?.(before, nextConfig);
            if (input.$set.hidden === false) {
                assertPublishableProblem({
                    domainId: input.domainId,
                    docId: input.pid,
                    publicPid: before.pid,
                    actor: input.user._id,
                    problemKind: input.expectedProblemKind,
                    codeEvaluationStatus: input.$set.codeEvaluationStatus ?? before.codeEvaluationStatus,
                    structureRevision: before.structureRevision,
                    config: nextConfig,
                    data: before.data,
                });
            }
            const result = await ProblemModel.editWithClaim(
                claim,
                input.$set,
                {},
                {
                    expectedStructureRevision: input.expectedStructureRevision,
                    requireExpectedStructureRevision: true,
                },
            );
            return { before, result, auditedFields };
        });
    }

    static async saveStructuredProblem(input: {
        domainId: string;
        pid: number;
        actor: number;
        user: ProblemAclUser;
        expectedStructureRevision: number;
        problemKind: ProblemKind;
        content: string;
        config: unknown;
        metadata?: Partial<Pick<ProblemDoc, 'title' | 'pid' | 'hidden' | 'tag' | 'difficulty' | 'lockHidden' | 'html' | 'knowledgeNodeIds'>>;
        completeCodeEvaluationDraft?: boolean;
    }): Promise<ProblemDoc> {
        const problemKind = parseProblemKind(input.problemKind);
        const lifecycle = await document.coll.findOne(
            { domainId: input.domainId, docType: document.TYPE_PROBLEM, docId: input.pid },
            { projection: { problemKind: 1, codeEvaluationStatus: 1, config: 1 } },
        );
        if (!lifecycle) throw new ProblemNotFoundError(input.domainId, input.pid);
        if (parseProblemKind(lifecycle.problemKind) !== problemKind) throw new ValidationError('problemKind');
        const codeEvaluation = isCodeEvaluationProblem(problemKind, lifecycle.config);
        if (input.completeCodeEvaluationDraft && (!codeEvaluation || lifecycle.codeEvaluationStatus !== 'draft')) {
            throw new ValidationError('codeEvaluationStatus', null, '只有未完成的代码评测草稿可以执行完成操作');
        }
        let config: Record<string, unknown>;
        try {
            config =
                codeEvaluation && lifecycle.codeEvaluationStatus === 'draft' && !input.completeCodeEvaluationDraft
                    ? normalizeCodeEvaluationDraftConfig(problemKind, input.config, lifecycle.config)
                    : normalizeStructuredProblemConfig(problemKind, input.config, lifecycle.config);
        } catch (error) {
            logger.error(
                'Structured problem save rejected domain=%s pid=%d kind=%s revision=%d stage=%s error=%o',
                input.domainId,
                input.pid,
                problemKind,
                input.expectedStructureRevision,
                input.completeCodeEvaluationDraft ? 'complete-normalize' : 'save-normalize',
                error,
            );
            throw error;
        }
        const completing = input.completeCodeEvaluationDraft === true;
        const $set = {
            ...input.metadata,
            content: input.content,
            config,
            problemKind,
            ...(completing ? { hidden: true, codeEvaluationStatus: 'ready' as const } : {}),
        } as any;
        if (completing) {
            logger.info(
                'Code evaluation completion started domain=%s pid=%d problemKind=%s actor=%d stage=complete structureRevision=%d result=attempt',
                input.domainId,
                input.pid,
                problemKind,
                input.actor,
                input.expectedStructureRevision,
            );
        }
        let snapshot: Awaited<ReturnType<typeof ProblemModel.editAuthorizedWithSnapshot>>;
        try {
            snapshot = await ProblemModel.editAuthorizedWithSnapshot({
                domainId: input.domainId,
                pid: input.pid,
                user: input.user,
                operation: completing ? 'code-evaluation-complete' : 'structure-save',
                $set,
                expectedProblemKind: problemKind,
                expectedStructureRevision: input.expectedStructureRevision,
                validateSnapshot: (before, nextConfig) => {
                    if (!codeEvaluation) return;
                    assertCodeEvaluationStatusInvariant(problemKind, nextConfig, before.codeEvaluationStatus);
                    if (before.codeEvaluationStatus === 'draft') {
                        if (completing) {
                            assertProblemReadyForUseWithTrace(
                                {
                                    ...before,
                                    config: nextConfig as any,
                                    codeEvaluationStatus: 'ready',
                                },
                                { actor: input.actor, stage: 'complete-cas' },
                            );
                        } else {
                            assertCodeEvaluationMappingsExistWithTrace(before, nextConfig, {
                                actor: input.actor,
                                stage: 'draft-save-mapping',
                            });
                        }
                        return;
                    }
                    if (before.codeEvaluationStatus !== 'ready') {
                        throw new ValidationError('codeEvaluationStatus', null, '代码评测题缺少有效生命周期状态');
                    }
                    assertProblemReadyForUseWithTrace({ ...before, config: nextConfig as any }, { actor: input.actor, stage: 'ready-save' });
                },
            });
        } catch (error) {
            if (completing) {
                logger.warn(
                    'Code evaluation completion rejected domain=%s pid=%d problemKind=%s actor=%d stage=complete structureRevision=%d result=denied error=%o',
                    input.domainId,
                    input.pid,
                    problemKind,
                    input.actor,
                    input.expectedStructureRevision,
                    error,
                );
            }
            throw error;
        }
        const { before, result, auditedFields } = snapshot;
        const changedFields = auditedFields.filter((field) => !isEqual(before[field], result[field]));
        await OplogModel.add({
            type: 'problem.structure.save',
            domainId: input.domainId,
            operator: input.actor,
            problemId: input.pid,
            problemKind,
            revision: result.structureRevision,
            changedFields,
            time: new Date(),
        } as any);
        if (completing) {
            logger.info(
                'Code evaluation completion succeeded domain=%s pid=%s docId=%d problemKind=%s actor=%d stage=complete structureRevision=%d result=ready',
                input.domainId,
                result.pid || '-',
                input.pid,
                problemKind,
                input.actor,
                result.structureRevision,
            );
        }
        return result;
    }

    static async saveStructuredProblemMetadata(input: {
        domainId: string;
        pid: number;
        actor: number;
        user: ProblemAclUser;
        problemKind: ProblemKind;
        metadata: Pick<ProblemDoc, 'title' | 'hidden' | 'tag' | 'difficulty' | 'knowledgeNodeIds'>;
    }): Promise<ProblemDoc> {
        const problemKind = parseProblemKind(input.problemKind);
        if (problemKind === 'programming') throw new ValidationError('problemKind');
        const { before, result, auditedFields } = await ProblemModel.editAuthorizedWithSnapshot({
            domainId: input.domainId,
            pid: input.pid,
            user: input.user,
            operation: 'metadata-save',
            $set: input.metadata,
            expectedProblemKind: problemKind,
        });
        const changedFields = auditedFields.filter((field) => !isEqual(before[field], result[field]));
        await OplogModel.add({
            type: 'problem.metadata.save',
            domainId: input.domainId,
            operator: input.actor,
            problemId: input.pid,
            problemKind,
            revision: result.structureRevision,
            changedFields,
            time: new Date(),
        } as any);
        return result;
    }

    static async archiveProblem(domainId: string, pid: number, actor: number, reason: string, user: ProblemAclUser): Promise<ProblemDoc> {
        const archiveReason = reason.trim();
        if (!archiveReason) throw new ValidationError('reason');
        const result = await ProblemModel.editAuthorized(
            domainId,
            pid,
            {
                hidden: true,
                archivedAt: new Date(),
                archivedBy: actor,
                archiveReason,
            },
            user,
        );
        await OplogModel.add({
            type: 'problem.archive',
            domainId,
            operator: actor,
            problemId: pid,
            changedFields: ['hidden', 'archivedAt', 'archivedBy', 'archiveReason'],
            time: new Date(),
        } as any);
        return result;
    }

    static findProblemReferences(domainId: string, pid: number, publicPid?: string) {
        return findProblemReferences(domainId, pid, publicPid);
    }

    private static async assertNoProblemReferences(domainId: string, pid: number, publicPid?: string) {
        let report;
        try {
            report = await ProblemModel.findProblemReferences(domainId, pid, publicPid);
        } catch (error) {
            logger.error('Hard delete reference scan failed domain=%s pid=%d error=%o', domainId, pid, error);
            throw error;
        }
        if (!problemReferenceCount(report)) return;
        logger.warn('Hard delete rejected domain=%s pid=%d references=%o', domainId, pid, report);
        throw new ProblemIsReferencedError('delete');
    }

    static async get(
        domainId: string,
        pid: string | number,
        projection: Projection<ProblemDoc> = ProblemModel.PROJECTION_PUBLIC,
        rawConfig = false,
    ): Promise<ProblemDoc | null> {
        if (Number.isSafeInteger(+pid)) pid = +pid;
        const ddoc = await DomainModel.get(domainId);
        const res =
            typeof pid === 'number'
                ? await document.get(domainId, document.TYPE_PROBLEM, pid, projection)
                : (
                      await document
                          .getMulti(domainId, document.TYPE_PROBLEM, { sort: sortable(pid, ddoc?.namespaces), pid })
                          .project(buildProjection(projection))
                          .limit(1)
                          .toArray()
                  )[0];
        if (!res) return null;
        try {
            if (!rawConfig && projection.includes('config')) res.config = await parseConfig(res.config, res.data?.map((i) => i.name) || []);
        } catch (e) {
            res.config = `Cannot parse: ${e.message}`;
        }
        return res;
    }

    /**
     * Direct-problem read whose authorization is linearized against ACL
     * mutation locks and revisions. Container-authorized reads intentionally
     * continue to use `get`: their authorization belongs to the container.
     */
    static async getViewableAuthorized(
        domainId: string,
        pid: string | number,
        user: User & ProblemAclUser,
        projection: Projection<ProblemDoc> = ProblemModel.PROJECTION_PUBLIC,
        rawConfig = false,
    ): Promise<ProblemDoc | null> {
        const requestedFields = new Set<string>(projection as string[]);
        const authorizationFields = ['domainId', 'docId', 'owner', 'hidden', 'authoringMode'] as Field[];
        const readProjection = Array.from(
            new Set([...(projection as Field[]), ...authorizationFields, ...(Array.from(PROBLEM_ACL_INTERNAL_FIELDS) as Field[])]),
        ) as Projection<ProblemDoc>;

        const read = async (filter?: Filter<ProblemDoc>) => {
            if (!filter) return ProblemModel.get(domainId, pid, readProjection, rawConfig);
            const [res] = await document
                .getMulti(domainId, document.TYPE_PROBLEM, filter)
                .project<ProblemDoc>(buildProjection(readProjection))
                .limit(1)
                .toArray();
            if (!res) return null;
            try {
                if (!rawConfig && readProjection.includes('config')) {
                    res.config = await parseConfig(res.config as string | ProblemConfigFile, res.data?.map((i) => i.name) || []);
                }
            } catch (e) {
                res.config = `Cannot parse: ${e.message}`;
            }
            return res;
        };

        const pdoc = await readStableViewableProblem(domainId, user, read);
        if (!pdoc) return null;
        for (const field of authorizationFields) {
            if (!requestedFields.has(field)) delete (pdoc as any)[field];
        }
        return pdoc;
    }

    /**
     * Small direct-read batch helper for non-container surfaces such as the
     * record list and user profile. Each problem still crosses the canonical
     * stable ACL read; unauthorized rows are omitted rather than replaced by
     * a document that could leak hidden metadata.
     */
    static async getListViewableAuthorized(
        domainId: string,
        pids: number[],
        user: User & ProblemAclUser,
        projection: Projection<ProblemDoc> = ProblemModel.PROJECTION_PUBLIC,
        rawConfig = false,
        indexByDocIdOnly = false,
    ): Promise<ProblemDict> {
        if (!pids?.length) return {};
        const requestedFields = new Set<string>(projection as string[]);
        const authorizationFields = ['domainId', 'docId', 'owner', 'hidden', 'authoringMode'] as Field[];
        const readProjection = Array.from(
            new Set([...(projection as Field[]), ...authorizationFields, ...(Array.from(PROBLEM_ACL_INTERNAL_FIELDS) as Field[])]),
        ) as Projection<ProblemDoc>;
        const read = async (filter: Filter<ProblemDoc>) => {
            const docs = await document
                .getMulti(domainId, document.TYPE_PROBLEM, filter)
                .project<ProblemDoc>(buildProjection(readProjection))
                .toArray();
            if (!rawConfig && readProjection.includes('config')) {
                for (const pdoc of docs) {
                    try {
                        pdoc.config = await parseConfig(pdoc.config as string | ProblemConfigFile, pdoc.data?.map((item) => item.name) || []);
                    } catch (e) {
                        pdoc.config = `Cannot parse: ${e.message}`;
                    }
                }
            }
            return docs;
        };
        const pdocs = await readStableViewableProblems(domainId, user, pids, read);
        const byDocId: Record<number, ProblemDoc> = {};
        const byPublicId: Record<string, ProblemDoc> = {};
        for (const pdoc of pdocs) {
            for (const field of authorizationFields) {
                if (!requestedFields.has(field)) delete (pdoc as any)[field];
            }
            byDocId[pdoc.docId] = pdoc;
            if (pdoc.pid) byPublicId[pdoc.pid] = pdoc;
        }
        return indexByDocIdOnly ? byDocId : Object.assign(byDocId, byPublicId);
    }

    /**
     * Maintainer-only read linearized against the current persistent ACL.
     * Raw config is loaded only by the final revision-guarded read, never
     * trusted from request preload or from a container-authorized statement.
     */
    static async getMaintainableAuthorized(
        domainId: string,
        pid: string | number,
        user: User & ProblemAclUser,
        projection: Projection<ProblemDoc> = ProblemModel.PROJECTION_PUBLIC,
        rawConfig = false,
    ): Promise<ProblemDoc | null> {
        const requestedFields = new Set<string>(projection as string[]);
        const authorizationFields = ['domainId', 'docId', 'owner', 'maintainer', 'authoringMode', 'managedAuthoring'] as Field[];
        const identityProjection = Array.from(
            new Set([...authorizationFields, ...(Array.from(PROBLEM_ACL_INTERNAL_FIELDS) as Field[])]),
        ) as Projection<ProblemDoc>;
        const readProjection = Array.from(new Set([...(projection as Field[]), ...identityProjection])) as Projection<ProblemDoc>;

        const read = async (filter?: Filter<ProblemDoc>) => {
            // The first read establishes identity/revision only. Sensitive raw
            // fields are fetched solely by the conditional final read below.
            if (!filter) return ProblemModel.get(domainId, pid, identityProjection, true);
            const [res] = await document
                .getMulti(domainId, document.TYPE_PROBLEM, filter)
                .project<ProblemDoc>(buildProjection(readProjection))
                .limit(1)
                .toArray();
            if (!res) return null;
            try {
                if (!rawConfig && readProjection.includes('config')) {
                    res.config = await parseConfig(res.config as string | ProblemConfigFile, res.data?.map((i) => i.name) || []);
                }
            } catch (e) {
                res.config = `Cannot parse: ${e.message}`;
            }
            return res;
        };

        const pdoc = await readStableMaintainableProblem(domainId, user, read);
        if (!pdoc) return null;
        for (const field of authorizationFields) {
            if (!requestedFields.has(field)) delete (pdoc as any)[field];
        }
        return pdoc;
    }

    /** Sensitive editor read for managed authors and legacy maintainers. */
    static async getEditableAuthorized(
        domainId: string,
        pid: string | number,
        user: User & ProblemAclUser,
        projection: Projection<ProblemDoc> = ProblemModel.PROJECTION_PUBLIC,
        rawConfig = false,
    ): Promise<ProblemDoc | null> {
        const requestedFields = new Set<string>(projection as string[]);
        const authorizationFields = ['domainId', 'docId', 'owner', 'maintainer', 'authoringMode', 'managedAuthoring'] as Field[];
        const identityProjection = Array.from(
            new Set([...authorizationFields, ...(Array.from(PROBLEM_ACL_INTERNAL_FIELDS) as Field[])]),
        ) as Projection<ProblemDoc>;
        const readProjection = Array.from(new Set([...(projection as Field[]), ...identityProjection])) as Projection<ProblemDoc>;

        const read = async (filter?: Filter<ProblemDoc>) => {
            if (!filter) return ProblemModel.get(domainId, pid, identityProjection, true);
            const [res] = await document
                .getMulti(domainId, document.TYPE_PROBLEM, filter)
                .project<ProblemDoc>(buildProjection(readProjection))
                .limit(1)
                .toArray();
            if (!res) return null;
            try {
                if (!rawConfig && readProjection.includes('config')) {
                    res.config = await parseConfig(res.config as string | ProblemConfigFile, res.data?.map((i) => i.name) || []);
                }
            } catch (e) {
                res.config = `Cannot parse: ${e.message}`;
            }
            return res;
        };

        const pdoc = await readStableEditableProblem(domainId, user, read);
        if (!pdoc) return null;
        for (const field of authorizationFields) {
            if (!requestedFields.has(field)) delete (pdoc as any)[field];
        }
        return pdoc;
    }

    static getMulti(domainId: string, query: Filter<ProblemDoc>, projection = ProblemModel.PROJECTION_LIST) {
        return document.getMulti(domainId, document.TYPE_PROBLEM, query, projection).sort({ sort: 1 });
    }

    /** @deprecated */
    static async list(
        domainId: string,
        query: Filter<ProblemDoc>,
        page: number,
        pageSize: number,
        projection = ProblemModel.PROJECTION_LIST,
    ): Promise<[ProblemDoc[], number, number]> {
        return await db.paginate(document.getMulti(domainId, document.TYPE_PROBLEM, query, projection).sort({ sort: 1, docId: 1 }), page, pageSize);
    }

    static getStatus(domainId: string, docId: number, uid: number) {
        return document.getStatus(domainId, document.TYPE_PROBLEM, docId, uid);
    }

    static getMultiStatus(domainId: string, query: Filter<ProblemStatusDoc>) {
        return document.getMultiStatus(domainId, document.TYPE_PROBLEM, query);
    }

    static async edit(
        domainId: string,
        _id: number,
        $set: Partial<ProblemDoc>,
        options: { expectedStructureRevision?: number; skipStructureGuard?: boolean; waitForObservers?: boolean } = {},
    ): Promise<ProblemDoc> {
        const delpid = $set.pid === '';
        const ddoc = await DomainModel.get(domainId);
        const $unset = delpid ? { pid: '' } : {};
        if (delpid) {
            delete $set.pid;
            $set.sort = sortable(`P${_id}`, ddoc.namespaces);
        } else if ($set.pid) {
            $set.sort = sortable($set.pid, ddoc.namespaces);
        }
        const current = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: _id,
            },
            {
                projection: {
                    domainId: 1,
                    docId: 1,
                    content: 1,
                    config: 1,
                    data: 1,
                    pid: 1,
                    problemKind: 1,
                    codeEvaluationStatus: 1,
                    structureRevision: 1,
                    structureLockedAt: 1,
                    archivedAt: 1,
                    hidden: 1,
                    authoringMode: 1,
                    tag: 1,
                    knowledgeNodeIds: 1,
                },
            },
        );
        if (!current) throw new ProblemNotFoundError(domainId, _id);
        if (current.authoringMode === 'managed') {
            logger.error('Raw managed problem edit rejected domain=%s pid=%d fields=%o', domainId, _id, [
                ...Object.keys($set),
                ...Object.keys($unset),
            ]);
            throw new ValidationError('authoringMode', null, '托管题必须使用授权写入口');
        }
        assertCodeEvaluationStatusTransition(current.codeEvaluationStatus, $set as Record<string, unknown>, $unset, 'raw-edit');
        const rawEditContext = { domainId, pid: _id, operation: 'raw-edit' };
        const preserveProgrammingTagPair =
            current.authoringMode !== 'managed' &&
            (current.problemKind === undefined || parseProblemKind(current.problemKind) === 'programming') &&
            !touchesProgrammingTagPair($set as Record<string, unknown>, $unset);
        const knowledgePairRequired = await canonicalizeStructuredKnowledgePatch(current, $set, $unset, rawEditContext, 'request');
        await bus.parallel('problem/before-edit', $set, $unset);
        if (preserveProgrammingTagPair && touchesProgrammingTagPair($set as Record<string, unknown>, $unset)) {
            logger.warn(
                'Programming tag hook write rejected domain=%s pid=%d actor=- operation=raw-edit stage=after-hook result=denied fields=%o',
                domainId,
                _id,
                [...Object.keys($set), ...Object.keys($unset)].filter(
                    (field) =>
                        field === 'tag' || field.startsWith('tag.') || field === 'knowledgeNodeIds' || field.startsWith('knowledgeNodeIds.'),
                ),
            );
            throw new ValidationError('tag', null, '未请求标签变更时，写入钩子不能修改编程题标签');
        }
        assertCodeEvaluationStatusTransition(current.codeEvaluationStatus, $set as Record<string, unknown>, $unset, 'raw-edit');
        assertCodeEvaluationLifecyclePatchWithTrace(current as ProblemDoc, $set as Record<string, unknown>, $unset, {
            operation: 'raw-edit',
            stage: 'raw-edit',
        });
        await canonicalizeStructuredKnowledgePatch(current, $set, $unset, rawEditContext, 'after-hook', {
            requireKnowledgePair: knowledgePairRequired,
        });
        const publishes = publishesProblemPatch($set as Record<string, unknown>, $unset);
        if (current.archivedAt && publishes) throw new ValidationError('hidden');
        if (publishes) {
            assertPublishableProblem({
                domainId,
                docId: _id,
                publicPid: current.pid,
                problemKind: current.problemKind,
                codeEvaluationStatus: $set.codeEvaluationStatus ?? current.codeEvaluationStatus,
                structureRevision: current.structureRevision,
                config: $set.config ?? current.config,
                data: ($set.data ?? current.data) as any,
            });
        }
        if ($set.content === current.content) delete $set.content;
        let result: ProblemDoc | null;
        if (current.problemKind !== undefined && isStructuralPatch($set as any, $unset) && !options.skipStructureGuard) {
            const expectedRevision = options.expectedStructureRevision ?? current.structureRevision;
            assertStructureRevision(expectedRevision);
            parseProblemKind(current.problemKind);
            if ($set.problemKind !== undefined && $set.problemKind !== current.problemKind) {
                throw new ValidationError('problemKind');
            }
            if (current.structureLockedAt || (await ProblemModel.materializeStartedContainerLock(domainId, _id))) {
                throw new ProblemStructureConflictError(_id);
            }
            result = await document.coll.findOneAndUpdate(
                {
                    domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: _id,
                    structureRevision: expectedRevision,
                    structureLockedAt: { $exists: false },
                },
                {
                    $set,
                    ...(Object.keys($unset).length ? { $unset } : {}),
                    $inc: { structureRevision: 1 },
                },
                { returnDocument: 'after' },
            );
            if (!result) throw new ProblemStructureConflictError(_id);
        } else {
            result = await document.set(domainId, document.TYPE_PROBLEM, _id, $set, $unset);
        }
        if (options.waitForObservers) await bus.parallel('problem/edit', result, undefined, { hidden: current.hidden });
        else bus.emit('problem/edit', result, undefined, { hidden: current.hidden });
        return result;
    }

    static async beginAuthorizedWriteClaim(
        domainId: string,
        _id: number,
        user: ProblemAclUser,
        operation: string,
        options: { requestId?: string; selfRevokeUid?: number; capability?: ProblemWriteCapability } = {},
    ): Promise<ProblemWriteClaim> {
        try {
            const prepareProblemWriteClaim = (global.Hydro?.model as any)?.permits?.prepareProblemWriteClaim;
            if (typeof prepareProblemWriteClaim !== 'function') {
                throw new TypeError('permits.prepareProblemWriteClaim is unavailable');
            }
            await prepareProblemWriteClaim(domainId, _id);
        } catch (error) {
            logger.error(
                'Problem write-claim preflight failed domain=%s pid=%d uid=%d operation=%s error=%o',
                domainId,
                _id,
                user._id,
                operation,
                error,
            );
            const denied = new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
            Object.defineProperty(denied, 'cause', { value: error, configurable: true });
            throw denied;
        }
        await ProblemModel.refreshProblemAcl(user, domainId);
        const authorizedPdoc = await document.get(domainId, document.TYPE_PROBLEM, _id, [
            'domainId',
            'docType',
            'docId',
            'owner',
            'maintainer',
            'authoringMode',
            'managedAuthoring',
            'aclMutationRevision',
            'aclMutationLocks',
            'aclWriteClaim',
        ] as any);
        if (!authorizedPdoc) throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
        const requestId = options.requestId?.trim() || `problem-write:${operation}:${domainId}:${_id}:${new ObjectId().toHexString()}`;
        const claim = await acquireProblemWriteClaim(user, authorizedPdoc, requestId, operation, {
            selfRevokeUid: options.selfRevokeUid,
            capability: options.capability,
        });
        if (!claim) {
            if (authorizedPdoc.authoringMode === 'managed') {
                logger.warn(
                    'Managed write denied domain=%s pid=%d actor=%d operation=%s capability=%s result=denied',
                    domainId,
                    _id,
                    user._id,
                    operation,
                    options.capability || 'maintain',
                );
                await OplogModel.add({
                    type: 'problem.managed.write.denied',
                    domainId,
                    operator: user._id,
                    problemId: _id,
                    operation,
                    capability: options.capability || 'maintain',
                    result: 'denied',
                    time: new Date(),
                } as any);
            }
            throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
        }
        return claim;
    }

    static async withAuthorizedWriteClaim<T>(
        domainId: string,
        _id: number,
        user: ProblemAclUser,
        operation: string,
        work: (claim: ProblemWriteClaim) => Promise<T>,
        options: { requestId?: string; selfRevokeUid?: number; capability?: ProblemWriteCapability } = {},
    ): Promise<T> {
        const claim = await ProblemModel.beginAuthorizedWriteClaim(domainId, _id, user, operation, options);
        try {
            const result = await work(claim);
            if (!(await clearProblemWriteClaim(claim))) {
                throw new Error(`problem write claim ownership lost before clear: ${claim.requestId}`);
            }
            return result;
        } catch (error) {
            if (
                error instanceof ValidationError ||
                error instanceof ProblemStructureConflictError ||
                error instanceof ProblemTagConflictError ||
                error instanceof ProblemIsReferencedError ||
                error instanceof ManagedProblemMetadataConflictError
            ) {
                if (!(await clearProblemWriteClaim(claim))) {
                    throw new Error(`problem write claim ownership lost after rejected request: ${claim.requestId}`, {
                        cause: error,
                    });
                }
                throw error;
            }
            let marked = false;
            try {
                marked = await markProblemWriteClaimError(claim, error);
            } catch (markerError) {
                logger.error(
                    'Problem write failed and ERROR marker write also failed domain=%s pid=%d requestId=%s error=%s markerError=%s',
                    domainId,
                    _id,
                    claim.requestId,
                    error,
                    markerError,
                );
                throw new Error(`problem write failed and ERROR marker could not be persisted: ${claim.requestId}`, { cause: error });
            }
            logger.error(
                'Problem write failed; durable claim retained domain=%s pid=%d actor=%d operation=%s requestId=%s marked=%s error=%s',
                domainId,
                _id,
                claim.actor,
                operation,
                claim.requestId,
                marked,
                error,
            );
            if (!marked) {
                throw new Error(`problem write claim vanished before ERROR marker: ${claim.requestId}`, { cause: error });
            }
            throw error;
        }
    }

    static async withAuthorizedStructuralWriteClaim<T>(
        domainId: string,
        pid: number,
        user: ProblemAclUser,
        operation: string,
        work: (claim: ProblemWriteClaim) => Promise<T>,
        options: { requestId?: string; capability?: ProblemWriteCapability } = {},
    ): Promise<T> {
        return ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pid,
            user,
            operation,
            async (claim) => {
                const current = await document.coll.findOne(
                    {
                        domainId,
                        docType: document.TYPE_PROBLEM,
                        docId: pid,
                        'aclWriteClaim.requestId': claim.requestId,
                        'aclWriteClaim.actor': claim.actor,
                        'aclWriteClaim.operation': claim.operation,
                        'aclWriteClaim.capability': claim.capability,
                        'aclWriteClaim.state': 'active',
                    },
                    { projection: { problemKind: 1, structureRevision: 1, structureLockedAt: 1, archivedAt: 1 } },
                );
                if (!current) throw new Error(`problem write claim ownership lost before ${operation}: ${claim.requestId}`);
                if (current.problemKind === undefined) return work(claim);
                const expectedRevision = current.structureRevision;
                assertStructureRevision(expectedRevision);
                parseProblemKind(current.problemKind);
                if (current.archivedAt || current.structureLockedAt || (await ProblemModel.materializeStartedContainerLock(domainId, pid))) {
                    throw new ProblemStructureConflictError(pid);
                }
                const result = await work(claim);
                const bumped = await document.coll.updateOne(revisionClaimFilter(claim, expectedRevision), { $inc: { structureRevision: 1 } });
                if (bumped.matchedCount !== 1) throw new ProblemStructureConflictError(pid);
                return result;
            },
            options,
        );
    }

    private static async assertDirectStructureWritable(
        domainId: string,
        pid: number,
        testdata = false,
        testdataNames: string[] = [],
    ): Promise<ProblemDoc | null> {
        const pdoc = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
            },
            {
                projection: {
                    domainId: 1,
                    docId: 1,
                    pid: 1,
                    problemKind: 1,
                    codeEvaluationStatus: 1,
                    config: 1,
                    data: 1,
                    structureLockedAt: 1,
                    archivedAt: 1,
                    authoringMode: 1,
                },
            },
        );
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        if (pdoc.authoringMode === 'managed') {
            logger.error('Raw managed problem file write rejected domain=%s pid=%d names=%o', domainId, pid, testdataNames);
            throw new ValidationError('authoringMode', null, '托管题文件必须使用授权写入口');
        }
        if (pdoc.problemKind === undefined) return null;
        const problemKind = parseProblemKind(pdoc.problemKind);
        if (testdata && problemKind !== 'programming' && !structuredProblemUsesTestdata(problemKind, pdoc.config)) {
            throw new ValidationError('problemKind', null, '结构化题不接受 testdata/config.yaml 文件写入');
        }
        if (testdata && problemKind !== 'programming' && testdataNames.some(isProblemConfigFilename)) {
            throw new ValidationError('name', null, '结构化题配置不通过 testdata 文件修改');
        }
        if (pdoc.archivedAt || pdoc.structureLockedAt || (await ProblemModel.materializeStartedContainerLock(domainId, pid))) {
            throw new ProblemStructureConflictError(pid);
        }
        return pdoc as ProblemDoc;
    }

    private static async bumpDirectStructureRevision(domainId: string, pid: number): Promise<void> {
        const result = await document.coll.updateOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
                problemKind: { $exists: true },
                structureLockedAt: { $exists: false },
            },
            { $inc: { structureRevision: 1 } },
        );
        if (result.matchedCount !== 1) throw new ProblemStructureConflictError(pid);
    }

    static async editWithClaim(
        claim: ProblemWriteClaim,
        $set: Partial<ProblemDoc>,
        requestedUnset: Record<string, unknown> = {},
        options: {
            expectedStructureRevision?: number;
            expectedTag?: string[];
            requireExpectedStructureRevision?: boolean;
            skipStructureGuard?: boolean;
        } = {},
    ): Promise<ProblemDoc> {
        const domainId = claim.domainId;
        const _id = claim.pid;

        const delpid = $set.pid === '';
        const ddoc = await DomainModel.get(domainId);
        const $unset = { ...requestedUnset, ...(delpid ? { pid: '' } : {}) };
        if (delpid) {
            delete $set.pid;
            $set.sort = sortable(`P${_id}`, ddoc.namespaces);
        } else if ($set.pid) {
            $set.sort = sortable($set.pid, ddoc.namespaces);
        }
        const requestedFields = [...new Set([...Object.keys($set), ...Object.keys($unset)])];
        const current = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: _id,
                'aclWriteClaim.requestId': claim.requestId,
                'aclWriteClaim.actor': claim.actor,
                'aclWriteClaim.operation': claim.operation,
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            },
            {
                projection: {
                    ...Object.fromEntries(requestedFields.map((field) => [field, 1])),
                    domainId: 1,
                    docId: 1,
                    content: 1,
                    config: 1,
                    data: 1,
                    pid: 1,
                    problemKind: 1,
                    codeEvaluationStatus: 1,
                    structureRevision: 1,
                    structureLockedAt: 1,
                    archivedAt: 1,
                    hidden: 1,
                    authoringMode: 1,
                    managedAuthoring: 1,
                    knowledgeNodeIds: 1,
                },
            },
        );
        if (!current) throw new Error(`problem write claim ownership lost before edit: ${claim.requestId}`);
        let managedGuard: ReturnType<typeof managedProblemPatchCapability> | null = null;
        if (current.authoringMode === 'managed') {
            managedGuard = managedProblemPatchCapability(current, $set, $unset);
            if (managedGuard.immutableFields.length || !problemWriteCapabilityAllows(claim.capability, managedGuard.capability)) {
                await auditManagedClaimPatchDenied(claim, managedGuard, 'request');
                throw new ValidationError('fields', null, '写入字段超出当前托管题写入凭据');
            }
            if (managedGuard.publishes) {
                await auditManagedClaimPatchDenied(claim, managedGuard, 'request');
                throw new ValidationError('hidden', null, '托管草稿必须从统一题库审核入口发布');
            }
        }
        const preserveProgrammingTagPair =
            current.authoringMode !== 'managed' &&
            (current.problemKind === undefined || parseProblemKind(current.problemKind) === 'programming') &&
            !touchesProgrammingTagPair($set as Record<string, unknown>, $unset);
        const knowledgePairRequired = await canonicalizeStructuredKnowledgePatch(current, $set, $unset, claim, 'request');
        const confirmedProgrammingTagPair =
            claim.operation === 'programming-tag-normalize'
                ? {
                      tags: Array.isArray($set.tag) ? [...$set.tag] : [],
                      nodeIds: Array.isArray($set.knowledgeNodeIds) ? $set.knowledgeNodeIds.map(String) : [],
                  }
                : null;
        await bus.parallel('problem/before-edit', $set, $unset);
        const hookTagFields = [...Object.keys($set), ...Object.keys($unset)].filter(
            (field) => field === 'tag' || field.startsWith('tag.') || field === 'knowledgeNodeIds' || field.startsWith('knowledgeNodeIds.'),
        );
        if (preserveProgrammingTagPair && hookTagFields.length) {
            logger.warn(
                'Programming tag hook write rejected domain=%s pid=%d actor=%d operation=%s stage=after-hook result=denied fields=%o',
                domainId,
                _id,
                claim.actor,
                claim.operation,
                hookTagFields,
            );
            throw new ValidationError('tag', null, '未请求标签变更时，写入钩子不能修改编程题标签');
        }
        if (
            confirmedProgrammingTagPair &&
            (!Array.isArray($set.tag) ||
                !isEqual($set.tag, confirmedProgrammingTagPair.tags) ||
                !Array.isArray($set.knowledgeNodeIds) ||
                !isEqual($set.knowledgeNodeIds.map(String), confirmedProgrammingTagPair.nodeIds) ||
                Object.keys($unset).some(
                    (field) =>
                        field === 'tag' || field.startsWith('tag.') || field === 'knowledgeNodeIds' || field.startsWith('knowledgeNodeIds.'),
                ))
        ) {
            logger.warn(
                'Programming tag confirmed pair rejected domain=%s pid=%d actor=%d operation=%s stage=after-hook result=changed-by-hook',
                domainId,
                _id,
                claim.actor,
                claim.operation,
            );
            throw new ValidationError('tag', null, '写入钩子不能改变用户已确认的标签结果');
        }
        if (current.authoringMode === 'managed') {
            const finalGuard = managedProblemPatchCapability(current, $set, $unset);
            if (finalGuard.immutableFields.length || !problemWriteCapabilityAllows(claim.capability, finalGuard.capability)) {
                await auditManagedClaimPatchDenied(claim, finalGuard, 'after-hook');
                throw new ValidationError('fields', null, '写入钩子产生了超出托管题凭据的字段');
            }
            if (finalGuard.publishes) {
                await auditManagedClaimPatchDenied(claim, finalGuard, 'after-hook');
                throw new ValidationError('hidden', null, '托管草稿必须从统一题库审核入口发布');
            }
            managedGuard = finalGuard;
        }
        await canonicalizeStructuredKnowledgePatch(current, $set, $unset, claim, 'after-hook', { requireKnowledgePair: knowledgePairRequired });
        assertCodeEvaluationLifecyclePatchWithTrace(current as ProblemDoc, $set as Record<string, unknown>, $unset, {
            actor: claim.actor,
            operation: claim.operation,
            stage: 'claim-edit',
        });
        const publishes = publishesProblemPatch($set as Record<string, unknown>, $unset);
        if (current.archivedAt && publishes) throw new ValidationError('hidden');
        if (publishes) {
            assertPublishableProblem({
                domainId,
                docId: _id,
                publicPid: current.pid,
                actor: claim.actor,
                problemKind: current.problemKind,
                codeEvaluationStatus: $set.codeEvaluationStatus ?? current.codeEvaluationStatus,
                structureRevision: current.structureRevision,
                config: $set.config ?? current.config,
                data: ($set.data ?? current.data) as any,
            });
        }
        if ($set.content === current.content) delete $set.content;
        let result: ProblemDoc | null;
        if (current.problemKind !== undefined && isStructuralPatch($set as any, $unset) && !options.skipStructureGuard) {
            if (options.requireExpectedStructureRevision) {
                assertStructureRevision(options.expectedStructureRevision);
            }
            const expectedRevision = options.expectedStructureRevision ?? current.structureRevision;
            assertStructureRevision(expectedRevision);
            parseProblemKind(current.problemKind);
            if ($set.problemKind !== undefined && $set.problemKind !== current.problemKind) {
                throw new ValidationError('problemKind');
            }
            if (current.structureLockedAt || (await ProblemModel.materializeStartedContainerLock(domainId, _id))) {
                throw new ProblemStructureConflictError(_id);
            }
            result = await commitProblemWriteClaimUpdate(claim, $set, $unset, managedGuard?.capability || claim.capability, {
                expectedStructureRevision: expectedRevision,
                expectedTag: options.expectedTag,
            });
        } else {
            result = await commitProblemWriteClaimUpdate(claim, $set, $unset, managedGuard?.capability || claim.capability, {
                expectedStructureRevision: options.expectedStructureRevision,
                expectedTag: options.expectedTag,
            });
        }
        if (!result && (options.expectedTag !== undefined || options.expectedStructureRevision !== undefined)) {
            const live = await document.coll.findOne(
                {
                    domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: _id,
                    'aclWriteClaim.requestId': claim.requestId,
                    'aclWriteClaim.actor': claim.actor,
                    'aclWriteClaim.operation': claim.operation,
                    'aclWriteClaim.capability': claim.capability,
                    'aclWriteClaim.state': 'active',
                },
                { projection: { tag: 1, structureRevision: 1, structureLockedAt: 1 } },
            );
            if (
                live &&
                options.expectedTag !== undefined &&
                !isEqual(Array.isArray(live.tag) ? live.tag : [], options.expectedTag)
            ) {
                throw new ProblemTagConflictError(_id);
            }
            if (
                live &&
                options.expectedStructureRevision !== undefined &&
                (live.structureLockedAt || live.structureRevision !== options.expectedStructureRevision)
            ) {
                throw new ProblemStructureConflictError(_id);
            }
        }
        if (!result) throw new Error(`problem write claim ownership lost during edit: ${claim.requestId}`);
        bus.emit('problem/edit', result, claim.requestId, { hidden: current.hidden });
        return result;
    }

    /** HTTP/service-token metadata write entrypoint. */
    static async editAuthorized(
        domainId: string,
        _id: number,
        $set: Partial<ProblemDoc>,
        user: ProblemAclUser,
        requestedUnset: Record<string, unknown> = {},
        options: { expectedStructureRevision?: number; expectedTag?: string[] } = {},
    ): Promise<ProblemDoc> {
        const preliminary = await document.coll.findOne({ domainId, docType: document.TYPE_PROBLEM, docId: _id });
        if (!preliminary) throw new ProblemNotFoundError(domainId, _id);
        if (
            ($set.authoringMode !== undefined && $set.authoringMode !== preliminary.authoringMode) ||
            (requestedUnset.authoringMode !== undefined && preliminary.authoringMode !== undefined)
        ) {
            if (preliminary.authoringMode === 'managed') {
                logger.warn(
                    'Managed write denied domain=%s pid=%d actor=%d operation=metadata-edit fields=authoringMode result=denied',
                    domainId,
                    _id,
                    user._id,
                );
                await OplogModel.add({
                    type: 'problem.managed.write.denied',
                    domainId,
                    operator: user._id,
                    problemId: _id,
                    operation: 'metadata-edit',
                    changedFields: ['authoringMode'],
                    result: 'denied',
                    time: new Date(),
                } as any);
            }
            throw new ValidationError('authoringMode', null, '题目授权模式创建后不可修改');
        }
        const initialGuard =
            preliminary.authoringMode === 'managed'
                ? managedProblemPatchCapability(preliminary, $set, requestedUnset)
                : { capability: 'maintain' as const };
        return ProblemModel.withAuthorizedWriteClaim(
            domainId,
            _id,
            user,
            'metadata-edit',
            async (claim) => {
                const before = await document.coll.findOne({
                    domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: _id,
                    'aclWriteClaim.requestId': claim.requestId,
                    'aclWriteClaim.actor': claim.actor,
                    'aclWriteClaim.operation': claim.operation,
                    'aclWriteClaim.capability': claim.capability,
                    'aclWriteClaim.state': 'active',
                });
                if (!before) throw new Error(`problem write claim ownership lost before managed guard: ${claim.requestId}`);
                let guard: ReturnType<typeof managedProblemPatchCapability> | null = null;
                if (before.authoringMode === 'managed') {
                    guard = managedProblemPatchCapability(before, $set, requestedUnset);
                    if (guard.immutableFields.length || !canUseProblemWriteCapability(user, before, guard.capability)) {
                        logger.warn(
                            'Managed write denied domain=%s pid=%d actor=%d operation=metadata-edit capability=%s fields=%o result=denied',
                            domainId,
                            _id,
                            user._id,
                            guard.capability,
                            guard.changedFields,
                        );
                        await OplogModel.add({
                            type: 'problem.managed.write.denied',
                            domainId,
                            operator: user._id,
                            problemId: _id,
                            operation: 'metadata-edit',
                            capability: guard.capability,
                            changedFields: guard.changedFields,
                            result: 'denied',
                            time: new Date(),
                        } as any);
                        const message = guard.immutableFields.length
                            ? `字段创建后不可修改：${guard.immutableFields.join(', ')}`
                            : '请求包含当前角色不可修改的托管题字段';
                        throw new ValidationError('fields', null, message);
                    }
                }
                const result = await ProblemModel.editWithClaim(claim, $set, requestedUnset, {
                    ...options,
                    requireExpectedStructureRevision: true,
                });
                if (guard) {
                    const type = guard.publishes ? 'problem.managed.publish' : 'problem.managed.write';
                    await OplogModel.add({
                        type,
                        domainId,
                        operator: user._id,
                        problemId: _id,
                        operation: 'metadata-edit',
                        capability: guard.capability,
                        changedFields: guard.changedFields,
                        result: 'success',
                        time: new Date(),
                    } as any);
                    logger.info(
                        'Managed write succeeded domain=%s pid=%d actor=%d operation=metadata-edit capability=%s fields=%o result=success',
                        domainId,
                        _id,
                        user._id,
                        guard.capability,
                        guard.changedFields,
                    );
                }
                return result;
            },
            { capability: initialGuard.capability },
        );
    }

    static async copy(
        domainId: string,
        _id: number,
        target: string,
        pid?: string,
        _hidden?: boolean,
        structuredLanguage?: string,
        attribution: { owner?: number; actor?: number; claim?: ProblemWriteClaim } = {},
    ) {
        const original = await ProblemModel.get(domainId, _id, [...ProblemModel.PROJECTION_PUBLIC, 'knowledgeNodeIds'], true);
        if (!original) throw new ProblemNotFoundError(domainId, _id);
        if (original.authoringMode === 'managed') {
            const claim = attribution.claim;
            if (!claim || claim.domainId !== domainId || claim.pid !== _id || !problemWriteCapabilityAllows(claim.capability, 'clone')) {
                logger.error('Raw managed problem clone rejected domain=%s pid=%d actor=%s', domainId, _id, attribution.actor ?? '-');
                throw new ValidationError('authoringMode', null, '托管题复制必须使用授权写入口');
            }
            const activeClaim = await document.coll.findOne({
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: _id,
                'aclWriteClaim.requestId': claim.requestId,
                'aclWriteClaim.actor': claim.actor,
                'aclWriteClaim.operation': claim.operation,
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            });
            if (!activeClaim) throw new Error(`problem write claim ownership lost before clone: ${claim.requestId}`);
        }
        if (original.reference) throw new ValidationError('reference');
        assertProblemReadyForUseWithTrace(original, { actor: attribution.actor, stage: 'clone-source' });
        if (pid && (/^[0-9]+$/.test(pid) || (await ProblemModel.get(target, pid)))) pid = '';
        if (!pid && original.pid && !(await ProblemModel.get(target, original.pid))) pid = original.pid;
        const problemKind = original.problemKind === undefined ? 'programming' : parseProblemKind(original.problemKind);
        let cloneKnowledge: Awaited<ReturnType<typeof materializeKnowledgeMindmapTags>> | null = null;
        const convertedProgramming =
            problemKind === 'programming' && original.authoringMode !== 'managed' && Object.hasOwn(original, 'knowledgeNodeIds');
        if (DEDICATED_STRUCTURED_PROBLEM_KINDS.has(problemKind) || convertedProgramming) {
            try {
                cloneKnowledge = await materializeKnowledgeMindmapTags(original.knowledgeNodeIds ?? []);
                if (convertedProgramming) {
                    cloneKnowledge.tags = [
                        ...new Set([...(original.tag || []).filter(isCanonicalManagedSourceTag), ...cloneKnowledge.tags]),
                    ];
                }
                logger.info(
                    'Problem clone knowledge canonicalized domain=%s pid=%d target=%s actor=%s kind=%s nodes=%d tags=%d stage=clone-materialize result=allowed',
                    domainId,
                    _id,
                    target,
                    attribution.actor ?? '-',
                    problemKind,
                    cloneKnowledge.nodeIds.length,
                    cloneKnowledge.tags.length,
                );
            } catch (error) {
                logger.warn(
                    'Problem clone knowledge rejected domain=%s pid=%d target=%s actor=%s kind=%s stage=clone-materialize error=%o',
                    domainId,
                    _id,
                    target,
                    attribution.actor ?? '-',
                    problemKind,
                    error,
                );
                throw error;
            }
        }
        const cloneConfig = structuredLanguage
            ? cloneStructuredProblemForLanguage(problemKind, original.config, structuredLanguage)
            : original.config;
        const cloneIsCodeEvaluation = isCodeEvaluationProblem(problemKind, cloneConfig);
        const cloneStructuredConfig = cloneIsCodeEvaluation
            ? (() => {
                  const editor = structuredProblemConfigForEditor(problemKind, cloneConfig) as any;
                  return {
                      main: {
                          ...editor.main,
                          regions: (editor.main.regions || []).map((region: any) => ({ ...region, id: '' })),
                      },
                  };
              })()
            : cloneConfig;
        const cloneOwner = attribution.owner ?? original.owner;
        const cloneActor = attribution.actor ?? cloneOwner;
        const cloneId = await ProblemModel.createProblemByKind(
            problemKind,
            target,
            pid || '',
            original.title,
            original.content,
            cloneOwner,
            cloneKnowledge?.tags ?? original.tag,
            {
                difficulty: original.difficulty,
                structuredConfig: cloneStructuredConfig,
                knowledgeNodeIds: cloneKnowledge?.nodeIds,
                ...(cloneIsCodeEvaluation ? { codeEvaluationStatus: 'draft' as const } : {}),
            },
        );
        const sourcePrefix = `problem/${domainId}/${_id}/`;
        const targetPrefix = `problem/${target}/${cloneId}/`;
        try {
            const files = await storage.list(sourcePrefix);
            await copyProblemStorageFiles({
                files,
                sourceDomainId: domainId,
                sourceProblemId: _id,
                targetDomainId: target,
                targetProblemId: cloneId,
                targetPrefix,
                copy: async (sourcePath, targetPath) => {
                    const content = await storage.get(sourcePath);
                    await storage.put(targetPath, content);
                },
                onFailure: (failure) => {
                    logger.error(
                        'Problem clone file copy failed source=%s/%d target=%s/%d filename=%s error=%o',
                        failure.sourceDomainId,
                        failure.sourceProblemId,
                        failure.targetDomainId,
                        failure.targetProblemId,
                        failure.filename,
                        failure.error,
                    );
                },
            });
            await document.set(target, document.TYPE_PROBLEM, cloneId, {
                ...(cloneIsCodeEvaluation ? {} : { config: cloneConfig as any }),
                data: original.data || [],
                additional_file: original.additional_file || [],
                html: !!original.html,
            });
        } catch (error) {
            logger.error('Problem clone failed domain=%s pid=%d target=%s cloneId=%d error=%o', domainId, _id, target, cloneId, error);
            throw error;
        }
        await OplogModel.add({
            type: 'problem.clone',
            domainId: target,
            operator: cloneActor,
            problemId: cloneId,
            sourceDomainId: domainId,
            sourceProblemId: _id,
            problemKind,
            revision: 1,
            changedFields: ['all'],
            time: new Date(),
        } as any);
        return cloneId;
    }

    static push<T extends ArrayKeys<ProblemDoc>>(domainId: string, _id: number, key: ArrayKeys<ProblemDoc>, value: ProblemDoc[T][0]) {
        assertNoCanonicalProblemPrimitiveMutation(String(key), { domainId, pid: _id, operation: 'problem-array-write' }, 'push');
        if (key === 'data') throw new ValidationError('data', null, '测试数据元数据只能由测试数据文件服务写入');
        return document.push(domainId, document.TYPE_PROBLEM, _id, key, value);
    }

    static pull<T extends ArrayKeys<ProblemDoc>>(domainId: string, pid: number, key: ArrayKeys<ProblemDoc>, values: ProblemDoc[T][0][]) {
        assertNoCanonicalProblemPrimitiveMutation(String(key), { domainId, pid, operation: 'problem-array-write' }, 'pull');
        if (key === 'data') throw new ValidationError('data', null, '测试数据元数据只能由测试数据文件服务写入');
        return document.deleteSub(domainId, document.TYPE_PROBLEM, pid, key, values);
    }

    static inc(domainId: string, _id: number, field: NumberKeys<ProblemDoc> | string, n: number): Promise<ProblemDoc> {
        assertNoCanonicalProblemPrimitiveMutation(String(field), { domainId, pid: _id, operation: 'problem-numeric-write' }, 'inc');
        return document.inc(domainId, document.TYPE_PROBLEM, _id, field as any, n);
    }

    static count(domainId: string, query: Filter<ProblemDoc>) {
        return document.count(domainId, document.TYPE_PROBLEM, query);
    }

    private static async deleteProblemDocumentUnchecked(
        domainId: string,
        docId: number,
        context?: {
            kind: 'managed-draft-creation-cleanup';
            creator: number;
            owner: number;
            documentId: ObjectId;
            publicPid: string;
            writeClaimRequestId?: string;
        },
    ): Promise<boolean> {
        if (context?.kind === 'managed-draft-creation-cleanup') {
            await bus.parallel('problem/before-del', domainId, docId, undefined, context);
            const deleted = await document.coll.deleteOne({
                _id: context.documentId,
                domainId,
                docType: document.TYPE_PROBLEM,
                docId,
                pid: context.publicPid,
                owner: context.owner,
                authoringMode: 'managed',
                hidden: true,
                'managedAuthoring.metadataStatus': 'draft',
            });
            if (deleted.deletedCount !== 1) {
                throw new Error(
                    `managed draft exact cleanup identity lost: domain=${domainId} pid=${docId} publicPid=${context.publicPid} documentId=${context.documentId.toHexString()}`,
                );
            }
            await Promise.all([
                document.deleteMultiStatus(domainId, document.TYPE_PROBLEM, { docId }),
                storage
                    .list(`problem/${domainId}/${docId}/`)
                    .then((items) => storage.del(items.map((item) => `problem/${domainId}/${docId}/${item.name}`))),
                bus.parallel('problem/delete', domainId, docId),
            ]);
            return true;
        }
        await bus.parallel('problem/before-del', domainId, docId, undefined, context);
        const res = await Promise.all([
            document.deleteOne(domainId, document.TYPE_PROBLEM, docId),
            document.deleteMultiStatus(domainId, document.TYPE_PROBLEM, { docId }),
            storage
                .list(`problem/${domainId}/${docId}/`)
                .then((items) => storage.del(items.map((item) => `problem/${domainId}/${docId}/${item.name}`))),
            bus.parallel('problem/delete', domainId, docId),
        ]);
        return !!res[0][0].deletedCount;
    }

    static async del(domainId: string, docId: number) {
        const pdoc = await ProblemModel.get(domainId, docId, ['docId', 'pid', 'authoringMode'] as any, true);
        if (!pdoc) return false;
        if (pdoc.authoringMode === 'managed') {
            logger.error('Raw managed problem delete rejected domain=%s pid=%d', domainId, docId);
            throw new ValidationError('authoringMode', null, '托管题删除必须使用授权写入口');
        }
        await ProblemModel.assertNoProblemReferences(domainId, docId, pdoc.pid);
        return ProblemModel.deleteProblemDocumentUnchecked(domainId, docId);
    }

    /** HTTP hard-delete entrypoint. The ProblemDoc delete itself owns the claim token. */
    static async delAuthorized(domainId: string, docId: number, user: ProblemAclUser, options: { requestId?: string } = {}) {
        const pdoc = await ProblemModel.get(domainId, docId, ['docId', 'pid', 'authoringMode'] as any, true);
        if (!pdoc) throw new ProblemNotFoundError(domainId, docId);
        await ProblemModel.assertNoProblemReferences(domainId, docId, pdoc.pid);
        const claim = await ProblemModel.beginAuthorizedWriteClaim(domainId, docId, user, 'hard-delete', {
            ...options,
            capability: 'hard-delete',
        });
        try {
            await bus.parallel('problem/before-del', domainId, docId, claim.requestId);
            await Promise.all([
                document.deleteMultiStatus(domainId, document.TYPE_PROBLEM, { docId }),
                storage
                    .list(`problem/${domainId}/${docId}/`)
                    .then((items) => storage.del(items.map((item) => `problem/${domainId}/${docId}/${item.name}`))),
                bus.parallel('problem/delete', domainId, docId),
            ]);
            const result = await document.coll.deleteOne({
                domainId,
                docType: document.TYPE_PROBLEM,
                docId,
                'aclWriteClaim.requestId': claim.requestId,
                'aclWriteClaim.actor': claim.actor,
                'aclWriteClaim.operation': claim.operation,
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            });
            if (result.deletedCount !== 1) {
                throw new Error(`problem write claim ownership lost before hard delete: ${claim.requestId}`);
            }
            return true;
        } catch (error) {
            let marked = false;
            try {
                marked = await markProblemWriteClaimError(claim, error);
            } catch (markerError) {
                logger.error(
                    'Hard delete failed and ERROR marker write also failed domain=%s pid=%d requestId=%s error=%s markerError=%s',
                    domainId,
                    docId,
                    claim.requestId,
                    error,
                    markerError,
                );
                throw new Error(`hard delete failed and ERROR marker could not be persisted: ${claim.requestId}`, { cause: error });
            }
            logger.error(
                'Hard delete failed; durable claim retained domain=%s pid=%d actor=%d requestId=%s marked=%s error=%s',
                domainId,
                docId,
                claim.actor,
                claim.requestId,
                marked,
                error,
            );
            if (!marked) {
                throw new Error(`hard-delete claim vanished before ERROR marker: ${claim.requestId}`, { cause: error });
            }
            throw error;
        }
    }

    static async addTestdata(domainId: string, pid: number, name: string, f: Readable | Buffer | string, operator = 1) {
        name = name.trim();
        if (!name) throw new ValidationError('name');
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid, true, [name]);
        if (revisionManaged) {
            assertCodeEvaluationFileMutationWithTrace(revisionManaged, { type: 'upload', filename: name }, { actor: operator, stage: 'file-upload' });
        }
        f = await normalizeProblemTestdataUpload(name, f);
        const [[, fileinfo]] = await Promise.all([
            document.getSub(domainId, document.TYPE_PROBLEM, pid, 'data', name),
            storage.put(`problem/${domainId}/${pid}/testdata/${name}`, f, operator),
        ]);
        const meta = await storage.getMeta(`problem/${domainId}/${pid}/testdata/${name}`);
        if (!meta) throw new FileUploadError();
        const payload = { name, ...pick(meta, ['size', 'lastModified', 'etag']) };
        payload.lastModified ||= new Date();
        if (!fileinfo) await document.push(domainId, document.TYPE_PROBLEM, pid, 'data', { _id: name, ...payload });
        else await document.setSub(domainId, document.TYPE_PROBLEM, pid, 'data', name, payload);
        await bus.emit('problem/addTestdata', domainId, pid, name, payload);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    static async renameTestdata(domainId: string, pid: number, file: string, newName: string, operator = 1) {
        if (file === newName) return;
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid, true, [file, newName]);
        if (revisionManaged) {
            assertCodeEvaluationFileMutationWithTrace(
                revisionManaged,
                { type: 'rename', filename: file, newFilename: newName },
                { actor: operator, stage: 'file-rename' },
            );
        }
        if (isProblemConfigFilename(newName)) {
            const source = await storage.get(`problem/${domainId}/${pid}/testdata/${file}`);
            await normalizeProblemTestdataUpload(newName, source);
        }
        const [, sdoc] = await document.getSub(domainId, document.TYPE_PROBLEM, pid, 'data', newName);
        if (sdoc) await ProblemModel.delTestdata(domainId, pid, newName);
        const payload = { _id: newName, name: newName, lastModified: new Date() };
        await Promise.all([
            storage.rename(`problem/${domainId}/${pid}/testdata/${file}`, `problem/${domainId}/${pid}/testdata/${newName}`, operator),
            document.setSub(domainId, document.TYPE_PROBLEM, pid, 'data', file, payload),
        ]);
        await bus.emit('problem/renameTestdata', domainId, pid, file, newName);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    static async delTestdata(domainId: string, pid: number, name: string | string[], operator = 1) {
        const names = name instanceof Array ? name : [name];
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid, true, names);
        if (revisionManaged) {
            assertCodeEvaluationFileMutationWithTrace(
                revisionManaged,
                { type: 'delete', filenames: names },
                { actor: operator, stage: 'file-delete' },
            );
        }
        await Promise.all([
            storage.del(
                names.map((t) => `problem/${domainId}/${pid}/testdata/${t}`),
                operator,
            ),
            document.deleteSub(domainId, document.TYPE_PROBLEM, pid, 'data', names),
        ]);
        await bus.emit('problem/delTestdata', domainId, pid, names);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    static async addAdditionalFile(domainId: string, pid: number, name: string, f: Readable | Buffer | string, operator = 1, skipUpload = false) {
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid);
        name = name.trim();
        const [[, fileinfo]] = await Promise.all([
            document.getSub(domainId, document.TYPE_PROBLEM, pid, 'additional_file', name),
            skipUpload ? '' : storage.put(`problem/${domainId}/${pid}/additional_file/${name}`, f, operator),
        ]);
        const meta = await storage.getMeta(`problem/${domainId}/${pid}/additional_file/${name}`);
        const payload = { name, ...pick(meta, ['size', 'lastModified', 'etag']) };
        if (!fileinfo) await ProblemModel.push(domainId, pid, 'additional_file', { _id: name, ...payload });
        else await document.setSub(domainId, document.TYPE_PROBLEM, pid, 'additional_file', name, payload);
        await bus.emit('problem/addAdditionalFile', domainId, pid, name, payload);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    static async renameAdditionalFile(domainId: string, pid: number, file: string, newName: string, operator = 1) {
        if (file === newName) return;
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid);
        const [, sdoc] = await document.getSub(domainId, document.TYPE_PROBLEM, pid, 'additional_file', newName);
        if (sdoc) await ProblemModel.delAdditionalFile(domainId, pid, newName);
        const payload = { _id: newName, name: newName, lastModified: new Date() };
        await Promise.all([
            storage.rename(`problem/${domainId}/${pid}/additional_file/${file}`, `problem/${domainId}/${pid}/additional_file/${newName}`, operator),
            document.setSub(domainId, document.TYPE_PROBLEM, pid, 'additional_file', file, payload),
        ]);
        await bus.emit('problem/renameAdditionalFile', domainId, pid, file, newName);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    static async delAdditionalFile(domainId: string, pid: number, name: MaybeArray<string>, operator = 1) {
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid);
        const names = name instanceof Array ? name : [name];
        await Promise.all([
            storage.del(
                names.map((t) => `problem/${domainId}/${pid}/additional_file/${t}`),
                operator,
            ),
            ProblemModel.pull(domainId, pid, 'additional_file', names),
        ]);
        await bus.emit('problem/delAdditionalFile', domainId, pid, names);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    private static async getClaimedProblemFiles(
        claim: ProblemWriteClaim,
        key: 'data' | 'additional_file',
        testdataNames: string[] = [],
    ): Promise<{ doc: ProblemDoc; snapshot: ProblemFileListSnapshot }> {
        const doc = await document.coll.findOne(
            {
                domainId: claim.domainId,
                docType: document.TYPE_PROBLEM,
                docId: claim.pid,
                'aclWriteClaim.requestId': claim.requestId,
                'aclWriteClaim.actor': claim.actor,
                'aclWriteClaim.operation': claim.operation,
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            },
            {
                projection: {
                    domainId: 1,
                    docId: 1,
                    pid: 1,
                    [key]: 1,
                    problemKind: 1,
                    codeEvaluationStatus: 1,
                    config: 1,
                    structureRevision: 1,
                    authoringMode: 1,
                },
            },
        );
        if (!doc) throw new Error(`problem write claim ownership lost before file operation: ${claim.requestId}`);
        if (doc.authoringMode === 'managed' && !problemWriteCapabilityAllows(claim.capability, 'content')) {
            throw new ValidationError('fields', null, `写入凭据 ${claim.capability} 不允许修改托管题文件`);
        }
        if (key === 'data' && doc.problemKind !== undefined) {
            const kind = parseProblemKind(doc.problemKind);
            if (kind !== 'programming' && !structuredProblemUsesTestdata(kind, doc.config)) {
                throw new ValidationError('problemKind', null, '此结构化题不接受 testdata 文件写入');
            }
            if (kind !== 'programming' && testdataNames.some(isProblemConfigFilename)) {
                throw new ValidationError('name', null, '结构化题配置不通过 testdata 文件修改');
            }
        }
        const { files, snapshot } = normalizeProblemFileListSnapshot(doc[key], Object.hasOwn(doc, key), key);
        doc[key] = files as any;
        return { doc: doc as ProblemDoc, snapshot };
    }

    private static async commitClaimedTestdataState(
        claim: ProblemWriteClaim,
        current: ProblemDoc,
        nextData: ProblemDoc['data'],
        mutation: ProblemTestdataMutation,
        expectedData: ProblemFileListSnapshot,
    ): Promise<void> {
        ProblemModel.assertClaimedTestdataWriteClaim(claim, mutation);
        if (current.problemKind === undefined) {
            const result = await commitProblemWriteClaimUpdate(claim, { data: nextData } as any, {}, 'content', {
                expectedData,
            });
            if (!result) {
                throw new Error(
                    `problem testdata metadata CAS failed stage=legacy-testdata-metadata-commit operation=${claim.operation} mutation=${mutation} requestId=${claim.requestId}`,
                );
            }
            return;
        }
        assertStructureRevision(current.structureRevision);
        assertCodeEvaluationLifecyclePatchWithTrace(
            current,
            { data: nextData } as any,
            {},
            {
                actor: claim.actor,
                operation: claim.operation,
                stage: 'physical-testdata-commit',
                physicalTestdataMutation: true,
            },
        );
        const result = await document.coll.findOneAndUpdate(
            { ...revisionClaimFilter(claim, current.structureRevision), ...problemDataSnapshotFilter(expectedData) },
            { $set: { data: nextData } },
            { returnDocument: 'after' },
        );
        if (!result) {
            throw new Error(
                `problem testdata metadata CAS failed stage=structured-testdata-metadata-commit operation=${claim.operation} mutation=${mutation} requestId=${claim.requestId}`,
            );
        }
    }

    private static assertClaimedTestdataWriteClaim(claim: ProblemWriteClaim, mutation: ProblemTestdataMutation): void {
        if (!problemWriteClaimAllowsTestdataMutation(claim, mutation)) {
            throw new TypeError(
                `problem write claim cannot mutate testdata operation=${claim.operation} mutation=${mutation} capability=${claim.capability} state=${claim.state}`,
            );
        }
    }

    static async addTestdataWithClaim(claim: ProblemWriteClaim, name: string, f: Readable | Buffer | string, operator = 1) {
        ProblemModel.assertClaimedTestdataWriteClaim(claim, 'upload');
        name = name.trim();
        if (!name) throw new ValidationError('name');
        const claimed = await ProblemModel.getClaimedProblemFiles(claim, 'data', [name]);
        const state = claimed.doc;
        assertCodeEvaluationFileMutationWithTrace(state, { type: 'upload', filename: name }, { actor: claim.actor, stage: 'file-upload' });
        const current = state.data;
        f = await normalizeProblemTestdataUpload(name, f);
        await storage.put(`problem/${claim.domainId}/${claim.pid}/testdata/${name}`, f, operator);
        const meta = await storage.getMeta(`problem/${claim.domainId}/${claim.pid}/testdata/${name}`);
        if (!meta) throw new FileUploadError();
        const payload = { name, ...pick(meta, ['size', 'lastModified', 'etag']) } as any;
        payload.lastModified ||= new Date();
        const next = current.filter((item) => item.name !== name);
        next.push({ _id: name, ...payload });
        await ProblemModel.commitClaimedTestdataState(claim, state, next, 'upload', claimed.snapshot);
        await bus.emit('problem/addTestdata', claim.domainId, claim.pid, name, payload, claim);
    }

    static async renameTestdataWithClaim(claim: ProblemWriteClaim, file: string, newName: string, operator = 1) {
        ProblemModel.assertClaimedTestdataWriteClaim(claim, 'rename');
        if (file === newName) return;
        const claimed = await ProblemModel.getClaimedProblemFiles(claim, 'data', [file, newName]);
        const state = claimed.doc;
        assertCodeEvaluationFileMutationWithTrace(
            state,
            { type: 'rename', filename: file, newFilename: newName },
            { actor: claim.actor, stage: 'file-rename' },
        );
        const current = state.data;
        if (isProblemConfigFilename(newName)) {
            const source = await storage.get(`problem/${claim.domainId}/${claim.pid}/testdata/${file}`);
            await normalizeProblemTestdataUpload(newName, source);
        }
        if (current.some((item) => item.name === newName)) {
            await storage.del([`problem/${claim.domainId}/${claim.pid}/testdata/${newName}`], operator);
        }
        await storage.rename(
            `problem/${claim.domainId}/${claim.pid}/testdata/${file}`,
            `problem/${claim.domainId}/${claim.pid}/testdata/${newName}`,
            operator,
        );
        const next = current
            .filter((item) => item.name !== newName)
            .map((item) => (item.name === file ? { ...item, _id: newName, name: newName, lastModified: new Date() } : item));
        await ProblemModel.commitClaimedTestdataState(claim, state, next, 'rename', claimed.snapshot);
        await bus.emit('problem/renameTestdata', claim.domainId, claim.pid, file, newName, claim);
    }

    static async delTestdataWithClaim(claim: ProblemWriteClaim, name: string | string[], operator = 1) {
        ProblemModel.assertClaimedTestdataWriteClaim(claim, 'delete');
        const names = name instanceof Array ? name : [name];
        const claimed = await ProblemModel.getClaimedProblemFiles(claim, 'data', names);
        const state = claimed.doc;
        assertCodeEvaluationFileMutationWithTrace(state, { type: 'delete', filenames: names }, { actor: claim.actor, stage: 'file-delete' });
        const current = state.data;
        await storage.del(
            names.map((item) => `problem/${claim.domainId}/${claim.pid}/testdata/${item}`),
            operator,
        );
        await ProblemModel.commitClaimedTestdataState(
            claim,
            state,
            current.filter((item) => !names.includes(item.name)),
            'delete',
            claimed.snapshot,
        );
        await bus.emit('problem/delTestdata', claim.domainId, claim.pid, names, claim);
    }

    static async addAdditionalFileWithClaim(claim: ProblemWriteClaim, name: string, f: Readable | Buffer | string, operator = 1) {
        name = name.trim();
        if (!name) throw new ValidationError('name');
        const current = (await ProblemModel.getClaimedProblemFiles(claim, 'additional_file')).doc.additional_file;
        await storage.put(`problem/${claim.domainId}/${claim.pid}/additional_file/${name}`, f, operator);
        const meta = await storage.getMeta(`problem/${claim.domainId}/${claim.pid}/additional_file/${name}`);
        if (!meta) throw new FileUploadError();
        const payload = { name, ...pick(meta, ['size', 'lastModified', 'etag']) } as any;
        const next = current.filter((item) => item.name !== name);
        next.push({ _id: name, ...payload });
        if (!(await commitProblemWriteClaimUpdate(claim, { additional_file: next } as any, {}, 'content'))) {
            throw new Error(`problem write claim ownership lost after additional-file upload: ${claim.requestId}`);
        }
        await bus.emit('problem/addAdditionalFile', claim.domainId, claim.pid, name, payload, claim);
    }

    static async renameAdditionalFileWithClaim(claim: ProblemWriteClaim, file: string, newName: string, operator = 1) {
        if (file === newName) return;
        const current = (await ProblemModel.getClaimedProblemFiles(claim, 'additional_file')).doc.additional_file;
        if (current.some((item) => item.name === newName)) {
            await storage.del([`problem/${claim.domainId}/${claim.pid}/additional_file/${newName}`], operator);
        }
        await storage.rename(
            `problem/${claim.domainId}/${claim.pid}/additional_file/${file}`,
            `problem/${claim.domainId}/${claim.pid}/additional_file/${newName}`,
            operator,
        );
        const next = current
            .filter((item) => item.name !== newName)
            .map((item) => (item.name === file ? { ...item, _id: newName, name: newName, lastModified: new Date() } : item));
        if (!(await commitProblemWriteClaimUpdate(claim, { additional_file: next } as any, {}, 'content'))) {
            throw new Error(`problem write claim ownership lost after additional-file rename: ${claim.requestId}`);
        }
        await bus.emit('problem/renameAdditionalFile', claim.domainId, claim.pid, file, newName, claim);
    }

    static async delAdditionalFileWithClaim(claim: ProblemWriteClaim, name: MaybeArray<string>, operator = 1) {
        const names = name instanceof Array ? name : [name];
        const current = (await ProblemModel.getClaimedProblemFiles(claim, 'additional_file')).doc.additional_file;
        await storage.del(
            names.map((item) => `problem/${claim.domainId}/${claim.pid}/additional_file/${item}`),
            operator,
        );
        if (
            !(await commitProblemWriteClaimUpdate(
                claim,
                { additional_file: current.filter((item) => !names.includes(item.name)) } as any,
                {},
                'content',
            ))
        ) {
            throw new Error(`problem write claim ownership lost after additional-file delete: ${claim.requestId}`);
        }
        await bus.emit('problem/delAdditionalFile', claim.domainId, claim.pid, names, claim);
    }

    static async random(domainId: string, query: Filter<ProblemDoc>) {
        const pcount = await document.count(domainId, document.TYPE_PROBLEM, query);
        if (!pcount) return null;
        const pdoc = await document
            .getMulti(domainId, document.TYPE_PROBLEM, query)
            .skip(Math.floor(Math.random() * pcount))
            .limit(1)
            .toArray();
        return pdoc[0].pid || pdoc[0].docId;
    }

    static async getList(
        domainId: string,
        pids: number[],
        canViewHidden: number | boolean = false,
        doThrow = true,
        projection = ProblemModel.PROJECTION_PUBLIC,
        indexByDocIdOnly = false,
    ): Promise<ProblemDict> {
        if (!pids?.length) return {};
        const r: Record<number, ProblemDoc> = {};
        const l: Record<string, ProblemDoc> = {};
        const q: any = { docId: { $in: pids } };
        const projectionExpr = buildProjection(projection.includes('config') ? [...projection, 'data', 'reference'] : projection);
        let pdocs = await document.getMulti(domainId, document.TYPE_PROBLEM, q).project<ProblemDoc>(projectionExpr).toArray();
        if (canViewHidden !== true) {
            pdocs = pdocs.filter((i) => i.owner === canViewHidden || !i.hidden);
        }
        await Promise.all(
            pdocs.map(async (pdoc) => {
                if (projection.includes('config')) {
                    if (pdoc.reference) {
                        const src = await ProblemModel.get(pdoc.reference.domainId, pdoc.reference.pid);
                        pdoc.config = src ? src.config : 'Cannot find source problem';
                    } else {
                        try {
                            pdoc.config = await parseConfig(pdoc.config as string, pdoc.data?.map((i) => i.name) || []);
                        } catch (e) {
                            pdoc.config = `Cannot parse: ${e.message}`;
                        }
                    }
                }
                if (!projection.includes('data')) delete pdoc.data;
                if (!projection.includes('reference')) delete pdoc.reference;
                r[pdoc.docId] = pdoc;
                if (pdoc.pid) l[pdoc.pid] = pdoc;
            }),
        );
        // TODO enhance
        if (pdocs.length !== pids.length) {
            for (const pid of pids) {
                if (!r[pid] && !l[pid]) {
                    if (doThrow) throw new ProblemNotFoundError(domainId, pid);
                    if (!indexByDocIdOnly) r[pid] = { ...ProblemModel.default, domainId, pid: pid.toString() };
                }
            }
        }
        return indexByDocIdOnly ? r : Object.assign(r, l);
    }

    static async getListStatus(domainId: string, uid: number, pids: number[]) {
        const psdocs = await ProblemModel.getMultiStatus(domainId, { uid, docId: { $in: Array.from(new Set(pids)) } }).toArray();
        return keyBy(psdocs, 'docId');
    }

    static async updateStatus(domainId: string, pid: number, uid: number, rid: ObjectId, status: number, score: number) {
        const condition = status === STATUS.STATUS_ACCEPTED ? {} : { $or: [{ status: { $ne: STATUS.STATUS_ACCEPTED } }, { rid }] };
        const res = await document.setStatusIfCondition(domainId, document.TYPE_PROBLEM, pid, uid, condition, { rid, status, score });
        return !!res;
    }

    static async updateManualStatusLatest(domainId: string, pid: number, uid: number, rid: ObjectId, status: number, score: number) {
        const res = await document.collStatus.findOneAndUpdate(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
                uid,
                $or: [{ rid: { $exists: false } }, { rid: { $lt: rid } }, { rid }],
            },
            { $set: { rid, status, score } },
            { upsert: true, returnDocument: 'after' },
        );
        return !!res;
    }

    static async updateManualGradeStatus(domainId: string, pid: number, uid: number, latestRid: ObjectId, score: number) {
        const res = await document.collStatus.findOneAndUpdate(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
                uid,
                rid: latestRid,
            },
            { $set: { rid: latestRid, status: STATUS.STATUS_MANUAL_GRADED, score } },
            { returnDocument: 'after' },
        );
        return !!res;
    }

    static async incStatus(domainId: string, pid: number, uid: number, key: NumberKeys<ProblemStatusDoc>, count: number) {
        return await document.incStatus(domainId, document.TYPE_PROBLEM, pid, uid, key, count);
    }

    static setStar(domainId: string, pid: number, uid: number, star: boolean) {
        return document.setStatus(domainId, document.TYPE_PROBLEM, pid, uid, { star });
    }

    static canViewBy(pdoc: ProblemDoc, udoc: User & ProblemAclUser) {
        return canViewProblem(udoc, pdoc);
    }

    static async import(domainId: string, filepath: string, options: ProblemImportOptions = {}) {
        let tmpdir = '';
        if (typeof options !== 'object') {
            logger.warn('ProblemModel.import: options should be an object');
            options = {};
        }
        const { preferredPrefix, progress, override = false, operator = 1 } = options;
        let delSource = options.delSource;
        let problems: string[];
        const ddoc = await DomainModel.get(domainId);
        if (!ddoc) throw new NotFoundError(domainId);
        try {
            if (filepath.endsWith('.zip')) {
                tmpdir = path.join(os.tmpdir(), 'hydro', `${Math.random()}.import`);
                const zip = new ZipReader(Readable.toWeb(fs.createReadStream(filepath)));
                let entries: Entry[];
                try {
                    entries = await zip.getEntries();
                } catch (e) {
                    throw new ValidationError('zip', null, e.message);
                }
                delSource = true;
                await extractZip(entries, tmpdir);
            } else if (fs.statSync(filepath).isDirectory()) {
                tmpdir = filepath;
            } else {
                throw new ValidationError('file', null, 'Invalid file');
            }
            const files = await fs.readdir(tmpdir, { withFileTypes: true });
            if (files.find((f) => f.name === 'problem.yaml')) {
                problems = ['.']; // special case for ICPC problem package
            } else {
                problems = files.filter((f) => f.isDirectory()).map((i) => i.name);
            }
        } catch (e) {
            if (delSource) await fs.remove(tmpdir);
            throw e;
        }
        for (const i of problems) {
            try {
                const files = await fs.readdir(path.join(tmpdir, i), { withFileTypes: true });
                if (!files.find((f) => f.name === 'problem.yaml')) continue;
                if (process.env.HYDRO_CLI) logger.info(`Importing problem ${i}`);
                const content = fs.readFileSync(path.join(tmpdir, i, 'problem.yaml'), 'utf-8');
                const pdoc: ProblemDoc = yaml.load(content) as any;
                if (!pdoc) {
                    if (process.env.HYDRO_CLI) logger.error(`Invalid problem.yaml ${i}`);
                    continue;
                }
                if (pdoc.problemKind !== undefined && parseProblemKind(pdoc.problemKind) !== 'programming') {
                    throw new ValidationError('problemKind', null, '结构化题导入将在对应题型任务中开放');
                }
                let pid = pdoc.pid;
                let overridePid = null;

                const isValidPid = async (id: string) => {
                    if (!/^(?:[a-z0-9]{1,10}-)?[a-z][0-9a-z]*$/i.test(id)) return false;
                    if (id.includes('-')) {
                        const [prefix] = id.split('-');
                        if (!ddoc?.namespaces?.[prefix]) return false;
                    }
                    const doc = await ProblemModel.get(domainId, id);
                    if (doc) {
                        if (!override) return false;
                        overridePid = doc.docId;
                        return true;
                    }
                    return true;
                };
                const getFiles = async (...type: string[]): Promise<[fs.Dirent, string][]> => {
                    if (type.length > 1) {
                        let result = [];
                        for (const t of type) result = result.concat(await getFiles(t));
                        return result;
                    }
                    const [t] = type;
                    if (!files.find((f) => f.name === t && f.isDirectory())) return [];
                    const rs = await fs.readdir(path.join(tmpdir, i, t), { withFileTypes: true });
                    return rs.map((r) => [r, path.join(tmpdir, i, t, r.name)] as [fs.Dirent, string]);
                };

                if (pid) {
                    if (preferredPrefix) {
                        const newPid = pid.replace(/^[A-Za-z]+/, preferredPrefix);
                        if (await isValidPid(newPid)) pid = newPid;
                    }
                    if (!(await isValidPid(pid))) pid = undefined;
                }
                let overrideContent = findOverrideContent(path.join(tmpdir, i), 'problem');
                overrideContent ||= findOverrideContent(path.join(tmpdir, i, 'statement'), 'problem');
                overrideContent ||= findOverrideContent(path.join(tmpdir, i, 'problem_statement'), 'problem');
                if (pdoc.difficulty && !Number.isSafeInteger(pdoc.difficulty)) delete pdoc.difficulty;
                const title = pdoc.title || (pdoc as any).name;
                if (typeof title !== 'string') throw new ValidationError('title', null, 'Invalid title');
                const allFiles = await getFiles(
                    'testdata',
                    'additional_file',
                    // The following is from https://icpc.io/problem-package-format/spec/2023-07-draft.html
                    'attachments',
                    'generators',
                    'include',
                    'data',
                    'statement',
                    'problem_statement',
                );
                const totalSize = allFiles.map((f) => fs.statSync(f[1]).size).reduce((a, b) => a + b, 0);
                if (allFiles.length > SystemModel.get('limit.problem_files')) throw new ValidationError('files', null, 'Too many files');
                if (totalSize > SystemModel.get('limit.problem_files_size')) throw new ValidationError('files', null, 'Files too large');
                const validateImportedTestdataConfigs = async () => {
                    const entries = await getFiles('testdata', 'attachments', 'generators', 'include', 'data', 'output_validators');
                    for (const [entry, location] of entries) {
                        if (entry.isFile()) {
                            if (isProblemConfigFilename(entry.name)) {
                                await normalizeProblemTestdataUpload(entry.name, location);
                            }
                            continue;
                        }
                        if (!entry.isDirectory()) continue;
                        const children = await fs.readdir(location, { withFileTypes: true });
                        for (const childEntry of children) {
                            if (!childEntry.isFile() || !isProblemConfigFilename(childEntry.name)) continue;
                            await normalizeProblemTestdataUpload(childEntry.name, path.join(location, childEntry.name));
                        }
                    }
                };
                await validateImportedTestdataConfigs();
                const tag = (pdoc.tag || []).map((t) => t.toString());
                let configChanged = false;
                let config: ProblemConfigFile = {};
                if (await fs.exists(path.join(tmpdir, i, 'testdata/config.yaml'))) {
                    try {
                        config = yaml.load(await fs.readFile(path.join(tmpdir, i, 'testdata/config.yaml'), 'utf-8'));
                    } catch (e) {
                        throw new ValidationError('config', null, `Invalid testdata/config.yaml: ${e.message}`);
                    }
                }
                if (await fs.exists(path.join(tmpdir, i, 'domjudge-problem.ini'))) {
                    const djConfig = ((await fs.readFile(path.join(tmpdir, i, 'domjudge-problem.ini'), 'utf-8')) as string)
                        .split('\n')
                        .map((line: string) => line.split('=').map((lines: string) => lines.trim()));
                    const djConfigJson: any = {};
                    for (const [key, value] of djConfig) {
                        djConfigJson[key] = value;
                    }
                    if (djConfigJson.timelimit) {
                        config.time = `${djConfigJson.timelimit * 1000}ms`;
                        configChanged = true;
                    }
                    if (djConfigJson.externalid) pid = djConfigJson.externalid;
                }
                if ((pdoc as any).limits) {
                    config.time = (pdoc as any).limits.time_limit ? `${(pdoc as any).limits.time_limit * 1000}ms` : config.time || undefined;
                    config.memory = (pdoc as any).limits.memory ? `${(pdoc as any).limits.memory}m` : config.memory || undefined;
                    configChanged = true;
                }
                const overrideDoc = overridePid ? await ProblemModel.get(domainId, overridePid, ['structureRevision'] as any, true) : null;
                const docId = overridePid
                    ? (
                          await ProblemModel.edit(
                              domainId,
                              overridePid,
                              {
                                  title: title.trim(),
                                  content: overrideContent || pdoc.content?.toString() || 'No content',
                                  tag,
                                  difficulty: pdoc.difficulty,
                                  ...(options.hidden ? { hidden: true } : {}),
                              },
                              { expectedStructureRevision: overrideDoc?.structureRevision },
                          )
                      ).docId
                    : await ProblemModel.add(
                          domainId,
                          pid,
                          title.trim(),
                          overrideContent || pdoc.content?.toString() || 'No content',
                          operator || pdoc.owner,
                          tag,
                          {
                              hidden: options.hidden || pdoc.hidden,
                              difficulty: pdoc.difficulty,
                              problemKind: 'programming',
                          },
                      );
                // TODO delete unused file when updating pdoc
                for (const [f, loc] of await getFiles('testdata', 'attachments', 'generators', 'include')) {
                    if (f.isDirectory()) {
                        const sub = await fs.readdir(loc);
                        for (const s of sub) await ProblemModel.addTestdata(domainId, docId, s, path.join(loc, s));
                    } else if (f.isFile()) await ProblemModel.addTestdata(domainId, docId, f.name, loc);
                }
                for (const [f, loc] of await getFiles('data')) {
                    if (!f.isDirectory()) continue;
                    const sub = await fs.readdir(loc);
                    for (const file of sub) {
                        if (f.name === 'sample') await ProblemModel.addAdditionalFile(domainId, docId, file, path.join(loc, file));
                        await ProblemModel.addTestdata(domainId, docId, file, path.join(loc, file));
                    }
                }
                for (const [f, loc] of await getFiles('output_validators')) {
                    if (f.isFile()) continue;
                    const sub = await fs.readdir(loc);
                    for (const file of sub) {
                        if (file === 'testlib.h') continue;
                        await ProblemModel.addTestdata(domainId, docId, file, path.join(loc, file));
                        if (f.name === 'checker') {
                            config.checker_type = 'testlib';
                            config.checker = file;
                        } else if (f.name === 'interactor') {
                            config.type = ProblemType.Interactive;
                            config.interactor = file;
                        }
                        configChanged = true;
                    }
                }
                for (const [f, loc] of await getFiles('additional_file', 'attachments', 'statement', 'problem_statement')) {
                    if (!f.isFile()) continue;
                    await ProblemModel.addAdditionalFile(domainId, docId, f.name, loc);
                }
                for (const [f, loc] of await getFiles('solution')) {
                    if (!f.isFile()) continue;
                    await SolutionModel.add(domainId, docId, operator, await fs.readFile(loc, 'utf-8'));
                }
                for (const [f] of await getFiles('attachments', 'include')) {
                    if (!f.isFile()) continue;
                    config.user_extra_files ||= [];
                    config.user_extra_files = Array.from(new Set(config.user_extra_files.concat(f.name)));
                    config.judge_extra_files ||= [];
                    config.judge_extra_files = Array.from(new Set(config.judge_extra_files.concat(f.name)));
                    configChanged = true;
                }
                if (configChanged) await ProblemModel.addTestdata(domainId, docId, 'config.yaml', Buffer.from(yaml.dump(config)));
                let count = 0;
                for (const [f, loc] of await getFiles('std')) {
                    if (!f.isFile()) continue;
                    count++;
                    if (count > 5) continue;
                    await RecordModel.add(domainId, docId, operator, f.name.split('.')[1], await fs.readFile(loc, 'utf-8'), true);
                }
                for (const [f, loc] of await getFiles('submissions')) {
                    if (f.isFile()) continue;
                    const sub = await fs.readdir(loc);
                    for (const file of sub) {
                        if (file.endsWith('.zip')) continue;
                        const code = await fs.readFile(path.join(loc, file), 'utf-8');
                        await RecordModel.add(domainId, docId, operator, file.split('.')[1], `// ${file}: ${loc}\n${code}`, true);
                    }
                }
                if (configChanged) await ProblemModel.addTestdata(domainId, docId, 'config.yaml', Buffer.from(yaml.dump(config)));
                const message = `${overridePid ? 'Updated' : 'Imported'} problem ${pdoc.pid || docId} (${title})`;
                (process.env.HYDRO_CLI ? logger.info : progress)?.(message);
            } catch (e) {
                (process.env.HYDRO_CLI ? logger.info : progress)?.(`Error importing problem ${i}: ${e.message}`);
            }
        }
        if (delSource) await fs.remove(tmpdir);
    }

    static async export(domainId: string, pidFilter = '') {
        console.log('Exporting problems...');
        const tmpdir = path.join(os.tmpdir(), 'hydro', `${Math.random()}.export`);
        await fs.mkdir(tmpdir);
        const pdocs = await ProblemModel.getMulti(
            domainId,
            pidFilter ? { pid: new RegExp(pidFilter) } : {},
            ProblemModel.PROJECTION_PUBLIC,
        ).toArray();
        if (process.env.HYDRO_CLI) logger.info(`Exporting ${pdocs.length} problems`);
        for (const pdoc of pdocs) {
            if (process.env.HYDRO_CLI) logger.info(`Exporting problem ${pdoc.pid || `P${pdoc.docId}`} (${pdoc.title})`);
            const problemPath = path.join(tmpdir, `${pdoc.docId}`);
            await fs.mkdir(problemPath);
            const problemYaml = path.join(problemPath, 'problem.yaml');
            const problemYamlContent = yaml.dump({
                pid: pdoc.pid || `P${pdoc.docId}`,
                owner: pdoc.owner,
                title: pdoc.title,
                tag: pdoc.tag,
                nSubmit: pdoc.nSubmit,
                nAccept: pdoc.nAccept,
                difficulty: pdoc.difficulty,
            });
            await fs.writeFile(problemYaml, problemYamlContent);
            try {
                const c = JSON.parse(pdoc.content);
                for (const key of Object.keys(c)) {
                    const problemContent = path.join(problemPath, `problem_${key}.md`);
                    await fs.writeFile(problemContent, typeof c[key] === 'string' ? c[key] : JSON.stringify(c[key]));
                }
            } catch (e) {
                const problemContent = path.join(problemPath, 'problem.md');
                await fs.writeFile(problemContent, pdoc.content);
            }
            if ((pdoc.data || []).length) {
                const testdataPath = path.join(problemPath, 'testdata');
                await fs.mkdir(testdataPath);
                for (const file of pdoc.data) {
                    const stream = await storage.get(`problem/${domainId}/${pdoc.docId}/testdata/${file.name}`);
                    const buf = await streamToBuffer(stream);
                    const testdataFile = path.join(testdataPath, file.name);
                    await fs.writeFile(testdataFile, buf);
                }
            }
            if ((pdoc.additional_file || []).length) {
                const additionalPath = path.join(problemPath, 'additional_file');
                await fs.mkdir(additionalPath);
                for (const file of pdoc.additional_file) {
                    const stream = await storage.get(`problem/${domainId}/${pdoc.docId}/additional_file/${file.name}`);
                    const buf = await streamToBuffer(stream);
                    const additionalFile = path.join(additionalPath, file.name);
                    await fs.writeFile(additionalFile, buf);
                }
            }
        }
        const target = `${process.cwd()}/problem-${domainId}-${new Date().toISOString().replace(':', '-').split(':')[0]}.zip`;
        const res = child.spawnSync('zip', ['-r', target, '.'], { cwd: tmpdir, stdio: 'inherit' });
        if (res.error) throw res.error;
        if (res.status) throw new Error(`Error: Exited with code ${res.status}`);
        const stat = fs.statSync(target);
        console.log(`Domain ${domainId} problems export saved at ${target} , size: ${size(stat.size)}`);
    }
}

async function assertConfigTestdataEventAllowed(domainId: string, docId: number) {
    const pdoc = await document.coll.findOne(
        {
            domainId,
            docType: document.TYPE_PROBLEM,
            docId,
        },
        { projection: { problemKind: 1 } },
    );
    if (!pdoc) throw new ProblemNotFoundError(domainId, docId);
    if (pdoc.problemKind !== undefined && parseProblemKind(pdoc.problemKind) !== 'programming') {
        throw new ValidationError('name', null, '结构化题配置不通过 testdata 文件修改');
    }
}

export async function apply(ctx: Context) {
    await ensureManagedProblemAuthoringIndexes();
    ctx.on('problem/addTestdata', async (domainId, docId, name, _payload, claim?: ProblemWriteClaim) => {
        if (!isProblemConfigFilename(name)) return;
        await assertConfigTestdataEventAllowed(domainId, docId);
        const buf = await storage.get(`problem/${domainId}/${docId}/testdata/${name}`);
        const update = { config: (await streamToBuffer(buf)).toString() };
        if (claim) await ProblemModel.editWithClaim(claim, update, {}, { skipStructureGuard: true });
        else await ProblemModel.edit(domainId, docId, update, { skipStructureGuard: true });
    });
    ctx.on('problem/delTestdata', async (domainId, docId, names, claim?: ProblemWriteClaim) => {
        if (!names.some(isProblemConfigFilename)) return;
        await assertConfigTestdataEventAllowed(domainId, docId);
        if (claim) await ProblemModel.editWithClaim(claim, { config: '' }, {}, { skipStructureGuard: true });
        else await ProblemModel.edit(domainId, docId, { config: '' }, { skipStructureGuard: true });
    });
    ctx.on('problem/renameTestdata', async (domainId, docId, file, newName, claim?: ProblemWriteClaim) => {
        if (isProblemConfigFilename(file) || isProblemConfigFilename(newName)) {
            await assertConfigTestdataEventAllowed(domainId, docId);
        }
        if (isProblemConfigFilename(file)) {
            if (claim) await ProblemModel.editWithClaim(claim, { config: '' }, {}, { skipStructureGuard: true });
            else await ProblemModel.edit(domainId, docId, { config: '' }, { skipStructureGuard: true });
        }
        if (isProblemConfigFilename(newName)) {
            const buf = await storage.get(`problem/${domainId}/${docId}/testdata/${newName}`);
            const update = { config: (await streamToBuffer(buf)).toString() };
            if (claim) await ProblemModel.editWithClaim(claim, update, {}, { skipStructureGuard: true });
            else await ProblemModel.edit(domainId, docId, update, { skipStructureGuard: true });
        }
    });
}

global.Hydro.model.problem = ProblemModel;
export default ProblemModel;
