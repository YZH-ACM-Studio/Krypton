import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { resolve } from 'node:path';
import { EPortalLoginError, login, parseEportalLoginBody } from '../src/eportal';
import { probeInternet } from '../src/probe';

const originalFetch = globalThis.fetch;
const SECRET_PASSWORD = 'campus-net-secret-pw-9f3a';

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function stubFetch(impl: typeof fetch): void {
    globalThis.fetch = impl;
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function errorText(error: unknown): string {
    const chunks: string[] = [];
    const seen = new Set<unknown>();
    const stack: unknown[] = [error];
    while (stack.length) {
        const current = stack.pop();
        if (current == null || seen.has(current)) continue;
        seen.add(current);
        if (typeof current === 'string') {
            chunks.push(current);
            continue;
        }
        if (typeof current !== 'object') {
            chunks.push(String(current));
            continue;
        }
        if (current instanceof Error) {
            chunks.push(current.name, current.message, current.stack || '');
        }
        try {
            chunks.push(JSON.stringify(current));
        } catch {
            chunks.push(String(current));
        }
        if ('cause' in current) stack.push((current as { cause?: unknown }).cause);
        if ('code' in current) stack.push((current as { code?: unknown }).code);
        if ('errors' in current) stack.push((current as { errors?: unknown }).errors);
    }
    return chunks.join('\n');
}

async function thrown(run: () => Promise<unknown> | unknown): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error('expected function to throw');
}

describe('campus-net probe', () => {
    it('treats probe failure as not ok', async () => {
        stubFetch(async () => {
            throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
        });
        const network = await probeInternet();
        expect(network.ok).to.equal(false);

        stubFetch(async () => jsonResponse(503, { status: 'FAILED' }));
        const http = await probeInternet();
        expect(http.ok).to.equal(false);

        stubFetch(async () => jsonResponse(200, { status: 'FAILED', comment: 'backend down' }));
        const cf = await probeInternet();
        expect(cf.ok).to.equal(false);

        stubFetch(async () => new Response('<html>captcha</html>', { status: 200 }));
        const parse = await probeInternet();
        expect(parse.ok).to.equal(false);
    });
});

describe('campus-net eportal', () => {
    it('throws when the login body cannot be parsed', () => {
        const bodies = [
            '',
            '   ',
            '<html><title>EPortal</title></html>',
            'not-jsonp',
            'dr1003(',
            'dr1003({}) leftover',
            'dr1003([])',
            '[{"result":1}]',
            '{"msg":"ok"}',
            'dr1003({"msg":"ok"})',
        ];
        for (const body of bodies) {
            expect(() => parseEportalLoginBody(body), body).to.throw(EPortalLoginError);
        }
    });

    it('never includes the campus password in thrown messages', async () => {
        stubFetch(async (input) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            throw new Error(`fetch failed: ${url}`);
        });
        const networkError = await thrown(() => login('campus-user', SECRET_PASSWORD));
        expect(errorText(networkError)).to.not.include(SECRET_PASSWORD);

        stubFetch(async () => new Response('<html>EPortal</html>', { status: 200 }));
        const htmlError = await thrown(() => login('campus-user', SECRET_PASSWORD));
        expect(htmlError).to.be.instanceOf(EPortalLoginError);
        expect(errorText(htmlError)).to.not.include(SECRET_PASSWORD);

        stubFetch(async () => new Response('dr1003({"result":0,"msg":"账号或密码不对"})', { status: 200 }));
        const loginError = await thrown(() => login('campus-user', SECRET_PASSWORD));
        expect(loginError).to.be.instanceOf(EPortalLoginError);
        expect(errorText(loginError)).to.not.include(SECRET_PASSWORD);
    });
});

describe('campus-net notify', () => {
    function loadCampusNetModules(): {
        tick: typeof import('../src/daemon').tick;
        notifyRoot: typeof import('../src/notify').notifyRoot;
    } {
        const Module = require('module');
        const originalLoad = Module._load;
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === 'hydrooj') {
                return {
                    MessageModel: {
                        FLAG_UNREAD: 1,
                        async send() {
                            throw new Error('MessageModel.send must not run in this test');
                        },
                    },
                    UserModel: {
                        async getByUname() {
                            return { _id: 42, uname: 'root' };
                        },
                    },
                };
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            const daemonPath = require.resolve('../src/daemon.ts');
            const notifyPath = require.resolve('../src/notify.ts');
            delete require.cache[daemonPath];
            delete require.cache[notifyPath];
            const daemon = require(daemonPath) as typeof import('../src/daemon');
            const notify = require(notifyPath) as typeof import('../src/notify');
            return { tick: daemon.tick, notifyRoot: notify.notifyRoot };
        } finally {
            Module._load = originalLoad;
        }
    }

    function memoryStore(initial: { connectivity: 'up' | 'down'; dialFailNotified: boolean } | null) {
        return {
            state: initial,
            async load() {
                return this.state;
            },
            async save(next: { connectivity: 'up' | 'down'; dialFailNotified: boolean }) {
                this.state = next;
            },
        };
    }

    it('does not notify on same-state transitions', async () => {
        const { tick } = loadCampusNetModules();

        const sent: unknown[] = [];
        const initial: { connectivity: 'up' | 'down'; dialFailNotified: boolean } = { connectivity: 'up', dialFailNotified: false };
        const store = {
            state: initial,
            async load() {
                return this.state;
            },
            async save(next: { connectivity: 'up' | 'down'; dialFailNotified: boolean }) {
                this.state = next;
            },
        };

        const stillUp = await tick({
            credentials: { username: 'campus-user', password: SECRET_PASSWORD },
            stateStore: store,
            probeInternet: async () => ({ ok: true, detail: 'http 200 status OK' }),
            login: async () => {
                throw new Error('same-state up must not dial');
            },
            notifyRoot: async (payload) => {
                sent.push(payload);
            },
        });
        expect(stillUp.notified).to.deep.equal([]);
        expect(sent).to.deep.equal([]);

        store.state = { connectivity: 'down', dialFailNotified: true };
        const stillDown = await tick({
            credentials: { username: 'campus-user', password: SECRET_PASSWORD },
            stateStore: store,
            probeInternet: async () => ({ ok: false, detail: 'timeout' }),
            login: async () => {
                throw new EPortalLoginError('denied');
            },
            notifyRoot: async (payload) => {
                sent.push(payload);
            },
        });
        expect(stillDown.notified).to.deep.equal([]);
        expect(sent).to.deep.equal([]);
    });

    it('must notify on up->down', async () => {
        const { tick } = loadCampusNetModules();
        const sent: unknown[] = [];
        const store = memoryStore({ connectivity: 'up', dialFailNotified: false });

        const result = await tick({
            credentials: { username: 'campus-user', password: SECRET_PASSWORD },
            stateStore: store,
            probeInternet: async () => ({ ok: false, detail: 'timeout' }),
            login: async () => ({ alreadyOnline: false, msg: 'ok' }),
            notifyRoot: async (payload) => {
                sent.push(payload);
            },
        });

        expect(result.previousConnectivity).to.equal('up');
        expect(result.connectivity).to.equal('down');
        expect(result.notified).to.deep.equal(['up->down']);
        expect(sent).to.deep.equal([{ event: 'up->down', probeDetail: 'timeout' }]);
        expect(store.state).to.deep.equal({ connectivity: 'down', dialFailNotified: false });
    });

    it('must notify on down->up', async () => {
        const { tick } = loadCampusNetModules();
        const sent: unknown[] = [];
        const store = memoryStore({ connectivity: 'down', dialFailNotified: false });

        const result = await tick({
            credentials: { username: 'campus-user', password: SECRET_PASSWORD },
            stateStore: store,
            probeInternet: async () => ({ ok: true, detail: 'http 200 status OK' }),
            login: async () => {
                throw new Error('down->up must not dial');
            },
            notifyRoot: async (payload) => {
                sent.push(payload);
            },
        });

        expect(result.previousConnectivity).to.equal('down');
        expect(result.connectivity).to.equal('up');
        expect(result.notified).to.deep.equal(['down->up']);
        expect(sent).to.deep.equal([{ event: 'down->up', probeDetail: 'http 200 status OK' }]);
        expect(store.state).to.deep.equal({ connectivity: 'up', dialFailNotified: false });
    });

    it('must not notify on first tick null->online', async () => {
        const { tick } = loadCampusNetModules();
        const sent: unknown[] = [];
        const store = memoryStore(null);

        const result = await tick({
            credentials: { username: 'campus-user', password: SECRET_PASSWORD },
            stateStore: store,
            probeInternet: async () => ({ ok: true, detail: 'http 200 status OK' }),
            login: async () => {
                throw new Error('first tick null->online must not dial');
            },
            notifyRoot: async (payload) => {
                sent.push(payload);
            },
        });

        expect(result.previousConnectivity).to.equal('unknown');
        expect(result.connectivity).to.equal('up');
        expect(result.notified).to.deep.equal([]);
        expect(sent).to.deep.equal([]);
        expect(store.state).to.deep.equal({ connectivity: 'up', dialFailNotified: false });
    });

    it('rejects Hydro uname root at uid 1 and does not send', async () => {
        const { notifyRoot } = loadCampusNetModules();
        const sent: unknown[] = [];
        const error = await thrown(() => notifyRoot(
            { event: 'up->down', probeDetail: 'timeout' },
            {
                async getByUname(domainId, uname) {
                    expect(domainId).to.equal('system');
                    expect(uname).to.equal('root');
                    return { _id: 1, uname: 'root' };
                },
                async send(from, to, content, flag) {
                    sent.push({ from, to, content, flag });
                },
                flagUnread: 1,
            },
        ));
        expect(error).to.be.instanceOf(Error);
        expect(errorText(error)).to.include('uid 1');
        expect(errorText(error)).to.include('system/guest');
        expect(errorText(error)).to.not.include(SECRET_PASSWORD);
        expect(sent).to.deep.equal([]);
    });
});

describe('campus-net apply', () => {
    it('declares CLI-only apply with no HTTP student routes', () => {
        const src = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
        expect(src).to.match(/export async function apply\(/);
        expect(src).to.include('registerCommands(ctx)');
        expect(src).to.include('dispatchHydroCliTick');
        expect(src).to.not.include('applyHandlers');
        expect(src).to.not.include('ctx.Route');
        expect(src).to.not.include('ctx.Connection');
        expect(src).to.not.include('ctx.server');
    });

    it('registers CLI commands and does not add HTTP routes', async () => {
        const Module = require('module');
        const originalLoad = Module._load;
        const commands: string[] = [];
        const routes: string[] = [];
        Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
            if (request === 'hydrooj') {
                return {};
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        try {
            const indexPath = require.resolve('../index.ts');
            const cliPath = require.resolve('../src/cli.ts');
            delete require.cache[indexPath];
            delete require.cache[cliPath];
            const { apply } = require(indexPath) as { apply(ctx: unknown): Promise<void> };
            const chain = {
                option() {
                    return chain;
                },
                action() {
                    return chain;
                },
            };
            const cli = {
                command(name: string) {
                    commands.push(name);
                    return chain;
                },
            };
            await apply({
                cli,
                get(name: string) {
                    return name === 'cli' ? cli : undefined;
                },
                Route(name: string) {
                    routes.push(name);
                },
                Connection(name: string) {
                    routes.push(name);
                },
            });
        } finally {
            Module._load = originalLoad;
        }
        expect(routes).to.deep.equal([]);
        expect(commands).to.deep.equal(['campus-net:tick']);
    });
});
