import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import type { DataZoomComponentOption, GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

export type KryptonEChartsOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | PieSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption | DataZoomComponentOption
>;

const REQUIRED_CSS_VARS = ['--background', '--foreground', '--muted-foreground', '--border', '--primary', '--card'] as const;
const CHART_PALETTE_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const;

export interface KryptonEchartTheme {
  background: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  primary: string;
  card: string;
  palette: string[];
}

function readRequiredCssVar(styles: CSSStyleDeclaration, name: (typeof REQUIRED_CSS_VARS)[number]): string {
  const value = styles.getPropertyValue(name).trim();
  if (!value) {
    throw new Error(`Missing required CSS variable ${name}`);
  }
  return value;
}

export function readEchartTheme(): KryptonEchartTheme {
  const styles = getComputedStyle(document.documentElement);
  const [background, foreground, mutedForeground, border, primary, card] = REQUIRED_CSS_VARS.map((name) => readRequiredCssVar(styles, name));
  const palette: string[] = [];
  for (const name of CHART_PALETTE_VARS) {
    const value = styles.getPropertyValue(name).trim();
    if (value) palette.push(value);
  }
  return {
    background,
    foreground,
    mutedForeground,
    border,
    primary,
    card,
    palette,
  };
}

function mergeTooltip(tooltip: KryptonEChartsOption['tooltip'], theme: KryptonEchartTheme): KryptonEChartsOption['tooltip'] {
  const defaults = {
    backgroundColor: theme.card,
    borderColor: theme.border,
    textStyle: { color: theme.foreground },
  };
  if (tooltip === undefined) return defaults;
  if (Array.isArray(tooltip)) {
    return tooltip.map((item) => ({ ...defaults, ...item }));
  }
  return { ...defaults, ...tooltip };
}

function mergeLegend(legend: NonNullable<KryptonEChartsOption['legend']>, theme: KryptonEchartTheme): KryptonEChartsOption['legend'] {
  const defaults = { textStyle: { color: theme.mutedForeground } };
  if (Array.isArray(legend)) {
    return legend.map((item) => ({ ...defaults, ...item }));
  }
  return { ...defaults, ...legend };
}

export function applyEchartDefaults(option: KryptonEChartsOption): KryptonEChartsOption {
  const theme = readEchartTheme();
  const palette = theme.palette.length > 0 ? theme.palette : [theme.primary];
  const textStyle = option.textStyle;
  const next: KryptonEChartsOption = {
    ...option,
    color: option.color ?? palette,
    backgroundColor: option.backgroundColor ?? theme.background,
    textStyle: {
      color: theme.foreground,
      ...(textStyle && typeof textStyle === 'object' ? textStyle : undefined),
    },
    tooltip: mergeTooltip(option.tooltip, theme),
  };
  if (option.legend !== undefined) {
    next.legend = mergeLegend(option.legend, theme);
  }
  return next;
}
