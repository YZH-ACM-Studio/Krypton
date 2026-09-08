import { expect } from 'chai';
import { describe, it } from 'node:test';
import { PERM } from '@hydrooj/common';
import { BUILTIN_ROLES } from '../src/model/builtin-roles';

describe('builtin domain roles', () => {
    it('does not put rankboard import or manage on the teacher role', () => {
        expect(BUILTIN_ROLES.teacher & PERM.PERM_RANKBOARD_IMPORT).to.equal(0n);
        expect(BUILTIN_ROLES.teacher & PERM.PERM_RANKBOARD_MANAGE).to.equal(0n);
        expect(BUILTIN_ROLES.teacher & PERM.PERM_CREATE_TASK).to.equal(PERM.PERM_CREATE_TASK);
        expect(BUILTIN_ROLES.teacher & PERM.PERM_CREATE_EXAM_EVENT).to.equal(PERM.PERM_CREATE_EXAM_EVENT);
    });

    it('puts create collect on teacher and keeps manage collect off teacher', () => {
        expect(BUILTIN_ROLES.teacher & PERM.PERM_CREATE_COLLECT).to.equal(PERM.PERM_CREATE_COLLECT);
        expect(BUILTIN_ROLES.teacher & PERM.PERM_MANAGE_COLLECT).to.equal(0n);
    });
});
