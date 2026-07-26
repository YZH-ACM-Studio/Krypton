import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import yaml from 'js-yaml';
import { after, before, describe, it } from 'node:test';
import {
    applyProblemBatchImport,
    createProblemBatchExecutionReport,
    type ProblemBatchExecutionReport,
    type ProblemBatchImportAdapter,
    type ProblemBatchProductionFacts,
    type ProblemBatchVerifyResult,
    preflightProblemBatchImport,
    problemBatchValidationSummary,
    validateProblemBatchManifest,
    verifyProblemBatchImport,
} from '../src/lib/problem-batch-import';
import { compileProgrammingStatement, emptyProgrammingStatement } from '../src/lib/programming-statement';
import { problemBatchCommandInternals } from '../src/commands/problem-batch-import';

const caseCounts = [10, 30, 43, 43, 3, 14, 30];
const problemRows = [
    ['A', '2090 Virus', 1582, 1583],
    ['C', 'Fish Eating', 260, 398],
    ['E', 'Permutation Evaluation', 1578, 1579],
    ['F', 'Permutation Generation', 1135, 1413],
    ['G', 'Precision Error?!', 419, 547],
    ['H', 'Rock-Paper-Scissors Master', 112, 127],
    ['J', 'Show Hand', 361, 582],
] as const;
const nodeId = '64b000000000000000000011';
const mapId = '64a000000000000000000001';

async function writeFixture(root: string): Promise<string> {
    const problems = [] as any[];
    for (let index = 0; index < problemRows.length; index++) {
        const [code, title, accepted, submitted] = problemRows[index];
        const directory = path.join(root, 'problems', code);
        const dataDirectory = path.join(directory, 'testdata');
        await fsp.mkdir(dataDirectory, { recursive: true });
        const canonicalStatement = {
            ...emptyProgrammingStatement(),
            background: { state: 'absent' as const, content: '' },
            description: { state: 'present' as const, content: `# ${title}\n\n![diagram](file://diagram.png)` },
            input: { state: 'present' as const, content: '输入一个整数。' },
            output: { state: 'present' as const, content: '输出答案。' },
            examples: {
                state: 'present' as const,
                items: [{ input: '1', inputEmpty: false, output: '1', outputEmpty: false, note: '' }],
            },
            hints: { state: 'absent' as const, content: '' },
        };
        const statement = compileProgrammingStatement(canonicalStatement);
        await fsp.writeFile(path.join(directory, 'statement.md'), statement);
        await fsp.writeFile(path.join(directory, 'programming-statement.json'), JSON.stringify(canonicalStatement));
        await fsp.writeFile(path.join(directory, 'diagram.png'), Buffer.from(`asset-${code}`));
        const cases = [] as Array<{ input: string; output: string }>;
        const files = [] as string[];
        for (let caseIndex = 1; caseIndex <= caseCounts[index]; caseIndex++) {
            const input = `${caseIndex}.in`;
            const output = `${caseIndex}.out`;
            cases.push({ input, output });
            files.push(input, output);
            await Promise.all([
                fsp.writeFile(path.join(dataDirectory, input), `${caseIndex}\n`),
                fsp.writeFile(path.join(dataDirectory, output), `${caseIndex}\n`),
            ]);
        }
        await fsp.writeFile(path.join(directory, 'config.yaml'), yaml.dump({ time: '1s', memory: '256m', cases }));
        problems.push({
            sourceProblemCode: code,
            title,
            difficulty: Math.min(10, index + 2),
            mindmapNodeIds: [nodeId],
            origStat: { accepted, submitted },
            statement: `problems/${code}/statement.md`,
            programmingStatement: `problems/${code}/programming-statement.json`,
            assets: [{ source: `problems/${code}/diagram.png`, target: 'diagram.png' }],
            testdata: {
                directory: `problems/${code}/testdata`,
                files,
                config: `problems/${code}/config.yaml`,
                checker: null,
                cases,
            },
        });
    }
    const manifestPath = path.join(root, 'batch.json');
    await fsp.writeFile(
        manifestPath,
        `${JSON.stringify(
            {
                schemaVersion: 2,
                batchId: 'nowcoder-2026-summer-1',
                domain: 'system',
                actor: 2,
                source: { template: 'nowcoder_summer', year: 2026, round: 1 },
                author: { uid: 515, username: 'nowcoder-2026' },
                training: {
                    id: '68486d8165edbb11e9ec9036',
                    title: '牛客暑期多校训练集',
                    chapterTitle: '2026年牛客-第1场',
                },
                selection: { field: 'accepted', operator: '>', value: 100, source: 'official contest screenshot' },
                problems,
            },
            null,
            2,
        )}\n`,
    );
    return manifestPath;
}

function productionFacts(batch: Awaited<ReturnType<typeof validateProblemBatchManifest>>): ProblemBatchProductionFacts {
    return {
        domain: 'system',
        actor: { uid: 2, username: 'root' },
        author: { uid: 515, username: 'nowcoder-2026' },
        counter: { namespace: 'nowcoder', value: 1063 },
        training: {
            id: '68486d8165edbb11e9ec9036',
            title: '牛客暑期多校训练集',
            chapterId: 8,
            chapterTitle: '2026年牛客-第1场',
            chapterState: 'missing',
            chapterMode: 'create-front',
            chapterPosition: 0,
            currentMaxChapterId: 7,
            nonTargetDagFingerprint: 'f'.repeat(64),
            targetPids: [],
            replacePids: [],
        },
        knowledgeMaps: [{ id: mapId, title: '算法知识图谱' }],
        mindmapNodes: [{ id: nodeId, mapId, topic: '模拟', tags: ['模拟'] }],
        problems: batch.problems.map((entry, index) => ({
            sourceProblemCode: entry.sourceProblemCode,
            fingerprint: entry.fingerprint,
            pid: `NK${1064 + index}`,
            knowledgeMapId: mapId,
            state: 'new',
        })),
        suspectedDuplicates: [],
    };
}

function verifyResult(batch: Awaited<ReturnType<typeof validateProblemBatchManifest>>): ProblemBatchVerifyResult {
    return {
        ok: true,
        batchId: batch.manifest.batchId,
        problems: batch.problems.map((entry, index) => ({
            sourceProblemCode: entry.sourceProblemCode,
            docId: 2000 + index,
            pid: `NK${1064 + index}`,
            hidden: false,
            metadataStatus: 'confirmed',
            testdataFiles: entry.testdataFiles.length + 1,
            cases: entry.testdata.cases.length,
            assets: entry.assetFiles.length,
        })),
        training: {
            id: batch.manifest.training.id,
            chapterId: 8,
            chapterTitle: batch.manifest.training.chapterTitle,
            pids: batch.problems.map((_, index) => 2000 + index),
        },
    };
}

class FixtureAdapter implements ProblemBatchImportAdapter {
    applyCalls = 0;
    verifyCalls = 0;

    constructor(
        readonly facts: ProblemBatchProductionFacts,
        readonly result: ProblemBatchVerifyResult,
    ) {}

    async preflight() {
        return structuredClone(this.facts);
    }

    async apply(_batch: any, _plan: any, _report: any, progress: any) {
        this.applyCalls++;
        await progress({ stage: 'draft-created', sourceProblemCode: 'A', docId: 2000, pid: 'NK1064' });
        await progress({ stage: 'published', sourceProblemCode: 'A', docId: 2000, pid: 'NK1064' });
        return structuredClone(this.result);
    }

    async verify() {
        this.verifyCalls++;
        return structuredClone(this.result);
    }
}

async function expectReject(work: Promise<unknown>, message: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.have.property('message').that.includes(message);
        return;
    }
    expect.fail('expected promise to reject');
}

describe('P2.23 canonical problem batch import', () => {
    let root: string;
    let manifestPath: string;
    let commandHarnessPath: string;

    before(async () => {
        root = await fsp.mkdtemp(path.join(os.tmpdir(), 'problem-batch-import-'));
        manifestPath = await writeFixture(root);
        commandHarnessPath = path.join(root, 'command-harness.cjs');
        await fsp.writeFile(
            commandHarnessPath,
            `
const cacModule = require(${JSON.stringify(require.resolve('cac'))});
const cac = cacModule.default || cacModule;
const { register } = require(${JSON.stringify(require.resolve('../src/commands/problem-batch-import.ts'))});
function result(batch) {
  return {
    ok: true,
    batchId: batch.manifest.batchId,
    problems: batch.problems.map((entry, index) => ({
      sourceProblemCode: entry.sourceProblemCode,
      docId: 2000 + index,
      pid: 'NK' + (1064 + index),
      hidden: false,
      metadataStatus: 'confirmed',
      testdataFiles: entry.testdataFiles.length + 1,
      cases: entry.testdata.cases.length,
      assets: entry.assetFiles.length,
    })),
    training: {
      id: batch.manifest.training.id,
      chapterId: 8,
      chapterTitle: batch.manifest.training.chapterTitle,
      pids: batch.problems.map((_, index) => 2000 + index),
    },
  };
}
const adapter = {
  async preflight(batch) {
    return {
      domain: batch.manifest.domain,
      actor: { uid: batch.manifest.actor, username: 'root' },
      author: { ...batch.manifest.author },
      counter: { namespace: 'nowcoder', value: 1063 },
      training: {
        id: batch.manifest.training.id,
        title: batch.manifest.training.title,
        chapterId: 8,
        chapterTitle: batch.manifest.training.chapterTitle,
        chapterState: 'missing',
        chapterMode: 'create-front',
        chapterPosition: 0,
        currentMaxChapterId: 7,
        nonTargetDagFingerprint: 'f'.repeat(64),
        targetPids: [],
        replacePids: [],
      },
      mindmapNodes: [{ id: ${JSON.stringify(nodeId)}, topic: '模拟', tags: ['模拟'] }],
      problems: batch.problems.map((entry, index) => ({
        sourceProblemCode: entry.sourceProblemCode,
        fingerprint: entry.fingerprint,
        pid: 'NK' + (1064 + index),
        state: 'new',
      })),
      suspectedDuplicates: [],
    };
  },
  async apply(batch, _plan, _report, progress) {
    await progress({ stage: 'draft-created', sourceProblemCode: batch.problems[0].sourceProblemCode, docId: 2000, pid: 'NK1064' });
    return result(batch);
  },
  async verify(batch) { return result(batch); },
};
const cli = cac();
register(cli, { loadRuntimeAdapter: async () => adapter });
cli.parse(process.argv, { run: false });
Promise.resolve(cli.runMatchedCommand()).catch((error) => {
  process.stderr.write(String(error && (error.stack || error.message) || error) + '\\n', () => process.exit(1));
});
`,
        );
    });

    after(() => fs.rmSync(root, { recursive: true, force: true }));

    it('validates the real seven-problem shape with exactly 173 test cases and canonical filenames', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const summary = problemBatchValidationSummary(batch);
        expect(summary.problems).to.have.length(7);
        expect(summary.totalCases).to.equal(173);
        expect(batch.problems[0].testdataFiles[0].name).to.equal('1.in');
        expect(batch.problems[0].configFile.name).to.equal('config.yaml');
    });

    it('keeps legacy manifests public by default and accepts batch or per-problem visibility', async () => {
        const legacy = await validateProblemBatchManifest(manifestPath);
        expect(legacy.manifest.visibility).to.equal(undefined);
        expect(problemBatchValidationSummary(legacy).problems[0].visibility).to.equal('public');

        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        manifest.visibility = 'hidden';
        const hiddenPath = path.join(root, 'hidden.json');
        await fsp.writeFile(hiddenPath, JSON.stringify(manifest));
        const hidden = await validateProblemBatchManifest(hiddenPath);
        expect(hidden.manifest.visibility).to.equal('hidden');
        expect(hidden.fingerprint).not.to.equal(legacy.fingerprint);
        expect(problemBatchValidationSummary(hidden).visibility).to.equal('hidden');
        expect(problemBatchValidationSummary(hidden).problems[0].visibility).to.equal('hidden');

        manifest.problems[0].visibility = 'public';
        const mixedPath = path.join(root, 'mixed-visibility.json');
        await fsp.writeFile(mixedPath, JSON.stringify(manifest));
        const mixed = await validateProblemBatchManifest(mixedPath);
        expect(mixed.problems[0].visibility).to.equal('public');
        expect(problemBatchValidationSummary(mixed).problems[0].visibility).to.equal('public');
        expect(mixed.fingerprint).not.to.equal(hidden.fingerprint);

        manifest.visibility = 'private';
        const invalidPath = path.join(root, 'invalid-visibility.json');
        await fsp.writeFile(invalidPath, JSON.stringify(manifest));
        await expectReject(validateProblemBatchManifest(invalidPath), 'visibility must be public or hidden');

        manifest.visibility = 'public';
        manifest.problems[0].visibility = 'private';
        const invalidProblemPath = path.join(root, 'invalid-problem-visibility.json');
        await fsp.writeFile(invalidProblemPath, JSON.stringify(manifest));
        await expectReject(validateProblemBatchManifest(invalidProblemPath), 'problems[0].visibility must be public or hidden');
    });

    it('accepts an explicit source-code selection without inventing unavailable contest statistics', async () => {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        manifest.batchId = 'pat-advanced-2021-spring';
        manifest.source = { template: 'pat_advanced', year: 2021, season: 'spring' };
        manifest.training.chapterId = 47;
        manifest.training.replacePids = [2678];
        manifest.selection = {
            field: 'sourceProblemCode',
            operator: 'in',
            value: manifest.problems.map((problem: any) => problem.sourceProblemCode),
            source: 'user-provided complete problem list',
        };
        for (const problem of manifest.problems) delete problem.origStat;
        const explicitPath = path.join(root, 'explicit-no-stat.json');
        await fsp.writeFile(explicitPath, JSON.stringify(manifest));

        const batch = await validateProblemBatchManifest(explicitPath);
        expect(batch.manifest.training).to.include({ chapterId: 47 });
        expect(batch.manifest.training.replacePids).to.deep.equal([2678]);
        expect(batch.problems.every((problem) => problem.origStat === undefined)).to.equal(true);
        expect(problemBatchValidationSummary(batch).problems[0]).to.include({ accepted: null, submitted: null });

        manifest.training.replacePids = [];
        const emptyReplacementPath = path.join(root, 'explicit-empty-replacement.json');
        await fsp.writeFile(emptyReplacementPath, JSON.stringify(manifest));
        await expectReject(validateProblemBatchManifest(emptyReplacementPath), 'training.replacePids must be non-empty');
        manifest.training.replacePids = [2678];

        manifest.selection.value.push('missing-code');
        const incompletePath = path.join(root, 'explicit-incomplete-selection.json');
        await fsp.writeFile(incompletePath, JSON.stringify(manifest));
        await expectReject(validateProblemBatchManifest(incompletePath), 'selection.value must exactly match');

        manifest.selection = { field: 'accepted', operator: '>=', value: 0, source: 'invalid fixture' };
        const invalidPath = path.join(root, 'accepted-without-stat.json');
        await fsp.writeFile(invalidPath, JSON.stringify(manifest));
        await expectReject(validateProblemBatchManifest(invalidPath), 'does not satisfy the declared selection rule');
    });

    it('rejects undeclared fields, traversal, missing assets, and config drift before loading runtime', async () => {
        const original = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        await fsp.writeFile(path.join(root, 'bad-statement.json'), JSON.stringify({ schemaVersion: 1, locale: 'zh-CN' }));
        const cases = [
            ['PID fields', (manifest: any) => (manifest.problems[0].pid = 'NK9999'), 'unsupported fields'],
            ['path traversal', (manifest: any) => (manifest.problems[0].statement = '../statement.md'), 'escapes the batch directory'],
            ['missing asset', (manifest: any) => (manifest.problems[0].assets[0].source = 'missing.png'), 'is missing'],
            [
                'reserved config filename',
                (manifest: any) => {
                    manifest.problems[0].testdata.files[0] = 'config.yaml';
                    manifest.problems[0].testdata.cases[0].input = 'config.yaml';
                },
                'reserved name config.yaml',
            ],
            [
                'missing checker',
                (manifest: any) => {
                    manifest.problems[0].testdata.checker = 'checker.cc';
                    manifest.problems[0].testdata.files.push('checker.cc');
                },
                'file list differs from disk',
            ],
            ['empty cases', (manifest: any) => (manifest.problems[0].testdata.cases = []), 'cases must be non-empty'],
            [
                'bad structured statement',
                (manifest: any) => {
                    manifest.problems[0].programmingStatement = 'bad-statement.json';
                },
                'programmingStatement is invalid',
            ],
        ] as const;
        for (const [name, mutate, message] of cases) {
            const filename = path.join(root, `${name.replace(/\s/g, '-')}.json`);
            const manifest = structuredClone(original);
            mutate(manifest);
            await fsp.writeFile(filename, JSON.stringify(manifest));
            await expectReject(validateProblemBatchManifest(filename), message);
        }
        const configPath = path.join(root, original.problems[0].testdata.config);
        const savedConfig = await fsp.readFile(configPath, 'utf8');
        await fsp.writeFile(configPath, yaml.dump({ time: '1s', memory: '256m', cases: [] }));
        await expectReject(validateProblemBatchManifest(manifestPath), 'config cases differ');
        await fsp.writeFile(configPath, savedConfig);
    });

    it('rejects a batch symlink whose real target escapes the manifest directory', async () => {
        const original = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'problem-batch-outside-'));
        try {
            const outsideStatement = path.join(outside, 'statement.md');
            await fsp.writeFile(outsideStatement, '# Outside\n\n```input1\n1\n```\n\n```output1\n1\n```\n');
            const link = path.join(root, 'outside-statement.md');
            await fsp.symlink(outsideStatement, link);
            original.problems[0].statement = 'outside-statement.md';
            const symlinkManifest = path.join(root, 'symlink.json');
            await fsp.writeFile(symlinkManifest, JSON.stringify(original));

            await expectReject(validateProblemBatchManifest(symlinkManifest), 'resolves outside the batch directory');
        } finally {
            await fsp.rm(outside, { recursive: true, force: true });
        }
    });

    it('binds apply to the approved fingerprint, token, actor, and resumable execution report', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new FixtureAdapter(productionFacts(batch), verifyResult(batch));
        const plan = await preflightProblemBatchImport(batch, adapter);
        const report = createProblemBatchExecutionReport(plan, 2);
        const snapshots: ProblemBatchExecutionReport[] = [];
        const persistReport = async (next: ProblemBatchExecutionReport) => {
            snapshots.push(structuredClone(next));
        };
        await expectReject(
            applyProblemBatchImport({
                batch,
                plan,
                adapter,
                actor: 2,
                fingerprint: '0'.repeat(64),
                confirmationToken: plan.confirmationToken,
                report,
                persistReport,
            }),
            'fingerprint does not match',
        );
        const result = await applyProblemBatchImport({
            batch,
            plan,
            adapter,
            actor: 2,
            fingerprint: plan.fingerprint,
            confirmationToken: plan.confirmationToken,
            report,
            persistReport,
        });
        expect(result.problems).to.have.length(7);
        expect(adapter.applyCalls).to.equal(1);
        expect(report.state).to.equal('applied');
        expect(report.events.map((event) => event.stage)).to.deep.equal(['draft-created', 'published']);
        expect(snapshots.length).to.be.greaterThan(2);

        await verifyProblemBatchImport({ batch, plan, adapter, report, persistReport });
        expect(adapter.verifyCalls).to.equal(1);
        expect(report.state).to.equal('verified');
        expect(report.events.at(-1)?.stage).to.equal('verified');
    });

    it('treats actor and author usernames as current display snapshots instead of identity locks', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const facts = productionFacts(batch);
        facts.actor.username = 'renamed-admin';
        facts.author.username = 'renamed-source-author';

        const plan = await preflightProblemBatchImport(batch, new FixtureAdapter(facts, verifyResult(batch)));

        expect(plan.facts.actor).to.deep.equal({ uid: batch.manifest.actor, username: 'renamed-admin' });
        expect(plan.facts.author).to.deep.equal({ uid: batch.manifest.author.uid, username: 'renamed-source-author' });
        expect(batch.manifest.author.username).to.equal('nowcoder-2026');
    });

    it('blocks unconfirmed ambiguity, fingerprint conflicts, and legacy duplicate suspicions', async () => {
        const original = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        original.problems[0].ambiguities = [{ field: 'title', message: 'check source typography', confirmed: false }];
        const ambiguousPath = path.join(root, 'ambiguous.json');
        await fsp.writeFile(ambiguousPath, JSON.stringify(original));
        const ambiguousBatch = await validateProblemBatchManifest(ambiguousPath);
        const adapter = new FixtureAdapter(productionFacts(ambiguousBatch), verifyResult(ambiguousBatch));
        const plan = await preflightProblemBatchImport(ambiguousBatch, adapter);
        await expectReject(
            applyProblemBatchImport({
                batch: ambiguousBatch,
                plan,
                adapter,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                report: createProblemBatchExecutionReport(plan, 2),
                persistReport: async () => {},
            }),
            'unconfirmed ambiguities',
        );

        const normalBatch = await validateProblemBatchManifest(manifestPath);
        const conflictedFacts = productionFacts(normalBatch);
        conflictedFacts.problems[0].fingerprint = '0'.repeat(64);
        await expectReject(
            preflightProblemBatchImport(normalBatch, new FixtureAdapter(conflictedFacts, verifyResult(normalBatch))),
            'identity fingerprint conflicts',
        );
        const duplicateFacts = productionFacts(normalBatch);
        duplicateFacts.suspectedDuplicates.push({ sourceProblemCode: 'A', docId: 9, pid: 'NK1', title: '2090 Virus' });
        await expectReject(
            preflightProblemBatchImport(normalBatch, new FixtureAdapter(duplicateFacts, verifyResult(normalBatch))),
            'suspected legacy duplicates',
        );
    });

    it('persists the exact completed stage and a failed state when apply is interrupted', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new FixtureAdapter(productionFacts(batch), verifyResult(batch));
        adapter.apply = async (_batch: any, _plan: any, _report: any, progress: any) => {
            await progress({ stage: 'draft-created', sourceProblemCode: 'A', docId: 2000, pid: 'NK1064' });
            throw new Error('fixture interruption');
        };
        const plan = await preflightProblemBatchImport(batch, adapter);
        const report = createProblemBatchExecutionReport(plan, 2);
        const snapshots: ProblemBatchExecutionReport[] = [];
        await expectReject(
            applyProblemBatchImport({
                batch,
                plan,
                adapter,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                report,
                persistReport: async (next) => {
                    snapshots.push(structuredClone(next));
                },
            }),
            'fixture interruption',
        );
        expect(report.state).to.equal('failed');
        expect(report.error).to.equal('fixture interruption');
        expect(report.events).to.deep.include({
            stage: 'draft-created',
            sourceProblemCode: 'A',
            docId: 2000,
            pid: 'NK1064',
            at: report.events[0].at,
        });
        expect(snapshots.at(-1)?.state).to.equal('failed');
    });

    it('persists committed publication failures and refuses to wash them into a later success', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const adapter = new FixtureAdapter(productionFacts(batch), verifyResult(batch));
        adapter.apply = async (_batch: any, _plan: any, _report: any, progress: any) => {
            adapter.applyCalls++;
            await progress({
                stage: 'publication-incomplete',
                sourceProblemCode: 'A',
                docId: 2000,
                pid: 'NK1064',
                requestId: 'publish-request-A',
                incompleteStages: ['edit-observers'],
            });
            throw new Error('fixture publication finalization failure');
        };
        const plan = await preflightProblemBatchImport(batch, adapter);
        const report = createProblemBatchExecutionReport(plan, 2);
        const snapshots: ProblemBatchExecutionReport[] = [];
        const persistReport = async (next: ProblemBatchExecutionReport) => {
            snapshots.push(structuredClone(next));
        };
        const apply = () =>
            applyProblemBatchImport({
                batch,
                plan,
                adapter,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                report,
                persistReport,
            });

        await expectReject(apply(), 'fixture publication finalization failure');
        expect(report.state).to.equal('failed');
        expect(report.events.at(-1)).to.deep.include({
            stage: 'publication-incomplete',
            sourceProblemCode: 'A',
            requestId: 'publish-request-A',
            incompleteStages: ['edit-observers'],
        });
        const persistedSnapshots = snapshots.length;

        await expectReject(apply(), 'incomplete committed publication');
        expect(adapter.applyCalls).to.equal(1);
        expect(snapshots).to.have.length(persistedSnapshots);

        await expectReject(verifyProblemBatchImport({ batch, plan, adapter, report, persistReport }), 'incomplete committed publication');
        expect(adapter.verifyCalls).to.equal(1);
        expect(report.state).to.equal('failed');
    });

    it('exposes validate as a local-only top-level CLI with one JSON stdout record', () => {
        const result = childProcess.spawnSync(
            process.execPath,
            [path.resolve(__dirname, '../bin/hydrooj.js'), 'problem:batch-import', 'validate', manifestPath],
            {
                cwd: path.resolve(__dirname, '..'),
                encoding: 'utf8',
                timeout: 5000,
                env: { ...process.env, HOME: path.join(root, 'empty-home') },
            },
        );
        expect(result.error, result.stderr || result.stdout).to.equal(undefined);
        expect(result.status, result.stderr || result.stdout).to.equal(0);
        const output = JSON.parse(result.stdout);
        expect(output).to.include({ ok: true, stage: 'validate', totalCases: 173 });
        expect(output.problems).to.have.length(7);
    });

    it('selects one stage-specific adapter, closes it, and never loads an adapter for validate', async () => {
        const batch = await validateProblemBatchManifest(manifestPath);
        const stages: string[] = [];
        let closes = 0;
        const dependencies = {
            loadRuntimeAdapter: async (stage: 'preflight' | 'apply' | 'verify') => {
                stages.push(stage);
                const adapter = new FixtureAdapter(productionFacts(batch), verifyResult(batch)) as FixtureAdapter & {
                    close(): Promise<void>;
                };
                adapter.close = async () => {
                    closes++;
                };
                return adapter;
            },
        };
        const planPath = path.join(root, 'stage-aware-plan.json');
        const local = await problemBatchCommandInternals.runProblemBatchCommand('validate', manifestPath, {}, dependencies);
        expect(local).to.have.property('stage', 'validate');
        expect(stages).to.deep.equal([]);

        await problemBatchCommandInternals.runProblemBatchCommand('preflight', manifestPath, { plan: planPath }, dependencies);
        await problemBatchCommandInternals.runProblemBatchCommand('verify', manifestPath, { plan: planPath }, dependencies);
        expect(stages).to.deep.equal(['preflight', 'verify']);
        expect(closes).to.equal(2);
    });

    it('keeps preflight/apply/verify arguments, JSON streams, exit codes, and artifacts as the public CLI boundary', async () => {
        const planPath = path.join(root, 'approved-plan.json');
        const reportPath = path.join(root, 'execution-report.json');
        const run = (stage: string, args: string[] = []) =>
            childProcess.spawnSync(
                process.execPath,
                ['-r', '@hydrooj/register', commandHarnessPath, 'problem:batch-import', stage, manifestPath, ...args],
                {
                    cwd: path.resolve(__dirname, '../../..'),
                    encoding: 'utf8',
                    timeout: 5000,
                },
            );

        const preflight = run('preflight', ['--plan', planPath]);
        expect(preflight.status, preflight.stderr || preflight.stdout).to.equal(0);
        const preflightOutput = JSON.parse(preflight.stdout);
        expect(preflightOutput).to.include({ ok: true, stage: 'preflight', planPath });
        expect(fs.existsSync(planPath)).to.equal(true);

        const refused = run('apply', [
            '--plan',
            planPath,
            '--report',
            reportPath,
            '--fingerprint',
            '0'.repeat(64),
            '--confirm',
            'APPLY:nowcoder-2026-summer-1',
            '--actor',
            '2',
        ]);
        expect(refused.status).not.to.equal(0);
        expect(refused.stdout).to.equal('');
        expect(JSON.parse(refused.stderr)).to.deep.include({ ok: false });
        expect(JSON.parse(refused.stderr).error.code, refused.stderr).to.equal('BATCH_IMPORT_CONFIRMATION_REQUIRED');

        const applied = run('apply', [
            '--plan',
            planPath,
            '--report',
            reportPath,
            '--fingerprint',
            preflightOutput.plan.fingerprint,
            '--confirm',
            preflightOutput.plan.confirmationToken,
            '--actor',
            '2',
        ]);
        expect(applied.status, applied.stderr || applied.stdout).to.equal(0);
        expect(JSON.parse(applied.stdout)).to.include({ ok: true, stage: 'apply', reportPath });
        expect(JSON.parse(await fsp.readFile(reportPath, 'utf8')).state).to.equal('applied');

        const verified = run('verify', ['--plan', planPath, '--report', reportPath]);
        expect(verified.status, verified.stderr || verified.stdout).to.equal(0);
        expect(JSON.parse(verified.stdout)).to.include({ ok: true, stage: 'verify', reportPath });
        expect(JSON.parse(await fsp.readFile(reportPath, 'utf8')).state).to.equal('verified');
    });
});
