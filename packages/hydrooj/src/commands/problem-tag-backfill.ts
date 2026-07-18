import fs from 'node:fs/promises';
import path from 'node:path';
import type { CAC } from 'cac';
import {
    applyProblemTagBackfill,
    planProblemTagBackfill,
    ProblemTagBackfillError,
    type ProblemTagBackfillPlanAdapter,
    type ProblemTagBackfillReport,
    type ProblemTagBackfillRuntimeAdapter,
    problemTagBackfillSummary,
    readProblemTagBackfillReport,
    renderProblemTagBackfillMarkdown,
    verifyProblemTagBackfill,
} from '../lib/problem-tag-backfill';
import { writeJsonAtomic } from '../lib/problem-batch-import';

interface ProblemTagBackfillCommandOptions {
    actor?: string;
    confirm?: string;
    fingerprint?: string;
}

type RuntimeStage = 'plan' | 'apply' | 'verify';
type RuntimeAdapter = Partial<ProblemTagBackfillPlanAdapter & ProblemTagBackfillRuntimeAdapter> & {
    close?(): Promise<void>;
};

interface ProblemTagBackfillCommandDependencies {
    loadRuntimeAdapter(stage: RuntimeStage): Promise<RuntimeAdapter>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ProblemTagBackfillError(`${field} must be a positive integer`, 'PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED');
    }
    return parsed;
}

function markdownPath(reportPath: string): string {
    const extension = path.extname(reportPath);
    return `${extension ? reportPath.slice(0, -extension.length) : reportPath}.md`;
}

async function writeMarkdownAtomic(filename: string, body: string): Promise<void> {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.tmp-${process.pid}`;
    await fs.writeFile(temporary, body, { mode: 0o600 });
    await fs.rename(temporary, filename);
}

async function persistArtifacts(reportPath: string, report: ProblemTagBackfillReport, includeMarkdown: boolean): Promise<void> {
    await writeJsonAtomic(reportPath, report);
    if (includeMarkdown) await writeMarkdownAtomic(markdownPath(reportPath), renderProblemTagBackfillMarkdown(report));
}

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof ProblemTagBackfillError ? error.code : 'PROBLEM_TAG_BACKFILL_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof ProblemTagBackfillError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function defaultLoadRuntimeAdapter(stage: RuntimeStage): Promise<RuntimeAdapter> {
    if (stage === 'plan') {
        const { createReadonlyProblemTagBackfillAdapter } =
            require('../model/problem-tag-backfill-readonly-adapter') as typeof import('../model/problem-tag-backfill-readonly-adapter');
        return createReadonlyProblemTagBackfillAdapter();
    }
    const { loadAddonCommandContext } = require('../loader') as typeof import('../loader');
    await loadAddonCommandContext();
    const { default: HydroProblemTagBackfillAdapter } =
        require('../model/problem-tag-backfill-adapter') as typeof import('../model/problem-tag-backfill-adapter');
    return new HydroProblemTagBackfillAdapter();
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
    dependencies: ProblemTagBackfillCommandDependencies,
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

async function runProblemTagBackfillCommand(
    stage: string,
    reportInput: string,
    options: ProblemTagBackfillCommandOptions,
    dependencies: ProblemTagBackfillCommandDependencies,
) {
    if (!['plan', 'apply', 'verify'].includes(stage)) {
        throw new ProblemTagBackfillError(`unsupported stage: ${stage}`, 'PROBLEM_TAG_BACKFILL_STAGE_INVALID');
    }
    const reportPath = path.resolve(reportInput);
    if (stage === 'plan') {
        return withRuntimeAdapter('plan', dependencies, async (adapter) => {
            if (typeof adapter.loadPlanFacts !== 'function' || typeof adapter.preview !== 'function') {
                throw new ProblemTagBackfillError('plan adapter is incomplete', 'PROBLEM_TAG_BACKFILL_STAGE_INVALID');
            }
            const report = await planProblemTagBackfill(adapter as ProblemTagBackfillPlanAdapter);
            await persistArtifacts(reportPath, report, true);
            return { ok: true, stage, reportPath, markdownPath: markdownPath(reportPath), summary: problemTagBackfillSummary(report) };
        });
    }

    const report = await readProblemTagBackfillReport(reportPath);
    const runtime = (adapter: RuntimeAdapter): ProblemTagBackfillRuntimeAdapter => {
        if (
            typeof adapter.prepareActor !== 'function' ||
            typeof adapter.loadMindmapFingerprint !== 'function' ||
            typeof adapter.inspectEntryStateFingerprint !== 'function' ||
            typeof adapter.applyReady !== 'function' ||
            typeof adapter.verifyEntry !== 'function'
        ) {
            throw new ProblemTagBackfillError('runtime adapter is incomplete', 'PROBLEM_TAG_BACKFILL_STAGE_INVALID');
        }
        return adapter as ProblemTagBackfillRuntimeAdapter;
    };
    if (stage === 'apply') {
        const actor = positiveInteger(options.actor, '--actor');
        const fingerprint = String(options.fingerprint || '').trim();
        const confirmationToken = String(options.confirm || '').trim();
        if (!fingerprint || !confirmationToken) {
            throw new ProblemTagBackfillError('--fingerprint and --confirm are required', 'PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED');
        }
        return withRuntimeAdapter('apply', dependencies, async (adapter) => {
            try {
                const summary = await applyProblemTagBackfill({
                    report,
                    adapter: runtime(adapter),
                    actor,
                    fingerprint,
                    confirmationToken,
                    persistReport: (next) => persistArtifacts(reportPath, next, false),
                });
                await persistArtifacts(reportPath, report, true);
                return { ok: true, stage, reportPath, markdownPath: markdownPath(reportPath), summary };
            } catch (error) {
                await persistArtifacts(reportPath, report, true);
                throw error;
            }
        });
    }

    return withRuntimeAdapter('verify', dependencies, async (adapter) => {
        try {
            const summary = await verifyProblemTagBackfill({
                report,
                adapter: runtime(adapter),
                persistReport: (next) => persistArtifacts(reportPath, next, false),
            });
            await persistArtifacts(reportPath, report, true);
            return { ok: true, stage, reportPath, markdownPath: markdownPath(reportPath), summary };
        } catch (error) {
            await persistArtifacts(reportPath, report, true);
            throw error;
        }
    });
}

export function register(cli: CAC, dependencies: ProblemTagBackfillCommandDependencies = { loadRuntimeAdapter: defaultLoadRuntimeAdapter }): void {
    cli.command('problem:tag-backfill <stage> <report>')
        .option('--fingerprint <sha256>', 'Exact plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:problem-tag-backfill:<fingerprint> token required by apply')
        .option('--actor <uid>', 'Site administrator UID required by apply')
        .action(async (stage: string, report: string, options: ProblemTagBackfillCommandOptions) => {
            try {
                const result = await runProblemTagBackfillCommand(stage, report, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const problemTagBackfillCommandInternals = { markdownPath, runProblemTagBackfillCommand };
