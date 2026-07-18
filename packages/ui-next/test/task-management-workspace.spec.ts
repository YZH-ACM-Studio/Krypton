import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { resolveTaskManagementCapability } from '../task-capabilities.ts';

const PRIV_EDIT_SYSTEM = 1;
const PERM_CREATE_TASK = 2n;
const PERM_MANAGE_TASKS = 4n;

function capability(
  user: any,
  onError: (error: unknown) => void = (error) => {
    throw error;
  },
) {
  return resolveTaskManagementCapability({
    user,
    editSystemPriv: PRIV_EDIT_SYSTEM,
    createTaskPerm: PERM_CREATE_TASK,
    manageTasksPerm: PERM_MANAGE_TASKS,
    onError,
  });
}

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('task management capability', () => {
  it('allows system editors, domain task managers, and domain task creators', () => {
    expect(capability({ hasPriv: () => true, hasPerm: () => false })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_MANAGE_TASKS })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: (perm: bigint) => perm === PERM_CREATE_TASK })).to.equal(true);
    expect(capability({ hasPriv: () => false, hasPerm: () => false })).to.equal(false);
  });

  it('fails closed and reports missing or failing permission checks', () => {
    expect(capability(undefined)).to.equal(false);
    const observed: unknown[] = [];
    expect(capability({ hasPriv: () => false }, (error) => observed.push(error))).to.equal(false);
    expect(observed[0]).to.be.instanceOf(TypeError);

    const failure = new Error('permission lookup failed');
    expect(
      capability(
        {
          hasPriv: () => {
            throw failure;
          },
          hasPerm: () => true,
        },
        (error) => observed.push(error),
      ),
    ).to.equal(false);
    expect(observed[1]).to.equal(failure);

    const permissionFailure = new Error('domain permission lookup failed');
    expect(
      capability(
        {
          hasPriv: () => false,
          hasPerm: () => {
            throw permissionFailure;
          },
        },
        (error) => observed.push(error),
      ),
    ).to.equal(false);
    expect(observed[2]).to.equal(permissionFailure);
  });
});

describe('task management workspace contracts', () => {
  const adminTasks = source('packages/ui-next/src/pages/admin-tasks/index.tsx');
  const publicTasks = source('packages/ui-next/src/pages/tasks/index.tsx');
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const bootstrapServer = source('packages/ui-next/index.ts');
  const bootstrapTypes = source('packages/ui-next/src/lib/bootstrap.tsx');
  const taskAuth = source('packages/krypton-tasks/src/auth.ts');

  it('moves all seven task management pages into one shared workspace', () => {
    expect(adminTasks).not.to.include('registerAdminNavSection');
    expect(adminTasks).not.to.match(/<AdminPage\b/);
    expect(adminTasks.match(/<ModuleWorkspace\b/g) || []).to.have.lengthOf(7);

    const contracts = [
      ['任务', '/admin/tasks', 'admin_tasks.html', 'admin_tasks_edit.html', 'admin_tasks_assign.html', 'admin_tasks_stats.html', 'admin_tasks_candidates.html'],
      ['比赛分数', '/admin/tasks/scores', 'admin_tasks_scores.html'],
      ['系统设置', '/admin/tasks/settings', 'admin_tasks_settings.html'],
    ];
    for (const contract of contracts) {
      for (const value of contract) expect(adminTasks, `missing task workspace contract: ${value}`).to.include(value);
    }
  });

  it('exposes one capability-gated management entry while preserving the public task entry', () => {
    expect(sidebar.match(/label: '任务管理'/g) || []).to.have.lengthOf(1);
    expect(sidebar).to.include('bs.user.canManageTasks');
    expect(sidebar).to.match(/label: '任务'[\s\S]*?href: '\/tasks'[\s\S]*?'tasks_center\.html', 'tasks_my\.html', 'tasks_detail\.html'/);
    for (const template of [
      'admin_tasks.html',
      'admin_tasks_edit.html',
      'admin_tasks_assign.html',
      'admin_tasks_stats.html',
      'admin_tasks_candidates.html',
      'admin_tasks_scores.html',
      'admin_tasks_settings.html',
    ]) {
      expect(sidebar, `sidebar task management entry missing ${template}`).to.include(template);
    }
  });

  it('publishes an observable server-computed task capability without replacing route authorization', () => {
    expect(bootstrapServer).to.include('resolveTaskManagementCapability');
    expect(bootstrapServer).to.include('editSystemPriv: PRIV.PRIV_EDIT_SYSTEM');
    expect(bootstrapServer).to.include('createTaskPerm: PERM.PERM_CREATE_TASK');
    expect(bootstrapServer).to.include('manageTasksPerm: PERM.PERM_MANAGE_TASKS');
    expect(bootstrapServer).to.include("'[ui-next] task management capability resolution failed:'");
    expect(bootstrapServer).to.include('canManageTasks,');
    expect(bootstrapTypes).to.include('canManageTasks?: boolean');

    expect(taskAuth).to.include('user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
    expect(taskAuth).to.include('user.hasPerm(PERM.PERM_MANAGE_TASKS)');
    expect(taskAuth).to.include('user.hasPerm(PERM.PERM_CREATE_TASK)');
  });

  it('keeps the public task cards equal-height with their primary actions aligned', () => {
    expect(publicTasks).not.to.include('auto-rows-fr');
    expect(publicTasks).not.to.include("!task.description && 'invisible'");
    expect(publicTasks).to.include('task.description ? <p');
    expect(publicTasks).to.include("'h-full transition-[box-shadow,opacity]");
    expect(publicTasks).to.match(/<CardContent[^>]*flex h-full flex-col/);
    expect(publicTasks).to.match(/className="mt-auto pt-1"[\s\S]*?<Button/);
  });

  it('keeps multi-action task headers reachable on narrow workspaces', () => {
    const statsPage = adminTasks.slice(adminTasks.indexOf('export function AdminTasksStatsPage'), adminTasks.indexOf('export function AdminTasksCandidatesPage'));
    const candidatesPage = adminTasks.slice(adminTasks.indexOf('export function AdminTasksCandidatesPage'), adminTasks.indexOf('function DotMatrix'));
    expect(statsPage).to.include('className="flex max-w-full flex-wrap gap-2"');
    expect(candidatesPage).to.include('className="flex max-w-full flex-wrap items-center gap-2"');
  });

  it('preserves task management write operations and editor fields', () => {
    for (const operation of [
      "operation: 'clone'",
      "operation: 'delete'",
      'value="batch"',
      'value="recheck_all"',
      'value="export_group"',
      'operation="admit"',
      'operation="unadmit"',
      'operation="confirm"',
      'operation="pat_import"',
      'operation="gplt_import"',
      'operation="csp_import"',
      'value="stay"',
      'value="stayImport"',
      'value="stayDelete"',
    ]) {
      expect(adminTasks, `task operation changed or missing: ${operation}`).to.include(operation);
    }
    for (const field of ['title', 'tags', 'description', 'startDate', 'endDate', 'claimStartAt', 'claimEndAt', 'maxAssignments']) {
      expect(adminTasks).to.match(new RegExp(`name=["']${field}["']`));
    }
  });
});
