import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const hooksPath = require.resolve('../src/hooks.ts');
const originalLoad = Module._load;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === hooksPath) {
        if (request === 'hydrooj') return {};
        if (request === './model') return { permitsModel: {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let isLegacyPublishTransition: (
    pdoc: { authoringMode?: string; hidden?: boolean } | null | undefined,
    previous?: { hidden?: boolean },
) => boolean;
try {
    delete require.cache[hooksPath];
    ({ isLegacyPublishTransition } = require(hooksPath));
} finally {
    Module._load = originalLoad;
}

describe('permit lifecycle hook transitions', () => {
    it('clears legacy verifiers only for a real hidden-to-visible publication', () => {
        expect(isLegacyPublishTransition({ hidden: false }, { hidden: true })).to.equal(true);
        expect(isLegacyPublishTransition({ hidden: false }, { hidden: false })).to.equal(false);
        expect(isLegacyPublishTransition({ hidden: false })).to.equal(false);
        expect(isLegacyPublishTransition({ hidden: true }, { hidden: true })).to.equal(false);
        expect(isLegacyPublishTransition({ hidden: false, authoringMode: 'managed' }, { hidden: true })).to.equal(false);
    });
});
