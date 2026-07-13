import { expect } from 'chai';
import { describe, it } from 'node:test';
import { preloadProblemAcl } from '../src/preload';

describe('problem ACL preload', () => {
    it('loads uid=1 administrators instead of bypassing their fences', async () => {
        const user: any = { _id: 1 };
        let calls = 0;
        await preloadProblemAcl(
            user,
            'system',
            async () => {
                calls++;
                return {
                    permitPids: new Set([1, 2]),
                    authoredPids: new Set([1]),
                    maintainedPids: new Set([2]),
                    fencedPids: new Set([1]),
                };
            },
            (error) => {
                throw error;
            },
        );

        expect(calls).to.equal(1);
        expect(user._problemAclLoaded).to.equal(true);
        expect(user._problemAclDomainId).to.equal('system');
        expect([...user._aclFencedPids]).to.deep.equal([1]);
    });

    it('fails closed and reports the load error without retaining stale ACL state', async () => {
        const user: any = {
            _id: 7,
            _permitPids: new Set([999]),
            _authoredPids: new Set([999]),
            _maintainedPids: new Set([999]),
            _aclFencedPids: new Set(),
            _problemAclLoaded: true,
            _problemAclDomainId: 'other',
        };
        const errors: unknown[] = [];
        await preloadProblemAcl(
            user,
            'system',
            async () => {
                throw new Error('database unavailable');
            },
            (error) => errors.push(error),
        );

        expect(user._problemAclLoaded).to.equal(false);
        expect(user._problemAclDomainId).to.equal(undefined);
        expect([...user._permitPids]).to.deep.equal([]);
        expect([...user._authoredPids]).to.deep.equal([]);
        expect([...user._maintainedPids]).to.deep.equal([]);
        expect([...user._aclFencedPids]).to.deep.equal([]);
        expect((errors[0] as Error).message).to.equal('database unavailable');
    });
});
