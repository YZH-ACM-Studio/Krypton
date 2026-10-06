import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDomainUsersByIds } from '../src/components/domain-user-search';

function mockUsers(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}

describe('loadDomainUsersByIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips the placeholder Hydro returns for a deleted account', async () => {
    mockUsers([{ _id: 2, uname: 'zhang', displayName: '张老师' }, { _id: 0, uname: 'Unknown User' }]);
    const users = await loadDomainUsersByIds('system', [2, 99]);
    expect(users.map((u) => u._id)).toEqual([2]);
    expect(users[0]?.displayName).toBe('张老师');
  });

  it('still rejects a malformed entry', async () => {
    mockUsers([{ _id: 2, uname: 'zhang' }, { uname: 'no id' }]);
    await expect(loadDomainUsersByIds('system', [2, 3])).rejects.toThrow('用户资料响应格式错误');
  });
});
