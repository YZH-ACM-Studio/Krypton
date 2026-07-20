import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { runFunction3049MigrationCommand } from '../src/commands/function-3049-migration';
import {
    applyFunction3049Migration,
    buildFunction3049MigrationPlan,
    Function3049MigrationError,
    type Function3049MigrationRepository,
    type Function3049MigrationSnapshot,
    transformLegacyFunction3049Config,
    verifyFunction3049Migration,
} from '../src/lib/function-3049-migration';
import { sha256 } from '../src/lib/problem-batch-import';

const source = ['#include <iostream>', 'int first(int x) {', '  return x + 1;', '}', 'int second(int x) {', '  return first(x) * 2;', '}'].join('\n');

function legacyConfig() {
    return {
        type: 'function',
        score: 100,
        langs: ['cc.cc17'],
        template: {
            lang: 'cc.cc17',
            source,
            sourceHash: sha256(source),
            regions: [
                {
                    id: 'r_mnopqrstuvwx',
                    startLine: 4,
                    endLine: 7,
                    order: 0,
                    signature: 'int second(int x)',
                    description: '实现第二个函数',
                },
                {
                    id: 'r_abcdefghijkl',
                    startLine: 1,
                    endLine: 4,
                    order: 1,
                    signature: 'int first(int x)',
                },
            ],
        },
        cases: [
            { input: '1.in', output: '1.out' },
            { input: '2.in', output: '2.out' },
        ],
    };
}

function targetProblem(overrides: Record<string, any> = {}) {
    return {
        _id: new ObjectId('64b000000000000000003049'),
        docType: 10,
        domainId: 'system',
        docId: 3049,
        pid: 'P3049',
        title: '测试函数1',
        owner: 2,
        content: 'private statement',
        hidden: true,
        nSubmit: 0,
        problemKind: 'function',
        codeEvaluationStatus: 'draft',
        structureRevision: 1,
        config: legacyConfig(),
        ...overrides,
    };
}

function snapshot(problem = targetProblem()): Function3049MigrationSnapshot {
    return { functionProblems: [problem], recordCount: 0 };
}

class MemoryRepository implements Function3049MigrationRepository {
    admin = true;
    audits: Array<Record<string, any>> = [];
    constructor(public current: Function3049MigrationSnapshot) {}

    async loadSnapshot() {
        return this.current;
    }

    async isSystemAdministrator() {
        return this.admin;
    }

    async updateTarget(input: { expectedProblem: Record<string, any>; nextConfig: Record<string, any>; nextStructureRevision: number }) {
        if (this.current.functionProblems[0] !== input.expectedProblem) return { matchedCount: 0, modifiedCount: 0 };
        this.current.functionProblems[0] = {
            ...input.expectedProblem,
            config: input.nextConfig,
            structureRevision: input.nextStructureRevision,
        };
        return { matchedCount: 1, modifiedCount: 1 };
    }

    async insertAudit(audit: Record<string, any>) {
        const row = { _id: `audit-${this.audits.length + 1}`, ...audit };
        this.audits.push(row);
        return row._id;
    }

    async findSuccessfulAudit(fingerprint: string) {
        return this.audits.find((audit) => audit.fingerprint === fingerprint && audit.result === 'success') || null;
    }
}

async function expectError(promise: Promise<unknown>, code: string) {
    try {
        await promise;
        expect.fail(`expected ${code}`);
    } catch (error) {
        expect(error).to.be.instanceOf(Function3049MigrationError);
        expect((error as Function3049MigrationError).code).to.equal(code);
    }
}

describe('P3.22 strict system/#3049 function protocol migration', () => {
    it('preserves source, language, cases, ids, and coordinates while removing signature and order', () => {
        const config = legacyConfig();
        const before = structuredClone(config);
        const transformed = transformLegacyFunction3049Config(config);
        expect(config).to.deep.equal(before);
        expect(transformed.nextConfig).to.deep.include({ type: 'function', score: 100, langs: ['cc.cc17'], cases: before.cases });
        expect(transformed.nextConfig.template).to.deep.include({
            lang: 'cc.cc17',
            source,
            sourceHash: sha256(source),
            publicRanges: [],
        });
        expect(transformed.targetRegions.map((region) => region.id)).to.deep.equal(['r_abcdefghijkl', 'r_mnopqrstuvwx']);
        expect(transformed.targetRegions).to.deep.equal([
            { id: 'r_abcdefghijkl', startLine: 1, endLine: 4, title: 'int first(int x)' },
            {
                id: 'r_mnopqrstuvwx',
                startLine: 4,
                endLine: 7,
                title: 'int second(int x)',
                description: '实现第二个函数',
            },
        ]);
        expect(JSON.stringify(transformed.nextConfig)).not.to.match(/signature|"order"/);
    });

    it('produces a source-only report with the complete safe structure summary and exact confirmation token', () => {
        const plan = buildFunction3049MigrationPlan(snapshot(), new Date('2026-07-20T12:00:00.000Z'));
        expect(plan.source).to.deep.include({
            domainId: 'system',
            docId: 3049,
            pid: 'P3049',
            title: '测试函数1',
            hidden: true,
            codeEvaluationStatus: 'draft',
            structureRevision: 1,
            nSubmit: 0,
            recordCount: 0,
            functionProblemCount: 1,
        });
        expect(plan.source.template).to.deep.include({ lang: 'cc.cc17', sourceHash: sha256(source), sourceLineCount: 7 });
        expect(plan.source.template.regions).to.have.length(2);
        expect(plan.target).to.deep.include({ structureRevision: 2, publicRanges: [] });
        expect(plan.confirmationToken).to.equal(`APPLY:function-3049:${plan.fingerprint}`);
        expect(JSON.stringify(plan)).not.to.include(source);
    });

    it('fails closed on target drift, submissions, missing templates, and malformed old regions', () => {
        const cases: Function3049MigrationSnapshot[] = [
            { functionProblems: [], recordCount: 0 },
            { functionProblems: [targetProblem(), targetProblem({ _id: new ObjectId(), docId: 3050 })], recordCount: 0 },
            snapshot(targetProblem({ hidden: false })),
            snapshot(targetProblem({ codeEvaluationStatus: 'ready' })),
            snapshot(targetProblem({ nSubmit: 1 })),
            { functionProblems: [targetProblem()], recordCount: 1 },
            snapshot(targetProblem({ config: { type: 'function' } })),
            snapshot(
                targetProblem({
                    config: {
                        ...legacyConfig(),
                        template: { ...legacyConfig().template, regions: [{ ...legacyConfig().template.regions[0], startLine: 99 }] },
                    },
                }),
            ),
        ];
        for (const item of cases) expect(() => buildFunction3049MigrationPlan(item)).to.throw(Function3049MigrationError);
    });

    it('rejects an already migrated template instead of inventing a compatibility path', () => {
        const config = legacyConfig();
        const transformed = transformLegacyFunction3049Config(config).nextConfig;
        expect(() => transformLegacyFunction3049Config(transformed)).to.throw(Function3049MigrationError);
    });

    it('requires exact confirmation and an active system administrator, then applies one CAS and verifies the audit', async () => {
        const repository = new MemoryRepository(snapshot());
        const report = buildFunction3049MigrationPlan(repository.current, new Date('2026-07-20T12:00:00.000Z'));
        await expectError(
            applyFunction3049Migration({
                report: structuredClone(report),
                repository,
                actor: 2,
                fingerprint: '0'.repeat(64),
                confirmationToken: report.confirmationToken,
            }),
            'FUNCTION_3049_MIGRATION_CONFIRMATION_REQUIRED',
        );
        repository.admin = false;
        await expectError(
            applyFunction3049Migration({
                report: structuredClone(report),
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'FUNCTION_3049_MIGRATION_ACTOR_DENIED',
        );
        repository.admin = true;
        const persisted: string[] = [];
        await applyFunction3049Migration({
            report,
            repository,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
            persistReport: async (next) => {
                persisted.push(next.execution?.state || '');
            },
        });
        expect(persisted).to.deep.equal(['applying', 'applied']);
        expect(repository.current.functionProblems[0].structureRevision).to.equal(2);
        expect(repository.current.functionProblems[0]).to.deep.include({
            pid: 'P3049',
            title: '测试函数1',
            owner: 2,
            content: 'private statement',
            hidden: true,
            codeEvaluationStatus: 'draft',
        });
        expect(repository.audits).to.have.length(1);
        await verifyFunction3049Migration(report, repository, new Date('2026-07-20T12:01:00.000Z'));
        expect(report.verification).to.deep.include({ ok: true, auditId: 'audit-1' });
    });

    it('rejects live source drift before issuing the CAS write', async () => {
        const repository = new MemoryRepository(snapshot());
        const report = buildFunction3049MigrationPlan(repository.current, new Date('2026-07-20T12:00:00.000Z'));
        repository.current.functionProblems[0] = { ...repository.current.functionProblems[0], title: 'changed' };
        await expectError(
            applyFunction3049Migration({
                report,
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'FUNCTION_3049_MIGRATION_FINGERPRINT_DRIFT',
        );
        expect(repository.current.functionProblems[0].structureRevision).to.equal(1);
        expect(repository.audits.at(-1)?.result).to.equal('failed');
    });

    it('requires service stop and a backup acknowledgement matching the plan fingerprint', async () => {
        const folder = await mkdtemp(join(tmpdir(), 'krypton-function-3049-'));
        const reportPath = join(folder, 'plan.json');
        const repository = new MemoryRepository(snapshot());
        const report = buildFunction3049MigrationPlan(repository.current, new Date('2026-07-20T12:00:00.000Z'));
        await writeFile(reportPath, JSON.stringify(report));
        const dependencies = { loadRepository: async () => repository };
        try {
            await expectError(
                runFunction3049MigrationCommand(
                    'apply',
                    reportPath,
                    {
                        actor: '2',
                        fingerprint: report.fingerprint,
                        confirm: report.confirmationToken,
                        backupConfirmed: report.fingerprint,
                    },
                    dependencies,
                ),
                'FUNCTION_3049_MIGRATION_SERVICE_RUNNING',
            );
            await expectError(
                runFunction3049MigrationCommand(
                    'apply',
                    reportPath,
                    {
                        actor: '2',
                        fingerprint: report.fingerprint,
                        confirm: report.confirmationToken,
                        backupConfirmed: '0'.repeat(64),
                        serviceStopped: true,
                    },
                    dependencies,
                ),
                'FUNCTION_3049_MIGRATION_BACKUP_REQUIRED',
            );
        } finally {
            await rm(folder, { recursive: true, force: true });
        }
    });
});
