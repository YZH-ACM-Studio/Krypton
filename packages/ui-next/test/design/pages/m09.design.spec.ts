// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expectExplicitButtonVariants, expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const LANE_FILES = [
  'src/pages/contest-edit-exam.tsx',
  'src/pages/contest-exam-detail.tsx',
  'src/pages/contest-exam-manage.tsx',
  'src/pages/contest-exam-paper-pool.tsx',
  'src/pages/contest-exam-paper-quotas.tsx',
  'src/pages/contest-exam-pass-settings.tsx',
  'src/pages/contest-exam-score-batch.tsx',
] as const;

const EDIT = 'src/pages/contest-edit-exam.tsx';
const DETAIL = 'src/pages/contest-exam-detail.tsx';
const MANAGE = 'src/pages/contest-exam-manage.tsx';
const SCORE = 'src/pages/contest-exam-score-batch.tsx';

// 这些文件现在用 Card 分区；迁移后必须改成 Panel。没有 Card 的文件不要求凭空加 Panel。
const CARD_FILES = [EDIT, DETAIL, MANAGE, SCORE] as const;
const HEADING_FILES = [EDIT, DETAIL, MANAGE] as const;
const HEADING_FILE_SET: ReadonlySet<string> = new Set(HEADING_FILES);
const CARD_TAGS = ['Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter'] as const;
const EXAM_PANEL_TITLES = ['这场考试', '试卷', '谁能考', '考生说明', '客户端与反作弊'] as const;
const FILE_PANEL_TITLES = ['公开文件', '私有材料'] as const;
const SELECTED_TOKENS = ['border-brand', 'bg-brand-soft/60'] as const;

// 七个文件都是子视图：结构规格只有门禁，不写 expectPageStructure。
// legacy-intents T01–T04 没有这些源文件的条目。

function classTokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter((token) => token.length > 0 && !token.includes('${')));
}

function hasTokens(value: string, tokens: readonly string[]): boolean {
  const present = classTokens(value);
  return tokens.every((token) => present.has(token));
}

function selectedClass(value: string): boolean {
  if (!hasTokens(value, SELECTED_TOKENS)) return false;
  const tokens = value.split(/\s+/);
  return tokens.lastIndexOf('border-line') < tokens.lastIndexOf('border-brand');
}

function unselectedClass(value: string): boolean {
  const tokens = classTokens(value);
  return tokens.has('border-line') && !tokens.has('border-brand') && !tokens.has('bg-brand-soft/60');
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

function quotedPieces(source: string): { value: string; index: number }[] {
  return [...source.matchAll(/['"`]([^'"`]*)['"`]/g)].map((match) => ({
    value: match[1] ?? '',
    index: match.index ?? 0,
  }));
}

function balancedCall(source: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

function choiceStates(source: string): { selected: boolean; unselected: boolean } {
  const ternary = /\?\s*(['"`])([^'"`]*)\1\s*:\s*(['"`])([^'"`]*)\3/g;
  for (const match of source.matchAll(ternary)) {
    if (selectedClass(match[2] ?? '') && unselectedClass(match[4] ?? '')) {
      return { selected: true, unselected: true };
    }
  }
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('cn(', from);
    if (at < 0) break;
    const body = balancedCall(source, at + 2);
    if (body === null) break;
    const pieces = quotedPieces(body);
    const selectedPiece = pieces.find((piece) => selectedClass(piece.value));
    const plainPiece = pieces.find((piece) => unselectedClass(piece.value));
    const conditional = selectedPiece !== undefined
      && /(?:&&|\?)\s*$/.test(body.slice(Math.max(0, selectedPiece.index - 40), selectedPiece.index));
    if (selectedPiece && plainPiece && plainPiece.index < selectedPiece.index && conditional) {
      return { selected: true, unselected: true };
    }
    from = at + 3 + body.length;
  }
  return { selected: false, unselected: false };
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

  it('考试分区改为 Panel 且不保留 ExamCard 包装', () => {
    const source = readSource(EDIT);
    const panels = findOpenTags(source, 'Panel').map((tag) => tag.text);
    const missingTitles = EXAM_PANEL_TITLES.filter((title) => !panels.some((tag) => panelHasTitle(tag, title)));
    expect({
      wrapper: source.includes('function ExamCard') || findOpenTags(source, 'ExamCard').length > 0,
      missingTitles,
    }).toEqual({ wrapper: false, missingTitles: [] });
  });

  it('可选卡片选中为 border-brand bg-brand-soft/60，未选为 border-line', () => {
    expect(choiceStates(readSource(EDIT))).toEqual({ selected: true, unselected: true });
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
