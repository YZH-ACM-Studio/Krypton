import { localizedErrorText, AccountStateConflictError, UserAlreadyExistError, UserNotFoundError, ValidationError } from '../error';
import type { Udoc } from '../interface';

interface UsernameRenameCollection {
    findOne(filter: any): Promise<Udoc | null>;
    findOneAndUpdate(filter: any, update: any, options: any): Promise<Udoc | null>;
}

interface UsernameRenameInput {
    uid: number;
    expectedUsername: string;
    username: string;
}

interface AuditedUsernameRename<T> {
    rename(): Promise<T>;
    markSuccess(result: T): Promise<void>;
    markFailure(error: unknown): Promise<void>;
}

export class UsernameRenameCommittedError extends Error {
    constructor(
        public readonly result: Udoc,
        cause: unknown,
    ) {
        super('用户名已修改，但缓存失效失败');
        this.name = 'UsernameRenameCommittedError';
        Object.defineProperty(this, 'cause', { value: cause, configurable: true });
    }
}

export async function runAuditedUsernameRename<T>(operation: AuditedUsernameRename<T>): Promise<T> {
    let result: T;
    try {
        result = await operation.rename();
    } catch (error) {
        if (error instanceof UsernameRenameCommittedError) {
            try {
                await operation.markSuccess(error.result as T);
            } catch (auditError) {
                throw new AggregateError([error, auditError], '用户名已修改，但缓存失效及成功审计收尾均失败');
            }
            throw error;
        }
        try {
            await operation.markFailure(error);
        } catch (auditError) {
            throw new AggregateError([error, auditError], '用户名修改失败，且审计结果写入失败');
        }
        throw error;
    }
    try {
        await operation.markSuccess(result);
    } catch (auditError) {
        // The identity write has committed. Leave the audit in its started
        // state rather than recording a false failure.
        throw new AggregateError([auditError], '用户名已修改，但成功审计收尾失败');
    }
    return result;
}

/**
 * Rename one real user through the canonical UID while protecting the mutable
 * login name with a CAS. The unique unameLower index remains the final arbiter
 * for concurrent claims.
 */
export async function renameUsernameRecord(
    collection: UsernameRenameCollection,
    invalidate: (record: Udoc) => unknown,
    input: UsernameRenameInput,
): Promise<Udoc> {
    const expectedUnameLower = input.expectedUsername.trim().toLowerCase();
    const username = input.username.trim();
    const unameLower = username.toLowerCase();
    const current = await collection.findOne({ _id: input.uid });
    if (!current) throw new UserNotFoundError(input.uid);
    if (current.unameLower !== expectedUnameLower) throw new AccountStateConflictError(localizedErrorText`用户名已变化，请刷新页面后重试`);
    if (current.unameLower === unameLower) throw new ValidationError('username', null, localizedErrorText`新用户名不能与当前用户名相同`);

    const occupied = await collection.findOne({ _id: { $ne: input.uid }, unameLower });
    if (occupied) throw new UserAlreadyExistError(username);

    invalidate(current);
    let updated: Udoc | null;
    try {
        updated = await collection.findOneAndUpdate(
            { _id: input.uid, unameLower: expectedUnameLower },
            { $set: { uname: username, unameLower } },
            { returnDocument: 'after' },
        );
    } catch (error) {
        if ((error as any)?.code === 11000) throw new UserAlreadyExistError(username);
        throw error;
    }
    if (!updated) throw new AccountStateConflictError(localizedErrorText`用户名已变化，请刷新页面后重试`);
    // A concurrent old-name lookup may repopulate the cache between the first
    // invalidation and the committed Mongo write. Clear that identity again
    // only after the CAS succeeds, then clear the new identity as usual.
    const invalidationErrors: unknown[] = [];
    for (const record of [current, updated]) {
        try {
            invalidate(record);
        } catch (error) {
            invalidationErrors.push(error);
        }
    }
    if (invalidationErrors.length) {
        const cause = invalidationErrors.length === 1 ? invalidationErrors[0] : new AggregateError(invalidationErrors, '用户名缓存失效失败');
        throw new UsernameRenameCommittedError(updated, cause);
    }
    return updated;
}
