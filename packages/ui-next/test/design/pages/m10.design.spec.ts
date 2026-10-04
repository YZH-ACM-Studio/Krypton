// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const PAGE = 'src/pages/problem-edit.tsx';

/** PLAN M10：未评定保持空串，其余难度值沿用 DIFFICULTY_LEVELS。 */
const DIFFICULTY_FROM_LEVELS = /DIFFICULTY_LEVELS\.map\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\(\s*\{\s*value:\s*\1\.value\s*===\s*0\s*\?\s*(?:''|"")\s*:\s*\1\.value\s*,\s*label:\s*\1\.label\s*\}\s*\)\s*\)/;

describe('m10 problem edit page', () => {
  it('门禁零违规', () => {
    expectGateClean([PAGE]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([PAGE]);
  });

  it('页面结构 problem-edit.tsx', () => {
    expectPageStructure(PAGE, {
      widths: ['form', 'wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('题面编辑区带 p-5', () => {
    const src = readSource(PAGE);
    const opening = /\{!isCreate\s*\?\s*\(\s*<div\b([^>]*)>/.exec(src);
    expect(opening).not.toBeNull();
    const className = /className="([^"]*)"/.exec(opening?.[1] ?? '');
    const tokens = (className?.[1] ?? '').split(/\s+/).filter((token) => token.length > 0);
    expect(tokens).toContain('p-5');
  });

  it('删除 DIFFICULTY_OPTIONS 并改用 DIFFICULTY_LEVELS', () => {
    const src = readSource(PAGE);
    expect(src).not.toMatch(/\bDIFFICULTY_OPTIONS\b/);
    expect(src).toMatch(DIFFICULTY_FROM_LEVELS);
  });
});
