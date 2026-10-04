import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ComponentType } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A static import fails collection while media-node-badge.tsx is absent.
const badgeLoaders = import.meta.glob('../src/pages/vigil/media-node-badge.tsx');

const BADGE_FILE = 'src/pages/vigil/media-node-badge.tsx';
const POLL_MS = 15_000;
const EM_DASH = '\u2014';

interface MediaNode {
  serverId: string;
  deviceId: string;
  ip: string;
  rtmp: string[];
  http: string[];
  api: string[];
  updatedAt: string | null;
  registered: boolean;
  apiReachable: boolean | null;
  streams: number | null;
  cpuPercent: number | null;
}

interface MediaNodes {
  configured: boolean;
  healthy: number;
  total: number;
  error: 'redis_unavailable' | null;
  nodes: MediaNode[];
}

const { getMediaNodes } = vi.hoisted(() => ({
  getMediaNodes: vi.fn(),
}));

vi.mock('@/lib/vigil-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vigil-api')>();
  return { ...actual, getMediaNodes };
});

function badgeLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(badgeLoaders)) {
    if (key.endsWith('media-node-badge.tsx')) return load;
  }
  return undefined;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

async function loadMediaNodeBadge(): Promise<ComponentType> {
  const load = badgeLoader();
  expect(typeof load, BADGE_FILE).toBe('function');
  if (typeof load !== 'function') {
    throw new TypeError(`${BADGE_FILE} must exist`);
  }
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError('media-node-badge module must be an object');
  }
  const value = readField(imported, 'MediaNodeBadge');
  expect(typeof value, 'MediaNodeBadge').toBe('function');
  if (typeof value !== 'function') {
    throw new TypeError('MediaNodeBadge must be a function');
  }
  return value as ComponentType;
}

function mediaNode(overrides: Partial<MediaNode> = {}): MediaNode {
  return {
    serverId: 'srv',
    deviceId: 'dev',
    ip: '10.0.0.1',
    rtmp: [],
    http: [],
    api: [],
    updatedAt: null,
    registered: true,
    apiReachable: true,
    streams: null,
    cpuPercent: null,
    ...overrides,
  };
}

function mediaNodes(overrides: Partial<MediaNodes> = {}): MediaNodes {
  return {
    configured: true,
    healthy: 0,
    total: 0,
    error: null,
    nodes: [],
    ...overrides,
  };
}

function quietRejection(message: string): Promise<never> {
  const pending = Promise.reject(new Error(message));
  void pending.catch(() => undefined);
  return pending;
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function badgeElement(container: HTMLElement): HTMLElement {
  const badge = container.querySelector('[data-slot="badge"]');
  expect(badge).toBeInstanceOf(HTMLElement);
  if (!(badge instanceof HTMLElement)) {
    throw new TypeError('expected a badge element');
  }
  return badge;
}

function outsideText(container: HTMLElement): string {
  return [...document.body.children]
    .filter((element) => element !== container)
    .map((element) => element.textContent ?? '')
    .join('');
}

describe('media node badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getMediaNodes.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing before the first response and when media nodes are not configured', async () => {
    let resolveNodes: (value: MediaNodes) => void = () => {
      throw new Error('getMediaNodes has not been called');
    };
    getMediaNodes.mockImplementation(() => new Promise<MediaNodes>((fulfill) => {
      resolveNodes = fulfill;
    }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const { container } = render(<MediaNodeBadge />);

    expect(getMediaNodes).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
    expect(container.childElementCount).toBe(0);

    await act(async () => {
      resolveNodes(mediaNodes({ configured: false, healthy: 0, total: 0, error: null, nodes: [] }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toBe('');
    expect(container.childElementCount).toBe(0);
  });

  it('shows a success badge when every configured node is healthy', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({
      healthy: 1,
      total: 1,
      nodes: [mediaNode({ deviceId: 'dev-1', ip: '10.0.0.8' })],
    }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const { container } = render(<MediaNodeBadge />);
    await flush();

    expect(container.textContent).toBe('媒体节点 1/1 正常');
    expect(badgeElement(container)).toHaveAttribute('data-tone', 'success');
    const button = screen.getByRole('button', { name: '媒体节点 1/1 正常' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('[data-slot="badge"]')).toBe(badgeElement(container));
  });

  it('uses danger when none are healthy and warning when only some are', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({ healthy: 0, total: 2 }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const danger = render(<MediaNodeBadge />);
    await flush();
    expect(danger.container.textContent).toBe('媒体节点 0/2 正常');
    expect(badgeElement(danger.container)).toHaveAttribute('data-tone', 'danger');
    danger.unmount();

    getMediaNodes.mockResolvedValue(mediaNodes({ healthy: 1, total: 2 }));
    const warning = render(<MediaNodeBadge />);
    await flush();
    expect(warning.container.textContent).toBe('媒体节点 1/2 正常');
    expect(badgeElement(warning.container)).toHaveAttribute('data-tone', 'warning');
  });

  it('uses danger when healthy and total are both zero', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({
      configured: true,
      healthy: 0,
      total: 0,
      error: null,
      nodes: [],
    }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const view = render(<MediaNodeBadge />);
    await flush();
    expect(view.container.textContent).toBe('媒体节点 0/0 正常');
    expect(badgeElement(view.container)).toHaveAttribute('data-tone', 'danger');
  });

  it('shows an unknown badge when the request fails or redis is unavailable', async () => {
    getMediaNodes.mockImplementation(() => quietRejection('down'));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const rejected = render(<MediaNodeBadge />);
    await flush();
    expect(rejected.container.textContent).toBe('媒体节点状态未知');
    expect(badgeElement(rejected.container)).toHaveAttribute('data-tone', 'warning');
    fireEvent.click(screen.getByRole('button', { name: '媒体节点状态未知' }));
    expect(outsideText(rejected.container)).toContain('无法读取媒体节点状态');
    rejected.unmount();

    getMediaNodes.mockResolvedValue(mediaNodes({
      configured: true,
      healthy: 0,
      total: 0,
      error: 'redis_unavailable',
      nodes: [],
    }));
    const unavailable = render(<MediaNodeBadge />);
    await flush();
    expect(unavailable.container.textContent).toBe('媒体节点状态未知');
    expect(badgeElement(unavailable.container)).toHaveAttribute('data-tone', 'warning');
    fireEvent.click(screen.getByRole('button', { name: '媒体节点状态未知' }));
    expect(outsideText(unavailable.container)).toContain('无法读取媒体节点状态');
  });

  it('polls every 15000ms and does not poll after unmount', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({ healthy: 1, total: 1 }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const view = render(<MediaNodeBadge />);
    await flush();
    expect(getMediaNodes).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    });
    expect(getMediaNodes).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getMediaNodes).toHaveBeenCalledTimes(2);
    await flush();

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(getMediaNodes).toHaveBeenCalledTimes(2);
  });

  it('keeps polling on each later 15000ms tick while the badge stays mounted', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({ healthy: 1, total: 1 }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const view = render(<MediaNodeBadge />);
    await flush();
    expect(getMediaNodes).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });
    expect(getMediaNodes).toHaveBeenCalledTimes(3);
    view.unmount();
  });

  it('opens a row for each node with identity, status, streams, and cpu', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({
      healthy: 1,
      total: 3,
      nodes: [
        mediaNode({
          serverId: 'srv-off',
          deviceId: 'dev-off',
          ip: '10.0.0.1',
          registered: false,
          apiReachable: true,
          streams: null,
          cpuPercent: null,
        }),
        mediaNode({
          serverId: 'srv-api',
          deviceId: 'dev-api',
          ip: '10.0.0.2',
          registered: true,
          apiReachable: false,
          streams: 3,
          cpuPercent: 12,
        }),
        mediaNode({
          serverId: 'srv-only',
          deviceId: '',
          ip: '10.0.0.3',
          registered: true,
          apiReachable: null,
          streams: 0,
          cpuPercent: 0,
        }),
      ],
    }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const { container } = render(<MediaNodeBadge />);
    await flush();

    const button = screen.getByRole('button', { name: '媒体节点 1/3 正常' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const popover = outsideText(container);
    expect(popover).toContain('dev-off');
    expect(popover).toContain('10.0.0.1');
    expect(popover).toContain('已离线');
    expect(popover).toContain('dev-api');
    expect(popover).toContain('10.0.0.2');
    expect(popover).toContain('API 不可达');
    expect(popover).toContain('3 路');
    expect(popover).toContain('CPU 12%');
    expect(popover).toContain(EM_DASH);
    expect(popover).toContain('srv-only');
    expect(popover).toContain('10.0.0.3');
    expect(popover).toContain('正常');
    expect(popover).toContain('0 路');
    expect(popover).toContain('CPU 0%');
  });

  it('shows 已离线 rather than API 不可达 when the node is unregistered', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({
      healthy: 0,
      total: 1,
      nodes: [
        mediaNode({
          serverId: 'srv-both',
          deviceId: 'dev-both',
          ip: '10.0.0.9',
          registered: false,
          apiReachable: false,
          streams: 1,
          cpuPercent: 4,
        }),
      ],
    }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const { container } = render(<MediaNodeBadge />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '媒体节点 0/1 正常' }));
    const popover = outsideText(container);
    expect(popover).toContain('dev-both');
    expect(popover).toContain('10.0.0.9');
    expect(popover).toContain('已离线');
    expect(popover).not.toContain('API 不可达');
    expect(popover).toContain('1 路');
    expect(popover).toContain('CPU 4%');
  });

  it('says there are no registered media nodes when the list is empty', async () => {
    getMediaNodes.mockResolvedValue(mediaNodes({
      configured: true,
      healthy: 1,
      total: 1,
      error: null,
      nodes: [],
    }));
    const MediaNodeBadge = await loadMediaNodeBadge();
    const { container } = render(<MediaNodeBadge />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '媒体节点 1/1 正常' }));
    expect(outsideText(container)).toContain('没有已注册的媒体节点');
  });
});

describe('proctor page actions', () => {
  it('inserts MediaNodeBadge before 返回总览 inside the actions row', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/vigil/index.tsx'), 'utf8');
    const badgeAt = source.indexOf('<MediaNodeBadge />');
    const backAt = source.indexOf('返回总览');
    expect(source.includes('<MediaNodeBadge />')).toBe(true);
    expect(backAt).toBeGreaterThan(badgeAt);
    const actionsAt = source.lastIndexOf('actions=', badgeAt);
    expect(actionsAt).toBeGreaterThan(-1);
    expect(source.slice(actionsAt, badgeAt).includes('className="flex items-center gap-2"')).toBe(true);
  });
});
