// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const LANE_FILES = [
  'src/pages/contest-exam-detail.tsx',
  'src/pages/contest-exam-manage.tsx',
  'src/pages/contest-exam-score-batch.tsx',
] as const;

const DETAIL = 'src/pages/contest-exam-detail.tsx';
const MANAGE = 'src/pages/contest-exam-manage.tsx';
const SCORE = 'src/pages/contest-exam-score-batch.tsx';

// 仍在使用的考试子视图：结构规格只有门禁，不写 expectPageStructure。
const CARD_FILES = [DETAIL, MANAGE, SCORE] as const;
const HEADING_FILES = [DETAIL, MANAGE] as const;
const HEADING_FILE_SET: ReadonlySet<string> = new Set(HEADING_FILES);
const CARD_TAGS = ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter'] as const;
const FILE_PANEL_TITLES = ['公开文件', '私有材料'] as const;

function classTokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0 && !token.includes('${')));
}

function headingTokens(tag: string): Set<string> {
  const at = tag.indexOf('className');
  if (at < 0) return new Set();
  const tokens = new Set<string>();
  for (const match of tag.slice(at).matchAll(/['"`]([^'"`]*)['"`]/g)) {
    for (const token of classTokens(match[1] ?? '')) tokens.add(token);
  }
  return tokens;
}

function importsPanel(source: string): boolean {
  return /from\s+['"]@\/components\/ui\/panel['"]/.test(source);
}

function panelHasTitle(tag: string, title: string): boolean {
  return tag.includes(`title="${title}"`)
    || tag.includes(`title={'${title}'}`)
    || tag.includes(`title={"${title}"}`);
}

function cardProblems(file: string): string[] {
  const source = readSource(file);
  const problems: string[] = [];
  if (source.includes('components/ui/card')) problems.push(`${file} 仍引用 card`);
  for (const tag of CARD_TAGS) {
    for (const open of findOpenTags(source, tag)) problems.push(`${file}:${open.line} <${tag}`);
  }
  return problems;
}

describe('m09 contest exam configuration pages', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('子视图的 h1 改为 h2 text-lg font-semibold', () => {
    const h1 = HEADING_FILES.flatMap((file) => (
      findOpenTags(readSource(file), 'h1').map((tag) => `${file}:${tag.line} ${tag.text}`)
    ));
    const h2 = HEADING_FILES.flatMap((file) => {
      const matched = findOpenTags(readSource(file), 'h2').some((tag) => {
        const tokens = headingTokens(tag.text);
        return tokens.has('text-lg') && tokens.has('font-semibold');
      });
      return matched ? [] : [file];
    });
    const stray = LANE_FILES.filter((file) => !HEADING_FILE_SET.has(file) && findOpenTags(readSource(file), 'h1').length > 0);
    expect({ h1, h2, stray }).toEqual({ h1: [], h2: [], stray: [] });
  });

  it('迁移文件里的 Card 换成 Panel', () => {
    const problems = LANE_FILES.flatMap((file) => cardProblems(file));
    const missingPanel = CARD_FILES.filter((file) => {
      const source = readSource(file);
      return !importsPanel(source) || findOpenTags(source, 'Panel').length === 0;
    });
    expect({ problems, missingPanel }).toEqual({ problems: [], missingPanel: [] });
  });

  it('考试材料卡改为 Panel', () => {
    const source = readSource(MANAGE);
    const panels = findOpenTags(source, 'Panel').map((tag) => tag.text);
    const calls = findOpenTags(source, 'ExamFileCard').map((tag) => tag.text);
    const missingTitles = FILE_PANEL_TITLES.filter((title) => {
      const onPanel = panels.some((tag) => panelHasTitle(tag, title));
      const onCall = panels.length > 0 && calls.some((tag) => panelHasTitle(tag, title));
      return !onPanel && !onCall;
    });
    expect({
      card: cardProblems(MANAGE),
      panel: importsPanel(source) && panels.length > 0,
      missingTitles,
    }).toEqual({ card: [], panel: true, missingTitles: [] });
  });
});
