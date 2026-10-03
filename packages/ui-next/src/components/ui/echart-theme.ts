import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import type { DataZoomComponentOption, GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import { readToken } from '@/lib/read-token';

export type KryptonEChartsOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | PieSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption | DataZoomComponentOption
>;

const TOOLTIP_EXTRA_CSS = 'box-shadow: var(--shadow-pop); border-radius: 11px;';
const AXIS_LABEL_FONT_SIZE = 12;

export interface KryptonEchartTheme {
  background: string;
  foreground: string;
  subtleForeground: string;
  line: string;
  lineSubtle: string;
  brand: string;
  surfaceRaised: string;
  palette: string[];
}

function readRequiredToken(name: `--${string}`): string {
  const value = readToken(name);
  if (value === '') {
    throw new Error(`echart theme token missing: ${name}`);
  }
  return value;
}

function readThemeTokens() {
  return {
    '--bg': readRequiredToken('--bg'),
    '--fg': readRequiredToken('--fg'),
    '--fg-subtle': readRequiredToken('--fg-subtle'),
    '--line': readRequiredToken('--line'),
    '--line-subtle': readRequiredToken('--line-subtle'),
    '--brand-solid': readRequiredToken('--brand-solid'),
    '--surface-raised': readRequiredToken('--surface-raised'),
    '--chart-1': readRequiredToken('--chart-1'),
    '--chart-2': readRequiredToken('--chart-2'),
    '--chart-3': readRequiredToken('--chart-3'),
    '--chart-4': readRequiredToken('--chart-4'),
    '--chart-5': readRequiredToken('--chart-5'),
    '--chart-6': readRequiredToken('--chart-6'),
  };
}

export function readEchartTheme(): KryptonEchartTheme {
  const tokens = readThemeTokens();
  return {
    background: tokens['--bg'],
    foreground: tokens['--fg'],
    subtleForeground: tokens['--fg-subtle'],
    line: tokens['--line'],
    lineSubtle: tokens['--line-subtle'],
    brand: tokens['--brand-solid'],
    surfaceRaised: tokens['--surface-raised'],
    palette: [
      tokens['--chart-1'],
      tokens['--chart-2'],
      tokens['--chart-3'],
      tokens['--chart-4'],
      tokens['--chart-5'],
      tokens['--chart-6'],
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: object): value is readonly unknown[] {
  return Array.isArray(value);
}

function paintOneAxis<T>(axis: T, theme: KryptonEchartTheme): T {
  if (!isRecord(axis)) {
    return axis;
  }
  const axisLine = isRecord(axis.axisLine) ? axis.axisLine : {};
  const splitLine = isRecord(axis.splitLine) ? axis.splitLine : {};
  const axisLabel = isRecord(axis.axisLabel) ? axis.axisLabel : {};
  const axisLineStyle = isRecord(axisLine.lineStyle) ? axisLine.lineStyle : {};
  const splitLineStyle = isRecord(splitLine.lineStyle) ? splitLine.lineStyle : {};
  return {
    ...axis,
    axisLine: {
      ...axisLine,
      lineStyle: {
        color: theme.line,
        ...axisLineStyle,
      },
    },
    splitLine: {
      ...splitLine,
      lineStyle: {
        color: theme.lineSubtle,
        ...splitLineStyle,
      },
    },
    axisLabel: {
      color: theme.subtleForeground,
      fontSize: AXIS_LABEL_FONT_SIZE,
      ...axisLabel,
    },
  } as T;
}

function paintAxis<T>(axis: T, theme: KryptonEchartTheme): T {
  if (typeof axis === 'object' && axis !== null && isUnknownArray(axis)) {
    return axis.map((item) => paintOneAxis(item, theme)) as T;
  }
  return paintOneAxis(axis, theme);
}

function mergeTooltip(tooltip: KryptonEChartsOption['tooltip'], theme: KryptonEchartTheme): KryptonEChartsOption['tooltip'] {
  const paint = (item: TooltipComponentOption | undefined): TooltipComponentOption => {
    const textStyle = item?.textStyle;
    return {
      backgroundColor: theme.surfaceRaised,
      borderColor: theme.line,
      extraCssText: TOOLTIP_EXTRA_CSS,
      ...item,
      textStyle: {
        color: theme.foreground,
        ...(textStyle && typeof textStyle === 'object' ? textStyle : undefined),
      },
    };
  };
  if (tooltip === undefined) return paint(undefined);
  if (Array.isArray(tooltip)) {
    return tooltip.map((item) => paint(item));
  }
  return paint(tooltip);
}

function mergeLegend(legend: NonNullable<KryptonEChartsOption['legend']>, theme: KryptonEchartTheme): KryptonEChartsOption['legend'] {
  const defaults = { textStyle: { color: theme.subtleForeground } };
  if (Array.isArray(legend)) {
    return legend.map((item) => ({ ...defaults, ...item }));
  }
  return { ...defaults, ...legend };
}

export function applyEchartDefaults(option: KryptonEChartsOption): KryptonEChartsOption {
  const theme = readEchartTheme();
  const textStyle = option.textStyle;
  const next: KryptonEChartsOption = {
    ...option,
    color: option.color ?? theme.palette,
    backgroundColor: option.backgroundColor ?? theme.background,
    textStyle: {
      color: theme.foreground,
      ...(textStyle && typeof textStyle === 'object' ? textStyle : undefined),
    },
    tooltip: mergeTooltip(option.tooltip, theme),
  };
  if (option.xAxis !== undefined) {
    next.xAxis = paintAxis(option.xAxis, theme);
  }
  if (option.yAxis !== undefined) {
    next.yAxis = paintAxis(option.yAxis, theme);
  }
  if (option.legend !== undefined) {
    next.legend = mergeLegend(option.legend, theme);
  }
  return next;
}
