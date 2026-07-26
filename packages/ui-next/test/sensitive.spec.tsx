import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sensitive, SensitiveProvider, useSensitive } from '../src/lib/sensitive.tsx';

const STORAGE_KEY = 'krypton:sensitive-visible';

/**
 * The vitest jsdom environment ships no `window.localStorage` instance, so the
 * provider's try/catch would always take the failure path. Stubbing a
 * Map-backed storage lets both the persistence path and the failure path be
 * exercised deliberately. `unstubGlobals: true` in vitest.config.ts removes
 * the stub after each test.
 */
function createMemoryStorage(overrides: Partial<Pick<Storage, 'getItem' | 'setItem'>> = {}): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
    ...overrides,
  } as Storage;
}

function Toggler() {
  const { toggle } = useSensitive();
  return (
    <button type="button" onClick={toggle}>
      toggle
    </button>
  );
}

describe('sensitive content masking', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('masks children with the default placeholder outside any provider', () => {
    render(<Sensitive>13800000000</Sensitive>);
    expect(screen.queryByText('13800000000')).to.equal(null);
    expect(screen.getByText('••••••')).to.not.equal(null);
  });

  it('keeps the default context toggle a no-op without persisting anything', () => {
    const { result } = renderHook(() => useSensitive());
    expect(result.current.visible).to.equal(false);
    act(() => result.current.toggle());
    expect(result.current.visible).to.equal(false);
    expect(localStorage.getItem(STORAGE_KEY)).to.equal(null);
  });

  it('starts revealed only when the stored flag is exactly "1"', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    const revealed = render(
      <SensitiveProvider>
        <Sensitive>id-card-777</Sensitive>
      </SensitiveProvider>,
    );
    expect(screen.getByText('id-card-777')).to.not.equal(null);
    revealed.unmount();

    for (const stored of ['0', 'true', 'yes', '01']) {
      localStorage.setItem(STORAGE_KEY, stored);
      const masked = render(
        <SensitiveProvider>
          <Sensitive>id-card-777</Sensitive>
        </SensitiveProvider>,
      );
      expect(screen.queryByText('id-card-777'), `stored=${stored}`).to.equal(null);
      masked.unmount();
    }
  });

  it('renders a custom placeholder while hidden', () => {
    render(
      <SensitiveProvider>
        <Sensitive placeholder="[已隐藏]">secret</Sensitive>
      </SensitiveProvider>,
    );
    expect(screen.getByText('[已隐藏]')).to.not.equal(null);
    expect(screen.queryByText('secret')).to.equal(null);
  });

  it('reveals on toggle and persists "1" then "0" across flips', () => {
    render(
      <SensitiveProvider>
        <Toggler />
        <Sensitive>secret-phone</Sensitive>
      </SensitiveProvider>,
    );
    expect(screen.queryByText('secret-phone')).to.equal(null);

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('secret-phone')).to.not.equal(null);
    expect(localStorage.getItem(STORAGE_KEY)).to.equal('1');

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.queryByText('secret-phone')).to.equal(null);
    expect(localStorage.getItem(STORAGE_KEY)).to.equal('0');
  });

  it('falls back to hidden when localStorage reads throw', () => {
    vi.stubGlobal(
      'localStorage',
      createMemoryStorage({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    );
    render(
      <SensitiveProvider>
        <Sensitive>secret</Sensitive>
      </SensitiveProvider>,
    );
    expect(screen.queryByText('secret')).to.equal(null);
    expect(screen.getByText('••••••')).to.not.equal(null);
  });

  it('still toggles in memory when persisting fails', () => {
    vi.stubGlobal(
      'localStorage',
      createMemoryStorage({
        setItem: () => {
          throw new Error('quota exceeded');
        },
      }),
    );
    const { result } = renderHook(() => useSensitive(), { wrapper: SensitiveProvider });
    act(() => result.current.toggle());
    expect(result.current.visible).to.equal(true);
    act(() => result.current.toggle());
    expect(result.current.visible).to.equal(false);
  });
});
