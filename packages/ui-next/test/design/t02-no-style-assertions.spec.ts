// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSource } from './helpers.ts';
import { findStyleAssertions, parseIntents, type StyleHit } from './style-assertion-scan.ts';

const T02_TEST_FILES = [
  'test/drawer-scroll-consumers.spec.ts',
  'test/user-profile-external-rating.spec.ts',
  'test/management-workspace.contract.test.mjs',
  'test/admin-stats-echarts.spec.ts',
  'test/structured-code-ui.spec.ts',
  'test/admin-pages.spec.tsx',
  'test/virtual-contest-ui.spec.ts',
  'test/programming-editor-workspace.spec.ts',
] as const;

const T02_INTENT_FILE = 'test/design/legacy-intents-T02.md';

function formatStyleHits(hits: readonly StyleHit[]): string {
  return hits.map((hit) => `${hit.line}: ${hit.text}`).join('\n');
}

function baselineSource(testFile: string): string {
  const source = execFileSync('git', ['show', `78ff8de96:packages/ui-next/${testFile}`], {
    encoding: 'utf8',
  });
  if (typeof source !== 'string') {
    throw new TypeError('git show did not return text');
  }
  return source;
}

describe('t02 style assertions', () => {
  it.each(T02_TEST_FILES)('%s has no style assertions', (file) => {
    const hits = findStyleAssertions(readSource(file));
    expect(hits, formatStyleHits(hits)).toEqual([]);
  });

  it('records legacy intents for this lane whose it names are in the baseline', () => {
    const intents = parseIntents(readSource(T02_INTENT_FILE));
    expect(intents.length).toBeGreaterThan(0);
    for (const intent of intents) {
      expect(
        (T02_TEST_FILES as readonly string[]).includes(intent.testFile),
        intent.testFile,
      ).toBe(true);
      const baseline = baselineSource(intent.testFile);
      expect(baseline.includes(intent.itName), `${intent.testFile}::${intent.itName}`).toBe(true);
    }
  });

  it('points every legacy intent at an existing source file', () => {
    const intents = parseIntents(readSource(T02_INTENT_FILE));
    for (const intent of intents) {
      expect(intent.sourceFile.startsWith('src/'), intent.sourceFile).toBe(true);
      expect(existsSync(intent.sourceFile), intent.sourceFile).toBe(true);
    }
  });
});
