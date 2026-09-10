import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import { Context } from '../context';
import db from '../service/db';
import { settleDomainCleanupOperations, withDomainLifecycleMutation } from './domain-lifecycle-boundary';
import { examClassroomService } from './exam-classroom';

export type ExamSeatFacing = 'down' | 'left' | 'right' | 'unset' | 'up';
export type ExamSeatDisabledReason = 'client_incompatible' | 'computer_failure' | 'manual_reserve' | 'physical_seat_unavailable';

export interface ExamSeatOperationalEntry {
    sourceSeatId: string;
    enabled: boolean;
    facing: ExamSeatFacing;
    disabledReason: ExamSeatDisabledReason | null;
    note: string | null;
}

export interface ExamSeatOperationalProfileDoc {
    _id: ObjectId;
    schemaVersion: 1;
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    layoutRevision: number;
    layoutFingerprint: string;
    revision: number;
    previousRevision: number | null;
    entries: ExamSeatOperationalEntry[];
    fingerprint: string;
    createdAt: Date;
    createdBy: number;
}

export interface ExamSeatOperationalProfileView {
    schemaVersion: 1;
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    layoutRevision: number;
    layoutFingerprint: string;
    revision: number;
    previousRevision: number | null;
    entries: ExamSeatOperationalEntry[];
    fingerprint: string;
    createdAt: Date | null;
    createdBy: number | null;
    persisted: boolean;
}

export interface ExamSeatOperationalClassroomFacts {
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    layoutRevision: number;
    layoutFingerprint: string;
    sourceSeatIds: string[];
}

type ProfileCollection = Pick<Collection<ExamSeatOperationalProfileDoc>, 'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'insertOne'>;

export class ExamSeatOperationalProfileError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamSeatOperationalProfileError';
    }
}

function fail(reason: string): never {
    throw new ExamSeatOperationalProfileError(reason);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value: unknown, keys: string[], reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(reason);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) fail(reason);
    return record;
}

function assertDomainId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value || value.length > 64) throw new TypeError('domainId is invalid');
}

function assertObjectId(value: unknown, field: string): asserts value is ObjectId {
    if (!(value instanceof ObjectId)) throw new TypeError(`${field} must be an ObjectId`);
}

function assertRevision(value: unknown, allowZero = false): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) throw new TypeError('revision is invalid');
}

function assertFingerprint(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${field}_invalid`);
}

function assertUid(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError('actorUid is invalid');
}

function canonicalDate(value: unknown): Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail('seat_profile_created_at_invalid');
    return new Date(value);
}

function canonicalSeatId(value: unknown): string {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 128) fail('seat_profile_entry_invalid');
    return value;
}

function canonicalNote(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 240) fail('seat_profile_entry_invalid');
    return value;
}

function canonicalEntries(value: unknown, expectedSeatIds?: readonly string[]): ExamSeatOperationalEntry[] {
    if (!Array.isArray(value) || value.length > 500) fail('seat_profile_entries_invalid');
    const entries = value.map((item) => {
        const entry = exactObject(item, ['disabledReason', 'enabled', 'facing', 'note', 'sourceSeatId'], 'seat_profile_entry_invalid');
        const sourceSeatId = canonicalSeatId(entry.sourceSeatId);
        if (
            typeof entry.enabled !== 'boolean' ||
            typeof entry.facing !== 'string' ||
            !['down', 'left', 'right', 'unset', 'up'].includes(entry.facing)
        ) {
            fail('seat_profile_entry_invalid');
        }
        const facing = entry.facing as ExamSeatFacing;
        const note = canonicalNote(entry.note);
        if (entry.enabled) {
            if (entry.disabledReason !== null || note !== null) fail('seat_profile_entry_invalid');
            return { sourceSeatId, enabled: true, facing, disabledReason: null, note: null };
        }
        if (
            typeof entry.disabledReason !== 'string' ||
            !['client_incompatible', 'computer_failure', 'manual_reserve', 'physical_seat_unavailable'].includes(entry.disabledReason)
        ) {
            fail('seat_profile_entry_invalid');
        }
        return {
            sourceSeatId,
            enabled: false,
            facing,
            disabledReason: entry.disabledReason as ExamSeatDisabledReason,
            note,
        };
    });
    entries.sort((left, right) => compareText(left.sourceSeatId, right.sourceSeatId));
    if (new Set(entries.map((entry) => entry.sourceSeatId)).size !== entries.length) fail('seat_profile_seat_set_invalid');
    if (expectedSeatIds) {
        const expected = [...expectedSeatIds].map(canonicalSeatId).sort(compareText);
        if (expected.length !== entries.length || expected.some((seatId, index) => seatId !== entries[index].sourceSeatId)) {
            fail('seat_profile_seat_set_invalid');
        }
    }
    return entries;
}

function profileFingerprint(input: {
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    layoutRevision: number;
    layoutFingerprint: string;
    revision: number;
    entries: ExamSeatOperationalEntry[];
}): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                schemaVersion: 1,
                domainId: input.domainId,
                schoolId: input.schoolId.toHexString(),
                classroomId: input.classroomId.toHexString(),
                layoutRevision: input.layoutRevision,
                layoutFingerprint: input.layoutFingerprint,
                revision: input.revision,
                entries: input.entries,
            }),
            'utf8',
        )
        .digest('hex');
}

function canonicalClassroomFacts(value: ExamSeatOperationalClassroomFacts): ExamSeatOperationalClassroomFacts {
    assertDomainId(value.domainId);
    assertObjectId(value.schoolId, 'schoolId');
    assertObjectId(value.classroomId, 'classroomId');
    assertRevision(value.layoutRevision);
    assertFingerprint(value.layoutFingerprint, 'seat_profile_layout_fingerprint');
    if (!Array.isArray(value.sourceSeatIds) || value.sourceSeatIds.length > 500) fail('seat_profile_seat_set_invalid');
    const sourceSeatIds = value.sourceSeatIds.map(canonicalSeatId).sort(compareText);
    if (new Set(sourceSeatIds).size !== sourceSeatIds.length) fail('seat_profile_seat_set_invalid');
    return {
        domainId: value.domainId,
        schoolId: new ObjectId(value.schoolId),
        classroomId: new ObjectId(value.classroomId),
        layoutRevision: value.layoutRevision,
        layoutFingerprint: value.layoutFingerprint,
        sourceSeatIds,
    };
}

function defaultEntries(sourceSeatIds: readonly string[]): ExamSeatOperationalEntry[] {
    return [...sourceSeatIds]
        .sort(compareText)
        .map((sourceSeatId) => ({ sourceSeatId, enabled: true, facing: 'unset', disabledReason: null, note: null }));
}

function virtualProfile(classroom: ExamSeatOperationalClassroomFacts): ExamSeatOperationalProfileView {
    const entries = defaultEntries(classroom.sourceSeatIds);
    return {
        schemaVersion: 1,
        domainId: classroom.domainId,
        schoolId: new ObjectId(classroom.schoolId),
        classroomId: new ObjectId(classroom.classroomId),
        layoutRevision: classroom.layoutRevision,
        layoutFingerprint: classroom.layoutFingerprint,
        revision: 0,
        previousRevision: null,
        entries,
        fingerprint: profileFingerprint({ ...classroom, revision: 0, entries }),
        createdAt: null,
        createdBy: null,
        persisted: false,
    };
}

function storedView(profile: ExamSeatOperationalProfileDoc): ExamSeatOperationalProfileView {
    return { ...profile, persisted: true };
}

function assertProfileMatchesClassroom(profile: ExamSeatOperationalProfileDoc, classroom: ExamSeatOperationalClassroomFacts): void {
    if (
        profile.domainId !== classroom.domainId ||
        !profile.schoolId.equals(classroom.schoolId) ||
        !profile.classroomId.equals(classroom.classroomId) ||
        profile.layoutRevision !== classroom.layoutRevision ||
        profile.layoutFingerprint !== classroom.layoutFingerprint ||
        profile.entries.length !== classroom.sourceSeatIds.length ||
        profile.entries.some((entry, index) => entry.sourceSeatId !== classroom.sourceSeatIds[index])
    ) {
        fail('seat_profile_classroom_drift');
    }
}

function duplicateKey(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 11000);
}

export function assertExamSeatOperationalProfileIntegrity(value: unknown): asserts value is ExamSeatOperationalProfileDoc {
    const doc = exactObject(
        value,
        [
            '_id',
            'classroomId',
            'createdAt',
            'createdBy',
            'domainId',
            'entries',
            'fingerprint',
            'layoutFingerprint',
            'layoutRevision',
            'previousRevision',
            'revision',
            'schemaVersion',
            'schoolId',
        ],
        'seat_profile_document_invalid',
    );
    assertObjectId(doc._id, 'profileId');
    assertDomainId(doc.domainId);
    assertObjectId(doc.schoolId, 'schoolId');
    assertObjectId(doc.classroomId, 'classroomId');
    assertRevision(doc.layoutRevision);
    assertRevision(doc.revision);
    assertFingerprint(doc.layoutFingerprint, 'seat_profile_layout_fingerprint');
    assertFingerprint(doc.fingerprint, 'seat_profile_fingerprint');
    assertUid(doc.createdBy);
    canonicalDate(doc.createdAt);
    if (doc.schemaVersion !== 1) fail('seat_profile_document_invalid');
    if ((doc.revision === 1 && doc.previousRevision !== null) || (doc.revision > 1 && doc.previousRevision !== doc.revision - 1)) {
        fail('seat_profile_revision_invalid');
    }
    const entries = canonicalEntries(doc.entries);
    if ((doc.entries as ExamSeatOperationalEntry[]).some((entry, index) => entry.sourceSeatId !== entries[index].sourceSeatId)) {
        fail('seat_profile_entries_not_canonical');
    }
    const expectedFingerprint = profileFingerprint({
        domainId: doc.domainId,
        schoolId: doc.schoolId,
        classroomId: doc.classroomId,
        layoutRevision: doc.layoutRevision,
        layoutFingerprint: doc.layoutFingerprint,
        revision: doc.revision,
        entries,
    });
    if (doc.fingerprint !== expectedFingerprint) fail('seat_profile_fingerprint_mismatch');
}

export class ExamSeatOperationalProfileService {
    private indexesPromise?: Promise<void>;

    constructor(
        private readonly options: {
            profiles: ProfileCollection;
            domainExists: (domainId: string) => Promise<boolean>;
            loadClassroom: (domainId: string, classroomId: ObjectId, layoutRevision?: number) => Promise<ExamSeatOperationalClassroomFacts | null>;
            now?: () => Date;
            idFactory?: () => ObjectId;
        },
    ) {}

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.options.profiles.createIndex(
                { domainId: 1, classroomId: 1, layoutRevision: 1, revision: 1 },
                { name: 'examSeatOperationalProfileRevision', unique: true },
            ),
            this.options.profiles.createIndex(
                { domainId: 1, schoolId: 1, classroomId: 1, layoutRevision: 1, revision: -1 },
                { name: 'examSeatOperationalProfileLookup' },
            ),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    private async classroom(domainId: string, classroomId: ObjectId, layoutRevision?: number): Promise<ExamSeatOperationalClassroomFacts> {
        assertDomainId(domainId);
        assertObjectId(classroomId, 'classroomId');
        if (layoutRevision !== undefined) assertRevision(layoutRevision);
        if (!(await this.options.domainExists(domainId))) fail('seat_profile_domain_not_found');
        const classroom = await this.options.loadClassroom(domainId, classroomId, layoutRevision);
        if (!classroom) fail('seat_profile_classroom_not_found');
        const canonical = canonicalClassroomFacts(classroom);
        if (canonical.domainId !== domainId || !canonical.classroomId.equals(classroomId)) fail('seat_profile_classroom_mismatch');
        if (layoutRevision !== undefined && canonical.layoutRevision !== layoutRevision) fail('seat_profile_layout_not_found');
        return canonical;
    }

    private async latest(domainId: string, classroomId: ObjectId, layoutRevision: number): Promise<ExamSeatOperationalProfileDoc | null> {
        const [profile] = await this.options.profiles.find({ domainId, classroomId, layoutRevision }).sort({ revision: -1 }).limit(1).toArray();
        if (profile) assertExamSeatOperationalProfileIntegrity(profile);
        return profile || null;
    }

    async getCurrent(domainId: string, classroomId: ObjectId): Promise<ExamSeatOperationalProfileView> {
        const classroom = await this.classroom(domainId, classroomId);
        const profile = await this.latest(domainId, classroomId, classroom.layoutRevision);
        if (!profile) return virtualProfile(classroom);
        assertProfileMatchesClassroom(profile, classroom);
        return storedView(profile);
    }

    async getRevision(
        domainId: string,
        classroomId: ObjectId,
        layoutRevision: number,
        revision: number,
    ): Promise<ExamSeatOperationalProfileDoc | ExamSeatOperationalProfileView | null> {
        assertDomainId(domainId);
        assertObjectId(classroomId, 'classroomId');
        assertRevision(layoutRevision);
        assertRevision(revision, true);
        const classroom = await this.classroom(domainId, classroomId, layoutRevision);
        if (revision === 0) return virtualProfile(classroom);
        const profile = await this.options.profiles.findOne({ domainId, classroomId, layoutRevision, revision });
        if (profile) {
            assertExamSeatOperationalProfileIntegrity(profile);
            assertProfileMatchesClassroom(profile, classroom);
        }
        return profile;
    }

    async replaceCurrent(input: {
        domainId: string;
        classroomId: ObjectId;
        layoutRevision: number;
        layoutFingerprint: string;
        expectedRevision: number;
        actorUid: number;
        entries: unknown;
    }): Promise<ExamSeatOperationalProfileDoc> {
        assertDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroomId');
        assertRevision(input.layoutRevision);
        assertRevision(input.expectedRevision, true);
        assertFingerprint(input.layoutFingerprint, 'seat_profile_layout_fingerprint');
        assertUid(input.actorUid);
        return withDomainLifecycleMutation(input.domainId, async () => {
            const classroom = await this.classroom(input.domainId, input.classroomId);
            if (classroom.layoutRevision !== input.layoutRevision || classroom.layoutFingerprint !== input.layoutFingerprint) {
                fail('seat_profile_layout_changed');
            }
            const entries = canonicalEntries(input.entries, classroom.sourceSeatIds);
            const previous = await this.latest(input.domainId, input.classroomId, input.layoutRevision);
            if (previous) assertProfileMatchesClassroom(previous, classroom);
            const currentRevision = previous?.revision || 0;
            if (currentRevision !== input.expectedRevision) fail('seat_profile_revision_conflict');
            const currentEntries = previous?.entries || defaultEntries(classroom.sourceSeatIds);
            if (JSON.stringify(entries) === JSON.stringify(currentEntries)) fail('seat_profile_unchanged');
            const revision = currentRevision + 1;
            const profile: ExamSeatOperationalProfileDoc = {
                _id: this.options.idFactory?.() || new ObjectId(),
                schemaVersion: 1,
                domainId: input.domainId,
                schoolId: new ObjectId(classroom.schoolId),
                classroomId: new ObjectId(input.classroomId),
                layoutRevision: input.layoutRevision,
                layoutFingerprint: input.layoutFingerprint,
                revision,
                previousRevision: previous?.revision || null,
                entries,
                fingerprint: profileFingerprint({ ...classroom, revision, entries }),
                createdAt: new Date(this.options.now?.() || new Date()),
                createdBy: input.actorUid,
            };
            try {
                await this.options.profiles.insertOne(profile);
            } catch (error) {
                if (duplicateKey(error)) fail('seat_profile_revision_conflict');
                throw error;
            }
            return profile;
        });
    }

    async deleteDomain(domainId: string): Promise<void> {
        assertDomainId(domainId);
        await this.options.profiles.deleteMany({ domainId });
    }
}

async function loadProductionClassroom(
    domainId: string,
    classroomId: ObjectId,
    requestedLayoutRevision?: number,
): Promise<ExamSeatOperationalClassroomFacts | null> {
    const classroom = await examClassroomService.get(domainId, classroomId, requestedLayoutRevision !== undefined);
    if (!classroom) return null;
    const layoutRevision = requestedLayoutRevision ?? classroom.layoutRevision;
    if (!classroom.layoutRevisions.some((candidate) => candidate.revision === layoutRevision)) fail('seat_profile_layout_not_found');
    const layout = examClassroomService.layout(classroom, layoutRevision).snapshot;
    return {
        domainId,
        schoolId: new ObjectId(classroom.schoolId),
        classroomId: new ObjectId(classroom._id),
        layoutRevision,
        layoutFingerprint: layout.fingerprint,
        sourceSeatIds: layout.seats.map((seat) => seat.sourceSeatId),
    };
}

export const examSeatOperationalProfileColl = db.collection<ExamSeatOperationalProfileDoc>('exam.seatOperationalProfiles');
const domainColl = db.collection<{ _id: string }>('domain');
export const examSeatOperationalProfileService = new ExamSeatOperationalProfileService({
    profiles: examSeatOperationalProfileColl,
    domainExists: async (domainId) => Boolean(await domainColl.findOne({ _id: domainId }, { projection: { _id: 1 } })),
    loadClassroom: loadProductionClassroom,
});

export async function apply(ctx: Context): Promise<void> {
    await examSeatOperationalProfileService.ensureIndexes();
    ctx.on('domain/delete', async (domainId) => {
        await settleDomainCleanupOperations(domainId, [() => examSeatOperationalProfileService.deleteDomain(domainId)]);
    });
}

global.Hydro.model.examSeatOperationalProfile = { examSeatOperationalProfileColl, examSeatOperationalProfileService };
