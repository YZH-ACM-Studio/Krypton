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
    expect(home).to.include('<motion.a href={href}');
  });

  it('lets the search form wrap at 320px without clipping the submit control', () => {
    expect(home).to.include('size="sm"');
    expect(home).to.include('window.location.assign');
    expect(home).to.include('bs.urls.problems');
  });

  it('truncates search, starred, and recent titles outside trailing icons', () => {
    expect(home).to.include('{p.docId}. {p.title || \'未命名\'}');
  });

  it('keeps the hidden contest badge outside the truncated title', () => {
    const contests = home.slice(home.indexOf('{/* Contests */}'), home.indexOf('{/* Homework */}'));
    expect(contests).to.include("{c.title || '未命名比赛'}");
    expect(contests).to.include('已隐藏');
  });

  it('truncates announcement categories on a min-height row', () => {
    expect(announce).to.include('{doc.categoryName}');
  });
});
