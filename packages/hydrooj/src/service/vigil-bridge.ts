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
    body?: unknown;
    timeout?: number;
    retries?: number;
}

class VigilHttpError extends Error {
    constructor(
        readonly status: number,
        readonly retryable: boolean,
    ) {
        super(`Vigil request failed with HTTP ${status}`);
        this.name = 'VigilHttpError';
    }
}

class VigilProtocolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VigilProtocolError';
    }
}

class VigilConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VigilConfigurationError';
    }
}

export interface VigilBridgeFailure {
    deliveryUnknown: boolean;
    reason: 'vigil_configuration_invalid' | 'vigil_delivery_unknown' | 'vigil_http_rejected' | 'vigil_protocol_invalid';
    errorName: string;
    httpStatus?: number;
}

export function classifyVigilBridgeFailure(error: unknown): VigilBridgeFailure {
    if (error instanceof VigilHttpError) {
        return {
            deliveryUnknown: error.retryable,
            reason: error.retryable ? 'vigil_delivery_unknown' : 'vigil_http_rejected',
            errorName: error.name,
            httpStatus: error.status,
        };
    }
    if (error instanceof VigilProtocolError) {
        return { deliveryUnknown: true, reason: 'vigil_protocol_invalid', errorName: error.name };
    }
    if (error instanceof VigilConfigurationError) {
        return { deliveryUnknown: false, reason: 'vigil_configuration_invalid', errorName: error.name };
    }
    return {
        deliveryUnknown: true,
        reason: 'vigil_delivery_unknown',
        errorName: error instanceof Error ? error.name : 'Error',
    };
}

async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
    const { method = 'GET', body, timeout = 5000, retries = 3 } = options;
    if (!Number.isSafeInteger(retries) || retries < 1) throw new TypeError('Vigil bridge retries must be a positive integer');
    const token = system.get('serviceToken.oj.outbound');
    if (!token) {
        throw new VigilConfigurationError('Vigil bridge: serviceToken.oj.outbound not configured');
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
                throw new VigilHttpError(res.status, false);
            }
            lastError = new VigilHttpError(res.status, true);
        } catch (error: unknown) {
            clearTimeout(timer);
            const concrete = error instanceof Error ? error : new Error(String(error));
            if (concrete instanceof VigilHttpError && !concrete.retryable) throw concrete;
            lastError = concrete;
        }
        if (attempt < retries - 1) {
            const backoff = 2 ** attempt * 500;
            await new Promise((r) => setTimeout(r, backoff));
        }
    }
    throw lastError || new Error(`Vigil ${method} ${url} failed without an error`);
}

function baseUrl(): string {
    const base = system.get('vigil.baseUrl');
    if (!base || typeof base !== 'string') {
        throw new VigilConfigurationError('Vigil bridge: vigil.baseUrl not configured');
    }
    return base.replace(/\/+$/, '');
}

async function readVigilJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        throw new VigilProtocolError('Vigil response was not valid JSON.');
    }
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

export interface VigilEndpointCapability {
    name: string;
    version: number;
    commands: string[];
}

export interface VigilEndpointPreflightItem {
    endpointId: string;
    ready: boolean;
    reason: string;
    credentialStatus: string | null;
    online: boolean;
    compatible: boolean | null;
    serviceVersion: string | null;
    protocolVersion: number | null;
    capabilities: VigilEndpointCapability[];
}

export interface VigilExamNetworkRevisionRef {
    id: string;
    revision: number;
    fingerprint: string;
}

export interface VigilExamNetworkRequestPayload {
    requestId: string;
    idempotencyKey: string;
    domainId: string;
    eventId: string;
    executionId: string;
    executionRevision: number;
    operation: 'apply' | 'stop';
    activityId: string;
    networkPolicyRevision: number;
    policyRef: VigilExamNetworkRevisionRef;
    targetRef: VigilExamNetworkRevisionRef;
    endpointIds: string[];
    startAt: string;
    hardEndAt: string;
    policy?: { hosts: string[]; ips: string[]; ports: number[] };
}

export type VigilEndpointCommandStatus = 'applied' | 'expired' | 'failed' | 'offline' | 'queued' | 'rejected' | 'sent';

export interface VigilExamNetworkProjectionItem {
    commandId: string | null;
    endpointId: string;
    executionSessionId: string | null;
    commandRevision: number | null;
    command: 'apply_network_policy' | 'stop_network_policy';
    expectedPolicyRevision: number | null;
    appliedPolicyRevision: number | null;
    status: VigilEndpointCommandStatus;
    failureReason: string | null;
    online: boolean;
    networkPolicyState: {
        state: string;
        reason?: string;
        activityId?: string;
        policyRevision?: number;
        permitRuleCount?: number;
        acknowledgedActivityId?: string;
        acknowledgedPolicyRevision?: number;
        acknowledgedCommandId?: string;
        acknowledgedCommandRevision?: number;
    } | null;
}

export interface VigilExamNetworkProjection {
    requestId: string;
    idempotencyKey: string;
    domainId: string;
    eventId: string;
    executionId: string;
    executionRevision: number;
    operation: 'apply' | 'stop';
    activityId: string;
    networkPolicyRevision: number;
    policyRef: VigilExamNetworkRevisionRef;
    targetRef: VigilExamNetworkRevisionRef;
    hardEndAt: string;
    projectionRevision: number;
    dispatchStatus: 'complete' | 'dispatching';
    summary: Record<string, number>;
    items: VigilExamNetworkProjectionItem[];
}

function bridgeRecord(value: unknown, reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VigilProtocolError(reason);
    return value as Record<string, unknown>;
}

function exactBridgeRecord(value: unknown, keys: readonly string[], reason: string): Record<string, unknown> {
    const record = bridgeRecord(value, reason);
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new VigilProtocolError(reason);
    return record;
}

function bridgeString(value: unknown, reason: string, nullable = false): string | null {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !value) throw new VigilProtocolError(reason);
    return value;
}

function bridgeInteger(value: unknown, reason: string, nullable = false): number | null {
    if (nullable && value === null) return null;
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new VigilProtocolError(reason);
    return Number(value);
}

function parseEndpointCapability(value: unknown): VigilEndpointCapability {
    const record = exactBridgeRecord(value, ['commands', 'name', 'version'], 'Vigil endpoint capability was malformed.');
    if (!Array.isArray(record.commands) || record.commands.some((command) => typeof command !== 'string' || !command)) {
        throw new VigilProtocolError('Vigil endpoint capability was malformed.');
    }
    const name = bridgeString(record.name, 'Vigil endpoint capability was malformed.')!;
    const version = bridgeInteger(record.version, 'Vigil endpoint capability was malformed.')!;
    return { name, version, commands: [...record.commands] as string[] };
}

export async function preflightExamNetworkOnVigil(endpointIds: string[]): Promise<VigilEndpointPreflightItem[]> {
    const response = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/network-lock/preflight`, {
        method: 'POST',
        body: { endpointIds },
        retries: 1,
    });
    const payload = exactBridgeRecord(await readVigilJson(response), ['items', 'ready'], 'Vigil endpoint preflight was malformed.');
    if (typeof payload.ready !== 'boolean' || !Array.isArray(payload.items) || payload.items.length !== endpointIds.length) {
        throw new VigilProtocolError('Vigil endpoint preflight was malformed.');
    }
    const items = payload.items.map((value) => {
        const item = exactBridgeRecord(
            value,
            [
                'capabilities',
                'compatible',
                'credentialStatus',
                'endpointId',
                'networkPolicyState',
                'online',
                'protocolVersion',
                'ready',
                'reason',
                'serviceVersion',
            ],
            'Vigil endpoint preflight item was malformed.',
        );
        const { compatible, online, ready } = item;
        if (
            typeof ready !== 'boolean' ||
            typeof online !== 'boolean' ||
            (compatible !== null && typeof compatible !== 'boolean') ||
            !Array.isArray(item.capabilities)
        ) {
            throw new VigilProtocolError('Vigil endpoint preflight item was malformed.');
        }
        const compatibleValue = typeof compatible === 'boolean' ? compatible : null;
        return {
            endpointId: bridgeString(item.endpointId, 'Vigil endpoint preflight item was malformed.')!,
            ready,
            reason: bridgeString(item.reason, 'Vigil endpoint preflight item was malformed.')!,
            credentialStatus: bridgeString(item.credentialStatus, 'Vigil endpoint preflight item was malformed.', true),
            online,
            compatible: compatibleValue,
            serviceVersion: bridgeString(item.serviceVersion, 'Vigil endpoint preflight item was malformed.', true),
            protocolVersion: bridgeInteger(item.protocolVersion, 'Vigil endpoint preflight item was malformed.', true),
            capabilities: item.capabilities.map(parseEndpointCapability),
        } satisfies VigilEndpointPreflightItem;
    });
    if (
        new Set(items.map((item) => item.endpointId)).size !== items.length ||
        items.some((item) => !endpointIds.includes(item.endpointId))
    ) {
        throw new VigilProtocolError('Vigil endpoint preflight did not match the requested endpoints.');
    }
    return items;
}

export async function getExamNetworkControlPlaneOnVigil(): Promise<{ host: string; port: number }> {
    const response = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam-network/control-plane`, { retries: 1 });
    const payload = exactBridgeRecord(await readVigilJson(response), ['host', 'port'], 'Vigil control plane was malformed.');
    const host = bridgeString(payload.host, 'Vigil control plane was malformed.')!;
    const port = bridgeInteger(payload.port, 'Vigil control plane was malformed.')!;
    if (port < 1 || port > 65535) throw new VigilProtocolError('Vigil control plane was malformed.');
    return { host, port };
}

function parseRevisionRef(value: unknown): VigilExamNetworkRevisionRef {
    const record = exactBridgeRecord(value, ['fingerprint', 'id', 'revision'], 'Vigil execution revision reference was malformed.');
    const id = bridgeString(record.id, 'Vigil execution revision reference was malformed.')!;
    const revision = bridgeInteger(record.revision, 'Vigil execution revision reference was malformed.')!;
    const fingerprint = bridgeString(record.fingerprint, 'Vigil execution revision reference was malformed.')!;
    if (!/^[a-f0-9]{24}$/.test(id) || revision < 1 || !/^[a-f0-9]{64}$/.test(fingerprint)) {
        throw new VigilProtocolError('Vigil execution revision reference was malformed.');
    }
    return { id, revision, fingerprint };
}

function parseNetworkState(value: unknown): VigilExamNetworkProjectionItem['networkPolicyState'] {
    if (value === null) return null;
    const state = bridgeRecord(value, 'Vigil network policy state was malformed.');
    const allowed = new Set([
        'acknowledgedActivityId',
        'acknowledgedCommandId',
        'acknowledgedCommandRevision',
        'acknowledgedPolicyRevision',
        'activityId',
        'endpointId',
        'permitRuleCount',
        'policyRevision',
        'reason',
        'state',
    ]);
    if (Object.keys(state).some((key) => !allowed.has(key))) throw new VigilProtocolError('Vigil network policy state was malformed.');
    const parsed: NonNullable<VigilExamNetworkProjectionItem['networkPolicyState']> = {
        state: bridgeString(state.state, 'Vigil network policy state was malformed.')!,
    };
    for (const key of ['reason', 'activityId', 'acknowledgedActivityId', 'acknowledgedCommandId'] as const) {
        if (state[key] !== undefined) parsed[key] = bridgeString(state[key], 'Vigil network policy state was malformed.')!;
    }
    for (const key of ['policyRevision', 'permitRuleCount', 'acknowledgedPolicyRevision', 'acknowledgedCommandRevision'] as const) {
        if (state[key] !== undefined) parsed[key] = bridgeInteger(state[key], 'Vigil network policy state was malformed.')!;
    }
    return parsed;
}

function parseExamNetworkProjectionItem(value: unknown): VigilExamNetworkProjectionItem {
    const record = exactBridgeRecord(
        value,
        [
            'appliedAt',
            'appliedPolicyRevision',
            'command',
            'commandId',
            'commandRevision',
            'createdAt',
            'endpointId',
            'executionSessionId',
            'expectedPolicyRevision',
            'expiresAt',
            'failedAt',
            'failureReason',
            'networkPolicyState',
            'online',
            'sentAt',
            'status',
            'updatedAt',
        ],
        'Vigil exam network projection item was malformed.',
    );
    const command = bridgeString(record.command, 'Vigil exam network projection item was malformed.');
    const status = bridgeString(record.status, 'Vigil exam network projection item was malformed.');
    if (
        (command !== 'apply_network_policy' && command !== 'stop_network_policy') ||
        !['applied', 'expired', 'failed', 'offline', 'queued', 'rejected', 'sent'].includes(status || '') ||
        typeof record.online !== 'boolean'
    ) {
        throw new VigilProtocolError('Vigil exam network projection item was malformed.');
    }
    return {
        commandId: bridgeString(record.commandId, 'Vigil exam network projection item was malformed.', true),
        endpointId: bridgeString(record.endpointId, 'Vigil exam network projection item was malformed.')!,
        executionSessionId: bridgeString(record.executionSessionId, 'Vigil exam network projection item was malformed.', true),
        commandRevision: bridgeInteger(record.commandRevision, 'Vigil exam network projection item was malformed.', true),
        command,
        expectedPolicyRevision: bridgeInteger(record.expectedPolicyRevision, 'Vigil exam network projection item was malformed.', true),
        appliedPolicyRevision: bridgeInteger(record.appliedPolicyRevision, 'Vigil exam network projection item was malformed.', true),
        status: status as VigilEndpointCommandStatus,
        failureReason: bridgeString(record.failureReason, 'Vigil exam network projection item was malformed.', true),
        online: record.online,
        networkPolicyState: parseNetworkState(record.networkPolicyState),
    };
}

export function parseVigilExamNetworkProjection(value: unknown): VigilExamNetworkProjection {
    const record = exactBridgeRecord(
        value,
        [
            'activityId',
            'dispatchStatus',
            'domainId',
            'eventId',
            'executionId',
            'executionRevision',
            'hardEndAt',
            'idempotencyKey',
            'items',
            'networkPolicyRevision',
            'operation',
            'policyRef',
            'projectionRevision',
            'requestId',
            'summary',
            'targetRef',
        ],
        'Vigil exam network projection was malformed.',
    );
    const operation = bridgeString(record.operation, 'Vigil exam network projection was malformed.');
    const dispatchStatus = bridgeString(record.dispatchStatus, 'Vigil exam network projection was malformed.');
    if (
        (operation !== 'apply' && operation !== 'stop') ||
        (dispatchStatus !== 'complete' && dispatchStatus !== 'dispatching') ||
        !Array.isArray(record.items)
    ) {
        throw new VigilProtocolError('Vigil exam network projection was malformed.');
    }
    const summaryRecord = bridgeRecord(record.summary, 'Vigil exam network projection was malformed.');
    const summary: Record<string, number> = {};
    for (const [key, count] of Object.entries(summaryRecord)) {
        if (!key || !Number.isSafeInteger(count) || Number(count) < 0) {
            throw new VigilProtocolError('Vigil exam network projection was malformed.');
        }
        summary[key] = Number(count);
    }
    const eventId = bridgeString(record.eventId, 'Vigil exam network projection was malformed.')!;
    const executionId = bridgeString(record.executionId, 'Vigil exam network projection was malformed.')!;
    const executionRevision = bridgeInteger(record.executionRevision, 'Vigil exam network projection was malformed.')!;
    const networkPolicyRevision = bridgeInteger(record.networkPolicyRevision, 'Vigil exam network projection was malformed.')!;
    const projectionRevision = bridgeInteger(record.projectionRevision, 'Vigil exam network projection was malformed.')!;
    const hardEndAt = bridgeString(record.hardEndAt, 'Vigil exam network projection was malformed.')!;
    const parsedHardEndAt = new Date(hardEndAt);
    const items = record.items.map(parseExamNetworkProjectionItem);
    const expectedCommand = operation === 'apply' ? 'apply_network_policy' : 'stop_network_policy';
    const observedSummary = new Map<string, number>();
    for (const item of items) observedSummary.set(item.status, (observedSummary.get(item.status) || 0) + 1);
    if (
        !/^[a-f0-9]{24}$/.test(eventId) ||
        !/^[a-f0-9]{24}$/.test(executionId) ||
        executionRevision < 1 ||
        networkPolicyRevision < 1 ||
        !Number.isFinite(parsedHardEndAt.getTime()) ||
        parsedHardEndAt.toISOString() !== hardEndAt ||
        items.some(
            (item) =>
                item.command !== expectedCommand ||
                (item.status === 'rejected'
                    ? item.commandId !== null || item.commandRevision !== null || item.expectedPolicyRevision !== null
                    : item.commandId === null ||
                      item.commandRevision === null ||
                      item.expectedPolicyRevision !== networkPolicyRevision) ||
                (item.appliedPolicyRevision !== null && item.appliedPolicyRevision !== networkPolicyRevision),
        ) ||
        new Set(items.map((item) => item.endpointId)).size !== items.length ||
        Object.keys(summary).length !== observedSummary.size ||
        Object.entries(summary).some(([status, count]) => observedSummary.get(status) !== count) ||
        (dispatchStatus === 'complete' && items.length === 0)
    ) {
        throw new VigilProtocolError('Vigil exam network projection was malformed.');
    }
    return {
        requestId: bridgeString(record.requestId, 'Vigil exam network projection was malformed.')!,
        idempotencyKey: bridgeString(record.idempotencyKey, 'Vigil exam network projection was malformed.')!,
        domainId: bridgeString(record.domainId, 'Vigil exam network projection was malformed.')!,
        eventId,
        executionId,
        executionRevision,
        operation,
        activityId: bridgeString(record.activityId, 'Vigil exam network projection was malformed.')!,
        networkPolicyRevision,
        policyRef: parseRevisionRef(record.policyRef),
        targetRef: parseRevisionRef(record.targetRef),
        hardEndAt,
        projectionRevision,
        dispatchStatus,
        summary,
        items,
    };
}

function assertExamNetworkProjectionIdentity(
    projection: VigilExamNetworkProjection,
    expected: VigilExamNetworkRequestPayload,
): void {
    if (
        projection.requestId !== expected.requestId ||
        projection.idempotencyKey !== expected.idempotencyKey ||
        projection.domainId !== expected.domainId ||
        projection.eventId !== expected.eventId ||
        projection.executionId !== expected.executionId ||
        projection.executionRevision !== expected.executionRevision ||
        projection.operation !== expected.operation ||
        projection.activityId !== expected.activityId ||
        projection.networkPolicyRevision !== expected.networkPolicyRevision ||
        projection.policyRef.id !== expected.policyRef.id ||
        projection.policyRef.revision !== expected.policyRef.revision ||
        projection.policyRef.fingerprint !== expected.policyRef.fingerprint ||
        projection.targetRef.id !== expected.targetRef.id ||
        projection.targetRef.revision !== expected.targetRef.revision ||
        projection.targetRef.fingerprint !== expected.targetRef.fingerprint ||
        projection.hardEndAt !== expected.hardEndAt
    ) {
        throw new VigilProtocolError('Vigil exam network projection identity did not match the request.');
    }
    const expectedEndpointIds = [...expected.endpointIds].sort();
    const projectedEndpointIds = projection.items.map((item) => item.endpointId).sort();
    if (
        projectedEndpointIds.some((endpointId) => !expectedEndpointIds.includes(endpointId)) ||
        (projection.dispatchStatus === 'complete' &&
            (expectedEndpointIds.length !== projectedEndpointIds.length ||
                expectedEndpointIds.some((endpointId, index) => endpointId !== projectedEndpointIds[index])))
    ) {
        throw new VigilProtocolError('Vigil exam network projection target did not match the request.');
    }
}

export async function dispatchExamNetworkOnVigil(payload: VigilExamNetworkRequestPayload): Promise<VigilExamNetworkProjection> {
    const response = await fetchWithRetry(`${baseUrl()}/api/integrations/oj/exam-network/requests`, {
        method: 'POST',
        body: payload,
        retries: 3,
        timeout: 10_000,
    });
    const projection = parseVigilExamNetworkProjection(await readVigilJson(response));
    assertExamNetworkProjectionIdentity(projection, payload);
    return projection;
}

export async function getExamNetworkRequestOnVigil(expected: VigilExamNetworkRequestPayload): Promise<VigilExamNetworkProjection> {
    const response = await fetchWithRetry(
        `${baseUrl()}/api/integrations/oj/exam-network/requests/${encodeURIComponent(expected.idempotencyKey)}`,
        { retries: 1 },
    );
    const projection = parseVigilExamNetworkProjection(await readVigilJson(response));
    assertExamNetworkProjectionIdentity(projection, expected);
    return projection;
}

export async function revokeEndpointOnVigilStrict(endpointId: string, actorUid: number, reason: string): Promise<void> {
    await fetchWithRetry(`${baseUrl()}/api/integrations/oj/endpoints/${encodeURIComponent(endpointId)}/revoke`, {
        method: 'POST',
        body: { actorUid, reason },
        retries: 1,
    });
    logger.info('revoked Endpoint credential endpoint=%s actor=%d', endpointId, actorUid);
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
