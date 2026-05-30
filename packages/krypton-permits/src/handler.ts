/**
 * Route handlers for krypton-permits.
 *
 *   POST  /p/:pid/permits                    grant a permit (author / maintainer)
 *   POST  /p/:pid/permits/revoke             revoke a single permit by id
 *   POST  /contest/:tid/verifiers            add a contest verifier
 *   POST  /contest/:tid/verifiers/remove     remove a contest verifier
 *   GET   /tasks/verify                      "my verify inbox"
 *
 * Permission model:
 *   - Author of the problem can grant/revoke on that problem.
 *   - `PERM_EDIT_PROBLEM` holder can grant/revoke on any problem.
 *   - Contest owner / `PERM_EDIT_CONTEST` holder can manage contest verifiers.
 *   - Anyone can view their own inbox (`PRIV_USER_PROFILE`).
 *   - Verifier-targeted users can revoke their own permit ("退出验题").
 */
import type { Context } from 'hydrooj';
import {
    ContestModel, NotFoundError, ObjectId, PERM, PermissionError, PRIV,
    PrivilegeError, ProblemModel, UserModel, ValidationError,
} from 'hydrooj';
import { Handler, param, Types } from 'hydrooj';
import MessageModel from 'hydrooj/src/model/message';
import { permitsColl } from './db';
import { permitsModel } from './model';
import type { PermitRole } from './types';

const VALID_ROLES: PermitRole[] = ['verifier', 'maintainer'];

function canManageProblemPermits(user: any, pdoc: any): boolean {
    if (user.own(pdoc)) return true;
    if (user.hasPerm(PERM.PERM_EDIT_PROBLEM)) return true;
    return false;
}

function canManageContestVerifiers(user: any, tdoc: any): boolean {
    if (user.own(tdoc)) return true;
    if (user.hasPerm(PERM.PERM_EDIT_CONTEST)) return true;
    return false;
}

class ProblemPermitGrantHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    async get({ domainId }: { domainId: string }, pid: number) {
        const pdoc = await ProblemModel.get(domainId, pid);
        if (!pdoc) throw new NotFoundError('题目不存在');
        // Anyone who can already see the problem can see who else has permits
        // (typically only author / problem-editors hit this endpoint via the
        // edit page; we don't gate it harder because the info is non-sensitive
        // — just uids + roles).
        const permits = await permitsModel.listForProblem(domainId, pdoc.docId);
        const uids = Array.from(new Set([
            ...permits.map((p) => p.uid),
            ...permits.map((p) => p.grantedBy),
        ]));
        const udict = await UserModel.getList(domainId, uids);
        this.response.body = { permits, udict };
    }

    @param('pid', Types.UnsignedInt)
    @param('uid', Types.PositiveInt, true)
    @param('uids', Types.CommaSeperatedArray, true)
    @param('role', Types.String)
    @param('note', Types.String, true)
    async post(
        { domainId }: { domainId: string },
        pid: number, uid: number | undefined, uids: string[] | undefined, role: string, note: string,
    ) {
        if (!VALID_ROLES.includes(role as PermitRole)) {
            throw new ValidationError('role', null, 'role 必须是 verifier 或 maintainer');
        }
        const targetUids = Array.from(new Set([
            ...(uid ? [uid] : []),
            ...(uids || []).map((i) => +i),
        ].filter((i) => Number.isSafeInteger(i) && i > 0)));
        if (!targetUids.length) {
            throw new ValidationError('uid', null, '请选择至少一个目标用户');
        }
        const pdoc = await ProblemModel.get(domainId, pid);
        if (!pdoc) throw new NotFoundError('题目不存在');
        if (!canManageProblemPermits(this.user, pdoc)) {
            throw new PermissionError('无权管理此题目的验题人');
        }
        const targets = await UserModel.getList(domainId, targetUids);
        for (const targetUid of targetUids) {
            if (!targets[targetUid]) throw new ValidationError('uid', null, `目标用户 ${targetUid} 不存在`);
            if (targetUid === pdoc.owner) {
                throw new ValidationError('uid', null, '不能给作者自己授权');
            }
        }
        const link = `/p/${pdoc.pid || pdoc.docId}`;
        const roleZh = role === 'maintainer' ? '题目维护者' : '验题人';
        await Promise.all(targetUids.map(async (targetUid) => {
            await permitsModel.grant(domainId, pdoc.docId, targetUid, role as PermitRole, this.user._id, { note });
            const msg = `[krypton] 你被 ${this.user.uname} 邀请成为题目 ${pdoc.title} 的 ${roleZh}：${link}${note ? `\n附言：${note}` : ''}`;
            try {
                await MessageModel.send(this.user._id, targetUid, msg, MessageModel.FLAG_UNREAD);
            } catch {
                // Notification is best-effort — don't fail the grant if messages fail.
            }
        }));
        this.response.body = { success: true, count: targetUids.length };
    }
}

class ProblemPermitRevokeHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    @param('permitId', Types.ObjectId)
    async post(
        { domainId }: { domainId: string },
        pid: number, permitId: ObjectId,
    ) {
        const pdoc = await ProblemModel.get(domainId, pid);
        if (!pdoc) throw new NotFoundError('题目不存在');
        // Owner / problem editor can revoke any permit on the problem.
        // The grantee themselves can also revoke their own permit ("退出验题").
        const row = await permitsColl.findOne({ domainId, _id: permitId });
        if (!row) throw new NotFoundError('权限记录不存在');
        const isSelf = row.uid === this.user._id;
        if (!isSelf && !canManageProblemPermits(this.user, pdoc)) {
            throw new PermissionError('无权撤销该权限');
        }
        await permitsModel.revoke(domainId, permitId);
        this.response.body = { success: true };
    }
}

class ContestVerifierAddHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('uid', Types.PositiveInt)
    @param('role', Types.String, true)
    @param('note', Types.String, true)
    async post(
        { domainId }: { domainId: string },
        tid: ObjectId, uid: number, role: string, note: string,
    ) {
        const r = (role || 'verifier') as PermitRole;
        if (!VALID_ROLES.includes(r)) {
            throw new ValidationError('role', null, 'role 必须是 verifier 或 maintainer');
        }
        const tdoc = await ContestModel.get(domainId, tid);
        if (!tdoc) throw new NotFoundError('比赛不存在');
        if (!canManageContestVerifiers(this.user, tdoc)) {
            throw new PermissionError('无权管理此比赛的验题人');
        }
        const target = await UserModel.getById(domainId, uid);
        if (!target) throw new ValidationError('uid', null, '目标用户不存在');
        if (uid === tdoc.owner) {
            throw new ValidationError('uid', null, '不能给比赛作者自己授权');
        }
        const verifiers = tdoc.verifiers || [];
        if (!verifiers.includes(uid)) {
            // Add to contest verifier list + auto-include in assign so the
            // user can also enter the contest page if it's restricted.
            const newVerifiers = [...verifiers, uid];
            const $set: any = { verifiers: newVerifiers };
            if (Array.isArray(tdoc.assign) && tdoc.assign.length && !tdoc.assign.includes(uid)) {
                $set.assign = [...tdoc.assign, uid];
            }
            await ContestModel.edit(domainId, tid, $set);
        }
        // Bulk-grant on every contest problem.
        await permitsModel.grantBulkViaContest(
            domainId, tdoc.pids || [], uid, r, this.user._id, tid,
        );
        const link = `/contest/${tid.toHexString()}`;
        const roleZh = r === 'maintainer' ? '比赛维护者' : '验比赛人';
        const msg = `[krypton] 你被 ${this.user.uname} 邀请成为比赛 ${tdoc.title} 的 ${roleZh}（共 ${(tdoc.pids || []).length} 题）：${link}${note ? `\n附言：${note}` : ''}`;
        try {
            await MessageModel.send(this.user._id, uid, msg, MessageModel.FLAG_UNREAD);
        } catch { /* best-effort */ }
        this.response.body = { success: true };
    }
}

class ContestVerifierRemoveHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('uid', Types.PositiveInt)
    async post(
        { domainId }: { domainId: string },
        tid: ObjectId, uid: number,
    ) {
        const tdoc = await ContestModel.get(domainId, tid);
        if (!tdoc) throw new NotFoundError('比赛不存在');
        const isSelf = uid === this.user._id;
        if (!isSelf && !canManageContestVerifiers(this.user, tdoc)) {
            throw new PermissionError('无权移除该验题人');
        }
        const verifiers = (tdoc.verifiers || []).filter((u) => u !== uid);
        await ContestModel.edit(domainId, tid, { verifiers });
        await permitsModel.revokeContestUser(domainId, tid, uid);
        this.response.body = { success: true };
    }
}

class MyVerifyInboxHandler extends Handler {
    async get({ domainId }: { domainId: string }) {
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) throw new PrivilegeError(PRIV.PRIV_USER_PROFILE);
        const rows = await permitsModel.listForUser(domainId, this.user._id);
        const pids = Array.from(new Set(rows.map((r) => r.pid)));
        // Resolve problems + granters. canViewHidden = uid bypasses hidden
        // filtering for problems where THIS user has a permit row anyway —
        // we want to see them in the inbox regardless of hidden status.
        const pdict = await ProblemModel.getList(
            domainId, pids, this.user._id, false, ProblemModel.PROJECTION_LIST,
        );
        // Permits override visibility — manually re-include any pdoc that
        // got placeholdered (default docId=0) because of the hidden filter.
        const fixedPdict: Record<string, any> = {};
        for (const r of rows) {
            const p = pdict[r.pid];
            if (p && p.docId) fixedPdict[r.pid] = p;
            // For permitted-hidden problems that hydro's getList placeholdered
            // out, fetch them directly bypassing the filter.
            else {
                const direct = await ProblemModel.get(domainId, r.pid);
                if (direct) fixedPdict[r.pid] = direct;
            }
        }
        const granterUids = Array.from(new Set(rows.map((r) => r.grantedBy)));
        const udict = await UserModel.getList(domainId, granterUids);
        // Group contest-tagged permits separately
        const contestIds = Array.from(new Set(rows.map((r) => r.viaContest?.toHexString()).filter(Boolean) as string[]));
        const tdict: Record<string, any> = {};
        for (const tidHex of contestIds) {
            const t = await ContestModel.get(domainId, new ObjectId(tidHex));
            if (t) tdict[tidHex] = { _id: t._id, title: t.title };
        }
        this.response.template = 'my_verify_inbox.html';
        this.response.body = { permits: rows, pdict: fixedPdict, udict, tdict };
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('problem_permit_grant', '/p/:pid/permits', ProblemPermitGrantHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_permit_revoke', '/p/:pid/permits/revoke', ProblemPermitRevokeHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('contest_verifier_add', '/contest/:tid/verifiers', ContestVerifierAddHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_verifier_remove', '/contest/:tid/verifiers/remove', ContestVerifierRemoveHandler, PERM.PERM_VIEW_CONTEST);
    // Not /tasks/verify — that would collide with krypton-tasks's
    // `/tasks/:tid` (TaskDetailHandler) route: hydro routes by registration
    // order, and "verify" would be parsed as a tid ObjectId, failing
    // validation. Plugin-namespaced path is collision-free.
    ctx.Route('my_verify_inbox', '/permits/inbox', MyVerifyInboxHandler, PRIV.PRIV_USER_PROFILE);
}
