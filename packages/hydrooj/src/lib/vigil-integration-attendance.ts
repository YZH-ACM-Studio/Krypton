import { ObjectId } from 'mongodb';
import { NotFoundError, OplogModel, ValidationError } from 'hydrooj';
import type { Handler } from 'hydrooj';
import * as contestModel from '../model/contest';

export async function ensureVigilContestParticipation(handler: Handler, domainId: string, contestId: string | undefined, uid: number): Promise<void> {
    if (!contestId || !ObjectId.isValid(contestId)) throw new ValidationError('contestId');
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new ValidationError('uid');
    const tid = new ObjectId(contestId);
    const tdoc = await contestModel.get(domainId, tid);
    if (!tdoc) throw new NotFoundError('Contest', contestId);

    let tsdoc = await contestModel.getStatus(domainId, tid, uid);
    let autoAttended = false;
    if (!tsdoc?.attend && !contestModel.isDone(tdoc, tsdoc)) {
        try {
            await contestModel.attend(domainId, tid, uid, { subscribe: 1 });
        } catch (error) {
            tsdoc = await contestModel.getStatus(domainId, tid, uid);
            if (!tsdoc?.attend) throw error;
        }
        tsdoc = await contestModel.getStatus(domainId, tid, uid);
        if (!tsdoc?.attend) throw new Error(`Vigil auto-attend did not persist for contest ${contestId} and user ${uid}.`);
        autoAttended = true;
    }
    if (tsdoc?.attend) {
        const invalidateLockoutCache = (global as any).Hydro?.model?.vigilguard?.invalidateLockoutCache;
        if (typeof invalidateLockoutCache !== 'function') {
            throw new TypeError('Vigil lockout cache invalidation service is unavailable after confirmed attendance.');
        }
        invalidateLockoutCache(domainId, uid);
        if (autoAttended) {
            await OplogModel.log(handler as any, 'vigilguard.auto_attend', {
                contestId,
                uid,
                lockoutCacheKey: `${domainId}:${uid}`,
            });
        }
    }
    if (tsdoc?.attend && !tsdoc.startAt && contestModel.isOngoing(tdoc, tsdoc)) {
        await contestModel.setStatus(domainId, tid, uid, { startAt: new Date() });
    }
}
