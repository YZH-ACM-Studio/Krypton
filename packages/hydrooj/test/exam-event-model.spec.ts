import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamEventDoc, ExamEventError as ExamEventErrorType } from '../src/model/exam-event';

function same(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    if (left instanceof Date || right instanceof Date) return Number(left) === Number(right);
    return left === right;
}

function clone(doc: ExamEventDoc): ExamEventDoc {
    return {
        ...doc,
        _id: new ObjectId(doc._id),
        schoolId: new ObjectId(doc.schoolId),
        ...(doc.contestId ? { contestId: new ObjectId(doc.contestId) } : {}),
        startAt: new Date(doc.startAt),
        endAt: new Date(doc.endAt),
        createdAt: new Date(doc.createdAt),
        updatedAt: new Date(doc.updatedAt),
        ...(doc.archivedAt ? { archivedAt: new Date(doc.archivedAt) } : {}),
        collaboratorUids: [...doc.collaboratorUids],
    };
}

class MemoryCollection {
    docs: ExamEventDoc[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async insertOne(doc: ExamEventDoc) {
        this.docs.push(clone(doc));
        return { insertedId: doc._id };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => this.matches(doc, filter));
        return found ? clone(found) : null;
    }

    find(filter: Record<string, unknown>) {
        const rows = this.docs.filter((doc) => this.matches(doc, filter));
        return {
            sort: () => ({
                limit: (count: number) => ({ toArray: async () => rows.slice(0, count).map(clone) }),
            }),
        };
    }

    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) return null;
        const next = clone(this.docs[index]);
        Object.assign(next, (update.$set as Record<string, unknown> | undefined) || {});
        for (const field of Object.keys((update.$unset as Record<string, unknown> | undefined) || {})) {
            delete (next as unknown as Record<string, unknown>)[field];
        }
        this.docs[index] = next;
        return clone(next);
    }

    private matches(doc: ExamEventDoc, filter: Record<string, unknown>) {
        return Object.entries(filter).every(([field, expected]) => {
            if (field === '$or') {
                return Array.isArray(expected) && expected.some((candidate) => this.matches(doc, candidate as Record<string, unknown>));
            }
            const actual = (doc as unknown as Record<string, unknown>)[field];
            if (
                expected &&
                typeof expected === 'object' &&
                !Array.isArray(expected) &&
                !(expected instanceof ObjectId) &&
                !(expected instanceof Date)
            ) {
                const operators = expected as Record<string, unknown>;
                if ('$ne' in operators && same(actual, operators.$ne)) return false;
                if ('$gt' in operators && (!(actual instanceof Date) || !(operators.$gt instanceof Date) || actual <= operators.$gt)) return false;
                if ('$in' in operators && (!Array.isArray(operators.$in) || !operators.$in.some((value) => same(value, actual)))) return false;
                return true;
            }
            return same(actual, expected);
        });
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
const productionCollection = new MemoryCollection();
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => productionCollection } },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const eventModule = require('../src/model/exam-event.ts') as typeof import('../src/model/exam-event');
const requestModule = require('../src/model/exam-event-request.ts') as typeof import('../src/model/exam-event-request');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const { ExamEventError, ExamEventService, examEventDisplayStatus } = eventModule;

function fixture() {
    const events = new MemoryCollection();
    let now = new Date('2026-08-10T10:00:00.000Z');
    let sequence = 0x101;
    const service = new ExamEventService(
        events as never,
        () => new Date(now),
        () => new ObjectId(`66b800000000000000${(sequence++).toString(16).padStart(6, '0')}`),
    );
    return { events, service, setNow: (value: string) => (now = new Date(value)) };
}

async function reason(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        expect(error).to.be.instanceOf(ExamEventError);
        return (error as ExamEventErrorType).reason;
    }
}

function createInput() {
    return {
        domainId: 'system',
        schoolId: new ObjectId('66b800000000000000000201'),
        title: 'CSP 认证考试',
        type: 'external' as const,
        startAt: new Date('2026-08-10T12:00:00.000Z'),
        endAt: new Date('2026-08-10T14:00:00.000Z'),
        ownerUid: 2,
        collaboratorUids: [4, 3, 4, 2],
    };
}

describe('ExamEvent canonical model', () => {
    it('creates a school-scoped draft with deterministic audit identity and exact indexes', async () => {
        const { events, service } = fixture();
        await service.ensureIndexes();
        expect(events.indexes.map((entry) => entry.options.name)).to.deep.equal([
            'examEventDomainLifecycle',
            'examEventSchoolLifecycle',
            'examEventOwner',
            'examEventCollaborator',
            'examEventContest',
        ]);
        expect(events.indexes.at(-1)?.options).to.deep.equal({
            name: 'examEventContest',
        });
        expect(events.indexes.at(-1)?.key).to.deep.equal({ domainId: 1, contestId: 1, updatedAt: -1 });

        const event = await service.create(createInput());
        expect(event).to.include({ lifecycle: 'draft', revision: 1, auditRef: `exam-event:${event._id}:1` });
        expect(event.collaboratorUids).to.deep.equal([3, 4]);
        expect(examEventDisplayStatus(event)).to.equal('draft');
    });

    it('accepts root as an actor and does not invent a one-event-per-Contest rule', async () => {
        const { service } = fixture();
        const contestId = new ObjectId('66b800000000000000000211');
        const first = await service.create({ ...createInput(), ownerUid: 1, type: 'krypton', contestId });
        const second = await service.create({
            ...createInput(),
            ownerUid: 1,
            schoolId: new ObjectId('66b800000000000000000202'),
            type: 'krypton',
            contestId,
        });
        expect(first.ownerUid).to.equal(1);
        expect(second.contestId?.equals(contestId)).to.equal(true);
    });

    it('filters owner/collaborator in Mongo before applying the list limit', async () => {
        const { service } = fixture();
        for (let index = 0; index < 201; index++) {
            await service.create({ ...createInput(), ownerUid: 99, title: `Other ${index}`, collaboratorUids: [] });
        }
        const own = await service.create({ ...createInput(), title: 'Own old event', collaboratorUids: [] });
        const rows = await service.list('system', [createInput().schoolId], 200, 2).toArray();
        expect(rows.map((event) => event._id.toHexString())).to.deep.equal([own._id.toHexString()]);
    });

    it('filters a Contest association in Mongo instead of relying on a capped recent-event page', async () => {
        const { service } = fixture();
        const wantedContestId = new ObjectId('66b800000000000000000212');
        const otherContestId = new ObjectId('66b800000000000000000213');
        const wanted = await service.create({ ...createInput(), type: 'krypton', contestId: wantedContestId });
        await service.create({ ...createInput(), type: 'krypton', contestId: otherContestId });

        const rows = await service.list('system', undefined, 500, undefined, wantedContestId).toArray();

        expect(rows.map((event) => event._id.toHexString())).to.deep.equal([wanted._id.toHexString()]);
    });

    it('preserves update field presence, including explicit Contest clearing, and rejects empty patches', () => {
        const clear = requestModule.parseExamEventUpdatePatch({ contestId: null, type: 'external', collaboratorUids: [] });
        expect(clear.requestedFields).to.deep.equal(['type', 'contestId', 'collaboratorUids']);
        expect(clear.contestId).to.equal(null);
        expect(clear.collaboratorUids).to.deep.equal([]);
        for (const invalid of [{}, { title: '' }, { startAt: '' }, { contestId: false }]) {
            expect(() => requestModule.parseExamEventUpdatePatch(invalid)).to.throw(ExamEventError);
        }
    });

    it('uses the same 120-character canonical title boundary for create and update', async () => {
        const { service } = fixture();
        const longTitle = '长'.repeat(100);
        const created = await service.create({ ...createInput(), title: longTitle });
        expect(created.title).to.equal(longTitle);
        expect(await reason(() => service.create({ ...createInput(), title: '长'.repeat(121) }))).to.equal('invalid_title');
        const updated = await service.update({
            domainId: 'system',
            eventId: created._id,
            expectedRevision: 1,
            actorUid: 2,
            title: '改'.repeat(120),
        });
        expect(updated.title).to.equal('改'.repeat(120));
    });

    it('schedules only a complete future event and derives active/ended without background writes', async () => {
        const { service, setNow } = fixture();
        const external = await service.create(createInput());
        const scheduled = await service.schedule('system', external._id, 1, 2);
        expect(scheduled).to.include({ lifecycle: 'scheduled', revision: 2 });
        expect(examEventDisplayStatus(scheduled, new Date('2026-08-10T13:00:00.000Z'))).to.equal('active');
        expect(examEventDisplayStatus(scheduled, new Date('2026-08-10T14:00:00.000Z'))).to.equal('ended');

        const krypton = await service.create({ ...createInput(), type: 'krypton' });
        expect(await reason(() => service.schedule('system', krypton._id, 1, 2))).to.equal('contest_required');
        setNow('2026-08-10T12:00:00.000Z');
        expect(await reason(() => service.schedule('system', krypton._id, 1, 2))).to.equal('start_not_future');
    });

    it('uses CAS, freezes critical scope after start, and keeps title edits available', async () => {
        const { service, setNow } = fixture();
        const created = await service.create(createInput());
        const scheduled = await service.schedule('system', created._id, 1, 2);
        setNow('2026-08-10T12:30:00.000Z');
        expect(
            await reason(() =>
                service.update({
                    domainId: 'system',
                    eventId: created._id,
                    expectedRevision: scheduled.revision,
                    actorUid: 2,
                    schoolId: new ObjectId('66b800000000000000000202'),
                }),
            ),
        ).to.equal('started');
        const renamed = await service.update({
            domainId: 'system',
            eventId: created._id,
            expectedRevision: scheduled.revision,
            actorUid: 2,
            title: 'CSP 考试（改名）',
        });
        expect(renamed).to.include({ title: 'CSP 考试（改名）', revision: 3 });
        expect(
            await reason(() => service.update({ domainId: 'system', eventId: created._id, expectedRevision: 2, actorUid: 2, title: '旧写入' })),
        ).to.equal('revision_conflict');
    });

    it('never permits a scheduled Krypton event to lose its Contest association', async () => {
        const { service } = fixture();
        const contestId = new ObjectId('66b800000000000000000212');
        const krypton = await service.create({ ...createInput(), type: 'krypton', contestId });
        await service.schedule('system', krypton._id, 1, 2);
        expect(
            await reason(() => service.update({ domainId: 'system', eventId: krypton._id, expectedRevision: 2, actorUid: 2, contestId: null })),
        ).to.equal('contest_required');

        const external = await service.create(createInput());
        await service.schedule('system', external._id, 1, 2);
        expect(
            await reason(() => service.update({ domainId: 'system', eventId: external._id, expectedRevision: 2, actorUid: 2, type: 'krypton' })),
        ).to.equal('contest_required');
    });

    it('archives with CAS and rejects later mutation', async () => {
        const { service } = fixture();
        const created = await service.create(createInput());
        const archived = await service.archive('system', created._id, 1, 2);
        expect(archived).to.include({ lifecycle: 'archived', revision: 2, archivedBy: 2 });
        expect(examEventDisplayStatus(archived)).to.equal('archived');
        expect(
            await reason(() => service.update({ domainId: 'system', eventId: created._id, expectedRevision: 2, actorUid: 2, title: '不可改' })),
        ).to.equal('archived');
    });
});
