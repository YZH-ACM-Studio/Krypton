import { useLayoutEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { cn } from '@/lib/cn';
import { useColorMode } from '@/lib/use-color-mode';
import { applyEchartDefaults, type KryptonEChartsOption } from './echart-theme';

export type { KryptonEChartsOption };

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

export function EChart({
  option,
  className,
  heightClassName,
}: {
  option: KryptonEChartsOption;
  className?: string;
  heightClassName?: string;
}) {
  const colorMode = useColorMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const ensureChart = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      const existing = chartRef.current;
      if (existing) {
        existing.resize();
        return;
      }
      echarts.getInstanceByDom(el)?.dispose();
      const chart = echarts.init(el, undefined, { renderer: 'canvas' });
      chartRef.current = chart;
      try {
        chart.setOption(applyEchartDefaults(optionRef.current), { notMerge: true });
      } catch (error) {
        chart.dispose();
        chartRef.current = null;
        throw error;
      }
    };

    ensureChart();
    const observer = new ResizeObserver(ensureChart);
    observer.observe(el);
    return () => {
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [colorMode]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(applyEchartDefaults(option), { notMerge: true });
  }, [option]);

  return <div ref={containerRef} className={cn('h-[220px] w-full min-w-0', heightClassName, className)} />;
}
