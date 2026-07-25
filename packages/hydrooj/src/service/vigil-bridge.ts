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

export async function pushExamToVigilStrict(payload: OjContestPayload): Promise<void> {
    await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam`, {
        method: 'POST',
        body: payload,
    });
    logger.info('pushed exam %s to Vigil', payload.ojContestId);
}

export async function pushExamToVigil(payload: OjContestPayload): Promise<void> {
    try {
        await pushExamToVigilStrict(payload);
    } catch (e: any) {
        logger.error('failed to push exam %s to Vigil: %s', payload.ojContestId, e.message);
        // Don't throw — Vigil push is fire-and-forget; lazy-fallback at student login.
    }
}

export async function deleteExamFromVigilStrict(ojContestId: string): Promise<void> {
    await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam/${ojContestId}`, {
        method: 'DELETE',
    });
    logger.info('deleted exam %s from Vigil', ojContestId);
}

export async function deleteExamFromVigil(ojContestId: string): Promise<void> {
    try {
        await deleteExamFromVigilStrict(ojContestId);
    } catch (e: any) {
        logger.error('failed to delete exam %s from Vigil: %s', ojContestId, e.message);
    }
}

export async function closeSessionOnVigil(ojContestId: string, sessionId: string, closeReason: string): Promise<void> {
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

export interface VigilTeamRoleChangePayload {
    domainId: string;
    contestId: string;
    teamId: string;
    teamRevision: number;
    affectedUids: number[];
    actorUid: number;
}

/**
 * Refresh active Vigil clients after the OJ roster has already committed.
 * Unlike background contest sync, this call intentionally throws so the
 * administrator sees a post-commit warning. Submission authority remains
 * governed by the newly committed OJ roster regardless of push outcome.
 */
export async function notifyTeamRoleChangeOnVigil(payload: VigilTeamRoleChangePayload): Promise<void> {
    await fetchWithRetry(`${baseUrl()}/api/integrations/oj/team-role-change`, {
        method: 'POST',
        body: payload,
        retries: 1,
    });
    logger.info(
        'refreshed Vigil team roles contest=%s team=%s revision=%d affected=%d',
        payload.contestId,
        payload.teamId,
        payload.teamRevision,
        payload.affectedUids.length,
    );
}

export interface VigilTeamCodePresence {
    uid: number;
    online: boolean;
}

/** Resolve current WebSocket presence on demand; no lease or presence cache. */
export async function getTeamCodePresenceOnVigil(ojContestId: string, targetUids: number[]): Promise<VigilTeamCodePresence[]> {
    const response = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/team-code-presence`, {
        method: 'POST',
        body: { contestId: ojContestId, targetUids },
        retries: 1,
    });
    const payload: any = await response.json();
    if (!Array.isArray(payload?.targets)) throw new Error('Vigil team-code presence returned malformed targets.');
    const targets = payload.targets.map((target: any) => ({ uid: Number(target?.uid), online: target?.online === true }));
    if (
        targets.length !== targetUids.length ||
        targets.some((target: VigilTeamCodePresence) => !Number.isSafeInteger(target.uid) || !targetUids.includes(target.uid)) ||
        new Set(targets.map((target: VigilTeamCodePresence) => target.uid)).size !== targets.length
    ) {
        throw new Error('Vigil team-code presence did not match the requested recipients.');
    }
    return targets;
}

export interface RecordingDeleteScope {
    cid: string;
    ojUserId?: number;
    examSessionId?: string;
    recordingId?: string;
}

export async function previewRecordingDelete(
    scope: RecordingDeleteScope,
    actor: { uid: number; uname: string },
): Promise<any> {
    const query = new URLSearchParams({
        cid: scope.cid,
        actorUid: String(actor.uid),
        actorUname: actor.uname,
    });
    if (scope.ojUserId != null) query.set('ojUserId', String(scope.ojUserId));
    if (scope.examSessionId) query.set('examSessionId', scope.examSessionId);
    if (scope.recordingId) query.set('recordingId', scope.recordingId);
    const response = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/recordings/delete-preview?${query}`, { retries: 1 });
    return await response.json();
}

export async function executeRecordingDelete(
    scope: RecordingDeleteScope,
    actor: { uid: number; uname: string },
    intent: string,
    confirmTitle?: string,
): Promise<any> {
    const response = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/recordings/delete`, {
        method: 'POST',
        retries: 1,
        timeout: 30_000,
        body: { ...scope, actor, intent, confirmTitle },
    });
    return await response.json();
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
    /** Versioned Client↔Server team-policy protocol snapshot. */
    clientProtocolVersion?: number;
    clientVersion?: string;
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

export async function verifyAccessTokenWithVigil(sessionId: string, accessToken: string): Promise<VigilAccessVerification> {
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
