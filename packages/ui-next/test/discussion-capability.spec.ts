// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

interface DiscussionCapabilityUser {
  hasPriv?: (privilege: unknown) => boolean;
  hasPerm?: (permission: unknown) => boolean;
}

interface DiscussionCapabilityInput {
  user?: DiscussionCapabilityUser | null;
  editSystemPriv: unknown;
  viewPerm: unknown;
  editPerm: unknown;
  createPerm: unknown;
  onError: (error: unknown) => void;
}

interface TeacherRoleUser {
  role?: string | null;
}

const EDIT_SYSTEM = 1;
const VIEW_DISCUSSION = 2n;
const EDIT_DISCUSSION = 4n;
const CREATE_DISCUSSION = 8n;

const DISCUSSION_COMMENT = '服务端判定：系统管理员，或有查看 / 编辑 / 创建讨论任一权限（与 handler/discussion.ts 放行规则一致）。只控制入口显示。';

const repoRoot = resolvePath(import.meta.dirname, '../../..');
const discussionModuleId = '../domain-permission-capabilities.ts';
const permsModuleId = '../src/lib/perms.ts';

function readRepo(relativePath: string): string {
  return readFileSync(resolvePath(repoRoot, relativePath), 'utf8');
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

function sliceCall(source: string, callee: string): string {
  const start = source.indexOf(`${callee}(`);
  if (start < 0) return '';
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

function interfaceBody(source: string, name: string): string {
  const header = `export interface ${name}`;
  const start = source.indexOf(header);
  if (start < 0) return '';
  const open = source.indexOf('{', start + header.length);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return '';
}

function docImmediatelyBefore(source: string, field: string): string {
  const at = source.indexOf(field);
  if (at < 0) return '';
  const before = source.slice(0, at).trimEnd();
  if (!before.endsWith('*/')) return '';
  const open = before.lastIndexOf('/**');
  if (open < 0) return '';
  return before.slice(open);
}

function fieldsAreAdjacent(source: string, first: string, second: string): boolean {
  const pattern = new RegExp(`${first}\\s*,\\s*(?:\\/\\/[^\\n]*\\n\\s*)?${second}\\b`);
  return pattern.test(source);
}

async function loadExport(moduleId: string, name: string): Promise<unknown> {
  const loaded: unknown = await import(/* @vite-ignore */ moduleId);
  if (typeof loaded !== 'object' || loaded === null || !(name in loaded)) return undefined;
  return (loaded as Record<string, unknown>)[name];
}

function asDiscussionResolver(exported: unknown): (input: DiscussionCapabilityInput) => boolean {
  if (typeof exported !== 'function') {
    throw new TypeError('resolveDiscussionCapability is not exported');
  }
  return exported as (input: DiscussionCapabilityInput) => boolean;
}

function asTeacherRole(exported: unknown): (user: TeacherRoleUser) => boolean {
  if (typeof exported !== 'function') {
    throw new TypeError('isTeacherRole is not exported');
  }
  return exported as (user: TeacherRoleUser) => boolean;
}

function decide(
  resolveDiscussionCapability: (input: DiscussionCapabilityInput) => boolean,
  user: DiscussionCapabilityInput['user'],
  onError: (error: unknown) => void,
): boolean {
  return resolveDiscussionCapability({
    user,
    editSystemPriv: EDIT_SYSTEM,
    viewPerm: VIEW_DISCUSSION,
    editPerm: EDIT_DISCUSSION,
    createPerm: CREATE_DISCUSSION,
    onError,
  });
}

describe('discussion capability resolution', () => {
  it('returns true when only view, create, edit, or system edit is granted', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const observed: unknown[] = [];
    const report = (error: unknown) => {
      observed.push(error);
    };
    expect(decide(
      resolveDiscussionCapability,
      { hasPriv: () => false, hasPerm: (permission) => permission === VIEW_DISCUSSION },
      report,
    )).to.equal(true);
    expect(decide(
      resolveDiscussionCapability,
      { hasPriv: () => false, hasPerm: (permission) => permission === CREATE_DISCUSSION },
      report,
    )).to.equal(true);
    expect(decide(
      resolveDiscussionCapability,
      { hasPriv: () => false, hasPerm: (permission) => permission === EDIT_DISCUSSION },
      report,
    )).to.equal(true);
    expect(decide(
      resolveDiscussionCapability,
      { hasPriv: (privilege) => privilege === EDIT_SYSTEM, hasPerm: () => false },
      report,
    )).to.equal(true);
    expect(observed.length).to.equal(0);
  });

  it('returns false when none of the discussion permissions are held', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const observed: unknown[] = [];
    expect(decide(
      resolveDiscussionCapability,
      { hasPriv: () => false, hasPerm: () => false },
      (error) => observed.push(error),
    )).to.equal(false);
    expect(observed.length).to.equal(0);
  });

  it('returns false without onError when the user is missing', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const observed: unknown[] = [];
    const report = (error: unknown) => {
      observed.push(error);
    };
    expect(decide(resolveDiscussionCapability, undefined, report)).to.equal(false);
    expect(decide(resolveDiscussionCapability, null, report)).to.equal(false);
    expect(observed.length).to.equal(0);
  });

  it('returns false and reports a TypeError when hasPerm is missing', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const observed: unknown[] = [];
    expect(decide(
      resolveDiscussionCapability,
      { hasPriv: () => true },
      (error) => observed.push(error),
    )).to.equal(false);
    expect(observed.some((error) => error instanceof TypeError)).to.equal(true);
  });

  it('returns false and reports a TypeError when hasPriv is missing', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const observed: unknown[] = [];
    expect(decide(
      resolveDiscussionCapability,
      { hasPerm: () => true },
      (error) => observed.push(error),
    )).to.equal(false);
    expect(observed.some((error) => error instanceof TypeError)).to.equal(true);
  });

  it('returns false and reports the original error when a permission lookup throws', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const permFailure = new Error('permission lookup failed');
    const permErrors: unknown[] = [];
    expect(decide(
      resolveDiscussionCapability,
      {
        hasPriv: () => false,
        hasPerm: () => {
          throw permFailure;
        },
      },
      (error) => permErrors.push(error),
    )).to.equal(false);
    expect(permErrors.includes(permFailure)).to.equal(true);

    const privFailure = new Error('privilege lookup failed');
    const privErrors: unknown[] = [];
    expect(decide(
      resolveDiscussionCapability,
      {
        hasPriv: () => {
          throw privFailure;
        },
        hasPerm: () => true,
      },
      (error) => privErrors.push(error),
    )).to.equal(false);
    expect(privErrors.includes(privFailure)).to.equal(true);
  });

  it('returns true without onError when system edit passes before a later lookup throws', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const observed: unknown[] = [];
    expect(decide(
      resolveDiscussionCapability,
      {
        hasPriv: () => true,
        hasPerm: () => {
          throw new Error('permission lookup failed');
        },
      },
      (error) => observed.push(error),
    )).to.equal(true);
    expect(observed.length).to.equal(0);
  });

  it('fails closed when the edit lookup throws even if create would allow access', async () => {
    const resolveDiscussionCapability = asDiscussionResolver(
      await loadExport(discussionModuleId, 'resolveDiscussionCapability'),
    );
    const editFailure = new Error('edit permission lookup failed');
    const observed: unknown[] = [];
    let createCalls = 0;
    expect(decide(
      resolveDiscussionCapability,
      {
        hasPriv: () => false,
        hasPerm: (permission) => {
          if (permission === VIEW_DISCUSSION) return false;
          if (permission === EDIT_DISCUSSION) throw editFailure;
          if (permission === CREATE_DISCUSSION) {
            createCalls += 1;
            return true;
          }
          return false;
        },
      },
      (error) => observed.push(error),
    )).to.equal(false);
    expect(observed.includes(editFailure)).to.equal(true);
    expect(createCalls).to.equal(0);
  });

  it('keeps the capability helper free of hydrooj imports', () => {
    const source = readRepo('packages/ui-next/domain-permission-capabilities.ts');
    expect(source.includes('from \'hydrooj\'')).to.equal(false);
    expect(source.includes('from "hydrooj"')).to.equal(false);
    expect(source.includes('require(\'hydrooj\')')).to.equal(false);
    expect(source.includes('require("hydrooj")')).to.equal(false);
  });
});

describe('teacher role helper', () => {
  it('accepts only the builtin teacher role', async () => {
    const isTeacherRole = asTeacherRole(await loadExport(permsModuleId, 'isTeacherRole'));
    expect(isTeacherRole({ role: 'teacher' })).to.equal(true);
    expect(isTeacherRole({ role: 'default' })).to.equal(false);
    expect(isTeacherRole({ role: 'root' })).to.equal(false);
    expect(isTeacherRole({ role: 'create_problems' })).to.equal(false);
    expect(isTeacherRole({ role: '' })).to.equal(false);
    expect(isTeacherRole({ role: null })).to.equal(false);
    expect(isTeacherRole({ role: undefined })).to.equal(false);
    expect(isTeacherRole({})).to.equal(false);
    expect(isTeacherRole({ role: 'notteacher' })).to.equal(false);
    expect(isTeacherRole({ role: 'Teacher' })).to.equal(false);
    expect(isTeacherRole({ role: 'teachers' })).to.equal(false);
    expect(isTeacherRole({ role: 'teacher ' })).to.equal(false);
  });
});

describe('discussion capability bootstrap wiring', () => {
  it('puts canViewDiscussion beside canTeach on the bootstrap user', () => {
    const server = readRepo('packages/ui-next/index.ts');
    const user = sliceBetween(server, 'user: {', 'domain: {');
    expect(user.length > 0).to.equal(true);
    expect(
      fieldsAreAdjacent(user, 'canTeach', 'canViewDiscussion')
      || fieldsAreAdjacent(user, 'canViewDiscussion', 'canTeach'),
    ).to.equal(true);
  });

  it('computes canViewDiscussion from the discussion permissions and logs resolution failures', () => {
    const call = sliceCall(readRepo('packages/ui-next/index.ts'), 'resolveDiscussionCapability');
    expect(call.length > 0).to.equal(true);
    expect(call).to.include('user: context.handler?.user');
    expect(call).to.include('editSystemPriv:');
    expect(call).to.include('PRIV.PRIV_EDIT_SYSTEM');
    expect(call).to.include('viewPerm:');
    expect(call).to.include('PERM.PERM_VIEW_DISCUSSION');
    expect(call).to.include('editPerm:');
    expect(call).to.include('PERM.PERM_EDIT_DISCUSSION');
    expect(call).to.include('createPerm:');
    expect(call).to.include('PERM.PERM_CREATE_DISCUSSION');
    expect(call).to.include('\'[ui-next] discussion capability resolution failed:\'');
    expect(call).to.include('domainId');
    expect(call).to.include('uid');
    expect(call).to.include('templateName');
    const loggedAt = call.indexOf('console.error(');
    expect(loggedAt >= 0).to.equal(true);
    const errorLog = call.slice(loggedAt);
    expect(errorLog.includes("'[ui-next] discussion capability resolution failed:'")).to.equal(true);
    expect(/\{\s*domainId[\s\S]*uid[\s\S]*templateName[\s\S]*\}\s*,\s*error\s*,\s*\)/.test(errorLog)).to.equal(true);
  });

  it('publishes the computed canViewDiscussion value on the bootstrap user', () => {
    const user = sliceBetween(readRepo('packages/ui-next/index.ts'), 'user: {', 'domain: {');
    const shipsComputed = /canViewDiscussion\s*,/.test(user)
      || /canViewDiscussion\s*:\s*canViewDiscussion\s*,/.test(user);
    expect(shipsComputed).to.equal(true);
    expect(/canViewDiscussion\s*:\s*(?:true|false|canTeach)\b/.test(user)).to.equal(false);
  });

  it('declares optional canViewDiscussion on KryptonUser', () => {
    const types = readRepo('packages/ui-next/src/lib/bootstrap.tsx');
    const user = interfaceBody(types, 'KryptonUser');
    expect(user.length > 0).to.equal(true);
    expect(user).to.include('canViewDiscussion?: boolean');
    expect(/canViewDiscussion\?\s*:\s*boolean\s*;/.test(user)).to.equal(true);
    expect(/canViewDiscussion\?\s*:\s*boolean\s*\|/.test(user)).to.equal(false);
    expect(docImmediatelyBefore(user, 'canViewDiscussion?: boolean')).to.include(DISCUSSION_COMMENT);
  });
});
