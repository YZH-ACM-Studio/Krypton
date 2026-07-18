import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Logger } from '@hydrooj/utils';
import { ManagedProblemMetadataConflictError, ValidationError } from '../error';
import type { ProblemDoc, TrainingNode } from '../interface';
import type { KnowledgeMindmapOption } from '../lib/problem-tag-canonical';
import db from '../service/db';
import * as document from './document';
import {
    deriveManagedSourceTags,
    formatManagedProblemPid,
    isCanonicalManagedSourceTag,
    isManagedAnnualSourceTag,
    managedPidCounterNamespace,
    MANAGED_FIXED_SOURCE_TAGS,
    MANAGED_SOURCE_TEMPLATES,
    normalizeManagedSourceMeta,
    type ManagedSourceMeta,
    type ManagedSourceTemplate,
} from './managed-problem-source';

export { classifyLegacyProgrammingTags } from '../lib/problem-tag-canonical';
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
    content: string;
    difficulty: number;
    sourceMeta: unknown;
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
    difficulty: number;
    sourceMeta: ManagedSourceMeta;
    selectedMindmapNodeIds: ObjectId[];
    pendingTrainingPlacement?: ManagedTrainingPlacement;
    tags: string[];
    authorUid?: number;
    batchImport?: ManagedProblemBatchImportIdentity;
}

export interface PreparedManagedProblemPublication {
    sourceMeta: ManagedSourceMeta;
    selectedMindmapNodeIds: ObjectId[];
    pendingTrainingPlacement?: ManagedTrainingPlacement;
    tags: string[];
}

interface MindmapNodeRecord {
    _id: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    tags: string[];
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
export const managedPidCountersColl = db.collection<PidCounterDoc>('problem.pid_counters');

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
    if (unknown.length) throw new ValidationError('batchImport', null, `批量导入标识不接受字段：${unknown.join(', ')}`);
    const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : '';
    const sourceProblemCode = typeof input.sourceProblemCode === 'string' ? input.sourceProblemCode.trim() : '';
    const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.trim().toLowerCase() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(batchId)) throw new ValidationError('batchId');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(sourceProblemCode)) throw new ValidationError('sourceProblemCode');
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new ValidationError('fingerprint');
    return { batchId, sourceProblemCode, identity: `${batchId}:${sourceProblemCode}`, fingerprint };
}

/** Atomically reserve one PID. Missing counters are an operator error, never auto-initialized. */
export async function reserveManagedProblemPid(domainId: string, sourceMetaInput: unknown): Promise<string> {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    const namespace = managedPidCounterNamespace(sourceMeta);
    let counter: PidCounterDoc | null = null;
    try {
        counter = await managedPidCountersColl.findOneAndUpdate(
            { domainId, namespace },
            { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
            { returnDocument: 'after' },
        );
        if (!counter) throw new Error(`PID counter is not initialized: ${domainId}/${namespace}`);
        const pid = formatManagedProblemPid(sourceMeta, counter.value);
        logger.info('Managed PID reserved domain=%s namespace=%s sequence=%d pid=%s stage=reserved', domainId, namespace, counter.value, pid);
        return pid;
    } catch (error) {
        logger.error(
            'Managed PID reservation failed domain=%s namespace=%s sequence=%s stage=reserve error=%o',
            domainId,
            namespace,
            counter?.value,
            error,
        );
        throw error;
    }
}

function normalizeNodeIds(nodeIds: unknown, required: boolean, field: 'knowledgeNodeIds' | 'mindmapNodeIds'): string[] {
    if (!Array.isArray(nodeIds)) throw new ValidationError(field);
    const normalized = nodeIds
        .map((value) => (value instanceof ObjectId ? value.toHexString() : typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);
    if (!normalized.length) {
        if (required) throw new ValidationError(field);
        return [];
    }
    if (normalized.some((value) => !ObjectId.isValid(value))) throw new ValidationError(field);
    return [...new Set(normalized)].sort();
}

async function loadMindmapNodes(): Promise<MindmapNodeRecord[]> {
    return mindmapNodesColl.find({}, { projection: { _id: 1, parentId: 1, topic: 1, tags: 1, updatedAt: 1 } }).toArray();
}

function buildNodePath(node: MindmapNodeRecord, byId: Map<string, MindmapNodeRecord>): MindmapNodeRecord[] {
    const path: MindmapNodeRecord[] = [];
    const visited = new Set<string>();
    let current: MindmapNodeRecord | undefined = node;
    while (current) {
        const id = current._id.toHexString();
        if (visited.has(id)) throw new ManagedProblemMetadataConflictError('导图存在循环');
        visited.add(id);
        path.push(current);
        if (!current.parentId) break;
        current = byId.get(current.parentId.toHexString());
        if (!current) throw new ManagedProblemMetadataConflictError('导图祖先节点已删除');
    }
    return path.reverse();
}

export async function listKnowledgeMindmapOptions(): Promise<KnowledgeMindmapOption[]> {
    const nodes = await loadMindmapNodes();
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    return nodes
        .filter((node) => Array.isArray(node.tags) && node.tags.some((tag) => typeof tag === 'string' && tag.trim()))
        .map((node) => ({
            id: node._id.toHexString(),
            label: buildNodePath(node, byId)
                .map((part) => part.topic)
                .join(' / '),
            tags: [...new Set(node.tags.map((tag) => tag.trim()).filter(Boolean))],
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
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
    structureRevision?: number;
    currentTags: unknown;
    selectedNodeIds: unknown;
}): Promise<ProgrammingTagNormalizationPreview> {
    const currentTags = requireStoredProblemTags(input.currentTags);
    if (input.structureRevision !== undefined && (!Number.isSafeInteger(input.structureRevision) || input.structureRevision < 1)) {
        throw new TypeError('programming problem structureRevision must be a positive integer');
    }
    const knowledge = await materializeKnowledgeMindmapState(input.selectedNodeIds, {
        required: true,
        field: 'knowledgeNodeIds',
        includePathVersion: true,
    });
    const sourceTags = currentTags.filter(isCanonicalManagedSourceTag);
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
                structureRevision: input.structureRevision ?? null,
                currentTags,
                selectedNodeIds: knowledge.nodeIds.map(String),
                nextTags,
                mindmapPathVersion: knowledge.pathVersion,
            }),
        )
        .digest('hex');
    return {
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
            paths.add(option.label);
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
    options: { required?: boolean; field?: 'knowledgeNodeIds' | 'mindmapNodeIds'; includePathVersion?: boolean } = {},
): Promise<{ nodeIds: ObjectId[]; tags: string[]; pathVersion: MindmapPathVersion[] }> {
    const nodeIds = normalizeNodeIds(nodeIdsInput, options.required === true, options.field || 'knowledgeNodeIds');
    if (!nodeIds.length) return { nodeIds: [], tags: [], pathVersion: [] };
    const nodes = await loadMindmapNodes();
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    const tags: string[] = [];
    const pathVersion = new Map<string, MindmapPathVersion>();
    for (const id of nodeIds) {
        const node = byId.get(id);
        if (!node || !Array.isArray(node.tags) || !node.tags.some((tag) => typeof tag === 'string' && tag.trim())) {
            throw new ManagedProblemMetadataConflictError(`导图节点 ${id} 已删除或不可选`);
        }
        for (const pathNode of buildNodePath(node, byId)) {
            if (options.includePathVersion) {
                if (!(pathNode.updatedAt instanceof Date) || Number.isNaN(pathNode.updatedAt.getTime())) {
                    throw new TypeError(`mindmap node ${pathNode._id.toHexString()} updatedAt must be a valid date`);
                }
                const pathNodeId = pathNode._id.toHexString();
                pathVersion.set(pathNodeId, {
                    id: pathNodeId,
                    parentId: pathNode.parentId?.toHexString() || null,
                    topic: pathNode.topic,
                    updatedAt: pathNode.updatedAt.toISOString(),
                });
            }
            for (const tag of Array.isArray(pathNode.tags) ? pathNode.tags : []) {
                const normalized = typeof tag === 'string' ? tag.trim() : '';
                if (normalized && !tags.includes(normalized)) tags.push(normalized);
            }
        }
    }
    return {
        nodeIds: nodeIds.map((id) => new ObjectId(id)),
        tags,
        pathVersion: [...pathVersion.values()].sort((left, right) => left.id.localeCompare(right.id)),
    };
}

export async function materializeKnowledgeMindmapTags(
    nodeIdsInput: unknown,
    options: { required?: boolean; field?: 'knowledgeNodeIds' | 'mindmapNodeIds' } = {},
): Promise<{ nodeIds: ObjectId[]; tags: string[] }> {
    const { nodeIds, tags } = await materializeKnowledgeMindmapState(nodeIdsInput, options);
    return { nodeIds, tags };
}

export function materializeManagedMindmapTags(nodeIdsInput: unknown): Promise<{ nodeIds: ObjectId[]; tags: string[] }> {
    return materializeKnowledgeMindmapTags(nodeIdsInput, { required: true, field: 'mindmapNodeIds' });
}

/** Re-read live mindmap nodes before any managed draft patch reaches Mongo. */
export async function canonicalizeManagedDraftMindmapPatch(
    current: Pick<ProblemDoc, 'authoringMode' | 'managedAuthoring'>,
    $set: Partial<ProblemDoc>,
): Promise<string[] | null> {
    if (current.authoringMode !== 'managed' || !Object.hasOwn($set, 'managedAuthoring')) return null;
    if (current.managedAuthoring?.metadataStatus !== 'draft' || $set.managedAuthoring?.metadataStatus !== 'draft') {
        throw new ValidationError('knowledgeNodeIds', null, '只有托管草稿可以提交知识节点建议');
    }
    const materialized = await materializeKnowledgeMindmapTags($set.managedAuthoring.selectedMindmapNodeIds, {
        required: true,
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
        .find({ domainId, docType: document.TYPE_TRAINING, kind: { $ne: 'course' } }, { projection: { docId: 1, title: 1, dag: 1 } })
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
        .find({ domainId, docType: document.TYPE_TRAINING, kind: { $ne: 'course' } }, { projection: { docId: 1, title: 1, dag: 1 } })
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
    const training = await document.coll.findOne(
        { domainId, docType: document.TYPE_TRAINING, docId: trainingId, kind: { $ne: 'course' } },
        { projection: { dag: 1 } },
    );
    const chapters = canonicalTrainingChapters(training?.dag);
    const chapter = chapters.find((candidate) => candidate._id === chapterId);
    if (!training || !chapter) throw new ManagedProblemMetadataConflictError('待挂训练或章节已删除');
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
    if (!supportingProblem) throw new ManagedProblemMetadataConflictError(`该训练不接受来源模板 ${template}`);
    return { trainingId, chapterId };
}

export async function prepareManagedProblemDraft(domainId: string, input: ManagedProblemDraftInput): Promise<PreparedManagedProblemDraft> {
    const workingTitle = typeof input.workingTitle === 'string' ? input.workingTitle.trim() : '';
    if (!workingTitle) throw new ValidationError('title');
    if (typeof input.content !== 'string') throw new ValidationError('content');
    const difficulty = parseInteger(input.difficulty, 'difficulty', 1, 10);
    const sourceMeta = normalizeManagedSourceMeta(input.sourceMeta);
    const mindmap = await materializeManagedMindmapTags(input.mindmapNodeIds);
    const pendingTrainingPlacement = await validateManagedTrainingPlacement(domainId, sourceMeta.template, input.pendingTrainingPlacement);
    const sourceTags = deriveManagedSourceTags(sourceMeta);
    const authorUid = input.authorUid === undefined ? undefined : parseInteger(input.authorUid, 'authorUid', 1, Number.MAX_SAFE_INTEGER);
    const batchImport = input.batchImport === undefined ? undefined : normalizeManagedProblemBatchImport(input.batchImport);
    return {
        workingTitle,
        content: input.content,
        difficulty,
        sourceMeta,
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
    pdoc: Pick<ProblemDoc, 'docId' | 'sourceMeta' | 'managedAuthoring'>,
): Promise<PreparedManagedProblemPublication> {
    let sourceMeta: ManagedSourceMeta;
    let mindmap: Awaited<ReturnType<typeof materializeManagedMindmapTags>>;
    try {
        sourceMeta = normalizeManagedSourceMeta(pdoc.sourceMeta);
        mindmap = await materializeManagedMindmapTags(pdoc.managedAuthoring?.selectedMindmapNodeIds);
    } catch (error) {
        if (error instanceof ManagedProblemMetadataConflictError) throw error;
        const conflict = new ManagedProblemMetadataConflictError('来源或算法标签已失效');
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
        const conflict = new ManagedProblemMetadataConflictError('待挂训练字段已失效');
        Object.defineProperty(conflict, 'cause', { value: error, configurable: true });
        throw conflict;
    }
    if (pendingTrainingPlacement) {
        const training = await document.coll.findOne(
            {
                domainId,
                docType: document.TYPE_TRAINING,
                docId: pendingTrainingPlacement.trainingId,
                kind: { $ne: 'course' },
            },
            { projection: { dag: 1 } },
        );
        const chapters = canonicalTrainingChapters(training?.dag);
        const chapter = chapters.find((candidate) => candidate._id === pendingTrainingPlacement.chapterId);
        if (!chapter) throw new ManagedProblemMetadataConflictError('待挂训练或章节已删除');
        if (chapters.some((candidate) => candidate.pids.map(Number).includes(pdoc.docId))) {
            throw new ManagedProblemMetadataConflictError('题目已存在于待挂训练');
        }
    }
    return {
        sourceMeta,
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
