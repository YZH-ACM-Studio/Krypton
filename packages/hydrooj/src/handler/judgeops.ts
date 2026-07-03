/**
 * Judge Ops — service-token-gated (channel `judge`) evaluation-queue monitor,
 * stuck-record detection, and batch rejudge. Powers the desktop "评测救火台"
 * (ecosystems/KryptonTagger). Auth is a per-worker service token on channel
 * `judge` (NOT a Hydro login), same mechanism as the `tagger` channel.
 *
 * Blast radius: read-only queue/stuck queries + a rejudge that mirrors the
 * built-in `postRejudge` (reset + low-priority re-enqueue) and is gated by
 * PERM_REJUDGE_PROBLEM. It NEVER deletes records or mutates problems/testdata.
 *
 * Endpoints (all require X-Service-Token, channel `judge`, fixed domain):
 *   GET  /api/judge/queue   → { domainId, pending:{...}, totalPending, oldestPendingAgeSec, pulse:{...} }
 *   GET  /api/judge/stuck   → { domainId, thresholdMin, records:[{rid,pid,uid,status,lang,ageSec}] }
 *   POST /api/judge/rejudge { rids?|pid?|uid?|status?|stuckOnly?, dryRun? } → { count, dryRun }
 */
import { ObjectId } from 'mongodb';
import {
    Context, Handler, OplogModel, param, Types,
} from 'hydrooj';
import { requireAuthToken } from '../lib/auth-token';
import { PERM, STATUS } from '../model/builtin';
import record from '../model/record';
import system from '../model/system';

const CHANNEL = 'judge';
/** Statuses that mean "not yet finished" — the judge queue. */
const PENDING = [
    STATUS.STATUS_WAITING, STATUS.STATUS_JUDGING, STATUS.STATUS_COMPILING, STATUS.STATUS_FETCHED,
];
/** A pending record older than this (minutes) is considered stuck. */
const STUCK_MIN = 10;
/** Safety cap on one rejudge batch. */
const MAX_REJUDGE = 5000;
/** Stuck list page size. */
const STUCK_LIMIT = 200;

function judgeDomain(): string {
    const d = system.get(`serviceToken.${CHANNEL}.domain`);
    return typeof d === 'string' && d ? d : 'system';
}

/** ObjectId whose embedded timestamp is `minutesAgo` in the past (zero low bytes),
 * for `_id < cutoff` "submitted before" comparisons. */
function cutoffOid(minutesAgo: number): ObjectId {
    return ObjectId.createFromTime(Math.floor(Date.now() / 1000) - minutesAgo * 60);
}

function ageSec(oid: ObjectId): number {
    return Math.max(0, Math.round((Date.now() - oid.getTimestamp().getTime()) / 1000));
}

class JudgeApiHandler extends Handler {
    noCheckPermView = true;
    workerLabel = 'unknown';

    async prepare() {
        await requireAuthToken(this, CHANNEL);
        this.workerLabel = this.user.uname || `uid:${this.user._id}`;
    }
}

// ─── GET /api/judge/queue ────────────────────────────────────────────────────

class JudgeQueueHandler extends JudgeApiHandler {
    async get() {
        this.checkPerm(PERM.PERM_REJUDGE_PROBLEM);
        const domainId = judgeDomain();
        const [waiting, judging, compiling, fetched, oldest, pulse] = await Promise.all([
            record.count(domainId, { status: STATUS.STATUS_WAITING }),
            record.count(domainId, { status: STATUS.STATUS_JUDGING }),
            record.count(domainId, { status: STATUS.STATUS_COMPILING }),
            record.count(domainId, { status: STATUS.STATUS_FETCHED }),
            record.getMulti(domainId, { status: { $in: PENDING } })
                .project({ _id: 1 }).sort({ _id: 1 }).limit(1).toArray(),
            record.stat(domainId),
        ]);
        const totalPending = waiting + judging + compiling + fetched;
        this.response.body = {
            domainId,
            pending: { waiting, judging, compiling, fetched },
            totalPending,
            oldestPendingAgeSec: oldest.length ? ageSec(oldest[0]._id) : 0,
            pulse: { d5min: pulse.d5min, d1h: pulse.d1h, day: pulse.day },
        };
    }
}

// ─── GET /api/judge/stuck ────────────────────────────────────────────────────

class JudgeStuckHandler extends JudgeApiHandler {
    async get() {
        this.checkPerm(PERM.PERM_REJUDGE_PROBLEM);
        const domainId = judgeDomain();
        const cutoff = cutoffOid(STUCK_MIN);
        const rdocs = await record.getMulti(domainId, {
            status: { $in: PENDING },
            _id: { $lt: cutoff },
        }).project({ _id: 1, pid: 1, uid: 1, status: 1, lang: 1 }).sort({ _id: 1 }).limit(STUCK_LIMIT).toArray();
        this.response.body = {
            domainId,
            thresholdMin: STUCK_MIN,
            records: rdocs.map((r) => ({
                rid: r._id.toHexString(),
                pid: r.pid,
                uid: r.uid,
                status: r.status,
                lang: (r as any).lang || '',
                ageSec: ageSec(r._id),
            })),
        };
    }
}

// ─── POST /api/judge/rejudge ─────────────────────────────────────────────────

class JudgeRejudgeHandler extends JudgeApiHandler {
    @param('rids', Types.Any, true)
    @param('pid', Types.Int, true)
    @param('uid', Types.Int, true)
    @param('status', Types.Int, true)
    @param('stuckOnly', Types.Boolean, true)
    @param('dryRun', Types.Boolean, true)
    async post(
        _args: any, rids: any, pid: number, uid: number, status: number,
        stuckOnly: boolean, dryRun: boolean,
    ) {
        this.checkPerm(PERM.PERM_REJUDGE_PROBLEM);
        const domainId = judgeDomain();

        // Build the selector. At least one narrowing selector is REQUIRED so a
        // misfired request can never rejudge the whole library.
        const query: any = {
            contest: { $nin: [record.RECORD_GENERATE, record.RECORD_PRETEST] },
            status: { $ne: STATUS.STATUS_CANCELED },
            'files.hack': { $exists: false },
        };
        let hasSelector = false;
        if (Array.isArray(rids) && rids.length) {
            const oids: ObjectId[] = [];
            for (const r of rids) {
                if (ObjectId.isValid(String(r))) oids.push(new ObjectId(String(r)));
            }
            if (!oids.length) {
                this.response.status = 400;
                this.response.body = { error: 'no_valid_rids' };
                return;
            }
            query._id = { $in: oids };
            hasSelector = true;
        }
        if (Number.isSafeInteger(pid)) { query.pid = pid; hasSelector = true; }
        if (Number.isSafeInteger(uid)) { query.uid = uid; hasSelector = true; }
        if (Number.isSafeInteger(status)) { query.status = status; hasSelector = true; }
        if (stuckOnly === true) {
            query.status = { $in: PENDING };
            query._id = { ...(query._id || {}), $lt: cutoffOid(STUCK_MIN) };
            hasSelector = true;
        }
        if (!hasSelector) {
            this.response.status = 400;
            this.response.body = { error: 'selector_required' };
            return;
        }

        if (dryRun === true) {
            this.response.body = { dryRun: true, count: await record.count(domainId, query) };
            return;
        }

        const rdocs = await record.getMulti(domainId, query)
            .project({ _id: 1, contest: 1 }).limit(MAX_REJUDGE).toArray();
        if (!rdocs.length) {
            this.response.body = { dryRun: false, count: 0, capped: false, matched: 0 };
            return;
        }
        const ids = rdocs.map((r) => r._id);
        // execute caps at MAX_REJUDGE; tell the client if more matched so it can
        // re-run for the remainder instead of assuming everything was rejudged.
        const capped = rdocs.length >= MAX_REJUDGE;
        // Low priority so a big rejudge never crowds out live submissions.
        const priority = await record.submissionPriority(this.user._id, -10000 - rdocs.length * 5 - 50);
        await record.reset(domainId, ids, true);
        await Promise.all([
            record.judge(domainId, rdocs.filter((i) => i.contest).map((i) => i._id), priority, { detail: false }, { rejudge: true }),
            record.judge(domainId, rdocs.filter((i) => !i.contest).map((i) => i._id), priority, {}, { rejudge: true }),
        ]);
        await OplogModel.log(this as any, 'judge.rejudge', {
            worker: this.workerLabel, domainId, count: ids.length, stuckOnly: stuckOnly === true,
        });
        this.response.body = {
            dryRun: false,
            count: ids.length,
            capped,
            matched: capped ? await record.count(domainId, query) : ids.length,
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('judge_queue', '/api/judge/queue', JudgeQueueHandler);
    ctx.Route('judge_stuck', '/api/judge/stuck', JudgeStuckHandler);
    ctx.Route('judge_rejudge', '/api/judge/rejudge', JudgeRejudgeHandler);
}
