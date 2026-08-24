import { createReadStream } from 'fs';
import { PassThrough, Readable, Writable } from 'stream';
import { Entry, ZipReader } from '@zip.js/zip.js';
import { readFile } from 'fs-extra';
import { escapeRegExp, flattenDeep, intersection, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';
import sanitize from 'sanitize-filename';
import Schema from 'schemastery';
import {
    BASIC_OBJECTIVE_KIND,
    type BasicObjectiveKind,
    effectiveProblemKind,
    isBasicObjectiveKind,
    parseProblemKindSlug,
    PROBLEM_KIND_SLUGS,
    PROBLEM_KIND_TO_SLUG,
    PROBLEM_KINDS,
    problemKindToSlug,
} from '@hydrooj/common';
import parser from '@hydrooj/utils/lib/search';
import { Logger, randomstring, sortFiles, streamToBuffer } from '@hydrooj/utils/lib/utils';
import type { Context } from '../context';
import {
    localizeError,
    localizeErrorParameter,
    localizedErrorText,
    BadRequestError,
    ContestNotAttendedError,
    ContestNotEndedError,
    ContestNotFoundError,
    ContestNotLiveError,
    FileLimitExceededError,
    FileTooLargeError,
    HackFailedError,
    NoProblemError,
    NotFoundError,
    PermissionError,
    ProblemAlreadyExistError,
    ProblemAlreadyUsedByContestError,
    ProblemConfigError,
    ProblemIsReferencedError,
    ProblemNotAllowCopyError,
    ProblemNotAllowLanguageError,
    ProblemNotAllowPretestError,
    ProblemNotFoundError,
    RecordNotFoundError,
    SolutionNotFoundError,
    type LocalizedErrorText,
    ValidationError,
} from '../error';
import { DomainDoc, ProblemDataWriteConfirmation, ProblemDataWriteOperation, ProblemDoc, ProblemStatusDoc, RecordDoc, User } from '../interface';
import {
    assertStoredAntiAiMarkers,
    isRawStatementContentInput,
    remapAntiAiMarkerOffset,
    statementSourcesForAntiAiMarkers,
    type AntiAiMarkerSourceReplacement,
} from '../lib/anti-ai-marker';
import { canUsePostContestPractice, getContestSubmissionScope, resolvePostContestProblemMode } from '../lib/contest-correction';
import { buildPersonalPracticeRecordQuery, buildPersonalPracticeStatusByPid, PersonalPracticeRecord } from '../lib/contest-problem-status';
import { getProblemConfigErrorText, isProblemConfigFilename, parseProblemConfigObject, parseStructuredRegionSubmission } from '../lib/problem-config';
import {
    compileProgrammingStatement,
    emptyProgrammingStatement,
    previewLegacyProgrammingStatement,
    programmingStatementClientView,
    programmingStatementLimits,
} from '../lib/programming-statement';
import { resolveProblemKnowledgeNodeIds } from '../lib/problem-tag-canonical';
import { PERM, PRIV, STATUS } from '../model/builtin';
import { virtualContestService } from '../model/virtual-contest';
import { normalizeCodeEvaluationDraftCreationConfig } from '../model/code-evaluation-lifecycle';
import * as contest from '../model/contest';
import * as discussion from '../model/discussion';
import domain from '../model/domain';
import { markManualPending } from '../model/manual-grade';
import * as oplog from '../model/oplog';
import {
    PracticeIntegrityContextError,
    practiceIntegrityService,
    trustedPracticeContextReference,
    type PracticeContainerKind,
    type PracticeScopeKind,
    type TrustedPracticeContextReference,
} from '../model/practice-integrity';
import { selectPracticeIssueTargets } from '../lib/practice-issue-targets';
import {
    assertPracticeContextAccess,
    canManagePracticeContainer,
    canPreviewPracticeIntegrity,
    preparePracticeIssue,
} from '../model/practice-integrity-access';
import problem from '../model/problem';
import {
    classifyLegacyProgrammingTags,
    listKnowledgeMapsForProblemSelection,
    listKnowledgeMindmapOptions,
    listManagedMindmapOptions,
    listManagedProblemTrainingPlacements,
    listManagedTrainingOptions,
    MANAGED_SOURCE_TEMPLATES,
    materializeKnowledgeMindmapTags,
    prepareManagedProblemPublication,
    previewProgrammingTagNormalization,
} from '../model/managed-problem-authoring';
import { isCanonicalManagedSourceTag } from '../model/managed-problem-source';
import {
    canManagePidNamespaces,
    canReviewPidNamespaceProblems,
    createCustomPidNamespace,
    DEFAULT_PID_NAMESPACE_ID,
    deleteCustomPidNamespace,
    listCreatablePidNamespaces,
    listManageablePidNamespaces,
    listPidNamespaces,
    managedPidNamespaceIds,
    setPidNamespaceMember,
    updatePidNamespaceConfig,
} from '../model/problem-pid-namespace';
import { structuredProblemConfigForEditor, structuredProblemUsesTestdata } from '../model/problem-lifecycle';
import record from '../model/record';
import * as setting from '../model/setting';
import solution from '../model/solution';
import storage from '../model/storage';
import system from '../model/system';
import user from '../model/user';
import { Handler, param, post, Query, query, route, Types } from '../service/server';
import { ContestDetailBaseHandler } from './contest';

export const parseCategory = (value: string) =>
    value
        .replace(/，/g, ',')
        .split(',')
        .map((e) => e.trim());
const logger = new Logger('problem-handler');

function localizedConfigValidation(field: string, detail: LocalizedErrorText) {
    return new ValidationError(field, null, detail);
}

function structuredCodeLanguageRange(ddoc: DomainDoc | null | undefined): Record<string, string> {
    const configured =
        typeof ddoc?.langs === 'string'
            ? ddoc.langs
                  .split(',')
                  .map((lang) => lang.trim())
                  .filter(Boolean)
            : [];
    const allowed = new Set(configured);
    return Object.fromEntries(
        Object.entries(setting.SETTINGS_BY_KEY.codeLang.range).filter(([lang]) => {
            const runtime = setting.langs[lang];
            if (!runtime || runtime.disabled || runtime.remote) return false;
            return allowed.size ? allowed.has(lang) : !runtime.hidden;
        }),
    );
}

function assertStructuredCodeLanguageAllowed(problemKind: string, configInput: unknown, ddoc: DomainDoc | null | undefined): void {
    if (problemKind !== PROGRAM_FILL_KIND && problemKind !== FUNCTION_KIND) return;
    if (!configInput || typeof configInput !== 'object' || Array.isArray(configInput)) throw new ValidationError('structuredConfig');
    const main = (configInput as Record<string, unknown>).main;
    if (!main || typeof main !== 'object' || Array.isArray(main)) throw new ValidationError('structuredConfig');
    const mode = (main as Record<string, unknown>).mode;
    if (problemKind === PROGRAM_FILL_KIND && mode === 'text') return;
    const lang = (main as Record<string, unknown>).lang;
    if (typeof lang !== 'string' || !Object.hasOwn(structuredCodeLanguageRange(ddoc), lang)) {
        throw new ValidationError('lang', null, localizedErrorText`请选择当前域允许的评测语言`);
    }
}

function pidNamespaceClientOption(namespace: Awaited<ReturnType<typeof listPidNamespaces>>[number]) {
    return {
        namespaceId: namespace.namespaceId,
        kind: namespace.kind,
        name: namespace.name,
        enabled: namespace.enabled,
        sourceTemplates: namespace.sourceTemplates,
        pidPattern: namespace.pidPattern,
        prefix: namespace.prefix,
        start: namespace.start,
        counter: namespace.counter,
        allocated: namespace.allocated,
    };
}

async function problemAuthorUsers(pdoc: ProblemDoc, owner?: User, stage = 'detail-author-resolution'): Promise<User[]> {
    if (pdoc.authoringMode !== 'managed') return owner ? [owner] : [];
    const permits = (global.Hydro?.model as any)?.permits;
    if (typeof permits?.listForProblem !== 'function') throw new TypeError('permits.listForProblem is unavailable');
    const rows = await permits.listForProblem(pdoc.domainId, pdoc.docId);
    const malformed = rows.find((row: any) => row?.role === 'author' && (!Number.isSafeInteger(row.uid) || row.uid <= 0));
    if (malformed) throw new TypeError(`managed problem ${pdoc.domainId}/${pdoc.docId} has a malformed author permit`);
    const authorUids = [...new Set<number>(rows.filter((row: any) => row?.role === 'author').map((row: any) => row.uid))].sort((a, b) => a - b);
    if (!authorUids.length) {
        logger.error(
            'Managed problem author unavailable domainId=%s docId=%d owner=%d authorUids=%o stage=%s',
            pdoc.domainId,
            pdoc.docId,
            pdoc.owner,
            authorUids,
            stage,
        );
        return [];
    }
    const authorDict = await user.getList(pdoc.domainId, authorUids);
    const missing = authorUids.filter((uid) => authorDict[uid]?._id !== uid);
    if (missing.length) {
        logger.error(
            'Managed problem author unavailable domainId=%s docId=%d owner=%d authorUids=%o stage=%s missingProfiles=%o',
            pdoc.domainId,
            pdoc.docId,
            pdoc.owner,
            authorUids,
            stage,
            missing,
        );
        return [];
    }
    return authorUids.map((uid) => authorDict[uid]);
}

async function problemDataContributorUsers(pdoc: ProblemDoc): Promise<User[]> {
    const permits = (global.Hydro?.model as any)?.permits;
    if (typeof permits?.listCompletedDataContributorUids !== 'function') {
        throw new TypeError('permits.listCompletedDataContributorUids is unavailable');
    }
    const uids = await permits.listCompletedDataContributorUids(pdoc.domainId, pdoc.docId);
    if (!uids.length) return [];
    const udict = await user.getList(pdoc.domainId, uids);
    const missing = uids.filter((uid: number) => udict[uid]?._id !== uid);
    if (missing.length) {
        logger.warn('Problem data contributor profiles missing domain=%s pid=%d uids=%o', pdoc.domainId, pdoc.docId, missing);
    }
    return uids.flatMap((uid: number) => (udict[uid]?._id === uid ? [udict[uid]] : []));
}

async function pendingProblemContributionReviewFacts(domainId: string, pids: number[]) {
    const uniquePids = [...new Set(pids)];
    const rowsByDocId: Record<string, Array<{ uid: number; scope: 'data' | 'tag' }>> = {};
    const fingerprintByDocId: Record<string, string> = {};
    if (!uniquePids.length) return { rowsByDocId, fingerprintByDocId, udict: {} as Record<string, User> };
    const permits = (global.Hydro?.model as any)?.permits;
    if (typeof permits?.listPendingContributionsForProblems !== 'function') {
        throw new TypeError('permits.listPendingContributionsForProblems is unavailable');
    }
    const rows = await permits.listPendingContributionsForProblems(domainId, uniquePids);
    if (!Array.isArray(rows)) throw new TypeError('pending contribution service returned a non-array result');
    for (const row of rows) {
        if (
            !uniquePids.includes(row?.pid) ||
            !Number.isSafeInteger(row?.uid) ||
            row.uid <= 0 ||
            !['data', 'tag'].includes(row.scope) ||
            row.active !== true ||
            row.status !== 'pending'
        ) {
            throw new TypeError('pending contribution service returned malformed facts');
        }
        (rowsByDocId[row.pid] ||= []).push({ uid: row.uid, scope: row.scope });
    }
    for (const pid of uniquePids) {
        const problemRows = rows.filter((row: any) => row.pid === pid);
        if (problemRows.length) fingerprintByDocId[pid] = problem.pendingProblemContributionFingerprint(problemRows);
    }
    const uids = [...new Set<number>(rows.map((row: any) => row.uid))];
    const udict = uids.length ? await user.getList(domainId, uids) : {};
    return { rowsByDocId, fingerprintByDocId, udict };
}

const BASIC_OBJECTIVE_TEMPLATES: Record<BasicObjectiveKind, string> = {
    [BASIC_OBJECTIVE_KIND.single]: 'problem_edit_single.html',
    [BASIC_OBJECTIVE_KIND.multi]: 'problem_edit_multi.html',
    [BASIC_OBJECTIVE_KIND.trueFalse]: 'problem_edit_true_false.html',
    [BASIC_OBJECTIVE_KIND.blank]: 'problem_edit_blank.html',
};
const SUBJECTIVE_KIND = PROBLEM_KIND_TO_SLUG.subjective;
const PROGRAM_FILL_KIND = 'program_fill' as const;
const FUNCTION_KIND = 'function' as const;
type DedicatedStructuredEditorKind = BasicObjectiveKind | typeof SUBJECTIVE_KIND | typeof PROGRAM_FILL_KIND | typeof FUNCTION_KIND;

function isDedicatedStructuredEditorKind(kind: ReturnType<typeof effectiveProblemKind>): kind is DedicatedStructuredEditorKind {
    return isBasicObjectiveKind(kind) || [SUBJECTIVE_KIND, PROGRAM_FILL_KIND, FUNCTION_KIND].includes(kind as any);
}

function programmingTagEditorState(
    pdoc: ProblemDoc,
    maps: Awaited<ReturnType<typeof listKnowledgeMapsForProblemSelection>>,
    mindmapOptions: Awaited<ReturnType<typeof listKnowledgeMindmapOptions>>,
) {
    const knowledgeMapId = pdoc.knowledgeMapId ? String(pdoc.knowledgeMapId) : '';
    const scopedOptions = mindmapOptions.filter((option) => option.mapId === knowledgeMapId);
    const classification = classifyLegacyProgrammingTags(pdoc.tag || [], scopedOptions);
    const knowledgeMapTitle = maps.find((map) => map.id === knowledgeMapId)?.title || '';
    const selectedNodeIds = resolveProblemKnowledgeNodeIds(pdoc, `problem ${pdoc.domainId}/${pdoc.docId}`);
    if (pdoc.authoringMode === 'managed') {
        return {
            mode: 'managed' as const,
            knowledgeMapId,
            knowledgeMapTitle,
            sourceTags: classification.sourceTags,
            selectedNodeIds,
        };
    }
    if (selectedNodeIds.length) {
        return {
            mode: 'converted' as const,
            knowledgeMapId,
            knowledgeMapTitle,
            sourceTags: classification.sourceTags,
            selectedNodeIds,
        };
    }
    return {
        mode: 'unconverted' as const,
        knowledgeMapId,
        knowledgeMapTitle,
        ...classification,
        selectedNodeIds: classification.suggestedNodeIds,
    };
}

function programmingTagPreviewResponse(preview: Awaited<ReturnType<typeof previewProgrammingTagNormalization>>) {
    return { ...preview, knowledgeMapId: String(preview.knowledgeMapId), selectedNodeIds: preview.selectedNodeIds.map(String) };
}

async function managedProblemReviewPreview(pdoc: ProblemDoc) {
    const revision = pdoc.structureRevision;
    if (pdoc.managedAuthoring?.metadataStatus !== 'draft') {
        return {
            state: 'confirmed' as const,
            structureRevision: revision,
            tags: [...(pdoc.tag || [])],
            selectedMindmapNodeIds: (pdoc.managedAuthoring?.selectedMindmapNodeIds || []).map(String),
        };
    }
    try {
        const prepared = await prepareManagedProblemPublication(pdoc.domainId, pdoc);
        return {
            state: 'ready' as const,
            structureRevision: revision,
            tags: prepared.tags,
            selectedMindmapNodeIds: prepared.selectedMindmapNodeIds.map(String),
        };
    } catch (error) {
        logger.warn(
            'Managed review preview rejected domain=%s pid=%d publicPid=%s revision=%s stage=review-preview result=invalid error=%o',
            pdoc.domainId,
            pdoc.docId,
            pdoc.pid,
            revision ?? '-',
            error,
        );
        return {
            state: 'invalid' as const,
            structureRevision: revision,
            tags: [] as string[],
            selectedMindmapNodeIds: [] as string[],
            message: error instanceof Error && error.message ? error.message : '来源、知识节点或待挂训练预检失败',
        };
    }
}

function logProgrammingTagNormalizationRejected(
    pdoc: ProblemDoc,
    actor: number,
    stage: 'preview' | 'confirm',
    selectedNodeIds: unknown,
    error: unknown,
) {
    const tags = Array.isArray(pdoc.tag) ? pdoc.tag : [];
    const sourceTags = tags.filter(isCanonicalManagedSourceTag);
    const selectedNodeCount = Array.isArray(selectedNodeIds) ? selectedNodeIds.length : 0;
    logger.warn(
        'Programming tag normalization rejected domain=%s pid=%s docId=%d actor=%d stage=%s result=rejected oldTagCount=%d sourceTagCount=%d selectedNodeCount=%d addedTagCount=0 removedTagCount=0 revision=%s sourceTags=%o error=%o',
        pdoc.domainId,
        pdoc.pid || `P${pdoc.docId}`,
        pdoc.docId,
        actor,
        stage,
        tags.length,
        sourceTags.length,
        selectedNodeCount,
        pdoc.structureRevision ?? '-',
        sourceTags,
        error,
    );
}

function structuredEditorTemplate(kind: DedicatedStructuredEditorKind): string {
    if (kind === SUBJECTIVE_KIND) return 'problem_edit_subjective.html';
    if (kind === PROGRAM_FILL_KIND) return 'problem_edit_program_fill.html';
    if (kind === FUNCTION_KIND) return 'problem_edit_function.html';
    return BASIC_OBJECTIVE_TEMPLATES[kind];
}

function defaultBasicObjectiveConfig(kind: BasicObjectiveKind): Record<string, unknown> {
    if (kind === BASIC_OBJECTIVE_KIND.single) return { main: { options: ['', ''], answerIndex: 0 } };
    if (kind === BASIC_OBJECTIVE_KIND.multi) {
        return { main: { options: ['', ''], answerIndexes: [0], partialCreditPercent: 0 } };
    }
    if (kind === BASIC_OBJECTIVE_KIND.trueFalse) return { main: { answer: true } };
    return { main: { answer: '' } };
}

function defaultDedicatedConfig(kind: DedicatedStructuredEditorKind): Record<string, unknown> {
    if (kind === SUBJECTIVE_KIND) return { main: { gradingInstructions: '' } };
    if (kind === PROGRAM_FILL_KIND) return { main: { mode: 'text', lang: '', source: '', regions: [] } };
    if (kind === FUNCTION_KIND) return { main: { mode: 'function', lang: '' } };
    return defaultBasicObjectiveConfig(kind);
}

function allowsStructuredTestdata(pdoc: ProblemDoc): boolean {
    if (pdoc.problemKind === undefined || pdoc.problemKind === 'programming') return true;
    const kind = effectiveProblemKind(pdoc);
    return structuredProblemUsesTestdata(kind, parseProblemConfigObject(pdoc));
}

function parseStructuredConfigInput(raw: string): unknown {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw localizeErrorParameter(
            new ValidationError('structuredConfig', null, error.message),
            2,
            'The structured problem configuration could not be parsed: {0}',
            error.message,
        );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ValidationError('structuredConfig', null, localizedErrorText`config must be an object`);
    }
    return parsed;
}

function createRequestUsesCodeEvaluationDraft(kind: DedicatedStructuredEditorKind, config: unknown): boolean {
    if (kind === FUNCTION_KIND) return true;
    if (kind !== PROGRAM_FILL_KIND || !config || typeof config !== 'object' || Array.isArray(config)) return false;
    const main = (config as Record<string, unknown>).main;
    return !!main && typeof main === 'object' && !Array.isArray(main) && (main as Record<string, unknown>).mode === 'compile';
}

function exactProblemFilter(id: string | number): Filter<ProblemDoc> {
    return Number.isSafeInteger(+id) ? { docId: +id } : { pid: id as string };
}

function buildProblemTextFilter(q: string, includeTag = true): Filter<ProblemDoc> {
    const escaped = escapeRegExp(q.toLowerCase());
    const $regex = new RegExp(q.length >= 2 ? escaped : `^${escaped}`, 'i');
    const alternatives: Filter<ProblemDoc>[] = [{ pid: { $regex } }, { title: { $regex } }];
    if (includeTag) alternatives.push({ tag: q });
    if (Number.isSafeInteger(+q)) alternatives.unshift({ docId: +q });
    else if (/^P\d+$/i.test(q) && Number.isSafeInteger(+q.substring(1))) {
        alternatives.unshift({ docId: +q.substring(1) });
    }
    return { $or: alternatives };
}

async function auditManagedWriteDenied(handler: Handler, pdoc: ProblemDoc, operation: string, capability: string, fields: string[] = []) {
    if (pdoc.authoringMode !== 'managed') return;
    logger.warn(
        'Managed write rejected domain=%s pid=%d actor=%d operation=%s capability=%s fields=%o result=denied',
        pdoc.domainId,
        pdoc.docId,
        handler.user._id,
        operation,
        capability,
        fields,
    );
    await oplog.log(handler, 'problem.managed.write.denied', {
        pid: pdoc.docId,
        action: operation,
        capability,
        fields,
        result: 'denied',
    });
}

async function assertProblemWriteCapability(handler: Handler, pdoc: ProblemDoc, allowed: boolean, operation: string, capability: string) {
    if (allowed) return;
    await auditManagedWriteDenied(handler, pdoc, operation, capability);
    throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
}

const MANAGED_FILE_WRITE_FIELDS: Record<string, string[]> = {
    prepare_data_write: ['operation', 'writeOperation'],
    upload_file: ['operation', 'filename', 'type', 'activeContainerConfirmation'],
    rename_files: ['operation', 'files', 'newNames', 'type', 'activeContainerConfirmation'],
    delete_files: ['operation', 'files', 'type', 'activeContainerConfirmation'],
    generate_testdata: ['operation', 'std', 'gen', 'activeContainerConfirmation'],
};

async function assertManagedFileWriteBody(handler: Handler, pdoc: ProblemDoc) {
    if (pdoc.authoringMode !== 'managed') return;
    const body = handler.request.body || {};
    const operation = String((handler.args as any).operation || body.operation || '');
    const allowed = MANAGED_FILE_WRITE_FIELDS[operation];
    if (!allowed) return;
    const unknownFields = Object.keys(body).filter((field) => !allowed.includes(field));
    if (!unknownFields.length) return;
    await auditManagedWriteDenied(handler, pdoc, operation, 'content', unknownFields);
    throw new ValidationError('fields', null, localizedErrorText`托管题文件操作不接受字段：${unknownFields.join(', ')}`);
}

function validateProblemBulkDownloadFiles(
    handler: Handler,
    pdoc: ProblemDoc,
    type: 'testdata' | 'additional_file',
    files: Set<unknown>,
): { names: string[]; metadata: Array<{ name: string; size?: number }> } {
    const requested = Array.from(files);
    const invalidTypeCount = requested.filter((file) => typeof file !== 'string').length;
    if (invalidTypeCount) {
        logger.warn(
            'Bulk problem download rejected domain=%s pid=%d actor=%d type=%s count=%d invalidTypeCount=%d result=invalid-files-shape',
            pdoc.domainId,
            pdoc.docId,
            handler.user._id,
            type,
            requested.length,
            invalidTypeCount,
        );
        throw new ValidationError('files', null, localizedErrorText`文件列表必须是字符串数组`);
    }

    const names = requested as string[];
    const metadata = (pdoc[type === 'testdata' ? 'data' : 'additional_file'] || []) as Array<{ name: string; size?: number }>;
    const available = new Set(metadata.map((file) => file.name));
    const missingCount = names.filter((name) => !available.has(name)).length;
    if (missingCount) {
        logger.warn(
            'Bulk problem download rejected domain=%s pid=%d actor=%d type=%s count=%d missingCount=%d result=missing-files',
            pdoc.domainId,
            pdoc.docId,
            handler.user._id,
            type,
            names.length,
            missingCount,
        );
        throw new ValidationError('files', null, localizedErrorText`请求的文件不存在（${missingCount} 个）`);
    }
    return { names, metadata };
}

function problemAuthoringCapabilities(udoc: User, pdoc: ProblemDoc) {
    return {
        managed: pdoc.authoringMode === 'managed',
        canEditContent: problem.canEditProblemContent(udoc, pdoc),
        canEditData: problem.canEditProblemData(udoc, pdoc),
        canEditTags: problem.canEditProblemTags(udoc, pdoc),
        canEditDraftMetadata: problem.canEditProblemMetadata(udoc, pdoc),
        canSubmitProblem: problem.canSubmitProblem(udoc, pdoc),
        canManageCollaborators: problem.canManageProblemCollaborators(udoc, pdoc),
        canManageContributions: problem.canManageProblemContributions(udoc, pdoc),
        canManageMaintainers: problem.canManageProblemMaintainers(udoc, pdoc),
        canPublish: problem.canPublishProblem(udoc, pdoc),
        canArchive: problem.canArchiveProblem(udoc, pdoc),
        canDelete: problem.canDeleteProblem(udoc, pdoc),
        canClone: problem.canCloneProblem(udoc, pdoc),
    };
}

function isManagedPublicationCandidate(pdoc: ProblemDoc) {
    if (pdoc.authoringMode !== 'managed' || pdoc.hidden !== true) return false;
    return pdoc.managedAuthoring?.metadataStatus === 'draft' || pdoc.managedAuthoring?.metadataStatus === 'confirmed';
}

function assertManagedPublicationRevision(pdoc: ProblemDoc) {
    if (!Number.isSafeInteger(pdoc.structureRevision) || pdoc.structureRevision! < 1) {
        throw new Error(`Managed publication candidate ${pdoc.domainId}/${pdoc.docId} is missing an exact structure revision`);
    }
}

async function requireStableCapabilityProblem(
    udoc: User,
    pdoc: ProblemDoc,
    capability: 'content' | 'data' | 'tag' | 'contributions',
    projection: any = problem.PROJECTION_PUBLIC,
    rawConfig = false,
): Promise<ProblemDoc> {
    const stable = await problem.getCapabilityAuthorized(pdoc.domainId, pdoc.docId, udoc, capability, projection, rawConfig);
    if (!stable) throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
    return stable;
}

const PROBLEM_TAG_WORKSPACE_PROJECTION = [
    '_id',
    'domainId',
    'docType',
    'docId',
    'pid',
    'owner',
    'title',
    'difficulty',
    'tag',
    'hidden',
    'content',
    'html',
    'problemKind',
    'codeEvaluationStatus',
    'structureRevision',
    'archivedAt',
    'authoringMode',
    'sourceMeta',
    'knowledgeMapId',
    'knowledgeNodeIds',
    'managedAuthoring.metadataStatus',
    'managedAuthoring.workingTitle',
    'managedAuthoring.selectedMindmapNodeIds',
] as any;

function problemWorkspaceProjection(capability: 'content' | 'data' | 'tag' | 'contributions', canEditTags: boolean) {
    if (capability === 'content') return problem.PROJECTION_MANAGED_EDITOR;
    if (capability === 'data') {
        return canEditTags
            ? ([
                  ...problem.PROJECTION_PUBLIC,
                  'sourceMeta',
                  'knowledgeNodeIds',
                  'managedAuthoring.metadataStatus',
                  'managedAuthoring.workingTitle',
                  'managedAuthoring.selectedMindmapNodeIds',
              ] as any)
            : problem.PROJECTION_PUBLIC;
    }
    return PROBLEM_TAG_WORKSPACE_PROJECTION;
}

const DATA_WRITE_CONFIRMATION_SESSION_KEY = 'problemDataWriteConfirmations';
const DATA_WRITE_CONFIRMATION_OPERATIONS: ProblemDataWriteOperation[] = ['files-upload', 'files-rename', 'files-delete', 'generate-testdata-request'];

function confirmationStore(handler: Handler): Record<string, ProblemDataWriteConfirmation> {
    const session = handler.session as any;
    const stored = session?.[DATA_WRITE_CONFIRMATION_SESSION_KEY];
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

function resolveDataWriteConfirmation(
    handler: Handler,
    pdoc: ProblemDoc,
    operation: ProblemDataWriteOperation,
    requestId?: string,
): ProblemDataWriteConfirmation | undefined {
    if (!requestId) return undefined;
    const store = confirmationStore(handler);
    const confirmation = store[requestId];
    const now = Date.now();
    if (
        !confirmation ||
        confirmation.requestId !== requestId ||
        confirmation.domainId !== pdoc.domainId ||
        confirmation.pid !== pdoc.docId ||
        confirmation.actor !== handler.user._id ||
        confirmation.operation !== operation ||
        !Number.isSafeInteger(confirmation.issuedAt) ||
        confirmation.issuedAt > now ||
        now - confirmation.issuedAt > problem.PROBLEM_DATA_WRITE_CONFIRMATION_TTL_MS
    ) {
        logger.warn(
            'Active-container confirmation rejected domain=%s pid=%d actor=%d operation=%s confirmationRequestId=%s result=invalid-or-expired',
            pdoc.domainId,
            pdoc.docId,
            handler.user._id,
            operation,
            requestId,
        );
        throw new ValidationError(
            'activeContainerConfirmation',
            null,
            localizedErrorText`${operation === 'statement-edit' ? '赛中题面' : '赛中数据'}修改确认已失效，请刷新页面后重新确认`,
        );
    }
    if (operation === 'statement-edit') {
        const nextStore = { ...store };
        delete nextStore[requestId];
        (handler.session as any)[DATA_WRITE_CONFIRMATION_SESSION_KEY] = nextStore;
        logger.info(
            'Active-container statement confirmation consumed domain=%s pid=%d actor=%d confirmationRequestId=%s result=consumed',
            pdoc.domainId,
            pdoc.docId,
            handler.user._id,
            requestId,
        );
    }
    return confirmation;
}

async function dataWriteGuardState(
    handler: Handler,
    pdoc: ProblemDoc,
    udoc: User,
    scope: 'data' | 'statement' = 'data',
    operations?: ProblemDataWriteOperation[],
) {
    const active = await problem.listActiveDataWriteContainers(pdoc.domainId, pdoc.docId);
    const facts = problem.activeDataWriteContainerFacts(active);
    const canOverride = problem.isProblemBankAdmin(udoc);
    const contributionOnly = !problem.canEditProblemContent(udoc, pdoc);
    const guardedFacts = scope === 'statement' || canOverride || contributionOnly ? facts : [];
    const state: any = {
        active: guardedFacts.map((item) => ({ id: item.id, title: item.title, rule: item.rule, endAt: item.endAt })),
        canOverride,
    };
    if (!guardedFacts.length || !canOverride) return state;
    const confirmationOperations = scope === 'statement' ? (['statement-edit'] as ProblemDataWriteOperation[]) : operations || [];
    if (!confirmationOperations.length) return state;
    if (!handler.session) throw new TypeError('active-container confirmation requires an HTTP session');
    const issuedAt = Date.now();
    const retained = Object.values(confirmationStore(handler))
        .filter(
            (entry) =>
                Number.isSafeInteger(entry?.issuedAt) &&
                entry.issuedAt <= issuedAt &&
                issuedAt - entry.issuedAt <= problem.PROBLEM_DATA_WRITE_CONFIRMATION_TTL_MS,
        )
        .sort((left, right) => right.issuedAt - left.issuedAt)
        .slice(0, 28);
    const store = Object.fromEntries(retained.map((entry) => [entry.requestId, entry]));
    const containerFingerprint = problem.activeDataWriteContainerFingerprint(pdoc.domainId, pdoc.docId, guardedFacts);
    state.confirmationRequestIds = Object.fromEntries(
        confirmationOperations.map((operation) => {
            const requestId = `problem-data-confirm:${nanoid(20)}`;
            store[requestId] = {
                requestId,
                domainId: pdoc.domainId,
                pid: pdoc.docId,
                actor: udoc._id,
                operation,
                containerFingerprint,
                issuedAt,
            };
            return [operation, requestId];
        }),
    );
    (handler.session as any)[DATA_WRITE_CONFIRMATION_SESSION_KEY] = store;
    return state;
}

export interface QueryContext {
    query: Filter<ProblemDoc>;
    sort: string[];
    pcountRelation: string;
    parsed: ReturnType<typeof parser.parse>;
    category: string[];
    text: string;
    total: number;
    fail: boolean;
    hint: string;
}

export class ProblemMainHandler extends Handler {
    queryContext: QueryContext = {
        query: {},
        sort: [],
        pcountRelation: 'eq',
        parsed: null,
        category: [],
        text: '',
        total: 0,
        fail: false,
        hint: 'sort',
    };

    @param('page', Types.PositiveInt, true)
    @param('q', Types.Content, true)
    @param('limit', Types.PositiveInt, true)
    @param('pjax', Types.Boolean)
    @param('quick', Types.Boolean)
    @param('sort', Types.Range(['default', 'recent', 'title']), true)
    @param('kind', Types.Range([...PROBLEM_KIND_SLUGS]), true)
    @param('tag', Types.Content, true)
    @param('owner', Types.PositiveInt, true)
    @param('visibility', Types.Range(['all', 'hidden', 'published']), true)
    @param('lifecycle', Types.Range(['active', 'archived', 'all']), true)
    @param('managedReview', Types.Range(['all', 'pending']), true)
    @param('pidNamespaceId', Types.String, true)
    @param('contest', Types.ObjectId, true)
    async get(
        _domainId: string,
        page = 1,
        q = '',
        limit: number,
        pjax = false,
        quick = false,
        sortStrategy: 'default' | 'recent' | 'title' = 'default',
        kindSlug = '',
        tag = '',
        owner = 0,
        visibility: 'all' | 'hidden' | 'published' = 'all',
        lifecycle: 'active' | 'archived' | 'all' = 'active',
        managedReview: 'all' | 'pending' = 'all',
        pidNamespaceId = '',
        contestId: ObjectId = null,
    ) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (!problem.canBrowseProblemBank(this.user)) {
            if (quick || this.request.json) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
            this.response.redirect = this.url('training_main');
            return;
        }
        this.response.template = 'problem_main.html';
        if (!limit || limit > this.ctx.setting.get('pagination.problem') || page > 1) limit = this.ctx.setting.get('pagination.problem');
        const problemBankScope = problem.buildProblemBankScope(this.user);
        const isBankAdmin = problem.isProblemBankAdmin(this.user);
        const canReviewManaged = canReviewPidNamespaceProblems(this.user, domainId);
        const canManageNamespaces = canManagePidNamespaces(this.user, domainId);
        if (owner && !isBankAdmin) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        if (managedReview === 'pending' && !canReviewManaged) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
        const canFilterContest = this.user.hasPerm(PERM.PERM_VIEW_CONTEST);
        if (contestId && !canFilterContest) throw new PermissionError(PERM.PERM_VIEW_CONTEST);
        let contestAccessFilter: Filter<any> | null = null;
        if (canFilterContest) {
            const contestGroups = (await user.listGroup(domainId, this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST) ? undefined : this.user._id)).map(
                (item) => item.name,
            );
            contestAccessFilter = {
                ...(this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST)
                    ? {}
                    : {
                          $or: [
                              { maintainer: this.user._id },
                              { owner: this.user._id },
                              { assign: { $in: contestGroups } },
                              { assign: { $size: 0 } },
                          ],
                      }),
                rule: { $ne: 'homework' },
            };
        }
        const selectedContest = contestId
            ? await contest
                  .getMulti(domainId, { ...contestAccessFilter!, docId: contestId })
                  .limit(1)
                  .next()
            : null;
        if (contestId && !selectedContest) throw new ContestNotFoundError(domainId, contestId);
        const filterParts: Filter<ProblemDoc>[] = [problemBankScope];
        if (selectedContest) filterParts.push({ docId: { $in: selectedContest.pids || [] } });
        if (pidNamespaceId) filterParts.push({ pidNamespaceId });
        if (kindSlug) {
            const problemKind = parseProblemKindSlug(kindSlug);
            filterParts.push(
                problemKind === 'programming' ? { $or: [{ problemKind: 'programming' }, { problemKind: { $exists: false } }] } : { problemKind },
            );
        }
        const normalizedTag = tag.trim();
        if (normalizedTag) filterParts.push({ tag: normalizedTag });
        if (owner) filterParts.push({ owner });
        if (visibility === 'hidden') filterParts.push({ hidden: true });
        else if (visibility === 'published') filterParts.push({ hidden: { $ne: true } });
        if (lifecycle === 'active') filterParts.push({ archivedAt: { $exists: false } });
        else if (lifecycle === 'archived') filterParts.push({ archivedAt: { $exists: true } });
        if (managedReview === 'pending') {
            filterParts.push({ authoringMode: 'managed', hidden: true, 'managedAuthoring.metadataStatus': 'draft' });
        }
        this.queryContext.query = filterParts.length === 1 ? problemBankScope : { $and: filterParts };
        if (sortStrategy === 'recent') this.queryContext.hint = 'basic';
        // eslint-disable-next-line ts/no-shadow
        const query = this.queryContext.query;
        const psdict = {};
        const parsed = parser.parse(q, {
            keywords: ['category', 'difficulty', 'namespace'],
            offsets: false,
            alwaysArray: true,
            tokenize: true,
        });
        const category = parsed.category || [];
        const text = (parsed.text || []).join(' ');
        if (parsed.difficulty?.every((i) => Number.isSafeInteger(+i))) {
            query.difficulty = { $in: parsed.difficulty.flatMap((i) => (+i === 0 ? [0, undefined] : [+i])) };
        }
        if (category.length) {
            query.$and ||= [];
            query.$and.push(...category.map((categoryTag) => ({ tag: categoryTag })));
        }
        if (parsed.namespace?.length) {
            const mappedPrefix = this.domain.namespaces?.[parsed.namespace[0]];
            query.$and ||= [];
            if (mappedPrefix) query.$and.push({ sort: new RegExp(`^${mappedPrefix}-`) });
            else query.$and.push({ tag: parsed.namespace[0] });
        }
        if (text) category.push(text);
        if (category.length) this.UiContext.extraTitleContent = category.join(',');
        if (text) {
            query.$and ||= [];
            query.$and.push(buildProblemTextFilter(text));
            this.queryContext.hint = 'basic';
        }
        const sort = this.queryContext.sort;
        await this.ctx.parallel('problem/list', query, this, sort);
        const sortKey = (
            {
                default: { sort: 1, docId: 1 },
                recent: { docId: -1 },
                title: { title: 1, docId: 1 },
            } as const
        )[sortStrategy];
        let [pdocs, ppcount, pcount] = this.queryContext.fail
            ? [[], 0, 0]
            : await this.paginate(
                  problem
                      .getMulti(domainId, query, quick ? ['title', 'pid', 'domainId', 'docId'] : problem.PROJECTION_MANAGED_BANK)
                      .sort(sortKey)
                      .hint(this.queryContext.hint),
                  sort.length ? 1 : page,
                  limit,
              );
        if (sort.length) pdocs = pdocs.sort((a, b) => sort.indexOf(`${a.domainId}/${a.docId}`) - sort.indexOf(`${b.domainId}/${b.docId}`));
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            Object.assign(
                psdict,
                await problem.getListStatus(
                    domainId,
                    this.user._id,
                    pdocs.map((i) => i.docId),
                ),
            );
        }
        const ownerIds = quick ? [] : Array.from(new Set(pdocs.map((pdoc) => pdoc.owner)));
        const ownerDict = ownerIds.length ? await user.getList(domainId, ownerIds) : {};
        const ownerNames = Object.fromEntries(pdocs.map((pdoc) => [pdoc.owner, ownerDict[pdoc.owner]?.uname || `UID ${pdoc.owner}`]));
        const canManageByDocId = Object.fromEntries((quick ? [] : pdocs).map((pdoc) => [pdoc.docId, problem.canEditProblemContent(this.user, pdoc)]));
        const canArchiveByDocId = Object.fromEntries((quick ? [] : pdocs).map((pdoc) => [pdoc.docId, problem.canArchiveProblem(this.user, pdoc)]));
        const canCloneByDocId = Object.fromEntries((quick ? [] : pdocs).map((pdoc) => [pdoc.docId, problem.canCloneProblem(this.user, pdoc)]));
        const managedReviewableByDocId = Object.fromEntries(
            (quick ? [] : pdocs).map((pdoc) => {
                if (!isManagedPublicationCandidate(pdoc)) return [pdoc.docId, false];
                assertManagedPublicationRevision(pdoc);
                return [pdoc.docId, problem.canPublishProblem(this.user, pdoc)];
            }),
        );
        const canManageContributionsByDocId = Object.fromEntries(
            (quick ? [] : pdocs).map((pdoc) => [pdoc.docId, problem.canManageProblemContributions(this.user, pdoc)]),
        );
        const reviewablePids = (quick ? [] : pdocs).filter((pdoc) => managedReviewableByDocId[pdoc.docId]).map((pdoc) => pdoc.docId);
        const pendingContributionFacts = await pendingProblemContributionReviewFacts(domainId, reviewablePids);
        const managedTrainingOptions =
            !quick &&
            canReviewManaged &&
            pdocs.some((pdoc) => managedReviewableByDocId[pdoc.docId] && pdoc.managedAuthoring?.pendingTrainingPlacement)
                ? await listManagedTrainingOptions(domainId)
                : [];
        const pidNamespaces = quick ? [] : (await listPidNamespaces(domainId)).map(pidNamespaceClientOption);
        const contestOptions =
            quick || !contestAccessFilter
                ? []
                : await contest
                      .getMulti(domainId, contestAccessFilter)
                      .project({ docId: 1, title: 1, beginAt: 1 })
                      .sort({ beginAt: -1, docId: -1 })
                      .toArray();
        if (pjax) {
            this.response.body = {
                title: this.renderTitle(this.translate('problem_main')),
                fragments: (
                    await Promise.all([
                        this.renderHTML('partials/problem_list.html', {
                            page,
                            ppcount,
                            pcount,
                            pdocs,
                            psdict,
                            qs: q,
                            sort: sortStrategy,
                        }),
                        this.renderHTML('partials/problem_stat.html', { pcount, pcountRelation: this.queryContext.pcountRelation }),
                        this.renderHTML('partials/problem_lucky.html', { qs: q }),
                    ])
                ).map((i) => ({ html: i })),
            };
        } else {
            this.response.body = {
                page,
                pcount,
                ppcount,
                pcountRelation: this.queryContext.pcountRelation,
                pdocs,
                psdict,
                qs: q,
                sort: sortStrategy,
                filters: {
                    kind: kindSlug,
                    tag: normalizedTag,
                    owner: owner || '',
                    visibility,
                    lifecycle,
                    managedReview,
                    pidNamespaceId,
                    contest: contestId?.toHexString() || '',
                },
                contestOptions: contestOptions.map((tdoc) => ({
                    id: tdoc.docId.toHexString(),
                    title: tdoc.title,
                    beginAt: tdoc.beginAt,
                })),
                problemKinds: PROBLEM_KINDS.map((kind) => ({
                    kind,
                    slug: problemKindToSlug(kind),
                })),
                canFilterOwner: isBankAdmin,
                canReviewManaged,
                problemReviewUrl: canReviewManaged ? this.url('problem_review') : '',
                canManagePidNamespaces: canManageNamespaces,
                pidNamespaceUrl: canManageNamespaces ? this.url('problem_pid_namespace') : '',
                pidNamespaces,
                problemCreationCapabilities: {
                    canCreateAny: problem.canCreateManagedProgrammingDraft(this.user),
                    canImport: problem.canImportProblems(this.user),
                },
                ownerNames,
                canManageByDocId,
                canArchiveByDocId,
                canManageContributionsByDocId,
                canCloneByDocId,
                managedReviewableByDocId,
                pendingContributionsByDocId: pendingContributionFacts.rowsByDocId,
                pendingContributionFingerprintByDocId: pendingContributionFacts.fingerprintByDocId,
                contributionUdict: pendingContributionFacts.udict,
                managedSourceTemplates: MANAGED_SOURCE_TEMPLATES,
                managedTrainingOptions,
            };
        }
    }

    @param('pids', Types.NumericArray)
    @param('target', Types.String)
    @param('hidden', Types.Boolean)
    @param('redirect', Types.Boolean)
    @param('cloneLang', Types.Name, true)
    async postCopy(_domainId: string, pids: number[], target: string, hidden?: boolean, redirect = false, cloneLang?: string) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        let t = `,${this.domain.share || ''},`;
        if (t !== ',*,' && !t.includes(`,${target},`)) throw new ProblemNotAllowCopyError(this.domain._id, target);
        const ddoc = await domain.get(target);
        if (!ddoc) throw localizeError(new NotFoundError(target), 'Resource {0} not found.', target);
        const dudoc = await user.getById(target, this.user._id);
        if (!dudoc.hasPerm(PERM.PERM_CREATE_PROBLEM)) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        if (!pids.length) throw new ValidationError('pids');
        if (cloneLang) {
            if (pids.length !== 1) throw new ValidationError('cloneLang');
            if (!setting.langs[cloneLang] || setting.langs[cloneLang].disabled) {
                throw new ValidationError('cloneLang');
            }
        }
        await problem.assertProblemBankSelection(domainId, pids, this.user);
        const pdict = await problem.getList(domainId, pids, true, true, ['domainId', 'docId', 'reference', 'authoringMode'], true);
        const ids = [];
        for (const pid of pids) {
            let pdoc = pdict[pid];
            if (pdoc.authoringMode === 'managed') {
                await problem.refreshProblemAcl(this.user, pdoc.domainId);
                await assertProblemWriteCapability(this, pdoc, problem.canCloneProblem(this.user, pdoc), 'copy', 'clone');
            }
            if (pdoc.reference) {
                const [sourcePdoc, sourceDdoc] = await Promise.all([
                    problem.get(pdoc.reference.domainId, pdoc.reference.pid),
                    domain.get(pdoc.reference.domainId),
                ]);
                if (!sourcePdoc) throw new ProblemNotFoundError(pdoc.reference.domainId, pdoc.reference.pid);
                else pdoc = sourcePdoc;
                t = `,${sourceDdoc.share || ''},`;
                if (t !== ',*,' && !t.includes(`,${target},`)) throw new ProblemNotAllowCopyError(sourceDdoc._id, target);
            }
            if (pdoc.authoringMode === 'managed') {
                await problem.refreshProblemAcl(this.user, pdoc.domainId);
                await assertProblemWriteCapability(this, pdoc, problem.canCloneProblem(this.user, pdoc), 'copy', 'clone');
                ids.push(
                    await problem.withAuthorizedWriteClaim(
                        pdoc.domainId,
                        pdoc.docId,
                        this.user,
                        'copy',
                        (claim) =>
                            problem.copy(pdoc.domainId, pdoc.docId, target, undefined, hidden, cloneLang, {
                                actor: this.user._id,
                                claim,
                            }),
                        { capability: 'clone' },
                    ),
                );
            } else {
                ids.push(await problem.copy(pdoc.domainId, pdoc.docId, target, undefined, hidden, cloneLang, { actor: this.user._id }));
            }
        }
        if (redirect) this.response.redirect = this.url('problem_detail', { domainId: target, pid: ids[0] });
        else this.response.body = ids;
    }

    @param('pids', Types.NumericArray)
    async postDelete(_domainId: string, pids: number[]) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        let i = 0;
        for (const pid of pids) {
            const pdoc = await problem.get(domainId, pid);
            if (!pdoc) continue;
            await assertProblemWriteCapability(this, pdoc, problem.canDeleteProblem(this.user, pdoc), 'hard-delete', 'hard-delete');

            await problem.delAuthorized(domainId, pid, this.user);
            i++;
            this.progress('Deleting: ({0}/{1})', [i, pids.length]);
        }
        this.back();
    }

    @param('pids', Types.NumericArray)
    async postHide(_domainId: string, pids: number[]) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        for (const pid of pids) {
            const pdoc = await problem.get(domainId, pid);
            if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
            await assertProblemWriteCapability(this, pdoc, problem.canPublishProblem(this.user, pdoc), 'hide', 'publish');

            await problem.editAuthorized(domainId, pid, { hidden: true }, this.user);
        }
        this.back();
    }

    @param('pids', Types.NumericArray)
    async postUnhide(_domainId: string, pids: number[]) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        for (const pid of pids) {
            const pdoc = await problem.get(domainId, pid);
            if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
            if (pdoc.authoringMode === 'managed') {
                throw new ValidationError('hidden', null, localizedErrorText`托管草稿必须从统一题库审核入口发布`);
            }
            await assertProblemWriteCapability(this, pdoc, problem.canPublishProblem(this.user, pdoc), 'publish', 'publish');

            await problem.editAuthorized(domainId, pid, { hidden: false }, this.user);
        }
        this.back();
    }

    @param('pid', Types.UnsignedInt)
    @param('formalTitle', Types.Title)
    @param('difficulty', Types.UnsignedInt)
    @param('expectedStructureRevision', Types.PositiveInt)
    @param('finalHidden', Types.Boolean, true)
    @param('pendingContributionsConfirmed', Types.Boolean, true)
    @param('pendingContributionFingerprint', Types.String, true)
    async postManagedPublish(
        _domainId: string,
        pid: number,
        formalTitle: string,
        difficulty: number,
        expectedStructureRevision: number,
        finalHidden = false,
        pendingContributionsConfirmed = false,
        pendingContributionFingerprint = '',
    ) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (difficulty > 10) throw new ValidationError('difficulty');
        const result = await problem.publishManagedProgrammingProblem({
            domainId,
            docId: pid,
            formalTitle,
            difficulty,
            expectedStructureRevision,
            actor: this.user._id,
            user: this.user,
            finalHidden,
            pendingContributionsConfirmed,
            pendingContributionFingerprint,
        });
        if (result.state === 'committed_with_error') {
            const stageLabels: Record<(typeof result.incompleteStages)[number], string> = {
                'persistence-session-finalization': '数据库会话收尾',
                'publication-claim-finalization': '发布写入凭据收尾',
                'verifier-cleanup': '验题人权限清理',
                'edit-observers': '发布事件通知',
                'success-audit': '发布结果审计',
            };
            const stages = result.incompleteStages.map((stage) => stageLabels[stage]).join('、');
            this.response.status = 500;
            this.response.body = {
                error: {
                    name: 'ManagedPublicationFinalizationError',
                    message: `题目已经公开，但发布收尾未完成（${stages}）。请勿重复发布；刷新题目后按日志中的 requestId 处理。`,
                },
                publicationState: result.state,
                incompleteStages: result.incompleteStages,
                requestId: result.requestId,
                url: this.url('problem_detail', { pid: result.pdoc.pid || pid }),
            };
            return;
        }
        this.response.redirect = this.url('problem_review');
    }

    @param('pid', Types.UnsignedInt)
    @param('workingTitle', Types.Title)
    @param('difficulty', Types.UnsignedInt)
    @param('expectedStructureRevision', Types.PositiveInt)
    @param('knowledgeNodeIds', Types.CommaSeperatedArray, true)
    @param('returnNote', Types.Content, true)
    async postManagedReview(
        _domainId: string,
        pid: number,
        workingTitle: string,
        difficulty: number,
        expectedStructureRevision: number,
        knowledgeNodeIds: string[] = [],
        returnNote?: string,
    ) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (difficulty > 10) throw new ValidationError('difficulty');
        await problem.updateManagedProgrammingReview({
            domainId,
            docId: pid,
            workingTitle,
            difficulty,
            selectedMindmapNodeIds: knowledgeNodeIds,
            expectedStructureRevision,
            actor: this.user._id,
            user: this.user,
            returnNote,
        });
        this.response.redirect = this.url('problem_review');
    }

    @param('pid', Types.UnsignedInt)
    @param('targetPidNamespaceId', Types.String)
    @param('template', Types.String)
    @param('year', Types.String)
    @param('expectedStructureRevision', Types.PositiveInt)
    @param('season', Types.String, true)
    @param('level', Types.String, true)
    @param('round', Types.String, true)
    async postManagedNamespaceCorrect(
        _domainId: string,
        pid: number,
        targetPidNamespaceId: string,
        template: string,
        year: string,
        expectedStructureRevision: number,
        season = '',
        level = '',
        round = '',
    ) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const sourceMeta: Record<string, unknown> = { template, year };
        if (season) sourceMeta.season = season;
        if (level) sourceMeta.level = level;
        if (round) sourceMeta.round = round;
        const corrected = await problem.correctManagedProgrammingPidNamespace({
            domainId,
            docId: pid,
            targetPidNamespaceId,
            sourceMeta,
            expectedStructureRevision,
            actor: this.user._id,
            user: this.user,
        });
        this.response.redirect = this.url('problem_edit', { pid: corrected.pid || corrected.docId });
    }

    @param('pid', Types.PositiveInt)
    async postClone(_domainId: string, pid: number) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const pdoc = await problem.get(domainId, pid);
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        await assertProblemWriteCapability(this, pdoc, problem.canCloneProblem(this.user, pdoc), 'clone', 'clone');
        const cloneId = await problem.withAuthorizedWriteClaim(
            domainId,
            pid,
            this.user,
            'clone-revision',
            (claim) =>
                problem.copy(domainId, pid, domainId, undefined, true, undefined, {
                    owner: this.user._id,
                    actor: this.user._id,
                    claim,
                }),
            { capability: 'clone' },
        );
        this.response.redirect = this.url('problem_edit', { pid: cloneId });
    }

    @param('pid', Types.PositiveInt)
    @param('reason', Types.Content)
    async postArchive(_domainId: string, pid: number, reason: string) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const pdoc = await problem.get(domainId, pid);
        if (!pdoc) throw new ProblemNotFoundError(domainId, pid);
        await assertProblemWriteCapability(this, pdoc, problem.canArchiveProblem(this.user, pdoc), 'archive', 'archive');
        await problem.archiveProblem(domainId, pid, this.user._id, reason, this.user);
        this.back();
    }
}

export class ProblemReviewHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.Content, true)
    @param('limit', Types.PositiveInt, true)
    @param('status', Types.Range(['all', 'draft', 'confirmed']), true)
    async get(_domainId: string, page = 1, q = '', limit: number, status: 'all' | 'draft' | 'confirmed' = 'all') {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (!canReviewPidNamespaceProblems(this.user, domainId)) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);

        this.response.template = 'problem_review.html';
        if (!limit || limit > this.ctx.setting.get('pagination.problem') || page > 1) limit = this.ctx.setting.get('pagination.problem');
        const normalizedQuery = q.trim();
        const reviewStatus = status === 'all' ? { $in: ['draft', 'confirmed'] } : status;
        const filters: Filter<ProblemDoc>[] = [
            problem.buildProblemBankScope(this.user),
            {
                authoringMode: 'managed',
                hidden: true,
                archivedAt: { $exists: false },
                'managedAuthoring.metadataStatus': reviewStatus,
            },
        ];
        if (!problem.isProblemBankAdmin(this.user)) {
            filters.push({ pidNamespaceId: { $in: managedPidNamespaceIds(this.user, domainId) } });
        }
        if (normalizedQuery) filters.push(buildProblemTextFilter(normalizedQuery, false));
        const reviewQuery: Filter<ProblemDoc> = { $and: filters };
        const [pdocs, ppcount, pcount] = await this.paginate(
            problem.getMulti(domainId, reviewQuery, problem.PROJECTION_MANAGED_BANK).sort({ docId: 1 }),
            page,
            limit,
        );
        const pendingContributionFacts = await pendingProblemContributionReviewFacts(
            domainId,
            pdocs.map((pdoc) => pdoc.docId),
        );
        const authorLists = await Promise.all(pdocs.map((pdoc) => problemAuthorUsers(pdoc, undefined, 'review-queue-author-resolution')));
        const managedAuthorsByDocId = Object.fromEntries(
            pdocs.map((pdoc, index) => [
                pdoc.docId,
                authorLists[index].map((author) => ({
                    _id: author._id,
                    uname: author.uname,
                })),
            ]),
        );
        const managedTrainingOptions = pdocs.some((pdoc) => pdoc.managedAuthoring?.pendingTrainingPlacement)
            ? await listManagedTrainingOptions(domainId)
            : [];
        const [knowledgeMaps, knowledgeMindmapOptions] = await Promise.all([listKnowledgeMapsForProblemSelection(), listKnowledgeMindmapOptions()]);

        this.response.body = {
            page,
            ppcount,
            pcount,
            pdocs,
            qs: normalizedQuery,
            status,
            problemReviewUrl: this.url('problem_review'),
            managedAuthorsByDocId,
            pendingContributionsByDocId: pendingContributionFacts.rowsByDocId,
            pendingContributionFingerprintByDocId: pendingContributionFacts.fingerprintByDocId,
            contributionUdict: pendingContributionFacts.udict,
            managedSourceTemplates: MANAGED_SOURCE_TEMPLATES,
            managedTrainingOptions,
            knowledgeMaps,
            knowledgeMindmapOptions,
            pidNamespaces: (await listPidNamespaces(domainId)).map(pidNamespaceClientOption),
            canCorrectPidNamespaces: problem.isProblemBankAdmin(this.user),
            canManagePidNamespaces: canManagePidNamespaces(this.user, domainId),
            pidNamespaceUrl: canManagePidNamespaces(this.user, domainId) ? this.url('problem_pid_namespace') : '',
        };
    }
}

export class ProblemPidNamespaceHandler extends Handler {
    async get() {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (!canManagePidNamespaces(this.user, domainId)) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
        const pidNamespaces = await listManageablePidNamespaces(domainId, this.user);
        const namespaceIds = pidNamespaces.map((namespace) => namespace.namespaceId);
        const namespaceAudits = namespaceIds.length
            ? await oplog.coll
                  .find(
                      {
                          domainId,
                          namespaceId: { $in: namespaceIds },
                          type: { $in: [/^problem\.pid-namespace\./, 'problem.managed.publish'] },
                      } as any,
                      {
                          projection: {
                              type: 1,
                              operation: 1,
                              action: 1,
                              namespaceId: 1,
                              operator: 1,
                              problemId: 1,
                              result: 1,
                              requestId: 1,
                              time: 1,
                              completedAt: 1,
                          },
                      },
                  )
                  .sort({ time: -1, _id: -1 })
                  .limit(30)
                  .toArray()
            : [];
        const memberUids = [
            ...new Set([
                ...pidNamespaces.flatMap((namespace) => namespace.members.map((member) => member.uid)),
                ...namespaceAudits.map((entry: any) => entry.operator).filter((uid: unknown): uid is number => Number.isSafeInteger(uid)),
            ]),
        ];
        const memberUsers = memberUids.length ? await user.getList(domainId, memberUids) : {};
        this.response.template = 'problem_pid_namespace.html';
        this.response.body = {
            pidNamespaces,
            namespaceAudits,
            memberUsers,
            canAdministerPidNamespaces: problem.isProblemBankAdmin(this.user),
            pidNamespaceUrl: this.url('problem_pid_namespace'),
            problemReviewUrl: canReviewPidNamespaceProblems(this.user, domainId) ? this.url('problem_review') : '',
        };
    }

    @post('name', Types.String)
    @post('prefix', Types.String)
    @post('start', Types.PositiveInt)
    async postCreate(_domainId: string, name: string, prefix: string, start: number) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const namespace = await createCustomPidNamespace(
            domainId,
            { name, prefix, start },
            this.user,
            `pid-namespace-create:${domainId}:${this.user._id}:${nanoid()}`,
        );
        this.response.body = { ok: true, namespace };
    }

    @post('namespaceId', Types.String)
    @post('expectedRevision', Types.UnsignedInt)
    @post('name', Types.String)
    @post('enabled', Types.Boolean)
    @post('prefix', Types.String, true)
    @post('start', Types.PositiveInt, true)
    async postUpdateConfig(_domainId: string, namespaceId: string, expectedRevision: number, name: string, enabled: boolean, prefix = '', start = 0) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const namespace = await updatePidNamespaceConfig({
            domainId,
            namespaceId,
            expectedRevision,
            user: this.user,
            requestId: `pid-namespace-config:${domainId}:${namespaceId}:${this.user._id}:${nanoid()}`,
            name,
            enabled,
            ...(prefix ? { prefix } : {}),
            ...(start ? { start } : {}),
        });
        this.response.body = { ok: true, namespace };
    }

    @post('namespaceId', Types.String)
    @post('expectedRevision', Types.UnsignedInt)
    @post('targetUid', Types.PositiveInt)
    @post('role', Types.Range(['author', 'manager']))
    @post('editAll', Types.Boolean)
    async postSetMember(
        _domainId: string,
        namespaceId: string,
        expectedRevision: number,
        targetUid: number,
        role: 'author' | 'manager',
        editAll: boolean,
    ) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const target = await user.getById(domainId, targetUid);
        if (!target || target._id !== targetUid) throw new ValidationError('targetUid');
        const namespace = await setPidNamespaceMember({
            domainId,
            namespaceId,
            expectedRevision,
            targetUid,
            role,
            editAll,
            user: this.user,
            requestId: `pid-namespace-member-set:${domainId}:${namespaceId}:${targetUid}:${this.user._id}:${nanoid()}`,
        });
        this.response.body = { ok: true, namespace };
    }

    @post('namespaceId', Types.String)
    @post('expectedRevision', Types.UnsignedInt)
    @post('targetUid', Types.PositiveInt)
    async postRemoveMember(_domainId: string, namespaceId: string, expectedRevision: number, targetUid: number) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const namespace = await setPidNamespaceMember({
            domainId,
            namespaceId,
            expectedRevision,
            targetUid,
            role: null,
            editAll: false,
            user: this.user,
            requestId: `pid-namespace-member-remove:${domainId}:${namespaceId}:${targetUid}:${this.user._id}:${nanoid()}`,
        });
        this.response.body = { ok: true, namespace };
    }

    @post('namespaceId', Types.String)
    @post('expectedRevision', Types.UnsignedInt)
    async postDelete(_domainId: string, namespaceId: string, expectedRevision: number) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        await deleteCustomPidNamespace({
            domainId,
            namespaceId,
            expectedRevision,
            user: this.user,
            requestId: `pid-namespace-delete:${domainId}:${namespaceId}:${this.user._id}:${nanoid()}`,
        });
        this.response.body = { ok: true };
    }
}

export class ProblemRandomHandler extends Handler {
    @param('q', Types.Content, true)
    async get(_domainId: string, qs = '') {
        const domainId = String(this.domain?._id);
        if (!problem.canBrowseProblemBank(this.user)) {
            this.response.redirect = this.url('training_main');
            return;
        }
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (!problem.canBrowseProblemBank(this.user)) {
            this.response.redirect = this.url('training_main');
            return;
        }
        const category = flattenDeep(
            qs
                .split(' ')
                .filter((i) => i.startsWith('category:'))
                .map((i) => i.split('category:')[1]?.split(',')),
        );
        const q: Filter<ProblemDoc> = {
            $and: [problem.buildProblemBankScope(this.user), { archivedAt: { $exists: false } }],
        };
        if (category.length) {
            q.$and ||= [];
            q.$and.push(...category.map((tag) => ({ tag })));
        }
        await this.ctx.parallel('problem/list', q, this);
        const pid = await problem.random(domainId, q);
        if (!pid) throw new NoProblemError();
        this.response.body = { pid };
        this.response.redirect = this.url('problem_detail', { pid });
    }
}

export class ProblemDetailHandler extends ContestDetailBaseHandler {
    pdoc: ProblemDoc;
    udoc: User;
    psdoc: ProblemStatusDoc;
    protected canEditLoadedProblem = false;
    protected canSubmitLoadedProblem = false;
    protected virtualAttempt?: import('../model/virtual-contest').VirtualContestAttemptDoc;
    protected knowledgeNodeIdsForDetail: string[] = [];
    protected practicePageContext?: {
        controlled: boolean;
        bypassed: boolean;
        previewAvailable: boolean;
        entry: {
            containerKind: PracticeContainerKind;
            containerId: string;
            scopeKind: PracticeScopeKind;
            scopeId: number;
        };
        contextId?: string;
        expiresAt?: string;
        policy?: {
            prohibitExternalCodeInjection: boolean;
            removeIndependentSubmitForm: boolean;
            antiAiCopyInjection: boolean;
        };
        mode?: 'student' | 'preview';
        revisions?: Array<{
            containerKind: PracticeContainerKind;
            containerId: string;
            scopeKind: PracticeScopeKind;
            scopeId: number;
            revision: number;
        }>;
    };

    private async resolvePracticePageContext(
        containerKindRaw: string,
        containerId: ObjectId | undefined,
        scopeKindRaw: string,
        scopeId: number | undefined,
        preview: boolean,
    ) {
        const hasAnyRequestField = !!containerKindRaw || !!containerId || !!scopeKindRaw || scopeId !== undefined || preview;
        if (!hasAnyRequestField) return undefined;
        if (!containerKindRaw || !containerId || !scopeKindRaw || scopeId === undefined) {
            throw new ValidationError('practiceContext', null, localizedErrorText`真实性训练入口参数不完整，请返回课程或题集重新进入题目`);
        }
        if (this.tdoc) throw new ValidationError('practiceContext', null, localizedErrorText`比赛或 VP 题目不能使用真实性训练入口`);
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        if (containerKindRaw !== 'course' && containerKindRaw !== 'problemSet') {
            throw new ValidationError('practiceContainerKind', null, localizedErrorText`真实性训练容器类型无效`);
        }
        if (scopeKindRaw !== 'chapter' && scopeKindRaw !== 'stage') {
            throw new ValidationError('practiceScopeKind', null, localizedErrorText`真实性训练范围类型无效`);
        }
        const containerKind = containerKindRaw as PracticeContainerKind;
        const scopeKind = scopeKindRaw as PracticeScopeKind;
        const target = { containerKind, containerId, scopeKind, scopeId };
        let rejectionReason = 'context-access-denied';
        try {
            const prepared = await preparePracticeIssue({
                domainId: this.pdoc.domainId,
                user: this.user,
                handler: this,
                target,
                pid: this.pdoc.docId,
                mode: preview ? 'preview' : 'student',
                setRejectionReason: (reason) => {
                    rejectionReason = reason;
                },
            });
            const tdoc = prepared.primaryContainer;
            const canPreview = canPreviewPracticeIntegrity(this.user, this.pdoc, canManagePracticeContainer(this.user, tdoc, containerKind));
            rejectionReason = 'policy-read-failed';
            const published = await practiceIntegrityService.getLatestPublished(this.pdoc.domainId, containerKind, containerId);
            const extraPublished = prepared.extra
                ? await practiceIntegrityService.getLatestPublished(
                      this.pdoc.domainId,
                      prepared.extra.containerKind,
                      prepared.extra.containerId,
                  )
                : null;
            const entry = { containerKind, containerId: containerId.toHexString(), scopeKind, scopeId };
            const selected = selectPracticeIssueTargets({
                primary: target,
                extra: prepared.extra,
                primaryPublished: published,
                extraPublished,
            });
            if (!selected.controlled) return { controlled: false, bypassed: false, previewAvailable: false, entry };
            if (canPreview && !preview) {
                return { controlled: false, bypassed: true, previewAvailable: true, entry };
            }
            rejectionReason = 'context-issue-failed';
            const context = await practiceIntegrityService.issueContext({
                domainId: this.pdoc.domainId,
                uid: this.user._id,
                containerKind: selected.identity.containerKind,
                containerId: selected.identity.containerId,
                scopeKind: selected.identity.scopeKind,
                scopeId: selected.identity.scopeId,
                pid: this.pdoc.docId,
                mode: preview ? 'preview' : 'student',
                targets: selected.targets,
            });
            const contextId = context._id.toHexString();
            logger.info(
                'Practice problem entry issued domain=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d mode=%s revisions=%o stage=problem-entry result=success',
                this.pdoc.domainId,
                contextId,
                this.user._id,
                containerKind,
                containerId,
                scopeKind,
                scopeId,
                this.pdoc.docId,
                context.mode,
                context.revisions.map((revision) => `${revision.containerKind}:${revision.containerId.toHexString()}:${revision.revision}`),
            );
            return {
                controlled: true,
                bypassed: false,
                previewAvailable: canPreview,
                entry,
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
                'Practice problem entry rejected domain=%s uid=%d container=%s/%s scope=%s/%s pid=%d preview=%s reason=%s stage=problem-entry result=rejected',
                this.pdoc.domainId,
                this.user._id,
                containerKindRaw || 'invalid',
                containerId || 'invalid',
                scopeKindRaw || 'invalid',
                scopeId ?? 'invalid',
                this.pdoc.docId,
                preview,
                rejectionReason,
            );
            throw error;
        }
    }

    @route('pid', Types.ProblemId, true)
    @query('tid', Types.ObjectId, true)
    @query('practiceContainerKind', Types.String, true)
    @query('practiceContainerId', Types.ObjectId, true)
    @query('practiceScopeKind', Types.String, true)
    @query('practiceScopeId', Types.PositiveInt, true)
    @query('practicePreview', Types.Boolean, true)
    @query('virtual', Types.Boolean, true)
    async _prepare(
        _domainId: string,
        pid: number | string,
        tid?: ObjectId,
        practiceContainerKind = '',
        practiceContainerId?: ObjectId,
        practiceScopeKind = '',
        practiceScopeId?: number,
        practicePreview = false,
        virtual = false,
    ) {
        const domainId = String(this.domain?._id);
        this.pdoc = tid
            ? await problem.get(domainId, pid)
            : await problem.getViewableAuthorized(domainId, pid, this.user, [...problem.PROJECTION_PUBLIC, 'managedAuthoring']);
        if (!this.pdoc) throw new ProblemNotFoundError(domainId, pid);
        this.canSubmitLoadedProblem = tid ? this.user.hasPerm(PERM.PERM_SUBMIT_PROBLEM) : problem.canSubmitProblem(this.user, this.pdoc);
        const canManageContest =
            !!tid && (this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM));
        const canViewDirectly = !!tid && problem.canViewBy(this.pdoc, this.user);
        const postContestProblemMode = tid
            ? resolvePostContestProblemMode(this.tdoc, this.tsdoc, {
                  canManageContest,
                  canViewDirectly,
                  subjective: effectiveProblemKind(this.pdoc) === SUBJECTIVE_KIND,
              })
            : null;
        if (!tid) {
            this.canEditLoadedProblem = problem.canEditProblemContent(this.user, this.pdoc);
            this.knowledgeNodeIdsForDetail = resolveProblemKnowledgeNodeIds(this.pdoc, `problem ${domainId}/${this.pdoc.docId}`);
            // `managedAuthoring` is read only to evaluate the author draft
            // capability. Keep the internal workflow state out of hooks and
            // every public problem-detail response.
            delete this.pdoc.managedAuthoring;
        }
        if (tid) {
            if (virtual) {
                this.checkPriv(PRIV.PRIV_USER_PROFILE);
                const attempt = await virtualContestService.getOfficialAttempt(domainId, tid, this.user._id);
                if (!attempt) throw new ValidationError('virtual', null, localizedErrorText`虚拟参赛尚未开始`);
                this.virtualAttempt = await virtualContestService.assertActiveForUser(domainId, attempt._id, this.user._id, this.pdoc.docId);
            } else {
                if (!this.tdoc?.pids?.includes(this.pdoc.docId)) throw new ContestNotFoundError(domainId, tid);
                if (contest.isNotStarted(this.tdoc)) throw new ContestNotLiveError(tid);
                // Krypton: a privileged viewer (contest owner / editor / system admin)
                // who opened a problem from an external scoreboard hasn't "attended"
                // the live contest. Don't block them — let them view it (contest
                // "view" mode, no submit, since !attend). Ordinary contestants still
                // must attend before the contest ends.
                if (!canManageContest && !contest.isDone(this.tdoc, this.tsdoc) && (!this.tsdoc?.attend || !this.tsdoc.startAt)) {
                    throw new ContestNotAttendedError(tid);
                }
                if (postContestProblemMode === 'none') throw new ProblemNotFoundError(domainId, pid);
            }
            // Delete problem-related info in contest mode
            this.pdoc.tag.length = 0;
            delete this.pdoc.nAccept;
            delete this.pdoc.nSubmit;
            delete this.pdoc.difficulty;
            delete this.pdoc.stats;
            delete this.pdoc.origStat;
            delete this.pdoc.knowledgeMapId;
            delete this.pdoc.knowledgeNodeIds;
        }
        let ddoc = this.domain;
        if (this.pdoc.reference) {
            ddoc = await domain.get(this.pdoc.reference.domainId);
            const pdoc = await problem.get(this.pdoc.reference.domainId, this.pdoc.reference.pid);
            if (!ddoc || !pdoc) throw new ProblemNotFoundError(this.pdoc.reference.domainId, this.pdoc.reference.pid);
            this.pdoc.config = pdoc.config;
            this.pdoc.additional_file = pdoc.additional_file;
        }
        if (typeof this.pdoc.config !== 'string') {
            let baseLangs;
            const t = [];
            if (this.pdoc.config.langs) t.push(this.pdoc.config.langs);
            if (ddoc.langs) {
                t.push(
                    ddoc.langs
                        .split(',')
                        .map((i) => i.trim())
                        .filter((i) => i),
                );
            }
            if (this.domain.langs) {
                t.push(
                    this.domain.langs
                        .split(',')
                        .map((i) => i.trim())
                        .filter((i) => i),
                );
            }
            if (this.virtualAttempt?.snapshot.langs.length) t.push(this.virtualAttempt.snapshot.langs);
            else if (this.tdoc?.langs?.length) t.push(this.tdoc.langs);
            if (this.pdoc.config.type === 'remote_judge') {
                const p = this.pdoc.config.subType;
                const dl = Object.keys(setting.langs).filter((i) => i.startsWith(`${p}.`) || setting.langs[i].validAs[p]);
                if (setting.langs[p]) dl.push(p);
                baseLangs = dl;
            } else {
                const needHiddenLangs = flattenDeep(t).length;
                baseLangs = Object.keys(setting.langs).filter((i) =>
                    needHiddenLangs ? !setting.langs[i].remote : !setting.langs[i].remote && !setting.langs[i].hidden,
                );
            }
            this.pdoc.config.langs = ['objective', 'submit_answer'].includes(this.pdoc.config.type) ? ['_'] : intersection(baseLangs, ...t);
        }
        await this.ctx.parallel('problem/get', this.pdoc, this);
        if (this.virtualAttempt && (practiceContainerKind || practiceContainerId || practiceScopeKind || practiceScopeId)) {
            throw new ValidationError('virtual', null, localizedErrorText`比赛或 VP 提交不能使用真实性训练上下文`);
        }
        this.practicePageContext = this.virtualAttempt
            ? undefined
            : await this.resolvePracticePageContext(
                  practiceContainerKind,
                  practiceContainerId,
                  practiceScopeKind,
                  practiceScopeId,
                  practicePreview,
              );
        let knowledgeMapVisible = true;
        if (!tid && this.pdoc.knowledgeMapId && !problem.isProblemBankAdmin(this.user)) {
            const publicMaps = await listKnowledgeMapsForProblemSelection();
            knowledgeMapVisible = publicMaps.some((map) => map.id === String(this.pdoc.knowledgeMapId));
            if (!knowledgeMapVisible) {
                logger.warn(
                    'Hidden knowledge map redacted from problem detail domain=%s pid=%d map=%s actor=%d stage=detail result=redacted',
                    this.pdoc.domainId,
                    this.pdoc.docId,
                    this.pdoc.knowledgeMapId,
                    this.user._id,
                );
            }
        }
        [this.psdoc, this.udoc] = await Promise.all([
            problem.getStatus(this.pdoc.domainId, this.pdoc.docId, this.user._id),
            user.getById(this.pdoc.domainId, this.pdoc.owner),
        ]);
        const [scnt, dcnt, authorUdocs, dataContributorUdocs, knowledgeMapView] = await Promise.all([
            solution.count(this.pdoc.domainId, { parentId: this.pdoc.docId }),
            discussion.count(this.pdoc.domainId, { parentId: this.pdoc.docId }),
            tid ? Promise.resolve(this.udoc ? [this.udoc] : []) : problemAuthorUsers(this.pdoc, this.udoc),
            tid ? Promise.resolve([]) : problemDataContributorUsers(this.pdoc),
            !tid && this.pdoc.knowledgeMapId && knowledgeMapVisible
                ? materializeKnowledgeMindmapTags(this.knowledgeNodeIdsForDetail, {
                      knowledgeMapId: this.pdoc.knowledgeMapId,
                      requireMap: true,
                  }).then((knowledge) => ({
                      id: String(knowledge.mapId),
                      title: knowledge.mapTitle,
                      nodes: knowledge.nodePaths,
                  }))
                : Promise.resolve(null),
        ]);
        const responsePdoc: ProblemDoc & { programmingStatementView?: ReturnType<typeof programmingStatementClientView> } = { ...this.pdoc };
        delete responsePdoc.antiAiMarkers;
        if (responsePdoc.statementFormat === 'structured-v1') {
            try {
                const view = programmingStatementClientView(responsePdoc.programmingStatement, responsePdoc.config);
                if (compileProgrammingStatement(responsePdoc.programmingStatement) !== responsePdoc.content) {
                    throw new ValidationError('content', null, localizedErrorText`结构化题面投影不一致`);
                }
                responsePdoc.programmingStatementView = view;
                delete responsePdoc.programmingStatement;
            } catch (error) {
                logger.error(
                    'Programming statement render rejected domain=%s pid=%s docId=%d actor=%d statementFormat=%s revision=%s stage=detail-serialize result=denied error=%o',
                    this.pdoc.domainId,
                    this.pdoc.pid || '-',
                    this.pdoc.docId,
                    this.user._id,
                    this.pdoc.statementFormat,
                    this.pdoc.structureRevision ?? '-',
                    error,
                );
                throw error;
            }
        } else {
            delete responsePdoc.programmingStatement;
        }
        if (!knowledgeMapVisible) {
            delete responsePdoc.knowledgeMapId;
            delete responsePdoc.knowledgeNodeIds;
        }
        const postContestPracticeActive = !this.virtualAttempt && postContestProblemMode === 'correction';
        const personalPracticePsdoc = postContestPracticeActive
            ? buildPersonalPracticeStatusByPid(
                  await record
                      .getMulti(this.pdoc.domainId, buildPersonalPracticeRecordQuery(this.user._id, [this.pdoc.docId]))
                      .project<PersonalPracticeRecord>({
                          _id: 1,
                          pid: 1,
                          status: 1,
                          contest: 1,
                          contestTeamId: 1,
                          hackTarget: 1,
                          input: 1,
                      })
                      .toArray(),
                  [this.pdoc.docId],
                  this.tdoc.beginAt,
                  this.tdoc.endAt,
              )[this.pdoc.docId] || null
            : null;
        let mode = 'normal';
        if (this.virtualAttempt) mode = 'contest';
        else if (tid) {
            if (postContestProblemMode) mode = postContestProblemMode;
            else if (!this.tsdoc?.attend) mode = 'view';
            else if (!contest.isDone(this.tdoc)) mode = 'contest';
            else if (problem.canViewBy(this.pdoc, this.user)) mode = 'correction';
            else mode = 'none';
        }
        let antiAiMarkerView: Awaited<ReturnType<typeof problem.getAntiAiMarkerClientView>>;
        if (this.practicePageContext?.controlled && this.practicePageContext.policy?.antiAiCopyInjection) {
            try {
                antiAiMarkerView = await problem.getAntiAiMarkerClientView(this.pdoc.domainId, this.pdoc.docId, this.pdoc);
            } catch (error) {
                logger.error(
                    'Anti AI marker serialization rejected domain=%s pid=%d uid=%d stage=detail-serialize result=denied error=%o',
                    this.pdoc.domainId,
                    this.pdoc.docId,
                    this.user._id,
                    error,
                );
                throw new ValidationError('antiAiMarkers', null, localizedErrorText`防 AI 标记数据无效，请联系题目维护者`);
            }
        }
        this.response.body = {
            pdoc: responsePdoc,
            udoc: this.udoc,
            authorUdocs,
            dataContributorUdocs,
            knowledgeMapView,
            psdoc: !tid ? this.psdoc : personalPracticePsdoc,
            title: this.pdoc.title,
            solutionCount: scnt,
            discussionCount: dcnt,
            tdoc: this.tdoc,
            owner_udoc: tid && this.tdoc.owner !== this.pdoc.owner ? await user.getById(this.pdoc.domainId, this.tdoc.owner) : null,
            mode,
            postContestPracticeActive,
            ...(antiAiMarkerView ? { antiAiMarkerView } : {}),
            canPreviewSubjective: effectiveProblemKind(this.pdoc) === SUBJECTIVE_KIND && problem.canMaintainProblem(this.user, this.pdoc),
            canSubmitProblem: this.canSubmitLoadedProblem,
            canRejudgeProblem: !tid && !this.virtualAttempt && this.user.hasPerm(PERM.PERM_REJUDGE_PROBLEM),
            canEditProblem:
                this.canEditLoadedProblem ||
                problem.canEditProblemData(this.user, this.pdoc) ||
                problem.canEditProblemTags(this.user, this.pdoc) ||
                problem.canManageProblemContributions(this.user, this.pdoc),
            ...(this.practicePageContext ? { practiceIntegrity: this.practicePageContext } : {}),
            ...(this.virtualAttempt
                ? {
                      virtualContestActive: true,
                      virtualAttemptId: this.virtualAttempt._id,
                      virtualRemainingMs: Math.max(0, this.virtualAttempt.endAt.getTime() - Date.now()),
                      solutionCount: 0,
                      discussionCount: 0,
                  }
                : {}),
        };
        if (this.virtualAttempt) this.response.addHeader('Cache-Control', 'no-store');
        if (this.tdoc && this.tsdoc) {
            const fields = ['attend', 'startAt'];
            if (this.tdoc.duration) fields.push('endAt');
            if (contest.canShowSelfRecord.call(this, this.tdoc, true)) fields.push('detail');
            this.tsdoc = pick(this.tsdoc, fields);
            this.response.body.tsdoc = this.tsdoc;
        }
        this.response.template = 'problem_detail.html';
        this.UiContext.extraTitleContent = this.pdoc.title;
    }

    @query('tid', Types.ObjectId, true)
    @query('pjax', Types.Boolean)
    async get(...args: any[]) {
        // Navigate to current additional file download
        // e.g. ![img](file://a.jpg) will navigate to ![img](./pid/file/a.jpg)
        const rewriteFileUrls = (source: string) => {
            const replacements: AntiAiMarkerSourceReplacement[] = [];
            const content = source.replace(/file:\/\/([^ \n)\\"]+)/g, (str: string, fileinfo: string, offset: number) => {
                let filename = fileinfo.split('?')[0]; // remove querystring
                try {
                    filename = decodeURIComponent(filename);
                } catch (e) {}
                if (!this.pdoc.additional_file?.find((i) => i.name === filename)) return str;
                const replacement = !args[1]
                    ? `./${this.pdoc.docId}/file/${fileinfo}`
                    : `./${this.pdoc.docId}/file/${fileinfo}${fileinfo.includes('?') ? '&' : '?'}tid=${args[1]}`;
                replacements.push({ start: offset, end: offset + str.length, replacementLength: replacement.length });
                return replacement;
            });
            return { content, replacements };
        };
        if (!this.request.json || args[2]) {
            this.response.body.pdoc.content = rewriteFileUrls(this.response.body.pdoc.content).content;
        }
        const statementView = this.response.body.pdoc.programmingStatementView;
        if (statementView) {
            for (const section of ['background', 'description', 'input', 'output', 'hints']) {
                if (statementView[section]?.content) statementView[section].content = rewriteFileUrls(statementView[section].content).content;
            }
            for (const item of statementView.examples?.items || []) {
                if (item.note) item.note = rewriteFileUrls(item.note).content;
            }
        }
        const antiAiMarkerView = this.response.body.antiAiMarkerView;
        if (antiAiMarkerView) {
            try {
                const sources = statementSourcesForAntiAiMarkers(this.pdoc);
                const replacementsByPath = new Map<string, AntiAiMarkerSourceReplacement[]>();
                for (const marker of antiAiMarkerView.markers) {
                    let replacements = replacementsByPath.get(marker.path);
                    if (!replacements) {
                        const source = sources.get(marker.path);
                        if (source === undefined) throw new TypeError(`anti AI marker source is unavailable: ${marker.id}`);
                        replacements = rewriteFileUrls(source).replacements;
                        replacementsByPath.set(marker.path, replacements);
                    }
                    marker.offset = remapAntiAiMarkerOffset(marker.offset, replacements);
                }
            } catch (error) {
                logger.error(
                    'Anti AI marker attachment remap rejected domain=%s pid=%d uid=%d stage=detail-attachment-remap result=denied error=%o',
                    this.pdoc.domainId,
                    this.pdoc.docId,
                    this.user._id,
                    error,
                );
                throw new ValidationError('antiAiMarkers', null, localizedErrorText`防 AI 标记数据无效，请联系题目维护者`);
            }
        }
        this.response.body.page_name = this.tdoc
            ? this.tdoc.rule === 'homework'
                ? 'homework_detail_problem'
                : 'contest_detail_problem'
            : 'problem_detail';
        if (args[2]) {
            const data = { pdoc: this.response.body.pdoc, tdoc: this.tdoc };
            this.response.body = {
                title: this.renderTitle(this.response.body.page_name),
                fragments: [{ html: await this.renderHTML('partials/problem_description.html', data) }],
                raw: data,
            };
        }
        if (!this.response.body.tdoc) {
            if (this.psdoc?.rid) {
                this.response.body.rdoc = await record.get(this.pdoc.domainId, this.psdoc.rid);
            }
            [this.response.body.ctdocs, this.response.body.htdocs] = (
                await Promise.all([
                    contest.getRelated(this.pdoc.domainId, this.pdoc.docId),
                    contest.getRelated(this.pdoc.domainId, this.pdoc.docId, 'homework'),
                ])
            ).map((tdocs) =>
                tdocs.filter(
                    (tdoc) =>
                        this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST) ||
                        !tdoc.assign?.length ||
                        new Set(tdoc.assign).intersection(new Set(this.user.group)).size,
                ),
            );
        }
    }

    async postRejudge() {
        const domainId = this.pdoc.domainId;
        this.checkPerm(PERM.PERM_REJUDGE_PROBLEM);
        if (this.tdoc) {
            logger.warn(
                'Whole-problem rejudge rejected domain=%s contest=%s pid=%d actor=%d stage=context-gate result=denied',
                domainId,
                this.tdoc.docId,
                this.pdoc.docId,
                this.user._id,
            );
            throw new ValidationError('tid', null, localizedErrorText`整题重测仅支持从题目详情页执行`);
        }
        if (!this.pdoc.config || typeof this.pdoc.config === 'string') throw new ProblemConfigError();
        const rdocs = await record
            .getMulti(domainId, {
                pid: this.pdoc.docId,
                contest: { $nin: [record.RECORD_GENERATE, record.RECORD_PRETEST] },
                virtualAttemptId: { $exists: false },
                status: { $ne: STATUS.STATUS_CANCELED },
                'files.hack': { $exists: false },
                manualPending: { $ne: true },
                manualGrade: { $exists: false },
            })
            .project({ _id: 1, contest: 1 })
            .toArray();
        if (rdocs.length) {
            const priority = await record.submissionPriority(this.user._id, -10000 - rdocs.length * 5 - 50);
            await record.reset(
                domainId,
                rdocs.map((rdoc) => rdoc._id),
                true,
            );
            await Promise.all([
                record.judge(
                    domainId,
                    rdocs.filter((i) => i.contest).map((i) => i._id),
                    priority,
                    { detail: false },
                    { rejudge: true },
                ),
                record.judge(
                    domainId,
                    rdocs.filter((i) => !i.contest).map((i) => i._id),
                    priority,
                    {},
                    { rejudge: true },
                ),
            ]);
        }
        logger.info(
            'Whole-problem rejudge queued domain=%s pid=%d actor=%d count=%d result=success',
            domainId,
            this.pdoc.docId,
            this.user._id,
            rdocs.length,
        );
        await oplog.log(this, 'problem.rejudge.all', {
            pid: this.pdoc.docId,
            count: rdocs.length,
            result: 'success',
        });
        this.back({ ok: true, rejudged: rdocs.length });
    }

    async postDelete() {
        await assertProblemWriteCapability(this, this.pdoc, problem.canDeleteProblem(this.user, this.pdoc), 'hard-delete', 'hard-delete');
        const tdocs = await contest.getRelated(this.pdoc.domainId, this.pdoc.docId);
        if (tdocs.length) throw new ProblemAlreadyUsedByContestError(this.pdoc.docId, tdocs[0]._id);
        await problem.delAuthorized(this.pdoc.domainId, this.pdoc.docId, this.user);
        this.response.redirect = this.url('problem_main');
    }

    @param('star', Types.Boolean)
    async postStar(_domainId: string, star: boolean) {
        await problem.setStar(this.pdoc.domainId, this.pdoc.docId, this.user._id, star);
        this.back({ star });
    }
}

export class ProblemSubmitHandler extends ProblemDetailHandler {
    private assertContestSubmissionContext(tid?: ObjectId) {
        if (!tid) return;
        if (
            !this.tdoc ||
            String(this.tdoc.docId) !== String(tid) ||
            (!this.virtualAttempt && (!Array.isArray(this.tdoc.pids) || !this.tdoc.pids.includes(this.pdoc.docId)))
        ) {
            throw new ContestNotFoundError(this.pdoc.domainId, tid);
        }
    }

    private rejectPracticeContext(error: unknown): never {
        if (!(error instanceof PracticeIntegrityContextError)) throw error;
        if (error.reason === 'expired') {
            throw new ValidationError('practiceContextId', null, localizedErrorText`真实性训练上下文已过期，请返回课程或题集重新进入题目`);
        }
        if (error.reason === 'identity_mismatch' || error.reason === 'scope_container_mismatch') {
            throw new ValidationError('practiceContextId', null, localizedErrorText`真实性训练上下文与当前提交不匹配`);
        }
        throw new ValidationError('practiceContextId', null, localizedErrorText`真实性训练上下文无效，请返回课程或题集重新进入题目`);
    }

    private async resolvePracticeContext(practiceContextId: string, tid?: ObjectId): Promise<TrustedPracticeContextReference | undefined> {
        if (!practiceContextId) return undefined;
        if (tid || this.tdoc) throw new ValidationError('practiceContextId', null, localizedErrorText`比赛或 VP 提交不能使用真实性训练上下文`);
        const domainId = this.pdoc.domainId;
        const canonicalContextId = /^[0-9a-f]{24}$/i.test(practiceContextId) ? practiceContextId.toLowerCase() : 'invalid';
        let rejectionReason = canonicalContextId === 'invalid' ? 'invalid-context-id' : 'context-read-failed';
        try {
            if (canonicalContextId === 'invalid') throw new PracticeIntegrityContextError('invalid_context_id');
            const context = await practiceIntegrityService.assertSubmissionContext({
                contextId: canonicalContextId,
                domainId,
                uid: this.user._id,
                pid: this.pdoc.docId,
            });
            await assertPracticeContextAccess({
                domainId,
                user: this.user,
                handler: this,
                targets: context.revisions,
                pid: this.pdoc.docId,
                mode: context.mode,
                setRejectionReason: (reason) => {
                    rejectionReason = reason;
                },
            });
            const reference = trustedPracticeContextReference(context);
            logger.info(
                'Practice context accepted for submission domain=%s contextId=%s uid=%d container=%s/%s scope=%s/%d pid=%d revisions=%o stage=submit-gate result=success',
                domainId,
                reference.contextId,
                this.user._id,
                reference.containerKind,
                reference.containerId,
                reference.scopeKind,
                reference.scopeId,
                this.pdoc.docId,
                reference.targets.map((target) => `${target.containerKind}:${target.containerId}:${target.revision}`),
            );
            return reference;
        } catch (error) {
            const reason = error instanceof PracticeIntegrityContextError ? error.reason : rejectionReason;
            logger.warn(
                'Practice context rejected for submission domain=%s contextId=%s uid=%d pid=%d stage=submit-gate reason=%s result=rejected',
                domainId,
                canonicalContextId,
                this.user._id,
                this.pdoc.docId,
                reason,
            );
            this.rejectPracticeContext(error);
        }
    }

    @param('tid', Types.ObjectId, true)
    async prepare(_domainId: string, tid?: ObjectId) {
        if (!this.canSubmitLoadedProblem) {
            logger.warn(
                'Problem submit rejected domain=%s container=%s pid=%d actor=%d stage=submit-prepare result=denied',
                this.pdoc.domainId,
                tid || '-',
                this.pdoc.docId,
                this.user._id,
            );
            throw new PermissionError(PERM.PERM_SUBMIT_PROBLEM);
        }
        this.assertContestSubmissionContext(tid);
        if (this.virtualAttempt) {
            await virtualContestService.assertActiveForUser(this.pdoc.domainId, this.virtualAttempt._id, this.user._id, this.pdoc.docId);
        } else {
            const postContestPractice =
                !!tid && effectiveProblemKind(this.pdoc) !== SUBJECTIVE_KIND && canUsePostContestPractice(this.tdoc, this.tsdoc);
            if (tid && !postContestPractice && !contest.isOngoing(this.tdoc, this.tsdoc)) throw new ContestNotLiveError(this.tdoc.docId);
        }
        if (effectiveProblemKind(this.pdoc) === SUBJECTIVE_KIND && (!tid || !this.tdoc || !['exam', 'homework', 'oi'].includes(this.tdoc.rule))) {
            throw new ValidationError('rule', null, localizedErrorText`主观题仅允许在 exam、homework 或 oi 容器中提交`);
        }
        if (typeof this.pdoc.config === 'string') throw new ProblemConfigError();
        if (this.pdoc.config.langs && !this.pdoc.config.langs.length) throw new ProblemConfigError();
        const kind = effectiveProblemKind(this.pdoc);
        if (['program_fill', 'function'].includes(kind)) {
            try {
                const rawPdoc = await problem.get(this.pdoc.domainId, this.pdoc.docId, undefined, true);
                if (!rawPdoc) throw new ProblemNotFoundError(this.pdoc.domainId, this.pdoc.docId);
                problem.assertProblemReadyForUse(rawPdoc, { actor: this.user._id, stage: 'submit-prepare' });
            } catch (error) {
                logger.error(
                    'Structured submit prepare rejected domain=%s container=%s pid=%d kind=%s revision=%s uid=%d error=%o',
                    this.pdoc.domainId,
                    tid || '-',
                    this.pdoc.docId,
                    kind,
                    this.pdoc.structureRevision,
                    this.user._id,
                    error,
                );
                throw new ProblemConfigError();
            }
        }
    }

    async get() {
        const problemKind = effectiveProblemKind(this.pdoc);
        const structuredIde = ['program_fill', 'function'].includes(problemKind);
        if (this.practicePageContext?.controlled && this.practicePageContext.policy?.removeIndependentSubmitForm && !structuredIde) {
            logger.warn(
                'Independent submit page rejected domain=%s contextId=%s uid=%d pid=%d stage=submit-page reason=ide-only result=rejected',
                this.pdoc.domainId,
                this.practicePageContext.contextId,
                this.user._id,
                this.pdoc.docId,
            );
            throw new ValidationError('practiceContext', null, localizedErrorText`当前真实性训练只能使用题面内的 Krypton IDE 提交`);
        }
        this.response.template = 'problem_submit.html';
        if (this.practicePageContext) this.response.body.practiceIntegrity = this.practicePageContext;
        const langRange =
            typeof this.pdoc.config === 'object' && this.pdoc.config.langs
                ? Object.fromEntries(this.pdoc.config.langs.map((i) => [i, setting.langs[i]?.display || i]))
                : setting.SETTINGS_BY_KEY.codeLang.range;
        this.response.body.langRange = langRange;
        this.response.body.page_name = this.tdoc
            ? this.tdoc.rule === 'homework'
                ? 'homework_detail_problem_submit'
                : 'contest_detail_problem_submit'
            : 'problem_submit';
        if (this.virtualAttempt) this.response.body.virtualContestActive = true;
    }

    @param('lang', Types.Name)
    @param('code', Types.String, true)
    @param('pretest', Types.Boolean)
    @param('input', Types.ArrayOf(Types.String, true), true)
    @param('tid', Types.ObjectId, true)
    @param('practiceContextId', Types.ShortString, true)
    async post(_domainId: string, lang: string, code: string, pretest = false, input: string[] = [], tid?: ObjectId, practiceContextId = '') {
        this.assertContestSubmissionContext(tid);
        const domainId = this.pdoc.domainId;
        const config = this.pdoc.config;
        const isSubjective = effectiveProblemKind(this.pdoc) === SUBJECTIVE_KIND;
        const problemKind = effectiveProblemKind(this.pdoc);
        if (this.virtualAttempt) {
            await virtualContestService.assertActiveForUser(domainId, this.virtualAttempt._id, this.user._id, this.pdoc.docId);
        }
        const submissionScope = this.virtualAttempt
            ? { postContestPractice: false, recordContestId: undefined, virtualAttemptId: this.virtualAttempt._id, sourceContestId: this.virtualAttempt.sourceContestId }
            : tid
              ? getContestSubmissionScope(this.tdoc, this.tsdoc, tid)
              : { postContestPractice: false, recordContestId: undefined };
        if (!this.virtualAttempt && tid && !submissionScope.postContestPractice && !contest.isOngoing(this.tdoc, this.tsdoc)) {
            throw new ContestNotLiveError(this.tdoc.docId);
        }
        if (isSubjective && submissionScope.postContestPractice) throw new ContestNotLiveError(this.tdoc.docId);
        if (isSubjective && (pretest || !tid || !this.tdoc || !['exam', 'homework', 'oi'].includes(this.tdoc.rule))) {
            throw new ValidationError('rule', null, localizedErrorText`主观题仅允许在 exam、homework 或 oi 容器中提交`);
        }
        if (typeof config === 'string' || config === null) throw new ProblemConfigError();
        const structuredCode = ['program_fill', 'function'].includes(config.type) && ['program_fill', 'function'].includes(problemKind);
        if (structuredCode) lang = config.type === 'program_fill' && config.mode === 'text' ? '_' : config.template?.lang || '';
        if (['submit_answer', 'objective'].includes(config.type) || (config.type === 'program_fill' && config.mode === 'text')) {
            lang = '_';
        } else if ((config.langs && !config.langs.includes(lang)) || !setting.langs[lang] || setting.langs[lang].disabled) {
            throw new ProblemNotAllowLanguageError();
        }
        if (pretest) {
            const supportsStructuredPretest = structuredCode && (config.type !== 'program_fill' || config.mode !== 'text');
            if (!structuredCode && setting.langs[lang]?.pretest) lang = setting.langs[lang].pretest as string;
            if (!supportsStructuredPretest && !['default', 'remote_judge'].includes(config.type)) {
                throw new ProblemNotAllowPretestError('type');
            }
            if (!input.length) throw new ValidationError('input');
            input = input.map((i) => i || '');
        }
        await this.limitRate('add_record', 60, system.get('limit.submission_user'), '{{user}}');
        await this.limitRate('add_record', 60, pretest ? system.get('limit.pretest') : system.get('limit.submission'));
        const files: Record<string, string> = {};
        const lengthLimit = system.get('limit.codelength') || 128 * 1024;
        if (!code) {
            const file = this.request.files?.file;
            if (!file || file.size === 0) throw new ValidationError('code');
            const sizeLimit = config.type === 'submit_answer' ? 128 * 1024 * 1024 : lengthLimit;
            if (file.size > sizeLimit) throw new FileTooLargeError('file');
            const shouldReadFile = () => {
                if (config.type === 'objective') return true;
                if (lang === '_') return false;
                return file.size < lengthLimit && !file.filepath.endsWith('.zip') && !setting.langs[lang].isBinary;
            };
            if (shouldReadFile()) code = await readFile(file.filepath, 'utf-8');
            else {
                const id = nanoid();
                await storage.put(`submission/${this.user._id}/${id}`, file.filepath, this.user._id);
                files.code = `${this.user._id}/${id}#${file.originalFilename}`;
            }
        } else {
            if (!isSubjective) code = code.replace(/\r\n/g, '\n');
            if (code.length > lengthLimit) throw new ValidationError('code');
        }
        if (structuredCode) {
            try {
                const structuredKind = problemKind === 'program_fill' ? 'program_fill' : 'function';
                parseStructuredRegionSubmission(structuredKind, config.template, code);
            } catch (error: any) {
                logger.error(
                    'Structured submission rejected domain=%s container=%s pid=%d kind=%s revision=%s uid=%d error=%o',
                    domainId,
                    tid || '-',
                    this.pdoc.docId,
                    problemKind,
                    this.pdoc.structureRevision,
                    this.user._id,
                    error,
                );
                const localizedDetail = getProblemConfigErrorText(error);
                if (localizedDetail) throw localizedConfigValidation('code', localizedDetail);
                throw localizeErrorParameter(
                    new ValidationError('code', null, error.message),
                    2,
                    'The structured answer is invalid: {0}',
                    error.message,
                );
            }
        }
        const practiceContext = await this.resolvePracticeContext(practiceContextId, tid || this.virtualAttempt?.sourceContestId);
        if (this.virtualAttempt && (isSubjective || practiceContext)) {
            throw new ValidationError('virtual', null, localizedErrorText`比赛或 VP 提交不能使用真实性训练上下文`);
        }
        if (this.virtualAttempt && !pretest) {
            await virtualContestService.markFirstRecord({
                domainId,
                attemptId: this.virtualAttempt._id,
                uid: this.user._id,
                pid: this.pdoc.docId,
            });
        }
        const rid = await record.add(
            domainId,
            this.pdoc.docId,
            this.user._id,
            lang,
            code,
            true,
            pretest
                ? {
                      input,
                      type: 'pretest',
                      contestContext: submissionScope.recordContestId,
                      vigilSessionKey: (global as any).Hydro?.model?.vigilguard?.clientSessionKeyFromSession?.(this.session),
                  }
                : {
                      contest: submissionScope.recordContestId,
                      files,
                      type: isSubjective ? 'manual' : 'judge',
                      practiceContext,
                      virtualAttemptId: this.virtualAttempt?._id,
                      sourceContestId: this.virtualAttempt?.sourceContestId,
                      vigilSessionKey: (global as any).Hydro?.model?.vigilguard?.clientSessionKeyFromSession?.(this.session),
                  },
        );
        if (submissionScope.postContestPractice) {
            logger.info(
                'Post-contest practice record created domain=%s contest=%s pid=%d uid=%d rid=%s pretest=%s stage=record-created',
                domainId,
                tid,
                this.pdoc.docId,
                this.user._id,
                rid,
                pretest,
            );
        }
        if (!pretest) {
            const updates: Promise<unknown>[] = [
                problem.inc(domainId, this.pdoc.docId, 'nSubmit', 1),
                domain.incUserInDomain(domainId, this.user._id, 'nSubmit'),
            ];
            if (isSubjective) {
                updates.push(
                    markManualPending({
                        domainId,
                        tid: submissionScope.recordContestId,
                        pid: this.pdoc.docId,
                        uid: this.user._id,
                        rid,
                    }),
                );
            } else if (this.virtualAttempt) {
                updates.push(
                    virtualContestService.updateStatus({
                        domainId,
                        attemptId: this.virtualAttempt._id,
                        uid: this.user._id,
                        rid,
                        pid: this.pdoc.docId,
                        result: { status: STATUS.STATUS_WAITING, score: 0 },
                    }),
                );
            } else if (submissionScope.recordContestId) {
                updates.push(contest.updateStatus(domainId, submissionScope.recordContestId, this.user._id, rid, this.pdoc.docId));
            }
            await Promise.all(updates);
        }
        if (submissionScope.recordContestId && !pretest && !contest.canShowSelfRecord.call(this, this.tdoc)) {
            this.response.body = { tid: submissionScope.recordContestId };
            this.response.redirect = this.url(this.tdoc.rule === 'homework' ? 'homework_detail' : 'contest_problemlist', {
                tid: submissionScope.recordContestId,
            });
        } else {
            this.response.body = { rid };
            this.response.redirect = this.url('record_detail', {
                rid,
                query: this.virtualAttempt
                    ? { tid, virtual: 1 }
                    : submissionScope.postContestPractice
                      ? { tid, practice: 1 }
                      : undefined,
            });
        }
    }
}

export class ProblemHackHandler extends ProblemDetailHandler {
    rdoc: RecordDoc;

    @param('rid', Types.ObjectId)
    @param('tid', Types.ObjectId, true)
    async prepare(_domainId: string, rid: ObjectId, tid?: ObjectId) {
        const domainId = this.pdoc.domainId;
        if (typeof this.pdoc.config !== 'object' || !this.pdoc.config.hackable) {
            throw new HackFailedError(localizedErrorText`This problem is not hackable.`);
        }
        this.rdoc = await record.get(domainId, rid);
        if (!this.rdoc || this.rdoc.pid !== this.pdoc.docId || this.rdoc.contest?.toString() !== tid?.toString()) {
            throw localizeError(new RecordNotFoundError(domainId, rid), 'Record {0} not found.', rid);
        }
        if (this.rdoc.virtualAttemptId) throw new HackFailedError(localizedErrorText`虚拟参赛记录不能被 hack`);
        if (tid) {
            if (this.tdoc.rule !== 'codeforces') throw new HackFailedError(localizedErrorText`This contest is not hackable.`);
            if (!contest.isOngoing(this.tdoc, this.tsdoc)) throw new ContestNotLiveError(this.tdoc.docId);
        }
        if (this.rdoc.uid === this.user._id) throw new HackFailedError(localizedErrorText`You cannot hack your own submission`);
        if (this.psdoc?.status !== STATUS.STATUS_ACCEPTED) {
            throw new HackFailedError(localizedErrorText`You must accept this problem before hacking.`);
        }
        if (this.rdoc.status !== STATUS.STATUS_ACCEPTED) {
            throw new HackFailedError(localizedErrorText`You cannot hack a unsuccessful submission.`);
        }
    }

    async get() {
        this.response.template = 'problem_hack.html';
        this.response.body = {
            pdoc: this.pdoc,
            udoc: this.udoc,
            rid: this.rdoc._id,
            title: this.pdoc.title,
            page_name: this.tdoc ? 'contest_detail_problem_hack' : 'problem_hack',
        };
    }

    @param('input', Types.String, true)
    @param('autoOrganizeInput', Types.Boolean, true)
    @param('tid', Types.ObjectId, true)
    async post(_domainId: string, input = '', autoOrganizeInput = false, tid?: ObjectId) {
        const domainId = this.pdoc.domainId;
        await this.limitRate('add_record', 60, system.get('limit.submission_user'), '{{user}}');
        await this.limitRate('add_record', 60, system.get('limit.submission'));
        const id = `${this.user._id}/${nanoid()}`;
        if (this.request.files?.file?.size > 0) {
            const file = this.request.files.file;
            if (!file || file.size > 2 * 1024 * 1024) throw new ValidationError('input');
            await storage.put(`submission/${id}`, file.filepath, this.user._id);
        } else if (input) {
            if (autoOrganizeInput) input = input.replace(/\s+\n/g, '\n').replace(/\s+ /g, ' ');
            await storage.put(`submission/${id}`, Buffer.from(input), this.user._id);
        }
        const rid = await record.add(domainId, this.pdoc.docId, this.user._id, this.rdoc.lang, this.rdoc.code, true, {
            contest: tid,
            type: 'hack',
            hackTarget: this.rdoc._id,
            files: { hack: `${id}#input.txt` },
            vigilSessionKey: (global as any).Hydro?.model?.vigilguard?.clientSessionKeyFromSession?.(this.session),
        });
        this.response.body = { rid };
        this.response.redirect = this.url('record_detail', { rid });
    }
}

export class ProblemManageHandler extends ProblemDetailHandler {
    async prepare() {
        const capability = this.canEditLoadedProblem
            ? 'content'
            : problem.canEditProblemData(this.user, this.pdoc)
              ? 'data'
              : problem.canEditProblemTags(this.user, this.pdoc)
                ? 'tag'
                : problem.canManageProblemContributions(this.user, this.pdoc)
                  ? 'contributions'
                  : null;
        if (!capability) throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
        this.pdoc = await requireStableCapabilityProblem(
            this.user,
            this.pdoc,
            capability,
            problemWorkspaceProjection(capability, problem.canEditProblemTags(this.user, this.pdoc)),
        );
        this.canEditLoadedProblem = problem.canEditProblemContent(this.user, this.pdoc);
        // `_prepare` may have loaded the statement through a contest `tid`.
        // That container access never upgrades the response to editor data.
        if (this.response.body) {
            this.response.body.pdoc = this.pdoc;
            this.response.body.problemAuthoringCapabilities = problemAuthoringCapabilities(this.user, this.pdoc);
            this.response.body.canEditProblem = this.canEditLoadedProblem;
            this.response.body.canDeleteProblem = problem.canDeleteProblem(this.user, this.pdoc);
        }
    }
}

export class ProblemEditHandler extends ProblemManageHandler {
    async get() {
        const capabilities = problemAuthoringCapabilities(this.user, this.pdoc);
        if (capabilities.canEditData) {
            this.response.body.testdata = sortFiles(this.pdoc.data || []);
            this.response.body.additional_file = sortFiles(this.pdoc.additional_file || []);
        }
        if (capabilities.canEditContent) {
            this.response.body.statementLangs = this.ctx.i18n.langs(false);
            this.response.body.statementWriteGuard = await dataWriteGuardState(this, this.pdoc, this.user, 'statement');
        }
        const problemKind = effectiveProblemKind(this.pdoc);
        if (problemKind === 'programming') {
            const canReviewManaged = this.pdoc.authoringMode === 'managed' && capabilities.canPublish;
            const canLoadManagedWorkflow = this.pdoc.authoringMode === 'managed' && (capabilities.canEditContent || canReviewManaged);
            const [
                knowledgeMaps,
                programmingMindmapOptions,
                managedTrainingOptions,
                managedTrainingPlacements,
                managedReviewPreview,
                pendingContributionFacts,
            ] = await Promise.all([
                capabilities.canEditTags ? listKnowledgeMapsForProblemSelection() : Promise.resolve([]),
                capabilities.canEditTags ? listKnowledgeMindmapOptions() : Promise.resolve([]),
                canLoadManagedWorkflow ? listManagedTrainingOptions(this.pdoc.domainId) : Promise.resolve([]),
                canLoadManagedWorkflow ? listManagedProblemTrainingPlacements(this.pdoc.domainId, this.pdoc.docId) : Promise.resolve([]),
                canReviewManaged ? managedProblemReviewPreview(this.pdoc) : Promise.resolve(undefined),
                canReviewManaged ? pendingProblemContributionReviewFacts(this.pdoc.domainId, [this.pdoc.docId]) : Promise.resolve(undefined),
            ]);
            Object.assign(this.response.body, {
                ...(capabilities.canEditTags
                    ? {
                          programmingMindmapOptions,
                          knowledgeMaps,
                          programmingTagState: programmingTagEditorState(this.pdoc, knowledgeMaps, programmingMindmapOptions),
                      }
                    : {}),
                ...(this.pdoc.authoringMode === 'managed'
                    ? {
                          managedSourceTemplates: MANAGED_SOURCE_TEMPLATES,
                          managedTrainingOptions,
                          managedTrainingPlacements,
                          ...(capabilities.canEditTags ? { managedMindmapOptions: programmingMindmapOptions } : {}),
                          ...(managedReviewPreview ? { managedReviewPreview } : {}),
                          ...(pendingContributionFacts
                              ? {
                                    managedPendingContributions: pendingContributionFacts.rowsByDocId[this.pdoc.docId] || [],
                                    managedPendingContributionFingerprint: pendingContributionFacts.fingerprintByDocId[this.pdoc.docId] || '',
                                    managedContributionUdict: pendingContributionFacts.udict,
                                }
                              : {}),
                      }
                    : {}),
            });
        } else if (capabilities.canEditTags) {
            const [knowledgeMaps, knowledgeMindmapOptions] = await Promise.all([
                listKnowledgeMapsForProblemSelection(),
                listKnowledgeMindmapOptions(),
            ]);
            Object.assign(this.response.body, {
                knowledgeMaps,
                programmingMindmapOptions: knowledgeMindmapOptions,
                programmingTagState: programmingTagEditorState(this.pdoc, knowledgeMaps, knowledgeMindmapOptions),
            });
        }
        // 原始 config YAML（本页 gated by ProblemManageHandler）：前端类型
        // 编辑器直接从页面数据初始化。此前前端 fetch 文件下载路由读取——
        // 该路由对缺失文件不返回 404（照签跳转链接），新题/无 config 题的
        // 类型编辑永远初始化失败（Rev.12 bug 修复）。
        if (!this.canEditLoadedProblem) {
            this.response.template = 'problem_edit.html';
            return;
        }
        const rawPdoc = await requireStableCapabilityProblem(
            this.user,
            this.pdoc,
            'content',
            [...problem.PROJECTION_MANAGED_EDITOR, 'config', 'antiAiMarkers'] as any,
            true,
        );
        if (rawPdoc.antiAiMarkers !== undefined) {
            try {
                this.response.body.pdoc.antiAiMarkers = assertStoredAntiAiMarkers(rawPdoc.antiAiMarkers, rawPdoc);
            } catch (error) {
                logger.error(
                    'Anti AI marker authoring load rejected domain=%s pid=%d actor=%d stage=author-load result=denied error=%o',
                    rawPdoc.domainId,
                    rawPdoc.docId,
                    this.user._id,
                    error,
                );
                throw new ValidationError('antiAiMarkers', null, localizedErrorText`防 AI 标记数据无效，已阻止题面编辑`);
            }
        }
        if (problemKind === 'programming' && rawPdoc.statementFormat !== 'structured-v1') {
            this.response.body.legacyStatementPreview = previewLegacyProgrammingStatement(rawPdoc.content || '');
            this.response.body.legacyStatementConversionRequired =
                rawPdoc.authoringMode === 'managed' && rawPdoc.managedAuthoring?.metadataStatus === 'draft';
        }
        if (problemKind === 'programming') {
            this.response.body.programmingStatementLimits = programmingStatementLimits(rawPdoc.config);
        }
        if (isDedicatedStructuredEditorKind(problemKind)) {
            const config = parseProblemConfigObject(rawPdoc);
            const editorConfig = structuredProblemConfigForEditor(problemKind, config);
            if (!editorConfig.main || typeof editorConfig.main !== 'object') {
                throw new ValidationError('config', null, localizedErrorText`结构化题缺少 main 配置`);
            }
            this.response.body.editorProblemKind = problemKind;
            this.response.body.structuredConfig = editorConfig;
            const [knowledgeMaps, knowledgeMindmapOptions] = await Promise.all([
                listKnowledgeMapsForProblemSelection(),
                listKnowledgeMindmapOptions(),
            ]);
            this.response.body.knowledgeMaps = knowledgeMaps;
            this.response.body.knowledgeMindmapOptions = knowledgeMindmapOptions;
            this.response.body.canUseCustomPid = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
            if ([PROGRAM_FILL_KIND, FUNCTION_KIND].includes(problemKind as any)) {
                this.response.body.langRange = structuredCodeLanguageRange(this.domain);
            }
            this.response.template = structuredEditorTemplate(problemKind);
            return;
        }
        this.response.body.configRaw = typeof rawPdoc?.config === 'string' ? rawPdoc.config : '';
        this.response.template = 'problem_edit.html';
    }

    @route('pid', Types.ProblemId)
    @post('title', Types.Title, true)
    @post('content', Types.String, true, isRawStatementContentInput)
    @post('pid', Types.ProblemId, true, (i) => /^(?:[a-z0-9]{1,10}-)?[a-z][a-z0-9]*$/i.test(i))
    @post('hidden', Types.Boolean)
    @post('tag', Types.Content, true, null, parseCategory)
    @post('knowledgeMapId', Types.String, true)
    @post('knowledgeNodeIds', Types.CommaSeperatedArray, true)
    @post('difficulty', Types.UnsignedInt, (i) => +i <= 10, true)
    @post('lockHidden', Types.Boolean, true)
    @post('expectedStructureRevision', Types.UnsignedInt, true)
    @post('editorProblemKind', Types.String, true)
    @post('structuredConfig', Types.Content, true)
    @post('metadataOnly', Types.Boolean, true)
    @post('completeCodeEvaluationDraft', Types.Boolean, true)
    @post('activeContainerConfirmation', Types.String, true)
    @post('programmingStatement', Types.Content, true)
    @post('antiAiMarkers', Types.String, true)
    @post('conversionFingerprint', Types.String, true)
    @post('conversionUnclassified', Types.Content, true)
    async post(
        _domainId: string,
        pid: string | number,
        title: string | undefined,
        content: string | undefined,
        newPid: string | number | undefined,
        hidden = false,
        tag: string[] = [],
        knowledgeMapId: string,
        knowledgeNodeIds: string[] = [],
        difficulty?: number,
        lockHidden?: boolean,
        expectedStructureRevision?: number,
        editorProblemKind = '',
        structuredConfig = '',
        metadataOnly = false,
        completeCodeEvaluationDraft = false,
        activeContainerConfirmation?: string,
        programmingStatementInput?: string,
        antiAiMarkersInput?: string,
        conversionFingerprint?: string,
        parsedConversionUnclassified?: string,
    ) {
        // The framework invokes `post` before `postDelete` for operation requests.
        // Deletion has its own capability and reference checks, so it must not
        // first run the ordinary edit pipeline or require an edit payload.
        if (this.request.body?.operation === 'delete') return;
        await assertProblemWriteCapability(this, this.pdoc, this.canEditLoadedProblem, 'edit', 'content');
        const domainId = this.pdoc.domainId;
        const problemKind = effectiveProblemKind(this.pdoc);
        const managed = this.pdoc.authoringMode === 'managed';
        const body = this.request.body || {};
        const conversionUnclassified = Object.hasOwn(body, 'conversionUnclassified') ? (parsedConversionUnclassified ?? '') : undefined;
        const dedicatedStructured = isDedicatedStructuredEditorKind(problemKind);
        const legacyProgramming = !managed && problemKind === 'programming';
        let structuredKnowledge: Awaited<ReturnType<typeof materializeKnowledgeMindmapTags>> | null = null;
        let managedKnowledge: Awaited<ReturnType<typeof materializeKnowledgeMindmapTags>> | null = null;
        if (!managed && title === undefined) throw new ValidationError('title');
        if (managed) {
            const allowed = new Set([
                'title',
                'content',
                'programmingStatement',
                'antiAiMarkers',
                'conversionFingerprint',
                'conversionUnclassified',
                'pid',
                'hidden',
                'tag',
                'knowledgeNodeIds',
                'difficulty',
                'lockHidden',
                'expectedStructureRevision',
                'editorProblemKind',
                'structuredConfig',
                'metadataOnly',
                'activeContainerConfirmation',
            ]);
            const unknownFields = Object.keys(body).filter((field) => !allowed.has(field));
            if (unknownFields.length) {
                await auditManagedWriteDenied(this, this.pdoc, 'edit', 'unknown', unknownFields);
                throw new ValidationError('fields', null, localizedErrorText`托管题编辑不接受字段：${unknownFields.join(', ')}`);
            }
            const canonicalFields = ['pid', 'tag'].filter((field) => Object.hasOwn(body, field));
            if (canonicalFields.length) {
                await auditManagedWriteDenied(this, this.pdoc, 'edit', 'fields', canonicalFields);
                throw new ValidationError('fields', null, localizedErrorText`托管题字段只能由服务端派生：${canonicalFields.join(', ')}`);
            }
            const capabilities = problemAuthoringCapabilities(this.user, this.pdoc);
            const metadataFields = ['title', 'difficulty'].filter((field) => Object.hasOwn(body, field));
            const publishFields = ['hidden', 'lockHidden'].filter((field) => Object.hasOwn(body, field));
            const knowledgeFields = Object.hasOwn(body, 'knowledgeNodeIds') ? ['knowledgeNodeIds'] : [];
            const forbiddenFields = [
                ...(!capabilities.canEditDraftMetadata ? metadataFields : []),
                ...(!capabilities.canPublish ? publishFields : []),
                ...(!capabilities.canEditContent || this.pdoc.managedAuthoring?.metadataStatus !== 'draft' ? knowledgeFields : []),
            ];
            if (forbiddenFields.length) {
                await auditManagedWriteDenied(this, this.pdoc, 'edit', 'fields', forbiddenFields);
                throw new ValidationError('fields', null, localizedErrorText`当前角色不可修改字段：${forbiddenFields.join(', ')}`);
            }
            if (knowledgeFields.length) {
                try {
                    managedKnowledge = await materializeKnowledgeMindmapTags(knowledgeNodeIds, {
                        required: true,
                        requireMap: true,
                        requirePublicMap: true,
                        knowledgeMapId: this.pdoc.knowledgeMapId,
                        field: 'knowledgeNodeIds',
                    });
                } catch (error) {
                    logger.warn(
                        'Managed knowledge suggestion rejected domain=%s pid=%d actor=%d stage=knowledge-materialize result=denied error=%o',
                        domainId,
                        this.pdoc.docId,
                        this.user._id,
                        error,
                    );
                    throw error;
                }
            }
        }
        if (legacyProgramming) {
            const canonicalFields = ['tag', 'knowledgeMapId', 'knowledgeNodeIds'].filter((field) => Object.hasOwn(body, field));
            if (canonicalFields.length) {
                logger.warn(
                    'Programming tag write rejected domain=%s pid=%d actor=%d stage=ordinary-save fields=%o result=denied',
                    domainId,
                    this.pdoc.docId,
                    this.user._id,
                    canonicalFields,
                );
                throw new ValidationError('fields', null, localizedErrorText`编程题标签只能从知识导图选择并单独确认`);
            }
            const requestedPid = typeof newPid === 'number' ? `P${newPid}` : newPid;
            if (
                (this.pdoc.pidNamespaceId || this.pdoc.knowledgeNodeIds?.length) &&
                Object.hasOwn(body, 'pid') &&
                requestedPid !== undefined &&
                requestedPid !== this.pdoc.pid
            ) {
                logger.warn(
                    'Namespaced programming PID write rejected domain=%s pid=%d namespace=%s actor=%d stage=ordinary-save result=denied',
                    domainId,
                    this.pdoc.docId,
                    this.pdoc.pidNamespaceId || 'legacy-canonical-tags',
                    this.user._id,
                );
                throw new ValidationError('pid', null, localizedErrorText`已归入题号命名空间或已规范化的编号只能通过管理员迁移流程修改`);
            }
        }
        if (dedicatedStructured) {
            if (Object.hasOwn(body, 'tag')) throw new ValidationError('tag', null, localizedErrorText`结构化题标签只能从知识导图选择`);
            const hasKnowledgeMap = Object.hasOwn(body, 'knowledgeMapId');
            const hasKnowledgeNodes = Object.hasOwn(body, 'knowledgeNodeIds');
            if (hasKnowledgeMap !== hasKnowledgeNodes) {
                throw new ValidationError('knowledgeNodeIds', null, localizedErrorText`所属导图与知识节点必须一起保存`);
            }
            if (Object.hasOwn(body, 'pid') && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
                throw new ValidationError('pid', null, localizedErrorText`只有站点管理员可自定义结构化题编号`);
            }
            if (hasKnowledgeMap) {
                if (String(this.pdoc.knowledgeMapId || '') !== knowledgeMapId) {
                    throw new ValidationError('knowledgeMapId', null, localizedErrorText`更换所属导图必须单独预览并确认`);
                }
                try {
                    structuredKnowledge = await materializeKnowledgeMindmapTags(knowledgeNodeIds, {
                        required: this.pdoc.codeEvaluationStatus !== 'draft' || completeCodeEvaluationDraft,
                        knowledgeMapId,
                        requireMap: true,
                        requirePublicMap: true,
                    });
                } catch (error) {
                    logger.warn(
                        'Structured knowledge save rejected domain=%s pid=%d kind=%s actor=%d stage=knowledge-materialize error=%o',
                        domainId,
                        this.pdoc.docId,
                        problemKind,
                        this.user._id,
                        error,
                    );
                    throw error;
                }
            }
        }
        if (metadataOnly) {
            if (
                !isDedicatedStructuredEditorKind(problemKind) ||
                content !== undefined ||
                antiAiMarkersInput !== undefined ||
                newPid !== undefined ||
                lockHidden !== undefined ||
                expectedStructureRevision !== undefined ||
                editorProblemKind ||
                structuredConfig ||
                completeCodeEvaluationDraft
            ) {
                throw new ValidationError('metadataOnly');
            }
            const pdoc = await problem.saveStructuredProblemMetadata({
                domainId,
                pid: this.pdoc.docId,
                actor: this.user._id,
                user: this.user,
                problemKind,
                metadata: {
                    title: title || this.pdoc.title,
                    hidden,
                    difficulty: difficulty ?? this.pdoc.difficulty ?? 0,
                    ...(structuredKnowledge
                        ? {
                              tag: structuredKnowledge.tags,
                              knowledgeMapId: structuredKnowledge.mapId,
                              knowledgeNodeIds: structuredKnowledge.nodeIds,
                          }
                        : {}),
                },
            });
            const responsePid = this.pdoc.pid || pdoc.docId;
            this.response.body = { ok: true, pid: responsePid, problemKind };
            this.response.redirect = this.url('problem_detail', { pid: responsePid });
            return;
        }
        const structuredStatementSave =
            problemKind === 'programming' && (this.pdoc.statementFormat === 'structured-v1' || programmingStatementInput !== undefined);
        if (structuredStatementSave && content !== undefined) {
            throw new ValidationError('content', null, localizedErrorText`结构化题面不接受直接 Markdown 写入`);
        }
        if (!structuredStatementSave && content === undefined) throw new ValidationError('content');
        if (
            problemKind === 'programming' &&
            this.pdoc.authoringMode === 'managed' &&
            this.pdoc.managedAuthoring?.metadataStatus === 'draft' &&
            !this.pdoc.statementFormat &&
            !structuredStatementSave
        ) {
            throw new ValidationError('statementFormat', null, localizedErrorText`旧托管草稿必须先完成显式题面转换`);
        }
        const statementConfirmation = resolveDataWriteConfirmation(this, this.pdoc, 'statement-edit', activeContainerConfirmation);
        if (newPid === undefined) newPid = this.pdoc.pid || '';
        else if (typeof newPid !== 'string') newPid = `P${newPid}`;
        if (newPid !== this.pdoc.pid && (await problem.get(domainId, newPid))) throw new ProblemAlreadyExistError(newPid);
        const $update: Partial<ProblemDoc> = content === undefined ? {} : { content, html: false };
        if (Object.hasOwn(body, 'antiAiMarkers')) {
            if (antiAiMarkersInput === undefined) throw new ValidationError('antiAiMarkers');
            try {
                $update.antiAiMarkers = JSON.parse(antiAiMarkersInput);
            } catch {
                throw new ValidationError('antiAiMarkers', null, localizedErrorText`防 AI 标记 JSON 无效`);
            }
        }
        if (!managed) {
            Object.assign($update, {
                title,
                pid: newPid,
                hidden,
                difficulty: difficulty ?? 0,
                lockHidden: !!lockHidden,
                ...(structuredKnowledge
                    ? {
                          tag: structuredKnowledge.tags,
                          knowledgeMapId: structuredKnowledge.mapId,
                          knowledgeNodeIds: structuredKnowledge.nodeIds,
                      }
                    : {}),
            });
        } else {
            let nextManagedAuthoring = this.pdoc.managedAuthoring;
            if (Object.hasOwn(body, 'title')) {
                if (this.pdoc.managedAuthoring?.metadataStatus !== 'draft') {
                    await auditManagedWriteDenied(this, this.pdoc, 'edit', 'fields', ['title']);
                    throw new ValidationError('title', null, localizedErrorText`正式标题只能从统一题库审核入口确认`);
                }
                const workingTitle = title?.trim();
                if (!workingTitle) throw new ValidationError('title');
                $update.title = `待审核 · ${workingTitle}`;
                nextManagedAuthoring = { ...nextManagedAuthoring!, workingTitle };
            }
            if (managedKnowledge) {
                nextManagedAuthoring = {
                    ...nextManagedAuthoring!,
                    selectedMindmapNodeIds: managedKnowledge.nodeIds,
                };
            }
            if (nextManagedAuthoring !== this.pdoc.managedAuthoring) $update.managedAuthoring = nextManagedAuthoring;
            if (Object.hasOwn(body, 'pid')) $update.pid = newPid;
            if (Object.hasOwn(body, 'hidden')) $update.hidden = hidden;
            if (Object.hasOwn(body, 'tag')) $update.tag = tag ?? [];
            if (Object.hasOwn(body, 'difficulty')) $update.difficulty = difficulty ?? 0;
            if (Object.hasOwn(body, 'lockHidden')) $update.lockHidden = !!lockHidden;
        }
        if (structuredStatementSave) {
            if (!programmingStatementInput) throw new ValidationError('programmingStatement');
            let programmingStatement: unknown;
            try {
                programmingStatement = JSON.parse(programmingStatementInput);
            } catch {
                throw new ValidationError('programmingStatement', null, localizedErrorText`结构化题面 JSON 无效`);
            }
            if (!expectedStructureRevision) throw new ValidationError('expectedStructureRevision');
            const pdoc = await problem.saveProgrammingStatement({
                domainId,
                pid: this.pdoc.docId,
                user: this.user,
                expectedStructureRevision,
                programmingStatement,
                activeContainerConfirmation: statementConfirmation,
                ...(conversionFingerprint ? { conversionFingerprint } : {}),
                ...(conversionUnclassified !== undefined ? { conversionUnclassified } : {}),
                metadata: $update,
            });
            const responsePid = pdoc.pid || pdoc.docId;
            this.response.body = {
                ok: true,
                pid: responsePid,
                problemKind,
                statementFormat: pdoc.statementFormat,
                structureRevision: pdoc.structureRevision,
            };
            this.response.redirect = this.url('problem_detail', { pid: responsePid });
            return;
        }
        if (isDedicatedStructuredEditorKind(problemKind)) {
            if (editorProblemKind !== problemKind) throw new ValidationError('editorProblemKind');
            if (!structuredConfig) throw new ValidationError('structuredConfig');
            const parsedStructuredConfig = parseStructuredConfigInput(structuredConfig);
            assertStructuredCodeLanguageAllowed(problemKind, parsedStructuredConfig, this.domain);
            const pdoc = await problem.saveStructuredProblem({
                domainId,
                pid: this.pdoc.docId,
                actor: this.user._id,
                user: this.user,
                expectedStructureRevision,
                problemKind,
                content,
                config: parsedStructuredConfig,
                metadata: $update,
                completeCodeEvaluationDraft,
                activeContainerConfirmation: statementConfirmation,
            });
            const responsePid = newPid || pdoc.docId;
            this.response.body = {
                ok: true,
                pid: responsePid,
                problemKind,
                codeEvaluationStatus: pdoc.codeEvaluationStatus,
                structureRevision: pdoc.structureRevision,
            };
            this.response.redirect = this.url(pdoc.codeEvaluationStatus === 'draft' ? 'problem_edit' : 'problem_detail', { pid: responsePid });
            return;
        }
        if (editorProblemKind || structuredConfig || completeCodeEvaluationDraft) throw new ValidationError('problemKind');
        const pdoc = await problem.editAuthorized(
            domainId,
            this.pdoc.docId,
            $update,
            this.user,
            {},
            {
                expectedStructureRevision,
                activeContainerConfirmation: statementConfirmation,
            },
        );
        const responsePid = newPid || pdoc.docId;
        this.response.body = { ok: true, pid: responsePid, problemKind };
        this.response.redirect = this.url('problem_detail', { pid: responsePid });
    }
}

export class ProblemProgrammingTagPreviewHandler extends ProblemManageHandler {
    @route('pid', Types.ProblemId)
    @post('knowledgeMapId', Types.String)
    @post('knowledgeNodeIds', Types.CommaSeperatedArray)
    async post(_domainId: string, _pid: string | number, knowledgeMapId: string, knowledgeNodeIds: string[]) {
        try {
            const bodyFields = Object.keys(this.request.body || {});
            if (bodyFields.some((field) => !['knowledgeMapId', 'knowledgeNodeIds'].includes(field))) {
                throw new ValidationError('fields', null, localizedErrorText`标签预览只接受所属导图与知识节点`);
            }
            const domainId = this.pdoc.domainId;
            await problem.assertProgrammingTagNormalizationUnlocked(domainId, this.pdoc.docId);
            const live = await requireStableCapabilityProblem(this.user, this.pdoc, 'tag', problem.PROJECTION_MANAGED_EDITOR);
            const preview = await previewProgrammingTagNormalization({
                domainId,
                docId: live.docId,
                problemKind: effectiveProblemKind(live),
                structureRevision: live.structureRevision,
                currentTags: live.tag || [],
                currentKnowledgeMapId: live.knowledgeMapId,
                currentKnowledgeNodeIds: resolveProblemKnowledgeNodeIds(live, `problem ${live.domainId}/${live.docId}`),
                targetKnowledgeMapId: knowledgeMapId,
                selectedNodeIds: knowledgeNodeIds,
            });
            logger.info(
                'Programming tag normalization previewed domain=%s pid=%s docId=%d actor=%d stage=preview result=success oldTagCount=%d sourceTagCount=%d selectedNodeCount=%d addedTagCount=%d removedTagCount=%d revision=%s sourceTags=%o addedTags=%o removedTags=%o',
                domainId,
                live.pid || `P${live.docId}`,
                live.docId,
                this.user._id,
                live.tag?.length || 0,
                preview.sourceTags.length,
                preview.selectedNodeIds.length,
                preview.addedTags.length,
                preview.removedTags.length,
                live.structureRevision ?? 'legacy',
                preview.sourceTags,
                preview.addedTags,
                preview.removedTags,
            );
            this.response.body = { ok: true, preview: programmingTagPreviewResponse(preview) };
        } catch (error) {
            logProgrammingTagNormalizationRejected(this.pdoc, this.user._id, 'preview', knowledgeNodeIds, error);
            throw error;
        }
    }
}

export class ProblemProgrammingTagApplyHandler extends ProblemManageHandler {
    @route('pid', Types.ProblemId)
    @post('knowledgeMapId', Types.String)
    @post('knowledgeNodeIds', Types.CommaSeperatedArray)
    @post('intent', Types.String)
    @post('confirmed', Types.Boolean)
    @post('previewFingerprint', Types.String)
    async post(
        _domainId: string,
        _pid: string | number,
        knowledgeMapId: string,
        knowledgeNodeIds: string[],
        intent: string,
        confirmed: boolean,
        previewFingerprint: string,
    ) {
        try {
            const bodyFields = Object.keys(this.request.body || {});
            const allowedFields = new Set(['knowledgeMapId', 'knowledgeNodeIds', 'intent', 'confirmed', 'previewFingerprint']);
            if (bodyFields.some((field) => !allowedFields.has(field))) {
                throw new ValidationError('fields', null, localizedErrorText`标签规范化请求包含未允许字段`);
            }
            if (intent !== 'normalize' || confirmed !== true) {
                throw new ValidationError('confirmed', null, localizedErrorText`请先查看完整增删预览并明确确认`);
            }
            const result = await problem.applyProgrammingTagNormalization({
                domainId: this.pdoc.domainId,
                pid: this.pdoc.docId,
                user: this.user,
                targetKnowledgeMapId: knowledgeMapId,
                selectedNodeIds: knowledgeNodeIds,
                previewFingerprint,
            });
            this.response.body = {
                ok: true,
                pid: result.pdoc.pid || result.pdoc.docId,
                structureRevision: result.pdoc.structureRevision,
                programmingTagState: {
                    mode: 'converted',
                    knowledgeMapId: String(result.preview.knowledgeMapId),
                    knowledgeMapTitle: result.preview.knowledgeMapTitle,
                    sourceTags: result.preview.sourceTags,
                    selectedNodeIds: result.preview.selectedNodeIds.map(String),
                },
            };
        } catch (error) {
            logProgrammingTagNormalizationRejected(this.pdoc, this.user._id, 'confirm', knowledgeNodeIds, error);
            throw error;
        }
    }
}

abstract class DedicatedStructuredCreateHandler extends Handler {
    abstract problemKind: DedicatedStructuredEditorKind;

    async get() {
        if (!problem.canCreateAllProblemKinds(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        const [knowledgeMaps, knowledgeMindmapOptions] = await Promise.all([listKnowledgeMapsForProblemSelection(), listKnowledgeMindmapOptions()]);
        const defaultMapId = knowledgeMaps.length === 1 ? knowledgeMaps[0].id : '';
        this.response.template = structuredEditorTemplate(this.problemKind);
        this.response.body = {
            page_name: `problem_create_${this.problemKind}`,
            editorProblemKind: this.problemKind,
            structuredConfig: defaultDedicatedConfig(this.problemKind),
            pdoc: { hidden: true, problemKind: this.problemKind, knowledgeMapId: defaultMapId, knowledgeNodeIds: [] },
            knowledgeMaps,
            knowledgeMindmapOptions,
            canUseCustomPid: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
        };
        if ([PROGRAM_FILL_KIND, FUNCTION_KIND].includes(this.problemKind as any)) {
            this.response.body.langRange = structuredCodeLanguageRange(this.domain);
        }
    }

    @post('title', Types.Title)
    @post('content', Types.Content, true)
    @post('pid', Types.ProblemId, true, (i) => /^(?:[a-z0-9]{1,10}-)?[a-z][a-z0-9]*$/i.test(i))
    @post('difficulty', Types.UnsignedInt, (i) => +i <= 10, true)
    @post('knowledgeMapId', Types.String)
    @post('knowledgeNodeIds', Types.CommaSeperatedArray, true)
    @post('editorProblemKind', Types.String)
    @post('structuredConfig', Types.Content)
    @post('codeEvaluationDraft', Types.Boolean, true)
    async post(
        _domainId: string,
        title: string,
        content: string | undefined,
        pid: string | number = '',
        difficulty = 0,
        knowledgeMapId = '',
        knowledgeNodeIds: string[] = [],
        editorProblemKind = '',
        structuredConfig = '',
        codeEvaluationDraft = false,
    ) {
        const domainId = String(this.domain?._id);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (!problem.canCreateAllProblemKinds(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        const canUseCustomPid = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const allowedFields = new Set([
            'title',
            'content',
            'difficulty',
            'knowledgeMapId',
            'knowledgeNodeIds',
            'editorProblemKind',
            'structuredConfig',
            'codeEvaluationDraft',
            ...(canUseCustomPid ? ['pid'] : []),
        ]);
        const unknownFields = Object.keys(this.request.body || {}).filter((field) => !allowedFields.has(field));
        if (unknownFields.length) {
            logger.warn(
                'Structured problem create rejected domain=%s kind=%s actor=%d fields=%o stage=field-gate result=denied',
                domainId,
                this.problemKind,
                this.user._id,
                unknownFields,
            );
            throw new ValidationError('fields', null, localizedErrorText`结构化题创建不接受字段：${unknownFields.join(', ')}`);
        }
        if (editorProblemKind !== this.problemKind) {
            throw new ValidationError('editorProblemKind');
        }
        const parsedConfig = parseStructuredConfigInput(structuredConfig);
        const requiresCodeEvaluationDraft = createRequestUsesCodeEvaluationDraft(this.problemKind, parsedConfig);
        if (requiresCodeEvaluationDraft !== codeEvaluationDraft) {
            if (requiresCodeEvaluationDraft) {
                throw new ValidationError('codeEvaluationDraft', null, localizedErrorText`代码评测题必须先创建真实隐藏草稿`);
            }
            throw new ValidationError('codeEvaluationDraft', null, localizedErrorText`当前题型或模式不能创建代码评测草稿`);
        }
        let persistedConfig = parsedConfig;
        if (codeEvaluationDraft) {
            if (Object.hasOwn(this.request.body || {}, 'content')) {
                throw new ValidationError('content', null, localizedErrorText`代码评测草稿第一阶段不接受题面、模板或测试数据`);
            }
            persistedConfig = normalizeCodeEvaluationDraftCreationConfig(this.problemKind, parsedConfig);
            assertStructuredCodeLanguageAllowed(this.problemKind, persistedConfig, this.domain);
        } else if (content === undefined) {
            throw new ValidationError('content');
        }
        if (typeof pid !== 'string') pid = `P${pid}`;
        if (pid && (await problem.get(domainId, pid))) throw new ProblemAlreadyExistError(pid);
        let knowledge: Awaited<ReturnType<typeof materializeKnowledgeMindmapTags>>;
        try {
            knowledge = await materializeKnowledgeMindmapTags(knowledgeNodeIds, {
                required: !codeEvaluationDraft,
                requireMap: true,
                requirePublicMap: true,
                knowledgeMapId,
            });
        } catch (error) {
            logger.warn(
                'Structured knowledge create rejected domain=%s kind=%s actor=%d stage=knowledge-materialize error=%o',
                domainId,
                this.problemKind,
                this.user._id,
                error,
            );
            throw error;
        }
        const docId = await problem.createProblemByKind(this.problemKind, domainId, pid, title, content || '', this.user._id, knowledge.tags, {
            difficulty,
            structuredConfig: persistedConfig,
            knowledgeMapId: knowledge.mapId,
            knowledgeNodeIds: knowledge.nodeIds,
            ...(codeEvaluationDraft ? { codeEvaluationStatus: 'draft' as const } : {}),
        });
        if (codeEvaluationDraft) {
            logger.info(
                'Code evaluation draft created domain=%s pid=%s docId=%d problemKind=%s actor=%d stage=create structureRevision=1 result=draft',
                domainId,
                pid || `P${docId}`,
                docId,
                this.problemKind,
                this.user._id,
            );
        }
        this.response.body = {
            ok: true,
            pid: pid || docId,
            hidden: true,
            problemKind: this.problemKind,
            ...(codeEvaluationDraft ? { codeEvaluationStatus: 'draft' } : {}),
            structureRevision: 1,
        };
        this.response.redirect = this.url('problem_edit', { pid: pid || docId });
    }
}

export class ProblemCreateSingleHandler extends DedicatedStructuredCreateHandler {
    problemKind = BASIC_OBJECTIVE_KIND.single;
}
export class ProblemCreateMultiHandler extends DedicatedStructuredCreateHandler {
    problemKind = BASIC_OBJECTIVE_KIND.multi;
}
export class ProblemCreateTrueFalseHandler extends DedicatedStructuredCreateHandler {
    problemKind = BASIC_OBJECTIVE_KIND.trueFalse;
}
export class ProblemCreateBlankHandler extends DedicatedStructuredCreateHandler {
    problemKind = BASIC_OBJECTIVE_KIND.blank;
}

export class ProblemCreateSubjectiveHandler extends DedicatedStructuredCreateHandler {
    problemKind = SUBJECTIVE_KIND;
}
export class ProblemCreateProgramFillHandler extends DedicatedStructuredCreateHandler {
    problemKind = PROGRAM_FILL_KIND;
}
export class ProblemCreateFunctionHandler extends DedicatedStructuredCreateHandler {
    problemKind = FUNCTION_KIND;
}

export class ProblemConfigHandler extends ProblemManageHandler {
    async get() {
        this.pdoc = await requireStableCapabilityProblem(this.user, this.pdoc, 'data', problem.PROJECTION_MANAGED_EDITOR);
        if (this.pdoc.reference) throw new ProblemIsReferencedError(localizedErrorText`edit config`);
        this.response.body.pdoc = this.pdoc;
        this.response.body.problemAuthoringCapabilities = problemAuthoringCapabilities(this.user, this.pdoc);
        this.response.body.dataWriteGuard = await dataWriteGuardState(this, this.pdoc, this.user);
        this.response.body.testdata = sortFiles(this.pdoc.data || []);
        const configFile = (this.pdoc.data || []).filter((i) => i.name.toLowerCase() === 'config.yaml');
        this.response.body.config = '';
        if (configFile.length > 0) {
            try {
                this.response.body.config = (
                    await streamToBuffer(await storage.get(`problem/${this.pdoc.domainId}/${this.pdoc.docId}/testdata/${configFile[0].name}`))
                ).toString();
            } catch (error) {
                logger.error(
                    'Problem config read failed domain=%s pid=%d file=%s error=%o',
                    this.pdoc.domainId,
                    this.pdoc.docId,
                    configFile[0].name,
                    error,
                );
                throw error;
            }
        }
        this.response.template = 'problem_config.html';
    }
}

export class ProblemFilesHandler extends ProblemDetailHandler {
    notUsage = true;

    @param('d', Types.CommaSeperatedArray, true)
    @param('sidebar', Types.Boolean)
    async get({}, d = ['testdata', 'additional_file'], sidebar = false) {
        if (this.tdoc) throw new ContestNotEndedError();
        this.pdoc = await requireStableCapabilityProblem(this.user, this.pdoc, 'data', problem.PROJECTION_MANAGED_EDITOR);
        this.canEditLoadedProblem = problem.canEditProblemData(this.user, this.pdoc);
        // The files page shares the editor workspace but does not inherit
        // ProblemManageHandler. Publish the same server-computed capability
        // contract so managed authors, maintainers and administrators do not
        // get different navigation merely because they changed routes.
        this.response.body.pdoc = this.pdoc;
        this.response.body.problemAuthoringCapabilities = problemAuthoringCapabilities(this.user, this.pdoc);
        this.response.body.dataWriteGuard = await dataWriteGuardState(this, this.pdoc, this.user);
        this.response.body.testdata = sortFiles(this.pdoc.data || []);
        this.response.body.additional_file = sortFiles(this.pdoc.additional_file || []);
        this.response.body.reference = this.pdoc.reference;
        this.response.pjax = d.map((i) => ['partials/problem_files.html', { filetype: i, sidebar, can_edit: true }]);
        if (!sidebar) this.response.pjax.push(['partials/problem-sidebar-information.html', {}]);
        this.response.template = 'problem_files.html';
    }

    async post() {
        if (this.args.operation === 'get_links') return;
        await assertManagedFileWriteBody(this, this.pdoc);
        // File-write policy must inspect the canonical lifecycle config. The
        // normal editor projection parses config into a client-safe view, and
        // incomplete code-evaluation drafts intentionally cannot be rendered
        // through that view yet. Using it here made a valid compile-mode
        // program-fill draft look as if it did not support testdata.
        this.pdoc = await requireStableCapabilityProblem(this.user, this.pdoc, 'data', problem.PROJECTION_MANAGED_EDITOR, true);
        this.canEditLoadedProblem = problem.canEditProblemData(this.user, this.pdoc);
        if (this.pdoc.reference) throw new ProblemIsReferencedError(localizedErrorText`edit files`);
        await assertProblemWriteCapability(this, this.pdoc, this.canEditLoadedProblem, 'files', 'data');
    }

    @post('writeOperation', Types.Range(DATA_WRITE_CONFIRMATION_OPERATIONS))
    async postPrepareDataWrite(_domainId: string, writeOperation: ProblemDataWriteOperation) {
        const guard = await dataWriteGuardState(this, this.pdoc, this.user, 'data', [writeOperation]);
        const confirmationRequestId = guard.confirmationRequestIds?.[writeOperation];
        const result = !guard.active.length ? 'not-required' : confirmationRequestId ? 'issued' : 'denied';
        logger.info(
            'Active-container data challenge prepared domain=%s pid=%d actor=%d operation=%s confirmationRequestId=%s containers=%o result=%s',
            this.pdoc.domainId,
            this.pdoc.docId,
            this.user._id,
            writeOperation,
            confirmationRequestId || '-',
            guard.active.map((item) => item.id),
            result,
        );
        this.response.body = {
            ok: true,
            active: guard.active,
            canOverride: guard.canOverride,
            confirmationRequestId: confirmationRequestId || null,
        };
    }

    @post('files', Types.Set)
    @post('type', Types.Range(['testdata', 'additional_file']), true)
    async postGetLinks(_domainId: string, files: Set<unknown>, type: 'testdata' | 'additional_file' = 'testdata') {
        if (type === 'testdata' && this.pdoc.reference) {
            throw new ProblemIsReferencedError(localizedErrorText`download testdata.`);
        }
        if (type === 'testdata') {
            const editable = await problem.getCapabilityAuthorized(this.pdoc.domainId, this.pdoc.docId, this.user, 'data');
            if (editable) this.pdoc = editable;
            else {
                if (!this.user.hasPriv(PRIV.PRIV_READ_PROBLEM_DATA)) this.checkPerm(PERM.PERM_READ_PROBLEM_DATA);
                if (this.tdoc && !contest.isDone(this.tdoc)) throw new ContestNotEndedError(this.tdoc.domainId, this.tdoc.docId);
            }
        }
        if (this.pdoc.reference) this.pdoc = await problem.get(this.pdoc.reference.domainId, this.pdoc.reference.pid);
        const { names, metadata } = validateProblemBulkDownloadFiles(this, this.pdoc, type, files);
        const requestedNames = new Set(names);
        const links: Record<string, string> = Object.create(null);
        const size = Math.sum(metadata.filter((file) => requestedNames.has(file.name)).map((file) => file.size || 0)) || 0;
        await oplog.log(this, 'download.problem.bulk', {
            target: names.map((file) => `problem/${this.pdoc.domainId}/${this.pdoc.docId}/${type}/${file}`),
            size,
        });
        for (const file of names) {
            links[file] = await storage.signDownloadLink(`problem/${this.pdoc.domainId}/${this.pdoc.docId}/${type}/${file}`, file, false, 'user');
        }
        this.response.body.links = links;
    }

    @post('filename', Types.Filename, true)
    @post('type', Types.Range(['testdata', 'additional_file']), true)
    @post('activeContainerConfirmation', Types.String, true)
    async postUploadFile(_domainId: string, filename: string, type = 'testdata', activeContainerConfirmation?: string) {
        const domainId = this.pdoc.domainId;
        if (type === 'testdata' && !allowsStructuredTestdata(this.pdoc)) {
            throw new ValidationError('type', null, localizedErrorText`此结构化题不接受 testdata 文件写入`);
        }
        const file = this.request.files.file;
        if (!file) throw new ValidationError('file');
        filename ||= file.originalFilename || randomstring(16);
        if (type === 'testdata' && this.pdoc.problemKind !== undefined && this.pdoc.problemKind !== 'programming') {
            if (isProblemConfigFilename(filename)) {
                throw new ValidationError('filename', null, localizedErrorText`结构化题配置不通过 testdata 文件修改`);
            }
            if (filename.toLowerCase().endsWith('.zip')) {
                throw new ValidationError('filename', null, localizedErrorText`结构化编译题请直接上传测试数据文件`);
            }
        }
        const files = [];
        if (filename.toLowerCase().endsWith('.zip') && type === 'testdata') {
            const zip = new ZipReader(Readable.toWeb(createReadStream(file.filepath)));
            let entries: Entry[];
            try {
                entries = await zip.getEntries();
            } catch (e) {
                throw localizeErrorParameter(new ValidationError('zip', null, e.message), 2, 'Unable to read the archive: {0}', e.message);
            }
            for (const entry of entries) {
                if (!entry.filename || entry.directory === true) continue;
                files.push({
                    type,
                    name: sanitize(entry.filename),
                    size: entry.uncompressedSize,
                    data: () => {
                        const pass = new PassThrough();
                        entry.getData(Writable.toWeb(pass));
                        return pass;
                    },
                });
            }
        } else {
            files.push({
                type,
                name: filename,
                size: file.size,
                data: () => file.filepath,
            });
        }
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            if (
                (this.pdoc.data?.length || 0) + (this.pdoc.additional_file?.length || 0) + files.length >=
                this.ctx.setting.get('limit.problem_files_max')
            ) {
                throw new FileLimitExceededError('count');
            }
            const size = Math.sum(
                (this.pdoc.data || []).map((i) => i.size),
                (this.pdoc.additional_file || []).map((i) => i.size),
                files.map((i) => i.size),
            );
            if (size >= this.ctx.setting.get('limit.problem_files_max_size')) {
                throw new FileLimitExceededError('size');
            }
        }
        await problem.withAuthorizedDataWriteClaim(
            domainId,
            this.pdoc.docId,
            this.user,
            'files-upload',
            async (claim) => {
                for (const entry of files) {
                    if (entry.type === 'testdata') {
                        await problem.addTestdataWithClaim(claim, entry.name, entry.data(), this.user._id);
                    } else {
                        await problem.addAdditionalFileWithClaim(claim, entry.name, entry.data(), this.user._id);
                    }
                }
            },
            { activeContainerConfirmation: resolveDataWriteConfirmation(this, this.pdoc, 'files-upload', activeContainerConfirmation) },
        );
        if (type === 'testdata' && [PROGRAM_FILL_KIND, FUNCTION_KIND].includes(this.pdoc.problemKind as any)) {
            const latest = await problem.get(domainId, this.pdoc.docId, ['structureRevision', 'data'] as any, true);
            if (!latest) throw new ProblemNotFoundError(domainId, this.pdoc.docId);
            this.back({
                ok: true,
                operation: 'upload_file',
                type,
                filename,
                structureRevision: latest.structureRevision,
                testdata: sortFiles(latest.data || []),
            });
            return;
        }
        this.back({ ok: true, operation: 'upload_file', type, filename });
    }

    @post('files', Types.ArrayOf(Types.Filename))
    @post('newNames', Types.ArrayOf(Types.Filename))
    @post('type', Types.Range(['testdata', 'additional_file']), true)
    @post('activeContainerConfirmation', Types.String, true)
    async postRenameFiles(_domainId: string, files: string[], newNames: string[], type = 'testdata', activeContainerConfirmation?: string) {
        const domainId = this.pdoc.domainId;
        if (type === 'testdata' && !allowsStructuredTestdata(this.pdoc)) {
            throw new ValidationError('type', null, localizedErrorText`此结构化题不接受 testdata 文件写入`);
        }
        if (
            type === 'testdata' &&
            this.pdoc.problemKind !== undefined &&
            this.pdoc.problemKind !== 'programming' &&
            [...files, ...newNames].some(isProblemConfigFilename)
        ) {
            throw new ValidationError('newNames');
        }
        if (files.length !== newNames.length) throw new ValidationError('files', 'newNames');
        await problem.withAuthorizedDataWriteClaim(
            domainId,
            this.pdoc.docId,
            this.user,
            'files-rename',
            async (claim) => {
                for (let index = 0; index < files.length; index++) {
                    const file = files[index];
                    const newName = newNames[index];
                    if (type === 'testdata') {
                        await problem.renameTestdataWithClaim(claim, file, newName, this.user._id);
                    } else {
                        await problem.renameAdditionalFileWithClaim(claim, file, newName, this.user._id);
                    }
                }
            },
            { activeContainerConfirmation: resolveDataWriteConfirmation(this, this.pdoc, 'files-rename', activeContainerConfirmation) },
        );
        this.back();
    }

    @post('files', Types.ArrayOf(Types.Filename))
    @post('type', Types.Range(['testdata', 'additional_file']), true)
    @post('activeContainerConfirmation', Types.String, true)
    async postDeleteFiles(_domainId: string, files: string[], type = 'testdata', activeContainerConfirmation?: string) {
        const domainId = this.pdoc.domainId;
        if (type === 'testdata' && !allowsStructuredTestdata(this.pdoc)) {
            throw new ValidationError('type', null, localizedErrorText`此结构化题不接受 testdata 文件写入`);
        }
        if (
            type === 'testdata' &&
            this.pdoc.problemKind !== undefined &&
            this.pdoc.problemKind !== 'programming' &&
            files.some(isProblemConfigFilename)
        ) {
            throw new ValidationError('files');
        }
        await problem.withAuthorizedDataWriteClaim(
            domainId,
            this.pdoc.docId,
            this.user,
            'files-delete',
            (claim) =>
                type === 'testdata'
                    ? problem.delTestdataWithClaim(claim, files, this.user._id)
                    : problem.delAdditionalFileWithClaim(claim, files, this.user._id),
            { activeContainerConfirmation: resolveDataWriteConfirmation(this, this.pdoc, 'files-delete', activeContainerConfirmation) },
        );
        this.back();
    }

    @post('std', Types.Filename)
    @post('gen', Types.Filename)
    @post('activeContainerConfirmation', Types.String, true)
    async postGenerateTestdata(_domainId: string, std: string, gen: string, activeContainerConfirmation?: string) {
        const domainId = this.pdoc.domainId;
        const confirmation = resolveDataWriteConfirmation(this, this.pdoc, 'generate-testdata-request', activeContainerConfirmation);
        let enqueueError: unknown;
        const rid = await problem.withAuthorizedDataWriteClaim(
            domainId,
            this.pdoc.docId,
            this.user,
            'generate-testdata-request',
            async () => {
                try {
                    // `this.pdoc` predates claim acquisition. A concurrent
                    // reference conversion or file rename/delete may have won
                    // first, so validate the current claimed state before
                    // enqueueing a generation Record.
                    const current = await problem.get(domainId, this.pdoc.docId);
                    if (!current) throw new ProblemNotFoundError(domainId, this.pdoc.docId);
                    if (current.reference) throw new ProblemIsReferencedError(localizedErrorText`edit files`);
                    if (!current.data?.find((i) => i.name === std)) throw new BadRequestError();
                    if (!current.data?.find((i) => i.name === gen)) throw new BadRequestError();
                    return await record.add(domainId, this.pdoc.docId, this.user._id, '_', `${gen}\n${std}`, true, {
                        type: 'generate',
                        dataWriteActiveContainerConfirmation: confirmation,
                    });
                } catch (error) {
                    // No ProblemDoc/storage mutation has started. Release the
                    // claim cleanly, then propagate validation/read/queue
                    // failures below without converting them into a write
                    // repair marker.
                    enqueueError = error;
                    return null;
                }
            },
            { activeContainerConfirmation: confirmation, bumpStructureRevision: false },
        );
        if (enqueueError) throw enqueueError;
        this.response.redirect = this.url('record_detail', { rid });
    }
}

export class ProblemFileDownloadHandler extends ProblemDetailHandler {
    @query('type', Types.Range(['additional_file', 'testdata']), true)
    @param('filename', Types.Filename)
    @param('noDisposition', Types.Boolean)
    @query('tid', Types.ObjectId, true)
    async get({}, type = 'additional_file', filename: string, noDisposition = false, tid: ObjectId) {
        if (!tid) this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        if (this.pdoc.reference) {
            if (type === 'testdata') throw new ProblemIsReferencedError(localizedErrorText`download testdata`);
            const reference = this.pdoc.reference;
            this.pdoc = await problem.get(reference.domainId, reference.pid);
            if (!this.pdoc) throw localizeError(new ProblemNotFoundError(), 'Problem {0} not found.', reference.pid);
        }
        if (type === 'testdata') {
            const dataAuthorized = await problem.getCapabilityAuthorized(this.pdoc.domainId, this.pdoc.docId, this.user, 'data');
            if (dataAuthorized) this.pdoc = dataAuthorized;
            else {
                if (!this.user.hasPriv(PRIV.PRIV_READ_PROBLEM_DATA)) this.checkPerm(PERM.PERM_READ_PROBLEM_DATA);
                if (this.tdoc && !contest.isDone(this.tdoc)) throw new ContestNotEndedError(this.tdoc.domainId, this.tdoc.docId);
            }
        }
        const target = `problem/${this.pdoc.domainId}/${this.pdoc.docId}/${type}/${filename}`;
        const file = await storage.getMeta(target);
        await oplog.log(this, 'download.problem.single', {
            target,
            size: file?.size || 0,
        });
        this.response.redirect = await storage.signDownloadLink(target, noDisposition ? undefined : filename, false, 'user');
    }
}

export class ProblemSolutionHandler extends ProblemDetailHandler {
    @param('page', Types.PositiveInt, true)
    @param('tid', Types.ObjectId, true)
    @param('sid', Types.ObjectId, true)
    async get(_domainId: string, page = 1, tid?: ObjectId, sid?: ObjectId) {
        const domainId = this.pdoc.domainId;
        if (tid) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_SOLUTION);
        this.response.template = 'problem_solution.html';
        const accepted = this.psdoc?.status === STATUS.STATUS_ACCEPTED;
        if (!accepted || !this.user.hasPerm(PERM.PERM_VIEW_PROBLEM_SOLUTION_ACCEPT)) {
            this.checkPerm(PERM.PERM_VIEW_PROBLEM_SOLUTION);
        }

        let [psdocs, pcount, pscount] = await this.paginate(solution.getMulti(domainId, this.pdoc.docId), page, 'solution');
        if (sid) {
            psdocs = [await solution.get(domainId, sid)];
            if (!psdocs[0]) throw new SolutionNotFoundError(domainId, sid);
        }
        const uids = [this.pdoc.owner];
        const docids = [];
        for (const psdoc of psdocs) {
            docids.push(psdoc.docId);
            uids.push(psdoc.owner);
            if (psdoc.reply.length) {
                for (const psrdoc of psdoc.reply) uids.push(psrdoc.owner);
            }
        }
        const udict = await user.getList(domainId, uids);
        const pssdict = await solution.getListStatus(domainId, docids, this.user._id);
        this.response.body = {
            psdocs,
            page,
            pcount,
            pscount,
            udict,
            pssdict,
            pdoc: this.pdoc,
            sid,
        };
    }

    @param('content', Types.Content)
    async postSubmit(_domainId: string, content: string) {
        const domainId = this.pdoc.domainId;
        this.checkPerm(PERM.PERM_CREATE_PROBLEM_SOLUTION);
        const psid = await solution.add(domainId, this.pdoc.docId, this.user._id, content);
        this.back({ psid });
    }

    @param('content', Types.Content)
    @param('psid', Types.ObjectId)
    async postEditSolution(_domainId: string, content: string, psid: ObjectId) {
        const domainId = this.pdoc.domainId;
        let psdoc = await solution.get(domainId, psid);
        if (!this.user.own(psdoc)) this.checkPerm(PERM.PERM_EDIT_PROBLEM_SOLUTION);
        else this.checkPerm(PERM.PERM_EDIT_PROBLEM_SOLUTION_SELF);
        psdoc = await solution.edit(domainId, psdoc.docId, content);
        this.back({ psdoc });
    }

    @param('psid', Types.ObjectId)
    async postDeleteSolution(_domainId: string, psid: ObjectId) {
        const domainId = this.pdoc.domainId;
        const psdoc = await solution.get(domainId, psid);
        if (!this.user.own(psdoc)) this.checkPerm(PERM.PERM_DELETE_PROBLEM_SOLUTION);
        else this.checkPerm(PERM.PERM_DELETE_PROBLEM_SOLUTION_SELF);
        await solution.del(domainId, psdoc.docId);
        this.back();
    }

    @param('psid', Types.ObjectId)
    @param('content', Types.Content)
    async postReply(_domainId: string, psid: ObjectId, content: string) {
        const domainId = this.pdoc.domainId;
        this.checkPerm(PERM.PERM_REPLY_PROBLEM_SOLUTION);
        const psdoc = await solution.get(domainId, psid);
        await solution.reply(domainId, psdoc.docId, this.user._id, content);
        this.back();
    }

    @param('psid', Types.ObjectId)
    @param('psrid', Types.ObjectId)
    @param('content', Types.Content)
    async postEditReply(_domainId: string, psid: ObjectId, psrid: ObjectId, content: string) {
        const domainId = this.pdoc.domainId;
        const [psdoc, psrdoc] = await solution.getReply(domainId, psid, psrid);
        if (!psdoc || psdoc.parentId !== this.pdoc.docId) throw new SolutionNotFoundError(domainId, psid);
        if (!this.user.own(psrdoc) || !this.user.hasPerm(PERM.PERM_EDIT_PROBLEM_SOLUTION_REPLY_SELF)) {
            throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SOLUTION_REPLY_SELF);
        }
        await solution.editReply(domainId, psid, psrid, content);
        this.back();
    }

    @param('psid', Types.ObjectId)
    @param('psrid', Types.ObjectId)
    async postDeleteReply(_domainId: string, psid: ObjectId, psrid: ObjectId) {
        const domainId = this.pdoc.domainId;
        const [psdoc, psrdoc] = await solution.getReply(domainId, psid, psrid);
        if (!psdoc || psdoc.parentId !== this.pdoc.docId) throw new SolutionNotFoundError(domainId, psid);
        if (!this.user.own(psrdoc) || !this.user.hasPerm(PERM.PERM_DELETE_PROBLEM_SOLUTION_REPLY_SELF)) {
            this.checkPerm(PERM.PERM_DELETE_PROBLEM_SOLUTION_REPLY);
        }
        await solution.delReply(domainId, psid, psrid);
        this.back();
    }

    @param('psid', Types.ObjectId)
    async postUpvote(_domainId: string, psid: ObjectId) {
        const domainId = this.pdoc.domainId;
        this.checkPerm(PERM.PERM_VOTE_PROBLEM_SOLUTION);
        const psdoc = await solution.vote(domainId, psid, this.user._id, 1);
        this.back({ vote: psdoc.vote, user_vote: 1 });
    }

    @param('psid', Types.ObjectId)
    async postDownvote(_domainId: string, psid: ObjectId) {
        const domainId = this.pdoc.domainId;
        this.checkPerm(PERM.PERM_VOTE_PROBLEM_SOLUTION);
        const psdoc = await solution.vote(domainId, psid, this.user._id, -1);
        this.back({ vote: psdoc.vote, user_vote: -1 });
    }
}

export class ProblemSolutionRawHandler extends ProblemDetailHandler {
    @param('psid', Types.ObjectId)
    @route('psrid', Types.ObjectId, true)
    @param('tid', Types.ObjectId, true)
    async get(_domainId: string, psid: ObjectId, psrid?: ObjectId, tid?: ObjectId) {
        const domainId = this.pdoc.domainId;
        if (tid) throw new PermissionError(PERM.PERM_VIEW_PROBLEM_SOLUTION);
        const accepted = this.psdoc?.status === STATUS.STATUS_ACCEPTED;
        if (!accepted || !this.user.hasPerm(PERM.PERM_VIEW_PROBLEM_SOLUTION_ACCEPT)) {
            this.checkPerm(PERM.PERM_VIEW_PROBLEM_SOLUTION);
        }
        if (psrid) {
            const [psdoc, psrdoc] = await solution.getReply(domainId, psid, psrid);
            if (!psdoc || psdoc.parentId !== this.pdoc.docId) throw new SolutionNotFoundError(psid, psrid);
            this.response.body = psrdoc.content;
        } else {
            const psdoc = await solution.get(domainId, psid);
            this.response.body = psdoc.content;
        }
        this.response.type = 'text/markdown';
    }
}

export class ProblemStatisticsHandler extends ProblemDetailHandler {
    @param('sort', Types.Range(Object.keys(record.STAT_QUERY)), true)
    @param('direction', Types.Range([-1, 1]), true)
    @param('lang', Types.String, true)
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, sort = 'time', direction: 1 | -1 = 1, lang?: string, page = 1) {
        const domainId = this.pdoc.domainId;
        if (this.tdoc) throw new ContestNotEndedError();
        const [rsdocs, pcount, rscount] = await this.paginate(
            record.getMultiStat(
                domainId,
                {
                    pid: this.pdoc.docId,
                    ...(lang ? { lang } : {}),
                },
                record.STAT_QUERY[sort][Math.max(direction, 0)],
            ),
            page,
            'record',
        );
        const [udict, udoc] = await Promise.all([
            user.getListForRender(
                domainId,
                rsdocs.map((i) => i.uid),
                this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
            ),
            user.getById(domainId, this.pdoc.owner),
        ]);
        this.response.template = 'problem_statistics.html';
        this.response.body = {
            rsdocs,
            page,
            pcount,
            rscount,
            sort,
            direction,
            lang,
            langs: setting.langs,
            pdoc: this.pdoc,
            udict,
            types: Object.keys(record.STAT_QUERY),
            udoc,
        };
    }
}

/** Author-scoped problem workbench; it shares the canonical bank scope. */
export class ProblemMineHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, page = 1) {
        const domainId = String(this.domain?._id);
        if (!problem.canBrowseProblemBank(this.user)) {
            this.response.redirect = this.url('training_main');
            return;
        }
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (!problem.canBrowseProblemBank(this.user)) {
            this.response.redirect = this.url('training_main');
            return;
        }
        const limit = this.ctx.setting.get('pagination.problem');
        const bankScope = problem.buildProblemBankScope(this.user);
        const [pdocs, pcount] = await Promise.all([
            problem
                .getMulti(domainId, bankScope, problem.PROJECTION_MANAGED_BANK)
                .sort({ docId: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .toArray(),
            problem.getMulti(domainId, bankScope).count(),
        ]);
        this.response.template = 'problem_mine.html';
        const canCreate = problem.canCreateManagedProgrammingDraft(this.user);
        this.response.body = {
            pdocs,
            page,
            pcount,
            ppcount: Math.ceil(pcount / limit),
            canCreate,
        };
    }
}

export class ProblemCreateHubHandler extends Handler {
    async get() {
        const canCreateAllKinds = problem.canCreateAllProblemKinds(this.user);
        const canCreateManagedDraft = problem.canCreateManagedProgrammingDraft(this.user);
        if (!canCreateManagedDraft) throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
        const availableKinds = canCreateAllKinds ? PROBLEM_KINDS : (['programming'] as const);
        this.response.template = 'problem_create_hub.html';
        this.response.body = {
            problemKinds: availableKinds.map((kind) => ({
                kind,
                slug: problemKindToSlug(kind),
            })),
        };
    }
}

export class ProblemCreateProgrammingHandler extends Handler {
    async get() {
        const domainId = String(this.domain?._id);
        const canAssignManagedAuthor = problem.canAssignManagedAuthor(this.user);
        if (!problem.canCreateManagedProgrammingDraft(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        const pidNamespaces = await listCreatablePidNamespaces(domainId, this.user);
        if (!pidNamespaces.length) throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
        const allowedSourceTemplates = new Set(pidNamespaces.flatMap((namespace) => namespace.sourceTemplates));
        const [knowledgeMaps, managedMindmapOptions, managedTrainingOptions] = await Promise.all([
            listKnowledgeMapsForProblemSelection(),
            listManagedMindmapOptions(),
            canAssignManagedAuthor ? listManagedTrainingOptions(domainId) : Promise.resolve([]),
        ]);
        this.response.template = 'problem_edit.html';
        this.response.body = {
            page_name: 'problem_create_programming',
            additional_file: [],
            statementLangs: this.ctx.i18n.langs(false),
            pdoc: {
                hidden: true,
                problemKind: 'programming',
                authoringMode: 'managed',
                statementFormat: 'structured-v1',
                programmingStatement: emptyProgrammingStatement(),
                knowledgeMapId: knowledgeMaps.length === 1 ? knowledgeMaps[0].id : '',
                managedAuthoring: { workingTitle: '', selectedMindmapNodeIds: [], metadataStatus: 'draft' },
            },
            canCreateManagedProblem: true,
            canAssignManagedAuthor,
            canAssignManagedTraining: canAssignManagedAuthor,
            managedCreateDefault: true,
            managedSourceTemplates: MANAGED_SOURCE_TEMPLATES.filter((template) => allowedSourceTemplates.has(template.id)),
            pidNamespaces: pidNamespaces.map(pidNamespaceClientOption),
            defaultPidNamespaceId:
                pidNamespaces.find((namespace) => namespace.namespaceId === DEFAULT_PID_NAMESPACE_ID)?.namespaceId || pidNamespaces[0].namespaceId,
            managedMindmapOptions,
            knowledgeMaps,
            managedTrainingOptions,
            problemAuthoringCapabilities: {
                managed: true,
                canEditContent: true,
                canEditDraftMetadata: false,
                canManageCollaborators: false,
                canManageMaintainers: false,
                canPublish: false,
                canArchive: false,
                canDelete: false,
                canClone: false,
            },
        };
    }

    @post('title', Types.Title)
    @post('content', Types.Content, true)
    @post('pid', Types.ProblemId, true, (i) => /^(?:[a-z0-9]{1,10}-)?[a-z][a-z0-9]*$/i.test(i))
    @post('hidden', Types.Boolean)
    @post('difficulty', Types.PositiveInt, (i) => +i <= 10, true)
    @post('tag', Types.Content, true, null, parseCategory)
    @post('managed', Types.Boolean, true)
    @post('template', Types.String, true)
    @post('pidNamespaceId', Types.String)
    @post('year', Types.String, true)
    @post('season', Types.String, true)
    @post('level', Types.String, true)
    @post('round', Types.String, true)
    @post('knowledgeMapId', Types.String)
    @post('mindmapNodeIds', Types.CommaSeperatedArray, true)
    @post('trainingId', Types.String, true)
    @post('chapterId', Types.String, true)
    @post('authorUid', Types.PositiveInt, true)
    async post(
        _domainId: string,
        title: string,
        _content: string | undefined,
        _pid: string | number = '',
        _hidden = false,
        difficulty = 0,
        _tag: string[] = [],
        managed = false,
        template = '',
        pidNamespaceId = '',
        year: string | number = '',
        season = '',
        level = '',
        round: string | number = '',
        knowledgeMapId = '',
        mindmapNodeIds: string[] = [],
        trainingId = '',
        chapterId: string | number = '',
        authorUid = 0,
    ) {
        const domainId = String(this.domain?._id);
        const isBankAdmin = problem.canAssignManagedAuthor(this.user);
        if (!problem.canCreateManagedProgrammingDraft(this.user)) throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
        await problem.refreshProblemAcl(this.user, domainId);
        problem.assertProblemAclDomain(this.user, domainId);
        if (
            !isBankAdmin &&
            (Object.hasOwn(this.request.body || {}, 'authorUid') ||
                Object.hasOwn(this.request.body || {}, 'trainingId') ||
                Object.hasOwn(this.request.body || {}, 'chapterId'))
        ) {
            const restrictedFields = [
                ...(Object.hasOwn(this.request.body || {}, 'authorUid') ? ['authorUid'] : []),
                ...(Object.hasOwn(this.request.body || {}, 'trainingId') ? ['trainingId'] : []),
                ...(Object.hasOwn(this.request.body || {}, 'chapterId') ? ['chapterId'] : []),
            ];
            logger.warn(
                'Managed draft authority rejected domain=%s actor=%d template=%s fields=%o stage=create-authority result=denied',
                domainId,
                this.user._id,
                template,
                restrictedFields,
            );
            await oplog.log(this, 'problem.managed.write.denied', {
                action: 'create',
                fields: restrictedFields,
                stage: 'create-authority',
                result: 'denied',
            });
            throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT);
        }
        const allowed = new Set([
            'title',
            'managed',
            'template',
            'pidNamespaceId',
            'year',
            'season',
            'level',
            'round',
            'difficulty',
            'knowledgeMapId',
            'mindmapNodeIds',
            'trainingId',
            'chapterId',
            ...(isBankAdmin ? ['authorUid'] : []),
        ]);
        const unknownFields = Object.keys(this.request.body || {}).filter((field) => !allowed.has(field));
        if (unknownFields.length || managed !== true) {
            const fields = [...unknownFields, ...(managed === true ? [] : ['managed'])];
            logger.warn('Managed draft create rejected domain=%s actor=%d fields=%o result=denied', domainId, this.user._id, fields);
            await oplog.log(this, 'problem.managed.write.denied', {
                action: 'create',
                fields,
                result: 'denied',
            });
            throw new ValidationError('fields', null, localizedErrorText`托管草稿不接受字段或创建模式：${fields.join(', ')}`);
        }
        const resolvedAuthorUid = isBankAdmin ? authorUid || this.user._id : this.user._id;
        const resolvedDifficulty = difficulty || 1;
        if (isBankAdmin && resolvedAuthorUid !== this.user._id) {
            const author = await user.getById(domainId, authorUid);
            if (!author || author._id !== authorUid) throw new ValidationError('authorUid');
        }
        const sourceMeta = {
            template,
            year,
            ...(season ? { season } : {}),
            ...(level ? { level } : {}),
            ...(round ? { round } : {}),
        };
        const created = await problem.createManagedProgrammingDraft(
            domainId,
            {
                workingTitle: title,
                difficulty: resolvedDifficulty,
                pidNamespaceId,
                sourceMeta,
                knowledgeMapId,
                mindmapNodeIds,
                ...(trainingId || chapterId ? { pendingTrainingPlacement: { trainingId, chapterId } } : {}),
                ...(resolvedAuthorUid ? { authorUid: resolvedAuthorUid } : {}),
            },
            this.user._id,
            this.user,
        );
        this.response.body = {
            ok: true,
            pid: created.pid,
            docId: created.docId,
            hidden: true,
            problemKind: 'programming',
            authoringMode: 'managed',
            structureRevision: 1,
        };
        this.response.redirect = this.url('problem_edit', { pid: created.pid });
    }
}

export const ProblemApi = {
    problem: Query(
        Schema.object({
            id: Schema.union([Schema.number().step(1), Schema.string()]).required(),
            domainId: Schema.string().required(),
        }),
        async (ctx, args) => {
            const domainId = String(ctx.domain?._id);
            await problem.refreshProblemAcl(ctx.user, domainId);
            problem.assertProblemAclDomain(ctx.user, domainId);
            if (domainId !== args.domainId) {
                throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
            }
            if (!problem.canBrowseProblemBank(ctx.user)) {
                throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
            }
            const [pdoc] = await problem
                .getMulti(
                    domainId,
                    {
                        $and: [problem.buildProblemBankScope(ctx.user), exactProblemFilter(args.id)],
                    },
                    problem.PROJECTION_PUBLIC,
                )
                .limit(1)
                .toArray();
            return pdoc || null;
        },
    ),
    problems: Query(
        Schema.object({
            ids: Schema.array(Schema.number().step(1)).required(),
            domainId: Schema.string().required(),
        }),
        async (ctx, args) => {
            const domainId = String(ctx.domain?._id);
            await problem.refreshProblemAcl(ctx.user, domainId);
            problem.assertProblemAclDomain(ctx.user, domainId);
            if (domainId !== args.domainId) {
                throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
            }
            if (!problem.canBrowseProblemBank(ctx.user)) {
                throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
            }
            const ids = Array.from(new Set(args.ids));
            const pdocs = await problem
                .getMulti(
                    domainId,
                    {
                        $and: [problem.buildProblemBankScope(ctx.user), { docId: { $in: ids } }],
                    },
                    problem.PROJECTION_PUBLIC,
                )
                .toArray();
            const pdict = Object.fromEntries(pdocs.map((pdoc) => [pdoc.docId, pdoc]));
            return args.ids.map((id) => pdict[id]).filter((pdoc) => pdoc);
        },
    ),
} as const;

declare module '@hydrooj/framework' {
    interface Apis {
        problem: typeof ProblemApi;
    }
}

export async function apply(ctx: Context) {
    ctx.Route('problem_main', '/p', ProblemMainHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_review', '/p/review', ProblemReviewHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_pid_namespace', '/p/namespaces', ProblemPidNamespaceHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_random', '/problem/random', ProblemRandomHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_detail', '/p/:pid', ProblemDetailHandler);
    ctx.Route('problem_submit', '/p/:pid/submit', ProblemSubmitHandler);
    ctx.Route('problem_hack', '/p/:pid/hack/:rid', ProblemHackHandler, PERM.PERM_SUBMIT_PROBLEM);
    ctx.Route('problem_edit', '/p/:pid/edit', ProblemEditHandler);
    ctx.Route('problem_programming_tags_preview', '/p/:pid/tags/preview', ProblemProgrammingTagPreviewHandler);
    ctx.Route('problem_programming_tags_apply', '/p/:pid/tags/apply', ProblemProgrammingTagApplyHandler);
    ctx.Route('problem_config', '/p/:pid/config', ProblemConfigHandler);
    ctx.Route('problem_files', '/p/:pid/files', ProblemFilesHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_file_download', '/p/:pid/file/:filename', ProblemFileDownloadHandler);
    ctx.Route('problem_solution', '/p/:pid/solution', ProblemSolutionHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_solution_detail', '/p/:pid/solution/:sid', ProblemSolutionHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_solution_raw', '/p/:pid/solution/:psid/raw', ProblemSolutionRawHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_solution_reply_raw', '/p/:pid/solution/:psid/:psrid/raw', ProblemSolutionRawHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_statistics', '/p/:pid/stat', ProblemStatisticsHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_mine', '/problem/mine', ProblemMineHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('problem_create', '/problem/create', ProblemCreateHubHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(
        'problem_create_programming',
        `/problem/create/${problemKindToSlug('programming')}`,
        ProblemCreateProgrammingHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'problem_create_single',
        `/problem/create/${problemKindToSlug(BASIC_OBJECTIVE_KIND.single)}`,
        ProblemCreateSingleHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'problem_create_multi',
        `/problem/create/${problemKindToSlug(BASIC_OBJECTIVE_KIND.multi)}`,
        ProblemCreateMultiHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'problem_create_true_false',
        `/problem/create/${problemKindToSlug(BASIC_OBJECTIVE_KIND.trueFalse)}`,
        ProblemCreateTrueFalseHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'problem_create_blank',
        `/problem/create/${problemKindToSlug(BASIC_OBJECTIVE_KIND.blank)}`,
        ProblemCreateBlankHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'problem_create_subjective',
        `/problem/create/${problemKindToSlug(SUBJECTIVE_KIND)}`,
        ProblemCreateSubjectiveHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'problem_create_program_fill',
        `/problem/create/${problemKindToSlug(PROGRAM_FILL_KIND)}`,
        ProblemCreateProgramFillHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route('problem_create_function', `/problem/create/${problemKindToSlug(FUNCTION_KIND)}`, ProblemCreateFunctionHandler, PRIV.PRIV_USER_PROFILE);
    await ctx.inject(['api'], ({ api }) => {
        api.provide(ProblemApi);
    });
}
