import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { assertImpersonationActorPrivileges, resolveSudoAuthenticationUser } from '../src/lib/sudo-auth';

async function captureError(work: () => Promise<unknown>) {
    try {
        await work();
    } catch (error) {
        return error as Error;
    }
    throw new Error('Expected operation to fail');
}

describe('sudo authentication while impersonating another account', () => {
    it('uses the original administrator identity recorded in sudoUid', async () => {
        const target = { _id: 73, uname: 'student' };
        const administrator = { _id: 2, uname: 'root' };
        const loaded: number[] = [];

        const resolved = await resolveSudoAuthenticationUser(target, 2, async (uid) => {
            loaded.push(uid);
            return uid === 2 ? administrator : null;
        });

        expect(resolved).to.deep.equal({ user: administrator, impersonated: true });
        expect(loaded).to.deep.equal([2]);
    });

    it('keeps normal sudo bound to the current account without a lookup', async () => {
        const current = { _id: 73, uname: 'student' };
        let loads = 0;

        const resolved = await resolveSudoAuthenticationUser(current, null, async () => {
            loads++;
            return null;
        });

        expect(resolved).to.deep.equal({ user: current, impersonated: false });
        expect(loads).to.equal(0);
    });

    it('fails closed when the impersonation actor identity is invalid or missing', async () => {
        const current = { _id: 73, uname: 'student' };
        const invalid = await captureError(() => resolveSudoAuthenticationUser(current, 'not-a-uid', async () => null));
        const missing = await captureError(() => resolveSudoAuthenticationUser(current, 2, async () => null));

        expect(`${invalid.message} ${((invalid as any).params || []).join(' ')}`).to.match(/impersonation|proxy|代理/i);
        expect(`${missing.message} ${((missing as any).params || []).join(' ')}`).to.match(/not found|不存在|2/i);
    });

    it('fails closed when an established impersonation actor loses either required privilege', () => {
        const privileges = new Set([1, 2]);
        const actor = { _id: 2, hasPriv: (privilege: number) => privileges.has(privilege) };

        expect(() => assertImpersonationActorPrivileges(actor, [1, 2])).not.to.throw();
        privileges.delete(1);
        let revoked: Error | null = null;
        try {
            assertImpersonationActorPrivileges(actor, [1, 2]);
        } catch (error) {
            revoked = error as Error;
        }
        expect(revoked).not.to.equal(null);
        expect(`${revoked!.message} ${((revoked as any).params || []).join(' ')}`).to.match(/no longer|无权|权限/i);
    });

    it('wires proxy sudo to password-only authentication of the resolved actor', () => {
        const handler = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/user.ts'), 'utf8');
        const template = readFileSync(resolve(process.cwd(), 'packages/ui-default/templates/user_sudo.html'), 'utf8');
        const start = handler.indexOf('class UserSudoHandler');
        const end = handler.indexOf('class UserTFAHandler', start);
        expect(start).to.be.greaterThan(-1);
        expect(end).to.be.greaterThan(start);
        const sudoHandler = handler.slice(start, end);

        expect(handler).to.include('resolveSudoAuthenticationUser');
        expect(sudoHandler).to.include('actorUid');
        expect(sudoHandler).to.include('targetUid');
        expect(sudoHandler).to.match(/if \(impersonated\)[\s\S]*authUser\.checkPassword\(password\)/);
        expect(handler).to.include('assertImpersonationActorPrivileges');
        expect(template).to.include('not impersonated and UserContext.authn');
        expect(template).to.include('not impersonated and UserContext.tfa');
        expect(template).to.include("SuperUser's Password");
    });
});
