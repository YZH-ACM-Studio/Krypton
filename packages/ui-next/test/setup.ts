import '@testing-library/jest-dom/vitest';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

// The `/vitest` entry supplies the types but extends the `vitest` instance it
// resolves itself. In a git worktree whose node_modules is linked from the
// main checkout, that is not the instance running the tests, so extend the
// running one as well.
expect.extend(jestDomMatchers);

/**
 * Global test setup for `@hydrooj/ui-next`.
 *
 * Loaded via `test.setupFiles` in `vitest.config.ts` for every test file,
 * including the `// @vitest-environment node` ones — so every browser-only
 * access here must be guarded.
 */

const hasDom = typeof window !== 'undefined';

afterEach(() => {
  if (hasDom) cleanup();
});

if (hasDom) {
  // jsdom implements neither of these, and Radix / shadcn primitives call them
  // during mount. Without the stubs, any component test that renders a Dialog,
  // Select or ScrollArea throws before its first assertion.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })) as unknown as typeof window.matchMedia;
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }

  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    } as unknown as typeof window.IntersectionObserver;
  }

  // Radix uses these for focus management and pointer capture; jsdom omits them.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  }

  // CodeMirror measures Range geometry after animation frames. jsdom exposes
  // Range but omits the layout methods, so editor tests need an empty geometry.
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function getClientRects() {
      return {
        length: 0,
        item: () => null,
        [Symbol.iterator]: () => [][Symbol.iterator](),
      } as DOMRectList;
    };
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return new DOMRect();
    };
  }
}
