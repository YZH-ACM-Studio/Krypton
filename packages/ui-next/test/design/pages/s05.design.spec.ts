// @vitest-environment node
import { describe, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, expectPageStructure } from '../helpers.ts';

const LANE_FILES = [
  'src/pages/problem-submit.tsx',
  'src/pages/problem-hack.tsx',
  'src/components/competitive-companion-bridge.tsx',
] as const;

describe('s05 problem submit and hack pages', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 problem-submit.tsx', () => {
    expectPageStructure('src/pages/problem-submit.tsx', {
      widths: ['form', 'wide'],
      workspace: 'allowed',
      minPageHeaders: 1,
    });
  });

  it('页面结构 problem-hack.tsx', () => {
    expectPageStructure('src/pages/problem-hack.tsx', {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });
});
