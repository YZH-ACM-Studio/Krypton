import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { afterEach, describe, it } from 'node:test';
import { runMindmapMultiMigrationCommand } from '../src/commands/mindmap-migrate-multi';
import {
    applyMindmapMultiMigration,
    buildMindmapMultiMigrationPlan,
    MINDMAP_MULTI_MIGRATION_NODE_COUNT,
    MindmapMultiMigrationError,
    type MindmapMultiMigrationRepository,
    type MindmapMultiMigrationSnapshot,
    verifyMindmapMultiMigration,
} from '../src/lib/mindmap-multi-migration';

const temporaryDirectories: string[] = [];

function fixtureSnapshot(): MindmapMultiMigrationSnapshot {
    const rootNodeId = new ObjectId('64b000000000000000000001');
    const nodes = [
        {
            _id: rootNodeId,
            parentId: null,
            topic: '算法',
            tags: [],
            problemIds: [],
            order: 0,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        ...Array.from({ length: MINDMAP_MULTI_MIGRATION_NODE_COUNT - 1 }, (_, index) => ({
            _id: new ObjectId((index + 2).toString(16).padStart(24, '0')),
            parentId: rootNodeId,
            topic: `节点 ${index + 1}`,
            tags: [`标签 ${index + 1}`],
            problemIds: [],
            order: index + 1,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        })),
    ];
    return {
        configs: [
            {
                _id: 'global',
                title: '旧标题',
                rootNodeId,
                layoutDirection: 'RIGHT',
                updatedAt: new Date('2026-07-16T00:00:00.000Z'),
            },
        ],
        maps: [],
        nodes,
        problems: [
            {
                _id: new ObjectId('74b000000000000000000001'),
                domainId: 'system',
                docType: 10,
                docId: 1,
                pid: 'P1',
                title: '有标签题',
                owner: 2,
                tag: ['标签 1'],
                knowledgeNodeIds: [nodes[1]._id],
                structureRevision: 3,
            },
            {
                _id: new ObjectId('74b000000000000000000002'),
                domainId: 'system',
                docType: 10,
                docId: 2,
                pid: 'P2',
                title: '无节点旧题',
                owner: 8,
                tag: [],
                managedAuthoring: { selectedMindmapNodeIds: [] },
            },
            {
                _id: new ObjectId('74b000000000000000000003'),
                domainId: 'system',
                docType: 10,
                docId: 3,
                pid: 'P3',
                title: '托管题',
                owner: 9,
                tag: ['标签 2'],
                managedAuthoring: { selectedMindmapNodeIds: [nodes[2]._id], metadataStatus: 'draft' },
            },
        ],
        courses: [
            {
                _id: new ObjectId('84b000000000000000000001'),
                domainId: 'system',
                docType: 40,
                docId: new ObjectId('84b000000000000000000002'),
                kind: 'course',
                title: '面向对象程序设计',
                dag: [],
            },
        ],
    };
}

class FixtureRepository implements MindmapMultiMigrationRepository {
    readonly audits: Array<Record<string, any>> = [];
    closed = 0;
    failProblemCount = false;

    constructor(readonly snapshot = fixtureSnapshot()) {}

    async loadSnapshot() {
        return this.snapshot;
    }

    async isSystemAdministrator(uid: number) {
        return uid === 2;
    }

    async insertMap(map: Record<string, any>) {
        this.snapshot.maps.push(map);
    }

    async setNodeMapId(mapId: ObjectId) {
        const candidates = this.snapshot.nodes.filter((node) => !Object.hasOwn(node, 'mapId'));
        for (const node of candidates) node.mapId = mapId;
        return { matchedCount: candidates.length, modifiedCount: candidates.length };
    }

    async setProblemMapId(mapId: ObjectId) {
        const candidates = this.snapshot.problems.filter((problem) => !Object.hasOwn(problem, 'knowledgeMapId'));
        for (const problem of candidates) problem.knowledgeMapId = mapId;
        return {
            matchedCount: candidates.length,
            modifiedCount: candidates.length - (this.failProblemCount ? 1 : 0),
        };
    }

    async deleteGlobalConfig() {
        const count = this.snapshot.configs.length;
        this.snapshot.configs = [];
        return count;
    }

    async insertAudit(audit: Record<string, any>) {
        const row = { _id: new ObjectId(), ...audit };
        this.audits.push(row);
        return row._id.toHexString();
    }

    async findSuccessfulAudit(fingerprint: string) {
        return this.audits.find((audit) => audit.fingerprint === fingerprint && audit.result === 'success') || null;
    }

    async close() {
        this.closed++;
    }
}

async function rejectCode(work: Promise<unknown>, code: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.be.instanceOf(MindmapMultiMigrationError);
        expect(error).to.have.property('code', code);
        return;
    }
    expect.fail(`expected ${code}`);
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('P2.29 strict multi-mindmap migration', () => {
    it('plans, applies, and verifies the exact legacy tree while preserving every non-target field', async () => {
        const repository = new FixtureRepository();
        const targetMapId = new ObjectId('64a000000000000000000001');
        const report = buildMindmapMultiMigrationPlan(repository.snapshot, targetMapId, new Date('2026-07-20T10:00:00.000Z'));
        const originalProblems = repository.snapshot.problems.map((problem) => ({ ...problem }));
        const originalNodes = repository.snapshot.nodes.map((node) => ({ ...node }));
        const originalCourses = repository.snapshot.courses.map((course) => ({ ...course }));
        let persisted = 0;

        expect(report.source).to.include({ nodeCount: 274, problemCount: 3, courseCount: 1 });
        expect(report.source.problemKnowledgeNodeReferenceCount).to.equal(1);
        expect(report.source.managedKnowledgeNodeReferenceCount).to.equal(1);
        await applyMindmapMultiMigration({
            report,
            repository,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async () => {
                persisted++;
            },
        });
        await verifyMindmapMultiMigration(report, repository, new Date('2026-07-20T10:05:00.000Z'));

        expect(persisted).to.equal(2);
        expect(report.execution?.state).to.equal('applied');
        expect(report.verification?.ok).to.equal(true);
        expect(repository.snapshot.configs).to.deep.equal([]);
        expect(repository.snapshot.maps).to.have.length(1);
        expect(repository.snapshot.nodes.every((node) => node.mapId.equals(targetMapId))).to.equal(true);
        expect(repository.snapshot.problems.every((problem) => problem.knowledgeMapId.equals(targetMapId))).to.equal(true);
        expect(repository.snapshot.problems.map(({ knowledgeMapId: _ignored, ...problem }) => problem)).to.deep.equal(originalProblems);
        expect(repository.snapshot.nodes.map(({ mapId: _ignored, ...node }) => node)).to.deep.equal(originalNodes);
        expect(repository.snapshot.courses).to.deep.equal(originalCourses);
    });

    it('rejects malformed trees, references, partial migrations, and production drift before writing', async () => {
        const multipleRoots = fixtureSnapshot();
        multipleRoots.nodes[1].parentId = null;
        expect(() => buildMindmapMultiMigrationPlan(multipleRoots)).to.throw('exactly the configured root');

        const missingReference = fixtureSnapshot();
        missingReference.problems[0].knowledgeNodeIds = [new ObjectId('64b000000000000000000099')];
        expect(() => buildMindmapMultiMigrationPlan(missingReference)).to.throw('references a missing mindmap node');

        const partial = fixtureSnapshot();
        partial.problems[0].knowledgeMapId = new ObjectId();
        expect(() => buildMindmapMultiMigrationPlan(partial)).to.throw('already has knowledgeMapId');

        const repository = new FixtureRepository();
        const report = buildMindmapMultiMigrationPlan(repository.snapshot, new ObjectId('64a000000000000000000001'));
        repository.snapshot.problems[0].title = '计划后被修改';
        await rejectCode(
            applyMindmapMultiMigration({
                report,
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'MINDMAP_MULTI_MIGRATION_FINGERPRINT_DRIFT',
        );
        expect(repository.snapshot.maps).to.deep.equal([]);
    });

    it('fails nonzero on a write-count mismatch and leaves explicit failure evidence', async () => {
        const repository = new FixtureRepository();
        repository.failProblemCount = true;
        const report = buildMindmapMultiMigrationPlan(repository.snapshot, new ObjectId('64a000000000000000000001'));
        await rejectCode(
            applyMindmapMultiMigration({
                report,
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'MINDMAP_MULTI_MIGRATION_WRITE_COUNT_MISMATCH',
        );
        expect(report.execution?.state).to.equal('failed');
        expect(repository.audits.at(-1)).to.include({ result: 'failed', fingerprint: report.fingerprint, operator: 2 });
    });

    it('detects any post-migration non-target Problem or Course mutation', async () => {
        const repository = new FixtureRepository();
        const report = buildMindmapMultiMigrationPlan(repository.snapshot, new ObjectId('64a000000000000000000001'));
        await applyMindmapMultiMigration({
            report,
            repository,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
        });
        repository.snapshot.problems[0].owner = 999;
        await rejectCode(verifyMindmapMultiMigration(report, repository), 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');

        repository.snapshot.problems[0].owner = 2;
        repository.snapshot.courses[0].title = '被修改的课程';
        await rejectCode(verifyMindmapMultiMigration(report, repository), 'MINDMAP_MULTI_MIGRATION_VERIFY_FAILED');
    });

    it('enforces the exact CLI stages, stopped-service and backup gates, confirmation, and report persistence', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mindmap-migrate-multi-'));
        temporaryDirectories.push(directory);
        const reportPath = path.join(directory, 'report.json');
        const repository = new FixtureRepository();
        const dependencies = { loadRepository: async () => repository };

        await runMindmapMultiMigrationCommand('plan', reportPath, {}, dependencies);
        const planned = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        await rejectCode(
            runMindmapMultiMigrationCommand(
                'apply',
                reportPath,
                { actor: '2', fingerprint: planned.fingerprint, confirm: planned.confirmationToken },
                dependencies,
            ),
            'MINDMAP_MULTI_MIGRATION_SERVICE_RUNNING',
        );
        await rejectCode(
            runMindmapMultiMigrationCommand(
                'apply',
                reportPath,
                {
                    actor: '2',
                    fingerprint: planned.fingerprint,
                    confirm: planned.confirmationToken,
                    serviceStopped: true,
                },
                dependencies,
            ),
            'MINDMAP_MULTI_MIGRATION_BACKUP_REQUIRED',
        );
        await runMindmapMultiMigrationCommand(
            'apply',
            reportPath,
            {
                actor: '2',
                backupConfirmed: planned.fingerprint,
                fingerprint: planned.fingerprint,
                confirm: planned.confirmationToken,
                serviceStopped: true,
            },
            dependencies,
        );
        const applied = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        expect(applied.execution.state).to.equal('applied');
        await runMindmapMultiMigrationCommand('verify', reportPath, {}, dependencies);
        const verified = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        expect(verified.verification.ok).to.equal(true);
        expect(repository.closed).to.equal(3);
    });
});
