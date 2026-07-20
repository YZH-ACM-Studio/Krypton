export function createEmptyStructuredRegionDraft(regionIds: string[]): Record<string, string> {
  assertRegionIds(regionIds);
  return Object.fromEntries(regionIds.map((id) => [id, '']));
}

export function parseStructuredRegionDraft(raw: string, regionIds: string[], singleLine: boolean): Record<string, string> | null {
  assertRegionIds(regionIds);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const values = parsed as Record<string, unknown>;
  const actualIds = Object.keys(values).sort();
  const expectedIds = [...regionIds].sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) return null;
  if (actualIds.some((id) => typeof values[id] !== 'string')) return null;
  if (singleLine && actualIds.some((id) => /[\r\n]/.test(values[id] as string))) return null;
  return Object.fromEntries(regionIds.map((id) => [id, values[id] as string]));
}

function assertRegionIds(regionIds: string[]): void {
  if (regionIds.some((id) => typeof id !== 'string' || !id) || new Set(regionIds).size !== regionIds.length) {
    throw new Error('structured region draft requires unique non-empty region ids');
  }
}
