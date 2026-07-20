import path from 'node:path';
import type { CAC } from 'cac';
import {
    applyFunction3049Migration,
    buildFunction3049MigrationPlan,
    Function3049MigrationError,
    function3049MigrationSummary,
    readFunction3049MigrationReport,
    type Function3049MigrationRepository,
    verifyFunction3049Migration,
} from '../lib/function-3049-migration';
import { writeJsonAtomic } from '../lib/problem-batch-import';

interface Function3049MigrationCommandOptions {
    actor?: string;
    backupConfirmed?: string;
    confirm?: string;
    fingerprint?: string;
    serviceStopped?: boolean;
}

interface Function3049MigrationCommandDependencies {
    loadRepository(): Promise<Function3049MigrationRepository>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

async function defaultLoadRepository(): Promise<Function3049MigrationRepository> {
    const { createMongoFunction3049MigrationRepository } =
        require('../model/function-3049-migration-adapter') as typeof import('../model/function-3049-migration-adapter');
    return createMongoFunction3049MigrationRepository();
}

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Function3049MigrationError(`${field} must be a positive integer`, 'FUNCTION_3049_MIGRATION_CONFIRMATION_REQUIRED');
    }
    return parsed;
}

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof Function3049MigrationError ? error.code : 'FUNCTION_3049_MIGRATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Function3049MigrationError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function withRepository<T>(
    dependencies: Function3049MigrationCommandDependencies,
    callback: (repository: Function3049MigrationRepository) => Promise<T>,
) {
    const repository = await dependencies.loadRepository();
    try {
        return await callback(repository);
    } finally {
        await repository.close?.();
    }
}

export async function runFunction3049MigrationCommand(
    stage: string,
    reportInput: string,
    options: Function3049MigrationCommandOptions,
    dependencies: Function3049MigrationCommandDependencies,
) {
    if (!['plan', 'apply', 'verify'].includes(stage)) {
        throw new Function3049MigrationError(`unsupported stage: ${stage}`, 'FUNCTION_3049_MIGRATION_STAGE_INVALID');
    }
    const reportPath = path.resolve(reportInput);
    if (stage === 'plan') {
        return withRepository(dependencies, async (repository) => {
            const generatedAt = new Date();
            const first = buildFunction3049MigrationPlan(await repository.loadSnapshot(), generatedAt);
            const second = buildFunction3049MigrationPlan(await repository.loadSnapshot(), generatedAt);
            if (first.fingerprint !== second.fingerprint) {
                throw new Function3049MigrationError(
                    'production changed while the read-only migration plan was loading',
                    'FUNCTION_3049_MIGRATION_PLAN_DRIFT',
                );
            }
            await writeJsonAtomic(reportPath, second);
            return { ok: true, stage, reportPath, summary: function3049MigrationSummary(second) };
        });
    }

    const report = await readFunction3049MigrationReport(reportPath);
    if (stage === 'apply') {
        if (options.serviceStopped !== true) {
            throw new Function3049MigrationError(
                '--service-stopped is required; stop Hydro before applying this protocol migration',
                'FUNCTION_3049_MIGRATION_SERVICE_RUNNING',
            );
        }
        const actor = positiveInteger(options.actor, '--actor');
        const fingerprint = String(options.fingerprint || '').trim();
        const backupConfirmed = String(options.backupConfirmed || '').trim();
        const confirmationToken = String(options.confirm || '').trim();
        if (!fingerprint || !confirmationToken) {
            throw new Function3049MigrationError('--fingerprint and --confirm are required', 'FUNCTION_3049_MIGRATION_CONFIRMATION_REQUIRED');
        }
        if (backupConfirmed !== report.fingerprint) {
            throw new Function3049MigrationError(
                '--backup-confirmed must equal the exact plan fingerprint after the required full and target collection backups complete',
                'FUNCTION_3049_MIGRATION_BACKUP_REQUIRED',
            );
        }
        return withRepository(dependencies, async (repository) => {
            await applyFunction3049Migration({
                report,
                repository,
                actor,
                fingerprint,
                confirmationToken,
                persistReport: (next) => writeJsonAtomic(reportPath, next),
            });
            return { ok: true, stage, reportPath, summary: function3049MigrationSummary(report) };
        });
    }

    return withRepository(dependencies, async (repository) => {
        await verifyFunction3049Migration(report, repository);
        await writeJsonAtomic(reportPath, report);
        return { ok: true, stage, reportPath, summary: function3049MigrationSummary(report) };
    });
}

export function register(cli: CAC, dependencies: Function3049MigrationCommandDependencies = { loadRepository: defaultLoadRepository }): void {
    cli.command('problem:migrate-function-3049 <stage> <report>')
        .option('--fingerprint <sha256>', 'Exact read-only plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:function-3049:<fingerprint> token required by apply')
        .option('--actor <uid>', 'System administrator UID recorded in the migration audit')
        .option('--backup-confirmed <sha256>', 'Exact plan fingerprint acknowledging the required full and target collection backups')
        .option('--service-stopped', 'Required acknowledgement that Hydro is stopped')
        .action(async (stage: string, report: string, options: Function3049MigrationCommandOptions) => {
            try {
                const result = await runFunction3049MigrationCommand(stage, report, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const function3049MigrationCommandInternals = { runFunction3049MigrationCommand };
