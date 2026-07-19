import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';
import { Readable } from 'node:stream';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };
(global as any).Hydro.model ||= {};

type Observer = (...args: any[]) => Promise<unknown>;

let observers: Record<string, Observer> = {};
let current: any;
const stored = new Map<string, Buffer>();

const appStub = {
    events: {
        dispatch(_type: string, args: unknown[]) {
            const event = args.shift() as string;
            const observer = observers[event];
            return observer ? [observer] : [];
        },
    },
};
(global as any).app = appStub;

function applyUpdate(target: any, update: any) {
    Object.assign(target, structuredClone(update.$set || {}));
    for (const field of Object.keys(update.$unset || {})) delete target[field];
}

const documentStub = {
    TYPE_PROBLEM: 10,
    coll: {
        async findOne() {
            return structuredClone(current);
        },
        async findOneAndUpdate(_filter: any, update: any) {
            applyUpdate(current, update);
            return structuredClone(current);
        },
    },
    async getSub() {
        return [null, null];
    },
    async push() {
        return undefined;
    },
    async setSub() {
        return undefined;
    },
    async deleteSub() {
        return undefined;
    },
};

async function toBuffer(value: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value);
    const chunks: Buffer[] = [];
    for await (const chunk of value as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
}

const storageStub = {
    async put(target: string, value: unknown) {
        stored.set(target, await toBuffer(value));
    },
    async get(target: string) {
        const value = stored.get(target);
        if (!value) throw new Error(`missing storage fixture: ${target}`);
        return Readable.from(Buffer.from(value));
    },
    async getMeta(target: string) {
        const value = stored.get(target);
        if (!value) return null;
        return { size: value.length, lastModified: new Date('2026-07-19T00:00:00.000Z'), etag: target };
    },
    async rename(source: string, target: string) {
        const value = stored.get(source);
        if (!value) throw new Error(`missing storage fixture: ${source}`);
        stored.delete(source);
        stored.set(target, value);
    },
    async del(targets: string | string[]) {
        for (const target of Array.isArray(targets) ? targets : [targets]) stored.delete(target);
    },
};

class StubError extends Error {}

const genericRelativeStub = new Proxy(
    {},
    {
        get(_target, key) {
            if (key === '__esModule') return false;
            return () => undefined;
        },
    },
);

const accessStub = new Proxy(
    {
        PROBLEM_ACL_INTERNAL_FIELDS: new Set(),
        normalizeProblemFileListSnapshot(value: unknown, present: boolean) {
            const files = Array.isArray(value) ? structuredClone(value) : [];
            return {
                files,
                snapshot: present ? { state: 'array', value: structuredClone(files) } : { state: 'missing' },
            };
        },
        problemDataSnapshotFilter() {
            return {};
        },
        problemWriteCapabilityAllows(granted: string, required: string) {
            return granted === required || (granted === 'content' && required === 'data');
        },
        problemWriteClaimAllowsTestdataMutation(claim: any) {
            return claim.state === 'active' && claim.capability === 'data';
        },
    },
    {
        get(target, key) {
            if (key === '__esModule') return false;
            return key in target ? (target as any)[key] : () => undefined;
        },
    },
);

const problemPath = require.resolve('../src/model/problem.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === problemPath) {
        if (request === '../service/bus') return originalLoad.call(this, request, parent, isMain);
        if (request === './document') return documentStub;
        if (request === './storage') return storageStub;
        if (request === './problem-access') return accessStub;
        if (request === './managed-problem-patch') return originalLoad.call(this, request, parent, isMain);
        if (request === './oplog') {
            return {
                async add() {
                    return undefined;
                },
            };
        }
        if (request === '../lib/problem-testdata-upload') {
            return {
                normalizeProblemTestdataUpload: async (name: string, value: unknown) => (/^config\.ya?ml$/i.test(name) ? toBuffer(value) : value),
            };
        }
        if (request === '../lib/problem-config') {
            return {
                isProblemConfigFilename: (name: string) => /^config\.ya?ml$/i.test(name),
                parseProblemConfigObject: () => null,
            };
        }
        if (request === '../error') {
            return new Proxy({ FileUploadError: StubError, ValidationError: StubError }, { get: (target, key: string) => target[key] || StubError });
        }
        if (request.startsWith('.')) return genericRelativeStub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let ProblemModel: any;
let apply: (ctx: any) => Promise<void>;
try {
    delete require.cache[problemPath];
    const loaded = require(problemPath);
    ProblemModel = loaded.default;
    apply = loaded.apply;
} finally {
    Module._load = originalLoad;
}

const configPath = 'problem/system/3050/testdata/config.yaml';
const claim = {
    domainId: 'system',
    pid: 3050,
    actor: 2,
    operation: 'files-upload',
    capability: 'data',
    state: 'active',
    requestId: 'managed-config-upload',
};

beforeEach(async () => {
    stored.clear();
    observers = {};
    current = {
        domainId: 'system',
        docType: 10,
        docId: 3050,
        pid: 'P5035',
        authoringMode: 'managed',
        problemKind: 'programming',
        structureRevision: 1,
        hidden: true,
        managedAuthoring: { metadataStatus: 'draft', workingTitle: 'Fixture', selectedMindmapNodeIds: ['node-1'] },
        config: {},
        data: [],
        aclWriteClaim: structuredClone(claim),
    };
    const registered: Record<string, Observer> = {};
    await apply({
        on(event: string, observer: Observer) {
            registered[event] = observer;
        },
    });
    observers = registered;
});

describe('managed config testdata consistency', () => {
    it('commits config.yaml metadata and the config mirror under one data claim', async () => {
        const yaml = 'type: default\n';

        await ProblemModel.addTestdataWithClaim(claim, 'config.yaml', Buffer.from(yaml), 2);

        expect(stored.get(configPath)?.toString()).to.equal(yaml);
        expect(current.data).to.have.length(1);
        expect(current.data[0].name).to.equal('config.yaml');
        expect(current.config).to.equal(yaml);
    });

    it('clears the config mirror in the same claimed delete that removes config.yaml', async () => {
        const yaml = 'type: default\n';
        stored.set(configPath, Buffer.from(yaml));
        current.config = yaml;
        current.data = [{ _id: 'config.yaml', name: 'config.yaml', size: Buffer.byteLength(yaml) }];
        current.aclWriteClaim = { ...claim, operation: 'files-delete', requestId: 'managed-config-delete' };

        await ProblemModel.delTestdataWithClaim(current.aclWriteClaim, 'config.yaml', 2);

        expect(stored.has(configPath)).to.equal(false);
        expect(current.data).to.deep.equal([]);
        expect(current.config).to.equal('');
    });

    it('moves the config mirror atomically when a claimed rename enters or leaves the config filename', async () => {
        const yaml = 'type: default\n';
        const textPath = 'problem/system/3050/testdata/judge.txt';
        const yamlPath = 'problem/system/3050/testdata/config.yml';
        stored.set(configPath, Buffer.from(yaml));
        current.config = yaml;
        current.data = [{ _id: 'config.yaml', name: 'config.yaml', size: Buffer.byteLength(yaml) }];
        current.aclWriteClaim = { ...claim, operation: 'files-rename', requestId: 'managed-config-rename' };

        await ProblemModel.renameTestdataWithClaim(current.aclWriteClaim, 'config.yaml', 'judge.txt', 2);

        expect(stored.has(configPath)).to.equal(false);
        expect(stored.get(textPath)?.toString()).to.equal(yaml);
        expect(current.data[0].name).to.equal('judge.txt');
        expect(current.config).to.equal('');

        await ProblemModel.renameTestdataWithClaim(current.aclWriteClaim, 'judge.txt', 'config.yml', 2);

        expect(stored.has(textPath)).to.equal(false);
        expect(stored.get(yamlPath)?.toString()).to.equal(yaml);
        expect(current.data[0].name).to.equal('config.yml');
        expect(current.config).to.equal(yaml);
    });
});
