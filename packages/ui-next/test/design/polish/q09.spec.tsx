// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const METADATA = 'src/components/structured-problem-metadata-panel.tsx';
const INTEGRITY = 'src/components/practice-integrity-policy-panel.tsx';

/** 开标签之后、对应闭合标签之前的正文里含 label 的 Button。 */
function buttonOpenTagsContaining(source: string, label: string): string[] {
  const hits: string[] = [];
  let searchFrom = 0;
  for (const tag of findOpenTags(source, 'Button')) {
    const start = source.indexOf(tag.text, searchFrom);
    if (start < 0) continue;
    const after = start + tag.text.length;
    searchFrom = after;
    if (tag.text.endsWith('/>')) continue;
    const close = source.indexOf('</Button>', after);
    if (close < 0) continue;
    if (source.slice(after, close).includes(label)) hits.push(tag.text);
  }
  return hits;
}

describe('q09 metadata panel long map titles and integrity panel primary', () => {
  it('metadata 面板每个 SimpleSelect 开标签含 min-w-0', () => {
    const tags = findOpenTags(readSource(METADATA), 'SimpleSelect');
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(/\bmin-w-0\b/.test(tag.text), `${METADATA}:${tag.line} ${tag.text}`).toBe(true);
    }
  });

  it('「发布到学生」按钮开标签是 secondary，且真实性面板没有 primary', () => {
    const src = readSource(INTEGRITY);
    const publish = buttonOpenTagsContaining(src, '发布到学生');
    expect(publish).toHaveLength(1);
    expect(publish[0]).toContain('variant="secondary"');
    expect(src).not.toContain('variant="primary"');
  });

  it('门禁零违规', () => {
    expectGateClean([METADATA, INTEGRITY]);
  });
});
