import { PERM } from '@hydrooj/common';
import { PermissionError, ProblemWriteLockedError } from '../error';

const EXISTING_WRITE_CLAIM = /already has \S+ write claim /;

/** Preflight failures are not domain-permission failures. An existing claim is a write lock. */
export function problemWritePreflightFailure(error: unknown): Error {
    if (error instanceof Error && EXISTING_WRITE_CLAIM.test(error.message)) {
        const locked = new ProblemWriteLockedError();
        Object.defineProperty(locked, 'cause', { value: error, configurable: true });
        return locked;
    }
    const denied = new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
    Object.defineProperty(denied, 'cause', { value: error, configurable: true });
    return denied;
}
