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
  '--background': 'rgb(255, 255, 255)',
  '--foreground': 'rgb(10, 10, 10)',
  '--muted-foreground': 'rgb(100, 116, 139)',
  '--border': 'rgb(226, 232, 240)',
  '--primary': 'rgb(14, 165, 233)',
  '--card': 'rgb(248, 250, 252)',
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
    expect(() => readEchartTheme()).toThrow(/Missing required CSS variable --background/);
  });

  it('throws on the first missing required CSS variable', () => {
    mockDocumentCssVars({
      '--background': 'bg',
      '--foreground': 'fg',
      '--muted-foreground': 'muted',
      '--border': 'border',
      '--card': 'card',
    });
    expect(() => readEchartTheme()).toThrow(/Missing required CSS variable --primary/);
  });

  it('returns colors from mocked getComputedStyle', () => {
    mockDocumentCssVars({
      ...REQUIRED_CSS_VARS,
      '--chart-1': 'c1',
      '--chart-2': 'c2',
      '--chart-3': 'c3',
      '--chart-4': 'c4',
      '--chart-5': 'c5',
    });
    expect(readEchartTheme()).toEqual({
      background: 'rgb(255, 255, 255)',
      foreground: 'rgb(10, 10, 10)',
      mutedForeground: 'rgb(100, 116, 139)',
      border: 'rgb(226, 232, 240)',
      primary: 'rgb(14, 165, 233)',
      card: 'rgb(248, 250, 252)',
      palette: ['c1', 'c2', 'c3', 'c4', 'c5'],
    });
  });

  it('omits missing --chart-* tokens from the series palette', () => {
    mockDocumentCssVars({
      ...REQUIRED_CSS_VARS,
      '--chart-1': 'c1',
      '--chart-3': 'c3',
    });
    expect(readEchartTheme().palette).toEqual(['c1', 'c3']);
  });
});

describe('applyEchartDefaults', () => {
  it('fills series color from --chart-* and text from --foreground', () => {
    mockDocumentCssVars({
      ...REQUIRED_CSS_VARS,
      '--chart-1': 'c1',
      '--chart-2': 'c2',
    });
    const option: KryptonEChartsOption = { series: [{ type: 'bar', data: [1, 2] }] };
    const themed = applyEchartDefaults(option);
    expect(themed.color).toEqual(['c1', 'c2']);
    expect(themed.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(themed.textStyle).toMatchObject({ color: 'rgb(10, 10, 10)' });
    expect(option.color).toBeUndefined();
  });

  it('falls back to --primary when no chart palette is present', () => {
    mockDocumentCssVars(REQUIRED_CSS_VARS);
    const themed = applyEchartDefaults({ series: [] });
    expect(themed.color).toEqual(['rgb(14, 165, 233)']);
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
