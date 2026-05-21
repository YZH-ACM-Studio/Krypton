/**
 * Task system model — CRUD, assignment lifecycle, completion check.
 *
 * Most write methods do NOT check permissions — that's the caller's
 * responsibility (handlers use `canModifyTask` from ./auth).
 *
 * Key behaviors:
 *   - `checkTaskCompletion` is the single entry point that turns "raw" check
 *      results into stored progress + flips assignment status when applicable.
 *      Honors admin manual overrides recorded as `result.overridden=true`.
 *   - `assignTask` upgrades an existing self-claim to admin-locked when called
 *      with assignedBy !== 0 (i.e., admin assign). It does NOT downgrade.
 *   - Cancellation refuses to operate on `completed` assignments.
 */
import { NotFoundError, ObjectId, PermissionError } from 'hydrooj';
import {
    assignmentsColl, auditColl, settingsColl, tasksColl,
} from './db';
import { runChecker, taskPointPresets } from './presets';
import type {
    AuditLogDoc, DomainSettingsDoc, TaskAssignmentDoc, TaskDoc, TaskPointResult,
} from './types';
import { DEFAULT_DOMAIN_SETTINGS } from './types';

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
        points: task.points || [],
        condition: task.condition || { type: 'all' },
        access: task.access || { type: 'public' },
        isActive: task.isActive ?? true,
        startDate: task.startDate || null,
        endDate: task.endDate || null,
        maxAssignments: task.maxAssignments || null,
        currentAssignments: 0,
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
        points: src.points,
        condition: src.condition,
        access: src.access,
        isActive: false,
        startDate: null,
        endDate: null,
        maxAssignments: src.maxAssignments,
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

// ============ Completion check ============

/**
 * Recompute progress for one assignment. Honors per-point admin overrides:
 * if a stored progress entry has `overridden=true`, the live checker is NOT
 * called for that point — the override is preserved.
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

    // If the assignment is already completed, just re-evaluate the cached snapshot —
    // completed is terminal, we never re-pull live data (Q10).
    if (a.status === 'completed') {
        return { conditionMet: true, progress: a.progress || {} };
    }
    // If task is inactive, freeze: return cached progress, no recompute.
    if (!task.isActive && !opts.force) {
        return {
            conditionMet: evaluateCondition(task, a.progress || {}),
            progress: a.progress || {},
        };
    }

    const progress: Record<string, TaskPointResult> = {};
    for (const point of task.points) {
        const stored = a.progress?.[point.id];
        if (stored?.overridden) {
            progress[point.id] = stored; // keep admin override
            continue;
        }
        progress[point.id] = await runChecker(point.presetId, {
            userId: a.userId,
            domainId,
            startDate: task.startDate || undefined,
            endDate: task.endDate || undefined,
        }, point.params);
    }

    const conditionMet = evaluateCondition(task, progress);
    const update: any = { progress, progressUpdatedAt: new Date() };
    if (conditionMet && a.status === 'pending') {
        update.status = 'completed';
        update.completedAt = new Date();
    }
    await assignmentsColl.updateOne({ _id: a._id }, { $set: update });
    return { conditionMet, progress };
}

function evaluateCondition(
    task: TaskDoc,
    progress: Record<string, TaskPointResult>,
): boolean {
    if (!task.points.length) return false;
    if (task.condition.type === 'all') {
        return task.points.every((p) => progress[p.id]?.completed);
    }
    for (const g of task.condition.groups) {
        const done = g.points.filter((pid) => progress[pid]?.completed).length;
        if (done < g.require) return false;
    }
    return true;
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
    const point = task.points.find((p) => p.id === pointId);
    if (!point) throw new NotFoundError('任务点不存在');

    const before = a.progress?.[pointId] || null;
    const after: TaskPointResult = {
        completed,
        current: completed ? 1 : 0,
        target: 1,
        details: completed ? `管理员手动判定为完成${reason ? `（${reason}）` : ''}` : `管理员撤销完成判定${reason ? `（${reason}）` : ''}`,
        overridden: true,
    };

    const newProgress = { ...(a.progress || {}), [pointId]: after };
    const conditionMet = evaluateCondition(task, newProgress);
    const update: any = { progress: newProgress, progressUpdatedAt: new Date() };
    if (conditionMet && a.status === 'pending') {
        update.status = 'completed';
        update.completedAt = new Date();
    }
    await assignmentsColl.updateOne({ _id: a._id }, { $set: update });

    const audit: AuditLogDoc = {
        _id: new ObjectId(),
        domainId,
        assignmentId,
        taskId: a.taskId,
        pointId,
        adminUid,
        before,
        after,
        reason,
        createdAt: new Date(),
    };
    await auditColl.insertOne(audit);
}

async function listAuditForTask(
    domainId: string,
    taskId: ObjectId,
    limit = 100,
): Promise<AuditLogDoc[]> {
    return auditColl.find({ domainId, taskId })
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
 */
async function markUserAssignmentsStale(domainId: string, userId: number): Promise<void> {
    await assignmentsColl.updateMany(
        { domainId, userId, status: 'pending' },
        { $set: { progressUpdatedAt: null } },
    );
}

// ============ exported model ============

export const taskModel = {
    presets: taskPointPresets,
    // CRUD
    createTask, getTask, listTasks, updateTask, deleteTask, cloneTask,
    // assignment
    assignTask, cancelAssignment, getUserAssignments, getTaskAssignments, getAssignment,
    // check
    checkTaskCompletion, evaluateCondition,
    // override / audit
    overridePointCompletion, listAuditForTask,
    // settings
    getDomainSettings, setDomainSettings,
    // hooks
    markUserAssignmentsStale,
};
