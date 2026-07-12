import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

// Import the framework directly: importing `hydrooj` boots model singletons and
// requires an initialized database, which is deliberately outside this focused
// handler/dispatch test.
const framework = require('../../../framework/framework');
const Module = require('module');
const requireFromFramework = createRequire(require.resolve('../../../framework/framework/package.json'));
const { ObjectId } = requireFromFramework('mongodb');

const PRIV_EDIT_SYSTEM = 1;
const PERM_RANKBOARD_IMPORT = 2n;
const PERM_RANKBOARD_MANAGE = 4n;

class PermissionError extends framework.ForbiddenError {
    name = 'PermissionError';
}
class PrivilegeError extends framework.ForbiddenError {
    name = 'PrivilegeError';
}

const studentDocId = new ObjectId();
const outerStudentDocId = new ObjectId();
const personId = new ObjectId();
const batchId = new ObjectId();
const createdPersonId = new ObjectId();

interface MutationCalls {
    addAwardImage: any[];
    createPerson: any[];
    deletePerson: any[];
    setConfig: any[];
    rollbackImportBatch: any[];
    importAwardsBatch: any[];
    upsertAwardType: any[];
    deleteAwardType: any[];
    updatePerson: any[];
}

const calls: MutationCalls = {
    addAwardImage: [],
    createPerson: [],
    deletePerson: [],
    setConfig: [],
    rollbackImportBatch: [],
    importAwardsBatch: [],
    upsertAwardType: [],
    deleteAwardType: [],
    updatePerson: [],
};

let config = { baseScore: 100, decayFactor: 0.5 };
const reads = {
    getConfig: 0,
    getPerson: 0,
    listAwardTypes: 0,
    listImportBatches: 0,
    listLeaderboard: 0,
};

const studentsColl = {
    async findOne(filter: any) {
        if (String(filter?._id) === String(studentDocId) && (filter.domainId === undefined || filter.domainId === 'system')) {
            return {
                _id: studentDocId,
                domainId: 'system',
                studentId: '20230001',
                realName: '测试学生',
                schoolId: new ObjectId(),
            };
        }
        if (String(filter?._id) === String(outerStudentDocId) && (filter.domainId === undefined || filter.domainId === 'owned-course')) {
            return {
                _id: outerStudentDocId,
                domainId: 'owned-course',
                studentId: '20239999',
                realName: '外域学生',
                schoolId: new ObjectId(),
            };
        }
        return null;
    },
    find() {
        return {
            limit() {
                return this;
            },
            async toArray() {
                return [];
            },
        };
    },
};

const schoolsColl = {
    find() {
        return {
            async toArray() {
                return [];
            },
        };
    },
};

const modelStub = {
    RANKBOARD_DOMAIN: 'system',
    async addAward() {
        return undefined;
    },
    async addAwardImage(...args: any[]) {
        calls.addAwardImage.push(args);
        return [];
    },
    async applyGpltStoreScores() {
        return undefined;
    },
    async buildGallery() {
        return { years: [] };
    },
    async createPerson(input: any) {
        calls.createPerson.push(input);
        return { _id: createdPersonId, studentDocId: input.studentDocId, awards: [] };
    },
    async deleteAwardType(key: string) {
        calls.deleteAwardType.push(key);
        return { ok: true };
    },
    async deletePerson(id: any) {
        calls.deletePerson.push(id);
    },
    async getConfig() {
        reads.getConfig++;
        return { ...config };
    },
    async getPerson(id: any) {
        reads.getPerson++;
        if (String(id) !== String(personId)) return null;
        return { _id: personId, studentDocId, awards: [], employmentStatus: '' };
    },
    async importAwardsBatch(rows: any[], actor: number, options: any) {
        calls.importAwardsBatch.push({ rows, actor, options });
        return {
            ok: rows.length,
            notFound: [],
            unknownType: [],
            errors: [],
            createdStudents: 0,
            batchId: String(batchId),
        };
    },
    async listAwardTypes() {
        reads.listAwardTypes++;
        return [];
    },
    async listImportBatches() {
        reads.listImportBatches++;
        return [];
    },
    async listLeaderboard() {
        reads.listLeaderboard++;
        return [];
    },
    async removeAwardAt() {
        return undefined;
    },
    async rollbackImportBatch(id: any, actor: number) {
        calls.rollbackImportBatch.push({ id, actor });
        return { pulled: 3 };
    },
    async setConfig(next: { baseScore: number; decayFactor: number }) {
        calls.setConfig.push(next);
        config = { ...next };
    },
    async updateAwardAt() {
        return undefined;
    },
    async updatePerson(id: any, patch: any) {
        calls.updatePerson.push({ id, patch });
    },
    async upsertAwardType(input: any) {
        calls.upsertAwardType.push(input);
    },
};

const hydroojStub = {
    ...framework,
    db: {
        collection(name: string) {
            if (name === 'userbind.students') return studentsColl;
            if (name === 'userbind.schools') return schoolsColl;
            throw new Error(`Unexpected collection: ${name}`);
        },
    },
    Handler: framework.Handler,
    ObjectId,
    PERM: {
        PERM_RANKBOARD_IMPORT,
        PERM_RANKBOARD_MANAGE,
    },
    PRIV: { PRIV_EDIT_SYSTEM },
    PermissionError,
    PrivilegeError,
    UserModel: {
        async getPrefixList() {
            return [];
        },
    },
};

// Load the real handler module while replacing only its process/database
// boundaries. The Handler classes, decorators, gates and response logic below
// are the production implementations.
const handlerPath = require.resolve('../src/handler.ts');
const modelPath = require.resolve('../src/model.ts');
const previousModelCache = require.cache[modelPath];
const originalLoad = Module._load;
require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: modelStub,
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === 'hydrooj') return hydroojStub;
    return originalLoad.call(this, request, parent, isMain);
};

let applyHandlers: (ctx: any) => void;
try {
    ({ applyHandlers } = require(handlerPath));
} finally {
    Module._load = originalLoad;
    if (previousModelCache) require.cache[modelPath] = previousModelCache;
    else delete require.cache[modelPath];
}

const routes = new Map<string, any>();
applyHandlers({
    Route(name: string, _routePath: string, HandlerClass: any) {
        routes.set(name, HandlerClass);
    },
});

function makeUser(kind: 'admin' | 'import' | 'manage' | 'none') {
    return {
        _id: 42,
        hasPriv(priv: number) {
            return kind === 'admin' && priv === PRIV_EDIT_SYSTEM;
        },
        hasPerm(perm: bigint) {
            if (kind === 'manage') return perm === PERM_RANKBOARD_MANAGE;
            if (kind === 'import') return perm === PERM_RANKBOARD_IMPORT;
            return false;
        },
    };
}

function urlFor(name: string, args: Record<string, string> = {}) {
    if (name === 'admin_rankboard') return '/admin/rankboard';
    if (name === 'admin_rankboard_awards') return '/admin/rankboard/awards';
    if (name === 'admin_rankboard_person') return `/admin/rankboard/people/${args.id}`;
    return `/${name}`;
}

async function dispatchClass(
    HandlerClass: any,
    body: Record<string, any>,
    user = makeUser('admin'),
    routeArgs: Record<string, any> = {},
    method: 'GET' | 'POST' = 'POST',
    query: Record<string, any> = {},
    authoritativeDomainId = 'system',
) {
    const request = {
        method: method.toLowerCase(),
        host: 'example.test',
        hostname: 'example.test',
        ip: '127.0.0.1',
        headers: {},
        cookies: {},
        body,
        files: {},
        query,
        querystring: '',
        path: '/test',
        originalPath: '/test',
        params: routeArgs,
        referer: '',
        json: false,
        websocket: false,
    };
    const response = {
        body: undefined as any,
        type: '',
        status: 200,
        template: undefined as string | undefined,
        redirect: undefined as string | undefined,
        attachment() {},
        addHeader() {},
    };
    const args = { domainId: 'system', ...routeArgs, ...(method === 'GET' ? query : body) };
    const koaContext: any = {
        method,
        params: routeArgs,
        request,
        session: {},
        holdFiles: [],
        HydroContext: {
            args,
            request,
            response,
            UiContext: {},
        },
    };
    const service: any = {
        activeHandlers: new Map(),
        ctx: {
            async parallel(event: string, handler: any) {
                if (event === 'handler/create') {
                    handler.user = user;
                    handler.domain = { _id: authoritativeDomainId };
                    handler.url = urlFor;
                    // Keep expected 403/405 paths quiet while preserving the
                    // framework's status/error contract.
                    handler.onerror = async (error: any) => {
                        response.status = error.code || 500;
                        response.body = { error: { name: error.name, params: error.params } };
                    };
                }
            },
            async serial() {
                return undefined;
            },
        },
    };
    const savedContext = {
        plugin() {
            return {
                ctx: { server: { renderers: {} } },
                async dispose() {
                    return undefined;
                },
            };
        },
    };
    await (framework.WebService.prototype as any).handleHttp.call(service, koaContext, HandlerClass, () => {}, savedContext);
    return response;
}

async function dispatchGet(
    routeName: string,
    user = makeUser('admin'),
    query: Record<string, any> = {},
    routeArgs: Record<string, any> = {},
    authoritativeDomainId = 'system',
) {
    const HandlerClass = routes.get(routeName);
    expect(HandlerClass, `missing route ${routeName}`).to.be.a('function');
    return dispatchClass(HandlerClass, {}, user, routeArgs, 'GET', query, authoritativeDomainId);
}

async function dispatch(
    routeName: string,
    body: Record<string, any>,
    user = makeUser('admin'),
    routeArgs: Record<string, any> = {},
    authoritativeDomainId = 'system',
) {
    const HandlerClass = routes.get(routeName);
    expect(HandlerClass, `missing route ${routeName}`).to.be.a('function');
    return dispatchClass(HandlerClass, body, user, routeArgs, 'POST', {}, authoritativeDomainId);
}

function mutationCount() {
    return Object.values(calls).reduce((sum, entries) => sum + entries.length, 0);
}

beforeEach(() => {
    for (const entries of Object.values(calls)) entries.length = 0;
    for (const key of Object.keys(reads) as Array<keyof typeof reads>) reads[key] = 0;
    config = { baseScore: 100, decayFactor: 0.5 };
});

describe('framework operation dispatch contract', () => {
    it('rejects an operation when a handler only declares generic post()', async () => {
        let genericWrites = 0;
        class GenericOnlyHandler extends framework.Handler {
            async post() {
                genericWrites++;
            }
        }

        const response = await dispatchClass(GenericOnlyHandler, { operation: 'add' });

        expect(response.status).to.equal(405);
        expect(response.body.error.name).to.equal('InvalidOperationError');
        expect(genericWrites).to.equal(0);
    });

    it('dispatches an operation to postX exactly once when generic post is absent', async () => {
        let operationWrites = 0;
        class NativeOperationHandler extends framework.Handler {
            async postAdd() {
                operationWrites++;
            }
        }

        const response = await dispatchClass(NativeOperationHandler, { operation: 'add' });

        expect(response.status).to.equal(200);
        expect(operationWrites).to.equal(1);
    });
});

describe('rankboard handler operation contract', () => {
    it('declares only framework-native operation methods', () => {
        const list = routes.get('admin_rankboard').prototype;
        const awards = routes.get('admin_rankboard_awards').prototype;
        const person = routes.get('admin_rankboard_person').prototype;

        for (const name of ['postAdd', 'postDelete', 'postConfig', 'postRollbackBatch', 'postBatch']) {
            expect(list[name], name).to.be.a('function');
        }
        for (const name of ['postUpsert', 'postDelete']) expect(awards[name], name).to.be.a('function');
        expect(person.postSave).to.be.a('function');
        expect(Object.hasOwn(list, 'post')).to.equal(false);
        expect(Object.hasOwn(awards, 'post')).to.equal(false);
        expect(Object.hasOwn(person, 'post')).to.equal(false);
        expect(Object.hasOwn(person, 'postUpload')).to.equal(false);
    });

    it('postAdd creates one person and redirects to the editor', async () => {
        const response = await dispatch(
            'admin_rankboard',
            {
                operation: 'add',
                studentDocId: String(studentDocId),
            },
            makeUser('import'),
        );

        expect(response.status).to.equal(200);
        expect(calls.createPerson).to.have.lengthOf(1);
        expect(String(calls.createPerson[0].studentDocId)).to.equal(String(studentDocId));
        expect(response.redirect).to.equal(`/admin/rankboard/people/${createdPersonId}`);
    });

    it('postAdd does not reveal or create a person for an outer-domain student id', async () => {
        const response = await dispatch(
            'admin_rankboard',
            {
                operation: 'add',
                studentDocId: String(outerStudentDocId),
            },
            makeUser('import'),
        );

        expect(response.status).to.equal(404);
        expect(response.body.error.name).to.equal('NotFoundError');
        expect(calls.createPerson).to.have.lengthOf(0);
    });

    it('postDelete removes one person and redirects to the list', async () => {
        const response = await dispatch(
            'admin_rankboard',
            {
                operation: 'delete',
                personId: String(personId),
            },
            makeUser('manage'),
        );

        expect(response.status).to.equal(200);
        expect(calls.deletePerson).to.have.lengthOf(1);
        expect(String(calls.deletePerson[0])).to.equal(String(personId));
        expect(response.redirect).to.equal('/admin/rankboard?section=people');
    });

    it('postConfig persists one merged config and redirects', async () => {
        const response = await dispatch(
            'admin_rankboard',
            {
                operation: 'config',
                baseScore: '125',
                decayFactor: '0.8',
            },
            makeUser('manage'),
        );

        expect(response.status).to.equal(200);
        expect(calls.setConfig).to.deep.equal([{ baseScore: 125, decayFactor: 0.8 }]);
        expect(response.redirect).to.equal('/admin/rankboard?section=settings');
    });

    it('postRollbackBatch rolls one batch back and reports its write count', async () => {
        const response = await dispatch(
            'admin_rankboard',
            {
                operation: 'rollbackBatch',
                batchId: String(batchId),
            },
            makeUser('import'),
        );

        expect(response.status).to.equal(200);
        expect(calls.rollbackImportBatch).to.have.lengthOf(1);
        expect(String(calls.rollbackImportBatch[0].id)).to.equal(String(batchId));
        expect(response.body).to.deep.equal({ rolledBack: 3 });
        expect(response.redirect).to.equal('/admin/rankboard?section=import');
    });

    it('postBatch parses TSV once and returns refreshed page data', async () => {
        const response = await dispatch(
            'admin_rankboard',
            {
                operation: 'batch',
                batchTsv: '20230001\ticpc_gold\tICPC 北京站\t2026-04\t12\t1\t队名\t队友甲,队友乙',
            },
            makeUser('import'),
        );

        expect(response.status).to.equal(200);
        expect(calls.importAwardsBatch).to.have.lengthOf(1);
        expect(calls.importAwardsBatch[0].rows).to.deep.equal([
            {
                studentId: '20230001',
                type: 'icpc_gold',
                contest: 'ICPC 北京站',
                date: '2026-04',
                liveRank: 12,
                schoolRank: 1,
                team: '队名',
                teammates: ['队友甲', '队友乙'],
                realName: undefined,
            },
        ]);
        expect(response.template).to.equal('admin_rankboard.html');
        expect(response.body.section).to.equal('import');
        expect(response.body.report.ok).to.equal(1);
    });

    it('postUpsert writes one complete award type and redirects', async () => {
        const response = await dispatch(
            'admin_rankboard_awards',
            {
                operation: 'upsert',
                key: 'custom_award',
                name: '自定义奖项',
                weight: '1.5',
                useRankDecay: 'true',
                order: '20',
                hidden: 'true',
            },
            makeUser('manage'),
        );

        expect(response.status).to.equal(200);
        expect(calls.upsertAwardType).to.deep.equal([
            {
                key: 'custom_award',
                name: '自定义奖项',
                weight: 1.5,
                useRankDecay: true,
                order: 20,
                hidden: true,
            },
        ]);
        expect(response.redirect).to.equal('/admin/rankboard/awards');
    });

    it('award-type postDelete deletes one key and redirects', async () => {
        const response = await dispatch(
            'admin_rankboard_awards',
            {
                operation: 'delete',
                key: 'custom_award',
            },
            makeUser('manage'),
        );

        expect(response.status).to.equal(200);
        expect(calls.deleteAwardType).to.deep.equal(['custom_award']);
        expect(response.redirect).to.equal('/admin/rankboard/awards');
    });

    it('postSave restores ObjectId fields, writes once and redirects', async () => {
        const response = await dispatch(
            'admin_rankboard_person',
            {
                operation: 'save',
                awards: JSON.stringify([{ type: 'icpc_gold', importBatchId: String(batchId) }]),
                employmentStatus: '测试去向',
            },
            makeUser('import'),
            { id: String(personId) },
        );

        expect(response.status).to.equal(200);
        expect(calls.updatePerson).to.have.lengthOf(1);
        expect(String(calls.updatePerson[0].id)).to.equal(String(personId));
        expect(calls.updatePerson[0].patch.employmentStatus).to.equal('测试去向');
        expect(calls.updatePerson[0].patch.awards[0].importBatchId).to.be.instanceOf(ObjectId);
        expect(response.redirect).to.equal(`/admin/rankboard/people/${personId}`);
    });

    const unauthorizedCases: Array<[string, string, Record<string, any>, Record<string, any>]> = [
        ['add', 'admin_rankboard', { operation: 'add', studentDocId: String(studentDocId) }, {}],
        ['delete person', 'admin_rankboard', { operation: 'delete', personId: String(personId) }, {}],
        ['config', 'admin_rankboard', { operation: 'config', baseScore: '120' }, {}],
        ['rollbackBatch', 'admin_rankboard', { operation: 'rollbackBatch', batchId: String(batchId) }, {}],
        ['batch', 'admin_rankboard', { operation: 'batch', batchTsv: '20230001\ticpc_gold' }, {}],
        [
            'upsert award type',
            'admin_rankboard_awards',
            {
                operation: 'upsert',
                key: 'x',
                name: 'X',
                weight: '1',
            },
            {},
        ],
        ['delete award type', 'admin_rankboard_awards', { operation: 'delete', key: 'x' }, {}],
        ['save', 'admin_rankboard_person', { operation: 'save', awards: '[]' }, { id: String(personId) }],
    ];

    for (const [label, routeName, body, routeArgs] of unauthorizedCases) {
        it(`rejects ${label} before any mutation when the user cannot enter admin`, async () => {
            const response = await dispatch(routeName, body, makeUser('none'), routeArgs);

            expect(response.status).to.equal(403);
            expect(mutationCount()).to.equal(0);
        });
    }

    for (const [label, routeName, body] of [
        ['delete person', 'admin_rankboard', { operation: 'delete', personId: String(personId) }],
        ['config', 'admin_rankboard', { operation: 'config', baseScore: '120' }],
        [
            'upsert award type',
            'admin_rankboard_awards',
            {
                operation: 'upsert',
                key: 'x',
                name: 'X',
                weight: '1',
            },
        ],
        ['delete award type', 'admin_rankboard_awards', { operation: 'delete', key: 'x' }],
    ] as Array<[string, string, Record<string, any>]>) {
        it(`keeps ${label} behind the structural MANAGE gate`, async () => {
            const response = await dispatch(routeName, body, makeUser('import'));

            expect(response.status).to.equal(403);
            expect(mutationCount()).to.equal(0);
        });
    }

    it('returns 405 for an unknown operation', async () => {
        const response = await dispatch('admin_rankboard', { operation: 'unknown' });

        expect(response.status).to.equal(405);
        expect(response.body.error.name).to.equal('InvalidOperationError');
        expect(mutationCount()).to.equal(0);
    });

    it('returns 405 for the removed pseudo upload operation', async () => {
        const response = await dispatch(
            'admin_rankboard_person',
            {
                operation: 'upload',
            },
            makeUser('admin'),
            { id: String(personId) },
        );

        expect(response.status).to.equal(405);
        expect(response.body.error.name).to.equal('InvalidOperationError');
        expect(mutationCount()).to.equal(0);
    });
});

describe('rankboard management GET capability and section contract', () => {
    it('defaults IMPORT users to people and returns fail-closed capabilities', async () => {
        const response = await dispatchGet('admin_rankboard', makeUser('import'));

        expect(response.status).to.equal(200);
        expect(response.template).to.equal('admin_rankboard.html');
        expect(response.body.section).to.equal('people');
        expect(response.body.canImport).to.equal(true);
        expect(response.body.canManage).to.equal(false);
        expect(reads.listLeaderboard).to.equal(1);
    });

    it('renders the import section for IMPORT users with its supporting data', async () => {
        const response = await dispatchGet('admin_rankboard', makeUser('import'), { section: 'import' });

        expect(response.status).to.equal(200);
        expect(response.body.section).to.equal('import');
        expect(response.body.canImport).to.equal(true);
        expect(response.body.canManage).to.equal(false);
        expect(reads.listImportBatches).to.equal(1);
    });

    it('keeps settings GET behind MANAGE before loading its config', async () => {
        const response = await dispatchGet('admin_rankboard', makeUser('import'), { section: 'settings' });

        expect(response.status).to.equal(403);
        expect(reads.getConfig).to.equal(0);
    });

    it('lets MANAGE users open settings and treats MANAGE as implying IMPORT', async () => {
        const response = await dispatchGet('admin_rankboard', makeUser('manage'), { section: 'settings' });

        expect(response.status).to.equal(200);
        expect(response.body.section).to.equal('settings');
        expect(response.body.canImport).to.equal(true);
        expect(response.body.canManage).to.equal(true);
        expect(response.body.config).to.deep.equal({ baseScore: 100, decayFactor: 0.5 });
    });

    it('rejects unknown sections instead of silently choosing a view', async () => {
        const response = await dispatchGet('admin_rankboard', makeUser('manage'), { section: 'unknown' });

        expect(response.status).to.equal(400);
        expect(reads.listLeaderboard + reads.listImportBatches + reads.getConfig).to.equal(0);
    });

    it('uses the authoritative request domain and rejects injected system args', async () => {
        const domainOwner = { _id: 42, hasPriv: () => false, hasPerm: () => true };
        const getResponse = await dispatchGet('admin_rankboard', domainOwner, { domainId: 'system' }, {}, 'owned-course');
        expect(getResponse.status).to.equal(403);
        expect(reads.listLeaderboard + reads.listImportBatches + reads.getConfig).to.equal(0);

        const postResponse = await dispatch(
            'admin_rankboard',
            {
                operation: 'add',
                studentDocId: String(studentDocId),
                domainId: 'system',
            },
            domainOwner,
            {},
            'owned-course',
        );
        expect(postResponse.status).to.equal(403);
        expect(mutationCount()).to.equal(0);
        expect(reads.listLeaderboard + reads.listImportBatches + reads.getConfig).to.equal(0);
    });

    it('does not let forged non-system args revoke a real system-domain capability', async () => {
        const response = await dispatchGet('admin_rankboard', makeUser('import'), { domainId: 'owned-course' }, {}, 'system');

        expect(response.status).to.equal(200);
        expect(response.body.section).to.equal('people');
        expect(response.body.canImport).to.equal(true);
    });

    it('keeps award-type GET behind MANAGE before loading types', async () => {
        const denied = await dispatchGet('admin_rankboard_awards', makeUser('import'));
        expect(denied.status).to.equal(403);
        expect(reads.listAwardTypes).to.equal(0);

        const allowed = await dispatchGet('admin_rankboard_awards', makeUser('manage'));
        expect(allowed.status).to.equal(200);
        expect(allowed.body.canImport).to.equal(true);
        expect(allowed.body.canManage).to.equal(true);
        expect(reads.listAwardTypes).to.equal(1);
    });

    it('returns capabilities on person GET and keeps the people context', async () => {
        const response = await dispatchGet('admin_rankboard_person', makeUser('import'), {}, { id: String(personId), domainId: 'system' });

        expect(response.status).to.equal(200);
        expect(response.body.canImport).to.equal(true);
        expect(response.body.canManage).to.equal(false);
        expect(response.body.person._id).to.equal(String(personId));
    });
});

describe('rankboard gallery upload authoritative-domain contract', () => {
    const domainOwner = { _id: 42, hasPriv: () => false, hasPerm: () => true };

    it('rejects an outer-domain owner even when GET and POST args forge system', async () => {
        const getResponse = await dispatchGet('rankboard_gallery', domainOwner, { domainId: 'system' }, {}, 'owned-course');
        expect(getResponse.status).to.equal(200);
        expect(getResponse.body.canUpload).to.equal(false);

        const postResponse = await dispatch(
            'rankboard_gallery',
            {
                operation: 'addImage',
                personId: String(personId),
                awardIndex: '0',
                url: '/file/42/award.jpg',
                domainId: 'system',
            },
            domainOwner,
            {},
            'owned-course',
        );
        expect(postResponse.status).to.equal(403);
        expect(calls.addAwardImage).to.have.lengthOf(0);
    });

    it('keeps a real system-domain IMPORT capability despite forged outer-domain args', async () => {
        const getResponse = await dispatchGet('rankboard_gallery', makeUser('import'), { domainId: 'owned-course' }, {}, 'system');
        expect(getResponse.status).to.equal(200);
        expect(getResponse.body.canUpload).to.equal(true);

        const postResponse = await dispatch(
            'rankboard_gallery',
            {
                operation: 'addImage',
                personId: String(personId),
                awardIndex: '0',
                url: '/file/42/award.jpg',
                domainId: 'owned-course',
            },
            makeUser('import'),
            {},
            'system',
        );
        expect(postResponse.status).to.equal(200);
        expect(calls.addAwardImage).to.have.lengthOf(1);
    });
});

describe('award type editor form contract', () => {
    it('submits the immutable key through a hidden field when editing', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../ui-next/src/pages/rankboard/admin.tsx'), 'utf8');

        expect(source).to.include('<input type="hidden" name="key" value={key} />');
    });
});
