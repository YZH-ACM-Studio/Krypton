// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/records.tsx',
  'src/pages/record-objective.tsx',
] as const;

const RECORDS_PAGE = 'src/pages/records.tsx';

function firstGroup(pattern: RegExp, tag: string): string | undefined {
  return pattern.exec(tag)?.[1];
}

function classNameText(tag: string): string {
  return firstGroup(/className="([^"]*)"/, tag)
    ?? firstGroup(/className='([^']*)'/, tag)
    ?? firstGroup(/className=\{`([^`]*)`\}/, tag)
    ?? firstGroup(/className=\{([\s\S]*?)\}/, tag)
    ?? '';
}

function classNameHas(tag: string, names: readonly string[]): boolean {
  const className = classNameText(tag);
  return names.every((name) => className.includes(name));
}

function verdictTags(source: string): string[] {
  return findOpenTags(source, 'Verdict').map((tag) => tag.text);
}

function scoreToneCalls(source: string): string[] {
  return source.match(/scoreTone\([^)]*\)/g) ?? [];
}

function passesProblemFull(call: string): boolean {
  return /scoreTone\([^,)]+,[^)]+\)/.test(call);
}

describe('s06 records list and record detail', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 records.tsx', () => {
    expectPageStructure(RECORDS_PAGE, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('记录表滚动区全宽，高度不超过 65vh 与 680px 中的较小值，并双向滚动', () => {
    const matched = findOpenTags(readSource(RECORDS_PAGE), 'ScrollArea').some((tag) => (
      classNameHas(tag.text, ['max-h-[min(65vh,680px)]', 'w-full'])
      && tag.text.includes('orientation="both"')
    ));
    expect(matched).toBe(true);
  });

  it('记录原生表在共用表格类之外至少 56rem 宽', () => {
    const matched = findOpenTags(readSource(RECORDS_PAGE), 'table').some((tag) => (
      tag.text.includes('RECORD_NATIVE_TABLE_CLASS')
      && classNameHas(tag.text, ['min-w-[56rem]'])
    ));
    expect(matched).toBe(true);
  });

  it('源码不包含 STATUS_MAP', () => {
    for (const file of LANE_FILES) {
      expect(readSource(file), file).not.toContain('STATUS_MAP');
    }
  });

  it('列表列 Verdict 使用 compact 和 texts', () => {
    const matched = verdictTags(readSource(RECORDS_PAGE)).some((tag) => (
      /\bcompact\b/.test(tag) && /\btexts=/.test(tag)
    ));
    expect(matched).toBe(true);
  });

  it('详情页头部 Verdict 使用 size="lg" 和 texts', () => {
    const matched = verdictTags(readSource(RECORDS_PAGE)).some((tag) => (
      /size="lg"|size=\{['"]lg['"]\}/.test(tag) && /\btexts=/.test(tag)
    ));
    expect(matched).toBe(true);
  });

  it('每个 Verdict 都传入 texts', () => {
    const tags = verdictTags(readSource(RECORDS_PAGE));
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => /\btexts=/.test(tag))).toBe(true);
  });

  it('记录页分数按题目满分调用 scoreTone', () => {
    const calls = scoreToneCalls(readSource(RECORDS_PAGE));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(passesProblemFull)).toBe(true);
    for (const tone of ['text-danger-fg', 'text-warning-fg', 'text-success-fg']) {
      expect(readSource(RECORDS_PAGE)).toContain(tone);
    }
  });

  it('客观题单题分数按 maxScore 调用 scoreTone', () => {
    const source = readSource('src/pages/record-objective.tsx');
    const calls = scoreToneCalls(source);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(passesProblemFull)).toBe(true);
    const rowCall = calls.find((call) => call.includes('row.score') && call.includes('row.maxScore'));
    expect(rowCall).toBeDefined();
    expect(rowCall ?? '').toMatch(/row\.score\s*,\s*row\.maxScore/);
  });
});
