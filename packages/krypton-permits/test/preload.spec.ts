import { expect } from 'chai';
import { describe, it } from 'node:test';
import { preloadProblemAcl } from '../src/preload';

const emptyPidNamespaceAcl = async () => ({
    authorNamespaceIds: new Set<string>(),
    managerNamespaceIds: new Set<string>(),
    editAllNamespaceIds: new Set<string>(),
});

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
                    dataContributionPids: new Set([3]),
                    tagContributionPids: new Set([4]),
                    fencedPids: new Set([1]),
                    ownsLegacyProblems: true,
                };
            },
            async () => ({
                authorNamespaceIds: new Set(['custom:os']),
                managerNamespaceIds: new Set(['custom:os']),
                editAllNamespaceIds: new Set<string>(),
            }),
            (error) => {
                throw error;
            },
        );

        expect(calls).to.equal(1);
        expect(user._problemAclLoaded).to.equal(true);
        expect(user._problemAclDomainId).to.equal('system');
        expect([...user._aclFencedPids]).to.deep.equal([1]);
        expect([...user._dataContributionPids]).to.deep.equal([3]);
        expect([...user._tagContributionPids]).to.deep.equal([4]);
        expect(user._ownsLegacyProblems).to.equal(true);
        expect([...user._pidNamespaceAuthorIds]).to.deep.equal(['custom:os']);
        expect([...user._pidNamespaceManagerIds]).to.deep.equal(['custom:os']);
        expect(user._pidNamespaceAclLoaded).to.equal(true);
        expect(user._pidNamespaceAclDomainId).to.equal('system');
    });

    it('fails closed and reports the load error without retaining stale ACL state', async () => {
        const user: any = {
            _id: 7,
            _permitPids: new Set([999]),
            _authoredPids: new Set([999]),
            _maintainedPids: new Set([999]),
            _dataContributionPids: new Set([999]),
            _tagContributionPids: new Set([999]),
            _aclFencedPids: new Set(),
            _ownsLegacyProblems: true,
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
            emptyPidNamespaceAcl,
            (error) => errors.push(error),
        );

        expect(user._problemAclLoaded).to.equal(false);
        expect(user._problemAclDomainId).to.equal(undefined);
        expect([...user._permitPids]).to.deep.equal([]);
        expect([...user._authoredPids]).to.deep.equal([]);
        expect([...user._maintainedPids]).to.deep.equal([]);
        expect([...user._dataContributionPids]).to.deep.equal([]);
        expect([...user._tagContributionPids]).to.deep.equal([]);
        expect([...user._aclFencedPids]).to.deep.equal([]);
        expect(user._ownsLegacyProblems).to.equal(false);
        expect(user._pidNamespaceAclLoaded).to.equal(false);
        expect(user._pidNamespaceAclDomainId).to.equal(undefined);
        expect([...user._pidNamespaceAuthorIds]).to.deep.equal([]);
        expect((errors[0] as Error).message).to.equal('database unavailable');
    });

    it('fails closed when a loader omits the legacy ownership fact', async () => {
        const user: any = { _id: 8, _ownsLegacyProblems: true };
        const errors: unknown[] = [];

        await preloadProblemAcl(
            user,
            'system',
            async () =>
                ({
                    permitPids: new Set(),
                    authoredPids: new Set(),
                    maintainedPids: new Set(),
                    dataContributionPids: new Set(),
                    tagContributionPids: new Set(),
                    fencedPids: new Set(),
                }) as any,
            emptyPidNamespaceAcl,
            (error) => errors.push(error),
        );

        expect(user._problemAclLoaded).to.equal(false);
        expect(user._ownsLegacyProblems).to.equal(false);
        expect(errors[0]).to.be.instanceOf(TypeError);
    });

    it('fails closed when a loader returns an incomplete ACL set snapshot', async () => {
        const user: any = {
            _id: 9,
            _permitPids: new Set([999]),
            _authoredPids: new Set([999]),
            _maintainedPids: new Set([999]),
            _dataContributionPids: new Set([999]),
            _tagContributionPids: new Set([999]),
            _aclFencedPids: new Set([999]),
            _ownsLegacyProblems: true,
            _problemAclLoaded: true,
            _problemAclDomainId: 'other',
        };
        const errors: unknown[] = [];

        await preloadProblemAcl(
            user,
            'system',
            async () =>
                ({
                    permitPids: new Set([1]),
                    authoredPids: new Set([2]),
                    maintainedPids: new Set([3]),
                    ownsLegacyProblems: true,
                }) as any,
            emptyPidNamespaceAcl,
            (error) => errors.push(error),
        );

        expect(user._problemAclLoaded).to.equal(false);
        expect(user._problemAclDomainId).to.equal(undefined);
        expect([...user._permitPids]).to.deep.equal([]);
        expect([...user._authoredPids]).to.deep.equal([]);
        expect([...user._maintainedPids]).to.deep.equal([]);
        expect([...user._dataContributionPids]).to.deep.equal([]);
        expect([...user._tagContributionPids]).to.deep.equal([]);
        expect([...user._aclFencedPids]).to.deep.equal([]);
        expect(user._ownsLegacyProblems).to.equal(false);
        expect(errors[0]).to.be.instanceOf(TypeError);
    });

    it('loads problem and namespace ACL snapshots atomically', async () => {
        const user: any = {
            _id: 10,
            _pidNamespaceAuthorIds: new Set(['stale']),
            _pidNamespaceAclDomainId: 'stale-domain',
            _pidNamespaceAclLoaded: true,
        };
        const errors: unknown[] = [];

        await preloadProblemAcl(
            user,
            'system',
            async () => ({
                permitPids: new Set([7]),
                authoredPids: new Set([7]),
                maintainedPids: new Set([7]),
                dataContributionPids: new Set(),
                tagContributionPids: new Set(),
                fencedPids: new Set(),
                ownsLegacyProblems: false,
            }),
            async () =>
                ({
                    authorNamespaceIds: ['not-a-set'],
                    managerNamespaceIds: new Set(),
                    editAllNamespaceIds: new Set(),
                }) as any,
            (error) => errors.push(error),
        );

        expect(user._problemAclLoaded).to.equal(false);
        expect(user._pidNamespaceAclLoaded).to.equal(false);
        expect([...user._permitPids]).to.deep.equal([]);
        expect([...user._pidNamespaceAuthorIds]).to.deep.equal([]);
        expect(errors[0]).to.be.instanceOf(TypeError);
    });

    it('marks an anonymous request with two empty authoritative snapshots without database loads', async () => {
        const user: any = { _id: 0 };
        let problemLoads = 0;
        let namespaceLoads = 0;

        await preloadProblemAcl(
            user,
            'system',
            async () => {
                problemLoads++;
                throw new Error('must not load');
            },
            async () => {
                namespaceLoads++;
                throw new Error('must not load');
            },
            (error) => {
                throw error;
            },
        );

        expect(problemLoads).to.equal(0);
        expect(namespaceLoads).to.equal(0);
        expect(user._problemAclLoaded).to.equal(true);
        expect(user._pidNamespaceAclLoaded).to.equal(true);
        expect(user._problemAclDomainId).to.equal('system');
        expect(user._pidNamespaceAclDomainId).to.equal('system');
        expect([...user._pidNamespaceAuthorIds]).to.deep.equal([]);
    });
});
