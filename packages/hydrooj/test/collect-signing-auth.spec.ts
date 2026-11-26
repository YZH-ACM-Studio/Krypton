import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { PERM, PRIV } from '@hydrooj/common';
import * as errors from '../src/error';

const Module = require('node:module');
const handlerPath = require.resolve('../src/handler/user');
const first = '/collect/0123456789abcdef01234567/sign';
const second = '/collect/abcdef0123456789abcdef01/sign';
interface Token { _id: string; tokenType: number; expireAt: Date; [key: string]: unknown }
const tokens = new Map<string, Token>();
let sequence = 0;
const settings = new Map<string, unknown>();
const links = new Map<string, number>();
const writes: string[] = [];
let blocked = false;
const domain = { _id: 'system', registerRedirect: '/ordinary-welcome' };

function account(uid: number, uname = 'student') {
    return {
        _id: uid,
        uname,
        tfa: false,
        authn: false,
        hasPriv: (priv: number) => priv === PRIV.PRIV_USER_PROFILE && uid > 0,
        hasPerm: () => false,
        async checkPassword(password: string) {
            if (password !== 'correct-password') throw new errors.VerifyPasswordError();
        },
    };
}
const accounts = new Map<number, ReturnType<typeof account>>();
const mailAccounts = new Map<string, number>();
const userModel = {
    getByEmail: async (_domain: string, mail: string) => accounts.get(mailAccounts.get(mail)),
    getByUname: async (_domain: string, uname: string) => [...accounts.values()].find((user) => user.uname === uname),
    getById: async (_domain: string, uid: number) => accounts.get(uid),
    async create(mail: string, uname: string) {
        const uid = 100 + accounts.size;
        accounts.set(uid, account(uid, uname));
        mailAccounts.set(mail, uid);
        writes.push('create-user');
        return uid;
    },
    async setById() { /* Profile persistence is outside this isolated authentication fixture. */ },
    async setPassword() {
        writes.push('set-password');
    },
};
const tokenModel = {
    TYPE_REGISTRATION: 2,
    TYPE_OAUTH: 4,
    TYPE_LOSTPASS: 5,
    TYPE_WEBAUTHN: 8,
    async add(tokenType: number, seconds: number, data: Record<string, unknown>) {
        const id = `token-${++sequence}`;
        const doc = { ...data, _id: id, tokenType, expireAt: new Date(Date.now() + seconds * 1000) };
        tokens.set(id, doc);
        return [id, structuredClone(doc)];
    },
    async get(id: string, type: number) {
        const doc = tokens.get(id);
        return doc?.tokenType === type ? structuredClone(doc) : null;
    },
    async update(id: string, type: number, _seconds: number, data: Record<string, unknown>) {
        const doc = tokens.get(id);
        assert.equal(doc?.tokenType, type);
        Object.assign(doc, data);
        return structuredClone(doc);
    },
    async del(id: string, type: number) {
        assert.equal(tokens.get(id)?.tokenType, type);
        tokens.delete(id);
    },
};

class HandlerStub {
    args: Record<string, unknown> = { domainId: 'system' };
    domain = domain;
    user = account(0);
    session: Record<string, unknown> = {};
    context = { HydroContext: { user: account(0) } };
    request = { referer: '/login', ip: '127.0.0.1', headers: { origin: 'https://oj.test' } };
    response = { body: {} as Record<string, unknown>, template: '', redirect: undefined as string | undefined };
    rendered: Record<string, unknown> = {};
    ctx = context;

    url(name: string, args: Record<string, unknown> = {}) {
        const routes = {
            homepage: '/',
            user_login: '/login',
            user_register: '/register',
            user_lostpass: '/lostpass',
            home_settings: '/home/preference',
            user_oauth: `/oauth/${args.type}/login`,
            user_register_with_code: `/register/${args.code}`,
            user_lostpass_with_code: `/lostpass/${args.code}`,
            collect_sign: `/collect/${args.id}/sign`,
        };
        if (!(name in routes)) throw new Error(`Unexpected route ${name}`);
        return `${args.domainId ? `/d/${args.domainId}` : ''}${routes[name as keyof typeof routes]}`;
    }

    async limitRate() { /* The fixture does not contact a rate-limit service. */ }
    checkPriv() {}
    async renderHTML(_name: string, data: Record<string, unknown>) {
        this.rendered = data;
        return Buffer.from('synthetic email');
    }
}
type RoutedHandler = HandlerStub & {
    prepare(...args: unknown[]): Promise<void>;
    get(...args: unknown[]): Promise<void>;
    post(...args: unknown[]): Promise<void>;
};
const routes = new Map<string, new () => RoutedHandler>();
interface Provider {
    canRegister?: boolean;
    get(this: HandlerStub): Promise<void>;
    callback(this: HandlerStub, args: { state: string }): Promise<{ _id: string; email: string; uname: string[] }>;
}
const providers: Record<string, Provider> = {};
const context = {
    Route(name: string, _path: string, handlerClass: new () => RoutedHandler) {
        routes.set(name, handlerClass);
    },
    oauth: {
        providers,
        provide(name: string, provider: Provider) {
            providers[name] = provider;
        },
        get: async (type: string, id: string) => links.get(`${type}:${id}`),
        async set(type: string, id: string, uid: number) {
            writes.push('oauth-link');
            links.set(`${type}:${id}`, uid);
        },
    },
    async inject(_names: string[], callback: (ctx: { api: { provide: () => void } }) => void) {
        callback({ api: { provide() {} } });
    },
};

const originalLoad = Module._load;
let apply: (ctx: typeof context) => Promise<void>;
try {
    Module._load = function load(request: string, parent: { filename?: string }, isMain: boolean) {
        if (parent?.filename === handlerPath) {
            if (request === '../service/server') {
 return {
                    Handler: HandlerStub,
                    Query: () => ({}),
                    param: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
                    post: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
                    Types: new Proxy({}, { get: () => [null, () => true] }),
                };
}
            if (request === '../error') return errors;
            if (request === '../model/builtin') return { PERM, PRIV, STATUS: {} };
            if (request === '../model/user') return { __esModule: true, default: userModel };
            if (request === '../model/token') return { __esModule: true, default: tokenModel };
            if (request === '../model/system') return { __esModule: true, default: { get: (key: string) => settings.get(key) } };
            if (request === '../model/blacklist') return { __esModule: true, default: { get: async () => false } };
            if (request === '../model/oplog') return { log: async () => undefined };
            if (request === '../lib/mail') {
 return {
                    sendMail: async () => {
                        writes.push('mail');
                    },
                };
}
            if (request.startsWith('../model/') || (request.startsWith('../lib/') && request !== '../lib/collect-signing-return')) return {};
            if (request === '../service/student-directory') return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    ({ apply } = require(handlerPath));
} finally {
    Module._load = originalLoad;
}

function handler(name: string, destination?: string) {
    const Class = routes.get(name);
    assert.ok(Class);
    const result = new Class();
    if (destination) result.args.collectSign = destination;
    return result;
}

describe('signing auth handlers', () => {
    beforeEach(async () => {
        tokens.clear();
        accounts.clear();
        mailAccounts.clear();
        links.clear();
        writes.length = 0;
        sequence = 0;
        blocked = false;
        accounts.set(11, account(11));
        mailAccounts.set('student@example.test', 11);
        settings.clear();
        settings.set('server.login', true);
        settings.set('server.url', 'https://oj.test/');
        settings.set('session.unsaved_expire_seconds', 600);
        settings.set('smtp.user', 'synthetic-sender');
        for (const key of Object.keys(providers)) delete providers[key];
        Reflect.set(globalThis, 'Hydro', {
            model: { vigilguard: { getBrowserLockoutDecision: async () => (blocked ? { contestId: 'exam' } : null) } },
        });
        await apply(context);
        providers.test = {
            canRegister: true,
            async get() {
                const [state] = await tokenModel.add(tokenModel.TYPE_OAUTH, 600, {});
                this.response.redirect = `https://provider.test/auth?state=${state}`;
            },
            async callback({ state }) {
                await tokenModel.del(state, tokenModel.TYPE_OAUTH);
                return { _id: 'linked', email: 'student@example.test', uname: ['external'] };
            },
        };
    });

    it('keeps password failures, success and parallel destinations scoped to their requests', async () => {
        const a = handler('user_login', first);
        const b = handler('user_login', second);
        await a.get();
        assert.equal(a.response.body.signingReturn, first);
        await assert.rejects(a.post('system', 'student', 'wrong'));
        assert.equal(a.session.uid, undefined);
        await b.post('system', 'student', 'correct-password');
        await a.post('system', 'student', 'correct-password', false, 'https://unrelated.test');
        assert.equal(a.response.redirect, first);
        assert.equal(b.response.redirect, second);
        const ordinary = handler('user_login');
        await ordinary.post('system', 'student', 'correct-password', false, '/ordinary');
        assert.equal(ordinary.response.redirect, '/ordinary');
        assert.equal(ordinary.response.body.signingReturn, undefined);
    });

    it('rejects invalid destinations before authentication and retains the browser lockout gate', async () => {
        const invalid = handler('user_login', '//unrelated.test');
        await assert.rejects(invalid.post('system', 'student', 'correct-password'), { name: 'ValidationError' });
        assert.equal(invalid.session.uid, undefined);
        blocked = true;
        const locked = handler('user_login', first);
        await locked.post('system', 'student', 'correct-password');
        assert.equal(locked.session.uid, 0);
        assert.equal(locked.response.redirect, '/client-required-notice?tid=exam');
    });

    it('stores registration continuation per token and ignores a forged completion-form destination', async () => {
        const a = handler('user_register', first);
        const b = handler('user_register', second);
        await a.post({}, 'one@example.test');
        await b.post({}, 'two@example.test');
        const [one, two] = [...tokens.values()];
        assert.equal(one.signingReturn, first);
        assert.equal(two.signingReturn, second);
        assert.equal(domain.registerRedirect, '/ordinary-welcome');
        const finish = handler('user_register_with_code', second);
        await finish.prepare({}, one._id);
        await assert.rejects(finish.post('system', 'password', 'different', 'new-one', one._id));
        assert.ok(tokens.has(one._id));
        await finish.post('system', 'password', 'password', 'new-one', one._id);
        assert.equal(finish.response.redirect, first);
        assert.ok(tokens.has(two._id));
        const ordinary = handler('user_register');
        await ordinary.post({}, 'ordinary@example.test');
        const last = [...tokens.values()].at(-1);
        assert.equal(last.signingReturn, undefined);
        assert.equal(last.redirect, '/ordinary-welcome');
    });

    it('returns password reset to the same signing login and blocks cross-domain token use before writes', async () => {
        const begin = handler('user_lostpass', first);
        await begin.post('system', 'student@example.test');
        const [doc] = tokens.values();
        const wrongDomain = handler('user_lostpass_with_code');
        wrongDomain.domain = { ...domain, _id: 'other' };
        await assert.rejects(wrongDomain.post('other', doc._id, 'new', 'new'), { name: 'ValidationError' });
        assert.ok(!writes.includes('set-password'));
        const finish = handler('user_lostpass_with_code');
        await finish.post('system', doc._id, 'new', 'new');
        const url = new URL(finish.response.redirect, 'https://oj.test');
        assert.equal(url.pathname, '/login');
        assert.equal(url.searchParams.get('collectSign'), first);
    });

    it('uses each verified OAuth state even when callbacks return in reverse order', async () => {
        links.set('test:linked', 11);
        const startA = handler('user_oauth', first);
        const startB = handler('user_oauth', second);
        await startA.get('system', 'test');
        await startB.get('system', 'test');
        const [a, b] = [...tokens.values()];
        const callbackB = handler('user_oauth_callback');
        await callbackB.get({ type: 'test', state: b._id, domainId: 'system' });
        const callbackA = handler('user_oauth_callback');
        callbackA.session.oauthBind = 'test';
        await callbackA.get({ type: 'test', state: a._id, domainId: 'system' });
        assert.equal(callbackB.response.redirect, `/d/system${second}`);
        assert.equal(callbackA.response.redirect, `/d/system${first}`);
        assert.ok(!writes.includes('oauth-link'));
        assert.equal(tokens.size, 0);
    });
});
