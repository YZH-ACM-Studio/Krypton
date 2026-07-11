import { createRequire } from 'node:module';
import { expect } from 'chai';
import { beforeEach, describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('module');
const indexPath = require.resolve('../index.ts');
const originalLoad = Module._load;

let resolution: (user: any) => boolean = () => false;
const ProblemModel = {
    canBrowseProblemBank(user: any) {
        return resolution(user);
    },
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === indexPath) {
        if (request === 'hydrooj') {
            return {
                Context: class {},
                PERM: {},
                PRIV: {},
                ProblemModel,
            };
        }
        if (request === '@hydrooj/framework') return { serializer: () => undefined };
        if (request === 'koa2-connect') return () => undefined;
        if (request === './rankboard-capabilities') {
            return {
                resolveRankboardCapabilities: () => ({
                    canImportRankboard: false,
                    canManageRankboard: false,
                }),
            };
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

let resolveProblemBankCapability: (
    user: unknown,
    onError: (error: unknown) => void,
) => boolean;
try {
    delete require.cache[indexPath];
    ({ resolveProblemBankCapability } = require(indexPath));
} finally {
    Module._load = originalLoad;
}

beforeEach(() => {
    resolution = () => false;
});

describe('ui-next problem-bank bootstrap capability', () => {
    it('publishes the canonical server result without client-side permission reconstruction', () => {
        const user = { _id: 42 };
        const observed: unknown[] = [];
        resolution = (candidate) => candidate === user;

        expect(resolveProblemBankCapability(user, (error) => observed.push(error))).to.equal(true);
        expect(observed).to.deep.equal([]);
    });

    it('fails closed and reports the original capability-resolution error', () => {
        const failure = new Error('ACL preload failed');
        const observed: unknown[] = [];
        resolution = () => { throw failure; };

        expect(resolveProblemBankCapability({ _id: 42 }, (error) => observed.push(error))).to.equal(false);
        expect(observed).to.deep.equal([failure]);
    });

    it('fails closed and reports when handler user context is missing', () => {
        const observed: unknown[] = [];

        expect(resolveProblemBankCapability(undefined, (error) => observed.push(error))).to.equal(false);
        expect(observed).to.have.length(1);
        expect((observed[0] as Error).message).to.equal('handler user is unavailable');
    });
});
