import path from 'node:path';
import type { CAC } from 'cac';
import { ObjectId } from 'mongodb';
import {
    applyMindmapMultiMigration,
    buildMindmapMultiMigrationPlan,
    MindmapMultiMigrationError,
    mindmapMultiMigrationSummary,
    readMindmapMultiMigrationReport,
    type MindmapMultiMigrationRepository,
    verifyMindmapMultiMigration,
} from '../lib/mindmap-multi-migration';
import { writeJsonAtomic } from '../lib/problem-batch-import';

interface MindmapMultiMigrationCommandOptions {
    actor?: string;
    backupConfirmed?: string;
    confirm?: string;
    fingerprint?: string;
    serviceStopped?: boolean;
}

interface MindmapMultiMigrationCommandDependencies {
    loadRepository(): Promise<MindmapMultiMigrationRepository>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

async function defaultLoadRepository(): Promise<MindmapMultiMigrationRepository> {
    const { createMongoMindmapMultiMigrationRepository } =
        require('../model/mindmap-multi-migration-adapter') as typeof import('../model/mindmap-multi-migration-adapter');
    return createMongoMindmapMultiMigrationRepository();
}

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new MindmapMultiMigrationError(`${field} must be a positive integer`, 'MINDMAP_MULTI_MIGRATION_CONFIRMATION_REQUIRED');
    }
    return parsed;
}

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof MindmapMultiMigrationError ? error.code : 'MINDMAP_MULTI_MIGRATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof MindmapMultiMigrationError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function withRepository<T>(
    dependencies: MindmapMultiMigrationCommandDependencies,
    callback: (repository: MindmapMultiMigrationRepository) => Promise<T>,
) {
    const repository = await dependencies.loadRepository();
    try {
        return await callback(repository);
    } finally {
        await repository.close?.();
    }
}

export async function runMindmapMultiMigrationCommand(
    stage: string,
    reportInput: string,
    options: MindmapMultiMigrationCommandOptions,
    dependencies: MindmapMultiMigrationCommandDependencies,
) {
    if (!['plan', 'apply', 'verify'].includes(stage)) {
        throw new MindmapMultiMigrationError(`unsupported stage: ${stage}`, 'MINDMAP_MULTI_MIGRATION_STAGE_INVALID');
    }
    const reportPath = path.resolve(reportInput);
    if (stage === 'plan') {
        return withRepository(dependencies, async (repository) => {
            const targetMapId = new ObjectId();
            const generatedAt = new Date();
            const first = buildMindmapMultiMigrationPlan(await repository.loadSnapshot(), targetMapId, generatedAt);
            const second = buildMindmapMultiMigrationPlan(await repository.loadSnapshot(), targetMapId, generatedAt);
            if (first.fingerprint !== second.fingerprint) {
                throw new MindmapMultiMigrationError(
                    'production changed while the read-only migration plan was loading',
                    'MINDMAP_MULTI_MIGRATION_PLAN_DRIFT',
                );
            }
            await writeJsonAtomic(reportPath, second);
            return { ok: true, stage, reportPath, summary: mindmapMultiMigrationSummary(second) };
        });
    }

    const report = await readMindmapMultiMigrationReport(reportPath);
    if (stage === 'apply') {
        if (options.serviceStopped !== true) {
            throw new MindmapMultiMigrationError(
                '--service-stopped is required; stop Hydro before applying this migration',
                'MINDMAP_MULTI_MIGRATION_SERVICE_RUNNING',
            );
        }
        const actor = positiveInteger(options.actor, '--actor');
        const fingerprint = String(options.fingerprint || '').trim();
        const backupConfirmed = String(options.backupConfirmed || '').trim();
        const confirmationToken = String(options.confirm || '').trim();
        if (!fingerprint || !confirmationToken) {
            throw new MindmapMultiMigrationError('--fingerprint and --confirm are required', 'MINDMAP_MULTI_MIGRATION_CONFIRMATION_REQUIRED');
        }
        if (backupConfirmed !== report.fingerprint) {
            throw new MindmapMultiMigrationError(
                '--backup-confirmed must equal the exact plan fingerprint after the required full and collection backups complete',
                'MINDMAP_MULTI_MIGRATION_BACKUP_REQUIRED',
            );
        }
        return withRepository(dependencies, async (repository) => {
            await applyMindmapMultiMigration({
                report,
                repository,
                actor,
                fingerprint,
                confirmationToken,
                persistReport: (next) => writeJsonAtomic(reportPath, next),
            });
            return { ok: true, stage, reportPath, summary: mindmapMultiMigrationSummary(report) };
        });
    }

    return withRepository(dependencies, async (repository) => {
        await verifyMindmapMultiMigration(report, repository);
        await writeJsonAtomic(reportPath, report);
        return { ok: true, stage, reportPath, summary: mindmapMultiMigrationSummary(report) };
    });
}

export function register(cli: CAC, dependencies: MindmapMultiMigrationCommandDependencies = { loadRepository: defaultLoadRepository }): void {
    cli.command('mindmap:migrate-multi <stage> <report>')
        .option('--fingerprint <sha256>', 'Exact read-only plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:mindmap-migrate-multi:<fingerprint> token required by apply')
        .option('--actor <uid>', 'System administrator UID recorded in the migration audit')
        .option('--backup-confirmed <sha256>', 'Exact plan fingerprint acknowledging the required full and collection backups')
        .option('--service-stopped', 'Required acknowledgement that Hydro is stopped')
        .action(async (stage: string, report: string, options: MindmapMultiMigrationCommandOptions) => {
            try {
                const result = await runMindmapMultiMigrationCommand(stage, report, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const mindmapMultiMigrationCommandInternals = { runMindmapMultiMigrationCommand };
