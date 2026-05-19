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
 */
export type QuestionKind = 'single' | 'multi' | 'blank' | 'fill_program';

/**
 * `Objective.config.answers[key]` shape. Backward-compatible with the legacy
 * `[stdAns, score]` tuple; new code can use the 3-tuple to attach kind + prompt.
 */
export type AnswerEntry =
    | [string | string[], number]
    | [string | string[], number, { kind?: QuestionKind; prompt?: string }];

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
    start: { line: number; col: number };
    end: { line: number; col: number };
    /** Optional prompt shown above the editable area in the student UI. */
    prompt?: string;
}

export interface TestCaseConfig {
    input: string;
    output: string;
    time?: string;
    memory?: string;
    score?: number;
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
