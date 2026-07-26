import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

const courseLayouts = [
  ['课程列表', 'packages/ui-next/src/pages/course/list.tsx'],
  ['课程详情', 'packages/ui-next/src/pages/course/detail.tsx'],
  ['课程创建与编辑', 'packages/ui-next/src/pages/course/editor.tsx'],
] as const;

function rootClasses(relativePath: string): string {
  const source = readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
  const match = source.match(/<main className="([^"]+)"/);
  expect(match, `${relativePath} should expose a static main root class`).not.to.equal(null);
  return match![1];
}

describe('course workspace full-width layout', () => {
  for (const [label, relativePath] of courseLayouts) {
    it(`${label} fills the shared AppShell content width`, () => {
      const classes = rootClasses(relativePath);
      expect(classes).to.include('w-full');
      expect(classes).to.include('min-w-0');
      expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);
      expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);
    });
  }
});
