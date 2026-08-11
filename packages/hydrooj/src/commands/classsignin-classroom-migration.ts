import fs from 'node:fs/promises';
import path from 'node:path';
import type { CAC } from 'cac';
import {
    applyClassSigninClassroomMigration,
    assertClassSigninClassroomMigrationPlan,
    buildClassSigninClassroomMigrationPlan,
    ClassSigninClassroomMigrationError,
    type ClassSigninClassroomMigrationPlan,
    type ClassSigninClassroomMigrationRepository,
    validateClassSigninExport,
    validateClassSigninManifest,
    verifyClassSigninClassroomMigration,
} from '../lib/classsignin-classroom-migration';
import { writeJsonAtomic } from '../lib/problem-batch-import';

export interface ClassSigninClassroomMigrationCommandOptions {
    manifest?: string;
    plan?: string;
    actor?: string;
    fingerprint?: string;
    confirm?: string;
    backupConfirmed?: string;
    serviceStopped?: boolean;
}

type MigrationStage = 'validate' | 'plan' | 'apply' | 'verify';

export interface ClassSigninClassroomMigrationCommandDependencies {
    loadRepository(stage: MigrationStage): Promise<ClassSigninClassroomMigrationRepository>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function fail(message: string, code: string): never {
    throw new ClassSigninClassroomMigrationError(message, code);
}

function defaultPlanPath(sourcePath: string): string {
    const extension = path.extname(sourcePath);
    const stem = extension ? sourcePath.slice(0, -extension.length) : sourcePath;
    return `${stem}.classroom-migration.json`;
}

async function canonicalArtifactPath(filename: string): Promise<string> {
    const resolved = path.resolve(filename);
    try {
        return await fs.realpath(resolved);
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code !== 'ENOENT') throw error;
        return path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
    }
}

async function assertDistinctPlanPath(planPath: string, sourcePath: string, manifestPath: string): Promise<void> {
    const [canonicalPlan, canonicalSource, canonicalManifest] = await Promise.all([
        canonicalArtifactPath(planPath),
        canonicalArtifactPath(sourcePath),
        canonicalArtifactPath(manifestPath),
    ]);
    if (canonicalPlan === canonicalSource || canonicalPlan === canonicalManifest) {
        fail('migration plan path must differ from source and manifest paths', 'CLASSSIGNIN_CLASSROOM_PLAN_PATH_COLLISION');
    }
}

async function readText(filename: string, kind: 'source' | 'manifest'): Promise<string> {
    try {
        return await fs.readFile(filename, 'utf8');
    } catch (error) {
        throw new ClassSigninClassroomMigrationError(
            `cannot read ${kind} file: ${filename}`,
            kind === 'source' ? 'CLASSSIGNIN_CLASSROOM_SOURCE_UNREADABLE' : 'CLASSSIGNIN_CLASSROOM_MANIFEST_UNREADABLE',
            undefined,
            { cause: error },
        );
    }
}

async function readPlan(filename: string): Promise<ClassSigninClassroomMigrationPlan> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new ClassSigninClassroomMigrationError(`cannot read migration plan: ${filename}`, 'CLASSSIGNIN_CLASSROOM_PLAN_UNREADABLE', undefined, {
            cause: error,
        });
    }
    assertClassSigninClassroomMigrationPlan(parsed as ClassSigninClassroomMigrationPlan);
    return parsed as ClassSigninClassroomMigrationPlan;
}

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`${field} must be a positive integer`, 'CLASSSIGNIN_CLASSROOM_CONFIRMATION_REQUIRED');
    return parsed;
}

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof ClassSigninClassroomMigrationError ? error.code : 'CLASSSIGNIN_CLASSROOM_MIGRATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof ClassSigninClassroomMigrationError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function defaultLoadRepository(stage: MigrationStage): Promise<ClassSigninClassroomMigrationRepository> {
    const { createMongoClassSigninClassroomMigrationRepository } =
        require('../model/classsignin-classroom-migration-adapter') as typeof import('../model/classsignin-classroom-migration-adapter');
    return createMongoClassSigninClassroomMigrationRepository({ authorizeApply: stage === 'apply' });
}

async function withRepository<T>(
    stage: MigrationStage,
    dependencies: ClassSigninClassroomMigrationCommandDependencies,
    callback: (repository: ClassSigninClassroomMigrationRepository) => Promise<T>,
): Promise<T> {
    const repository = await dependencies.loadRepository(stage);
    try {
        return await callback(repository);
    } finally {
        await repository.close?.();
    }
}

function requireManifestPath(options: ClassSigninClassroomMigrationCommandOptions): string {
    if (!options.manifest) fail('--manifest is required for plan, apply, and verify', 'CLASSSIGNIN_CLASSROOM_MANIFEST_REQUIRED');
    return path.resolve(options.manifest);
}

function assertInputIdentity(
    plan: ClassSigninClassroomMigrationPlan,
    source: ReturnType<typeof validateClassSigninExport>,
    manifest: ReturnType<typeof validateClassSigninManifest>,
): void {
    if (
        plan.source.sourceSha256 !== source.sourceSha256 ||
        plan.source.canonicalFingerprint !== source.canonicalFingerprint ||
        plan.source.snapshotAt !== source.snapshotAt ||
        plan.manifest.fingerprint !== manifest.fingerprint
    ) {
        fail('source or manifest changed after plan', 'CLASSSIGNIN_CLASSROOM_INPUT_DRIFT');
    }
}

export async function runClassSigninClassroomMigrationCommand(
    rawStage: string,
    sourceInput: string,
    options: ClassSigninClassroomMigrationCommandOptions,
    dependencies: ClassSigninClassroomMigrationCommandDependencies,
): Promise<Record<string, unknown>> {
    if (!['validate', 'plan', 'apply', 'verify'].includes(rawStage)) {
        fail(`unsupported stage: ${rawStage}`, 'CLASSSIGNIN_CLASSROOM_STAGE_INVALID');
    }
    const stage = rawStage as MigrationStage;
    const sourcePath = path.resolve(sourceInput);
    const source = validateClassSigninExport(await readText(sourcePath, 'source'));
    if (stage === 'validate') return { ok: true, stage, sourcePath, sourceSha256: source.sourceSha256, summary: source.summary };

    const manifestPath = requireManifestPath(options);
    const manifest = validateClassSigninManifest(await readText(manifestPath, 'manifest'), source);
    const planPath = path.resolve(options.plan || defaultPlanPath(sourcePath));
    await assertDistinctPlanPath(planPath, sourcePath, manifestPath);
    if (stage === 'plan') {
        return withRepository(stage, dependencies, async (repository) => {
            const generatedAt = new Date();
            const first = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot(), generatedAt);
            const second = buildClassSigninClassroomMigrationPlan(source, manifest, await repository.loadSnapshot(), generatedAt);
            if (first.fingerprint !== second.fingerprint) {
                fail('MongoDB changed while the read-only plan was loading', 'CLASSSIGNIN_CLASSROOM_PLAN_DRIFT');
            }
            await writeJsonAtomic(planPath, second);
            return { ok: true, stage, sourcePath, manifestPath, planPath, fingerprint: second.fingerprint, summary: second.summary };
        });
    }

    const plan = await readPlan(planPath);
    assertInputIdentity(plan, source, manifest);
    if (stage === 'apply') {
        if (options.serviceStopped !== true) {
            fail('--service-stopped is required; stop Hydro before applying this migration', 'CLASSSIGNIN_CLASSROOM_SERVICE_RUNNING');
        }
        const actor = positiveInteger(options.actor, '--actor');
        if (options.backupConfirmed !== plan.fingerprint) {
            fail(
                '--backup-confirmed must equal the exact plan fingerprint after full and collection backups complete',
                'CLASSSIGNIN_CLASSROOM_BACKUP_REQUIRED',
            );
        }
        const fingerprint = String(options.fingerprint || '').trim();
        const confirmationToken = String(options.confirm || '').trim();
        if (!fingerprint || !confirmationToken) {
            fail('--fingerprint and --confirm are required', 'CLASSSIGNIN_CLASSROOM_CONFIRMATION_REQUIRED');
        }
        return withRepository(stage, dependencies, async (repository) => {
            await applyClassSigninClassroomMigration({
                plan,
                source,
                manifest,
                repository,
                actor,
                fingerprint,
                confirmationToken,
                persistPlan: (next) => writeJsonAtomic(planPath, next),
            });
            return { ok: true, stage, sourcePath, manifestPath, planPath, fingerprint: plan.fingerprint, summary: plan.summary };
        });
    }

    return withRepository(stage, dependencies, async (repository) => {
        await verifyClassSigninClassroomMigration(plan, source, manifest, repository, new Date(), (next) => writeJsonAtomic(planPath, next));
        return { ok: true, stage, sourcePath, manifestPath, planPath, fingerprint: plan.fingerprint, summary: plan.summary };
    });
}

export function register(cli: CAC, dependencies: ClassSigninClassroomMigrationCommandDependencies = { loadRepository: defaultLoadRepository }): void {
    cli.command('classroom:migrate-classsignin <stage> <source>')
        .option('--manifest <file>', 'Exact source-school to userbind-school mapping (required except validate)')
        .option('--plan <file>', 'Migration plan path (default: <source>.classroom-migration.json)')
        .option('--fingerprint <sha256>', 'Exact read-only plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:classsignin-classrooms:<fingerprint> token required by apply')
        .option('--actor <uid>', 'Site or exam-infrastructure administrator UID recorded in the audit')
        .option('--backup-confirmed <sha256>', 'Exact plan fingerprint acknowledging full and target collection backups')
        .option('--service-stopped', 'Required acknowledgement that Hydro is stopped')
        .action(async (stage: string, source: string, options: ClassSigninClassroomMigrationCommandOptions) => {
            try {
                const result = await runClassSigninClassroomMigrationCommand(stage, source, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const classSigninClassroomMigrationCommandInternals = { assertDistinctPlanPath, canonicalArtifactPath, defaultPlanPath, readPlan };
