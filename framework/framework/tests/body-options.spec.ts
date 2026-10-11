import { expect } from 'chai';
import type { AddressInfo } from 'node:net';
import { before, describe, it } from 'node:test';
import Koa from 'koa';
import Body from 'koa-body';
import { BODY_OPTIONS } from '../body-options';
import { Types } from '../validator';

/** Posts a urlencoded body through koa-body and returns what the handler would see. */
async function parsedUids(options: Parameters<typeof Body>[0], count: number): Promise<unknown> {
    const app = new Koa();
    app.use(Body(options));
    app.use((ctx) => {
        ctx.body = { uids: (ctx.request.body as Record<string, unknown>).uids };
    });
    const server = app.listen(0);
    try {
        const { port } = server.address() as AddressInfo;
        const form = new URLSearchParams({ operation: 'unrank_roster_save' });
        for (let index = 1; index <= count; index++) form.append('uids', String(index));
        const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: form });
        return ((await response.json()) as { uids: unknown }).uids;
    } finally {
        server.close();
    }
}

describe('form body options', () => {
    let defaults: unknown;
    let configured: unknown;
    before(async () => {
        defaults = await parsedUids({ multipart: true }, 21);
        configured = await parsedUids(BODY_OPTIONS, 21);
    });

    it('reproduces the qs default: 21 repeated fields stop being an array and fail NumericArray', () => {
        expect(Array.isArray(defaults)).to.equal(false);
        expect(() => Types.NumericArray(defaults)).to.throw();
    });

    it('keeps 21 repeated form fields as an array that NumericArray accepts', () => {
        expect(configured).to.deep.equal(Array.from({ length: 21 }, (_, index) => String(index + 1)));
        expect(Types.NumericArray(configured)).to.deep.equal(Array.from({ length: 21 }, (_, index) => index + 1));
    });

    it('keeps a full contest-sized list as an array', async () => {
        const uids = await parsedUids(BODY_OPTIONS, 600);
        expect(Array.isArray(uids)).to.equal(true);
        expect((uids as unknown[]).length).to.equal(600);
    });
});
