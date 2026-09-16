/**
 * hydrooj campus-net:tick
 *
 * Two discovery paths, neither of which may be added to hydrooj/bin/commands.ts:
 *
 * 1. Top-level `hydrooj campus-net:tick` — Hydro's bin/commands.ts only
 *    requires `$addon/command.ts` (then command.js) for paths in
 *    ~/.hydro/addon.json (getAddons()). Builtin addons are not listed there.
 * 2. `hydrooj cli campus-net:tick` — loadCli() preloads BUILTIN_ADDONS and
 *    calls apply(). There is no ctx.cli during that runtime, so apply()
 *    dispatches this argv explicitly.
 */
import { Logger } from '@hydrooj/utils';
import type { CampusNetTickOptions, CampusNetTickResult } from './daemon';

const logger = new Logger('campus-net.cli');

export const CAMPUS_NET_TICK_COMMAND = 'campus-net:tick';

export interface CampusNetCliCommand {
    option(flags: string, description: string): CampusNetCliCommand;
    action(handler: (options: CampusNetTickCliOptions) => Promise<void> | void): CampusNetCliCommand;
}

export interface CampusNetCli {
    command(name: string): CampusNetCliCommand;
}

export interface CampusNetCliContext {
    get?(name: string): unknown;
    cli?: CampusNetCli;
}

export interface CampusNetTickCliOptions {
    envFile?: string;
    stateFile?: string;
}

export type CampusNetTickRunner = (options: CampusNetTickCliOptions) => Promise<CampusNetTickResult | void>;

export interface DispatchHydroCliTickOptions {
    argv?: readonly string[];
    env?: NodeJS.ProcessEnv;
    runTick?: CampusNetTickRunner;
    writeStdout?: (chunk: string) => void;
    writeStderr?: (chunk: string) => void;
    exitProcess?: (code: number) => void;
}

async function loadCampusNetRuntime(): Promise<void> {
    const { loadAddonCommandContext } = require('hydrooj/src/loader') as {
        loadAddonCommandContext(): Promise<void>;
    };
    await loadAddonCommandContext();
}

function tickOptionsFromCli(options: CampusNetTickCliOptions): CampusNetTickOptions {
    const tickOptions: CampusNetTickOptions = {};
    if (options.envFile) tickOptions.envFile = options.envFile;
    if (options.stateFile) tickOptions.stateFile = options.stateFile;
    return tickOptions;
}

export async function runCampusNetTickCommand(options: CampusNetTickCliOptions = {}): Promise<CampusNetTickResult> {
    await loadCampusNetRuntime();
    const { tick } = require('./daemon') as typeof import('./daemon');
    return tick(tickOptionsFromCli(options));
}

/** Runtime is already loaded by `hydrooj cli`; do not call loadAddonCommandContext again. */
export async function runCampusNetTickInLoadedRuntime(options: CampusNetTickCliOptions = {}): Promise<CampusNetTickResult> {
    const { tick } = require('./daemon') as typeof import('./daemon');
    return tick(tickOptionsFromCli(options));
}

/** Addon command.ts: `export function register(cli) { registerCommands({ cli }); }` */
export function register(cli: CampusNetCli): void {
    registerCommands({ cli });
}

export function registerCommands(ctx: CampusNetCliContext, runTick: CampusNetTickRunner = runCampusNetTickCommand): void {
    let cli: CampusNetCli | undefined;
    try {
        cli = (ctx.get?.('cli') as CampusNetCli | undefined) ?? ctx.cli;
    } catch {
        cli = undefined;
    }
    if (!cli) return;

    cli.command(CAMPUS_NET_TICK_COMMAND)
        .option('--env-file <path>', 'Root-only env file with CAMPUS_NET_USERNAME / CAMPUS_NET_PASSWORD')
        .option('--state-file <path>', 'Persisted last connectivity state')
        .action(async (options: CampusNetTickCliOptions) => {
            reportTickResult(await runTick(options));
        });
}

export function listPositionalArgv(argv: readonly string[]): string[] {
    const args = argv.slice(2);
    const positionals: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') continue;
        if (arg.startsWith('--')) {
            if (!arg.includes('=')) {
                const next = args[i + 1];
                if (next !== undefined && !next.startsWith('-')) i += 1;
            }
            continue;
        }
        if (arg.startsWith('-') && arg !== '-') continue;
        positionals.push(arg);
    }
    return positionals;
}

export function parseCampusNetTickArgv(argv: readonly string[]): CampusNetTickCliOptions {
    const options: CampusNetTickCliOptions = {};
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const envFile = readFlagValue(args, i, '--env-file');
        if (envFile.matched) {
            options.envFile = envFile.value;
            i = envFile.nextIndex;
            continue;
        }
        const stateFile = readFlagValue(args, i, '--state-file');
        if (stateFile.matched) {
            options.stateFile = stateFile.value;
            i = stateFile.nextIndex;
            continue;
        }
    }
    return options;
}

export function isHydroCliCampusNetTick(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.HYDRO_CLI !== 'true') return false;
    if (env.HYDRO_ADDON_COMMAND_CONTEXT === 'true') return false;
    const positionals = listPositionalArgv(argv);
    return positionals.length === 2 && positionals[0] === 'cli' && positionals[1] === CAMPUS_NET_TICK_COMMAND;
}

export async function dispatchHydroCliTick(options: DispatchHydroCliTickOptions = {}): Promise<boolean> {
    const argv = options.argv ?? process.argv;
    const env = options.env ?? process.env;
    if (!isHydroCliCampusNetTick(argv, env)) return false;

    const runTick = options.runTick ?? runCampusNetTickInLoadedRuntime;
    const writeStdout = options.writeStdout ?? ((chunk: string) => process.stdout.write(chunk));
    const writeStderr = options.writeStderr ?? ((chunk: string) => process.stderr.write(chunk));
    const exitProcess = options.exitProcess ?? ((code: number) => process.exit(code));

    try {
        reportTickResult(await runTick(parseCampusNetTickArgv(argv)), writeStdout);
        exitProcess(0);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        writeStderr(`${message}\n`);
        exitProcess(1);
        return true;
    }
}

function reportTickResult(
    result: CampusNetTickResult | void,
    writeStdout: (chunk: string) => void = (chunk) => process.stdout.write(chunk),
): void {
    if (!result) return;
    logger.info(
        'tick connectivity=%s previous=%s notified=%s',
        result.connectivity,
        result.previousConnectivity,
        result.notified.join(',') || 'none',
    );
    writeStdout(`${JSON.stringify(result)}\n`);
}

function readFlagValue(
    args: readonly string[],
    index: number,
    flag: string,
): { matched: false } | { matched: true; value: string | undefined; nextIndex: number } {
    const arg = args[index];
    if (arg === flag) {
        return { matched: true, value: args[index + 1], nextIndex: index + 1 };
    }
    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
        return { matched: true, value: arg.slice(prefix.length), nextIndex: index };
    }
    return { matched: false };
}
