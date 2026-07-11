/**
 * Production `problem.permits` rows created before P2.11 have no `active`
 * field. They remain active unless an operator explicitly wrote
 * `active:false`; compatibility is read-only and never backfills the row.
 */
export function canonicalActiveFilter(): { $ne: false } {
    return { $ne: false };
}

export function isActiveCanonicalDoc(doc: { active?: unknown } | null | undefined): boolean {
    return Boolean(doc) && doc!.active !== false;
}

export function normalizeActiveCanonicalDoc<T extends { active?: unknown }>(doc: T): T & { active: true } {
    if (!isActiveCanonicalDoc(doc)) throw new Error('inactive canonical permit cannot be normalized');
    return doc.active === true ? doc as T & { active: true } : { ...doc, active: true };
}
