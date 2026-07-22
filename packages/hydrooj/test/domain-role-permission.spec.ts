import { expect } from 'chai';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

(global as any).Hydro ||= { model: {}, module: {} };
(global as any).Hydro.model ||= {};

const {
    buildDomainRolePermissionUpdate,
    createDomainRole,
    deleteDomainRole,
    DOMAIN_PERMISSION_DEFINITIONS,
    loadDomainPermissionWorkspace,
    parseDomainPermissionSelection,
    resolveCurrentDomainId,
    updateDomainRolePermissions,
} = require('../src/lib/domain-role-permission.ts');

class FakeRoleRepository {
    roles = new Map<string, bigint>([
        ['root', -1n],
        ['default', 0n],
        ['teacher', 16n],
        ['guest', 1n],
        ['reviewer', 0n],
        ['other', 4n],
    ]);

    members = new Map<string, number>([
        ['root', 1],
        ['default', 8],
        ['teacher', 3],
        ['guest', 0],
        ['reviewer', 5],
        ['other', 2],
    ]);

    forceUpdateConflict = false;

    async getRoles() {
        return [...this.roles].map(([_id, perm]) => ({ _id, perm }));
    }

    async countUser(_domainId: string, role: string) {
        return this.members.get(role) || 0;
    }

    async compareAndSetRolePermission(_domainId: string, role: string, expected: bigint, next: bigint) {
        if (this.forceUpdateConflict || this.roles.get(role) !== expected) return { state: 'conflict' as const };
        this.roles.set(role, next);
        return { state: 'updated' as const };
    }

    async addRoleFromDefault(_domainId: string, role: string, expectedDefault: bigint) {
        if (this.roles.has(role)) return { state: 'exists' as const };
        if (this.roles.get('default') !== expectedDefault) return { state: 'conflict' as const };
        this.roles.set(role, expectedDefault);
        this.members.set(role, 0);
        return { state: 'created' as const };
    }

    async deleteRoleWithFallback(_domainId: string, role: string) {
        if (!this.roles.has(role)) return { state: 'missing' as const };
        const affectedUsers = this.members.get(role) || 0;
        this.roles.delete(role);
        this.members.delete(role);
        this.members.set('default', (this.members.get('default') || 0) + affectedUsers);
        return { state: 'deleted' as const, affectedUsers };
    }
}

function expectValidationError(callback: () => unknown) {
    try {
        callback();
        throw new Error('Expected validation to fail');
    } catch (error) {
        expect((error as Error).name).to.equal('ValidationError');
    }
}

describe('domain role permission workspace service', () => {
    it('rejects a request domain that differs from the framework current domain', () => {
        expect(resolveCurrentDomainId('system', 'system')).to.equal('system');
        expectValidationError(() => resolveCurrentDomainId('other', 'system'));
        expectValidationError(() => resolveCurrentDomainId('system', undefined));
    });

    it('exposes the complete 75-permission, 13-family catalog', () => {
        expect(DOMAIN_PERMISSION_DEFINITIONS).to.have.lengthOf(75);
        expect(new Set(DOMAIN_PERMISSION_DEFINITIONS.map((permission: any) => permission.family)).size).to.equal(13);
        expect(new Set(DOMAIN_PERMISSION_DEFINITIONS.map((permission: any) => permission.key.toString())).size).to.equal(75);
    });

    it('has explicit Simplified Chinese names for every permission and family', () => {
        const locale = readFileSync(resolve(process.cwd(), 'packages/hydrooj/locales/zh.yaml'), 'utf8').split('\n');
        for (const permission of DOMAIN_PERMISSION_DEFINITIONS) {
            expect(locale.some((line) => line.startsWith(`${permission.desc}:`)), permission.desc).to.equal(true);
        }
        for (const family of new Set<string>(DOMAIN_PERMISSION_DEFINITIONS.map((permission: any) => String(permission.family)))) {
            expect(locale.some((line) => line.startsWith(`${family}:`)), family).to.equal(true);
        }
    });

    it('round-trips the highest permission bit and keeps unrelated roles unchanged', async () => {
        const repository = new FakeRoleRepository();
        const highest = 1n << 80n;
        const result = await updateDomainRolePermissions(repository, {
            domainId: 'system',
            role: 'reviewer',
            expectedMask: '0',
            submittedMask: highest.toString(),
            permissions: [highest.toString()],
        });

        expect(result.mask).to.equal(highest.toString());
        expect(result.permissionCount).to.equal(1);
        expect(result.affectedUsers).to.equal(5);
        expect(repository.roles.get('reviewer')).to.equal(highest);
        expect(repository.roles.get('other')).to.equal(4n);
    });

    it('round-trips every known bit from 0 through 80 in one role mask', async () => {
        const repository = new FakeRoleRepository();
        const bits = DOMAIN_PERMISSION_DEFINITIONS.map((permission: any) => permission.key.toString());
        const allMask = DOMAIN_PERMISSION_DEFINITIONS.reduce((mask: bigint, permission: any) => mask | permission.key, 0n);
        const result = await updateDomainRolePermissions(repository, {
            domainId: 'system',
            role: 'reviewer',
            expectedMask: '0',
            submittedMask: allMask.toString(),
            permissions: bits,
        });
        expect(result.permissionCount).to.equal(75);
        expect(result.mask).to.equal(allMask.toString());
        expect(repository.roles.get('reviewer')).to.equal(allMask);
    });

    it('supports selecting nothing without overwriting other roles', async () => {
        const repository = new FakeRoleRepository();
        repository.roles.set('reviewer', 1n);
        const result = await updateDomainRolePermissions(repository, {
            domainId: 'system',
            role: 'reviewer',
            expectedMask: '1',
            submittedMask: '0',
            permissions: undefined,
        });
        expect(result.mask).to.equal('0');
        expect(repository.roles.get('reviewer')).to.equal(0n);
        expect(repository.roles.get('other')).to.equal(4n);
    });

    it('preserves unknown stored bits while rejecting unknown, duplicate and non-single-bit selections', () => {
        const reserved = 1n << 3n;
        const visible = 1n;
        const update = buildDomainRolePermissionUpdate({
            expectedMask: reserved.toString(),
            submittedMask: (reserved | visible).toString(),
            permissions: [visible.toString()],
        });
        expect(update.next).to.equal(reserved | visible);

        expectValidationError(() => parseDomainPermissionSelection([reserved.toString()]));
        expectValidationError(() => parseDomainPermissionSelection(['3']));
        expectValidationError(() => parseDomainPermissionSelection(['1', '1']));
    });

    it('returns a 409 conflict for stale expected masks and CAS races', async () => {
        const stale = new FakeRoleRepository();
        stale.roles.set('reviewer', 1n);
        await assert.rejects(
            updateDomainRolePermissions(stale, {
                domainId: 'system',
                role: 'reviewer',
                expectedMask: '0',
                submittedMask: '1',
                permissions: ['1'],
            }),
            { name: 'DomainRolePermissionConflictError' },
        );

        const racing = new FakeRoleRepository();
        racing.forceUpdateConflict = true;
        await assert.rejects(
            updateDomainRolePermissions(racing, {
                domainId: 'system',
                role: 'reviewer',
                expectedMask: '0',
                submittedMask: '1',
                permissions: ['1'],
            }),
            { name: 'DomainRolePermissionConflictError' },
        );
    });

    it('keeps root read-only and protects all four built-in roles from deletion', async () => {
        const repository = new FakeRoleRepository();
        await assert.rejects(
            updateDomainRolePermissions(repository, {
                domainId: 'system',
                role: 'root',
                expectedMask: '0',
                submittedMask: '0',
                permissions: [],
            }),
            { name: 'ValidationError' },
        );

        for (const role of ['root', 'guest', 'default', 'teacher']) {
            await assert.rejects(deleteDomainRole(repository, 'system', role), { name: 'ValidationError' });
        }
    });

    it('creates from the current default mask and deletes custom roles into default', async () => {
        const repository = new FakeRoleRepository();
        repository.roles.set('default', 17n);
        const created = await createDomainRole(repository, 'system', 'grader');
        expect(created.perm).to.equal('17');
        expect(repository.roles.get('grader')).to.equal(17n);

        const deleted = await deleteDomainRole(repository, 'system', 'reviewer');
        expect(deleted).to.deep.equal({ role: 'reviewer', affectedUsers: 5, fallbackRole: 'default' });
        expect(repository.roles.has('reviewer')).to.equal(false);
        expect(repository.members.get('default')).to.equal(13);
    });

    it('loads root as read-only and teacher as editable but non-deletable with member counts', async () => {
        const roles = await loadDomainPermissionWorkspace(new FakeRoleRepository(), 'system');
        expect(roles[0]).to.include({ id: 'root', perm: '-1', memberCount: 1, type: 'root', editable: false, deletable: false });
        expect(roles.find((role: any) => role.id === 'teacher')).to.include({ type: 'builtin', editable: true, deletable: false, memberCount: 3 });
        expect(roles.find((role: any) => role.id === 'reviewer')).to.include({ type: 'custom', editable: true, deletable: true, memberCount: 5 });
    });
});
