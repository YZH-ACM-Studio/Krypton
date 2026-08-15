import { Collection, Filter, ObjectId } from 'mongodb';
import db from '../service/db';

export type ExamEventType = 'krypton' | 'external';
export type ExamEventLifecycle = 'draft' | 'scheduled' | 'archived';
export type ExamEventDisplayStatus = 'draft' | 'scheduled' | 'active' | 'ended' | 'archived';

export interface ExamEventDoc {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    title: string;
    type: ExamEventType;
    contestId?: ObjectId;
    lifecycle: ExamEventLifecycle;
    startAt: Date;
    endAt: Date;
    ownerUid: number;
    collaboratorUids: number[];
    revision: number;
    auditRef: string;
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    updatedBy: number;
    archivedAt?: Date;
    archivedBy?: number;
}

type ExamEventCollection = Pick<Collection<ExamEventDoc>, 'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'findOneAndUpdate' | 'insertOne'>;

export interface CreateExamEventInput {
    eventId?: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    title: string;
    type: ExamEventType;
    contestId?: ObjectId;
    startAt: Date;
    endAt: Date;
    ownerUid: number;
    collaboratorUids?: number[];
}

export interface UpdateExamEventInput {
    domainId: string;
    eventId: ObjectId;
    expectedRevision: number;
    actorUid: number;
    title?: string;
    schoolId?: ObjectId;
    type?: ExamEventType;
    contestId?: ObjectId | null;
    startAt?: Date;
    endAt?: Date;
    collaboratorUids?: number[];
}

export class ExamEventError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamEventError';
    }
}

function assertDomainId(domainId: string): void {
    if (!domainId || domainId.length > 64) throw new TypeError('domainId is invalid');
}

function assertUid(uid: number, field: string): void {
    if (!Number.isSafeInteger(uid) || uid < 1) throw new TypeError(`${field} is invalid`);
}

function canonicalTitle(value: string): string {
    const title = value.trim();
    if (!title || title.length > 120) throw new ExamEventError('invalid_title');
    return title;
}

function canonicalType(value: ExamEventType): ExamEventType {
    if (value !== 'krypton' && value !== 'external') throw new ExamEventError('invalid_type');
    return value;
}

function canonicalDate(value: Date, field: string): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ExamEventError(`invalid_${field}`);
    return new Date(value);
}

function canonicalWindow(startAtValue: Date, endAtValue: Date): { startAt: Date; endAt: Date } {
    const startAt = canonicalDate(startAtValue, 'start_at');
    const endAt = canonicalDate(endAtValue, 'end_at');
    if (startAt >= endAt) throw new ExamEventError('invalid_time_window');
    return { startAt, endAt };
}

export function canonicalCollaboratorUids(ownerUid: number, values: number[] = []): number[] {
    assertUid(ownerUid, 'ownerUid');
    if (!Array.isArray(values) || values.length > 50) throw new ExamEventError('invalid_collaborators');
    const result = Array.from(new Set(values));
    if (result.some((uid) => !Number.isSafeInteger(uid) || uid < 1)) throw new ExamEventError('invalid_collaborators');
    return result.filter((uid) => uid !== ownerUid).sort((a, b) => a - b);
}

export function examEventAuditRef(eventId: ObjectId, revision: number): string {
    return `exam-event:${eventId.toHexString()}:${revision}`;
}

function isCriticalPatch(input: UpdateExamEventInput): boolean {
    return (
        input.schoolId !== undefined ||
        input.type !== undefined ||
        input.contestId !== undefined ||
        input.startAt !== undefined ||
        input.endAt !== undefined
    );
}

export function examEventDisplayStatus(event: ExamEventDoc, now = new Date()): ExamEventDisplayStatus {
    if (event.lifecycle === 'archived') return 'archived';
    if (event.lifecycle === 'draft') return 'draft';
    if (now < event.startAt) return 'scheduled';
    if (now < event.endAt) return 'active';
    return 'ended';
}

export class ExamEventService {
    private indexesPromise?: Promise<void>;

    constructor(
        private readonly events: ExamEventCollection,
        private readonly now: () => Date = () => new Date(),
        private readonly idFactory: () => ObjectId = () => new ObjectId(),
    ) {}

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.events.createIndex({ domainId: 1, lifecycle: 1, startAt: -1 }, { name: 'examEventDomainLifecycle' }),
            this.events.createIndex({ domainId: 1, schoolId: 1, lifecycle: 1, startAt: -1 }, { name: 'examEventSchoolLifecycle' }),
            this.events.createIndex({ domainId: 1, ownerUid: 1, updatedAt: -1 }, { name: 'examEventOwner' }),
            this.events.createIndex({ domainId: 1, collaboratorUids: 1, updatedAt: -1 }, { name: 'examEventCollaborator' }),
            this.events.createIndex({ domainId: 1, contestId: 1, updatedAt: -1 }, { name: 'examEventContest' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    async create(input: CreateExamEventInput): Promise<ExamEventDoc> {
        assertDomainId(input.domainId);
        if (!(input.schoolId instanceof ObjectId)) throw new TypeError('schoolId must be an ObjectId');
        assertUid(input.ownerUid, 'ownerUid');
        const type = canonicalType(input.type);
        if (input.contestId !== undefined && !(input.contestId instanceof ObjectId)) throw new TypeError('contestId must be an ObjectId');
        if (type === 'external' && input.contestId) throw new ExamEventError('external_contest_forbidden');
        const { startAt, endAt } = canonicalWindow(input.startAt, input.endAt);
        const now = this.now();
        if (input.eventId !== undefined && !(input.eventId instanceof ObjectId)) throw new TypeError('eventId must be an ObjectId');
        const _id = input.eventId ? new ObjectId(input.eventId) : this.idFactory();
        const event: ExamEventDoc = {
            _id,
            domainId: input.domainId,
            schoolId: new ObjectId(input.schoolId),
            title: canonicalTitle(input.title),
            type,
            ...(input.contestId ? { contestId: new ObjectId(input.contestId) } : {}),
            lifecycle: 'draft',
            startAt,
            endAt,
            ownerUid: input.ownerUid,
            collaboratorUids: canonicalCollaboratorUids(input.ownerUid, input.collaboratorUids),
            revision: 1,
            auditRef: examEventAuditRef(_id, 1),
            createdAt: now,
            createdBy: input.ownerUid,
            updatedAt: now,
            updatedBy: input.ownerUid,
        };
        await this.events.insertOne(event);
        return event;
    }

    async get(domainId: string, eventId: ObjectId): Promise<ExamEventDoc | null> {
        assertDomainId(domainId);
        if (!(eventId instanceof ObjectId)) throw new TypeError('eventId must be an ObjectId');
        return this.events.findOne({ domainId, _id: eventId });
    }

    list(domainId: string, schoolIds?: ObjectId[], limit = 200, actorUid?: number, contestId?: ObjectId) {
        assertDomainId(domainId);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError('limit is invalid');
        if (schoolIds && schoolIds.some((schoolId) => !(schoolId instanceof ObjectId))) throw new TypeError('schoolIds are invalid');
        if (actorUid !== undefined) assertUid(actorUid, 'actorUid');
        if (contestId !== undefined && !(contestId instanceof ObjectId)) throw new TypeError('contestId is invalid');
        const filter: Filter<ExamEventDoc> = {
            domainId,
            ...(schoolIds ? { schoolId: { $in: schoolIds } } : {}),
            ...(actorUid !== undefined ? { $or: [{ ownerUid: actorUid }, { collaboratorUids: actorUid }] } : {}),
            ...(contestId ? { contestId } : {}),
        };
        return this.events.find(filter).sort({ updatedAt: -1 }).limit(limit);
    }

    async update(input: UpdateExamEventInput): Promise<ExamEventDoc> {
        assertDomainId(input.domainId);
        if (!(input.eventId instanceof ObjectId)) throw new TypeError('eventId must be an ObjectId');
        assertUid(input.actorUid, 'actorUid');
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new TypeError('expectedRevision is invalid');
        const current = await this.events.findOne({ domainId: input.domainId, _id: input.eventId });
        if (!current) throw new ExamEventError('not_found');
        if (current.lifecycle === 'archived') throw new ExamEventError('archived');
        const now = this.now();
        const critical = isCriticalPatch(input);
        if (critical && current.lifecycle === 'scheduled' && current.startAt <= now) throw new ExamEventError('started');

        const type = input.type === undefined ? current.type : canonicalType(input.type);
        const contestId = input.contestId === undefined ? current.contestId : input.contestId || undefined;
        if (contestId !== undefined && !(contestId instanceof ObjectId)) throw new TypeError('contestId must be an ObjectId');
        if (type === 'external' && contestId) throw new ExamEventError('external_contest_forbidden');
        if (current.lifecycle === 'scheduled' && type === 'krypton' && !contestId) throw new ExamEventError('contest_required');
        const { startAt, endAt } = canonicalWindow(input.startAt || current.startAt, input.endAt || current.endAt);
        const revision = input.expectedRevision + 1;
        const $set: Partial<ExamEventDoc> = {
            title: input.title === undefined ? current.title : canonicalTitle(input.title),
            schoolId: input.schoolId === undefined ? current.schoolId : new ObjectId(input.schoolId),
            type,
            startAt,
            endAt,
            collaboratorUids:
                input.collaboratorUids === undefined ? current.collaboratorUids : canonicalCollaboratorUids(current.ownerUid, input.collaboratorUids),
            updatedAt: now,
            updatedBy: input.actorUid,
            revision,
            auditRef: examEventAuditRef(current._id, revision),
        };
        if (input.schoolId !== undefined && !(input.schoolId instanceof ObjectId)) throw new TypeError('schoolId must be an ObjectId');
        if (contestId) $set.contestId = new ObjectId(contestId);
        const $unset = contestId ? undefined : { contestId: '' as const };
        const updated = await this.events.findOneAndUpdate(
            {
                domainId: input.domainId,
                _id: input.eventId,
                revision: input.expectedRevision,
                lifecycle: { $ne: 'archived' },
                ...(critical && current.lifecycle === 'scheduled' ? { startAt: { $gt: now } } : {}),
            },
            { $set, ...($unset ? { $unset } : {}) },
            { returnDocument: 'after' },
        );
        if (updated) return updated;
        const latest = await this.events.findOne({ domainId: input.domainId, _id: input.eventId });
        if (!latest) throw new ExamEventError('not_found');
        if (latest.lifecycle === 'archived') throw new ExamEventError('archived');
        if (critical && latest.lifecycle === 'scheduled' && latest.startAt <= this.now()) throw new ExamEventError('started');
        throw new ExamEventError('revision_conflict');
    }

    async schedule(domainId: string, eventId: ObjectId, expectedRevision: number, actorUid: number): Promise<ExamEventDoc> {
        assertDomainId(domainId);
        if (!(eventId instanceof ObjectId)) throw new TypeError('eventId must be an ObjectId');
        assertUid(actorUid, 'actorUid');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('expectedRevision is invalid');
        const current = await this.events.findOne({ domainId, _id: eventId });
        if (!current) throw new ExamEventError('not_found');
        if (current.lifecycle !== 'draft') throw new ExamEventError('not_draft');
        if (current.startAt <= this.now()) throw new ExamEventError('start_not_future');
        if (current.type === 'krypton' && !current.contestId) throw new ExamEventError('contest_required');
        const now = this.now();
        const revision = expectedRevision + 1;
        const updated = await this.events.findOneAndUpdate(
            { domainId, _id: eventId, lifecycle: 'draft', revision: expectedRevision, startAt: { $gt: now } },
            {
                $set: {
                    lifecycle: 'scheduled',
                    updatedAt: now,
                    updatedBy: actorUid,
                    revision,
                    auditRef: examEventAuditRef(eventId, revision),
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ExamEventError('revision_conflict');
        return updated;
    }

    async archive(domainId: string, eventId: ObjectId, expectedRevision: number, actorUid: number): Promise<ExamEventDoc> {
        assertDomainId(domainId);
        if (!(eventId instanceof ObjectId)) throw new TypeError('eventId must be an ObjectId');
        assertUid(actorUid, 'actorUid');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('expectedRevision is invalid');
        const now = this.now();
        const revision = expectedRevision + 1;
        const updated = await this.events.findOneAndUpdate(
            { domainId, _id: eventId, revision: expectedRevision, lifecycle: { $ne: 'archived' } },
            {
                $set: {
                    lifecycle: 'archived',
                    archivedAt: now,
                    archivedBy: actorUid,
                    updatedAt: now,
                    updatedBy: actorUid,
                    revision,
                    auditRef: examEventAuditRef(eventId, revision),
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) {
            const current = await this.events.findOne({ domainId, _id: eventId });
            if (!current) throw new ExamEventError('not_found');
            if (current.lifecycle === 'archived') throw new ExamEventError('archived');
            throw new ExamEventError('revision_conflict');
        }
        return updated;
    }
}

export const examEventColl = db.collection<ExamEventDoc>('exam.events');
export const examEventService = new ExamEventService(examEventColl);

export async function apply(ctx: any): Promise<void> {
    await examEventService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await examEventColl.deleteMany({ domainId });
    });
}

global.Hydro.model.examEvent = { examEventColl, examEventService };
