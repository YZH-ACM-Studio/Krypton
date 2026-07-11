import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(path) {
    try {
        return readFileSync(resolve(ROOT, path), 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') return '';
        throw error;
    }
}

const workspace = read('packages/ui-next/src/components/management/module-workspace.tsx');
const userbind = read('packages/ui-next/src/pages/userbind/index.tsx');
const sidebar = read('packages/ui-next/src/components/layout/sidebar.tsx');
const domainAdmin = read('packages/ui-next/src/pages/admin.tsx');
const userbindHandler = read('packages/krypton-userbind/src/handler.ts');
const rankboardAdmin = read('packages/ui-next/src/pages/rankboard/admin.tsx');
const bootstrap = read('packages/ui-next/index.ts');

test('management workspace exposes reusable active, gate, toolbar, and content contracts', () => {
    assert.match(workspace, /export interface ModuleWorkspaceNavItem/);
    assert.match(workspace, /templateNames\?: readonly string\[\]/);
    assert.match(workspace, /activeKey\?: string/);
    assert.match(workspace, /toolbar\?: ReactNode/);
    assert.match(workspace, /bypassPrivGate\?: boolean/);
    assert.match(workspace, /resolveModuleWorkspaceActiveKey/);
    assert.match(workspace, /<AdminPage[\s\S]*?hideSidebar/);
});

test('management workspace active resolution fails fast for unknown keys and templates', () => {
    assert.match(workspace, /Unknown module workspace active key: \$\{activeKey\}/);
    assert.doesNotMatch(workspace, /\)\?\.key;/);
    assert.match(workspace, /const matchedItem = items\.find/);
    assert.match(
        workspace,
        /if \(!matchedItem\) \{[\s\S]*?No module workspace navigation item matches template: \$\{templateName\}/,
    );
});

test('management workspace navigation is accessible, compact, and reduced-motion aware', () => {
    assert.match(workspace, /<nav[\s\S]*?aria-label=/);
    assert.match(workspace, /aria-current=\{active \? 'page' : undefined\}/);
    assert.match(workspace, /overflow-x-auto/);
    assert.match(workspace, /min-h-11/);
    assert.match(workspace, /focus-visible:ring-2/);
    assert.match(workspace, /duration-200/);
    assert.match(workspace, /motion-reduce:transition-none/);
    assert.doesNotMatch(workspace, /backdrop-blur|gradient/);
});

test('userbind admin pages use one workspace and no longer register an admin-nav section', () => {
    assert.doesNotMatch(userbind, /registerAdminNavSection/);
    assert.match(userbind, /ModuleWorkspace/);
    assert.equal((userbind.match(/<ModuleWorkspace\b/g) || []).length, 9);
    assert.doesNotMatch(userbind, /<AdminPage\b/);

    const contracts = [
        ['学校', '/admin/userbind/schools', 'admin_userbind_schools.html', 'admin_userbind_school_detail.html'],
        ['班级与队伍', '/admin/userbind/groups', 'admin_userbind_groups.html', 'admin_userbind_group_detail.html'],
        ['学生', '/admin/userbind/students', 'admin_userbind_students.html'],
        ['批量导入', '/admin/userbind/students/import', 'admin_userbind_students_import.html'],
        ['邀请令牌', '/admin/userbind/tokens', 'admin_userbind_tokens.html'],
        ['绑定申请', '/admin/userbind/requests', 'admin_userbind_requests.html'],
    ];
    for (const contract of contracts) {
        for (const value of contract) assert.ok(userbind.includes(value), `missing userbind workspace contract: ${value}`);
    }
});

test('main sidebar exposes exactly one complete userbind entry inside the system-admin branch', () => {
    assert.equal((sidebar.match(/label: '用户绑定'/g) || []).length, 1);
    const systemGateStart = sidebar.indexOf("if (canSeeAdminAffordance(userCtx, 'systemAdmin'))");
    const systemGateEnd = sidebar.indexOf('\n      return {', systemGateStart);
    assert.notEqual(systemGateStart, -1);
    assert.notEqual(systemGateEnd, -1);
    const systemAdminBlock = sidebar.slice(systemGateStart, systemGateEnd);
    assert.match(systemAdminBlock, /label: '用户绑定'/);
    assert.match(systemAdminBlock, /href: '\/admin\/userbind\/schools'/);
    for (const template of [
        'admin_userbind_overview.html',
        'admin_userbind_schools.html',
        'admin_userbind_school_detail.html',
        'admin_userbind_groups.html',
        'admin_userbind_group_detail.html',
        'admin_userbind_students.html',
        'admin_userbind_students_import.html',
        'admin_userbind_tokens.html',
        'admin_userbind_requests.html',
    ]) {
        assert.ok(systemAdminBlock.includes(template), `sidebar userbind entry missing ${template}`);
    }
});

test('domain dashboard drops the forbidden shortcut while student self-service stays registered', () => {
    assert.doesNotMatch(domainAdmin, /学生 \/ 班级 \/ 学校（用户绑定）/);
    assert.doesNotMatch(domainAdmin, /href: '\/admin\/userbind'/);

    for (const component of [
        'UserBindPage',
        'UserBindApplicationsPage',
        'UserBindLandingPage',
        'UserBindClaimPage',
    ]) {
        assert.match(userbind, new RegExp(`export function ${component}\\(`));
    }
    for (const route of [
        "ctx.Route('user_bind', '/userbind'",
        "ctx.Route('user_bind_applications', '/userbind/applications'",
        "ctx.Route('user_bind_claim', '/userbind/claim'",
        "ctx.Route('user_bind_landing', '/bind/:token'",
    ]) {
        assert.ok(userbindHandler.includes(route), `student route changed or missing: ${route}`);
    }
});

test('rankboard admin pages reuse the management workspace without legacy admin navigation', () => {
    assert.doesNotMatch(rankboardAdmin, /registerAdminNavSection/);
    assert.doesNotMatch(rankboardAdmin, /<AdminPage\b/);
    assert.match(rankboardAdmin, /ModuleWorkspace/);
    assert.equal((rankboardAdmin.match(/<ModuleWorkspace\b/g) || []).length, 3);

    for (const value of [
        '人员', '/admin/rankboard?section=people',
        '批量导入', '/admin/rankboard?section=import',
        '奖项类型', '/admin/rankboard/awards',
        '计分设置', '/admin/rankboard?section=settings',
    ]) assert.ok(rankboardAdmin.includes(value), `missing rankboard workspace contract: ${value}`);
    assert.match(rankboardAdmin, /activeKey=\{data\.section\}/);
    assert.match(rankboardAdmin, /activeKey="people"/);
    assert.match(rankboardAdmin, /activeKey="awards"/);
    assert.match(rankboardAdmin, /rankboardWorkspaceNav\(data\.canManage\)/);
    assert.match(rankboardAdmin, /RANKBOARD_WORKSPACE_NAV\.filter\(\(item\) => !item\.manageOnly\)/);
    assert.doesNotMatch(rankboardAdmin, /PRIV_USER_PROFILE/);
});

test('rankboard sections keep people, import history, and settings as separate task views', () => {
    assert.match(rankboardAdmin, /data\.section === 'people'/);
    assert.match(rankboardAdmin, /data\.section === 'import'/);
    assert.match(rankboardAdmin, /data\.section === 'settings'/);
    assert.match(rankboardAdmin, /function ImportBatchesSection/);
    assert.match(rankboardAdmin, /function RankboardSettingsSection/);
    assert.match(rankboardAdmin, /未匹配学号自动建档/);
    assert.match(rankboardAdmin, /operation: 'rollbackBatch'/);
    assert.match(rankboardAdmin, /operation" value="config"/);
});

test('main sidebar uses server rankboard capability and preserves the public rankboard entry', () => {
    assert.equal((sidebar.match(/label: '荣誉榜'/g) || []).length, 1);
    assert.match(sidebar, /label: '荣誉榜'[\s\S]*?href: '\/rankboard'[\s\S]*?'rankboard_main\.html', 'rankboard_detail\.html'/);
    assert.equal((sidebar.match(/label: '荣誉管理'/g) || []).length, 1);
    assert.match(sidebar, /bs\.user\.canImportRankboard \|\| bs\.user\.canManageRankboard/);
    assert.match(sidebar, /label: '荣誉管理'[\s\S]*?href: '\/admin\/rankboard\?section=people'/);
    for (const template of [
        'admin_rankboard.html', 'admin_rankboard_person.html', 'admin_rankboard_awards.html',
    ]) assert.ok(sidebar.includes(template), `sidebar rankboard entry missing ${template}`);
});

test('bootstrap publishes explicit server-computed rankboard capabilities', () => {
    assert.match(bootstrap, /resolveRankboardCapabilities/);
    assert.match(bootstrap, /onError[\s\S]*?console\.error\('\[ui-next\] rankboard capability resolution failed:'/);
    assert.match(bootstrap, /canImportRankboard: rankboardCapabilities\.canImportRankboard/);
    assert.match(bootstrap, /canManageRankboard: rankboardCapabilities\.canManageRankboard/);
});
