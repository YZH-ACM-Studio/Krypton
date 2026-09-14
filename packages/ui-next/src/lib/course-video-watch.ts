export const COURSE_VIDEO_MAX_RATE = 1.5;
export const COURSE_VIDEO_RATES = [1, 1.25, 1.5] as const;
export const COURSE_VIDEO_HEARTBEAT_MS = 5000;

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.min(COURSE_VIDEO_MAX_RATE, rate);
}

export function shouldBlockForwardSeek(target: number, lastLegalPosition: number): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(lastLegalPosition)) return true;
  return target > lastLegalPosition + 0.5;
}

export function heartbeatCovered(from: number, to: number): [number, number] | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  if (to - from > 20) return [from, from + 20];
  return [from, to];
}

export function coveragePercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(100, Math.round(ratio * 1000) / 10);
}
