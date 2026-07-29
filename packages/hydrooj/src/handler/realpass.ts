/**
 * 赛时通过率（原赛通过数据）管理 — PLAN 2026-07 P1.1/P1.2。
 *
 * `pdoc.origStat` 记录题目在原始比赛（牛客/杭电等外站）当年的
 * accepted/submitted。数据来源：
 *   1. 老插件集合 real_pass_percent 一次性迁移
 *      （docs/plan-2026-07/scripts/p11-migrate-realpass.mongosh.js，人工触发）；
 *   2. 本 handler 的单题录入 / 批量粘贴导入（dryRun 预览 → 确认写入）。
 *
 * 权限：v1 仅 PRIV_EDIT_SYSTEM（站点管理员）。教师录入属后续独立决策
 * （届时新增专用 PERM 位），不得复用 rankboard/userbind 等插件数据权限顶替。
 *
 * 题目 ID 解析规则（与迁移脚本一致，PLAN Rev.7）：
 *   - 纯数字串同时按 docId 与 pid 查——同题→命中；异题→冲突（拒绝写入）；
 *     单侧命中→命中；全无→unmatched。
 *   - 非数字串只按 pid 查。
 */
import { escapeRegExp } from 'lodash';
import { localizedErrorText, Context, db, Handler, OplogModel, param, PRIV, Types, ValidationError } from 'hydrooj';
import problem from '../model/problem';

const PROJ_RESOLVE = ['docId', 'pid', 'title'] as any[];
const PROJ_LIST = ['docId', 'pid', 'title', 'origStat', 'hidden'] as any[];

type ResolveStatus = 'ok' | 'unmatched' | 'conflict';
interface ResolveResult {
    status: ResolveStatus;
    docId?: number;
    pid?: string;
    title?: string;
    /** conflict 时的两侧命中，供报告展示 */
    byDocId?: number;
    byPid?: number;
}

async function resolveTarget(domainId: string, raw: string): Promise<ResolveResult> {
    const s = raw.trim();
    if (!s) return { status: 'unmatched' };
    if (/^\d+$/.test(s)) {
        const [byDocId, byPid] = await Promise.all([
            problem.getMulti(domainId, { docId: +s }, PROJ_RESOLVE).limit(1).toArray(),
            problem.getMulti(domainId, { pid: s }, PROJ_RESOLVE).limit(1).toArray(),
        ]);
        const a = byDocId[0];
        const b = byPid[0];
        if (a && b && a.docId !== b.docId) {
            return {
                status: 'conflict',
                byDocId: a.docId,
                byPid: b.docId,
            };
        }
        const hit = a || b;
        if (!hit) return { status: 'unmatched' };
        return {
            status: 'ok',
            docId: hit.docId,
            pid: hit.pid,
            title: hit.title,
        };
    }
    const hits = await problem.getMulti(domainId, { pid: s }, PROJ_RESOLVE).limit(1).toArray();
    if (!hits[0]) return { status: 'unmatched' };
    return {
        status: 'ok',
        docId: hits[0].docId,
        pid: hits[0].pid,
        title: hits[0].title,
    };
}

function buildOrigStat(accepted: number, submitted: number, uid: number) {
    return {
        accepted,
        submitted,
        updatedBy: uid,
        updatedAt: new Date(),
    };
}

interface BatchRow {
    line: string;
    status: ResolveStatus | 'invalid' | 'duplicate';
    reason?: string;
    docId?: number;
    pid?: string;
    title?: string;
    accepted?: number;
    submitted?: number;
}

class RealPassManageHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(domainId: string, page = 1, q = '') {
        const query: any = { origStat: { $type: 'object' } };
        if (q) {
            const re = new RegExp(escapeRegExp(q), 'i');
            query.$or = [{ pid: re }, { title: re }];
        }
        const [pdocs, ppcount, pcount] = await this.paginate(problem.getMulti(domainId, query, PROJ_LIST).sort({ docId: 1 }), page, 'problem');
        // 迁移脚本留下的 unmatched/conflict 报告（只读展示，帮助管理员收尾）。
        const migration = await db.collection('system' as any).findOne({ _id: 'realpass.migration_unmatched' as any });
        this.response.template = 'manage_realpass.html';
        this.response.body = {
            pdocs,
            page,
            ppcount,
            pcount,
            q,
            migration: migration?.value || null,
        };
    }

    @param('target', Types.String)
    @param('accepted', Types.UnsignedInt)
    @param('submitted', Types.UnsignedInt)
    async postSet(domainId: string, target: string, accepted: number, submitted: number) {
        if (accepted > submitted) throw new ValidationError('accepted', null, localizedErrorText`accepted 不能大于 submitted`);
        const r = await resolveTarget(domainId, target);
        if (r.status === 'conflict') {
            throw new ValidationError(
                'target',
                null,
                localizedErrorText`docId 与 pid 双命中不同题（docId→#${r.byDocId} / pid→#${r.byPid}），请改用明确的 pid`,
            );
        }
        if (r.status !== 'ok') throw new ValidationError('target', null, localizedErrorText`未找到题目：${target}`);
        await problem.editAuthorized(domainId, r.docId!, { origStat: buildOrigStat(accepted, submitted, this.user._id) } as any, this.user);
        await OplogModel.log(this as any, 'realpass.set', {
            docId: r.docId,
            pid: r.pid,
            accepted,
            submitted,
        });
        this.response.body = {
            ok: true,
            docId: r.docId,
            pid: r.pid,
            title: r.title,
        };
    }

    @param('docId', Types.UnsignedInt)
    async postRemove(domainId: string, docId: number) {
        // 先验证题目存在，随后由 ACL revision 条件写完成原子删除。
        const exists = await problem.getMulti(domainId, { docId }, PROJ_RESOLVE).limit(1).toArray();
        if (!exists[0]) throw new ValidationError('docId', null, localizedErrorText`题目不存在：#${docId}`);
        await problem.editAuthorized(domainId, docId, {}, this.user, { origStat: '' });
        await OplogModel.log(this as any, 'realpass.remove', { docId });
        this.response.body = { ok: true, docId };
    }

    @param('payload', Types.String)
    @param('commit', Types.Boolean)
    async postBatch(domainId: string, payload: string, commit = false) {
        const lines = payload
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (!lines.length) throw new ValidationError('payload', null, localizedErrorText`内容为空`);
        if (lines.length > 2000) throw new ValidationError('payload', null, localizedErrorText`单次最多 2000 行`);
        const rows: BatchRow[] = [];
        const seen = new Set<number>();
        for (const line of lines) {
            // TSV 为主，宽容逗号/连续空白分隔。
            const parts = line.split(/[\t,，]+|\s+/).filter(Boolean);
            if (parts.length !== 3) {
                rows.push({ line, status: 'invalid', reason: '需要 3 列：题目ID 通过数 提交数' });
                continue;
            }
            const [id, a, s] = parts;
            const accepted = Number(a);
            const submitted = Number(s);
            if (!Number.isSafeInteger(accepted) || !Number.isSafeInteger(submitted) || accepted < 0 || submitted < 0) {
                rows.push({ line, status: 'invalid', reason: '通过数/提交数必须是非负整数' });
                continue;
            }
            if (accepted > submitted) {
                rows.push({ line, status: 'invalid', reason: '通过数不能大于提交数' });
                continue;
            }
            const r = await resolveTarget(domainId, id);
            if (r.status === 'conflict') {
                rows.push({
                    line,
                    status: 'conflict',
                    reason: `docId→#${r.byDocId} / pid→#${r.byPid} 双命中不同题`,
                    accepted,
                    submitted,
                });
                continue;
            }
            if (r.status !== 'ok') {
                rows.push({
                    line,
                    status: 'unmatched',
                    reason: `未找到题目：${id}`,
                    accepted,
                    submitted,
                });
                continue;
            }
            if (seen.has(r.docId!)) {
                rows.push({
                    line,
                    status: 'duplicate',
                    reason: `与前面的行指向同一题 #${r.docId}，本行跳过`,
                    docId: r.docId,
                    pid: r.pid,
                    title: r.title,
                    accepted,
                    submitted,
                });
                continue;
            }
            seen.add(r.docId!);
            rows.push({
                line,
                status: 'ok',
                docId: r.docId,
                pid: r.pid,
                title: r.title,
                accepted,
                submitted,
            });
        }
        const okRows = rows.filter((r) => r.status === 'ok');
        if (commit) {
            for (const r of okRows) {
                await problem.editAuthorized(
                    domainId,
                    r.docId!,
                    { origStat: buildOrigStat(r.accepted!, r.submitted!, this.user._id) } as any,
                    this.user,
                );
            }
            await OplogModel.log(this as any, 'realpass.batch', {
                total: rows.length,
                written: okRows.length,
                docIds: okRows.map((r) => r.docId).slice(0, 200),
            });
        }
        this.response.body = {
            rows,
            committed: !!commit,
            summary: {
                total: rows.length,
                ok: okRows.length,
                unmatched: rows.filter((r) => r.status === 'unmatched').length,
                conflict: rows.filter((r) => r.status === 'conflict').length,
                invalid: rows.filter((r) => r.status === 'invalid').length,
                duplicate: rows.filter((r) => r.status === 'duplicate').length,
            },
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('manage_realpass', '/manage/realpass', RealPassManageHandler, PRIV.PRIV_EDIT_SYSTEM);
}
