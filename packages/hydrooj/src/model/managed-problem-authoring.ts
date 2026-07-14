import { ObjectId } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { Logger } from '@hydrooj/utils';
import { ManagedProblemMetadataConflictError, ValidationError } from '../error';
import type { ProblemDoc, TrainingNode } from '../interface';
import db from '../service/db';
import * as document from './document';

const logger = new Logger('managed-problem-authoring');

export type ManagedSourceMeta = NonNullable<ProblemDoc['sourceMeta']>;
export type ManagedSourceTemplate = ManagedSourceMeta['template'];

type TemplateField = 'year' | 'season' | 'level' | 'round';

export interface ManagedSourceTemplateDefinition {
    id: ManagedSourceTemplate;
    label: string;
    fields: TemplateField[];
}

export interface KnowledgeMindmapOption {
    id: string;
    label: string;
    tags: string[];
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

export interface ManagedProblemDraftInput {
    workingTitle: string;
    content: string;
    difficulty: number;
    sourceMeta: unknown;
    mindmapNodeIds: unknown;
    pendingTrainingPlacement?: unknown;
    authorUid?: number;
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
}

interface PidCounterDoc {
    domainId: string;
    namespace: string;
    value: number;
    updatedAt: Date;
}

export const MANAGED_SOURCE_TEMPLATES: readonly ManagedSourceTemplateDefinition[] = [
    { id: 'pat_basic', label: 'PAT 乙级', fields: ['year', 'season'] },
    { id: 'pat_advanced', label: 'PAT 甲级', fields: ['year', 'season'] },
    { id: 'gplt_national', label: '天梯全国总决赛', fields: ['year', 'level'] },
    { id: 'gplt_provincial', label: '天梯省级赛', fields: ['year', 'level'] },
    { id: 'cauc', label: 'CAUC 校赛', fields: ['year'] },
    { id: 'self', label: '自命题', fields: ['year'] },
    { id: 'nowcoder_summer', label: '牛客暑期多校', fields: ['year', 'round'] },
    { id: 'hdu_summer', label: '杭电暑期多校', fields: ['year', 'round'] },
    { id: 'hdu_spring', label: '杭电春季赛', fields: ['year', 'round'] },
] as const;

const TEMPLATE_BY_ID = new Map(MANAGED_SOURCE_TEMPLATES.map((template) => [template.id, template]));
const TEMPLATE_ANCHOR_TAG: Record<ManagedSourceTemplate, string> = {
    pat_basic: 'PAT乙级',
    pat_advanced: 'PAT甲级',
    gplt_national: '天梯赛全国总决赛',
    gplt_provincial: '天梯赛省级赛',
    cauc: 'CAUC校赛',
    self: '自命题',
    nowcoder_summer: '牛客暑期多校',
    hdu_summer: '杭电暑期多校',
    hdu_spring: '杭电春季赛',
};
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

/** Parse and canonicalize the only source metadata accepted for managed problems. */
export function normalizeManagedSourceMeta(input: unknown): ManagedSourceMeta {
    if (!isPlainObject(input)) throw new ValidationError('sourceMeta');
    const template = typeof input.template === 'string' ? (input.template.trim() as ManagedSourceTemplate) : ('' as ManagedSourceTemplate);
    const definition = TEMPLATE_BY_ID.get(template);
    if (!definition) throw new ValidationError('template');
    const allowed = new Set<string>(['template', ...definition.fields]);
    const unknown = Object.keys(input).filter((field) => !allowed.has(field));
    if (unknown.length) throw new ValidationError('sourceMeta', null, `来源模板不接受字段：${unknown.join(', ')}`);

    const sourceMeta: ManagedSourceMeta = {
        template,
        year: parseInteger(input.year, 'year', 2000, 2100),
    };
    if (definition.fields.includes('season')) {
        const season = input.season;
        if (season !== 'spring' && season !== 'summer' && season !== 'autumn' && season !== 'winter') throw new ValidationError('season');
        sourceMeta.season = season;
    }
    if (definition.fields.includes('level')) {
        if (input.level !== 'L1' && input.level !== 'L2' && input.level !== 'L3') throw new ValidationError('level');
        sourceMeta.level = input.level;
    }
    if (definition.fields.includes('round')) sourceMeta.round = parseInteger(input.round, 'round', 1, 99);
    return sourceMeta;
}

/** System tags have one source of truth and never include the round number. */
export function deriveManagedSourceTags(sourceMetaInput: unknown): string[] {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    const { template, year } = sourceMeta;
    if (template === 'pat_basic' || template === 'pat_advanced') {
        const season = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[sourceMeta.season!];
        return [template === 'pat_basic' ? 'PAT乙级' : 'PAT甲级', `${year}${season}`];
    }
    if (template === 'gplt_national') return ['天梯赛全国总决赛', sourceMeta.level!, `${year}CCCC`];
    if (template === 'gplt_provincial') return ['天梯赛省级赛', sourceMeta.level!, `${year}CCCC-省`];
    if (template === 'cauc') return ['CAUC校赛', `${year}校赛`];
    if (template === 'self') return ['自命题', `${year}自命题`];
    if (template === 'nowcoder_summer') return ['MultiSchool', '牛客暑期多校', `${year}牛客暑期多校`];
    if (template === 'hdu_summer') return ['MultiSchool', '杭电暑期多校', `${year}杭电暑期多校`];
    return ['杭电春季赛', `${year}HDU-S`];
}

export function managedPidCounterNamespace(sourceMetaInput: unknown): string {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    if (sourceMeta.template === 'pat_basic') return 'pat-basic';
    if (sourceMeta.template === 'pat_advanced') return 'pat-advanced';
    if (sourceMeta.template === 'self') return 'self';
    if (sourceMeta.template === 'nowcoder_summer') return 'nowcoder';
    if (sourceMeta.template === 'hdu_summer' || sourceMeta.template === 'hdu_spring') return 'hdu';
    if (sourceMeta.template === 'gplt_national') return `gplt-${sourceMeta.year}-national`;
    if (sourceMeta.template === 'gplt_provincial') return `gplt-${sourceMeta.year}-provincial`;
    return `cauc-${sourceMeta.year}`;
}

export function formatManagedProblemPid(sourceMetaInput: unknown, sequence: number): string {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ValidationError('sequence');
    if (sourceMeta.template === 'pat_basic') {
        if (sequence < 3000 || sequence > 3999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (sourceMeta.template === 'pat_advanced') {
        if (sequence < 4000 || sequence > 4999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (sourceMeta.template === 'self') {
        if (sequence < 5000 || sequence > 5999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (sourceMeta.template === 'nowcoder_summer') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `NK${String(sequence).padStart(4, '0')}`;
    }
    if (sourceMeta.template === 'hdu_summer' || sourceMeta.template === 'hdu_spring') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `HDU${String(sequence).padStart(4, '0')}`;
    }
    if (sourceMeta.template === 'cauc') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `CCCCCAUC${sourceMeta.year}${String(sequence).padStart(4, '0')}`;
    }
    if (sequence > 999) throw new ValidationError('sequence');
    const stage = sourceMeta.template === 'gplt_national' ? 'N' : 'P';
    return `GPLT${sourceMeta.year}${stage}${String(sequence).padStart(3, '0')}`;
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
    return mindmapNodesColl.find({}, { projection: { _id: 1, parentId: 1, topic: 1, tags: 1 } }).toArray();
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

/** Re-read the live tree and materialize every tagged ancestor of each selection. */
export async function materializeKnowledgeMindmapTags(
    nodeIdsInput: unknown,
    options: { required?: boolean; field?: 'knowledgeNodeIds' | 'mindmapNodeIds' } = {},
): Promise<{ nodeIds: ObjectId[]; tags: string[] }> {
    const nodeIds = normalizeNodeIds(nodeIdsInput, options.required === true, options.field || 'knowledgeNodeIds');
    if (!nodeIds.length) return { nodeIds: [], tags: [] };
    const nodes = await loadMindmapNodes();
    const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
    const tags: string[] = [];
    for (const id of nodeIds) {
        const node = byId.get(id);
        if (!node || !Array.isArray(node.tags) || !node.tags.some((tag) => typeof tag === 'string' && tag.trim())) {
            throw new ManagedProblemMetadataConflictError(`导图节点 ${id} 已删除或不可选`);
        }
        for (const pathNode of buildNodePath(node, byId)) {
            for (const tag of Array.isArray(pathNode.tags) ? pathNode.tags : []) {
                const normalized = typeof tag === 'string' ? tag.trim() : '';
                if (normalized && !tags.includes(normalized)) tags.push(normalized);
            }
        }
    }
    return { nodeIds: nodeIds.map((id) => new ObjectId(id)), tags };
}

export function materializeManagedMindmapTags(nodeIdsInput: unknown): Promise<{ nodeIds: ObjectId[]; tags: string[] }> {
    return materializeKnowledgeMindmapTags(nodeIdsInput, { required: true, field: 'mindmapNodeIds' });
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
        const templates = MANAGED_SOURCE_TEMPLATES.filter((template) => memberTags.has(TEMPLATE_ANCHOR_TAG[template.id])).map(
            (template) => template.id,
        );
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
    const anchor = TEMPLATE_ANCHOR_TAG[template];
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
    return {
        workingTitle,
        content: input.content,
        difficulty,
        sourceMeta,
        selectedMindmapNodeIds: mindmap.nodeIds,
        ...(pendingTrainingPlacement ? { pendingTrainingPlacement } : {}),
        tags: [...new Set([...sourceTags, ...mindmap.tags])],
        ...(authorUid ? { authorUid } : {}),
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
        const actual = (await document.coll.listIndexes().toArray()).find((index) => index.name === MANAGED_PROBLEM_PID_INDEX.options.name);
        if (
            !actual ||
            actual.unique !== true ||
            !isDeepStrictEqual(actual.key, MANAGED_PROBLEM_PID_INDEX.key) ||
            !isDeepStrictEqual(actual.partialFilterExpression, MANAGED_PROBLEM_PID_INDEX.options.partialFilterExpression)
        ) {
            throw new Error('Problem PID index is not the required partial unique index');
        }
        logger.info(
            'Managed authoring indexes verified counter=%s problem=%s',
            'problem_pid_counter_namespace_uq',
            MANAGED_PROBLEM_PID_INDEX.options.name,
        );
    } catch (error) {
        logger.error('Managed authoring index verification failed error=%o', error);
        throw error;
    }
}
