/**
 * Outbound HTTP client for OJ → Vigil server calls.
 *
 * Reads `vigil.baseUrl` + `serviceToken.oj.outbound` from system settings.
 * Retries with exponential backoff up to 3 times for non-2xx responses.
 *
 * See docs/service-tokens.md for token rotation. See PRD §2.7 for the
 * full Vigil-side endpoint surface.
 */
import { Logger } from '@hydrooj/utils';
import system from '../model/system';

const logger = new Logger('vigil-bridge');

interface FetchOptions {
    method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
    body?: any;
    timeout?: number;
    retries?: number;
}

async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
    const { method = 'GET', body, timeout = 5000, retries = 3 } = options;
    const token = system.get('serviceToken.oj.outbound');
    if (!token) {
        throw new Error('Vigil bridge: serviceToken.oj.outbound not configured');
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, {
                method,
                headers: {
                    'X-Service-Token': token,
                    'Content-Type': 'application/json',
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (res.status >= 200 && res.status < 300) return res;
            if (res.status >= 400 && res.status < 500) {
                // Don't retry client errors.
                const text = await res.text().catch(() => '');
                throw new Error(`Vigil ${method} ${url} → ${res.status}: ${text}`);
            }
            lastError = new Error(`Vigil ${method} ${url} → ${res.status}`);
        } catch (e: any) {
            clearTimeout(timer);
            lastError = e;
        }
        if (attempt < retries - 1) {
            const backoff = 2 ** attempt * 500;
            await new Promise((r) => setTimeout(r, backoff));
        }
    }
    throw lastError;
}

function baseUrl(): string {
    const base = system.get('vigil.baseUrl');
    if (!base || typeof base !== 'string') {
        throw new Error('Vigil bridge: vigil.baseUrl not configured');
    }
    return base.replace(/\/+$/, '');
}

export interface OjContestPayload {
    ojContestId: string;
    ojDomainId: string;
    title: string;
    rule?: string;
    beginAt: string;
    endAt: string;
    entryMode?: 'open' | 'client_required';
    approvalMode: 'strict' | 'auto';
    lockdownMode: boolean;
    networkLockdownMode?: boolean;
    networkLockdownFailurePolicy?: 'strict' | 'report_only' | 'off';
    networkWhitelistHosts?: string[];
    networkWhitelistIps?: string[];
    networkWhitelistPorts?: number[];
    pauseOnDisconnect: boolean;
    screenshotIntervalMs: number;
    exclusive: boolean;
    clientLoginBlockBeforeMinutes?: number;
    clientLoginBlockAfterMinutes?: number;
    // Krypton: live media + 8-class event detection
    liveEnabled?: boolean;
    recordEnabled?: boolean;
    cameraEnabled?: boolean;
    screenshotJitterMs?: number;
    processWhitelist?: string[];
}

export async function pushExamToVigil(payload: OjContestPayload): Promise<void> {
    try {
        await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam`, {
            method: 'POST',
            body: payload,
        });
        logger.info('pushed exam %s to Vigil', payload.ojContestId);
    } catch (e: any) {
        logger.error('failed to push exam %s to Vigil: %s', payload.ojContestId, e.message);
        // Don't throw — Vigil push is fire-and-forget; lazy-fallback at student login.
    }
}

export async function deleteExamFromVigil(ojContestId: string): Promise<void> {
    try {
        await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam/${ojContestId}`, {
            method: 'DELETE',
        });
        logger.info('deleted exam %s from Vigil', ojContestId);
    } catch (e: any) {
        logger.error('failed to delete exam %s from Vigil: %s', ojContestId, e.message);
    }
}

export async function closeSessionOnVigil(
    ojContestId: string, sessionId: string, closeReason: string,
): Promise<void> {
    try {
        await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam/${ojContestId}/close-session`, {
            method: 'POST',
            body: { sessionId, closeReason },
        });
        logger.info('closed Vigil session %s (reason=%s)', sessionId, closeReason);
    } catch (e: any) {
        logger.error('failed to close Vigil session %s: %s', sessionId, e.message);
    }
}

export interface VigilAccessVerification {
    valid: boolean;
    ojUserId?: number;
    /** Owning OJ domain (Vigil knows which OJ instance issued the token). */
    ojDomainId?: string;
    /** Contest id this Vigil session is bound to (single-contest binding). */
    ojContestId?: string;
    /** Machine fingerprint Vigil recorded at session-open time. */
    machineId?: string;
    /**
     * True when this session is for a Vigil-created temporary user
     * (proctor approval path, see DESIGN §9). The OJ-side checks combine
     * this with `scopeOverride` to allow temp accounts past scope gates.
     */
    isTemporary?: boolean;
    /**
     * True iff the human approver explicitly granted scope override
     * (e.g., student couldn't be matched against StudentRecord but the
     * proctor approved them anyway). Defaults to `false`.
     */
    scopeOverride?: boolean;
}

export async function verifyAccessTokenWithVigil(
    sessionId: string, accessToken: string,
): Promise<VigilAccessVerification> {
    try {
        const res = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/verify-access-token`, {
            method: 'POST',
            body: { sessionId, accessToken },
        });
        const data: any = await res.json();
        return data;
    } catch (e: any) {
        logger.error('failed to verify access token: %s', e.message);
        return { valid: false };
    }
}

/** Generate a one-shot opaque token for the temporary-user flow. */
export function generateOneShotToken(): string {
    const { randomBytes } = require('node:crypto');
    return `t_oneshot_${randomBytes(24).toString('hex')}`;
}
