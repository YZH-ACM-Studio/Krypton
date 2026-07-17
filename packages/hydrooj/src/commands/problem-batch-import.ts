import path from 'node:path';
import type { CAC } from 'cac';
import {
    applyProblemBatchImport,
    createProblemBatchExecutionReport,
    type ProblemBatchImportAdapter,
    ProblemBatchImportError,
    preflightProblemBatchImport,
    problemBatchValidationSummary,
    readProblemBatchExecutionReport,
    readProblemBatchPlan,
    validateProblemBatchManifest,
    verifyProblemBatchImport,
    writeJsonAtomic,
} from '../lib/problem-batch-import';

interface ProblemBatchCommandOptions {
    actor?: string;
    confirm?: string;
    fingerprint?: string;
    plan?: string;
    report?: string;
}

type RuntimeStage = 'preflight' | 'apply' | 'verify';
type RuntimeAdapter = ProblemBatchImportAdapter & { close?: () => Promise<void> };

interface ProblemBatchCommandDependencies {
    loadRuntimeAdapter(stage: RuntimeStage): Promise<RuntimeAdapter>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function artifactPath(manifestPath: string, suffix: 'preflight' | 'execution'): string {
    const resolved = path.resolve(manifestPath);
    const extension = path.extname(resolved);
    const stem = extension ? resolved.slice(0, -extension.length) : resolved;
    return `${stem}.${suffix}.json`;
}

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ProblemBatchImportError(`${field} must be a positive integer`, 'BATCH_IMPORT_CONFIRMATION_REQUIRED');
    }
    return parsed;
}

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof ProblemBatchImportError ? error.code : 'BATCH_IMPORT_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof ProblemBatchImportError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function defaultLoadRuntimeAdapter(stage: RuntimeStage): Promise<RuntimeAdapter> {
    if (stage === 'preflight') {
        const { createReadonlyProblemBatchImportAdapter } =
            require('../model/problem-batch-readonly-adapter') as typeof import('../model/problem-batch-readonly-adapter');
        return createReadonlyProblemBatchImportAdapter();
    }
    const { loadAddonCommandContext } = require('../loader') as typeof import('../loader');
    await loadAddonCommandContext();
    const { default: HydroProblemBatchImportAdapter } =
        require('../model/problem-batch-import-adapter') as typeof import('../model/problem-batch-import-adapter');
    return new HydroProblemBatchImportAdapter();
}

async function withRuntimeOutputOnStderr<T>(callback: () => Promise<T>): Promise<T> {
    const stdout = process.stdout.write;
    process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    try {
        return await callback();
    } finally {
        process.stdout.write = stdout;
    }
}

async function withRuntimeAdapter<T>(
    stage: RuntimeStage,
    dependencies: ProblemBatchCommandDependencies,
    callback: (adapter: RuntimeAdapter) => Promise<T>,
): Promise<T> {
    return withRuntimeOutputOnStderr(async () => {
        const adapter = await dependencies.loadRuntimeAdapter(stage);
        try {
            return await callback(adapter);
        } finally {
            await adapter.close?.();
        }
    });
}

async function runProblemBatchCommand(
    stage: string,
    manifestInput: string,
    options: ProblemBatchCommandOptions,
    dependencies: ProblemBatchCommandDependencies,
): Promise<unknown> {
    if (!['validate', 'preflight', 'apply', 'verify'].includes(stage)) {
        throw new ProblemBatchImportError(`unsupported stage: ${stage}`, 'BATCH_IMPORT_STAGE_INVALID');
    }
    const manifestPath = path.resolve(manifestInput);
    const batch = await validateProblemBatchManifest(manifestPath);
    if (stage === 'validate') return problemBatchValidationSummary(batch);

    const planPath = path.resolve(options.plan || artifactPath(manifestPath, 'preflight'));
    const reportPath = path.resolve(options.report || artifactPath(manifestPath, 'execution'));
    if (stage === 'preflight') {
        return withRuntimeAdapter(stage, dependencies, async (adapter) => {
            const plan = await preflightProblemBatchImport(batch, adapter);
            await writeJsonAtomic(planPath, plan);
            return { ok: true, stage, batchId: batch.manifest.batchId, planPath, plan };
        });
    }

    const plan = await readProblemBatchPlan(planPath);
    if (stage === 'apply') {
        const actor = positiveInteger(options.actor, '--actor');
        const fingerprint = options.fingerprint === undefined ? '' : String(options.fingerprint).trim();
        const confirmationToken = options.confirm === undefined ? '' : String(options.confirm).trim();
        if (!fingerprint) {
            throw new ProblemBatchImportError('--fingerprint is required', 'BATCH_IMPORT_CONFIRMATION_REQUIRED');
        }
        if (!confirmationToken) {
            throw new ProblemBatchImportError('--confirm is required', 'BATCH_IMPORT_CONFIRMATION_REQUIRED');
        }
        const existing = await readProblemBatchExecutionReport(reportPath);
        const report = existing || createProblemBatchExecutionReport(plan, actor);
        return withRuntimeAdapter(stage, dependencies, async (adapter) => {
            const result = await applyProblemBatchImport({
                batch,
                plan,
                adapter,
                actor,
                fingerprint,
                confirmationToken,
                report,
                persistReport: (next) => writeJsonAtomic(reportPath, next),
            });
            return { ok: true, stage, batchId: batch.manifest.batchId, planPath, reportPath, result };
        });
    }

    const report = await readProblemBatchExecutionReport(reportPath);
    return withRuntimeAdapter('verify', dependencies, async (adapter) => {
        const result = await verifyProblemBatchImport({
            batch,
            plan,
            adapter,
            ...(report ? { report, persistReport: (next: typeof report) => writeJsonAtomic(reportPath, next) } : {}),
        });
        return { ok: true, stage, batchId: batch.manifest.batchId, planPath, ...(report ? { reportPath } : {}), result };
    });
}

export function register(cli: CAC, dependencies: ProblemBatchCommandDependencies = { loadRuntimeAdapter: defaultLoadRuntimeAdapter }): void {
    cli.command('problem:batch-import <stage> <manifest>')
        .option('--plan <file>', 'Preflight plan path (default: <manifest>.preflight.json)')
        .option('--report <file>', 'Execution report path (default: <manifest>.execution.json)')
        .option('--fingerprint <sha256>', 'Exact preflight plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:<batchId> token required by apply')
        .option('--actor <uid>', 'Exact manifest actor UID required by apply')
        .action(async (stage: string, manifest: string, options: ProblemBatchCommandOptions) => {
            try {
                const result = await runProblemBatchCommand(stage, manifest, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const problemBatchCommandInternals = { artifactPath, runProblemBatchCommand };
