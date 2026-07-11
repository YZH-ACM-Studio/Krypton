/**
 * 出卷中心（PLAN 2026-07 P3.1 骨架 / Rev.12 全量）——客观题与函数题的
 * 独立管理入口：
 *   GET  /paper-center                 列表（题号/标题/题型构成/创建时间 + 搜索）
 *   POST /paper-center/create          弹标题框创建（objective / fill_function）
 *   GET/POST /paper-center/:docId/edit 客观题独立编辑器（Rev.12：不再走 problem-edit）
 *   GET/POST /paper-center/grading/:tid 比赛主观题阅卷（列表 + 给分）
 *
 * 权限：路由级 PERM_CREATE_PROBLEM（管理员 + 教师）；编辑 = 题目 owner
 * （PERM_EDIT_PROBLEM_SELF）或 PERM_EDIT_PROBLEM（对齐 ProblemManageHandler）；
 * 阅卷 = 题目 owner 或站点管理员（PRIV_EDIT_SYSTEM）。
 *
 * canonical config 由服务端生成（客户端只发结构化 questions JSON），
 * 客户端永远拿不到"直接写任意 YAML"的口子。
 */
import yaml from 'js-yaml';
import { escapeRegExp } from 'lodash';
import { ObjectId } from 'mongodb';
import { STATUS } from '@hydrooj/common';
import {
    Context, Handler, NotFoundError, OplogModel, param, PermissionError, Types, ValidationError,
} from 'hydrooj';
import {
    parseProblemConfigObject, questionKindMap, subjectiveKeysOf,
} from '../lib/problem-config';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import problem from '../model/problem';
import { buildProblemBankScope } from '../model/problem-access';
import record from '../model/record';
import user from '../model/user';

const PROJ_LIST = ['_id', 'docId', 'pid', 'title', 'hidden', 'owner', 'maintainer'] as any[];

/**
 * 匹配 config YAML 串里的题目类型行（客观题类 = objective + fill_function）。
 * 行锚定避免把注释/字符串值里的同名文本当命中；解析后仍以 cfg.type 回验
 * （regex 只是把全集合收敛到候选集的粗筛）。
 */
const OBJECTIVE_CONFIG_RE = /^\s*['"]?type['"]?\s*:\s*['"]?(objective|fill_function)['"]?\s*(?:#.*)?$/m;

interface KindSummary {
    /** 'objective' | 'fill_function'；parseError 时按 objective 兜底 */
    type: string;
    /** kind → 小题数，如 { single: 5, multi: 2, blank: 3 } */
    kinds: Record<string, number>;
    /** 小题总数（fill_function 为挖空区数） */
    total: number;
    parseError?: boolean;
}

const PARSE_ERROR: KindSummary = Object.freeze({
    type: 'objective', kinds: Object.freeze({}), total: 0, parseError: true,
});

/** regex 误命中（解析后 type 并非客观题类）→ null，调用方把该行从列表剔除。 */
function summarizeConfig(raw: unknown): KindSummary | null {
    let cfg: any = raw;
    if (typeof raw === 'string') {
        try {
            cfg = yaml.load(raw);
        } catch {
            return PARSE_ERROR;
        }
    }
    if (!cfg || typeof cfg !== 'object') return PARSE_ERROR;
    if (cfg.type === 'fill_function') {
        const regions = Array.isArray(cfg.template?.regions) ? cfg.template.regions.length : 0;
        return { type: 'fill_function', kinds: { fill_function: regions }, total: regions };
    }
    if (cfg.type !== 'objective') return null;
    try {
        // answers 结构不受控（config.yaml 可原样上传/来自 legacy 迁移），
        // 单条畸形 entry（如值为 null）不许炸掉整个列表页。
        const kindByKey = questionKindMap(cfg.answers);
        const kinds: Record<string, number> = {};
        for (const kind of Object.values(kindByKey)) kinds[kind] = (kinds[kind] || 0) + 1;
        return { type: 'objective', kinds, total: Object.keys(kindByKey).length };
    } catch {
        return PARSE_ERROR;
    }
}

export class PaperCenterHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, page = 1, q = '') {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const query: any = {
            $and: [buildProblemBankScope(this.user), { config: OBJECTIVE_CONFIG_RE }],
        };
        if (q) {
            const re = new RegExp(escapeRegExp(q), 'i');
            query.$and.push({ $or: [{ pid: re }, { title: re }] });
        }
        const [pdocs, ppcount, pcount] = await this.paginate(
            problem.getMulti(authoritativeDomainId, query, PROJ_LIST).sort({ docId: -1 }),
            page,
            20, // spec Rev.2：每页 ≤20，题型构成才允许当页逐题解析 raw config
        );
        const stableConfigs = await Promise.all(pdocs.map((p) => problem.getMaintainableAuthorized(
            authoritativeDomainId, p.docId, this.user, ['config'] as any, true,
        )));
        const udict = await user.getList(authoritativeDomainId, pdocs.map((p) => p.owner));
        const rows = pdocs.flatMap((p, index) => {
            const stable = stableConfigs[index];
            if (!stable) return [];
            const summary = summarizeConfig(stable.config);
            // summary=null = regex 粗筛误命中（解析后并非客观题类），剔除。
            // 极罕见；此时 pcount/分页会略微高估，骨架版接受。
            if (!summary) return [];
            return [{
                docId: p.docId,
                pid: p.pid,
                title: p.title,
                hidden: !!p.hidden,
                owner: p.owner,
                ownerName: udict[p.owner]?.uname || `UID ${p.owner}`,
                createdAt: p._id?.getTimestamp?.() || null,
                summary,
            }];
        });
        this.response.template = 'paper_center.html';
        this.response.body = {
            rows, page, ppcount, pcount, q,
        };
    }
}

// ─── Rev.12：创建 / 独立编辑器 / 阅卷 ─────────────────────────────────────

const QUESTION_KINDS = ['single', 'multi', 'blank', 'fill_program', 'subjective'] as const;
type EditorKind = typeof QUESTION_KINDS[number];

interface EditorQuestion {
    key: string;
    kind: EditorKind;
    prompt: string;
    choices?: string[];
    answer: string | string[];
    score: number;
    presentation?: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * 服务端校验 + 生成 canonical config YAML。客户端只发结构化 questions，
 * answers/options 由这里构造——畸形 YAML / 越界 answer 在入口处拒绝。
 */
function buildObjectiveConfigYaml(questions: EditorQuestion[], existingRaw: string): string {
    if (!Array.isArray(questions)) throw new ValidationError('questions', null, 'questions 必须是数组');
    if (questions.length > 200) throw new ValidationError('questions', null, '小题数量超限（≤200）');
    let base: any = {};
    if (existingRaw && typeof existingRaw === 'string') {
        try {
            const parsed = yaml.load(existingRaw);
            if (parsed && typeof parsed === 'object') base = parsed;
        } catch { base = {}; }
    }
    const answers: Record<string, any> = {};
    const options: Record<string, string[]> = {};
    const seen = new Set<string>();
    for (const [i, q] of questions.entries()) {
        const label = `第 ${i + 1} 题`;
        if (!q || typeof q !== 'object') throw new ValidationError('questions', null, `${label}格式错误`);
        const key = String(q.key ?? '').trim();
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(key)) throw new ValidationError('questions', null, `${label}题号非法（字母数字-_，≤32 字符）`);
        // JS 对象保留属性名会被静默吞掉（answers['__proto__']=... 丢题）
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ValidationError('questions', null, `${label}题号 "${key}" 是保留字`);
        if (seen.has(key)) throw new ValidationError('questions', null, `题号 "${key}" 重复`);
        seen.add(key);
        if (!QUESTION_KINDS.includes(q.kind)) throw new ValidationError('questions', null, `${label}题型非法`);
        const score = Number(q.score);
        if (!Number.isFinite(score) || score < 0 || score > 1000) throw new ValidationError('questions', null, `${label}分值非法（0-1000）`);
        const prompt = typeof q.prompt === 'string' ? q.prompt : '';
        if (prompt.length > 65536) throw new ValidationError('questions', null, `${label}题干过长`);
        const meta: any = { kind: q.kind, prompt };
        if (typeof q.presentation === 'string' && q.presentation) meta.presentation = q.presentation.slice(0, 32);
        let answer: string | string[];
        if (q.kind === 'single' || q.kind === 'multi') {
            const choices = Array.isArray(q.choices) ? q.choices.map((c) => String(c ?? '')) : [];
            if (choices.length < 2 || choices.length > LETTERS.length) {
                throw new ValidationError('questions', null, `${label}选项数需在 2-${LETTERS.length} 之间`);
            }
            if (choices.some((c) => !c.trim())) throw new ValidationError('questions', null, `${label}存在空白选项`);
            const valid = new Set(choices.map((_, j) => LETTERS[j]));
            if (q.kind === 'single') {
                answer = String(q.answer ?? '').trim().toUpperCase();
                if (!valid.has(answer)) throw new ValidationError('questions', null, `${label}未标记正确答案`);
            } else {
                const arr = Array.isArray(q.answer) ? q.answer.map((a) => String(a).trim().toUpperCase()) : [];
                const uniq = Array.from(new Set(arr)).sort();
                if (!uniq.length) throw new ValidationError('questions', null, `${label}至少勾选一个正确答案`);
                if (uniq.some((a) => !valid.has(a))) throw new ValidationError('questions', null, `${label}正确答案超出选项范围`);
                answer = uniq;
            }
            meta.choices = choices;
            options[key] = choices;
        } else if (q.kind === 'subjective') {
            // 主观题无标准答案；判题器见 kind 记 0 分待人工。
            answer = '';
            if (score <= 0) throw new ValidationError('questions', null, `${label}（主观题）分值必须大于 0`);
        } else {
            // blank / fill_program：单字符串答案（blank v1 约束，PLAN P3.2）
            answer = Array.isArray(q.answer) ? String(q.answer[0] ?? '') : String(q.answer ?? '');
            if (!answer.trim()) throw new ValidationError('questions', null, `${label}标准答案不能为空`);
            if (answer.length > 65536) throw new ValidationError('questions', null, `${label}标准答案过长`);
        }
        answers[key] = [answer, score, meta];
    }
    base.type = 'objective';
    base.answers = answers;
    if (Object.keys(options).length) base.options = options;
    else delete base.options;
    // 客观题不该有编程题评测配置，防串。
    delete base.cases;
    delete base.subtasks;
    delete base.checker;
    delete base.template;
    return yaml.dump(base);
}

export class PaperCenterCreateHandler extends Handler {
    @param('title', Types.Title)
    @param('ptype', Types.Range(['objective', 'fill_function']))
    async post(_domainId: string, title: string, ptype: string) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const docId = await problem.add(authoritativeDomainId, '', title, '', this.user._id, [], { hidden: true });
        const config = ptype === 'objective'
            ? yaml.dump({ type: 'objective', answers: {} })
            : yaml.dump({ type: 'fill_function' });
        await problem.addTestdata(authoritativeDomainId, docId, 'config.yaml', Buffer.from(config), this.user._id);
        await OplogModel.log(this, 'paperCenter.create', { docId, ptype });
        this.response.body = {
            ok: true,
            docId,
            url: ptype === 'objective'
                ? this.url('paper_center_edit', { docId })
                : `${this.url('problem_detail', { pid: docId })}/edit`,
        };
    }
}

export class PaperCenterEditHandler extends Handler {
    pdoc: any;

    @param('docId', Types.UnsignedInt)
    async _prepare(_domainId: string, docId: number) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        // raw config（含标准答案）——本页 owner/教师 gated，不经净化。
        this.pdoc = await problem.getMaintainableAuthorized(
            authoritativeDomainId, docId, this.user, undefined, true,
        );
        if (!this.pdoc) throw new PermissionError(PERM.PERM_EDIT_PROBLEM_SELF);
        const cfg = parseProblemConfigObject(this.pdoc);
        if (cfg?.type !== 'objective') {
            // 非客观题不归本编辑器管——比如函数题走 problem-edit。
            throw new ValidationError('docId', null, '该题不是客观题，请在题目编辑页编辑');
        }
    }

    async get() {
        this.response.template = 'paper_center_edit.html';
        this.response.body = {
            pdoc: {
                docId: this.pdoc.docId,
                pid: this.pdoc.pid,
                title: this.pdoc.title,
                content: this.pdoc.content || '',
                tag: this.pdoc.tag || [],
                hidden: !!this.pdoc.hidden,
                owner: this.pdoc.owner,
            },
            configRaw: typeof this.pdoc.config === 'string' ? this.pdoc.config : '',
        };
    }

    @param('title', Types.Title)
    @param('content', Types.Content, true)
    @param('tag', Types.Content, true)
    @param('hidden', Types.Boolean)
    @param('questions', Types.Content)
    async post(
        _domainId: string, title: string, content = '', tagRaw = '', hidden = false, questionsRaw = '',
    ) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        let questions: EditorQuestion[];
        try {
            questions = JSON.parse(questionsRaw);
        } catch {
            throw new ValidationError('questions', null, 'questions 不是合法 JSON');
        }
        const existingRaw = typeof this.pdoc.config === 'string' ? this.pdoc.config : '';
        const configYaml = buildObjectiveConfigYaml(questions, existingRaw);
        let tag: string[] = [];
        if (tagRaw) {
            try {
                const parsed = JSON.parse(tagRaw);
                if (Array.isArray(parsed)) tag = parsed.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
            } catch { /* 忽略非法 tag，保持空 */ }
        }
        // 基本信息 + config 同步落库；addTestdata 的钩子会把 config.yaml
        // 镜像进 pdoc.config 并触发 problem/edit 事件（ES 重索引）。
        await problem.withAuthorizedWriteClaim(
            authoritativeDomainId,
            this.pdoc.docId,
            this.user,
            'paper-center-save',
            async (claim) => {
                await problem.editWithClaim(claim, {
                    title, content, tag, hidden: !!hidden, html: false,
                } as any);
                await problem.addTestdataWithClaim(
                    claim, 'config.yaml', Buffer.from(configYaml), this.user._id,
                );
            },
        );
        await OplogModel.log(this, 'paperCenter.save', { docId: this.pdoc.docId, questionCount: questions.length });
        this.response.body = { ok: true, docId: this.pdoc.docId };
    }
}

// ─── 阅卷（主观题人工给分，按比赛）────────────────────────────────────────

function canGrade(h: Handler, pdoc: any): boolean {
    return pdoc.owner === h.user._id || h.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

export class PaperCenterGradingHandler extends Handler {
    tdoc: any;

    @param('tid', Types.ObjectId)
    async _prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.tdoc) throw new NotFoundError('Contest');
    }

    @param('pid', Types.UnsignedInt, true)
    async get(_domainId: string, pid = 0) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        // 本场含主观题、且当前用户可阅卷（题目 owner ∥ 站点管理员）的题目清单。
        const problems: Array<{ pid: number, title: string, keys: Record<string, { score: number, prompt: string }> }> = [];
        for (const p of (this.tdoc.pids as number[] || [])) {
            const pdoc = await problem.getMaintainableAuthorized( // eslint-disable-line no-await-in-loop
                authoritativeDomainId, p, this.user, undefined, true,
            );
            if (!pdoc || !canGrade(this, pdoc)) continue;
            const keys = subjectiveKeysOf(parseProblemConfigObject(pdoc));
            if (Object.keys(keys).length) problems.push({ pid: p, title: pdoc.title, keys });
        }
        this.response.template = 'paper_center_grading.html';
        const body: any = { tdoc: { docId: this.tdoc.docId, title: this.tdoc.title }, problems };
        if (pid && problems.some((p) => p.pid === pid)) {
            const keys = problems.find((p) => p.pid === pid)!.keys;
            // 每人最新一条本场提交（记录量=参赛人数级，全取内存去重）。
            const rdocs = await record.getMulti(authoritativeDomainId, { contest: this.tdoc.docId, pid })
                .sort({ _id: -1 }).limit(2000).toArray();
            const latestByUid = new Map<number, any>();
            for (const r of rdocs) if (!latestByUid.has(r.uid)) latestByUid.set(r.uid, r);
            const uids = Array.from(latestByUid.keys());
            const udict = await user.getListForRender(authoritativeDomainId, uids, false).catch(() => ({} as any));
            body.rows = Array.from(latestByUid.values()).map((r) => {
                let answers: Record<string, any> = {};
                try {
                    // rdoc.code 是学生可控输入：客观题答案本应只有几 KB，
                    // 超长的一律不解析（防 YAML 解析拖垮事件循环，红线 5/坑 22 同类）。
                    const code = typeof r.code === 'string' ? r.code : '';
                    if (code.length <= 65536) {
                        const parsed = yaml.load(code);
                        if (parsed && typeof parsed === 'object') answers = parsed as any;
                    }
                } catch { /* 答案不可解析 → 空 */ }
                const subjectiveAnswers: Record<string, string> = {};
                for (const k of Object.keys(keys)) {
                    const v = (answers as any)[k];
                    subjectiveAnswers[k] = v === undefined || v === null ? '' : (Array.isArray(v) ? v.join('\n') : String(v));
                }
                const u = (udict as any)[r.uid] || {};
                return {
                    rid: String(r._id),
                    uid: r.uid,
                    uname: u.uname || `UID ${r.uid}`,
                    realName: u.realName,
                    studentId: u.studentId,
                    submittedAt: r._id.getTimestamp(),
                    status: r.status,
                    score: r.score || 0,
                    answers: subjectiveAnswers,
                    manualScores: r.subjective?.scores || {},
                    gradedBy: r.subjective?.gradedBy,
                };
            });
            body.pid = pid;
        }
        this.response.body = body;
    }

    @param('rid', Types.ObjectId)
    @param('scores', Types.Content)
    async post(_domainId: string, rid: ObjectId, scoresRaw: string) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const rdoc = await record.get(authoritativeDomainId, rid);
        if (!rdoc) throw new NotFoundError('Record');
        if (String(rdoc.contest) !== String(this.tdoc.docId)) {
            throw new ValidationError('rid', null, '该提交不属于本场比赛');
        }
        const pdoc = await problem.getMaintainableAuthorized(
            authoritativeDomainId, rdoc.pid, this.user, undefined, true,
        );
        if (!pdoc) throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
        if (!canGrade(this, pdoc)) throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
        const cfg = parseProblemConfigObject(pdoc);
        const keys = subjectiveKeysOf(cfg);
        if (!Object.keys(keys).length) throw new ValidationError('rid', null, '该题没有主观题小题');

        let submitted: Record<string, number>;
        try {
            submitted = JSON.parse(scoresRaw);
            if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new Error('bad');
        } catch {
            throw new ValidationError('scores', null, 'scores 不是合法 JSON 对象');
        }
        for (const [k, v] of Object.entries(submitted)) {
            if (!keys[k]) throw new ValidationError('scores', null, `"${k}" 不是主观题题号`);
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0 || n > keys[k].score) {
                throw new ValidationError('scores', null, `第 ${k} 题分数需在 0-${keys[k].score} 之间`);
            }
        }

        const prev = rdoc.subjective;
        const baseScore = prev?.baseScore ?? (rdoc.score || 0);
        const newScores: Record<string, number> = { ...(prev?.scores || {}) };
        for (const [k, v] of Object.entries(submitted)) newScores[k] = Number(v);
        const manualSum = Object.values(newScores).reduce((s, v) => s + v, 0);
        const newScore = baseScore + manualSum;
        const allGraded = Object.keys(keys).every((k) => newScores[k] !== undefined);
        // 满分口径：全部小题分值合计（自动 + 主观）。
        let totalFull = 0;
        for (const entry of Object.values(cfg.answers || {})) {
            if (Array.isArray(entry)) totalFull += Number(entry[1]) || 0;
        }
        const newStatus = allGraded
            ? (newScore >= totalFull ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER)
            : STATUS.STATUS_WAITING;

        // 回写判题明细，让记录页每题显示人工分。
        const testCases = (rdoc.testCases || []).map((c: any) => {
            const key = Object.keys(keys).find((k) => Number(k.split('-')[0]) === c.subtaskId);
            if (!key || newScores[key] === undefined) return c;
            const v = newScores[key];
            const max = keys[key].score;
            return {
                ...c,
                score: v,
                status: v >= max ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER,
                message: `人工评分：${v}/${max}`,
            };
        });

        const updated = await record.update(authoritativeDomainId, rid, {
            score: newScore,
            status: newStatus,
            testCases,
            subjective: {
                scores: newScores, baseScore, gradedBy: this.user._id, gradedAt: new Date(),
            },
        } as any);
        // 与判题完成路径（handler/judge.ts postJudge）同构地刷新题目/比赛状态。
        await problem.updateStatus(authoritativeDomainId, rdoc.pid, rdoc.uid, rid, newStatus, newScore);
        await contest.updateStatus(
            authoritativeDomainId, this.tdoc.docId, rdoc.uid, rid, rdoc.pid,
            updated || { ...rdoc, score: newScore, status: newStatus },
        );
        await OplogModel.log(this, 'paperCenter.grade', {
            tid: this.tdoc.docId, rid, pid: rdoc.pid, uid: rdoc.uid, scores: submitted, newScore, newStatus,
        });
        this.response.body = {
            ok: true, rid: String(rid), score: newScore, status: newStatus, allGraded,
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('paper_center', '/paper-center', PaperCenterHandler, PERM.PERM_CREATE_PROBLEM);
    ctx.Route('paper_center_create', '/paper-center/create', PaperCenterCreateHandler, PERM.PERM_CREATE_PROBLEM);
    ctx.Route('paper_center_edit', '/paper-center/:docId/edit', PaperCenterEditHandler, PERM.PERM_CREATE_PROBLEM);
    ctx.Route('paper_center_grading', '/paper-center/grading/:tid', PaperCenterGradingHandler, PERM.PERM_CREATE_PROBLEM);
}
