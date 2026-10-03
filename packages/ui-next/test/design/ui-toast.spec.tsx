// @vitest-environment jsdom
import { StrictMode, type ComponentType, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as toastModule from '../../src/components/ui/toast';

const { toast } = toastModule;

const DEFAULT_DURATIONS = {
  info: 4000,
  success: 3000,
  error: 6000,
  loading: Infinity,
} as const;

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function svgClassTokens(text: string): string[][] {
  return [...toastContainer(screen.getByText(text)).querySelectorAll('svg')].map((svg) => classTokens(svg));
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key);
}

function isToastHost(value: unknown): value is ComponentType<{ children?: ReactNode }> {
  return typeof value === 'function';
}

function loadToastHost(): ComponentType<{ children?: ReactNode }> {
  const value = readField(toastModule, 'ToastProvider');
  if (!isToastHost(value)) {
    throw new TypeError('ToastProvider is not a function');
  }
  return value;
}

const ToastHost = loadToastHost();

/** Portal stack is the body child that contains the toast text. */
function toastContainer(node: HTMLElement): HTMLElement {
  let current: HTMLElement | null = node;
  while (current !== null && current.parentElement !== document.body) {
    current = current.parentElement;
  }
  if (current === null || current.parentElement !== document.body) {
    throw new TypeError('expected the toast container');
  }
  return current;
}

describe('toast', () => {
  it('shows one toast when two providers are nested', () => {
    render(
      <ToastHost>
        <ToastHost>
          <span>内层</span>
        </ToastHost>
      </ToastHost>,
    );

    expect(screen.getByText('内层')).toBeInTheDocument();
    act(() => {
      toast.success('已保存');
    });
    expect(screen.getAllByText('已保存')).toHaveLength(1);
  });

  it('replaces a toast that reuses the same id', () => {
    render(<ToastHost />);
    act(() => {
      toast.info('A', { id: 'x' });
      toast.info('B', { id: 'x' });
    });

    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getAllByText('B')).toHaveLength(1);
  });

  it('places the stack at z-70 and aligns it to the end from sm', () => {
    render(<ToastHost />);
    act(() => {
      toast.success('已保存');
    });
    const tokens = classTokens(toastContainer(screen.getByText('已保存')));

    expect(tokens).toContain('z-70');
    expect(tokens).toContain('sm:items-end');
    expect(tokens).not.toContain('z-[300]');
  });

  it('paints an error toast icon with text-danger-fg', () => {
    render(<ToastHost />);
    act(() => {
      toast.error('失败');
    });
    const iconClasses = [...toastContainer(screen.getByText('失败')).querySelectorAll('svg')].flatMap((svg) => classTokens(svg));

    expect(iconClasses).toContain('text-danger-fg');
  });

  it('exports the current default durations', () => {
    expect(readField(toastModule, 'TOAST_DURATIONS')).toEqual(DEFAULT_DURATIONS);
  });

  it('dismisses a toast by the id toast.info returns', async () => {
    render(<ToastHost />);
    let id = '';
    act(() => {
      id = toast.info('临时');
    });
    expect(screen.getByText('临时')).toBeInTheDocument();
    act(() => {
      toast.dismiss(id);
    });

    await waitFor(() => {
      expect(screen.queryByText('临时')).toBeNull();
    });
  });

  it('lets the next mounted provider become host while a non-host stays mounted', () => {
    const host = render(<ToastHost />);
    const nonHost = render(<ToastHost />);
    host.unmount();
    expect(nonHost.container.isConnected).toBe(true);

    const next = render(<ToastHost />);
    act(() => {
      toast.success('交接');
    });
    expect(screen.getAllByText('交接')).toHaveLength(1);

    nonHost.unmount();
    expect(next.container.isConnected).toBe(true);
    expect(screen.getAllByText('交接')).toHaveLength(1);
  });

  it('renders only the first provider as the toast stack', () => {
    render(
      <ToastHost>
        <ToastHost>
          <span>内层</span>
        </ToastHost>
      </ToastHost>,
    );
    act(() => {
      toast.success('已保存');
    });

    const stacks = [...document.body.children].filter((node) => classTokens(node).includes('z-70'));
    expect(stacks).toHaveLength(1);
    expect(screen.getAllByText('已保存')).toHaveLength(1);
  });

  it('keeps one toast when sibling providers replay under StrictMode', () => {
    render(
      <StrictMode>
        <ToastHost />
        <ToastHost />
      </StrictMode>,
    );
    act(() => {
      toast.success('已保存');
    });

    expect(screen.queryAllByText('已保存')).toHaveLength(1);
  });

  it('paints success, info, and loading glyphs in their tones', () => {
    render(<ToastHost />);
    act(() => {
      toast.success('成功');
      toast.info('提示');
      toast.loading('发送中');
    });

    expect(svgClassTokens('成功').some((tokens) => tokens.includes('text-success-fg'))).toBe(true);
    expect(svgClassTokens('提示').some((tokens) => tokens.includes('text-info-fg'))).toBe(true);
    expect(svgClassTokens('发送中').some((tokens) => tokens.includes('text-fg-subtle') && tokens.some((token) => token.includes('kr-spin')))).toBe(true);
  });

  it('anchors the stack to the bottom and caps each card at the toast width', () => {
    render(<ToastHost />);
    act(() => {
      toast.success('已保存');
    });
    const stack = classTokens(toastContainer(screen.getByText('已保存')));
    const card = classTokens(screen.getByRole('status'));

    expect(stack).toEqual(expect.arrayContaining([
      'inset-x-0',
      'bottom-0',
      'items-center',
      'p-3',
      'pb-[max(.75rem,env(safe-area-inset-bottom))]',
      'sm:items-end',
      'sm:p-5',
      'z-70',
    ]));
    expect(stack).not.toContain('top-0');
    expect(card).toEqual(expect.arrayContaining([
      'max-w-sm',
      'rounded-lg',
      'border',
      'border-line',
      'bg-surface-raised',
      'p-3',
      'pr-2',
      'shadow-pop',
    ]));
  });

  it('shows the description in the muted caption style', () => {
    render(<ToastHost />);
    act(() => {
      toast.success('已保存', { description: '写入完成' });
    });

    expect(classTokens(screen.getByText('写入完成'))).toEqual(expect.arrayContaining(['text-xs', 'text-fg-muted']));
  });

  it('dismisses the toast from its close button', async () => {
    render(<ToastHost />);
    act(() => {
      toast.error('关掉');
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => {
      expect(screen.queryByText('关掉')).toBeNull();
    });
  });

  it('hides a toast after an explicit duration and keeps a loading toast', async () => {
    render(<ToastHost />);
    act(() => {
      toast.info('自定义', { duration: 50 });
      toast.loading('发送中');
    });

    expect(screen.getByText('自定义')).toBeInTheDocument();
    expect(screen.getByText('发送中')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('自定义')).toBeNull();
    });
    expect(screen.getByText('发送中')).toBeInTheDocument();
  });
});
