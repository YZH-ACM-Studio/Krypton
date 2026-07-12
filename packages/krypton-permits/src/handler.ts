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
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import {
    ContestModel,
    Handler,
    NotFoundError,
    ObjectId,
    param,
    PERM,
    PermissionError,
    PRIV,
    PrivilegeError,
    ProblemModel,
    Types,
    UserModel,
    ValidationError,
} from 'hydrooj';
import MessageModel from 'hydrooj/src/model/message';
import { canMaintainProblem } from 'hydrooj/src/model/problem-access';
import { permitsColl } from './db';
import { canonicalActiveFilter } from './legacy-canonical';
import { permitsModel } from './model';
import { deriveAclRequestId } from './request-id';
import type { PermitRole } from './types';

const VALID_ROLES: PermitRole[] = ['verifier', 'maintainer'];
const logger = new Logger('krypton-permits.handler');

function canManageProblemPermits(user: any, pdoc: any): boolean {
    return canMaintainProblem(user, pdoc);
}

function canManageContestVerifiers(user: any, tdoc: any): boolean {
    if (user.own(tdoc)) return true;
    if (user.hasPerm(PERM.PERM_EDIT_CONTEST)) return true;
    return false;
}

function authoritativeDomainId(handler: Handler, args: { domainId?: unknown }): string {
    const domainId = String((handler as any).domain?._id || '');
    if (!domainId || (args.domainId !== undefined && String(args.domainId) !== domainId)) {
        throw new PermissionError('请求域与当前会话域不一致');
    }
    return domainId;
}

class ProblemPermitGrantHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    async get(args: { domainId?: unknown }, pid: number) {
        const domainId = authoritativeDomainId(this, args);
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        if (!canManageProblemPermits(this.user, pdoc)) {
            throw new PermissionError('无权查看此题目的权限列表');
        }
        const permits = await permitsModel.listForProblem(domainId, pdoc.docId);
        const uids = Array.from(new Set([...permits.map((p) => p.uid), ...permits.map((p) => p.grantedBy)]));
        const udict = await UserModel.getList(domainId, uids);
        const confirmedPdoc = await ProblemModel.getViewableAuthorized(domainId, pdoc.docId, this.user);
        if (!confirmedPdoc || confirmedPdoc.docId !== pdoc.docId || !canManageProblemPermits(this.user, confirmedPdoc)) {
            throw new PermissionError('无权查看此题目的权限列表');
        }
        this.response.body = { permits, udict };
    }

    @param('pid', Types.UnsignedInt)
    @param('uid', Types.PositiveInt, true)
    @param('uids', Types.CommaSeperatedArray, true)
    @param('role', Types.String)
    @param('note', Types.String, true)
    @param('requestId', Types.String, true)
    async post(
        args: { domainId?: unknown },
        pid: number,
        uid: number | undefined,
        uids: string[] | undefined,
        role: string,
        note: string,
        requestId: string | undefined,
    ) {
        const domainId = authoritativeDomainId(this, args);
        if (!VALID_ROLES.includes(role as PermitRole)) {
            throw new ValidationError('role', null, 'role 必须是 verifier 或 maintainer');
        }
        const targetUids = Array.from(
            new Set([...(uid ? [uid] : []), ...(uids || []).map((i) => +i)].filter((i) => Number.isSafeInteger(i) && i > 0)),
        );
        if (!targetUids.length) {
            throw new ValidationError('uid', null, '请选择至少一个目标用户');
        }
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
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
        const mutationId = deriveAclRequestId(
            requestId,
            'problem-permit-grant',
            domainId,
            pdoc.docId,
            role,
            targetUids
                .slice()
                .sort((a, b) => a - b)
                .join(','),
        );
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'permit-grant',
            async (claim) => {
                await Promise.all(
                    targetUids.map((targetUid) =>
                        permitsModel.grant(domainId, pdoc.docId, targetUid, role as PermitRole, this.user._id, {
                            note,
                            requestId: `${mutationId}:${targetUid}`,
                            writeClaimRequestId: claim.requestId,
                        }),
                    ),
                );
            },
            { requestId: mutationId },
        );
        await Promise.all(
            targetUids.map(async (targetUid) => {
                const pairRequestId = `${mutationId}:${targetUid}`;
                const msg = `[krypton] 你被 ${this.user.uname} 邀请成为题目 ${pdoc.title} 的 ${roleZh}：${link}${note ? `\n附言：${note}` : ''}`;
                try {
                    await MessageModel.send(this.user._id, targetUid, msg, MessageModel.FLAG_UNREAD);
                } catch (error) {
                    logger.error(
                        'notification failed requestId=%s domain=%s pid=%d uid=%d error=%s',
                        pairRequestId,
                        domainId,
                        pdoc.docId,
                        targetUid,
                        error,
                    );
                }
            }),
        );
        this.response.body = { success: true, count: targetUids.length, requestId: mutationId };
    }
}

class ProblemPermitRevokeHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    @param('permitId', Types.ObjectId)
    @param('requestId', Types.String, true)
    async post(args: { domainId?: unknown }, pid: number, permitId: ObjectId, requestId: string | undefined) {
        const domainId = authoritativeDomainId(this, args);
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        const row = await permitsColl.findOne({
            domainId,
            _id: permitId,
            pid: pdoc.docId,
            active: canonicalActiveFilter(),
        });
        if (!row) throw new NotFoundError('权限记录不存在');
        const isSelf = row.uid === this.user._id;
        if (!isSelf && !canManageProblemPermits(this.user, pdoc)) {
            throw new PermissionError('无权撤销该权限');
        }
        const mutationId = deriveAclRequestId(requestId, 'problem-permit-revoke', domainId, pdoc.docId, row.uid);
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'permit-revoke',
            (claim) =>
                permitsModel.revoke(domainId, permitId, {
                    requestId: mutationId,
                    actor: this.user._id,
                    writeClaimRequestId: claim.requestId,
                }),
            { requestId: mutationId, selfRevokeUid: isSelf ? row.uid : undefined },
        );
        this.response.body = { success: true, requestId: mutationId };
    }
}

class ContestVerifierAddHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('uid', Types.PositiveInt)
    @param('role', Types.String, true)
    @param('note', Types.String, true)
    @param('requestId', Types.String, true)
    async post(args: { domainId?: unknown }, tid: ObjectId, uid: number, role: string, note: string, requestId: string | undefined) {
        const domainId = authoritativeDomainId(this, args);
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
            const assign = tdoc.assign as any[];
            if (Array.isArray(assign) && assign.length && !assign.includes(uid)) {
                $set.assign = [...assign, uid];
            }
            await ContestModel.edit(domainId, tid, $set);
        }
        // Always re-run the persistent full-state sync. If ContestModel.edit
        // committed but its hook failed, a retry skips the edit branch above;
        // this call resumes the hook's stable requestId instead of colliding
        // with an abandoned fence.
        await permitsModel.syncContestCurrentPids(domainId, tid, tdoc.pids || [], [...new Set([...verifiers, uid])], this.user._id, {
            requestId: `contest-edit:${domainId}:${tid.toHexString()}`,
        });
        // Bulk-grant on every contest problem.
        const mutationId = deriveAclRequestId(requestId, 'contest-permit-grant', domainId, tid.toHexString(), uid, r);
        await permitsModel.grantBulkViaContest(domainId, tdoc.pids || [], uid, r, this.user._id, tid, { requestId: mutationId, note });
        const link = `/contest/${tid.toHexString()}`;
        const roleZh = r === 'maintainer' ? '比赛维护者' : '验比赛人';
        const problemCount = (tdoc.pids || []).length;
        const msg =
            `[krypton] 你被 ${this.user.uname} 邀请成为比赛 ${tdoc.title} 的 ${roleZh}` +
            `（共 ${problemCount} 题）：${link}${note ? `\n附言：${note}` : ''}`;
        try {
            await MessageModel.send(this.user._id, uid, msg, MessageModel.FLAG_UNREAD);
        } catch (error) {
            logger.error(
                'notification failed requestId=%s domain=%s contest=%s uid=%d error=%s',
                mutationId,
                domainId,
                tid.toHexString(),
                uid,
                error,
            );
        }
        this.response.body = { success: true, requestId: mutationId };
    }
}

class ContestVerifierRemoveHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('uid', Types.PositiveInt)
    @param('requestId', Types.String, true)
    async post(args: { domainId?: unknown }, tid: ObjectId, uid: number, requestId: string | undefined) {
        const domainId = authoritativeDomainId(this, args);
        const tdoc = await ContestModel.get(domainId, tid);
        if (!tdoc) throw new NotFoundError('比赛不存在');
        const isSelf = uid === this.user._id;
        if (!isSelf && !canManageContestVerifiers(this.user, tdoc)) {
            throw new PermissionError('无权移除该验题人');
        }
        const verifiers = (tdoc.verifiers || []).filter((u) => u !== uid);
        const mutationId = deriveAclRequestId(requestId, 'contest-permit-revoke', domainId, tid.toHexString(), uid);
        await permitsModel.revokeContestUser(domainId, tid, uid, {
            requestId: mutationId,
            actor: this.user._id,
        });
        await ContestModel.edit(domainId, tid, { verifiers });
        this.response.body = { success: true, requestId: mutationId };
    }
}

class MyVerifyInboxHandler extends Handler {
    async get(args: { domainId?: unknown }) {
        const domainId = authoritativeDomainId(this, args);
        if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) throw new PrivilegeError(PRIV.PRIV_USER_PROFILE);
        const rows = await permitsModel.listForUser(domainId, this.user._id);
        const pids = Array.from(new Set(rows.map((r) => r.pid)));
        // Every inbox problem is a direct hidden-problem read. Resolve it at
        // the same durable ACL revision as the refreshed permit snapshot so a
        // concurrent revoke cannot leave an old permitted title in the page.
        const fixedPdict: Record<string, any> = {};
        for (const pid of pids) {
            const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user, ProblemModel.PROJECTION_LIST);
            if (pdoc) fixedPdict[pid] = pdoc;
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
