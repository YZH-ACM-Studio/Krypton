/**
 * HTTP handlers + route registration for krypton-tasks.
 *
 * Routes (templates are consumed by ui-next/src/pages/resolver.tsx):
 *   GET  /tasks                       tasks_center.html
 *   GET  /tasks/my                    tasks_my.html
 *   GET  /tasks/:tid                  tasks_detail.html
 *   POST /tasks/:tid/claim
 *   POST /tasks/assignments/:aid/cancel
 *   POST /tasks/assignments/:aid/recheck
 *
 *   GET  /admin/tasks                 admin_tasks.html
 *   POST /admin/tasks                 (create)
 *   GET  /admin/tasks/create          admin_tasks_edit.html  (empty form)
 *   GET  /admin/tasks/:tid/edit       admin_tasks_edit.html
 *   POST /admin/tasks/:tid/edit
 *   POST /admin/tasks/:tid/delete
 *   POST /admin/tasks/:tid/clone
 *   GET  /admin/tasks/:tid/assign     admin_tasks_assign.html
 *   POST /admin/tasks/:tid/assign     (single uid or group/school bulk)
 *   POST /admin/tasks/:tid/override   (toggle one point's completed flag)
 *   GET  /admin/tasks/:tid/stats      admin_tasks_stats.html (with CSV export ?format=csv)
 *
 *   GET  /admin/tasks/scores          admin_tasks_scores.html (tabbed)
 *   POST /admin/tasks/scores/pat      (add/update)
 *   POST /admin/tasks/scores/pat/import
 *   POST /admin/tasks/scores/pat/delete
 *   (… same for gplt, csp)
 *   GET  /admin/tasks/settings        admin_tasks_settings.html
 *   POST /admin/tasks/settings
 */
import {
    Context, Handler, NotFoundError, ObjectId, OplogModel, param, PERM, PRIV,
    Types, UserModel, ValidationError,
} from 'hydrooj';
import { userBindModel } from '@hydrooj/krypton-userbind';
import { canCreateTask, canManageAllTasks, canModifyTask } from './auth';
import {
    cspScoreColl, gpltScoreColl, patScoreColl,
} from './db';
import { taskModel } from './model';
import { presetSummaries } from './presets';
import type {
    CspScoreDoc, GpltLevel, GpltScoreDoc, PatLevel, PatScoreDoc, PatSeason,
    TaskAccess, TaskCondition, TaskDoc, TaskPoint,
} from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseTaskPointsJson(json: string): TaskPoint[] {
    if (!json) return [];
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { throw new ValidationError('points', null, 'JSON 格式错误'); }
    if (!Array.isArray(parsed)) throw new ValidationError('points', null, '必须是数组');
    return parsed.map((p: any, i: number) => {
        if (!p?.presetId) throw new ValidationError('points', null, `第 ${i + 1} 项缺少 presetId`);
        return {
            id: p.id || `p${i}_${Math.random().toString(36).slice(2, 8)}`,
            presetId: String(p.presetId),
            name: String(p.name || p.presetId),
            params: p.params && typeof p.params === 'object' ? p.params : {},
        };
    });
}

function parseTaskConditionJson(json: string): TaskCondition {
    if (!json) return { type: 'all' };
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { throw new ValidationError('condition', null, 'JSON 格式错误'); }
    if (parsed?.type === 'groups' && Array.isArray(parsed.groups)) {
        return {
            type: 'groups',
            groups: parsed.groups.map((g: any) => ({
                points: Array.isArray(g.points) ? g.points.map(String) : [],
                require: Math.max(1, +g.require || 1),
            })),
        };
    }
    return { type: 'all' };
}

function parseTaskAccessJson(json: string): TaskAccess {
    if (!json) return { type: 'public' };
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { return { type: 'public' }; }
    if (parsed?.type === 'user_group' && parsed.targetId) {
        return { type: 'user_group', targetId: new ObjectId(String(parsed.targetId)) };
    }
    if (parsed?.type === 'school' && parsed.targetId) {
        return { type: 'school', targetId: new ObjectId(String(parsed.targetId)) };
    }
    return { type: 'public' };
}

function parseTagsCsv(csv?: string): string[] {
    if (!csv) return [];
    return csv.split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 16);
}

async function visibleTasksForUser(
    domainId: string,
    user: { _id: number; hasPerm(p: bigint): boolean; hasPriv(p: number): boolean },
): Promise<TaskDoc[]> {
    const isAdmin = canManageAllTasks(user);
    const baseFilter: any = isAdmin ? {} : { isActive: true };
    const all = await taskModel.listTasks(domainId, baseFilter, 1, 500);
    if (isAdmin) return all.docs;
    // Filter by access.
    const memberSchoolIds = new Set<string>();
    const memberGroupIds = new Set<string>();
    const student = await userBindModel.findStudentByUserId(domainId, user._id);
    if (student) {
        memberSchoolIds.add(student.schoolId.toHexString());
        for (const g of student.groupIds || []) memberGroupIds.add(g.toHexString());
    }
    return all.docs.filter((t) => {
        if (t.access.type === 'public') return true;
        if (t.access.type === 'school') return memberSchoolIds.has(t.access.targetId.toHexString());
        if (t.access.type === 'user_group') return memberGroupIds.has(t.access.targetId.toHexString());
        return false;
    });
}

async function loadAssignmentMap(
    domainId: string,
    userId: number,
): Promise<Record<string, { _id: ObjectId; status: string; canCancel: boolean }>> {
    const list = await taskModel.getUserAssignments(domainId, userId, { status: { $ne: 'cancelled' } });
    const out: Record<string, any> = {};
    for (const a of list) out[a.taskId.toHexString()] = {
        _id: a._id, status: a.status, canCancel: a.canCancel,
    };
    return out;
}

// ─── User-facing handlers ─────────────────────────────────────────────────

class TaskCenterHandler extends Handler {
    async get({ domainId }: { domainId: string }) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const visible = await visibleTasksForUser(domainId, this.user as any);
        const assignmentMap = await loadAssignmentMap(domainId, this.user._id);
        this.response.template = 'tasks_center.html';
        this.response.body = {
            tasks: visible,
            assignmentMap,
            canManage: canManageAllTasks(this.user as any),
        };
    }
}

class TaskMyHandler extends Handler {
    async get({ domainId }: { domainId: string }) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const assignments = await taskModel.getUserAssignments(domainId, this.user._id);
        // Light recompute on view for pending ones whose progress is stale.
        for (const a of assignments) {
            if (a.status === 'pending' && a.progressUpdatedAt === null) {
                try {
                    await taskModel.checkTaskCompletion(domainId, a._id);
                } catch { /* swallow per-row */ }
            }
        }
        const fresh = await taskModel.getUserAssignments(domainId, this.user._id);
        const taskIds = Array.from(new Set(fresh.map((a) => a.taskId.toHexString())));
        const tasks: Record<string, TaskDoc> = {};
        for (const idHex of taskIds) {
            const t = await taskModel.getTask(domainId, new ObjectId(idHex));
            if (t) tasks[idHex] = t;
        }
        this.response.template = 'tasks_my.html';
        this.response.body = {
            assignments: fresh,
            tasks,
            canManage: canManageAllTasks(this.user as any),
        };
    }
}

class TaskDetailHandler extends Handler {
    @param('tid', Types.ObjectId)
    async get({ domainId }: { domainId: string }, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        // Recompute current user's progress if any.
        const myAssignment = await taskModel.getUserAssignments(domainId, this.user._id, {
            taskId: tid, status: { $ne: 'cancelled' },
        }).then((rs) => rs[0]);
        let progress: any = {};
        if (myAssignment) {
            const r = await taskModel.checkTaskCompletion(domainId, myAssignment._id);
            progress = r.progress;
        }
        const creator = await UserModel.getById(domainId, task.createdBy);
        const assignmentCount = (await taskModel.getTaskAssignments(domainId, tid, {
            status: { $ne: 'cancelled' },
        })).length;
        this.response.template = 'tasks_detail.html';
        this.response.body = {
            task,
            assignment: myAssignment ? await taskModel.getAssignment(domainId, myAssignment._id) : null,
            progress,
            creatorName: creator?.uname || '系统',
            assignmentCount,
            presets: presetSummaries(),
            canManage: canModifyTask(this.user as any, task),
        };
    }

    @param('tid', Types.ObjectId)
    async postClaim({ domainId }: { domainId: string }, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        // Re-check visibility before allowing claim.
        const visible = await visibleTasksForUser(domainId, this.user as any);
        if (!visible.find((t) => t._id.equals(tid))) {
            throw new ValidationError('tid', null, '无权认领此任务');
        }
        if (!task.isActive) throw new ValidationError('tid', null, '任务已停用');
        if (task.endDate && task.endDate.getTime() < Date.now()) {
            throw new ValidationError('tid', null, '任务已过期');
        }
        await taskModel.assignTask(domainId, tid, this.user._id, 0);
        await OplogModel.log(this, 'tasks.claim', { taskId: tid });
        this.response.redirect = this.url('tasks_my');
    }
}

class TaskAssignmentActionHandler extends Handler {
    @param('aid', Types.ObjectId)
    async postCancel({ domainId }: { domainId: string }, aid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        await taskModel.cancelAssignment(domainId, aid, this.user._id);
        await OplogModel.log(this, 'tasks.cancel', { assignmentId: aid });
        this.response.redirect = this.url('tasks_my');
    }

    @param('aid', Types.ObjectId)
    async postRecheck({ domainId }: { domainId: string }, aid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const a = await taskModel.getAssignment(domainId, aid);
        if (!a) throw new NotFoundError('分配不存在');
        if (a.userId !== this.user._id && !canManageAllTasks(this.user as any)) {
            throw new ValidationError('aid', null, '无权重算他人进度');
        }
        await taskModel.checkTaskCompletion(domainId, aid, { force: true });
        this.response.redirect = this.url('tasks_my');
    }
}

// ─── Admin: tasks ─────────────────────────────────────────────────────────

class AdminTasksListHandler extends Handler {
    async prepare() {
        if (!canCreateTask(this.user as any) && !canManageAllTasks(this.user as any)) {
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    async get({ domainId }: { domainId: string }) {
        const isAdmin = canManageAllTasks(this.user as any);
        const filter = isAdmin ? {} : { createdBy: this.user._id };
        const { docs } = await taskModel.listTasks(domainId, filter, 1, 200);
        const allTags = new Set<string>();
        for (const t of docs) for (const tag of t.tags) allTags.add(tag);
        this.response.template = 'admin_tasks.html';
        this.response.body = {
            tasks: docs,
            tagOptions: Array.from(allTags).sort(),
            canManage: isAdmin,
        };
    }

    @param('tid', Types.ObjectId)
    async postClone({ domainId }: { domainId: string }, tid: ObjectId) {
        const src = await taskModel.getTask(domainId, tid);
        if (!src) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, src)) {
            throw new ValidationError('tid', null, '无权复制');
        }
        const newId = await taskModel.cloneTask(domainId, tid, this.user._id);
        await OplogModel.log(this, 'tasks.clone', { from: tid, to: newId });
        if (newId) this.response.redirect = this.url('admin_tasks_edit', { tid: newId });
        else this.response.redirect = this.url('admin_tasks');
    }

    @param('tid', Types.ObjectId)
    async postDelete({ domainId }: { domainId: string }, tid: ObjectId) {
        const t = await taskModel.getTask(domainId, tid);
        if (!t) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, t)) {
            throw new ValidationError('tid', null, '无权删除');
        }
        await taskModel.deleteTask(domainId, tid);
        await OplogModel.log(this, 'tasks.delete', { taskId: tid });
        this.response.redirect = this.url('admin_tasks');
    }
}

class AdminTasksEditHandler extends Handler {
    async prepare() {
        if (!canCreateTask(this.user as any) && !canManageAllTasks(this.user as any)) {
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('tid', Types.ObjectId, true)
    async get({ domainId }: { domainId: string }, tid?: ObjectId) {
        let task: TaskDoc | null = null;
        if (tid) {
            task = await taskModel.getTask(domainId, tid);
            if (!task) throw new NotFoundError('任务不存在');
            if (!canModifyTask(this.user as any, task)) {
                throw new ValidationError('tid', null, '无权编辑');
            }
        }
        const schools = await userBindModel.listSchools(domainId);
        const userGroups = await userBindModel.listUserGroups(domainId);
        this.response.template = 'admin_tasks_edit.html';
        this.response.body = {
            task,
            isEdit: !!task,
            presets: presetSummaries(),
            schools,
            userGroups,
        };
    }

    @param('tid', Types.ObjectId, true)
    @param('title', Types.Title)
    @param('description', Types.Content, true)
    @param('tags', Types.String, true)
    @param('points', Types.String, true)
    @param('condition', Types.String, true)
    @param('access', Types.String, true)
    @param('isActive', Types.Boolean, true)
    @param('startDate', Types.String, true)
    @param('endDate', Types.String, true)
    @param('maxAssignments', Types.Int, true)
    async post(
        { domainId }: { domainId: string },
        tid: ObjectId | undefined,
        title: string,
        description: string,
        tagsCsv: string,
        pointsJson: string,
        conditionJson: string,
        accessJson: string,
        isActive: boolean,
        startDate: string,
        endDate: string,
        maxAssignments: number,
    ) {
        const data: Partial<TaskDoc> = {
            title,
            description: description || '',
            tags: parseTagsCsv(tagsCsv),
            points: parseTaskPointsJson(pointsJson),
            condition: parseTaskConditionJson(conditionJson),
            access: parseTaskAccessJson(accessJson),
            isActive: isActive ?? true,
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
            maxAssignments: maxAssignments && maxAssignments > 0 ? maxAssignments : null,
        };
        if (tid) {
            const existing = await taskModel.getTask(domainId, tid);
            if (!existing) throw new NotFoundError('任务不存在');
            if (!canModifyTask(this.user as any, existing)) {
                throw new ValidationError('tid', null, '无权编辑');
            }
            await taskModel.updateTask(domainId, tid, data);
            await OplogModel.log(this, 'tasks.update', { taskId: tid });
            this.response.redirect = this.url('admin_tasks');
        } else {
            const newId = await taskModel.createTask(domainId, this.user._id, data);
            await OplogModel.log(this, 'tasks.create', { taskId: newId });
            this.response.redirect = this.url('admin_tasks');
        }
    }
}

class AdminTasksAssignHandler extends Handler {
    async prepare() {
        if (!canCreateTask(this.user as any) && !canManageAllTasks(this.user as any)) {
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('tid', Types.ObjectId)
    async get({ domainId }: { domainId: string }, tid: ObjectId) {
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, task)) {
            throw new ValidationError('tid', null, '无权分配');
        }
        const assignments = await taskModel.getTaskAssignments(domainId, tid);
        const uids = Array.from(new Set(assignments.map((a) => a.userId)));
        const udict = await UserModel.getList(domainId, uids);
        const schools = await userBindModel.listSchools(domainId);
        const userGroups = await userBindModel.listUserGroups(domainId);
        this.response.template = 'admin_tasks_assign.html';
        this.response.body = {
            task, assignments, udict, schools, userGroups,
        };
    }

    @param('tid', Types.ObjectId)
    @param('scope', Types.String)
    @param('targetId', Types.String, true)
    @param('uid', Types.Int, true)
    @param('note', Types.String, true)
    async postBatch(
        { domainId }: { domainId: string },
        tid: ObjectId,
        scope: string,
        targetId: string,
        uid: number,
        note: string,
    ) {
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, task)) {
            throw new ValidationError('tid', null, '无权分配');
        }
        let uids: number[] = [];
        if (scope === 'uid' && uid) uids = [uid];
        else if (scope === 'user_group' && targetId) {
            const gid = new ObjectId(targetId);
            const { docs } = await userBindModel.listStudents(domainId, {
                groupId: gid, boundOnly: true, limit: 5000,
            });
            uids = docs.map((s) => s.boundUserId!).filter(Boolean);
        } else if (scope === 'school' && targetId) {
            const sid = new ObjectId(targetId);
            const { docs } = await userBindModel.listStudents(domainId, {
                schoolId: sid, boundOnly: true, limit: 5000,
            });
            uids = docs.map((s) => s.boundUserId!).filter(Boolean);
        }
        let assigned = 0;
        for (const u of uids) {
            try {
                await taskModel.assignTask(domainId, tid, u, this.user._id, note || '');
                assigned++;
            } catch { /* per-user errors swallowed; counted as skip */ }
        }
        await OplogModel.log(this, 'tasks.assign_batch', { taskId: tid, scope, count: assigned });
        this.response.redirect = this.url('admin_tasks_assign', { tid });
    }

    @param('tid', Types.ObjectId)
    @param('aid', Types.ObjectId)
    @param('pointId', Types.String)
    @param('completed', Types.Boolean)
    @param('reason', Types.String, true)
    async postOverride(
        { domainId }: { domainId: string },
        tid: ObjectId,
        aid: ObjectId,
        pointId: string,
        completed: boolean,
        reason: string,
    ) {
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, task)) {
            throw new ValidationError('tid', null, '无权覆盖');
        }
        await taskModel.overridePointCompletion(
            domainId, aid, pointId, this.user._id, reason || '', completed,
        );
        await OplogModel.log(this, 'tasks.override', { aid, pointId, completed });
        this.response.redirect = this.url('admin_tasks_assign', { tid });
    }
}

class AdminTasksStatsHandler extends Handler {
    async prepare() {
        if (!canCreateTask(this.user as any) && !canManageAllTasks(this.user as any)) {
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('tid', Types.ObjectId)
    @param('format', Types.String, true)
    async get({ domainId }: { domainId: string }, tid: ObjectId, format = '') {
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, task)) {
            throw new ValidationError('tid', null, '无权查看');
        }
        const assignments = await taskModel.getTaskAssignments(domainId, tid, {
            status: { $ne: 'cancelled' },
        });
        // Recompute progress on the fly for the report (only pending ones; completed are frozen).
        for (const a of assignments) {
            if (a.status === 'pending' && a.progressUpdatedAt === null) {
                try { await taskModel.checkTaskCompletion(domainId, a._id); } catch { /* */ }
            }
        }
        const fresh = await taskModel.getTaskAssignments(domainId, tid, {
            status: { $ne: 'cancelled' },
        });
        const uids = fresh.map((a) => a.userId);
        const udict = await UserModel.getList(domainId, uids);
        if (format === 'csv') {
            const lines: string[] = ['uid,uname,status,completedPoints,totalPoints,completedAt,note'];
            for (const a of fresh) {
                const completedPoints = task.points.filter((p) => a.progress?.[p.id]?.completed).length;
                const u = udict[a.userId];
                lines.push([
                    a.userId,
                    JSON.stringify(u?.uname || ''),
                    a.status,
                    completedPoints,
                    task.points.length,
                    a.completedAt ? a.completedAt.toISOString() : '',
                    JSON.stringify(a.note || ''),
                ].join(','));
            }
            this.response.type = 'text/csv; charset=utf-8';
            this.response.disposition = `attachment; filename="task-${tid}-stats.csv"`;
            this.response.body = lines.join('\n');
            return;
        }
        const audit = await taskModel.listAuditForTask(domainId, tid, 50);
        this.response.template = 'admin_tasks_stats.html';
        this.response.body = { task, assignments: fresh, udict, audit, presets: presetSummaries() };
    }
}

// ─── Admin: scores ─────────────────────────────────────────────────────────

const PAT_LEVELS_OK: PatLevel[] = ['advanced', 'basic'];
const PAT_SEASONS_OK: PatSeason[] = ['spring', 'summer', 'autumn', 'winter'];
const GPLT_LEVELS_OK: GpltLevel[] = ['school', 'national'];

function clampScore(value: number, max: number): number {
    if (Number.isNaN(value)) throw new ValidationError('score', null, '分数无效');
    if (value < 0) throw new ValidationError('score', null, '分数不能为负');
    if (value > max) throw new ValidationError('score', null, `分数不能超过 ${max}`);
    return value;
}

function parseScoreImport(
    text: string,
    columns: string[],
): { rows: Record<string, string>[]; errors: string[] } {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const rows: Record<string, string>[] = [];
    const errors: string[] = [];
    lines.forEach((line, idx) => {
        const cells = line.split(/[,\t]/).map((c) => c.trim());
        if (cells.length < columns.length) {
            errors.push(`第 ${idx + 1} 行: 字段数不足，需要 ${columns.length} 列`);
            return;
        }
        const row: Record<string, string> = {};
        columns.forEach((col, i) => { row[col] = cells[i] || ''; });
        rows.push(row);
    });
    return { rows, errors };
}

class AdminScoresHandler extends Handler {
    async prepare() {
        if (!canManageAllTasks(this.user as any)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    @param('tab', Types.String, true)
    @param('level', Types.String, true)
    @param('year', Types.Int, true)
    async get({ domainId }: { domainId: string }, tab = 'pat', level = '', year = 0) {
        const settings = await taskModel.getDomainSettings(domainId);
        let scores: any[] = [];
        if (tab === 'pat') {
            const filter: any = { domainId };
            if (level && PAT_LEVELS_OK.includes(level as PatLevel)) filter.level = level;
            if (year) filter.year = year;
            scores = await patScoreColl.find(filter).sort({ year: -1, season: 1, userId: 1 }).limit(500).toArray();
        } else if (tab === 'gplt') {
            const filter: any = { domainId };
            if (level && GPLT_LEVELS_OK.includes(level as GpltLevel)) filter.level = level;
            if (year) filter.year = year;
            scores = await gpltScoreColl.find(filter).sort({ year: -1, userId: 1 }).limit(500).toArray();
        } else if (tab === 'csp') {
            const filter: any = { domainId };
            scores = await cspScoreColl.find(filter).sort({ round: -1, userId: 1 }).limit(500).toArray();
        }
        const uids = Array.from(new Set(scores.map((s) => s.userId)));
        const udict = await UserModel.getList(domainId, uids);
        this.response.template = 'admin_tasks_scores.html';
        this.response.body = { tab, scores, udict, settings, level, year };
    }

    // PAT single entry
    @param('userId', Types.Int)
    @param('level', Types.String)
    @param('year', Types.Int)
    @param('season', Types.String)
    @param('score', Types.Float)
    async postPat(
        { domainId }: { domainId: string },
        userId: number, level: string, year: number, season: string, score: number,
    ) {
        if (!PAT_LEVELS_OK.includes(level as PatLevel)) throw new ValidationError('level');
        if (!PAT_SEASONS_OK.includes(season as PatSeason)) throw new ValidationError('season');
        const settings = await taskModel.getDomainSettings(domainId);
        const safe = clampScore(score, settings.maxPatScore);
        await patScoreColl.updateOne(
            { domainId, userId, level: level as PatLevel, year, season: season as PatSeason },
            {
                $set: { score: safe, updatedAt: new Date(), updatedBy: this.user._id },
                $setOnInsert: { _id: new ObjectId(), createdAt: new Date(), createdBy: this.user._id },
            },
            { upsert: true },
        );
        this.response.redirect = this.url('admin_tasks_scores', { query: { tab: 'pat' } });
    }

    @param('id', Types.ObjectId)
    async postPatDelete({ domainId }: { domainId: string }, id: ObjectId) {
        await patScoreColl.deleteOne({ domainId, _id: id });
        this.response.body = { success: true };
    }

    @param('text', Types.Content)
    @param('level', Types.String)
    async postPatImport({ domainId }: { domainId: string }, text: string, level: string) {
        if (!PAT_LEVELS_OK.includes(level as PatLevel)) throw new ValidationError('level');
        const settings = await taskModel.getDomainSettings(domainId);
        const { rows, errors } = parseScoreImport(text, ['studentId', 'year', 'season', 'score']);
        let imported = 0;
        const rowErrors: string[] = [...errors];
        for (const r of rows) {
            const { docs: matched } = await userBindModel.listStudents(domainId, {
                query: r.studentId, boundOnly: true, limit: 5,
            });
            const student = matched.find((s) => s.studentId === r.studentId);
            if (!student?.boundUserId) {
                rowErrors.push(`学号 ${r.studentId}: 未绑定用户`);
                continue;
            }
            const score = parseFloat(r.score);
            if (Number.isNaN(score) || score < 0 || score > settings.maxPatScore) {
                rowErrors.push(`学号 ${r.studentId}: 分数无效 (0-${settings.maxPatScore})`);
                continue;
            }
            if (!PAT_SEASONS_OK.includes(r.season as PatSeason)) {
                rowErrors.push(`学号 ${r.studentId}: 季节无效 (spring/summer/autumn/winter)`);
                continue;
            }
            const year = parseInt(r.year, 10);
            if (!year) {
                rowErrors.push(`学号 ${r.studentId}: 年份无效`);
                continue;
            }
            await patScoreColl.updateOne(
                { domainId, userId: student.boundUserId, level: level as PatLevel, year, season: r.season as PatSeason },
                {
                    $set: { score, updatedAt: new Date(), updatedBy: this.user._id },
                    $setOnInsert: { _id: new ObjectId(), createdAt: new Date(), createdBy: this.user._id },
                },
                { upsert: true },
            );
            imported++;
        }
        this.response.body = { success: true, imported, errors: rowErrors };
    }

    // GPLT
    @param('userId', Types.Int)
    @param('level', Types.String)
    @param('year', Types.Int)
    @param('score', Types.Float)
    @param('rank', Types.Int, true)
    async postGplt(
        { domainId }: { domainId: string },
        userId: number, level: string, year: number, score: number, rank: number,
    ) {
        if (!GPLT_LEVELS_OK.includes(level as GpltLevel)) throw new ValidationError('level');
        const settings = await taskModel.getDomainSettings(domainId);
        const safe = clampScore(score, settings.maxGpltScore);
        await gpltScoreColl.updateOne(
            { domainId, userId, level: level as GpltLevel, year },
            {
                $set: { score: safe, rank: rank || null, updatedAt: new Date(), updatedBy: this.user._id },
                $setOnInsert: { _id: new ObjectId(), createdAt: new Date(), createdBy: this.user._id },
            },
            { upsert: true },
        );
        this.response.redirect = this.url('admin_tasks_scores', { query: { tab: 'gplt' } });
    }

    @param('id', Types.ObjectId)
    async postGpltDelete({ domainId }: { domainId: string }, id: ObjectId) {
        await gpltScoreColl.deleteOne({ domainId, _id: id });
        this.response.body = { success: true };
    }

    // CSP
    @param('userId', Types.Int)
    @param('round', Types.Int)
    @param('score', Types.Float)
    async postCsp(
        { domainId }: { domainId: string },
        userId: number, round: number, score: number,
    ) {
        const settings = await taskModel.getDomainSettings(domainId);
        const safe = clampScore(score, settings.maxCspScore);
        await cspScoreColl.updateOne(
            { domainId, userId, round },
            {
                $set: { score: safe, updatedAt: new Date(), updatedBy: this.user._id },
                $setOnInsert: { _id: new ObjectId(), createdAt: new Date(), createdBy: this.user._id },
            },
            { upsert: true },
        );
        this.response.redirect = this.url('admin_tasks_scores', { query: { tab: 'csp' } });
    }

    @param('id', Types.ObjectId)
    async postCspDelete({ domainId }: { domainId: string }, id: ObjectId) {
        await cspScoreColl.deleteOne({ domainId, _id: id });
        this.response.body = { success: true };
    }
}

class AdminSettingsHandler extends Handler {
    async prepare() {
        if (!canManageAllTasks(this.user as any)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get({ domainId }: { domainId: string }) {
        const settings = await taskModel.getDomainSettings(domainId);
        this.response.template = 'admin_tasks_settings.html';
        this.response.body = { settings };
    }

    @param('maxPatScore', Types.Float, true)
    @param('maxGpltScore', Types.Float, true)
    @param('maxCspScore', Types.Float, true)
    async post(
        { domainId }: { domainId: string },
        maxPatScore: number, maxGpltScore: number, maxCspScore: number,
    ) {
        await taskModel.setDomainSettings(domainId, {
            maxPatScore: maxPatScore || undefined,
            maxGpltScore: maxGpltScore || undefined,
            maxCspScore: maxCspScore || undefined,
        }, this.user._id);
        this.response.redirect = this.url('admin_tasks_settings');
    }
}

// ─── Route registration ──────────────────────────────────────────────────

export function applyHandlers(ctx: Context) {
    // User-facing
    ctx.Route('tasks_center', '/tasks', TaskCenterHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('tasks_my', '/tasks/my', TaskMyHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('tasks_detail', '/tasks/:tid', TaskDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('tasks_assignment_actions', '/tasks/assignments/:aid', TaskAssignmentActionHandler, PRIV.PRIV_USER_PROFILE);

    // Admin
    ctx.Route('admin_tasks', '/admin/tasks', AdminTasksListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_create', '/admin/tasks/create', AdminTasksEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_edit', '/admin/tasks/:tid/edit', AdminTasksEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_assign', '/admin/tasks/:tid/assign', AdminTasksAssignHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_stats', '/admin/tasks/:tid/stats', AdminTasksStatsHandler, PRIV.PRIV_USER_PROFILE);

    ctx.Route('admin_tasks_scores', '/admin/tasks/scores', AdminScoresHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_settings', '/admin/tasks/settings', AdminSettingsHandler, PRIV.PRIV_USER_PROFILE);
}
