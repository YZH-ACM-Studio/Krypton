// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSource } from './helpers.ts';
import { findStyleAssertions, parseIntents } from './style-assertion-scan.ts';

const LANE_FILES: readonly string[] = [
  'test/collect-pages.spec.ts',
  'test/viewport-layout.spec.ts',
  'test/home-training-progress.spec.ts',
  'test/mindmap-workspace.spec.ts',
  'test/collect-home-block.spec.ts',
  'test/course-full-width-layout.spec.ts',
  'test/course-workspace.spec.ts',
  'test/problem-full-width-layout.spec.ts',
];

const INTENTS_FILE = 'test/design/legacy-intents-T01.md';

describe('t01 style assertions are removed', () => {
  for (const file of LANE_FILES) {
    it(`${file} has no style assertions`, () => {
      const hits = findStyleAssertions(readSource(file));
      const listed = hits.map((hit) => `${hit.line}: ${hit.text}`).join('\n');
      expect(hits, `${file}\n${listed}`).toEqual([]);
    });
  }
});

describe('t01 legacy intents', () => {
  it('names baseline it() text from this lane', () => {
    const intents = parseIntents(readSource(INTENTS_FILE));
    expect(intents.length).toBeGreaterThan(0);
    for (const intent of intents) {
      expect(LANE_FILES.includes(intent.testFile), intent.testFile).toBe(true);
      // itName is matched against the baseline source, so template literals stay unexpanded.
      const baseline = execFileSync('git', ['show', `78ff8de96:packages/ui-next/${intent.testFile}`], {
        encoding: 'utf8',
      });
      expect(baseline.includes(intent.itName), `${intent.testFile} :: ${intent.itName}`).toBe(true);
    }
  });

  it('points each intent at an existing src file', () => {
    const intents = parseIntents(readSource(INTENTS_FILE));
    for (const intent of intents) {
      expect(intent.sourceFile.startsWith('src/'), intent.sourceFile).toBe(true);
      expect(existsSync(intent.sourceFile), intent.sourceFile).toBe(true);
    }
  });

  it('records an intent sentence and a follow-up for every removed assertion', () => {
    const sections = readSource(INTENTS_FILE).split(/\n(?=## )/).filter((section) => section.startsWith('## '));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const title = section.split('\n')[0] ?? '';
      const removed = section.match(/^- 删除的断言：[^\S\n]*(\S.*)$/m);
      const intent = section.match(/^- 意图（一句话）：[^\S\n]*(\S.*)$/m);
      const follow = section.match(/^- 后续阶段应如何表达：[^\S\n]*(\S.*)$/m);
      expect(typeof removed?.[1], title).toBe('string');
      expect(typeof intent?.[1], title).toBe('string');
      expect(typeof follow?.[1], title).toBe('string');
    }
  });
});

const MIGRATED_TODO = "it.todo('样式断言已迁出，见 test/design/legacy-intents-T01.md');";

describe('t01 emptied spec files', () => {
  it('keeps the migration todo when no assertion remains', () => {
    for (const file of LANE_FILES) {
      const source = readSource(file);
      const hasAssertion = source.includes('expect(') || source.includes('assert(');
      if (!hasAssertion) {
        expect(source.includes(MIGRATED_TODO), file).toBe(true);
      }
    }
  });
});
