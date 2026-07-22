import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { renameUsernameRecord, runAuditedUsernameRename } from '../src/lib/user-rename';

interface UserRecord {
    _id: number;
    uname: string;
    unameLower: string;
    mail: string;
}

function userRecord(uname = 'old-name'): UserRecord {
    return {
        _id: 42,
        uname,
        unameLower: uname.toLowerCase(),
        mail: 'student@example.com',
    };
}

async function captureError(work: () => Promise<unknown>) {
    try {
        await work();
    } catch (error) {
        return error as Error;
    }
    throw new Error('Expected operation to fail');
}

function errorText(error: Error) {
    return `${error.message} ${((error as any).params || []).join(' ')}`;
}

describe('self-service username rename', () => {
    it('renames with a UID + old-name CAS and clears an old-name cache entry repopulated during the write', async () => {
        const before = userRecord();
        const after = { ...before, uname: 'New-Name', unameLower: 'new-name' };
        const invalidated: UserRecord[] = [];
        const cachedNames = new Set([before.unameLower]);
        const filters: any[] = [];
        const collection = {
            async findOne(filter: any) {
                filters.push(filter);
                if (typeof filter._id === 'number') return before;
                return null;
            },
            async findOneAndUpdate(filter: any, update: any) {
                expect(filter).to.deep.equal({ _id: 42, unameLower: 'old-name' });
                expect(update).to.deep.equal({ $set: { uname: 'New-Name', unameLower: 'new-name' } });
                // A lookup can repopulate the old-name entry after the first
                // invalidation but before Mongo commits the rename.
                cachedNames.add(before.unameLower);
                return after;
            },
        };

        const result = await renameUsernameRecord(
            collection as any,
            (record) => {
                invalidated.push(record as UserRecord);
                cachedNames.delete(record.unameLower);
            },
            {
                uid: 42,
                expectedUsername: ' OLD-NAME ',
                username: ' New-Name ',
            },
        );

        expect(result).to.deep.equal(after);
        expect(filters).to.deep.equal([{ _id: 42 }, { _id: { $ne: 42 }, unameLower: 'new-name' }]);
        expect(invalidated).to.deep.equal([before, before, after]);
        expect(cachedNames.has('old-name')).to.equal(false);
    });

    it('rejects case-only no-op, stale forms, and an already occupied name before writing', async () => {
        const before = userRecord();
        let writes = 0;
        const collection = {
            async findOne(filter: any) {
                if (typeof filter._id === 'number') return before;
                return { ...userRecord('occupied'), _id: 99 };
            },
            async findOneAndUpdate() {
                writes++;
                return null;
            },
        };

        const noOp = await captureError(() =>
            renameUsernameRecord(collection as any, () => undefined, {
                uid: 42,
                expectedUsername: 'old-name',
                username: 'OLD-NAME',
            }),
        );
        expect(errorText(noOp)).to.match(/current username|当前用户名/i);

        const stale = await captureError(() =>
            renameUsernameRecord(collection as any, () => undefined, {
                uid: 42,
                expectedUsername: 'older-name',
                username: 'new-name',
            }),
        );
        expect(errorText(stale)).to.match(/state changed|状态.*变化|刷新/i);

        const occupied = await captureError(() =>
            renameUsernameRecord(collection as any, () => undefined, {
                uid: 42,
                expectedUsername: 'old-name',
                username: 'occupied',
            }),
        );
        expect(errorText(occupied)).to.match(/already exists|已.*占用/i);
        expect(writes).to.equal(0);
    });

    it('turns unique-index races and a failed CAS into explicit user-facing errors', async () => {
        const before = userRecord();
        const duplicateCollection = {
            async findOne(filter: any) {
                return typeof filter._id === 'number' ? before : null;
            },
            async findOneAndUpdate() {
                throw Object.assign(new Error('duplicate key'), { code: 11000 });
            },
        };
        const duplicate = await captureError(() =>
            renameUsernameRecord(duplicateCollection as any, () => undefined, {
                uid: 42,
                expectedUsername: 'old-name',
                username: 'new-name',
            }),
        );
        expect(errorText(duplicate)).to.match(/already exists|已.*占用/i);

        const staleCollection = {
            async findOne(filter: any) {
                return typeof filter._id === 'number' ? before : null;
            },
            async findOneAndUpdate() {
                return null;
            },
        };
        const stale = await captureError(() =>
            renameUsernameRecord(staleCollection as any, () => undefined, {
                uid: 42,
                expectedUsername: 'old-name',
                username: 'new-name',
            }),
        );
        expect(errorText(stale)).to.match(/state changed|状态.*变化|刷新/i);
    });

    it('never marks a committed rename as failed when success-audit finalization breaks', async () => {
        const transitions: string[] = [];
        const failure = await captureError(() =>
            runAuditedUsernameRename({
                rename: async () => {
                    transitions.push('renamed');
                    return userRecord('new-name');
                },
                markSuccess: async () => {
                    transitions.push('success-audit');
                    throw new Error('audit unavailable');
                },
                markFailure: async () => {
                    transitions.push('failed-audit');
                },
            }),
        );

        expect(transitions).to.deep.equal(['renamed', 'success-audit']);
        expect(failure.message).to.match(/renamed|modified|已修改/i);
    });

    it('records success when Mongo committed but a post-write cache invalidation fails', async () => {
        const before = userRecord();
        const after = { ...before, uname: 'new-name', unameLower: 'new-name' };
        let invalidations = 0;
        let committed = false;
        const transitions: string[] = [];
        const collection = {
            async findOne(filter: any) {
                return typeof filter._id === 'number' ? before : null;
            },
            async findOneAndUpdate() {
                committed = true;
                return after;
            },
        };

        const failure = await captureError(() =>
            runAuditedUsernameRename({
                rename: () =>
                    renameUsernameRecord(
                        collection as any,
                        () => {
                            invalidations++;
                            if (invalidations === 2) throw new Error('broadcast failed after commit');
                        },
                        { uid: 42, expectedUsername: 'old-name', username: 'new-name' },
                    ),
                markSuccess: async () => {
                    transitions.push('success');
                },
                markFailure: async () => {
                    transitions.push('failed');
                },
            }),
        );

        expect(committed).to.equal(true);
        expect(invalidations).to.equal(3);
        expect(transitions).to.deep.equal(['success']);
        expect(failure.message).to.match(/cache|缓存|已修改/i);
    });

    it('marks the audit failed only when the rename itself did not commit', async () => {
        const transitions: string[] = [];
        const failure = await captureError(() =>
            runAuditedUsernameRename({
                rename: async () => {
                    transitions.push('rename-failed');
                    throw new Error('mongo unavailable');
                },
                markSuccess: async () => {
                    transitions.push('success-audit');
                },
                markFailure: async () => {
                    transitions.push('failed-audit');
                },
            }),
        );

        expect(transitions).to.deep.equal(['rename-failed', 'failed-audit']);
        expect(failure.message).to.equal('mongo unavailable');
    });

    it('wires password reauthentication, impersonation actor audit, and a session-preserving UI form', () => {
        const handler = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/home.ts'), 'utf8');
        const page = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/user-account.tsx'), 'utf8');
        const start = handler.indexOf('async postChangeUsername');
        const end = handler.indexOf('async postChangePassword', start);
        expect(start).to.be.greaterThan(-1);
        expect(end).to.be.greaterThan(start);
        const method = handler.slice(start, end);

        expect(handler).to.include("@param('username', Types.Username)");
        expect(handler).to.include("@param('expectedUsername', Types.String)");
        expect(method).to.include('this.session.sudoUid');
        expect(method).to.include('assertImpersonationActorPrivileges');
        expect(method).to.include('checkPassword(current)');
        expect(method).to.include('actorUid');
        expect(method).to.include('renameUname');
        expect(method).to.include("type: 'user.rename'");
        expect(method).to.include("result: 'started'");
        expect(method).to.include('runAuditedUsernameRename');
        expect(method).not.to.include('token.delByUid');
        expect(method.indexOf('checkPassword(current)')).to.be.lessThan(method.indexOf('renameUname'));

        expect(page).to.include('修改用户名');
        expect(page).to.include('name="operation" value="change_username"');
        expect(page).to.include('name="username"');
        expect(page).to.include('name="expectedUsername"');
        expect(page).to.include('name="current"');
        expect(page).to.include('bs.user.name');
        expect(page).not.to.include('旧用户名将保留');
        expect(page).not.to.include('旧用户名仍可登录');
    });
});
