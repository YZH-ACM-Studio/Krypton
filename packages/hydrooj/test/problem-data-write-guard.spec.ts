import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };

let activeContainers: any[] = [];
let referenceWrappers: any[] = [];
const activeContainersByTarget = new Map<string, any[]>();
const containerQueries: any[] = [];
const wrapperQueries: any[] = [];
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
        find(query: any) {
            wrapperQueries.push(structuredClone(query));
            return {
                async toArray() {
                    return structuredClone(referenceWrappers);
                },
            };
        },
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
                const rows = activeContainersByTarget.get(`${domainId}/${query.pids}`) || activeContainers;
                return structuredClone(rows.map((row) => ({ domainId, ...row })));
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
ProblemModel.canAuthorProblem = (user: any) => user.existingAuthor === true;
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

async function captureFailure(task: () => Promise<unknown>) {
    try {
        await task();
        return null;
    } catch (error) {
        return error as StubError;
    }
}

function confirmation(operation = 'files-upload', issuedAt = Date.now()) {
    const facts = ProblemModel.activeDataWriteContainerFacts(activeContainers.map((item) => ({ domainId: item.domainId || 'system', ...item })));
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

function runStatement(user: any, activeContainerConfirmation?: any) {
    return ProblemModel.assertActiveContainerWriteAllowed(
        { domainId: 'system', docId: 7 },
        { _id: 42, ...user },
        'statement-edit',
        'statement-claim',
        activeContainerConfirmation,
        'statement',
    );
}

beforeEach(() => {
    activeContainers = [];
    referenceWrappers = [];
    activeContainersByTarget.clear();
    containerQueries.length = 0;
    wrapperQueries.length = 0;
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
        expect(wrapperQueries).to.deep.equal([
            {
                docType: 10,
                'reference.domainId': 'system',
                'reference.pid': 7,
            },
        ]);
    });

    it('includes active containers that reference a wrapper around the edited source problem', async () => {
        referenceWrappers = [{ domainId: 'contest-domain', docId: 70 }];
        activeContainersByTarget.set('system/7', []);
        activeContainersByTarget.set('contest-domain/70', [
            {
                domainId: 'contest-domain',
                docId: 'contest-2',
                title: '跨域考试',
                rule: 'exam',
            },
        ]);

        const containers = await ProblemModel.listActiveDataWriteContainers('system', 7);
        const facts = ProblemModel.activeDataWriteContainerFacts(containers);

        expect(containerQueries.map((query) => [query.domainId, query.query.pids])).to.deep.equal([
            ['system', 7],
            ['contest-domain', 70],
        ]);
        expect(facts).to.deep.equal([
            {
                domainId: 'contest-domain',
                id: 'contest-2',
                title: '跨域考试',
                rule: 'exam',
                beginAt: undefined,
                endAt: undefined,
            },
        ]);
        const error = await captureFailure(() => run({ admin: false }));
        expect(error).to.be.instanceOf(StubError);
        expect(error?.params[1]).to.equal('跨域考试');
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
                domainId: 'system',
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
        expect(await run({ admin: false, existingAuthor: true })).to.equal('written');
        expect(innerWorkCalls).to.equal(2);
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

    it('blocks every non-admin statement edit while a contest is active, including maintainers', async () => {
        activeContainers = [{ docId: 'contest-1', title: '现场赛', rule: 'acm' }];

        expect(await captureFailure(() => runStatement({ admin: false, existingContent: true }))).to.be.instanceOf(StubError);
        expect(oplogCalls).to.deep.equal([]);
    });

    it('requires and audits an exact administrator confirmation for an active-contest statement correction', async () => {
        activeContainers = [{ docId: 'contest-1', title: '现场赛', rule: 'acm' }];
        expect(await captureFailure(() => runStatement({ admin: true }))).to.be.instanceOf(StubError);

        const confirmed = confirmation('statement-edit');
        await runStatement({ admin: true }, confirmed);
        expect(oplogCalls).to.have.length(1);
        expect(oplogCalls[0]).to.deep.include({
            type: 'problem.statement.active-container-override',
            operation: 'statement-edit',
            requestId: 'statement-claim',
            confirmationRequestId: 'confirmation-1',
            result: 'confirmed',
        });
    });
});
