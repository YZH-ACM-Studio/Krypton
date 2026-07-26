import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useColorMode } from '../src/lib/use-color-mode.ts';

const html = () => document.documentElement;

describe('useColorMode', () => {
  afterEach(() => {
    // Unmount before wiping the class list so the MutationObserver of a
    // still-mounted hook cannot fire outside act().
    cleanup();
    html().className = '';
  });

  it('reads light mode when the dark class is absent at mount', () => {
    const { result } = renderHook(() => useColorMode());
    expect(result.current).to.equal('light');
  });

  it('reads dark mode when the dark class is already present at mount', () => {
    html().classList.add('dark');
    const { result } = renderHook(() => useColorMode());
    expect(result.current).to.equal('dark');
  });

  it('follows dark-class toggles on the document element', async () => {
    const { result } = renderHook(() => useColorMode());
    expect(result.current).to.equal('light');

    await act(async () => {
      html().classList.add('dark');
    });
    expect(result.current).to.equal('dark');

    await act(async () => {
      html().classList.remove('dark');
    });
    expect(result.current).to.equal('light');
  });

  it('stays light through class churn that never involves the dark class', async () => {
    const { result } = renderHook(() => useColorMode());
    await act(async () => {
      html().classList.add('sidebar-open');
      html().classList.add('theme-blue');
    });
    expect(result.current).to.equal('light');
  });

  it('keeps dark mode while unrelated classes come and go', async () => {
    html().classList.add('dark');
    const { result } = renderHook(() => useColorMode());
    await act(async () => {
      html().classList.add('sidebar-open');
      html().classList.remove('sidebar-open');
    });
    expect(result.current).to.equal('dark');
  });

  it('disconnects its mutation observer on unmount', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { unmount } = renderHook(() => useColorMode());
    expect(disconnect).not.toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
