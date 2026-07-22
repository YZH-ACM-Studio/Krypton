import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const Module = require('module');
const handlerPath = require.resolve('../src/handler/import.ts');
const originalLoad = Module._load;
const PERM = { PERM_CREATE_PROBLEM: 1n };
const PRIV = { PRIV_EDIT_SYSTEM: 1, PRIV_USER_PROFILE: 2 };

class TestPermissionError extends Error {}
class TestValidationError extends Error {}
class HandlerStub {}

let canImport = false;
let canAssignAuthor = false;
let listCalls = 0;
let importFailure: Error | null = null;
const importCalls: any[][] = [];
const messages: any[][] = [];

const problemStub = {
    canImportProblems: () => canImport,
    canAssignManagedAuthor: () => canAssignAuthor,
    async listKnowledgeMapsForProblemSelection() {
        listCalls++;
        return [{ id: 'map-1', title: '算法' }];
    },
    async import(...args: any[]) {
        importCalls.push(args);
        if (importFailure) throw importFailure;
        return { imported: 1 };
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename !== handlerPath) return originalLoad.call(this, request, parent, isMain);
    if (request === '@hydrooj/utils') return { sleep: () => new Promise((resolve) => setTimeout(resolve, 10)) };
    if (request === '../context') return { Context: class {} };
    if (request === '../error') return { PermissionError: TestPermissionError, ValidationError: TestValidationError };
    if (request === '../model/builtin') return { PERM, PRIV };
    if (request === '../model/message') {
        return {
            __esModule: true,
            default: {
                send: async (...args: any[]) => {
                    messages.push(args);
                },
            },
        };
    }
    if (request === '../model/problem') return { __esModule: true, default: problemStub };
    if (request === '../service/server') {
        return {
            Handler: HandlerStub,
            param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
            Types: new Proxy({}, { get: () => () => ({}) }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let ProblemImportHydroHandler: any;
let apply: (ctx: any) => Promise<void>;
try {
    delete require.cache[handlerPath];
    ({ ProblemImportHydroHandler, apply } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function makeHandler() {
    return Object.assign(new ProblemImportHydroHandler(), {
        user: { _id: 42 },
        response: { body: {} },
        request: { body: {}, files: {} },
        progress: () => undefined,
        url: (name: string, args: unknown) => ({ name, args }),
    }) as any;
}

async function captureFailure(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error;
    }
}

beforeEach(() => {
    canImport = false;
    canAssignAuthor = false;
    listCalls = 0;
    importFailure = null;
    importCalls.length = 0;
    messages.length = 0;
});

describe('P2.30 problem import capability boundary', () => {
    it('rejects direct GET and POST before reading import inputs', async () => {
        const handler = makeHandler();

        expect(await captureFailure(() => handler.get())).to.be.instanceOf(TestPermissionError);
        expect(await captureFailure(() => handler.post('system', false))).to.be.instanceOf(TestPermissionError);
        expect(listCalls).to.equal(0);
    });

    it('serves the import page only after the canonical capability accepts the user', async () => {
        canImport = true;
        const handler = makeHandler();

        await handler.get();

        expect(handler.response.template).to.equal('problem_import.html');
        expect(handler.response.body.knowledgeMaps).to.deep.equal([{ id: 'map-1', title: '算法' }]);
        expect(handler.response.body.canKeepOriginalAuthor).to.equal(false);
        expect(listCalls).to.equal(1);
    });

    it('passes the authenticated actor into the canonical managed importer', async () => {
        canImport = true;
        const handler = makeHandler();
        handler.request.files.file = { filepath: '/tmp/problem.zip' };
        handler.request.body = { knowledgeMapId: 'map-1' };

        await handler.post('system', false, 'map-1');

        expect(importCalls).to.have.lengthOf(1);
        expect(importCalls[0][0]).to.equal('system');
        expect(importCalls[0][1]).to.equal('/tmp/problem.zip');
        expect(importCalls[0][2]).to.deep.include({
            actorUser: handler.user,
            keepOriginalAuthor: false,
            delSource: true,
            knowledgeMapId: 'map-1',
        });
    });

    it('rejects stale import controls and delegated ownership without administrator authority', async () => {
        canImport = true;
        const handler = makeHandler();
        handler.request.files.file = { filepath: '/tmp/problem.zip' };
        handler.request.body = { knowledgeMapId: 'map-1', preferredPrefix: 'P' };

        expect(await captureFailure(() => handler.post('system', false, 'map-1'))).to.be.instanceOf(TestValidationError);
        expect(importCalls).to.deep.equal([]);

        handler.request.body = { knowledgeMapId: 'map-1', keepUser: true };
        expect(await captureFailure(() => handler.post('system', true, 'map-1'))).to.be.instanceOf(TestPermissionError);
        expect(importCalls).to.deep.equal([]);
    });

    it('notifies the operator and still propagates an early importer failure', async () => {
        canImport = true;
        importFailure = new Error('fixture import failed');
        const handler = makeHandler();
        handler.request.files.file = { filepath: '/tmp/problem.zip' };
        handler.request.body = { knowledgeMapId: 'map-1' };

        const failure = await captureFailure(() => handler.post('system', false, 'map-1'));

        expect(failure).to.equal(importFailure);
        expect(messages).to.have.lengthOf(1);
        expect(messages[0][2]).to.include('fixture import failed');
    });

    it('keeps the route signed-in and delegates import authorization to the handler capability', async () => {
        const routes: any[][] = [];
        await apply({
            Route: (...args: any[]) => routes.push(args),
            injectUI: () => undefined,
        });

        expect(routes).to.have.lengthOf(1);
        expect(routes[0].slice(0, 2)).to.deep.equal(['problem_import_hydro', '/problem/import/hydro']);
        expect(routes[0][3]).to.equal(PRIV.PRIV_USER_PROFILE);
    });
});
