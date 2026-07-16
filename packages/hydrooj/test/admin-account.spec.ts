import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
    ACCOUNT_BULK_LIMIT,
    SUPERADMIN_UID,
    buildAccountCsv,
    filterAndSortAccountRows,
    markCanonicalImportDuplicates,
    normalizeTargetUids,
    paginateAccountRows,
    parseAccountImport,
    parseAccountImportForCommit,
    redactAccountSecrets,
    resolveRestoredPrivilege,
    validateAccountTarget,
} from '../src/lib/admin-account';

const BASE_FILTER = {
    q: '',
    status: 'all',
    admin: 'all',
    security: 'all',
    binding: 'all',
    registeredFrom: null,
    registeredTo: null,
    loginFrom: null,
    loginTo: null,
    sort: 'uid',
    order: 'asc',
};

const LIST_ROWS = [
    {
        uid: 7,
        username: 'teacher',
        email: 'teacher@example.com',
        displayName: '王老师',
        school: '中国民航大学',
        studentId: '',
        status: 'enabled',
        isAdmin: true,
        hasTfa: true,
        hasWebAuthn: false,
        oauthProviders: [],
        binding: null,
        registeredAt: '2026-06-01T00:00:00.000Z',
        lastLoginAt: '2026-07-10T00:00:00.000Z',
    },
    {
        uid: 9,
        username: 'student-b',
        email: 'b@example.com',
        displayName: '李四',
        school: '航大',
        studentId: '24002',
        status: 'enabled',
        isAdmin: false,
        hasTfa: false,
        hasWebAuthn: true,
        oauthProviders: ['github'],
        binding: { realName: '李四', studentId: '24002' },
        registeredAt: '2026-07-02T00:00:00.000Z',
        lastLoginAt: '2026-07-12T00:00:00.000Z',
    },
    {
        uid: 8,
        username: 'student-a',
        email: 'a@example.com',
        displayName: '张三',
        school: '其他学校',
        studentId: '24001',
        status: 'disabled',
        isAdmin: false,
        hasTfa: false,
        hasWebAuthn: false,
        oauthProviders: [],
        binding: { realName: '张三', studentId: '24001' },
        registeredAt: '2026-07-01T00:00:00.000Z',
        lastLoginAt: null,
    },
];

describe('admin account management contracts', () => {
    it('protects UID 2 and rejects unsafe targets before writes', () => {
        expect(SUPERADMIN_UID).to.equal(2);
        expect(() => validateAccountTarget({ actorUid: 9, targetUid: 2, targetPriv: -1, operation: 'profile' })).to.throw(/UID 2/);
        expect(() => validateAccountTarget({ actorUid: 9, targetUid: 9, targetPriv: 3, operation: 'disable' })).to.throw(/当前管理员/);
        expect(() => validateAccountTarget({ actorUid: 9, targetUid: 10, targetPriv: 1, operation: 'disable' })).to.throw(/系统管理员/);
        expect(() => validateAccountTarget({ actorUid: 9, targetUid: 10, targetPriv: 1, operation: 'impersonate' })).to.throw(/系统管理员/);
        expect(() => validateAccountTarget({ actorUid: 9, targetUid: 10, targetPriv: 3, operation: 'profile' })).not.to.throw();
    });

    it('normalizes bounded unique positive target lists', () => {
        expect(normalizeTargetUids('5,3,5,4')).to.deep.equal([3, 4, 5]);
        expect(() => normalizeTargetUids('2,nope')).to.throw(/UID/);
        expect(() => normalizeTargetUids(Array.from({ length: ACCOUNT_BULK_LIMIT + 1 }, (_, i) => i + 3).join(','))).to.throw(/100/);
    });

    it('applies every account-list filter on the server-side row set', () => {
        expect(filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, q: '24002' }).map((row) => row.uid)).to.deep.equal([9]);
        expect(filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, status: 'disabled' }).map((row) => row.uid)).to.deep.equal([8]);
        expect(filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, admin: 'yes' }).map((row) => row.uid)).to.deep.equal([7]);
        expect(filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, security: 'oauth' }).map((row) => row.uid)).to.deep.equal([9]);
        expect(filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, security: 'none' }).map((row) => row.uid)).to.deep.equal([8]);
        expect(filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, binding: 'unbound' }).map((row) => row.uid)).to.deep.equal([7]);
        expect(filterAndSortAccountRows(LIST_ROWS, {
            ...BASE_FILTER,
            registeredFrom: new Date('2026-07-01T12:00:00.000Z'),
        }).map((row) => row.uid)).to.deep.equal([9]);
        expect(filterAndSortAccountRows(LIST_ROWS, {
            ...BASE_FILTER,
            loginTo: new Date('2026-07-11T00:00:00.000Z'),
        }).map((row) => row.uid)).to.deep.equal([7]);
        expect(filterAndSortAccountRows(LIST_ROWS, BASE_FILTER, {
            groupMembers: new Set([7, 9]),
            roleMembers: new Set([9]),
        }).map((row) => row.uid)).to.deep.equal([9]);
    });

    it('sorts and paginates deterministically and strips admin authority on restore', () => {
        const sorted = filterAndSortAccountRows(LIST_ROWS, { ...BASE_FILTER, sort: 'username', order: 'desc' });
        expect(sorted.map((row) => row.username)).to.deep.equal(['teacher', 'student-b', 'student-a']);
        expect(paginateAccountRows(sorted, 99, 2)).to.deep.equal({ rows: [sorted[2]], page: 2, pageSize: 2, pageCount: 2 });
        expect(paginateAccountRows(Array.from({ length: 120 }, (_, index) => index), 1, 500).pageSize).to.equal(100);
        expect(resolveRestoredPrivilege(1 | 4 | 8, 4 | 8)).to.equal(4 | 8);
        expect(resolveRestoredPrivilege(undefined, 4 | 8)).to.equal(4 | 8);
        expect(() => resolveRestoredPrivilege(undefined, 1)).to.throw(/默认权限/);
    });

    it('redacts every account credential recursively without mutating the source', () => {
        const source = {
            password: 'actor-secret',
            newPassword: 'target-secret',
            verifyPassword: 'target-secret',
            nested: { adminPassword: 'nested-secret', token: 'plain-token', tokenType: 0, label: 'safe' },
        };
        const redacted = redactAccountSecrets(source);
        expect(redacted).to.deep.equal({ nested: { tokenType: 0, label: 'safe' } });
        expect(source.newPassword).to.equal('target-secret');
    });

    it('parses imports with explicit per-line failures and never echoes passwords', () => {
        const rows = parseAccountImport([
            'one@example.com\tone\tSecret123\t张三\t{"group":"一班","school":"航大"}',
            'broken@example.com,broken',
            'two@example.com,two,Secret456,李四,{bad json}',
        ].join('\n'));
        expect(rows).to.have.lengthOf(3);
        expect(rows[0]).to.include({ line: 1, email: 'one@example.com', username: 'one', displayName: '张三', passwordPresent: true, status: 'ok' });
        expect(rows[0].extra).to.deep.equal({ group: '一班', school: '航大' });
        expect(rows[0]).not.to.have.property('password');
        expect(rows[1].status).to.equal('invalid');
        expect(rows[2].status).to.equal('invalid');
        expect(rows[2].message).to.match(/JSON/);
        const secretExtra = parseAccountImport('leak@example.com\tleak\tSecret789\t\t{"password":"must-not-pass"}')[0];
        expect(secretExtra.status).to.equal('invalid');
        expect(secretExtra.message).to.match(/不支持的字段/);
        expect(secretExtra.extra).not.to.have.property('password');
    });

    it('rejects canonical email aliases within one import batch before writes', () => {
        const rows = parseAccountImportForCommit([
            'first.last+teacher@gmail.com\tfirst\tSecret123',
            'firstlast@googlemail.com\tsecond\tSecret456',
        ].join('\n'));
        const canonical = markCanonicalImportDuplicates(rows, (mail) => {
            const [local, rawDomain] = mail.trim().toLowerCase().split('@');
            const [withoutAlias] = local.split('+');
            return `${withoutAlias.replaceAll('.', '')}@${rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain}`;
        });
        expect(canonical.map((row) => row.status)).to.deep.equal(['ok', 'duplicate']);
    });

    it('exports Excel-compatible safe CSV without credentials', () => {
        const csv = buildAccountCsv([{
            uid: 7,
            username: '=HYPERLINK("x")',
            email: '+danger@example.com',
            displayName: '张三',
            status: '正常',
            school: '中国民航大学',
            studentId: '24001',
            priv: 3,
            registeredAt: new Date('2026-07-01T00:00:00.000Z'),
            lastLoginAt: new Date('2026-07-02T00:00:00.000Z'),
        }]);
        expect(Array.from(Buffer.from(csv).subarray(0, 3))).to.deep.equal([0xef, 0xbb, 0xbf]);
        expect(csv.endsWith('\r\n')).to.equal(true);
        expect(csv).to.include("'=HYPERLINK");
        expect(csv).to.include("'+danger@example.com");
        expect(csv).not.to.match(/password|hash|token|secret/i);
    });

    it('wires one gated route and removes direct GET impersonation', () => {
        const handler = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/admin-account.ts'), 'utf8');
        const misc = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/misc.ts'), 'utf8');
        const resolver = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/resolver.tsx'), 'utf8');
        const sidebar = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/components/layout/sidebar.tsx'), 'utf8');
        const page = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/pages/admin-accounts.tsx'), 'utf8');
        const manage = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/manage.ts'), 'utf8');
        const router = readFileSync(resolve(process.cwd(), 'packages/ui-next/src/router.tsx'), 'utf8');
        const oplog = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/oplog.ts'), 'utf8');
        const token = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/token.ts'), 'utf8');

        expect(handler).to.include("ctx.Route('admin_accounts', '/admin/accounts', AdminAccountsHandler, PRIV.PRIV_EDIT_SYSTEM)");
        expect(handler).to.include("ctx.Route('admin_accounts_return', '/admin/accounts/return', AdminAccountsReturnHandler)");
        expect(handler).to.include("export const inject = ['oauth']");
        expect(handler).to.include('this.checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(handler).to.include('auditAccountOperation');
        expect(handler).not.to.include('cleanUserEffect');
        expect(handler).to.include('nextPriv === PRIV.PRIV_NONE');
        expect(handler).to.include('isUsableSystemAdmin');
        expect(handler).to.include('markCanonicalImportDuplicates(validated, handleMailLower)');
        expect(handler).to.include('assertExpectedProfileVersion');
        expect(handler).to.include('assertExpectedPrivilege');
        const passwordHandler = handler.slice(handler.indexOf('async postPassword'), handler.indexOf('async postDisable'));
        expect(passwordHandler).to.include('revokeAccountAccess');
        expect(passwordHandler).to.include('user.setPassword');
        expect(passwordHandler.indexOf('revokeAccountAccess')).to.be.lessThan(passwordHandler.indexOf('user.setPassword'));
        const privilegeHandler = handler.slice(handler.indexOf('async postPrivilege'), handler.indexOf('async postSecurity'));
        expect(privilegeHandler).to.include('revokeAccountAccess');
        expect(privilegeHandler).to.include('user.setPriv');
        expect(privilegeHandler.indexOf('revokeAccountAccess')).to.be.lessThan(privilegeHandler.indexOf('user.setPriv'));
        expect(misc).not.to.include('this.session.sudoUid = this.user._id');
        expect(resolver).to.include("'admin_accounts.html': AdminAccountsPage");
        expect(sidebar).to.include("href: '/admin/accounts'");
        expect(manage).to.include("this.response.redirect = '/admin/accounts?view=import'");
        expect(manage).to.include("this.response.redirect = '/admin/accounts?view=permissions'");
        expect(router).to.include('bs.user.impersonation');
        expect(router).to.include('bs.user.impersonation.startedAt');
        expect(router).to.include('action="/admin/accounts/return"');
        expect(oplog).to.include('json: safeKeys(cloneDeep(handler.request.json))');
        expect(handler).to.include('progress: redactAccountSecrets(context.progress)');
        expect(token).to.include('{ tokenType: TokenModel.TYPE_SESSION, sudoUid: uid }');
        expect(token).to.include('delAccountAccessByUid');
        expect(page).to.include("window.addEventListener('popstate'");
        expect(page).to.include('expectedProfileVersion');
        for (const section of ['基本资料', '账号安全', '权限与成员关系', '关联数据', '操作审计']) expect(page).to.include(section);
        expect(page).to.include('<Dialog');
        expect(page).not.to.match(/window\.(?:alert|confirm|prompt)\s*\(/);
        expect(page).not.to.match(/passwordHash|credentialPublicKey|attestationObject/);
    });
});
