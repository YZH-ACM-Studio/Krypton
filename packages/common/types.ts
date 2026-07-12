export type CompilableSource = string | {
    file: string;
    lang: string;
};

export enum ProblemType {
    Default = 'default',
    SubmitAnswer = 'submit_answer',
    Interactive = 'interactive',
    Communication = 'communication',
    Objective = 'objective',
    Remote = 'remote_judge',
    FillFunction = 'fill_function',
}

/**
 * Per-question kind metadata for `Objective` problems. The answer-sheet UI
 * uses this to pick the renderer (radio / checkbox / blank input / code snippet).
 *
 * Inference fallback when no explicit kind is set:
 *  - stdAns is an array            → 'multi'
 *  - single string, no whitespace  → 'single'
 *  - single string with whitespace → 'blank'
 *
 * 'fill_program' is always explicit (PRD §1.1).
 *
 * 'subjective'：独立主观题的学生端输入描述；提交不进入自动判题器，
 * Record 直接进入人工待评状态。
 */
export type QuestionKind = 'single' | 'multi' | 'blank' | 'fill_program' | 'subjective';

/**
 * `Objective.config.answers[key]` shape. Backward-compatible with the legacy
 * `[stdAns, score]` tuple; new code can use the 3-tuple to attach kind + prompt.
 */
/**
 * meta 键名 canonical 为 `kind`（PLAN 2026-07 P3.2）；`type` 是早期
 * problem-type-editor 写入的 legacy 别名，读取端做 `kind ?? type` 兜底。
 * `choices` 与 `ProblemConfigFile.options[key]` 双写（考试页现行消费点是
 * options，编辑器保存时两处同步）。
 */
export type AnswerEntry =
    | [string | string[], number]
    | [string | string[], number, {
        kind?: QuestionKind;
        prompt?: string;
        /** @deprecated legacy alias of `kind` (early editor versions) */
        type?: QuestionKind;
        choices?: string[];
        /**
         * UI 呈现变体（Rev.12）：'truefalse' = 判断题（single 的预设，
         * choices 锁定「正确/错误」）。判题/统计不区分，仅编辑器回读用。
         */
        presentation?: string;
        /** New single-problem multi-select scoring; absent keeps legacy 50%. */
        partialCreditPercent?: number;
    }];

export interface ObjectiveSingleMain {
    options: string[];
    answerIndex: number;
}

export interface ObjectiveMultiMain {
    options: string[];
    answerIndexes: number[];
    partialCreditPercent: number;
}

export interface ObjectiveTrueFalseMain {
    answer: boolean;
}

export interface ObjectiveBlankMain {
    answer: string;
}

/**
 * Fill-function problem template — see PRD §1.7.
 *
 * `source` is the complete compilable program. Regions are the ranges the
 * student may edit; everything else is rendered read-only but visible in the
 * student UI. At submission, the server splices each region's content back
 * into `source` and submits the result as a normal `default` record.
 */
export interface FillFunctionTemplate {
    lang: string;
    source: string;
    regions: FillRegion[];
    /** SHA-256 of `source` at save time. Used for draft staleness detection. */
    sourceHash: string;
}

export interface FillRegion {
    /** Stable identifier chosen by the teacher (e.g. 'r1', 'main_logic'). */
    id: string;
    start: { line: number, col: number };
    end: { line: number, col: number };
    /** Optional prompt shown above the editable area in the student UI. */
    prompt?: string;
}

export interface TestCaseConfig {
    input: string;
    output: string;
    time?: string;
    memory?: string;
    score?: number;
    /**
     * PTA-style per-test-point hint shown next to this case in the record
     * (judge) detail. Authored in the problem config editor. Visibility is
     * enforced server-side (RecordDetailHandler): shown only when `hintPublic`
     * and NOT during an ongoing contest (revealed after the contest ends).
     */
    hint?: string;
    /** Author intent: may students ever see this hint (practice/post-contest). */
    hintPublic?: boolean;
    /** Per-test-point explainer video link, shown next to the hint. */
    videoUrl?: string;
    /**
     * Author intent: may students ever see the video link. Absent means
     * "follow hintPublic" so pre-existing configs keep their behavior.
     */
    videoPublic?: boolean;
}

export enum SubtaskType {
    min = 'min',
    max = 'max',
    sum = 'sum',
}

export interface SubtaskConfig {
    time?: string;
    memory?: string;
    score?: number;
    if?: number[];
    id?: number;
    type?: SubtaskType;
    cases?: TestCaseConfig[];
}

export type DetailType = 'full' | 'case' | 'none';

export interface ProblemConfigFile {
    type?: ProblemType;
    subType?: string;
    target?: string;
    score?: number;
    time?: string;
    memory?: string;
    filename?: string;
    checker_type?: string;
    num_processes?: number;
    user_extra_files?: string[];
    judge_extra_files?: string[];
    detail?: DetailType | boolean;
    answers?: Record<string, AnswerEntry>;
    /** Canonical single-question config used by revision-managed problem kinds. */
    main?: ObjectiveSingleMain | ObjectiveMultiMain | ObjectiveTrueFalseMain | ObjectiveBlankMain | Record<string, unknown>;
    /**
     * 客观题选项：questionKey → 选项文本数组（A/B/C… 按下标映射）。
     * 与 answers[key][2].choices 双写；考试页/结构化渲染器消费此处。
     */
    options?: Record<string, string[]>;
    /** When `type === 'fill_function'`, the template source and editable regions. */
    template?: FillFunctionTemplate;
    redirect?: string;
    cases?: TestCaseConfig[];
    subtasks?: SubtaskConfig[];
    langs?: string[];
    checker?: CompilableSource;
    interactor?: CompilableSource;
    manager?: CompilableSource;
    validator?: CompilableSource;
    time_limit_rate?: Record<string, number>;
    memory_limit_rate?: Record<string, number>;
}

export interface FileInfo {
    /** storage path */
    _id: string;
    /** filename */
    name: string;
    /** file size (in bytes) */
    size: number;
    etag: string;
    lastModified: Date;
}

export interface JudgeMeta {
    problemOwner: number;
    hackRejudge?: string;
    rejudge?: boolean | 'controlled';
    // FIXME stricter types
    type?: string;
}

export interface RecordJudgeInfo {
    score: number;
    memory: number;
    time: number;
    judgeTexts: (string | JudgeMessage)[];
    compilerTexts: string[];
    testCases: Required<TestCase>[];
    /** judge uid */
    judger: number;
    judgeAt: Date;
    status: number;
    subtasks?: Record<number, SubtaskResult>;
}

export interface RecordPayload extends RecordJudgeInfo {
    domainId: string;
    pid: number;
    uid: number;
    lang: string;
    code: string;
    rejudged: boolean;
    source?: string;
    progress?: number;
    /** pretest */
    input?: string | string[];
    /** hack target rid */
    hackTarget?: string;
    /** 0 if pretest&script */
    contest?: string;

    files?: Record<string, string>;
    manualGrade?: {
        score: number;
        maxScore: number;
        comment?: string;
        gradedBy: number;
        gradedAt: Date;
        revision: number;
    };
    manualPending?: true;
}

export interface JudgeRequest extends Omit<RecordPayload, 'testCases'> {
    priority: number;
    type: 'judge' | 'generate';
    rid: string;
    config: ProblemConfigFile;
    meta: JudgeMeta;
    data: FileInfo[];
    source: string;
    trusted: boolean;
}

export interface TestCase {
    id?: number;
    subtaskId?: number;
    score?: number;
    time: number;
    memory: number;
    status: number;
    message: string;
}

export interface JudgeMessage {
    message: string;
    params?: string[];
    stack?: string;
}

export interface SubtaskResult {
    type: SubtaskType;
    score: number;
    status: number;
}

export interface JudgeResultBody {
    key: string;
    domainId: string;
    rid: string;
    judger?: number;
    progress?: number;
    addProgress?: number;
    case?: TestCase;
    cases?: TestCase[];
    status?: number;
    score?: number;
    /** in miliseconds */
    time?: number;
    /** in kilobytes */
    memory?: number;
    message?: string | JudgeMessage;
    compilerText?: string;
    nop?: boolean;
    subtasks?: Record<number, SubtaskResult>;
}
