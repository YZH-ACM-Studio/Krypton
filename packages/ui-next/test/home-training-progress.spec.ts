import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trainingProgress } from '../src/pages/home.tsx';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

const training = {
  dag: [{ pids: [101, 202] }, { pids: [101] }],
};

describe('home training progress', () => {
  it('uses scoped contextual counts instead of historical global completion', () => {
    expect(
      trainingProgress(training, {
        enroll: true,
        donePids: [101, 202],
        contextualProgress: { completedProblemCount: 1, totalProblemCount: 3 },
      }),
    ).to.equal(33);
    expect(
      trainingProgress(training, {
        enroll: true,
        donePids: [101, 202],
        contextualProgress: { completedProblemCount: 0, totalProblemCount: 3 },
      }),
    ).to.equal(0);
  });

  it('keeps legacy progress when no contextual projection exists', () => {
    expect(trainingProgress(training, { enroll: true, donePids: [101, 202] })).to.equal(67);
    expect(trainingProgress(training, {})).to.equal(null);
  });
});

describe('student homepage layout contracts', () => {
  const home = source('packages/ui-next/src/pages/home.tsx');
  const announce = source('packages/ui-next/src/components/announcement-home-block.tsx');

  it('keeps the homepage as an ultra-wide reading shell with shrinkable 1fr columns', () => {
    expect(home).to.include('className="mx-auto w-full max-w-[90rem] space-y-6"');
    expect(home).to.include('grid min-w-0 gap-6 p-6 lg:grid-cols-[1fr_340px]');
    expect(home).to.include('flex min-w-0 flex-col justify-center gap-4');
    expect(home).to.include('grid min-w-0 gap-6 lg:grid-cols-[1fr_320px]');
    expect(home).to.include('<div className="min-w-0 space-y-6">');
    expect(home).to.include('<motion.a href={href} className="min-w-0"');
    expect(home).to.include('className="group min-w-0 rounded-lg border p-3 transition-colors hover:bg-accent/50"');
  });

  it('lets the search form wrap at 320px without clipping the submit control', () => {
    expect(home).to.include('className="flex min-w-0 flex-wrap gap-2"');
    expect(home).to.include('className="relative min-w-0 flex-1"');
    expect(home).to.include('className="min-w-0 pl-8 text-base sm:text-sm"');
    expect(home).to.include('size="sm" className="shrink-0"');
    expect(home).to.include('window.location.assign');
    expect(home).to.include('bs.urls.problems');
  });

  it('truncates search, starred, and recent titles outside trailing icons', () => {
    const titleClass = 'className="min-w-0 flex-1 truncate"';
    expect(home.split(titleClass).length - 1).to.equal(3);
    expect(home).to.include('{p.docId}. {p.title || \'未命名\'}');
  });

  it('keeps the hidden contest badge outside the truncated title', () => {
    const contests = home.slice(home.indexOf('{/* Contests */}'), home.indexOf('{/* Homework */}'));
    expect(contests).to.include("className=\"min-w-0 flex-1 truncate text-sm font-medium\">{c.title || '未命名比赛'}");
    expect(contests).to.include('已隐藏');
    expect(contests).not.to.match(/truncate text-sm font-medium">\s*\{c\.title \|\| '未命名比赛'\}\s*\{c\.hidden === true/);
    expect(contests).to.include('className="shrink-0 text-[10px]"');
  });

  it('truncates announcement categories on a min-height row', () => {
    expect(announce).to.include('flex min-h-11 min-w-0 items-center gap-3');
    expect(announce).to.include('max-w-[6rem] min-w-0 shrink-0 truncate');
    expect(announce).to.include('{doc.categoryName}');
    expect(announce).to.include('min-w-0 flex-1 truncate text-sm font-medium');
  });
});
