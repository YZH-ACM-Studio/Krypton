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
 *   - Legacy owners/maintainers retain their existing grant/revoke behavior.
 *   - Managed maintainers can manage author/verifier; only a system
 *     administrator can grant or revoke managed maintainer.
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
    OplogModel,
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
import { permitsColl, permitSourcesColl } from './db';
import { canonicalActiveFilter } from './legacy-canonical';
import { permitsModel } from './model';
import { deriveAclRequestId } from './request-id';
import type { ContestPermitRole, PermitRole, ProblemContributionScope, ProblemContributionStatus } from './types';

const PROBLEM_ROLES: PermitRole[] = ['verifier', 'author', 'maintainer'];
const CONTEST_ROLES: ContestPermitRole[] = ['verifier', 'maintainer'];
const logger = new Logger('krypton-permits.handler');

function grantableProblemRoles(user: any, pdoc: any): PermitRole[] {
    if (pdoc.authoringMode !== 'managed') return ProblemModel.canMaintainProblem(user, pdoc) ? ['verifier', 'maintainer'] : [];
    if (ProblemModel.canManageProblemMaintainers(user, pdoc)) return [...PROBLEM_ROLES];
    if (ProblemModel.canManageProblemCollaborators(user, pdoc)) return ['verifier', 'author'];
    return [];
}

function canRevokeProblemRole(user: any, pdoc: any, role: PermitRole): boolean {
    if (pdoc.authoringMode !== 'managed') return ProblemModel.canMaintainProblem(user, pdoc);
    if (role === 'maintainer') return ProblemModel.canManageProblemMaintainers(user, pdoc);
    return ProblemModel.canManageProblemCollaborators(user, pdoc);
}

async function logManagedPermitDenied(handler: Handler, pdoc: any, action: 'grant' | 'revoke', role: PermitRole) {
    logger.warn(
        'Managed permit denied domain=%s pid=%d actor=%d role=%s action=%s result=denied',
        pdoc.domainId,
        pdoc.docId,
        handler.user._id,
        role,
        action,
    );
    await OplogModel.log(handler as any, 'problem.permit.denied', {
        problemId: pdoc.docId,
        role,
        action,
        result: 'denied',
    });
}

async function assertManagedPermitBody(handler: Handler, pdoc: any, allowed: string[], action: 'grant' | 'revoke') {
    if (pdoc.authoringMode !== 'managed') return;
    const unknownFields = Object.keys((handler as any).request?.body || {}).filter((field) => !allowed.includes(field));
    if (!unknownFields.length) return;
    logger.warn(
        'Managed permit denied domain=%s pid=%d actor=%d action=%s fields=%o result=denied',
        pdoc.domainId,
        pdoc.docId,
        handler.user._id,
        action,
        unknownFields,
    );
    await OplogModel.log(handler as any, 'problem.permit.denied', {
        problemId: pdoc.docId,
        action,
        fields: unknownFields,
        result: 'denied',
    });
    throw new ValidationError('fields', null, `托管题权限接口不接受字段：${unknownFields.join(', ')}`);
}

async function targetHasMaintainerSource(domainId: string, pid: number, targetUids: number[]): Promise<boolean> {
    const [canonical, sources] = await Promise.all([
        permitsColl
            .find({ domainId, pid, uid: { $in: targetUids }, active: canonicalActiveFilter() })
            .project({ uid: 1, role: 1 })
            .toArray(),
        permitSourcesColl
            .find({ domainId, pid, uid: { $in: targetUids }, active: true })
            .project({ uid: 1, role: 1 })
            .toArray(),
    ]);
    return [...canonical, ...sources].some((row) => row.role === 'maintainer');
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
        const grantableRoles = grantableProblemRoles(this.user, pdoc);
        if (!grantableRoles.length) {
            throw new PermissionError('无权查看此题目的权限列表');
        }
        const permits = await permitsModel.listForProblem(domainId, pdoc.docId);
        const uids = Array.from(new Set([...permits.map((p) => p.uid), ...permits.map((p) => p.grantedBy)]));
        const udict = await UserModel.getList(domainId, uids);
        const confirmedPdoc = await ProblemModel.getViewableAuthorized(domainId, pdoc.docId, this.user);
        const confirmedGrantableRoles = confirmedPdoc ? grantableProblemRoles(this.user, confirmedPdoc) : [];
        if (!confirmedPdoc || confirmedPdoc.docId !== pdoc.docId || !confirmedGrantableRoles.length) {
            throw new PermissionError('无权查看此题目的权限列表');
        }
        this.response.body = {
            permits,
            udict,
            grantableRoles: confirmedGrantableRoles,
            canManageMaintainers: ProblemModel.canManageProblemMaintainers(this.user, confirmedPdoc),
        };
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
        if (!PROBLEM_ROLES.includes(role as PermitRole)) {
            throw new ValidationError('role', null, 'role 必须是 verifier、author 或 maintainer');
        }
        const targetUids = Array.from(
            new Set([...(uid ? [uid] : []), ...(uids || []).map((i) => +i)].filter((i) => Number.isSafeInteger(i) && i > 0)),
        );
        if (!targetUids.length) {
            throw new ValidationError('uid', null, '请选择至少一个目标用户');
        }
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        await assertManagedPermitBody(this, pdoc, ['uid', 'uids', 'role', 'note', 'requestId'], 'grant');
        if (pdoc.authoringMode === 'managed' && targetUids.length !== 1) {
            await logManagedPermitDenied(this, pdoc, 'grant', role as PermitRole);
            throw new ValidationError('uids', null, '托管题每次只能变更一个用户的角色');
        }
        const allowedRoles = grantableProblemRoles(this.user, pdoc);
        if (!allowedRoles.includes(role as PermitRole)) {
            if (pdoc.authoringMode === 'managed') await logManagedPermitDenied(this, pdoc, 'grant', role as PermitRole);
            throw new PermissionError('无权授予该题目角色');
        }
        const targets = await UserModel.getList(domainId, targetUids);
        for (const targetUid of targetUids) {
            if (!targets[targetUid]) throw new ValidationError('uid', null, `目标用户 ${targetUid} 不存在`);
            if (pdoc.authoringMode !== 'managed' && targetUid === pdoc.owner) {
                throw new ValidationError('uid', null, '不能给作者自己授权');
            }
        }
        const initialMaintainerInvolved =
            pdoc.authoringMode === 'managed' && (role === 'maintainer' || (await targetHasMaintainerSource(domainId, pdoc.docId, targetUids)));
        if (initialMaintainerInvolved && !ProblemModel.canManageProblemMaintainers(this.user, pdoc)) {
            await logManagedPermitDenied(this, pdoc, 'grant', role as PermitRole);
            throw new PermissionError('无权授予或覆盖该题目角色');
        }
        const link = `/p/${pdoc.pid || pdoc.docId}`;
        const roleZh = role === 'maintainer' ? '题目维护者' : role === 'author' ? '出题人' : '验题人';
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
        let deniedInsideClaim = false;
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'permit-grant',
            async (claim) => {
                const currentPdoc = await ProblemModel.get(domainId, pdoc.docId);
                if (!currentPdoc) throw new Error(`problem ${domainId}/${pdoc.docId} disappeared during permit grant`);
                const currentAllowed = grantableProblemRoles(this.user, currentPdoc);
                const maintainerInvolved = role === 'maintainer' || (await targetHasMaintainerSource(domainId, currentPdoc.docId, targetUids));
                if (
                    !currentAllowed.includes(role as PermitRole) ||
                    (currentPdoc.authoringMode === 'managed' &&
                        maintainerInvolved &&
                        !ProblemModel.canManageProblemMaintainers(this.user, currentPdoc))
                ) {
                    deniedInsideClaim = true;
                    return;
                }
                // Persist the audit intent before the ACL mutation. A failed
                // Oplog write must never leave a newly active role behind.
                await OplogModel.log(this as any, 'problem.permit.grant', {
                    problemId: pdoc.docId,
                    targetUids,
                    role,
                    action: 'grant',
                    result: 'attempt',
                    requestId: mutationId,
                });
                await Promise.all(
                    targetUids.map((targetUid) =>
                        permitsModel.grant(domainId, pdoc.docId, targetUid, role as PermitRole, this.user._id, {
                            note,
                            requestId: `${mutationId}:${targetUid}`,
                            writeClaimRequestId: claim.requestId,
                        }),
                    ),
                );
                logger.info(
                    'Problem permit changed domain=%s pid=%d actor=%d role=%s action=grant targets=%o result=success',
                    domainId,
                    pdoc.docId,
                    this.user._id,
                    role,
                    targetUids,
                );
            },
            { requestId: mutationId, capability: initialMaintainerInvolved ? 'publish' : 'collaborators' },
        );
        if (deniedInsideClaim) {
            await logManagedPermitDenied(this, pdoc, 'grant', role as PermitRole);
            throw new PermissionError('无权授予或覆盖该题目角色');
        }
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
        await assertManagedPermitBody(this, pdoc, ['permitId', 'requestId'], 'revoke');
        const row = await permitsColl.findOne({
            domainId,
            _id: permitId,
            pid: pdoc.docId,
            active: canonicalActiveFilter(),
        });
        if (!row) throw new NotFoundError('权限记录不存在');
        const isSelf = row.uid === this.user._id;
        const canSelfRevoke = isSelf && (pdoc.authoringMode !== 'managed' || row.role !== 'maintainer');
        const initialMaintainerInvolved = pdoc.authoringMode === 'managed' && (await targetHasMaintainerSource(domainId, pdoc.docId, [row.uid]));
        const canManageInitialRole = initialMaintainerInvolved
            ? ProblemModel.canManageProblemMaintainers(this.user, pdoc)
            : canSelfRevoke || canRevokeProblemRole(this.user, pdoc, row.role);
        if (!canManageInitialRole) {
            if (pdoc.authoringMode === 'managed') await logManagedPermitDenied(this, pdoc, 'revoke', row.role);
            throw new PermissionError('无权撤销该权限');
        }
        const mutationId = deriveAclRequestId(requestId, 'problem-permit-revoke', domainId, pdoc.docId, row.uid);
        let deniedInsideClaim: PermitRole | null = null;
        let missingInsideClaim = false;
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'permit-revoke',
            async (claim) => {
                const [currentPdoc, currentRow] = await Promise.all([
                    ProblemModel.get(domainId, pdoc.docId),
                    permitsColl.findOne({
                        domainId,
                        _id: permitId,
                        pid: pdoc.docId,
                        active: canonicalActiveFilter(),
                    }),
                ]);
                if (!currentPdoc) throw new Error(`problem ${domainId}/${pdoc.docId} disappeared during permit revoke`);
                if (!currentRow) {
                    missingInsideClaim = true;
                    return;
                }
                const currentIsSelf = currentRow.uid === this.user._id;
                const currentCanSelfRevoke = currentIsSelf && (currentPdoc.authoringMode !== 'managed' || currentRow.role !== 'maintainer');
                const maintainerInvolved = await targetHasMaintainerSource(domainId, currentPdoc.docId, [currentRow.uid]);
                const allowed =
                    currentPdoc.authoringMode === 'managed' && maintainerInvolved
                        ? ProblemModel.canManageProblemMaintainers(this.user, currentPdoc)
                        : currentCanSelfRevoke || canRevokeProblemRole(this.user, currentPdoc, currentRow.role);
                if (!allowed) {
                    deniedInsideClaim = currentRow.role;
                    return;
                }
                // See grant: audit persistence is part of the precondition,
                // not a fallible step after the canonical ACL has changed.
                await OplogModel.log(this as any, 'problem.permit.revoke', {
                    problemId: pdoc.docId,
                    targetUid: currentRow.uid,
                    role: currentRow.role,
                    action: 'revoke',
                    result: 'attempt',
                    requestId: mutationId,
                });
                await permitsModel.revoke(domainId, permitId, {
                    requestId: mutationId,
                    actor: this.user._id,
                    writeClaimRequestId: claim.requestId,
                });
                logger.info(
                    'Problem permit changed domain=%s pid=%d actor=%d role=%s action=revoke target=%d result=success',
                    domainId,
                    pdoc.docId,
                    this.user._id,
                    currentRow.role,
                    currentRow.uid,
                );
            },
            {
                requestId: mutationId,
                selfRevokeUid: canSelfRevoke && !initialMaintainerInvolved ? row.uid : undefined,
                capability: initialMaintainerInvolved ? 'publish' : 'collaborators',
            },
        );
        if (missingInsideClaim) throw new NotFoundError('权限记录不存在');
        if (deniedInsideClaim) {
            await logManagedPermitDenied(this, pdoc, 'revoke', deniedInsideClaim);
            throw new PermissionError('无权撤销该题目角色');
        }
        this.response.body = { success: true, requestId: mutationId };
    }
}

const CONTRIBUTION_SCOPES: ProblemContributionScope[] = ['data', 'tag'];
const CONTRIBUTION_STATUSES: ProblemContributionStatus[] = ['pending', 'completed'];

function deriveContributionMutationId(requestId: string, operation: string, ...identity: unknown[]): string {
    return deriveAclRequestId(undefined, operation, ...identity, requestId.trim());
}

async function auditContributionDenied(handler: Handler, pdoc: any, targetUid: number, scope: string, stage: string, requestId: string) {
    logger.warn(
        'Problem contribution denied domain=%s pid=%d actor=%d target=%d scope=%s stage=%s result=denied requestId=%s',
        pdoc.domainId,
        pdoc.docId,
        handler.user._id,
        targetUid,
        scope,
        stage,
        requestId,
    );
    await OplogModel.log(handler as any, 'problem.contribution.denied', {
        domainId: pdoc.domainId,
        problemId: pdoc.docId,
        actor: handler.user._id,
        targetUid,
        scope,
        stage,
        result: 'denied',
        requestId,
    });
}

class ProblemContributionHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    async get(args: { domainId?: unknown }, pid: number) {
        const domainId = authoritativeDomainId(this, args);
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        if (!ProblemModel.canManageProblemContributions(this.user, pdoc)) {
            throw new PermissionError('无权查看此题目的贡献分工');
        }
        const rows = await permitsModel.listContributionsForProblem(domainId, pdoc.docId);
        const uids = [...new Set(rows.flatMap((row) => [row.uid, row.assignedBy, row.updatedBy]))];
        const udict = await UserModel.getList(domainId, uids);
        const confirmed = await ProblemModel.getViewableAuthorized(domainId, pdoc.docId, this.user);
        if (!confirmed || !ProblemModel.canManageProblemContributions(this.user, confirmed)) {
            throw new PermissionError('无权查看此题目的贡献分工');
        }
        this.response.body = { contributions: rows, udict };
    }

    @param('pid', Types.UnsignedInt)
    @param('uid', Types.PositiveInt)
    @param('scope', Types.String)
    @param('note', Types.String, true)
    @param('requestId', Types.String)
    async post(args: { domainId?: unknown }, pid: number, uid: number, scope: string, note: string, requestId: string) {
        const domainId = authoritativeDomainId(this, args);
        if (!CONTRIBUTION_SCOPES.includes(scope as ProblemContributionScope)) {
            throw new ValidationError('scope', null, 'scope 必须是 data 或 tag');
        }
        const target = await UserModel.getById(domainId, uid);
        if (!target) throw new ValidationError('uid', null, '目标用户不存在');
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        const mutationId = deriveContributionMutationId(requestId, 'problem-contribution-assign', domainId, pdoc.docId, uid, scope);
        if (!ProblemModel.canManageProblemContributions(this.user, pdoc)) {
            await auditContributionDenied(this, pdoc, uid, scope, 'authorize-assign', mutationId);
            throw new PermissionError('无权分配此题目的贡献范围');
        }
        let deniedInsideClaim = false;
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'contribution-assign',
            async (claim) => {
                const current = await ProblemModel.get(domainId, pdoc.docId);
                if (!current) throw new Error(`problem ${domainId}/${pdoc.docId} disappeared during contribution assign`);
                if (!ProblemModel.canManageProblemContributions(this.user, current)) {
                    deniedInsideClaim = true;
                    return;
                }
                await OplogModel.log(this as any, 'problem.contribution.assign', {
                    problemId: pdoc.docId,
                    targetUid: uid,
                    scope,
                    note: note || '',
                    requestId: mutationId,
                    result: 'attempt',
                });
                await permitsModel.assignContribution({
                    domainId,
                    pid: pdoc.docId,
                    uid,
                    scope: scope as ProblemContributionScope,
                    actor: this.user._id,
                    note,
                    requestId: mutationId,
                    writeClaimRequestId: claim.requestId,
                });
                logger.info(
                    'Problem contribution changed domain=%s pid=%d actor=%d target=%d scope=%s stage=assign result=success requestId=%s',
                    domainId,
                    pdoc.docId,
                    this.user._id,
                    uid,
                    scope,
                    mutationId,
                );
            },
            { requestId: mutationId, capability: 'contributions' },
        );
        if (deniedInsideClaim) {
            await auditContributionDenied(this, pdoc, uid, scope, 'claim-assign', mutationId);
            throw new PermissionError('无权分配此题目的贡献范围');
        }
        const scopeZh = scope === 'data' ? '数据贡献者' : '标签贡献者';
        try {
            await MessageModel.send(
                this.user._id,
                uid,
                `[krypton] 你被 ${this.user.uname} 分配为题目 ${pdoc.title} 的${scopeZh}：/p/${pdoc.pid || pdoc.docId}${note ? `\n附言：${note}` : ''}`,
                MessageModel.FLAG_UNREAD,
            );
        } catch (error) {
            logger.error(
                'contribution notification failed requestId=%s domain=%s pid=%d uid=%d scope=%s error=%o',
                mutationId,
                domainId,
                pdoc.docId,
                uid,
                scope,
                error,
            );
        }
        this.response.body = { success: true, requestId: mutationId };
    }
}

class ProblemContributionRevokeHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    @param('uid', Types.PositiveInt)
    @param('scope', Types.String)
    @param('requestId', Types.String)
    async post(args: { domainId?: unknown }, pid: number, uid: number, scope: string, requestId: string) {
        const domainId = authoritativeDomainId(this, args);
        if (!CONTRIBUTION_SCOPES.includes(scope as ProblemContributionScope)) throw new ValidationError('scope');
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        const mutationId = deriveContributionMutationId(requestId, 'problem-contribution-revoke', domainId, pdoc.docId, uid, scope);
        if (!ProblemModel.canManageProblemContributions(this.user, pdoc)) {
            await auditContributionDenied(this, pdoc, uid, scope, 'authorize-revoke', mutationId);
            throw new PermissionError('无权撤销此题目的贡献范围');
        }
        let deniedInsideClaim = false;
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'contribution-revoke',
            async (claim) => {
                const current = await ProblemModel.get(domainId, pdoc.docId);
                if (!current) throw new Error(`problem ${domainId}/${pdoc.docId} disappeared during contribution revoke`);
                if (!ProblemModel.canManageProblemContributions(this.user, current)) {
                    deniedInsideClaim = true;
                    return;
                }
                await OplogModel.log(this as any, 'problem.contribution.revoke', {
                    problemId: pdoc.docId,
                    targetUid: uid,
                    scope,
                    requestId: mutationId,
                    result: 'attempt',
                });
                await permitsModel.revokeContribution({
                    domainId,
                    pid: pdoc.docId,
                    uid,
                    scope: scope as ProblemContributionScope,
                    actor: this.user._id,
                    requestId: mutationId,
                    writeClaimRequestId: claim.requestId,
                });
                logger.info(
                    'Problem contribution changed domain=%s pid=%d actor=%d target=%d scope=%s stage=revoke result=success requestId=%s',
                    domainId,
                    pdoc.docId,
                    this.user._id,
                    uid,
                    scope,
                    mutationId,
                );
            },
            { requestId: mutationId, capability: 'contributions' },
        );
        if (deniedInsideClaim) {
            await auditContributionDenied(this, pdoc, uid, scope, 'claim-revoke', mutationId);
            throw new PermissionError('无权撤销此题目的贡献范围');
        }
        this.response.body = { success: true, requestId: mutationId };
    }
}

class ProblemContributionStatusHandler extends Handler {
    @param('pid', Types.UnsignedInt)
    @param('scope', Types.String)
    @param('status', Types.String)
    @param('requestId', Types.String)
    async post(args: { domainId?: unknown }, pid: number, scope: string, status: string, requestId: string) {
        const domainId = authoritativeDomainId(this, args);
        if (!CONTRIBUTION_SCOPES.includes(scope as ProblemContributionScope)) throw new ValidationError('scope');
        if (!CONTRIBUTION_STATUSES.includes(status as ProblemContributionStatus)) throw new ValidationError('status');
        const pdoc = await ProblemModel.getViewableAuthorized(domainId, pid, this.user);
        if (!pdoc) throw new NotFoundError('题目不存在');
        const rows = await permitsModel.listContributionsForProblem(domainId, pdoc.docId);
        const row = rows.find((item) => item.uid === this.user._id && item.scope === scope && item.active);
        const mutationId = deriveContributionMutationId(requestId, 'problem-contribution-status', domainId, pdoc.docId, this.user._id, scope, status);
        if (!row) {
            await auditContributionDenied(this, pdoc, this.user._id, scope, 'authorize-status', mutationId);
            throw new PermissionError('当前没有这项贡献任务');
        }
        await OplogModel.log(this as any, 'problem.contribution.status', {
            problemId: pdoc.docId,
            scope,
            status,
            requestId: mutationId,
            result: 'attempt',
        });
        await ProblemModel.withAuthorizedWriteClaim(
            domainId,
            pdoc.docId,
            this.user,
            'contribution-status',
            (claim) =>
                permitsModel.setContributionStatus({
                    domainId,
                    pid: pdoc.docId,
                    uid: this.user._id,
                    scope: scope as ProblemContributionScope,
                    status: status as ProblemContributionStatus,
                    actor: this.user._id,
                    requestId: mutationId,
                    writeClaimRequestId: claim.requestId,
                }),
            { requestId: mutationId, capability: scope as ProblemContributionScope },
        );
        logger.info(
            'Problem contribution changed domain=%s pid=%d actor=%d target=%d scope=%s stage=%s result=success requestId=%s',
            domainId,
            pdoc.docId,
            this.user._id,
            this.user._id,
            scope,
            status,
            mutationId,
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
        const r = (role || 'verifier') as ContestPermitRole;
        if (!CONTEST_ROLES.includes(r)) {
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
        if (r === 'maintainer') {
            for (const pid of tdoc.pids || []) {
                const pdoc = await ProblemModel.get(domainId, pid);
                if (pdoc?.authoringMode === 'managed') {
                    throw new ValidationError('role', null, '托管题维护者必须由系统管理员逐题直接授予');
                }
            }
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
    ctx.Route('problem_contribution', '/p/:pid/contributions', ProblemContributionHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_contribution_revoke', '/p/:pid/contributions/revoke', ProblemContributionRevokeHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('problem_contribution_status', '/p/:pid/contributions/status', ProblemContributionStatusHandler, PERM.PERM_VIEW_PROBLEM);
    ctx.Route('contest_verifier_add', '/contest/:tid/verifiers', ContestVerifierAddHandler, PERM.PERM_VIEW_CONTEST);
    ctx.Route('contest_verifier_remove', '/contest/:tid/verifiers/remove', ContestVerifierRemoveHandler, PERM.PERM_VIEW_CONTEST);
    // Not /tasks/verify — that would collide with krypton-tasks's
    // `/tasks/:tid` (TaskDetailHandler) route: hydro routes by registration
    // order, and "verify" would be parsed as a tid ObjectId, failing
    // validation. Plugin-namespaced path is collision-free.
    ctx.Route('my_verify_inbox', '/permits/inbox', MyVerifyInboxHandler, PRIV.PRIV_USER_PROFILE);
}
