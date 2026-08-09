import { describe, expect, it } from 'vitest';
import { trainingProgress } from '../src/pages/home.tsx';

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
