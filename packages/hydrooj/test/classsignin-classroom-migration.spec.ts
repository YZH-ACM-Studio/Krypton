import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PERM, PRIV } from '@hydrooj/common';
import { BSON, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterEach, describe, it } from 'node:test';
import { runClassSigninClassroomMigrationCommand } from '../src/commands/classsignin-classroom-migration';
import {
    applyClassSigninClassroomMigration,
    assertExamClassroomIntegrity,
    buildClassSigninClassroomMigrationPlan,
    classSigninClassroomMigrationFingerprint,
    type ClassSigninClassroomMigrationBatchDoc,
    type ClassSigninClassroomMigrationPlan,
    type ClassSigninClassroomMigrationRepository,
    type ClassSigninClassroomMigrationSnapshot,
    ClassSigninClassroomMigrationError,
    type ExamClassroomDoc,
    validateClassSigninExport,
    validateClassSigninManifest,
    verifyClassSigninClassroomMigration,
} from '../src/lib/classsignin-classroom-migration';
import { canonicalJson, sha256 } from '../src/lib/problem-batch-import';
import {
    classSigninClassroomMigrationAdapterInternals,
    MongoClassSigninClassroomMigrationRepository,
} from '../src/model/classsignin-classroom-migration-adapter';
import { ExamClassroomService } from '../src/model/exam-classroom-service';
import type { EndpointSeatPairingWindowDoc } from '../src/model/endpoint-seat-binding';

function sourceExport(layoutJson: string | null = null): string {
    return JSON.stringify({
        formatVersion: 1,
        sourceSystem: 'ClassSigninSystem',
        sourceDatabase: 'class_signin',
        postgresVersion: '16.12',
        snapshotAt: '2026-08-11T08:34:42.508Z',
        migrations: [{ id: 1, hash: 'a'.repeat(64), createdAt: 1763882221236 }],
        schools: [
            {
                id: '10000000-0000-4000-8000-000000000001',
                code: 'CAUC',
                name: '中国民航大学',
                isActive: true,
                createdAt: '2026-03-07T12:12:57.403Z',
                updatedAt: '2026-03-07T12:12:57.403Z',
            },
        ],
        classrooms: [
            {
                id: '20000000-0000-4000-8000-000000000001',
                schoolId: '10000000-0000-4000-8000-000000000001',
                name: '北实-201',
                layoutJson,
                createdAt: '2026-03-07T12:12:57.417Z',
                updatedAt: '2026-03-07T12:12:57.417Z',
            },
        ],
    });
}

function manifestForSource(
    source: ReturnType<typeof validateClassSigninExport>,
    schoolId = new ObjectId('64a000000000000000000001'),
    domainId = 'system',
) {
    return validateClassSigninManifest(
        JSON.stringify({
            schemaVersion: 1,
            sourceSystem: 'ClassSigninSystem',
            sourceSha256: source.sourceSha256,
            schoolMappings: [{ sourceSchoolId: source.schools[0].sourceSchoolId, domainId, schoolId: schoolId.toHexString() }],
        }),
        source,
    );
}

const temporaryDirectories: string[] = [];

function bsonClone<T>(value: T): T {
    return BSON.deserialize(BSON.serialize(value)) as T;
}

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

class FixtureRepository implements ClassSigninClassroomMigrationRepository {
    readonly snapshot: ClassSigninClassroomMigrationSnapshot;
    readonly batches = new Map<string, ClassSigninClassroomMigrationBatchDoc>();
    readonly audits = new Map<string, Record<string, unknown>>();
    indexesEnsured = 0;
    authorizedActor = 2;

    constructor(snapshot: ClassSigninClassroomMigrationSnapshot) {
        this.snapshot = snapshot;
    }

    async loadSnapshot() {
        return this.snapshot;
    }

    async isExamInfrastructureAdministrator(uid: number) {
        return uid === this.authorizedActor;
    }

    async ensureIndexes() {
        this.indexesEnsured++;
    }

    async writeClassroom(expected: ExamClassroomDoc | null, target: ExamClassroomDoc) {
        const index = this.snapshot.classrooms.findIndex((classroom) => classroom._id.equals(target._id));
        if (index < 0) {
            if (expected) throw new Error('fixture expected an existing classroom');
            this.snapshot.classrooms.push(bsonClone(target));
            return 'applied' as const;
        }
        const current = this.snapshot.classrooms[index];
        if (JSON.stringify(current) === JSON.stringify(target)) return 'no-op' as const;
        if (!expected || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('fixture CAS conflict');
        this.snapshot.classrooms[index] = bsonClone(target);
        return 'applied' as const;
    }

    async saveBatch(batch: ClassSigninClassroomMigrationBatchDoc, expectedState: ClassSigninClassroomMigrationBatchDoc | null) {
        const current = this.batches.get(batch._id);
        if (expectedState === null) {
            if (current) {
                if (JSON.stringify(current) === JSON.stringify(batch)) return 'no-op' as const;
                throw new Error('fixture batch insert conflict');
            }
            if (batch.revision !== 1) throw new Error('fixture initial batch revision');
        } else {
            if (
                !current ||
                JSON.stringify(current) !== JSON.stringify(expectedState) ||
                expectedState.state === 'applied' ||
                batch.revision !== expectedState.revision + 1
            ) {
                if (current && JSON.stringify(current) === JSON.stringify(batch)) return 'no-op' as const;
                throw new Error('fixture batch CAS conflict');
            }
        }
        this.batches.set(batch._id, structuredClone(batch));
        return 'applied' as const;
    }

    async loadBatch(batchId: string) {
        return this.batches.get(batchId) || null;
    }

    async insertAudit(audit: Record<string, unknown>) {
        const id = new ObjectId().toHexString();
        this.audits.set(id, { _id: id, ...structuredClone(audit) });
        return id;
    }

    async ensureAudit(auditId: string, audit: Record<string, unknown>) {
        const target = { _id: auditId, ...structuredClone(audit) };
        const current = this.audits.get(auditId);
        if (current) {
            if (JSON.stringify(current) === JSON.stringify(target)) return 'no-op' as const;
            throw new Error('fixture audit identity conflict');
        }
        this.audits.set(auditId, target);
        return 'applied' as const;
    }

    async loadAudit(auditId: string) {
        return this.audits.get(auditId) || null;
    }
}

async function rejectCode(work: Promise<unknown>, code: string) {
    try {
        await work;
    } catch (error) {
        expect(error).to.be.instanceOf(ClassSigninClassroomMigrationError);
        expect(error).to.have.property('code', code);
        return;
    }
    expect.fail(`expected ${code}`);
}

describe('P2.1 one-time ClassSignin classroom migration', () => {
    it('normalizes stable seats and decorations without inventing identities', () => {
        const source = validateClassSigninExport(
            sourceExport(
                JSON.stringify([
                    { id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' },
                    {
                        id: 'desk-1',
                        label: '讲台',
                        x: -40,
                        y: -80,
                        width: 120,
                        height: 30,
                        rotation: -90,
                        status: 'disabled',
                        type: 'rect',
                    },
                ]),
            ),
        );

        expect(source.summary).to.deep.include({ schoolCount: 1, classroomCount: 1, seatCount: 1, decorationCount: 1 });
        expect(source.classrooms[0].layout.seats).to.deep.equal([
            { sourceSeatId: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty' },
        ]);
        expect(source.classrooms[0].layout.decorations).to.deep.equal([
            {
                sourceItemId: 'desk-1',
                label: '讲台',
                x: -40,
                y: -80,
                width: 120,
                height: 30,
                rotation: -90,
                status: 'disabled',
                type: 'rect',
            },
        ]);
    });

    it('builds a deterministic add plan from an explicit userbind school mapping', () => {
        const source = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = validateClassSigninManifest(
            JSON.stringify({
                schemaVersion: 1,
                sourceSystem: 'ClassSigninSystem',
                sourceSha256: source.sourceSha256,
                schoolMappings: [
                    {
                        sourceSchoolId: source.schools[0].sourceSchoolId,
                        domainId: 'system',
                        schoolId: schoolId.toHexString(),
                    },
                ],
            }),
            source,
        );
        const generatedAt = new Date('2026-08-11T09:00:00.000Z');
        const snapshot = {
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        };
        const first = buildClassSigninClassroomMigrationPlan(source, manifest, snapshot, generatedAt);
        const second = buildClassSigninClassroomMigrationPlan(source, manifest, snapshot, generatedAt);

        expect(first.fingerprint).to.equal(second.fingerprint);
        expect(first.summary).to.deep.include({ added: 1, unchanged: 0, updated: 0, archived: 0, conflicts: 0 });
        expect(first.entries[0]).to.include({ action: 'add', domainId: 'system', sourceClassroomId: source.classrooms[0].sourceClassroomId });
        expect(first.entries[0].targetLayoutRevision).to.equal(1);
        expect(first.confirmationToken).to.equal(`APPLY:classsignin-classrooms:${first.fingerprint}`);
    });

    it('re-derives every plan entry from the supplied source and manifest instead of trusting a recomputed public hash', async () => {
        const source = validateClassSigninExport(sourceExport(null));
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = manifestForSource(source, schoolId);
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        plan.entries[0].domainId = 'forged-domain';
        plan.entries[0].desired!.name = '伪造写入';
        plan.fingerprint = classSigninClassroomMigrationFingerprint(plan);
        plan.confirmationToken = `APPLY:classsignin-classrooms:${plan.fingerprint}`;

        await rejectCode(
            applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_PLAN_NOT_DERIVED',
        );
        expect(repository.indexesEnsured).to.equal(0);
        expect(repository.snapshot.classrooms).to.have.length(0);
    });

    it('applies once with CAS, is idempotent, and verifies Mongo canonical facts', async () => {
        const source = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = validateClassSigninManifest(
            JSON.stringify({
                schemaVersion: 1,
                sourceSystem: 'ClassSigninSystem',
                sourceSha256: source.sourceSha256,
                schoolMappings: [{ sourceSchoolId: source.schools[0].sourceSchoolId, domainId: 'system', schoolId: schoolId.toHexString() }],
            }),
            source,
        );
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot(), new Date('2026-08-11T09:00:00.000Z'));
        let persisted = 0;

        await applyClassSigninClassroomMigration({
            plan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: plan.fingerprint,
            confirmationToken: plan.confirmationToken,
            now: new Date('2026-08-11T09:05:00.000Z'),
            persistPlan: async () => {
                persisted++;
            },
        });
        await applyClassSigninClassroomMigration({
            plan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: plan.fingerprint,
            confirmationToken: plan.confirmationToken,
            now: new Date('2026-08-11T09:10:00.000Z'),
        });
        await verifyClassSigninClassroomMigration(plan, source, manifest, repository, new Date('2026-08-11T09:15:00.000Z'));

        expect(repository.snapshot.classrooms).to.have.length(1);
        expect(repository.snapshot.classrooms[0]).to.include({ revision: 1, layoutRevision: 1, importBatchId: plan.batchId, status: 'active' });
        expect(repository.snapshot.classrooms[0].layoutRevisions).to.have.length(1);
        expect(repository.snapshot.classrooms[0].layoutRevisions[0].snapshot.seats[0].sourceSeatId).to.equal('seat-1');
        expect(plan.execution?.state).to.equal('applied');
        expect(plan.verification?.ok).to.equal(true);
        expect(persisted).to.be.greaterThan(1);
    });

    it('recovers idempotently when the process dies after success audit insertion but before final batch persistence', async () => {
        const source = validateClassSigninExport(sourceExport(null));
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = manifestForSource(source, schoolId);
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        let persistedText = JSON.stringify(plan);
        let crashObserved = false;
        try {
            await applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                now: new Date('2026-08-11T09:20:00.000Z'),
                persistPlan: async (next) => {
                    if (next.execution?.state === 'applied') throw new Error('injected crash before final batch persistence');
                    persistedText = JSON.stringify(next);
                },
            });
        } catch (error) {
            expect(error).to.have.property('message', 'injected crash before final batch persistence');
            crashObserved = true;
        }
        expect(crashObserved).to.equal(true);
        const successAuditsBefore = [...repository.audits.values()].filter((audit) => audit.result === 'success');
        expect(successAuditsBefore).to.have.length(1);
        const persistedResult = JSON.parse(persistedText).execution.results[0];
        expect(persistedResult.result).to.equal('applied');

        const recoveredPlan = JSON.parse(persistedText) as ClassSigninClassroomMigrationPlan;
        await applyClassSigninClassroomMigration({
            plan: recoveredPlan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: recoveredPlan.fingerprint,
            confirmationToken: recoveredPlan.confirmationToken,
            now: new Date('2026-08-11T09:30:00.000Z'),
        });
        const successAuditsAfter = [...repository.audits.values()].filter((audit) => audit.result === 'success');
        expect(successAuditsAfter).to.have.length(1);
        expect(recoveredPlan.execution?.state).to.equal('applied');
        expect(recoveredPlan.execution?.results[0]).to.deep.equal(persistedResult);
        expect(recoveredPlan.execution?.auditId).to.equal(String(successAuditsBefore[0]._id));
    });

    it('reconciles exact audit and batch facts when Mongo commits them but acknowledgements are lost', async () => {
        const source = validateClassSigninExport(sourceExport(null));
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = manifestForSource(source, schoolId);
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        let persistedText = JSON.stringify(plan);
        let loseAuditAcknowledgement = true;
        let loseBatchAcknowledgement = true;
        let loseFirstFinalBatchRead = false;
        const ensureAudit = repository.ensureAudit.bind(repository);
        repository.ensureAudit = async (auditId, audit) => {
            const result = await ensureAudit(auditId, audit);
            if (loseAuditAcknowledgement) {
                loseAuditAcknowledgement = false;
                throw new Error('injected success audit acknowledgement loss');
            }
            return result;
        };
        const saveBatch = repository.saveBatch.bind(repository);
        repository.saveBatch = async (batch, expected) => {
            const result = await saveBatch(batch, expected);
            if (batch.state === 'applied' && loseBatchAcknowledgement) {
                loseBatchAcknowledgement = false;
                loseFirstFinalBatchRead = true;
                throw new Error('injected final batch acknowledgement loss');
            }
            return result;
        };
        const loadBatch = repository.loadBatch.bind(repository);
        repository.loadBatch = async (batchId) => {
            if (loseFirstFinalBatchRead) {
                loseFirstFinalBatchRead = false;
                throw new Error('injected first final batch read loss');
            }
            return loadBatch(batchId);
        };
        await applyClassSigninClassroomMigration({
            plan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: plan.fingerprint,
            confirmationToken: plan.confirmationToken,
            now: new Date('2026-08-11T09:40:00.000Z'),
            persistPlan: async (next) => {
                persistedText = JSON.stringify(next);
            },
        });
        expect(plan.execution?.state).to.equal('applied');
        const persistedResult = JSON.parse(persistedText).execution.results[0];
        expect(persistedResult.result).to.equal('applied');
        expect([...repository.audits.values()].filter((audit) => audit.result === 'success')).to.have.length(1);
        expect([...repository.audits.values()].filter((audit) => audit.result === 'failed')).to.have.length(0);

        const recoveredPlan = JSON.parse(persistedText) as ClassSigninClassroomMigrationPlan;
        await applyClassSigninClassroomMigration({
            plan: recoveredPlan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: recoveredPlan.fingerprint,
            confirmationToken: recoveredPlan.confirmationToken,
            now: new Date('2026-08-11T09:50:00.000Z'),
        });
        expect(recoveredPlan.execution?.state).to.equal('applied');
        expect(recoveredPlan.execution?.completedAt).to.equal('2026-08-11T09:40:00.000Z');
        expect(recoveredPlan.execution?.results[0]).to.deep.equal(persistedResult);
        expect([...repository.audits.values()].filter((audit) => audit.result === 'success')).to.have.length(1);
    });

    it('only advances a locally persisted transition from its exact recorded Mongo predecessor', async () => {
        const source = validateClassSigninExport(sourceExport(null));
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = manifestForSource(source, schoolId);
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        let persistedText = JSON.stringify(plan);
        let crashObserved = false;
        try {
            await applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                now: new Date('2026-08-11T09:55:00.000Z'),
                persistPlan: async (next) => {
                    persistedText = JSON.stringify(next);
                    if (next.execution?.state === 'applying' && next.execution.results.length === 1) {
                        throw new Error('injected crash after local transition persistence');
                    }
                },
            });
        } catch (error) {
            expect(error).to.have.property('message', 'injected crash after local transition persistence');
            crashObserved = true;
        }
        expect(crashObserved).to.equal(true);
        const predecessor = structuredClone(repository.batches.get(plan.batchId)!);
        expect(predecessor.revision).to.equal(1);
        const persistedTarget = bsonClone(repository.snapshot.classrooms[0]);
        const persistedResult = JSON.parse(persistedText).execution.results[0];
        const auditsBeforeDrift = structuredClone([...repository.audits.entries()]);
        const indexesBeforeDrift = repository.indexesEnsured;
        repository.snapshot.classrooms = [];
        const driftedRecoveryPlan = JSON.parse(persistedText) as ClassSigninClassroomMigrationPlan;
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: driftedRecoveryPlan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT',
        );
        expect(repository.snapshot.classrooms).to.have.length(0);
        expect(repository.batches.get(plan.batchId)).to.deep.equal(predecessor);
        expect(driftedRecoveryPlan.execution?.results[0]).to.deep.equal(persistedResult);
        expect([...repository.audits.entries()]).to.deep.equal(auditsBeforeDrift);
        expect(repository.indexesEnsured).to.equal(indexesBeforeDrift);
        repository.snapshot.classrooms = [persistedTarget];

        repository.batches.set(plan.batchId, { ...predecessor, concurrentAddedField: true } as ClassSigninClassroomMigrationBatchDoc);
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: JSON.parse(persistedText),
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT',
        );

        repository.batches.set(plan.batchId, {
            ...predecessor,
            updatedAt: new Date(predecessor.updatedAt.getTime() + 1),
        });
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: JSON.parse(persistedText),
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT',
        );

        repository.batches.set(plan.batchId, predecessor);
        const recoveredPlan = JSON.parse(persistedText) as ClassSigninClassroomMigrationPlan;
        await applyClassSigninClassroomMigration({
            plan: recoveredPlan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: plan.fingerprint,
            confirmationToken: plan.confirmationToken,
            now: new Date('2026-08-11T09:56:00.000Z'),
        });
        expect(recoveredPlan.execution?.state).to.equal('applied');
        expect(recoveredPlan.execution?.results[0].result).to.equal('applied');
    });

    it('rejects a failed-execution retry on clock rollback before mutating persistent facts', async () => {
        const source = validateClassSigninExport(sourceExport(null));
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = manifestForSource(source, schoolId);
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        const writeClassroom = repository.writeClassroom.bind(repository);
        repository.writeClassroom = async () => {
            throw new Error('injected classroom write failure');
        };
        let failureObserved = false;
        try {
            await applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                now: new Date('2026-08-11T10:10:00.000Z'),
            });
        } catch (error) {
            expect(error).to.have.property('message', 'injected classroom write failure');
            failureObserved = true;
        }
        expect(failureObserved).to.equal(true);
        expect(plan.execution?.state).to.equal('failed');
        repository.writeClassroom = writeClassroom;
        const planBeforeRetry = JSON.stringify(plan);
        const batchBeforeRetry = structuredClone(repository.batches.get(plan.batchId)!);
        const auditsBeforeRetry = structuredClone([...repository.audits.entries()]);
        const indexesBeforeRetry = repository.indexesEnsured;

        await rejectCode(
            applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                now: new Date('2026-08-11T10:09:59.999Z'),
            }),
            'CLASSSIGNIN_CLASSROOM_CLOCK_ROLLBACK',
        );
        expect(JSON.stringify(plan)).to.equal(planBeforeRetry);
        expect(repository.batches.get(plan.batchId)).to.deep.equal(batchBeforeRetry);
        expect([...repository.audits.entries()]).to.deep.equal(auditsBeforeRetry);
        expect(repository.indexesEnsured).to.equal(indexesBeforeRetry);
    });

    it('appends one immutable layout revision for label drift while preserving seat identity', async () => {
        const schoolId = new ObjectId('64a000000000000000000001');
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const firstSource = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const manifestFor = (source: ReturnType<typeof validateClassSigninExport>) =>
            validateClassSigninManifest(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceSystem: 'ClassSigninSystem',
                    sourceSha256: source.sourceSha256,
                    schoolMappings: [{ sourceSchoolId: source.schools[0].sourceSchoolId, domainId: 'system', schoolId: schoolId.toHexString() }],
                }),
                source,
            );
        const firstManifest = manifestFor(firstSource);
        const firstPlan = buildClassSigninClassroomMigrationPlan(firstSource, firstManifest, await repository.loadSnapshot());
        await applyClassSigninClassroomMigration({
            plan: firstPlan,
            source: firstSource,
            manifest: firstManifest,
            repository,
            actor: 2,
            fingerprint: firstPlan.fingerprint,
            confirmationToken: firstPlan.confirmationToken,
            now: new Date('2026-08-11T10:00:00.000Z'),
        });

        const secondSource = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: 'A-001', x: 15, y: 25, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const beforeUpdate = repository.snapshot.classrooms[0];
        const secondManifest = manifestFor(secondSource);
        const secondPlan = buildClassSigninClassroomMigrationPlan(secondSource, secondManifest, await repository.loadSnapshot());
        expect(secondPlan.entries[0]).to.include({ action: 'update', targetRevision: 2, targetLayoutRevision: 2 });
        expect(secondPlan.entries[0].removedSeatIds).to.deep.equal([]);

        const classroomBeforeRollback = bsonClone(repository.snapshot.classrooms[0]);
        const batchesBeforeRollback = structuredClone([...repository.batches.entries()]);
        const auditsBeforeRollback = structuredClone([...repository.audits.entries()]);
        const indexesBeforeRollback = repository.indexesEnsured;
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: secondPlan,
                source: secondSource,
                manifest: secondManifest,
                repository,
                actor: 2,
                fingerprint: secondPlan.fingerprint,
                confirmationToken: secondPlan.confirmationToken,
                now: new Date('2026-08-11T09:59:59.999Z'),
            }),
            'CLASSSIGNIN_CLASSROOM_CLOCK_ROLLBACK',
        );
        expect(repository.snapshot.classrooms[0]).to.deep.equal(classroomBeforeRollback);
        expect([...repository.batches.entries()]).to.deep.equal(batchesBeforeRollback);
        expect([...repository.audits.entries()]).to.deep.equal(auditsBeforeRollback);
        expect(repository.indexesEnsured).to.equal(indexesBeforeRollback);
        expect(secondPlan.execution).to.equal(undefined);

        await applyClassSigninClassroomMigration({
            plan: secondPlan,
            source: secondSource,
            manifest: secondManifest,
            repository,
            actor: 2,
            fingerprint: secondPlan.fingerprint,
            confirmationToken: secondPlan.confirmationToken,
            now: new Date('2026-08-11T10:01:00.000Z'),
        });
        expect(repository.snapshot.classrooms[0].layoutRevisions).to.have.length(2);
        expect(repository.snapshot.classrooms[0].layoutRevisions.map((revision) => revision.snapshot.seats[0].sourceSeatId)).to.deep.equal([
            'seat-1',
            'seat-1',
        ]);
        expect(repository.snapshot.classrooms[0].layoutRevisions[1].snapshot.seats[0].label).to.equal('A-001');

        const applied = repository.snapshot.classrooms[0];
        repository.snapshot.classrooms[0] = beforeUpdate;
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: secondPlan,
                source: secondSource,
                manifest: secondManifest,
                repository,
                actor: 2,
                fingerprint: secondPlan.fingerprint,
                confirmationToken: secondPlan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT',
        );
        repository.snapshot.classrooms[0] = applied;
    });

    it('requires the exact persisted applied batch and success audit and detects canonical layout corruption', async () => {
        const source = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = manifestForSource(source, schoolId);
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        await applyClassSigninClassroomMigration({
            plan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: plan.fingerprint,
            confirmationToken: plan.confirmationToken,
        });
        const auditId = plan.execution!.auditId!;
        const successAudit = repository.audits.get(auditId)!;

        repository.audits.delete(auditId);
        await rejectCode(verifyClassSigninClassroomMigration(plan, source, manifest, repository), 'CLASSSIGNIN_CLASSROOM_VERIFY_FAILED');
        repository.audits.set(auditId, successAudit);
        const batch = repository.batches.get(plan.batchId)!;
        repository.batches.delete(plan.batchId);
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT',
        );
        repository.batches.set(plan.batchId, batch);
        repository.batches.set(plan.batchId, { ...batch, sourceSha256: 'f'.repeat(64) });
        await rejectCode(verifyClassSigninClassroomMigration(plan, source, manifest, repository), 'CLASSSIGNIN_CLASSROOM_VERIFY_FAILED');
        repository.batches.set(plan.batchId, batch);

        const forgedAuditId = new ObjectId().toHexString();
        repository.audits.set(forgedAuditId, { ...successAudit, _id: forgedAuditId });
        plan.execution!.auditId = forgedAuditId;
        repository.batches.set(plan.batchId, { ...batch, auditId: forgedAuditId });
        await rejectCode(verifyClassSigninClassroomMigration(plan, source, manifest, repository), 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        plan.execution!.auditId = auditId;
        repository.batches.set(plan.batchId, batch);

        const canonicalClassroom = bsonClone(repository.snapshot.classrooms[0]);
        const unknownRoot = Object.assign(bsonClone(canonicalClassroom), { unknownRootField: true });
        expect(() => assertExamClassroomIntegrity(unknownRoot)).to.throw(ClassSigninClassroomMigrationError);
        const unknownRevision = bsonClone(canonicalClassroom);
        Object.assign(unknownRevision.layoutRevisions[0], { unknownRevisionField: true });
        expect(() => assertExamClassroomIntegrity(unknownRevision)).to.throw(ClassSigninClassroomMigrationError);
        const malformedLayout = bsonClone(canonicalClassroom.layoutRevisions[0].snapshot);
        malformedLayout.seats = [{ sourceSeatId: 'seat-1' } as (typeof malformedLayout.seats)[number]];
        const { fingerprint: _fingerprint, ...malformedPayload } = malformedLayout;
        malformedLayout.fingerprint = sha256(canonicalJson(malformedPayload));
        canonicalClassroom.layoutRevisions[0].snapshot = malformedLayout;
        canonicalClassroom.layoutRevisions[0].fingerprint = malformedLayout.fingerprint;
        expect(() => assertExamClassroomIntegrity(canonicalClassroom)).to.throw(ClassSigninClassroomMigrationError);

        repository.snapshot.classrooms[0].layoutRevisions[0].snapshot.seats = [];
        await rejectCode(verifyClassSigninClassroomMigration(plan, source, manifest, repository), 'CLASSSIGNIN_CLASSROOM_VERIFY_FAILED');
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT',
        );
    });

    it('fails closed when a referenced seat or classroom would disappear', async () => {
        const schoolId = new ObjectId('64a000000000000000000001');
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const source = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const makeManifest = (value: ReturnType<typeof validateClassSigninExport>) =>
            validateClassSigninManifest(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceSystem: 'ClassSigninSystem',
                    sourceSha256: value.sourceSha256,
                    schoolMappings: [{ sourceSchoolId: value.schools[0].sourceSchoolId, domainId: 'system', schoolId: schoolId.toHexString() }],
                }),
                value,
            );
        const initialManifest = makeManifest(source);
        const initial = buildClassSigninClassroomMigrationPlan(source, initialManifest, await repository.loadSnapshot());
        repository.snapshot.references.push({
            domainId: 'system',
            classroomId: new ObjectId(initial.entries[0].classroomId),
            kind: 'endpoint-seat-binding',
            sourceSeatId: 'missing-seat',
            referenceId: 'dangling-binding-before-add',
        });
        expect(() => buildClassSigninClassroomMigrationPlan(source, initialManifest, repository.snapshot)).to.throw(
            ClassSigninClassroomMigrationError,
        );
        repository.snapshot.references.pop();
        await applyClassSigninClassroomMigration({
            plan: initial,
            source,
            manifest: initialManifest,
            repository,
            actor: 2,
            fingerprint: initial.fingerprint,
            confirmationToken: initial.confirmationToken,
        });
        const classroomId = repository.snapshot.classrooms[0]._id;
        repository.snapshot.references.push({
            domainId: 'system',
            classroomId,
            kind: 'endpoint-seat-binding',
            sourceSeatId: 'missing-seat',
            referenceId: 'binding-with-missing-seat',
        });
        expect(() => buildClassSigninClassroomMigrationPlan(source, initialManifest, repository.snapshot)).to.throw(
            ClassSigninClassroomMigrationError,
        );
        repository.snapshot.references.pop();
        repository.snapshot.references.push({
            domainId: 'other',
            classroomId,
            kind: 'exam-target',
            referenceId: 'cross-domain-target',
        });
        expect(() => buildClassSigninClassroomMigrationPlan(source, initialManifest, repository.snapshot)).to.throw(
            ClassSigninClassroomMigrationError,
        );
        repository.snapshot.references.pop();
        const withoutSeat = validateClassSigninExport(sourceExport(JSON.stringify([])));
        const withoutSeatManifest = makeManifest(withoutSeat);
        repository.snapshot.references.push({
            domainId: 'system',
            classroomId,
            kind: 'exam-target',
            referenceId: 'whole-classroom-target',
        });
        const wholeClassroomPlan = buildClassSigninClassroomMigrationPlan(withoutSeat, withoutSeatManifest, await repository.loadSnapshot());
        expect(wholeClassroomPlan.entries[0].action).to.equal('conflict');
        expect(wholeClassroomPlan.entries[0].conflicts).to.deep.equal(['referenced_seat_removed:seat-1']);
        repository.snapshot.references.pop();

        repository.snapshot.references.push({
            domainId: 'system',
            classroomId,
            kind: 'endpoint-seat-binding',
            sourceSeatId: 'seat-1',
            referenceId: 'binding-1',
        });

        const seatPlan = buildClassSigninClassroomMigrationPlan(withoutSeat, withoutSeatManifest, await repository.loadSnapshot());
        expect(seatPlan.entries[0].action).to.equal('conflict');
        expect(seatPlan.entries[0].conflicts).to.deep.equal(['referenced_seat_removed:seat-1']);
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: seatPlan,
                source: withoutSeat,
                manifest: withoutSeatManifest,
                repository,
                actor: 2,
                fingerprint: seatPlan.fingerprint,
                confirmationToken: seatPlan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_PLAN_CONFLICT',
        );

        const deletedRaw = JSON.parse(sourceExport(null));
        deletedRaw.classrooms = [];
        const deleted = validateClassSigninExport(JSON.stringify(deletedRaw));
        const deletePlan = buildClassSigninClassroomMigrationPlan(deleted, makeManifest(deleted), await repository.loadSnapshot());
        expect(deletePlan.entries[0].action).to.equal('conflict');
        expect(deletePlan.entries[0].conflicts[0]).to.match(/^referenced_classroom_removed:/);
    });

    it('detects references and non-target classroom mutations introduced after the read-only plan', async () => {
        const schoolId = new ObjectId('64a000000000000000000001');
        const source = validateClassSigninExport(sourceExport(null));
        const manifest = manifestForSource(source, schoolId);
        const referenceRepository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const referencePlan = buildClassSigninClassroomMigrationPlan(source, manifest, await referenceRepository.loadSnapshot());
        referenceRepository.snapshot.references.push({
            domainId: 'system',
            classroomId: new ObjectId(referencePlan.entries[0].classroomId),
            kind: 'exam-target',
            referenceId: 'post-plan-reference',
        });
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: referencePlan,
                source,
                manifest,
                repository: referenceRepository,
                actor: 2,
                fingerprint: referencePlan.fingerprint,
                confirmationToken: referencePlan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_REFERENCE_DRIFT',
        );

        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const initialPlan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        await applyClassSigninClassroomMigration({
            plan: initialPlan,
            source,
            manifest,
            repository,
            actor: 2,
            fingerprint: initialPlan.fingerprint,
            confirmationToken: initialPlan.confirmationToken,
        });
        const imported = repository.snapshot.classrooms[0];
        repository.snapshot.classrooms.push({ ...imported, _id: new ObjectId(), domainId: 'other' });
        const changedSource = validateClassSigninExport(
            sourceExport(JSON.stringify([{ id: 'seat-1', label: 'changed', x: 0, y: 0, rotation: 0, status: 'empty', type: 'seat' }])),
        );
        const changedManifest = manifestForSource(changedSource, schoolId);
        const driftPlan = buildClassSigninClassroomMigrationPlan(changedSource, changedManifest, await repository.loadSnapshot());
        repository.snapshot.classrooms[1].name = 'post-plan non-target mutation';
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan: driftPlan,
                source: changedSource,
                manifest: changedManifest,
                repository,
                actor: 2,
                fingerprint: driftPlan.fingerprint,
                confirmationToken: driftPlan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_NON_TARGET_DRIFT',
        );
    });

    it('rejects malformed layouts, duplicate IDs, invalid coordinates, and mapping drift', async () => {
        expect(() => validateClassSigninExport(sourceExport('{'))).to.throw(ClassSigninClassroomMigrationError);
        expect(() =>
            validateClassSigninExport(
                sourceExport(
                    JSON.stringify([
                        { id: 'seat-1', label: '1', x: 0, y: 0, rotation: 0, status: 'empty', type: 'seat' },
                        { id: 'seat-1', label: '2', x: 1, y: 0, rotation: 0, status: 'empty', type: 'seat' },
                    ]),
                ),
            ),
        ).to.throw(ClassSigninClassroomMigrationError);
        expect(() =>
            validateClassSigninExport(
                sourceExport(JSON.stringify([{ id: ' seat-1 ', label: '1', x: 0, y: 0, rotation: 0, status: 'empty', type: 'seat' }])),
            ),
        ).to.throw(ClassSigninClassroomMigrationError, 'must not contain surrounding whitespace');
        expect(() =>
            validateClassSigninExport(
                sourceExport(JSON.stringify([{ id: 'seat-1', label: '1', x: 1_000_001, y: 0, rotation: 0, status: 'empty', type: 'seat' }])),
            ),
        ).to.throw(ClassSigninClassroomMigrationError);

        const source = validateClassSigninExport(sourceExport(null));
        expect(() =>
            validateClassSigninManifest(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceSystem: 'ClassSigninSystem',
                    sourceSha256: 'b'.repeat(64),
                    schoolMappings: [
                        {
                            sourceSchoolId: source.schools[0].sourceSchoolId,
                            domainId: 'system',
                            schoolId: '64a000000000000000000001',
                        },
                    ],
                }),
                source,
            ),
        ).to.throw(ClassSigninClassroomMigrationError);

        const legacy = validateClassSigninExport(
            sourceExport(JSON.stringify({ rows: 1, cols: 2, seats: [{ id: 'S-1', row: 0, col: 1 }], obstacles: [] })),
        );
        expect(legacy.classrooms[0].layout).to.include({ sourceFormat: 'legacy-grid-v1', coordinateSystem: 'grid', rows: 1, cols: 2 });
        expect(legacy.classrooms[0].layout.seats[0]).to.include({ sourceSeatId: 'S-1', label: 'S-1', x: 1, y: 0 });
    });

    it('reports a missing mapped empty school globally and rejects cross-domain batches', () => {
        const raw = JSON.parse(sourceExport(null));
        raw.classrooms = [];
        const emptySource = validateClassSigninExport(JSON.stringify(raw));
        const schoolId = new ObjectId('64a000000000000000000001');
        const emptyManifest = manifestForSource(emptySource, schoolId);
        const plan = buildClassSigninClassroomMigrationPlan(emptySource, emptyManifest, { schools: [], classrooms: [], references: [] });
        expect(plan.conflicts).to.deep.equal([`missing_userbind_school:system/${schoolId.toHexString()}`]);
        expect(plan.summary.conflicts).to.equal(1);

        raw.schools.push({
            ...raw.schools[0],
            id: '10000000-0000-4000-8000-000000000002',
            code: 'SECOND',
            name: '第二学校',
        });
        const twoSchoolSource = validateClassSigninExport(JSON.stringify(raw));
        expect(() =>
            validateClassSigninManifest(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceSystem: 'ClassSigninSystem',
                    sourceSha256: twoSchoolSource.sourceSha256,
                    schoolMappings: [
                        {
                            sourceSchoolId: twoSchoolSource.schools[0].sourceSchoolId,
                            domainId: 'system',
                            schoolId: schoolId.toHexString(),
                        },
                        {
                            sourceSchoolId: twoSchoolSource.schools[1].sourceSchoolId,
                            domainId: 'other',
                            schoolId: new ObjectId().toHexString(),
                        },
                    ],
                }),
                twoSchoolSource,
            ),
        ).to.throw(ClassSigninClassroomMigrationError, 'exactly one domain');
    });

    it('rejects permission and post-plan school drift before creating indexes or writing classrooms', async () => {
        const source = validateClassSigninExport(sourceExport(null));
        const schoolId = new ObjectId('64a000000000000000000001');
        const manifest = validateClassSigninManifest(
            JSON.stringify({
                schemaVersion: 1,
                sourceSystem: 'ClassSigninSystem',
                sourceSha256: source.sourceSha256,
                schoolMappings: [{ sourceSchoolId: source.schools[0].sourceSchoolId, domainId: 'system', schoolId: schoolId.toHexString() }],
            }),
            source,
        );
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
        repository.authorizedActor = 99;
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_PERMISSION_DENIED',
        );
        expect(repository.indexesEnsured).to.equal(0);

        repository.authorizedActor = 2;
        repository.snapshot.schools[0].name = '已漂移';
        await rejectCode(
            applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
            }),
            'CLASSSIGNIN_CLASSROOM_DATABASE_DRIFT',
        );
        expect(repository.indexesEnsured).to.equal(0);
        expect(repository.snapshot.classrooms).to.have.length(0);
    });

    it('exercises Mongo uniqueness, document CAS, monotonic batch CAS, strict references, and raw authorization', { timeout: 60_000 }, async () => {
        const server = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
        const client = await MongoClient.connect(server.getUri());
        try {
            const database = client.db('p21-adapter');
            const schoolId = new ObjectId('64a000000000000000000001');
            await database.collection('userbind.schools').insertOne({ _id: schoolId, domainId: 'system', name: '中国民航大学' });
            const repository = new MongoClassSigninClassroomMigrationRepository(database, {}, async () => true);
            const source = validateClassSigninExport(
                sourceExport(JSON.stringify([{ id: 'seat-1', label: '001', x: 10, y: 20, rotation: 0, status: 'empty', type: 'seat' }])),
            );
            const manifest = manifestForSource(source, schoolId);
            const plan = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot());
            await applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                now: new Date('2026-08-11T10:00:00.000Z'),
            });
            await applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor: 2,
                fingerprint: plan.fingerprint,
                confirmationToken: plan.confirmationToken,
                now: new Date('2026-08-11T10:00:00.000Z'),
            });
            await verifyClassSigninClassroomMigration(plan, source, manifest, repository, new Date('2026-08-11T10:00:01.000Z'));

            const classroomCollection = database.collection<ExamClassroomDoc>('exam.classrooms');
            const classroom = (await classroomCollection.findOne({}))!;
            const historicalBindingId = new ObjectId();
            const pairingWindowId = new ObjectId();
            await database.collection('exam.endpointSeatBindings').insertOne({
                _id: historicalBindingId,
                domainId: 'system',
                schoolId,
                classroomId: classroom._id,
                sourceSeatId: 'seat-1',
                status: 'unbound',
                revision: 2,
                history: [
                    {
                        revision: 1,
                        action: 'bind',
                        endpointId: 'ep_historical_123456',
                        requestId: 'endpoint_historical_bind_001',
                        actorUid: 7,
                        at: new Date('2026-08-11T10:00:02.000Z'),
                        pairingWindowId,
                    },
                    {
                        revision: 2,
                        action: 'unbind',
                        previousEndpointId: 'ep_historical_123456',
                        requestId: 'admin_historical_unbind_001',
                        actorUid: 7,
                        at: new Date('2026-08-11T10:00:03.000Z'),
                        referenceFingerprint: 'a'.repeat(64),
                    },
                ],
                createdBy: 7,
                createdAt: new Date('2026-08-11T10:00:02.000Z'),
                updatedBy: 7,
                updatedAt: new Date('2026-08-11T10:00:03.000Z'),
            });
            const withoutSeat = validateClassSigninExport(sourceExport(JSON.stringify([])));
            const withoutSeatPlan = buildClassSigninClassroomMigrationPlan(
                withoutSeat,
                manifestForSource(withoutSeat, schoolId),
                await repository.loadSnapshot(),
            );
            expect(withoutSeatPlan.entries[0].action).to.equal('conflict');
            expect(withoutSeatPlan.entries[0].conflicts).to.deep.equal(['referenced_seat_removed:seat-1']);
            await database.collection('exam.endpointSeatBindings').deleteOne({ _id: historicalBindingId });

            const retainedWindowId = new ObjectId();
            const retainedWindowDocumentId = `endpoint-seat:${retainedWindowId.toHexString()}`;
            const pairingWindowCollection = database.collection<EndpointSeatPairingWindowDoc>('exam.endpointSeatPairingWindows');
            await pairingWindowCollection.insertOne({
                _id: retainedWindowDocumentId,
                windowId: retainedWindowId,
                domainId: 'system',
                schoolId,
                classroomId: classroom._id,
                status: 'closed',
                revision: 2,
                requestId: 'admin_historical_window_001',
                expiresAt: new Date('2026-08-11T10:01:02.000Z'),
                entries: [
                    {
                        sourceSeatId: 'seat-1',
                        mode: 'bind',
                        status: 'open',
                        revision: 1,
                        codeDigest: 'b'.repeat(64),
                        codeHint: 'AA',
                        expectedBindingRevision: 0,
                    },
                ],
                createdBy: 7,
                createdAt: new Date('2026-08-11T10:00:02.000Z'),
                updatedActor: { kind: 'user', uid: 7 },
                updatedAt: new Date('2026-08-11T10:00:32.000Z'),
                closedBy: 7,
                closedAt: new Date('2026-08-11T10:00:32.000Z'),
                closedRequestId: 'admin_historical_close_001',
            });
            const retainedWindowPlan = buildClassSigninClassroomMigrationPlan(
                withoutSeat,
                manifestForSource(withoutSeat, schoolId),
                await repository.loadSnapshot(),
            );
            expect(retainedWindowPlan.entries[0].action).to.equal('conflict');
            expect(retainedWindowPlan.entries[0].conflicts).to.deep.equal(['referenced_seat_removed:seat-1']);
            await pairingWindowCollection.deleteOne({ _id: retainedWindowDocumentId });

            const historicalV2SeatPlanId = new ObjectId();
            const historicalV2AssignmentId = new ObjectId();
            await database.collection('exam.seatPlans').insertOne({
                _id: historicalV2SeatPlanId,
                schemaVersion: 2,
                domainId: 'system',
                revision: 2,
                classrooms: [{ classroomId: classroom._id, candidateSeatIds: ['seat-1'] }],
            });
            await database.collection('exam.seatAssignments').insertOne({
                _id: historicalV2AssignmentId,
                schemaVersion: 2,
                domainId: 'system',
                revision: 2,
                assignments: [{ boundUserId: 101, seat: { classroomId: classroom._id, sourceSeatId: 'seat-1' } }],
            });
            const retainedV2Plan = buildClassSigninClassroomMigrationPlan(
                withoutSeat,
                manifestForSource(withoutSeat, schoolId),
                await repository.loadSnapshot(),
            );
            expect(retainedV2Plan.entries[0].action).to.equal('conflict');
            expect(retainedV2Plan.entries[0].conflicts).to.deep.equal(['referenced_seat_removed:seat-1']);
            await database.collection('exam.seatPlans').deleteOne({ _id: historicalV2SeatPlanId });
            await database.collection('exam.seatAssignments').deleteOne({ _id: historicalV2AssignmentId });

            const classroomService = new ExamClassroomService(classroomCollection);
            expect(await classroomService.list('system', schoolId).toArray()).to.have.length(1);
            expect(await classroomService.listDomain('system').toArray()).to.have.length(1);
            await classroomCollection.updateOne({ _id: classroom._id }, { $set: { 'layoutRevisions.0.snapshot.schema': 'malformed-layout-v1' } });
            await rejectCode(classroomService.list('system', schoolId).toArray(), 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            await rejectCode(classroomService.listDomain('system').toArray(), 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            await classroomCollection.replaceOne({ _id: classroom._id }, classroom);
            expect(await repository.writeClassroom(null, classroom)).to.equal('no-op');
            await rejectCode(repository.writeClassroom(null, { ...classroom, _id: new ObjectId() }), 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
            const replacement = {
                ...classroom,
                name: 'CAS target',
                revision: classroom.revision + 1,
                updatedAt: new Date('2026-08-11T10:01:00.000Z'),
            };
            expect(await repository.writeClassroom(classroom, replacement)).to.equal('applied');
            const persistedReplacement = (await database.collection<ExamClassroomDoc>('exam.classrooms').findOne({ _id: classroom._id }))!;
            const staleReplacement = {
                ...persistedReplacement,
                name: 'must not erase concurrent fields',
                revision: persistedReplacement.revision + 1,
                updatedAt: new Date('2026-08-11T10:02:00.000Z'),
            };
            await database.collection('exam.classrooms').updateOne({ _id: classroom._id }, { $set: { concurrentAddedField: true } });
            await rejectCode(repository.writeClassroom(persistedReplacement, staleReplacement), 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');

            const batch = (await repository.loadBatch(plan.batchId))!;
            await rejectCode(
                repository.saveBatch(
                    {
                        ...batch,
                        revision: batch.revision + 1,
                        state: 'failed',
                        updatedAt: new Date('2026-08-11T10:03:00.000Z'),
                        lastError: 'stale writer',
                    },
                    batch,
                ),
                'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT',
            );
            expect((await repository.loadBatch(plan.batchId))!.state).to.equal('applied');

            const applyingBatch: ClassSigninClassroomMigrationBatchDoc = {
                ...batch,
                _id: 'batch-added-field-race',
                planFingerprint: 'a'.repeat(64),
                revision: 1,
                state: 'applying',
                updatedAt: new Date('2026-08-11T10:04:00.000Z'),
                results: [],
            };
            delete applyingBatch.completedAt;
            delete applyingBatch.auditId;
            delete applyingBatch.lastError;
            await repository.saveBatch(applyingBatch, null);
            await database
                .collection<ClassSigninClassroomMigrationBatchDoc & { concurrentAddedField?: boolean }>('exam.classroomImportBatches')
                .updateOne({ _id: applyingBatch._id }, { $set: { concurrentAddedField: true } });
            await rejectCode(
                repository.saveBatch(
                    {
                        ...applyingBatch,
                        revision: 2,
                        updatedAt: new Date('2026-08-11T10:05:00.000Z'),
                    },
                    applyingBatch,
                ),
                'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT',
            );

            const malformedSeatPlanId = new ObjectId();
            await database.collection('exam.seatPlans').insertOne({
                _id: malformedSeatPlanId,
                domainId: 'system',
                classroomId: classroom._id,
                revision: 1,
                candidateSeatIds: {},
            });
            await rejectCode(repository.loadSnapshot(), 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            await database.collection('exam.seatPlans').deleteOne({ _id: malformedSeatPlanId });

            await database.collection('exam.targetAssignments').insertOne({
                _id: new ObjectId(),
                domainId: 'system',
                draft: { sources: {} },
                revisions: [],
            });
            await rejectCode(repository.loadSnapshot(), 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');

            await database.collection<{ _id: number; priv: number }>('user').insertMany([
                { _id: 10, priv: PRIV.PRIV_USER_PROFILE },
                { _id: 11, priv: PRIV.PRIV_EDIT_SYSTEM },
            ]);
            await database.collection<{ _id: string; lower: string; roles: Record<string, string> }>('domain').insertOne({
                _id: 'system',
                lower: 'system',
                roles: { exam: PERM.PERM_MANAGE_EXAM_INFRASTRUCTURE.toString() },
            });
            await database.collection('domain.user').insertOne({ domainId: 'system', uid: 10, join: true, role: 'exam' });
            const authorize = classSigninClassroomMigrationAdapterInternals.databaseActorAuthorizer(database, {});
            expect(await authorize(10, ['system'])).to.equal(true);
            expect(await authorize(11, ['missing-domain'])).to.equal(true);
            await database.collection('domain.user').updateOne({ domainId: 'system', uid: 10 }, { $set: { join: false } });
            expect(await authorize(10, ['system'])).to.equal(false);
        } finally {
            await client.close();
            await server.stop();
        }
    });

    it('enforces the one-time CLI stage, stopped-service, backup, and exact confirmation gates', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'classsignin-classroom-migration-'));
        temporaryDirectories.push(directory);
        const sourcePath = path.join(directory, 'source.json');
        const manifestPath = path.join(directory, 'manifest.json');
        const planPath = path.join(directory, 'plan.json');
        const sourceText = sourceExport(null);
        const source = validateClassSigninExport(sourceText);
        const schoolId = new ObjectId('64a000000000000000000001');
        await fs.writeFile(sourcePath, sourceText);
        await fs.writeFile(
            manifestPath,
            JSON.stringify({
                schemaVersion: 1,
                sourceSystem: 'ClassSigninSystem',
                sourceSha256: source.sourceSha256,
                schoolMappings: [{ sourceSchoolId: source.schools[0].sourceSchoolId, domainId: 'system', schoolId: schoolId.toHexString() }],
            }),
        );
        const repository = new FixtureRepository({
            schools: [{ _id: schoolId, domainId: 'system', name: '中国民航大学' }],
            classrooms: [],
            references: [],
        });
        const dependencies = { loadRepository: async () => repository };

        const validation = await runClassSigninClassroomMigrationCommand('validate', sourcePath, {}, dependencies);
        expect(validation).to.deep.include({ ok: true, stage: 'validate' });
        await rejectCode(
            runClassSigninClassroomMigrationCommand('plan', sourcePath, { manifest: manifestPath, plan: sourcePath }, dependencies),
            'CLASSSIGNIN_CLASSROOM_PLAN_PATH_COLLISION',
        );
        await rejectCode(
            runClassSigninClassroomMigrationCommand('plan', sourcePath, { manifest: manifestPath, plan: manifestPath }, dependencies),
            'CLASSSIGNIN_CLASSROOM_PLAN_PATH_COLLISION',
        );
        await runClassSigninClassroomMigrationCommand('plan', sourcePath, { manifest: manifestPath, plan: planPath }, dependencies);
        const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
        await rejectCode(
            runClassSigninClassroomMigrationCommand(
                'apply',
                sourcePath,
                {
                    manifest: manifestPath,
                    plan: planPath,
                    actor: '2',
                    fingerprint: plan.fingerprint,
                    confirm: plan.confirmationToken,
                    backupConfirmed: plan.fingerprint,
                },
                dependencies,
            ),
            'CLASSSIGNIN_CLASSROOM_SERVICE_RUNNING',
        );
        await rejectCode(
            runClassSigninClassroomMigrationCommand(
                'apply',
                sourcePath,
                {
                    manifest: manifestPath,
                    plan: planPath,
                    actor: '2',
                    fingerprint: plan.fingerprint,
                    confirm: plan.confirmationToken,
                    serviceStopped: true,
                },
                dependencies,
            ),
            'CLASSSIGNIN_CLASSROOM_BACKUP_REQUIRED',
        );
        await runClassSigninClassroomMigrationCommand(
            'apply',
            sourcePath,
            {
                manifest: manifestPath,
                plan: planPath,
                actor: '2',
                fingerprint: plan.fingerprint,
                confirm: plan.confirmationToken,
                backupConfirmed: plan.fingerprint,
                serviceStopped: true,
            },
            dependencies,
        );
        await runClassSigninClassroomMigrationCommand('verify', sourcePath, { manifest: manifestPath, plan: planPath }, dependencies);
        const verified = JSON.parse(await fs.readFile(planPath, 'utf8'));
        expect(verified.execution.state).to.equal('applied');
        expect(verified.verification.ok).to.equal(true);
    });
});
