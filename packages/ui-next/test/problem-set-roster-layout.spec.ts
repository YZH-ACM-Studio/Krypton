import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), 'utf8');
}

function exportedReturnRootClasses(fileSource: string, exportName: string, tag?: string): string {
  const exportAt = fileSource.indexOf(`export function ${exportName}(`);
  expect(exportAt, `${exportName} should be exported`).to.be.greaterThan(-1);
  const tagPattern = tag ? tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[A-Za-z]+(?:\\.[A-Za-z]+)?';
  const match = fileSource
    .slice(exportAt)
    .match(new RegExp(`return\\s*\\(\\s*<${tagPattern}\\b[\\s\\S]*?className="([^"]+)"`));
  expect(match, `${exportName} should expose a static ${tag ?? 'page'} root class`).not.to.equal(null);
  return match![1];
}

describe('problem-set roster layout', () => {
  it('fills the shared AppShell content width', () => {
    const roster = source('packages/ui-next/src/pages/problem-set-roster.tsx');
    const classes = exportedReturnRootClasses(roster, 'ProblemSetRosterPage');
    expect(classes).to.include('w-full');
    expect(classes).to.include('min-w-0');
    expect(roster).not.to.include('mx-auto');
    expect(roster).not.to.include('max-w-7xl');
    expect(roster).not.to.include('max-w-[90rem]');
  });

  it('keeps the training detail motion.div full-width without rendering PracticeRosterCard', () => {
    const training = source('packages/ui-next/src/pages/training.tsx');
    const classes = exportedReturnRootClasses(training, 'TrainingDetailPage', 'motion.div');
    expect(classes).to.include('w-full');
    expect(classes).to.include('min-w-0');
    expect(training).not.to.match(/<PracticeRosterCard\b/);
  });
});
