// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const ANNOUNCE = 'src/pages/announcement/index.tsx';
const COLLECT = 'src/pages/admin-collect/index.tsx';

function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** className 字面量。表达式里的字符串也算，避免 min-h- / h- 只写在 cn() 里就漏掉。 */
function classNameLiterals(tag: string): string[] {
  const literals: string[] = [];
  for (const match of tag.matchAll(/\bclassName=(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/g)) {
    const quoted = match[1] ?? match[2];
    if (quoted !== undefined) {
      literals.push(quoted);
      continue;
    }
    const expression = match[3] ?? '';
    const strings = [...expression.matchAll(/['"`]([^'"`]*)['"`]/g)].map((item) => item[1] ?? '');
    literals.push(...(strings.length > 0 ? strings : [expression]));
  }
  return literals;
}

/** min-h-* 与 h-*（含 sm: 等变体）。max-h-* 不是按钮高度覆盖。 */
function heightOverrideTokens(className: string): string[] {
  return className.split(/\s+/).filter((token) => {
    const utility = token.split(':').pop() ?? '';
    return utility.startsWith('min-h-') || utility.startsWith('h-');
  });
}

describe('q03 announcement category dialog and collect button heights', () => {
  it('公告页每个 DialogFooter 开标签不含 flex-row 与 justify-', () => {
    const footers = findOpenTags(readSource(ANNOUNCE), 'DialogFooter');
    expect(footers.length).toBeGreaterThan(0);
    const violations = footers
      .filter((footer) => footer.text.includes('flex-row') || footer.text.includes('justify-'))
      .map((footer) => `${footer.line}: ${oneLine(footer.text)}`);
    expect(violations).toEqual([]);
  });

  it('收集页每个 Button 开标签不含 min-h- 或 h- 高度覆盖', () => {
    const buttons = findOpenTags(readSource(COLLECT), 'Button');
    expect(buttons.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const button of buttons) {
      const overrides = classNameLiterals(button.text).flatMap((value) => heightOverrideTokens(value));
      if (button.text.includes('min-h-') || overrides.length > 0) {
        const detail = overrides.length > 0 ? overrides.join(' ') : 'min-h-';
        violations.push(`${button.line}: ${detail} ${oneLine(button.text)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('公告与收集页门禁零违规', () => {
    expectGateClean([ANNOUNCE, COLLECT]);
  });
});
