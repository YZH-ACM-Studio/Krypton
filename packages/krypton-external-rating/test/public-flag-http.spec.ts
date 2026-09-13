import { expect } from 'chai';
import { describe, it } from 'node:test';
import { EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT, ExternalRatingTypeError } from '../src/types';
import { parsePublicFlag } from '../src/validate';

function expectRejected(run: () => unknown): Error {
    try {
        run();
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
        return error as Error;
    }
    expect.fail('expected fail closed');
    throw new Error('unreachable');
}

describe('krypton-external-rating public flag HTTP encodings', () => {
    it('accepts JSON boolean true as public', () => {
        expect(parsePublicFlag(true)).to.equal(true);
    });

    it('accepts JSON boolean false as hidden', () => {
        expect(parsePublicFlag(false)).to.equal(false);
    });

    it('treats omitted HTML checkbox and missing JSON flag as hidden', () => {
        expect(EXTERNAL_RATING_PUBLIC_SHOW_DEFAULT).to.equal(false);
        expect(parsePublicFlag(undefined)).to.equal(false);
        expect(parsePublicFlag(null)).to.equal(false);
    });

    it('rejects HTML checkbox string on; only JSON true is public', () => {
        const error = expectRejected(() => parsePublicFlag('on'));
        expect(error).to.be.instanceOf(ExternalRatingTypeError);
        expect((error as ExternalRatingTypeError).field).to.equal('publicShow');
        expectRejected(() => parsePublicFlag('true'));
        expectRejected(() => parsePublicFlag('1'));
        expectRejected(() => parsePublicFlag('off'));
        expectRejected(() => parsePublicFlag('false'));
        expectRejected(() => parsePublicFlag(''));
        expectRejected(() => parsePublicFlag(1));
        expectRejected(() => parsePublicFlag(0));
    });
});
