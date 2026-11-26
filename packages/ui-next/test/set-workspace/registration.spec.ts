// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).to.be.at.least(0);
  expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
  return text.slice(start, end);
}

/** Shells that skip DefaultAppShell before this lane adds set_workspace.html. */
const ORIGINAL_STANDALONE_TEMPLATES = [
  'exam_mode_home.html',
  'exam_contest.html',
  'exam_paper.html',
  'contest_workspace.html',
] as const;

describe('set workspace template registration', () => {
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const router = source('packages/ui-next/src/router.tsx');

  it('maps set_workspace.html and exam_paper.html to SetWorkspacePage', () => {
    const pageMap = sliceBetween(resolver, 'const PAGE_MAP', 'export function PageResolver');
    expect(pageMap).to.include("'set_workspace.html': SetWorkspacePage");
    expect(pageMap).to.include("'exam_paper.html': SetWorkspacePage");
  });

  it('includes set_workspace.html in STANDALONE_TEMPLATES with the existing shells', () => {
    const standalone = router.match(/const STANDALONE_TEMPLATES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
    expect(standalone).to.include('set_workspace.html');
    for (const template of ORIGINAL_STANDALONE_TEMPLATES) {
      expect(standalone, template).to.include(template);
    }
  });
});
