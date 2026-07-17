import {
    formatManagedProblemPid,
    managedPidCounterNamespace,
    MANAGED_SOURCE_TEMPLATES,
    normalizeManagedSourceMeta,
} from '../model/managed-problem-source';
import { canonicalJson, ProblemBatchImportError, type ProblemBatchProductionFacts, sha256, type ValidatedProblemBatch } from './problem-batch-import';

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
    managedAuthoring?: { metadataStatus?: string };
    batchImport?: { batchId?: string; sourceProblemCode?: string; identity?: string; fingerprint?: string };
    hasBatchImportIdentity?: boolean;
}

export interface ProblemBatchFactPermit {
    uid: number;
    role: string;
}

export interface ProblemBatchFactsRepository {
    getUser(domainId: string, uid: number): Promise<ProblemBatchFactUser | null>;
    getCounter(domainId: string, namespace: string): Promise<number | null>;
    getTraining(domainId: string, trainingId: string): Promise<ProblemBatchFactTraining | null>;
    hasTrainingAnchor(domainId: string, pids: number[], tag: string): Promise<boolean>;
    getMindmapFacts(nodeIds: string[]): Promise<Array<{ id: string; topic: string; tags: string[] }>>;
    getBatchProblems(domainId: string, batchId: string): Promise<ProblemBatchFactProblem[]>;
    getActiveProblemPermits(domainId: string, docId: number): Promise<ProblemBatchFactPermit[]>;
    getDuplicateProblems(domainId: string, titles: string[], pids: string[]): Promise<ProblemBatchFactProblem[]>;
}

function fail(message: string, code = 'BATCH_IMPORT_PRODUCTION_DRIFT', details?: unknown): never {
    throw new ProblemBatchImportError(message, code, details);
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

export function problemBatchDocumentState(pdoc: ProblemBatchFactProblem): 'draft' | 'published' {
    if (pdoc.hidden === true && pdoc.managedAuthoring?.metadataStatus === 'draft') return 'draft';
    if (pdoc.hidden === false && pdoc.managedAuthoring?.metadataStatus === 'confirmed') return 'published';
    fail(`batch problem has an invalid lifecycle state: ${pdoc.docId}`);
}

async function assertAuthorPermit(repository: ProblemBatchFactsRepository, domainId: string, docId: number, expectedAuthor: number): Promise<void> {
    const permits = await repository.getActiveProblemPermits(domainId, docId);
    const authors = permits.filter((permit) => permit.role === 'author');
    if (authors.length !== 1 || authors[0].uid !== expectedAuthor) {
        fail(`${domainId}/${docId}: expected exactly one active author UID ${expectedAuthor}`, 'BATCH_IMPORT_AUTHOR_CONFLICT', authors);
    }
}

export async function buildProblemBatchProductionFacts(
    batch: ValidatedProblemBatch,
    repository: ProblemBatchFactsRepository,
): Promise<ProblemBatchProductionFacts> {
    const sourceMeta = normalizeManagedSourceMeta(batch.manifest.source);
    const template = MANAGED_SOURCE_TEMPLATES.find((candidate) => candidate.id === sourceMeta.template);
    if (!template) fail(`source template does not exist: ${sourceMeta.template}`);
    const namespace = managedPidCounterNamespace(sourceMeta);
    const requestedNodeIds = [...new Set(batch.problems.flatMap((entry) => entry.mindmapNodeIds))].sort();
    const [actor, author, counter, training, mindmapNodes] = await Promise.all([
        repository.getUser(batch.manifest.domain, batch.manifest.actor),
        repository.getUser(batch.manifest.domain, batch.manifest.author.uid),
        repository.getCounter(batch.manifest.domain, namespace),
        repository.getTraining(batch.manifest.domain, batch.manifest.training.id),
        repository.getMindmapFacts(requestedNodeIds),
    ]);
    if (!actor || actor.uid !== batch.manifest.actor) fail(`actor UID ${batch.manifest.actor} does not exist`);
    if (!actor.isProblemBankAdmin) fail(`actor UID ${batch.manifest.actor} is not a problem-bank administrator`);
    if (!author || author.uid !== batch.manifest.author.uid) fail(`author UID ${batch.manifest.author.uid} does not exist`);
    if (author.username !== batch.manifest.author.username) {
        fail(`author UID ${author.uid} username changed: expected ${batch.manifest.author.username}, got ${author.username}`);
    }
    if (
        sourceMeta.template !== 'self' &&
        (author.uid === 2 || author.uid === actor.uid || author.isProblemBankAdmin || author.username.trim().toLowerCase() === 'root')
    ) {
        fail(`official source ${sourceMeta.template} requires a dedicated non-administrator author account`, 'BATCH_IMPORT_AUTHOR_CONFLICT', {
            actorUid: actor.uid,
            authorUid: author.uid,
            authorUsername: author.username,
        });
    }
    if (!Number.isSafeInteger(counter)) fail(`PID counter is missing or malformed: ${batch.manifest.domain}/${namespace}`);
    if (!training || training.id !== batch.manifest.training.id || training.title !== batch.manifest.training.title || !Array.isArray(training.dag)) {
        fail(`training identity changed: ${batch.manifest.domain}/${batch.manifest.training.id}`);
    }
    if (mindmapNodes.length !== requestedNodeIds.length) {
        fail('mindmap fact count differs from the manifest', 'BATCH_IMPORT_MINDMAP_CONFLICT');
    }
    const mindmapById = new Map(mindmapNodes.map((node) => [node.id, node]));
    const canonicalMindmapNodes = requestedNodeIds.map((id) => {
        const node = mindmapById.get(id);
        if (!node) fail(`mindmap node is missing or not selectable: ${id}`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
        return node;
    });

    const chapters = training.dag.map(canonicalChapter);
    const currentMaxChapterId = chapters.length ? Math.max(...chapters.map((chapter) => chapter._id)) : 0;
    const targetMatches = chapters.filter((chapter) => chapter.title === batch.manifest.training.chapterTitle);
    if (targetMatches.length > 1) fail(`training chapter title is ambiguous: ${batch.manifest.training.chapterTitle}`);
    const target = targetMatches[0];
    if (target && (chapters[0] !== target || target.requireNids.length !== 0)) {
        fail(`existing batch chapter is not the exact first chapter: ${batch.manifest.training.chapterTitle}`);
    }
    const chapterId = target?._id || currentMaxChapterId + 1;
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) fail('planned training chapter id is invalid');
    const nonTargetDag = chapters.filter((chapter) => chapter !== target);
    const trainingPids = [...new Set(chapters.flatMap((chapter) => chapter.pids))];
    if (!trainingPids.length || !(await repository.hasTrainingAnchor(batch.manifest.domain, trainingPids, template.trainingAnchorTag))) {
        fail(`training does not accept source template ${sourceMeta.template}`);
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
            await assertAuthorPermit(repository, batch.manifest.domain, pdoc.docId, batch.manifest.author.uid);
            problems.push({
                sourceProblemCode: entry.sourceProblemCode,
                fingerprint: entry.fingerprint,
                pid: pdoc.pid,
                state: problemBatchDocumentState(pdoc),
                docId: pdoc.docId,
            });
        } else {
            sequence++;
            problems.push({
                sourceProblemCode: entry.sourceProblemCode,
                fingerprint: entry.fingerprint,
                pid: formatManagedProblemPid(sourceMeta, sequence),
                state: 'new',
            });
        }
    }

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
        training: {
            id: training.id,
            title: training.title,
            chapterId,
            chapterTitle: batch.manifest.training.chapterTitle,
            chapterState: target ? 'existing' : 'missing',
            currentMaxChapterId,
            nonTargetDagFingerprint: sha256(canonicalJson(nonTargetDag)),
            targetPids: target?.pids || [],
        },
        mindmapNodes: canonicalMindmapNodes,
        problems,
        suspectedDuplicates,
    };
}
