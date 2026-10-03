// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from './helpers.ts';
import { findStyleAssertions, parseIntents } from './style-assertion-scan.ts';

const LANE_FILES: readonly string[] = [
  'test/user-account-settings.spec.ts',
  'test/problem-set-roster-layout.spec.ts',
  'test/exam-seat-plan.page.spec.tsx',
  'test/contest-team-workspace.spec.ts',
  'test/user-account-messages.spec.tsx',
  'test/task-management-workspace.spec.ts',
  'test/management-entry-dialog-announcement.spec.ts',
  'test/sidebar-tooltip.spec.ts',
];

const INTENT_FILE = 'test/design/legacy-intents-T03.md';
const BASELINE = '78ff8de96';
const packageRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(packageRoot, '..');

function baselineSource(testFile: string): string {
  return execFileSync('git', ['show', `${BASELINE}:packages/ui-next/${testFile}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function baselineItNames(testFile: string): string[] {
  const names: string[] = [];
  const pattern = /it(?:\.(?:only|skip|todo))?\(\s*(['"`])([\s\S]*?)\1/g;
  const source = baselineSource(testFile);
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    names.push(match[2] ?? '');
  }
  return names;
}

describe('t03 style assertions', () => {
  it.each(LANE_FILES)('%s has no style assertions', (file) => {
    const hits = findStyleAssertions(readSource(file));
    const detail = hits.map((hit) => `${hit.line}: ${hit.text}`).join('\n');
    expect(hits, detail).toEqual([]);
  });

  it('lists at least one intent for a lane file whose it name is in the baseline', () => {
    const intents = parseIntents(readSource(INTENT_FILE));
    expect(intents.length).toBeGreaterThan(0);
    for (const intent of intents) {
      expect(LANE_FILES.includes(intent.testFile), intent.testFile).toBe(true);
      expect(baselineSource(intent.testFile).includes(intent.itName), intent.itName).toBe(true);
    }
  });

  it('points each intent at an existing source file under src/', () => {
    const intents = parseIntents(readSource(INTENT_FILE));
    for (const intent of intents) {
      expect(intent.sourceFile.startsWith('src/'), intent.sourceFile).toBe(true);
      expect(existsSync(resolve(packageRoot, intent.sourceFile)), intent.sourceFile).toBe(true);
    }
  });

  it('records a removed assertion, an intent sentence, and a follow-up in every section', () => {
    const sections = readSource(INTENT_FILE).split(/\n(?=## )/).filter((section) => section.startsWith('## '));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const title = section.split('\n')[0] ?? '';
      const removed = section.match(/^- 删除的断言：[^\S\n]*(\S.*)$/m);
      const sentence = section.match(/^- 意图（一句话）：[^\S\n]*(\S.*)$/m);
      const follow = section.match(/^- 后续阶段应如何表达：[^\S\n]*(\S.*)$/m);
      expect(typeof removed?.[1], title).toBe('string');
      expect(typeof sentence?.[1], title).toBe('string');
      expect(typeof follow?.[1], title).toBe('string');
    }
  });

  it('copies each intent it name from a baseline it() argument', () => {
    const intents = parseIntents(readSource(INTENT_FILE));
    const namesByFile = new Map<string, string[]>();
    for (const intent of intents) {
      let names = namesByFile.get(intent.testFile);
      if (names === undefined) {
        names = baselineItNames(intent.testFile);
        namesByFile.set(intent.testFile, names);
      }
      expect(names.includes(intent.itName), `${intent.testFile} :: ${intent.itName}`).toBe(true);
    }
  });
});
