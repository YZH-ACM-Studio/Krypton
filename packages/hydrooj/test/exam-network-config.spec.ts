import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';

function cloneValue<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (value instanceof Date) return new Date(value) as T;
    if (Array.isArray(value)) return value.map(cloneValue) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
    }
    return value;
}

function same(left: unknown, right: unknown): boolean {
    if (Array.isArray(left)) return left.some((value) => same(value, right));
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    if (left instanceof Date || right instanceof Date) return Number(left) === Number(right);
    return left === right;
}

class MemoryCollection<T extends Record<string, unknown>> {
    docs: T[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];
    insertError?: unknown;

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async insertOne(doc: T) {
        if (this.insertError !== undefined) {
            const error = this.insertError;
            this.insertError = undefined;
            throw error;
        }
        this.docs.push(cloneValue(doc));
        return { insertedId: doc._id };
    }

    async findOne(filter: Record<string, unknown>) {
        const found = this.docs.find((doc) => this.matches(doc, filter));
        return found ? cloneValue(found) : null;
    }

    find(filter: Record<string, unknown>) {
        const rows = this.docs.filter((doc) => this.matches(doc, filter));
        return {
            sort: () => ({ limit: (count: number) => ({ toArray: async () => rows.slice(0, count).map(cloneValue) }) }),
        };
    }

    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) return null;
        const next = cloneValue(this.docs[index]);
        for (const [path, value] of Object.entries((update.$set as Record<string, unknown> | undefined) || {})) {
            this.setPath(next, path, cloneValue(value));
        }
        for (const [path, value] of Object.entries((update.$push as Record<string, unknown> | undefined) || {})) {
            const target = this.getPath(next, path);
            if (!Array.isArray(target)) throw new Error(`Cannot push to ${path}`);
            target.push(cloneValue(value));
        }
        this.docs[index] = next;
        return cloneValue(next);
    }

    private getPath(doc: T, path: string): unknown {
        return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], doc);
    }

    private setPath(doc: T, path: string, value: unknown): void {
        const pieces = path.split('.');
        const leaf = pieces.pop()!;
        const parent = pieces.reduce<Record<string, unknown>>((target, key) => target[key] as Record<string, unknown>, doc);
        parent[leaf] = value;
    }

    private matches(doc: T, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, expected]) => {
            if (field === '$or') {
                return Array.isArray(expected) && expected.some((item) => this.matches(doc, item as Record<string, unknown>));
            }
            const actual = this.getPath(doc, field);
            if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId)) {
                const operators = expected as Record<string, unknown>;
                if ('$ne' in operators) return !same(actual, operators.$ne);
            }
            return same(actual, expected);
        });
    }
}

const collections = new Map<string, MemoryCollection<Record<string, unknown>>>();
const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection: (name: string) => {
                const collection = new MemoryCollection<Record<string, unknown>>();
                collections.set(name, collection);
                return collection;
            },
        },
    },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const policyModule = require('../src/model/exam-network-policy.ts') as typeof import('../src/model/exam-network-policy');
const configModule = require('../src/model/exam-network-config.ts') as typeof import('../src/model/exam-network-config');
const auditModule = require('../src/model/exam-network-audit.ts') as typeof import('../src/model/exam-network-audit');
const boundaryModule = require('../src/model/exam-event-boundary.ts') as typeof import('../src/model/exam-event-boundary');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const schoolId = new ObjectId('66b800000000000000000701');
const otherSchoolId = new ObjectId('66b800000000000000000702');
const eventId = new ObjectId('66b800000000000000000703');

function fixture() {
    const templates = new MemoryCollection<Record<string, unknown>>();
    const assignments = new MemoryCollection<Record<string, unknown>>();
    const configs = new MemoryCollection<Record<string, unknown>>();
    let sequence = 0x710;
    const service = new configModule.ExamNetworkConfigService(
        templates as never,
        assignments as never,
        configs as never,
        () => new Date('2026-08-11T01:00:00.000Z'),
        () => new ObjectId(`66b800000000000000${(sequence++).toString(16).padStart(6, '0')}`),
    );
    return { service, templates, assignments, configs };
}

function policy(hosts: string[] = ['judge.example.edu']) {
    return { hosts, ips: ['10.10.0.0/16', '2001:db8::/64'], ports: [80, 443] };
}

const controlPlane = { host: 'vigil.example.edu', port: 443 };
const networkPolicyCommands = ['apply_network_policy', 'get_network_policy_status', 'stop_network_policy'];

function endpoint(endpointId: string, endpointSchoolId = schoolId, version = 1, commands = networkPolicyCommands) {
    return { endpointId, schoolId: endpointSchoolId, capabilities: [{ name: 'network.policy', version, commands }] };
}

async function reason(run: () => unknown | Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { reason?: string }).reason || null;
    }
}

describe('Exam network policy canonical schema', () => {
    it('normalizes the strict wire policy and preserves a stable fingerprint', () => {
        const canonical = policyModule.canonicalExamNetworkPolicy({
            hosts: ['JUDGE.Example.EDU'],
            ips: ['2001:0db8::/64', '10.10.0.0/16'],
            ports: [443, 80],
        });
        expect(canonical).to.deep.equal(policy());
        expect(policyModule.examNetworkPolicyFingerprint(canonical)).to.match(/^[a-f0-9]{64}$/);
    });

    it('fails closed on extra fields, noncanonical networks, scoped IPv6, duplicates and overlapping rules', async () => {
        const invalid = [
            { ...policy(), extra: true },
            { hosts: [], ips: ['10.10.1.1/16'], ports: [] },
            { hosts: [], ips: ['fe80::1%3'], ports: [] },
            { hosts: ['A.example.edu', 'a.example.edu'], ips: [], ports: [] },
            { hosts: ['*.example.edu', 'judge.example.edu'], ips: [], ports: [] },
            { hosts: [], ips: ['10.0.0.0/8', '10.1.0.0/16'], ports: [] },
            { hosts: [], ips: [], ports: [443] },
        ];
        for (const value of invalid) expect(() => policyModule.canonicalExamNetworkPolicy(value)).to.throw(policyModule.ExamNetworkPolicyError);
        expect(
            await reason(() =>
                policyModule.validateExamNetworkPolicyResolution(policyModule.canonicalExamNetworkPolicy(policy()), async () => [], controlPlane),
            ),
        ).to.equal('unresolved_host');
    });

    it('rejects resolved rule expansion beyond the Endpoint Service limit', async () => {
        const canonical = policyModule.canonicalExamNetworkPolicy({ hosts: ['judge.example.edu'], ips: [], ports: [80, 443] });
        const addresses = Array.from(
            { length: 2049 },
            (_, index) => `10.${Math.floor(index / 65536)}.${Math.floor(index / 256) % 256}.${index % 256}`,
        );
        expect(await reason(() => policyModule.validateExamNetworkPolicyResolution(canonical, async () => addresses, controlPlane))).to.equal(
            'permit_rule_limit',
        );
    });

    it('counts the actual implicit control-plane permits without duplicating an explicit host rule', async () => {
        const explicitIps = Array.from({ length: 64 }, (_, index) => `192.0.2.${index}`);
        const resolved = Array.from(
            { length: 4032 },
            (_, index) => `10.${Math.floor(index / 65536)}.${Math.floor(index / 256) % 256}.${index % 256}`,
        );
        const needsImplicitPermit = policyModule.canonicalExamNetworkPolicy({
            hosts: ['judge.example.edu'],
            ips: explicitIps,
            ports: [443],
        });
        expect(
            await reason(() =>
                policyModule.validateExamNetworkPolicyResolution(
                    needsImplicitPermit,
                    async (hostname) => (hostname === 'judge.example.edu' ? resolved : ['198.51.100.1']),
                    controlPlane,
                ),
            ),
        ).to.equal('permit_rule_limit');

        const explicitlyCovered = policyModule.canonicalExamNetworkPolicy({
            hosts: [controlPlane.host],
            ips: explicitIps,
            ports: [controlPlane.port],
        });
        await policyModule.validateExamNetworkPolicyResolution(explicitlyCovered, async () => resolved, controlPlane);
    });

    it('classifies policy changes by effective host, CIDR and all-port semantics', () => {
        const base = policyModule.canonicalExamNetworkPolicy({
            hosts: ['*.example.edu'],
            ips: ['10.0.0.0/8'],
            ports: [443],
        });
        expect(
            policyModule.diffExamNetworkPolicies(
                base,
                policyModule.canonicalExamNetworkPolicy({
                    hosts: ['judge.example.edu'],
                    ips: ['10.1.0.0/16'],
                    ports: [443],
                }),
            ).effect,
        ).to.equal('tightening');
        expect(
            policyModule.diffExamNetworkPolicies(
                base,
                policyModule.canonicalExamNetworkPolicy({
                    hosts: ['*.example.edu'],
                    ips: ['10.0.0.0/8'],
                    ports: [],
                }),
            ).effect,
        ).to.equal('loosening');
        expect(
            policyModule.diffExamNetworkPolicies(
                base,
                policyModule.canonicalExamNetworkPolicy({
                    hosts: ['judge.example.edu', 'mirror.example.net'],
                    ips: ['10.1.0.0/16'],
                    ports: [80, 443],
                }),
            ).effect,
        ).to.equal('mixed');
        expect(policyModule.diffExamNetworkPolicies(base, base)).to.deep.equal({
            effect: 'unchanged',
            addedHosts: [],
            removedHosts: [],
            addedIps: [],
            removedIps: [],
            beforePorts: [443],
            afterPorts: [443],
        });

        const splitIpv4 = policyModule.canonicalExamNetworkPolicy({
            hosts: ['*.example.edu'],
            ips: ['10.0.0.0/9', '10.128.0.0/9'],
            ports: [443],
        });
        expect(policyModule.diffExamNetworkPolicies(base, splitIpv4).effect).to.equal('unchanged');
        expect(policyModule.diffExamNetworkPolicies(splitIpv4, base).effect).to.equal('unchanged');

        const ipv6 = policyModule.canonicalExamNetworkPolicy({
            hosts: ['*.example.edu'],
            ips: ['2001:db8::/64'],
            ports: [443],
        });
        const splitIpv6 = policyModule.canonicalExamNetworkPolicy({
            hosts: ['*.example.edu'],
            ips: ['2001:db8::/65', '2001:db8:0:0:8000::/65'],
            ports: [443],
        });
        expect(policyModule.diffExamNetworkPolicies(ipv6, splitIpv6).effect).to.equal('unchanged');
        expect(policyModule.diffExamNetworkPolicies(splitIpv6, ipv6).effect).to.equal('unchanged');

        const ipv4WithGap = policyModule.canonicalExamNetworkPolicy({
            hosts: ['*.example.edu'],
            ips: ['10.0.0.0/9', '10.128.0.0/10'],
            ports: [443],
        });
        expect(policyModule.diffExamNetworkPolicies(base, ipv4WithGap).effect).to.equal('tightening');
    });
});

describe('Exam policy templates and immutable revisions', () => {
    it('creates exact indexes, publishes immutable revisions and keeps them after archive', async () => {
        const { service, templates, assignments, configs } = fixture();
        await service.ensureIndexes();
        expect(templates.indexes.map((entry) => entry.options.name)).to.deep.equal([
            'examPolicySchoolStatus',
            'examPolicyOwner',
            'examPolicyCollaborator',
        ]);
        expect(assignments.indexes[0]).to.deep.equal({
            key: { domainId: 1, eventId: 1 },
            options: { name: 'examTargetEvent', unique: true },
        });
        expect(configs.indexes[0]).to.deep.equal({
            key: { domainId: 1, eventId: 1 },
            options: { name: 'examNetworkConfigEvent', unique: true },
        });

        const created = await service.createTemplate({
            domainId: 'system',
            schoolId,
            name: '  CSP 网络策略  ',
            ownerUid: 1,
            collaboratorUids: [3, 2, 3, 1],
            policy: policy(),
        });
        expect(created).to.include({ name: 'CSP 网络策略', status: 'active', revision: 1 });
        expect(created.collaboratorUids).to.deep.equal([2, 3]);
        const firstPublished = await service.publishTemplate({
            domainId: 'system',
            templateId: created._id,
            expectedRevision: 1,
            actorUid: 1,
            resolveHost: async () => ['10.20.0.1'],
            controlPlane,
        });
        expect(firstPublished.revisions).to.have.length(1);
        const firstFingerprint = firstPublished.revisions[0].fingerprint;
        const edited = await service.saveTemplateDraft({
            domainId: 'system',
            templateId: created._id,
            expectedRevision: 2,
            actorUid: 1,
            policy: { hosts: ['new.example.edu'], ips: [], ports: [443] },
        });
        const secondPublished = await service.publishTemplate({
            domainId: 'system',
            templateId: created._id,
            expectedRevision: edited.revision,
            actorUid: 1,
            resolveHost: async () => ['10.20.0.2'],
            controlPlane,
        });
        expect(secondPublished.revisions.map((revision) => revision.revision)).to.deep.equal([1, 2]);
        expect(secondPublished.revisions[0].fingerprint).to.equal(firstFingerprint);
        expect(secondPublished.revisions[0].policy.hosts).to.deep.equal(['judge.example.edu']);
        const archived = await service.archiveTemplate({
            domainId: 'system',
            templateId: created._id,
            expectedRevision: secondPublished.revision,
            actorUid: 1,
        });
        expect(archived.status).to.equal('archived');
        expect(archived.revisions).to.have.length(2);
        expect(
            await reason(() =>
                service.saveTemplateDraft({
                    domainId: 'system',
                    templateId: created._id,
                    expectedRevision: archived.revision,
                    actorUid: 1,
                    name: 'x',
                }),
            ),
        ).to.equal('template_archived');
    });

    it('does not publish unresolved DNS or a stale root revision', async () => {
        const { service } = fixture();
        const created = await service.createTemplate({
            domainId: 'system',
            schoolId,
            name: 'Policy',
            ownerUid: 1,
            collaboratorUids: [],
            policy: policy(),
        });
        expect(
            await reason(() =>
                service.publishTemplate({
                    domainId: 'system',
                    templateId: created._id,
                    expectedRevision: 1,
                    actorUid: 1,
                    resolveHost: async () => [],
                    controlPlane,
                }),
            ),
        ).to.equal('unresolved_host');
        const saved = await service.saveTemplateDraft({
            domainId: 'system',
            templateId: created._id,
            expectedRevision: 1,
            actorUid: 1,
            name: 'Policy 2',
        });
        expect(saved.revision).to.equal(2);
        expect(
            await reason(() =>
                service.publishTemplate({
                    domainId: 'system',
                    templateId: created._id,
                    expectedRevision: 1,
                    actorUid: 1,
                    resolveHost: async () => ['10.0.0.1'],
                    controlPlane,
                }),
            ),
        ).to.equal('revision_conflict');
    });
});

describe('Exam target snapshots and event revision references', () => {
    it('allows incomplete target drafts but fails closed when previewing an empty source set', async () => {
        const { service } = fixture();
        await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [],
        });
        expect(
            await reason(() =>
                service.previewTargets({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    resolver: async () => ({ sourceFingerprint: 'a'.repeat(64), endpoints: [endpoint('e1')] }),
                }),
            ),
        ).to.equal('empty_target_source');
    });

    it('re-resolves, confirms and freezes an explicit capable same-school endpoint list', async () => {
        const { service } = fixture();
        const assignment = await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [
                { kind: 'endpoint', ids: ['endpoint-b', 'endpoint-a'] },
                { kind: 'userbindGroup', ids: ['66b800000000000000000704'] },
            ],
        });
        expect(assignment.draft.sources[0]).to.deep.equal({ kind: 'endpoint', ids: ['endpoint-a', 'endpoint-b'] });
        const resolver = async () => ({
            sourceFingerprint: 'a'.repeat(64),
            endpoints: [endpoint('endpoint-b'), endpoint('endpoint-a')],
        });
        const preview = await service.previewTargets({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 1,
            resolver,
        });
        expect(preview.endpointIds).to.deep.equal(['endpoint-a', 'endpoint-b']);
        expect(preview.addedEndpointIds).to.deep.equal(['endpoint-a', 'endpoint-b']);
        expect(
            await reason(() =>
                service.publishTargets({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: 1,
                    confirmationFingerprint: '0'.repeat(64),
                    actorUid: 1,
                    resolver,
                }),
            ),
        ).to.equal('target_confirmation_stale');
        const published = await service.publishTargets({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 1,
            confirmationFingerprint: preview.previewFingerprint,
            actorUid: 1,
            resolver,
        });
        expect(published.revisions[0]).to.include({ revision: 1, targetCount: 2 });
        expect(published.revisions[0].endpointIds).to.deep.equal(['endpoint-a', 'endpoint-b']);
    });

    it('rejects empty, cross-school, duplicate and insufficient-capability resolution facts', async () => {
        const { service } = fixture();
        await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [{ kind: 'classroom', ids: ['room-1'] }],
        });
        const cases = [
            { endpoints: [], expected: 'empty_target' },
            { endpoints: [endpoint('e1', otherSchoolId)], expected: 'cross_school_endpoint' },
            { endpoints: [endpoint('e1'), endpoint('e1')], expected: 'duplicate_endpoint' },
            { endpoints: [{ ...endpoint('e1'), capabilities: [] }], expected: 'endpoint_capability_missing' },
            { endpoints: [endpoint('e1', schoolId, 2)], expected: 'endpoint_capability_incomplete' },
            ...networkPolicyCommands.map((missingCommand) => ({
                endpoints: [
                    endpoint(
                        'e1',
                        schoolId,
                        1,
                        networkPolicyCommands.filter((command) => command !== missingCommand),
                    ),
                ],
                expected: 'endpoint_capability_incomplete',
            })),
            {
                endpoints: [
                    {
                        ...endpoint('e1'),
                        capabilities: [{ name: 'network.policy', version: 1, commands: 'apply_network_policy' as never }],
                    },
                ],
                expected: 'endpoint_capability_incomplete',
            },
        ];
        for (const item of cases) {
            expect(
                await reason(() =>
                    service.previewTargets({
                        domainId: 'system',
                        eventId,
                        schoolId,
                        resolver: async () => ({ sourceFingerprint: 'b'.repeat(64), endpoints: item.endpoints }),
                    }),
                ),
            ).to.equal(item.expected);
        }
    });

    it('detects source drift between preview and publish and keeps the first snapshot immutable', async () => {
        const { service } = fixture();
        await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [{ kind: 'examSeat', ids: ['seat-revision-1'] }],
        });
        const preview = await service.previewTargets({
            domainId: 'system',
            eventId,
            schoolId,
            resolver: async () => ({ sourceFingerprint: 'c'.repeat(64), endpoints: [endpoint('e1')] }),
        });
        expect(
            await reason(() =>
                service.publishTargets({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: 1,
                    confirmationFingerprint: preview.previewFingerprint,
                    actorUid: 1,
                    resolver: async () => ({ sourceFingerprint: 'd'.repeat(64), endpoints: [endpoint('e1'), endpoint('e2')] }),
                }),
            ),
        ).to.equal('target_confirmation_stale');
        const first = await service.publishTargets({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 1,
            confirmationFingerprint: preview.previewFingerprint,
            actorUid: 1,
            resolver: async () => ({ sourceFingerprint: 'c'.repeat(64), endpoints: [endpoint('e1')] }),
        });
        const edited = await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: first.revision,
            actorUid: 1,
            sources: [{ kind: 'endpoint', ids: ['e2'] }],
        });
        const nextPreview = await service.previewTargets({
            domainId: 'system',
            eventId,
            schoolId,
            resolver: async () => ({ sourceFingerprint: 'e'.repeat(64), endpoints: [endpoint('e2')] }),
        });
        const second = await service.publishTargets({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: edited.revision,
            confirmationFingerprint: nextPreview.previewFingerprint,
            actorUid: 1,
            resolver: async () => ({ sourceFingerprint: 'e'.repeat(64), endpoints: [endpoint('e2')] }),
        });
        expect(second.revisions[0].endpointIds).to.deep.equal(['e1']);
        expect(second.revisions[1].endpointIds).to.deep.equal(['e2']);
        expect(nextPreview.removedEndpointIds).to.deep.equal(['e1']);
    });

    it('reassigns an old immutable revision for rollback without mutating history', async () => {
        const { service } = fixture();
        const template = await service.createTemplate({
            domainId: 'system',
            schoolId,
            name: 'Policy',
            ownerUid: 1,
            collaboratorUids: [],
            policy: policy(),
        });
        const first = await service.publishTemplate({
            domainId: 'system',
            templateId: template._id,
            expectedRevision: 1,
            actorUid: 1,
            resolveHost: async () => ['10.20.0.1'],
            controlPlane,
        });
        const edited = await service.saveTemplateDraft({
            domainId: 'system',
            templateId: template._id,
            expectedRevision: first.revision,
            actorUid: 1,
            policy: { hosts: ['second.example.edu'], ips: [], ports: [443] },
        });
        await service.publishTemplate({
            domainId: 'system',
            templateId: template._id,
            expectedRevision: edited.revision,
            actorUid: 1,
            resolveHost: async () => ['10.20.0.2'],
            controlPlane,
        });
        const assignedFirst = await service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            policy: { templateId: template._id, revision: 1 },
        });
        const assignedSecond = await service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 1,
            actorUid: 1,
            policy: { templateId: template._id, revision: 2 },
        });
        const rollback = await service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 2,
            actorUid: 1,
            policy: { templateId: template._id, revision: 1 },
        });
        expect(assignedFirst.policy?.revision).to.equal(1);
        expect(assignedSecond.policy?.revision).to.equal(2);
        expect(rollback.policy?.revision).to.equal(1);
        expect(rollback.policy?.fingerprint).to.equal(first.revisions[0].fingerprint);
    });

    it('assigns and rolls back target revisions while rejecting unknown revision identities', async () => {
        const { service } = fixture();
        const created = await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [{ kind: 'endpoint', ids: ['e1'] }],
        });
        const firstPreview = await service.previewTargets({
            domainId: 'system',
            eventId,
            schoolId,
            resolver: async () => ({ sourceFingerprint: '1'.repeat(64), endpoints: [endpoint('e1')] }),
        });
        const first = await service.publishTargets({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: created.revision,
            confirmationFingerprint: firstPreview.previewFingerprint,
            actorUid: 1,
            resolver: async () => ({ sourceFingerprint: '1'.repeat(64), endpoints: [endpoint('e1')] }),
        });
        const edited = await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: first.revision,
            actorUid: 1,
            sources: [{ kind: 'endpoint', ids: ['e2'] }],
        });
        const secondPreview = await service.previewTargets({
            domainId: 'system',
            eventId,
            schoolId,
            resolver: async () => ({ sourceFingerprint: '2'.repeat(64), endpoints: [endpoint('e2')] }),
        });
        await service.publishTargets({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: edited.revision,
            confirmationFingerprint: secondPreview.previewFingerprint,
            actorUid: 1,
            resolver: async () => ({ sourceFingerprint: '2'.repeat(64), endpoints: [endpoint('e2')] }),
        });
        const assignedFirst = await service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            target: { assignmentId: created._id, revision: 1 },
        });
        const assignedSecond = await service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: assignedFirst.revision,
            actorUid: 1,
            target: { assignmentId: created._id, revision: 2 },
        });
        const rollback = await service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: assignedSecond.revision,
            actorUid: 1,
            target: { assignmentId: created._id, revision: 1 },
        });
        expect(assignedFirst.target?.revision).to.equal(1);
        expect(assignedSecond.target?.revision).to.equal(2);
        expect(rollback.target?.revision).to.equal(1);
        expect(
            await reason(() =>
                service.assignRevision({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: rollback.revision,
                    actorUid: 1,
                    target: { assignmentId: created._id, revision: 3 },
                }),
            ),
        ).to.equal('target_revision_not_found');
    });

    it('blocks event school changes after either target or policy configuration exists', async () => {
        const assignmentFixture = fixture();
        await assignmentFixture.service.assertEventSchoolChangeAllowed('system', eventId);
        await assignmentFixture.service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [],
        });
        expect(await reason(() => assignmentFixture.service.assertEventSchoolChangeAllowed('system', eventId))).to.equal(
            'network_configuration_exists',
        );

        const configFixture = fixture();
        const template = await configFixture.service.createTemplate({
            domainId: 'system',
            schoolId,
            name: 'Policy',
            ownerUid: 1,
            collaboratorUids: [],
            policy: policy(),
        });
        const published = await configFixture.service.publishTemplate({
            domainId: 'system',
            templateId: template._id,
            expectedRevision: 1,
            actorUid: 1,
            resolveHost: async () => ['10.20.0.1'],
            controlPlane,
        });
        await configFixture.service.assignRevision({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            policy: { templateId: template._id, revision: published.revisions[0].revision },
        });
        expect(await reason(() => configFixture.service.assertEventSchoolChangeAllowed('system', eventId))).to.equal('network_configuration_exists');
    });

    it('maps only the expected event unique-key race to a revision conflict', async () => {
        const exact = fixture();
        exact.assignments.insertError = {
            code: 11000,
            keyPattern: { domainId: 1, eventId: 1 },
            keyValue: { domainId: 'system', eventId },
        };
        expect(
            await reason(() =>
                exact.service.saveTargetDraft({
                    domainId: 'system',
                    eventId,
                    schoolId,
                    expectedRevision: 0,
                    actorUid: 1,
                    sources: [],
                }),
            ),
        ).to.equal('revision_conflict');

        const unexpected = fixture();
        const duplicate = Object.assign(new Error('unexpected duplicate'), {
            code: 11000,
            keyPattern: { _id: 1 },
            keyValue: { _id: new ObjectId() },
        });
        unexpected.assignments.insertError = duplicate;
        let caught: unknown;
        try {
            await unexpected.service.saveTargetDraft({
                domainId: 'system',
                eventId,
                schoolId,
                expectedRevision: 0,
                actorUid: 1,
                sources: [],
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).to.equal(duplicate);
    });
});

describe('Exam target resolver and audit boundaries', () => {
    it('serializes event scope and network writes so the second operation rechecks canonical state', async () => {
        let school = 'old';
        let assignmentSchool: string | null = null;
        let releaseSchoolChange!: () => void;
        let schoolChangeEntered!: () => void;
        const entered = new Promise<void>((resolve) => {
            schoolChangeEntered = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseSchoolChange = resolve;
        });
        const schoolChange = boundaryModule.withExamEventBoundary('system', eventId, async () => {
            schoolChangeEntered();
            await release;
            if (assignmentSchool) throw new Error('network_configuration_exists');
            school = 'new';
        });
        await entered;
        const oldSchoolWrite = boundaryModule.withExamEventBoundary('system', eventId, async () => {
            if (school !== 'old') throw new Error('event_school_mismatch');
            assignmentSchool = 'old';
        });
        releaseSchoolChange();
        await schoolChange;
        let writeError: unknown;
        try {
            await oldSchoolWrite;
        } catch (error) {
            writeError = error;
        }
        expect(writeError).to.have.property('message', 'event_school_mismatch');
        expect({ school, assignmentSchool }).to.deep.equal({ school: 'new', assignmentSchool: null });

        let archived = false;
        await boundaryModule.withExamEventBoundary('system', eventId, async () => {
            archived = true;
        });
        let archivedWriteError: unknown;
        try {
            await boundaryModule.withExamEventBoundary('system', eventId, async () => {
                if (archived) throw new Error('archived');
            });
        } catch (error) {
            archivedWriteError = error;
        }
        expect(archivedWriteError).to.have.property('message', 'archived');
    });

    it('fails closed without trusted resolvers and rejects double registration', () => {
        expect(() => configModule.requireExamTargetResolver()).to.throw(configModule.ExamNetworkConfigError);
        expect(() => configModule.requireExamNetworkControlPlaneResolver()).to.throw(configModule.ExamNetworkConfigError);
        const resolver: import('../src/model/exam-network-config').ExamTargetResolver = async () => ({
            sourceFingerprint: 'f'.repeat(64),
            endpoints: [],
        });
        const dispose = configModule.registerExamTargetResolver(resolver);
        expect(configModule.requireExamTargetResolver()).to.equal(resolver);
        expect(() => configModule.registerExamTargetResolver(resolver)).to.throw('already registered');
        dispose();
        const controlResolver = async () => controlPlane;
        const disposeControl = configModule.registerExamNetworkControlPlaneResolver(controlResolver);
        expect(configModule.requireExamNetworkControlPlaneResolver()).to.equal(controlResolver);
        expect(() => configModule.registerExamNetworkControlPlaneResolver(controlResolver)).to.throw('already registered');
        disposeControl();
    });

    it('persists audit intent before mutation and records fingerprint/count on success', async () => {
        const writes: Array<Record<string, unknown>> = [];
        const store = {
            add: async (data: Record<string, unknown>) => {
                writes.push(data);
                return new ObjectId('66b800000000000000000799');
            },
            updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
                writes.push(update.$set);
                return { matchedCount: 1 };
            },
        };
        const entityId = new ObjectId('66b800000000000000000798');
        const result = await auditModule.runAuditedExamNetworkMutation(
            { domainId: 'system', actorUid: 1 },
            'target-assignment.publish',
            {
                eventId,
                entityKind: 'targetAssignment',
                entityId,
                auditRef: `exam-target-assignment:${entityId}:2`,
                expectedRevision: 1,
                observedRevision: 1,
                targetRevision: 2,
                fingerprint: 'a'.repeat(64),
                targetCount: 2,
            },
            async () => ({ revision: 2, auditRef: `exam-target-assignment:${entityId}:2` }),
            () => ({ fingerprint: 'b'.repeat(64), targetCount: 2 }),
            store,
        );
        expect(result.revision).to.equal(2);
        expect(writes[0]).to.include({
            type: 'exam.network.target-assignment.publish',
            result: 'started',
            expectedRevision: 1,
            observedRevision: 1,
            targetRevision: 2,
            targetCount: 2,
        });
        expect(writes[1]).to.include({ result: 'success', targetCount: 2, fingerprint: 'b'.repeat(64) });
    });

    it('reports current draft facts without reusing the previous published fingerprint or target count', async () => {
        const { service } = fixture();
        const template = await service.createTemplate({
            domainId: 'system',
            schoolId,
            name: 'Policy',
            ownerUid: 1,
            collaboratorUids: [],
            policy: policy(),
        });
        const published = await service.publishTemplate({
            domainId: 'system',
            templateId: template._id,
            expectedRevision: 1,
            actorUid: 1,
            resolveHost: async () => ['10.20.0.1'],
            controlPlane,
        });
        const edited = await service.saveTemplateDraft({
            domainId: 'system',
            templateId: template._id,
            expectedRevision: published.revision,
            actorUid: 1,
            policy: { hosts: ['changed.example.edu'], ips: [], ports: [443] },
        });
        const templateFacts = auditModule.policyTemplateAuditFacts('saveDraft', edited);
        expect(templateFacts.fingerprint).to.equal(edited.draft.fingerprint);
        expect(templateFacts.fingerprint).not.to.equal(published.revisions[0].fingerprint);

        const assignment = await service.saveTargetDraft({
            domainId: 'system',
            eventId,
            schoolId,
            expectedRevision: 0,
            actorUid: 1,
            sources: [{ kind: 'endpoint', ids: ['e1', 'e2'] }],
        });
        const targetFacts = auditModule.targetAssignmentAuditFacts('saveDraft', assignment);
        expect(targetFacts).to.include({ sourceCount: 2, publishedRevision: null });
        expect(targetFacts)
            .to.have.property('sourceFingerprint')
            .that.matches(/^[a-f0-9]{64}$/);
        expect(targetFacts).not.to.have.property('targetCount');
        expect(targetFacts).not.to.have.property('fingerprint');
    });

    it('does not mutate when the audit intent cannot be written', async () => {
        let mutated = false;
        let error: unknown;
        try {
            await auditModule.runAuditedExamNetworkMutation(
                { domainId: 'system', actorUid: 1 },
                'config.assignPolicy',
                {
                    eventId,
                    entityKind: 'config',
                    entityId: eventId,
                    auditRef: `exam-event-network-config:${eventId}:1`,
                    expectedRevision: 0,
                    observedRevision: null,
                    targetRevision: 1,
                },
                async () => {
                    mutated = true;
                    return { revision: 1, auditRef: `exam-event-network-config:${eventId}:1` };
                },
                () => ({}),
                {
                    add: async () => {
                        throw new Error('audit unavailable');
                    },
                    updateOne: async () => ({ matchedCount: 1 }),
                },
            );
        } catch (caught) {
            error = caught;
        }
        expect(error).to.have.property('message', 'audit unavailable');
        expect(mutated).to.equal(false);
    });

    it('finalizes the audit as failed when a mutation returns the wrong canonical identity', async () => {
        const writes: Array<Record<string, unknown>> = [];
        const auditRef = `exam-event-network-config:${eventId}:1`;
        let caught: unknown;
        try {
            await auditModule.runAuditedExamNetworkMutation(
                { domainId: 'system', actorUid: 1 },
                'config.assignPolicy',
                {
                    eventId,
                    entityKind: 'config',
                    entityId: eventId,
                    auditRef,
                    expectedRevision: 0,
                    observedRevision: null,
                    targetRevision: 1,
                },
                async () => ({ revision: 2, auditRef }),
                () => ({}),
                {
                    add: async () => new ObjectId('66b800000000000000000799'),
                    updateOne: async (_filter, update) => {
                        writes.push(update.$set);
                        return { matchedCount: 1 };
                    },
                },
            );
        } catch (error) {
            caught = error;
        }
        expect(caught).to.have.property('message', `Exam network mutation returned an unexpected identity: ${auditRef}`);
        expect(writes).to.have.length(1);
        expect(writes[0]).to.include({ result: 'failed' });
    });
});
