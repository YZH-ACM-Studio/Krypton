import { expect } from 'chai';
import { describe, it } from 'node:test';
import { resolveRankboardCapabilities } from '../rankboard-capabilities.ts';

const PRIV_EDIT_SYSTEM = 1;
const PERM_RANKBOARD_IMPORT = 2n;
const PERM_RANKBOARD_MANAGE = 4n;

function resolve(user: any, domainId: string, onError: (error: unknown) => void) {
    return resolveRankboardCapabilities({
        user,
        domainId,
        editSystemPriv: PRIV_EDIT_SYSTEM,
        importPerm: PERM_RANKBOARD_IMPORT,
        managePerm: PERM_RANKBOARD_MANAGE,
        onError,
    });
}

function failOnUnexpectedError(error: unknown): never {
    throw error;
}

describe('rankboard bootstrap capabilities', () => {
    it('grants both capabilities to a system administrator in any domain', () => {
        const user = { hasPriv: (priv: number) => priv === PRIV_EDIT_SYSTEM, hasPerm: () => false };
        expect(resolve(user, 'course-domain', failOnUnexpectedError)).to.deep.equal({
            canImportRankboard: true,
            canManageRankboard: true,
        });
    });

    it('grants only import to a system-domain IMPORT user', () => {
        const user = {
            hasPriv: () => false,
            hasPerm: (perm: bigint) => perm === PERM_RANKBOARD_IMPORT,
        };
        expect(resolve(user, 'system', failOnUnexpectedError)).to.deep.equal({
            canImportRankboard: true,
            canManageRankboard: false,
        });
    });

    it('treats system-domain MANAGE as implying IMPORT', () => {
        const user = {
            hasPriv: () => false,
            hasPerm: (perm: bigint) => perm === PERM_RANKBOARD_MANAGE,
        };
        expect(resolve(user, 'system', failOnUnexpectedError)).to.deep.equal({
            canImportRankboard: true,
            canManageRankboard: true,
        });
    });

    it('does not let a non-system domain owner or PERM_ALL identity cross the scope boundary', () => {
        const user = { hasPriv: () => false, hasPerm: () => true };
        expect(resolve(user, 'owned-course', failOnUnexpectedError)).to.deep.equal({
            canImportRankboard: false,
            canManageRankboard: false,
        });
    });

    it('fails closed when the handler user or permission methods are unavailable or throw', () => {
        expect(resolve(undefined, 'system', failOnUnexpectedError)).to.deep.equal({
            canImportRankboard: false,
            canManageRankboard: false,
        });
        expect(resolve({ hasPriv: () => false }, 'system', failOnUnexpectedError)).to.deep.equal({
            canImportRankboard: false,
            canManageRankboard: false,
        });
        const observed: unknown[] = [];
        const failure = new Error('boom');
        expect(resolve(
            { hasPriv: () => { throw failure; }, hasPerm: () => true },
            'system',
            (error) => observed.push(error),
        )).to.deep.equal({
            canImportRankboard: false,
            canManageRankboard: false,
        });
        expect(observed).to.deep.equal([failure]);
    });
});
