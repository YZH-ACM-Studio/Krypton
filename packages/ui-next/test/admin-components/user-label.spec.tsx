import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// A static import fails collection while user-label.tsx is absent.
const userLabelLoaders = import.meta.glob('../../src/components/admin/user-label.tsx');

const SOURCE = 'src/components/admin/user-label.tsx';
const DOMAIN_ID = 'system';
const EM_DASH = '—';

const NAMED_USERS = [
  { _id: 3, uname: 'helper', displayName: '协助教师' },
  { _id: 7, uname: 'seven' },
];

type UserNames = ReadonlyMap<number, string>;
type UseUserNames = (domainId: string, uids: ReadonlyArray<number | null | undefined>) => UserNames;
type UserDisplayName = (uid: number | null | undefined, names: UserNames) => string;

interface UserLabelProps {
  uid: number | null | undefined;
  names: UserNames;
}

interface UserLabelApi {
  useUserNames: UseUserNames;
  userDisplayName: UserDisplayName;
  UserLabel: ComponentType<UserLabelProps>;
}

interface NamesProps {
  domainId: string;
  uids: ReadonlyArray<number | null | undefined>;
}

interface FailureWatch {
  rejections: unknown[];
  errors: unknown[];
  stop: () => void;
}

function userLabelLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(userLabelLoaders)) {
    if (key.endsWith(SOURCE)) return load;
  }
  return undefined;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as Fn;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError(`${key} must be a function`);
  }
  return value as ComponentType<Props>;
}

async function loadApi(): Promise<UserLabelApi> {
  const load = userLabelLoader();
  expect(typeof load, SOURCE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${SOURCE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('user-label module must be an object');
  }
  return {
    useUserNames: asFunction<UseUserNames>(readField(imported, 'useUserNames'), 'useUserNames'),
    userDisplayName: asFunction<UserDisplayName>(readField(imported, 'userDisplayName'), 'userDisplayName'),
    UserLabel: asComponent<UserLabelProps>(readField(imported, 'UserLabel'), 'UserLabel'),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsersRequest(input: unknown, init: unknown): { url: string; ids: number[] } {
  let url = '';
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    url = input.url;
  } else {
    throw new TypeError('expected a fetch url');
  }
  const rawBody = isRecord(init) ? init.body : undefined;
  if (typeof rawBody !== 'string') {
    throw new TypeError('expected a JSON string body');
  }
  const parsed: unknown = JSON.parse(rawBody);
  if (!isRecord(parsed)) {
    throw new TypeError('expected a request object');
  }
  const args = parsed.args;
  if (!isRecord(args)) {
    throw new TypeError('expected args');
  }
  const ids = args.ids;
  if (!Array.isArray(ids) || !ids.every((id): id is number => typeof id === 'number')) {
    throw new TypeError('expected numeric args.ids');
  }
  return { url, ids };
}

function requestAt(fetchMock: { mock: { calls: unknown[][] } }, index: number): { url: string; ids: number[] } {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) {
    throw new TypeError(`expected fetch call ${index + 1}`);
  }
  return readUsersRequest(call[0], call[1]);
}

function mountNames(useUserNames: UseUserNames, props: NamesProps) {
  return renderHook(
    (current: NamesProps) => useUserNames(current.domainId, current.uids),
    { initialProps: props },
  );
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

function watchFailures(): FailureWatch {
  const rejections: unknown[] = [];
  const errors: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) => {
    rejections.push(event.reason);
    event.preventDefault();
  };
  const onError = (event: ErrorEvent) => {
    errors.push(event.error ?? event.message);
    event.preventDefault();
  };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError);
  return {
    rejections,
    errors,
    stop() {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    },
  };
}

function silenceConsoleError(): () => void {
  // fetchHydroResponse logs transport failures. That log is not this hook's; don't assert it is absent.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => {
    spy.mockRestore();
  };
}

async function expectSettledEmpty(fetchMock: { mock: { calls: unknown[][] } }, sizeCheck: () => void): Promise<void> {
  await waitFor(() => {
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });
  await act(async () => {
    await flushMicrotasks();
  });
  sizeCheck();
}

describe('useUserNames', () => {
  it('uids=[3, 3, 0, -1, null, 2.5, 7] 只请求一次，args.ids 为 [3, 7]', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const uids: ReadonlyArray<number | null | undefined> = [3, 3, 0, -1, null, 2.5, 7];

    mountNames(useUserNames, { domainId: DOMAIN_ID, uids });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = requestAt(fetchMock, 0);
    expect(request.ids).toEqual([3, 7]);
    expect(request.url.endsWith('/d/system/api/users')).toBe(true);
  });

  it('按升序去重提交，与传入顺序无关', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();

    mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [7, 3, 7] });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(requestAt(fetchMock, 0).ids).toEqual([3, 7]);
  });

  it('两位数按数值升序提交，不按字符串顺序', async () => {
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();

    mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [10, 2, 10] });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(requestAt(fetchMock, 0).ids).toEqual([2, 10]);
  });

  it('只请求正的安全整数', async () => {
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const unsafe = Number.MAX_SAFE_INTEGER + 1;

    mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [unsafe, 0, -1, null, 2.5] });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [Number.MAX_SAFE_INTEGER] });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(requestAt(fetchMock, 0).ids).toEqual([Number.MAX_SAFE_INTEGER]);
  });

  it('1 是正的安全整数，会去重后按升序进入 args.ids', async () => {
    const fetchMock = vi.fn(async () => json([
      { _id: 1, uname: 'one' },
      { _id: 3, uname: 'helper', displayName: '协助教师' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 1, 1] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(requestAt(fetchMock, 0).ids).toEqual([1, 3]);
    await waitFor(() => {
      expect(view.result.current.get(1)).toBe('one');
    });
    expect(view.result.current.get(3)).toBe('协助教师');
  });

  it('混入非安全整数不会改变已有 key，因此不会再次请求', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [7, 3] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(requestAt(fetchMock, 0).ids).toEqual([3, 7]);

    view.rerender({
      domainId: DOMAIN_ID,
      uids: [3, 2.5, unsafe, Number.POSITIVE_INFINITY, 7],
    });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchMock, 0).ids).toEqual([3, 7]);
  });

  it('混入 0 或负数不会改变已有 key，因此不会再次请求', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [7, 3] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(requestAt(fetchMock, 0).ids).toEqual([3, 7]);

    view.rerender({ domainId: DOMAIN_ID, uids: [-4, 0, null, 3, 7] });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestAt(fetchMock, 0).ids).toEqual([3, 7]);
  });

  it('mock 用户名：3 用 displayName，7 用 uname', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 7] });

    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('协助教师');
    });
    expect(view.result.current.get(7)).toBe('seven');
    expect(view.result.current.size).toBe(2);
  });

  it('displayName 和 uname 都没有的用户不进入 Map', async () => {
    const fetchMock = vi.fn(async () => json([
      { _id: 3, uname: 'helper', displayName: '协助教师' },
      { _id: 8 },
      { _id: 7, uname: 'seven' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 8, 7] });

    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('协助教师');
    });
    expect(view.result.current.get(7)).toBe('seven');
    expect(view.result.current.has(8)).toBe(false);
    expect(view.result.current.size).toBe(2);
  });

  it('只有 realName、没有 displayName 和 uname 的用户不进入 Map', async () => {
    const fetchMock = vi.fn(async () => json([
      { _id: 3, uname: 'helper', displayName: '协助教师' },
      { _id: 8, realName: '张三' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 8] });

    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('协助教师');
    });
    expect(view.result.current.has(8)).toBe(false);
    expect(view.result.current.get(8)).toBeUndefined();
    expect(view.result.current.size).toBe(1);
  });

  it('displayName 原样保留，空白不会被裁掉，也不会改用 uname', async () => {
    const fetchMock = vi.fn(async () => json([
      { _id: 3, uname: 'helper', displayName: ' 协助教师 ' },
      { _id: 4, uname: 'seven', displayName: '   ' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 4] });

    await waitFor(() => {
      expect(view.result.current.get(3)).toBe(' 协助教师 ');
    });
    expect(view.result.current.get(4)).toBe('   ');
    expect(view.result.current.size).toBe(2);
  });

  it('uids 为空或全部无效时不请求，返回空 Map', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();

    const empty = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [] });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(empty.result.current).toBeInstanceOf(Map);
    expect(empty.result.current.size).toBe(0);

    const invalid = mountNames(useUserNames, {
      domainId: DOMAIN_ID,
      uids: [0, -1, null, undefined, 2.5],
    });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invalid.result.current).toBeInstanceOf(Map);
    expect(invalid.result.current.size).toBe(0);
  });

  it('fetch reject 时返回空 Map，不抛错，也没有未处理的拒绝', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const restoreConsole = silenceConsoleError();
    const watched = watchFailures();
    try {
      const { useUserNames } = await loadApi();
      let thrown: unknown;
      let view: ReturnType<typeof mountNames> | undefined;
      try {
        view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 7] });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeUndefined();
      if (view === undefined) {
        throw new TypeError('expected the hook to mount');
      }
      const names = view.result;
      await expectSettledEmpty(fetchMock, () => {
        expect(names.current).toBeInstanceOf(Map);
        expect(names.current.size).toBe(0);
      });
      expect(watched.rejections).toEqual([]);
      expect(watched.errors).toEqual([]);
    } finally {
      watched.stop();
      restoreConsole();
    }
  });

  it('http 500 时返回空 Map', async () => {
    const fetchMock = vi.fn(async () => json({ message: '用户资料加载失败' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    const restoreConsole = silenceConsoleError();
    const watched = watchFailures();
    try {
      const { useUserNames } = await loadApi();
      const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3] });
      await expectSettledEmpty(fetchMock, () => {
        expect(view.result.current).toBeInstanceOf(Map);
        expect(view.result.current.size).toBe(0);
      });
      expect(watched.rejections).toEqual([]);
      expect(watched.errors).toEqual([]);
    } finally {
      watched.stop();
      restoreConsole();
    }
  });

  it('fetch 同步抛错时返回空 Map，且 hook 不抛错', async () => {
    const fetchMock = vi.fn(() => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    const restoreConsole = silenceConsoleError();
    const watched = watchFailures();
    try {
      const { useUserNames } = await loadApi();
      let thrown: unknown;
      let view: ReturnType<typeof mountNames> | undefined;
      try {
        view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3] });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeUndefined();
      if (view === undefined) {
        throw new TypeError('expected the hook to mount');
      }
      const names = view.result;
      await expectSettledEmpty(fetchMock, () => {
        expect(names.current).toBeInstanceOf(Map);
        expect(names.current.size).toBe(0);
      });
      expect(watched.rejections).toEqual([]);
      expect(watched.errors).toEqual([]);
    } finally {
      watched.stop();
      restoreConsole();
    }
  });

  it('重新渲染但 uids 内容相同（新数组引用）时 fetch 仍只调用 1 次', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 7] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    view.rerender({ domainId: DOMAIN_ID, uids: [3, 7] });
    view.rerender({ domainId: DOMAIN_ID, uids: [3, 3, 7] });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('domainId 变化时按新域再请求一次', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((settle) => {
      pending.push(settle);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3] });

    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    const first = pending[0];
    if (first === undefined) {
      throw new TypeError('expected the first request');
    }
    await act(async () => {
      first(json([{ _id: 3, uname: 'helper', displayName: '系统教师' }]));
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('系统教师');
    });
    expect(requestAt(fetchMock, 0).url.endsWith('/d/system/api/users')).toBe(true);

    view.rerender({ domainId: 'library', uids: [3] });
    expect(view.result.current.has(3)).toBe(false);
    expect(view.result.current.size).toBe(0);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const second = requestAt(fetchMock, 1);
    expect(second.ids).toEqual([3]);
    expect(second.url.endsWith('/d/library/api/users')).toBe(true);
    expect(view.result.current.has(3)).toBe(false);
    expect(view.result.current.size).toBe(0);

    const resolveSecond = pending[1];
    if (resolveSecond === undefined) {
      throw new TypeError('expected the second request');
    }
    await act(async () => {
      resolveSecond(json([{ _id: 3, uname: 'lib', displayName: '图书馆教师' }]));
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('图书馆教师');
    });
    expect(view.result.current.has(3)).toBe(true);
  });

  it('key 与结果不变时 Map 引用保持不变', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((settle) => {
      pending.push(settle);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 7] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const loading = view.result.current;
    expect(loading.size).toBe(0);
    view.rerender({ domainId: DOMAIN_ID, uids: [7, 3] });
    expect(view.result.current).toBe(loading);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const resolveRequest = pending[0];
    if (resolveRequest === undefined) {
      throw new TypeError('expected the request');
    }
    await act(async () => {
      resolveRequest(json(NAMED_USERS));
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('协助教师');
    });
    const loaded = view.result.current;
    view.rerender({ domainId: DOMAIN_ID, uids: [3, 7] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBe(loaded);
  });

  it('key 变化后不写入旧请求的结果', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((settle) => {
      pending.push(settle);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3] });

    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    view.rerender({ domainId: DOMAIN_ID, uids: [7] });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    const stale = pending[0];
    const current = pending[1];
    if (stale === undefined || current === undefined) {
      throw new TypeError('expected both requests');
    }

    await act(async () => {
      current(json([{ _id: 7, uname: 'seven' }]));
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(view.result.current.get(7)).toBe('seven');
    });
    await act(async () => {
      stale(json([{ _id: 3, uname: 'helper', displayName: '旧请求' }]));
      await flushMicrotasks();
    });
    expect(view.result.current.get(7)).toBe('seven');
    expect(view.result.current.has(3)).toBe(false);
    expect(view.result.current.size).toBe(1);
  });

  it('key 变化后、新请求返回前不保留上一组名字', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((settle) => {
      pending.push(settle);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();
    const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3, 7] });

    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    const first = pending[0];
    if (first === undefined) {
      throw new TypeError('expected the first request');
    }
    await act(async () => {
      first(json(NAMED_USERS));
      await flushMicrotasks();
    });
    await waitFor(() => {
      expect(view.result.current.get(3)).toBe('协助教师');
    });
    expect(view.result.current.get(7)).toBe('seven');

    view.rerender({ domainId: DOMAIN_ID, uids: [7] });
    expect(view.result.current.has(3)).toBe(false);
    expect(view.result.current.has(7)).toBe(false);
    expect(view.result.current.size).toBe(0);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(requestAt(fetchMock, 1).ids).toEqual([7]);
    expect(view.result.current.has(3)).toBe(false);
    expect(view.result.current.has(7)).toBe(false);
    expect(view.result.current.size).toBe(0);
  });

  it('key 变化后旧请求失败不得写回并清掉新结果', async () => {
    const pending: Array<{
      resolve: (response: Response) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((settle, reject) => {
      pending.push({ resolve: settle, reject });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const restoreConsole = silenceConsoleError();
    const watched = watchFailures();
    try {
      const { useUserNames } = await loadApi();
      const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3] });
      await waitFor(() => {
        expect(pending).toHaveLength(1);
      });
      view.rerender({ domainId: DOMAIN_ID, uids: [7] });
      await waitFor(() => {
        expect(pending).toHaveLength(2);
      });
      const stale = pending[0];
      const current = pending[1];
      if (stale === undefined || current === undefined) {
        throw new TypeError('expected both requests');
      }
      await act(async () => {
        current.resolve(json([{ _id: 7, uname: 'seven' }]));
        await flushMicrotasks();
      });
      await waitFor(() => {
        expect(view.result.current.get(7)).toBe('seven');
      });
      await act(async () => {
        stale.reject(new TypeError('offline'));
        await flushMicrotasks();
      });
      expect(view.result.current.get(7)).toBe('seven');
      expect(view.result.current.has(3)).toBe(false);
      expect(view.result.current.size).toBe(1);
      expect(watched.rejections).toEqual([]);
      expect(watched.errors).toEqual([]);
    } finally {
      watched.stop();
      restoreConsole();
    }
  });

  it('卸载后旧请求完成不会抛错或留下未处理拒绝', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((settle) => {
      pending.push(settle);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const watched = watchFailures();
    try {
      const { useUserNames } = await loadApi();
      const view = mountNames(useUserNames, { domainId: DOMAIN_ID, uids: [3] });
      await waitFor(() => {
        expect(pending).toHaveLength(1);
      });
      view.unmount();
      const resolveRequest = pending[0];
      if (resolveRequest === undefined) {
        throw new TypeError('expected the request');
      }
      await act(async () => {
        resolveRequest(json(NAMED_USERS));
        await flushMicrotasks();
      });
      expect(watched.rejections).toEqual([]);
      expect(watched.errors).toEqual([]);
    } finally {
      watched.stop();
    }
  });

  it('不同组件实例不共享缓存', async () => {
    const fetchMock = vi.fn(async () => json(NAMED_USERS));
    vi.stubGlobal('fetch', fetchMock);
    const { useUserNames } = await loadApi();

    renderHook(() => useUserNames(DOMAIN_ID, [3]));
    renderHook(() => useUserNames(DOMAIN_ID, [3]));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('userDisplayName', () => {
  it('null 或 undefined 为破折号，命中返回名字，未命中为 UID n', async () => {
    const { userDisplayName } = await loadApi();
    const names: UserNames = new Map<number, string>([[3, '协助教师'], [4, '']]);

    expect(userDisplayName(null, names)).toBe(EM_DASH);
    expect(userDisplayName(undefined, names)).toBe(EM_DASH);
    expect(userDisplayName(3, names)).toBe('协助教师');
    expect(userDisplayName(4, names)).toBe('');
    expect(userDisplayName(9, new Map())).toBe('UID 9');
    expect(userDisplayName(0, new Map())).toBe('UID 0');
  });
});

describe('userLabel', () => {
  it('uid 3 的 span title 为 UID 3，文本为解析名', async () => {
    const { UserLabel } = await loadApi();
    const names: UserNames = new Map([[3, '协助教师']]);
    const view = render(<UserLabel uid={3} names={names} />);
    const label = screen.getByTitle('UID 3');

    expect(label.tagName.toLowerCase()).toBe('span');
    expect(label.textContent).toBe('协助教师');
    expect(label).toBe(view.container.firstElementChild);
  });

  it('uid 为空时不设置 title，文本为破折号；未命中时标题和文本都是 UID n', async () => {
    const { UserLabel } = await loadApi();
    const names: UserNames = new Map();

    const missing = render(<UserLabel uid={null} names={names} />);
    const missingSpan = missing.container.firstElementChild;
    if (!(missingSpan instanceof HTMLElement)) {
      throw new TypeError('expected a span');
    }
    expect(missingSpan.tagName.toLowerCase()).toBe('span');
    expect(missingSpan.hasAttribute('title')).toBe(false);
    expect(missingSpan.textContent).toBe(EM_DASH);

    const omitted = render(<UserLabel uid={undefined} names={names} />);
    const omittedSpan = omitted.container.firstElementChild;
    if (!(omittedSpan instanceof HTMLElement)) {
      throw new TypeError('expected a span');
    }
    expect(omittedSpan.hasAttribute('title')).toBe(false);
    expect(omittedSpan.textContent).toBe(EM_DASH);

    const unknown = render(<UserLabel uid={9} names={names} />);
    const unknownLabel = screen.getByTitle('UID 9');
    expect(unknownLabel.tagName.toLowerCase()).toBe('span');
    expect(unknownLabel.textContent).toBe('UID 9');
    expect(unknownLabel).toBe(unknown.container.firstElementChild);
  });

  it('uid 为 0 时标题和文本都是 UID 0', async () => {
    const { UserLabel, userDisplayName } = await loadApi();
    const names: UserNames = new Map();

    expect(userDisplayName(0, names)).toBe('UID 0');
    const view = render(<UserLabel uid={0} names={names} />);
    const label = screen.getByTitle('UID 0');
    expect(label.tagName.toLowerCase()).toBe('span');
    expect(label.textContent).toBe('UID 0');
    expect(label).toBe(view.container.firstElementChild);
  });

  it('uid 为负数时标题和文本都是 UID n', async () => {
    const { UserLabel, userDisplayName } = await loadApi();
    const names: UserNames = new Map();

    expect(userDisplayName(-3, names)).toBe('UID -3');
    const view = render(<UserLabel uid={-3} names={names} />);
    const label = screen.getByTitle('UID -3');
    expect(label.tagName.toLowerCase()).toBe('span');
    expect(label.textContent).toBe('UID -3');
    expect(label).toBe(view.container.firstElementChild);
  });
});

describe('user-label 门禁', () => {
  it('门禁零违规', () => {
    const packageRoot = resolve(import.meta.dirname, '../..');
    const absolute = resolve(packageRoot, SOURCE);
    expect(existsSync(absolute), SOURCE).toBe(true);
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', SOURCE], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    if (typeof result.status !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
      throw new TypeError('design-gate did not return a status and string output');
    }
    expect(result.status, `${result.stdout}${result.stderr}`.trim()).toBe(0);
  });
});
