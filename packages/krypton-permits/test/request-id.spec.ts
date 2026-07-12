import { expect } from 'chai';
import { describe, it } from 'node:test';
import { deriveAclRequestId } from '../src/request-id';

describe('ACL HTTP request id', () => {
    it('derives the same retryable id from the mutation identity when the client omits one', () => {
        const input = ['system', 42, 7, 'maintainer'];
        expect(deriveAclRequestId(undefined, 'grant', ...input)).to.equal(deriveAclRequestId(undefined, 'grant', ...input));
        expect(deriveAclRequestId(undefined, 'grant', ...input)).not.to.equal(deriveAclRequestId(undefined, 'grant', 'system', 42, 8, 'maintainer'));
    });

    it('uses an explicit client requestId unchanged', () => {
        expect(deriveAclRequestId(' client-retry-1 ', 'grant', 'ignored')).to.equal('client-retry-1');
    });
});
