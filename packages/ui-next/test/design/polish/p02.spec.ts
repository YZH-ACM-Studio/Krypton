// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatLimitRange } from '../../../src/pages/problem-detail.tsx';
import { readSource } from '../helpers';

describe('p02 problem detail limits and workspace footer', () => {
  it('两者都有且不相等时显示 min–max 与单位', () => {
    expect(formatLimitRange(1000, 2000, 'ms')).toBe('1000\u20132000 ms');
  });

  it('上下限相等时只显示一个值', () => {
    expect(formatLimitRange(1000, 1000, 'ms')).toBe('1000 ms');
  });

  it('只有上限时显示该值', () => {
    expect(formatLimitRange(undefined, 2000, 'ms')).toBe('2000 ms');
  });

  it('只有下限时显示该值', () => {
    expect(formatLimitRange(1000, undefined, 'ms')).toBe('1000 ms');
  });

  it('内存限制套用同一范围格式', () => {
    expect(formatLimitRange(128, 256, 'MB')).toBe('128\u2013256 MB');
    expect(formatLimitRange(256, 256, 'MB')).toBe('256 MB');
    expect(formatLimitRange(undefined, 256, 'MB')).toBe('256 MB');
  });

  it('页脚源码在主区包含 Workspace 时用 :has() 隐藏', () => {
    expect(readSource('src/components/layout/footer.tsx')).toContain('has([data-slot=workspace])');
  });
});
