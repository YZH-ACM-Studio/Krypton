/**
 * One campus-net tick: probe public internet; if down, EPortal login; notify
 * Hydro uname `root` only on 通→断 / 断→通 / new dial-fail.
 */
import { chmod, lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { Logger } from '@hydrooj/utils';
import { EPortalLoginError, login as eportalLogin } from './eportal';
import {
    notifyRoot as sendCampusNetNotify,
    shouldNotifyTransition,
    type CampusNetNotifyEvent,
    type CampusNetNotifyPayload,
    type CampusNetObservedState,
} from './notify';
import { probeInternet as probePublicInternet, type InternetProbeResult } from './probe';

const logger = new Logger('campus-net');

export const DEFAULT_CAMPUS_NET_ENV_FILE = '/root/.hydro/campus-net.env';
export const DEFAULT_CAMPUS_NET_STATE_FILE = '/root/.hydro/campus-net.state';
export const CAMPUS_NET_USERNAME_ENV = 'CAMPUS_NET_USERNAME';
export const CAMPUS_NET_PASSWORD_ENV = 'CAMPUS_NET_PASSWORD';
export const CAMPUS_NET_STATE_FILE_ENV = 'CAMPUS_NET_STATE_FILE';

const MAX_ENV_FILE_CHARS = 64 * 1024;
const MAX_STATE_FILE_CHARS = 4096;

export interface CampusNetPersistedState {
    connectivity: 'up' | 'down';
    dialFailNotified: boolean;
}

export type CampusNetPreviousConnectivity = 'up' | 'down' | 'unknown';

export interface CampusNetCredentials {
    username: string;
    password: string;
}

export interface CampusNetStateStore {
    load(): Promise<CampusNetPersistedState | null>;
    save(state: CampusNetPersistedState): Promise<void>;
}

export interface CampusNetTickOptions {
    envFile?: string;
    stateFile?: string;
    env?: NodeJS.ProcessEnv;
    credentials?: CampusNetCredentials;
    stateStore?: CampusNetStateStore;
    probeInternet?: () => Promise<InternetProbeResult>;
    login?: (username: string, password: string) => ReturnType<typeof eportalLogin>;
    notifyRoot?: (payload: CampusNetNotifyPayload) => Promise<void>;
}

export interface CampusNetTickResult {
    connectivity: 'up' | 'down';
    previousConnectivity: CampusNetPreviousConnectivity;
    probeDetail: string;
    dialAttempted: boolean;
    dialOk: boolean | null;
    dialDetail: string | null;
    notified: CampusNetNotifyEvent[];
}

export async function tick(options: CampusNetTickOptions = {}): Promise<CampusNetTickResult> {
    const env = options.env ?? process.env;
    if (options.envFile) {
        applyCampusNetEnvFile(await readCampusNetEnvFile(options.envFile), env);
    }

    const probe = options.probeInternet ?? probePublicInternet;
    const dial = options.login ?? eportalLogin;
    const notify = options.notifyRoot ?? sendCampusNetNotify;
    const store = options.stateStore ?? createFileStateStore(resolveStateFilePath(options, env));

    const probeResult = await probe();
    const previous = await store.load();
    const previousConnectivity: CampusNetPreviousConnectivity = previous?.connectivity ?? 'unknown';
    const previousObserved = observedFromPersisted(previous);
    const notified: CampusNetNotifyEvent[] = [];

    if (probeResult.ok) {
        if (shouldNotifyTransition(previousObserved, 'online')) {
            await notify({ event: 'down->up', probeDetail: probeResult.detail });
            notified.push('down->up');
        }
        await store.save({ connectivity: 'up', dialFailNotified: false });
        logger.info(
            'tick connectivity=up previous=%s probe=%s notified=%s',
            previousConnectivity,
            probeResult.detail,
            notified.join(',') || 'none',
        );
        return {
            connectivity: 'up',
            previousConnectivity,
            probeDetail: probeResult.detail,
            dialAttempted: false,
            dialOk: null,
            dialDetail: null,
            notified,
        };
    }

    if (shouldNotifyTransition(previousObserved, 'offline')) {
        await notify({ event: 'up->down', probeDetail: probeResult.detail });
        notified.push('up->down');
    }

    const dialOutcome = await attemptDial(options, env, dial);
    if (!dialOutcome.ok && shouldNotifyTransition(previousObserved, 'dial_failed')) {
        await notify({
            event: 'dial-fail',
            probeDetail: probeResult.detail,
            dialDetail: dialOutcome.detail,
        });
        notified.push('dial-fail');
    }

    await store.save({ connectivity: 'down', dialFailNotified: !dialOutcome.ok });
    logger.info(
        'tick connectivity=down previous=%s probe=%s dialAttempted=true dialOk=%s dial=%s notified=%s',
        previousConnectivity,
        probeResult.detail,
        dialOutcome.ok,
        dialOutcome.detail,
        notified.join(',') || 'none',
    );
    return {
        connectivity: 'down',
        previousConnectivity,
        probeDetail: probeResult.detail,
        dialAttempted: true,
        dialOk: dialOutcome.ok,
        dialDetail: dialOutcome.detail,
        notified,
    };
}

export function parseCampusNetEnvFile(raw: string): Record<string, string> {
    if (raw.length > MAX_ENV_FILE_CHARS) {
        throw new Error('campus-net env file is too large');
    }
    const parsed: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) {
            throw new Error(`campus-net env file line ${i + 1}: invalid KEY=VALUE`);
        }
        const key = trimmed.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            throw new Error(`campus-net env file line ${i + 1}: invalid KEY=VALUE`);
        }
        parsed[key] = unquoteEnvValue(trimmed.slice(eq + 1).trim());
    }
    return parsed;
}

export function parseCampusNetState(raw: string): CampusNetPersistedState {
    if (raw.length > MAX_STATE_FILE_CHARS) {
        throw new Error('campus-net state file is too large');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('campus-net state file is not JSON');
    }
    if (!isRecord(parsed)) {
        throw new Error('campus-net state file is not a JSON object');
    }
    const keys = Object.keys(parsed).sort();
    if (keys.length !== 2 || keys[0] !== 'connectivity' || keys[1] !== 'dialFailNotified') {
        throw new Error('campus-net state file has unexpected keys');
    }
    const connectivity = parsed.connectivity;
    if (connectivity !== 'up' && connectivity !== 'down') {
        throw new Error('campus-net state file connectivity is not up|down');
    }
    if (typeof parsed.dialFailNotified !== 'boolean') {
        throw new TypeError('campus-net state file dialFailNotified is not boolean');
    }
    return { connectivity, dialFailNotified: parsed.dialFailNotified };
}

export function resolveCampusNetCredentials(env: NodeJS.ProcessEnv): CampusNetCredentials | { missing: string } {
    const username = env[CAMPUS_NET_USERNAME_ENV];
    const password = env[CAMPUS_NET_PASSWORD_ENV];
    if (typeof username !== 'string' || username.trim().length === 0) {
        return { missing: `${CAMPUS_NET_USERNAME_ENV} is missing` };
    }
    if (typeof password !== 'string' || password.length === 0) {
        return { missing: `${CAMPUS_NET_PASSWORD_ENV} is missing` };
    }
    return { username: username.trim(), password };
}

export function createFileStateStore(stateFile: string): CampusNetStateStore {
    return {
        async load() {
            try {
                await assertRegularFile(stateFile);
            } catch (error) {
                if (isEnoent(error)) return null;
                throw error;
            }
            const raw = await readFile(stateFile, 'utf8');
            return parseCampusNetState(raw);
        },
        async save(state) {
            try {
                await assertRegularFile(stateFile);
            } catch (error) {
                if (!isEnoent(error)) throw error;
            }
            const body = JSON.stringify({
                connectivity: state.connectivity,
                dialFailNotified: state.dialFailNotified,
            });
            const tmp = `${stateFile}.tmp`;
            await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
            await chmod(tmp, 0o600);
            await rename(tmp, stateFile);
        },
    };
}

async function attemptDial(
    options: CampusNetTickOptions,
    env: NodeJS.ProcessEnv,
    dial: (username: string, password: string) => ReturnType<typeof eportalLogin>,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
    const creds = await resolveDialCredentials(options, env);
    if ('missing' in creds) {
        return { ok: false, detail: creds.missing };
    }
    try {
        const result = await dial(creds.username, creds.password);
        const detail = oneLine(result.msg) || (result.alreadyOnline ? 'already online' : 'ok');
        return { ok: true, detail };
    } catch (error) {
        if (error instanceof EPortalLoginError) {
            return { ok: false, detail: oneLine(error.message) };
        }
        return { ok: false, detail: 'eportal login failed' };
    }
}

async function resolveDialCredentials(
    options: CampusNetTickOptions,
    env: NodeJS.ProcessEnv,
): Promise<CampusNetCredentials | { missing: string }> {
    if (options.credentials) {
        if (!options.credentials.username || !options.credentials.password) {
            return { missing: 'campus-net credentials are empty' };
        }
        return options.credentials;
    }
    let resolved = resolveCampusNetCredentials(env);
    if (!('missing' in resolved)) return resolved;
    if (options.envFile) return resolved;
    const loadDefaultFile = options.env === undefined;
    if (loadDefaultFile && (await campusNetEnvFileExists(DEFAULT_CAMPUS_NET_ENV_FILE))) {
        applyCampusNetEnvFile(await readCampusNetEnvFile(DEFAULT_CAMPUS_NET_ENV_FILE), env);
        resolved = resolveCampusNetCredentials(env);
    }
    return resolved;
}

function observedFromPersisted(state: CampusNetPersistedState | null): CampusNetObservedState | null {
    if (!state) return null;
    if (state.connectivity === 'up') return 'online';
    return state.dialFailNotified ? 'dial_failed' : 'offline';
}

function resolveStateFilePath(options: CampusNetTickOptions, env: NodeJS.ProcessEnv): string {
    if (options.stateFile) return options.stateFile;
    const fromEnv = env[CAMPUS_NET_STATE_FILE_ENV];
    if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
    return DEFAULT_CAMPUS_NET_STATE_FILE;
}

async function readCampusNetEnvFile(path: string): Promise<Record<string, string>> {
    const stats = await assertRegularFile(path);
    if ((stats.mode & 0o077) !== 0) {
        throw new Error('campus-net env file must be mode 0600 or stricter (no group/other access)');
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    if (uid === 0 && stats.uid !== 0) {
        throw new Error('campus-net env file must be owned by root');
    }
    const raw = await readFile(path, 'utf8');
    return parseCampusNetEnvFile(raw);
}

async function campusNetEnvFileExists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (isEnoent(error)) return false;
        throw error;
    }
}

async function assertRegularFile(path: string): Promise<{ mode: number; uid: number }> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
        throw new Error(`${path} must be a regular file, not a symlink`);
    }
    if (!stats.isFile()) {
        throw new Error(`${path} must be a regular file`);
    }
    return stats;
}

function applyCampusNetEnvFile(parsed: Record<string, string>, env: NodeJS.ProcessEnv): void {
    for (const [key, value] of Object.entries(parsed)) {
        env[key] = value;
    }
}

function unquoteEnvValue(value: string): string {
    if (value.length >= 2) {
        const start = value[0];
        const end = value[value.length - 1];
        if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
            return value.slice(1, -1);
        }
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}
