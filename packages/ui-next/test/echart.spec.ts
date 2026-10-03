import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EChart, type KryptonEChartsOption } from '../src/components/ui/echart';
import { applyEchartDefaults, readEchartTheme } from '../src/components/ui/echart-theme';

const echartsCore = vi.hoisted(() => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
  use: vi.fn(),
  getInstanceByDom: vi.fn(() => undefined),
}));

vi.mock('echarts/core', () => ({
  init: echartsCore.init,
  use: echartsCore.use,
  getInstanceByDom: echartsCore.getInstanceByDom,
}));

const REQUIRED_CSS_VARS: Record<string, string> = {
  '--bg': 'rgb(255, 255, 255)',
  '--fg': 'rgb(10, 10, 10)',
  '--fg-subtle': 'rgb(100, 116, 139)',
  '--line': 'rgb(226, 232, 240)',
  '--line-subtle': 'rgb(241, 245, 249)',
  '--brand-solid': 'rgb(79, 70, 229)',
  '--surface-raised': 'rgb(248, 250, 252)',
  '--chart-1': 'c1',
  '--chart-2': 'c2',
  '--chart-3': 'c3',
  '--chart-4': 'c4',
  '--chart-5': 'c5',
  '--chart-6': 'c6',
};

function mockDocumentCssVars(vars: Record<string, string>): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
    const getPropertyValue = (property: string): string => {
      if (element !== document.documentElement) return '';
      return vars[property] ?? '';
    };
    return { getPropertyValue } as CSSStyleDeclaration;
  });
}

describe('readEchartTheme', () => {
  it('throws when required CSS variables are missing', () => {
    mockDocumentCssVars({});
    expect(() => readEchartTheme()).toThrow(/echart theme token missing: --bg/);
  });

  it('throws on the first missing required CSS variable', () => {
    const { '--brand-solid': _omitted, ...withoutBrand } = REQUIRED_CSS_VARS;
    mockDocumentCssVars(withoutBrand);
    expect(() => readEchartTheme()).toThrow(/echart theme token missing: --brand-solid/);
  });

  it('returns colors from mocked getComputedStyle', () => {
    mockDocumentCssVars(REQUIRED_CSS_VARS);
    expect(readEchartTheme()).toEqual({
      background: 'rgb(255, 255, 255)',
      foreground: 'rgb(10, 10, 10)',
      subtleForeground: 'rgb(100, 116, 139)',
      line: 'rgb(226, 232, 240)',
      lineSubtle: 'rgb(241, 245, 249)',
      brand: 'rgb(79, 70, 229)',
      surfaceRaised: 'rgb(248, 250, 252)',
      palette: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
    });
  });

  it('throws when a --chart-* token is missing instead of shortening the palette', () => {
    const { '--chart-6': _omitted, ...withoutChart6 } = REQUIRED_CSS_VARS;
    mockDocumentCssVars(withoutChart6);
    expect(() => readEchartTheme()).toThrow(/echart theme token missing: --chart-6/);
  });
});

describe('applyEchartDefaults', () => {
  it('fills series color from --chart-* and text from --fg', () => {
    mockDocumentCssVars(REQUIRED_CSS_VARS);
    const option: KryptonEChartsOption = { series: [{ type: 'bar', data: [1, 2] }] };
    const themed = applyEchartDefaults(option);
    expect(themed.color).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(themed.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(themed.textStyle).toMatchObject({ color: 'rgb(10, 10, 10)' });
    expect(option.color).toBeUndefined();
  });
});

function stubClientSize(width: number, height: number): () => void {
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDesc);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  };
}

describe('echart wrapper', () => {
  it('does not call echarts.init when the container has zero size', () => {
    render(createElement(EChart, { option: { series: [] } }));
    expect(echartsCore.init).not.toHaveBeenCalled();
  });

  it('disposes the instance if setOption throws after init', () => {
    mockDocumentCssVars(REQUIRED_CSS_VARS);
    const dispose = vi.fn();
    echartsCore.init.mockReturnValue({
      setOption: vi.fn(() => {
        throw new Error('setOption failed');
      }),
      resize: vi.fn(),
      dispose,
    });
    const restoreClientSize = stubClientSize(400, 220);
    try {
      expect(() => render(createElement(EChart, { option: { series: [] } }))).toThrow(/setOption failed/);
      expect(dispose).toHaveBeenCalled();
    } finally {
      restoreClientSize();
    }
  });
});
