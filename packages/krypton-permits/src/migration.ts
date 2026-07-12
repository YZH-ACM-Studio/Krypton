/**
 * P2.11 deliberately has no automatic ACL data migration.
 *
 * Legacy maintainer rows and old canonical permits are first surfaced by the
 * read-only drift report. An operator must then choose and run one of the
 * explicit repair commands; plugin startup never mutates production ACL data.
 *
 * The original plugin already shipped migration slot v1. Removing that slot
 * makes every database at version 1 look newer than the code and aborts
 * startup as a downgrade. Keep the historical slot as a no-op so the channel
 * version remains monotonic without repeating the old automatic backfill.
 */
async function preserveLegacyV1Version(): Promise<void> {
    return undefined;
}

export const migrationScripts: Array<() => Promise<void>> = [preserveLegacyV1Version];
