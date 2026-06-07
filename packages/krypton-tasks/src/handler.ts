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
    Context, DocumentModel, Handler, NotFoundError, ObjectId, OplogModel,
    param, PRIV, ProblemModel, Types, UserModel, ValidationError,
} from 'hydrooj';
import { userBindModel } from '@hydrooj/krypton-userbind';
import { canCreateTask, canManageAllTasks, canModifyTask } from './auth';
import {
    cspScoreColl, gpltScoreColl, patScoreColl,
} from './db';
import { taskModel } from './model';
import { presetSummaries } from './presets';
import type {
    AdmissionMode, GpltLevel, PatLevel,
    PatSeason, TaskAccess, TaskDoc, TaskGraph, TaskGraphEdge, TaskGraphNode,
} from './types';
import { emptyTaskGraph } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function parsePosition(p: any): { x: number; y: number } {
    if (!p || typeof p !== 'object') return { x: 0, y: 0 };
    return {
        x: Number.isFinite(+p.x) ? +p.x : 0,
        y: Number.isFinite(+p.y) ? +p.y : 0,
    };
}

/**
 * Parse a task graph from JSON.
 *
 * Enforces invariants:
 *  - Exactly one `start` and one `end` node (auto-inserted if missing).
 *  - Task nodes must carry `presetId`.
 *  - Edges only between known node ids; self-loops dropped silently.
 *  - Cycles are NOT detected here (evaluator's visited-set is tolerant);
 *    a future pass could reject them as a separate validation step.
 */
function parseTaskGraphJson(json: string): TaskGraph {
    if (!json) return emptyTaskGraph();
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { throw new ValidationError('graph', null, 'JSON 格式错误'); }
    if (!parsed || typeof parsed !== 'object') return emptyTaskGraph();

    const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    const nodes: TaskGraphNode[] = [];
    let sawStart = false;
    let sawEnd = false;
    for (const n of rawNodes) {
        if (!n || typeof n !== 'object') continue;
        const type = n.type === 'start' || n.type === 'end' || n.type === 'task' ? n.type : null;
        if (!type) continue;
        if (type === 'start') {
            if (sawStart) continue;
            sawStart = true;
            nodes.push({
                id: String(n.id || 'start'),
                type: 'start',
                position: parsePosition(n.position),
            });
            continue;
        }
        if (type === 'end') {
            if (sawEnd) continue;
            sawEnd = true;
            nodes.push({
                id: String(n.id || 'end'),
                type: 'end',
                position: parsePosition(n.position),
            });
            continue;
        }
        // task
        if (!n.presetId) continue;
        nodes.push({
            id: String(n.id || `t_${Math.random().toString(36).slice(2, 9)}`),
            type: 'task',
            position: parsePosition(n.position),
            presetId: String(n.presetId),
            name: String(n.name || n.presetId),
            params: n.params && typeof n.params === 'object' ? n.params : {},
        });
    }
    if (!sawStart) nodes.unshift({ id: 'start', type: 'start', position: { x: 0, y: 0 } });
    if (!sawEnd) nodes.push({ id: 'end', type: 'end', position: { x: 0, y: 200 } });

    const validIds = new Set(nodes.map((n) => n.id));
    const edges: TaskGraphEdge[] = [];
    for (const e of rawEdges) {
        if (!e || typeof e !== 'object') continue;
        const from = String(e.from || e.source || '');
        const to = String(e.to || e.target || '');
        if (!validIds.has(from) || !validIds.has(to)) continue;
        if (from === to) continue;
        edges.push({
            id: String(e.id || `e_${Math.random().toString(36).slice(2, 9)}`),
            from,
            to,
        });
    }
    return { nodes, edges };
}

function parseAdmissionMode(s: string | undefined): AdmissionMode {
    return s === 'quota' ? 'quota' : 'auto';
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
    if (parsed?.type === 'grade' && Array.isArray(parsed.years)) {
        const years = parsed.years
            .map((y: any) => +y)
            .filter((y: number) => Number.isInteger(y) && y >= 1900 && y <= 2099);
        return { type: 'grade', years };
    }
    return { type: 'public' };
}

function parseTagsCsv(csv?: string): string[] {
    if (!csv) return [];
    return csv.split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 16);
}

function parseCstDateTime(input?: string, boundary: 'start' | 'end' = 'start'): Date | null {
    const value = (input || '').trim();
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const time = boundary === 'end' ? '23:59:59.999' : '00:00:00.000';
        return new Date(`${value}T${time}+08:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value)) {
        const withSeconds = value.length === 16 ? `${value}:00` : value;
        return new Date(`${withSeconds}+08:00`);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeLocalRedirect(target: string | undefined, fallback: string): string {
    const value = (target || '').trim();
    if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
    return value;
}

function objectIdHex(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value.toHexString === 'function') return value.toHexString();
    return String(value);
}

function addObjectIdRef(set: Set<string>, value: any) {
    const id = objectIdHex(value).trim();
    if (id && ObjectId.isValid(id)) set.add(id);
}

function addProblemRef(set: Set<number>, value: any) {
    const pid = +value;
    if (Number.isInteger(pid) && pid > 0) set.add(pid);
}

function collectTaskParamRefs(graph: TaskGraph) {
    const refs = {
        contestIds: new Set<string>(),
        homeworkIds: new Set<string>(),
        trainingIds: new Set<string>(),
        problemIds: new Set<number>(),
        schoolIds: new Set<string>(),
        userGroupIds: new Set<string>(),
    };
    const presetMap = new Map(presetSummaries().map((p) => [p.id, p]));
    for (const node of graph.nodes || []) {
        if (node.type !== 'task' || !node.presetId) continue;
        const preset = presetMap.get(node.presetId);
        if (!preset) continue;
        const params = node.params || {};
        for (const spec of preset.params || []) {
            const value = params[spec.name] ?? spec.default;
            if (value == null || value === '') continue;
            if (node.presetId === 'group_membership' && spec.name === 'targetId') {
                if (params.scope === 'school') addObjectIdRef(refs.schoolIds, value);
                else addObjectIdRef(refs.userGroupIds, value);
                continue;
            }
            if (spec.type === 'contest') addObjectIdRef(refs.contestIds, value);
            else if (spec.type === 'homework') addObjectIdRef(refs.homeworkIds, value);
            else if (spec.type === 'training') addObjectIdRef(refs.trainingIds, value);
            else if (spec.type === 'problem') addProblemRef(refs.problemIds, value);
            else if (spec.type === 'school') addObjectIdRef(refs.schoolIds, value);
            else if (spec.type === 'user_group') addObjectIdRef(refs.userGroupIds, value);
        }
    }
    return refs;
}

async function resolveTaskParamRefs(domainId: string, graph: TaskGraph) {
    const refs = collectTaskParamRefs(graph);
    const toObjectIds = (set: Set<string>) => Array.from(set).map((id) => new ObjectId(id));
    const contestIds = toObjectIds(refs.contestIds);
    const homeworkIds = toObjectIds(refs.homeworkIds);
    const trainingIds = toObjectIds(refs.trainingIds);

    const [contestDocs, homeworkDocs, trainingDocs, problems, schools, userGroups] = await Promise.all([
        contestIds.length
            ? DocumentModel.coll.find({ domainId, docType: DocumentModel.TYPE_CONTEST, docId: { $in: contestIds } })
                .project({ docId: 1, title: 1, beginAt: 1, rule: 1 }).toArray()
            : Promise.resolve([]),
        homeworkIds.length
            ? DocumentModel.coll.find({ domainId, docType: DocumentModel.TYPE_CONTEST, rule: 'homework', docId: { $in: homeworkIds } })
                .project({ docId: 1, title: 1, beginAt: 1, rule: 1 }).toArray()
            : Promise.resolve([]),
        trainingIds.length
            ? DocumentModel.coll.find({ domainId, docType: DocumentModel.TYPE_TRAINING, docId: { $in: trainingIds } })
                .project({ docId: 1, title: 1 }).toArray()
            : Promise.resolve([]),
        Promise.all(Array.from(refs.problemIds).map(async (pid) => {
            const pdoc = await ProblemModel.get(domainId, pid).catch(() => null);
            return pdoc ? {
                docId: pdoc.docId,
                pid: (pdoc as any).pid,
                title: pdoc.title,
            } : null;
        })),
        refs.schoolIds.size || refs.userGroupIds.size ? userBindModel.listSchools(domainId) : Promise.resolve([]),
        refs.userGroupIds.size ? userBindModel.listUserGroups(domainId) : Promise.resolve([]),
    ]);

    const groupSchoolIds = new Set(userGroups.map((g: any) => objectIdHex(g.schoolId)));
    const docRef = (d: any) => ({
        _id: objectIdHex(d.docId),
        title: d.title || objectIdHex(d.docId),
        beginAt: d.beginAt || null,
        rule: d.rule || '',
    });
    return {
        contests: contestDocs.map(docRef),
        homeworks: homeworkDocs.map(docRef),
        trainings: trainingDocs.map((d: any) => ({ _id: objectIdHex(d.docId), title: d.title || objectIdHex(d.docId) })),
        problems: problems.filter(Boolean),
        schools: schools
            .filter((s: any) => refs.schoolIds.has(objectIdHex(s._id)) || groupSchoolIds.has(objectIdHex(s._id)))
            .map((s: any) => ({ _id: objectIdHex(s._id), name: s.name })),
        userGroups: userGroups
            .filter((g: any) => refs.userGroupIds.has(objectIdHex(g._id)))
            .map((g: any) => ({ _id: objectIdHex(g._id), schoolId: objectIdHex(g.schoolId), name: g.name })),
    };
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
    const enrollmentYear = student?.enrollmentYear ?? null;
    if (student) {
        memberSchoolIds.add(student.schoolId.toHexString());
        for (const g of student.groupIds || []) memberGroupIds.add(g.toHexString());
    }
    return all.docs.filter((t) => {
        if (t.access.type === 'public') return true;
        if (t.access.type === 'school') return memberSchoolIds.has(t.access.targetId.toHexString());
        if (t.access.type === 'user_group') return memberGroupIds.has(t.access.targetId.toHexString());
        if (t.access.type === 'grade') {
            return enrollmentYear != null && t.access.years.includes(enrollmentYear);
        }
        return false;
    });
}

async function loadAssignmentMap(
    domainId: string,
    userId: number,
): Promise<Record<string, { _id: ObjectId; status: string; canCancel: boolean; assignedAt: Date }>> {
    const list = await taskModel.getUserAssignments(domainId, userId, { status: { $ne: 'cancelled' } });
    const out: Record<string, any> = {};
    for (const a of list) out[a.taskId.toHexString()] = {
        _id: a._id, status: a.status, canCancel: a.canCancel, assignedAt: a.assignedAt,
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
        const paramRefs = await resolveTaskParamRefs(domainId, task.graph);
        // Resolve current user's enrollmentYear so the UI can highlight the
        // matching `by_grade` branch (read-only — has no effect on backend).
        const myStudent = await userBindModel.findStudentByUserId(domainId, this.user._id);
        this.response.template = 'tasks_detail.html';
        this.response.body = {
            task,
            assignment: myAssignment ? await taskModel.getAssignment(domainId, myAssignment._id) : null,
            progress,
            creatorName: creator?.uname || '系统',
            assignmentCount,
            presets: presetSummaries(),
            canManage: canModifyTask(this.user as any, task),
            userEnrollmentYear: myStudent?.enrollmentYear ?? null,
            paramRefs,
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
        const now = Date.now();
        if (task.claimStartAt && task.claimStartAt.getTime() > now) {
            throw new ValidationError('tid', null, '未到认领时间');
        }
        if (task.claimEndAt && task.claimEndAt.getTime() < now) {
            throw new ValidationError('tid', null, '认领已截止');
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
        // Bootstrap small-cardinality picker sources so the right-side editor
        // can use dropdowns (no manual ObjectId entry). Problems are too many
        // to bootstrap — see admin_tasks_api_problems for autocomplete.
        const [schools, userGroups, contestDocs, homeworkDocs, trainingDocs] = await Promise.all([
            userBindModel.listSchools(domainId),
            userBindModel.listUserGroups(domainId),
            DocumentModel.coll.find({ domainId, docType: DocumentModel.TYPE_CONTEST })
                .project({ docId: 1, title: 1, beginAt: 1, rule: 1 })
                .sort({ beginAt: -1 }).limit(500).toArray(),
            DocumentModel.coll.find({ domainId, docType: DocumentModel.TYPE_CONTEST, rule: 'homework' })
                .project({ docId: 1, title: 1, beginAt: 1 })
                .sort({ beginAt: -1 }).limit(500).toArray(),
            DocumentModel.coll.find({ domainId, docType: DocumentModel.TYPE_TRAINING })
                .project({ docId: 1, title: 1 })
                .limit(500).toArray(),
        ]);
        const toRef = (d: any) => ({ _id: d.docId, title: d.title, beginAt: d.beginAt, rule: d.rule });
        this.response.template = 'admin_tasks_edit.html';
        this.response.body = {
            task,
            isEdit: !!task,
            presets: presetSummaries(),
            schools,
            userGroups,
            contests: contestDocs.map(toRef),
            homeworks: homeworkDocs.map(toRef),
            trainings: trainingDocs.map(toRef),
        };
    }

    @param('tid', Types.ObjectId, true)
    @param('title', Types.Title)
    @param('description', Types.Content, true)
    @param('tags', Types.String, true)
    @param('graph', Types.String, true)
    @param('access', Types.String, true)
    @param('isActive', Types.Boolean, true)
    @param('startDate', Types.String, true)
    @param('endDate', Types.String, true)
    @param('claimStartAt', Types.String, true)
    @param('claimEndAt', Types.String, true)
    @param('maxAssignments', Types.Int, true)
    @param('countsAsStay', Types.Boolean, true)
    @param('admissionMode', Types.String, true)
    @param('quota', Types.Int, true)
    async post(
        { domainId }: { domainId: string },
        tid: ObjectId | undefined,
        title: string,
        description: string,
        tagsCsv: string,
        graphJson: string,
        accessJson: string,
        isActive: boolean,
        startDate: string,
        endDate: string,
        claimStartAt: string,
        claimEndAt: string,
        maxAssignments: number,
        countsAsStay: boolean,
        admissionMode: string,
        quota: number,
    ) {
        const mode = parseAdmissionMode(admissionMode);
        const data: Partial<TaskDoc> = {
            title,
            description: description || '',
            tags: parseTagsCsv(tagsCsv),
            graph: parseTaskGraphJson(graphJson),
            access: parseTaskAccessJson(accessJson),
            isActive: isActive ?? true,
            startDate: parseCstDateTime(startDate, 'start'),
            endDate: parseCstDateTime(endDate, 'end'),
            claimStartAt: parseCstDateTime(claimStartAt, 'start'),
            claimEndAt: parseCstDateTime(claimEndAt, 'end'),
            maxAssignments: maxAssignments && maxAssignments > 0 ? maxAssignments : null,
            countsAsStay: !!countsAsStay,
            admissionMode: mode,
            quota: mode === 'quota' && quota && quota > 0 ? quota : null,
        };
        if (tid) {
            const existing = await taskModel.getTask(domainId, tid);
            if (!existing) throw new NotFoundError('任务不存在');
            if (!canModifyTask(this.user as any, existing)) {
                throw new ValidationError('tid', null, '无权编辑');
            }
            // Audit task-level edits so we can correlate "condition tightened
            // on date X" with "user Y suddenly downgraded" later.
            await taskModel.writeAudit({
                domainId, assignmentId: null, taskId: tid,
                eventType: 'condition_change', adminUid: this.user._id,
                before: {
                    graph: existing.graph,
                    admissionMode: existing.admissionMode,
                    quota: existing.quota,
                },
                after: { graph: data.graph, admissionMode: data.admissionMode, quota: data.quota },
                reason: '',
            });
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

class AdminTasksOverrideHandler extends Handler {
    async prepare() {
        if (!canCreateTask(this.user as any) && !canManageAllTasks(this.user as any)) {
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('tid', Types.ObjectId)
    @param('aid', Types.ObjectId)
    @param('pointId', Types.String)
    @param('completed', Types.Boolean)
    @param('reason', Types.String, true)
    @param('redirect', Types.String, true)
    async post(
        { domainId }: { domainId: string },
        tid: ObjectId,
        aid: ObjectId,
        pointId: string,
        completed: boolean,
        reason: string,
        redirect: string,
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
        this.response.redirect = safeLocalRedirect(redirect, this.url('admin_tasks_stats', { tid }));
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
        const [udict, studentByUid] = await Promise.all([
            UserModel.getList(domainId, uids),
            userBindModel.findStudentsByUserIds(domainId, uids),
        ]);
        const taskNodes = task.graph.nodes.filter((n) => n.type === 'task');
        if (format === 'csv') {
            const lines: string[] = ['uid,uname,studentId,realName,status,completedNodes,totalNodes,completedAt,note'];
            for (const a of fresh) {
                const completedNodes = taskNodes.filter((n) => a.progress?.[n.id]?.completed).length;
                const u = udict[a.userId];
                const student = studentByUid[String(a.userId)];
                lines.push([
                    a.userId,
                    JSON.stringify(u?.uname || ''),
                    JSON.stringify(student?.studentId || ''),
                    JSON.stringify(student?.realName || ''),
                    a.status,
                    completedNodes,
                    taskNodes.length,
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
        this.response.body = {
            task, assignments: fresh, udict, studentByUid, audit, presets: presetSummaries(),
        };
    }
}

// ─── Admin: candidate pool (quota mode) ──────────────────────────────────

/**
 * `/admin/tasks/:tid/candidates`
 *
 * GET: bootstraps the candidate-pool table (qualified + admitted + completed
 * assignments, joined with student/school/group info, plus per-node done
 * matrix). Returns assignments unfiltered by status — the UI picks which
 * sub-list to show via tabs.
 *
 * POST operations:
 *   - admit    : qualified → admitted          (bulk, no side effects)
 *   - unadmit  : admitted  → qualified         (bulk, no side effects)
 *   - confirm  : admitted  → completed         (bulk, triggers stay event)
 *
 * Each operation accepts a comma-separated `aids` form field. Errors are
 * swallowed per-row and reported in aggregate (so a stale row doesn't
 * abort the entire batch).
 */
class AdminTasksCandidatesHandler extends Handler {
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
            throw new ValidationError('tid', null, '无权查看候选池');
        }

        const assignments = await taskModel.getTaskAssignments(domainId, tid, {
            status: { $in: ['qualified', 'admitted', 'completed'] },
        });
        const uids = assignments.map((a) => a.userId);
        const [udict, students, schools, userGroups] = await Promise.all([
            UserModel.getList(domainId, uids),
            // Fetch student records in bulk to enrich rows with realName/school/year.
            Promise.all(uids.map((uid) => userBindModel.findStudentByUserId(domainId, uid))),
            userBindModel.listSchools(domainId),
            userBindModel.listUserGroups(domainId),
        ]);
        const studentByUid: Record<number, any> = {};
        uids.forEach((uid, i) => { if (students[i]) studentByUid[uid] = students[i]; });

        const counts = {
            qualified: assignments.filter((a) => a.status === 'qualified').length,
            admitted: assignments.filter((a) => a.status === 'admitted').length,
            completed: assignments.filter((a) => a.status === 'completed').length,
        };

        this.response.template = 'admin_tasks_candidates.html';
        this.response.body = {
            task,
            assignments,
            udict,
            studentByUid,
            schools,
            userGroups,
            counts,
            presets: presetSummaries(),
        };
    }

    /**
     * Parse a comma/space-separated string of ObjectId hex strings.
     * Silently drops malformed entries.
     */
    private parseAids(raw: string): ObjectId[] {
        if (!raw) return [];
        const out: ObjectId[] = [];
        for (const s of raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)) {
            try { out.push(new ObjectId(s)); } catch { /* skip */ }
        }
        return out;
    }

    @param('tid', Types.ObjectId)
    @param('operation', Types.String)
    @param('aids', Types.String)
    @param('note', Types.String, true)
    async post(
        { domainId }: { domainId: string },
        tid: ObjectId,
        operation: string,
        aidsCsv: string,
        note: string,
    ) {
        const task = await taskModel.getTask(domainId, tid);
        if (!task) throw new NotFoundError('任务不存在');
        if (!canModifyTask(this.user as any, task)) {
            throw new ValidationError('tid', null, '无权操作候选池');
        }
        const aids = this.parseAids(aidsCsv);
        if (!aids.length) throw new ValidationError('aids', null, '未选中任何分配');

        let ok = 0;
        const errors: Array<{ aid: string; reason: string }> = [];
        for (const aid of aids) {
            try {
                if (operation === 'admit') {
                    await taskModel.admitAssignment(domainId, aid, this.user._id, note || '');
                } else if (operation === 'unadmit') {
                    await taskModel.unadmitAssignment(domainId, aid, this.user._id, note || '');
                } else if (operation === 'confirm') {
                    await taskModel.confirmAssignment(domainId, aid, this.user._id, note || '');
                } else {
                    throw new ValidationError('operation', null, '未知操作');
                }
                ok++;
            } catch (e: any) {
                errors.push({ aid: aid.toHexString(), reason: e?.message || String(e) });
            }
        }
        await OplogModel.log(this, `tasks.${operation}_batch`, { tid, count: ok, errors: errors.length });

        // For form-style POST, redirect back; for fetch with Accept: json,
        // return JSON.
        if (this.request.headers.accept?.includes('application/json')) {
            this.response.body = { success: true, ok, errors };
            return;
        }
        this.response.redirect = this.url('admin_tasks_candidates', { tid });
    }
}

// ─── Admin: editor-helper API (problem autocomplete) ─────────────────────

/**
 * `/admin/tasks/api/problems/search?q=...&limit=30`
 *
 * Returns up to `limit` problems matching the query string (matches against
 * pid as exact, then title as substring; case-insensitive). Used by the
 * xyflow editor's right-panel problem picker; problems are too many
 * (~thousands) to bootstrap on the edit page, so we autocomplete instead.
 */
class AdminTasksProblemSearchHandler extends Handler {
    async prepare() {
        if (!canCreateTask(this.user as any) && !canManageAllTasks(this.user as any)) {
            this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('q', Types.String, true)
    @param('limit', Types.Int, true)
    async get({ domainId }: { domainId: string }, q: string, limit: number) {
        const cap = Math.min(50, Math.max(5, limit || 30));
        const query: any = { domainId, hidden: { $ne: true } };
        const trimmed = (q || '').trim();
        if (trimmed) {
            // pid exact (numeric) → exact match wins; else case-insensitive title regex.
            const orList: any[] = [];
            const asNum = +trimmed;
            if (Number.isInteger(asNum)) orList.push({ docId: asNum });
            orList.push({
                title: { $regex: trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
            });
            orList.push({ pid: trimmed });
            query.$or = orList;
        }
        // ProblemModel.getMulti returns a cursor sorted by `sort` ASC; for
        // search results we'd prefer docId ASC. Project only the picker-needed
        // fields to keep the response light.
        const docs = await ProblemModel.getMulti(domainId, query, ['docId', 'pid', 'title'] as any)
            .sort({ docId: 1 }).limit(cap).toArray();
        this.response.body = {
            results: docs.map((d: any) => ({
                docId: d.docId,
                pid: d.pid || String(d.docId),
                title: d.title,
            })),
        };
        this.response.type = 'application/json';
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

/**
 * Resolve a human-entered studentId to its userbind student doc. Scores are
 * keyed by `studentDocId` (= student._id) since 2026-06-07, so this is the
 * single resolution point for both single-entry and bulk import. Uses an EXACT
 * match (no fuzzy regex / limit). Returns null when the studentId resolves to
 * other than exactly one student — i.e. not found (0) OR ambiguous across
 * schools (>1) — so a score is never silently attributed to the wrong student.
 * Binding to an OJ account is NOT required — unbound students can hold scores.
 */
async function findStudentDoc(domainId: string, studentId: string) {
    const matches = await userBindModel.findStudentsByStudentId(domainId, studentId);
    return matches.length === 1 ? matches[0] : null;
}

function parseScoreImport(
    text: string,
    columns: string[],
): { rows: Record<string, string>[]; errors: string[] } {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const rows: Record<string, string>[] = [];
    const errors: string[] = [];
    lines.forEach((line, idx) => {
        const primaryDelimiter = /[,\t]/.test(line) ? /[,\t]/ : /\s+/;
        const cells = line.split(primaryDelimiter).map((c) => c.trim()).filter(Boolean);
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
        let stayEvents: any[] = [];
        let schools: any[] = [];
        if (tab === 'pat') {
            const filter: any = { domainId };
            if (level && PAT_LEVELS_OK.includes(level as PatLevel)) filter.level = level;
            if (year) filter.year = year;
            scores = await patScoreColl.find(filter).sort({ year: -1, season: 1, studentDocId: 1 }).limit(500).toArray();
        } else if (tab === 'gplt') {
            const filter: any = { domainId };
            if (level && GPLT_LEVELS_OK.includes(level as GpltLevel)) filter.level = level;
            if (year) filter.year = year;
            scores = await gpltScoreColl.find(filter).sort({ year: -1, studentDocId: 1 }).limit(500).toArray();
        } else if (tab === 'csp') {
            const filter: any = { domainId };
            scores = await cspScoreColl.find(filter).sort({ round: -1, studentDocId: 1 }).limit(500).toArray();
        } else if (tab === 'stay') {
            stayEvents = await taskModel.listStayEvents(domainId, year ? { year } : {});
            schools = await userBindModel.listSchools(domainId);
        }
        // Scores are keyed by studentDocId — join student records for display
        // (学号/姓名/学校) plus bound OJ users for uname. Stay events remain
        // userId-keyed (not re-keyed), so collect their uids separately.
        const studentDocIds = Array.from(new Set(scores.map((s) => String(s.studentDocId))))
            .map((s) => new ObjectId(s));
        const studentDict: Record<string, any> = {};
        const boundUids: number[] = [];
        await Promise.all(studentDocIds.map(async (sid) => {
            const st = await userBindModel.getStudent(domainId, sid);
            if (!st) return;
            studentDict[String(sid)] = {
                studentId: st.studentId, realName: st.realName,
                schoolId: st.schoolId, boundUserId: st.boundUserId,
            };
            if (st.boundUserId) boundUids.push(st.boundUserId);
        }));
        const uids = Array.from(new Set([...boundUids, ...stayEvents.map((e) => e.userId)]));
        const udict = await UserModel.getList(domainId, uids);
        this.response.template = 'admin_tasks_scores.html';
        this.response.body = { tab, scores, stayEvents, schools, udict, studentDict, settings, level, year };
    }

    // PAT single entry
    @param('studentId', Types.String)
    @param('level', Types.String)
    @param('year', Types.Int)
    @param('season', Types.String)
    @param('score', Types.Float)
    async postPat(
        { domainId }: { domainId: string },
        studentId: string, level: string, year: number, season: string, score: number,
    ) {
        if (!PAT_LEVELS_OK.includes(level as PatLevel)) throw new ValidationError('level');
        if (!PAT_SEASONS_OK.includes(season as PatSeason)) throw new ValidationError('season');
        const student = await findStudentDoc(domainId, studentId);
        if (!student) throw new ValidationError('studentId', null, `学号 ${studentId}: 未找到学生档案`);
        const settings = await taskModel.getDomainSettings(domainId);
        const safe = clampScore(score, settings.maxPatScore);
        await patScoreColl.updateOne(
            { domainId, studentDocId: student._id, level: level as PatLevel, year, season: season as PatSeason },
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

    // PAT bulk import — format per line: 学号,级别(advanced|basic),年,季节,分
    @param('text', Types.Content)
    async postPatImport({ domainId }: { domainId: string }, text: string) {
        const settings = await taskModel.getDomainSettings(domainId);
        const { rows, errors } = parseScoreImport(text, ['studentId', 'level', 'year', 'season', 'score']);
        let imported = 0;
        const rowErrors: string[] = [...errors];
        for (const r of rows) {
            const student = await findStudentDoc(domainId, r.studentId);
            if (!student) {
                rowErrors.push(`学号 ${r.studentId}: 未找到学生档案`);
                continue;
            }
            if (!PAT_LEVELS_OK.includes(r.level as PatLevel)) {
                rowErrors.push(`学号 ${r.studentId}: 等级无效 (advanced/basic)`);
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
                { domainId, studentDocId: student._id, level: r.level as PatLevel, year, season: r.season as PatSeason },
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

    // GPLT single entry
    @param('studentId', Types.String)
    @param('level', Types.String)
    @param('year', Types.Int)
    @param('score', Types.Float)
    @param('rank', Types.Int, true)
    async postGplt(
        { domainId }: { domainId: string },
        studentId: string, level: string, year: number, score: number, rank: number,
    ) {
        if (!GPLT_LEVELS_OK.includes(level as GpltLevel)) throw new ValidationError('level');
        const student = await findStudentDoc(domainId, studentId);
        if (!student) throw new ValidationError('studentId', null, `学号 ${studentId}: 未找到学生档案`);
        const settings = await taskModel.getDomainSettings(domainId);
        const safe = clampScore(score, settings.maxGpltScore);
        await gpltScoreColl.updateOne(
            { domainId, studentDocId: student._id, level: level as GpltLevel, year },
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

    // GPLT bulk import — format per line: 学号,级别(school|national),年,分
    @param('text', Types.Content)
    async postGpltImport({ domainId }: { domainId: string }, text: string) {
        const settings = await taskModel.getDomainSettings(domainId);
        const { rows, errors } = parseScoreImport(text, ['studentId', 'level', 'year', 'score']);
        let imported = 0;
        const rowErrors: string[] = [...errors];
        for (const r of rows) {
            const student = await findStudentDoc(domainId, r.studentId);
            if (!student) { rowErrors.push(`学号 ${r.studentId}: 未找到学生档案`); continue; }
            if (!GPLT_LEVELS_OK.includes(r.level as GpltLevel)) { rowErrors.push(`学号 ${r.studentId}: 级别无效 (school/national)`); continue; }
            const year = parseInt(r.year, 10);
            if (!year) { rowErrors.push(`学号 ${r.studentId}: 年份无效`); continue; }
            const score = parseFloat(r.score);
            if (Number.isNaN(score) || score < 0 || score > settings.maxGpltScore) {
                rowErrors.push(`学号 ${r.studentId}: 分数无效 (0-${settings.maxGpltScore})`);
                continue;
            }
            await gpltScoreColl.updateOne(
                { domainId, studentDocId: student._id, level: r.level as GpltLevel, year },
                {
                    // rank is set only via single-entry; bulk import preserves any existing rank
                    $set: { score, updatedAt: new Date(), updatedBy: this.user._id },
                    $setOnInsert: { _id: new ObjectId(), createdAt: new Date(), createdBy: this.user._id, rank: null },
                },
                { upsert: true },
            );
            imported++;
        }
        this.response.body = { success: true, imported, errors: rowErrors };
    }

    // CSP single entry
    @param('studentId', Types.String)
    @param('round', Types.Int)
    @param('score', Types.Float)
    async postCsp(
        { domainId }: { domainId: string },
        studentId: string, round: number, score: number,
    ) {
        if (!round || round < 1) throw new ValidationError('round', null, '认证次数无效');
        const student = await findStudentDoc(domainId, studentId);
        if (!student) throw new ValidationError('studentId', null, `学号 ${studentId}: 未找到学生档案`);
        const settings = await taskModel.getDomainSettings(domainId);
        const safe = clampScore(score, settings.maxCspScore);
        await cspScoreColl.updateOne(
            { domainId, studentDocId: student._id, round },
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

    // CSP bulk import — format per line: 学号,轮次,分
    @param('text', Types.Content)
    async postCspImport({ domainId }: { domainId: string }, text: string) {
        const settings = await taskModel.getDomainSettings(domainId);
        const { rows, errors } = parseScoreImport(text, ['studentId', 'round', 'score']);
        let imported = 0;
        const rowErrors: string[] = [...errors];
        for (const r of rows) {
            const student = await findStudentDoc(domainId, r.studentId);
            if (!student) { rowErrors.push(`学号 ${r.studentId}: 未找到学生档案`); continue; }
            const round = parseInt(r.round, 10);
            if (!round) { rowErrors.push(`学号 ${r.studentId}: 轮次无效`); continue; }
            const score = parseFloat(r.score);
            if (Number.isNaN(score) || score < 0 || score > settings.maxCspScore) {
                rowErrors.push(`学号 ${r.studentId}: 分数无效 (0-${settings.maxCspScore})`);
                continue;
            }
            await cspScoreColl.updateOne(
                { domainId, studentDocId: student._id, round },
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

    // ─── 留校次数（stay events）─────────────────────────────────────────
    //
    // Each row = one stay event. Multiple entries per (user, year) are
    // intentionally allowed — admin backfilling 3 historical stays should
    // submit 3 entries. Auto-generated entries from task completions
    // (source = `task:<aid>`) are listed alongside manual ones; admin can
    // delete either via postStayDelete.

    @param('schoolId', Types.ObjectId)
    @param('studentId', Types.String)
    @param('realName', Types.String)
    @param('year', Types.Int)
    async postStay(
        { domainId }: { domainId: string },
        schoolId: ObjectId, studentId: string, realName: string, year: number,
    ) {
        const r = await taskModel.addManualStayEvent(
            domainId, schoolId, studentId.trim(), realName.trim(), year, this.user._id,
        );
        if (!r.ok) throw new ValidationError('studentId', null, 'reason' in r ? r.reason : '添加失败');
        this.response.redirect = this.url('admin_tasks_scores', { query: { tab: 'stay' } });
    }

    @param('text', Types.Content)
    @param('schoolId', Types.ObjectId)
    async postStayImport(
        { domainId }: { domainId: string }, text: string, schoolId: ObjectId,
    ) {
        const { rows, errors } = parseScoreImport(text, ['studentId', 'realName', 'year']);
        let imported = 0;
        const rowErrors: string[] = [...errors];
        for (const r of rows) {
            const year = parseInt(r.year, 10);
            if (!year || year < 1900 || year > 2099) {
                rowErrors.push(`学号 ${r.studentId}: 年份无效`);
                continue;
            }
            const res = await taskModel.addManualStayEvent(
                domainId, schoolId, r.studentId, r.realName, year, this.user._id,
            );
            if (!res.ok) rowErrors.push(`学号 ${r.studentId}: ${'reason' in res ? res.reason : '添加失败'}`);
            else imported++;
        }
        this.response.body = { success: true, imported, errors: rowErrors };
    }

    @param('id', Types.ObjectId)
    async postStayDelete({ domainId }: { domainId: string }, id: ObjectId) {
        await taskModel.deleteStayEvent(domainId, id);
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
    // Problem search endpoint MUST be registered before :tid/edit etc., since
    // Hydro's router won't try /admin/tasks/api/problems/search against the
    // ObjectId param regex — but defensive ordering avoids future confusion.
    ctx.Route('admin_tasks_api_problems', '/admin/tasks/api/problems/search', AdminTasksProblemSearchHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_edit', '/admin/tasks/:tid/edit', AdminTasksEditHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_assign', '/admin/tasks/:tid/assign', AdminTasksAssignHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_override', '/admin/tasks/:tid/override', AdminTasksOverrideHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_candidates', '/admin/tasks/:tid/candidates', AdminTasksCandidatesHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_stats', '/admin/tasks/:tid/stats', AdminTasksStatsHandler, PRIV.PRIV_USER_PROFILE);

    ctx.Route('admin_tasks_scores', '/admin/tasks/scores', AdminScoresHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('admin_tasks_settings', '/admin/tasks/settings', AdminSettingsHandler, PRIV.PRIV_USER_PROFILE);
}
