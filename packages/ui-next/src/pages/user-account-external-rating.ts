function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Account settings inject `externalRatingBound`; only exact `true` is bound. */
export function isBoundStudentFromPayload(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return data.externalRatingBound === true;
}
