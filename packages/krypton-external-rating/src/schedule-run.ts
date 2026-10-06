/**
 * Production entry for the daily CF / Nowcoder refresh.
 * Lists saved handles, then reuses the save/refresh fetch path.
 */
import { db } from 'hydrooj';
import { fetchBoth } from './fetch';
import { loadState, saveSnapshot } from './model';
import { refreshExternalRatingBatch, SCHEDULED_EXTERNAL_RATING_GAP_MS } from './schedule';
import { isHandleUnset, parseUserExternalRatingState } from './types';

interface UserHandleRow {
    _id: number;
    externalRating?: unknown;
}

function logFail(detail: string): void {
    console.error(`krypton-external-rating.schedule stage=user_fail ${detail}`);
}

export async function listScheduledExternalRatingUids(): Promise<{ uids: number[]; rejected: number }> {
    const rows = await db.collection<UserHandleRow>('user').find(
        {
            $or: [
                { 'externalRating.codeforces.handle': { $type: 'string', $gt: '' } },
                { 'externalRating.nowcoder.handle': { $type: 'string', $gt: '' } },
            ],
        },
        { projection: { _id: 1, externalRating: 1 }, sort: { _id: 1 } },
    ).toArray();
    const uids: number[] = [];
    let rejected = 0;
    for (const row of rows) {
        if (!Number.isSafeInteger(row._id) || row._id <= 0) {
            rejected += 1;
            logFail('reason=bad_uid');
            continue;
        }
        let state;
        try {
            state = parseUserExternalRatingState(row.externalRating ?? null);
        } catch (error: unknown) {
            rejected += 1;
            const message = error instanceof Error ? error.message : 'unknown error';
            logFail(`uid=${row._id} ${message}`);
            continue;
        }
        if (isHandleUnset(state.codeforces.handle) && isHandleUnset(state.nowcoder.handle)) continue;
        uids.push(row._id);
    }
    return { uids, rejected };
}

export async function runScheduledExternalRatingRefresh(now = new Date()) {
    const listed = await listScheduledExternalRatingUids();
    const uids = listed.uids;
    const targets = [];
    let preloadFailed = listed.rejected;
    for (const uid of uids) {
        try {
            targets.push({ uid, state: await loadState(uid) });
        } catch (error: unknown) {
            preloadFailed += 1;
            const message = error instanceof Error ? error.message : 'unknown error';
            logFail(`uid=${uid} ${message}`);
        }
    }
    const result = await refreshExternalRatingBatch(targets, now, {
        gapMs: SCHEDULED_EXTERNAL_RATING_GAP_MS,
        fetch: (state, at, uid) => fetchBoth(state, at, undefined, { uid }),
        save: async (uid, state) => {
            await saveSnapshot(uid, state);
        },
    });
    return {
        users: uids.length + listed.rejected,
        saved: result.saved,
        failed: result.failed + preloadFailed,
    };
}
