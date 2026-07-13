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
    NotFoundError,
    PermissionError,
    ProblemIsReferencedError,
    ProblemNotFoundError,
    ProblemStructureConflictError,
    ValidationError,
} from '../error';
import type { Document, ProblemDict, ProblemStatusDoc, User } from '../interface';
import { copyProblemStorageFiles } from '../lib/problem-clone';
import {
    isProblemConfigFilename,
    parseProblemConfigObject,
    validateCompiledStructuredConfig,
    validateFillFunctionTestdataFiles,
} from '../lib/problem-config';
import { normalizeProblemTestdataUpload } from '../lib/problem-testdata-upload';
import { parseConfig } from '../lib/testdataConfig';
import bus from '../service/bus';
import db from '../service/db';
import { ArrayKeys, MaybeArray, NumberKeys, Projection } from '../typeutils';
import { buildProjection } from '../utils';
import { PERM, STATUS } from './builtin';
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
    problemWriteCapabilityAllows,
    PROBLEM_ACL_INTERNAL_FIELDS,
    type ProblemAclUser,
    type ProblemWriteCapability,
    type ProblemWriteClaim,
    readStableEditableProblem,
    readStableMaintainableProblem,
    readStableViewableProblem,
    refreshProblemAcl as refreshProblemAclAccess,
} from './problem-access';
import {
    assertStructureRevision,
    cloneStructuredProblemForLanguage,
    findProblemReferences,
    hasStartedProblemContainer,
    normalizeStructuredProblemConfig,
    PROBLEM_STRUCTURAL_FIELDS,
    problemCreateChangedFields,
    problemEditAuditedFields,
    problemReferenceCount,
    structuredProblemUsesTestdata,
} from './problem-lifecycle';
import RecordModel from './record';
import SolutionModel from './solution';
import storage from './storage';
import SystemModel from './system';

export interface ProblemDoc extends Document {}
export type Field = keyof ProblemDoc;

const logger = new Logger('problem');
function sortable(source: string, namespaces: Record<string, string>) {
    const [namespace, pid] = source.includes('-') ? source.split('-') : ['default', source];
    return ((namespaces ? `${namespaces[namespace]}-` : '') + pid).replace(/(\d+)/g, (str) =>
        str.length >= 6 ? str : '0'.repeat(6 - str.length) + str,
    );
}

function isStructuralPatch($set: Record<string, unknown>, $unset: Record<string, unknown> = {}) {
    return [...Object.keys($set), ...Object.keys($unset)].some((field) => PROBLEM_STRUCTURAL_FIELDS.has(field));
}

const MANAGED_CONTENT_FIELDS = new Set(['content', 'config', 'data', 'additional_file', 'html']);
const MANAGED_DRAFT_METADATA_FIELDS = new Set(['title', 'difficulty']);
const MANAGED_ARCHIVE_FIELDS = new Set(['archivedAt', 'archivedBy', 'archiveReason']);

function managedPatchCapability(
    current: ProblemDoc,
    $set: Partial<ProblemDoc>,
    $unset: Record<string, unknown>,
): { capability: ProblemWriteCapability; requestedFields: string[]; changedFields: string[]; immutableFields: string[]; publishes: boolean } {
    const requestedFields = [...new Set([...Object.keys($set), ...Object.keys($unset)])];
    const changedFields = [
        ...Object.entries($set)
            .filter(([field, value]) => !isEqual((current as any)[field], value))
            .map(([field]) => field),
        ...Object.keys($unset).filter((field) => (current as any)[field] !== undefined),
    ];
    const immutableFields = requestedFields.filter((field) => field === 'authoringMode');
    const publishes = current.hidden === true && $set.hidden === false;
    if (!requestedFields.length || requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field))) {
        return { capability: 'content', requestedFields, changedFields, immutableFields, publishes };
    }
    if (requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field) || MANAGED_DRAFT_METADATA_FIELDS.has(field))) {
        return { capability: 'metadata', requestedFields, changedFields, immutableFields, publishes };
    }
    if (requestedFields.every((field) => MANAGED_CONTENT_FIELDS.has(field) || field === 'hidden' || MANAGED_ARCHIVE_FIELDS.has(field))) {
        const hasArchiveField = requestedFields.some((field) => MANAGED_ARCHIVE_FIELDS.has(field));
        return { capability: hasArchiveField ? 'archive' : 'publish', requestedFields, changedFields, immutableFields, publishes };
    }
    // PID, tags, source/system metadata, lockHidden, collaborators and every
    // unknown top-level field are administrator-only on managed problems.
    return { capability: 'publish', requestedFields, changedFields, immutableFields, publishes };
}

async function auditManagedClaimPatchDenied(
    claim: ProblemWriteClaim,
    guard: ReturnType<typeof managedPatchCapability>,
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

function assertPublishableFillFunction(input: {
    domainId: string;
    pid: number;
    problemKind?: unknown;
    structureRevision?: unknown;
    config: unknown;
    data?: Array<{ name: string }>;
}) {
    const config = parseProblemConfigObject({ config: input.config });
    if (config?.type !== 'fill_function') return;
    const problemKind = input.problemKind === undefined ? 'programming' : parseProblemKind(input.problemKind);
    try {
        validateCompiledStructuredConfig(problemKind, config);
        validateFillFunctionTestdataFiles(config, input.data || []);
    } catch (error: any) {
        logger.error(
            'Fill-function publish rejected domain=%s pid=%d kind=%s revision=%s error=%o',
            input.domainId,
            input.pid,
            problemKind,
            input.structureRevision,
            error,
        );
        throw new ValidationError('hidden', null, error.message);
    }
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
    managedAuthoring?: ProblemDoc['managedAuthoring'];
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
        'structureRevision',
        'structureLockedAt',
        'structureLockReason',
        'archivedAt',
        'archivedBy',
        'archiveReason',
        'authoringMode',
        'managedAuthoring',
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
    ) {
        const [doc] = await ProblemModel.getMulti(domainId, {})
            .withReadPreference('primary')
            .sort({ docId: -1 })
            .limit(1)
            .project({ docId: 1 })
            .toArray();
        const result = await ProblemModel.addWithId(domainId, (doc?.docId || 0) + 1, pid, title, content, owner, tag, meta);
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
    ) {
        const ddoc = await DomainModel.get(domainId);
        const problemKind = parseProblemKind(meta?.problemKind);
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
        if (meta.managedAuthoring) args.managedAuthoring = meta.managedAuthoring;
        if (problemKind !== 'programming') {
            try {
                args.config = normalizeStructuredProblemConfig(problemKind, meta.structuredConfig) as any;
            } catch (error) {
                logger.error('Structured problem create rejected domain=%s pid=%d kind=%s revision=1 error=%o', domainId, docId, problemKind, error);
                throw error;
            }
        }
        await bus.parallel('problem/before-add', domainId, content, owner, docId, args);
        const result = await document.add(domainId, content, owner, document.TYPE_PROBLEM, docId, null, null, args);
        args.content = content;
        args.owner = owner;
        args.docType = document.TYPE_PROBLEM;
        args.domainId = domainId;
        await bus.emit('problem/add', args, result);
        await OplogModel.add({
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
            }),
            time: new Date(),
        } as any);
        return result;
    }

    /**
     * Create one hidden managed programming draft and grant its creator the
     * canonical direct author role. The draft is removed synchronously if the
     * ACL grant cannot be completed; callers never receive an unowned draft.
     */
    static async createManagedProgrammingDraft(domainId: string, workingTitle: string, content: string, creator: number): Promise<number> {
        const normalizedTitle = workingTitle.trim();
        if (!normalizedTitle) throw new ValidationError('title');
        let docId: number | null = null;
        try {
            docId = await ProblemModel.createProblemByKind('programming', domainId, '', `待审核 · ${normalizedTitle}`, content, creator, [], {
                authoringMode: 'managed',
                managedAuthoring: {
                    workingTitle: normalizedTitle,
                    metadataStatus: 'draft',
                },
            });
            const bootstrapManagedDraftAuthor = (global.Hydro?.model as any)?.permits?.bootstrapManagedDraftAuthor;
            if (typeof bootstrapManagedDraftAuthor !== 'function') {
                throw new TypeError('permits.bootstrapManagedDraftAuthor is unavailable');
            }
            await OplogModel.add({
                type: 'problem.permit.grant',
                domainId,
                operator: creator,
                problemId: docId,
                targetUids: [creator],
                role: 'author',
                action: 'grant',
                source: 'managed-draft-create',
                result: 'attempt',
                time: new Date(),
            } as any);
            await bootstrapManagedDraftAuthor(domainId, docId, creator, {
                requestId: `managed-draft-create:${domainId}:${docId}:${creator}`,
                note: 'managed draft creator',
            });
            logger.info('Managed draft created domain=%s pid=%d actor=%d role=author action=grant result=success', domainId, docId, creator);
            return docId;
        } catch (error) {
            logger.error('Managed draft create failed domain=%s pid=%s actor=%d error=%o', domainId, docId, creator, error);
            if (docId !== null) {
                try {
                    const cleanupManagedDraftCreation = (global.Hydro?.model as any)?.permits?.cleanupManagedDraftCreation;
                    if (typeof cleanupManagedDraftCreation === 'function') {
                        await cleanupManagedDraftCreation(domainId, docId, creator, {
                            requestId: `managed-draft-create-cleanup:${domainId}:${docId}:${creator}`,
                        });
                    }
                    await ProblemModel.deleteProblemDocumentUnchecked(domainId, docId);
                } catch (cleanupError) {
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

    static createProblemByKind(
        kind: ProblemKind,
        domainId: string,
        pid: string,
        title: string,
        content: string,
        owner: number,
        tag: string[] = [],
        options: Omit<ProblemCreateOptions, 'problemKind'> = {},
    ) {
        return ProblemModel.add(domainId, pid, title, content, owner, tag, {
            ...options,
            problemKind: parseProblemKind(kind),
        });
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

    static async claimStructureLockForSubmission(domainId: string, pid: number): Promise<void> {
        const pdoc = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
            },
            { projection: { problemKind: 1, structureRevision: 1, structureLockedAt: 1 } },
        );
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        if (pdoc.problemKind === undefined || pdoc.structureLockedAt) return;
        parseProblemKind(pdoc.problemKind);
        assertStructureRevision(pdoc.structureRevision);
        const now = new Date();
        const result = await document.coll.updateOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
                structureRevision: pdoc.structureRevision,
                structureLockedAt: { $exists: false },
                aclWriteClaim: { $exists: false },
            },
            {
                $set: {
                    structureLockedAt: now,
                    structureLockReason: 'first_submission',
                },
                $inc: { structureRevision: 1 },
            },
        );
        if (result.matchedCount === 1) return;
        const current = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
            },
            { projection: { structureLockedAt: 1 } },
        );
        if (!current?.structureLockedAt) throw new ProblemStructureConflictError(pid);
    }

    private static async editAuthorizedWithSnapshot(input: {
        domainId: string;
        pid: number;
        user: ProblemAclUser;
        operation: string;
        $set: Partial<ProblemDoc>;
        expectedProblemKind: ProblemKind;
        expectedStructureRevision?: number;
    }): Promise<{ before: ProblemDoc; result: ProblemDoc; auditedFields: string[] }> {
        const auditedFields = problemEditAuditedFields(input.$set as Record<string, unknown>);
        return ProblemModel.withAuthorizedWriteClaim(input.domainId, input.pid, input.user, input.operation, async (claim) => {
            const projection = Object.fromEntries(
                [...new Set([...auditedFields, 'problemKind', 'structureRevision', 'config', 'data'])].map((field) => [field, 1]),
            );
            const before = (await document.coll.findOne(
                {
                    domainId: input.domainId,
                    docType: document.TYPE_PROBLEM,
                    docId: input.pid,
                    'aclWriteClaim.requestId': claim.requestId,
                    'aclWriteClaim.actor': claim.actor,
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
            const existingConfig = before.config as any;
            const nextConfig = hasConfigUpdate ? (input.$set.config as any) : existingConfig;
            const existingMain = existingConfig?.main;
            const nextMain = nextConfig?.main;
            if (hasConfigUpdate && input.expectedProblemKind === 'program_fill' && existingMain) {
                if (existingMain.mode !== nextMain?.mode) throw new ValidationError('mode', null, '程序填空模式创建后不可修改');
                if (existingMain.mode === 'compile' && existingMain.lang !== nextMain?.lang) {
                    throw new ValidationError('lang', null, '评测语言创建后不可修改');
                }
            }
            if (hasConfigUpdate && input.expectedProblemKind === 'function' && existingMain && existingMain.lang !== nextMain?.lang) {
                throw new ValidationError('lang', null, '评测语言创建后不可修改');
            }
            if (input.$set.hidden === false) {
                assertPublishableFillFunction({
                    domainId: input.domainId,
                    pid: input.pid,
                    problemKind: input.expectedProblemKind,
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
        metadata?: Partial<Pick<ProblemDoc, 'title' | 'pid' | 'hidden' | 'tag' | 'difficulty' | 'lockHidden' | 'html'>>;
    }): Promise<ProblemDoc> {
        const problemKind = parseProblemKind(input.problemKind);
        let config: Record<string, unknown>;
        try {
            config = normalizeStructuredProblemConfig(problemKind, input.config);
        } catch (error) {
            logger.error(
                'Structured problem save rejected domain=%s pid=%d kind=%s revision=%d error=%o',
                input.domainId,
                input.pid,
                problemKind,
                input.expectedStructureRevision,
                error,
            );
            throw error;
        }
        const $set = { ...input.metadata, content: input.content, config, problemKind } as any;
        const { before, result, auditedFields } = await ProblemModel.editAuthorizedWithSnapshot({
            domainId: input.domainId,
            pid: input.pid,
            user: input.user,
            operation: 'structure-save',
            $set,
            expectedProblemKind: problemKind,
            expectedStructureRevision: input.expectedStructureRevision,
        });
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
        return result;
    }

    static async saveStructuredProblemMetadata(input: {
        domainId: string;
        pid: number;
        actor: number;
        user: ProblemAclUser;
        problemKind: ProblemKind;
        metadata: Pick<ProblemDoc, 'title' | 'hidden' | 'tag'>;
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
        const byDocId: Record<number, ProblemDoc> = {};
        const byPublicId: Record<string, ProblemDoc> = {};
        for (const pid of Array.from(new Set(pids))) {
            const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, user, projection, rawConfig);
            if (!pdoc) continue;
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
        options: { expectedStructureRevision?: number; skipStructureGuard?: boolean } = {},
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
                    content: 1,
                    config: 1,
                    data: 1,
                    problemKind: 1,
                    structureRevision: 1,
                    structureLockedAt: 1,
                    archivedAt: 1,
                    authoringMode: 1,
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
        await bus.parallel('problem/before-edit', $set, $unset);
        if (current.archivedAt && $set.hidden === false) throw new ValidationError('hidden');
        if ($set.hidden === false) {
            assertPublishableFillFunction({
                domainId,
                pid: _id,
                problemKind: current.problemKind,
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
        await bus.emit('problem/edit', result);
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
            if (error instanceof ValidationError || error instanceof ProblemStructureConflictError || error instanceof ProblemIsReferencedError) {
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
    ): Promise<boolean> {
        const pdoc = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_PROBLEM,
                docId: pid,
            },
            { projection: { problemKind: 1, config: 1, structureLockedAt: 1, archivedAt: 1, authoringMode: 1 } },
        );
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        if (pdoc.authoringMode === 'managed') {
            logger.error('Raw managed problem file write rejected domain=%s pid=%d names=%o', domainId, pid, testdataNames);
            throw new ValidationError('authoringMode', null, '托管题文件必须使用授权写入口');
        }
        if (pdoc.problemKind === undefined) return false;
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
        return true;
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
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            },
            {
                projection: {
                    ...Object.fromEntries(requestedFields.map((field) => [field, 1])),
                    content: 1,
                    config: 1,
                    data: 1,
                    problemKind: 1,
                    structureRevision: 1,
                    structureLockedAt: 1,
                    archivedAt: 1,
                    authoringMode: 1,
                    managedAuthoring: 1,
                },
            },
        );
        if (!current) throw new Error(`problem write claim ownership lost before edit: ${claim.requestId}`);
        let managedGuard: ReturnType<typeof managedPatchCapability> | null = null;
        if (current.authoringMode === 'managed') {
            managedGuard = managedPatchCapability(current, $set, $unset);
            if (managedGuard.immutableFields.length || !problemWriteCapabilityAllows(claim.capability, managedGuard.capability)) {
                await auditManagedClaimPatchDenied(claim, managedGuard, 'request');
                throw new ValidationError('fields', null, '写入字段超出当前托管题写入凭据');
            }
        }
        await bus.parallel('problem/before-edit', $set, $unset);
        if (current.authoringMode === 'managed') {
            const finalGuard = managedPatchCapability(current, $set, $unset);
            if (finalGuard.immutableFields.length || !problemWriteCapabilityAllows(claim.capability, finalGuard.capability)) {
                await auditManagedClaimPatchDenied(claim, finalGuard, 'after-hook');
                throw new ValidationError('fields', null, '写入钩子产生了超出托管题凭据的字段');
            }
            managedGuard = finalGuard;
        }
        if (current.archivedAt && $set.hidden === false) throw new ValidationError('hidden');
        if ($set.hidden === false) {
            assertPublishableFillFunction({
                domainId,
                pid: _id,
                problemKind: current.problemKind,
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
            result = await document.coll.findOneAndUpdate(
                revisionClaimFilter(claim, expectedRevision),
                {
                    $set,
                    ...(Object.keys($unset).length ? { $unset } : {}),
                    $inc: { structureRevision: 1 },
                },
                { returnDocument: 'after' },
            );
        } else {
            result = await commitProblemWriteClaimUpdate(claim, $set, $unset, managedGuard?.capability || claim.capability);
        }
        if (!result) throw new Error(`problem write claim ownership lost during edit: ${claim.requestId}`);
        await bus.emit('problem/edit', result, claim.requestId);
        return result;
    }

    /** HTTP/service-token metadata write entrypoint. */
    static async editAuthorized(
        domainId: string,
        _id: number,
        $set: Partial<ProblemDoc>,
        user: ProblemAclUser,
        requestedUnset: Record<string, unknown> = {},
        options: { expectedStructureRevision?: number } = {},
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
            preliminary.authoringMode === 'managed' ? managedPatchCapability(preliminary, $set, requestedUnset) : { capability: 'maintain' as const };
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
                    'aclWriteClaim.capability': claim.capability,
                    'aclWriteClaim.state': 'active',
                });
                if (!before) throw new Error(`problem write claim ownership lost before managed guard: ${claim.requestId}`);
                let guard: ReturnType<typeof managedPatchCapability> | null = null;
                if (before.authoringMode === 'managed') {
                    guard = managedPatchCapability(before, $set, requestedUnset);
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
                if (guard?.publishes) await prepareManagedPublish(claim);
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
        const original = await ProblemModel.get(domainId, _id, ProblemModel.PROJECTION_PUBLIC, true);
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
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            });
            if (!activeClaim) throw new Error(`problem write claim ownership lost before clone: ${claim.requestId}`);
        }
        if (original.reference) throw new ValidationError('reference');
        if (pid && (/^[0-9]+$/.test(pid) || (await ProblemModel.get(target, pid)))) pid = '';
        if (!pid && original.pid && !(await ProblemModel.get(target, original.pid))) pid = original.pid;
        const problemKind = original.problemKind === undefined ? 'programming' : parseProblemKind(original.problemKind);
        const cloneConfig = structuredLanguage
            ? cloneStructuredProblemForLanguage(problemKind, original.config, structuredLanguage)
            : original.config;
        const cloneOwner = attribution.owner ?? original.owner;
        const cloneActor = attribution.actor ?? cloneOwner;
        const cloneId = await ProblemModel.createProblemByKind(
            problemKind,
            target,
            pid || '',
            original.title,
            original.content,
            cloneOwner,
            original.tag,
            { difficulty: original.difficulty, structuredConfig: cloneConfig },
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
                config: cloneConfig as any,
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
        return document.push(domainId, document.TYPE_PROBLEM, _id, key, value);
    }

    static pull<T extends ArrayKeys<ProblemDoc>>(domainId: string, pid: number, key: ArrayKeys<ProblemDoc>, values: ProblemDoc[T][0][]) {
        return document.deleteSub(domainId, document.TYPE_PROBLEM, pid, key, values);
    }

    static inc(domainId: string, _id: number, field: NumberKeys<ProblemDoc> | string, n: number): Promise<ProblemDoc> {
        return document.inc(domainId, document.TYPE_PROBLEM, _id, field as any, n);
    }

    static count(domainId: string, query: Filter<ProblemDoc>) {
        return document.count(domainId, document.TYPE_PROBLEM, query);
    }

    private static async deleteProblemDocumentUnchecked(domainId: string, docId: number): Promise<boolean> {
        await bus.parallel('problem/before-del', domainId, docId);
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
        f = await normalizeProblemTestdataUpload(name, f);
        const [[, fileinfo]] = await Promise.all([
            document.getSub(domainId, document.TYPE_PROBLEM, pid, 'data', name),
            storage.put(`problem/${domainId}/${pid}/testdata/${name}`, f, operator),
        ]);
        const meta = await storage.getMeta(`problem/${domainId}/${pid}/testdata/${name}`);
        if (!meta) throw new FileUploadError();
        const payload = { name, ...pick(meta, ['size', 'lastModified', 'etag']) };
        payload.lastModified ||= new Date();
        if (!fileinfo) await ProblemModel.push(domainId, pid, 'data', { _id: name, ...payload });
        else await document.setSub(domainId, document.TYPE_PROBLEM, pid, 'data', name, payload);
        await bus.emit('problem/addTestdata', domainId, pid, name, payload);
        if (revisionManaged) await ProblemModel.bumpDirectStructureRevision(domainId, pid);
    }

    static async renameTestdata(domainId: string, pid: number, file: string, newName: string, operator = 1) {
        if (file === newName) return;
        const revisionManaged = await ProblemModel.assertDirectStructureWritable(domainId, pid, true, [file, newName]);
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
        await Promise.all([
            storage.del(
                names.map((t) => `problem/${domainId}/${pid}/testdata/${t}`),
                operator,
            ),
            ProblemModel.pull(domainId, pid, 'data', names),
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
    ): Promise<any[]> {
        const doc = await document.coll.findOne(
            {
                domainId: claim.domainId,
                docType: document.TYPE_PROBLEM,
                docId: claim.pid,
                'aclWriteClaim.requestId': claim.requestId,
                'aclWriteClaim.actor': claim.actor,
                'aclWriteClaim.capability': claim.capability,
                'aclWriteClaim.state': 'active',
            },
            { projection: { [key]: 1, problemKind: 1, config: 1, authoringMode: 1 } },
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
        return Array.isArray(doc[key]) ? doc[key] : [];
    }

    static async addTestdataWithClaim(claim: ProblemWriteClaim, name: string, f: Readable | Buffer | string, operator = 1) {
        name = name.trim();
        if (!name) throw new ValidationError('name');
        const current = await ProblemModel.getClaimedProblemFiles(claim, 'data', [name]);
        f = await normalizeProblemTestdataUpload(name, f);
        await storage.put(`problem/${claim.domainId}/${claim.pid}/testdata/${name}`, f, operator);
        const meta = await storage.getMeta(`problem/${claim.domainId}/${claim.pid}/testdata/${name}`);
        if (!meta) throw new FileUploadError();
        const payload = { name, ...pick(meta, ['size', 'lastModified', 'etag']) } as any;
        payload.lastModified ||= new Date();
        const next = current.filter((item) => item.name !== name);
        next.push({ _id: name, ...payload });
        if (!(await commitProblemWriteClaimUpdate(claim, { data: next } as any, {}, 'content'))) {
            throw new Error(`problem write claim ownership lost after testdata upload: ${claim.requestId}`);
        }
        await bus.emit('problem/addTestdata', claim.domainId, claim.pid, name, payload, claim);
    }

    static async renameTestdataWithClaim(claim: ProblemWriteClaim, file: string, newName: string, operator = 1) {
        if (file === newName) return;
        const current = await ProblemModel.getClaimedProblemFiles(claim, 'data', [file, newName]);
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
        if (!(await commitProblemWriteClaimUpdate(claim, { data: next } as any, {}, 'content'))) {
            throw new Error(`problem write claim ownership lost after testdata rename: ${claim.requestId}`);
        }
        await bus.emit('problem/renameTestdata', claim.domainId, claim.pid, file, newName, claim);
    }

    static async delTestdataWithClaim(claim: ProblemWriteClaim, name: string | string[], operator = 1) {
        const names = name instanceof Array ? name : [name];
        const current = await ProblemModel.getClaimedProblemFiles(claim, 'data', names);
        await storage.del(
            names.map((item) => `problem/${claim.domainId}/${claim.pid}/testdata/${item}`),
            operator,
        );
        if (!(await commitProblemWriteClaimUpdate(claim, { data: current.filter((item) => !names.includes(item.name)) } as any, {}, 'content'))) {
            throw new Error(`problem write claim ownership lost after testdata delete: ${claim.requestId}`);
        }
        await bus.emit('problem/delTestdata', claim.domainId, claim.pid, names, claim);
    }

    static async addAdditionalFileWithClaim(claim: ProblemWriteClaim, name: string, f: Readable | Buffer | string, operator = 1) {
        name = name.trim();
        if (!name) throw new ValidationError('name');
        const current = await ProblemModel.getClaimedProblemFiles(claim, 'additional_file');
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
        const current = await ProblemModel.getClaimedProblemFiles(claim, 'additional_file');
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
        const current = await ProblemModel.getClaimedProblemFiles(claim, 'additional_file');
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

export function apply(ctx: Context) {
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
