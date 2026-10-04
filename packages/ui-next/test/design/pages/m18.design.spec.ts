// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const ADMIN = 'src/pages/rankboard/admin.tsx';
const AWARD_DISPLAY = 'src/pages/rankboard/award-display.ts';
const LANE_FILES = [ADMIN] as const;

// legacy-intents T01–T04 没有源文件 src/pages/rankboard/admin.tsx 的条目。

/** §2.3 tone。金银铜与 award-display 的 MEDAL_TONE 一致。 */
const MEDAL_TONE_EXPECTED = {
  gold: 'warning',
  silver: 'neutral',
  bronze: 'orange',
} as const;

type MedalKey = keyof typeof MEDAL_TONE_EXPECTED;

const RAW_SHADE = /(?<![A-Za-z0-9-])(?:[\w-]+:)?(?:text|bg|border|from|via|to|fill|stroke|ring|outline)-(?:amber|yellow|slate|gray|zinc|stone|orange|red|rose|emerald|green|lime|teal|sky|blue|cyan|indigo|violet|purple|pink|fuchsia)-\d{2,3}/g;

const MEDAL_KEYS: readonly MedalKey[] = ['gold', 'silver', 'bronze'];

function rawShadeHits(source: string): string[] {
  const pattern = new RegExp(RAW_SHADE.source, RAW_SHADE.flags);
  return [...new Set(source.match(pattern) ?? [])];
}

function readStringField(block: string, key: string): string | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*(['"])([^'"]*)\\1`).exec(block);
  return match?.[2] ?? null;
}

function medalToneBlock(source: string): string | null {
  const match = /(?:export\s+)?const\s+MEDAL_TONE\b[^=]*=\s*\{([^{}]*)\}/.exec(source);
  return match?.[1] ?? null;
}

function medalToneFromBlock(block: string): Record<MedalKey, string> | null {
  const gold = readStringField(block, 'gold');
  const silver = readStringField(block, 'silver');
  const bronze = readStringField(block, 'bronze');
  if (gold === null || silver === null || bronze === null) return null;
  return { gold, silver, bronze };
}

function sharedMedalTone(source: string): Record<MedalKey, string> | null {
  const block = medalToneBlock(source);
  if (block === null) return null;
  return medalToneFromBlock(block);
}

function localMedalMaps(source: string): Array<Record<MedalKey, string>> {
  const maps: Array<Record<MedalKey, string>> = [];
  for (const match of source.matchAll(/\{([^{}]*)\}/g)) {
    const tone = medalToneFromBlock(match[1] ?? '');
    if (tone) maps.push(tone);
  }
  return maps;
}

interface MedalImport {
  local: string;
  kind: 'tone' | 'text';
}

function importedMedals(source: string): MedalImport[] {
  const imports: MedalImport[] = [];
  const pattern = /import\s*\{([^}]+)\}\s*from\s*['"]\.\/award-display['"]/g;
  for (const match of source.matchAll(pattern)) {
    for (const part of (match[1] ?? '').split(',')) {
      const trimmed = part.trim().replace(/^type\s+/, '');
      const original = /^([A-Za-z_$][\w$]*)/.exec(trimmed)?.[1] ?? '';
      let kind: MedalImport['kind'] | null = null;
      if (original === 'MEDAL_TONE') kind = 'tone';
      else if (original === 'MEDAL_TEXT_CLASS') kind = 'text';
      if (kind === null) continue;
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
      imports.push({ local: alias?.[1] ?? original, kind });
    }
  }
  return imports;
}

function skipNoise(source: string, index: number): number {
  if (source.startsWith('//', index)) {
    const newline = source.indexOf('\n', index);
    return newline < 0 ? source.length : newline + 1;
  }
  if (source.startsWith('/*', index)) {
    const end = source.indexOf('*/', index + 2);
    return end < 0 ? source.length : end + 2;
  }
  const quote = source[index];
  if (quote !== "'" && quote !== '"' && quote !== '`') return -1;
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
      cursor += 2;
      let depth = 1;
      while (cursor < source.length && depth > 0) {
        const nested = skipNoise(source, cursor);
        if (nested >= 0) {
          cursor = nested;
          continue;
        }
        if (source[cursor] === '{') depth += 1;
        else if (source[cursor] === '}') depth -= 1;
        cursor += 1;
      }
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const nested = skipNoise(source, index);
    if (nested >= 0) {
      index = nested - 1;
      continue;
    }
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** 参数类型里的花括号不算函数体。 */
function readFunctionBody(source: string, fnIndex: number): string | null {
  let paren = 0;
  let seenParen = false;
  for (let index = fnIndex; index < source.length; index += 1) {
    const nested = skipNoise(source, index);
    if (nested >= 0) {
      index = nested - 1;
      continue;
    }
    const char = source[index];
    if (char === '(') {
      paren += 1;
      seenParen = true;
    } else if (char === ')') {
      paren = Math.max(0, paren - 1);
    } else if (char === '{' && seenParen && paren === 0) {
      const end = matchingBrace(source, index);
      return end < 0 ? null : source.slice(index, end + 1);
    }
  }
  return null;
}

function medalFunctionBodies(source: string): string[] {
  const bodies: string[] = [];
  const seen = new Set<number>();
  for (const match of source.matchAll(/\bmedalMetal\s*\(/g)) {
    const at = match.index ?? 0;
    const fn = source.lastIndexOf('function ', at);
    if (fn < 0 || seen.has(fn)) continue;
    seen.add(fn);
    const body = readFunctionBody(source, fn);
    if (body) bodies.push(body);
  }
  return bodies;
}

function medalMetalBindings(body: string): Set<string> {
  const names = new Set<string>();
  for (const match of body.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*medalMetal\s*\(/g)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
}

function readAttr(tag: string, name: string): { literal: string | null; expr: string | null } | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([\\s\\S]*?)\\})`).exec(tag);
  if (!match) return null;
  if (match[1] !== undefined) return { literal: match[1], expr: null };
  if (match[2] !== undefined) return { literal: match[2], expr: null };
  return { literal: null, expr: (match[3] ?? '').trim() };
}

function literalValue(attr: { literal: string | null; expr: string | null }): string | null {
  if (attr.literal !== null) return attr.literal;
  const quoted = /^(['"])([^'"]*)\1$/.exec(attr.expr ?? '');
  return quoted?.[2] ?? null;
}

function sharedIndex(expr: string, locals: readonly string[]): string | null {
  const names = locals.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (names.length === 0) return null;
  const match = new RegExp(`^(?:${names})\\s*\\[\\s*([^\\]]+?)\\s*\\]$`).exec(expr.trim());
  return match?.[1]?.trim() ?? null;
}

function keyUsesMedalMetal(key: string, bindings: ReadonlySet<string>): boolean {
  if (/^medalMetal\s*\(/.test(key)) return true;
  return /^[A-Za-z_$][\w$]*$/.test(key) && bindings.has(key);
}

function badgeRegions(source: string): Array<{ open: string; inner: string }> {
  const regions: Array<{ open: string; inner: string }> = [];
  let searchFrom = 0;
  for (const tag of findOpenTags(source, 'Badge')) {
    const start = source.indexOf(tag.text, searchFrom);
    if (start < 0) continue;
    const openEnd = start + tag.text.length;
    searchFrom = openEnd;
    if (tag.text.endsWith('/>')) {
      regions.push({ open: tag.text, inner: '' });
      continue;
    }
    const close = source.indexOf('</Badge>', openEnd);
    regions.push({ open: tag.text, inner: close < 0 ? '' : source.slice(openEnd, close) });
  }
  return regions;
}

function openTagCovering(source: string, innerAt: number): string | null {
  const start = source.lastIndexOf('<', innerAt);
  if (start < 0 || source[start + 1] === '/') return null;
  const end = source.indexOf('>', start);
  if (end < 0 || end >= innerAt) return null;
  return source.slice(start, end + 1);
}

/** className 只有写在包住 `{name}` 的标签上才算着色，旁边未使用的下标不算。 */
function textClassPaintsName(body: string, textLocals: readonly string[], bindings: ReadonlySet<string>): boolean {
  const pattern = /\{\s*name\s*\}/g;
  for (const match of body.matchAll(pattern)) {
    const tag = openTagCovering(body, match.index ?? 0);
    const className = tag ? readAttr(tag, 'className') : null;
    const key = sharedIndex(className?.expr ?? '', textLocals);
    if (key !== null && keyUsesMedalMetal(key, bindings)) return true;
  }
  return false;
}

/**
 * 颜色由包住奖项名的 Badge `tone` 决定。文件里另写一行未使用的 MEDAL_TONE[metal]
 * 不能把 tone="neutral" 算成金银铜映射。
 */
function awardNameToneProblems(source: string): string[] {
  const problems: string[] = [];
  const toneLocals = importedMedals(source).filter((item) => item.kind === 'tone').map((item) => item.local);
  const textLocals = importedMedals(source).filter((item) => item.kind === 'text').map((item) => item.local);
  const bodies = medalFunctionBodies(source);
  const nameBadges = bodies.flatMap((body) => {
    const bindings = medalMetalBindings(body);
    return badgeRegions(body)
      .filter((region) => /\{\s*name\s*\}/.test(region.inner))
      .map((region) => ({ region, bindings }));
  });
  if (nameBadges.length === 0) {
    const painted = bodies.some((body) => textClassPaintsName(body, textLocals, medalMetalBindings(body)));
    if (!painted) {
      problems.push('奖项名的颜色不是由 MEDAL_TONE[medalMetal 的结果] 决定');
    }
    return problems;
  }
  for (const { region, bindings } of nameBadges) {
    const tone = readAttr(region.open, 'tone');
    if (!tone) {
      problems.push('奖项名 Badge 没有 tone，颜色不是由 MEDAL_TONE 决定');
      continue;
    }
    const literal = literalValue(tone);
    if (literal !== null) {
      problems.push(`奖项名 Badge 的 tone 是字面量 "${literal}"，金银铜不能因此变成同一种颜色`);
      continue;
    }
    const key = sharedIndex(tone.expr ?? '', toneLocals);
    if (key === null || !keyUsesMedalMetal(key, bindings)) {
      problems.push(`奖项名 Badge 的 tone 不是 MEDAL_TONE[medalMetal 的结果]：${tone.expr ?? ''}`);
    }
  }
  return problems;
}

function awardColorProblems(admin: string): string[] {
  const problems: string[] = [];
  const shades = rawShadeHits(admin);
  if (shades.length > 0) {
    problems.push(`奖项颜色使用了原始色板，不是 §2.3 tone：${shades.join(', ')}`);
  }
  problems.push(...awardNameToneProblems(admin));
  for (const map of localMedalMaps(admin)) {
    for (const key of MEDAL_KEYS) {
      if (map[key] !== MEDAL_TONE_EXPECTED[key]) {
        problems.push(`管理端 ${key} 应为 ${MEDAL_TONE_EXPECTED[key]}，实际 ${map[key]}`);
      }
    }
  }
  return problems;
}

describe('m18 rankboard administration', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 rankboard/admin.tsx', () => {
    expectPageStructure(ADMIN, {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('奖项类型颜色只用 §2.3 tone，金银铜与 award-display 一致', () => {
    expect(sharedMedalTone(readSource(AWARD_DISPLAY))).toEqual(MEDAL_TONE_EXPECTED);
    const problems = awardColorProblems(readSource(ADMIN));
    expect(problems).toEqual([]);
  });

  it('未使用的 MEDAL_TONE 下标不能把奖项名 Badge 收成同一种 tone', () => {
    const cheat = [
      "import { medalMetal, MEDAL_TONE } from './award-display';",
      'function AwardTypeName({ typeKey, name }: { typeKey: string; name: string }) {',
      '  const metal = medalMetal({ key: typeKey, name });',
      '  return (',
      '    <>',
      '      <Badge tone="neutral"><span>{name}</span></Badge>',
      '      {MEDAL_TONE[metal]}',
      '    </>',
      '  );',
      '}',
    ].join('\n');
    const problems = awardNameToneProblems(cheat);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.includes('字面量 "neutral"'))).toBe(true);
  });
});
