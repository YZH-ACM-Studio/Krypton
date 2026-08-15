import { isDeepStrictEqual } from 'node:util';
import { PERM, PRIV } from '@hydrooj/common';
import type { Db, Filter } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import mongoUri from 'mongodb-uri';
import {
    assertExamClassroomIntegrity,
    ClassSigninClassroomMigrationError,
    type ClassSigninClassroomMigrationBatchDoc,
    type ClassSigninClassroomMigrationRepository,
    type ClassSigninClassroomMigrationSnapshot,
    type ExamClassroomDoc,
    type ExamClassroomReferenceFact,
} from '../lib/classsignin-classroom-migration';
import { load } from '../options';
import { BUILTIN_ROLES } from './builtin-roles';

interface HydroMongoOptions {
    protocol?: string;
    username?: string;
    password?: string;
    host?: string;
    port?: string;
    name?: string;
    url?: string;
    uri?: string;
    prefix?: string;
    collectionMap?: Record<string, string>;
}

type ActorAuthorizer = (uid: number, domainIds: string[]) => Promise<boolean>;

interface AuthorizationUserDoc {
    _id: number;
    priv: number;
}

interface AuthorizationDomainDoc {
    _id: string;
    lower: string;
    roles: Record<string, string>;
}

interface AuthorizationDomainUserDoc {
    _id?: ObjectId;
    domainId: string;
    uid: number;
    join?: boolean;
    role?: string;
}

function fail(message: string, code = 'CLASSSIGNIN_CLASSROOM_DATABASE_UNAVAILABLE', details?: unknown, options?: ErrorOptions): never {
    throw new ClassSigninClassroomMigrationError(message, code, details, options);
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for classroom migration');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

function requiredObjectId(value: unknown, field: string): ObjectId {
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
    fail(`${field} is not a BSON ObjectId`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
}

function requiredText(value: unknown, field: string): string {
    if (
        typeof value !== 'string' ||
        !value ||
        value !== value.trim() ||
        value.length > 256 ||
        [...value].some((character) => {
            const code = character.codePointAt(0)!;
            return code < 32 || code === 127;
        })
    ) {
        fail(`${field} is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    return value;
}

function referenceIdentity(reference: ExamClassroomReferenceFact): string {
    return `${reference.domainId}\0${reference.classroomId.toHexString()}\0${reference.kind}\0${reference.sourceSeatId || ''}\0${reference.referenceId}`;
}

function pushReference(target: Map<string, ExamClassroomReferenceFact>, reference: ExamClassroomReferenceFact): void {
    target.set(referenceIdentity(reference), reference);
}

function exactRootFilter<T extends object>(identity: Record<string, unknown>, expected: T): Filter<T> {
    return {
        ...identity,
        $expr: { $eq: ['$$ROOT', { $literal: expected }] },
    } as unknown as Filter<T>;
}

function parseClassroomSources(
    target: Map<string, ExamClassroomReferenceFact>,
    document: Record<string, unknown>,
    sources: unknown,
    suffix: string,
): void {
    if (!Array.isArray(sources)) fail('exam target sources are invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    for (const source of sources) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            fail('exam target source is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        const row = source as Record<string, unknown>;
        if (Object.keys(row).length !== 2 || !Object.hasOwn(row, 'kind') || !Object.hasOwn(row, 'ids') || typeof row.kind !== 'string') {
            fail('exam target source shape is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        if (!['classroom', 'endpoint', 'examSeat', 'seat', 'userbindGroup'].includes(row.kind)) {
            fail('exam target source kind is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        if (!Array.isArray(row.ids)) fail('exam target source has invalid IDs', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        if (!row.ids.length) fail('exam target source IDs are empty', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        if (row.kind !== 'classroom') {
            for (const id of row.ids) requiredText(id, 'exam target source ID');
            continue;
        }
        for (const id of row.ids) {
            const classroomId = requiredObjectId(id, 'exam target classroom ID');
            pushReference(target, {
                domainId: requiredText(document.domainId, 'exam target domainId'),
                classroomId,
                kind: 'exam-target',
                referenceId: `exam-target:${String(document._id)}:${suffix}`,
            });
        }
    }
}

function databaseActorAuthorizer(database: Db, options: HydroMongoOptions): ActorAuthorizer {
    const collection = <T = Record<string, unknown>>(logicalName: string) => database.collection<T>(collectionName(options, logicalName));
    return async (uid, domainIds) => {
        const actor = await collection<AuthorizationUserDoc>('user').findOne({ _id: uid });
        if (!actor || !Number.isSafeInteger(actor.priv)) return false;
        const privileges = Number(actor.priv);
        if ((privileges & PRIV.PRIV_EDIT_SYSTEM) !== 0) return true;
        for (const requestedDomainId of domainIds) {
            const domain = await collection<AuthorizationDomainDoc>('domain').findOne({ lower: requestedDomainId.toLowerCase() });
            if (!domain || typeof domain._id !== 'string' || !domain.roles || typeof domain.roles !== 'object' || Array.isArray(domain.roles)) {
                return false;
            }
            const membership: Partial<AuthorizationDomainUserDoc> =
                (await collection<AuthorizationDomainUserDoc>('domain.user').findOne({ domainId: domain._id, uid })) || {};
            if (
                (membership.join !== undefined && typeof membership.join !== 'boolean') ||
                (membership.role !== undefined && typeof membership.role !== 'string')
            ) {
                return false;
            }
            let role = typeof membership.role === 'string' && membership.role ? membership.role : 'default';
            if ((privileges & PRIV.PRIV_USER_PROFILE) === 0 || (!membership.join && (privileges & PRIV.PRIV_VIEW_ALL_DOMAIN) === 0)) role = 'guest';
            if ((privileges & PRIV.PRIV_MANAGE_ALL_DOMAIN) !== 0) role = 'root';
            const roles: Record<string, string> = domain.roles;
            let permission: bigint | undefined;
            if (role === 'root') permission = BUILTIN_ROLES.root;
            else if (Object.hasOwn(roles, role)) {
                try {
                    permission = BigInt(roles[role]);
                } catch (error) {
                    fail('domain role permission is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID', undefined, { cause: error });
                }
            } else if (Object.hasOwn(BUILTIN_ROLES, role)) {
                permission = BUILTIN_ROLES[role as keyof typeof BUILTIN_ROLES];
            }
            if (permission === undefined || (permission & PERM.PERM_MANAGE_EXAM_INFRASTRUCTURE) === 0n) return false;
        }
        return true;
    };
}

export class MongoClassSigninClassroomMigrationRepository implements ClassSigninClassroomMigrationRepository {
    constructor(
        private readonly database: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly authorizeActor: ActorAuthorizer = async () => false,
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection<T = Record<string, unknown>>(logicalName: string) {
        return this.database.collection<T>(collectionName(this.options, logicalName));
    }

    async loadSnapshot(): Promise<ClassSigninClassroomMigrationSnapshot> {
        const [schools, classrooms, bindings, pairingWindows, targets, seatPlans, seatAssignments] = await Promise.all([
            this.collection('userbind.schools').find({}).toArray(),
            this.collection<ExamClassroomDoc>('exam.classrooms').find({}).toArray(),
            this.collection('exam.endpointSeatBindings').find({}).toArray(),
            this.collection('exam.endpointSeatPairingWindows').find({}).toArray(),
            this.collection('exam.targetAssignments').find({}).toArray(),
            this.collection('exam.seatPlans').find({}).toArray(),
            this.collection('exam.seatAssignments').find({}).toArray(),
        ]);
        const references = new Map<string, ExamClassroomReferenceFact>();
        for (const binding of bindings) {
            pushReference(references, {
                domainId: requiredText(binding.domainId, 'endpoint seat binding domainId'),
                classroomId: requiredObjectId(binding.classroomId, 'endpoint seat binding classroomId'),
                kind: 'endpoint-seat-binding',
                sourceSeatId: requiredText(binding.sourceSeatId, 'endpoint seat binding sourceSeatId'),
                referenceId: `endpoint-seat-binding:${String(binding._id)}`,
            });
        }
        for (const window of pairingWindows) {
            const domainId = requiredText(window.domainId, 'endpoint seat pairing window domainId');
            const classroomId = requiredObjectId(window.classroomId, 'endpoint seat pairing window classroomId');
            const windowId = requiredText(window._id, 'endpoint seat pairing window ID');
            if (!Array.isArray(window.entries) || !window.entries.length) {
                fail('endpoint seat pairing window entries are invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            }
            const sourceSeatIds = new Set<string>();
            for (const raw of window.entries) {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                    fail('endpoint seat pairing window entry is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                }
                const sourceSeatId = requiredText((raw as Record<string, unknown>).sourceSeatId, 'endpoint seat pairing window sourceSeatId');
                if (sourceSeatIds.has(sourceSeatId)) {
                    fail('endpoint seat pairing window has duplicate seats', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                }
                sourceSeatIds.add(sourceSeatId);
                pushReference(references, {
                    domainId,
                    classroomId,
                    kind: 'endpoint-seat-pairing-window',
                    sourceSeatId,
                    referenceId: `endpoint-seat-pairing-window:${windowId}`,
                });
            }
        }
        for (const target of targets) {
            const draft = target.draft;
            if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
                fail('exam target draft is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            }
            parseClassroomSources(references, target, (draft as Record<string, unknown>).sources, 'draft');
            if (!Array.isArray(target.revisions)) fail('exam target revisions are invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            for (const revision of target.revisions) {
                if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
                    fail('exam target revision is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                }
                const row = revision as Record<string, unknown>;
                if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1) {
                    fail('exam target revision identity is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                }
                parseClassroomSources(references, target, row.sources, `revision:${String(row.revision)}`);
            }
        }
        for (const seatPlan of seatPlans) {
            const domainId = requiredText(seatPlan.domainId, 'exam seat plan domainId');
            const referenceId = `exam-seat-plan:${String(seatPlan._id)}:${String(seatPlan.revision)}`;
            const classroomRows = Object.hasOwn(seatPlan, 'schemaVersion')
                ? (() => {
                      if (seatPlan.schemaVersion !== 2 || !Array.isArray(seatPlan.classrooms) || !seatPlan.classrooms.length) {
                          fail('exam seat plan v2 classrooms are invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                      }
                      return seatPlan.classrooms.map((raw) => {
                          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                              fail('exam seat plan v2 classroom is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                          }
                          const row = raw as Record<string, unknown>;
                          if (!Array.isArray(row.candidateSeatIds) || !row.candidateSeatIds.length) {
                              fail('exam seat plan v2 candidateSeatIds are invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                          }
                          return {
                              classroomId: requiredObjectId(row.classroomId, 'exam seat plan v2 classroomId'),
                              candidateSeatIds: row.candidateSeatIds,
                          };
                      });
                  })()
                : (() => {
                      if (!Array.isArray(seatPlan.candidateSeatIds)) {
                          fail('exam seat plan candidateSeatIds are invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                      }
                      return [
                          {
                              classroomId: requiredObjectId(seatPlan.classroomId, 'exam seat plan classroomId'),
                              candidateSeatIds: seatPlan.candidateSeatIds,
                          },
                      ];
                  })();
            for (const classroom of classroomRows) {
                if (!classroom.candidateSeatIds.length) {
                    pushReference(references, { domainId, classroomId: classroom.classroomId, kind: 'exam-seat-plan', referenceId });
                }
                for (const sourceSeatId of classroom.candidateSeatIds) {
                    pushReference(references, {
                        domainId,
                        classroomId: classroom.classroomId,
                        kind: 'exam-seat-plan',
                        sourceSeatId: requiredText(sourceSeatId, 'exam seat plan sourceSeatId'),
                        referenceId,
                    });
                }
            }
        }
        for (const assignment of seatAssignments) {
            if (!Array.isArray(assignment.assignments)) {
                fail('exam seat assignment has invalid assignments', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            }
            const v2 = Object.hasOwn(assignment, 'schemaVersion');
            if (v2 && assignment.schemaVersion !== 2) {
                fail('exam seat assignment schemaVersion is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            }
            const v1ClassroomId = v2 ? null : requiredObjectId(assignment.classroomId, 'exam seat assignment classroomId');
            for (const raw of assignment.assignments) {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                    fail('exam seat assignment row is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                }
                const row = raw as Record<string, unknown>;
                const seat = v2
                    ? (() => {
                          if (!row.seat || typeof row.seat !== 'object' || Array.isArray(row.seat)) {
                              fail('exam seat assignment v2 seat is invalid', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
                          }
                          return row.seat as Record<string, unknown>;
                      })()
                    : row;
                pushReference(references, {
                    domainId: requiredText(assignment.domainId, 'exam seat assignment domainId'),
                    classroomId: v2 ? requiredObjectId(seat.classroomId, 'exam seat assignment v2 classroomId') : v1ClassroomId!,
                    kind: 'exam-seat-assignment',
                    sourceSeatId: requiredText(seat.sourceSeatId, 'exam seat assignment sourceSeatId'),
                    referenceId: `exam-seat-assignment:${String(assignment._id)}:${String(assignment.revision)}`,
                });
            }
        }
        return {
            schools: schools.map((school) => ({
                _id: requiredObjectId(school._id, 'userbind school ID'),
                domainId: requiredText(school.domainId, 'userbind school domainId'),
                name: requiredText(school.name, 'userbind school name'),
            })),
            classrooms,
            references: [...references.values()],
        };
    }

    isExamInfrastructureAdministrator(uid: number, domainIds: string[]): Promise<boolean> {
        return this.authorizeActor(uid, domainIds);
    }

    async ensureIndexes(): Promise<void> {
        await Promise.all([
            this.collection('exam.classrooms').createIndex(
                { domainId: 1, sourceSystem: 1, sourceClassroomId: 1 },
                { name: 'examClassroomSourceIdentity', unique: true },
            ),
            this.collection('exam.classrooms').createIndex({ domainId: 1, schoolId: 1, status: 1, name: 1 }, { name: 'examClassroomSchoolStatus' }),
            this.collection('exam.classroomImportBatches').createIndex({ planFingerprint: 1 }, { name: 'examClassroomImportPlan', unique: true }),
        ]);
    }

    async writeClassroom(expected: ExamClassroomDoc | null, target: ExamClassroomDoc): Promise<'applied' | 'no-op'> {
        if (expected) assertExamClassroomIntegrity(expected);
        assertExamClassroomIntegrity(target);
        const classrooms = this.collection<ExamClassroomDoc>('exam.classrooms');
        if (!expected) {
            try {
                await classrooms.insertOne(target);
                return 'applied';
            } catch (error) {
                const current = await classrooms.findOne({ _id: target._id });
                if (current && isDeepStrictEqual(current, target)) return 'no-op';
                fail(`classroom ${target._id.toHexString()} insert lost a uniqueness race`, 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT', undefined, {
                    cause: error,
                });
            }
        }
        const result = await classrooms.replaceOne(exactRootFilter({ _id: expected._id }, expected), target);
        if (result.matchedCount === 1) return result.modifiedCount === 1 ? 'applied' : 'no-op';
        const current = await classrooms.findOne({ _id: target._id });
        if (current && isDeepStrictEqual(current, target)) return 'no-op';
        fail(`classroom ${target._id.toHexString()} lost its compare-and-set race`, 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
    }

    async saveBatch(
        batch: ClassSigninClassroomMigrationBatchDoc,
        expectedState: ClassSigninClassroomMigrationBatchDoc | null,
    ): Promise<'applied' | 'no-op'> {
        const batches = this.collection<ClassSigninClassroomMigrationBatchDoc>('exam.classroomImportBatches');
        if (expectedState === null) {
            if (batch.revision !== 1 || batch.state !== 'applying') {
                fail('initial classroom migration batch state is invalid', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
            }
            try {
                await batches.insertOne(batch);
                return 'applied';
            } catch (error) {
                const concurrent = await batches.findOne({ _id: batch._id });
                if (concurrent && isDeepStrictEqual(concurrent, batch)) return 'no-op';
                fail('classroom migration batch identity collided', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT', undefined, { cause: error });
            }
        }
        if (batch.revision !== expectedState.revision + 1) {
            fail('classroom migration batch revision is not monotonic', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
        }
        const current = await batches.findOne({ _id: batch._id });
        if (current && isDeepStrictEqual(current, batch)) return 'no-op';
        if (
            !current ||
            !isDeepStrictEqual(current, expectedState) ||
            expectedState.planFingerprint !== batch.planFingerprint ||
            expectedState.actor !== batch.actor ||
            expectedState.state === 'applied'
        ) {
            fail('classroom migration batch cannot advance from its current state', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
        }
        const result = await batches.replaceOne(exactRootFilter({ _id: expectedState._id }, expectedState), batch);
        if (result.matchedCount === 1) return result.modifiedCount === 1 ? 'applied' : 'no-op';
        const concurrent = await batches.findOne({ _id: batch._id });
        if (concurrent && isDeepStrictEqual(concurrent, batch)) return 'no-op';
        fail('classroom migration batch lost its compare-and-set race', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
    }

    loadBatch(batchId: string): Promise<ClassSigninClassroomMigrationBatchDoc | null> {
        return this.collection<ClassSigninClassroomMigrationBatchDoc>('exam.classroomImportBatches').findOne({ _id: batchId });
    }

    async insertAudit(audit: Record<string, unknown>): Promise<string> {
        const result = await this.collection('oplog').insertOne({ _id: new ObjectId(), ...audit });
        return result.insertedId.toHexString();
    }

    async ensureAudit(auditId: string, audit: Record<string, unknown>): Promise<'applied' | 'no-op'> {
        if (!/^[a-f0-9]{24}$/.test(auditId)) {
            fail('classroom migration audit identity is invalid', 'CLASSSIGNIN_CLASSROOM_AUDIT_CONFLICT');
        }
        const audits = this.collection('oplog');
        const target = { _id: new ObjectId(auditId), ...audit };
        try {
            await audits.insertOne(target);
            return 'applied';
        } catch (error) {
            const current = await audits.findOne({ _id: target._id });
            if (current && isDeepStrictEqual(current, target)) return 'no-op';
            fail('classroom migration success audit identity collided', 'CLASSSIGNIN_CLASSROOM_AUDIT_CONFLICT', undefined, { cause: error });
        }
    }

    loadAudit(auditId: string): Promise<Record<string, unknown> | null> {
        if (!ObjectId.isValid(auditId)) return Promise.resolve(null);
        return this.collection('oplog').findOne({ _id: new ObjectId(auditId) });
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createMongoClassSigninClassroomMigrationRepository(options: { authorizeApply?: boolean } = {}) {
    const config = load() as HydroMongoOptions | null;
    if (!config) fail('Hydro configuration is unavailable for classroom migration');
    const url = mongoUrl(config);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    const database = client.db(parsed.database || config.name || 'hydro');
    return new MongoClassSigninClassroomMigrationRepository(
        database,
        config,
        options.authorizeApply ? databaseActorAuthorizer(database, config) : async () => false,
        () => client.close(),
    );
}

export const classSigninClassroomMigrationAdapterInternals = { collectionName, databaseActorAuthorizer, mongoUrl };
