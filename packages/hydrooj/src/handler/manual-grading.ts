import { ObjectId } from 'mongodb';
import { effectiveProblemKind } from '@hydrooj/common';
import { Context } from '../context';
import { NotFoundError, PermissionError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { parseProblemConfigObject } from '../lib/problem-config';
import { PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import { gradeLatestManualRecord, MANUAL_GRADE_RULES } from '../model/manual-grade';
import problem from '../model/problem';
import record from '../model/record';
import user from '../model/user';
import { Handler, param, Types } from '../service/server';

export class ManualGradingHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId)
    async _prepare(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc) throw new NotFoundError('Contest');
        if (!MANUAL_GRADE_RULES.includes(this.tdoc.rule as any)) throw new ValidationError('rule');
        if (this.tdoc.owner !== this.user._id && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('pid', Types.UnsignedInt, true)
    @param('uid', Types.UnsignedInt, true)
    async get(_domainId: string, pid = 0, uid = 0) {
        const domainId = String(this.domain?._id);
        const pdocs = (await Promise.all((this.tdoc.pids || []).map((problemId) => problem.get(domainId, problemId, undefined, true)))).filter(
            (pdoc) => pdoc && effectiveProblemKind(pdoc) === 'subjective',
        );
        const problems = pdocs.map((pdoc) => ({
            pid: pdoc.docId,
            title: pdoc.title,
            gradingInstructions: parseProblemConfigObject(pdoc)?.main?.gradingInstructions || '',
        }));
        const selectedPid = pid && problems.some((item) => item.pid === pid) ? pid : problems[0]?.pid;
        const body: any = {
            tdoc: { docId: this.tdoc.docId, title: this.tdoc.title, rule: this.tdoc.rule },
            problems,
            pid: selectedPid || 0,
            uid: uid || 0,
            rows: [],
        };
        if (selectedPid) {
            const query: any = { contest: this.tdoc.docId, pid: selectedPid };
            if (uid) query.uid = uid;
            const rdocs = await record.getMulti(domainId, query).sort({ _id: -1 }).toArray();
            const latestByUid = new Map<number, (typeof rdocs)[number]>();
            for (const rdoc of rdocs) if (!latestByUid.has(rdoc.uid)) latestByUid.set(rdoc.uid, rdoc);
            const udict = await user.getListForRender(domainId, [...latestByUid.keys()], false);
            body.rows = [...latestByUid.values()].map((rdoc) => ({
                latestRid: String(rdoc._id),
                uid: rdoc.uid,
                uname: udict[rdoc.uid]?.uname || `UID ${rdoc.uid}`,
                displayName: udict[rdoc.uid]?.displayName || '',
                studentId: udict[rdoc.uid]?.studentId || '',
                answer: typeof rdoc.code === 'string' ? rdoc.code : '',
                submittedAt: rdoc._id.getTimestamp(),
                status: rdoc.status,
                manualGrade: rdoc.manualGrade || null,
                expectedRevision: rdoc.manualGrade?.revision || 0,
            }));
        }
        this.response.body = body;
        this.response.template = 'manual_grading.html';
    }

    @param('pid', Types.UnsignedInt)
    @param('uid', Types.UnsignedInt)
    @param('latestRid', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('score', Types.Float)
    @param('comment', Types.Content, true)
    @param('reason', Types.Content, true)
    async post(_domainId: string, pid: number, uid: number, latestRid: ObjectId, expectedRevision: number, score: number, comment = '', reason = '') {
        const updated = await gradeLatestManualRecord({
            domainId: String(this.domain?._id),
            tid: this.tdoc.docId,
            pid,
            uid,
            latestRid,
            expectedRevision,
            score,
            comment,
            reason,
            actor: this.user._id,
        });
        this.response.body = {
            ok: true,
            latestRid: String(updated._id),
            manualGrade: updated.manualGrade,
            status: updated.status,
            score: updated.score,
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('manual_grading', '/manage/grading/:tid', ManualGradingHandler);
}
