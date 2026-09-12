import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, ManagedProblemMetadataConflictError, ValidationError } from '../error';
import type { ProblemDoc, TrainingNode } from '../interface';
import {
    deriveProgrammingStatementContent,
    emptyProgrammingStatement,
    normalizeProgrammingStatement,
    type ProgrammingStatement,
    type ProgrammingStatementFormat,
} from '../lib/programming-statement';
import type { KnowledgeMapOption, KnowledgeMindmapOption } from '../lib/problem-tag-canonical';
import { withProblemSetKind } from '../lib/training-kind';
import db from '../service/db';
import * as document from './document';
import {
    deriveManagedSourceTags,
    isCanonicalManagedSourceTag,
    isManagedAnnualSourceTag,
    MANAGED_FIXED_SOURCE_TAGS,
    MANAGED_SOURCE_TEMPLATES,
    normalizeManagedSourceMeta,
    type ManagedSourceMeta,
    type ManagedSourceTemplate,
} from './managed-problem-source';

export { classifyLegacyProgrammingTags, resolveProblemKnowledgeNodeIds } from '../lib/problem-tag-canonical';
export type { KnowledgeMindmapOption, LegacyProgrammingTagClassification } from '../lib/problem-tag-canonical';
export {
    deriveManagedSourceTags,
    formatManagedProblemPid,
    isCanonicalManagedSourceTag,
    isManagedAnnualSourceTag,
    MANAGED_SOURCE_TEMPLATES,
    managedPidCounterNamespace,
    normalizeManagedSourceMeta,
} from './managed-problem-source';
export type { ManagedSourceMeta, ManagedSourceTemplate, ManagedSourceTemplateDefinition } from './managed-problem-source';

const logger = new Logger('managed-problem-authoring');

export interface CanonicalProblemTagOption {
    value: string;
    label: string;
    group: '算法知识点' | '来源与赛事';
}

export interface ProgrammingTagNormalizationPreview {
    knowledgeMapId: ObjectId;
    knowledgeMapTitle: string;
    sourceTags: string[];
    selectedNodeIds: ObjectId[];
    nextTags: string[];
    retainedTags: string[];
    addedTags: string[];
    removedTags: string[];
    fingerprint: string;
    mindmapPathVersion?: MindmapPathVersion[];
}

export type ManagedMindmapOption = KnowledgeMindmapOption;

export interface ManagedTrainingOption {
    id: string;
    title: string;
    templates: ManagedSourceTemplate[];
    chapters: Array<{ id: number; title: string }>;
}

export interface ManagedTrainingPlacement {
    trainingId: ObjectId;
    chapterId: number;
}

export interface ManagedProblemTrainingPlacementView {
    trainingId: string;
    trainingTitle: string;
    chapterId: number;
    chapterTitle: string;
}

export interface ManagedProblemDraftInput {
    workingTitle: string;
    /** New web/batch creation uses structured-v1; raw package import must opt into legacy-import-v1. */
    content?: string;
    statementFormat?: ProgrammingStatementFormat;
    programmingStatement?: unknown;
    difficulty: number;
    /**
     * Canonical PID namespace selected before any number is reserved.
     * Draft preparation deliberately does not require it because it only
     * validates statement/source metadata. The creation boundary requires it
     * before allocating a PID.
     */
    pidNamespaceId?: unknown;
    sourceMeta: unknown;
    knowledgeMapId?: unknown;
    mindmapNodeIds: unknown;
    pendingTrainingPlacement?: unknown;
    authorUid?: number;
    batchImport?: unknown;
}

export interface ManagedProblemBatchImportIdentity {
    batchId: string;
    sourceProblemCode: string;
    identity: string;
    fingerprint: string;
}

export interface PreparedManagedProblemDraft {
    workingTitle: string;
    content: string;
    statementFormat: ProgrammingStatementFormat;
    programmingStatement?: ProgrammingStatement;
    difficulty: number;
    sourceMeta: ManagedSourceMeta;
    knowledgeMapId: ObjectId;
    selectedMindmapNodeIds: ObjectId[];
    pendingTrainingPlacement?: ManagedTrainingPlacement;
    tags: string[];
    authorUid?: number;
    batchImport?: ManagedProblemBatchImportIdentity;
}

export interface PreparedManagedProblemPublication {
    sourceMeta: ManagedSourceMeta;
    knowledgeMapId: ObjectId;
    selectedMindmapNodeIds: ObjectId[];
    pendingTrainingPlacement?: ManagedTrainingPlacement;
    tags: string[];
}

interface MindmapNodeRecord {
    _id: ObjectId;
    mapId: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    tags: string[];
    updatedAt: Date;
}

interface KnowledgeMapRecord {
    _id: ObjectId;
    title: string;
    rootNodeId: ObjectId;
    visibility: 'hidden' | 'public';
    updatedAt: Date;
}

export interface MindmapPathVersion {
    id: string;
    parentId: string | null;
    topic: string;
    updatedAt: string;
}

interface PidCounterDoc {
    domainId: string;
    namespace: string;
    value: number;
    updatedAt: Date;
}

const TEMPLATE_BY_ID = new Map(MANAGED_SOURCE_TEMPLATES.map((template) => [template.id, template]));
const mindmapNodesColl = db.collection<MindmapNodeRecord>('mindmap.nodes');
const knowledgeMapsColl = db.collection<KnowledgeMapRecord>('mindmap.maps');
export const managedPidCountersColl = db.collection<PidCounterDoc>('problem.pid_counters');

interface HydroMindmapMaterializeResult {
    mapId: ObjectId;
    mapTitle: string;
    nodeIds: ObjectId[];
    nodePaths: Array<{ id: string; label: string }>;
    tags: string[];
    pathVersion?: MindmapPathVersion[];
}

interface HydroMindmapMaterializeOptions {
    required?: boolean;
    requirePublicMap?: boolean;
    field?: 'knowledgeNodeIds' | 'mindmapNodeIds';
    includePathVersion?: boolean;
}

type HydroMindmapMaterialize = (mapId: unknown, nodeIds: unknown, options?: HydroMindmapMaterializeOptions) => Promise<HydroMindmapMaterializeResult>;

function getMindmapMaterialize(): HydroMindmapMaterialize {
    const hydro = globalThis as typeof globalThis & {
        Hydro?: { model?: { mindmap?: { materialize?: HydroMindmapMaterialize } } };
    };
    const materialize = hydro.Hydro?.model?.mindmap?.materialize;
    if (typeof materialize !== 'function') {
        throw new TypeError('krypton-mindmap materialize is not registered');
    }
    return materialize;
}

function isNamedError(error: unknown, name: string): error is Error & { params?: unknown[] } {
    return error instanceof Error && error.name === name;
}

function rethrowKnowledgeMaterializeError(error: unknown): never {
    if (error instanceof TypeError) throw error;
    if (isNamedError(error, 'MindmapConflictError')) {
        const payload = Array.isArray(error.params) && error.params.length ? error.params[0] : error.message;
        throw new ManagedProblemMetadataConflictError(payload as ConstructorParameters<typeof ManagedProblemMetadataConflictError>[0]);
    }
    throw error;
}

const MANAGED_PROBLEM_PID_INDEX = {
    key: { domainId: 1, docType: 1, pid: 1 },
    options: {
        name: 'problemPid',
        unique: true,
        partialFilterExpression: { docType: document.TYPE_PROBLEM, pid: { $type: 'string' } },
    },
} as const;

const MANAGED_PROBLEM_BATCH_IMPORT_INDEX = {
    key: { domainId: 1, docType: 1, 'batchImport.identity': 1 },
    options: {
        name: 'problemBatchImportIdentity',
        unique: true,
        partialFilterExpression: { docType: document.TYPE_PROBLEM, hasBatchImportIdentity: true },
    },
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parseInteger(value: unknown, field: string, minimum: number, maximum: number): number {
    const normalized = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
        throw new ValidationError(field);
    }
    return normalized;
}

export function normalizeManagedProblemBatchImport(input: unknown): ManagedProblemBatchImportIdentity {
    if (!isPlainObject(input)) throw new ValidationError('batchImport');
    const unknown = Object.keys(input).filter((field) => !['batchId', 'sourceProblemCode', 'fingerprint'].includes(field));
    if (unknown.length) throw new ValidationError('batchImport', null, localizedErrorText`批量导入标识不接受字段：${unknown.join(', ')}`);
    const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : '';
    const sourceProblemCode = typeof input.sourceProblemCode === 'string' ? input.sourceProblemCode.trim() : '';
    const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.trim().toLowerCase() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(batchId)) throw new ValidationError('batchId');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(sourceProblemCode)) throw new ValidationError('sourceProblemCode');
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new ValidationError('fingerprint');
    return { batchId, sourceProblemCode, identity: `${batchId}:${sourceProblemCode}`, fingerprint };
}

function normalizeNodeIds(nodeIds: unknown, required: boolean, field: 'knowledgeNodeIds' | 'mindmapNodeIds'): string[] {
    if (!Array.isArray(nodeIds)) throw new ValidationError(field);
    const normalized = nodeIds.map((value) => {
        if (value instanceof ObjectId) return value.toHexString();
        if (typeof value !== 'string') throw new ValidationError(field);
        const trimmed = value.trim();
        if (!trimmed || !ObjectId.isValid(trimmed)) throw new ValidationError(field);
        return new ObjectId(trimmed).toHexString();
    });
    if (!normalized.length) {
        if (required) throw new ValidationError(field);
        return [];
    }
    return [...new Set(normalized)].sort();
}

function normalizeMapId(value: unknown, field = 'knowledgeMapId'): ObjectId | null {
    const normalized = value instanceof ObjectId ? value.toHexString() : typeof value === 'string' ? value.trim() : '';
    if (!normalized) return null;
    if (!ObjectId.isValid(normalized)) throw new ValidationError(field);
    return new ObjectId(normalized);
}

async function loadMindmapNodes(mapId: ObjectId): Promise<MindmapNodeRecord[]> {
    return mindmapNodesColl.find({ mapId }, { projection: { _id: 1, mapId: 1, parentId: 1, topic: 1, tags: 1, updatedAt: 1 } }).toArray();
}

function buildNodePath(node: MindmapNodeRecord, byId: Map<string, MindmapNodeRecord>, expectedRootNodeId: ObjectId): MindmapNodeRecord[] {
    const path: MindmapNodeRecord[] = [];
    const visited = new Set<string>();
    let current: MindmapNodeRecord | undefined = node;
    while (current) {
        const id = current._id.toHexString();
        if (visited.has(id)) throw new ManagedProblemMetadataConflictError(localizedErrorText`导图存在循环`);
        visited.add(id);
        path.push(current);
        if (!current.parentId) break;
        current = byId.get(current.parentId.toHexString());
        if (!current) throw new ManagedProblemMetadataConflictError(localizedErrorText`导图祖先节点已删除`);
    }
    path.reverse();
    if (!path[0]?._id.equals(expectedRootNodeId) || path[0].parentId !== null) {
        throw new ManagedProblemMetadataConflictError(localizedErrorText`导图节点不属于该图的唯一根节点`);
    }
    return path;
}

export async function listKnowledgeMapsForProblemSelection(includeHidden = false): Promise<KnowledgeMapOption[]> {
    const maps = await knowledgeMapsColl
        .find(includeHidden ? {} : { visibility: 'public' }, { projection: { _id: 1, title: 1, visibility: 1 } })
        .sort({ title: 1, _id: 1 })
        .toArray();
    return maps.map((map) => ({ id: map._id.toHexString(), title: map.title, visibility: map.visibility }));
}

export async function listKnowledgeMindmapOptions(mapIdInput?: unknown, includeHidden = false): Promise<KnowledgeMindmapOption[]> {
    const requestedMapId = normalizeMapId(mapIdInput);
    const maps = await knowledgeMapsColl
        .find(
            {
                ...(requestedMapId ? { _id: requestedMapId } : {}),
                ...(includeHidden ? {} : { visibility: 'public' }),
            },
            { projection: { _id: 1, title: 1, rootNodeId: 1, visibility: 1 } },
        )
        .sort({ title: 1, _id: 1 })
        .toArray();
    if (requestedMapId && maps.length !== 1) throw new ManagedProblemMetadataConflictError(localizedErrorText`所属导图不存在或不可选`);
    const options: KnowledgeMindmapOption[] = [];
    for (const map of maps) {
        const nodes = await loadMindmapNodes(map._id);
        const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
        options.push(
            ...nodes
                .filter((node) => Array.isArray(node.tags) && node.tags.some((tag) => typeof tag === 'string' && tag.trim()))
                .map((node) => ({
                    id: node._id.toHexString(),
                    mapId: map._id.toHexString(),
                    mapTitle: map.title,
                    label: buildNodePath(node, byId, map.rootNodeId)
                        .map((part) => part.topic)
                        .join(' / '),
                    tags: [...new Set(node.tags.map((tag) => tag.trim()).filter(Boolean))],
                })),
        );
    }
    return options.sort((left, right) => left.mapTitle.localeCompare(right.mapTitle, 'zh-CN') || left.label.localeCompare(right.label, 'zh-CN'));
}

export const listManagedMindmapOptions = listKnowledgeMindmapOptions;

function requireStoredProblemTags(input: unknown): string[] {
    if (!Array.isArray(input) || input.some((tag) => typeof tag !== 'string')) {
        throw new TypeError('stored problem tags must be a string array');
    }
    return [...input];
}

/** Re-read the live tree and build the exact atomic replacement shown in the confirmation dialog. */
export async function previewProgrammingTagNormalization(input: {
    domainId: string;
    docId: number;
    problemKind?: unknown;
    structureRevision?: number;
    currentTags: unknown;
    currentKnowledgeMapId: unknown;
    currentKnowledgeNodeIds: unknown;
    targetKnowledgeMapId: unknown;
    selectedNodeIds: unknown;
}): Promise<ProgrammingTagNormalizationPreview> {
    const currentTags = requireStoredProblemTags(input.currentTags);
    const currentKnowledgeNodeIds = normalizeNodeIds(input.currentKnowledgeNodeIds ?? [], false, 'knowledgeNodeIds');
    if (input.structureRevision !== undefined && (!Number.isSafeInteger(input.structureRevision) || input.structureRevision < 1)) {
        throw new TypeError('programming problem structureRevision must be a positive integer');
    }
    const knowledge = await materializeKnowledgeMindmapState(input.selectedNodeIds, {
        required: true,
        knowledgeMapId: input.targetKnowledgeMapId,
        requireMap: true,
        requirePublicMap: true,
        field: 'knowledgeNodeIds',
        includePathVersion: true,
    });
    const currentKnowledgeMapId = normalizeMapId(input.currentKnowledgeMapId);
    if (!currentKnowledgeMapId) throw new ManagedProblemMetadataConflictError(localizedErrorText`题目缺少所属导图，请先完成站点迁移`);
    const sourceTags = input.problemKind === undefined || input.problemKind === 'programming' ? currentTags.filter(isCanonicalManagedSourceTag) : [];
    const nextTags = [...new Set([...sourceTags, ...knowledge.tags])];
    const currentSet = new Set(currentTags);
    const nextSet = new Set(nextTags);
    const retainedTags = currentTags.filter((tag) => nextSet.has(tag));
    const addedTags = nextTags.filter((tag) => !currentSet.has(tag));
    const removedTags = currentTags.filter((tag) => !nextSet.has(tag));
    const fingerprint = createHash('sha256')
        .update(
            JSON.stringify({
                domainId: input.domainId,
                docId: input.docId,
                problemKind: input.problemKind ?? 'programming',
                structureRevision: input.structureRevision ?? null,
                currentTags,
                currentKnowledgeMapId: currentKnowledgeMapId.toHexString(),
                currentKnowledgeNodeIds,
                targetKnowledgeMapId: knowledge.mapId.toHexString(),
                selectedNodeIds: knowledge.nodeIds.map(String),
                nextTags,
                mindmapPathVersion: knowledge.pathVersion,
            }),
        )
        .digest('hex');
    return {
        knowledgeMapId: knowledge.mapId,
        knowledgeMapTitle: knowledge.mapTitle,
        sourceTags,
        selectedNodeIds: knowledge.nodeIds,
        nextTags,
        retainedTags,
        addedTags,
        removedTags,
        fingerprint,
        mindmapPathVersion: knowledge.pathVersion,
    };
}

/**
 * Shared P2.14 canonical tag directory.
 *
 * Knowledge choices come from live tagged mindmap nodes and retain their full
 * path. Source choices come from the managed source templates above; only
 * registered annual tags already present on a problem are included. The
 * payload deliberately contains no problem counts.
 */
export async function listCanonicalProblemTagOptions(domainId: string): Promise<CanonicalProblemTagOption[]> {
    const [mindmapOptions, existingProblemTags] = await Promise.all([
        listKnowledgeMindmapOptions(),
        document.coll.distinct('tag', { domainId, docType: document.TYPE_PROBLEM }),
    ]);
    const byValue = new Map<string, CanonicalProblemTagOption>();
    const knowledgePaths = new Map<string, Set<string>>();
    for (const option of mindmapOptions) {
        for (const tag of option.tags) {
            const paths = knowledgePaths.get(tag) || new Set<string>();
            paths.add(`${option.mapTitle} / ${option.label}`);
            knowledgePaths.set(tag, paths);
        }
    }
    for (const [value, paths] of knowledgePaths) {
        byValue.set(value, {
            value,
            label: [...paths].sort((left, right) => left.localeCompare(right, 'zh-CN')).join('；'),
            group: '算法知识点',
        });
    }

    const sourceTags = new Set<string>(MANAGED_FIXED_SOURCE_TAGS);
    for (const tag of existingProblemTags as unknown[]) {
        if (isManagedAnnualSourceTag(tag)) sourceTags.add(tag);
    }
    for (const value of sourceTags) byValue.set(value, { value, label: value, group: '来源与赛事' });

    const groupOrder = { 算法知识点: 0, 来源与赛事: 1 } as const;
    return [...byValue.values()].sort(
        (left, right) => groupOrder[left.group] - groupOrder[right.group] || left.label.localeCompare(right.label, 'zh-CN'),
    );
}

/** Re-read the live tree and materialize every tagged ancestor of each selection. */
async function materializeKnowledgeMindmapState(
    nodeIdsInput: unknown,
    options: {
        required?: boolean;
        requireMap?: boolean;
        allowSolePublicMap?: boolean;
        requirePublicMap?: boolean;
        knowledgeMapId?: unknown;
        field?: 'knowledgeNodeIds' | 'mindmapNodeIds';
        includePathVersion?: boolean;
    } = {},
): Promise<{
    mapId: ObjectId;
    mapTitle: string;
    nodeIds: ObjectId[];
    nodePaths: Array<{ id: string; label: string }>;
    tags: string[];
    pathVersion: MindmapPathVersion[];
}> {
    const nodeIds = normalizeNodeIds(nodeIdsInput, options.required === true, options.field || 'knowledgeNodeIds');
    let mapId = normalizeMapId(options.knowledgeMapId);
    if (!mapId && options.allowSolePublicMap) {
        const maps = await knowledgeMapsColl
            .find({ visibility: 'public' }, { projection: { _id: 1 } })
            .sort({ title: 1, _id: 1 })
            .limit(2)
            .toArray();
        if (maps.length === 1) mapId = maps[0]._id;
        else if (maps.length > 1) throw new ValidationError('knowledgeMapId', null, localizedErrorText`存在多张公开导图，请明确选择所属导图`);
    }
    if (!mapId) {
        if (options.requireMap !== false) throw new ValidationError('knowledgeMapId');
        throw new TypeError('materializeKnowledgeMindmapState requires a knowledge map');
    }
    try {
        const result = await getMindmapMaterialize()(mapId, nodeIds, {
            required: options.required === true,
            requirePublicMap: options.requirePublicMap,
            field: options.field || 'knowledgeNodeIds',
            includePathVersion: options.includePathVersion === true,
        });
        return {
            mapId: result.mapId,
            mapTitle: result.mapTitle,
            nodeIds: result.nodeIds,
            nodePaths: result.nodePaths,
            tags: result.tags,
            pathVersion: result.pathVersion ?? [],
        };
    } catch (error) {
        rethrowKnowledgeMaterializeError(error);
    }
}

export async function materializeKnowledgeMindmapTags(
    nodeIdsInput: unknown,
    options: {
        required?: boolean;
        requireMap?: boolean;
        allowSolePublicMap?: boolean;
        requirePublicMap?: boolean;
        knowledgeMapId?: unknown;
        field?: 'knowledgeNodeIds' | 'mindmapNodeIds';
    } = {},
): Promise<{ mapId: ObjectId; mapTitle: string; nodeIds: ObjectId[]; nodePaths: Array<{ id: string; label: string }>; tags: string[] }> {
    const { mapId, mapTitle, nodeIds, nodePaths, tags } = await materializeKnowledgeMindmapState(nodeIdsInput, options);
    return { mapId, mapTitle, nodeIds, nodePaths, tags };
}

export function materializeManagedMindmapTags(
    nodeIdsInput: unknown,
    knowledgeMapId?: unknown,
    required = true,
): Promise<{ mapId: ObjectId; mapTitle: string; nodeIds: ObjectId[]; nodePaths: Array<{ id: string; label: string }>; tags: string[] }> {
    return materializeKnowledgeMindmapTags(nodeIdsInput, {
        required,
        requireMap: true,
        allowSolePublicMap: !knowledgeMapId,
        requirePublicMap: true,
        knowledgeMapId,
        field: 'mindmapNodeIds',
    });
}

/** Re-read live mindmap nodes before any managed draft patch reaches Mongo. */
export async function canonicalizeManagedDraftMindmapPatch(
    current: Pick<ProblemDoc, 'authoringMode' | 'managedAuthoring' | 'knowledgeMapId'>,
    $set: Partial<ProblemDoc>,
): Promise<string[] | null> {
    if (current.authoringMode !== 'managed' || !Object.hasOwn($set, 'managedAuthoring')) return null;
    if (current.managedAuthoring?.metadataStatus !== 'draft' || $set.managedAuthoring?.metadataStatus !== 'draft') {
        throw new ValidationError('knowledgeNodeIds', null, localizedErrorText`只有托管草稿可以提交知识节点建议`);
    }
    const materialized = await materializeKnowledgeMindmapTags($set.managedAuthoring.selectedMindmapNodeIds, {
        required: false,
        requireMap: true,
        requirePublicMap: true,
        knowledgeMapId: current.knowledgeMapId,
        field: 'knowledgeNodeIds',
    });
    $set.managedAuthoring = {
        ...$set.managedAuthoring,
        selectedMindmapNodeIds: materialized.nodeIds,
    };
    return materialized.nodeIds.map(String);
}

function canonicalTrainingChapters(dag: unknown): TrainingNode[] {
    if (!Array.isArray(dag)) return [];
    return dag.filter(
        (node): node is TrainingNode =>
            isPlainObject(node) && Number.isSafeInteger(node._id) && typeof node.title === 'string' && Array.isArray(node.pids),
    );
}

/** Existing training membership determines which fixed source templates it accepts. */
export async function listManagedTrainingOptions(domainId: string): Promise<ManagedTrainingOption[]> {
    const trainings = await document.coll
        .find(withProblemSetKind({ domainId, docType: document.TYPE_TRAINING }), { projection: { docId: 1, title: 1, dag: 1 } })
        .sort({ title: 1, docId: 1 })
        .toArray();
    const pids = [
        ...new Set(
            trainings.flatMap((training) =>
                canonicalTrainingChapters(training.dag)
                    .flatMap((chapter) => chapter.pids)
                    .map(Number)
                    .filter(Number.isSafeInteger),
            ),
        ),
    ];
    const problems = pids.length
        ? await document.coll.find({ domainId, docType: document.TYPE_PROBLEM, docId: { $in: pids } }, { projection: { docId: 1, tag: 1 } }).toArray()
        : [];
    const tagsByPid = new Map(problems.map((pdoc) => [pdoc.docId, new Set(Array.isArray(pdoc.tag) ? pdoc.tag : [])]));
    const result: ManagedTrainingOption[] = [];
    for (const training of trainings) {
        const chapters = canonicalTrainingChapters(training.dag);
        const memberTags = new Set(chapters.flatMap((chapter) => chapter.pids.flatMap((pid) => [...(tagsByPid.get(Number(pid)) || [])])));
        const templates = MANAGED_SOURCE_TEMPLATES.filter((template) => memberTags.has(template.trainingAnchorTag)).map((template) => template.id);
        if (!templates.length) continue;
        result.push({
            id: training.docId.toHexString(),
            title: training.title,
            templates,
            chapters: chapters.map((chapter) => ({ id: chapter._id, title: chapter.title })),
        });
    }
    return result;
}

/** Read the persisted training membership of an existing problem. */
export async function listManagedProblemTrainingPlacements(domainId: string, pid: number): Promise<ManagedProblemTrainingPlacementView[]> {
    const trainings = await document.coll
        .find(withProblemSetKind({ domainId, docType: document.TYPE_TRAINING }), { projection: { docId: 1, title: 1, dag: 1 } })
        .sort({ title: 1, docId: 1 })
        .toArray();
    return trainings.flatMap((training) =>
        canonicalTrainingChapters(training.dag)
            .filter((chapter) => chapter.pids.some((memberPid) => Number(memberPid) === pid))
            .map((chapter) => ({
                trainingId: training.docId.toHexString(),
                trainingTitle: training.title,
                chapterId: chapter._id,
                chapterTitle: chapter.title,
            })),
    );
}

/** Validate one optional pending placement against live training membership. */
export async function validateManagedTrainingPlacement(
    domainId: string,
    template: ManagedSourceTemplate,
    placementInput: unknown,
): Promise<ManagedTrainingPlacement | undefined> {
    if (placementInput === undefined || placementInput === null || placementInput === '') return undefined;
    if (!isPlainObject(placementInput)) throw new ValidationError('trainingPlacement');
    const unknown = Object.keys(placementInput).filter((field) => !['trainingId', 'chapterId'].includes(field));
    if (unknown.length) throw new ValidationError('trainingPlacement');
    const trainingIdValue =
        placementInput.trainingId instanceof ObjectId
            ? placementInput.trainingId.toHexString()
            : typeof placementInput.trainingId === 'string'
              ? placementInput.trainingId.trim()
              : '';
    if (!ObjectId.isValid(trainingIdValue)) throw new ValidationError('trainingId');
    const chapterId = parseInteger(placementInput.chapterId, 'chapterId', 1, Number.MAX_SAFE_INTEGER);
    const trainingId = new ObjectId(trainingIdValue);
    const training = await document.coll.findOne(withProblemSetKind({ domainId, docType: document.TYPE_TRAINING, docId: trainingId }), {
        projection: { dag: 1 },
    });
    const chapters = canonicalTrainingChapters(training?.dag);
    const chapter = chapters.find((candidate) => candidate._id === chapterId);
    if (!training || !chapter) throw new ManagedProblemMetadataConflictError(localizedErrorText`待挂训练或章节已删除`);
    const memberPids = [
        ...new Set(
            chapters
                .flatMap((candidate) => candidate.pids)
                .map(Number)
                .filter(Number.isSafeInteger),
        ),
    ];
    const anchor = TEMPLATE_BY_ID.get(template)!.trainingAnchorTag;
    const supportingProblem = memberPids.length
        ? await document.coll.findOne(
              { domainId, docType: document.TYPE_PROBLEM, docId: { $in: memberPids }, tag: anchor },
              { projection: { docId: 1 } },
          )
        : null;
    if (!supportingProblem) {
        throw new ManagedProblemMetadataConflictError(localizedErrorText`该训练不接受来源模板 ${template}`);
    }
    return { trainingId, chapterId };
}

export async function prepareManagedProblemDraft(domainId: string, input: ManagedProblemDraftInput): Promise<PreparedManagedProblemDraft> {
    const workingTitle = typeof input.workingTitle === 'string' ? input.workingTitle.trim() : '';
    if (!workingTitle) throw new ValidationError('title');
    const statementFormat = input.statementFormat || 'structured-v1';
    let programmingStatement: ProgrammingStatement | undefined;
    let content: string;
    if (statementFormat === 'structured-v1') {
        programmingStatement = normalizeProgrammingStatement(input.programmingStatement ?? emptyProgrammingStatement());
        content = deriveProgrammingStatementContent(programmingStatement, input.content);
    } else if (statementFormat === 'legacy-import-v1') {
        if (typeof input.content !== 'string') throw new ValidationError('content');
        if (input.programmingStatement !== undefined) throw new ValidationError('programmingStatement');
        content = input.content;
    } else {
        throw new ValidationError('statementFormat');
    }
    const difficulty = parseInteger(input.difficulty, 'difficulty', 1, 10);
    const sourceMeta = normalizeManagedSourceMeta(input.sourceMeta);
    const mindmap = await materializeManagedMindmapTags(input.mindmapNodeIds, input.knowledgeMapId, false);
    const pendingTrainingPlacement = await validateManagedTrainingPlacement(domainId, sourceMeta.template, input.pendingTrainingPlacement);
    const sourceTags = deriveManagedSourceTags(sourceMeta);
    const authorUid = input.authorUid === undefined ? undefined : parseInteger(input.authorUid, 'authorUid', 1, Number.MAX_SAFE_INTEGER);
    const batchImport = input.batchImport === undefined ? undefined : normalizeManagedProblemBatchImport(input.batchImport);
    return {
        workingTitle,
        content,
        statementFormat,
        ...(programmingStatement ? { programmingStatement } : {}),
        difficulty,
        sourceMeta,
        knowledgeMapId: mindmap.mapId,
        selectedMindmapNodeIds: mindmap.nodeIds,
        ...(pendingTrainingPlacement ? { pendingTrainingPlacement } : {}),
        tags: [...new Set([...sourceTags, ...mindmap.tags])],
        ...(authorUid ? { authorUid } : {}),
        ...(batchImport ? { batchImport } : {}),
    };
}

/** Re-read every live catalog dependency immediately before administrator publication. */
export async function prepareManagedProblemPublication(
    domainId: string,
    pdoc: Pick<ProblemDoc, 'docId' | 'sourceMeta' | 'managedAuthoring' | 'knowledgeMapId'>,
): Promise<PreparedManagedProblemPublication> {
    let sourceMeta: ManagedSourceMeta;
    let mindmap: Awaited<ReturnType<typeof materializeManagedMindmapTags>>;
    try {
        sourceMeta = normalizeManagedSourceMeta(pdoc.sourceMeta);
        mindmap = await materializeManagedMindmapTags(pdoc.managedAuthoring?.selectedMindmapNodeIds, pdoc.knowledgeMapId, true);
    } catch (error) {
        if (error instanceof ManagedProblemMetadataConflictError) throw error;
        const conflict = new ManagedProblemMetadataConflictError(localizedErrorText`来源或算法标签已失效`);
        Object.defineProperty(conflict, 'cause', { value: error, configurable: true });
        throw conflict;
    }
    let pendingTrainingPlacement: ManagedTrainingPlacement | undefined;
    try {
        pendingTrainingPlacement = await validateManagedTrainingPlacement(
            domainId,
            sourceMeta.template,
            pdoc.managedAuthoring?.pendingTrainingPlacement,
        );
    } catch (error) {
        if (error instanceof ManagedProblemMetadataConflictError) throw error;
        const conflict = new ManagedProblemMetadataConflictError(localizedErrorText`待挂训练字段已失效`);
        Object.defineProperty(conflict, 'cause', { value: error, configurable: true });
        throw conflict;
    }
    if (pendingTrainingPlacement) {
        const training = await document.coll.findOne(
            withProblemSetKind({
                domainId,
                docType: document.TYPE_TRAINING,
                docId: pendingTrainingPlacement.trainingId,
            }),
            { projection: { dag: 1 } },
        );
        const chapters = canonicalTrainingChapters(training?.dag);
        const chapter = chapters.find((candidate) => candidate._id === pendingTrainingPlacement.chapterId);
        if (!chapter) throw new ManagedProblemMetadataConflictError(localizedErrorText`待挂训练或章节已删除`);
        if (chapters.some((candidate) => candidate.pids.map(Number).includes(pdoc.docId))) {
            throw new ManagedProblemMetadataConflictError(localizedErrorText`题目已存在于待挂训练`);
        }
    }
    return {
        sourceMeta,
        knowledgeMapId: mindmap.mapId,
        selectedMindmapNodeIds: mindmap.nodeIds,
        ...(pendingTrainingPlacement ? { pendingTrainingPlacement } : {}),
        tags: [...new Set([...deriveManagedSourceTags(sourceMeta), ...mindmap.tags])],
    };
}

export async function ensureManagedProblemAuthoringIndexes(): Promise<void> {
    try {
        await managedPidCountersColl.createIndex({ domainId: 1, namespace: 1 }, { name: 'problem_pid_counter_namespace_uq', unique: true });
        await document.coll.createIndex(MANAGED_PROBLEM_PID_INDEX.key, MANAGED_PROBLEM_PID_INDEX.options);
        await document.coll.createIndex(MANAGED_PROBLEM_BATCH_IMPORT_INDEX.key, MANAGED_PROBLEM_BATCH_IMPORT_INDEX.options);
        const indexes = await document.coll.listIndexes().toArray();
        const actual = indexes.find((index) => index.name === MANAGED_PROBLEM_PID_INDEX.options.name);
        if (
            !actual ||
            actual.unique !== true ||
            !isDeepStrictEqual(actual.key, MANAGED_PROBLEM_PID_INDEX.key) ||
            !isDeepStrictEqual(actual.partialFilterExpression, MANAGED_PROBLEM_PID_INDEX.options.partialFilterExpression)
        ) {
            throw new Error('Problem PID index is not the required partial unique index');
        }
        const batchImportIndex = indexes.find((index) => index.name === MANAGED_PROBLEM_BATCH_IMPORT_INDEX.options.name);
        if (
            !batchImportIndex ||
            batchImportIndex.unique !== true ||
            !isDeepStrictEqual(batchImportIndex.key, MANAGED_PROBLEM_BATCH_IMPORT_INDEX.key) ||
            !isDeepStrictEqual(batchImportIndex.partialFilterExpression, MANAGED_PROBLEM_BATCH_IMPORT_INDEX.options.partialFilterExpression)
        ) {
            throw new Error('Problem batch import identity index is not the required partial unique index');
        }
        logger.info(
            'Managed authoring indexes verified counter=%s problem=%s batchImport=%s',
            'problem_pid_counter_namespace_uq',
            MANAGED_PROBLEM_PID_INDEX.options.name,
            MANAGED_PROBLEM_BATCH_IMPORT_INDEX.options.name,
        );
    } catch (error) {
        logger.error('Managed authoring index verification failed error=%o', error);
        throw error;
    }
}
