// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { paginationBaseUrl } from '../../../src/pages/problem-set-roster.tsx';
import { expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const ROSTER = 'src/components/practice-roster.tsx';
const ROSTER_PAGE = 'src/pages/problem-set-roster.tsx';
const HOMEWORK = 'src/pages/homework.tsx';
const LANE_FILES = [ROSTER, ROSTER_PAGE, HOMEWORK] as const;
const OPAQUE_SURFACE = /(?:^|\s)bg-surface(?:-sunken)?(?:\s|$)/;
const WINDOW_GUARD = /typeof\s+window\s*[!=]==\s*['"]undefined['"]|\bwindow\s*[!=]==\s*undefined\b/;
const ROSTER_IMPORT = /import\s*\{[^}]*\bpaginationBaseUrl\b[^}]*\}\s*from\s*['"][^'"]*problem-set-roster['"]/;

function classText(openTag: string): string {
  const quoted = /className=(?:"([^"]*)"|'([^']*)')/.exec(openTag);
  const literal = quoted?.[1] ?? quoted?.[2];
  if (literal !== undefined) return literal;
  const expr = /className=\{([\s\S]*?)\}/.exec(openTag);
  const text = expr?.[1];
  expect(text, `missing className on ${openTag}`).toBeDefined();
  return text ?? '';
}

function lastOpenTag(source: string, tag: string, before: number): string {
  const needle = `<${tag}`;
  let from = before;
  while (from >= 0) {
    const start = source.lastIndexOf(needle, from);
    expect(start, `<${tag}`).toBeGreaterThanOrEqual(0);
    if (start < 0) return '';
    const boundary = source[start + needle.length];
    if (boundary === ' ' || boundary === '\n' || boundary === '\t' || boundary === '\r' || boundary === '>' || boundary === '/') {
      const end = source.indexOf('>', start);
      expect(end, `<${tag}>`).toBeGreaterThan(start);
      return source.slice(start, (end < 0 ? start : end) + 1);
    }
    from = start - 1;
  }
  return '';
}

function matrixParts(source: string): { corner: string; header: string; firstColumn: string; scroll: string } {
  const marker = '>题目</th>';
  const markerAt = source.indexOf(marker);
  expect(markerAt, '矩阵左上角「题目」').toBeGreaterThanOrEqual(0);
  const tableStart = source.lastIndexOf('<table', Math.max(markerAt, 0));
  expect(tableStart).toBeGreaterThanOrEqual(0);
  const tableEnd = source.indexOf('</table>', Math.max(markerAt, 0));
  expect(tableEnd).toBeGreaterThan(markerAt);
  const origin = Math.max(tableStart, 0);
  const block = source.slice(origin, tableEnd);
  const cornerAt = markerAt - origin;
  const stickyCells = findOpenTags(block, 'td').filter((tag) => /\bsticky\b/.test(tag.text) && /\bleft-0\b/.test(tag.text));
  expect(stickyCells).toHaveLength(1);
  const scrolls = findOpenTags(source.slice(0, origin), 'ScrollArea');
  expect(scrolls.length).toBeGreaterThan(0);
  return {
    corner: classText(lastOpenTag(block, 'th', cornerAt)),
    header: classText(lastOpenTag(block, 'thead', cornerAt)),
    firstColumn: classText(stickyCells[0]?.text ?? ''),
    scroll: scrolls[scrolls.length - 1]?.text ?? '',
  };
}

function expectOpaqueLayer(className: string, z: string): void {
  expect(className).toMatch(new RegExp(`(?:^|\\s)${z}(?:\\s|$)`));
  expect(className).toMatch(OPAQUE_SURFACE);
  expect(className).not.toMatch(/\/\d/);
}

function queryOf(search: string): URLSearchParams {
  const baseUrl = paginationBaseUrl(search);
  expect(baseUrl).not.toContain('??');
  expect(baseUrl).not.toContain('&&');
  const query = baseUrl.includes('?') ? baseUrl.slice(baseUrl.indexOf('?') + 1) : baseUrl;
  return new URLSearchParams(query);
}

function attributeValue(tag: string, name: string): string {
  const key = `${name}=`;
  const at = tag.indexOf(key);
  expect(at, tag).toBeGreaterThanOrEqual(0);
  if (at < 0) return '';
  const start = at + key.length;
  const quote = tag[start];
  if (quote === '"' || quote === "'") {
    const end = tag.indexOf(quote, start + 1);
    expect(end).toBeGreaterThan(start);
    return tag.slice(start + 1, end < 0 ? tag.length : end);
  }
  expect(quote, tag).toBe('{');
  let depth = 0;
  for (let index = start; index < tag.length; index += 1) {
    const ch = tag[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return tag.slice(start + 1, index);
    }
  }
  expect(depth, tag).toBe(0);
  return '';
}

function homeworkListPagination(source: string): string {
  const tags = findOpenTags(source, 'Pagination').filter((tag) => tag.text.includes('total={tpcount}'));
  expect(tags).toHaveLength(1);
  return tags[0]?.text ?? '';
}

describe('p07 homework roster matrix header and pagination filters', () => {
  function parts() {
    return matrixParts(readSource(ROSTER));
  }

  it('左上角单元格使用 z-30 与不透明背景', () => {
    const { corner } = parts();
    expect(corner).toMatch(/(?:^|\s)sticky(?:\s|$)/);
    expect(corner).toMatch(/(?:^|\s)left-0(?:\s|$)/);
    expectOpaqueLayer(corner, 'z-30');
  });

  it('矩阵表头使用 sticky top-0 z-20 与不透明背景', () => {
    const { header } = parts();
    expect(header).toMatch(/(?:^|\s)sticky(?:\s|$)/);
    expect(header).toMatch(/(?:^|\s)top-0(?:\s|$)/);
    expectOpaqueLayer(header, 'z-20');
  });

  it('矩阵首列使用 sticky left-0 z-10 与不透明背景', () => {
    const { firstColumn } = parts();
    expect(firstColumn).toMatch(/(?:^|\s)sticky(?:\s|$)/);
    expect(firstColumn).toMatch(/(?:^|\s)left-0(?:\s|$)/);
    expectOpaqueLayer(firstColumn, 'z-10');
  });

  it('矩阵保留双向 ScrollArea', () => {
    expect(parts().scroll).toContain('orientation="both"');
  });

  it('分页 baseUrl 由 location.search 去掉 page 后保留其余参数', () => {
    const kept = queryOf('?q=a&page=3');
    expect(paginationBaseUrl('?q=a&page=3')).toContain('q=a');
    expect(paginationBaseUrl('?q=a&page=3')).not.toContain('page=3');
    expect(kept.get('q')).toBe('a');
    expect(kept.has('page')).toBe(false);

    const withGroup = queryOf('?page=3&q=a&group=b');
    expect(withGroup.get('q')).toBe('a');
    expect(withGroup.get('group')).toBe('b');
    expect(withGroup.has('page')).toBe(false);

    const pageOnly = queryOf('?page=3');
    expect(pageOnly.has('page')).toBe(false);
    expect(paginationBaseUrl('?page=3')).not.toContain('page');
  });

  it('作业列表 Pagination 的 baseUrl 调用 paginationBaseUrl，无 window 时退回作业地址', () => {
    const homework = readSource(HOMEWORK);
    const baseUrl = attributeValue(homeworkListPagination(homework), 'baseUrl');
    expect({
      imported: ROSTER_IMPORT.test(homework),
      calls: /\bpaginationBaseUrl\s*\(/.test(baseUrl),
      keepsHomeworkUrl: baseUrl.includes('bs.urls.homework'),
      ssrFallback: WINDOW_GUARD.test(homework),
    }, baseUrl).toEqual({
      imported: true,
      calls: true,
      keepsHomeworkUrl: true,
      ssrFallback: true,
    });
  });

  it('本 lane 源文件通过设计门禁', () => {
    expectGateClean([...LANE_FILES]);
  });
});
