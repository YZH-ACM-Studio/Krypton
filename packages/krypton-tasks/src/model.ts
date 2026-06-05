/**
 * Task system model — CRUD, assignment lifecycle, graph-based completion check.
 *
 * Most write methods do NOT check permissions — that's the caller's
 * responsibility (handlers use `canModifyTask` from ./auth).
 *
 * Key behaviors:
 *   - `checkTaskCompletion` is the single entry point that turns raw checker
 *      results into stored progress + advances the assignment state machine.
 *      Honors admin manual overrides (`result.overridden=true`).
 *   - `evaluateGraph` walks the task graph DFS — task complete iff *any*
 *      path from START to END has every internal task-node `done`.
 *   - Admission state machine (admissionMode='quota' only):
 *        pending → qualified → admitted → completed
 *      `admitAssignment` / `unadmitAssignment` toggle the middle hop;
 *      `confirmAssignment` makes it terminal and triggers stay events.
 *   - Qualified is monotone: once qualifiedAt is set, subsequent re-evals
 *      don't clear it. Admin must explicitly cancel the assignment to undo.
 *   - `assignTask` upgrades an existing self-claim to admin-locked when called
 *      with assignedBy !== 0 (admin assign); it does NOT downgrade.
 *   - Cancellation refuses to operate on `completed` assignments.
 */
import { NotFoundError, ObjectId, PermissionError } from 'hydrooj';
import { userBindModel } from '@hydrooj/krypton-userbind';
import {
    assignmentsColl, auditColl, settingsColl, stayEventsColl, tasksColl,
} from './db';
import { runChecker, taskPointPresets } from './presets';
import type {
    AuditEventType, AuditLogDoc, DomainSettingsDoc, StayEventDoc,
    TaskAssignmentDoc, TaskDoc, TaskGraph, TaskPointResult,
} from './types';
import { DEFAULT_DOMAIN_SETTINGS, emptyTaskGraph } from './types';

// ============ Tasks CRUD ============

async function createTask(
    domainId: string,
    createdBy: number,
    task: Partial<TaskDoc>,
): Promise<ObjectId> {
    const now = new Date();
    const doc: TaskDoc = {
        _id: new ObjectId(),
        domainId,
        title: task.title || '',
        description: task.description || '',
        tags: task.tags || [],
        graph: task.graph || emptyTaskGraph(),
        access: task.access || { type: 'public' },
        isActive: task.isActive ?? true,
        startDate: task.startDate || null,
        endDate: task.endDate || null,
        claimStartAt: task.claimStartAt || null,
        claimEndAt: task.claimEndAt || null,
        maxAssignments: task.maxAssignments || null,
        currentAssignments: 0,
        countsAsStay: !!task.countsAsStay,
        admissionMode: task.admissionMode || 'auto',
        quota: typeof task.quota === 'number' ? task.quota : null,
        createdAt: now,
        updatedAt: now,
        createdBy,
    };
    await tasksColl.insertOne(doc);
    return doc._id;
}

async function getTask(domainId: string, taskId: ObjectId): Promise<TaskDoc | null> {
    return tasksColl.findOne({ domainId, _id: taskId });
}

async function listTasks(
    domainId: string,
    filter: any = {},
    page = 1,
    pageSize = 30,
): Promise<{ docs: TaskDoc[]; count: number; page: number; pageSize: number }> {
    const query = { domainId, ...filter };
    const [docs, count] = await Promise.all([
        tasksColl.find(query).sort({ _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
        tasksColl.countDocuments(query),
    ]);
    return { docs, count, page, pageSize };
}

async function updateTask(
    domainId: string,
    taskId: ObjectId,
    update: Partial<TaskDoc>,
): Promise<void> {
    const { _id: _, ...rest } = update as any;
    await tasksColl.updateOne(
        { domainId, _id: taskId },
        { $set: { ...rest, updatedAt: new Date() } },
    );
}

async function deleteTask(domainId: string, taskId: ObjectId): Promise<void> {
    await tasksColl.deleteOne({ domainId, _id: taskId });
    await assignmentsColl.deleteMany({ domainId, taskId });
    await auditColl.deleteMany({ domainId, taskId });
}

async function cloneTask(
    domainId: string,
    sourceId: ObjectId,
    actorUid: number,
): Promise<ObjectId | null> {
    const src = await getTask(domainId, sourceId);
    if (!src) return null;
    return createTask(domainId, actorUid, {
        title: `${src.title} (副本)`,
        description: src.description,
        tags: src.tags,
        graph: JSON.parse(JSON.stringify(src.graph)) as TaskGraph,
        access: src.access,
        isActive: false,
        startDate: null,
        endDate: null,
        claimStartAt: null,
        claimEndAt: null,
        maxAssignments: src.maxAssignments,
        countsAsStay: src.countsAsStay,
        admissionMode: src.admissionMode,
        quota: src.quota,
    });
}

// ============ Assignment lifecycle ============

async function assignTask(
    domainId: string,
    taskId: ObjectId,
    userId: number,
    assignedBy: number,
    note = '',
): Promise<ObjectId> {
    const existing = await assignmentsColl.findOne({
        domainId,
        taskId,
        userId,
        status: { $ne: 'cancelled' },
    });
    if (existing) {
        // Admin re-assign locks an existing self-claim, but doesn't downgrade.
        if (assignedBy !== 0 && existing.canCancel) {
            await assignmentsColl.updateOne(
                { _id: existing._id },
                { $set: { canCancel: false, assignedBy, note: note || existing.note } },
            );
        }
        return existing._id;
    }
    const task = await getTask(domainId, taskId);
    if (!task) throw new NotFoundError('任务不存在');
    if (task.maxAssignments && task.currentAssignments >= task.maxAssignments) {
        throw new Error('该任务认领数已满');
    }
    const doc: TaskAssignmentDoc = {
        _id: new ObjectId(),
        domainId,
        taskId,
        userId,
        assignedBy,
        assignedAt: new Date(),
        canCancel: assignedBy === 0,
        status: 'pending',
        completedAt: null,
        progress: {},
        progressUpdatedAt: null,
        note,
        qualifiedAt: null,
        admittedAt: null,
        admittedBy: 0,
        admissionNote: '',
        confirmedAt: null,
        confirmedBy: 0,
    };
    await assignmentsColl.insertOne(doc);
    await tasksColl.updateOne({ _id: taskId }, { $inc: { currentAssignments: 1 } });
    return doc._id;
}

async function cancelAssignment(
    domainId: string,
    assignmentId: ObjectId,
    actorUid: number,
): Promise<void> {
    const a = await assignmentsColl.findOne({ _id: assignmentId, domainId });
    if (!a) throw new NotFoundError('任务分配不存在');
    if (a.userId !== actorUid) throw new PermissionError('无权操作');
    if (!a.canCancel) throw new Error('该任务由管理员分配，无法取消');
    if (a.status === 'completed') throw new Error('已完成的任务无法取消');
    await assignmentsColl.updateOne(
        { _id: assignmentId },
        { $set: { status: 'cancelled' } },
    );
    await tasksColl.updateOne({ _id: a.taskId }, { $inc: { currentAssignments: -1 } });
}

async function getUserAssignments(
    domainId: string,
    userId: number,
    filter: any = {},
): Promise<TaskAssignmentDoc[]> {
    return assignmentsColl.find({ domainId, userId, ...filter }).sort({ _id: -1 }).toArray();
}

async function getTaskAssignments(
    domainId: string,
    taskId: ObjectId,
    filter: any = {},
): Promise<TaskAssignmentDoc[]> {
    return assignmentsColl.find({ domainId, taskId, ...filter }).toArray();
}

async function getAssignment(
    domainId: string,
    assignmentId: ObjectId,
): Promise<TaskAssignmentDoc | null> {
    return assignmentsColl.findOne({ domainId, _id: assignmentId });
}

// ============ Graph evaluator ============

/**
 * Returns true iff there exists a path from START to END such that every
 * internal `task` node on the path has `progress[node.id].completed === true`.
 *
 * Start/end sentinels are always traversable. Cycles (which shouldn't exist
 * in a valid DAG) are broken by a visited-set; the evaluator runs in O(V+E).
 */
export function evaluateGraph(
    graph: TaskGraph,
    progress: Record<string, TaskPointResult>,
): boolean {
    if (!graph || !graph.nodes?.length) return false;
    const start = graph.nodes.find((n) => n.type === 'start');
    const end = graph.nodes.find((n) => n.type === 'end');
    if (!start || !end) return false;
    if (start.id === end.id) return false; // pathological

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const adj = new Map<string, string[]>();
    for (const e of graph.edges || []) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from)!.push(e.to);
    }

    const visited = new Set<string>();
    function dfs(nodeId: string): boolean {
        if (nodeId === end.id) return true;
        if (visited.has(nodeId)) return false;
        visited.add(nodeId);
        const nexts = adj.get(nodeId) || [];
        for (const nextId of nexts) {
            const nextNode = nodeById.get(nextId);
            if (!nextNode) continue;
            if (nextNode.type === 'task') {
                // Gate: must be done to step through.
                const r = progress[nextNode.id];
                if (!r?.completed) continue;
            }
            if (dfs(nextId)) return true;
        }
        return false;
    }
    return dfs(start.id);
}

// ============ Completion check ============

/**
 * Recompute progress for one assignment. Honors per-point admin overrides:
 * if a stored progress entry has `overridden=true`, the live checker is NOT
 * called for that node — the override is preserved.
 *
 * State transitions:
 *   - admissionMode='auto':  pending → completed when graph satisfies.
 *   - admissionMode='quota': pending → qualified when graph satisfies;
 *                             qualified/admitted/completed are admin-driven.
 *
 * Once an assignment is qualified, recompute is short-circuited (qualified
 * is monotone — see top-of-file note in ./types.ts).
 *
 * Skips recompute (returns cached) when the task is inactive — already-claimed
 * users keep their last snapshot.
 */
async function checkTaskCompletion(
    domainId: string,
    assignmentId: ObjectId,
    opts: { force?: boolean } = {},
): Promise<{ conditionMet: boolean; progress: Record<string, TaskPointResult> }> {
    const a = await assignmentsColl.findOne({ _id: assignmentId, domainId });
    if (!a) throw new NotFoundError('任务分配不存在');
    const task = await getTask(domainId, a.taskId);
    if (!task) throw new NotFoundError('任务不存在');

    // Terminal — never re-pull live data for completed assignments.
    if (a.status === 'completed') {
        return { conditionMet: true, progress: a.progress || {} };
    }
    // Quota-mode states (qualified / admitted) are admin-managed; checker
    // doesn't move them backwards or forwards. We do still refresh `progress`
    // for the stats display but skip status changes.
    const isQuotaAdvancedState = task.admissionMode === 'quota'
        && (a.status === 'qualified' || a.status === 'admitted');

    // If task is inactive, freeze: return cached, no recompute (unless force).
    if (!task.isActive && !opts.force) {
        return {
            conditionMet: evaluateGraph(task.graph, a.progress || {}),
            progress: a.progress || {},
        };
    }

    const progress: Record<string, TaskPointResult> = {};
    for (const node of task.graph.nodes) {
        if (node.type !== 'task' || !node.presetId) continue;
        const stored = a.progress?.[node.id];
        if (stored?.overridden) {
            progress[node.id] = stored; // keep admin override
            continue;
        }
        progress[node.id] = await runChecker(node.presetId, {
            userId: a.userId,
            domainId,
            startDate: task.startDate || undefined,
            endDate: task.endDate || undefined,
        }, node.params || {});
    }

    const conditionMet = evaluateGraph(task.graph, progress);
    const update: any = { progress, progressUpdatedAt: new Date() };

    if (!isQuotaAdvancedState && a.status === 'pending' && conditionMet) {
        if (task.admissionMode === 'auto') {
            update.status = 'completed';
            update.completedAt = new Date();
            update.confirmedAt = new Date();
            update.confirmedBy = 0; // 0 = system (auto mode)
            await maybeAwardStayEvent(task, a);
        } else {
            // quota: enter the candidate pool.
            update.status = 'qualified';
            update.qualifiedAt = new Date();
        }
    }

    await assignmentsColl.updateOne({ _id: a._id }, { $set: update });
    return { conditionMet, progress };
}

/**
 * Awards a stay event if the task is marked `countsAsStay`. Idempotent via
 * the `(domainId, userId, source)` unique index — duplicate inserts throw a
 * duplicate-key error which we swallow silently. Once awarded, never withdrawn.
 *
 * Note (v2): only called from `confirmAssignment` (admin-confirmed) or the
 * `auto` admission path inside `checkTaskCompletion`. Admit-without-confirm
 * does NOT award — by design, the two-stage flow gives admins a window to
 * revoke before any side-effect fires.
 */
async function maybeAwardStayEvent(
    task: TaskDoc, assignment: TaskAssignmentDoc,
): Promise<void> {
    if (!task.countsAsStay) return;
    const source = `task:${assignment._id.toHexString()}`;
    const doc: StayEventDoc = {
        _id: new ObjectId(),
        domainId: assignment.domainId,
        userId: assignment.userId,
        year: new Date().getFullYear(),
        source,
        createdAt: new Date(),
        createdBy: 0,
    };
    try {
        await stayEventsColl.insertOne(doc);
    } catch (e: any) {
        // Code 11000 = duplicate key. Anything else: re-throw.
        if (e?.code !== 11000) throw e;
    }
}

// ============ Admission state machine (quota mode) ============

async function writeAudit(row: {
    domainId: string;
    assignmentId: ObjectId | null;
    taskId: ObjectId;
    eventType: AuditEventType;
    adminUid: number;
    pointId?: string;
    before?: any;
    after?: any;
    reason?: string;
}): Promise<void> {
    const audit: AuditLogDoc = {
        _id: new ObjectId(),
        domainId: row.domainId,
        assignmentId: row.assignmentId,
        taskId: row.taskId,
        eventType: row.eventType,
        adminUid: row.adminUid,
        ...(row.pointId ? { pointId: row.pointId } : {}),
        ...(row.before !== undefined ? { before: row.before } : {}),
        ...(row.after !== undefined ? { after: row.after } : {}),
        reason: row.reason || '',
        createdAt: new Date(),
    };
    await auditColl.insertOne(audit);
}

/**
 * Admin admit (quota mode only). qualified → admitted.
 * Does NOT trigger side effects (stay event) — wait for confirm.
 */
async function admitAssignment(
    domainId: string,
    assignmentId: ObjectId,
    adminUid: number,
    note = '',
): Promise<void> {
    const a = await assignmentsColl.findOne({ _id: assignmentId, domainId });
    if (!a) throw new NotFoundError('任务分配不存在');
    const task = await getTask(domainId, a.taskId);
    if (!task) throw new NotFoundError('任务不存在');
    if (task.admissionMode !== 'quota') {
        throw new Error('该任务非配额模式，无需 admit');
    }
    if (a.status !== 'qualified') {
        throw new Error(`只能 admit 状态为 qualified 的分配（当前 ${a.status}）`);
    }
    await assignmentsColl.updateOne(
        { _id: assignmentId },
        {
            $set: {
                status: 'admitted',
                admittedAt: new Date(),
                admittedBy: adminUid,
                admissionNote: note,
            },
        },
    );
    await writeAudit({
        domainId, assignmentId, taskId: a.taskId,
        eventType: 'admit', adminUid, reason: note,
        before: { status: 'qualified' },
        after: { status: 'admitted', admittedBy: adminUid },
    });
}

/**
 * Admin unadmit (quota mode only). admitted → qualified.
 * No stay event has been written yet (those wait for confirm), so this is
 * cleanly reversible.
 */
async function unadmitAssignment(
    domainId: string,
    assignmentId: ObjectId,
    adminUid: number,
    reason = '',
): Promise<void> {
    const a = await assignmentsColl.findOne({ _id: assignmentId, domainId });
    if (!a) throw new NotFoundError('任务分配不存在');
    if (a.status !== 'admitted') {
        throw new Error(`只能 unadmit 状态为 admitted 的分配（当前 ${a.status}）`);
    }
    await assignmentsColl.updateOne(
        { _id: assignmentId },
        {
            $set: {
                status: 'qualified',
                admittedAt: null,
                admittedBy: 0,
                admissionNote: '',
            },
        },
    );
    await writeAudit({
        domainId, assignmentId, taskId: a.taskId,
        eventType: 'unadmit', adminUid, reason,
        before: { status: 'admitted', admittedBy: a.admittedBy },
        after: { status: 'qualified' },
    });
}

/**
 * Admin confirm (quota mode only). admitted → completed.
 * TERMINAL. Triggers stay event (idempotent). Cannot be undone (admin must
 * manually delete the stay event row if a true correction is needed).
 */
async function confirmAssignment(
    domainId: string,
    assignmentId: ObjectId,
    adminUid: number,
    reason = '',
): Promise<void> {
    const a = await assignmentsColl.findOne({ _id: assignmentId, domainId });
    if (!a) throw new NotFoundError('任务分配不存在');
    const task = await getTask(domainId, a.taskId);
    if (!task) throw new NotFoundError('任务不存在');
    if (task.admissionMode !== 'quota') {
        throw new Error('该任务非配额模式，无需 confirm');
    }
    if (a.status !== 'admitted') {
        throw new Error(`只能 confirm 状态为 admitted 的分配（当前 ${a.status}）`);
    }
    const now = new Date();
    await assignmentsColl.updateOne(
        { _id: assignmentId },
        {
            $set: {
                status: 'completed',
                completedAt: now,
                confirmedAt: now,
                confirmedBy: adminUid,
            },
        },
    );
    await maybeAwardStayEvent(task, a);
    await writeAudit({
        domainId, assignmentId, taskId: a.taskId,
        eventType: 'confirm', adminUid, reason,
        before: { status: 'admitted' },
        after: { status: 'completed', confirmedBy: adminUid },
    });
}

// ============ Admin overrides ============

async function overridePointCompletion(
    domainId: string,
    assignmentId: ObjectId,
    pointId: string,
    adminUid: number,
    reason: string,
    completed: boolean,
): Promise<void> {
    const a = await assignmentsColl.findOne({ _id: assignmentId, domainId });
    if (!a) throw new NotFoundError('任务分配不存在');
    const task = await getTask(domainId, a.taskId);
    if (!task) throw new NotFoundError('任务不存在');
    const node = task.graph.nodes.find((n) => n.id === pointId && n.type === 'task');
    if (!node) throw new NotFoundError('任务点不存在');

    const before = a.progress?.[pointId] || null;
    const after: TaskPointResult = {
        completed,
        current: completed ? 1 : 0,
        target: 1,
        details: completed ? `管理员手动判定为完成${reason ? `（${reason}）` : ''}` : `管理员撤销完成判定${reason ? `（${reason}）` : ''}`,
        overridden: true,
    };

    const newProgress = { ...(a.progress || {}), [pointId]: after };
    const conditionMet = evaluateGraph(task.graph, newProgress);
    const update: any = { progress: newProgress, progressUpdatedAt: new Date() };

    // Mirror the auto/quota state-machine from checkTaskCompletion.
    if (a.status === 'pending' && conditionMet) {
        if (task.admissionMode === 'auto') {
            update.status = 'completed';
            update.completedAt = new Date();
            update.confirmedAt = new Date();
            update.confirmedBy = 0;
            await maybeAwardStayEvent(task, a);
        } else {
            update.status = 'qualified';
            update.qualifiedAt = new Date();
        }
    }
    await assignmentsColl.updateOne({ _id: a._id }, { $set: update });

    await writeAudit({
        domainId, assignmentId, taskId: a.taskId,
        eventType: 'override', adminUid,
        pointId, reason,
        before, after,
    });
}

async function listAuditForTask(
    domainId: string,
    taskId: ObjectId,
    limit = 100,
): Promise<AuditLogDoc[]> {
    return auditColl.find({ domainId, taskId })
        .sort({ createdAt: -1 }).limit(limit).toArray();
}

async function listAuditForAssignment(
    domainId: string,
    assignmentId: ObjectId,
    limit = 100,
): Promise<AuditLogDoc[]> {
    return auditColl.find({ domainId, assignmentId })
        .sort({ createdAt: -1 }).limit(limit).toArray();
}

// ============ Per-domain settings ============

async function getDomainSettings(domainId: string): Promise<DomainSettingsDoc> {
    const found = await settingsColl.findOne({ domainId });
    if (found) return found;
    return {
        _id: new ObjectId(),
        domainId,
        ...DEFAULT_DOMAIN_SETTINGS,
        updatedAt: new Date(0),
        updatedBy: 0,
    };
}

async function setDomainSettings(
    domainId: string,
    update: Partial<DomainSettingsDoc>,
    actorUid: number,
): Promise<void> {
    const safe: any = {};
    if (typeof update.maxPatScore === 'number') safe.maxPatScore = Math.max(0, update.maxPatScore);
    if (typeof update.maxGpltScore === 'number') safe.maxGpltScore = Math.max(0, update.maxGpltScore);
    if (typeof update.maxCspScore === 'number') safe.maxCspScore = Math.max(0, update.maxCspScore);
    safe.updatedAt = new Date();
    safe.updatedBy = actorUid;
    await settingsColl.updateOne(
        { domainId },
        { $set: safe, $setOnInsert: { _id: new ObjectId(), domainId } },
        { upsert: true },
    );
}

// ============ Event hooks ============

/**
 * Mark all pending assignments of `userId` as stale — to be recomputed at
 * next view or by an explicit recompute call. Cheap (no checker runs here).
 *
 * Note: only 'pending' status is marked — qualified/admitted/completed are
 * past the auto-recompute fence and stay frozen.
 */
async function markUserAssignmentsStale(domainId: string, userId: number): Promise<void> {
    await assignmentsColl.updateMany(
        { domainId, userId, status: 'pending' },
        { $set: { progressUpdatedAt: null } },
    );
}

// ============ Stay events (留校次数) ============

/**
 * Insert a manually-entered stay event for a user. Resolves the user via
 * (schoolId, studentId, realName) against userbind, then writes a row with
 * `source = 'manual:<random>'`.
 *
 * Repeated calls for the same user/year produce multiple events — each row
 * counts as +1. Bulk paste handlers should loop this function row by row;
 * the unique index on `source` only blocks duplicate `task:*` entries, not
 * manual entries (each `manual:*` insert generates a fresh source string).
 */
async function addManualStayEvent(
    domainId: string,
    schoolId: ObjectId,
    studentId: string,
    realName: string,
    year: number,
    adminUid: number,
): Promise<{ ok: true; userId: number } | { ok: false; reason: string }> {
    const student = await userBindModel.findStudentByStudentId(domainId, schoolId, studentId);
    if (!student) return { ok: false, reason: '学生档案不存在' };
    if (student.realName !== realName) {
        return { ok: false, reason: `姓名不匹配（档案内"${student.realName}"）` };
    }
    if (!student.boundUserId) return { ok: false, reason: '学生未绑定 OJ 账号' };
    const source = `manual:${new ObjectId().toHexString()}`;
    await stayEventsColl.insertOne({
        _id: new ObjectId(),
        domainId,
        userId: student.boundUserId,
        year,
        source,
        createdAt: new Date(),
        createdBy: adminUid,
    });
    await markUserAssignmentsStale(domainId, student.boundUserId);
    return { ok: true, userId: student.boundUserId };
}

async function listStayEvents(
    domainId: string,
    filter: { userId?: number; year?: number } = {},
): Promise<StayEventDoc[]> {
    const q: any = { domainId };
    if (filter.userId) q.userId = filter.userId;
    if (filter.year) q.year = filter.year;
    return stayEventsColl.find(q).sort({ createdAt: -1 }).limit(500).toArray();
}

async function countStayEvents(domainId: string, userId: number): Promise<number> {
    return stayEventsColl.countDocuments({ domainId, userId });
}

async function deleteStayEvent(domainId: string, id: ObjectId): Promise<void> {
    const doc = await stayEventsColl.findOne({ domainId, _id: id });
    await stayEventsColl.deleteOne({ domainId, _id: id });
    if (doc?.userId) await markUserAssignmentsStale(domainId, doc.userId);
}

// ============ exported model ============

export const taskModel = {
    presets: taskPointPresets,
    emptyTaskGraph,
    // CRUD
    createTask, getTask, listTasks, updateTask, deleteTask, cloneTask,
    // assignment
    assignTask, cancelAssignment, getUserAssignments, getTaskAssignments, getAssignment,
    // check
    checkTaskCompletion, evaluateGraph,
    // admission (quota mode)
    admitAssignment, unadmitAssignment, confirmAssignment,
    // override / audit
    overridePointCompletion, listAuditForTask, listAuditForAssignment, writeAudit,
    // settings
    getDomainSettings, setDomainSettings,
    // stay events
    addManualStayEvent, listStayEvents, countStayEvents, deleteStayEvent,
    // hooks
    markUserAssignmentsStale,
};
