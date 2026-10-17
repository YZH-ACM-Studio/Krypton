// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const REMOVED_EDITORS = ['HomeworkEditPage', 'TrainingEditPage', 'ProblemSetManagePage'] as const;

// training-manage 与 problem-picker 的结构规格是组件，只进门禁，不写 expectPageStructure。
// legacy-intents T01–T04 没有这些源文件的条目。training.tsx 不是 training-manage.tsx。

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) found.push(full);
  }
  return found;
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

  it('页面结构 discussion-manage.tsx', () => {
    expectPageStructure(DISCUSSION, {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('题目选项难度走 Difficulty，不再用 Badge 写 Lv.N', () => {
    const source = readSource(PICKER);
    expect(importsVerdictDifficulty(source), PICKER).toBe(true);
    expect(difficultyLevelBindings(source).length, PICKER).toBeGreaterThan(0);
    expect(levelBadgeBodies(source), PICKER).toEqual([]);
  });

  it('旧的作业和题集编辑页不再出现在 src', () => {
    const src = resolve(import.meta.dirname, '../../../src');
    const hits: string[] = [];
    for (const file of sourceFiles(src)) {
      const text = readFileSync(file, 'utf8');
      for (const name of REMOVED_EDITORS) {
        if (text.includes(name)) hits.push(`${file} ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
