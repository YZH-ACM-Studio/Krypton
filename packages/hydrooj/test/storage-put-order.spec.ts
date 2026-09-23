import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { replaceStoredObject } from '../src/lib/storage-replacement';

function missingUpload(): NodeJS.ErrnoException {
    const error = new Error(
        "ENOENT: no such file or directory, copyfile '/tmp/hydro/upload/0/i3ow9uwka05ubsik9xd4f70xs.in' -> '/data/file/hydro/ryn/rtaflvyliyvhchiwillzw.in'",
    ) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return error;
}

describe('stored object replacement', () => {
    it('does not retire the live file when the upload temp is already gone', async () => {
        const events: string[] = [];
        const error = await replaceStoredObject(
            '/tmp/hydro/upload/0/missing.in',
            async () => {
                events.push('blob');
                throw missingUpload();
            },
            async () => {
                events.push('meta');
                return { metaData: {}, size: 1, etag: 'etag' };
            },
            async () => {
                events.push('retire');
            },
            async () => {
                events.push('insert');
            },
        ).catch((caught) => caught);

        expect(error?.name).to.equal('ValidationError');
        expect(events).to.deep.equal(['blob']);
    });

    it('stores the new bytes before retiring the previous object', async () => {
        const events: string[] = [];
        await replaceStoredObject(
            '/tmp/hydro/upload/0/present.in',
            async () => {
                events.push('blob');
            },
            async () => {
                events.push('meta');
                return { metaData: { 'Content-Type': 'text/plain' }, size: 4, etag: 'etag' };
            },
            async () => {
                events.push('retire');
            },
            async (meta) => {
                events.push('insert');
                expect(meta).to.deep.equal({ metaData: { 'Content-Type': 'text/plain' }, size: 4, etag: 'etag' });
            },
        );

        expect(events).to.deep.equal(['blob', 'meta', 'retire', 'insert']);
    });

    it('keeps a non-upload ENOENT as the original failure and still does not retire the live file', async () => {
        const events: string[] = [];
        const cause = missingUpload();
        const error = await replaceStoredObject(
            Buffer.from('3'),
            async () => {
                events.push('blob');
                throw cause;
            },
            async () => {
                events.push('meta');
                return { metaData: {}, size: 1, etag: 'etag' };
            },
            async () => {
                events.push('retire');
            },
            async () => {
                events.push('insert');
            },
        ).catch((caught) => caught);

        expect(error).to.equal(cause);
        expect(events).to.deep.equal(['blob']);
    });

    it('wires problem file replacement through the safe order', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/storage.ts'), 'utf8');
        const put = source.slice(source.indexOf('static async put('), source.indexOf('static async get('));
        const writeBlob = put.indexOf('() => storage.put(_id, file, meta)');
        const retire = put.indexOf('() => StorageModel.del([path])');
        const insert = put.indexOf('StorageModel.coll.insertOne');
        expect(writeBlob).to.be.greaterThan(-1);
        expect(writeBlob).to.be.lessThan(retire);
        expect(retire).to.be.lessThan(insert);

        const claim = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/problem.ts'), 'utf8');
        expect(claim).to.include('throw problemWritePreflightFailure(error);');
    });
});
