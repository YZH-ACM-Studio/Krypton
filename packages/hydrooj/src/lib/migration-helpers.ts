/**
 * Helpers for writing migration scripts shipped via `migration.registerChannel(...)`.
 *
 * ## Conventions
 *
 * - **Idempotency**: every script must be safe to re-run. If it's not naturally idempotent
 *   (e.g., it generates new ObjectIds, sends emails, writes to external systems), wrap the
 *   non-idempotent portion in `oncePerSetting()` with a stable flag name. The migration
 *   framework already tracks per-channel version numbers (`db.ver-<channel>`), but if a
 *   script halts midway and is re-run from the beginning of its own body, only the
 *   non-idempotent part is what needs guarding.
 *
 * - **One channel per package**: a plugin registers its own channel, e.g.
 *   `migration.registerChannel('userbind', userbindScripts)`. Don't mix-and-match into
 *   `coreScripts` — that array is hydrooj's, not yours.
 *
 * - **Halt-on-error**: returning a falsy (or throwing) value halts the channel at the
 *   current version. The next start re-runs from the same step. Use this for "needs
 *   operator review" branches — write a CSV report, then `return false`.
 *
 * - **Background scripts**: long-running migrations that don't block startup go through
 *   `migration.dontWait(fn, 'description')`. They run asynchronously and bump version on
 *   completion. Use sparingly — startup will not wait for them.
 *
 * - **Progress logging**: use `logger.info` to log per-step progress; for batch updates
 *   over large collections, log every N batches via `batchProgress()`.
 */

import { Logger } from '@hydrooj/utils';
import system from '../model/system';

const logger = new Logger('migration-helpers');

/**
 * Run `fn` exactly once, ever, across all subsequent re-runs of the script.
 *
 * Uses a system.settings key as the persistence flag. Safe to use inside a migration
 * script body, esp. when the migration is partially idempotent and only one section
 * needs the guard.
 *
 * @param flag - a unique key, e.g. `'userbind.migration.legacy_inline_split'`
 * @param fn - the action to run once
 * @returns whether the action was newly executed (false if previously done)
 */
export async function oncePerSetting(flag: string, fn: () => Promise<void>): Promise<boolean> {
    const done = system.get(flag);
    if (done) {
        logger.debug('skipping %s: already done', flag);
        return false;
    }
    await fn();
    await system.set(flag, Date.now());
    logger.info('flagged %s = done', flag);
    return true;
}

/**
 * Clear a flag set by `oncePerSetting`. Used by retry / rollback tooling.
 */
export async function clearOnceFlag(flag: string): Promise<void> {
    await system.set(flag, 0);
}

/**
 * Helper for "process big collection, log progress every N items" patterns.
 *
 * @example
 *   const progress = batchProgress('userbind.students', estimatedTotal, 1000);
 *   for await (const doc of cursor) {
 *       await processOne(doc);
 *       progress.tick();
 *   }
 *   progress.done();
 */
export function batchProgress(label: string, expectedTotal: number, logEvery = 500) {
    let count = 0;
    const startedAt = Date.now();
    return {
        tick() {
            count++;
            if (count % logEvery === 0) {
                const elapsed = (Date.now() - startedAt) / 1000;
                const rate = count / elapsed;
                const remaining = expectedTotal > count ? Math.ceil((expectedTotal - count) / rate) : 0;
                logger.info(
                    '%s: %d/%d (%.1f/s, ~%ds remaining)',
                    label,
                    count,
                    expectedTotal || count,
                    rate,
                    remaining,
                );
            }
        },
        done() {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            logger.info('%s: completed %d items in %ss', label, count, elapsed);
        },
        get count() {
            return count;
        },
    };
}

/**
 * Compute a stable SHA-256 hash for "fingerprint" use cases in migrations
 * (e.g., dedupe rows, hash document content for staleness detection).
 *
 * Imported lazily to avoid pulling node:crypto into the bundle path of clients
 * that import this module purely for the `oncePerSetting` helper.
 */
export async function shortHash(input: string, len = 12): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(input).digest('hex').slice(0, len);
}
