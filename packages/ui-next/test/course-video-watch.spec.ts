import { describe, expect, it } from 'vitest';
import { clampPlaybackRate, coveragePercent, heartbeatCovered, shouldBlockForwardSeek } from '../src/lib/course-video-watch';

describe('course video watch constraints', () => {
  it('blocks forward seeks and clamps rate', () => {
    expect(shouldBlockForwardSeek(12, 5)).toBe(true);
    expect(shouldBlockForwardSeek(5.2, 5)).toBe(false);
    expect(clampPlaybackRate(2)).toBe(1.5);
    expect(clampPlaybackRate(1.25)).toBe(1.25);
  });

  it('clips heartbeat spans and formats coverage', () => {
    expect(heartbeatCovered(1, 1)).toBeNull();
    expect(heartbeatCovered(0, 25)).toEqual([0, 20]);
    expect(coveragePercent(0.956)).toBe(95.6);
  });
});
