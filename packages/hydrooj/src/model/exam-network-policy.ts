import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export interface ExamNetworkPolicy {
    hosts: string[];
    ips: string[];
    ports: number[];
}

export interface ExamNetworkControlPlane {
    host: string;
    port: number;
}

export type ExamNetworkPolicyEffect = 'loosening' | 'mixed' | 'tightening' | 'unchanged';

export interface ExamNetworkPolicyDiff {
    effect: ExamNetworkPolicyEffect;
    addedHosts: string[];
    removedHosts: string[];
    addedIps: string[];
    removedIps: string[];
    beforePorts: number[];
    afterPorts: number[];
}

export class ExamNetworkPolicyError extends Error {
    constructor(public readonly reason: string) {
        super(reason);
        this.name = 'ExamNetworkPolicyError';
    }
}

const MAX_HOSTS = 64;
const MAX_IPS = 64;
const MAX_PORTS = 32;
const MAX_PERMIT_RULES = 4096;

function exactObject(value: unknown, keys: string[], reason: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExamNetworkPolicyError(reason);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
        throw new ExamNetworkPolicyError(reason);
    }
    return record;
}

function canonicalHost(value: unknown): string {
    if (typeof value !== 'string') throw new ExamNetworkPolicyError('invalid_host');
    const host = value.trim().toLowerCase();
    const base = host.startsWith('*.') ? host.slice(2) : host;
    const labels = base.split('.');
    if (
        base.length > 253 ||
        labels.length < 2 ||
        labels.some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-'))
    ) {
        throw new ExamNetworkPolicyError('invalid_host');
    }
    return host;
}

function canonicalIPv4(value: string): string {
    const parts = value.split('.');
    if (parts.length !== 4) throw new ExamNetworkPolicyError('invalid_ip');
    const numbers = parts.map((part) => {
        if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) throw new ExamNetworkPolicyError('invalid_ip');
        const parsed = Number(part);
        if (parsed > 255) throw new ExamNetworkPolicyError('invalid_ip');
        return parsed;
    });
    return numbers.join('.');
}

function canonicalIPv6(value: string): string {
    if (value.includes('%') || isIP(value) !== 6) throw new ExamNetworkPolicyError('invalid_ip');
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
}

function ipv4BigInt(value: string): bigint {
    return value.split('.').reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
}

function ipv6BigInt(value: string): bigint {
    const [leftRaw, rightRaw, ...extra] = value.split('::');
    if (extra.length) throw new ExamNetworkPolicyError('invalid_ip');
    const left = leftRaw ? leftRaw.split(':') : [];
    const right = rightRaw ? rightRaw.split(':') : [];
    const missing = 8 - left.length - right.length;
    if ((value.includes('::') && missing < 1) || (!value.includes('::') && missing !== 0)) throw new ExamNetworkPolicyError('invalid_ip');
    const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
    if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) throw new ExamNetworkPolicyError('invalid_ip');
    return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function canonicalIpOrCidr(value: unknown): string {
    if (typeof value !== 'string' || !value || value.includes('%')) throw new ExamNetworkPolicyError('invalid_ip');
    const pieces = value.trim().split('/');
    if (pieces.length > 2) throw new ExamNetworkPolicyError('invalid_ip');
    const version = isIP(pieces[0]);
    if (!version) throw new ExamNetworkPolicyError('invalid_ip');
    const address = version === 4 ? canonicalIPv4(pieces[0]) : canonicalIPv6(pieces[0]);
    if (pieces.length === 1) return address;
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(pieces[1])) throw new ExamNetworkPolicyError('invalid_ip');
    const prefix = Number(pieces[1]);
    const bits = version === 4 ? 32 : 128;
    if (prefix > bits) throw new ExamNetworkPolicyError('invalid_ip');
    const numeric = version === 4 ? ipv4BigInt(address) : ipv6BigInt(address);
    const hostBits = BigInt(bits - prefix);
    if (hostBits > 0n && (numeric & ((1n << hostBits) - 1n)) !== 0n) throw new ExamNetworkPolicyError('noncanonical_ip_network');
    return `${address}/${prefix}`;
}

function ipRange(value: string): { version: number; first: bigint; last: bigint } {
    const [address, prefixRaw] = value.split('/');
    const version = isIP(address);
    const bits = version === 4 ? 32 : 128;
    const prefix = prefixRaw === undefined ? bits : Number(prefixRaw);
    const first = version === 4 ? ipv4BigInt(address) : ipv6BigInt(address);
    const hostBits = BigInt(bits - prefix);
    return { version, first, last: first + (hostBits ? (1n << hostBits) - 1n : 0n) };
}

function hostRuleCovers(outer: string, inner: string): boolean {
    if (outer === inner) return true;
    if (!outer.startsWith('*.')) return false;
    const outerBase = outer.slice(2);
    const innerBase = inner.startsWith('*.') ? inner.slice(2) : inner;
    return innerBase.endsWith(`.${outerBase}`);
}

function mergedIpRanges(values: string[]): Array<{ version: number; first: bigint; last: bigint }> {
    const ranges = values.map(ipRange).sort((left, right) => {
        if (left.version !== right.version) return left.version - right.version;
        if (left.first !== right.first) return left.first < right.first ? -1 : 1;
        if (left.last !== right.last) return left.last < right.last ? -1 : 1;
        return 0;
    });
    const merged: Array<{ version: number; first: bigint; last: bigint }> = [];
    for (const range of ranges) {
        const previous = merged.at(-1);
        if (previous && previous.version === range.version && range.first <= previous.last + 1n) {
            if (range.last > previous.last) previous.last = range.last;
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

function ipRulesCover(outer: string[], inner: string[]): boolean {
    const outerRanges = mergedIpRanges(outer);
    return mergedIpRanges(inner).every((range) =>
        outerRanges.some((candidate) => candidate.version === range.version && candidate.first <= range.first && candidate.last >= range.last),
    );
}

function portRulesCover(outer: number[], inner: number[]): boolean {
    if (!outer.length) return true;
    if (!inner.length) return false;
    const allowed = new Set(outer);
    return inner.every((port) => allowed.has(port));
}

function exactAddress(value: unknown): string {
    const address = canonicalIpOrCidr(value);
    if (address.includes('/')) throw new ExamNetworkPolicyError('invalid_resolved_address');
    return address;
}

function rangeIdentity(value: string): string {
    if (value.includes('/')) return value;
    return `${value}/${isIP(value) === 4 ? 32 : 128}`;
}

export const EXAM_NETWORK_STREAM_PORT = 1935;

function hostMatchesPolicy(patterns: string[], host: string): boolean {
    return patterns.some(
        (pattern) => pattern === host || (pattern.startsWith('*.') && host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1),
    );
}

function canonicalControlPlane(value: ExamNetworkControlPlane): ExamNetworkControlPlane {
    if (!value || typeof value !== 'object') throw new ExamNetworkPolicyError('invalid_control_plane');
    if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535) {
        throw new ExamNetworkPolicyError('invalid_control_plane');
    }
    if (typeof value.host !== 'string' || !value.host.trim()) throw new ExamNetworkPolicyError('invalid_control_plane');
    const raw = value.host.trim();
    const host = isIP(raw) ? exactAddress(raw) : canonicalHost(raw);
    if (host.startsWith('*.')) throw new ExamNetworkPolicyError('invalid_control_plane');
    return { host, port: value.port };
}

function assertNoPolicyConflicts(hosts: string[], ips: string[]): void {
    for (let leftIndex = 0; leftIndex < hosts.length; leftIndex++) {
        const left = hosts[leftIndex].startsWith('*.') ? hosts[leftIndex].slice(2) : null;
        for (let rightIndex = leftIndex + 1; rightIndex < hosts.length; rightIndex++) {
            const right = hosts[rightIndex].startsWith('*.') ? hosts[rightIndex].slice(2) : null;
            if (
                (left && (hosts[rightIndex].endsWith(`.${left}`) || (right && left.endsWith(`.${right}`)))) ||
                (right && hosts[leftIndex].endsWith(`.${right}`))
            ) {
                throw new ExamNetworkPolicyError('conflicting_host_rules');
            }
        }
    }
    const ranges = ips.map(ipRange);
    for (let leftIndex = 0; leftIndex < ranges.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < ranges.length; rightIndex++) {
            const left = ranges[leftIndex];
            const right = ranges[rightIndex];
            if (left.version === right.version && left.first <= right.last && right.first <= left.last) {
                throw new ExamNetworkPolicyError('conflicting_ip_rules');
            }
        }
    }
}

function canonicalArray<T>(value: unknown, limit: number, parse: (item: unknown) => T, reason: string): T[] {
    if (!Array.isArray(value) || value.length > limit) throw new ExamNetworkPolicyError(reason);
    const parsed = value.map(parse);
    if (new Set(parsed).size !== parsed.length) throw new ExamNetworkPolicyError(reason);
    return parsed.sort((left, right) => String(left).localeCompare(String(right)));
}

export function canonicalExamNetworkPolicy(value: unknown): ExamNetworkPolicy {
    const input = exactObject(value, ['hosts', 'ips', 'ports'], 'invalid_policy');
    const hosts = canonicalArray(input.hosts, MAX_HOSTS, canonicalHost, 'duplicate_or_excess_hosts');
    const ips = canonicalArray(input.ips, MAX_IPS, canonicalIpOrCidr, 'duplicate_or_excess_ips');
    const ports = canonicalArray(
        input.ports,
        MAX_PORTS,
        (port) => {
            if (!Number.isSafeInteger(port) || Number(port) < 1 || Number(port) > 65535) {
                throw new ExamNetworkPolicyError('invalid_port');
            }
            return Number(port);
        },
        'duplicate_or_excess_ports',
    ).sort((left, right) => left - right);
    if (!hosts.length && !ips.length) throw new ExamNetworkPolicyError('destination_required');
    assertNoPolicyConflicts(hosts, ips);
    return { hosts, ips, ports };
}

export function examNetworkPolicyFingerprint(policy: ExamNetworkPolicy): string {
    return createHash('sha256').update(JSON.stringify(policy), 'utf8').digest('hex');
}

export function diffExamNetworkPolicies(beforeValue: ExamNetworkPolicy, afterValue: ExamNetworkPolicy): ExamNetworkPolicyDiff {
    const before = canonicalExamNetworkPolicy(beforeValue);
    const after = canonicalExamNetworkPolicy(afterValue);
    const loosening =
        after.hosts.some((rule) => !before.hosts.some((candidate) => hostRuleCovers(candidate, rule))) ||
        !ipRulesCover(before.ips, after.ips) ||
        !portRulesCover(before.ports, after.ports);
    const tightening =
        before.hosts.some((rule) => !after.hosts.some((candidate) => hostRuleCovers(candidate, rule))) ||
        !ipRulesCover(after.ips, before.ips) ||
        !portRulesCover(after.ports, before.ports);
    return {
        effect: loosening ? (tightening ? 'mixed' : 'loosening') : tightening ? 'tightening' : 'unchanged',
        addedHosts: after.hosts.filter((rule) => !before.hosts.includes(rule)),
        removedHosts: before.hosts.filter((rule) => !after.hosts.includes(rule)),
        addedIps: after.ips.filter((rule) => !before.ips.includes(rule)),
        removedIps: before.ips.filter((rule) => !after.ips.includes(rule)),
        beforePorts: [...before.ports],
        afterPorts: [...after.ports],
    };
}

export async function validateExamNetworkPolicyResolution(
    policy: ExamNetworkPolicy,
    resolveHost: (hostname: string) => Promise<string[]>,
    controlPlaneValue: ExamNetworkControlPlane,
): Promise<void> {
    const controlPlane = canonicalControlPlane(controlPlaneValue);
    const resolved = new Map<string, string[]>();
    for (const rule of policy.hosts) {
        const hostname = rule.startsWith('*.') ? rule.slice(2) : rule;
        let values: string[];
        try {
            values = await resolveHost(hostname);
        } catch {
            throw new ExamNetworkPolicyError('unresolved_host');
        }
        if (!Array.isArray(values) || !values.length) throw new ExamNetworkPolicyError('unresolved_host');
        resolved.set(rule, Array.from(new Set(values.map(exactAddress))).sort());
    }
    if (isIP(controlPlane.host)) {
        resolved.set(controlPlane.host, [controlPlane.host]);
    } else if (!resolved.has(controlPlane.host)) {
        let values: string[];
        try {
            values = await resolveHost(controlPlane.host);
        } catch {
            throw new ExamNetworkPolicyError('unresolved_control_plane');
        }
        if (!Array.isArray(values) || !values.length) throw new ExamNetworkPolicyError('unresolved_control_plane');
        resolved.set(controlPlane.host, Array.from(new Set(values.map(exactAddress))).sort());
    }

    const permits = new Set<string>();
    const appendRules = (address: string, ports: number[], serviceOnly: boolean) => {
        const effectivePorts: Array<number | '*'> = ports.length ? ports : ['*'];
        for (const port of effectivePorts) {
            permits.add(`${rangeIdentity(address)}:${port}:${serviceOnly ? 'service' : 'all'}`);
            if (permits.size > MAX_PERMIT_RULES) throw new ExamNetworkPolicyError('permit_rule_limit');
        }
    };
    for (const address of policy.ips) appendRules(address, policy.ports, false);
    const trackedHosts = [...policy.hosts];
    if (!trackedHosts.includes(controlPlane.host)) trackedHosts.push(controlPlane.host);
    for (const host of trackedHosts) {
        const addresses = resolved.get(host);
        if (!addresses?.length) throw new ExamNetworkPolicyError(host === controlPlane.host ? 'unresolved_control_plane' : 'unresolved_host');
        const isControlPlane = host === controlPlane.host;
        const serviceOnly = isControlPlane && !hostMatchesPolicy(policy.hosts, host);
        const ports = serviceOnly ? [controlPlane.port] : policy.ports;
        for (const address of addresses) {
            appendRules(address, ports, serviceOnly);
            if (isControlPlane && !serviceOnly && policy.ports.length && !policy.ports.includes(controlPlane.port)) {
                appendRules(address, [controlPlane.port], true);
            }
        }
    }
    assertExamNetworkPolicyExplicitClientAccess(policy, controlPlane, resolved.get(controlPlane.host) || []);
}

function policyCoversAddress(ips: string[], address: string): boolean {
    return ipRulesCover(ips, [exactAddress(address)]);
}

export function assertExamNetworkPolicyExplicitClientAccess(
    policy: ExamNetworkPolicy,
    controlPlaneValue: ExamNetworkControlPlane,
    resolvedControlPlaneAddresses: string[],
): void {
    const controlPlane = canonicalControlPlane(controlPlaneValue);
    const addresses = resolvedControlPlaneAddresses.map(exactAddress);
    const hostExplicit = !isIP(controlPlane.host) && hostMatchesPolicy(policy.hosts, controlPlane.host);
    const ipExplicit = addresses.some((address) => policyCoversAddress(policy.ips, address));
    if (!hostExplicit && !ipExplicit) throw new ExamNetworkPolicyError('control_plane_not_explicit');
    if (!policy.ports.length) return;
    if (!policy.ports.includes(controlPlane.port)) throw new ExamNetworkPolicyError('control_plane_port_not_explicit');
    if (!policy.ports.includes(EXAM_NETWORK_STREAM_PORT)) throw new ExamNetworkPolicyError('stream_port_not_explicit');
}

export function suggestedExamNetworkPolicy(
    controlPlaneValue: ExamNetworkControlPlane,
    ojHost: string,
): ExamNetworkPolicy {
    const controlPlane = canonicalControlPlane(controlPlaneValue);
    const hosts: string[] = [];
    const ips: string[] = [];
    const addDestination = (value: string) => {
        const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
        if (!trimmed) return;
        if (isIP(trimmed)) {
            const address = exactAddress(trimmed);
            if (!ips.includes(address)) ips.push(address);
            return;
        }
        const host = canonicalHost(trimmed);
        if (!hosts.includes(host)) hosts.push(host);
    };
    try {
        addDestination(ojHost);
    } catch (error) {
        if (!(error instanceof ExamNetworkPolicyError)) throw error;
    }
    addDestination(controlPlane.host);
    if (!hosts.length && !ips.length) throw new ExamNetworkPolicyError('destination_required');
    const ports = Array.from(new Set([80, 443, controlPlane.port, EXAM_NETWORK_STREAM_PORT])).sort((left, right) => left - right);
    return canonicalExamNetworkPolicy({ hosts, ips, ports });
}
