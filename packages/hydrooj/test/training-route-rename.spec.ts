import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';

const Module = require('module');
(global as any).Hydro ||= { model: {}, module: {}, ui: {} };

class TestValidationError extends Error {
    name = 'ValidationError';
}

const originalLoad = Module._load;
const routes: Record<string, { path: string; Handler: any }> = {};
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const fromHandler = parent?.filename?.includes('/packages/hydrooj/src/handler/training.ts');
    if (fromHandler && request === '../error') {
        return {
            localizeErrorParameter: (_error: unknown) => _error,
            localizedErrorText: (strings: TemplateStringsArray) => strings[0],
            FileLimitExceededError: Error,
            FileUploadError: Error,
            NotFoundError: Error,
            ValidationError: TestValidationError,
        };
    }
    if (fromHandler && request === '../model/builtin') return { PERM: { PERM_VIEW_TRAINING: 1n }, PRIV: {}, STATUS: {} };
    if (fromHandler && request === '../model/contextual-completion') return { contextualCompletionService: {} };
    if (fromHandler && request === '../model/document') return { TYPE_PROBLEM: 10 };
    if (fromHandler && request === '../model/oplog') {
        return {
            async log() {
                return undefined;
            },
        };
    }
    if (fromHandler && request === '../model/practice-integrity') return { practiceIntegrityService: {} };
    if (fromHandler && request === '../model/problem') {
        return {
            assertProblemAclDomain() {
                return undefined;
            },
        };
    }
    if (fromHandler && request === '../model/problem-access') return { assertProblemBankSelection: async () => undefined };
    if (fromHandler && request === '../model/storage') return { put() {}, getMeta() {}, del() {}, signDownloadLink() {} };
    if (fromHandler && request === '../model/system') return { get: () => 1 };
    if (fromHandler && request === '../model/problem-set-access') {
        return {
            canManageProblemSet() {
                return false;
            },
            problemSetAccessService: {
                async evaluateMany() {
                    return new Map();
                },
                async assertAccessible() {
                    return { accessible: true, stageAccess: 'all' };
                },
                stageIsAccessible() {
                    return true;
                },
                async assertStageEnterable() {
                    return { accessible: true, stageAccess: 'all' };
                },
            },
        };
    }
    if (fromHandler && request === '../model/training') return { get() {}, getMulti() {}, getPids: () => [] };
    if (fromHandler && request === '../model/user') return {};
    if (fromHandler && request === './problem-reference') {
        return { getVisibleReferencedProblems: async () => ({}), normalizeProblemDocIds: (pids: unknown) => pids };
    }
    if (fromHandler && request === '../lib/training-kind') {
        return originalLoad.call(this, request, parent, isMain);
    }
    if (fromHandler && request === '../lib/problem-set-audience') return { problemSetAudienceOf: () => [] };
    if (fromHandler && request === '../lib/practice-roster-load') return { loadCompletedPidsByUid: async () => [] };
    if (fromHandler && request === '../lib/practice-roster') {
        return {
            assemblePracticeRosterMembers: () => [],
            PRACTICE_ROSTER_ENROLL_LIMIT: 500,
            serializePracticeRosterProblems: () => [],
        };
    }
    if (fromHandler && request === '../service/server') {
        return {
            Handler: class Handler {
                request: any = { method: 'GET', path: '', query: {} };
                response: any = {};
                url(name: string, args: Record<string, unknown> = {}) {
                    const query = args.query && typeof args.query === 'object' ? (args.query as Record<string, string>) : {};
                    const qs = Object.keys(query).length
                        ? `?${Object.entries(query)
                              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
                              .join('&')}`
                        : '';
                    if (name === 'training_main') return `/problem-sets${qs}`;
                    if (name === 'training_create') return `/problem-sets/create${qs}`;
                    if (name === 'training_detail') return `/problem-sets/${args.tid}${qs}`;
                    if (name === 'training_edit') return `/problem-sets/${args.tid}/edit${qs}`;
                    if (name === 'training_files') return `/problem-sets/${args.tid}/file${qs}`;
                    if (name === 'training_file_download') return `/problem-sets/${args.tid}/file/${args.filename}${qs}`;
                    return `/${name}${qs}`;
                }
            },
            param: () => (_target: unknown, _key: string, desc: PropertyDescriptor) => desc,
            post: () => (_target: unknown, _key: string, desc: PropertyDescriptor) => desc,
            Types: {
                ObjectId: {},
                Filename: {},
                PositiveInt: {},
                String: {},
                Title: {},
                Content: {},
                UnsignedInt: {},
                Boolean: {},
                ArrayOf: () => ({}),
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let trainingModule: typeof import('../src/handler/training');
try {
    const trainingPath = require.resolve('../src/handler/training.ts');
    delete require.cache[trainingPath];
    trainingModule = require(trainingPath);
} finally {
    Module._load = originalLoad;
}

void trainingModule.apply({
    Route(name: string, path: string, HandlerClass: any) {
        routes[name] = { path, Handler: HandlerClass };
    },
} as any);

function makeRedirect(routeName: string, path: string, method = 'GET', query: Record<string, string> = {}) {
    const match = routes[routeName];
    if (!match) throw new Error(`missing compat route ${routeName}`);
    const handler = new match.Handler();
    handler.request = { method, path, query };
    return handler;
}

describe('P3.2 problem-set routes and training redirects', () => {
    it('registers canonical /problem-sets write routes and /training as redirects only', () => {
        expect(routes.training_main.path).to.equal('/problem-sets');
        expect(routes.training_create.path).to.equal('/problem-sets/create');
        expect(routes.training_detail.path).to.equal('/problem-sets/:tid');
        expect(routes.training_edit.path).to.equal('/problem-sets/:tid/edit');
        expect(routes.training_files.path).to.equal('/problem-sets/:tid/file');
        expect(routes.training_file_download.path).to.equal('/problem-sets/:tid/file/:filename');
        expect(routes.training_compat_main.path).to.equal('/training');
        expect(routes.training_compat_detail.path).to.equal('/training/:tid');
        expect(routes.training_compat_main.Handler).to.not.equal(routes.training_main.Handler);
    });

    it('keeps query string on 301 redirects and rejects old mutations', async () => {
        const tid = new ObjectId();
        const list = makeRedirect('training_compat_main', '/training', 'GET', { q: 'dp', page: '2' });
        await list.prepare();
        await list.get('system');
        expect(list.response.status).to.equal(301);
        expect(list.response.redirect).to.equal('/problem-sets?q=dp&page=2');

        const detail = makeRedirect('training_compat_detail', `/d/system/training/${tid}`, 'GET', { chapter: '3' });
        await detail.prepare();
        await detail.get('system', tid);
        expect(detail.response.redirect).to.equal(`/problem-sets/${tid}?chapter=3`);

        const edit = makeRedirect('training_compat_edit', `/training/${tid}/edit`);
        await edit.prepare();
        await edit.get('system', tid);
        expect(edit.response.redirect).to.equal(`/problem-sets/${tid}/edit`);

        const create = makeRedirect('training_compat_create', '/training/create');
        await create.prepare();
        await create.get('system');
        expect(create.response.redirect).to.equal('/problem-sets/create');

        const files = makeRedirect('training_compat_files', `/training/${tid}/file`);
        await files.prepare();
        await files.get('system', tid);
        expect(files.response.redirect).to.equal(`/problem-sets/${tid}/file`);

        const download = makeRedirect('training_compat_file_download', `/training/${tid}/file/a.txt`);
        await download.prepare();
        await download.get('system', tid, 'a.txt');
        expect(download.response.redirect).to.equal(`/problem-sets/${tid}/file/a.txt`);

        const lowercaseGet = makeRedirect('training_compat_detail', `/training/${tid}`, 'get');
        await lowercaseGet.prepare();
        await lowercaseGet.get('system', tid);
        expect(lowercaseGet.response.status).to.equal(301);
        expect(lowercaseGet.response.redirect).to.equal(`/problem-sets/${tid}`);

        const lowercaseHead = makeRedirect('training_compat_main', '/training', 'head');
        await lowercaseHead.prepare();

        const post = makeRedirect('training_compat_main', '/training', 'POST');
        try {
            await post.prepare();
            expect.fail('expected mutation on /training to fail closed');
        } catch (error) {
            expect(error).to.be.instanceOf(TestValidationError);
        }

        const lowercasePost = makeRedirect('training_compat_detail', `/training/${tid}`, 'post');
        try {
            await lowercasePost.prepare();
            expect.fail('expected lowercase post on /training to fail closed');
        } catch (error) {
            expect(error).to.be.instanceOf(TestValidationError);
        }
    });
});
