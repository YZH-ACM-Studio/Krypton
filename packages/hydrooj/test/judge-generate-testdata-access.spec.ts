import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(Math as any).sum ||= (...values: unknown[]) => values.flat(Infinity).reduce((sum: number, value) => sum + Number(value || 0), 0);
const judgePath = require.resolve('../src/handler/judge.ts');
const originalLoad = Module._load;

class ForbiddenError extends Error {}
class GenericError extends Error {}

const calls = {
    add: [] as any[],
    claims: [] as any[],
    gets: [] as any[],
    stats: [] as any[],
    users: [] as any[],
};
let claimAllowed = true;

const generateSentinel = {
    toString: () => '000000000000000000000001',
    equals(value: unknown) {
        return String(value) === this.toString();
    },
};
const pretestSentinel = { toString: () => '000000000000000000000002' };
const dataWriteConfirmation = {
    requestId: 'confirmation-1',
    domainId: 'system',
    pid: 7,
    actor: 42,
    operation: 'generate-testdata-request',
    containerFingerprint: 'container-fingerprint',
    issuedAt: 1_788_000_000_000,
};
let currentRecord: any = {
    domainId: 'system',
    pid: 7,
    uid: 42,
    contest: generateSentinel,
    dataWriteActiveContainerConfirmation: dataWriteConfirmation,
};

const pdoc = {
    domainId: 'system',
    docId: 7,
    owner: 1,
    reference: null,
    data: [],
    additional_file: [],
};
const actor = {
    _id: 42,
    own() {
        throw new Error('legacy udoc.own must not authorize callback writes');
    },
    hasPerm() {
        throw new Error('legacy wide permission check must not authorize callback writes');
    },
};

const problemStub = {
    async get(...args: any[]) {
        calls.gets.push(args);
        return pdoc;
    },
    async withAuthorizedWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        calls.claims.push({ domainId, pid, user, operation, options });
        if (!claimAllowed) throw new ForbiddenError('revoke won');
        return work({ domainId, pid, actor: user._id, requestId: 'generate-callback' });
    },
    async withAuthorizedStructuralWriteClaim(domainId: string, pid: number, user: any, operation: string, work: (claim: any) => Promise<any>) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work);
    },
    async withAuthorizedDataWriteClaim(
        domainId: string,
        pid: number,
        user: any,
        operation: string,
        work: (claim: any) => Promise<any>,
        options: any = {},
    ) {
        return problemStub.withAuthorizedWriteClaim(domainId, pid, user, operation, work, options);
    },
    async addTestdataWithClaim(claim: any, ...args: any[]) {
        calls.add.push({ claim, args });
    },
};

const recordStub = {
    RECORD_GENERATE: generateSentinel,
    RECORD_PRETEST: pretestSentinel,
    collHistory: {
        async updateOne() {
            return undefined;
        },
    },
    async get() {
        return currentRecord;
    },
};

function noopDecorator() {
    return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor;
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== judgePath) return originalLoad.call(this, request, parent, isMain);
    if (request === 'fs-extra') {
        return {
            async stat(filePath: string) {
                calls.stats.push(filePath);
                return { size: 1 };
            },
            createReadStream(filePath: string) {
                return { filePath };
            },
        };
    }
    if (request === '@hydrooj/common') return {};
    if (request === '@hydrooj/utils') return { sleep: async () => undefined };
    if (request === '../context') return { Context: class {} };
    if (request === '../error') {
        return new Proxy({ ForbiddenError }, { get: (target, key: string) => target[key] || GenericError });
    }
    if (request === '../interface') return {};
    if (request === '../lib/problem-config') {
        return { mergeSubjectiveScores: () => null, parseProblemConfigObject: () => ({}) };
    }
    if (request === '../logger') {
        return {
            Logger: class {
                info() {}
                warn() {}
            },
        };
    }
    if (request === '../model/builtin') {
        return { PERM: { PERM_EDIT_PROBLEM_SELF: 1n, PERM_EDIT_PROBLEM: 2n }, STATUS: {}, PRIV: {} };
    }
    if (request === '../model/contest') return {};
    if (request === '../model/domain') return {};
    if (request === '../model/problem') return problemStub;
    if (request === '../model/record') return recordStub;
    if (request === '../model/setting') return { langs: {} };
    if (request === '../model/storage') return {};
    if (request === '../model/system') return { get: () => 100 };
    if (request === '../model/task') return { default: {}, Consumer: class {} };
    if (request === '../model/user') {
        return {
            async getById(...args: any[]) {
                calls.users.push(args);
                return actor;
            },
        };
    }
    if (request === '../service/bus') return { default: {} };
    if (request === '../service/monitor') return { updateJudge: () => undefined };
    if (request === '../service/server') {
        return {
            ConnectionHandler: class {},
            Handler: class {},
            post: noopDecorator,
            subscribe: noopDecorator,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let processJudgeFileCallback: typeof import('../src/handler/judge').processJudgeFileCallback;
try {
    delete require.cache[judgePath];
    ({ processJudgeFileCallback } = require(judgePath));
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    claimAllowed = true;
    currentRecord = {
        domainId: 'system',
        pid: 7,
        uid: 42,
        contest: generateSentinel,
        dataWriteActiveContainerConfirmation: dataWriteConfirmation,
    };
});

describe('generated testdata judge callback authorization', () => {
    it('writes only inside an authoritative current-actor claim', async () => {
        await processJudgeFileCallback('rid' as any, 'generated.in', '/tmp/generated.in');
        expect(calls.claims).to.deep.equal([
            {
                domainId: 'system',
                pid: 7,
                user: actor,
                operation: 'generate-testdata-callback',
                options: {
                    activeContainerConfirmation: dataWriteConfirmation,
                    confirmationOperation: 'generate-testdata-request',
                },
            },
        ]);
        expect(calls.add).to.have.length(1);
        expect(calls.add[0].claim.requestId).to.equal('generate-callback');
        expect(calls.add[0].args[0]).to.equal('generated.in');
    });

    it('performs zero filesystem/storage/metadata work when revoke wins the claim race', async () => {
        claimAllowed = false;
        let error: unknown;
        try {
            await processJudgeFileCallback('rid' as any, 'generated.in', '/tmp/generated.in');
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(ForbiddenError);
        expect(calls.stats).to.deep.equal([]);
        expect(calls.add).to.deep.equal([]);
    });

    it('rejects missing, ordinary, pretest, and hack records before user/claim/filesystem/storage work', async () => {
        const invalidRecords = [
            null,
            { domainId: 'system', pid: 7, uid: 42 },
            { domainId: 'system', pid: 7, uid: 42, contest: pretestSentinel },
            { domainId: 'system', pid: 7, uid: 42, contest: { toString: () => '507f1f77bcf86cd799439011' } },
        ];
        for (const invalid of invalidRecords) {
            currentRecord = invalid;
            let error: unknown;
            try {
                await processJudgeFileCallback('rid' as any, 'generated.in', '/tmp/generated.in');
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.instanceOf(ForbiddenError);
        }
        expect(calls.users).to.deep.equal([]);
        expect(calls.claims).to.deep.equal([]);
        expect(calls.stats).to.deep.equal([]);
        expect(calls.add).to.deep.equal([]);
    });
});
