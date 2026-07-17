import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };
(global as any).Hydro.model ||= {};

type Observer = (...args: unknown[]) => Promise<unknown>;

let observers: Observer[] = [];
const observerEvents: unknown[][] = [];
const appStub = {
    events: {
        dispatch(_type: string, args: unknown[]) {
            const event = args.shift();
            observerEvents.push([event, ...args]);
            return observers;
        },
    },
};
(global as any).app = appStub;

const documentStub = {
    TYPE_PROBLEM: 1,
    async getSub() {
        return [null, null];
    },
    async push() {},
    async setSub() {},
    async deleteSub() {},
};

const storageStub = {
    async put() {},
    async rename() {},
    async del() {},
    async get() {
        return Buffer.from('data');
    },
    async getMeta() {
        return { size: 4, lastModified: new Date(), etag: 'etag' };
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

const problemPath = require.resolve('../src/model/problem.ts');
const originalLoad = Module._load;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === problemPath) {
        if (request === '../service/bus') return originalLoad.call(this, request, parent, isMain);
        if (request === './document') return documentStub;
        if (request === './storage') return storageStub;
        if (request === '../lib/problem-testdata-upload') {
            return { normalizeProblemTestdataUpload: async (_name: string, value: unknown) => value };
        }
        if (request === '../lib/problem-config') {
            return { isProblemConfigFilename: () => false, parseProblemConfigObject: () => null };
        }
        if (request === '../error') {
            return new Proxy(
                { FileUploadError: StubError, ValidationError: StubError },
                { get: (target, key: string) => target[key] || StubError },
            );
        }
        if (request.startsWith('.')) return genericRelativeStub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let ProblemModel: any;
try {
    delete require.cache[problemPath];
    ProblemModel = require(problemPath).default;
} finally {
    Module._load = originalLoad;
}

ProblemModel.assertDirectStructureWritable = async () => null;
ProblemModel.assertClaimedTestdataWriteClaim = () => undefined;
ProblemModel.getClaimedProblemFiles = async () => ({
    doc: {
        domainId: 'system',
        docId: 7,
        pid: 'P7',
        data: [{ _id: 'old.in', name: 'old.in', size: 4 }],
    },
    snapshot: { exists: true, files: [{ name: 'old.in', size: 4 }] },
});
ProblemModel.commitClaimedTestdataState = async () => undefined;

const claim = {
    domainId: 'system',
    pid: 7,
    actor: 42,
    operation: 'files-upload',
    capability: 'content',
    state: 'active',
    requestId: 'observer-test',
};

const mutations = [
    ['direct upload', 'problem/addTestdata', () => ProblemModel.addTestdata('system', 7, 'new.in', Buffer.from('data'), 42)],
    ['direct rename', 'problem/renameTestdata', () => ProblemModel.renameTestdata('system', 7, 'old.in', 'new.in', 42)],
    ['direct delete', 'problem/delTestdata', () => ProblemModel.delTestdata('system', 7, 'old.in', 42)],
    ['claimed upload', 'problem/addTestdata', () => ProblemModel.addTestdataWithClaim(claim, 'new.in', Buffer.from('data'), 42)],
    ['claimed rename', 'problem/renameTestdata', () => ProblemModel.renameTestdataWithClaim(claim, 'old.in', 'new.in', 42)],
    ['claimed delete', 'problem/delTestdata', () => ProblemModel.delTestdataWithClaim(claim, 'old.in', 42)],
] as const;

async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        return error;
    }
    return null;
}

describe('problem testdata observer completion contract', () => {
    for (const [label, expectedEvent, mutate] of mutations) {
        it(`${label} waits for the final observer and propagates its error`, async () => {
            observerEvents.length = 0;
            let releaseLastObserver!: () => void;
            observers = [
                async () => undefined,
                async () =>
                    new Promise<void>((resolve) => {
                        releaseLastObserver = resolve;
                    }),
            ];

            let settled = false;
            const pending = mutate().then(() => {
                settled = true;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(observerEvents).to.have.length(1);
            expect(observerEvents[0][0]).to.equal(expectedEvent);
            expect(settled).to.equal(false);

            releaseLastObserver();
            await pending;
            expect(settled).to.equal(true);

            const observerError = new Error(`${label} observer failed`);
            observers = [
                async () => undefined,
                async () => {
                    throw observerError;
                },
            ];
            expect(await captureFailure(mutate)).to.equal(observerError);

            let releaseSlowObserver!: () => void;
            let slowObserverFinished = false;
            observers = [
                async () => {
                    throw observerError;
                },
                async () => {
                    await new Promise<void>((resolve) => {
                        releaseSlowObserver = resolve;
                    });
                    slowObserverFinished = true;
                },
            ];
            let failedMutationSettled = false;
            const failedMutation = captureFailure(mutate).then((error) => {
                failedMutationSettled = true;
                return error;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(failedMutationSettled).to.equal(false);
            expect(slowObserverFinished).to.equal(false);

            releaseSlowObserver();
            expect(await failedMutation).to.equal(observerError);
            expect(slowObserverFinished).to.equal(true);
        });
    }
});
