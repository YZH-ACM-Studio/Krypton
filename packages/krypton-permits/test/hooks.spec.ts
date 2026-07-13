import { expect } from 'chai';
import { describe, it } from 'node:test';
import { isLegacyPublishTransition } from '../src/hook-policy';

describe('permit lifecycle hook transitions', () => {
    it('clears legacy verifiers only for a real hidden-to-visible publication', () => {
        expect(isLegacyPublishTransition({ hidden: false }, { hidden: true })).to.equal(true);
        expect(isLegacyPublishTransition({ hidden: false }, { hidden: false })).to.equal(false);
        expect(isLegacyPublishTransition({ hidden: false })).to.equal(false);
        expect(isLegacyPublishTransition({ hidden: true }, { hidden: true })).to.equal(false);
        expect(isLegacyPublishTransition({ hidden: false, authoringMode: 'managed' }, { hidden: true })).to.equal(false);
    });
});
