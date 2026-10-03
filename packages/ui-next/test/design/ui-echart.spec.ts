// @vitest-environment jsdom
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EChart } from '../../src/components/ui/echart';
import { applyEchartDefaults, readEchartTheme } from '../../src/components/ui/echart-theme';

const THEME_VALUES = {
  '--bg': 'v--bg',
  '--fg': 'v--fg',
  '--fg-subtle': 'v--fg-subtle',
  '--line': 'v--line',
  '--line-subtle': 'v--line-subtle',
  '--brand-solid': 'v--brand-solid',
  '--surface-raised': 'v--surface-raised',
  '--chart-1': 'v--chart-1',
  '--chart-2': 'v--chart-2',
  '--chart-3': 'v--chart-3',
  '--chart-4': 'v--chart-4',
  '--chart-5': 'v--chart-5',
  '--chart-6': 'v--chart-6',
} as const;

type ThemeToken = keyof typeof THEME_VALUES;

const CHART_PALETTE = [
  THEME_VALUES['--chart-1'],
  THEME_VALUES['--chart-2'],
  THEME_VALUES['--chart-3'],
  THEME_VALUES['--chart-4'],
  THEME_VALUES['--chart-5'],
  THEME_VALUES['--chart-6'],
] as const;

const TOOLTIP_EXTRA_CSS = 'box-shadow: var(--shadow-pop); border-radius: 11px;';

function isThemeToken(name: string): name is ThemeToken {
  return Object.hasOwn(THEME_VALUES, name);
}

function themeTokenNames(): ThemeToken[] {
  return Object.keys(THEME_VALUES).filter(isThemeToken);
}

function clearTheme(): void {
  document.documentElement.removeAttribute('style');
}

function installTheme(): void {
  clearTheme();
  for (const name of themeTokenNames()) {
    document.documentElement.style.setProperty(name, THEME_VALUES[name]);
  }
}

function capture<T>(fn: () => T): { value: T | undefined; message: string } {
  try {
    return { value: fn(), message: '' };
  } catch (error) {
    if (error instanceof Error) {
      return { value: undefined, message: error.message };
    }
    return { value: undefined, message: 'non-error throw' };
  }
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function singleOption<T>(value: T | T[] | undefined, label: string): T {
  expect(value, label).toBeDefined();
  expect(Array.isArray(value), label).toBe(false);
  if (value === undefined || Array.isArray(value)) {
    throw new TypeError(`expected a single ${label}`);
  }
  return value;
}

afterEach(() => {
  clearTheme();
});

describe('readEchartTheme', () => {
  it('reads chart-1 through chart-6, with chart-1 first', () => {
    installTheme();
    const result = capture(() => readEchartTheme());
    expect(result.message).toBe('');
    const theme = result.value;
    expect(theme).toBeDefined();
    if (theme === undefined) {
      return;
    }
    expect(theme.palette).toHaveLength(6);
    expect(theme.palette[0]).toBe(THEME_VALUES['--chart-1']);
    expect(theme.palette).toEqual([...CHART_PALETTE]);
  });

  it('throws when --chart-6 is removed', () => {
    installTheme();
    document.documentElement.style.removeProperty('--chart-6');
    expect(capture(() => readEchartTheme()).message).toBe('echart theme token missing: --chart-6');
  });

  it('throws echart theme token missing for every absent required token', () => {
    for (const name of themeTokenNames()) {
      installTheme();
      document.documentElement.style.removeProperty(name);
      expect(capture(() => readEchartTheme()).message).toBe(`echart theme token missing: ${name}`);
    }
  });

  it('returns each required token on the matching theme field', () => {
    installTheme();
    const result = capture(() => readEchartTheme());
    expect(result.message).toBe('');
    expect(result.value).toEqual({
      background: THEME_VALUES['--bg'],
      foreground: THEME_VALUES['--fg'],
      subtleForeground: THEME_VALUES['--fg-subtle'],
      line: THEME_VALUES['--line'],
      lineSubtle: THEME_VALUES['--line-subtle'],
      brand: THEME_VALUES['--brand-solid'],
      surfaceRaised: THEME_VALUES['--surface-raised'],
      palette: [...CHART_PALETTE],
    });
  });

  it('accepts a one-character token instead of treating it as missing', () => {
    installTheme();
    document.documentElement.style.setProperty('--brand-solid', 'x');
    const result = capture(() => readEchartTheme());
    expect(result.message).toBe('');
    expect(result.value?.brand).toBe('x');
  });
});

describe('applyEchartDefaults', () => {
  it('paints the x axis from line, line-subtle, and fg-subtle', () => {
    installTheme();
    const result = capture(() => applyEchartDefaults({ xAxis: {} }));
    expect(result.message).toBe('');
    const themed = result.value;
    expect(themed).toBeDefined();
    if (themed === undefined) {
      return;
    }
    const axis = singleOption(themed.xAxis, 'xAxis');
    expect(axis.axisLine?.lineStyle?.color).toBe(THEME_VALUES['--line']);
    expect(axis.splitLine?.lineStyle?.color).toBe(THEME_VALUES['--line-subtle']);
    expect(axis.axisLabel?.color).toBe(THEME_VALUES['--fg-subtle']);
    expect(axis.axisLabel?.fontSize).toBe(12);
  });

  it('paints the tooltip from surface-raised, line, fg, and shadow-pop', () => {
    installTheme();
    const result = capture(() => applyEchartDefaults({ xAxis: {} }));
    expect(result.message).toBe('');
    const themed = result.value;
    expect(themed).toBeDefined();
    if (themed === undefined) {
      return;
    }
    const tooltip = singleOption(themed.tooltip, 'tooltip');
    expect(tooltip.backgroundColor).toBe(THEME_VALUES['--surface-raised']);
    expect(tooltip.borderColor).toBe(THEME_VALUES['--line']);
    expect(tooltip.textStyle?.color).toBe(THEME_VALUES['--fg']);
    expect(tooltip.extraCssText).toBe(TOOLTIP_EXTRA_CSS);
  });

  it('paints every tooltip when tooltip is an array', () => {
    installTheme();
    const result = capture(() => applyEchartDefaults({ tooltip: [{}, {}] }));
    expect(result.message).toBe('');
    const themed = result.value;
    expect(themed).toBeDefined();
    if (themed === undefined) {
      return;
    }
    expect(Array.isArray(themed.tooltip)).toBe(true);
    if (!Array.isArray(themed.tooltip)) {
      return;
    }
    expect(themed.tooltip).toHaveLength(2);
    for (const item of themed.tooltip) {
      expect(item.backgroundColor).toBe(THEME_VALUES['--surface-raised']);
      expect(item.borderColor).toBe(THEME_VALUES['--line']);
      expect(item.textStyle?.color).toBe(THEME_VALUES['--fg']);
      expect(item.extraCssText).toBe(TOOLTIP_EXTRA_CSS);
    }
  });

  it('paints every x axis when xAxis is an array', () => {
    installTheme();
    const result = capture(() => applyEchartDefaults({
      xAxis: [{ type: 'category' }, { type: 'value' }],
    }));
    expect(result.message).toBe('');
    const themed = result.value;
    expect(themed).toBeDefined();
    if (themed === undefined) {
      return;
    }
    expect(Array.isArray(themed.xAxis)).toBe(true);
    if (!Array.isArray(themed.xAxis)) {
      return;
    }
    expect(themed.xAxis).toHaveLength(2);
    for (const [index, axis] of themed.xAxis.entries()) {
      expect(axis.axisLine?.lineStyle?.color).toBe(THEME_VALUES['--line']);
      expect(axis.splitLine?.lineStyle?.color).toBe(THEME_VALUES['--line-subtle']);
      expect(axis.axisLabel?.color).toBe(THEME_VALUES['--fg-subtle']);
      expect(axis.axisLabel?.fontSize).toBe(12);
      expect(axis.type).toBe(index === 0 ? 'category' : 'value');
    }
  });

  it('paints the y axis from line, line-subtle, and fg-subtle', () => {
    installTheme();
    const result = capture(() => applyEchartDefaults({ yAxis: { type: 'value' } }));
    expect(result.message).toBe('');
    const themed = result.value;
    expect(themed).toBeDefined();
    if (themed === undefined) {
      return;
    }
    const axis = singleOption(themed.yAxis, 'yAxis');
    expect(axis.type).toBe('value');
    expect(axis.axisLine?.lineStyle?.color).toBe(THEME_VALUES['--line']);
    expect(axis.splitLine?.lineStyle?.color).toBe(THEME_VALUES['--line-subtle']);
    expect(axis.axisLabel?.color).toBe(THEME_VALUES['--fg-subtle']);
    expect(axis.axisLabel?.fontSize).toBe(12);
  });

  it('paints legend text with --fg-subtle', () => {
    installTheme();
    const result = capture(() => applyEchartDefaults({ legend: {} }));
    expect(result.message).toBe('');
    const themed = result.value;
    expect(themed).toBeDefined();
    if (themed === undefined) {
      return;
    }
    const legend = singleOption(themed.legend, 'legend');
    expect(legend.textStyle?.color).toBe(THEME_VALUES['--fg-subtle']);
  });

  it('uses chart-1 through chart-6 unless option.color is already set', () => {
    installTheme();
    const defaults = capture(() => applyEchartDefaults({}));
    expect(defaults.message).toBe('');
    expect(defaults.value?.color).toEqual([...CHART_PALETTE]);
    const custom = capture(() => applyEchartDefaults({ color: ['kept'] }));
    expect(custom.message).toBe('');
    expect(custom.value?.color).toEqual(['kept']);
  });
});

describe('echart', () => {
  it('uses h-56 as the default height', () => {
    const view = render(createElement(EChart, { option: {} }));
    const root = view.container.firstElementChild;
    expect(root).toBeInstanceOf(HTMLElement);
    if (!(root instanceof HTMLElement)) {
      return;
    }
    const tokens = classTokens(root);
    expect(tokens).toContain('h-56');
    expect(tokens).not.toContain('h-[220px]');
  });

  it('lets a caller height class replace the default h-56', () => {
    const byClass = render(createElement(EChart, { option: {}, className: 'h-[240px]' }));
    const classRoot = byClass.container.firstElementChild;
    expect(classRoot).toBeInstanceOf(HTMLElement);
    if (!(classRoot instanceof HTMLElement)) {
      return;
    }
    const classNameTokens = classTokens(classRoot);
    expect(classNameTokens).toContain('h-[240px]');
    expect(classNameTokens).not.toContain('h-56');
    byClass.unmount();

    const byHeight = render(createElement(EChart, { option: {}, heightClassName: 'h-40' }));
    const heightRoot = byHeight.container.firstElementChild;
    expect(heightRoot).toBeInstanceOf(HTMLElement);
    if (!(heightRoot instanceof HTMLElement)) {
      return;
    }
    const heightTokens = classTokens(heightRoot);
    expect(heightTokens).toContain('h-40');
    expect(heightTokens).not.toContain('h-56');
  });
});
