import { expect } from 'chai';
import { describe, it } from 'node:test';
import { PERM, PRIV } from '@hydrooj/common';

const Module = require('module');
const authPath = require.resolve('../src/auth.ts');
const originalLoad = Module._load;

interface CollectAuthUser { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean }
interface CollectRequest { ownerUid: number; collaboratorUids: number[]; kind?: 'files' | 'signing' }

interface CollectAuth {
    canCreateCollect(user: CollectAuthUser, kind?: 'files' | 'signing'): boolean;
    canManageAllCollect(user: CollectAuthUser): boolean;
    canEditCollect(user: CollectAuthUser, request: Pick<CollectRequest, 'ownerUid' | 'kind'>): boolean;
    canViewCollect(user: CollectAuthUser, request: CollectRequest): boolean;
}

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === authPath && request === 'hydrooj') {
        return { PERM, PRIV };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let auth: CollectAuth;
try {
    delete require.cache[authPath];
    auth = require(authPath) as CollectAuth;
} finally {
    Module._load = originalLoad;
}

function user(id: number, flags?: { perms?: bigint[]; privs?: number[] }): CollectAuthUser {
    const perms = new Set(flags?.perms ?? []);
    const privs = new Set(flags?.privs ?? []);
    return {
        _id: id,
        hasPerm(perm: bigint) {
            return perms.has(perm);
        },
        hasPriv(priv: number) {
            return privs.has(priv);
        },
    };
}

const request: CollectRequest = { ownerUid: 10, collaboratorUids: [20, 21] };

describe('krypton-collect auth', () => {
    it('limits signing creation and edits to system admins, even for owners and domain managers', () => {
        const signing: CollectRequest = { ...request, kind: 'signing' };
        const teacher = user(10, { perms: [PERM.PERM_CREATE_COLLECT] });
        const manager = user(5, { perms: [PERM.PERM_MANAGE_COLLECT] });
        const admin = user(7, { privs: [PRIV.PRIV_EDIT_SYSTEM] });
        for (const actor of [teacher, manager, user(20, { perms: [PERM.PERM_CREATE_COLLECT] })]) {
            expect(auth.canCreateCollect(actor, 'signing')).to.equal(false);
            expect(auth.canEditCollect(actor, signing)).to.equal(false);
        }
        expect(auth.canCreateCollect(admin, 'signing')).to.equal(true);
        expect(auth.canEditCollect(admin, signing)).to.equal(true);
        expect(auth.canViewCollect(manager, signing)).to.equal(false);
        expect(auth.canViewCollect(teacher, signing)).to.equal(false);
        expect(auth.canViewCollect(user(20, { perms: [PERM.PERM_CREATE_COLLECT] }), signing)).to.equal(true);
        expect(auth.canViewCollect(user(20), signing)).to.equal(false);
    });
    it('lets system admins, domain managers, and creators create collections', () => {
        expect(auth.canCreateCollect(user(1))).to.equal(false);
        expect(auth.canCreateCollect(user(2, { perms: [PERM.PERM_CREATE_COLLECT] }))).to.equal(true);
        expect(auth.canCreateCollect(user(3, { perms: [PERM.PERM_MANAGE_COLLECT] }))).to.equal(true);
        expect(auth.canCreateCollect(user(4, { privs: [PRIV.PRIV_EDIT_SYSTEM] }))).to.equal(true);
    });

    it('limits manage-all to system admins and PERM_MANAGE_COLLECT', () => {
        expect(auth.canManageAllCollect(user(1))).to.equal(false);
        expect(auth.canManageAllCollect(user(2, { perms: [PERM.PERM_CREATE_COLLECT] }))).to.equal(false);
        expect(auth.canManageAllCollect(user(3, { perms: [PERM.PERM_MANAGE_COLLECT] }))).to.equal(true);
        expect(auth.canManageAllCollect(user(4, { privs: [PRIV.PRIV_EDIT_SYSTEM] }))).to.equal(true);
    });

    it('lets owners and manage-all edit; collaborators cannot', () => {
        const owner = user(10);
        const collaborator = user(20, { perms: [PERM.PERM_CREATE_COLLECT] });
        const stranger = user(99, { perms: [PERM.PERM_CREATE_COLLECT] });
        const manager = user(5, { perms: [PERM.PERM_MANAGE_COLLECT] });

        expect(auth.canEditCollect(owner, request)).to.equal(true);
        expect(auth.canEditCollect(collaborator, request)).to.equal(false);
        expect(auth.canEditCollect(stranger, request)).to.equal(false);
        expect(auth.canEditCollect(manager, request)).to.equal(true);
        expect(auth.canEditCollect(user(6, { privs: [PRIV.PRIV_EDIT_SYSTEM] }), request)).to.equal(true);
    });

    it('lets owners, collaborators, and manage-all view collections', () => {
        const owner = user(10);
        const collaborator = user(20, { perms: [PERM.PERM_CREATE_COLLECT] });
        const demoted = user(20);
        const stranger = user(99);
        const manager = user(5, { perms: [PERM.PERM_MANAGE_COLLECT] });

        expect(auth.canViewCollect(owner, request)).to.equal(true);
        expect(auth.canViewCollect(collaborator, request)).to.equal(true);
        expect(auth.canViewCollect(demoted, request)).to.equal(false);
        expect(auth.canViewCollect(stranger, request)).to.equal(false);
        expect(auth.canViewCollect(manager, request)).to.equal(true);
        expect(auth.canViewCollect(user(6, { privs: [PRIV.PRIV_EDIT_SYSTEM] }), request)).to.equal(true);
    });
});
