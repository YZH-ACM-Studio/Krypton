// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/contest-teams.tsx',
  'src/pages/team-batches.tsx',
] as const;

const TEAMS = 'src/pages/contest-teams.tsx';
const BATCHES = 'src/pages/team-batches.tsx';

/** legacy-intents-T03：管理端队伍行在 xl 上的三列。 */
const MANAGER_ROW_COLUMNS = 'xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_minmax(16rem,auto)]';

const TWO_COLUMN_CARDS = 'grid gap-3 lg:grid-cols-2';

function quotedStrings(source: string): string[] {
  const values: string[] = [];
  const pattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(pattern)) {
    values.push(match[2] ?? '');
  }
  return values;
}

function classStringHas(source: string, token: string): boolean {
  return quotedStrings(source).some((value) => value.includes(token));
}

function tagSetsStack(tag: string): boolean {
  return tag.includes('mobile="stack"')
    || tag.includes("mobile={'stack'}")
    || tag.includes('mobile={"stack"}');
}

function hasStackDataTable(source: string): boolean {
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('<DataTable', from);
    if (at < 0) {
      return false;
    }
    const next = source[at + '<DataTable'.length] ?? '';
    if (!/[\s>/]/.test(next)) {
      from = at + '<DataTable'.length;
      continue;
    }
    const close = source.indexOf('>', at);
    if (close < 0) {
      return false;
    }
    if (tagSetsStack(source.slice(at, close))) {
      return true;
    }
    from = close + 1;
  }
  return false;
}

function memberAvatarsStacked(source: string): boolean {
  let from = 0;
  while (from < source.length) {
    const classAt = source.indexOf('className=', from);
    if (classAt < 0) {
      return false;
    }
    const valueStart = classAt + 'className='.length;
    const quote = source[valueStart] ?? '';
    let valueEnd = valueStart;
    let value = '';
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, valueStart + 1);
      if (end < 0) {
        return false;
      }
      value = source.slice(valueStart + 1, end);
      valueEnd = end + 1;
    } else if (quote === '{') {
      const end = source.indexOf('}', valueStart + 1);
      if (end < 0) {
        return false;
      }
      value = source.slice(valueStart + 1, end);
      valueEnd = end + 1;
    } else {
      from = valueStart + 1;
      continue;
    }
    if (value.includes('-space-x-1.5') && /<Avatar\b/.test(source.slice(classAt, valueEnd + 4000))) {
      return true;
    }
    from = valueEnd;
  }
  return false;
}

describe('m08 contest teams and team batches', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 contest-teams.tsx', () => {
    expectPageStructure(TEAMS, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 team-batches.tsx', () => {
    expectPageStructure(BATCHES, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('管理端队伍行在 xl 上分成身份、成员和操作三列', () => {
    expect(classStringHas(readSource(TEAMS), MANAGER_ROW_COLUMNS)).toBe(true);
  });

  it('管理端队伍列表不再使用两列卡片网格', () => {
    expect(readSource(TEAMS).includes(TWO_COLUMN_CARDS)).toBe(false);
  });

  it('队伍列表使用 DataTable mobile="stack"', () => {
    expect(hasStackDataTable(readSource(TEAMS))).toBe(true);
  });

  it('成员用 Avatar 与 -space-x-1.5 叠放', () => {
    const source = readSource(TEAMS);
    expect(classStringHas(source, '-space-x-1.5')).toBe(true);
    expect(memberAvatarsStacked(source)).toBe(true);
  });
});
