/**
 * Task-point preset registry.
 *
 * Each preset exposes:
 *   - id / name / description    : surface metadata for the picker
 *   - params: TaskPointParamSchema[] — form schema rendered by the ui-next admin editor
 *   - checker(ctx, params)        — async fn returning {completed,current,target,details}
 *
 * Presets ship in three batches:
 *   - base 8       — pure-OJ presets (this file's `basePresets`)
 *   - Krypton 4    — added in `kryptonPresets` (exam-finalized, group membership,
 *                    homework progress, training progress)
 *   - score 6      — added in `scorePresets` (PAT/GPLT/CSP)
 *
 * The exported `taskPointPresets` is the merged registry; checkers reference
 * the live collections by `import` so we don't pay the registry cost twice.
 */
import {
    ContestModel, DocumentModel, ObjectId, RecordModel, STATUS,
} from 'hydrooj';
import { userBindModel } from '@hydrooj/krypton-userbind';
import { cspScoreColl, gpltScoreColl, patScoreColl, stayEventsColl } from './db';
import type {
    TaskCheckerContext, TaskPointParamSchema, TaskPointPreset, TaskPointResult,
} from './types';

// ============ shared helpers ============

type DateLike = string | Date | null | undefined;

function dateBoundaryMs(value: DateLike, boundary: 'start' | 'end'): number | null {
    if (!value) return null;
    if (value instanceof Date) {
        const t = value.getTime();
        return Number.isNaN(t) ? null : t;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const time = boundary === 'end' ? '23:59:59.999' : '00:00:00.000';
        const t = new Date(`${raw}T${time}+08:00`).getTime();
        return Number.isNaN(t) ? null : t;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(raw)) {
        const withSeconds = raw.length === 16 ? `${raw}:00` : raw;
        const t = new Date(`${withSeconds}+08:00`).getTime();
        return Number.isNaN(t) ? null : t;
    }
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
}

function hasDateValue(value: DateLike): boolean {
    return dateBoundaryMs(value, 'start') !== null;
}

/** Build an ObjectId range from a date/date-time for record query windowing. */
function dateRangeQuery(start?: DateLike, end?: DateLike): Record<string, any> {
    const r: any = {};
    const startT = dateBoundaryMs(start, 'start');
    if (startT !== null) r.$gte = new ObjectId(Math.floor(startT / 1000).toString(16).padStart(8, '0') + '0000000000000000');
    const endT = dateBoundaryMs(end, 'end');
    if (endT !== null) r.$lte = new ObjectId(Math.floor(endT / 1000).toString(16).padStart(8, '0') + 'ffffffffffffffff');
    return r;
}

function dateRangeParams(): TaskPointParamSchema[] {
    return [
        { name: 'startDate', type: 'date', label: '开始日期', required: false, helper: '留空表示不限' },
        { name: 'endDate', type: 'date', label: '结束日期', required: false, helper: '留空表示不限' },
    ];
}

function pct(current: number, target: number, completed: boolean, details: string): TaskPointResult {
    return { current, target, completed, details };
}

/**
 * Resolve the task user to their userbind student `_id` (= `studentDocId`, the
 * key for PAT/GPLT/CSP scores after the 2026-06-07 re-key). Returns null if the
 * user has no bound student record — score conditions are then simply unmet
 * (we can't know an unbound user's competition score). See docs/PLAN-2026-06-07.
 */
async function scoreStudentDocId(ctx: TaskCheckerContext): Promise<ObjectId | null> {
    const student = await userBindModel.findStudentByUserId(ctx.domainId, ctx.userId);
    return student?._id ?? null;
}

// ============ base 8 presets ============

const acCountPreset: TaskPointPreset = {
    id: 'ac_count',
    name: 'AC 题目数量',
    category: 'behavior',
    description: '统计用户在 OJ 上独立 AC 的题目数量是否达到指定值',
    params: [
        { name: 'count', type: 'number', label: '需要 AC 的题目数', default: 10, required: true },
        ...dateRangeParams(),
    ],
    async checker(ctx, params) {
        const query: any = { domainId: ctx.domainId, uid: ctx.userId, status: STATUS.STATUS_ACCEPTED };
        const idRange = dateRangeQuery(params.startDate, params.endDate);
        if (Object.keys(idRange).length) query._id = idRange;
        const pids = await RecordModel.coll.distinct('pid', query);
        const target = +params.count || 0;
        return pct(pids.length, target, pids.length >= target, `已 AC ${pids.length}/${target} 题`);
    },
};

const submitCountPreset: TaskPointPreset = {
    id: 'submit_count',
    name: '提交次数',
    category: 'behavior',
    description: '用户提交代码的总次数达到指定值',
    params: [
        { name: 'count', type: 'number', label: '需要提交次数', default: 50, required: true },
        ...dateRangeParams(),
    ],
    async checker(ctx, params) {
        const query: any = { domainId: ctx.domainId, uid: ctx.userId };
        const idRange = dateRangeQuery(params.startDate, params.endDate);
        if (Object.keys(idRange).length) query._id = idRange;
        const current = await RecordModel.coll.countDocuments(query);
        const target = +params.count || 0;
        return pct(current, target, current >= target, `已提交 ${current}/${target} 次`);
    },
};

const contestParticipatePreset: TaskPointPreset = {
    id: 'contest_participate',
    name: '参加比赛次数',
    category: 'behavior',
    description: '用户参加过的比赛数量达到指定值',
    params: [
        { name: 'count', type: 'number', label: '需要参加的比赛场数', default: 3, required: true },
        ...dateRangeParams(),
    ],
    async checker(ctx, params) {
        const attended = await DocumentModel.collStatus.find({
            domainId: ctx.domainId,
            uid: ctx.userId,
            docType: DocumentModel.TYPE_CONTEST,
            attend: 1,
        }).toArray();
        let count = attended.length;
        if (hasDateValue(params.startDate) || hasDateValue(params.endDate)) {
            const ids = attended.map((a: any) => a.docId);
            const contests = await DocumentModel.coll.find({
                domainId: ctx.domainId,
                docType: DocumentModel.TYPE_CONTEST,
                docId: { $in: ids },
            }).toArray();
            const startT = dateBoundaryMs(params.startDate, 'start') ?? -Infinity;
            const endT = dateBoundaryMs(params.endDate, 'end') ?? Infinity;
            count = contests.filter((c: any) => {
                const t = c.beginAt?.getTime() || 0;
                return t >= startT && t <= endT;
            }).length;
        }
        const target = +params.count || 0;
        return pct(count, target, count >= target, `已参加 ${count}/${target} 场`);
    },
};

const specificContestPreset: TaskPointPreset = {
    id: 'specific_contest',
    name: '参加特定比赛',
    category: 'behavior',
    description: '用户参加了管理员指定的某场比赛，并在该比赛中至少提交过一次',
    params: [
        { name: 'contestId', type: 'contest', label: '比赛', required: true },
    ],
    async checker(ctx, params) {
        if (!params.contestId) return pct(0, 1, false, '未配置比赛');
        const id = typeof params.contestId === 'string' ? new ObjectId(params.contestId) : params.contestId;
        const tsdoc = await DocumentModel.collStatus.findOne({
            domainId: ctx.domainId,
            uid: ctx.userId,
            docType: DocumentModel.TYPE_CONTEST,
            docId: id,
            attend: 1,
        });
        if (!tsdoc) return pct(0, 1, false, '未参加该比赛');
        const submitted = await RecordModel.coll.findOne({
            domainId: ctx.domainId,
            uid: ctx.userId,
            contest: id,
            status: { $ne: STATUS.STATUS_CANCELED },
        }, { projection: { _id: 1 } });
        return pct(
            submitted ? 1 : 0, 1, !!submitted,
            submitted ? '已参加该比赛且已有提交' : '已参加该比赛，但暂无有效提交',
        );
    },
};

/**
 * Generic comparator from a Mongo-style statusSort object (e.g. acm
 * `{accept:-1, time:1}`, oi `{score:-1}`). Negative = `a` ranks before `b`.
 */
function compareByStatusSort(a: any, b: any, statusSort: Record<string, number>): number {
    for (const k of Object.keys(statusSort || {})) {
        const dir = statusSort[k] < 0 ? -1 : 1;
        const av = a[k] ?? 0;
        const bv = b[k] ?? 0;
        if (av !== bv) return (av < bv ? -1 : 1) * dir;
    }
    return 0;
}

/**
 * Compute a user's LIVE rank in a contest.
 *
 * Hydro does NOT persist `rank`/`score` on the contest status doc — the
 * scoreboard derives them on the fly from each contestant's journal via the
 * rule's `stat()` + `statusSort`. So rank presets must compute the rank the
 * same way; reading `tsdoc.rank` (the old impl) always saw `undefined` and
 * failed for everyone. We replay every attendee's journal through the contest
 * rule's own `stat()` (penalty / lock / subtask logic identical to the
 * scoreboard), sort by the rule's `statusSort`, and return the competition
 * rank (ties share a rank: rank = 1 + #strictly-better).
 *
 * Returns null if the contest is missing; `{attended:false}` when the user has
 * no attend record; otherwise `{attended:true, rank, total}`.
 */
async function contestUserRank(
    ctx: TaskCheckerContext, contestId: any,
): Promise<{ attended: boolean; rank: number; total: number } | null> {
    const id = typeof contestId === 'string' ? new ObjectId(contestId) : contestId;
    let tdoc: any;
    try {
        tdoc = await ContestModel.get(ctx.domainId, id);
    } catch {
        return null;
    }
    const rule = tdoc ? (ContestModel as any).RULES?.[tdoc.rule] : null;
    if (!tdoc || !rule?.stat) return null;
    const statuses = await DocumentModel.collStatus.find({
        domainId: ctx.domainId,
        docType: DocumentModel.TYPE_CONTEST,
        docId: id,
        attend: 1,
    }).toArray();
    const rows = statuses.map((ts: any) => {
        const journal = [...(ts.journal || [])].sort(
            (a: any, b: any) => a.rid.getTimestamp().getTime() - b.rid.getTimestamp().getTime(),
        );
        let s: any = {};
        try { s = rule.stat(tdoc, journal); } catch { s = {}; }
        return { uid: ts.uid, ...s };
    });
    const me = rows.find((r) => r.uid === ctx.userId);
    if (!me) return { attended: false, rank: 0, total: rows.length };
    const ss = rule.statusSort || { accept: -1, time: 1 };
    const rank = 1 + rows.filter((r) => compareByStatusSort(r, me, ss) < 0).length;
    return { attended: true, rank, total: rows.length };
}

const contestRankPreset: TaskPointPreset = {
    id: 'contest_rank',
    name: '比赛排名',
    category: 'behavior',
    description: '用户在指定比赛中获得指定排名以内',
    params: [
        { name: 'contestId', type: 'contest', label: '比赛', required: true },
        { name: 'rank', type: 'number', label: '最低排名（不超过）', default: 10, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.rank || 1;
        if (!params.contestId) return pct(0, target, false, '未配置比赛');
        const r = await contestUserRank(ctx, params.contestId);
        if (!r) return pct(0, target, false, '比赛不存在');
        if (!r.attended) return pct(0, target, false, '未参加该比赛');
        return pct(r.rank, target, r.rank <= target, `当前排名 ${r.rank}/${r.total}，目标 ≤ ${target}`);
    },
};

const contestRankTopNPreset: TaskPointPreset = {
    id: 'contest_rank_top_n',
    name: '指定比赛排名前 N 名',
    category: 'behavior',
    description: '用户在指定比赛中的排名进入前 N 名以内（含第 N 名）',
    params: [
        { name: 'contestId', type: 'contest', label: '比赛', required: true },
        { name: 'topN', type: 'number', label: '前 N 名（含）', default: 10, required: true },
    ],
    async checker(ctx, params) {
        if (!params.contestId) return pct(0, 1, false, '未配置比赛');
        const target = Math.max(1, +params.topN || 1);
        const r = await contestUserRank(ctx, params.contestId);
        if (!r) return pct(0, 1, false, '比赛不存在');
        if (!r.attended) return pct(0, 1, false, '未参加该比赛');
        const ok = r.rank <= target;
        return pct(ok ? 1 : 0, 1, ok, `当前第 ${r.rank}/${r.total} 名（目标前 ${target} 名）`);
    },
};

/**
 * Top-percent variant. Needs the contest's total ranked-participant count to
 * convert the user's absolute rank into a percentile. We count attendees with
 * `rank > 0` (rank=0 means "no ranking emitted yet" for that scoreboard).
 */
const contestRankTopPercentPreset: TaskPointPreset = {
    id: 'contest_rank_top_percent',
    name: '指定比赛排名前 X%',
    category: 'behavior',
    description: '用户在指定比赛中的排名进入前 X%（按已出排名的参赛者总数计）',
    params: [
        { name: 'contestId', type: 'contest', label: '比赛', required: true },
        { name: 'percent', type: 'number', label: '前百分比 (0-100)', default: 10, required: true },
    ],
    async checker(ctx, params) {
        if (!params.contestId) return pct(0, 1, false, '未配置比赛');
        const targetPct = Math.max(0, Math.min(100, +params.percent || 0));
        const r = await contestUserRank(ctx, params.contestId);
        if (!r) return pct(0, 1, false, '比赛不存在');
        if (!r.attended) return pct(0, 1, false, '未参加该比赛');
        if (!r.total) return pct(0, 1, false, '比赛尚无参赛数据');
        const userPct = (r.rank / r.total) * 100;
        const ok = userPct <= targetPct;
        return pct(
            ok ? 1 : 0, 1, ok,
            `排名 ${r.rank}/${r.total}（位列前 ${userPct.toFixed(1)}% / 目标 ≤ ${targetPct}%）`,
        );
    },
};

const specificProblemPreset: TaskPointPreset = {
    id: 'specific_problem',
    name: 'AC 指定题目',
    category: 'behavior',
    description: '用户通过了管理员指定的某道题目',
    params: [
        { name: 'problemId', type: 'problem', label: '题目', required: true },
    ],
    async checker(ctx, params) {
        if (!params.problemId) return pct(0, 1, false, '未配置题目');
        const pid = +params.problemId;
        const psdoc = await DocumentModel.collStatus.findOne({
            domainId: ctx.domainId,
            uid: ctx.userId,
            docType: DocumentModel.TYPE_PROBLEM,
            docId: pid,
            status: STATUS.STATUS_ACCEPTED,
        });
        return pct(psdoc ? 1 : 0, 1, !!psdoc, psdoc ? '已 AC 该题' : '未 AC 该题');
    },
};

const continuousCheckinPreset: TaskPointPreset = {
    id: 'continuous_checkin',
    name: '连续活跃天数',
    category: 'behavior',
    description: '用户连续提交代码的天数达到指定值（任意题目均算）',
    params: [
        { name: 'days', type: 'number', label: '需要连续活跃天数', default: 7, required: true },
    ],
    async checker(ctx, params) {
        const records = await RecordModel.coll.find({ domainId: ctx.domainId, uid: ctx.userId })
            .sort({ _id: -1 }).limit(2000).project({ _id: 1 }).toArray();
        const target = +params.days || 0;
        if (!records.length) return pct(0, target, false, '暂无提交记录');
        const days = new Set<string>();
        for (const r of records) days.add(r._id.getTimestamp().toISOString().slice(0, 10));
        const sorted = Array.from(days).sort();
        let best = 1, cur = 1;
        for (let i = 1; i < sorted.length; i++) {
            const prev = new Date(sorted[i - 1]).getTime();
            const here = new Date(sorted[i]).getTime();
            const diffDays = Math.round((here - prev) / 86400000);
            if (diffDays === 1) {
                cur++;
                best = Math.max(best, cur);
            } else cur = 1;
        }
        return pct(best, target, best >= target, `最长连续 ${best} 天`);
    },
};

const totalScorePreset: TaskPointPreset = {
    id: 'total_score',
    name: '累计得分',
    category: 'behavior',
    description: '用户在 OJ 上累计获得的分数总和达到指定值',
    params: [
        { name: 'score', type: 'number', label: '需要达到的总分', default: 500, required: true },
        ...dateRangeParams(),
    ],
    async checker(ctx, params) {
        const query: any = { domainId: ctx.domainId, uid: ctx.userId, score: { $gt: 0 } };
        const idRange = dateRangeQuery(params.startDate, params.endDate);
        if (Object.keys(idRange).length) query._id = idRange;
        const recs = await RecordModel.coll.find(query).project({ score: 1 }).toArray();
        const total = recs.reduce((s, r) => s + (r.score || 0), 0);
        const target = +params.score || 0;
        return pct(total, target, total >= target, `累计 ${total}/${target} 分`);
    },
};

const basePresets: TaskPointPreset[] = [
    acCountPreset,
    submitCountPreset,
    contestParticipatePreset,
    specificContestPreset,
    contestRankPreset,
    contestRankTopNPreset,
    contestRankTopPercentPreset,
    specificProblemPreset,
    continuousCheckinPreset,
    totalScorePreset,
];

// ============ Krypton-specific presets ============

const examFinalizedPreset: TaskPointPreset = {
    id: 'exam_finalized',
    name: '完成指定 exam（已最终提交）',
    category: 'behavior',
    description: '用户最终提交了指定的 exam-rule 比赛',
    params: [
        { name: 'contestId', type: 'contest', label: 'Exam 比赛', required: true, helper: '仅支持 rule=exam 的比赛' },
    ],
    async checker(ctx, params) {
        if (!params.contestId) return pct(0, 1, false, '未配置 exam');
        const id = typeof params.contestId === 'string' ? new ObjectId(params.contestId) : params.contestId;
        // exam-rule contests track finalize via paper_draft.finalized — but the simplest
        // cross-rule heuristic is journal+attended. We accept either signal.
        const tsdoc = await DocumentModel.collStatus.findOne({
            domainId: ctx.domainId,
            uid: ctx.userId,
            docType: DocumentModel.TYPE_CONTEST,
            docId: id,
        });
        const finalized = !!(tsdoc?.attend && (tsdoc as any).finalized);
        const journalSubmitted = !!(tsdoc?.attend && tsdoc.journal && tsdoc.journal.length);
        const done = finalized || journalSubmitted;
        return pct(done ? 1 : 0, 1, done, done ? '已最终提交' : '未最终提交');
    },
};

const groupMembershipPreset: TaskPointPreset = {
    id: 'group_membership',
    name: '属于指定 user_group / school',
    category: 'condition',
    description: '用户当前是指定 user_group 或 school 的成员',
    params: [
        { name: 'scope', type: 'select', label: '范围', required: true, default: 'user_group',
          options: [{ value: 'user_group', label: 'User Group' }, { value: 'school', label: 'School' }] },
        { name: 'targetId', type: 'user_group', label: '目标', required: true, helper: '根据范围切换 picker 的来源' },
    ],
    async checker(ctx, params) {
        if (!params.targetId) return pct(0, 1, false, '未配置目标');
        const id = typeof params.targetId === 'string' ? new ObjectId(params.targetId) : params.targetId;
        const student = await userBindModel.findStudentByUserId(ctx.domainId, ctx.userId);
        if (!student) return pct(0, 1, false, '未绑定学生身份');
        if (params.scope === 'school') {
            const ok = student.schoolId.equals(id);
            if (ok) {
                const school = await userBindModel.getSchool(ctx.domainId, id);
                return pct(1, 1, true, `属于 ${school?.name || '该学校'}`);
            }
            return pct(0, 1, false, '不属于该学校');
        }
        const ok = (student.groupIds || []).some((g) => g.equals(id));
        if (ok) {
            const g = await userBindModel.getUserGroup(ctx.domainId, id);
            return pct(1, 1, true, `属于 ${g?.name || '该用户组'}`);
        }
        return pct(0, 1, false, '不属于该用户组');
    },
};

const homeworkProgressPreset: TaskPointPreset = {
    id: 'homework_progress',
    name: '完成 homework 进度',
    category: 'behavior',
    description: '用户在 homework 中 AC 的题目占比达到指定百分比',
    params: [
        { name: 'homeworkId', type: 'homework', label: 'Homework', required: true },
        { name: 'percent', type: 'number', label: '完成百分比（0-100）', default: 100, required: true },
    ],
    async checker(ctx, params) {
        if (!params.homeworkId) return pct(0, 100, false, '未配置 homework');
        const id = typeof params.homeworkId === 'string' ? new ObjectId(params.homeworkId) : params.homeworkId;
        const hw = await ContestModel.get(ctx.domainId, id);
        if (!hw) return pct(0, 100, false, 'Homework 不存在');
        const total = hw.pids?.length || 0;
        if (!total) return pct(0, 100, false, '此 homework 没有题目');
        const tsdoc = await DocumentModel.collStatus.findOne({
            domainId: ctx.domainId,
            uid: ctx.userId,
            docType: DocumentModel.TYPE_CONTEST,
            docId: id,
        });
        const detail = tsdoc?.detail || {};
        const accepted = Object.values(detail).filter((d: any) => d?.status === STATUS.STATUS_ACCEPTED).length;
        const target = Math.max(0, Math.min(100, +params.percent || 0));
        const got = Math.round((accepted / total) * 100);
        return pct(got, target, got >= target, `${accepted}/${total} 道（${got}% / ${target}%）`);
    },
};

const trainingProgressPreset: TaskPointPreset = {
    id: 'training_progress',
    name: '完成 training 进度',
    category: 'behavior',
    description: '用户在 training 课程中完成的阶段数达到指定值',
    params: [
        { name: 'trainingId', type: 'training', label: 'Training', required: true },
        { name: 'stages', type: 'number', label: '需要完成的阶段数（留空=全部）', required: false },
    ],
    async checker(ctx, params) {
        if (!params.trainingId) return pct(0, 1, false, '未配置 training');
        const id = typeof params.trainingId === 'string' ? new ObjectId(params.trainingId) : params.trainingId;
        const tdoc = await DocumentModel.coll.findOne({
            domainId: ctx.domainId,
            docType: DocumentModel.TYPE_TRAINING,
            docId: id,
        });
        if (!tdoc) return pct(0, 1, false, 'Training 不存在');
        const totalStages = (tdoc as any).dag?.length || 0;
        const target = params.stages == null || params.stages === '' ? totalStages : +params.stages;
        const tsdoc = await DocumentModel.collStatus.findOne({
            domainId: ctx.domainId,
            uid: ctx.userId,
            docType: DocumentModel.TYPE_TRAINING,
            docId: id,
        });
        const enrolled = (tsdoc as any)?.enroll === 1;
        const doneStages = (tsdoc as any)?.done?.length || 0;
        const detail = enrolled ? `已完成 ${doneStages}/${totalStages} 阶段` : '尚未加入此 training';
        return pct(doneStages, target, doneStages >= target, detail);
    },
};

/**
 * Manual-confirm placeholder. Checker always returns `completed: false` —
 * admin must use the override mechanism (overridePointCompletion) to mark
 * it done. Use for events with no automatic signal: on-site sign-in,
 * physical attendance, oral defense pass, etc. Every override writes an
 * audit row so the action is traceable.
 */
const manualConfirmPreset: TaskPointPreset = {
    id: 'manual_confirm',
    name: '管理员手动确认',
    category: 'behavior',
    description: '需要管理员手动判定为完成（点击任务点旁的"判定完成"按钮）。适用于现场签到、面试、留校报到等无法自动判定的事件。',
    params: [],
    async checker(_ctx, _params) {
        return pct(0, 1, false, '等待管理员手动判定');
    },
};

/**
 * Lifetime stay-count threshold. Counts all `tasks.stay_events` rows for
 * the user (regardless of year or source). Used by rules like "已留校过
 * 一次方可参加测试赛".
 */
const stayCountTotalPreset: TaskPointPreset = {
    id: 'stay_count_total',
    name: '历史留校次数达标',
    category: 'behavior',
    description: '用户历史留校次数（手动录入 + 任务自动 +1 汇总）达到指定值',
    params: [
        { name: 'count', type: 'number', label: '所需留校次数', default: 1, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.count || 0;
        const current = await stayEventsColl.countDocuments({
            domainId: ctx.domainId,
            userId: ctx.userId,
        });
        return pct(current, target, current >= target, `已留校 ${current}/${target} 次`);
    },
};

// ─── New condition presets (grilled 2026-05-25) ─────────────────────────────
//
// These are pure attribute checks against the user's bound StudentRecord.
// Unlike behavior presets they don't read submissions — they answer "is this
// person currently in <group>?" In the graph editor they live in the
// 「条件型」 toolbox group so admins instantly know they don't ask users to
// "do" anything; they gate path branches by who the user is.

const enrollmentYearPreset: TaskPointPreset = {
    id: 'enrollment_year',
    name: '入学年份属于',
    category: 'condition',
    description: '用户绑定的学生档案 enrollmentYear 属于指定的年份集合（用于按年级分支）',
    params: [
        {
            name: 'years',
            type: 'years',
            label: '允许的入学年份',
            required: true,
            helper: '多个年份用逗号或空格分隔，例如「2023 2024」',
        },
    ],
    async checker(ctx, params) {
        const years = Array.isArray(params.years)
            ? (params.years as any[]).map((y) => +y).filter((y) => Number.isInteger(y))
            : [];
        if (!years.length) return pct(0, 1, false, '未配置年份');
        const student = await userBindModel.findStudentByUserId(ctx.domainId, ctx.userId);
        if (!student) return pct(0, 1, false, '未绑定学生身份');
        const y = student.enrollmentYear;
        if (y == null) return pct(0, 1, false, '档案缺失入学年份');
        const ok = years.includes(y);
        return pct(ok ? 1 : 0, 1, ok, ok ? `${y} 级 ✓` : `${y} 级 (需 ${years.join('/')} 级)`);
    },
};

const boundToUserbindPreset: TaskPointPreset = {
    id: 'bound_to_userbind',
    name: '已绑定学生身份',
    category: 'condition',
    description: '用户 OJ 账号已绑定 userbind 学生档案（通过 invite-token 或 admin 手动绑定）',
    params: [],
    async checker(ctx, _params) {
        const student = await userBindModel.findStudentByUserId(ctx.domainId, ctx.userId);
        const ok = !!student;
        return pct(ok ? 1 : 0, 1, ok, ok ? '已绑定 ✓' : '未绑定学生身份');
    },
};

const kryptonPresets: TaskPointPreset[] = [
    examFinalizedPreset,
    groupMembershipPreset,
    homeworkProgressPreset,
    trainingProgressPreset,
    manualConfirmPreset,
    stayCountTotalPreset,
    enrollmentYearPreset,
    boundToUserbindPreset,
];

// ============ Score presets (PAT / GPLT / CSP) ============

const PAT_SEASONS: TaskPointParamSchema['options'] = [
    { value: 'spring', label: '春季' },
    { value: 'summer', label: '夏季' },
    { value: 'autumn', label: '秋季' },
    { value: 'winter', label: '冬季' },
];

const PAT_LEVELS: TaskPointParamSchema['options'] = [
    { value: 'advanced', label: '甲级' },
    { value: 'basic', label: '乙级' },
];

const GPLT_LEVELS: TaskPointParamSchema['options'] = [
    { value: 'school', label: '校赛' },
    { value: 'national', label: '国赛' },
];

const patSpecificPreset: TaskPointPreset = {
    id: 'pat_specific_exam',
    name: 'PAT 指定考试达标',
    category: 'behavior',
    description: '用户在指定的 PAT 考试中达到指定分数',
    params: [
        { name: 'level', type: 'pat_level', label: '等级', default: 'advanced', required: true, options: PAT_LEVELS },
        { name: 'year', type: 'number', label: '年份', default: new Date().getFullYear(), required: true },
        { name: 'season', type: 'pat_season', label: '季节', default: 'winter', required: true, options: PAT_SEASONS },
        { name: 'minScore', type: 'number', label: '最低分数', default: 60, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.minScore || 0;
        const studentDocId = await scoreStudentDocId(ctx);
        if (!studentDocId) return pct(0, target, false, '未绑定学生档案');
        const doc = await patScoreColl.findOne({
            domainId: ctx.domainId,
            studentDocId,
            level: params.level,
            year: +params.year,
            season: params.season,
        });
        if (!doc) return pct(0, target, false, '未参加该次考试');
        return pct(doc.score, target, doc.score >= target, `本次得分 ${doc.score}（需 ≥ ${target}）`);
    },
};

const patAnyPreset: TaskPointPreset = {
    id: 'pat_any_score',
    name: 'PAT 任意场次达标',
    category: 'behavior',
    description: '用户在任意一次 PAT 考试中达到指定分数即可',
    params: [
        { name: 'level', type: 'pat_level', label: '等级', default: 'advanced', required: true, options: PAT_LEVELS },
        { name: 'minScore', type: 'number', label: '最低分数', default: 60, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.minScore || 0;
        const studentDocId = await scoreStudentDocId(ctx);
        if (!studentDocId) return pct(0, target, false, '未绑定学生档案');
        const best = await patScoreColl.find({
            domainId: ctx.domainId,
            studentDocId,
            level: params.level,
        }).sort({ score: -1 }).limit(1).next();
        if (!best) return pct(0, target, false, '暂无 PAT 成绩');
        return pct(best.score, target, best.score >= target,
            `最佳: ${best.year} ${best.season} ${best.score} 分`);
    },
};

const gpltSpecificPreset: TaskPointPreset = {
    id: 'gplt_specific_year',
    name: '天梯赛指定年份达标',
    category: 'behavior',
    description: '用户在指定年份的天梯赛中达到指定分数',
    params: [
        { name: 'level', type: 'gplt_level', label: '比赛级别', default: 'school', required: true, options: GPLT_LEVELS },
        { name: 'year', type: 'number', label: '年份', default: new Date().getFullYear(), required: true },
        { name: 'minScore', type: 'number', label: '最低分数', default: 100, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.minScore || 0;
        const studentDocId = await scoreStudentDocId(ctx);
        if (!studentDocId) return pct(0, target, false, '未绑定学生档案');
        const doc = await gpltScoreColl.findOne({
            domainId: ctx.domainId,
            studentDocId,
            level: params.level,
            year: +params.year,
        });
        if (!doc) return pct(0, target, false, '未参加该年比赛');
        return pct(doc.score, target, doc.score >= target, `本次得分 ${doc.score}（需 ≥ ${target}）`);
    },
};

const gpltAnyPreset: TaskPointPreset = {
    id: 'gplt_any_score',
    name: '天梯赛任意年份达标',
    category: 'behavior',
    description: '用户在任意一年的天梯赛中达到指定分数即可',
    params: [
        { name: 'level', type: 'gplt_level', label: '比赛级别', default: 'school', required: true, options: GPLT_LEVELS },
        { name: 'minScore', type: 'number', label: '最低分数', default: 100, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.minScore || 0;
        const studentDocId = await scoreStudentDocId(ctx);
        if (!studentDocId) return pct(0, target, false, '未绑定学生档案');
        const best = await gpltScoreColl.find({
            domainId: ctx.domainId,
            studentDocId,
            level: params.level,
        }).sort({ score: -1 }).limit(1).next();
        if (!best) return pct(0, target, false, '暂无成绩');
        return pct(best.score, target, best.score >= target, `最佳: ${best.year} ${best.score} 分`);
    },
};

const cspSpecificPreset: TaskPointPreset = {
    id: 'csp_specific_round',
    name: 'CSP 指定次数达标',
    category: 'behavior',
    description: '用户在指定次 CSP 认证中达到指定分数',
    params: [
        { name: 'round', type: 'number', label: '认证次数（第几次）', default: 37, required: true },
        { name: 'minScore', type: 'number', label: '最低分数', default: 200, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.minScore || 0;
        const studentDocId = await scoreStudentDocId(ctx);
        if (!studentDocId) return pct(0, target, false, '未绑定学生档案');
        const doc = await cspScoreColl.findOne({
            domainId: ctx.domainId,
            studentDocId,
            round: +params.round,
        });
        if (!doc) return pct(0, target, false, '未参加该次认证');
        return pct(doc.score, target, doc.score >= target, `本次得分 ${doc.score}（需 ≥ ${target}）`);
    },
};

const cspAnyPreset: TaskPointPreset = {
    id: 'csp_any_score',
    name: 'CSP 任意次数达标',
    category: 'behavior',
    description: '用户在任意一次 CSP 认证中达到指定分数即可',
    params: [
        { name: 'minScore', type: 'number', label: '最低分数', default: 200, required: true },
    ],
    async checker(ctx, params) {
        const target = +params.minScore || 0;
        const studentDocId = await scoreStudentDocId(ctx);
        if (!studentDocId) return pct(0, target, false, '未绑定学生档案');
        const best = await cspScoreColl.find({
            domainId: ctx.domainId,
            studentDocId,
        }).sort({ score: -1 }).limit(1).next();
        if (!best) return pct(0, target, false, '暂无成绩');
        return pct(best.score, target, best.score >= target, `最佳: 第 ${best.round} 次 ${best.score} 分`);
    },
};

const scorePresets: TaskPointPreset[] = [
    patSpecificPreset,
    patAnyPreset,
    gpltSpecificPreset,
    gpltAnyPreset,
    cspSpecificPreset,
    cspAnyPreset,
];

// ============ exported registry ============

export const taskPointPresets: Record<string, TaskPointPreset> = Object.fromEntries(
    [...basePresets, ...kryptonPresets, ...scorePresets].map((p) => [p.id, p]),
);

/** Public summary (no checkers) — used by frontend to render the toolbox. */
export function presetSummaries(): Array<Omit<TaskPointPreset, 'checker'>> {
    return Object.values(taskPointPresets).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        params: p.params,
    }));
}

/** Run a single preset's checker. */
export async function runChecker(
    presetId: string,
    ctx: TaskCheckerContext,
    params: Record<string, any>,
): Promise<TaskPointResult> {
    const preset = taskPointPresets[presetId];
    if (!preset) {
        return { completed: false, current: 0, target: 0, details: `未知任务点类型: ${presetId}` };
    }
    try {
        const effectiveParams = { ...(params || {}) };
        if (!hasDateValue(effectiveParams.startDate) && ctx.startDate) effectiveParams.startDate = ctx.startDate;
        if (!hasDateValue(effectiveParams.endDate) && ctx.endDate) effectiveParams.endDate = ctx.endDate;
        return await preset.checker(ctx, effectiveParams);
    } catch (e: any) {
        return { completed: false, current: 0, target: 0, details: `校验错误: ${e?.message || e}` };
    }
}
