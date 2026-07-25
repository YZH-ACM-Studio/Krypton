import path from 'node:path';
import type { CAC } from 'cac';
import { ObjectId } from 'mongodb';
import {
    applyPidNamespaceMigration,
    buildPidNamespaceMigrationPlan,
    pidNamespaceMigrationSummary,
    PidNamespaceMigrationError,
    readPidNamespaceMigrationReport,
    type PidNamespaceMigrationRepository,
    verifyPidNamespaceMigration,
} from '../lib/problem-pid-namespace-migration';
import { writeJsonAtomic } from '../lib/problem-batch-import';

interface PidNamespaceMigrationCommandOptions {
    actor?: string;
    backupConfirmed?: string;
    confirm?: string;
    fingerprint?: string;
    serviceStopped?: boolean;
}

interface PidNamespaceMigrationCommandDependencies {
    loadRepository(): Promise<PidNamespaceMigrationRepository>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

async function defaultLoadRepository(): Promise<PidNamespaceMigrationRepository> {
    const { createMongoPidNamespaceMigrationRepository } =
        require('../model/problem-pid-namespace-migration-adapter') as typeof import('../model/problem-pid-namespace-migration-adapter');
    return createMongoPidNamespaceMigrationRepository();
}

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new PidNamespaceMigrationError(`${field} must be a positive integer`, 'PID_NAMESPACE_MIGRATION_CONFIRMATION_REQUIRED');
    }
    return parsed;
}

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof PidNamespaceMigrationError ? error.code : 'PID_NAMESPACE_MIGRATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof PidNamespaceMigrationError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function withRepository<T>(
    dependencies: PidNamespaceMigrationCommandDependencies,
    callback: (repository: PidNamespaceMigrationRepository) => Promise<T>,
): Promise<T> {
    const repository = await dependencies.loadRepository();
    try {
        return await callback(repository);
    } finally {
        await repository.close?.();
    }
}

async function persistVerificationResult(
    reportPath: string,
    verify: () => Promise<void>,
    report: Awaited<ReturnType<typeof readPidNamespaceMigrationReport>>,
): Promise<void> {
    let verificationError: unknown;
    try {
        await verify();
    } catch (error) {
        verificationError = error;
    }
    try {
        await writeJsonAtomic(reportPath, report);
    } catch (persistError) {
        if (verificationError) {
            throw new AggregateError(
                [verificationError, persistError],
                'PID namespace migration verification failed and its report could not be persisted',
            );
        }
        throw persistError;
    }
    if (verificationError) throw verificationError;
}

export async function runPidNamespaceMigrationCommand(
    stage: string,
    reportInput: string,
    options: PidNamespaceMigrationCommandOptions,
    dependencies: PidNamespaceMigrationCommandDependencies,
) {
    if (!['plan', 'apply', 'verify'].includes(stage)) {
        throw new PidNamespaceMigrationError(`unsupported stage: ${stage}`, 'PID_NAMESPACE_MIGRATION_STAGE_INVALID');
    }
    const reportPath = path.resolve(reportInput);
    if (stage === 'plan') {
        return withRepository(dependencies, async (repository) => {
            const osNamespaceObjectId = new ObjectId().toHexString();
            const generatedAt = new Date();
            const first = buildPidNamespaceMigrationPlan(await repository.loadSnapshot(), osNamespaceObjectId, generatedAt);
            const second = buildPidNamespaceMigrationPlan(await repository.loadSnapshot(), osNamespaceObjectId, generatedAt);
            if (first.fingerprint !== second.fingerprint) {
                throw new PidNamespaceMigrationError(
                    'production changed while the read-only migration plan was loading',
                    'PID_NAMESPACE_MIGRATION_PLAN_DRIFT',
                    {
                        first: first.fingerprint,
                        second: second.fingerprint,
                    },
                );
            }
            await writeJsonAtomic(reportPath, second);
            return { ok: true, stage, reportPath, summary: pidNamespaceMigrationSummary(second) };
        });
    }

    const report = await readPidNamespaceMigrationReport(reportPath);
    if (options.serviceStopped !== true) {
        throw new PidNamespaceMigrationError(
            `--service-stopped is required; stop Hydro before ${stage === 'apply' ? 'applying' : 'verifying'} this migration`,
            'PID_NAMESPACE_MIGRATION_SERVICE_RUNNING',
        );
    }
    if (stage === 'apply') {
        const actor = positiveInteger(options.actor, '--actor');
        const fingerprint = String(options.fingerprint || '').trim();
        const backupConfirmed = String(options.backupConfirmed || '').trim();
        const confirmationToken = String(options.confirm || '').trim();
        if (!fingerprint || !confirmationToken) {
            throw new PidNamespaceMigrationError('--fingerprint and --confirm are required', 'PID_NAMESPACE_MIGRATION_CONFIRMATION_REQUIRED');
        }
        if (backupConfirmed !== report.fingerprint) {
            throw new PidNamespaceMigrationError(
                '--backup-confirmed must equal the exact plan fingerprint after the required full and collection backups complete',
                'PID_NAMESPACE_MIGRATION_BACKUP_REQUIRED',
            );
        }
        return withRepository(dependencies, async (repository) => {
            await applyPidNamespaceMigration({
                report,
                repository,
                actor,
                fingerprint,
                confirmationToken,
                persistReport: (next) => writeJsonAtomic(reportPath, next),
            });
            return { ok: true, stage, reportPath, summary: pidNamespaceMigrationSummary(report) };
        });
    }

    return withRepository(dependencies, async (repository) => {
        await persistVerificationResult(reportPath, () => verifyPidNamespaceMigration(report, repository), report);
        return { ok: true, stage, reportPath, summary: pidNamespaceMigrationSummary(report) };
    });
}

export function register(cli: CAC, dependencies: PidNamespaceMigrationCommandDependencies = { loadRepository: defaultLoadRepository }): void {
    cli.command('problem:pid-namespace-migrate <stage> <report>')
        .option('--fingerprint <sha256>', 'Exact read-only plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:problem-pid-namespace:<fingerprint> token required by apply')
        .option('--actor <uid>', 'System administrator UID recorded in the migration audit')
        .option('--backup-confirmed <sha256>', 'Exact plan fingerprint acknowledging the required full and collection backups')
        .option('--service-stopped', 'Required acknowledgement that Hydro is stopped')
        .action(async (stage: string, report: string, options: PidNamespaceMigrationCommandOptions) => {
            try {
                const result = await runPidNamespaceMigrationCommand(stage, report, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const pidNamespaceMigrationCommandInternals = {
    persistVerificationResult,
    runPidNamespaceMigrationCommand,
};
