import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

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

describe('problem-set roster page contracts', () => {
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const sidebar = source('packages/ui-next/src/components/layout/sidebar.tsx');
  const generic = source('packages/ui-next/src/pages/generic.tsx');
  const training = source('packages/ui-next/src/pages/training.tsx');
  const handler = source('packages/hydrooj/src/handler/training.ts');

  it('registers problem_set_roster.html on ProblemSetRosterPage', () => {
    expect(resolver).to.include("from '@/pages/problem-set-roster'");
    const pageMap = sliceBetween(resolver, 'const PAGE_MAP', 'export function PageResolver');
    expect(pageMap).to.include("'problem_set_roster.html': ProblemSetRosterPage");
  });

  it('keeps 题集 nav active on the roster template', () => {
    const problemSetNav = sliceBetween(sidebar, "label: '题集'", "label: '任务'");
    expect(problemSetNav).to.include('problem_set_roster.html');
  });

  it('labels the GenericPage fallback as 参加名单', () => {
    expect(generic).to.include("'problem_set_roster.html': '参加名单'");
  });

  it('links the training detail toolbar to /roster without an inline roster card', () => {
    // eslint-disable-next-line no-template-curly-in-string
    expect(training).to.include('${trainingUrl}/roster');
    expect(training).to.include('名单');
    expect(training).not.to.include('<PracticeRosterCard');
    expect(training).not.to.include('参加名单（P2.3）');
  });

  it('renders PracticeRosterCard full-width on the dedicated roster page', () => {
    const rosterPage = source('packages/ui-next/src/pages/problem-set-roster.tsx');
    expect(rosterPage).to.include('PracticeRosterCard');
    expect(rosterPage).to.include('visibleGroupIds');
    expect(rosterPage).to.include('w-full min-w-0');
    expect(rosterPage).not.to.include('mx-auto');
    expect(rosterPage).not.to.include('max-w-[');
  });

  it('registers the training_roster route on TrainingRosterHandler', () => {
    expect(handler).to.include("ctx.Route('training_roster', '/problem-sets/:tid/roster', TrainingRosterHandler);");
  });
});
