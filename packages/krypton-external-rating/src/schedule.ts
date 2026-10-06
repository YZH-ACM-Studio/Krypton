/**
 * Daily CF / Nowcoder refresh. Profile and ranking GETs still do not fetch.
 * One user's failure is logged and does not skip the rest. A site fetch
 * failure keeps the last successful rating inside fetchBoth.
 */
import type { UserExternalRatingState } from './types';

export const SCHEDULED_EXTERNAL_RATING_GAP_MS = 1000;

export interface ScheduledExternalRatingTarget {
    uid: number;
    state: UserExternalRatingState;
}

export interface ScheduledExternalRatingResult {
    users: number;
    saved: number;
    failed: number;
}

export interface ScheduledExternalRatingDeps {
    fetch(state: UserExternalRatingState, now: Date, uid: number): Promise<UserExternalRatingState>;
    save(uid: number, state: UserExternalRatingState): Promise<void>;
    gapMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

function logStage(stage: string, detail: string, failed = false): void {
    const line = `krypton-external-rating.schedule stage=${stage} ${detail}`;
    if (failed || stage === 'user_fail') console.error(line);
    else console.info(line);
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function refreshExternalRatingBatch(
    targets: readonly ScheduledExternalRatingTarget[],
    now: Date,
    deps: ScheduledExternalRatingDeps,
): Promise<ScheduledExternalRatingResult> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError('scheduled external rating refresh requires a valid timestamp');
    }
    if (!Array.isArray(targets)) throw new TypeError('scheduled external rating targets must be an array');
    const gapMs = deps.gapMs ?? SCHEDULED_EXTERNAL_RATING_GAP_MS;
    if (!Number.isSafeInteger(gapMs) || gapMs < 0) {
        throw new TypeError('scheduled external rating gap must be a non-negative integer');
    }
    const sleep = deps.sleep ?? defaultSleep;
    let saved = 0;
    let failed = 0;
    logStage('start', `users=${targets.length}`);
    for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        if (!target || !Number.isSafeInteger(target.uid) || target.uid <= 0) {
            failed += 1;
            logStage('user_fail', `index=${index} reason=bad_uid`);
        } else {
            try {
                const next = await deps.fetch(target.state, now, target.uid);
                await deps.save(target.uid, next);
                saved += 1;
                logStage('user_ok', `uid=${target.uid}`);
            } catch (error: unknown) {
                failed += 1;
                const message = error instanceof Error ? error.message : 'unknown error';
                logStage('user_fail', `uid=${target.uid} ${message}`);
            }
        }
        if (gapMs > 0 && index < targets.length - 1) await sleep(gapMs);
    }
    logStage('done', `users=${targets.length} saved=${saved} failed=${failed}`, failed > 0);
    return { users: targets.length, saved, failed };
}
