// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const GRADING = 'src/pages/manual-grading.tsx';
const HOMEWORK = 'src/pages/homework-manage.tsx';
const TRAINING = 'src/pages/training-manage.tsx';
const DISCUSSION = 'src/pages/discussion-manage.tsx';
const PICKER = 'src/components/problem-picker.tsx';

const LANE_FILES = [GRADING, HOMEWORK, TRAINING, DISCUSSION, PICKER] as const;

// training-manage 与 problem-picker 的结构规格是组件，只进门禁，不写 expectPageStructure。
// legacy-intents T01–T04 没有这些源文件的条目。training.tsx 不是 training-manage.tsx。

function classTokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0 && !token.includes('${')));
}

function tagClassTokens(tag: string): Set<string> {
  const at = tag.indexOf('className');
  if (at < 0) return new Set();
  const tokens = new Set<string>();
  for (const match of tag.slice(at).matchAll(/['"`]([^'"`]*)['"`]/g)) {
    for (const token of classTokens(match[1] ?? '')) tokens.add(token);
  }
  return tokens;
}

function isSpecifiedHeading(tag: string): boolean {
  const tokens = tagClassTokens(tag);
  return tokens.has('text-lg') && tokens.has('font-semibold');
}

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function specifiedHeadingBodies(source: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (const tag of findOpenTags(source, 'h2')) {
    const start = source.indexOf(tag.text, from);
    if (start < 0) continue;
    const after = start + tag.text.length;
    from = after;
    if (!isSpecifiedHeading(tag.text) || tag.text.endsWith('/>')) continue;
    const close = source.indexOf('</h2>', after);
    if (close < 0) continue;
    bodies.push(source.slice(after, close));
  }
  return bodies;
}

function importsPanel(source: string): boolean {
  return /from\s+['"]@\/components\/ui\/panel['"]/.test(source);
}

// DESIGN §12.6：题目难度只能走 Difficulty，不能退回 outline Badge 的 Lv.N。
function importsVerdictDifficulty(source: string): boolean {
  const compact = source.replaceAll(/\s+/g, ' ');
  return /import \{[^}]*\bDifficulty\b[^}]*\} from ['"]@\/components\/ui\/verdict['"]/.test(compact);
}

function difficultyLevelBindings(source: string): string[] {
  return findOpenTags(source, 'Difficulty')
    .map((tag) => tag.text)
    .filter((text) => /\blevel\s*=/.test(text) && text.includes('.difficulty'));
}

function levelBadgeBodies(source: string): string[] {
  const hits: string[] = [];
  let from = 0;
  for (const tag of findOpenTags(source, 'Badge')) {
    const start = source.indexOf(tag.text, from);
    if (start < 0) continue;
    const after = start + tag.text.length;
    from = after;
    if (tag.text.endsWith('/>')) continue;
    const close = source.indexOf('</Badge>', after);
    if (close < 0) continue;
    const body = source.slice(after, close);
    if (/Lv\./.test(body)) hits.push(body.trim());
  }
  return hits;
}

describe('m16 grading, homework/problem-set management, discussion editing, problem picker', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 manual-grading.tsx', () => {
    expectPageStructure(GRADING, {
      widths: ['wide'],
      workspace: 'allowed',
      minPageHeaders: 1,
    });
  });

  it('页面结构 homework-manage.tsx', () => {
    expectPageStructure(HOMEWORK, {
      widths: ['form', 'wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('页面结构 discussion-manage.tsx', () => {
    expectPageStructure(DISCUSSION, {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('training-manage 的 h1 改为 h2 text-lg font-semibold', () => {
    const source = readSource(TRAINING);
    const h1 = findOpenTags(source, 'h1').map((tag) => `${tag.line}:${tag.text}`);
    const bodies = specifiedHeadingBodies(source);
    expect({
      h1,
      edit: bodies.some((body) => body.includes('编辑题集') && body.includes('创建题集')),
      files: bodies.some((body) => body.includes('题集文件')),
    }).toEqual({ h1: [], edit: true, files: true });
  });

  it('阶段卡使用 Panel，拖拽手柄为 GripVertical text-fg-subtle', () => {
    const source = readSource(TRAINING);
    const body = functionBody(source, 'SortableStageCard');
    const handle = findOpenTags(body, 'GripVertical').some((tag) => tagClassTokens(tag.text).has('text-fg-subtle'));
    expect({
      imported: importsPanel(source),
      panel: findOpenTags(body, 'Panel').length > 0,
      handle,
    }).toEqual({ imported: true, panel: true, handle: true });
  });

  it('题目选项难度走 Difficulty，不再用 Badge 写 Lv.N', () => {
    for (const file of [PICKER, HOMEWORK]) {
      const source = readSource(file);
      expect(importsVerdictDifficulty(source), file).toBe(true);
      expect(difficultyLevelBindings(source).length, file).toBeGreaterThan(0);
      expect(levelBadgeBodies(source), file).toEqual([]);
    }
  });
});
