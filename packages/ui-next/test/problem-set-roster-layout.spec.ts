import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

describe('problem-set roster layout', () => {
  it('keeps the training detail motion.div full-width without rendering PracticeRosterCard', () => {
    const training = source('packages/ui-next/src/pages/training.tsx');
    expect(training).not.to.match(/<PracticeRosterCard\b/);
  });
});
