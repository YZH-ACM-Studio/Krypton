import { canonicalJson, sha256 } from './problem-batch-import';
import { BSON, ObjectId } from 'mongodb';

export const CLASSSIGNIN_CLASSROOM_MIGRATION_SCHEMA_VERSION = 1;
export const CLASSSIGNIN_SOURCE_SYSTEM = 'ClassSigninSystem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SOURCE_TEXT_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_LAYOUT_ITEMS = 2_000;
const MAX_COORDINATE = 1_000_000;

export class ClassSigninClassroomMigrationError extends Error {
    constructor(
        message: string,
        public readonly code = 'CLASSSIGNIN_CLASSROOM_MIGRATION_INVALID',
        public readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'ClassSigninClassroomMigrationError';
    }
}

export interface ClassSigninLayoutSeat {
    sourceSeatId: string;
    label: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation: number;
    status: string;
}

export interface ClassSigninLayoutDecoration {
    sourceItemId: string;
    label: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation: number;
    status: string;
    type: string;
}

export interface ClassSigninClassroomLayout {
    schemaVersion: 1;
    sourceFormat: 'empty' | 'items-v1' | 'legacy-grid-v1';
    coordinateSystem: 'cartesian' | 'grid';
    rows?: number;
    cols?: number;
    seats: ClassSigninLayoutSeat[];
    decorations: ClassSigninLayoutDecoration[];
    fingerprint: string;
}

export interface ValidatedClassSigninSchool {
    sourceSchoolId: string;
    code: string;
    name: string;
    isActive: boolean;
    sourceCreatedAt: string;
    sourceUpdatedAt: string;
}

export interface ValidatedClassSigninClassroom {
    sourceClassroomId: string;
    sourceSchoolId: string;
    name: string;
    sourceCreatedAt: string;
    sourceUpdatedAt: string;
    layout: ClassSigninClassroomLayout;
    sourceFingerprint: string;
}

export interface ValidatedClassSigninExport {
    formatVersion: 1;
    sourceSystem: typeof CLASSSIGNIN_SOURCE_SYSTEM;
    sourceDatabase: string;
    postgresVersion: string;
    snapshotAt: string;
    migrations: Array<{ id: number; hash: string; createdAt: number }>;
    schools: ValidatedClassSigninSchool[];
    classrooms: ValidatedClassSigninClassroom[];
    sourceSha256: string;
    canonicalFingerprint: string;
    summary: {
        schoolCount: number;
        classroomCount: number;
        emptyLayoutCount: number;
        seatCount: number;
        decorationCount: number;
    };
}

export interface ClassSigninSchoolMapping {
    sourceSchoolId: string;
    domainId: string;
    schoolId: ObjectId;
}

export interface ValidatedClassSigninManifest {
    schemaVersion: 1;
    sourceSystem: typeof CLASSSIGNIN_SOURCE_SYSTEM;
    sourceSha256: string;
    schoolMappings: ClassSigninSchoolMapping[];
    fingerprint: string;
}

export interface ExamClassroomLayoutRevision {
    revision: number;
    fingerprint: string;
    sourceSnapshotAt: string;
    importBatchId: string;
    importedAt: Date;
    importedBy: number;
    snapshot: ClassSigninClassroomLayout;
}

export interface ExamClassroomDoc {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    name: string;
    status: 'active' | 'archived';
    sourceSystem: typeof CLASSSIGNIN_SOURCE_SYSTEM;
    sourceSchoolId: string;
    sourceClassroomId: string;
    sourceFingerprint: string;
    sourceSnapshotAt: string;
    importBatchId: string;
    revision: number;
    layoutRevision: number;
    layoutRevisions: ExamClassroomLayoutRevision[];
    createdAt: Date;
    createdBy: number;
    updatedAt: Date;
    updatedBy: number;
    archivedAt?: Date;
    archivedBy?: number;
}

export type ExamClassroomReferenceKind = 'endpoint-seat-binding' | 'exam-target' | 'exam-seat-plan' | 'exam-seat-assignment';

export interface ExamClassroomReferenceFact {
    domainId: string;
    classroomId: ObjectId;
    kind: ExamClassroomReferenceKind;
    sourceSeatId?: string;
    referenceId: string;
}

export interface ClassSigninClassroomMigrationSnapshot {
    schools: Array<{ _id: ObjectId; domainId: string; name: string }>;
    classrooms: ExamClassroomDoc[];
    references: ExamClassroomReferenceFact[];
}

export type ClassSigninClassroomMigrationAction = 'add' | 'update' | 'archive' | 'unchanged' | 'conflict';

export interface ClassSigninClassroomMigrationEntry {
    action: ClassSigninClassroomMigrationAction;
    domainId: string;
    schoolId: string;
    classroomId: string;
    sourceSchoolId: string;
    sourceClassroomId: string;
    name: string;
    /** Canonical BSON Extended JSON of the exact pre-migration document. */
    beforeState: unknown | null;
    beforeStateFingerprint: string | null;
    targetRevision: number;
    targetLayoutRevision: number;
    desired?: {
        name: string;
        status: 'active';
        sourceFingerprint: string;
        sourceSnapshotAt: string;
        layout: ClassSigninClassroomLayout;
    };
    removedSeatIds: string[];
    conflicts: string[];
}

export interface ClassSigninClassroomMigrationPlan {
    schemaVersion: 1;
    generatedAt: string;
    batchId: string;
    source: {
        sourceSha256: string;
        canonicalFingerprint: string;
        snapshotAt: string;
        mappedSchoolCount: number;
        ignoredSchoolCount: number;
        mappedClassroomCount: number;
        ignoredClassroomCount: number;
    };
    manifest: {
        fingerprint: string;
        schoolMappings: Array<{ sourceSchoolId: string; domainId: string; schoolId: string }>;
    };
    databaseBefore: {
        schoolFingerprint: string;
        managedFingerprint: string;
        nonTargetFingerprint: string;
        referenceFingerprint: string;
    };
    conflicts: string[];
    entries: ClassSigninClassroomMigrationEntry[];
    summary: {
        added: number;
        updated: number;
        archived: number;
        unchanged: number;
        conflicts: number;
        seats: number;
        decorations: number;
    };
    fingerprint: string;
    confirmationToken: string;
    execution?: {
        revision: number;
        actor: number;
        state: 'applying' | 'applied' | 'failed';
        startedAt: string;
        updatedAt: string;
        completedAt?: string;
        results: Array<{
            classroomId: string;
            action: ClassSigninClassroomMigrationAction;
            result: 'applied' | 'no-op';
            at: string;
        }>;
        previousBatchFingerprint?: string;
        lastError?: string;
        auditId?: string;
    };
    verification?: {
        ok: boolean;
        verifiedAt: string;
        checks: Array<{ check: string; ok: boolean; detail?: string }>;
        auditId?: string;
    };
}

export interface ClassSigninClassroomMigrationBatchDoc {
    _id: string;
    type: 'classsignin.classroom.migration';
    planFingerprint: string;
    sourceSha256: string;
    manifestFingerprint: string;
    domainIds: string[];
    revision: number;
    actor: number;
    state: 'applying' | 'applied' | 'failed';
    startedAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    summary: ClassSigninClassroomMigrationPlan['summary'];
    results: NonNullable<ClassSigninClassroomMigrationPlan['execution']>['results'];
    lastError?: string;
    auditId?: string;
}

export interface ClassSigninClassroomMigrationRepository {
    loadSnapshot(): Promise<ClassSigninClassroomMigrationSnapshot>;
    isExamInfrastructureAdministrator(uid: number, domainIds: string[]): Promise<boolean>;
    ensureIndexes(): Promise<void>;
    writeClassroom(expected: ExamClassroomDoc | null, target: ExamClassroomDoc): Promise<'applied' | 'no-op'>;
    saveBatch(batch: ClassSigninClassroomMigrationBatchDoc, expected: ClassSigninClassroomMigrationBatchDoc | null): Promise<'applied' | 'no-op'>;
    loadBatch(batchId: string): Promise<ClassSigninClassroomMigrationBatchDoc | null>;
    insertAudit(audit: Record<string, unknown>): Promise<string>;
    ensureAudit(auditId: string, audit: Record<string, unknown>): Promise<'applied' | 'no-op'>;
    loadAudit(auditId: string): Promise<Record<string, unknown> | null>;
    close?(): Promise<void>;
}

function fail(message: string, code = 'CLASSSIGNIN_CLASSROOM_MIGRATION_INVALID', details?: unknown): never {
    throw new ClassSigninClassroomMigrationError(message, code, details);
}

function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`);
    return value as Record<string, unknown>;
}

function exactRecord(value: unknown, required: string[], optional: string[], field: string): Record<string, unknown> {
    const result = record(value, field);
    const allowed = new Set([...required, ...optional]);
    const keys = Object.keys(result);
    const missing = required.filter((key) => !Object.hasOwn(result, key));
    const unknown = keys.filter((key) => !allowed.has(key));
    if (missing.length || unknown.length) fail(`${field} has an invalid shape`, 'CLASSSIGNIN_CLASSROOM_SOURCE_SCHEMA_INVALID', { missing, unknown });
    return result;
}

function exactRuntimeRecord(value: unknown, required: string[], optional: string[], field: string, code: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`, code);
    const result = value as Record<string, unknown>;
    const allowed = new Set([...required, ...optional]);
    const missing = required.filter((key) => !Object.hasOwn(result, key));
    const unknown = Object.keys(result).filter((key) => !allowed.has(key));
    if (missing.length || unknown.length) fail(`${field} has an invalid shape`, code, { missing, unknown });
    return result;
}

function text(value: unknown, field: string, maxLength = MAX_SOURCE_TEXT_LENGTH): string {
    if (typeof value !== 'string') fail(`${field} must be a string`);
    const result = value.trim();
    if (
        !result ||
        result.length > maxLength ||
        [...result].some((character) => {
            const code = character.codePointAt(0)!;
            return code < 32 || code === 127;
        })
    ) {
        fail(`${field} is invalid`);
    }
    return result;
}

function identityText(value: unknown, field: string, maxLength = MAX_SOURCE_TEXT_LENGTH): string {
    const result = text(value, field, maxLength);
    if (value !== result) {
        fail(`${field} must not contain surrounding whitespace`, 'CLASSSIGNIN_CLASSROOM_SOURCE_ID_NONCANONICAL');
    }
    return result;
}

function uuid(value: unknown, field: string): string {
    const result = identityText(value, field);
    if (!UUID.test(result) || result !== result.toLowerCase()) fail(`${field} must be a canonical lowercase UUID`);
    return result;
}

function isoDate(value: unknown, field: string): string {
    if (typeof value !== 'string') fail(`${field} must be an ISO timestamp`);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail(`${field} must be a canonical ISO timestamp`);
    return value;
}

function finiteNumber(value: unknown, field: string, min = -MAX_COORDINATE, max = MAX_COORDINATE): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${field} is outside the supported range`);
    return Object.is(value, -0) ? 0 : value;
}

function positiveDimension(value: unknown, field: string): number {
    return finiteNumber(value, field, Number.MIN_VALUE, MAX_COORDINATE);
}

function optionalDimensions(item: Record<string, unknown>, field: string): Pick<ClassSigninLayoutSeat, 'width' | 'height'> {
    const hasWidth = Object.hasOwn(item, 'width');
    const hasHeight = Object.hasOwn(item, 'height');
    if (hasWidth !== hasHeight) fail(`${field} must provide width and height together`);
    if (!hasWidth) return {};
    return {
        width: positiveDimension(item.width, `${field}.width`),
        height: positiveDimension(item.height, `${field}.height`),
    };
}

function withLayoutFingerprint(layout: Omit<ClassSigninClassroomLayout, 'fingerprint'>): ClassSigninClassroomLayout {
    return { ...layout, fingerprint: sha256(canonicalJson(layout)) };
}

function parseItemLayout(value: unknown[], field: string): ClassSigninClassroomLayout {
    if (value.length > MAX_LAYOUT_ITEMS) fail(`${field} contains too many items`);
    const seats: ClassSigninLayoutSeat[] = [];
    const decorations: ClassSigninLayoutDecoration[] = [];
    const itemIds = new Set<string>();
    for (const [index, raw] of value.entries()) {
        const itemField = `${field}[${index}]`;
        const item = exactRecord(raw, ['id', 'label', 'x', 'y', 'rotation', 'status', 'type'], ['width', 'height'], itemField);
        const id = identityText(item.id, `${itemField}.id`, 128);
        if (itemIds.has(id)) fail(`${field} contains duplicate item ID ${id}`, 'CLASSSIGNIN_CLASSROOM_DUPLICATE_ITEM_ID', { id });
        itemIds.add(id);
        const label = text(item.label, `${itemField}.label`, 128);
        const x = finiteNumber(item.x, `${itemField}.x`);
        const y = finiteNumber(item.y, `${itemField}.y`);
        const rotation = finiteNumber(item.rotation, `${itemField}.rotation`, -360, 360);
        const status = text(item.status, `${itemField}.status`, 64);
        const type = text(item.type, `${itemField}.type`, 64);
        const dimensions = optionalDimensions(item, itemField);
        if (type === 'seat') {
            seats.push({ sourceSeatId: id, label, x, y, ...dimensions, rotation, status });
        } else {
            decorations.push({ sourceItemId: id, label, x, y, ...dimensions, rotation, status, type });
        }
    }
    return withLayoutFingerprint({
        schemaVersion: 1,
        sourceFormat: 'items-v1',
        coordinateSystem: 'cartesian',
        seats,
        decorations,
    });
}

function positiveGridSize(value: unknown, field: string): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1_000) fail(`${field} is invalid`);
    return Number(value);
}

function parseLegacyLayout(value: Record<string, unknown>, field: string): ClassSigninClassroomLayout {
    const layout = exactRecord(value, ['rows', 'cols', 'seats', 'obstacles'], [], field);
    const rows = positiveGridSize(layout.rows, `${field}.rows`);
    const cols = positiveGridSize(layout.cols, `${field}.cols`);
    if (!Array.isArray(layout.seats) || layout.seats.length > MAX_LAYOUT_ITEMS) fail(`${field}.seats is invalid`);
    if (!Array.isArray(layout.obstacles)) fail(`${field}.obstacles must be an array`);
    if (layout.obstacles.length) {
        fail(`${field}.obstacles uses an unsupported legacy shape`, 'CLASSSIGNIN_CLASSROOM_LEGACY_OBSTACLE_UNSUPPORTED');
    }
    const seatIds = new Set<string>();
    const seats = layout.seats.map((raw, index): ClassSigninLayoutSeat => {
        const seatField = `${field}.seats[${index}]`;
        const seat = exactRecord(raw, ['id', 'row', 'col'], [], seatField);
        const sourceSeatId = identityText(seat.id, `${seatField}.id`, 128);
        if (seatIds.has(sourceSeatId)) {
            fail(`${field} contains duplicate seat ID ${sourceSeatId}`, 'CLASSSIGNIN_CLASSROOM_DUPLICATE_SEAT_ID', { sourceSeatId });
        }
        seatIds.add(sourceSeatId);
        if (!Number.isSafeInteger(seat.row) || Number(seat.row) < 0 || Number(seat.row) >= rows) fail(`${seatField}.row is outside the grid`);
        if (!Number.isSafeInteger(seat.col) || Number(seat.col) < 0 || Number(seat.col) >= cols) fail(`${seatField}.col is outside the grid`);
        return {
            sourceSeatId,
            label: sourceSeatId,
            x: Number(seat.col),
            y: Number(seat.row),
            rotation: 0,
            status: 'empty',
        };
    });
    return withLayoutFingerprint({
        schemaVersion: 1,
        sourceFormat: 'legacy-grid-v1',
        coordinateSystem: 'grid',
        rows,
        cols,
        seats,
        decorations: [],
    });
}

function parseLayout(value: unknown, field: string): ClassSigninClassroomLayout {
    if (value === null) {
        return withLayoutFingerprint({
            schemaVersion: 1,
            sourceFormat: 'empty',
            coordinateSystem: 'cartesian',
            seats: [],
            decorations: [],
        });
    }
    if (typeof value !== 'string') fail(`${field} must be a JSON string or null`);
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new ClassSigninClassroomMigrationError(`${field} is malformed JSON`, 'CLASSSIGNIN_CLASSROOM_LAYOUT_JSON_INVALID', undefined, {
            cause: error,
        });
    }
    if (Array.isArray(parsed)) return parseItemLayout(parsed, field);
    return parseLegacyLayout(record(parsed, field), field);
}

function parseSource(rawText: string): unknown {
    if (typeof rawText !== 'string' || !rawText.trim()) fail('source export is empty', 'CLASSSIGNIN_CLASSROOM_SOURCE_UNREADABLE');
    try {
        return JSON.parse(rawText);
    } catch (error) {
        throw new ClassSigninClassroomMigrationError('source export is malformed JSON', 'CLASSSIGNIN_CLASSROOM_SOURCE_JSON_INVALID', undefined, {
            cause: error,
        });
    }
}

export function validateClassSigninExport(rawText: string): ValidatedClassSigninExport {
    const root = exactRecord(
        parseSource(rawText),
        ['formatVersion', 'sourceSystem', 'sourceDatabase', 'postgresVersion', 'snapshotAt', 'migrations', 'schools', 'classrooms'],
        [],
        'source',
    );
    if (root.formatVersion !== 1) fail('source formatVersion is unsupported', 'CLASSSIGNIN_CLASSROOM_SOURCE_VERSION_UNSUPPORTED');
    if (root.sourceSystem !== CLASSSIGNIN_SOURCE_SYSTEM) fail('sourceSystem is unsupported');
    const sourceDatabase = text(root.sourceDatabase, 'source.sourceDatabase');
    const postgresVersion = text(root.postgresVersion, 'source.postgresVersion');
    const snapshotAt = isoDate(root.snapshotAt, 'source.snapshotAt');
    if (!Array.isArray(root.migrations) || !root.migrations.length) fail('source.migrations must be a non-empty array');
    const migrationIds = new Set<number>();
    const migrations = root.migrations.map((raw, index) => {
        const field = `source.migrations[${index}]`;
        const migration = exactRecord(raw, ['id', 'hash', 'createdAt'], [], field);
        if (!Number.isSafeInteger(migration.id) || Number(migration.id) < 1 || migrationIds.has(Number(migration.id))) fail(`${field}.id is invalid`);
        migrationIds.add(Number(migration.id));
        if (typeof migration.hash !== 'string' || !SHA256.test(migration.hash)) fail(`${field}.hash is invalid`);
        if (!Number.isSafeInteger(migration.createdAt) || Number(migration.createdAt) < 1) fail(`${field}.createdAt is invalid`);
        return { id: Number(migration.id), hash: migration.hash, createdAt: Number(migration.createdAt) };
    });
    if (!Array.isArray(root.schools) || !root.schools.length) fail('source.schools must be a non-empty array');
    const schoolIds = new Set<string>();
    const schools = root.schools.map((raw, index): ValidatedClassSigninSchool => {
        const field = `source.schools[${index}]`;
        const school = exactRecord(raw, ['id', 'code', 'name', 'isActive', 'createdAt', 'updatedAt'], [], field);
        const sourceSchoolId = uuid(school.id, `${field}.id`);
        if (schoolIds.has(sourceSchoolId)) fail(`${field}.id is duplicated`);
        schoolIds.add(sourceSchoolId);
        if (typeof school.isActive !== 'boolean') fail(`${field}.isActive must be boolean`);
        return {
            sourceSchoolId,
            code: text(school.code, `${field}.code`, 64),
            name: text(school.name, `${field}.name`, MAX_NAME_LENGTH),
            isActive: school.isActive,
            sourceCreatedAt: isoDate(school.createdAt, `${field}.createdAt`),
            sourceUpdatedAt: isoDate(school.updatedAt, `${field}.updatedAt`),
        };
    });
    if (!Array.isArray(root.classrooms)) fail('source.classrooms must be an array');
    const classroomIds = new Set<string>();
    const classrooms = root.classrooms.map((raw, index): ValidatedClassSigninClassroom => {
        const field = `source.classrooms[${index}]`;
        const classroom = exactRecord(raw, ['id', 'schoolId', 'name', 'layoutJson', 'createdAt', 'updatedAt'], [], field);
        const sourceClassroomId = uuid(classroom.id, `${field}.id`);
        if (classroomIds.has(sourceClassroomId)) fail(`${field}.id is duplicated`);
        classroomIds.add(sourceClassroomId);
        const sourceSchoolId = uuid(classroom.schoolId, `${field}.schoolId`);
        if (!schoolIds.has(sourceSchoolId)) fail(`${field}.schoolId references a missing school`, 'CLASSSIGNIN_CLASSROOM_CROSS_SCHOOL');
        const name = text(classroom.name, `${field}.name`, MAX_NAME_LENGTH);
        const sourceCreatedAt = isoDate(classroom.createdAt, `${field}.createdAt`);
        const sourceUpdatedAt = isoDate(classroom.updatedAt, `${field}.updatedAt`);
        const layout = parseLayout(classroom.layoutJson, `${field}.layoutJson`);
        return {
            sourceClassroomId,
            sourceSchoolId,
            name,
            sourceCreatedAt,
            sourceUpdatedAt,
            layout,
            sourceFingerprint: sha256(
                canonicalJson({ sourceClassroomId, sourceSchoolId, name, sourceCreatedAt, sourceUpdatedAt, layoutFingerprint: layout.fingerprint }),
            ),
        };
    });
    const canonical = {
        formatVersion: 1 as const,
        sourceSystem: CLASSSIGNIN_SOURCE_SYSTEM as typeof CLASSSIGNIN_SOURCE_SYSTEM,
        sourceDatabase,
        postgresVersion,
        snapshotAt,
        migrations,
        schools,
        classrooms,
    };
    return {
        ...canonical,
        sourceSha256: sha256(rawText),
        canonicalFingerprint: sha256(canonicalJson(canonical)),
        summary: {
            schoolCount: schools.length,
            classroomCount: classrooms.length,
            emptyLayoutCount: classrooms.filter((classroom) => classroom.layout.sourceFormat === 'empty').length,
            seatCount: classrooms.reduce((count, classroom) => count + classroom.layout.seats.length, 0),
            decorationCount: classrooms.reduce((count, classroom) => count + classroom.layout.decorations.length, 0),
        },
    };
}

function domainId(value: unknown, field: string): string {
    return identityText(value, field, 64);
}

function objectId(value: unknown, field: string): ObjectId {
    if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) fail(`${field} must be a BSON ObjectId`);
    return new ObjectId(value);
}

function serialized(value: unknown): unknown {
    return BSON.EJSON.serialize(value, { relaxed: false });
}

function hashValue(value: unknown): string {
    return sha256(canonicalJson(serialized(value)));
}

export function validateClassSigninManifest(rawText: string, source: ValidatedClassSigninExport): ValidatedClassSigninManifest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        throw new ClassSigninClassroomMigrationError(
            'migration manifest is malformed JSON',
            'CLASSSIGNIN_CLASSROOM_MANIFEST_JSON_INVALID',
            undefined,
            { cause: error },
        );
    }
    const manifest = exactRecord(parsed, ['schemaVersion', 'sourceSystem', 'sourceSha256', 'schoolMappings'], [], 'manifest');
    if (manifest.schemaVersion !== CLASSSIGNIN_CLASSROOM_MIGRATION_SCHEMA_VERSION) {
        fail('manifest schemaVersion is unsupported', 'CLASSSIGNIN_CLASSROOM_MANIFEST_VERSION_UNSUPPORTED');
    }
    if (manifest.sourceSystem !== CLASSSIGNIN_SOURCE_SYSTEM || manifest.sourceSystem !== source.sourceSystem) {
        fail('manifest sourceSystem is invalid');
    }
    if (typeof manifest.sourceSha256 !== 'string' || !SHA256.test(manifest.sourceSha256)) fail('manifest sourceSha256 is invalid');
    if (manifest.sourceSha256 !== source.sourceSha256) {
        fail('source export does not match manifest sourceSha256', 'CLASSSIGNIN_CLASSROOM_SOURCE_FINGERPRINT_MISMATCH', {
            expected: manifest.sourceSha256,
            actual: source.sourceSha256,
        });
    }
    if (!Array.isArray(manifest.schoolMappings) || !manifest.schoolMappings.length || manifest.schoolMappings.length > source.schools.length) {
        fail('manifest schoolMappings is invalid');
    }
    const sourceSchoolIds = new Set(source.schools.map((school) => school.sourceSchoolId));
    const mappedSourceIds = new Set<string>();
    const mappedTargetIds = new Set<string>();
    const schoolMappings = manifest.schoolMappings.map((raw, index): ClassSigninSchoolMapping => {
        const field = `manifest.schoolMappings[${index}]`;
        const mapping = exactRecord(raw, ['sourceSchoolId', 'domainId', 'schoolId'], [], field);
        const sourceSchoolId = uuid(mapping.sourceSchoolId, `${field}.sourceSchoolId`);
        const targetDomainId = domainId(mapping.domainId, `${field}.domainId`);
        const schoolId = objectId(mapping.schoolId, `${field}.schoolId`);
        if (!sourceSchoolIds.has(sourceSchoolId)) {
            fail(`${field}.sourceSchoolId is absent from the source export`, 'CLASSSIGNIN_CLASSROOM_CROSS_SCHOOL');
        }
        if (mappedSourceIds.has(sourceSchoolId)) fail(`${field}.sourceSchoolId is mapped more than once`);
        mappedSourceIds.add(sourceSchoolId);
        const targetIdentity = `${targetDomainId}\0${schoolId.toHexString()}`;
        if (mappedTargetIds.has(targetIdentity)) fail(`${field} maps multiple source schools to one userbind school`);
        mappedTargetIds.add(targetIdentity);
        return { sourceSchoolId, domainId: targetDomainId, schoolId };
    });
    if (new Set(schoolMappings.map((mapping) => mapping.domainId)).size !== 1) {
        fail('one migration manifest must target exactly one domain', 'CLASSSIGNIN_CLASSROOM_MULTI_DOMAIN_UNSUPPORTED');
    }
    schoolMappings.sort(
        (left, right) =>
            left.sourceSchoolId.localeCompare(right.sourceSchoolId) ||
            left.domainId.localeCompare(right.domainId) ||
            left.schoolId.toHexString().localeCompare(right.schoolId.toHexString()),
    );
    const canonical = {
        schemaVersion: CLASSSIGNIN_CLASSROOM_MIGRATION_SCHEMA_VERSION as 1,
        sourceSystem: CLASSSIGNIN_SOURCE_SYSTEM as typeof CLASSSIGNIN_SOURCE_SYSTEM,
        sourceSha256: manifest.sourceSha256,
        schoolMappings,
    };
    return { ...canonical, fingerprint: hashValue(canonical) };
}

function mappingKey(domain: string, schoolId: ObjectId, sourceSchoolId: string): string {
    return `${domain}\0${schoolId.toHexString()}\0${sourceSchoolId}`;
}

function classroomIdentity(domain: string, sourceClassroomId: string): string {
    return `${domain}\0${sourceClassroomId}`;
}

function deterministicClassroomId(domain: string, sourceClassroomId: string): ObjectId {
    return new ObjectId(sha256(`${CLASSSIGNIN_SOURCE_SYSTEM}\0${domain}\0${sourceClassroomId}`).slice(0, 24));
}

function sortedDocuments<T extends { _id: ObjectId }>(values: T[]): T[] {
    return [...values].sort((left, right) => left._id.toHexString().localeCompare(right._id.toHexString()));
}

function storedCanonicalText(value: unknown, field: string, maxLength: number): string {
    if (
        typeof value !== 'string' ||
        !value ||
        value !== value.trim() ||
        value.length > maxLength ||
        [...value].some((character) => {
            const code = character.codePointAt(0)!;
            return code < 32 || code === 127;
        })
    ) {
        fail(`${field} is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    return value;
}

function storedCanonicalNumber(value: unknown, field: string, min = -MAX_COORDINATE, max = MAX_COORDINATE): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < min || value > max) {
        fail(`${field} is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    return value;
}

function assertStoredDimensions(item: Record<string, unknown>, field: string): void {
    const hasWidth = Object.hasOwn(item, 'width');
    const hasHeight = Object.hasOwn(item, 'height');
    if (hasWidth !== hasHeight) fail(`${field} dimensions are incomplete`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    if (!hasWidth) return;
    storedCanonicalNumber(item.width, `${field}.width`, Number.MIN_VALUE);
    storedCanonicalNumber(item.height, `${field}.height`, Number.MIN_VALUE);
}

function assertStoredSeat(value: unknown, field: string): string {
    const seat = exactRuntimeRecord(
        value,
        ['sourceSeatId', 'label', 'x', 'y', 'rotation', 'status'],
        ['width', 'height'],
        field,
        'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID',
    );
    const sourceSeatId = storedCanonicalText(seat.sourceSeatId, `${field}.sourceSeatId`, 128);
    storedCanonicalText(seat.label, `${field}.label`, 128);
    storedCanonicalNumber(seat.x, `${field}.x`);
    storedCanonicalNumber(seat.y, `${field}.y`);
    storedCanonicalNumber(seat.rotation, `${field}.rotation`, -360, 360);
    storedCanonicalText(seat.status, `${field}.status`, 64);
    assertStoredDimensions(seat, field);
    return sourceSeatId;
}

function assertStoredDecoration(value: unknown, field: string): string {
    const decoration = exactRuntimeRecord(
        value,
        ['sourceItemId', 'label', 'x', 'y', 'rotation', 'status', 'type'],
        ['width', 'height'],
        field,
        'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID',
    );
    const sourceItemId = storedCanonicalText(decoration.sourceItemId, `${field}.sourceItemId`, 128);
    storedCanonicalText(decoration.label, `${field}.label`, 128);
    storedCanonicalNumber(decoration.x, `${field}.x`);
    storedCanonicalNumber(decoration.y, `${field}.y`);
    storedCanonicalNumber(decoration.rotation, `${field}.rotation`, -360, 360);
    storedCanonicalText(decoration.status, `${field}.status`, 64);
    const type = storedCanonicalText(decoration.type, `${field}.type`, 64);
    if (type === 'seat') fail(`${field}.type cannot be seat`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    assertStoredDimensions(decoration, field);
    return sourceItemId;
}

function assertStoredLayoutIntegrity(layout: ClassSigninClassroomLayout, field: string): void {
    exactRuntimeRecord(
        layout,
        ['schemaVersion', 'sourceFormat', 'coordinateSystem', 'seats', 'decorations', 'fingerprint'],
        ['rows', 'cols'],
        field,
        'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID',
    );
    if (
        layout.schemaVersion !== 1 ||
        !['empty', 'items-v1', 'legacy-grid-v1'].includes(layout.sourceFormat) ||
        !['cartesian', 'grid'].includes(layout.coordinateSystem) ||
        !Array.isArray(layout.seats) ||
        !Array.isArray(layout.decorations) ||
        layout.seats.length + layout.decorations.length > MAX_LAYOUT_ITEMS ||
        !SHA256.test(layout.fingerprint || '')
    ) {
        fail(`${field} items are invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    const identities = new Set<string>();
    for (const [index, seat] of layout.seats.entries()) {
        const id = assertStoredSeat(seat, `${field}.seats[${index}]`);
        if (identities.has(id)) fail(`${field} contains duplicate item identity`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        identities.add(id);
    }
    for (const [index, decoration] of layout.decorations.entries()) {
        const id = assertStoredDecoration(decoration, `${field}.decorations[${index}]`);
        if (identities.has(id)) fail(`${field} contains duplicate item identity`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        identities.add(id);
    }
    const hasRows = Object.hasOwn(layout, 'rows');
    const hasCols = Object.hasOwn(layout, 'cols');
    if (layout.sourceFormat === 'legacy-grid-v1') {
        if (layout.coordinateSystem !== 'grid' || !hasRows || !hasCols) {
            fail(`${field} legacy grid discriminator is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        if (
            !Number.isSafeInteger(layout.rows) ||
            Number(layout.rows) < 1 ||
            Number(layout.rows) > 1_000 ||
            !Number.isSafeInteger(layout.cols) ||
            Number(layout.cols) < 1 ||
            Number(layout.cols) > 1_000
        ) {
            fail(`${field} grid dimensions are invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        const rows = Number(layout.rows);
        const cols = Number(layout.cols);
        if (layout.decorations.length) fail(`${field} legacy grid has decorations`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        for (const [index, seat] of layout.seats.entries()) {
            if (
                !Number.isSafeInteger(seat.x) ||
                seat.x < 0 ||
                seat.x >= cols ||
                !Number.isSafeInteger(seat.y) ||
                seat.y < 0 ||
                seat.y >= rows ||
                seat.label !== seat.sourceSeatId ||
                seat.rotation !== 0 ||
                seat.status !== 'empty' ||
                seat.width !== undefined ||
                seat.height !== undefined
            ) {
                fail(`${field}.seats[${index}] is not a canonical grid seat`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
            }
        }
    } else {
        if (layout.coordinateSystem !== 'cartesian' || hasRows || hasCols) {
            fail(`${field} cartesian discriminator is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        if (layout.sourceFormat === 'empty' && (layout.seats.length || layout.decorations.length)) {
            fail(`${field} empty layout contains items`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
    }
    const { fingerprint, ...payload } = layout;
    if (sha256(canonicalJson(payload)) !== fingerprint) {
        fail(`${field} fingerprint does not match its contents`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
}

function assertStoredClassroomIntegrity(classroom: ExamClassroomDoc, field: string): void {
    exactRuntimeRecord(
        classroom,
        [
            '_id',
            'domainId',
            'schoolId',
            'name',
            'status',
            'sourceSystem',
            'sourceSchoolId',
            'sourceClassroomId',
            'sourceFingerprint',
            'sourceSnapshotAt',
            'importBatchId',
            'revision',
            'layoutRevision',
            'layoutRevisions',
            'createdAt',
            'createdBy',
            'updatedAt',
            'updatedBy',
        ],
        ['archivedAt', 'archivedBy'],
        field,
        'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID',
    );
    if (
        !classroom ||
        typeof classroom !== 'object' ||
        !(classroom._id instanceof ObjectId) ||
        !(classroom.schoolId instanceof ObjectId) ||
        classroom.sourceSystem !== CLASSSIGNIN_SOURCE_SYSTEM ||
        !Number.isSafeInteger(classroom.revision) ||
        classroom.revision < 1 ||
        !Number.isSafeInteger(classroom.layoutRevision) ||
        classroom.layoutRevision < 1 ||
        classroom.layoutRevision > classroom.revision ||
        !Array.isArray(classroom.layoutRevisions) ||
        classroom.layoutRevisions.length !== classroom.layoutRevision ||
        !(classroom.createdAt instanceof Date) ||
        !Number.isFinite(classroom.createdAt.getTime()) ||
        !(classroom.updatedAt instanceof Date) ||
        !Number.isFinite(classroom.updatedAt.getTime()) ||
        classroom.createdAt.getTime() > classroom.updatedAt.getTime() ||
        !Number.isSafeInteger(classroom.createdBy) ||
        classroom.createdBy < 1 ||
        !Number.isSafeInteger(classroom.updatedBy) ||
        classroom.updatedBy < 1 ||
        !SHA256.test(classroom.sourceFingerprint || '') ||
        !['active', 'archived'].includes(classroom.status)
    ) {
        fail(`${field} is not a canonical exam classroom`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    identityText(classroom.domainId, `${field}.domainId`, 64);
    identityText(classroom.name, `${field}.name`, MAX_NAME_LENGTH);
    identityText(classroom.importBatchId, `${field}.importBatchId`, 128);
    const sourceSchoolId = identityText(classroom.sourceSchoolId, `${field}.sourceSchoolId`, 64);
    const sourceClassroomId = identityText(classroom.sourceClassroomId, `${field}.sourceClassroomId`, 64);
    if (
        !UUID.test(sourceSchoolId) ||
        sourceSchoolId !== sourceSchoolId.toLowerCase() ||
        !UUID.test(sourceClassroomId) ||
        sourceClassroomId !== sourceClassroomId.toLowerCase()
    ) {
        fail(`${field} source identity is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    isoDate(classroom.sourceSnapshotAt, `${field}.sourceSnapshotAt`);
    const hasArchivedAt = Object.hasOwn(classroom, 'archivedAt');
    const hasArchivedBy = Object.hasOwn(classroom, 'archivedBy');
    if (
        (classroom.status === 'archived' &&
            (!hasArchivedAt ||
                !hasArchivedBy ||
                !(classroom.archivedAt instanceof Date) ||
                !Number.isFinite(classroom.archivedAt.getTime()) ||
                classroom.archivedAt.getTime() < classroom.createdAt.getTime() ||
                classroom.archivedAt.getTime() > classroom.updatedAt.getTime() ||
                !Number.isSafeInteger(classroom.archivedBy) ||
                Number(classroom.archivedBy) < 1)) ||
        (classroom.status === 'active' && (hasArchivedAt || hasArchivedBy))
    ) {
        fail(`${field} archive state is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    const revisions = new Set<number>();
    let previousImportedAt = classroom.createdAt.getTime();
    for (const [index, revision] of classroom.layoutRevisions.entries()) {
        exactRuntimeRecord(
            revision,
            ['revision', 'fingerprint', 'sourceSnapshotAt', 'importBatchId', 'importedAt', 'importedBy', 'snapshot'],
            [],
            `${field}.layoutRevisions[${index}]`,
            'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID',
        );
        if (
            !revision ||
            revision.revision !== index + 1 ||
            revisions.has(revision.revision) ||
            revision.fingerprint !== revision.snapshot?.fingerprint ||
            !(revision.importedAt instanceof Date) ||
            !Number.isFinite(revision.importedAt.getTime()) ||
            revision.importedAt.getTime() < previousImportedAt ||
            revision.importedAt.getTime() > classroom.updatedAt.getTime() ||
            !Number.isSafeInteger(revision.importedBy) ||
            revision.importedBy < 1 ||
            !SHA256.test(revision.fingerprint || '')
        ) {
            fail(`${field}.layoutRevisions[${index}] is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        previousImportedAt = revision.importedAt.getTime();
        revisions.add(revision.revision);
        identityText(revision.importBatchId, `${field}.layoutRevisions[${index}].importBatchId`, 128);
        isoDate(revision.sourceSnapshotAt, `${field}.layoutRevisions[${index}].sourceSnapshotAt`);
        assertStoredLayoutIntegrity(revision.snapshot, `${field}.layoutRevisions[${index}].snapshot`);
    }
    if (!currentLayout(classroom)) fail(`${field} has no unique current layout`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
}

export function assertExamClassroomIntegrity(classroom: ExamClassroomDoc): void {
    assertStoredClassroomIntegrity(classroom, `exam.classrooms/${classroom?._id?.toString() || 'unknown'}`);
}

function stateFingerprint(value: ExamClassroomDoc): string {
    assertStoredClassroomIntegrity(value, `exam.classrooms/${value?._id?.toString() || 'unknown'}`);
    return hashValue(value);
}

function currentLayout(classroom: ExamClassroomDoc): ExamClassroomLayoutRevision | null {
    const matches = classroom.layoutRevisions.filter((revision) => revision.revision === classroom.layoutRevision);
    return matches.length === 1 ? matches[0] : null;
}

function entryBeforeState(entry: ClassSigninClassroomMigrationEntry): ExamClassroomDoc | null {
    if (entry.beforeState === null) {
        if (entry.beforeStateFingerprint !== null) {
            fail('add entry has a before-state fingerprint', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
        return null;
    }
    let value: unknown;
    try {
        value = BSON.EJSON.deserialize(entry.beforeState as Parameters<typeof BSON.EJSON.deserialize>[0]);
    } catch (error) {
        throw new ClassSigninClassroomMigrationError(
            `classroom ${entry.classroomId} before state is invalid Extended JSON`,
            'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED',
            undefined,
            { cause: error },
        );
    }
    assertStoredClassroomIntegrity(value as ExamClassroomDoc, `plan entry ${entry.classroomId} beforeState`);
    const classroom = value as ExamClassroomDoc;
    if (
        classroom._id.toHexString() !== entry.classroomId ||
        classroom.domainId !== entry.domainId ||
        classroom.schoolId.toHexString() !== entry.schoolId ||
        classroom.sourceSchoolId !== entry.sourceSchoolId ||
        classroom.sourceClassroomId !== entry.sourceClassroomId ||
        entry.beforeStateFingerprint !== stateFingerprint(classroom)
    ) {
        fail(`classroom ${entry.classroomId} before state identity is invalid`, 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    }
    return classroom;
}

function mappedSnapshotFacts(
    manifest: ValidatedClassSigninManifest,
    snapshot: ClassSigninClassroomMigrationSnapshot,
): {
    managed: ExamClassroomDoc[];
    nonTarget: ExamClassroomDoc[];
    mappingKeys: Set<string>;
} {
    const mappingKeys = new Set(manifest.schoolMappings.map((mapping) => mappingKey(mapping.domainId, mapping.schoolId, mapping.sourceSchoolId)));
    const managed: ExamClassroomDoc[] = [];
    const nonTarget: ExamClassroomDoc[] = [];
    for (const classroom of snapshot.classrooms) {
        const key = mappingKey(classroom.domainId, classroom.schoolId, classroom.sourceSchoolId);
        if (classroom.sourceSystem === CLASSSIGNIN_SOURCE_SYSTEM && mappingKeys.has(key)) managed.push(classroom);
        else nonTarget.push(classroom);
    }
    return { managed, nonTarget, mappingKeys };
}

function assertSnapshotReferenceIntegrity(snapshot: ClassSigninClassroomMigrationSnapshot): void {
    if (!Array.isArray(snapshot.references)) {
        fail('classroom reference snapshot is not an array', 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
    }
    const classroomsById = new Map<string, ExamClassroomDoc>();
    for (const classroom of snapshot.classrooms) {
        const classroomId = classroom._id.toHexString();
        if (classroomsById.has(classroomId)) {
            fail(`duplicate classroom ID ${classroomId}`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        classroomsById.set(classroomId, classroom);
    }
    const identities = new Set<string>();
    for (const [index, reference] of snapshot.references.entries()) {
        const field = `snapshot.references[${index}]`;
        exactRuntimeRecord(
            reference,
            ['domainId', 'classroomId', 'kind', 'referenceId'],
            ['sourceSeatId'],
            field,
            'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID',
        );
        const domain = storedCanonicalText(reference.domainId, `${field}.domainId`, 64);
        if (!(reference.classroomId instanceof ObjectId)) {
            fail(`${field}.classroomId is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        if (!['endpoint-seat-binding', 'exam-target', 'exam-seat-plan', 'exam-seat-assignment'].includes(reference.kind)) {
            fail(`${field}.kind is invalid`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        const referenceId = storedCanonicalText(reference.referenceId, `${field}.referenceId`, 512);
        const hasSeatId = Object.hasOwn(reference, 'sourceSeatId');
        const sourceSeatId = hasSeatId ? storedCanonicalText(reference.sourceSeatId, `${field}.sourceSeatId`, 128) : undefined;
        if ((reference.kind === 'endpoint-seat-binding' || reference.kind === 'exam-seat-assignment') && !sourceSeatId) {
            fail(`${field} requires a seat identity`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        const classroom = classroomsById.get(reference.classroomId.toHexString());
        if (!classroom) fail(`${field} points to a missing classroom`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        if (classroom.domainId !== domain) fail(`${field} crosses classroom domains`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        if (classroom.status !== 'active') fail(`${field} points to an archived classroom`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        if (sourceSeatId) {
            const matches = currentLayout(classroom)!.snapshot.seats.filter((seat) => seat.sourceSeatId === sourceSeatId);
            if (matches.length !== 1) fail(`${field} points to a missing seat`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        }
        const identity = `${domain}\0${reference.classroomId.toHexString()}\0${reference.kind}\0${sourceSeatId || ''}\0${referenceId}`;
        if (identities.has(identity)) fail(`${field} duplicates a reference fact`, 'CLASSSIGNIN_CLASSROOM_DATABASE_INVALID');
        identities.add(identity);
    }
}

function entryOrder(left: ClassSigninClassroomMigrationEntry, right: ClassSigninClassroomMigrationEntry): number {
    return (
        left.domainId.localeCompare(right.domainId) ||
        left.schoolId.localeCompare(right.schoolId) ||
        left.sourceClassroomId.localeCompare(right.sourceClassroomId)
    );
}

function planPayload(plan: Omit<ClassSigninClassroomMigrationPlan, 'fingerprint' | 'confirmationToken' | 'execution' | 'verification'>): unknown {
    return plan;
}

export function buildClassSigninClassroomMigrationPlan(
    source: ValidatedClassSigninExport,
    manifest: ValidatedClassSigninManifest,
    snapshot: ClassSigninClassroomMigrationSnapshot,
    generatedAt = new Date(),
): ClassSigninClassroomMigrationPlan {
    if (!(generatedAt instanceof Date) || !Number.isFinite(generatedAt.getTime())) fail('plan generatedAt is invalid');
    if (manifest.sourceSha256 !== source.sourceSha256) fail('manifest and source fingerprints differ');
    for (const [index, classroom] of snapshot.classrooms.entries()) {
        assertStoredClassroomIntegrity(classroom, `snapshot.classrooms[${index}]`);
    }
    assertSnapshotReferenceIntegrity(snapshot);
    for (const [index, classroom] of source.classrooms.entries()) {
        assertStoredLayoutIntegrity(classroom.layout, `source.classrooms[${index}].layout`);
    }
    const mappingsBySource = new Map(manifest.schoolMappings.map((mapping) => [mapping.sourceSchoolId, mapping]));
    const selectedSchools = snapshot.schools
        .filter((school) => manifest.schoolMappings.some((mapping) => mapping.domainId === school.domainId && mapping.schoolId.equals(school._id)))
        .sort((left, right) => `${left.domainId}\0${left._id}`.localeCompare(`${right.domainId}\0${right._id}`));
    const planConflicts = manifest.schoolMappings
        .filter((mapping) => !selectedSchools.some((school) => school.domainId === mapping.domainId && school._id.equals(mapping.schoolId)))
        .map((mapping) => `missing_userbind_school:${mapping.domainId}/${mapping.schoolId.toHexString()}`);
    const { managed, nonTarget } = mappedSnapshotFacts(manifest, snapshot);
    const allByIdentity = new Map<string, ExamClassroomDoc[]>();
    for (const classroom of snapshot.classrooms) {
        const identity = classroomIdentity(classroom.domainId, classroom.sourceClassroomId);
        const values = allByIdentity.get(identity) || [];
        values.push(classroom);
        allByIdentity.set(identity, values);
    }
    const allById = new Map(snapshot.classrooms.map((classroom) => [classroom._id.toHexString(), classroom]));
    const referencesByClassroom = new Map<string, ExamClassroomReferenceFact[]>();
    for (const reference of snapshot.references) {
        const key = `${reference.domainId}\0${reference.classroomId.toHexString()}`;
        const values = referencesByClassroom.get(key) || [];
        values.push(reference);
        referencesByClassroom.set(key, values);
    }
    const entries: ClassSigninClassroomMigrationEntry[] = [];
    const desiredIdentities = new Set<string>();
    const mappedClassrooms = source.classrooms.filter((classroom) => mappingsBySource.has(classroom.sourceSchoolId));
    for (const desired of mappedClassrooms) {
        const mapping = mappingsBySource.get(desired.sourceSchoolId)!;
        const identity = classroomIdentity(mapping.domainId, desired.sourceClassroomId);
        desiredIdentities.add(identity);
        const matches = allByIdentity.get(identity) || [];
        const deterministicId = deterministicClassroomId(mapping.domainId, desired.sourceClassroomId);
        const existing = matches.length === 1 ? matches[0] : null;
        const conflicts: string[] = [];
        if (matches.length > 1) conflicts.push('duplicate_source_classroom_identity');
        if (
            existing &&
            (existing.sourceSystem !== CLASSSIGNIN_SOURCE_SYSTEM ||
                existing.sourceSchoolId !== desired.sourceSchoolId ||
                existing.domainId !== mapping.domainId ||
                !existing.schoolId.equals(mapping.schoolId))
        ) {
            conflicts.push('source_classroom_cross_school');
        }
        const idCollision = allById.get(deterministicId.toHexString());
        if (!existing && idCollision) conflicts.push('target_classroom_id_collision');
        const layout = existing ? currentLayout(existing) : null;
        if (existing && !layout) conflicts.push('invalid_current_layout_revision');
        const existingSeatIds = new Set(layout?.snapshot.seats.map((seat) => seat.sourceSeatId) || []);
        const desiredSeatIds = new Set(desired.layout.seats.map((seat) => seat.sourceSeatId));
        const removedSeatIds = [...existingSeatIds].filter((seatId) => !desiredSeatIds.has(seatId)).sort();
        const references = existing ? referencesByClassroom.get(`${existing.domainId}\0${existing._id.toHexString()}`) || [] : [];
        const referencedRemovedSeats = removedSeatIds.filter((seatId) =>
            references.some((reference) => !reference.sourceSeatId || reference.sourceSeatId === seatId),
        );
        if (referencedRemovedSeats.length) conflicts.push(`referenced_seat_removed:${referencedRemovedSeats.join(',')}`);
        const layoutChanged = !layout || layout.fingerprint !== desired.layout.fingerprint;
        const changed =
            !existing ||
            existing.status !== 'active' ||
            existing.name !== desired.name ||
            existing.sourceFingerprint !== desired.sourceFingerprint ||
            existing.sourceSnapshotAt !== source.snapshotAt ||
            layoutChanged;
        const action: ClassSigninClassroomMigrationAction = conflicts.length ? 'conflict' : !existing ? 'add' : changed ? 'update' : 'unchanged';
        entries.push({
            action,
            domainId: mapping.domainId,
            schoolId: mapping.schoolId.toHexString(),
            classroomId: (existing?._id || deterministicId).toHexString(),
            sourceSchoolId: desired.sourceSchoolId,
            sourceClassroomId: desired.sourceClassroomId,
            name: desired.name,
            beforeState: existing ? serialized(existing) : null,
            beforeStateFingerprint: existing ? stateFingerprint(existing) : null,
            targetRevision: existing ? existing.revision + (action === 'update' ? 1 : 0) : 1,
            targetLayoutRevision: existing ? existing.layoutRevision + (action === 'update' && layoutChanged ? 1 : 0) : 1,
            desired: {
                name: desired.name,
                status: 'active',
                sourceFingerprint: desired.sourceFingerprint,
                sourceSnapshotAt: source.snapshotAt,
                layout: desired.layout,
            },
            removedSeatIds,
            conflicts,
        });
    }
    for (const existing of managed) {
        const identity = classroomIdentity(existing.domainId, existing.sourceClassroomId);
        if (desiredIdentities.has(identity)) continue;
        const references = referencesByClassroom.get(`${existing.domainId}\0${existing._id.toHexString()}`) || [];
        const conflicts =
            existing.status === 'active' && references.length
                ? [
                      `referenced_classroom_removed:${references
                          .map((item) => item.referenceId)
                          .sort()
                          .join(',')}`,
                  ]
                : [];
        const action: ClassSigninClassroomMigrationAction = conflicts.length ? 'conflict' : existing.status === 'active' ? 'archive' : 'unchanged';
        entries.push({
            action,
            domainId: existing.domainId,
            schoolId: existing.schoolId.toHexString(),
            classroomId: existing._id.toHexString(),
            sourceSchoolId: existing.sourceSchoolId,
            sourceClassroomId: existing.sourceClassroomId,
            name: existing.name,
            beforeState: serialized(existing),
            beforeStateFingerprint: stateFingerprint(existing),
            targetRevision: existing.revision + (action === 'archive' ? 1 : 0),
            targetLayoutRevision: existing.layoutRevision,
            removedSeatIds:
                currentLayout(existing)
                    ?.snapshot.seats.map((seat) => seat.sourceSeatId)
                    .sort() || [],
            conflicts,
        });
    }
    entries.sort(entryOrder);
    const batchId = `classsignin:${sha256(`${source.canonicalFingerprint}\0${manifest.fingerprint}`)}`;
    const base = {
        schemaVersion: CLASSSIGNIN_CLASSROOM_MIGRATION_SCHEMA_VERSION as 1,
        generatedAt: generatedAt.toISOString(),
        batchId,
        source: {
            sourceSha256: source.sourceSha256,
            canonicalFingerprint: source.canonicalFingerprint,
            snapshotAt: source.snapshotAt,
            mappedSchoolCount: manifest.schoolMappings.length,
            ignoredSchoolCount: source.schools.length - manifest.schoolMappings.length,
            mappedClassroomCount: mappedClassrooms.length,
            ignoredClassroomCount: source.classrooms.length - mappedClassrooms.length,
        },
        manifest: {
            fingerprint: manifest.fingerprint,
            schoolMappings: manifest.schoolMappings.map((mapping) => ({
                sourceSchoolId: mapping.sourceSchoolId,
                domainId: mapping.domainId,
                schoolId: mapping.schoolId.toHexString(),
            })),
        },
        databaseBefore: {
            schoolFingerprint: hashValue(selectedSchools),
            managedFingerprint: hashValue(sortedDocuments(managed)),
            nonTargetFingerprint: hashValue(sortedDocuments(nonTarget)),
            referenceFingerprint: hashValue(
                [...snapshot.references].sort((left, right) =>
                    `${left.domainId}\0${left.classroomId}\0${left.sourceSeatId || ''}\0${left.kind}\0${left.referenceId}`.localeCompare(
                        `${right.domainId}\0${right.classroomId}\0${right.sourceSeatId || ''}\0${right.kind}\0${right.referenceId}`,
                    ),
                ),
            ),
        },
        conflicts: planConflicts,
        entries,
        summary: {
            added: entries.filter((entry) => entry.action === 'add').length,
            updated: entries.filter((entry) => entry.action === 'update').length,
            archived: entries.filter((entry) => entry.action === 'archive').length,
            unchanged: entries.filter((entry) => entry.action === 'unchanged').length,
            conflicts: planConflicts.length + entries.filter((entry) => entry.action === 'conflict').length,
            seats: mappedClassrooms.reduce((count, classroom) => count + classroom.layout.seats.length, 0),
            decorations: mappedClassrooms.reduce((count, classroom) => count + classroom.layout.decorations.length, 0),
        },
    };
    const fingerprint = hashValue(planPayload(base));
    return { ...base, fingerprint, confirmationToken: `APPLY:classsignin-classrooms:${fingerprint}` };
}

export function classSigninClassroomMigrationFingerprint(plan: ClassSigninClassroomMigrationPlan): string {
    const { fingerprint: _fingerprint, confirmationToken: _confirmationToken, execution: _execution, verification: _verification, ...base } = plan;
    return hashValue(planPayload(base));
}

export function assertClassSigninClassroomMigrationPlan(plan: ClassSigninClassroomMigrationPlan): void {
    if (!plan || typeof plan !== 'object' || plan.schemaVersion !== CLASSSIGNIN_CLASSROOM_MIGRATION_SCHEMA_VERSION) {
        fail('migration plan schemaVersion is unsupported', 'CLASSSIGNIN_CLASSROOM_PLAN_INVALID');
    }
    if (
        !Array.isArray(plan.entries) ||
        !Array.isArray(plan.conflicts) ||
        !plan.source ||
        !plan.manifest ||
        !Array.isArray(plan.manifest.schoolMappings) ||
        !plan.databaseBefore ||
        !plan.summary
    ) {
        fail('migration plan shape is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_INVALID');
    }
    if (!SHA256.test(plan.fingerprint || '') || classSigninClassroomMigrationFingerprint(plan) !== plan.fingerprint) {
        fail('migration plan fingerprint is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    }
    if (plan.confirmationToken !== `APPLY:classsignin-classrooms:${plan.fingerprint}`) {
        fail('migration plan confirmation token is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    }
    if (plan.entries.some((entry) => !ObjectId.isValid(entry.classroomId) || !ObjectId.isValid(entry.schoolId))) {
        fail('migration plan contains an invalid target identity', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    }
    if (new Set(plan.entries.map((entry) => entry.classroomId)).size !== plan.entries.length) {
        fail('migration plan contains duplicate classroom targets', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    }
    for (const entry of plan.entries) entryBeforeState(entry);
    if (
        plan.execution &&
        (!Number.isSafeInteger(plan.execution.revision) ||
            plan.execution.revision < 1 ||
            !Number.isSafeInteger(plan.execution.actor) ||
            plan.execution.actor < 1 ||
            !['applying', 'applied', 'failed'].includes(plan.execution.state) ||
            !Array.isArray(plan.execution.results))
    ) {
        fail('migration execution state is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    }
    if (plan.execution) {
        exactRuntimeRecord(
            plan.execution,
            ['revision', 'actor', 'state', 'startedAt', 'updatedAt', 'results'],
            ['completedAt', 'previousBatchFingerprint', 'lastError', 'auditId'],
            'plan.execution',
            'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED',
        );
        isoDate(plan.execution.startedAt, 'plan.execution.startedAt');
        isoDate(plan.execution.updatedAt, 'plan.execution.updatedAt');
        const startedAt = new Date(plan.execution.startedAt).getTime();
        const updatedAt = new Date(plan.execution.updatedAt).getTime();
        if (updatedAt < startedAt) {
            fail('migration execution timestamps are not monotonic', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
        if (plan.execution.previousBatchFingerprint !== undefined && !SHA256.test(plan.execution.previousBatchFingerprint)) {
            fail('migration execution predecessor fingerprint is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
        const entries = new Map(plan.entries.map((entry) => [entry.classroomId, entry]));
        const resultIds = new Set<string>();
        for (const [index, result] of plan.execution.results.entries()) {
            exactRuntimeRecord(
                result,
                ['classroomId', 'action', 'result', 'at'],
                [],
                `plan.execution.results[${index}]`,
                'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED',
            );
            const entry = result && entries.get(result.classroomId);
            if (!entry || resultIds.has(result.classroomId) || result.action !== entry.action || !['applied', 'no-op'].includes(result.result)) {
                fail(`migration execution result ${index} is invalid`, 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
            }
            resultIds.add(result.classroomId);
            isoDate(result.at, `plan.execution.results[${index}].at`);
            const resultAt = new Date(result.at).getTime();
            if (resultAt < startedAt || resultAt > updatedAt) {
                fail(`migration execution result ${index} has an invalid timestamp`, 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
            }
        }
        if (plan.execution.results.some((result, index, values) => index > 0 && values[index - 1].classroomId >= result.classroomId)) {
            fail('migration execution results are not in canonical order', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
        if (plan.execution.state === 'applied') {
            if (
                resultIds.size !== plan.entries.length ||
                !plan.execution.completedAt ||
                typeof plan.execution.auditId !== 'string' ||
                !ObjectId.isValid(plan.execution.auditId) ||
                plan.execution.auditId !== successAuditId(plan) ||
                plan.execution.lastError !== undefined
            ) {
                fail('applied migration execution is incomplete', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
            }
            isoDate(plan.execution.completedAt, 'plan.execution.completedAt');
            const deterministicCompletedAt = plan.execution.results.reduce(
                (latest, result) => Math.max(latest, new Date(result.at).getTime()),
                startedAt,
            );
            const completedAt = new Date(plan.execution.completedAt).getTime();
            if (completedAt !== deterministicCompletedAt || completedAt > updatedAt) {
                fail('applied migration completion timestamp is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
            }
        }
        if (plan.execution.state !== 'applied' && (plan.execution.completedAt !== undefined || plan.execution.auditId !== undefined)) {
            fail('unfinished migration execution contains completion facts', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
        if (plan.execution.state === 'failed' && !plan.execution.lastError) {
            fail('failed migration execution has no error', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
        if (plan.execution.state !== 'failed' && plan.execution.lastError !== undefined) {
            fail('non-failed migration execution contains an error', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        }
    }
}

export function assertClassSigninClassroomMigrationDerivedFromInputs(
    plan: ClassSigninClassroomMigrationPlan,
    source: ValidatedClassSigninExport,
    manifest: ValidatedClassSigninManifest,
    snapshot: ClassSigninClassroomMigrationSnapshot,
): void {
    assertClassSigninClassroomMigrationPlan(plan);
    const expectedMappings = manifest.schoolMappings.map((mapping) => ({
        sourceSchoolId: mapping.sourceSchoolId,
        domainId: mapping.domainId,
        schoolId: mapping.schoolId.toHexString(),
    }));
    if (
        plan.source.sourceSha256 !== source.sourceSha256 ||
        plan.source.canonicalFingerprint !== source.canonicalFingerprint ||
        plan.source.snapshotAt !== source.snapshotAt ||
        plan.manifest.fingerprint !== manifest.fingerprint ||
        hashValue(plan.manifest.schoolMappings) !== hashValue(expectedMappings) ||
        plan.batchId !== `classsignin:${sha256(`${source.canonicalFingerprint}\0${manifest.fingerprint}`)}`
    ) {
        fail('migration plan was not derived from the supplied source and manifest', 'CLASSSIGNIN_CLASSROOM_PLAN_NOT_DERIVED');
    }
    assertStableMigrationBoundary(plan, snapshot);
    const plannedIds = new Set(plan.entries.map((entry) => entry.classroomId));
    const beforeClassrooms = plan.entries
        .map((entry) => entryBeforeState(entry))
        .filter((classroom): classroom is ExamClassroomDoc => classroom !== null);
    const syntheticBefore: ClassSigninClassroomMigrationSnapshot = {
        schools: snapshot.schools,
        classrooms: [...snapshot.classrooms.filter((classroom) => !plannedIds.has(classroom._id.toHexString())), ...beforeClassrooms],
        references: snapshot.references,
    };
    const regenerated = buildClassSigninClassroomMigrationPlan(source, manifest, syntheticBefore, new Date(plan.generatedAt));
    if (regenerated.fingerprint !== plan.fingerprint) {
        fail('migration plan entries are not the exact source-derived plan', 'CLASSSIGNIN_CLASSROOM_PLAN_NOT_DERIVED');
    }
}

function planMappings(plan: ClassSigninClassroomMigrationPlan): ValidatedClassSigninManifest {
    return {
        schemaVersion: 1,
        sourceSystem: CLASSSIGNIN_SOURCE_SYSTEM,
        sourceSha256: plan.source.sourceSha256,
        fingerprint: plan.manifest.fingerprint,
        schoolMappings: plan.manifest.schoolMappings.map((mapping) => ({
            sourceSchoolId: mapping.sourceSchoolId,
            domainId: mapping.domainId,
            schoolId: new ObjectId(mapping.schoolId),
        })),
    };
}

function sortedReferences(values: ExamClassroomReferenceFact[]): ExamClassroomReferenceFact[] {
    return [...values].sort((left, right) =>
        `${left.domainId}\0${left.classroomId}\0${left.sourceSeatId || ''}\0${left.kind}\0${left.referenceId}`.localeCompare(
            `${right.domainId}\0${right.classroomId}\0${right.sourceSeatId || ''}\0${right.kind}\0${right.referenceId}`,
        ),
    );
}

function assertStableMigrationBoundary(plan: ClassSigninClassroomMigrationPlan, snapshot: ClassSigninClassroomMigrationSnapshot): void {
    const manifest = planMappings(plan);
    const selectedSchools = snapshot.schools
        .filter((school) => manifest.schoolMappings.some((mapping) => mapping.domainId === school.domainId && mapping.schoolId.equals(school._id)))
        .sort((left, right) => `${left.domainId}\0${left._id}`.localeCompare(`${right.domainId}\0${right._id}`));
    if (hashValue(selectedSchools) !== plan.databaseBefore.schoolFingerprint) {
        fail('mapped userbind schools changed after plan', 'CLASSSIGNIN_CLASSROOM_DATABASE_DRIFT');
    }
    const { managed, nonTarget } = mappedSnapshotFacts(manifest, snapshot);
    if (hashValue(sortedDocuments(nonTarget)) !== plan.databaseBefore.nonTargetFingerprint) {
        fail('non-target classroom data changed after plan', 'CLASSSIGNIN_CLASSROOM_NON_TARGET_DRIFT');
    }
    if (hashValue(sortedReferences(snapshot.references)) !== plan.databaseBefore.referenceFingerprint) {
        fail('classroom references changed after plan', 'CLASSSIGNIN_CLASSROOM_REFERENCE_DRIFT');
    }
    const plannedIds = new Set(plan.entries.map((entry) => entry.classroomId));
    const unexpected = managed.filter((classroom) => !plannedIds.has(classroom._id.toHexString()));
    if (unexpected.length) {
        fail(
            'managed classroom set changed after plan',
            'CLASSSIGNIN_CLASSROOM_DATABASE_DRIFT',
            unexpected.map((item) => item._id.toHexString()),
        );
    }
}

function referenceConflicts(entry: ClassSigninClassroomMigrationEntry, snapshot: ClassSigninClassroomMigrationSnapshot): string[] {
    const references = snapshot.references.filter(
        (reference) => reference.domainId === entry.domainId && reference.classroomId.equals(new ObjectId(entry.classroomId)),
    );
    if (entry.action === 'archive' && references.length) return references.map((reference) => reference.referenceId).sort();
    if (entry.action !== 'update' || !entry.removedSeatIds.length) return [];
    const removed = new Set(entry.removedSeatIds);
    return references
        .filter((reference) => !reference.sourceSeatId || removed.has(reference.sourceSeatId))
        .map((reference) => reference.referenceId)
        .sort();
}

function materializeEntryTarget(plan: ClassSigninClassroomMigrationPlan, entry: ClassSigninClassroomMigrationEntry): ExamClassroomDoc {
    if (!plan.execution) fail('migration execution state is missing', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    const batchId = plan.batchId;
    const actor = plan.execution.actor;
    const now = new Date(plan.execution.startedAt);
    if (!Number.isFinite(now.getTime())) fail('migration execution start time is invalid', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    const before = entryBeforeState(entry);
    if (entry.action === 'unchanged') {
        if (!before) fail('unchanged entry is missing before state', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        return before;
    }
    if (entry.action === 'add') {
        if (before) fail('add entry unexpectedly has before state', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        if (!entry.desired) fail('add entry is missing desired state', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
        return {
            _id: new ObjectId(entry.classroomId),
            domainId: entry.domainId,
            schoolId: new ObjectId(entry.schoolId),
            name: entry.desired.name,
            status: 'active',
            sourceSystem: CLASSSIGNIN_SOURCE_SYSTEM,
            sourceSchoolId: entry.sourceSchoolId,
            sourceClassroomId: entry.sourceClassroomId,
            sourceFingerprint: entry.desired.sourceFingerprint,
            sourceSnapshotAt: entry.desired.sourceSnapshotAt,
            importBatchId: batchId,
            revision: 1,
            layoutRevision: 1,
            layoutRevisions: [
                {
                    revision: 1,
                    fingerprint: entry.desired.layout.fingerprint,
                    sourceSnapshotAt: entry.desired.sourceSnapshotAt,
                    importBatchId: batchId,
                    importedAt: now,
                    importedBy: actor,
                    snapshot: entry.desired.layout,
                },
            ],
            createdAt: now,
            createdBy: actor,
            updatedAt: now,
            updatedBy: actor,
        };
    }
    if (!before) fail('planned classroom is missing its before state', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    if (entry.action === 'archive') {
        return {
            ...before,
            status: 'archived',
            importBatchId: batchId,
            revision: entry.targetRevision,
            updatedAt: now,
            updatedBy: actor,
            archivedAt: now,
            archivedBy: actor,
        };
    }
    if (entry.action !== 'update' || !entry.desired) fail('entry cannot be materialized', 'CLASSSIGNIN_CLASSROOM_PLAN_TAMPERED');
    const layoutChanged = before.layoutRevision !== entry.targetLayoutRevision;
    const layoutRevisions = layoutChanged
        ? [
              ...before.layoutRevisions,
              {
                  revision: entry.targetLayoutRevision,
                  fingerprint: entry.desired.layout.fingerprint,
                  sourceSnapshotAt: entry.desired.sourceSnapshotAt,
                  importBatchId: batchId,
                  importedAt: now,
                  importedBy: actor,
                  snapshot: entry.desired.layout,
              },
          ]
        : before.layoutRevisions;
    const target: ExamClassroomDoc = {
        ...before,
        name: entry.desired.name,
        status: 'active',
        sourceFingerprint: entry.desired.sourceFingerprint,
        sourceSnapshotAt: entry.desired.sourceSnapshotAt,
        importBatchId: batchId,
        revision: entry.targetRevision,
        layoutRevision: entry.targetLayoutRevision,
        layoutRevisions,
        updatedAt: now,
        updatedBy: actor,
    };
    delete target.archivedAt;
    delete target.archivedBy;
    return target;
}

function isEntryTarget(
    plan: ClassSigninClassroomMigrationPlan,
    entry: ClassSigninClassroomMigrationEntry,
    classroom: ExamClassroomDoc | null,
): boolean {
    if (!classroom || !plan.execution) return false;
    try {
        return stateFingerprint(classroom) === stateFingerprint(materializeEntryTarget(plan, entry));
    } catch {
        return false;
    }
}

function assertMaterializedTargetsCanonical(plan: ClassSigninClassroomMigrationPlan, actor: number, now: Date): void {
    const materializationPlan: ClassSigninClassroomMigrationPlan = plan.execution
        ? plan
        : {
              ...plan,
              execution: {
                  revision: 1,
                  actor,
                  state: 'applying',
                  startedAt: now.toISOString(),
                  updatedAt: now.toISOString(),
                  results: [],
              },
          };
    const writeTime = new Date(materializationPlan.execution!.startedAt);
    for (const entry of plan.entries) {
        const before = entryBeforeState(entry);
        if (before && writeTime.getTime() < before.updatedAt.getTime()) {
            fail(`apply timestamp is older than classroom ${entry.classroomId}`, 'CLASSSIGNIN_CLASSROOM_CLOCK_ROLLBACK', {
                applyAt: writeTime.toISOString(),
                classroomUpdatedAt: before.updatedAt.toISOString(),
            });
        }
        assertStoredClassroomIntegrity(materializeEntryTarget(materializationPlan, entry), `materialized classroom ${entry.classroomId}`);
    }
}

function batchFromPlan(plan: ClassSigninClassroomMigrationPlan): ClassSigninClassroomMigrationBatchDoc {
    if (!plan.execution) fail('migration execution state is missing');
    return {
        _id: plan.batchId,
        type: 'classsignin.classroom.migration',
        planFingerprint: plan.fingerprint,
        sourceSha256: plan.source.sourceSha256,
        manifestFingerprint: plan.manifest.fingerprint,
        domainIds: [...new Set(plan.manifest.schoolMappings.map((mapping) => mapping.domainId))].sort(),
        revision: plan.execution.revision,
        actor: plan.execution.actor,
        state: plan.execution.state,
        startedAt: new Date(plan.execution.startedAt),
        updatedAt: new Date(plan.execution.updatedAt),
        ...(plan.execution.completedAt ? { completedAt: new Date(plan.execution.completedAt) } : {}),
        summary: plan.summary,
        results: plan.execution.results,
        ...(plan.execution.lastError ? { lastError: plan.execution.lastError } : {}),
        ...(plan.execution.auditId ? { auditId: plan.execution.auditId } : {}),
    };
}

function currentExecutionState(
    plan: ClassSigninClassroomMigrationPlan,
): NonNullable<ClassSigninClassroomMigrationPlan['execution']>['state'] | undefined {
    return plan.execution?.state;
}

function assertMigrationBatchIntegrity(plan: ClassSigninClassroomMigrationPlan, batch: ClassSigninClassroomMigrationBatchDoc): void {
    exactRuntimeRecord(
        batch,
        [
            '_id',
            'type',
            'planFingerprint',
            'sourceSha256',
            'manifestFingerprint',
            'domainIds',
            'revision',
            'actor',
            'state',
            'startedAt',
            'updatedAt',
            'summary',
            'results',
        ],
        ['completedAt', 'lastError', 'auditId'],
        'Mongo classroom migration batch',
        'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT',
    );
    if (
        !Number.isSafeInteger(batch.revision) ||
        batch.revision < 1 ||
        !Number.isSafeInteger(batch.actor) ||
        batch.actor < 1 ||
        !['applying', 'applied', 'failed'].includes(batch.state) ||
        !(batch.startedAt instanceof Date) ||
        !Number.isFinite(batch.startedAt.getTime()) ||
        !(batch.updatedAt instanceof Date) ||
        !Number.isFinite(batch.updatedAt.getTime()) ||
        (batch.completedAt !== undefined && (!(batch.completedAt instanceof Date) || !Number.isFinite(batch.completedAt.getTime())))
    ) {
        fail('Mongo classroom migration batch state is invalid', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
    const execution: NonNullable<ClassSigninClassroomMigrationPlan['execution']> = {
        revision: batch.revision,
        actor: batch.actor,
        state: batch.state,
        startedAt: batch.startedAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        ...(batch.completedAt ? { completedAt: batch.completedAt.toISOString() } : {}),
        results: batch.results,
        ...(batch.lastError ? { lastError: batch.lastError } : {}),
        ...(batch.auditId ? { auditId: batch.auditId } : {}),
    };
    assertClassSigninClassroomMigrationPlan({ ...plan, execution });
}

function currentByEntry(snapshot: ClassSigninClassroomMigrationSnapshot, entry: ClassSigninClassroomMigrationEntry): ExamClassroomDoc | null {
    return snapshot.classrooms.find((classroom) => classroom._id.equals(new ObjectId(entry.classroomId))) || null;
}

function assertEntryCanApply(
    plan: ClassSigninClassroomMigrationPlan,
    entry: ClassSigninClassroomMigrationEntry,
    snapshot: ClassSigninClassroomMigrationSnapshot,
    allowPersistedTarget: boolean,
): ExamClassroomDoc | null {
    const current = currentByEntry(snapshot, entry);
    if (allowPersistedTarget && isEntryTarget(plan, entry, current)) return current;
    if (entry.action === 'add') {
        if (current) fail(`classroom ${entry.classroomId} appeared after plan`, 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
        return null;
    }
    const before = entryBeforeState(entry);
    if (!current || !before || stateFingerprint(before) !== stateFingerprint(current)) {
        fail(`classroom ${entry.classroomId} changed after plan`, 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
    }
    const conflicts = referenceConflicts(entry, snapshot);
    if (conflicts.length) {
        fail(`classroom ${entry.classroomId} gained protected references`, 'CLASSSIGNIN_CLASSROOM_REFERENCE_CONFLICT', conflicts);
    }
    return current;
}

function auditBase(plan: ClassSigninClassroomMigrationPlan, actor: number) {
    return {
        type: 'classsignin.classroom.migration',
        batchId: plan.batchId,
        planFingerprint: plan.fingerprint,
        sourceSha256: plan.source.sourceSha256,
        manifestFingerprint: plan.manifest.fingerprint,
        operator: actor,
        counts: plan.summary,
    };
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
    return hashValue(left) === hashValue(right);
}

function batchIdentityMatches(plan: ClassSigninClassroomMigrationPlan, batch: ClassSigninClassroomMigrationBatchDoc): boolean {
    assertMigrationBatchIntegrity(plan, batch);
    const expected = batchFromPlan(plan);
    return (
        batch._id === expected._id &&
        batch.type === expected.type &&
        batch.planFingerprint === expected.planFingerprint &&
        batch.sourceSha256 === expected.sourceSha256 &&
        batch.manifestFingerprint === expected.manifestFingerprint &&
        batch.actor === expected.actor &&
        sameCanonicalValue(batch.domainIds, expected.domainIds) &&
        sameCanonicalValue(batch.summary, expected.summary) &&
        batch.startedAt instanceof Date &&
        batch.startedAt.getTime() === expected.startedAt.getTime()
    );
}

function expectedSuccessAudit(plan: ClassSigninClassroomMigrationPlan): Record<string, unknown> {
    if (!plan.execution?.completedAt) fail('completed execution timestamp is missing', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    return {
        ...auditBase(plan, plan.execution.actor),
        result: 'success',
        time: new Date(plan.execution.completedAt),
    };
}

function successAuditId(plan: ClassSigninClassroomMigrationPlan): string {
    return sha256(`classsignin-classroom-success-audit\0${plan.batchId}\0${plan.fingerprint}`).slice(0, 24);
}

function auditMatches(actual: Record<string, unknown> | null, expected: Record<string, unknown>, auditId: string): boolean {
    if (!actual) return false;
    const allowed = new Set(['_id', ...Object.keys(expected)]);
    if (Object.keys(actual).some((key) => !allowed.has(key))) return false;
    const actualId = actual._id instanceof ObjectId ? actual._id.toHexString() : actual._id;
    if (actualId !== auditId) return false;
    return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && sameCanonicalValue(actual[key], value));
}

async function assertPersistentAppliedExecution(
    plan: ClassSigninClassroomMigrationPlan,
    repository: ClassSigninClassroomMigrationRepository,
): Promise<void> {
    if (plan.execution?.state !== 'applied' || !plan.execution.auditId) {
        fail('applied execution identity is incomplete', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
    const batch = await repository.loadBatch(plan.batchId);
    if (!batch || !sameCanonicalValue(batch, batchFromPlan(plan))) {
        fail('exact applied migration batch is missing', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
    const audit = await repository.loadAudit(plan.execution.auditId);
    if (!auditMatches(audit, expectedSuccessAudit(plan), plan.execution.auditId)) {
        fail('exact success audit is missing', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
}

async function assertAppliedTargetsAndSuccessAudit(
    plan: ClassSigninClassroomMigrationPlan,
    repository: ClassSigninClassroomMigrationRepository,
    snapshot: ClassSigninClassroomMigrationSnapshot,
): Promise<void> {
    if (plan.execution?.state !== 'applied' || !plan.execution.auditId) {
        fail('applied execution identity is incomplete', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
    const drifted = plan.entries.filter((entry) => !isEntryTarget(plan, entry, currentByEntry(snapshot, entry)));
    if (drifted.length) {
        fail(
            'applied migration no longer matches MongoDB canonical facts',
            'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT',
            drifted.map((entry) => entry.classroomId),
        );
    }
    const audit = await repository.loadAudit(plan.execution.auditId);
    if (!auditMatches(audit, expectedSuccessAudit(plan), plan.execution.auditId)) {
        fail('exact success audit is missing', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
}

type ExecutionPersistence =
    | { mode: 'new'; allowPersistedTarget: false }
    | { mode: 'insert-recovery'; allowPersistedTarget: false }
    | { mode: 'exact'; allowPersistedTarget: true }
    | { mode: 'advance'; allowPersistedTarget: true; expectedBatch: ClassSigninClassroomMigrationBatchDoc };

async function inspectExecutionPersistence(
    plan: ClassSigninClassroomMigrationPlan,
    repository: ClassSigninClassroomMigrationRepository,
    actor: number,
): Promise<ExecutionPersistence> {
    const batch = await repository.loadBatch(plan.batchId);
    if (!plan.execution) {
        if (batch) fail('database batch exists but local execution state is absent', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
        return { mode: 'new', allowPersistedTarget: false };
    }
    if (plan.execution.actor !== actor) {
        fail('migration execution belongs to a different actor', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
    }
    if (!batch) {
        if (plan.execution.revision === 1 && plan.execution.state === 'applying' && plan.execution.results.length === 0) {
            return { mode: 'insert-recovery', allowPersistedTarget: false };
        }
        fail('local execution state has no matching database batch', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    }
    if (!batchIdentityMatches(plan, batch)) {
        fail('database batch belongs to a different immutable execution', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
    }
    const expected = batchFromPlan(plan);
    if (sameCanonicalValue(batch, expected)) return { mode: 'exact', allowPersistedTarget: true };
    if (plan.execution.revision === batch.revision + 1 && batch.state !== 'applied') {
        if (plan.execution.previousBatchFingerprint !== hashValue(batch)) {
            fail('database batch is not the exact recorded predecessor', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
        }
        return { mode: 'advance', allowPersistedTarget: true, expectedBatch: batch };
    }
    fail('local and database execution revisions diverged', 'CLASSSIGNIN_CLASSROOM_CAS_CONFLICT');
}

async function persistExecutionTransition(
    plan: ClassSigninClassroomMigrationPlan,
    repository: ClassSigninClassroomMigrationRepository,
    persistPlan: ((plan: ClassSigninClassroomMigrationPlan) => Promise<void>) | undefined,
    mutate: (execution: NonNullable<ClassSigninClassroomMigrationPlan['execution']>) => void,
): Promise<void> {
    if (!plan.execution) fail('migration execution state is missing', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
    const expectedBatch = batchFromPlan(plan);
    const nextExecution: NonNullable<ClassSigninClassroomMigrationPlan['execution']> = {
        ...plan.execution,
        results: plan.execution.results.map((result) => ({ ...result })),
    };
    mutate(nextExecution);
    nextExecution.revision = expectedBatch.revision + 1;
    nextExecution.previousBatchFingerprint = hashValue(expectedBatch);
    assertClassSigninClassroomMigrationPlan({ ...plan, execution: nextExecution });
    plan.execution = nextExecution;
    await persistPlan?.(plan);
    await saveBatchExactly(repository, batchFromPlan(plan), expectedBatch);
}

async function saveBatchExactly(
    repository: ClassSigninClassroomMigrationRepository,
    target: ClassSigninClassroomMigrationBatchDoc,
    expected: ClassSigninClassroomMigrationBatchDoc | null,
): Promise<void> {
    try {
        await repository.saveBatch(target, expected);
    } catch (error) {
        const current = await repository.loadBatch(target._id);
        if (current && sameCanonicalValue(current, target)) return;
        throw error;
    }
}

async function ensureAuditExactly(
    repository: ClassSigninClassroomMigrationRepository,
    auditId: string,
    audit: Record<string, unknown>,
): Promise<void> {
    try {
        await repository.ensureAudit(auditId, audit);
    } catch (error) {
        if (auditMatches(await repository.loadAudit(auditId), audit, auditId)) return;
        throw error;
    }
}

export async function applyClassSigninClassroomMigration(input: {
    plan: ClassSigninClassroomMigrationPlan;
    source: ValidatedClassSigninExport;
    manifest: ValidatedClassSigninManifest;
    repository: ClassSigninClassroomMigrationRepository;
    actor: number;
    fingerprint: string;
    confirmationToken: string;
    now?: Date;
    persistPlan?: (plan: ClassSigninClassroomMigrationPlan) => Promise<void>;
}): Promise<void> {
    const { plan, repository } = input;
    if (!Number.isSafeInteger(input.actor) || input.actor < 1) {
        fail('actor must be a positive integer', 'CLASSSIGNIN_CLASSROOM_CONFIRMATION_REQUIRED');
    }
    if (input.fingerprint !== plan.fingerprint || input.confirmationToken !== plan.confirmationToken) {
        fail('exact plan fingerprint and confirmation token are required', 'CLASSSIGNIN_CLASSROOM_CONFIRMATION_REQUIRED');
    }
    let snapshot = await repository.loadSnapshot();
    assertClassSigninClassroomMigrationDerivedFromInputs(plan, input.source, input.manifest, snapshot);
    if (plan.conflicts.length || plan.summary.conflicts || plan.entries.some((entry) => entry.action === 'conflict' || entry.conflicts.length)) {
        fail('migration plan contains conflicts', 'CLASSSIGNIN_CLASSROOM_PLAN_CONFLICT', {
            plan: plan.conflicts,
            entries: plan.entries.filter((entry) => entry.conflicts.length),
        });
    }
    const domainIds = [...new Set(input.manifest.schoolMappings.map((mapping) => mapping.domainId))].sort();
    if (!(await repository.isExamInfrastructureAdministrator(input.actor, domainIds))) {
        fail('actor is not a site or exam infrastructure administrator', 'CLASSSIGNIN_CLASSROOM_PERMISSION_DENIED');
    }
    const now = input.now || new Date();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('apply timestamp is invalid');
    if (plan.execution && now.getTime() < new Date(plan.execution.updatedAt).getTime()) {
        fail('apply timestamp is older than the persisted execution state', 'CLASSSIGNIN_CLASSROOM_CLOCK_ROLLBACK');
    }
    assertMaterializedTargetsCanonical(plan, input.actor, now);
    const persistence = await inspectExecutionPersistence(plan, repository, input.actor);
    for (const entry of plan.entries) assertEntryCanApply(plan, entry, snapshot, persistence.allowPersistedTarget);
    for (const result of plan.execution?.results || []) {
        const entry = plan.entries.find((candidate) => candidate.classroomId === result.classroomId)!;
        if (!isEntryTarget(plan, entry, currentByEntry(snapshot, entry))) {
            fail(`recorded classroom result ${result.classroomId} no longer matches its target`, 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
        }
    }
    if (plan.execution?.state === 'applied') {
        await assertAppliedTargetsAndSuccessAudit(plan, repository, snapshot);
        if (persistence.mode === 'exact') {
            await assertPersistentAppliedExecution(plan, repository);
            return;
        }
    }
    await repository.ensureIndexes();
    if (persistence.mode === 'new') {
        const execution: NonNullable<ClassSigninClassroomMigrationPlan['execution']> = {
            revision: 1,
            actor: input.actor,
            state: 'applying',
            startedAt: now.toISOString(),
            updatedAt: now.toISOString(),
            results: [],
        };
        assertClassSigninClassroomMigrationPlan({ ...plan, execution });
        plan.execution = execution;
        await input.persistPlan?.(plan);
        await saveBatchExactly(repository, batchFromPlan(plan), null);
    } else if (persistence.mode === 'insert-recovery') {
        await saveBatchExactly(repository, batchFromPlan(plan), null);
    } else if (persistence.mode === 'advance') {
        await saveBatchExactly(repository, batchFromPlan(plan), persistence.expectedBatch);
    }
    if (plan.execution?.state === 'applied') {
        await assertPersistentAppliedExecution(plan, repository);
        return;
    }
    if (plan.execution?.state === 'failed') {
        await persistExecutionTransition(plan, repository, input.persistPlan, (execution) => {
            execution.state = 'applying';
            execution.updatedAt = now.toISOString();
            delete execution.lastError;
        });
    }
    try {
        if (!plan.execution || plan.execution.state !== 'applying') {
            fail('migration is not in applying state', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
        }
        const existingResults = new Map(plan.execution.results.map((result) => [result.classroomId, result]));
        for (const entry of plan.entries) {
            snapshot = await repository.loadSnapshot();
            assertClassSigninClassroomMigrationDerivedFromInputs(plan, input.source, input.manifest, snapshot);
            const current = assertEntryCanApply(plan, entry, snapshot, true);
            if (existingResults.has(entry.classroomId)) {
                if (!isEntryTarget(plan, entry, current)) {
                    fail(`recorded classroom result ${entry.classroomId} drifted during recovery`, 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
                }
                continue;
            }
            let result: 'applied' | 'no-op' = 'no-op';
            if (entry.action !== 'unchanged' && !isEntryTarget(plan, entry, current)) {
                const target = materializeEntryTarget(plan, entry);
                assertStoredClassroomIntegrity(target, `materialized classroom ${entry.classroomId}`);
                result = await repository.writeClassroom(current, target);
            }
            existingResults.set(entry.classroomId, {
                classroomId: entry.classroomId,
                action: entry.action,
                result,
                at: now.toISOString(),
            });
            await persistExecutionTransition(plan, repository, input.persistPlan, (execution) => {
                execution.results = [...existingResults.values()].sort((left, right) => left.classroomId.localeCompare(right.classroomId));
                execution.updatedAt = now.toISOString();
            });
        }
        if (existingResults.size !== plan.entries.length) {
            fail('migration result set is incomplete', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
        }
        const completedAt = [...existingResults.values()].reduce(
            (latest, result) => (new Date(result.at).getTime() > new Date(latest).getTime() ? result.at : latest),
            plan.execution.startedAt,
        );
        const auditId = successAuditId(plan);
        const successAudit = { ...auditBase(plan, input.actor), result: 'success', time: new Date(completedAt) };
        await ensureAuditExactly(repository, auditId, successAudit);
        if (!auditMatches(await repository.loadAudit(auditId), successAudit, auditId)) {
            fail('success audit did not persist exactly', 'CLASSSIGNIN_CLASSROOM_EXECUTION_DRIFT');
        }
        await persistExecutionTransition(plan, repository, input.persistPlan, (execution) => {
            execution.state = 'applied';
            execution.updatedAt = new Date(execution.updatedAt).getTime() > new Date(completedAt).getTime() ? execution.updatedAt : completedAt;
            execution.completedAt = completedAt;
            execution.auditId = auditId;
        });
    } catch (error) {
        const lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const batch = plan.execution ? await repository.loadBatch(plan.batchId) : null;
        if (batch && sameCanonicalValue(batch, batchFromPlan(plan))) {
            if (currentExecutionState(plan) === 'applied') {
                await assertPersistentAppliedExecution(plan, repository);
                return;
            }
            await repository.insertAudit({ ...auditBase(plan, input.actor), result: 'failed', error: lastError, time: now });
            await persistExecutionTransition(plan, repository, input.persistPlan, (execution) => {
                execution.state = 'failed';
                execution.updatedAt = now.toISOString();
                execution.lastError = lastError;
            });
        }
        throw error;
    }
}

export async function verifyClassSigninClassroomMigration(
    plan: ClassSigninClassroomMigrationPlan,
    source: ValidatedClassSigninExport,
    manifest: ValidatedClassSigninManifest,
    repository: ClassSigninClassroomMigrationRepository,
    now = new Date(),
    persistPlan?: (plan: ClassSigninClassroomMigrationPlan) => Promise<void>,
): Promise<void> {
    assertClassSigninClassroomMigrationPlan(plan);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('verify timestamp is invalid');
    if (plan.execution?.state !== 'applied') fail('migration has not completed apply', 'CLASSSIGNIN_CLASSROOM_VERIFY_FAILED');
    if (now.getTime() < new Date(plan.execution.updatedAt).getTime()) {
        fail('verify timestamp is older than the persisted execution state', 'CLASSSIGNIN_CLASSROOM_CLOCK_ROLLBACK');
    }
    const snapshot = await repository.loadSnapshot();
    const checks: Array<{ check: string; ok: boolean; detail?: string }> = [];
    try {
        assertClassSigninClassroomMigrationDerivedFromInputs(plan, source, manifest, snapshot);
        checks.push({ check: 'source-derived-plan', ok: true });
    } catch (error) {
        checks.push({ check: 'source-derived-plan', ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
    for (const entry of plan.entries) {
        const ok = isEntryTarget(plan, entry, currentByEntry(snapshot, entry));
        checks.push({ check: `classroom:${entry.classroomId}`, ok, ...(ok ? {} : { detail: 'target state mismatch' }) });
    }
    const batch = await repository.loadBatch(plan.batchId);
    const batchOk = !!batch && sameCanonicalValue(batch, batchFromPlan(plan));
    checks.push({ check: 'exact-applied-batch', ok: batchOk, ...(batchOk ? {} : { detail: 'exact applied batch fact is missing' }) });
    const successAudit = plan.execution.auditId ? await repository.loadAudit(plan.execution.auditId) : null;
    const successAuditOk = !!plan.execution.auditId && auditMatches(successAudit, expectedSuccessAudit(plan), plan.execution.auditId);
    checks.push({ check: 'exact-success-audit', ok: successAuditOk, ...(successAuditOk ? {} : { detail: 'exact success audit is missing' }) });
    const ok = checks.every((check) => check.ok);
    const auditId = await repository.insertAudit({
        ...auditBase(plan, plan.execution.actor),
        result: ok ? 'verified' : 'verify-failed',
        checks,
        time: now,
    });
    plan.verification = { ok, verifiedAt: now.toISOString(), checks, auditId };
    await persistPlan?.(plan);
    if (!ok) fail('migration verification failed', 'CLASSSIGNIN_CLASSROOM_VERIFY_FAILED', checks);
}
