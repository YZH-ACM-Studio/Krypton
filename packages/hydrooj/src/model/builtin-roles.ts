import { PERM } from '@hydrooj/common';

/** Side-effect-free single source of truth for domain role defaults. */
export const BUILTIN_ROLES = {
    guest: PERM.PERM_BASIC,
    default: PERM.PERM_DEFAULT,
    teacher: PERM.PERM_TEACHER,
    root: PERM.PERM_ALL,
};
