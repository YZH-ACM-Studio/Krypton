/**
 * P2.11 deliberately has no automatic ACL data migration.
 *
 * Legacy maintainer rows and old canonical permits are first surfaced by the
 * read-only drift report. An operator must then choose and run one of the
 * explicit repair commands; plugin startup never mutates production ACL data.
 */
export const migrationScripts: Array<() => Promise<void>> = [];
