/**
 * Exam countdown clock anchored to the server timestamp shipped with this page.
 * The anchor is taken once. Later reads add only the local time elapsed since
 * that read, so a wrong classroom clock cannot move the countdown and the
 * page does not keep asking the server for the time.
 */
export interface ExamServerClock {
  now(): number;
}

export function examServerClock(generatedAt: string, clientNow = Date.now()): ExamServerClock {
  const serverAt = Date.parse(generatedAt);
  if (!Number.isFinite(serverAt)) {
    throw new TypeError(`exam countdown requires a server timestamp, received ${JSON.stringify(generatedAt)}`);
  }
  const offset = serverAt - clientNow;
  return {
    now() {
      return Date.now() + offset;
    },
  };
}
