import { PERM } from '@hydrooj/common';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { problemWritePreflightFailure } from '../src/lib/problem-write-preflight';

(global as any).Hydro ||= { model: {} };
(global as any).Hydro.model ||= {};

describe('problem write-claim preflight', () => {
    it('reports an existing error claim as a write lock', () => {
        const cause = new Error('problem system/3619 already has error write claim problem-write:files-upload:system:3619:abc');
        const error = problemWritePreflightFailure(cause);

        expect(error.name).to.equal('ProblemWriteLockedError');
        expect((error as { cause?: unknown }).cause).to.equal(cause);
        expect(error.message).to.not.include('PERM_EDIT_PROBLEM_SELF');
    });

    it('keeps an unrelated preflight failure as the edit-own-problems denial', () => {
        const cause = new TypeError('permits.prepareProblemWriteClaim is unavailable');
        const error = problemWritePreflightFailure(cause);

        expect(error.name).to.equal('PermissionError');
        expect((error as { params?: unknown[] }).params?.[0]).to.equal(PERM.PERM_EDIT_PROBLEM_SELF);
        expect((error as { cause?: unknown }).cause).to.equal(cause);
    });
});
