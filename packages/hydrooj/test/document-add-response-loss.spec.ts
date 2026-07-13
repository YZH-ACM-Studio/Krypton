import { expect } from 'chai';
import { describe, it } from 'node:test';

(global as any).Hydro ||= { model: {}, module: {}, ui: {} };
(global as any).Hydro.ui ||= {};

const inserted: any[] = [];

const collection = {
    async insertOne(doc: any) {
        inserted.push(structuredClone(doc));
        throw new Error('injected insert response loss');
    },
};

const dbPath = require.resolve('../src/service/db.ts');
const busPath = require.resolve('../src/service/bus.ts');
const documentPath = require.resolve('../src/model/document.ts');

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection() {
                return collection;
            },
        },
    },
} as NodeModule;
require.cache[busPath] = {
    id: busPath,
    filename: busPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            async parallel() {
                return undefined;
            },
        },
    },
} as NodeModule;
delete require.cache[documentPath];

const document = require(documentPath) as typeof import('../src/model/document');

describe('P2.14 document insert identity', () => {
    it('exposes the exact prepared identity before a successful insert response is lost', async () => {
        inserted.length = 0;
        let prepared: any = null;
        let error: Error | null = null;
        try {
            await document.add(
                'system',
                'statement',
                42,
                document.TYPE_PROBLEM,
                101,
                undefined,
                undefined,
                { pid: 'P3101', authoringMode: 'managed' } as any,
                {
                    onPrepared(doc) {
                        prepared = structuredClone(doc);
                    },
                },
            );
        } catch (caught) {
            error = caught as Error;
        }

        expect(error?.message).to.equal('injected insert response loss');
        expect(prepared).to.include({ domainId: 'system', docType: document.TYPE_PROBLEM, docId: 101 });
        expect(prepared._id).to.deep.equal(inserted[0]._id);
        expect(inserted[0]).to.include({ pid: 'P3101', authoringMode: 'managed' });
    });
});
