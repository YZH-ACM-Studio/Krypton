import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };

let activeContainers: any[] = [];
const containerQueries: any[] = [];
const oplogCalls: any[] = [];
let innerWorkCalls = 0;
let claimOptions: any = null;

class StubError extends Error {
    params: unknown[];
    code = 409;

    constructor(...params: unknown[]) {
        super('guarded error');
        this.params = params;
    }
}

const documentStub = {
    TYPE_PROBLEM: 10,
    TYPE_CONTEST: 30,
    coll: {
        async findOne() {
            return {
                domainId: 'system',
                docId: 7,
                aclWriteClaim: {
                    requestId: 'data-claim',
                    actor: 42,
                    operation: 'files-upload',
                    capability: 'data',
                    state: 'active',
                },
            };
        },
        async updateOne() {
            return { matchedCount: 1 };
        },
    },
    getMulti(domainId: string, docType: number, query: any) {
        containerQueries.push({ domainId, docType, query: structuredClone(query) });
        const cursor = {
            project() {
                return cursor;
            },
            async toArray() {
                return structuredClone(activeContainers);
            },
        };
        return cursor;
    },
};

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
        if (request === '../service/bus') return { __esModule: true, default: {}, parallelAllSettled: async () => [] };
        if (request === './document') return documentStub;
        if (request === './oplog') {
            return {
                async add(entry: any) {
                    oplogCalls.push(structuredClone(entry));
                },
            };
        }
        if (request === '../error') {
            return new Proxy(
                {
                    ProblemDataActiveContainerError: StubError,
                    ValidationError: StubError,
                },
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

ProblemModel.isProblemBankAdmin = (user: any) => user.admin === true;
ProblemModel.canEditProblemContent = (user: any) => user.existingContent === true;
ProblemModel.withAuthorizedWriteClaim = async (
    domainId: string,
    pid: number,
    _user: any,
    operation: string,
    work: (claim: any) => Promise<unknown>,
    options: any,
) => {
    claimOptions = structuredClone(options);
    return work({
        domainId,
        pid,
        actor: 42,
        operation,
        requestId: 'data-claim',
        capability: 'data',
        state: 'active',
    });
};

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as StubError;
    }
}

function confirmation(operation = 'files-upload', issuedAt = Date.now()) {
    const facts = ProblemModel.activeDataWriteContainerFacts(activeContainers);
    return {
        requestId: 'confirmation-1',
        domainId: 'system',
        pid: 7,
        actor: 42,
        operation,
        containerFingerprint: ProblemModel.activeDataWriteContainerFingerprint('system', 7, facts),
        issuedAt,
    };
}

function run(user: any, activeContainerConfirmation?: any) {
    return ProblemModel.withAuthorizedDataWriteClaim(
        'system',
        7,
        { _id: 42, ...user },
        'files-upload',
        async () => {
            innerWorkCalls++;
            return 'written';
        },
        { requestId: 'request-1', activeContainerConfirmation },
    );
}

beforeEach(() => {
    activeContainers = [];
    containerQueries.length = 0;
    oplogCalls.length = 0;
    innerWorkCalls = 0;
    claimOptions = null;
});

describe('P2.24 active contest data-write guard', () => {
    it('excludes homework and selects only currently active contest or exam containers', async () => {
        const now = new Date('2026-07-18T03:00:00.000Z');
        await ProblemModel.listActiveDataWriteContainers('system', 7, now);

        expect(containerQueries).to.deep.equal([
            {
                domainId: 'system',
                docType: 30,
                query: {
                    pids: 7,
                    rule: { $ne: 'homework' },
                    beginAt: { $lte: now },
                    endAt: { $gt: now },
                },
            },
        ]);
    });

    it('blocks an ordinary data contributor and returns the exact active-container facts', async () => {
        activeContainers = [
            {
                docId: 'contest-1',
                title: '期中考试',
                rule: 'exam',
                beginAt: new Date('2026-07-18T01:00:00.000Z'),
                endAt: new Date('2026-07-18T05:00:00.000Z'),
            },
        ];

        const error = await captureFailure(() => run({ admin: false }));

        expect(error).to.be.instanceOf(StubError);
        expect(error?.params[0]).to.equal(7);
        expect(error?.params[1]).to.equal('期中考试');
        expect(error?.params[2]).to.deep.equal([
            {
                id: 'contest-1',
                title: '期中考试',
                rule: 'exam',
                beginAt: activeContainers[0].beginAt,
                endAt: activeContainers[0].endAt,
            },
        ]);
        expect(innerWorkCalls).to.equal(0);
        expect(oplogCalls).to.deep.equal([]);
        expect(claimOptions).to.deep.equal({ requestId: 'request-1', capability: 'data' });
    });

    it('requires an explicit administrator confirmation and audits the confirmed override', async () => {
        activeContainers = [{ docId: 'contest-1', title: '现场赛', rule: 'acm' }];
        expect(await captureFailure(() => run({ admin: true }))).to.be.instanceOf(StubError);
        expect(innerWorkCalls).to.equal(0);
        expect(oplogCalls).to.deep.equal([]);

        const confirmed = confirmation();
        expect(await run({ admin: true }, confirmed)).to.equal('written');
        expect(innerWorkCalls).to.equal(1);
        expect(oplogCalls).to.have.length(1);
        expect(oplogCalls[0]).to.deep.include({
            type: 'problem.data.active-container-override',
            domainId: 'system',
            operator: 42,
            problemId: 7,
            operation: 'files-upload',
            requestId: 'data-claim',
            confirmationRequestId: 'confirmation-1',
            containerFingerprint: confirmed.containerFingerprint,
            containerIds: ['contest-1'],
            result: 'confirmed',
        });
    });

    it('preserves active-container writes for existing owners, authors, and maintainers', async () => {
        activeContainers = [{ docId: 'contest-1', title: '现场赛', rule: 'acm' }];

        expect(await run({ admin: false, existingContent: true })).to.equal('written');
        expect(innerWorkCalls).to.equal(1);
        expect(oplogCalls).to.deep.equal([]);
    });

    it('rejects a stale or cross-container administrator confirmation', async () => {
        activeContainers = [{ docId: 'contest-1', title: '现场赛', rule: 'acm' }];
        const staleFacts = confirmation();
        activeContainers = [{ docId: 'contest-2', title: '补赛', rule: 'acm' }];

        expect(await captureFailure(() => run({ admin: true }, staleFacts))).to.be.instanceOf(StubError);
        expect(innerWorkCalls).to.equal(0);
        expect(oplogCalls).to.deep.equal([]);

        const expired = confirmation('files-upload', Date.now() - ProblemModel.PROBLEM_DATA_WRITE_CONFIRMATION_TTL_MS - 1);
        expect(await captureFailure(() => run({ admin: true }, expired))).to.be.instanceOf(StubError);
        expect(innerWorkCalls).to.equal(0);
        expect(oplogCalls).to.deep.equal([]);
    });

    it('writes normally when no contest or exam is active', async () => {
        expect(await run({ admin: false })).to.equal('written');
        expect(innerWorkCalls).to.equal(1);
        expect(oplogCalls).to.deep.equal([]);
    });
});
