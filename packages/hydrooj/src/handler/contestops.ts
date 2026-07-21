/**
 * Contest Ops — service-token-gated (channel `contest`) contest运营 collected into
 * the desktop tool: list contests, clone an existing contest (same rule + problem
 * set, new time window), lock/unlock the scoreboard, and export the final
 * scoreboard CSV. Powers ecosystems/KryptonTagger 比赛运营.
 *
 * Blast radius: read + clone(add a new hidden-by-rule contest) + scoreboard
 * lock/unlock. It NEVER deletes a contest or edits an existing contest's problem
 * set/window — clone always makes a NEW contest. Gated by PERM_EDIT_CONTEST
 * (export also needs PERM_VIEW_CONTEST_SCOREBOARD).
 *
 * Endpoints (X-Service-Token, channel `contest`, fixed domain):
 *   GET  /api/contest/list                 → { domainId, contests:[{tid,title,rule,beginAt,endAt,attend,pidCount,lockAt,unlocked}] }
 *   POST /api/contest/clone  {tid,title,beginAt,endAt} → { tid }
 *   POST /api/contest/lock   {tid,lockMinutes}         → { ok }   (lockMinutes=0 clears)
 *   POST /api/contest/unlock {tid}                     → { ok }   (reveal a locked board)
 *   GET  /api/contest/scoreboard?tid       → { title, csv }
 */
import { stringify as toCSV } from 'csv-stringify/sync';
import { ObjectId } from 'mongodb';
import { Context, Handler, OplogModel, param, Types } from 'hydrooj';
import type { ScoreboardConfig } from '../interface';
import { requireAuthToken } from '../lib/auth-token';
import * as contest from '../model/contest';
import { PERM } from '../model/builtin';
import system from '../model/system';

const CHANNEL = 'contest';

function contestDomain(): string {
    const d = system.get(`serviceToken.${CHANNEL}.domain`);
    return typeof d === 'string' && d ? d : 'system';
}

class ContestApiHandler extends Handler {
    noCheckPermView = true;
    workerLabel = 'unknown';

    async prepare() {
        await requireAuthToken(this, CHANNEL);
        this.workerLabel = this.user.uname || `uid:${this.user._id}`;
    }
}

// ─── GET /api/contest/list ───────────────────────────────────────────────────

class ContestListHandler extends ContestApiHandler {
    async get() {
        this.checkPerm(PERM.PERM_EDIT_CONTEST);
        const domainId = contestDomain();
        const tdocs = await contest.getMulti(domainId).limit(500).toArray();
        this.response.body = {
            domainId,
            contests: tdocs.map((t) => ({
                tid: t.docId.toHexString(),
                title: t.title || '',
                rule: t.rule || '',
                beginAt: t.beginAt ? t.beginAt.getTime() : 0,
                endAt: t.endAt ? t.endAt.getTime() : 0,
                attend: t.attend || 0,
                pidCount: Array.isArray(t.pids) ? t.pids.length : 0,
                lockAt: t.lockAt ? t.lockAt.getTime() : null,
                unlocked: (t as any).unlocked === true,
            })),
        };
    }
}

// ─── POST /api/contest/clone ─────────────────────────────────────────────────

class ContestCloneHandler extends ContestApiHandler {
    @param('tid', Types.ObjectId)
    @param('title', Types.Title)
    @param('beginAt', Types.Int)
    @param('endAt', Types.Int)
    async post(_args: any, tid: ObjectId, title: string, beginAt: number, endAt: number) {
        this.checkPerm(PERM.PERM_EDIT_CONTEST);
        const domainId = contestDomain();
        const src = await contest.get(domainId, tid); // throws ContestNotFoundError if absent
        const begin = new Date(beginAt);
        const end = new Date(endAt);
        if (!(begin < end)) {
            this.response.status = 400;
            this.response.body = { error: 'bad_time_window' };
            return;
        }
        // New contest: same rule + problem set + statement, fresh window/owner.
        const newTid = await contest.add(
            domainId,
            title,
            src.content || '',
            this.user._id,
            src.rule,
            begin,
            end,
            Array.isArray(src.pids) ? src.pids : [],
            false,
            src.participationMode
                ? {
                    participationMode: contest.getParticipationMode(src),
                    vigilEnabled: src.vigilEnabled,
                    entryMode: src.entryMode,
                }
                : {},
        );
        await OplogModel.log(this as any, 'contest.clone', {
            worker: this.workerLabel,
            domainId,
            from: tid.toHexString(),
            to: newTid.toHexString(),
            title,
        });
        this.response.body = { tid: newTid.toHexString() };
    }
}

// ─── POST /api/contest/lock ──────────────────────────────────────────────────

class ContestLockHandler extends ContestApiHandler {
    @param('tid', Types.ObjectId)
    @param('lockMinutes', Types.Int, true)
    async post(_args: any, tid: ObjectId, lockMinutes: number) {
        this.checkPerm(PERM.PERM_EDIT_CONTEST);
        const domainId = contestDomain();
        const tdoc = await contest.get(domainId, tid);
        // lockAt = endAt - lockMinutes (封榜起点); 0/absent clears the freeze.
        const m = Number.isSafeInteger(lockMinutes) ? lockMinutes : 0;
        const lockAt = m > 0 ? new Date(tdoc.endAt.getTime() - m * 60_000) : null;
        await contest.edit(domainId, tid, { lockAt, unlocked: false } as any);
        await contest.recalcStatus(domainId, tid);
        await OplogModel.log(this as any, 'contest.lock', {
            worker: this.workerLabel,
            domainId,
            tid: tid.toHexString(),
            lockMinutes: m,
        });
        this.response.body = { ok: true };
    }
}

// ─── POST /api/contest/unlock ────────────────────────────────────────────────

class ContestUnlockHandler extends ContestApiHandler {
    @param('tid', Types.ObjectId)
    async post(_args: any, tid: ObjectId) {
        this.checkPerm(PERM.PERM_EDIT_CONTEST);
        const domainId = contestDomain();
        await contest.unlockScoreboard(domainId, tid);
        await OplogModel.log(this as any, 'contest.unlock', {
            worker: this.workerLabel,
            domainId,
            tid: tid.toHexString(),
        });
        this.response.body = { ok: true };
    }
}

// ─── GET /api/contest/scoreboard ─────────────────────────────────────────────

class ContestScoreboardHandler extends ContestApiHandler {
    @param('tid', Types.ObjectId)
    async get(_args: any, tid: ObjectId) {
        this.checkPerm(PERM.PERM_VIEW_CONTEST_SCOREBOARD);
        const domainId = contestDomain();
        const tdoc = await contest.get(domainId, tid);
        const config: ScoreboardConfig = {
            isExport: true,
            lockAt: tdoc.lockAt,
            showDisplayName: this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO),
        };
        // getScoreboard needs a Handler `this` (translate + perm checks).
        const [, rows] = await contest.getScoreboard.call(this, domainId, tid, config);
        const csv = toCSV(
            rows.map((r) => r.map((c) => String(c.value))),
            { bom: true },
        );
        this.response.body = { title: tdoc.title || '', csv };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('contest_ops_list', '/api/contest/list', ContestListHandler);
    ctx.Route('contest_ops_clone', '/api/contest/clone', ContestCloneHandler);
    ctx.Route('contest_ops_lock', '/api/contest/lock', ContestLockHandler);
    ctx.Route('contest_ops_unlock', '/api/contest/unlock', ContestUnlockHandler);
    ctx.Route('contest_ops_scoreboard', '/api/contest/scoreboard', ContestScoreboardHandler);
}
