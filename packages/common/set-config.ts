import {
    assertExamPaperPoolSatisfiesQuotas,
    examDrawUnitContributions,
    parseExamPaperQuotas,
    type ExamPaperQuotas,
} from './exam-paper';
import { PROBLEM_KINDS, parseProblemKind, type ProblemKind } from './problem-kind';
import { parseSetAuthorization, parseSetExperience } from './set-experience';

/**
 * Behavioral source for homework, exam, and contest problem sets.
 * Purpose only chooses a preset. Readers must not infer scoring from `rule`.
 */

export const SET_CONFIG_SCHEMA_VERSION = 1 as const;

export const SET_PURPOSES = Object.freeze(['homework', 'exam', 'contest'] as const);
export type SetPurpose = (typeof SET_PURPOSES)[number];

export const SET_CREATE_KINDS = Object.freeze(['practice', 'homework', 'exam', 'contest'] as const);
export type SetCreateKind = (typeof SET_CREATE_KINDS)[number];

export const SET_PUBLICATIONS = Object.freeze(['draft', 'published'] as const);
export type SetPublication = (typeof SET_PUBLICATIONS)[number];

export const SET_CODE_POLICIES = Object.freeze(['highest', 'last', 'subtask_best', 'retry_decay', 'acm'] as const);
export type SetCodePolicy = (typeof SET_CODE_POLICIES)[number];

export const SET_FEEDBACK_WHENS = Object.freeze(['immediate', 'after_round', 'after_deadline', 'after_release'] as const);
export type SetFeedbackWhen = (typeof SET_FEEDBACK_WHENS)[number];

export const SET_OBJECTIVE_REVEALS = Object.freeze(['full', 'score', 'none'] as const);
export type SetObjectiveReveal = (typeof SET_OBJECTIVE_REVEALS)[number];

export const SET_CODE_REVEALS = Object.freeze(['full', 'verdict', 'none'] as const);
export type SetCodeReveal = (typeof SET_CODE_REVEALS)[number];

export const SET_AFTER_DEADLINE = Object.freeze(['same', 'full'] as const);
export type SetAfterDeadline = (typeof SET_AFTER_DEADLINE)[number];

export const SET_SCOREBOARDS = Object.freeze(['off', 'live', 'during_only', 'after_end'] as const);
export type SetScoreboard = (typeof SET_SCOREBOARDS)[number];

export const SET_ROUND_PICKS = Object.freeze(['highest_total', 'last_round'] as const);
export type SetRoundPick = (typeof SET_ROUND_PICKS)[number];

export const LEGACY_CONTEST_RULES = Object.freeze(['homework', 'exam', 'acm', 'oi', 'ioi', 'strictioi', 'ledo'] as const);
export type LegacyContestRule = (typeof LEGACY_CONTEST_RULES)[number];

const HOUR_MS = 3_600_000;
const HOUR_KEY = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ACM_KINDS = new Set<ProblemKind>(['programming', 'function', 'program_fill']);

export interface SetObjectiveFeedback {
    when: SetFeedbackWhen;
    reveal: SetObjectiveReveal;
}

export interface SetCodeFeedback {
    when: SetFeedbackWhen;
    reveal: SetCodeReveal;
    afterDeadline: SetAfterDeadline;
}

export const SET_PROGRAM_FILL_CHANNELS = Object.freeze(['objective', 'code'] as const);
export type SetProgramFillChannel = (typeof SET_PROGRAM_FILL_CHANNELS)[number];

export interface SetFeedback {
    objective: SetObjectiveFeedback;
    code: SetCodeFeedback;
    /** Legacy projectors treat every program fill like an objective answer. New presets use `code` only for a judged fill. */
    programFillChannel: SetProgramFillChannel;
    gradesReleased: boolean;
}

export interface SetPersonalLimit {
    hours: number | null;
    requireFullWindow: boolean;
}

export type SetLatePolicy = { enabled: false } | { enabled: true; onTimeAt: Date; rules: Record<string, number> };

export interface SetRetake {
    extra: number;
    onlyAfterFail: boolean;
    requireFullWindow: boolean;
    passScore: number | null;
    pick: SetRoundPick;
}

export interface SetDraw {
    enabled: boolean;
    quotas: ExamPaperQuotas | null;
    redrawEachRound: boolean;
    allowRepeatAcrossRounds: boolean;
}

export interface SetSettings {
    experience?: import('./set-experience').SetExperience;
    authorization?: import('./set-experience').SetAuthorization;
    codePolicy: SetCodePolicy;
    earlyHandIn: boolean;
    feedback: SetFeedback;
    scoreboard: SetScoreboard;
    personalLimit: SetPersonalLimit;
    late: SetLatePolicy;
    retake: SetRetake;
    draw: SetDraw;
}

export interface SetConfig {
    schemaVersion: typeof SET_CONFIG_SCHEMA_VERSION;
    purpose: SetPurpose;
    publication: SetPublication;
    revision: number;
    settings: SetSettings;
}

export interface SetProblemFact {
    kind: ProblemKind;
    judged: boolean;
}

export interface SetPublishFacts {
    beginAt: Date;
    endAt: Date;
    problemCount: number;
    audienceConfirmed: boolean;
    problems?: readonly SetProblemFact[];
    paperMax?: number | null;
    paperRange?: { min: number; max: number } | null;
    poolPids?: readonly number[];
    poolKinds?: ReadonlyMap<number, ProblemKind>;
    score?: unknown;
}

interface SetConfigText {
    zh: string;
    en: string;
}

export const SET_CONFIG_TEXT: Readonly<Record<string, SetConfigText>> = Object.freeze({
    set_config_experience_invalid: { zh: '作答与可见性设置无效。', en: 'Invalid problem set interaction settings.' },
    set_config_authorization_invalid: { zh: '用户组授权设置无效。', en: 'Invalid problem set group permissions.' },
    set_config_missing: {
        zh: '题目集还没有可用的配置。',
        en: 'This problem set has no usable configuration.',
    },
    set_config_invalid: {
        zh: '题目集配置无效。',
        en: 'The problem set configuration is invalid.',
    },
    set_config_schema_invalid: {
        zh: '题目集配置版本无法识别。',
        en: 'The problem set configuration version is not recognized.',
    },
    set_config_purpose_invalid: {
        zh: '题目集用途无效。',
        en: 'The problem set purpose is invalid.',
    },
    set_config_publication_invalid: {
        zh: '题目集发布状态无效。',
        en: 'The problem set publication state is invalid.',
    },
    set_config_revision_invalid: {
        zh: '题目集配置版本号无效。',
        en: 'The problem set configuration revision is invalid.',
    },
    set_config_code_policy_invalid: {
        zh: '编程题计分方式无效。',
        en: 'The code scoring policy is invalid.',
    },
    set_config_feedback_invalid: {
        zh: '成绩反馈设置无效。',
        en: 'The result feedback setting is invalid.',
    },
    set_config_scoreboard_invalid: {
        zh: '排行榜设置无效。',
        en: 'The scoreboard setting is invalid.',
    },
    set_config_hours_invalid: {
        zh: '个人限时无效。',
        en: 'The personal time limit is invalid.',
    },
    set_config_limit_flag_invalid: {
        zh: '个人限时的开考限制无效。',
        en: 'The personal time-limit start restriction is invalid.',
    },
    set_config_retake_invalid: {
        zh: '重做设置无效。',
        en: 'The retake setting is invalid.',
    },
    set_config_pass_score_invalid: {
        zh: '及格分无效。',
        en: 'The passing score is invalid.',
    },
    set_config_late_invalid: {
        zh: '迟交设置无效。',
        en: 'The late-submission setting is invalid.',
    },
    set_config_draw_invalid: {
        zh: '随机抽题设置无效。',
        en: 'The random draw setting is invalid.',
    },
    set_config_draw_quotas_invalid: {
        zh: '抽题配额无效。',
        en: 'The draw quotas are invalid.',
    },
    set_config_acm_draw: {
        zh: 'ACM 计分不能和随机抽题同时使用。',
        en: 'ACM scoring cannot be combined with a random draw.',
    },
    set_config_acm_kind: {
        zh: 'ACM 计分只能用于需要评测的编程、函数和程序填空题。',
        en: 'ACM scoring only accepts judged programming, function, and program-fill problems.',
    },
    set_config_code_policy_kind: {
        zh: '当前编程计分方式至少需要一道会评测的题。',
        en: 'This code scoring policy needs at least one judged problem.',
    },
    set_config_schedule_invalid: {
        zh: '开始时间必须早于最终截止时间。',
        en: 'The start time must be earlier than the final deadline.',
    },
    set_config_problems_required: {
        zh: '发布前至少要有一道题。',
        en: 'Add at least one problem before publishing.',
    },
    set_config_audience_required: {
        zh: '发布前要确认作答对象。',
        en: 'Confirm who can take this set before publishing.',
    },
    set_config_pass_above_max: {
        zh: '及格分不能高于卷面满分。',
        en: 'The passing score cannot exceed the paper maximum.',
    },
    set_config_late_outside_window: {
        zh: '迟交的准时截止必须落在开始时间和最终截止时间之间。',
        en: 'The on-time deadline must fall between the start and the final deadline.',
    },
    set_config_duration_outside_window: {
        zh: '个人限时不能超过开放时间。',
        en: 'The personal time limit cannot be longer than the open window.',
    },
    set_config_draw_pool: {
        zh: '题池数量不满足抽题配额。',
        en: 'The problem pool does not satisfy the draw quotas.',
    },
    set_config_draw_score_mixed: {
        zh: '同一题型的抽题分值必须相同。',
        en: 'Problems of the same kind must share one score when drawing.',
    },
    set_legacy_rule_unknown: {
        zh: '原题目集赛制无法识别，不能转换。',
        en: 'The original contest rule is not recognized and cannot be converted.',
    },
    set_legacy_field_invalid: {
        zh: '原题目集配置已损坏，不能转换。',
        en: 'The original contest configuration is damaged and cannot be converted.',
    },
    set_legacy_unexpected_exam_field: {
        zh: '非考试题目集带有考试专用字段，不能转换。',
        en: 'A non-exam problem set contains exam-only fields and cannot be converted.',
    },
    set_legacy_unexpected_homework_field: {
        zh: '非作业题目集带有作业专用字段，不能转换。',
        en: 'A non-homework problem set contains homework-only fields and cannot be converted.',
    },
    set_legacy_feedback_unmapped: {
        zh: '原题目集的成绩公开方式无法等价转换。',
        en: 'The original result visibility cannot be converted without changing it.',
    },
    set_create_kind_invalid: {
        zh: '不能创建这种题目集。',
        en: 'This problem set kind cannot be created.',
    },
    set_create_kind_forbidden: {
        zh: '你没有创建这种题目集的权限。',
        en: 'You cannot create this kind of problem set.',
    },
});

export function setConfigMessage(code: string): string {
    const text = SET_CONFIG_TEXT[code];
    if (!text) throw new TypeError('set_config_invalid');
    return text.zh;
}

function fail(code: keyof typeof SET_CONFIG_TEXT): never {
    throw new TypeError(code);
}

function isPlain(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObject(value: unknown, code: keyof typeof SET_CONFIG_TEXT): Record<string, unknown> {
    if (!isPlain(value)) fail(code);
    return value;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], code: keyof typeof SET_CONFIG_TEXT): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) fail(code);
    }
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], code: keyof typeof SET_CONFIG_TEXT): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    fail(code);
}

function readBoolean(value: unknown, code: keyof typeof SET_CONFIG_TEXT): boolean {
    if (typeof value === 'boolean') return value;
    fail(code);
}

function readDate(value: unknown, code: keyof typeof SET_CONFIG_TEXT): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    fail(code);
}

function readRevision(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value) || value < 1) {
        fail('set_config_revision_invalid');
    }
    return value;
}

function readHours(value: unknown): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('set_config_hours_invalid');
    return value;
}

function readExtra(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0) {
        fail('set_config_retake_invalid');
    }
    return value;
}

function readPassScore(value: unknown): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value) || value < 1) {
        fail('set_config_pass_score_invalid');
    }
    return value;
}

function readPenaltyRules(value: unknown, code: keyof typeof SET_CONFIG_TEXT): Record<string, number> {
    const raw = readObject(value, code);
    const rules: Record<string, number> = {};
    for (const [key, coefficient] of Object.entries(raw)) {
        if (!HOUR_KEY.test(key) || typeof coefficient !== 'number' || !Number.isFinite(coefficient)) fail(code);
        rules[key] = coefficient;
    }
    return rules;
}

function readQuotas(value: unknown): ExamPaperQuotas {
    try {
        const parsed = parseExamPaperQuotas(value);
        const ordered: ExamPaperQuotas = {};
        for (const kind of PROBLEM_KINDS) {
            const count = parsed[kind];
            if (count !== undefined) ordered[kind] = count;
        }
        return ordered;
    } catch (error) {
        if (error instanceof TypeError && error.message === 'exam_paper_quotas_invalid') fail('set_config_draw_quotas_invalid');
        throw error;
    }
}

function disabledDraw(): SetDraw {
    return {
        enabled: false,
        quotas: null,
        redrawEachRound: true,
        allowRepeatAcrossRounds: true,
    };
}

function readFeedback(value: unknown): SetFeedback {
    const raw = readObject(value, 'set_config_feedback_invalid');
    rejectUnknown(raw, ['objective', 'code', 'programFillChannel', 'gradesReleased'], 'set_config_feedback_invalid');
    const objective = readObject(raw.objective, 'set_config_feedback_invalid');
    rejectUnknown(objective, ['when', 'reveal'], 'set_config_feedback_invalid');
    const code = readObject(raw.code, 'set_config_feedback_invalid');
    rejectUnknown(code, ['when', 'reveal', 'afterDeadline'], 'set_config_feedback_invalid');
    return {
        objective: {
            when: readEnum(objective.when, SET_FEEDBACK_WHENS, 'set_config_feedback_invalid'),
            reveal: readEnum(objective.reveal, SET_OBJECTIVE_REVEALS, 'set_config_feedback_invalid'),
        },
        code: {
            when: readEnum(code.when, SET_FEEDBACK_WHENS, 'set_config_feedback_invalid'),
            reveal: readEnum(code.reveal, SET_CODE_REVEALS, 'set_config_feedback_invalid'),
            afterDeadline: readEnum(code.afterDeadline, SET_AFTER_DEADLINE, 'set_config_feedback_invalid'),
        },
        programFillChannel: readEnum(raw.programFillChannel, SET_PROGRAM_FILL_CHANNELS, 'set_config_feedback_invalid'),
        gradesReleased: readBoolean(raw.gradesReleased, 'set_config_feedback_invalid'),
    };
}

function readPersonalLimit(value: unknown): SetPersonalLimit {
    const raw = readObject(value, 'set_config_hours_invalid');
    rejectUnknown(raw, ['hours', 'requireFullWindow'], 'set_config_hours_invalid');
    const hours = readHours(raw.hours);
    const requireFullWindow = readBoolean(raw.requireFullWindow, 'set_config_limit_flag_invalid');
    if (hours === null && requireFullWindow) fail('set_config_limit_flag_invalid');
    return { hours, requireFullWindow };
}

function readLate(value: unknown): SetLatePolicy {
    const raw = readObject(value, 'set_config_late_invalid');
    const enabled = readBoolean(raw.enabled, 'set_config_late_invalid');
    if (!enabled) {
        rejectUnknown(raw, ['enabled'], 'set_config_late_invalid');
        return { enabled: false };
    }
    rejectUnknown(raw, ['enabled', 'onTimeAt', 'rules'], 'set_config_late_invalid');
    return {
        enabled: true,
        onTimeAt: readDate(raw.onTimeAt, 'set_config_late_invalid'),
        rules: readPenaltyRules(raw.rules, 'set_config_late_invalid'),
    };
}

function readRetake(value: unknown): SetRetake {
    const raw = readObject(value, 'set_config_retake_invalid');
    rejectUnknown(raw, ['extra', 'onlyAfterFail', 'requireFullWindow', 'passScore', 'pick'], 'set_config_retake_invalid');
    return {
        extra: readExtra(raw.extra),
        onlyAfterFail: readBoolean(raw.onlyAfterFail, 'set_config_retake_invalid'),
        requireFullWindow: readBoolean(raw.requireFullWindow, 'set_config_retake_invalid'),
        passScore: readPassScore(raw.passScore),
        pick: readEnum(raw.pick, SET_ROUND_PICKS, 'set_config_retake_invalid'),
    };
}

function readDraw(value: unknown): SetDraw {
    const raw = readObject(value, 'set_config_draw_invalid');
    rejectUnknown(raw, ['enabled', 'quotas', 'redrawEachRound', 'allowRepeatAcrossRounds'], 'set_config_draw_invalid');
    const enabled = readBoolean(raw.enabled, 'set_config_draw_invalid');
    const redrawEachRound = readBoolean(raw.redrawEachRound, 'set_config_draw_invalid');
    const allowRepeatAcrossRounds = readBoolean(raw.allowRepeatAcrossRounds, 'set_config_draw_invalid');
    if (!enabled) {
        if (raw.quotas !== null || redrawEachRound !== true || allowRepeatAcrossRounds !== true) fail('set_config_draw_invalid');
        return disabledDraw();
    }
    if (raw.quotas === null) fail('set_config_draw_invalid');
    return {
        enabled: true,
        quotas: readQuotas(raw.quotas),
        redrawEachRound,
        allowRepeatAcrossRounds,
    };
}

export function parseSetSettings(value: unknown): SetSettings {
    const raw = readObject(value, 'set_config_invalid');
    rejectUnknown(
        raw,
        ['codePolicy', 'earlyHandIn', 'feedback', 'scoreboard', 'personalLimit', 'late', 'retake', 'draw', 'experience', 'authorization'],
        'set_config_invalid',
    );
    return {
        ...(Object.hasOwn(raw, 'experience') ? { experience: parseSetExperience(raw.experience) } : {}),
        ...(Object.hasOwn(raw, 'authorization') ? { authorization: parseSetAuthorization(raw.authorization) } : {}),
        codePolicy: readEnum(raw.codePolicy, SET_CODE_POLICIES, 'set_config_code_policy_invalid'),
        earlyHandIn: readBoolean(raw.earlyHandIn, 'set_config_invalid'),
        feedback: readFeedback(raw.feedback),
        scoreboard: readEnum(raw.scoreboard, SET_SCOREBOARDS, 'set_config_scoreboard_invalid'),
        personalLimit: readPersonalLimit(raw.personalLimit),
        late: readLate(raw.late),
        retake: readRetake(raw.retake),
        draw: readDraw(raw.draw),
    };
}

export function parseSetConfig(value: unknown): SetConfig {
    const raw = readObject(value, 'set_config_invalid');
    rejectUnknown(raw, ['schemaVersion', 'purpose', 'publication', 'revision', 'settings'], 'set_config_invalid');
    if (raw.schemaVersion !== SET_CONFIG_SCHEMA_VERSION) fail('set_config_schema_invalid');
    return {
        schemaVersion: SET_CONFIG_SCHEMA_VERSION,
        purpose: readEnum(raw.purpose, SET_PURPOSES, 'set_config_purpose_invalid'),
        publication: readEnum(raw.publication, SET_PUBLICATIONS, 'set_config_publication_invalid'),
        revision: readRevision(raw.revision),
        settings: parseSetSettings(raw.settings),
    };
}

export function readStoredSetConfig(doc: unknown): SetConfig {
    if (!isPlain(doc) || !Object.hasOwn(doc, 'setConfig')) fail('set_config_missing');
    return parseSetConfig(doc.setConfig);
}

function immediateFull(): SetObjectiveFeedback {
    return { when: 'immediate', reveal: 'full' };
}

function codeImmediateFull(): SetCodeFeedback {
    return { when: 'immediate', reveal: 'full', afterDeadline: 'same' };
}

function baseRetake(pick: SetRoundPick, examLegacy: boolean): SetRetake {
    return {
        extra: 0,
        onlyAfterFail: examLegacy,
        requireFullWindow: examLegacy,
        passScore: null,
        pick,
    };
}

export function presetSettings(purpose: SetPurpose): SetSettings {
    const parsed = readEnum(purpose, SET_PURPOSES, 'set_config_purpose_invalid');
    if (parsed === 'exam') {
        return {
            codePolicy: 'highest',
            earlyHandIn: true,
            feedback: {
                objective: { when: 'after_deadline', reveal: 'full' },
                code: codeImmediateFull(),
                programFillChannel: 'code',
                gradesReleased: false,
            },
            scoreboard: 'off',
            personalLimit: { hours: null, requireFullWindow: false },
            late: { enabled: false },
            retake: baseRetake('highest_total', false),
            draw: disabledDraw(),
        };
    }
    return {
        codePolicy: 'highest',
        earlyHandIn: false,
        feedback: {
            objective: immediateFull(),
            code: codeImmediateFull(),
            programFillChannel: 'code',
            gradesReleased: false,
        },
        scoreboard: parsed === 'contest' ? 'live' : 'off',
        personalLimit: { hours: null, requireFullWindow: false },
        late: { enabled: false },
        retake: baseRetake('highest_total', false),
        draw: disabledDraw(),
    };
}

export function createDraftConfig(purpose: SetPurpose): SetConfig {
    return {
        schemaVersion: SET_CONFIG_SCHEMA_VERSION,
        purpose: readEnum(purpose, SET_PURPOSES, 'set_config_purpose_invalid'),
        publication: 'draft',
        revision: 1,
        settings: presetSettings(purpose),
    };
}

export function setCreateKindsAllowed(privEditSystem: boolean): readonly SetCreateKind[] {
    if (typeof privEditSystem !== 'boolean') fail('set_create_kind_invalid');
    return privEditSystem ? SET_CREATE_KINDS : (['homework', 'exam'] as const);
}

export function assertCanCreateSetKind(kind: unknown, privEditSystem: boolean): SetCreateKind {
    const parsed = readEnum(kind, SET_CREATE_KINDS, 'set_create_kind_invalid');
    if (!setCreateKindsAllowed(privEditSystem).includes(parsed)) fail('set_create_kind_forbidden');
    return parsed;
}

function isJudgedAcmProblem(problem: SetProblemFact): boolean {
    if (problem.judged !== true) return false;
    try {
        return ACM_KINDS.has(parseProblemKind(problem.kind));
    } catch (error) {
        if (error instanceof TypeError) return false;
        throw error;
    }
}

export function assertSetCombination(settings: SetSettings, problems?: readonly SetProblemFact[]): void {
    const parsed = parseSetSettings(settings);
    if (parsed.codePolicy === 'acm' && parsed.draw.enabled) fail('set_config_acm_draw');
    if (!problems) return;
    if (parsed.codePolicy === 'acm') {
        for (const problem of problems) {
            if (!isPlain(problem) || !isJudgedAcmProblem(problem)) fail('set_config_acm_kind');
        }
    }
    if ((parsed.codePolicy === 'subtask_best' || parsed.codePolicy === 'retry_decay') && problems.length > 0) {
        if (!problems.some((problem) => isPlain(problem) && problem.judged === true)) fail('set_config_code_policy_kind');
    }
}

export function assertSetPublishable(config: SetConfig, facts: SetPublishFacts): void {
    const parsed = parseSetConfig(config);
    const beginAt = readDate(facts?.beginAt, 'set_config_schedule_invalid');
    const endAt = readDate(facts?.endAt, 'set_config_schedule_invalid');
    if (beginAt.getTime() >= endAt.getTime()) fail('set_config_schedule_invalid');
    if (typeof facts.problemCount !== 'number' || !Number.isInteger(facts.problemCount) || facts.problemCount < 1) {
        fail('set_config_problems_required');
    }
    // Audience confirmation is a first-publication action, not a requirement to edit legacy published sets.
    if (parsed.publication === 'draft' && facts.audienceConfirmed !== true) fail('set_config_audience_required');
    const problemsMatch = !!facts.problems && facts.problems.length === facts.problemCount;
    if (parsed.settings.codePolicy === 'acm' && !problemsMatch) fail('set_config_acm_kind');
    if ((parsed.settings.codePolicy === 'subtask_best' || parsed.settings.codePolicy === 'retry_decay') && !problemsMatch) {
        fail('set_config_code_policy_kind');
    }
    assertSetCombination(parsed.settings, facts.problems);
    const minimum = facts.paperRange === undefined ? facts.paperMax : facts.paperRange?.min;
    if (
        parsed.settings.retake.passScore !== null &&
        (typeof minimum !== 'number' || !Number.isFinite(minimum) || parsed.settings.retake.passScore > minimum)
    ) {
        fail('set_config_pass_above_max');
    }
    if (parsed.settings.late.enabled) {
        const onTime = parsed.settings.late.onTimeAt.getTime();
        if (onTime < beginAt.getTime() || onTime >= endAt.getTime()) fail('set_config_late_outside_window');
    }
    const hours = parsed.settings.personalLimit.hours;
    if (hours !== null && hours * HOUR_MS > endAt.getTime() - beginAt.getTime()) fail('set_config_duration_outside_window');
    if (!parsed.settings.draw.enabled) return;
    if (!facts.poolPids || !facts.poolKinds || !parsed.settings.draw.quotas) fail('set_config_draw_pool');
    try {
        assertExamPaperPoolSatisfiesQuotas(facts.poolPids, facts.poolKinds, parsed.settings.draw.quotas);
    } catch (error) {
        if (error instanceof TypeError && (error.message === 'exam_paper_pool_short' || error.message === 'exam_paper_pool_kind_missing')) {
            fail('set_config_draw_pool');
        }
        throw error;
    }
    if (facts.paperRange === undefined &&
        examDrawUnitContributions(
            { score: facts.score, examPaperQuotas: parsed.settings.draw.quotas },
            facts.poolPids,
            facts.poolKinds,
        ) === null
    ) {
        fail('set_config_draw_score_mixed');
    }
}

function present(record: Record<string, unknown>, key: string): boolean {
    return Object.hasOwn(record, key) && record[key] !== undefined;
}

function legacyRule(value: unknown): LegacyContestRule {
    return readEnum(value, LEGACY_CONTEST_RULES, 'set_legacy_rule_unknown');
}

function legacyDate(value: unknown): Date {
    return readDate(value, 'set_legacy_field_invalid');
}

function legacyBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    return readBoolean(value, 'set_legacy_field_invalid');
}

function rejectForeignExamFields(record: Record<string, unknown>): void {
    for (const key of ['examPaperQuotas', 'examShowVerdict', 'examPassScore', 'examAttemptLimit']) {
        if (present(record, key)) fail('set_legacy_unexpected_exam_field');
    }
}

function rejectForeignHomeworkField(record: Record<string, unknown>): void {
    if (present(record, 'homeworkShowObjectiveVerdict')) fail('set_legacy_unexpected_homework_field');
}

function legacyHours(value: unknown): number | null {
    if (value === undefined || value === null || value === 0) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('set_legacy_field_invalid');
    return value;
}

function legacyAttemptExtra(record: Record<string, unknown>): number {
    if (!present(record, 'examAttemptLimit')) return 0;
    const raw = record.examAttemptLimit;
    if (typeof raw === 'string' && raw.trim() === '') return 0;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || !Number.isSafeInteger(raw) || raw < 1) fail('set_legacy_field_invalid');
    return raw - 1;
}

function legacyPassScore(record: Record<string, unknown>): number | null {
    if (!present(record, 'examPassScore')) return null;
    const raw = record.examPassScore;
    if (raw === 0 || raw === null || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || !Number.isSafeInteger(raw) || raw < 1) fail('set_legacy_field_invalid');
    return raw;
}

function legacyObjective(rule: LegacyContestRule, record: Record<string, unknown>): SetObjectiveFeedback {
    if (rule === 'homework') {
        const flag = record.homeworkShowObjectiveVerdict;
        if (flag === undefined || flag === true) return immediateFull();
        if (flag === false) return { when: 'immediate', reveal: 'none' };
        fail('set_legacy_field_invalid');
    }
    if (rule === 'exam') {
        const flag = record.examShowVerdict;
        if (flag === undefined || flag === true) return immediateFull();
        if (flag === false) return { when: 'after_deadline', reveal: 'full' };
        fail('set_legacy_field_invalid');
    }
    if (rule === 'oi') return { when: 'after_deadline', reveal: 'full' };
    return immediateFull();
}

export function feedbackSideForProblem(
    settings: SetSettings,
    problem: { kind: ProblemKind; judged: boolean },
): 'objective' | 'code' {
    const parsed = parseSetSettings(settings);
    const kind = parseProblemKind(problem.kind);
    if (kind === 'function' || kind === 'programming') return 'code';
    if (kind === 'program_fill' && problem.judged === true && parsed.feedback.programFillChannel === 'code') return 'code';
    return 'objective';
}

function legacyCode(rule: LegacyContestRule): SetCodeFeedback {
    if (rule === 'oi') return { when: 'after_deadline', reveal: 'full', afterDeadline: 'same' };
    if (rule === 'acm') return { when: 'immediate', reveal: 'verdict', afterDeadline: 'full' };
    return codeImmediateFull();
}

function legacyCodePolicy(rule: LegacyContestRule): SetCodePolicy {
    if (rule === 'ioi') return 'highest';
    if (rule === 'strictioi') return 'subtask_best';
    if (rule === 'ledo') return 'retry_decay';
    if (rule === 'acm') return 'acm';
    return 'last';
}

function legacyScoreboard(rule: LegacyContestRule, keepHidden: boolean): SetScoreboard {
    if (rule === 'homework' || rule === 'acm' || rule === 'ledo') return 'live';
    if (rule === 'ioi') return keepHidden ? 'during_only' : 'live';
    return keepHidden ? 'off' : 'after_end';
}

function legacyPurpose(rule: LegacyContestRule): SetPurpose {
    if (rule === 'homework') return 'homework';
    if (rule === 'exam') return 'exam';
    return 'contest';
}

function legacyLate(record: Record<string, unknown>): SetLatePolicy {
    if (!present(record, 'penaltySince') || !present(record, 'endAt')) fail('set_legacy_field_invalid');
    const rules = present(record, 'penaltyRules') ? readPenaltyRules(record.penaltyRules, 'set_legacy_field_invalid') : {};
    const onTimeAt = legacyDate(record.penaltySince);
    const endAt = legacyDate(record.endAt);
    if (onTimeAt.getTime() > endAt.getTime()) fail('set_legacy_field_invalid');
    if (onTimeAt.getTime() === endAt.getTime()) return { enabled: false };
    return { enabled: true, onTimeAt, rules };
}

function legacyDraw(record: Record<string, unknown>): SetDraw {
    if (!present(record, 'examPaperQuotas') || record.examPaperQuotas === null) return disabledDraw();
    try {
        return {
            enabled: true,
            quotas: readQuotas(record.examPaperQuotas),
            redrawEachRound: true,
            allowRepeatAcrossRounds: true,
        };
    } catch (error) {
        if (error instanceof TypeError && error.message === 'set_config_draw_quotas_invalid') fail('set_legacy_field_invalid');
        throw error;
    }
}

/** Converts one stored contest into the equivalent configuration. Does not apply new presets. */
export function mapLegacyContest(doc: unknown): SetConfig {
    const record = readObject(doc, 'set_legacy_field_invalid');
    const rule = legacyRule(record.rule);
    if (rule !== 'exam') rejectForeignExamFields(record);
    if (rule !== 'homework') rejectForeignHomeworkField(record);
    const keepHidden = legacyBoolean(record.keepScoreboardHidden, false);
    if (keepHidden && (rule === 'oi' || rule === 'strictioi')) fail('set_legacy_feedback_unmapped');
    const hours = legacyHours(record.duration);
    const exam = rule === 'exam';
    return parseSetConfig({
        schemaVersion: SET_CONFIG_SCHEMA_VERSION,
        purpose: legacyPurpose(rule),
        publication: 'published',
        revision: 1,
        settings: {
            codePolicy: legacyCodePolicy(rule),
            earlyHandIn: exam,
            feedback: {
                objective: legacyObjective(rule, record),
                code: legacyCode(rule),
                programFillChannel: 'objective',
                gradesReleased: false,
            },
            scoreboard: legacyScoreboard(rule, keepHidden),
            personalLimit: {
                hours,
                requireFullWindow: exam && hours !== null,
            },
            late: rule === 'homework' ? legacyLate(record) : { enabled: false },
            retake: exam
                ? {
                      extra: legacyAttemptExtra(record),
                      onlyAfterFail: true,
                      requireFullWindow: true,
                      passScore: legacyPassScore(record),
                      pick: 'last_round',
                  }
                : baseRetake('highest_total', false),
            draw: exam ? legacyDraw(record) : disabledDraw(),
        },
    });
}

export function summarizeSetSettings(settings: SetSettings): string {
    const code = {
        highest: '编程题取本轮最高分',
        last: '编程题取最后一次提交',
        subtask_best: '编程题按子任务最优',
        retry_decay: '编程题按重试衰减',
        acm: 'ACM 罚时',
    }[settings.codePolicy];
    const board = {
        off: '学生排行榜关闭',
        live: '学生排行榜实时',
        after_end: '学生排行榜结束后公开',
        during_only: '学生排行榜只在进行中公开',
    }[settings.scoreboard];
    if (!code || !board) throw new TypeError('set_config_invalid');
    const hours = settings.personalLimit.hours === null ? '不限个人时间' : `个人限时 ${settings.personalLimit.hours} 小时`;
    const late = settings.late.enabled ? '允许迟交' : '不允许迟交';
    const draw = settings.draw.enabled ? '开启抽题' : '不抽题';
    return `${code}。${board}。${hours}。${late}。${draw}。`;
}
