import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import type { ProblemDoc } from '../interface';
import {
    canonicalJson,
    ProblemBatchImportError,
    type ProblemBatchExecutionReport,
    type ProblemBatchImportAdapter,
    type ProblemBatchImportPlan,
    type ProblemBatchProductionFacts,
    type ProblemBatchProgressEvent,
    type ProblemBatchVerifyResult,
    type ValidatedBatchFile,
    type ValidatedProblemBatch,
    type ValidatedProblemBatchEntry,
} from '../lib/problem-batch-import';
import {
    buildProblemBatchProductionFacts,
    type ProblemBatchFactProblem,
    type ProblemBatchFactsRepository,
    problemBatchDocumentState,
} from '../lib/problem-batch-production-facts';
import storageService from '../service/storage';
import * as document from './document';
import {
    deriveManagedSourceTags,
    listManagedMindmapOptions,
    managedPidCountersColl,
    materializeManagedMindmapTags,
} from './managed-problem-authoring';
import { normalizeManagedSourceMeta } from './managed-problem-source';
import ProblemModel from './problem';
import { assertProgrammingTestcasesConfigured } from './problem-lifecycle';
import StorageModel from './storage';
import * as TrainingModel from './training';
import UserModel from './user';
import * as OplogModel from './oplog';

const logger = new Logger('problem-batch-import');

function fail(message: string, code = 'BATCH_IMPORT_PRODUCTION_DRIFT', details?: unknown): never {
    throw new ProblemBatchImportError(message, code, details);
}

function equal(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

async function loadUsers(batch: ValidatedProblemBatch) {
    const [actor, author] = await Promise.all([
        UserModel.getById(batch.manifest.domain, batch.manifest.actor),
        UserModel.getById(batch.manifest.domain, batch.manifest.author.uid),
    ]);
    if (!actor || actor._id !== batch.manifest.actor) fail(`actor UID ${batch.manifest.actor} does not exist`);
    if (!ProblemModel.isProblemBankAdmin(actor)) fail(`actor UID ${batch.manifest.actor} is not a problem-bank administrator`);
    if (!author || author._id !== batch.manifest.author.uid) fail(`author UID ${batch.manifest.author.uid} does not exist`);
    if (author.uname !== batch.manifest.author.username) {
        fail(`author UID ${author._id} username changed: expected ${batch.manifest.author.username}, got ${author.uname}`);
    }
    return { actor, author };
}

const factsRepository: ProblemBatchFactsRepository = {
    async getUser(domainId, uid) {
        const user = await UserModel.getById(domainId, uid);
        if (!user) return null;
        return { uid: user._id, username: user.uname, isProblemBankAdmin: ProblemModel.isProblemBankAdmin(user) };
    },
    async getCounter(domainId, namespace) {
        const counter = await managedPidCountersColl.findOne({ domainId, namespace });
        return counter?.value ?? null;
    },
    async getTraining(domainId, trainingId) {
        const training = await document.coll.findOne({
            domainId,
            docType: document.TYPE_TRAINING,
            docId: new ObjectId(trainingId),
            kind: { $ne: 'course' },
        });
        return training ? { id: String(training.docId), title: training.title, dag: training.dag } : null;
    },
    async hasTrainingAnchor(domainId, pids, tag) {
        if (!pids.length) return false;
        return !!(await document.coll.findOne({ domainId, docType: document.TYPE_PROBLEM, docId: { $in: pids }, tag }, { projection: { docId: 1 } }));
    },
    async getMindmapFacts(nodeIds) {
        const options = await listManagedMindmapOptions();
        const byId = new Map(options.map((option) => [option.id, option]));
        return Promise.all(
            nodeIds.map(async (id) => {
                const option = byId.get(id);
                if (!option) fail(`mindmap node is missing or not selectable: ${id}`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
                const materialized = await materializeManagedMindmapTags([id]);
                return { id, topic: option.label, tags: materialized.tags };
            }),
        );
    },
    async getBatchProblems(domainId, batchId) {
        return (await document.coll
            .find(
                { domainId, docType: document.TYPE_PROBLEM, 'batchImport.batchId': batchId },
                {
                    projection: {
                        docId: 1,
                        pid: 1,
                        title: 1,
                        hidden: 1,
                        authoringMode: 1,
                        problemKind: 1,
                        managedAuthoring: 1,
                        batchImport: 1,
                        hasBatchImportIdentity: 1,
                    },
                },
            )
            .toArray()) as ProblemBatchFactProblem[];
    },
    async getActiveProblemPermits(domainId, docId) {
        return (await (global.Hydro.model as any).permits.listForProblem(domainId, docId)).map((permit: any) => ({
            uid: permit.uid,
            role: permit.role,
        }));
    },
    async getDuplicateProblems(domainId, titles, pids) {
        return (await document.coll
            .find(
                {
                    domainId,
                    docType: document.TYPE_PROBLEM,
                    $or: [{ title: { $in: titles } }, { pid: { $in: pids } }],
                },
                { projection: { docId: 1, pid: 1, title: 1, batchImport: 1 } },
            )
            .toArray()) as ProblemBatchFactProblem[];
    },
};

function buildProductionFacts(batch: ValidatedProblemBatch): Promise<ProblemBatchProductionFacts> {
    return buildProblemBatchProductionFacts(batch, factsRepository);
}

async function loadAuthorPermit(domainId: string, docId: number, expectedAuthor: number): Promise<void> {
    const permits = await factsRepository.getActiveProblemPermits(domainId, docId);
    const authors = permits.filter((permit) => permit.role === 'author');
    if (authors.length !== 1 || authors[0].uid !== expectedAuthor) {
        fail(`${domainId}/${docId}: expected exactly one active author UID ${expectedAuthor}`, 'BATCH_IMPORT_AUTHOR_CONFLICT', authors);
    }
}

async function assertApplyFacts(batch: ValidatedProblemBatch, plan: ProblemBatchImportPlan): Promise<ProblemBatchProductionFacts> {
    const current = await buildProductionFacts(batch);
    if (current.suspectedDuplicates.length) {
        fail('suspected duplicates appeared after preflight', 'BATCH_IMPORT_DUPLICATE', current.suspectedDuplicates);
    }
    if (!equal(current.actor, plan.facts.actor) || !equal(current.author, plan.facts.author)) {
        fail('actor or source author changed after preflight');
    }
    if (!equal(current.mindmapNodes, plan.facts.mindmapNodes)) fail('mindmap selection changed after preflight', 'BATCH_IMPORT_MINDMAP_CONFLICT');
    if (
        current.training.id !== plan.facts.training.id ||
        current.training.title !== plan.facts.training.title ||
        current.training.chapterId !== plan.facts.training.chapterId ||
        current.training.chapterTitle !== plan.facts.training.chapterTitle ||
        current.training.nonTargetDagFingerprint !== plan.facts.training.nonTargetDagFingerprint
    ) {
        fail('training facts changed after preflight');
    }
    const planByCode = new Map(plan.facts.problems.map((entry) => [entry.sourceProblemCode, entry]));
    let createdSincePreflight = 0;
    let sawUnpublishedProblem = false;
    const publishedPrefixPids: number[] = [];
    for (const currentProblem of current.problems) {
        const planned = planByCode.get(currentProblem.sourceProblemCode);
        if (!planned || planned.pid !== currentProblem.pid || planned.fingerprint !== currentProblem.fingerprint) {
            fail(`${currentProblem.sourceProblemCode}: planned PID or fingerprint changed after preflight`);
        }
        if (planned.state !== 'new' && currentProblem.state === 'new') {
            fail(`${currentProblem.sourceProblemCode}: pre-existing batch identity disappeared`);
        }
        if (planned.state === 'published' && currentProblem.state !== 'published') {
            fail(`${currentProblem.sourceProblemCode}: published batch problem regressed`);
        }
        if (currentProblem.state === 'published') {
            if (sawUnpublishedProblem || !Number.isSafeInteger(currentProblem.docId)) {
                fail('published batch problems no longer form the exact manifest prefix');
            }
            publishedPrefixPids.push(currentProblem.docId!);
        } else {
            sawUnpublishedProblem = true;
        }
        if (planned.state === 'new' && currentProblem.state !== 'new') createdSincePreflight++;
    }
    const expectedCounter = plan.facts.counter.value + createdSincePreflight;
    if (current.counter.namespace !== plan.facts.counter.namespace || current.counter.value !== expectedCounter) {
        fail(`PID counter changed after preflight: expected ${expectedCounter}, got ${current.counter.value}`);
    }
    if (plan.facts.training.chapterState === 'existing' && current.training.chapterState !== 'existing') {
        fail('pre-existing batch chapter disappeared');
    }
    if (publishedPrefixPids.length && current.training.chapterState !== 'existing') {
        fail('published batch problems exist but the target chapter is missing');
    }
    if (current.training.chapterState === 'existing' && !equal(current.training.targetPids, publishedPrefixPids)) {
        fail('batch chapter members differ from the exact published manifest prefix');
    }
    return current;
}

async function hashPayload(payload: any): Promise<string> {
    const hash = createHash('sha256');
    if (Buffer.isBuffer(payload) || typeof payload === 'string') return hash.update(payload).digest('hex');
    if (!payload || typeof payload[Symbol.asyncIterator] !== 'function') throw new TypeError('storage backend returned a non-stream payload');
    for await (const chunk of payload) hash.update(chunk as Buffer);
    return hash.digest('hex');
}

async function storedFileHash(storagePath: string): Promise<string | null> {
    const record = await StorageModel.coll.findOne({ path: storagePath, autoDelete: null });
    if (!record) return null;
    return hashPayload(await storageService.get(record.link || record._id));
}

async function assertStoredFile(storagePath: string, expected: ValidatedBatchFile, label: string): Promise<'missing' | 'exact'> {
    const digest = await storedFileHash(storagePath);
    if (digest === null) return 'missing';
    if (digest !== expected.sha256) fail(`${label}: production file fingerprint conflicts`, 'BATCH_IMPORT_FILE_CONFLICT', { storagePath, digest });
    return 'exact';
}

async function loadIdentityProblem(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry): Promise<ProblemDoc | null> {
    return document.coll.findOne({
        domainId: batch.manifest.domain,
        docType: document.TYPE_PROBLEM,
        'batchImport.identity': `${batch.manifest.batchId}:${entry.sourceProblemCode}`,
    }) as Promise<ProblemDoc | null>;
}

async function uploadMissingDraftFiles(
    batch: ValidatedProblemBatch,
    entry: ValidatedProblemBatchEntry,
    pdoc: ProblemDoc,
    actorUser: any,
): Promise<void> {
    const testdataPrefix = `problem/${batch.manifest.domain}/${pdoc.docId}/testdata`;
    const additionalPrefix = `problem/${batch.manifest.domain}/${pdoc.docId}/additional_file`;
    const expectedTestdata = [...entry.testdataFiles, entry.configFile];
    const currentTestdataNames = new Set((pdoc.data || []).map((file) => file.name));
    const currentAdditionalNames = new Set((pdoc.additional_file || []).map((file) => file.name));
    const expectedTestdataNames = new Set(expectedTestdata.map((file) => file.name));
    const expectedAdditionalNames = new Set(entry.assetFiles.map((file) => file.target));
    const unexpectedTestdata = [...currentTestdataNames].filter((name) => !expectedTestdataNames.has(name));
    const unexpectedAdditional = [...currentAdditionalNames].filter((name) => !expectedAdditionalNames.has(name));
    if (unexpectedTestdata.length || unexpectedAdditional.length) {
        fail(`${entry.sourceProblemCode}: draft contains undeclared files`, 'BATCH_IMPORT_FILE_CONFLICT', {
            testdata: unexpectedTestdata,
            assets: unexpectedAdditional,
        });
    }
    const uploadTestdata: ValidatedBatchFile[] = [];
    for (const file of expectedTestdata) {
        const state = await assertStoredFile(`${testdataPrefix}/${file.name}`, file, `${entry.sourceProblemCode}/${file.name}`);
        const metadata = (pdoc.data || []).find((candidate) => candidate.name === file.name);
        const configNeedsObserver = file.name === entry.configFile.name && (!pdoc.config || pdoc.config === '');
        if (state === 'missing' || !metadata || metadata.size !== file.size || configNeedsObserver) uploadTestdata.push(file);
    }
    const uploadAssets: Array<ValidatedBatchFile & { target: string }> = [];
    for (const file of entry.assetFiles) {
        const state = await assertStoredFile(`${additionalPrefix}/${file.target}`, file, `${entry.sourceProblemCode}/${file.target}`);
        const metadata = (pdoc.additional_file || []).find((candidate) => candidate.name === file.target);
        if (state === 'missing' || !metadata || metadata.size !== file.size) uploadAssets.push(file);
    }
    if (!uploadTestdata.length && !uploadAssets.length) return;
    const config = uploadTestdata.find((file) => file.name === entry.configFile.name);
    const ordinaryTestdata = uploadTestdata.filter((file) => file !== config);
    await ProblemModel.withAuthorizedStructuralWriteClaim(
        batch.manifest.domain,
        pdoc.docId,
        actorUser,
        `managed-batch-upload:${batch.manifest.batchId}:${entry.sourceProblemCode}`,
        async (claim) => {
            for (const file of ordinaryTestdata) {
                await ProblemModel.addTestdataWithClaim(claim, file.name, createReadStream(file.path), batch.manifest.actor);
            }
            for (const file of uploadAssets) {
                await ProblemModel.addAdditionalFileWithClaim(claim, file.target, createReadStream(file.path), batch.manifest.actor);
            }
            if (config) {
                await ProblemModel.addTestdataWithClaim(claim, config.name, createReadStream(config.path), batch.manifest.actor);
            }
        },
        { capability: 'content' },
    );
}

async function setOriginalStatistics(
    batch: ValidatedProblemBatch,
    entry: ValidatedProblemBatchEntry,
    pdoc: ProblemDoc,
    actorUser: any,
): Promise<void> {
    if (pdoc.origStat) {
        if (
            pdoc.origStat.accepted !== entry.origStat.accepted ||
            pdoc.origStat.submitted !== entry.origStat.submitted ||
            pdoc.origStat.updatedBy !== batch.manifest.actor ||
            !(pdoc.origStat.updatedAt instanceof Date)
        ) {
            fail(`${entry.sourceProblemCode}: original contest statistics conflict`, 'BATCH_IMPORT_STAT_CONFLICT', pdoc.origStat);
        }
        await ensureOriginalStatisticsAudit(batch, entry, pdoc);
        return;
    }
    await ProblemModel.editAuthorized(
        batch.manifest.domain,
        pdoc.docId,
        {
            origStat: {
                accepted: entry.origStat.accepted,
                submitted: entry.origStat.submitted,
                updatedBy: batch.manifest.actor,
                updatedAt: new Date(),
            },
        } as any,
        actorUser,
    );
    await ensureOriginalStatisticsAudit(batch, entry, pdoc);
}

function originalStatisticsAuditIdentity(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry) {
    return {
        type: 'realpass.batch-import',
        domainId: batch.manifest.domain,
        requestId: `problem-batch:${batch.manifest.batchId}:${entry.sourceProblemCode}:orig-stat`,
    };
}

function assertOriginalStatisticsAuditRecord(record: any, batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry, pdoc: ProblemDoc): void {
    if (
        !record ||
        record.operator !== batch.manifest.actor ||
        record.problemId !== pdoc.docId ||
        record.batchId !== batch.manifest.batchId ||
        record.sourceProblemCode !== entry.sourceProblemCode ||
        record.accepted !== entry.origStat.accepted ||
        record.submitted !== entry.origStat.submitted ||
        record.result !== 'success'
    ) {
        fail(`${entry.sourceProblemCode}: original statistics audit is missing or conflicting`, 'BATCH_IMPORT_AUDIT_CONFLICT', record);
    }
}

async function findOriginalStatisticsAudit(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry) {
    return OplogModel.coll.findOne(originalStatisticsAuditIdentity(batch, entry));
}

async function ensureOriginalStatisticsAudit(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry, pdoc: ProblemDoc): Promise<void> {
    const existing = await findOriginalStatisticsAudit(batch, entry);
    if (existing) {
        assertOriginalStatisticsAuditRecord(existing, batch, entry, pdoc);
        return;
    }
    const identity = originalStatisticsAuditIdentity(batch, entry);
    try {
        await OplogModel.add({
            ...identity,
            operator: batch.manifest.actor,
            problemId: pdoc.docId,
            batchId: batch.manifest.batchId,
            sourceProblemCode: entry.sourceProblemCode,
            accepted: entry.origStat.accepted,
            submitted: entry.origStat.submitted,
            result: 'success',
            time: new Date(),
        } as any);
    } catch (error) {
        const confirmed = await findOriginalStatisticsAudit(batch, entry);
        if (!confirmed) {
            logger.error(
                'Problem batch original statistics audit failed batchId=%s sourceProblemCode=%s docId=%d requestId=%s stage=orig-stat-audit result=failed error=%o',
                batch.manifest.batchId,
                entry.sourceProblemCode,
                pdoc.docId,
                identity.requestId,
                error,
            );
            throw error;
        }
        assertOriginalStatisticsAuditRecord(confirmed, batch, entry, pdoc);
        logger.warn(
            'Problem batch original statistics audit confirmed after lost response batchId=%s sourceProblemCode=%s docId=%d requestId=%s stage=orig-stat-audit result=confirmed',
            batch.manifest.batchId,
            entry.sourceProblemCode,
            pdoc.docId,
            identity.requestId,
        );
    }
}

async function assertOriginalStatisticsAudit(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry, pdoc: ProblemDoc): Promise<void> {
    assertOriginalStatisticsAuditRecord(await findOriginalStatisticsAudit(batch, entry), batch, entry, pdoc);
}

async function assertFileSet(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry, pdoc: ProblemDoc): Promise<void> {
    const expectedData = [...entry.testdataFiles, entry.configFile];
    const actualData = (pdoc.data || []).map((file) => file.name).sort();
    const expectedDataNames = expectedData.map((file) => file.name).sort();
    if (!equal(actualData, expectedDataNames)) {
        fail(`${entry.sourceProblemCode}: testdata metadata differs from manifest`, 'BATCH_IMPORT_FILE_CONFLICT');
    }
    const actualAssets = (pdoc.additional_file || []).map((file) => file.name).sort();
    const expectedAssets = entry.assetFiles.map((file) => file.target).sort();
    if (!equal(actualAssets, expectedAssets)) fail(`${entry.sourceProblemCode}: asset metadata differs from manifest`, 'BATCH_IMPORT_FILE_CONFLICT');
    for (const file of expectedData) {
        const state = await assertStoredFile(
            `problem/${batch.manifest.domain}/${pdoc.docId}/testdata/${file.name}`,
            file,
            `${entry.sourceProblemCode}/${file.name}`,
        );
        if (state !== 'exact') fail(`${entry.sourceProblemCode}: testdata file is missing: ${file.name}`, 'BATCH_IMPORT_FILE_MISSING');
    }
    for (const file of entry.assetFiles) {
        const state = await assertStoredFile(
            `problem/${batch.manifest.domain}/${pdoc.docId}/additional_file/${file.target}`,
            file,
            `${entry.sourceProblemCode}/${file.target}`,
        );
        if (state !== 'exact') fail(`${entry.sourceProblemCode}: asset file is missing: ${file.target}`, 'BATCH_IMPORT_FILE_MISSING');
    }
}

async function assertDraftReady(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry, pdoc: ProblemDoc): Promise<void> {
    const statement = await fs.readFile(entry.statementFile.path, 'utf8');
    const config = await fs.readFile(entry.configFile.path, 'utf8');
    if (pdoc.content !== statement) fail(`${entry.sourceProblemCode}: statement content conflicts`, 'BATCH_IMPORT_CONTENT_CONFLICT');
    if (pdoc.config !== config) fail(`${entry.sourceProblemCode}: parsed judge config differs from the local config`, 'BATCH_IMPORT_CONFIG_INVALID');
    if (
        pdoc.batchImport?.identity !== `${batch.manifest.batchId}:${entry.sourceProblemCode}` ||
        pdoc.batchImport?.fingerprint !== entry.fingerprint
    ) {
        fail(`${entry.sourceProblemCode}: durable import identity conflicts`, 'BATCH_IMPORT_IDENTITY_CONFLICT');
    }
    if (!pdoc.structureRevision || pdoc.structureLockedAt || pdoc.archivedAt) {
        fail(`${entry.sourceProblemCode}: draft structure is not writable`, 'BATCH_IMPORT_STRUCTURE_CONFLICT');
    }
    ProblemModel.assertProblemReadyForUse(pdoc, { actor: batch.manifest.actor, stage: 'batch-import-draft-ready' });
    assertProgrammingTestcasesConfigured(pdoc.config, pdoc.data);
    await loadAuthorPermit(batch.manifest.domain, pdoc.docId, batch.manifest.author.uid);
    await assertFileSet(batch, entry, pdoc);
}

async function verifyImportedProblem(batch: ValidatedProblemBatch, entry: ValidatedProblemBatchEntry, plannedPid: string) {
    const pdoc = await loadIdentityProblem(batch, entry);
    if (!pdoc) fail(`${entry.sourceProblemCode}: imported problem is missing`, 'BATCH_IMPORT_VERIFY_FAILED');
    if (
        pdoc.pid !== plannedPid ||
        pdoc.title !== entry.title ||
        pdoc.difficulty !== entry.difficulty ||
        pdoc.hidden !== false ||
        pdoc.problemKind !== 'programming' ||
        pdoc.authoringMode !== 'managed' ||
        pdoc.managedAuthoring?.metadataStatus !== 'confirmed' ||
        pdoc.managedAuthoring?.approvedBy !== batch.manifest.actor ||
        !(pdoc.managedAuthoring?.approvedAt instanceof Date) ||
        pdoc.managedAuthoring?.pendingTrainingPlacement !== undefined ||
        !equal((pdoc.managedAuthoring?.selectedMindmapNodeIds || []).map(String).sort(), [...entry.mindmapNodeIds].sort()) ||
        pdoc.hasBatchImportIdentity !== true ||
        !isDeepStrictEqual(normalizeManagedSourceMeta(pdoc.sourceMeta), normalizeManagedSourceMeta(batch.manifest.source))
    ) {
        fail(`${entry.sourceProblemCode}: published problem metadata differs from the plan`, 'BATCH_IMPORT_VERIFY_FAILED');
    }
    if (
        pdoc.origStat?.accepted !== entry.origStat.accepted ||
        pdoc.origStat?.submitted !== entry.origStat.submitted ||
        pdoc.origStat?.updatedBy !== batch.manifest.actor ||
        !(pdoc.origStat?.updatedAt instanceof Date)
    ) {
        fail(`${entry.sourceProblemCode}: original contest statistics differ from the plan`, 'BATCH_IMPORT_VERIFY_FAILED');
    }
    await assertOriginalStatisticsAudit(batch, entry, pdoc);
    if ((pdoc as ProblemDoc & { aclWriteClaim?: unknown }).aclWriteClaim) {
        fail(`${entry.sourceProblemCode}: a durable write claim remains`, 'BATCH_IMPORT_VERIFY_FAILED');
    }
    const knowledge = await materializeManagedMindmapTags(entry.mindmapNodeIds);
    const expectedTags = [...new Set([...deriveManagedSourceTags(batch.manifest.source), ...knowledge.tags])];
    if (!equal(pdoc.tag, expectedTags)) fail(`${entry.sourceProblemCode}: canonical tags differ from the plan`, 'BATCH_IMPORT_VERIFY_FAILED');
    await assertDraftReady(batch, entry, pdoc);
    return {
        sourceProblemCode: entry.sourceProblemCode,
        docId: pdoc.docId,
        pid: pdoc.pid,
        hidden: pdoc.hidden,
        metadataStatus: pdoc.managedAuthoring.metadataStatus,
        testdataFiles: pdoc.data.length,
        cases: entry.testdata.cases.length,
        assets: pdoc.additional_file.length,
    };
}

async function verifyBatch(batch: ValidatedProblemBatch, plan: ProblemBatchImportPlan): Promise<ProblemBatchVerifyResult> {
    const current = await assertApplyFacts(batch, plan);
    const expectedFinalCounter = plan.facts.counter.value + plan.facts.problems.filter((entry) => entry.state === 'new').length;
    if (current.counter.value !== expectedFinalCounter) {
        fail(`final PID counter differs from plan: expected ${expectedFinalCounter}, got ${current.counter.value}`, 'BATCH_IMPORT_VERIFY_FAILED');
    }
    const plannedByCode = new Map(plan.facts.problems.map((entry) => [entry.sourceProblemCode, entry]));
    const problems = [] as ProblemBatchVerifyResult['problems'];
    for (const entry of batch.problems) {
        const planned = plannedByCode.get(entry.sourceProblemCode);
        if (!planned) fail(`${entry.sourceProblemCode}: missing preflight problem plan`, 'BATCH_IMPORT_VERIFY_FAILED');
        problems.push(await verifyImportedProblem(batch, entry, planned.pid));
    }
    const training = await document.coll.findOne({
        domainId: batch.manifest.domain,
        docType: document.TYPE_TRAINING,
        docId: new ObjectId(batch.manifest.training.id),
        title: batch.manifest.training.title,
        kind: { $ne: 'course' },
    });
    const chapter = Array.isArray(training?.dag)
        ? training.dag.find((candidate) => candidate?._id === plan.facts.training.chapterId && candidate?.title === plan.facts.training.chapterTitle)
        : null;
    if (!training || !chapter || training.dag[0] !== chapter) {
        fail('final training chapter is missing or no longer first', 'BATCH_IMPORT_VERIFY_FAILED');
    }
    await TrainingModel.assertProblemBatchChapterAudit({
        domainId: batch.manifest.domain,
        trainingId: new ObjectId(batch.manifest.training.id),
        chapterId: plan.facts.training.chapterId,
        chapterTitle: plan.facts.training.chapterTitle,
        batchId: batch.manifest.batchId,
        actor: batch.manifest.actor,
    });
    const expectedPids = problems.map((problem) => problem.docId);
    const actualPids = Array.isArray(chapter.pids) ? chapter.pids.map(Number) : [];
    if (!equal(actualPids, expectedPids)) fail('final training chapter members differ from manifest order', 'BATCH_IMPORT_VERIFY_FAILED');
    return {
        ok: true,
        batchId: batch.manifest.batchId,
        problems,
        training: {
            id: String(training.docId),
            chapterId: chapter._id,
            chapterTitle: chapter.title,
            pids: actualPids,
        },
    };
}

export class HydroProblemBatchImportAdapter implements ProblemBatchImportAdapter {
    preflight(batch: ValidatedProblemBatch): Promise<ProblemBatchProductionFacts> {
        return buildProductionFacts(batch);
    }

    async apply(
        batch: ValidatedProblemBatch,
        plan: ProblemBatchImportPlan,
        _report: ProblemBatchExecutionReport,
        progress: (event: ProblemBatchProgressEvent) => Promise<void>,
    ): Promise<ProblemBatchVerifyResult> {
        await assertApplyFacts(batch, plan);
        const { actor } = await loadUsers(batch);
        const plannedByCode = new Map(plan.facts.problems.map((entry) => [entry.sourceProblemCode, entry]));
        logger.info(
            'Problem batch apply start batchId=%s actor=%d problems=%d fingerprint=%s stage=apply',
            batch.manifest.batchId,
            batch.manifest.actor,
            batch.problems.length,
            plan.fingerprint,
        );

        for (const entry of batch.problems) {
            const planned = plannedByCode.get(entry.sourceProblemCode)!;
            let pdoc = await loadIdentityProblem(batch, entry);
            if (!pdoc) {
                const statement = await fs.readFile(entry.statementFile.path, 'utf8');
                const created = await ProblemModel.createManagedProgrammingDraft(
                    batch.manifest.domain,
                    {
                        workingTitle: entry.title,
                        content: statement,
                        difficulty: entry.difficulty,
                        sourceMeta: batch.manifest.source,
                        mindmapNodeIds: entry.mindmapNodeIds,
                        authorUid: batch.manifest.author.uid,
                        batchImport: {
                            batchId: batch.manifest.batchId,
                            sourceProblemCode: entry.sourceProblemCode,
                            fingerprint: entry.fingerprint,
                        },
                    },
                    batch.manifest.actor,
                    actor,
                );
                if (created.pid !== planned.pid) {
                    fail(
                        `${entry.sourceProblemCode}: reserved PID differs from approved plan: expected ${planned.pid}, got ${created.pid}`,
                        'BATCH_IMPORT_PID_CONFLICT',
                    );
                }
                await progress({ stage: 'draft-created', sourceProblemCode: entry.sourceProblemCode, docId: created.docId, pid: created.pid });
                pdoc = await loadIdentityProblem(batch, entry);
                if (!pdoc || pdoc.docId !== created.docId) fail(`${entry.sourceProblemCode}: created draft cannot be reloaded`);
            } else if (pdoc.pid !== planned.pid) {
                fail(`${entry.sourceProblemCode}: existing identity PID differs from approved plan`, 'BATCH_IMPORT_PID_CONFLICT');
            }
        }

        for (const entry of batch.problems) {
            let pdoc = await loadIdentityProblem(batch, entry);
            if (!pdoc) fail(`${entry.sourceProblemCode}: draft disappeared before upload`);
            if (problemBatchDocumentState(pdoc) === 'published') {
                await verifyImportedProblem(batch, entry, plannedByCode.get(entry.sourceProblemCode)!.pid);
                continue;
            }
            await uploadMissingDraftFiles(batch, entry, pdoc, actor);
            pdoc = (await loadIdentityProblem(batch, entry))!;
            await setOriginalStatistics(batch, entry, pdoc, actor);
            pdoc = (await loadIdentityProblem(batch, entry))!;
            await assertDraftReady(batch, entry, pdoc);
            await progress({ stage: 'draft-ready', sourceProblemCode: entry.sourceProblemCode, docId: pdoc.docId, pid: pdoc.pid });
        }

        await assertApplyFacts(batch, plan);
        const chapter = await TrainingModel.ensureProblemBatchChapter({
            domainId: batch.manifest.domain,
            trainingId: new ObjectId(batch.manifest.training.id),
            trainingTitle: batch.manifest.training.title,
            chapterId: plan.facts.training.chapterId,
            chapterTitle: plan.facts.training.chapterTitle,
            expectedCurrentMaxChapterId: plan.facts.training.currentMaxChapterId,
            batchId: batch.manifest.batchId,
            user: actor,
        });
        await progress({ stage: 'training-ready', note: chapter.created ? 'created' : 'existing' });

        for (const entry of batch.problems) {
            const planned = plannedByCode.get(entry.sourceProblemCode)!;
            let pdoc = await loadIdentityProblem(batch, entry);
            if (!pdoc) fail(`${entry.sourceProblemCode}: draft disappeared before publication`);
            if (problemBatchDocumentState(pdoc) === 'published') continue;
            await assertDraftReady(batch, entry, pdoc);
            if (!Number.isSafeInteger(pdoc.structureRevision)) fail(`${entry.sourceProblemCode}: structure revision is missing`);
            const placement = pdoc.managedAuthoring?.pendingTrainingPlacement;
            if (!placement || String(placement.trainingId) !== batch.manifest.training.id || placement.chapterId !== plan.facts.training.chapterId) {
                pdoc = await ProblemModel.setManagedProgrammingDraftTrainingPlacement({
                    domainId: batch.manifest.domain,
                    docId: pdoc.docId,
                    trainingId: new ObjectId(batch.manifest.training.id),
                    chapterId: plan.facts.training.chapterId,
                    expectedStructureRevision: pdoc.structureRevision!,
                    expectedBatchImportIdentity: `${batch.manifest.batchId}:${entry.sourceProblemCode}`,
                    actor: batch.manifest.actor,
                    user: actor,
                });
            }
            const published = await ProblemModel.publishManagedProgrammingProblem({
                domainId: batch.manifest.domain,
                docId: pdoc.docId,
                formalTitle: entry.title,
                difficulty: entry.difficulty,
                expectedStructureRevision: pdoc.structureRevision!,
                actor: batch.manifest.actor,
                user: actor,
            });
            if (published.state !== 'published') {
                logger.error(
                    'Problem batch publication incomplete batchId=%s sourceProblemCode=%s docId=%d pid=%s requestId=%s incompleteStages=%o stage=publication result=incomplete',
                    batch.manifest.batchId,
                    entry.sourceProblemCode,
                    pdoc.docId,
                    planned.pid,
                    published.requestId,
                    published.incompleteStages,
                );
                await progress({
                    stage: 'publication-incomplete',
                    sourceProblemCode: entry.sourceProblemCode,
                    docId: pdoc.docId,
                    pid: planned.pid,
                    requestId: published.requestId,
                    incompleteStages: [...published.incompleteStages],
                });
                fail(`${entry.sourceProblemCode}: publication committed with incomplete stages`, 'BATCH_IMPORT_PUBLICATION_INCOMPLETE', published);
            }
            await progress({ stage: 'published', sourceProblemCode: entry.sourceProblemCode, docId: pdoc.docId, pid: planned.pid });
        }

        const result = await verifyBatch(batch, plan);
        logger.info(
            'Problem batch apply complete batchId=%s actor=%d problems=%d chapter=%d stage=verify result=success',
            batch.manifest.batchId,
            batch.manifest.actor,
            result.problems.length,
            result.training.chapterId,
        );
        return result;
    }

    verify(batch: ValidatedProblemBatch, plan: ProblemBatchImportPlan): Promise<ProblemBatchVerifyResult> {
        return verifyBatch(batch, plan);
    }
}

export default HydroProblemBatchImportAdapter;
