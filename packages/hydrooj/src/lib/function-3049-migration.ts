import fs from 'node:fs/promises';
import { BSON } from 'mongodb';
import { canonicalJson, sha256 } from './problem-batch-import';

export const FUNCTION_3049_MIGRATION_SCHEMA_VERSION = 1;
export const FUNCTION_3049_DOMAIN_ID = 'system';
export const FUNCTION_3049_DOC_ID = 3049;

const SHA256 = /^[a-f0-9]{64}$/;
const REGION_ID = /^r_[A-Za-z0-9_-]{12,32}$/;

export class Function3049MigrationError extends Error {
    constructor(
        message: string,
        public readonly code = 'FUNCTION_3049_MIGRATION_FAILED',
        public readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'Function3049MigrationError';
    }
}

export interface Function3049MigrationSnapshot {
    functionProblems: Array<Record<string, any>>;
    recordCount: number;
}

export interface Function3049RegionSummary {
    id: string;
    startLine: number;
    endLine: number;
    order: number;
    signature: string;
    title?: string;
    description?: string;
}

export interface Function3049MigrationReport {
    schemaVersion: 1;
    generatedAt: string;
    source: {
        domainId: typeof FUNCTION_3049_DOMAIN_ID;
        docId: typeof FUNCTION_3049_DOC_ID;
        documentId: string;
        pid: string;
        title: string;
        hidden: true;
        codeEvaluationStatus: 'draft';
        structureRevision: number;
        nSubmit: 0;
        recordCount: 0;
        functionProblemCount: 1;
        stateFingerprint: string;
        nonTargetFingerprint: string;
        configFingerprint: string;
        template: {
            lang: string;
            sourceHash: string;
            sourceLineCount: number;
            cases: Array<{ input: string; output: string }>;
            regions: Function3049RegionSummary[];
        };
    };
    target: {
        structureRevision: number;
        configFingerprint: string;
        publicRanges: [];
        regions: Array<{
            id: string;
            startLine: number;
            endLine: number;
            title?: string;
            description?: string;
        }>;
    };
    fingerprint: string;
    confirmationToken: string;
    execution?: {
        actor: number;
        startedAt: string;
        completedAt?: string;
        state: 'applying' | 'applied' | 'failed';
        error?: string;
    };
    verification?: {
        verifiedAt: string;
        ok: true;
        auditId: string;
    };
}

export interface Function3049MigrationWriteResult {
    matchedCount: number;
    modifiedCount: number;
}

export interface Function3049MigrationRepository {
    loadSnapshot(): Promise<Function3049MigrationSnapshot>;
    isSystemAdministrator(uid: number): Promise<boolean>;
    updateTarget(input: {
        expectedProblem: Record<string, any>;
        nextConfig: Record<string, any>;
        nextStructureRevision: number;
    }): Promise<Function3049MigrationWriteResult>;
    insertAudit(audit: Record<string, any>): Promise<string>;
    findSuccessfulAudit(fingerprint: string): Promise<Record<string, any> | null>;
    close?(): Promise<void>;
}

function fail(message: string, code = 'FUNCTION_3049_MIGRATION_INVALID', details?: unknown): never {
    throw new Function3049MigrationError(message, code, details);
}

function own(value: object, field: PropertyKey): boolean {
    return Object.hasOwn(value, field);
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, any>, allowed: string[], field: string): void {
    const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
    if (unexpected) fail(`${field} contains unsupported field ${unexpected}`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
}

function serialized(value: unknown): unknown {
    return BSON.EJSON.serialize(value, { relaxed: false });
}

function hash(value: unknown): string {
    return sha256(canonicalJson(serialized(value)));
}

function sourceHash(source: string): string {
    return sha256(source);
}

function withoutMigrationFields(problem: Record<string, any>): Record<string, any> {
    const copy = { ...problem };
    delete copy.config;
    delete copy.structureRevision;
    return copy;
}

function validateCases(value: unknown): Array<{ input: string; output: string }> {
    if (!Array.isArray(value)) fail('function config cases must be an array', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    return value.map((item, index) => {
        if (!isPlainObject(item)) fail(`case ${index + 1} is malformed`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        exactKeys(item, ['input', 'output'], `case ${index + 1}`);
        const validFilename = (filename: unknown) =>
            typeof filename === 'string' &&
            !!filename &&
            filename === filename.trim() &&
            filename !== '.' &&
            filename !== '..' &&
            !/^config\.ya?ml$/i.test(filename) &&
            !/[<>:"/\\|?*]/.test(filename) &&
            !/[. ]$/.test(filename) &&
            ![...filename].some((character) => {
                const code = character.charCodeAt(0);
                return code <= 31 || (code >= 128 && code <= 159);
            });
        if (!validFilename(item.input) || !validFilename(item.output) || item.input === item.output) {
            fail(`case ${index + 1} filenames are malformed`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
        return { input: item.input, output: item.output };
    });
}

export function transformLegacyFunction3049Config(config: unknown): {
    nextConfig: Record<string, any>;
    summary: Function3049MigrationReport['source']['template'];
    targetRegions: Function3049MigrationReport['target']['regions'];
} {
    if (!isPlainObject(config) || config.type !== 'function') {
        fail('target config is not a legacy function config', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    if (!isPlainObject(config.template)) {
        fail('legacy function template is missing', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    const template = config.template;
    if (own(template, 'publicRanges')) {
        fail('target already uses the new publicRanges protocol', 'FUNCTION_3049_MIGRATION_ALREADY_APPLIED');
    }
    exactKeys(template, ['lang', 'source', 'sourceHash', 'regions'], 'function template');
    if (
        typeof template.lang !== 'string' ||
        !/^[A-Za-z0-9_.+-]{1,64}$/.test(template.lang) ||
        typeof template.source !== 'string' ||
        !template.source ||
        template.source.includes('\r')
    ) {
        fail('legacy function language or source is malformed', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    if (typeof template.sourceHash !== 'string' || template.sourceHash !== sourceHash(template.source)) {
        fail('legacy function source hash does not match its source', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    if (!Array.isArray(config.langs) || config.langs.length !== 1 || config.langs[0] !== template.lang) {
        fail('legacy function language fields disagree', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    if (config.score !== 100) fail('legacy function score is not 100', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    if (!Array.isArray(template.regions) || !template.regions.length) {
        fail('legacy function template must contain at least one region', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    const lines = template.source.split('\n');
    const ids = new Set<string>();
    const orders = new Set<number>();
    const regions = template.regions.map((item: unknown, index: number): Function3049RegionSummary => {
        if (!isPlainObject(item)) fail(`region ${index + 1} is malformed`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        exactKeys(item, ['id', 'startLine', 'endLine', 'order', 'signature', 'description'], `region ${index + 1}`);
        if (typeof item.id !== 'string' || !REGION_ID.test(item.id) || ids.has(item.id)) {
            fail(`region ${index + 1} has an invalid or duplicate id`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
        ids.add(item.id);
        if (!Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) || !Number.isSafeInteger(item.order)) {
            fail(`region ${item.id} has invalid coordinates or order`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
        if (item.startLine < 0 || item.endLine <= item.startLine || item.endLine > lines.length || item.order < 0 || orders.has(item.order)) {
            fail(`region ${item.id} is out of bounds or has duplicate order`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
        orders.add(item.order);
        if (typeof item.signature !== 'string') {
            fail(`region ${item.id} signature is malformed`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
        if (item.description !== undefined && typeof item.description !== 'string') {
            fail(`region ${item.id} description is malformed`, 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
        const title = item.signature.trim();
        return {
            id: item.id,
            startLine: item.startLine,
            endLine: item.endLine,
            order: item.order,
            signature: item.signature,
            ...(title ? { title } : {}),
            ...(item.description ? { description: item.description } : {}),
        };
    });
    if ([...orders].sort((left, right) => left - right).some((order, index) => order !== index)) {
        fail('legacy region order is not a contiguous zero-based sequence', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
    }
    const bySource = [...regions].sort(
        (left, right) => left.startLine - right.startLine || left.endLine - right.endLine || left.id.localeCompare(right.id),
    );
    for (let index = 1; index < bySource.length; index++) {
        if (bySource[index - 1].endLine > bySource[index].startLine) {
            fail('legacy function regions overlap', 'FUNCTION_3049_MIGRATION_LEGACY_CONFIG_INVALID');
        }
    }
    const cases = validateCases(config.cases);
    const targetRegions = bySource.map(({ id, startLine, endLine, title, description }) => ({
        id,
        startLine,
        endLine,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
    }));
    const nextConfig = {
        ...config,
        template: {
            lang: template.lang,
            source: template.source,
            sourceHash: template.sourceHash,
            publicRanges: [],
            regions: targetRegions,
        },
    };
    return {
        nextConfig,
        summary: {
            lang: template.lang,
            sourceHash: template.sourceHash,
            sourceLineCount: lines.length,
            cases,
            regions,
        },
        targetRegions,
    };
}

function inspectSource(snapshot: Function3049MigrationSnapshot) {
    if (!snapshot || !Array.isArray(snapshot.functionProblems) || !Number.isSafeInteger(snapshot.recordCount) || snapshot.recordCount < 0) {
        fail('migration snapshot is malformed');
    }
    if (snapshot.functionProblems.length !== 1) {
        fail('expected exactly one explicit function Problem before protocol cutover', 'FUNCTION_3049_MIGRATION_FUNCTION_COUNT_DRIFT', {
            actual: snapshot.functionProblems.length,
        });
    }
    const problem = snapshot.functionProblems[0];
    if (
        problem.docType !== 10 ||
        problem.domainId !== FUNCTION_3049_DOMAIN_ID ||
        problem.docId !== FUNCTION_3049_DOC_ID ||
        problem.problemKind !== 'function'
    ) {
        fail('the only explicit function Problem is not system/#3049', 'FUNCTION_3049_MIGRATION_TARGET_DRIFT');
    }
    if (problem.hidden !== true || problem.codeEvaluationStatus !== 'draft') {
        fail('system/#3049 must remain a hidden code-evaluation draft', 'FUNCTION_3049_MIGRATION_TARGET_DRIFT');
    }
    if (problem.nSubmit !== 0 || snapshot.recordCount !== 0) {
        fail('system/#3049 has real submissions and cannot be migrated', 'FUNCTION_3049_MIGRATION_SUBMISSIONS_EXIST');
    }
    if (!Number.isSafeInteger(problem.structureRevision) || problem.structureRevision < 1) {
        fail('system/#3049 structure revision is malformed', 'FUNCTION_3049_MIGRATION_TARGET_DRIFT');
    }
    if (typeof problem.pid !== 'string' || !problem.pid || typeof problem.title !== 'string' || !problem.title) {
        fail('system/#3049 identity fields are malformed', 'FUNCTION_3049_MIGRATION_TARGET_DRIFT');
    }
    const transformed = transformLegacyFunction3049Config(problem.config);
    return { problem, transformed };
}

function fingerprintPayload(report: Pick<Function3049MigrationReport, 'schemaVersion' | 'source' | 'target'>) {
    return { schemaVersion: report.schemaVersion, source: report.source, target: report.target };
}

export function function3049MigrationFingerprint(report: Pick<Function3049MigrationReport, 'schemaVersion' | 'source' | 'target'>): string {
    return hash(fingerprintPayload(report));
}

export function buildFunction3049MigrationPlan(snapshot: Function3049MigrationSnapshot, generatedAt = new Date()): Function3049MigrationReport {
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) fail('plan timestamp is invalid');
    const { problem, transformed } = inspectSource(snapshot);
    const report: Pick<Function3049MigrationReport, 'schemaVersion' | 'source' | 'target'> & { generatedAt: string } = {
        schemaVersion: FUNCTION_3049_MIGRATION_SCHEMA_VERSION,
        generatedAt: generatedAt.toISOString(),
        source: {
            domainId: FUNCTION_3049_DOMAIN_ID,
            docId: FUNCTION_3049_DOC_ID,
            documentId: String(problem._id ?? ''),
            pid: problem.pid,
            title: problem.title,
            hidden: true as const,
            codeEvaluationStatus: 'draft' as const,
            structureRevision: problem.structureRevision,
            nSubmit: 0 as const,
            recordCount: 0 as const,
            functionProblemCount: 1 as const,
            stateFingerprint: hash(problem),
            nonTargetFingerprint: hash(withoutMigrationFields(problem)),
            configFingerprint: hash(problem.config),
            template: transformed.summary,
        },
        target: {
            structureRevision: problem.structureRevision + 1,
            configFingerprint: hash(transformed.nextConfig),
            publicRanges: [],
            regions: transformed.targetRegions,
        },
    };
    const fingerprint = function3049MigrationFingerprint(report);
    return { ...report, fingerprint, confirmationToken: `APPLY:function-3049:${fingerprint}` };
}

export function assertFunction3049MigrationReport(value: unknown): asserts value is Function3049MigrationReport {
    if (!isPlainObject(value) || value.schemaVersion !== FUNCTION_3049_MIGRATION_SCHEMA_VERSION) fail('migration report schema is invalid');
    if (!isPlainObject(value.source) || !isPlainObject(value.target)) fail('migration report source or target is missing');
    if (
        value.source.domainId !== FUNCTION_3049_DOMAIN_ID ||
        value.source.docId !== FUNCTION_3049_DOC_ID ||
        value.source.hidden !== true ||
        value.source.codeEvaluationStatus !== 'draft' ||
        value.source.nSubmit !== 0 ||
        value.source.recordCount !== 0 ||
        value.source.functionProblemCount !== 1
    ) {
        fail('migration report target facts are invalid');
    }
    for (const [field, fingerprint] of [
        ['source state', value.source.stateFingerprint],
        ['source non-target', value.source.nonTargetFingerprint],
        ['source config', value.source.configFingerprint],
        ['target config', value.target.configFingerprint],
        ['plan', value.fingerprint],
    ] as const) {
        if (typeof fingerprint !== 'string' || !SHA256.test(fingerprint)) fail(`${field} fingerprint is invalid`);
    }
    if (!Array.isArray(value.target.publicRanges) || value.target.publicRanges.length !== 0 || !Array.isArray(value.target.regions)) {
        fail('migration target ranges are invalid');
    }
    if (!Number.isSafeInteger(value.source.structureRevision) || value.target.structureRevision !== value.source.structureRevision + 1) {
        fail('migration target revision is invalid');
    }
    const expectedFingerprint = function3049MigrationFingerprint(value as Function3049MigrationReport);
    if (value.fingerprint !== expectedFingerprint || value.confirmationToken !== `APPLY:function-3049:${expectedFingerprint}`) {
        fail('migration report fingerprint or confirmation token is invalid');
    }
}

export async function readFunction3049MigrationReport(path: string): Promise<Function3049MigrationReport> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(path, 'utf8'));
    } catch (error) {
        throw new Function3049MigrationError(`cannot read migration report: ${path}`, 'FUNCTION_3049_MIGRATION_REPORT_INVALID', undefined, {
            cause: error,
        });
    }
    assertFunction3049MigrationReport(parsed);
    return parsed;
}

function assertExactSource(report: Function3049MigrationReport, snapshot: Function3049MigrationSnapshot) {
    const live = buildFunction3049MigrationPlan(snapshot, new Date(report.generatedAt));
    if (live.fingerprint !== report.fingerprint) {
        fail('system/#3049 changed after plan; generate a new report', 'FUNCTION_3049_MIGRATION_FINGERPRINT_DRIFT', {
            expected: report.fingerprint,
            actual: live.fingerprint,
        });
    }
    return inspectSource(snapshot);
}

async function recordFailedAudit(
    repository: Function3049MigrationRepository,
    report: Function3049MigrationReport,
    actor: number,
    error: unknown,
): Promise<void> {
    await repository.insertAudit({
        type: 'problem.function-3049.migration',
        operator: actor,
        domainId: FUNCTION_3049_DOMAIN_ID,
        docId: FUNCTION_3049_DOC_ID,
        fingerprint: report.fingerprint,
        fromRevision: report.source.structureRevision,
        toRevision: report.target.structureRevision,
        result: 'failed',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        time: new Date(),
    });
}

export async function applyFunction3049Migration(input: {
    report: Function3049MigrationReport;
    repository: Function3049MigrationRepository;
    actor: number;
    fingerprint: string;
    confirmationToken: string;
    now?: Date;
    persistReport?: (report: Function3049MigrationReport) => Promise<void>;
}): Promise<void> {
    assertFunction3049MigrationReport(input.report);
    if (!Number.isSafeInteger(input.actor) || input.actor < 1) {
        fail('actor must be a positive integer', 'FUNCTION_3049_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (input.fingerprint !== input.report.fingerprint || input.confirmationToken !== input.report.confirmationToken) {
        fail('fingerprint or confirmation token does not match the report', 'FUNCTION_3049_MIGRATION_CONFIRMATION_REQUIRED');
    }
    if (!(await input.repository.isSystemAdministrator(input.actor))) {
        fail(`UID ${input.actor} is not a system administrator`, 'FUNCTION_3049_MIGRATION_ACTOR_DENIED');
    }
    const startedAt = input.now || new Date();
    input.report.execution = { actor: input.actor, startedAt: startedAt.toISOString(), state: 'applying' };
    await input.persistReport?.(input.report);
    try {
        const { problem, transformed } = assertExactSource(input.report, await input.repository.loadSnapshot());
        if (hash(transformed.nextConfig) !== input.report.target.configFingerprint) {
            fail('derived target config differs from the approved report', 'FUNCTION_3049_MIGRATION_FINGERPRINT_DRIFT');
        }
        const result = await input.repository.updateTarget({
            expectedProblem: problem,
            nextConfig: transformed.nextConfig,
            nextStructureRevision: input.report.target.structureRevision,
        });
        if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
            fail('system/#3049 CAS update did not modify exactly one document', 'FUNCTION_3049_MIGRATION_WRITE_COUNT_MISMATCH', result);
        }
        await input.repository.insertAudit({
            type: 'problem.function-3049.migration',
            operator: input.actor,
            domainId: FUNCTION_3049_DOMAIN_ID,
            docId: FUNCTION_3049_DOC_ID,
            fingerprint: input.report.fingerprint,
            fromRevision: input.report.source.structureRevision,
            toRevision: input.report.target.structureRevision,
            sourceConfigFingerprint: input.report.source.configFingerprint,
            targetConfigFingerprint: input.report.target.configFingerprint,
            result: 'success',
            time: new Date(),
        });
        input.report.execution = {
            ...input.report.execution,
            state: 'applied',
            completedAt: new Date().toISOString(),
        };
        await input.persistReport?.(input.report);
    } catch (error) {
        input.report.execution = {
            ...input.report.execution,
            state: 'failed',
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        };
        const secondaryErrors: unknown[] = [];
        try {
            await input.persistReport?.(input.report);
        } catch (persistError) {
            secondaryErrors.push(persistError);
        }
        try {
            await recordFailedAudit(input.repository, input.report, input.actor, error);
        } catch (auditError) {
            secondaryErrors.push(auditError);
        }
        if (secondaryErrors.length) {
            throw new AggregateError([error, ...secondaryErrors], 'function #3049 migration failed and its failure evidence is incomplete');
        }
        throw error;
    }
}

export async function verifyFunction3049Migration(
    report: Function3049MigrationReport,
    repository: Function3049MigrationRepository,
    now = new Date(),
): Promise<void> {
    assertFunction3049MigrationReport(report);
    if (report.execution?.state !== 'applied' || !Number.isSafeInteger(report.execution.actor)) {
        fail('migration report is not in the applied state', 'FUNCTION_3049_MIGRATION_VERIFY_FAILED');
    }
    const snapshot = await repository.loadSnapshot();
    if (snapshot.functionProblems.length !== 1 || snapshot.recordCount !== 0) {
        fail('function Problem or Record count changed during migration', 'FUNCTION_3049_MIGRATION_VERIFY_FAILED');
    }
    const problem = snapshot.functionProblems[0];
    if (
        problem.domainId !== FUNCTION_3049_DOMAIN_ID ||
        problem.docId !== FUNCTION_3049_DOC_ID ||
        problem.problemKind !== 'function' ||
        problem.hidden !== true ||
        problem.codeEvaluationStatus !== 'draft' ||
        problem.nSubmit !== 0 ||
        problem.structureRevision !== report.target.structureRevision ||
        hash(problem.config) !== report.target.configFingerprint ||
        hash(withoutMigrationFields(problem)) !== report.source.nonTargetFingerprint
    ) {
        fail('system/#3049 differs from the approved migration target', 'FUNCTION_3049_MIGRATION_VERIFY_FAILED');
    }
    const template = problem.config?.template;
    if (
        !isPlainObject(template) ||
        !Array.isArray(template.publicRanges) ||
        template.publicRanges.length !== 0 ||
        !Array.isArray(template.regions) ||
        template.regions.some((region: Record<string, any>) => own(region, 'signature') || own(region, 'order'))
    ) {
        fail('system/#3049 still contains the legacy function protocol', 'FUNCTION_3049_MIGRATION_VERIFY_FAILED');
    }
    const audit = await repository.findSuccessfulAudit(report.fingerprint);
    if (
        !audit ||
        audit.operator !== report.execution.actor ||
        audit.domainId !== FUNCTION_3049_DOMAIN_ID ||
        audit.docId !== FUNCTION_3049_DOC_ID ||
        audit.result !== 'success' ||
        audit.fromRevision !== report.source.structureRevision ||
        audit.toRevision !== report.target.structureRevision ||
        audit.sourceConfigFingerprint !== report.source.configFingerprint ||
        audit.targetConfigFingerprint !== report.target.configFingerprint
    ) {
        fail('successful migration audit is missing or conflicting', 'FUNCTION_3049_MIGRATION_VERIFY_FAILED');
    }
    report.verification = { verifiedAt: now.toISOString(), ok: true, auditId: String(audit._id) };
}

export function function3049MigrationSummary(report: Function3049MigrationReport) {
    return {
        fingerprint: report.fingerprint,
        confirmationToken: report.confirmationToken,
        target: `${report.source.domainId}/#${report.source.docId}`,
        pid: report.source.pid,
        title: report.source.title,
        hidden: report.source.hidden,
        codeEvaluationStatus: report.source.codeEvaluationStatus,
        revisions: { from: report.source.structureRevision, to: report.target.structureRevision },
        template: report.source.template,
        targetPublicRanges: report.target.publicRanges,
        targetRegions: report.target.regions,
        state: report.verification?.ok ? 'verified' : report.execution?.state || 'planned',
    };
}
