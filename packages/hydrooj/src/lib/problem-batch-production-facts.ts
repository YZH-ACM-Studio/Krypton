import type { SourceTemplateDefinition } from '@hydrooj/common';
import { formatManagedProblemPid, managedPidCounterNamespace, normalizeManagedSourceMeta } from '../model/managed-problem-source';
import { canonicalJson, ProblemBatchImportError, type ProblemBatchProductionFacts, sha256, type ValidatedProblemBatch } from './problem-batch-import';
import { resolveProblemKnowledgeNodeIds } from './problem-tag-canonical';

export interface ProblemBatchFactUser {
    uid: number;
    username: string;
    isProblemBankAdmin: boolean;
}

export interface ProblemBatchFactTraining {
    id: string;
    title: string;
    dag: unknown[];
}

export interface ProblemBatchFactProblem {
    docId: number;
    pid: string;
    title: string;
    hidden?: boolean;
    authoringMode?: string;
    problemKind?: string;
    knowledgeMapId?: unknown;
    knowledgeNodeIds?: unknown;
    managedAuthoring?: { metadataStatus?: string; selectedMindmapNodeIds?: unknown; pendingTrainingPlacement?: unknown };
    batchImport?: { batchId?: string; sourceProblemCode?: string; identity?: string; fingerprint?: string };
    hasBatchImportIdentity?: boolean;
}

export interface ProblemBatchFactPermit {
    uid: number;
    role: string;
}

export interface ProblemBatchFactChapterAudit {
    operator: number;
    trainingId: string;
    chapterId: number;
    chapterTitle: string;
    batchId: string;
    action: string;
    replacePids: number[];
    result: string;
}

export interface ProblemBatchFactsRepository {
    getSourceTemplates(domainId: string): Promise<SourceTemplateDefinition[]>;
    getNamespacePrefix(domainId: string, namespaceId: string): Promise<string | undefined>;
    getUser(domainId: string, uid: number): Promise<ProblemBatchFactUser | null>;
    getCounter(domainId: string, namespace: string): Promise<number | null>;
    getTraining(domainId: string, trainingId: string): Promise<ProblemBatchFactTraining | null>;
    hasTrainingAnchor(domainId: string, pids: number[], tag: string): Promise<boolean>;
    getMindmapFacts(nodeIds: string[]): Promise<Array<{ id: string; mapId: string; mapTitle: string; topic: string; tags: string[] }>>;
    getBatchProblems(domainId: string, batchId: string): Promise<ProblemBatchFactProblem[]>;
    getActiveProblemPermits(domainId: string, docId: number): Promise<ProblemBatchFactPermit[]>;
    getDuplicateProblems(domainId: string, titles: string[], pids: string[]): Promise<ProblemBatchFactProblem[]>;
    getTrainingReplacementAudit(
        domainId: string,
        batchId: string,
        trainingId: string,
        chapterId: number,
    ): Promise<ProblemBatchFactChapterAudit | null>;
}

function fail(message: string, code = 'BATCH_IMPORT_PRODUCTION_DRIFT', details?: unknown): never {
    throw new ProblemBatchImportError(message, code, details);
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function canonicalObjectId(value: unknown, field: string): string {
    let normalized = '';
    if (typeof value === 'string') normalized = value.trim();
    else if (value && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
        try {
            normalized = String((value as { toHexString(): string }).toHexString()).trim();
        } catch {
            fail(`${field} is not a valid ObjectId`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
        }
    }
    if (!OBJECT_ID.test(normalized)) fail(`${field} is not a valid ObjectId`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
    return normalized.toLowerCase();
}

function canonicalObjectIdArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value)) fail(`${field} must be an ObjectId array`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
    return value.map((item, index) => canonicalObjectId(item, `${field}.${index}`)).sort();
}

export function assertProblemBatchMindmapState(pdoc: ProblemBatchFactProblem, expectedMapId: string, expectedNodeIds: string[], label: string): void {
    const mapId = canonicalObjectId(pdoc.knowledgeMapId, `${label}.knowledgeMapId`);
    const expectedMap = canonicalObjectId(expectedMapId, `${label}.expectedKnowledgeMapId`);
    const expectedNodes = canonicalObjectIdArray(expectedNodeIds, `${label}.expectedKnowledgeNodeIds`);
    let knowledgeNodeIds: string[];
    try {
        knowledgeNodeIds = canonicalObjectIdArray(resolveProblemKnowledgeNodeIds(pdoc, label), `${label}.canonicalKnowledgeNodeIds`);
    } catch (error) {
        fail(`${label}: invalid canonical knowledge-node state`, 'BATCH_IMPORT_MINDMAP_CONFLICT', {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (mapId !== expectedMap || canonicalJson(knowledgeNodeIds) !== canonicalJson(expectedNodes)) {
        fail(`${label}: batch problem knowledge map or nodes differ from the manifest`, 'BATCH_IMPORT_MINDMAP_CONFLICT', {
            expectedMapId: expectedMap,
            actualMapId: mapId,
            expectedNodeIds: expectedNodes,
            actualCanonicalNodeIds: knowledgeNodeIds,
        });
    }
}

function canonicalChapter(chapter: any, index: number) {
    const id = Number(chapter?._id);
    const title = typeof chapter?.title === 'string' ? chapter.title.trim() : '';
    if (!Number.isSafeInteger(id) || id < 1 || !title) fail(`training chapter ${index} has an invalid id or title`);
    if (chapter.requireNids !== undefined && !Array.isArray(chapter.requireNids)) {
        fail(`training chapter ${id} has invalid prerequisites`);
    }
    if (chapter.pids !== undefined && !Array.isArray(chapter.pids)) fail(`training chapter ${id} has invalid problem members`);
    const requireNids = (chapter.requireNids || []).map(Number);
    const pids = (chapter.pids || []).map(Number);
    if (!requireNids.every(Number.isSafeInteger) || !pids.every(Number.isSafeInteger)) {
        fail(`training chapter ${id} contains non-integer references`);
    }
    return { _id: id, title, requireNids, pids };
}

export function problemBatchDocumentState(pdoc: ProblemBatchFactProblem, _finalHidden = false): 'draft' | 'published' {
    if (pdoc.hidden === true && pdoc.managedAuthoring?.metadataStatus === 'draft') return 'draft';
    // Confirmed problems stay published after later admin visibility edits.
    if (pdoc.managedAuthoring?.metadataStatus === 'confirmed') return 'published';
    fail(`batch problem has an invalid lifecycle state: ${pdoc.docId}`);
}

async function assertAuthorPermit(repository: ProblemBatchFactsRepository, domainId: string, docId: number, expectedAuthor: number): Promise<void> {
    const permits = await repository.getActiveProblemPermits(domainId, docId);
    const authors = permits.filter((permit) => permit.role === 'author');
    if (authors.length !== 1 || authors[0].uid !== expectedAuthor) {
        fail(`${domainId}/${docId}: expected exactly one active author UID ${expectedAuthor}`, 'BATCH_IMPORT_AUTHOR_CONFLICT', authors);
    }
}

async function buildTrainingFacts(
    batch: ValidatedProblemBatch,
    repository: ProblemBatchFactsRepository,
    training: ProblemBatchFactTraining | null,
    anchorTag: string,
    problems: ProblemBatchProductionFacts['problems'],
): Promise<ProblemBatchProductionFacts['training']> {
    const requested = batch.manifest.training;
    if (requested === null) return null;
    if (!training || training.id !== requested.id || training.title !== requested.title || !Array.isArray(training.dag)) {
        fail(`training identity changed: ${batch.manifest.domain}/${requested.id}`);
    }
    const chapters = training.dag.map(canonicalChapter);
    const currentMaxChapterId = chapters.length ? Math.max(...chapters.map((chapter) => chapter._id)) : 0;
    const replaceExisting = requested.chapterId !== undefined;
    const targetMatches = chapters.filter((chapter) =>
        replaceExisting ? chapter._id === requested.chapterId || chapter.title === requested.chapterTitle : chapter.title === requested.chapterTitle,
    );
    if (targetMatches.length > 1) fail(`training chapter title is ambiguous: ${requested.chapterTitle}`);
    const target = targetMatches[0];
    if (replaceExisting) {
        if (!target || target._id !== requested.chapterId || target.title !== requested.chapterTitle || target.requireNids.length !== 0) {
            fail(`historical batch chapter identity conflicts: ${requested.chapterTitle}`);
        }
    } else if (target && (chapters[0] !== target || target.requireNids.length !== 0)) {
        fail(`existing batch chapter is not the exact first chapter: ${requested.chapterTitle}`);
    }
    const chapterId = replaceExisting ? requested.chapterId! : target?._id || currentMaxChapterId + 1;
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) fail('planned training chapter id is invalid');
    const chapterPosition = target ? chapters.indexOf(target) : 0;
    const replacePids = replaceExisting ? [...requested.replacePids!] : [];
    const nonTargetDag = chapters.filter((chapter) => chapter !== target);
    const trainingPids = [...new Set(chapters.flatMap((chapter) => chapter.pids))];
    if (!trainingPids.length || !(await repository.hasTrainingAnchor(batch.manifest.domain, trainingPids, anchorTag))) {
        fail(`training does not accept source template ${batch.manifest.source.template}`);
    }

    if (replaceExisting) {
        const publishedPrefix: number[] = [];
        let sawUnpublished = false;
        for (const problem of problems) {
            if (problem.state === 'published') {
                if (sawUnpublished || !Number.isSafeInteger(problem.docId)) {
                    fail('published historical batch problems no longer form the exact manifest prefix');
                }
                publishedPrefix.push(problem.docId!);
            } else {
                sawUnpublished = true;
            }
        }
        const targetPids = target!.pids;
        let confirmedReplacement = false;
        if (!publishedPrefix.length && !targetPids.length) {
            const audit = await repository.getTrainingReplacementAudit(batch.manifest.domain, batch.manifest.batchId, requested.id, chapterId);
            confirmedReplacement =
                !!audit &&
                audit.operator === batch.manifest.actor &&
                audit.trainingId === requested.id &&
                audit.chapterId === chapterId &&
                audit.chapterTitle === requested.chapterTitle &&
                audit.batchId === batch.manifest.batchId &&
                audit.action === 'replace-members' &&
                canonicalJson(audit.replacePids) === canonicalJson(replacePids) &&
                audit.result === 'success';
            if (!confirmedReplacement) {
                fail('historical batch chapter is empty without the matching successful replacement audit');
            }
        }
        const allowedBeforePublication =
            !publishedPrefix.length && (canonicalJson(targetPids) === canonicalJson(replacePids) || confirmedReplacement);
        if (!allowedBeforePublication && canonicalJson(targetPids) !== canonicalJson(publishedPrefix)) {
            fail('historical batch chapter members differ from both the approved replacement and published manifest prefix');
        }
    }

    return {
        id: training.id,
        title: training.title,
        chapterId,
        chapterTitle: requested.chapterTitle,
        chapterState: target ? 'existing' : 'missing',
        chapterMode: replaceExisting ? 'replace-existing' : 'create-front',
        chapterPosition,
        currentMaxChapterId,
        nonTargetDagFingerprint: sha256(canonicalJson(nonTargetDag)),
        targetPids: target?.pids || [],
        replacePids,
    };
}

export async function buildProblemBatchProductionFacts(
    batch: ValidatedProblemBatch,
    repository: ProblemBatchFactsRepository,
): Promise<ProblemBatchProductionFacts> {
    const templates = await repository.getSourceTemplates(batch.manifest.domain);
    const sourceMeta = normalizeManagedSourceMeta(batch.manifest.source, templates);
    const template = templates.find((candidate) => candidate.id === sourceMeta.template);
    if (!template) fail(`source template does not exist: ${sourceMeta.template}`);
    const namespace = managedPidCounterNamespace(sourceMeta, templates);
    const customPrefix = await repository.getNamespacePrefix(batch.manifest.domain, template.pidNamespaceId);
    const requestedNodeIds = [...new Set(batch.problems.flatMap((entry) => entry.mindmapNodeIds))].sort();
    const [actor, author, counter, training, mindmapNodes] = await Promise.all([
        repository.getUser(batch.manifest.domain, batch.manifest.actor),
        repository.getUser(batch.manifest.domain, batch.manifest.author.uid),
        repository.getCounter(batch.manifest.domain, namespace),
        batch.manifest.training === null ? Promise.resolve(null) : repository.getTraining(batch.manifest.domain, batch.manifest.training.id),
        repository.getMindmapFacts(requestedNodeIds),
    ]);
    if (!actor || actor.uid !== batch.manifest.actor) fail(`actor UID ${batch.manifest.actor} does not exist`);
    if (!actor.isProblemBankAdmin) fail(`actor UID ${batch.manifest.actor} is not a problem-bank administrator`);
    if (!author || author.uid !== batch.manifest.author.uid) fail(`author UID ${batch.manifest.author.uid} does not exist`);
    if (sourceMeta.template !== 'self' && (author.uid === 2 || author.uid === actor.uid || author.isProblemBankAdmin)) {
        fail(`official source ${sourceMeta.template} requires a dedicated non-administrator author account`, 'BATCH_IMPORT_AUTHOR_CONFLICT', {
            actorUid: actor.uid,
            authorUid: author.uid,
            authorUsername: author.username,
        });
    }
    if (!Number.isSafeInteger(counter)) fail(`PID counter is missing or malformed: ${batch.manifest.domain}/${namespace}`);
    if (mindmapNodes.length !== requestedNodeIds.length) {
        fail('mindmap fact count differs from the manifest', 'BATCH_IMPORT_MINDMAP_CONFLICT');
    }
    const mindmapById = new Map(mindmapNodes.map((node) => [node.id, node]));
    const canonicalMindmapNodes = requestedNodeIds.map((id) => {
        const node = mindmapById.get(id);
        if (!node) fail(`mindmap node is missing or not selectable: ${id}`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
        const mapTitle = typeof node.mapTitle === 'string' ? node.mapTitle.trim() : '';
        const topic = typeof node.topic === 'string' ? node.topic.trim() : '';
        if (!mapTitle || !topic || !Array.isArray(node.tags) || node.tags.some((tag) => typeof tag !== 'string')) {
            fail(`mindmap node fact is malformed: ${id}`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
        }
        return {
            id: canonicalObjectId(node.id, `mindmap.${id}.id`),
            mapId: canonicalObjectId(node.mapId, `mindmap.${id}.mapId`),
            mapTitle,
            topic,
            tags: [...node.tags],
        };
    });
    const knowledgeMapTitles = new Map<string, string>();
    for (const node of canonicalMindmapNodes) {
        const previousTitle = knowledgeMapTitles.get(node.mapId);
        if (previousTitle && previousTitle !== node.mapTitle) {
            fail(`knowledge map ${node.mapId} has conflicting titles`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
        }
        knowledgeMapTitles.set(node.mapId, node.mapTitle);
    }
    const knowledgeMaps = [...knowledgeMapTitles].map(([id, title]) => ({ id, title })).sort((left, right) => left.id.localeCompare(right.id));
    const canonicalNodeById = new Map(canonicalMindmapNodes.map((node) => [node.id, node]));
    const knowledgeMapByProblem = new Map<string, string>();
    for (const entry of batch.problems) {
        const entryMaps = [...new Set(entry.mindmapNodeIds.map((id) => canonicalNodeById.get(id)?.mapId || ''))];
        if (entryMaps.length !== 1 || !entryMaps[0]) {
            fail(`${entry.sourceProblemCode}: mindmap nodes must belong to exactly one knowledge map`, 'BATCH_IMPORT_MINDMAP_CONFLICT', entryMaps);
        }
        knowledgeMapByProblem.set(entry.sourceProblemCode, entryMaps[0]);
    }

    const existing = await repository.getBatchProblems(batch.manifest.domain, batch.manifest.batchId);
    const expectedCodes = new Set(batch.problems.map((entry) => entry.sourceProblemCode));
    const unexpected = existing.filter((pdoc) => !expectedCodes.has(pdoc.batchImport?.sourceProblemCode || ''));
    if (unexpected.length) fail('production contains unexpected identities for this batch', 'BATCH_IMPORT_IDENTITY_CONFLICT', unexpected);
    const identityCounts = new Map<string, number>();
    for (const pdoc of existing) {
        const sourceProblemCode = pdoc.batchImport?.sourceProblemCode || '';
        identityCounts.set(sourceProblemCode, (identityCounts.get(sourceProblemCode) || 0) + 1);
    }
    const duplicateIdentities = [...identityCounts].filter(([, count]) => count !== 1).map(([sourceProblemCode]) => sourceProblemCode);
    if (duplicateIdentities.length) {
        fail('production contains duplicate durable identities for this batch', 'BATCH_IMPORT_IDENTITY_CONFLICT', duplicateIdentities);
    }
    const byCode = new Map(existing.map((pdoc) => [pdoc.batchImport?.sourceProblemCode, pdoc]));
    const problems: ProblemBatchProductionFacts['problems'] = [];
    let sequence = counter;
    for (const entry of batch.problems) {
        const knowledgeMapId = knowledgeMapByProblem.get(entry.sourceProblemCode)!;
        const pdoc = byCode.get(entry.sourceProblemCode);
        if (pdoc) {
            if (
                pdoc.problemKind !== 'programming' ||
                pdoc.authoringMode !== 'managed' ||
                pdoc.hasBatchImportIdentity !== true ||
                pdoc.batchImport?.identity !== `${batch.manifest.batchId}:${entry.sourceProblemCode}` ||
                pdoc.batchImport?.fingerprint !== entry.fingerprint ||
                typeof pdoc.pid !== 'string'
            ) {
                fail(`${entry.sourceProblemCode}: durable import identity conflicts`, 'BATCH_IMPORT_IDENTITY_CONFLICT', pdoc);
            }
            if (batch.manifest.training === null && pdoc.managedAuthoring?.pendingTrainingPlacement !== undefined) {
                fail(`${entry.sourceProblemCode}: problem-bank import has an unexpected pending training placement`);
            }
            assertProblemBatchMindmapState(pdoc, knowledgeMapId, entry.mindmapNodeIds, entry.sourceProblemCode);
            await assertAuthorPermit(repository, batch.manifest.domain, pdoc.docId, batch.manifest.author.uid);
            problems.push({
                sourceProblemCode: entry.sourceProblemCode,
                fingerprint: entry.fingerprint,
                pid: pdoc.pid,
                knowledgeMapId,
                state: problemBatchDocumentState(pdoc),
                docId: pdoc.docId,
            });
        } else {
            if (!template.enabled) fail(`来源模板“${template.label}”已停用，不能导入新题`, 'BATCH_IMPORT_SOURCE_DISABLED');
            sequence++;
            problems.push({
                sourceProblemCode: entry.sourceProblemCode,
                fingerprint: entry.fingerprint,
                pid: formatManagedProblemPid(sourceMeta, sequence, templates, customPrefix),
                knowledgeMapId,
                state: 'new',
            });
        }
    }

    const trainingFacts = await buildTrainingFacts(batch, repository, training, template.trainingAnchorTag, problems);

    const duplicateDocs = await repository.getDuplicateProblems(
        batch.manifest.domain,
        batch.problems.map((entry) => entry.title),
        problems.map((entry) => entry.pid),
    );
    const ownDocIds = new Set(existing.map((pdoc) => pdoc.docId));
    const suspectedDuplicates = duplicateDocs
        .filter((pdoc) => !ownDocIds.has(pdoc.docId))
        .map((pdoc) => ({
            sourceProblemCode:
                batch.problems.find((entry) => entry.title === pdoc.title)?.sourceProblemCode ||
                problems.find((entry) => entry.pid === pdoc.pid)?.sourceProblemCode ||
                '?',
            docId: pdoc.docId,
            pid: pdoc.pid,
            title: pdoc.title,
        }));

    return {
        domain: batch.manifest.domain,
        actor: { uid: actor.uid, username: actor.username },
        author: { uid: author.uid, username: author.username },
        counter: { namespace, value: counter },
        training: trainingFacts,
        knowledgeMaps,
        mindmapNodes: canonicalMindmapNodes.map(({ id, mapId, topic, tags }) => ({ id, mapId, topic, tags })),
        problems,
        suspectedDuplicates,
    };
}
