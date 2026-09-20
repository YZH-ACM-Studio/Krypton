import { expect } from 'chai';
import { afterEach, describe, it } from 'node:test';
import { EPortalLoginError, login } from '../src/eportal';

const originalFetch = globalThis.fetch;
const SECRET_PASSWORD = 'campus-net-secret-pw-9f3a';

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function stubFetch(impl: typeof fetch): void {
    globalThis.fetch = impl;
}

function toUrl(input: Parameters<typeof fetch>[0]): URL {
    if (input instanceof URL) return input;
    if (typeof input === 'string') return new URL(input);
    return new URL(input.url);
}

function jsonpOk(): Response {
    return new Response('dr1003({"result":1,"msg":"ok"})', {
        status: 200,
        headers: { 'Content-Type': 'text/javascript' },
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

describe('eportal login URL', () => {
    it('POSTs login() to 192.168.100.200:801 /eportal/portal/login', async () => {
        let captured: URL | undefined;
        stubFetch(async (input) => {
            captured = toUrl(input);
            return jsonpOk();
        });

        const result = await login('campus-user', SECRET_PASSWORD);

        expect(captured).to.be.instanceOf(URL);
        expect(captured!.host).to.equal('192.168.100.200:801');
        expect(captured!.pathname).to.include('/eportal/portal/login');
        expect(result).to.deep.equal({ alreadyOnline: false, msg: 'ok' });
    });

    it('never includes the campus password in thrown errors', async () => {
        stubFetch(async (input) => {
            throw new Error(`fetch failed: ${toUrl(input).href}`);
        });
        const networkError = await thrown(() => login('campus-user', SECRET_PASSWORD));
        expect(networkError).to.be.instanceOf(EPortalLoginError);
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
