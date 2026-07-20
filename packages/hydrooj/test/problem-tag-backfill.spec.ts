import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { after, before, describe, it } from 'node:test';
import {
    applyProblemTagBackfill,
    assertProblemTagBackfillReport,
    createProblemTagBackfillSnapshot,
    type ProblemTagBackfillApplyResult,
    type ProblemTagBackfillPlanEntry,
    type ProblemTagBackfillProblemSnapshot,
    type ProblemTagBackfillReport,
    type ProblemTagBackfillRuntimeAdapter,
    type ProblemTagBackfillVerificationItem,
    planProblemTagBackfill,
    ProblemTagBackfillError,
    refreshProblemTagBackfillOutcomeGroups,
    renderProblemTagBackfillMarkdown,
    verifyProblemTagBackfill,
} from '../src/lib/problem-tag-backfill';
import {
    knowledgeMindmapOptionsFromFacts,
    normalizeProblemTagBackfillMindmapFacts,
    previewProblemTagNormalizationFromFacts,
    problemTagBackfillMindmapFingerprint,
    type ProblemTagBackfillMindmapFact,
} from '../src/lib/problem-tag-backfill-facts';
import { sha256 } from '../src/lib/problem-batch-import';

const rootId = '64b000000000000000000001';
const mapId = '64a000000000000000000001';
const mapTitle = '算法知识图谱';
const uniqueId = '64b000000000000000000002';
const ambiguousAId = '64b000000000000000000003';
const ambiguousBId = '64b000000000000000000004';
const brokenId = '64b000000000000000000005';
const missingParentId = '64b000000000000000000099';
const missingNodeId = '64b000000000000000000098';

const mindmapFacts = normalizeProblemTagBackfillMindmapFacts([
    { _id: rootId, mapId, mapTitle, parentId: null, topic: '算法', tags: ['基础算法'], updatedAt: '2026-07-01T00:00:00.000Z' },
    { _id: uniqueId, mapId, mapTitle, parentId: rootId, topic: '二分', tags: ['二分'], updatedAt: '2026-07-02T00:00:00.000Z' },
    { _id: ambiguousAId, mapId, mapTitle, parentId: rootId, topic: '图论甲', tags: ['共享标签'], updatedAt: '2026-07-03T00:00:00.000Z' },
    { _id: ambiguousBId, mapId, mapTitle, parentId: rootId, topic: '图论乙', tags: ['共享标签'], updatedAt: '2026-07-04T00:00:00.000Z' },
    { _id: brokenId, mapId, mapTitle, parentId: missingParentId, topic: '坏路径', tags: ['坏路径'], updatedAt: '2026-07-05T00:00:00.000Z' },
]);

function snapshot(docId: number, patch: Record<string, unknown> = {}, structureRevision: number | null = 3): ProblemTagBackfillProblemSnapshot {
    const pdoc: Record<string, unknown> = {
        _id: `problem-${docId}`,
        domainId: 'system',
        docType: 10,
        docId,
        pid: `T${docId}`,
        title: `Problem ${docId}`,
        owner: 2,
        tag: ['二分'],
        knowledgeMapId: mapId,
        hidden: false,
        config: { time: '1s', memory: '256m' },
        data: [{ name: '1.in' }, { name: '1.out' }],
        additional_file: [],
        content: `statement-${docId}`,
        html: false,
        ...patch,
    };
    if (structureRevision !== null) pdoc.structureRevision = structureRevision;
    return createProblemTagBackfillSnapshot(pdoc, 1);
}

class FixturePlanAdapter {
    constructor(
        readonly problems: ProblemTagBackfillProblemSnapshot[],
        readonly facts: ProblemTagBackfillMindmapFact[] = mindmapFacts,
    ) {}

    async loadPlanFacts() {
        return {
            problems: this.problems,
            mindmapOptions: knowledgeMindmapOptionsFromFacts(this.facts),
            mindmapFingerprint: problemTagBackfillMindmapFingerprint(this.facts),
        };
    }

    async preview(problem: ProblemTagBackfillProblemSnapshot, selectedNodeIds: string[]) {
        return previewProblemTagNormalizationFromFacts(problem, selectedNodeIds, this.facts);
    }
}

type ApplyBehavior = (entry: ProblemTagBackfillPlanEntry, actor: number, planFingerprint: string) => Promise<ProblemTagBackfillApplyResult>;

class FixtureRuntimeAdapter extends FixturePlanAdapter implements ProblemTagBackfillRuntimeAdapter {
    prepared = 0;
    applyCalls: number[] = [];
    inspectCalls: number[] = [];

    constructor(
        problems: ProblemTagBackfillProblemSnapshot[],
        private readonly applyBehavior: ApplyBehavior,
        private readonly verifyBehavior?: (
            entry: ProblemTagBackfillPlanEntry,
            execution: Parameters<ProblemTagBackfillRuntimeAdapter['verifyEntry']>[1],
        ) => Promise<ProblemTagBackfillVerificationItem>,
    ) {
        super(problems);
    }

    async prepareActor() {
        this.prepared++;
    }

    async loadMindmapFingerprint() {
        return problemTagBackfillMindmapFingerprint(this.facts);
    }

    async inspectEntryStateFingerprint(entry: ProblemTagBackfillPlanEntry) {
        this.inspectCalls.push(entry.docId);
        return entry.snapshot.stateFingerprint;
    }

    async applyReady(entry: ProblemTagBackfillPlanEntry, actor: number, planFingerprint: string) {
        this.applyCalls.push(entry.docId);
        return this.applyBehavior(entry, actor, planFingerprint);
    }

    async verifyEntry(
        entry: ProblemTagBackfillPlanEntry,
        execution: Parameters<ProblemTagBackfillRuntimeAdapter['verifyEntry']>[1],
    ): Promise<ProblemTagBackfillVerificationItem> {
        if (this.verifyBehavior) return this.verifyBehavior(entry, execution);
        return {
            domainId: entry.domainId,
            docId: entry.docId,
            pid: entry.pid,
            ok: true,
            state: execution?.status || entry.decision,
            reason: 'fixture-verified',
            currentStateFingerprint: execution?.observedStateFingerprint || entry.snapshot.stateFingerprint,
        };
    }
}

async function readyReport(count = 2): Promise<ProblemTagBackfillReport> {
    const problems = [snapshot(101, { tag: ['PAT乙级', '二分'] }), snapshot(102, { tag: ['基础算法'] })].slice(0, count);
    return planProblemTagBackfill(new FixturePlanAdapter(problems), new Date('2026-07-18T00:00:00.000Z'));
}

async function rejectWithCode(work: Promise<unknown>, code: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.be.instanceOf(ProblemTagBackfillError);
        expect(error).to.have.property('code', code);
        return error as ProblemTagBackfillError;
    }
    expect.fail(`expected ${code}`);
}

async function rejectWithMessage(work: Promise<unknown>, message: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.have.property('message').that.includes(message);
        return error as Error;
    }
    expect.fail(`expected rejection containing ${message}`);
}

describe('P2.26 canonical programming tag backfill', () => {
    it('plans from real problem and mindmap fixtures with strict exact classification', async () => {
        const report = await planProblemTagBackfill(
            new FixturePlanAdapter([
                snapshot(1, { tag: ['PAT乙级', '二分'] }),
                snapshot(2, { tag: ['PAT乙级', '基础算法', '二分'], knowledgeNodeIds: [uniqueId] }),
                snapshot(3, {
                    tag: ['PAT乙级', '基础算法', '二分'],
                    authoringMode: 'managed',
                    managedAuthoring: { selectedMindmapNodeIds: [uniqueId] },
                }),
                snapshot(4, { tag: [] }),
                snapshot(5, { tag: ['PAT乙级'] }),
                snapshot(6, { tag: ['不存在'] }),
                snapshot(7, { tag: ['共享标签'] }),
                snapshot(8, { tag: '二分' }),
                snapshot(9, { tag: ['二分'], knowledgeNodeIds: [missingNodeId] }),
                snapshot(10, { tag: ['二分'] }, 0),
                snapshot(11, { tag: ['坏路径'] }),
                snapshot(12, { tag: ['二分'], authoringMode: 'legacy' }),
                snapshot(13, {
                    tag: ['PAT乙级', '基础算法', '二分'],
                    authoringMode: 'managed',
                    managedAuthoring: { selectedMindmapNodeIds: [uniqueId] },
                    knowledgeNodeIds: [uniqueId],
                }),
                snapshot(14, {
                    tag: ['PAT乙级', '基础算法', '二分'],
                    authoringMode: 'managed',
                    managedAuthoring: { selectedMindmapNodeIds: [uniqueId] },
                    knowledgeNodeIds: [ambiguousAId],
                }),
            ]),
            new Date('2026-07-18T00:00:00.000Z'),
        );
        const byPid = new Map(report.entries.map((entry) => [entry.pid, entry]));

        expect(byPid.get('T1')).to.deep.include({ decision: 'ready', reason: 'strict-unique-match' });
        expect(byPid.get('T1')?.nextTags).to.deep.equal(['PAT乙级', '基础算法', '二分']);
        expect(byPid.get('T1')?.selectedNodeIds).to.deep.equal([uniqueId]);
        expect(byPid.get('T2')).to.deep.include({ decision: 'already-canonical', reason: 'canonical-pair-validated' });
        expect(byPid.get('T3')).to.deep.include({ decision: 'already-canonical', reason: 'canonical-pair-validated' });
        expect(byPid.get('T4')?.reason).to.equal('empty-tags');
        expect(byPid.get('T5')?.reason).to.equal('source-tags-only');
        expect(byPid.get('T6')).to.deep.include({ decision: 'skipped', reason: 'unknown-tags' });
        expect(byPid.get('T6')?.unknownTags).to.deep.equal(['不存在']);
        expect(byPid.get('T7')).to.deep.include({ decision: 'skipped', reason: 'ambiguous-tags' });
        expect(byPid.get('T7')?.ambiguousTags[0].candidates).to.have.length(2);
        expect(byPid.get('T8')?.reason).to.equal('malformed-tags');
        expect(byPid.get('T9')?.reason).to.equal('invalid-canonical-mindmap');
        expect(byPid.get('T10')?.reason).to.equal('malformed-structure-revision');
        expect(byPid.get('T11')).to.deep.include({ decision: 'skipped', reason: 'invalid-mindmap-path' });
        expect(byPid.get('T11')?.detail).to.include('ancestor is missing');
        expect(byPid.get('T12')?.reason).to.equal('malformed-authoring-mode');
        expect(byPid.get('T13')).to.deep.include({ decision: 'already-canonical', reason: 'canonical-pair-validated' });
        expect(byPid.get('T14')).to.deep.include({
            decision: 'skipped',
            reason: 'canonical-fact-conflict',
            selectedNodeIds: [uniqueId],
        });
        expect(byPid.get('T14')?.detail).to.include('managedAuthoring.selectedMindmapNodeIds');
        expect(report.confirmationToken).to.equal(`APPLY:problem-tag-backfill:${report.fingerprint}`);
        expect(assertProblemTagBackfillReport(JSON.parse(JSON.stringify(report)))).to.deep.equal(JSON.parse(JSON.stringify(report)));
    });

    it('fingerprints archival state as a protected non-tag fact', () => {
        const active = snapshot(15);
        const archived = snapshot(15, { archivedAt: new Date('2026-07-18T02:00:00.000Z') });

        expect(active.nonTagFacts.archivedAtPresent).to.equal(false);
        expect(archived.nonTagFacts.archivedAtPresent).to.equal(true);
        expect(archived.nonTagFacts.archivedAtFingerprint).to.match(/^[a-f0-9]{64}$/);
        expect(archived.nonTagFingerprint).not.to.equal(active.nonTagFingerprint);
        expect(archived.stateFingerprint).not.to.equal(active.stateFingerprint);
    });

    it('rejects tampered plan facts and invalid execution rows before any write', async () => {
        const report = await readyReport(1);
        const tamperedPlan = structuredClone(report);
        tamperedPlan.entries[0].snapshot.nonTagFacts.owner = 99;
        expect(() => assertProblemTagBackfillReport(tamperedPlan)).to.throw(ProblemTagBackfillError);

        const tamperedExecution = structuredClone(report);
        tamperedExecution.execution = {
            planFingerprint: report.fingerprint,
            actor: 2,
            state: 'applied',
            startedAt: '2026-07-18T00:00:00.000Z',
            updatedAt: '2026-07-18T00:00:01.000Z',
            results: [
                {
                    domainId: 'system',
                    docId: 999,
                    pid: 'FORGED',
                    status: 'applied',
                    reason: 'forged',
                    observedStateFingerprint: 'a'.repeat(64),
                    at: '2026-07-18T00:00:01.000Z',
                },
            ],
        };
        expect(() => assertProblemTagBackfillReport(tamperedExecution)).to.throw(ProblemTagBackfillError);
    });

    it('requires the exact fingerprint, token, and actor before preparing the runtime adapter', async () => {
        const report = await readyReport(1);
        const adapter = new FixtureRuntimeAdapter([report.entries[0].snapshot], async () => {
            throw new Error('must not write');
        });
        await rejectWithCode(
            applyProblemTagBackfill({
                report,
                adapter,
                actor: 2,
                fingerprint: '0'.repeat(64),
                confirmationToken: report.confirmationToken,
                persistReport: async () => undefined,
            }),
            'PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED',
        );
        expect(adapter.prepared).to.equal(0);
        expect(adapter.applyCalls).to.deep.equal([]);
    });

    it('requires verify before resuming an interrupted applying report', async () => {
        const report = await readyReport(1);
        report.execution = {
            planFingerprint: report.fingerprint,
            actor: 2,
            state: 'applying',
            startedAt: '2026-07-18T00:00:00.000Z',
            updatedAt: '2026-07-18T00:00:01.000Z',
            results: [],
        };
        refreshProblemTagBackfillOutcomeGroups(report);
        const adapter = new FixtureRuntimeAdapter([report.entries[0].snapshot], async () => {
            throw new Error('must not write');
        });

        await rejectWithCode(
            applyProblemTagBackfill({
                report,
                adapter,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
                persistReport: async () => undefined,
            }),
            'PROBLEM_TAG_BACKFILL_RECOVERY_VERIFY_REQUIRED',
        );
        expect(adapter.prepared).to.equal(0);
        expect(adapter.applyCalls).to.deep.equal([]);
    });

    it('persists every ready result, continues after a business stale result, and reruns as no-op', async () => {
        const report = await readyReport(2);
        const adapter = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async (entry) => ({
                status: entry.docId === 101 ? 'applied' : 'stale',
                reason: entry.docId === 101 ? 'canonical-tags-written' : 'problem-facts-drift',
                observedStateFingerprint: sha256(`state-${entry.docId}`),
            }),
        );
        const persisted: ProblemTagBackfillReport[] = [];
        const summary = await applyProblemTagBackfill({
            report,
            adapter,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async (next) => void persisted.push(structuredClone(next)),
        });

        expect(adapter.applyCalls).to.deep.equal([101, 102]);
        expect(summary.execution).to.deep.equal({ applied: 1, 'no-op': 0, stale: 1 });
        expect(report.execution?.state).to.equal('applied');
        expect(persisted).to.have.length(4);
        expect(persisted[1].execution?.results).to.have.length(1);
        expect(persisted[2].execution?.results).to.have.length(2);
        expect(() => assertProblemTagBackfillReport(report)).not.to.throw();
        expect(
            report.outcomeGroups
                .find((group) => group.state === 'stale' && group.reason === 'problem-facts-drift')
                ?.entries.map((entry) => entry.pid),
        ).to.deep.equal(['T102']);
        expect(renderProblemTagBackfillMarkdown(report)).to.include('## stale / problem-facts-drift (1)');

        report.verification = {
            verifiedAt: '2026-07-18T00:00:00.000Z',
            ok: false,
            items: [
                { domainId: '*', docId: 0, pid: 'MINDMAP', ok: false, state: 'mindmap', reason: 'old-result' },
                ...report.entries.map((entry) => ({
                    domainId: entry.domainId,
                    docId: entry.docId,
                    pid: entry.pid,
                    ok: false,
                    state: 'old',
                    reason: 'old-result',
                })),
            ],
        };
        const rerun = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async (entry) => ({ status: 'no-op', reason: 'already-applied-with-audit', observedStateFingerprint: sha256(`rerun-${entry.docId}`) }),
        );
        const rerunSummary = await applyProblemTagBackfill({
            report,
            adapter: rerun,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async () => undefined,
        });
        expect(rerunSummary.execution).to.deep.equal({ applied: 0, 'no-op': 2, stale: 0 });
        expect(report.verification).to.equal(undefined);
    });

    it('marks every remaining ready entry stale when the global mindmap fingerprint has drifted', async () => {
        const report = await readyReport(2);
        const adapter = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async () => {
                throw new Error('applyReady must not run after global mindmap drift');
            },
        );
        adapter.loadMindmapFingerprint = async () => 'f'.repeat(64);

        const summary = await applyProblemTagBackfill({
            report,
            adapter,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async () => undefined,
        });

        expect(adapter.applyCalls).to.deep.equal([]);
        expect(adapter.inspectCalls).to.deep.equal([101, 102]);
        expect(summary.execution).to.deep.equal({ applied: 0, 'no-op': 0, stale: 2 });
        expect(report.execution?.results.every((result) => result.reason === 'global-mindmap-drift')).to.equal(true);
    });

    it('aborts on an observer-style system failure and durably marks the partial report failed', async () => {
        const report = await readyReport(2);
        const adapter = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async (entry) => {
                if (entry.docId === 102) throw new Error('observer unavailable');
                return { status: 'applied', reason: 'canonical-tags-written', observedStateFingerprint: sha256('first-applied') };
            },
        );
        const persisted: ProblemTagBackfillReport[] = [];
        await rejectWithMessage(
            applyProblemTagBackfill({
                report,
                adapter,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
                persistReport: async (next) => void persisted.push(structuredClone(next)),
            }),
            'observer unavailable',
        );

        expect(adapter.applyCalls).to.deep.equal([101, 102]);
        expect(report.execution).to.deep.include({ state: 'failed', lastError: 'Error: observer unavailable' });
        expect(report.execution?.results).to.have.length(1);
        expect(persisted.at(-1)?.execution?.state).to.equal('failed');

        const recovery = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async (entry) => ({
                status: entry.docId === 101 ? 'no-op' : 'applied',
                reason: entry.docId === 101 ? 'already-applied-with-audit' : 'canonical-tags-written',
                observedStateFingerprint: sha256(`recovered-${entry.docId}`),
            }),
        );
        await rejectWithCode(
            applyProblemTagBackfill({
                report,
                adapter: recovery,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
                persistReport: async () => undefined,
            }),
            'PROBLEM_TAG_BACKFILL_RECOVERY_VERIFY_REQUIRED',
        );
        expect(recovery.prepared).to.equal(0);

        const verifyAdapter = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async () => {
                throw new Error('apply is not used by verify');
            },
        );
        await verifyProblemTagBackfill({
            report,
            adapter: verifyAdapter,
            persistReport: async () => undefined,
            now: new Date(Date.parse(report.execution!.updatedAt) + 1),
        });
        const recovered = await applyProblemTagBackfill({
            report,
            adapter: recovery,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async () => undefined,
        });
        expect(recovered.execution).to.deep.equal({ applied: 1, 'no-op': 1, stale: 0 });
    });

    it('records a failed verify when any non-tag fact is reported changed', async () => {
        const report = await readyReport(1);
        const applyAdapter = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async (entry) => ({
                status: 'applied',
                reason: 'canonical-tags-written',
                observedStateFingerprint: sha256(`applied-${entry.docId}`),
            }),
        );
        await applyProblemTagBackfill({
            report,
            adapter: applyAdapter,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async () => undefined,
        });
        const verifyAdapter = new FixtureRuntimeAdapter(
            report.entries.map((entry) => entry.snapshot),
            async () => {
                throw new Error('apply is not used by verify');
            },
            async (entry) => ({
                domainId: entry.domainId,
                docId: entry.docId,
                pid: entry.pid,
                ok: false,
                state: 'applied',
                reason: 'non-tag-fingerprint-drift',
                currentStateFingerprint: sha256('changed-content'),
            }),
        );
        let persisted = 0;
        await rejectWithCode(
            verifyProblemTagBackfill({
                report,
                adapter: verifyAdapter,
                persistReport: async () => void persisted++,
                now: new Date('2026-07-18T01:00:00.000Z'),
            }),
            'PROBLEM_TAG_BACKFILL_VERIFY_FAILED',
        );
        expect(persisted).to.equal(1);
        expect(report.verification).to.deep.include({ ok: false, verifiedAt: '2026-07-18T01:00:00.000Z' });
        expect(report.verification?.items.some((item) => item.reason === 'non-tag-fingerprint-drift')).to.equal(true);
    });

    it('keeps the production adapter on the narrow claimed CAS, observer, and per-problem audit path', () => {
        const adapterSource = fs.readFileSync(path.resolve(__dirname, '../src/model/problem-tag-backfill-adapter.ts'), 'utf8');
        const applyStart = adapterSource.indexOf('async applyReady(');
        const verifyStart = adapterSource.indexOf('async verifyEntry(', applyStart);
        const applySource = adapterSource.slice(applyStart, verifyStart);
        expect(applyStart).to.be.greaterThan(-1);
        expect(verifyStart).to.be.greaterThan(applyStart);
        expect(applySource).to.include('ProblemModel.withAuthorizedWriteClaim(');
        expect(applySource).to.include("reason: 'problem-archived'");
        expect(applySource).to.include("reason: 'problem-archived-inside-claim'");
        expect(applySource.indexOf("reason: 'problem-archived'")).to.be.lessThan(applySource.indexOf('ProblemModel.withAuthorizedWriteClaim('));
        expect(applySource).to.include("{ requestId, capability: 'tag' }");
        expect(applySource).to.include('expectedStructureRevisionAbsent: true');
        expect(applySource).to.include('allowHistoricalStructureLock: true');
        expect(applySource).to.include("await parallelAllSettled('problem/edit'");
        expect(applySource).to.include('await this.ensureAudit(');
        expect(applySource.indexOf("await parallelAllSettled('problem/edit'")).to.be.lessThan(applySource.indexOf('await this.ensureAudit('));
        expect(applySource).not.to.include('ProblemModel.edit(');

        const readonlySource = fs.readFileSync(path.resolve(__dirname, '../src/model/problem-tag-backfill-readonly-adapter.ts'), 'utf8');
        expect(readonlySource).to.include('.find({ active: { $in: [true, null] } }');
        expect(readonlySource).to.include("readPreference: 'primary'");
    });
});

describe('P2.26 tag backfill CLI protocol', () => {
    let tempRoot: string;
    let harnessPath: string;
    let reportPath: string;

    before(async () => {
        tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'problem-tag-backfill-'));
        harnessPath = path.join(tempRoot, 'command-harness.cjs');
        reportPath = path.join(tempRoot, 'report.json');
        await fsp.writeFile(
            harnessPath,
            `
const cacModule = require(${JSON.stringify(require.resolve('cac'))});
const cac = cacModule.default || cacModule;
const { register } = require(${JSON.stringify(require.resolve('../src/commands/problem-tag-backfill.ts'))});
const { createProblemTagBackfillSnapshot } = require(${JSON.stringify(require.resolve('../src/lib/problem-tag-backfill.ts'))});
const factsLib = require(${JSON.stringify(require.resolve('../src/lib/problem-tag-backfill-facts.ts'))});
const facts = factsLib.normalizeProblemTagBackfillMindmapFacts([
  { _id: ${JSON.stringify(rootId)}, mapId: ${JSON.stringify(mapId)}, mapTitle: ${JSON.stringify(mapTitle)}, parentId: null, topic: '算法', tags: ['基础算法'], updatedAt: '2026-07-01T00:00:00.000Z' },
  { _id: ${JSON.stringify(uniqueId)}, mapId: ${JSON.stringify(mapId)}, mapTitle: ${JSON.stringify(mapTitle)}, parentId: ${JSON.stringify(rootId)}, topic: '二分', tags: ['二分'], updatedAt: '2026-07-02T00:00:00.000Z' },
]);
const problem = createProblemTagBackfillSnapshot({
  _id: 'fixture', domainId: 'system', docType: 10, docId: 501, pid: 'T501', title: 'CLI fixture', owner: 2,
  tag: ['二分'], knowledgeMapId: ${JSON.stringify(mapId)}, structureRevision: 2, hidden: false, config: {}, data: [], additional_file: [], content: 'statement', html: false,
}, 0);
const mindmapFingerprint = factsLib.problemTagBackfillMindmapFingerprint(facts);
const adapter = {
  async loadPlanFacts() { return { problems: [problem], mindmapOptions: factsLib.knowledgeMindmapOptionsFromFacts(facts), mindmapFingerprint }; },
  async preview(snapshot, ids) { return factsLib.previewProblemTagNormalizationFromFacts(snapshot, ids, facts); },
  async prepareActor() {},
  async loadMindmapFingerprint() { return mindmapFingerprint; },
  async inspectEntryStateFingerprint(entry) { return entry.snapshot.stateFingerprint; },
  async applyReady() { return { status: 'applied', reason: 'canonical-tags-written', observedStateFingerprint: 'a'.repeat(64) }; },
  async verifyEntry(entry, execution) { return { domainId: entry.domainId, docId: entry.docId, pid: entry.pid, ok: true, state: execution ? execution.status : entry.decision, reason: 'verified', currentStateFingerprint: execution ? execution.observedStateFingerprint : entry.snapshot.stateFingerprint }; },
  async close() { process.stdout.write('runtime-close\\n'); },
};
const cli = cac();
register(cli, { loadRuntimeAdapter: async () => { process.stdout.write('runtime-load\\n'); return adapter; } });
cli.parse(process.argv, { run: false });
Promise.resolve(cli.runMatchedCommand()).catch((error) => {
  process.stderr.write(String(error && (error.stack || error.message) || error) + '\\n', () => process.exit(1));
});
`,
        );
    });

    after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    it('keeps stdout as one JSON record and preserves exact plan/apply/verify arguments and exit codes', () => {
        const run = (stage: string, args: string[] = []) =>
            childProcess.spawnSync(process.execPath, ['-r', '@hydrooj/register', harnessPath, 'problem:tag-backfill', stage, reportPath, ...args], {
                cwd: path.resolve(__dirname, '../../..'),
                encoding: 'utf8',
                timeout: 5000,
            });

        const planned = run('plan');
        expect(planned.status, planned.stderr || planned.stdout).to.equal(0);
        const planOutput = JSON.parse(planned.stdout);
        expect(planOutput).to.deep.include({ ok: true, stage: 'plan', reportPath });
        expect(planned.stderr).to.include('runtime-load');
        expect(planned.stderr).to.include('runtime-close');
        expect(fs.existsSync(reportPath)).to.equal(true);
        expect(fs.existsSync(reportPath.replace(/\.json$/, '.md'))).to.equal(true);

        const refused = run('apply', ['--actor', '2', '--fingerprint', '0'.repeat(64), '--confirm', `APPLY:problem-tag-backfill:${'0'.repeat(64)}`]);
        expect(refused.status).not.to.equal(0);
        expect(refused.stdout).to.equal('');
        expect(JSON.parse(refused.stderr).error.code).to.equal('PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED');

        const persisted = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const applied = run('apply', ['--actor', '2', '--fingerprint', persisted.fingerprint, '--confirm', persisted.confirmationToken]);
        expect(applied.status, applied.stderr || applied.stdout).to.equal(0);
        expect(JSON.parse(applied.stdout)).to.deep.include({ ok: true, stage: 'apply', reportPath });

        const verified = run('verify');
        expect(verified.status, verified.stderr || verified.stdout).to.equal(0);
        const verifyOutput = JSON.parse(verified.stdout);
        expect(verifyOutput).to.deep.include({ ok: true, stage: 'verify', reportPath });
        expect(verifyOutput.summary.verificationOk).to.equal(true);
    });
});
