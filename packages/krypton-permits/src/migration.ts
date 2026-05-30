/**
 * krypton-permits migrations.
 *
 *   v1: Backfill `problem.permits` rows from each problem's legacy
 *       `pdoc.maintainer[]` array. Idempotent — only inserts rows that
 *       don't already exist. Old field is left in place (upstream hydro
 *       code reads it; canViewBy now checks both legacy field + new
 *       permits table).
 */
import type { Context } from 'hydrooj';
import {
    db, ObjectId, oncePerSetting,
} from 'hydrooj';
import { permitsColl } from './db';

async function migrateV1(_ctx: Context): Promise<void> {
    const V1_FLAG = 'permits.migration_v1_done';
    return await oncePerSetting(V1_FLAG, async () => {
        const docColl = db.collection<any>('document');
        // docType 10 = TYPE_PROBLEM
        const cursor = docColl.find(
            { docType: 10, maintainer: { $exists: true, $not: { $size: 0 } } },
            { projection: { _id: 1, domainId: 1, docId: 1, owner: 1, maintainer: 1 } },
        );
        let inserted = 0;
        let skipped = 0;
        const now = new Date();
        for await (const p of cursor) {
            for (const uid of p.maintainer || []) {
                if (!Number.isInteger(uid) || uid <= 0) continue;
                const exists = await permitsColl.findOne({
                    domainId: p.domainId, pid: p.docId, uid,
                });
                if (exists) { skipped++; continue; }
                await permitsColl.insertOne({
                    _id: new ObjectId(),
                    domainId: p.domainId,
                    pid: p.docId,
                    uid,
                    role: 'maintainer',
                    grantedBy: p.owner || 1,
                    grantedAt: now,
                    viaContest: null,
                    note: 'migrated from legacy pdoc.maintainer[]',
                });
                inserted++;
            }
        }
        // eslint-disable-next-line no-console
        console.log(`[krypton-permits] v1 backfill: ${inserted} permits inserted, ${skipped} skipped (already existed)`);
    });
}

export const migrationScripts = [migrateV1];
