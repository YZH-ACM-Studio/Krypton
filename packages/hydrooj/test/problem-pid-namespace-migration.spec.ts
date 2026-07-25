import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { BSON, ObjectId } from 'mongodb';
import { afterEach, describe, it } from 'node:test';
import { runPidNamespaceMigrationCommand } from '../src/commands/problem-pid-namespace-migration';
import {
    applyPidNamespaceMigration,
    buildPidNamespaceMigrationPlan,
    PID_NAMESPACE_OS_DOC_ID,
    PidNamespaceMigrationError,
    type PidNamespaceMigrationCounterTarget,
    type PidNamespaceMigrationEntry,
    type PidNamespaceMigrationReport,
    type PidNamespaceMigrationRepository,
    type PidNamespaceMigrationSnapshot,
    verifyPidNamespaceMigration,
} from '../src/lib/problem-pid-namespace-migration';

const OS_NAMESPACE_OBJECT_ID = '64f000000000000000000001';
const GENERATED_AT = new Date('2026-07-24T12:00:00.000Z');
const temporaryDirectories: string[] = [];

function clone<T>(value: T): T {
    return BSON.EJSON.parse(BSON.EJSON.stringify(value, { relaxed: false }), { relaxed: true }) as T;
}

function fixtureSnapshot(): PidNamespaceMigrationSnapshot {
    const problems: Array<Record<string, any>> = [];
    let objectSequence = 1;
    let docSequence = 1;
    const addProblem = (pid: unknown, options: { docId?: number; owner?: number } = {}) => {
        const docId = options.docId ?? docSequence++;
        const problem: Record<string, any> = {
            _id: new ObjectId((objectSequence++).toString(16).padStart(24, '0')),
            domainId: 'system',
            docType: 10,
            docId,
            title: `Problem ${String(pid)}`,
            owner: options.owner ?? 2,
            content: `Statement ${String(pid)}`,
            tag: ['fixture'],
            sort: `sort:${String(pid)}`,
            hidden: false,
        };
        if (pid !== undefined) problem.pid = pid;
        if (docId % 2 === 0) problem.structureRevision = 3;
        problems.push(problem);
    };

    for (let sequence = 3001; sequence <= 3070; sequence++) addProblem(`P${sequence}`);
    addProblem('P3100');
    for (let sequence = 4001; sequence <= 4057; sequence++) addProblem(`P${sequence}`);
    addProblem('P4059');
    for (let sequence = 5001; sequence <= 5020; sequence++) addProblem(`P${sequence}`);
    addProblem('P5043');
    for (let sequence = 1001; sequence <= 1083; sequence++) addProblem(`NK${sequence}`);
    for (let sequence = 1001; sequence <= 1175; sequence++) addProblem(`HDU${sequence}`);
    for (let sequence = 1; sequence <= 52; sequence++) {
        addProblem(`CCCCCAUC2026${String(sequence).padStart(4, '0')}`);
    }
    for (let sequence = 1001; sequence <= 1070; sequence++) addProblem(`OS${sequence}`, { owner: 8 });
    addProblem('OS1999', { docId: PID_NAMESPACE_OS_DOC_ID, owner: 8 });
    for (let sequence = 1; sequence <= 1164; sequence++) addProblem(`LEGACY-${String(sequence).padStart(4, '0')}`);
    for (let sequence = 0; sequence < 13; sequence++) addProblem(sequence % 2 ? null : undefined);

    expect(problems).to.have.length(1708);
    const records = Array.from({ length: 12 }, (_, index) => ({
        _id: new ObjectId((9000 + index).toString(16).padStart(24, '0')),
        domainId: 'system',
        pid: PID_NAMESPACE_OS_DOC_ID,
        uid: index + 1,
        status: index < 6 ? 1 : 2,
        score: index < 6 ? 100 : 0,
    }));
    return {
        databaseIdentity: {
            databaseName: 'hydro',
            collectionPrefix: '',
            collectionMap: [],
            replicaSet: null,
            primary: null,
            hosts: [],
        },
        codeVersion: 'hydrooj@test/problem-pid-namespace-migration@1',
        problems,
        domains: [{ _id: 'system', namespaces: {}, name: 'System' }],
        counters: [],
        namespaceDocs: [],
        related: {
            records,
            recordStats: [
                {
                    _id: new ObjectId('64f000000000000000000101'),
                    domainId: 'system',
                    pid: PID_NAMESPACE_OS_DOC_ID,
                    uid: 8,
                    status: 1,
                },
            ],
            recordHistory: [
                {
                    _id: new ObjectId('64f000000000000000000102'),
                    rid: records[0]._id,
                    status: 2,
                },
            ],
            statuses: [
                {
                    _id: new ObjectId('64f000000000000000000103'),
                    domainId: 'system',
                    docType: 10,
                    docId: PID_NAMESPACE_OS_DOC_ID,
                    uid: 8,
                    status: 1,
                },
            ],
            containers: [],
            trainingCourses: [],
            problemReferences: [],
            solutions: [],
            discussions: [],
            mindmap: [],
            tasks: [],
            paperDrafts: [],
            permits: [],
            permitSources: [],
            testdataSources: [],
            storage: [
                {
                    _id: 'fixture-file',
                    path: `problem/system/${PID_NAMESPACE_OS_DOC_ID}/testdata/1.in`,
                    size: 2,
                    etag: 'fixture',
                },
            ],
        },
    };
}

class FixtureRepository implements PidNamespaceMigrationRepository {
    readonly audits: Array<Record<string, any>> = [];
    closed = 0;
    casCalls = 0;
    failCasAt = 0;
    admin = true;

    constructor(readonly snapshot = fixtureSnapshot()) {}

    async loadSnapshot() {
        return this.snapshot;
    }

    async isSystemAdministrator(uid: number) {
        return this.admin && uid === 2;
    }

    async loadProblem(domainId: string, docId: number) {
        return this.snapshot.problems.find((problem) => problem.domainId === domainId && problem.docId === docId) || null;
    }

    async casProblem(entry: PidNamespaceMigrationEntry) {
        this.casCalls++;
        if (this.failCasAt && this.casCalls === this.failCasAt) return { matchedCount: 0, modifiedCount: 0 };
        const problem = await this.loadProblem(entry.domainId, entry.docId);
        if (
            !problem ||
            String(problem._id) !== entry.documentId ||
            problem.pid !== entry.pid ||
            Object.hasOwn(problem, 'structureRevision') !== entry.structureRevisionPresent ||
            (entry.structureRevisionPresent && BSON.EJSON.stringify(problem.structureRevision) !== BSON.EJSON.stringify(entry.structureRevision)) ||
            Object.hasOwn(problem, 'pidNamespaceId') !== entry.pidNamespaceIdPresent
        ) {
            return { matchedCount: 0, modifiedCount: 0 };
        }
        problem.pidNamespaceId = entry.namespaceId;
        if (entry.decision === 'rename-os') {
            problem.pid = entry.targetPid;
            problem.sort = entry.targetSort;
        }
        return { matchedCount: 1, modifiedCount: 1 };
    }

    async ensureOsNamespace(target: PidNamespaceMigrationReport['target']['osNamespace'], actor: number, now: Date): Promise<'applied' | 'no-op'> {
        const current = this.snapshot.namespaceDocs.find(
            (doc) => doc.namespaceId === target.namespaceId || (doc.domainId === 'system' && doc.prefix === 'OS'),
        );
        if (current) {
            if (current.namespaceId === target.namespaceId && current.counter === target.counter && current.createdBy === actor) {
                return 'no-op';
            }
            throw new PidNamespaceMigrationError('namespace collision', 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT');
        }
        this.snapshot.namespaceDocs.push({
            _id: new ObjectId(target.namespaceId.slice('custom:'.length)),
            domainId: 'system',
            namespaceId: target.namespaceId,
            kind: 'custom',
            name: target.name,
            prefix: target.prefix,
            start: target.start,
            counter: target.counter,
            allocated: true,
            enabled: true,
            revision: 1,
            members: clone(target.members),
            createdBy: actor,
            createdAt: now,
            updatedAt: now,
        });
        return 'applied';
    }

    async ensureCounter(target: PidNamespaceMigrationCounterTarget, now: Date): Promise<'applied' | 'no-op'> {
        const current = this.snapshot.counters.find((counter) => counter.domainId === target.domainId && counter.namespace === target.scope);
        if (current?.value === target.targetValue) return 'no-op';
        if (target.currentPresent) {
            if (!current || current.value !== target.currentValue) {
                throw new PidNamespaceMigrationError('counter collision', 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT');
            }
            current.value = target.targetValue;
            current.updatedAt = now;
            return 'applied';
        }
        if (current) throw new PidNamespaceMigrationError('counter collision', 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT');
        this.snapshot.counters.push({
            domainId: target.domainId,
            namespace: target.scope,
            value: target.targetValue,
            updatedAt: now,
        });
        return 'applied';
    }

    async insertAudit(audit: Record<string, any>) {
        const row = { _id: new ObjectId(), ...audit };
        this.audits.push(row);
        return row._id.toHexString();
    }

    async findEntryAudit(fingerprint: string, domainId: string, docId: number) {
        return (
            this.audits.find(
                (audit) =>
                    audit.type === 'problem.pid-namespace.migration.entry' &&
                    audit.fingerprint === fingerprint &&
                    audit.domainId === domainId &&
                    audit.problemId === docId &&
                    audit.result === 'success',
            ) || null
        );
    }

    async findNamespaceAudit(fingerprint: string) {
        return (
            this.audits.find(
                (audit) =>
                    audit.type === 'problem.pid-namespace.migration.namespace' && audit.fingerprint === fingerprint && audit.result === 'success',
            ) || null
        );
    }

    async findCounterAudit(fingerprint: string, domainId: string, scope: string) {
        return (
            this.audits.find(
                (audit) =>
                    audit.type === 'problem.pid-namespace.migration.counter' &&
                    audit.fingerprint === fingerprint &&
                    audit.domainId === domainId &&
                    audit.counterScope === scope &&
                    audit.result === 'success',
            ) || null
        );
    }

    async findSuccessfulAudit(fingerprint: string) {
        return (
            this.audits.find(
                (audit) => audit.type === 'problem.pid-namespace.migration' && audit.fingerprint === fingerprint && audit.result === 'success',
            ) || null
        );
    }

    async loadSuccessfulAudits(fingerprint: string) {
        return this.audits.filter((audit) => audit.fingerprint === fingerprint && audit.result === 'success');
    }

    async close() {
        this.closed++;
    }
}

async function rejectCode(work: Promise<unknown>, code: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.be.instanceOf(PidNamespaceMigrationError);
        expect(error).to.have.property('code', code);
        return;
    }
    expect.fail(`expected ${code}`);
}

function fixturePlan(snapshot = fixtureSnapshot()) {
    return buildPidNamespaceMigrationPlan(snapshot, OS_NAMESPACE_OBJECT_ID, GENERATED_AT);
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('P2.39 strict PID namespace migration', () => {
    it('creates a deterministic executable plan for the exact production facts', () => {
        const snapshot = fixtureSnapshot();
        const first = fixturePlan(snapshot);
        const second = fixturePlan(clone(snapshot));

        expect(first.fingerprint).to.equal(second.fingerprint);
        expect(first.source.executable).to.equal(true);
        expect(first.source.drifts).to.deep.equal([]);
        expect(first.source.problemCount).to.equal(1708);
        expect(first.source.familyCounts).to.deep.equal({
            'pat-basic': 71,
            'pat-advanced': 58,
            self: 21,
            nowcoder: 83,
            hdu: 175,
            gplt: 0,
            cauc: 52,
            os: 71,
            legacy: 1164,
            'invalid-pid': 13,
        });
        expect(first.entries.filter((entry) => entry.decision === 'assign')).to.have.length(530);
        expect(first.entries.filter((entry) => entry.decision === 'rename-os')).to.have.length(1);
        expect(first.target.osRename).to.include({ docId: 2966, oldPid: 'OS1999', newPid: 'OS1071', nextPid: 'OS1072' });
        expect(first.target.osNamespace).to.include({ prefix: 'OS', start: 1001, counter: 1071 });
        expect(first.target.osNamespace.members).to.deep.equal([{ uid: 8, role: 'manager', editAll: false }]);
        expect(first.target.counters.find((counter) => counter.scope === 'pat-basic')?.targetValue).to.equal(3100);
        expect(first.target.counters.find((counter) => counter.scope === 'nowcoder')?.targetValue).to.equal(1083);
    });

    it('marks any count, ownership, collision, or OS external-reference drift unexecutable', () => {
        const changedCount = fixtureSnapshot();
        changedCount.problems.pop();
        expect(fixturePlan(changedCount).source.drifts).to.include('problem-count:1707!=1708');

        const changedOwner = fixtureSnapshot();
        changedOwner.problems.find((problem) => problem.pid === 'OS1001')!.owner = 9;
        expect(fixturePlan(changedOwner).source.drifts).to.include('os-owner-drift:system/461');

        const collision = fixtureSnapshot();
        collision.problems.find((problem) => problem.pid === 'LEGACY-0001')!.pid = 'OS1071';
        expect(fixturePlan(collision).source.drifts).to.include('os1071-is-not-free');

        const referenced = fixtureSnapshot();
        referenced.related.containers.push({ _id: new ObjectId(), domainId: 'system', docType: 30, pids: [2966] });
        expect(fixturePlan(referenced).source.drifts).to.include('os1999-reference:containers:1');
        expect(fixturePlan(referenced).source.executable).to.equal(false);
    });

    it('requires exact confirmation and a system administrator before any write', async () => {
        const repository = new FixtureRepository();
        const report = fixturePlan(repository.snapshot);
        await rejectCode(
            applyPidNamespaceMigration({
                report,
                repository,
                actor: 2,
                fingerprint: '0'.repeat(64),
                confirmationToken: report.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_CONFIRMATION_REQUIRED',
        );
        repository.admin = false;
        await rejectCode(
            applyPidNamespaceMigration({
                report,
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_PERMISSION_DENIED',
        );
        expect(repository.casCalls).to.equal(0);
        expect(repository.snapshot.namespaceDocs).to.deep.equal([]);
    });

    it('assigns only deterministic families, renames OS1999 in place, initializes counters, audits, and verifies', async () => {
        const repository = new FixtureRepository();
        const report = fixturePlan(repository.snapshot);
        const osBefore = clone(await repository.loadProblem('system', PID_NAMESPACE_OS_DOC_ID));
        const relatedBefore = clone(repository.snapshot.related);

        await applyPidNamespaceMigration({
            report,
            repository,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
        });
        await verifyPidNamespaceMigration(report, repository, new Date('2026-07-24T12:05:00.000Z'));

        const osAfter = await repository.loadProblem('system', PID_NAMESPACE_OS_DOC_ID);
        expect(osAfter).to.include({ docId: PID_NAMESPACE_OS_DOC_ID, pid: 'OS1071' });
        expect(String(osAfter!._id)).to.equal(String(osBefore!._id));
        expect(osAfter!.owner).to.equal(osBefore!.owner);
        expect(osAfter!.content).to.equal(osBefore!.content);
        expect(repository.snapshot.related).to.deep.equal(relatedBefore);
        expect(repository.snapshot.problems.some((problem) => problem.pid === 'OS1999')).to.equal(false);
        expect(repository.snapshot.problems.some((problem) => problem.pid === 'OS1072')).to.equal(false);
        expect(repository.snapshot.problems.filter((problem) => problem.pidNamespaceId)).to.have.length(531);
        expect(repository.snapshot.problems.find((problem) => problem.pid === 'LEGACY-0001')).not.to.have.property('pidNamespaceId');
        expect(report.execution?.state).to.equal('applied');
        expect(report.verification?.ok).to.equal(true);
        expect(repository.audits.filter((audit) => audit.type === 'problem.pid-namespace.migration.entry')).to.have.length(531);
        expect(repository.audits.filter((audit) => audit.type === 'problem.pid-namespace.migration')).to.have.length(1);
    });

    it('resumes idempotently after a partial CAS failure without rewriting completed Problems', async () => {
        const repository = new FixtureRepository();
        repository.failCasAt = 5;
        const report = fixturePlan(repository.snapshot);
        await rejectCode(
            applyPidNamespaceMigration({
                report,
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_CAS_CONFLICT',
        );
        expect(report.execution?.state).to.equal('failed');
        expect(report.execution?.results).to.have.length(4);

        repository.failCasAt = 0;
        await applyPidNamespaceMigration({
            report,
            repository,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
        });
        await verifyPidNamespaceMigration(report, repository);
        expect(report.execution?.state).to.equal('applied');
        expect(repository.snapshot.problems.filter((problem) => problem.pidNamespaceId)).to.have.length(531);
        expect(repository.audits.filter((audit) => audit.type === 'problem.pid-namespace.migration.entry')).to.have.length(531);
    });

    it('revalidates all source facts before a forged or partial execution resume', async () => {
        const forgedRepository = new FixtureRepository();
        const forgedReport = fixturePlan(forgedRepository.snapshot);
        forgedReport.execution = {
            actor: 2,
            startedAt: GENERATED_AT.toISOString(),
            updatedAt: GENERATED_AT.toISOString(),
            state: 'failed',
            results: [],
            counterResults: [],
        };
        forgedRepository.snapshot.problems.find((problem) => problem.pid === 'LEGACY-0001')!.title = 'changed before forged resume';
        await rejectCode(
            applyPidNamespaceMigration({
                report: forgedReport,
                repository: forgedRepository,
                actor: 2,
                fingerprint: forgedReport.fingerprint,
                confirmationToken: forgedReport.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_FINGERPRINT_DRIFT',
        );
        expect(forgedRepository.casCalls).to.equal(0);

        const partialRepository = new FixtureRepository();
        partialRepository.failCasAt = 5;
        const partialReport = fixturePlan(partialRepository.snapshot);
        await rejectCode(
            applyPidNamespaceMigration({
                report: partialReport,
                repository: partialRepository,
                actor: 2,
                fingerprint: partialReport.fingerprint,
                confirmationToken: partialReport.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_CAS_CONFLICT',
        );
        partialRepository.snapshot.related.permits.push({
            _id: new ObjectId(),
            domainId: 'system',
            pid: PID_NAMESPACE_OS_DOC_ID,
            active: false,
        });
        const casCallsBeforeResume = partialRepository.casCalls;
        await rejectCode(
            applyPidNamespaceMigration({
                report: partialReport,
                repository: partialRepository,
                actor: 2,
                fingerprint: partialReport.fingerprint,
                confirmationToken: partialReport.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_FINGERPRINT_DRIFT',
        );
        expect(partialRepository.casCalls).to.equal(casCallsBeforeResume);
    });

    it('rejects pre-apply drift and detects post-apply skipped, related, and non-target mutations', async () => {
        const repository = new FixtureRepository();
        const report = fixturePlan(repository.snapshot);
        repository.snapshot.problems.find((problem) => problem.pid === 'P3001')!.title = 'changed after plan';
        await rejectCode(
            applyPidNamespaceMigration({
                report,
                repository,
                actor: 2,
                fingerprint: report.fingerprint,
                confirmationToken: report.confirmationToken,
            }),
            'PID_NAMESPACE_MIGRATION_FINGERPRINT_DRIFT',
        );

        const appliedRepository = new FixtureRepository();
        const appliedReport = fixturePlan(appliedRepository.snapshot);
        await applyPidNamespaceMigration({
            report: appliedReport,
            repository: appliedRepository,
            actor: 2,
            fingerprint: appliedReport.fingerprint,
            confirmationToken: appliedReport.confirmationToken,
        });
        appliedRepository.snapshot.problems.find((problem) => problem.pid === 'LEGACY-0001')!.title = 'changed skipped problem';
        appliedRepository.snapshot.related.records[0].score = 7;
        await rejectCode(verifyPidNamespaceMigration(appliedReport, appliedRepository), 'PID_NAMESPACE_MIGRATION_VERIFY_FAILED');
        expect(appliedReport.verification?.checks.find((check) => check.check === 'skipped-problems-unchanged')?.ok).to.equal(false);
        expect(appliedReport.verification?.checks.find((check) => check.check === 'records-status-storage-references')?.ok).to.equal(false);
    });

    it('fails verification when any per-write migration audit is missing', async () => {
        const repository = new FixtureRepository();
        const report = fixturePlan(repository.snapshot);
        await applyPidNamespaceMigration({
            report,
            repository,
            actor: 2,
            fingerprint: report.fingerprint,
            confirmationToken: report.confirmationToken,
        });
        const missingIndex = repository.audits.findIndex((audit) => audit.type === 'problem.pid-namespace.migration.entry');
        repository.audits.splice(missingIndex, 1);
        await rejectCode(verifyPidNamespaceMigration(report, repository), 'PID_NAMESPACE_MIGRATION_VERIFY_FAILED');
        expect(report.verification?.checks.find((check) => check.check === 'migration-audits')?.ok).to.equal(false);
    });

    it('keeps CLI plan read-only and enforces service-stop, backup, fingerprint, and persisted verification', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'problem-pid-namespace-migration-'));
        temporaryDirectories.push(directory);
        const reportPath = path.join(directory, 'report.json');
        const repository = new FixtureRepository();
        const dependencies = { loadRepository: async () => repository };

        await runPidNamespaceMigrationCommand('plan', reportPath, {}, dependencies);
        expect(repository.casCalls).to.equal(0);
        expect(repository.snapshot.namespaceDocs).to.deep.equal([]);
        const planned = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        await rejectCode(
            runPidNamespaceMigrationCommand(
                'apply',
                reportPath,
                {
                    actor: '2',
                    fingerprint: planned.fingerprint,
                    confirm: planned.confirmationToken,
                },
                dependencies,
            ),
            'PID_NAMESPACE_MIGRATION_SERVICE_RUNNING',
        );
        await rejectCode(
            runPidNamespaceMigrationCommand(
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
            'PID_NAMESPACE_MIGRATION_BACKUP_REQUIRED',
        );
        await runPidNamespaceMigrationCommand(
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
        await rejectCode(runPidNamespaceMigrationCommand('verify', reportPath, {}, dependencies), 'PID_NAMESPACE_MIGRATION_SERVICE_RUNNING');
        await runPidNamespaceMigrationCommand('verify', reportPath, { serviceStopped: true }, dependencies);
        const verified = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        expect(verified.verification.ok).to.equal(true);
        expect(repository.closed).to.equal(3);
    });
});
