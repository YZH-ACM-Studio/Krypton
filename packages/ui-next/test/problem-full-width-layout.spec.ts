import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

const problemLayouts = [
  ['题库', 'packages/ui-next/src/pages/problems.tsx', 'main'],
  ['题目创建入口', 'packages/ui-next/src/pages/problem-create-hub.tsx', 'main'],
  ['编程题编辑工作区', 'packages/ui-next/src/components/problem-editor-workspace.tsx', 'section'],
  ['客观题编辑器', 'packages/ui-next/src/pages/basic-objective-editors.tsx', 'main'],
  ['主观题编辑器', 'packages/ui-next/src/pages/subjective-editor.tsx', 'main'],
  ['结构化代码题编辑器', 'packages/ui-next/src/pages/structured-code-editors.tsx', 'main'],
] as const;

function rootClasses(relativePath: string, tag: string): string {
  const source = readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
  const match = source.match(new RegExp(`<${tag} className="([^"]+)"`));
  expect(match, `${relativePath} should expose a static ${tag} root class`).not.to.equal(null);
  return match![1];
}

describe('problem workspace full-width layout', () => {
  for (const [label, relativePath, tag] of problemLayouts) {
    it(`${label} fills the shared AppShell content width`, () => {
      const classes = rootClasses(relativePath, tag);
      expect(classes).to.include('w-full');
      expect(classes).not.to.match(/(?:^|\s)mx-auto(?:\s|$)/);
      expect(classes).not.to.match(/(?:^|\s)max-w-\S+/);
    });
  }
});
