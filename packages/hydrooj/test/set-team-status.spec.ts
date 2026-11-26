import { createDraftConfig, parseSetConfig } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { expect } from 'chai';
import { Service } from 'cordis';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';

global.Hydro = {
    version: { node: process.version, hydrooj: 'test' },
    model: {} as unknown as typeof global.Hydro.model,
    script: {},
    module: new Proxy({} as Record<string, Record<string, unknown>>, {
        get(self, key: string) {
            self[key] ||= {};
            return self[key];
        },
    }) as unknown as typeof global.Hydro.module,
    ui: {} as unknown as typeof global.Hydro.ui,
    error: {} as unknown as typeof global.Hydro.error,
    Logger,
    logger: new Logger('set-team-status'),
    locales: {},
};

const { Context } = require('../src/context.ts') as typeof import('../src/context');

class FakeDb extends Service {
    constructor(ctx: ConstructorParameters<typeof Service>[0]) {
        super(ctx, 'db');
    }

    collection() {
        return {};
    }
}

global.app = new Context();
const fakeDb = new FakeDb(global.app);
void fakeDb;

const { buildNextStatus } = require('../src/model/contest-team-status.ts') as typeof import('../src/model/contest-team-status');

function journalEntry() {
    return {
        rid: new ObjectId(),
        pid: 1,
        status: 0,
        score: 0,
    };
}

describe('team set status score', () => {
    it('keeps the stored set score and still uses accept for a legacy team contest', () => {
        const teamId = new ObjectId();
        const withSet = buildNextStatus(
            null,
            {
                domainId: 'system',
                docId: new ObjectId(),
                rule: 'contest',
                setConfig: parseSetConfig(createDraftConfig('contest')),
            } as Parameters<typeof buildNextStatus>[1],
            teamId,
            journalEntry(),
            () => ({ score: 80, accept: 1, time: 0, detail: {} }),
        );
        expect(withSet.score).to.equal(80);

        const legacy = buildNextStatus(
            null,
            {
                domainId: 'system',
                docId: new ObjectId(),
                rule: 'acm',
            } as Parameters<typeof buildNextStatus>[1],
            teamId,
            journalEntry(),
            () => ({ score: 80, accept: 1, time: 0, detail: {} }),
        );
        expect(legacy.score).to.equal(1);
    });
});
