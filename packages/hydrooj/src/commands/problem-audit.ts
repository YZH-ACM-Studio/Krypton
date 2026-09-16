import path from 'node:path';
import type { CAC } from 'cac';
import {
    parsePatMap,
    parsePidFilter,
    parseProblemAuditKind,
    persistProblemAuditReport,
    ProblemAuditError,
    problemAuditSummary,
    readPatMapFile,
    runProblemAudit,
    type ProblemAuditAdapter,
    type ProblemAuditKind,
} from '../lib/problem-audit';

interface ProblemAuditCommandOptions {
    domain?: string;
    allDomains?: boolean;
    pid?: string;
    fileRoot?: string;
    patMap?: string;
}

interface ProblemAuditCommandDependencies {
    loadAdapter(kind: ProblemAuditKind, fileRoot?: string): Promise<ProblemAuditAdapter>;
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function structuredError(error: unknown): Error {
    const payload = {
        ok: false,
        error: {
            code: error instanceof ProblemAuditError ? error.code : 'PROBLEM_AUDIT_FAILED',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof ProblemAuditError && error.details !== undefined ? { details: error.details } : {}),
        },
    };
    const wrapped = new Error(payload.error.message);
    wrapped.stack = JSON.stringify(payload);
    return wrapped;
}

async function defaultLoadAdapter(kind: ProblemAuditKind, fileRoot?: string): Promise<ProblemAuditAdapter> {
    const { createReadonlyProblemAuditAdapter } =
        require('../model/problem-audit-readonly-adapter') as typeof import('../model/problem-audit-readonly-adapter');
    if (kind !== 'testdata-eol' && fileRoot) {
        throw new ProblemAuditError('--file-root is only valid for testdata-eol', 'PROBLEM_AUDIT_OPTION_INVALID');
    }
    return createReadonlyProblemAuditAdapter(fileRoot);
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

async function withAdapter<T>(
    kind: ProblemAuditKind,
    fileRoot: string | undefined,
    dependencies: ProblemAuditCommandDependencies,
    callback: (adapter: ProblemAuditAdapter) => Promise<T>,
): Promise<T> {
    return withRuntimeOutputOnStderr(async () => {
        const adapter = await dependencies.loadAdapter(kind, fileRoot);
        try {
            return await callback(adapter);
        } finally {
            await adapter.close?.();
        }
    });
}

export async function runProblemAuditCommand(
    kindInput: string,
    reportInput: string,
    options: ProblemAuditCommandOptions,
    dependencies: ProblemAuditCommandDependencies,
) {
    const kind = parseProblemAuditKind(kindInput);
    const reportPath = path.resolve(reportInput);
    const pids = parsePidFilter(options.pid);
    const patMap = options.patMap ? await readPatMapFile(path.resolve(options.patMap)) : parsePatMap({});
    if (options.patMap && kind !== 'pat') {
        throw new ProblemAuditError('--pat-map is only valid for pat', 'PROBLEM_AUDIT_OPTION_INVALID');
    }
    return withAdapter(kind, options.fileRoot, dependencies, async (adapter) => {
        const report = await runProblemAudit({
            kind,
            adapter,
            domainId: options.domain,
            allDomains: options.allDomains === true,
            pids,
            patMap,
        });
        const persisted = await persistProblemAuditReport(reportPath, report);
        return {
            ok: true as const,
            kind,
            reportPath: persisted.reportPath,
            markdownPath: persisted.markdownPath,
            summary: problemAuditSummary(report),
        };
    });
}

export function register(cli: CAC, dependencies: ProblemAuditCommandDependencies = { loadAdapter: defaultLoadAdapter }): void {
    cli.command('problem:audit <kind> <report>')
        .option('--domain <id>', 'Domain to scan (default system)')
        .option('--all-domains', 'Scan every domain')
        .option('--pid <pids>', 'Comma-separated pid filter')
        .option('--file-root <path>', 'Local testdata blob root for testdata-eol')
        .option('--pat-map <file>', 'JSON map of pid to 4-digit PAT id')
        .action(async (kind: string, report: string, options: ProblemAuditCommandOptions) => {
            try {
                const result = await runProblemAuditCommand(kind, report, options, dependencies);
                originalStdoutWrite(`${JSON.stringify(result)}\n`);
            } catch (error) {
                throw structuredError(error);
            }
        });
}

export const problemAuditCommandInternals = { runProblemAuditCommand };
