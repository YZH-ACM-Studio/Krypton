// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { countMatches, expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const EDITOR = 'src/pages/problem-config-editor.tsx';

/** 用例列 ScrollArea 的 viewport wrapper 类。文件池必须照抄，truncate 才能收缩。 */
const CASE_WRAPPER_CLASSES = [
  '[&>div]:w-full',
  '[&>div]:min-w-0',
  '[&>div]:flex-col',
  '[&>div]:gap-1.5',
] as const;

const FILE_NAME_TAGS = ['span', 'p', 'div', 'a', 'button', 'Button'] as const;

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

/** 文件池列表的 ScrollArea 在上传对话框之前。 */
function filePoolRegion(source: string): string {
  const body = functionBody(source, 'FilesColumn');
  const dialog = body.indexOf('<Dialog');
  return dialog < 0 ? body : body.slice(0, dialog);
}

function viewportClassName(openTag: string): string {
  const quoted = /viewportClassName=(?:"([^"]*)"|'([^']*)')/.exec(openTag);
  const literal = quoted?.[1] ?? quoted?.[2];
  if (literal !== undefined) {
    return literal;
  }
  const expr = /viewportClassName=\{([\s\S]*?)\}/.exec(openTag);
  return expr?.[1] ?? '';
}

function directContent(source: string, openTag: string): string {
  const at = source.indexOf(openTag);
  if (at < 0) {
    return '';
  }
  const after = source.slice(at + openTag.length);
  const child = after.indexOf('<');
  return child < 0 ? after : after.slice(0, child);
}

function fileNameTruncateTags(source: string): { line: number; text: string }[] {
  const row = functionBody(source, 'FileRow');
  const tags: { line: number; text: string }[] = [];
  for (const name of FILE_NAME_TAGS) {
    for (const tag of findOpenTags(row, name)) {
      if (!/\btruncate\b/.test(tag.text)) {
        continue;
      }
      if (!/\{\s*f\.name\s*\}/.test(directContent(row, tag.text))) {
        continue;
      }
      tags.push(tag);
    }
  }
  return tags;
}

function bindsFileNameTitle(openTag: string): boolean {
  return /\btitle=\{\s*f\.name\s*\}/.test(openTag);
}

describe('q10 config editor long file names', () => {
  it('文件池 ScrollArea 使用 viewportLayout="flex" 和用例列相同的 wrapper 类', () => {
    const areas = findOpenTags(filePoolRegion(readSource(EDITOR)), 'ScrollArea');
    const problems: string[] = [];
    if (areas.length === 0) {
      problems.push('文件池列在上传对话框之前没有 ScrollArea');
    }
    const pool = areas.find((tag) => tag.text.includes('viewportLayout="flex"'));
    if (pool === undefined) {
      problems.push('包裹文件池的 ScrollArea 开标签缺少 viewportLayout="flex"');
    } else {
      const viewport = viewportClassName(pool.text);
      for (const token of CASE_WRAPPER_CLASSES) {
        if (!viewport.includes(token)) {
          problems.push(`文件池 viewportClassName 缺少 ${token}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('文件中 viewportLayout="flex" 至少出现 3 次', () => {
    const count = countMatches(readSource(EDITOR), /viewportLayout="flex"/g);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('文件名 truncate 元素带 title={文件名}', () => {
    const tags = fileNameTruncateTags(readSource(EDITOR));
    expect(tags.length).toBeGreaterThan(0);
    const missing = tags.filter((tag) => !bindsFileNameTitle(tag.text)).map((tag) => tag.text);
    expect(missing).toEqual([]);
  });

  it('评测配置编辑器门禁零违规', () => {
    expectGateClean([EDITOR]);
  });
});
