function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ranking inject always writes `externalRatingByUid`, even when this page's
 * rows have no public CF / Nowcoder scores. Column visibility follows that
 * inject, not current-page occupancy, so paging cannot drop the columns.
 */
export function rankingShowsExternalRatingColumns(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return isRecord(data.externalRatingByUid);
}
