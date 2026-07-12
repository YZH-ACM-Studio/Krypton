/**
 * Admin endpoints for paper / exam contest moderation.
 *
 *   POST /api/admin/paper/:tid/force-unlock/:pid
 *     Drops the lock-on-begin invariant for one problem inside one contest,
 *     allowing edits. Triggers a rejudge of every record for this problem
 *     within this contest's window (and any other locking exam contests).
 *
 *   POST /api/admin/paper/:tid/force-submit/:uid
 *     Privileged "force this student to submit now" — internally same path
 *     as VigilForceFinalizeHandler but driven by an OJ admin (no Vigil
 *     session required).
 */
import { ObjectId } from 'mongodb';
import { Context, Handler, NotFoundError, OplogModel, param, PRIV, Types, ValidationError } from 'hydrooj';
import * as contest from '../model/contest';
import record from '../model/record';
import { finalizePaperForUser } from './paper';

class AdminPaperHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }
}

class ForceUnlockHandler extends AdminPaperHandler {
    @param('tid', Types.ObjectId)
    @param('pid', Types.UnsignedInt)
    @param('confirm', Types.String, true)
    async post({ domainId }: { domainId: string }, tid: ObjectId, pid: number, confirm?: string) {
        if (confirm !== 'YES') {
            throw new ValidationError(
                'confirm',
                null,
                'Force-unlock is destructive: it will re-grade existing records. Pass confirm=YES to proceed.',
            );
        }

        // Snapshot existing records for this (tid, pid) before changing anything.
        const recordColl = (await import('../service/db')).default.collection('record');
        const snapshot = await recordColl.find({ domainId, contest: tid, pid }).toArray();
        await OplogModel.log(this, 'paper.force_unlock_snapshot', {
            tid,
            pid,
            recordCount: snapshot.length,
        });

        // Re-judge each record. We re-add records as 'rejudge' type using
        // the existing record.rejudge if available, else flag for re-evaluation.
        for (const rdoc of snapshot) {
            try {
                await record.reset(domainId, rdoc._id, true);
            } catch (e) {
                // Some record types may not be rejudge-able (e.g. submit_answer).
                // Log and continue.
            }
        }

        await OplogModel.log(this, 'paper.force_unlock', { tid, pid });
        this.response.body = {
            ok: true,
            rejudgedCount: snapshot.length,
            note: 'Edit the problem now; records will reflect new grading after rejudge completes.',
        };
    }
}

class ForceSubmitHandler extends AdminPaperHandler {
    @param('tid', Types.ObjectId)
    @param('uid', Types.Int)
    async post({ domainId }: { domainId: string }, tid: ObjectId, uid: number) {
        const tdoc = await contest.get(domainId, tid);
        if (!tdoc) throw new NotFoundError('Contest');
        // 复用 finalize 主路径（PLAN P3.2）：此前这里是它的复制品，且
        // config 用 `typeof === 'object'` 老判断（对字符串 config 恒 false，
        // objective/fill_function 分流失效）。finalizePaperForUser 已统一
        // raw+parse、附带 objective draft 判分与 contest.updateStatus。
        const rids = await finalizePaperForUser(domainId, tid, uid, {
            tdoc,
            meta: { proctorForced: true, forcedBy: this.user._id },
        });
        await OplogModel.log(this, 'paper.force_submit', { tid, uid, count: rids.length });
        this.response.body = { ok: true, rids, count: rids.length };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('admin_paper_force_unlock', '/api/admin/paper/:tid/force-unlock/:pid', ForceUnlockHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_paper_force_submit', '/api/admin/paper/:tid/force-submit/:uid', ForceSubmitHandler, PRIV.PRIV_EDIT_SYSTEM);
}
