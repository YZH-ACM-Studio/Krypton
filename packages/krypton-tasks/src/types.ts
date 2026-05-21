/**
 * Type definitions for @hydrooj/krypton-tasks.
 *
 * Design summary (full doc lives in commit history of the grill session):
 *
 *  - Tasks are per-domain. A Task = title + description + tags + points[]
 *    + condition + access + lifecycle. Each task point references a
 *    preset by id, with preset-specific params (see ./presets.ts).
 *
 *  - Assignments bind a user to a task. `canCancel=false` marks
 *    admin-assigned (locked) vs. self-claimed (cancelable, unless completed).
 *    `progress` is cached per task-point; completion is recomputed lazily
 *    on view, via the manual recheck button, and via cordis hooks
 *    (record judge / contest attend / paper finalize).
 *
 *  - Access is single-condition (public / user_group / school). The "current
 *    member of a user_group / school" preset is an independent point type.
 *
 *  - Admin manual override of a single point completion is allowed; every
 *    such override writes an audit log row.
 *
 *  - PAT/GPLT/CSP scores are independent collections fed by admin (paste
 *    import or single entry). Per-domain max-score settings bound their
 *    valid range.
 */
import type { ObjectId } from 'mongodb';

// ============ Task definitions ============

export interface TaskPoint {
    /** Stable per-task id (random string), referenced by `condition.groups[].points`. */
    id: string;
    presetId: string;
    /** Human override of the preset's default name. */
    name: string;
    params: Record<string, any>;
}

export interface TaskConditionGroup {
    /** TaskPoint.id values that belong to this group. */
    points: string[];
    /** Minimum number of points in `points` that must be completed for the group to count. */
    require: number;
}

export type TaskCondition =
    | { type: 'all' }
    | { type: 'groups'; groups: TaskConditionGroup[] };

/**
 * Who is allowed to *see* (and therefore self-claim) the task. Single rule.
 * Admin can always see, regardless of access.
 */
export type TaskAccess =
    | { type: 'public' }
    | { type: 'user_group'; targetId: ObjectId }
    | { type: 'school'; targetId: ObjectId };

export interface TaskDoc {
    _id: ObjectId;
    domainId: string;
    title: string;
    description: string;
    tags: string[];
    points: TaskPoint[];
    condition: TaskCondition;
    access: TaskAccess;
    isActive: boolean;
    startDate: Date | null;
    endDate: Date | null;
    maxAssignments: number | null;
    currentAssignments: number;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
}

// ============ Assignments ============

export interface TaskPointResult {
    completed: boolean;
    current: number;
    target: number;
    details?: string;
    /** True if this point's completion was forced by an admin override. */
    overridden?: boolean;
}

export type AssignmentStatus = 'pending' | 'completed' | 'cancelled';

export interface TaskAssignmentDoc {
    _id: ObjectId;
    domainId: string;
    taskId: ObjectId;
    userId: number;
    /** 0 = self-claim; otherwise the admin uid that assigned it. */
    assignedBy: number;
    assignedAt: Date;
    canCancel: boolean;
    status: AssignmentStatus;
    completedAt: Date | null;
    /** Cached progress per TaskPoint.id. Recomputed by checkTaskCompletion. */
    progress: Record<string, TaskPointResult>;
    /** Last time progress was recomputed (used for "stale" indicators). */
    progressUpdatedAt: Date | null;
    /** Admin-set note shown to the user. */
    note: string;
}

// ============ Audit ============

export interface AuditLogDoc {
    _id: ObjectId;
    domainId: string;
    assignmentId: ObjectId;
    taskId: ObjectId;
    /** TaskPoint.id that was overridden. */
    pointId: string;
    /** uid that performed the override. */
    adminUid: number;
    /** Snapshot of the result before the override. */
    before: TaskPointResult | null;
    /** Snapshot of the result after the override (with overridden=true). */
    after: TaskPointResult;
    reason: string;
    createdAt: Date;
}

// ============ Per-domain settings ============

export interface DomainSettingsDoc {
    _id: ObjectId;
    domainId: string;
    /** Inclusive upper bounds for score entry. */
    maxPatScore: number;
    maxGpltScore: number;
    maxCspScore: number;
    updatedAt: Date;
    updatedBy: number;
}

export const DEFAULT_DOMAIN_SETTINGS = {
    maxPatScore: 100,
    maxGpltScore: 290,
    maxCspScore: 500,
};

// ============ Contest score documents ============

export type PatLevel = 'advanced' | 'basic';
export type PatSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type GpltLevel = 'school' | 'national';

export interface PatScoreDoc {
    _id: ObjectId;
    domainId: string;
    userId: number;
    level: PatLevel;
    year: number;
    season: PatSeason;
    score: number;
    createdAt: Date;
    createdBy: number;
    updatedAt?: Date;
    updatedBy?: number;
}

export interface GpltScoreDoc {
    _id: ObjectId;
    domainId: string;
    userId: number;
    level: GpltLevel;
    year: number;
    score: number;
    rank: number | null;
    createdAt: Date;
    createdBy: number;
    updatedAt?: Date;
    updatedBy?: number;
}

export interface CspScoreDoc {
    _id: ObjectId;
    domainId: string;
    userId: number;
    round: number;
    score: number;
    createdAt: Date;
    createdBy: number;
    updatedAt?: Date;
    updatedBy?: number;
}

// ============ Preset registry types ============

export interface TaskPointParamSchema {
    name: string;
    type:
        | 'number'
        | 'string'
        | 'date'
        | 'select'
        | 'problem'
        | 'contest'
        | 'user_group'
        | 'school'
        | 'homework'
        | 'training'
        | 'pat_level'
        | 'pat_season'
        | 'gplt_level'
        | 'aggregate';
    label: string;
    required?: boolean;
    default?: any;
    /** For type='select'. */
    options?: Array<{ value: string; label: string }>;
    helper?: string;
}

export interface TaskCheckerContext {
    userId: number;
    domainId: string;
    /** Inherited from the parent task's lifecycle window — checkers may use as default range. */
    startDate?: Date;
    endDate?: Date;
}

export interface TaskPointPreset {
    id: string;
    name: string;
    description: string;
    params: TaskPointParamSchema[];
    checker(ctx: TaskCheckerContext, params: Record<string, any>): Promise<TaskPointResult>;
}

// ============ MongoDB module augmentation ============

declare module 'hydrooj' {
    interface Collections {
        'tasks.tasks': TaskDoc;
        'tasks.assignments': TaskAssignmentDoc;
        'tasks.audit': AuditLogDoc;
        'tasks.settings': DomainSettingsDoc;
        'tasks.score_pat': PatScoreDoc;
        'tasks.score_gplt': GpltScoreDoc;
        'tasks.score_csp': CspScoreDoc;
    }

    interface Model {
        tasks: typeof import('./model').taskModel;
    }
}
