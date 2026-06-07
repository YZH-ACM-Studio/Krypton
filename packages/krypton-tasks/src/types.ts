/**
 * Type definitions for @hydrooj/krypton-tasks.
 *
 * Design summary (v2 — graph-based, grilled 2026-05-25):
 *
 *  - A Task is a directed acyclic graph with a unique START sentinel and a
 *    unique END sentinel. Internal nodes are task points: each references a
 *    preset (`presetId`) plus per-instance params; preset metadata classifies
 *    it as `behavior` (user must do something) or `condition` (auto-judged
 *    from user attributes — grade, group, school, …).
 *
 *  - Completion semantics = "any path from START to END such that every
 *    internal node on that path is `done`". Edges are path options
 *    (OR semantics for branches), serial chains are AND (every node on the
 *    chain must be done). See `evaluateGraph` in ./model.ts.
 *
 *  - K-of-N is handled at the preset level (e.g. `ac_count.count=5`); the
 *    grill traded K-of-N at the graph level for path-clarity. A future
 *    "aggregate" composite-node type was left as a v2 stub but is not
 *    implemented in this batch.
 *
 *  - Admission flow: `admissionMode` is per-task. `auto` (default) flips an
 *    assignment to `completed` as soon as the graph is satisfied. `quota`
 *    inserts a two-stage gate — graph-satisfied → `qualified` (in candidate
 *    pool), admin picks → `admitted` (reversible), admin confirms →
 *    `completed` (terminal; triggers `countsAsStay` and other side effects).
 *
 *  - "Qualified" is monotone — once a user is qualified, future condition
 *    tightening doesn't downgrade them. This protects already-completed
 *    students when admin loosens or refines criteria mid-task.
 *
 *  - Audit: `tasks.audit` records `override` (existing), `admit`/`unadmit`,
 *    `confirm`/`unconfirm`, and `condition_change` events. Every irreversible
 *    or sensitive action writes a row.
 *
 *  - PAT/GPLT/CSP scores are keyed by `studentDocId` (userbind.students._id),
 *    NOT userId — a score belongs to the student, which covers unbound students
 *    and aligns with the rankboard. Admin-fed via studentId paste-import /
 *    single entry; task checkers resolve userId→studentDocId at check time.
 *    Per-domain max-score settings are unchanged.
 *    (2026-06-07: re-keyed from userId; the GPLT collection is the single
 *    source of truth that the rankboard reads. See docs/PLAN-2026-06-07.)
 */
import type { ObjectId } from 'mongodb';

// ============ Task graph ============

/**
 * A node in the task graph.
 *
 * Three kinds:
 *  - `start` / `end`: singleton sentinels. No preset/params. Auto-created
 *     with each task; not deletable but draggable for layout.
 *  - `task`:          carries `presetId` + `name` + `params`. The
 *                     `preset.category` field (`behavior` | `condition`)
 *                     drives editor grouping and is not stored here.
 */
export interface TaskGraphNode {
    id: string;
    type: 'start' | 'end' | 'task';
    /** Canvas position (xyflow coordinates). */
    position: { x: number; y: number };
    // Only when type === 'task':
    presetId?: string;
    name?: string;
    params?: Record<string, any>;
}

/** Directed edge. `from`/`to` reference TaskGraphNode.id. */
export interface TaskGraphEdge {
    id: string;
    from: string;
    to: string;
}

export interface TaskGraph {
    nodes: TaskGraphNode[];
    edges: TaskGraphEdge[];
}

/** Empty graph initializer used by new tasks and the v2 migration. */
export function emptyTaskGraph(): TaskGraph {
    return {
        nodes: [
            { id: 'start', type: 'start', position: { x: 0, y: 0 } },
            { id: 'end', type: 'end', position: { x: 0, y: 200 } },
        ],
        edges: [],
    };
}

// ============ Task definitions ============

/**
 * Who is allowed to *see* (and therefore self-claim) the task. Single rule.
 * Admin can always see, regardless of access.
 *
 * `grade`: limited to users whose StudentRecord.enrollmentYear ∈ `years`.
 * Users with null enrollmentYear (un-bound or malformed studentId) are
 * excluded — admin can override the year in the student detail page.
 */
export type TaskAccess =
    | { type: 'public' }
    | { type: 'user_group'; targetId: ObjectId }
    | { type: 'school'; targetId: ObjectId }
    | { type: 'grade'; years: number[] };

/** Per-task admission flow. See top-of-file doc. */
export type AdmissionMode = 'auto' | 'quota';

export interface TaskDoc {
    _id: ObjectId;
    domainId: string;
    title: string;
    description: string;
    tags: string[];
    /** Graph replaces the legacy `points` + `condition` pair. See evaluateGraph. */
    graph: TaskGraph;
    access: TaskAccess;
    isActive: boolean;
    /** Default statistics window inherited by task-point checkers. */
    startDate: Date | null;
    endDate: Date | null;
    /** Self-claim window. Admin assignments ignore this window. */
    claimStartAt: Date | null;
    claimEndAt: Date | null;
    maxAssignments: number | null;
    currentAssignments: number;
    /**
     * If true, transitioning this task's assignment to `completed` inserts a
     * `tasks.stay_events` row for the user (`source = "task:<assignmentId>"`).
     * Idempotent via the unique index — re-running the checker won't double
     * count. See ./model.ts: `maybeAwardStayEvent`.
     */
    countsAsStay?: boolean;
    /**
     * `auto`: graph-satisfied → completed.
     * `quota`: graph-satisfied → qualified → (admin admit) → admitted → (admin confirm) → completed.
     */
    admissionMode: AdmissionMode;
    /** Required when admissionMode='quota'. Soft cap — admin can over-admit with warning. */
    quota: number | null;
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

/**
 * Assignment lifecycle:
 *   pending     — graph not yet satisfied; recompute on view/hook/manual recheck
 *   qualified   — graph satisfied, awaiting admin admit (only reached under admissionMode='quota')
 *   admitted    — admin admit, but side-effects (stay event, etc.) NOT yet triggered;
 *                 admin may revoke back to qualified before confirming
 *   completed   — terminal; side-effects triggered (stay event, etc.); cannot be revoked
 *   cancelled   — user/admin cancelled an active assignment
 *
 * Under admissionMode='auto', the flow skips qualified+admitted entirely:
 *   pending → completed (directly when graph satisfies)
 */
export type AssignmentStatus =
    | 'pending'
    | 'qualified'
    | 'admitted'
    | 'completed'
    | 'cancelled';

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
    /** Cached progress per TaskGraphNode.id (for `task` nodes only). */
    progress: Record<string, TaskPointResult>;
    /** Last time progress was recomputed (used for "stale" indicators). */
    progressUpdatedAt: Date | null;
    /** Admin-set note shown to the user. */
    note: string;

    // ─── Quota-mode admission fields ────────────────────────────────────
    /** Set when graph first satisfies under admissionMode='quota'. Monotone — once set, condition tightening doesn't clear it. */
    qualifiedAt: Date | null;
    /** Set when admin admits. May be reset to null if admin unadmits before confirm. */
    admittedAt: Date | null;
    /** Admin uid who performed admit. 0 = never admitted. */
    admittedBy: number;
    /** Admin note attached at admit (e.g. "现场签到核对通过"). */
    admissionNote: string;
    /** Set when admin confirms (terminal — admitted → completed). */
    confirmedAt: Date | null;
    /** Admin uid who confirmed. */
    confirmedBy: number;
}

// ============ Audit ============

/**
 * Audit event kinds. `override` was the only kind in v1; v2 generalizes the
 * collection to cover the new admin actions (admit/confirm/condition change).
 */
export type AuditEventType =
    | 'override'
    | 'admit'
    | 'unadmit'
    | 'confirm'
    | 'unconfirm'
    | 'condition_change';

export interface AuditLogDoc {
    _id: ObjectId;
    domainId: string;
    /** Null for task-level events (e.g. condition_change applies to the whole task). */
    assignmentId: ObjectId | null;
    taskId: ObjectId;
    eventType: AuditEventType;
    /** Set for `override` events only — TaskGraphNode.id that was overridden. */
    pointId?: string;
    /** uid that performed the action. */
    adminUid: number;
    /** Event-specific snapshots — see ./model.ts for shapes. */
    before?: any;
    after?: any;
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
    /** Student identity = userbind.students._id. Keyed by the student (not the
     *  OJ account) so unbound students are covered; tasks resolve userId→this. */
    studentDocId: ObjectId;
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
    /** Student identity = userbind.students._id. Single source of truth for the
     *  天梯赛 numeric score; the rankboard reads it for display. */
    studentDocId: ObjectId;
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
    /** Student identity = userbind.students._id. */
    studentDocId: ObjectId;
    round: number;
    score: number;
    createdAt: Date;
    createdBy: number;
    updatedAt?: Date;
    updatedBy?: number;
}

/**
 * StayEvent / 留校事件.
 *
 * Each row = one stay occurrence for one user. Total stay count per user =
 * `countDocuments({domainId, userId})`. Two source kinds:
 *
 * - `source = 'manual'`         — admin entered via the scores admin page.
 * - `source = 'task:<assignmentId>'` — auto-inserted when an assignment with
 *                                       `task.countsAsStay=true` flips to
 *                                       `completed`. Unique index on
 *                                       `(domainId, userId, source)` makes
 *                                       the trigger idempotent — re-running
 *                                       the checker won't double count.
 *
 * Non-reversible by design: once awarded, the event stays even if the task
 * is later un-completed (admin can manually delete the row from the admin
 * list if a true correction is needed). Note the two-stage admit→confirm
 * flow (under admissionMode='quota') protects against accidental triggers —
 * admin can revoke at admit stage before any stay event is written.
 */
export interface StayEventDoc {
    _id: ObjectId;
    domainId: string;
    userId: number;
    year: number;
    source: string;
    createdAt: Date;
    createdBy: number;
}

// ============ Preset registry types ============

export type PresetCategory = 'behavior' | 'condition';

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
        | 'aggregate'
        | 'years';
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
    /** UI grouping: 'behavior' = user must do something; 'condition' = auto-judged from user attrs. */
    category: PresetCategory;
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
        'tasks.stay_events': StayEventDoc;
    }

    interface Model {
        tasks: typeof import('./model').taskModel;
    }
}
