import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

function cloneValue<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (value instanceof Date) return new Date(value) as T;
    if (Array.isArray(value)) return value.map(cloneValue) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
    }
    return value;
}

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

class MemoryCollection<T extends Record<string, unknown>> {
    docs: T[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async insertOne(doc: T) {
        if (
            this.docs.some(
                (current) =>
                    same(current.domainId, doc.domainId) &&
                    same(current.classroomId, doc.classroomId) &&
                    same(current.layoutRevision, doc.layoutRevision) &&
                    same(current.revision, doc.revision),
            )
        ) {
            throw Object.assign(new Error('duplicate profile revision'), { code: 11000 });
        }
        this.docs.push(cloneValue(doc));
        return { insertedId: doc._id };
    }

    async deleteMany(filter: Record<string, unknown>) {
        const before = this.docs.length;
        this.docs = this.docs.filter((doc) => !this.matches(doc, filter));
        return { deletedCount: before - this.docs.length };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => this.matches(doc, filter));
        return found ? cloneValue(found) : null;
    }

    find(filter: Record<string, unknown>) {
        let rows = this.docs.filter((doc) => this.matches(doc, filter));
        const cursor = {
            sort: (spec: Record<string, number>) => {
                const entries = Object.entries(spec);
                rows = [...rows].sort((left, right) => {
                    for (const [field, direction] of entries) {
                        const leftValue = left[field];
                        const rightValue = right[field];
                        if (same(leftValue, rightValue)) continue;
                        return (String(leftValue) < String(rightValue) ? -1 : 1) * direction;
                    }
                    return 0;
                });
                return cursor;
            },
            limit: (count: number) => {
                rows = rows.slice(0, count);
                return cursor;
            },
            toArray: async () => rows.map(cloneValue),
        };
        return cursor;
    }

    private matches(doc: T, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => same(doc[field], expected));
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => new MemoryCollection<Record<string, unknown>>() } },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const moduleUnderTest = require('../src/model/exam-seat-operational-profile.ts') as typeof import('../src/model/exam-seat-operational-profile');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const schoolId = new ObjectId('66bf00000000000000000001');
const classroomId = new ObjectId('66bf00000000000000000002');

function classroom(layoutRevision: number, sourceSeatIds: string[], fingerprintCharacter = 'a', classroomSchoolId = schoolId) {
    return {
        domainId: 'system',
        schoolId: classroomSchoolId,
        classroomId,
        layoutRevision,
        layoutFingerprint: fingerprintCharacter.repeat(64),
        sourceSeatIds,
    };
}

function defaultEntry(sourceSeatId: string) {
    return { sourceSeatId, enabled: true, facing: 'unset' as const, disabledReason: null, note: null };
}

async function reason(work: Promise<unknown>): Promise<string | null> {
    try {
        await work;
        return null;
    } catch (error) {
        return (error as { reason?: string }).reason || null;
    }
}

describe('P2.10 immutable classroom seat operational profiles', () => {
    function fixture(initial = classroom(3, ['seat-1', 'seat-2'])) {
        const profiles = new MemoryCollection<Record<string, unknown>>();
        let current: ReturnType<typeof classroom> | null = initial;
        let domainExists = true;
        const layouts = new Map<number, ReturnType<typeof classroom>>([[initial.layoutRevision, initial]]);
        let sequence = 0x100;
        const service = new moduleUnderTest.ExamSeatOperationalProfileService({
            profiles: profiles as never,
            domainExists: async () => domainExists,
            loadClassroom: async (domainId, targetClassroomId, layoutRevision) => {
                if (!current || current.domainId !== domainId || !current.classroomId.equals(targetClassroomId)) return null;
                const target = layoutRevision === undefined ? current : layouts.get(layoutRevision) || null;
                if (layoutRevision !== undefined && !target) {
                    throw new moduleUnderTest.ExamSeatOperationalProfileError('seat_profile_layout_not_found');
                }
                return target ? cloneValue(target) : null;
            },
            now: () => new Date('2026-08-15T10:00:00.000Z'),
            idFactory: () => new ObjectId(`66bf0000000000000000${(sequence++).toString(16).padStart(4, '0')}`),
        });
        return {
            profiles,
            service,
            setDomainExists: (value: boolean) => (domainExists = value),
            setClassroom: (value: ReturnType<typeof classroom> | null) => {
                current = value;
                if (value) layouts.set(value.layoutRevision, value);
            },
        };
    }

    it('derives empty, one-seat, and 500-seat defaults without persisting or interpreting visual rotation', async () => {
        for (const count of [0, 1, 500]) {
            const ids = Array.from({ length: count }, (_, index) => `seat-${index.toString().padStart(3, '0')}`);
            const { profiles, service } = fixture(classroom(7, ids));
            const profile = await service.getCurrent('system', classroomId);
            expect(profile.revision).to.equal(0);
            expect(profile.persisted).to.equal(false);
            expect(profile.entries).to.deep.equal(ids.map(defaultEntry));
            expect(profile.fingerprint).to.match(/^[a-f0-9]{64}$/);
            expect(profiles.docs).to.have.length(0);
        }
    });

    it('writes complete normalized revisions, preserves old revisions, and records disable/restore actors', async () => {
        const { service } = fixture();
        const first = await service.replaceCurrent({
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
            entries: [
                defaultEntry('seat-1'),
                {
                    sourceSeatId: 'seat-2',
                    enabled: false,
                    facing: 'left',
                    disabledReason: 'computer_failure',
                    note: '无法开机',
                },
            ],
        });
        expect(first.revision).to.equal(1);
        expect(first.previousRevision).to.equal(null);
        expect(first.createdBy).to.equal(2);

        const second = await service.replaceCurrent({
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 1,
            actorUid: 3,
            entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'right' }],
        });
        const historical = await service.getRevision('system', classroomId, 3, 1);
        expect(second.revision).to.equal(2);
        expect(second.previousRevision).to.equal(1);
        expect(second.createdBy).to.equal(3);
        expect(historical?.entries[1]).to.include({ enabled: false, disabledReason: 'computer_failure', note: '无法开机' });
        expect(second.entries[1]).to.deep.equal({ ...defaultEntry('seat-2'), facing: 'right' });
    });

    it('fails one concurrent writer by exact layout-scoped revision CAS', async () => {
        const { service } = fixture();
        const input = {
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
            entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'up' as const }],
        };
        const results = await Promise.allSettled([service.replaceCurrent(input), service.replaceCurrent({ ...input, actorUid: 3 })]);
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        expect((rejected?.reason as { reason?: string }).reason).to.equal('seat_profile_revision_conflict');
    });

    it('starts a new layout at explicit defaults while keeping the old layout revision readable', async () => {
        const { service, setClassroom } = fixture();
        await service.replaceCurrent({
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
            entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'down' }],
        });
        setClassroom(classroom(4, ['seat-2', 'seat-3'], 'b'));

        expect(
            await reason(
                service.replaceCurrent({
                    domainId: 'system',
                    classroomId,
                    layoutRevision: 3,
                    layoutFingerprint: 'a'.repeat(64),
                    expectedRevision: 1,
                    actorUid: 2,
                    entries: [defaultEntry('seat-1'), defaultEntry('seat-2')],
                }),
            ),
        ).to.equal('seat_profile_layout_changed');
        const current = await service.getCurrent('system', classroomId);
        const historical = await service.getRevision('system', classroomId, 3, 1);
        expect(current).to.include({ layoutRevision: 4, revision: 0, persisted: false });
        expect(current.entries).to.deep.equal([defaultEntry('seat-2'), defaultEntry('seat-3')]);
        expect(historical?.entries[1].facing).to.equal('down');
    });

    it('rejects incomplete seat sets, inconsistent disable facts, no-op revisions, and deleted classrooms', async () => {
        const { service, setClassroom, setDomainExists } = fixture();
        const base = {
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
        };
        expect(await reason(service.replaceCurrent({ ...base, entries: [defaultEntry('seat-1')] }))).to.equal('seat_profile_seat_set_invalid');
        expect(
            await reason(
                service.replaceCurrent({
                    ...base,
                    entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), enabled: false }],
                }),
            ),
        ).to.equal('seat_profile_entry_invalid');
        expect(
            await reason(
                service.replaceCurrent({
                    ...base,
                    entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: ['up'] }],
                }),
            ),
        ).to.equal('seat_profile_entry_invalid');
        expect(
            await reason(
                service.replaceCurrent({
                    ...base,
                    entries: [
                        defaultEntry('seat-1'),
                        {
                            ...defaultEntry('seat-2'),
                            enabled: false,
                            facing: {},
                            disabledReason: 'computer_failure',
                        },
                    ],
                }),
            ),
        ).to.equal('seat_profile_entry_invalid');
        expect(
            await reason(
                service.replaceCurrent({
                    ...base,
                    entries: [
                        defaultEntry('seat-1'),
                        {
                            ...defaultEntry('seat-2'),
                            enabled: false,
                            facing: 'up',
                            disabledReason: ['computer_failure'],
                        },
                    ],
                }),
            ),
        ).to.equal('seat_profile_entry_invalid');
        expect(await reason(service.replaceCurrent({ ...base, entries: [defaultEntry('seat-1'), defaultEntry('seat-2')] }))).to.equal(
            'seat_profile_unchanged',
        );
        setClassroom(null);
        expect(await reason(service.getCurrent('system', classroomId))).to.equal('seat_profile_classroom_not_found');
        setClassroom(classroom(3, ['seat-1', 'seat-2']));
        setDomainExists(false);
        expect(await reason(service.getCurrent('system', classroomId))).to.equal('seat_profile_domain_not_found');
        expect(
            await reason(service.replaceCurrent({ ...base, entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'up' }] })),
        ).to.equal('seat_profile_domain_not_found');
    });

    it('deletes only the requested domain facts and fails closed on corrupted stored canonical', async () => {
        const { profiles, service } = fixture();
        const saved = await service.replaceCurrent({
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
            entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'left' }],
        });
        const corrupted = cloneValue(saved) as unknown as Record<string, unknown>;
        (corrupted.entries as Array<Record<string, unknown>>)[0].disabledReason = 'computer_failure';
        expect(() => moduleUnderTest.assertExamSeatOperationalProfileIntegrity(corrupted)).to.throw(
            moduleUnderTest.ExamSeatOperationalProfileError,
            'seat_profile_entry_invalid',
        );
        profiles.docs.push({ ...cloneValue(saved), _id: new ObjectId(), domainId: 'another-domain' } as unknown as Record<string, unknown>);
        await service.deleteDomain('system');
        expect(profiles.docs.map((profile) => profile.domainId)).to.deep.equal(['another-domain']);
    });

    it('revalidates self-consistent historical and latest profiles against the referenced classroom layout', async () => {
        const foreignSchoolId = new ObjectId('66bf00000000000000000009');
        const { service, setClassroom } = fixture(classroom(3, ['seat-1', 'seat-2'], 'a', foreignSchoolId));
        await service.replaceCurrent({
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
            entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'left' }],
        });

        setClassroom(classroom(3, ['seat-1', 'seat-2']));
        expect(await reason(service.getRevision('system', classroomId, 3, 1))).to.equal('seat_profile_classroom_drift');
        expect(await reason(service.getRevision('system', classroomId, 2, 0))).to.equal('seat_profile_layout_not_found');
        expect(
            await reason(
                service.replaceCurrent({
                    domainId: 'system',
                    classroomId,
                    layoutRevision: 3,
                    layoutFingerprint: 'a'.repeat(64),
                    expectedRevision: 1,
                    actorUid: 3,
                    entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'right' }],
                }),
            ),
        ).to.equal('seat_profile_classroom_drift');

        setClassroom(classroom(3, ['seat-1', 'seat-3'], 'a', foreignSchoolId));
        expect(await reason(service.getRevision('system', classroomId, 3, 1))).to.equal('seat_profile_classroom_drift');
        setClassroom(classroom(3, ['seat-1', 'seat-2'], 'b', foreignSchoolId));
        expect(await reason(service.getRevision('system', classroomId, 3, 1))).to.equal('seat_profile_classroom_drift');
    });

    it('rejects a stored entry array whose order is not canonical even when its fingerprint is unchanged', async () => {
        const { service } = fixture();
        const saved = await service.replaceCurrent({
            domainId: 'system',
            classroomId,
            layoutRevision: 3,
            layoutFingerprint: 'a'.repeat(64),
            expectedRevision: 0,
            actorUid: 2,
            entries: [defaultEntry('seat-1'), { ...defaultEntry('seat-2'), facing: 'left' }],
        });
        const reordered = cloneValue(saved);
        reordered.entries.reverse();
        expect(() => moduleUnderTest.assertExamSeatOperationalProfileIntegrity(reordered)).to.throw(
            moduleUnderTest.ExamSeatOperationalProfileError,
            'seat_profile_entries_not_canonical',
        );
    });
});
