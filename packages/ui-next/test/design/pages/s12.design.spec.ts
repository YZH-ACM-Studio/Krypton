// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers';

const FILES = [
  'src/pages/ranking.tsx',
  'src/pages/rankboard/index.tsx',
  'src/pages/rankboard/gallery.tsx',
  'src/pages/rankboard/award-display.ts',
] as const;

const RANKING = 'src/pages/ranking.tsx';
const RANKBOARD = 'src/pages/rankboard/index.tsx';
const GALLERY = 'src/pages/rankboard/gallery.tsx';
const AWARD_DISPLAY = 'src/pages/rankboard/award-display.ts';

const RANKING_TABLES = [RANKING, RANKBOARD] as const;
const RANK_NUMBER_FILES = [RANKING, RANKBOARD, GALLERY] as const;

/** 纯名次，以及夹在「现场 / 校内 / 队伍排名」等文字里的名次。不匹配模板字符串里的 ${rank}。 */
const RANK_NUMBER = /#\{[A-Za-z0-9_.]*[Rr]ank\}|\{(?:r|row)\.rank\}|(?<!\$)\{rank(?:\s*\|\|[^}]*)?\}|\{teamRankLabel\}/g;
const SCROLL_MOBILE = /mobile=(?:"scroll"|'scroll'|\{["']scroll["']\})/;
const RAW_MEDAL_SHADE = /(?:text|border|from|via|bg)-(?:amber|yellow|slate|gray|orange)-\d/;
const AWARD_DISPLAY_IMPORT = /from ['"](?:\.\/rankboard\/award-display|@\/pages\/rankboard\/award-display)['"]/;

const METAL_TONE = {
  gold: 'warning',
  silver: 'neutral',
  bronze: 'orange',
} as const;

const FOREIGN_TONES = ['brand', 'success', 'warning', 'danger', 'info', 'violet', 'orange', 'neutral'] as const;

interface MetalStrings {
  gold: string;
  silver: string;
  bronze: string;
}

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

function readStringProp(block: string, key: string): string | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`).exec(block);
  return match?.[2] ?? null;
}

function metalStringMaps(source: string): MetalStrings[] {
  const maps: MetalStrings[] = [];
  for (const match of source.matchAll(/\{[^{}]*\}/g)) {
    const block = match[0] ?? '';
    const gold = readStringProp(block, 'gold');
    const silver = readStringProp(block, 'silver');
    const bronze = readStringProp(block, 'bronze');
    if (gold === null || silver === null || bronze === null) {
      continue;
    }
    maps.push({ gold, silver, bronze });
  }
  return maps;
}

function hasTone(value: string, tone: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9])${tone}(?:[^A-Za-z0-9]|$)`).test(value);
}

function usesRawPalette(value: string): boolean {
  return /(?:amber|yellow|slate|gray|zinc|stone|red|rose|emerald|green|lime|teal|sky|blue|cyan|indigo|violet|purple|pink|orange)-\d/.test(value);
}

function usesForeignTone(value: string, allowed: string): boolean {
  return FOREIGN_TONES.some((tone) => tone !== allowed && hasTone(value, tone));
}

function toneMapOk(map: MetalStrings): boolean {
  const entries = Object.entries(METAL_TONE) as Array<[keyof MetalStrings, string]>;
  return entries.every(([metal, tone]) => {
    const value = map[metal];
    return hasTone(value, tone) && !usesRawPalette(value) && !usesForeignTone(value, tone);
  });
}

function dataTableProblems(source: string): string[] {
  const tags = [...source.matchAll(/<DataTable\b[^>]*>/g)].map((match) => match[0] ?? '');
  if (tags.length === 0) {
    return ['缺少 <DataTable'];
  }
  return tags.filter((tag) => !SCROLL_MOBILE.test(tag)).map((tag) => `DataTable 未写 mobile="scroll"：${tag}`);
}

/** scroll 模式要保留二维对比列，不能再用 hideBelow 把 RP 分项、CF/牛客或简介藏起来。 */
function comparisonHideBelowProblems(source: string): string[] {
  const problems: string[] = [];
  const marks = [...source.matchAll(/hideBelow\s*[:=]/g)];
  for (let i = 0; i < marks.length; i += 1) {
    const index = marks[i]?.index ?? 0;
    const next = marks[i + 1]?.index ?? Math.min(source.length, index + 700);
    const after = source.slice(index, next);
    const before = source.slice(Math.max(0, index - 80), index);
    let kind = '对比列';
    if (/getRpDetail/.test(after)) {
      kind = 'RP 分项';
    } else if (/formatPublicRating|codeforces|nowcoder/.test(after)) {
      kind = 'CF/牛客 Rating';
    } else if (/简介|['"]bio['"]/.test(before) || /简介|['"]bio['"]/.test(after)) {
      kind = '简介';
    }
    problems.push(`${kind}在 mobile="scroll" 下不得写 hideBelow`);
  }
  return problems;
}

function tagClassTokens(tag: string): Set<string> {
  const tokens = new Set<string>();
  const literals = [
    /className="([^"]*)"/.exec(tag)?.[1],
    /className='([^']*)'/.exec(tag)?.[1],
    /className=\{`([^`]*)`\}/.exec(tag)?.[1],
    /className=\{"([^"]*)"\}/.exec(tag)?.[1],
    /className=\{'([^']*)'\}/.exec(tag)?.[1],
  ];
  for (const literal of literals) {
    if (literal === undefined) {
      continue;
    }
    for (const token of literal.split(/\s+/)) {
      if (token.length > 0) {
        tokens.add(token);
      }
    }
  }
  const cn = /className=\{cn\(([\s\S]*)\)\}/.exec(tag)?.[1];
  if (cn !== undefined) {
    for (const literal of cn.matchAll(/['"`]([^'"`]*)['"`]/g)) {
      for (const token of (literal[1] ?? '').split(/\s+/)) {
        if (token.length > 0) {
          tokens.add(token);
        }
      }
    }
  }
  return tokens;
}

function enclosingTag(source: string, index: number): { tag: string; inner: string } | null {
  let from = index;
  while (from > 0) {
    const tagStart = source.lastIndexOf('<', from);
    if (tagStart < 0) {
      return null;
    }
    if (source[tagStart + 1] === '/' || source[tagStart + 1] === '!') {
      from = tagStart - 1;
      continue;
    }
    const tagEnd = source.indexOf('>', tagStart);
    if (tagEnd < 0 || tagEnd > index) {
      from = tagStart - 1;
      continue;
    }
    const innerEnd = source.indexOf('<', tagEnd + 1);
    return {
      tag: source.slice(tagStart, tagEnd + 1),
      inner: source.slice(tagEnd + 1, innerEnd < 0 ? source.length : innerEnd),
    };
  }
  return null;
}

function rankTypographyProblems(source: string): string[] {
  const problems: string[] = [];
  let sawRankNumber = false;
  const expression = new RegExp(RANK_NUMBER.source, RANK_NUMBER.flags);
  for (const match of source.matchAll(expression)) {
    const text = match[0] ?? '';
    const enclosed = enclosingTag(source, match.index ?? 0);
    if (enclosed === null || !enclosed.inner.includes(text)) {
      continue;
    }
    sawRankNumber = true;
    const tokens = tagClassTokens(enclosed.tag);
    if (!tokens.has('tabular') || !tokens.has('font-semibold')) {
      problems.push(`${text} → ${enclosed.tag}`);
    }
  }
  if (!sawRankNumber) {
    problems.push('没有名次数字');
  }
  return problems;
}

function panelShellProblems(source: string, name: string): string[] {
  const body = functionBody(source, name);
  if (body.length > 0) {
    const problems: string[] = [];
    if (!/<Panel(?=[\s/>])/.test(body)) {
      problems.push(`${name} 未使用 Panel`);
    }
    if (/<Card(?=[\s/>])/.test(body)) {
      problems.push(`${name} 仍使用 Card`);
    }
    return problems;
  }
  if (!/<Panel(?=[\s/>])/.test(source)) {
    return [`${name} 已删除但仍缺少 Panel`];
  }
  return [];
}

describe('lane S12 ranking and rankboards', () => {
  it('门禁零违规', () => {
    expectGateClean([...FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...FILES]);
  });

  it('页面结构 ranking.tsx', () => {
    expectPageStructure(RANKING, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 rankboard/index.tsx', () => {
    expectPageStructure(RANKBOARD, {
      widths: ['wide', 'full'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('页面结构 rankboard/gallery.tsx', () => {
    expectPageStructure(GALLERY, {
      widths: ['full'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('排名表用 DataTable mobile="scroll"', () => {
    for (const file of RANKING_TABLES) {
      const problems = dataTableProblems(readSource(file));
      expect(problems, file).toEqual([]);
    }
    const hidden = comparisonHideBelowProblems(readSource(RANKING));
    expect(hidden, RANKING).toEqual([]);
  });

  it('排名数字使用 tabular 与 font-semibold', () => {
    const problems: string[] = [];
    for (const file of RANK_NUMBER_FILES) {
      for (const problem of rankTypographyProblems(readSource(file))) {
        problems.push(`${file}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('把 PodiumCard 换成 Panel 的外观', () => {
    const problems = panelShellProblems(readSource(RANKBOARD), 'PodiumCard');
    expect(problems).toEqual([]);
  });

  it('把 TeamCard 换成 Panel 的外观', () => {
    const problems = panelShellProblems(readSource(GALLERY), 'TeamCard');
    expect(problems).toEqual([]);
  });

  it('奖牌和名次颜色只使用 award-display 里的 warning、neutral、orange', () => {
    const maps = metalStringMaps(readSource(AWARD_DISPLAY));
    expect(maps.length).toBeGreaterThan(0);
    const matched = maps.find((map) => toneMapOk(map));
    expect(matched, `金银铜映射应为 warning/neutral/orange，实际 ${JSON.stringify(maps)}`).toBeDefined();
    const ranking = readSource(RANKING);
    const rankboard = readSource(RANKBOARD);
    expect(ranking).toMatch(AWARD_DISPLAY_IMPORT);
    expect(ranking).not.toMatch(RAW_MEDAL_SHADE);
    expect(rankboard).toMatch(/from ['"]\.\/award-display['"]/);
    expect(rankboard).not.toMatch(RAW_MEDAL_SHADE);
  });
});
