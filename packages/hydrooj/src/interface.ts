/* eslint-disable perfectionist/sort-exports */
import type { AttestationFormat, CredentialDeviceType } from '@simplewebauthn/server';
import type { ParsedAuthenticatorData } from '@simplewebauthn/server/helpers';
import type fs from 'fs';
import type { Dictionary, NumericDictionary } from 'lodash';
import type { Binary, FindCursor, ObjectId } from 'mongodb';
import type { ClientStructuredCodeSegment, FileInfo, RecordJudgeInfo, RecordPayload } from '@hydrooj/common/types';
import type { Context } from './context';
import type { ClientQuestion } from './lib/problem-config';
import type { PrintTaskStatus } from './model/contest';
import type { DocStatusType } from './model/document';
import type { OauthMap } from './model/oauth';
import type { ProblemDoc } from './model/problem';

export * from '@hydrooj/common/types';

type document = typeof import('./model/document');

export interface System {
    _id: string;
    value: any;
}

export interface SystemKeys {
    'smtp.user': string;
    'smtp.from': string;
    'smtp.pass': string;
    'smtp.host': string;
    'smtp.port': number;
    'smtp.secure': boolean;
    installid: string;
    'server.name': string;
    'server.url': string;
    'server.xff': string;
    'server.xhost': string;
    'server.host': string;
    'server.port': number;
    'server.language': string;
    'exam.preloginTicketKey': string;
    'exam.preloginV2WriterEnabled': boolean;
    'exam.preloginWorkflowWriterEnabled': boolean;
    'limit.problem_files_max': number;
    'problem.categories': string;
    'session.keys': string[];
    'session.saved_expire_seconds': number;
    'session.unsaved_expire_seconds': number;
    'user.quota': number;
}

export interface Setting {
    family: string;
    key: string;
    range: [string, string][] | Record<string, string>;
    value: any;
    type: string;
    subType?: string;
    name: string;
    desc: string;
    flag: number;
    validation?: (val: any) => boolean;
}

export interface Authenticator {
    name: string;
    regat: number;

    fmt: AttestationFormat;
    counter: number;
    aaguid: string;
    credentialID: Binary;
    credentialPublicKey: Binary;
    credentialType: 'public-key';
    attestationObject: Binary;
    userVerified: boolean;
    credentialDeviceType: CredentialDeviceType;
    credentialBackedUp: boolean;
    authenticatorExtensionResults?: ParsedAuthenticatorData['extensionsData'];
    authenticatorAttachment: 'platform' | 'cross-platform';
}

export interface Udoc extends Record<string, any> {
    _id: number;
    mail: string;
    mailLower: string;
    uname: string;
    unameLower: string;
    salt: string;
    hash: string;
    hashType: string;
    priv: number;
    regat: Date;
    loginat: Date;
    ip: string[];
    loginip: string;
}

export interface VUdoc {
    _id: number;
    mail: string;
    mailLower: string;
    uname: string;
    unameLower: string;
    salt: '';
    hash: '';
    hashType: 'hydro';
    priv: 0;
    regat: Date;
    loginat: Date;
    ip: ['127.0.0.1'];
    loginip: '127.0.0.1';
}

export interface GDoc {
    _id: ObjectId;
    domainId: string;
    name: string;
    uids: number[];
}

export interface UserPreferenceDoc {
    _id: ObjectId;
    filename: string;
    uid: number;
    content: string;
}

export interface OwnerInfo {
    owner: number;
    maintainer?: number[];
}

export type User = import('./model/user').User;
export type Udict = Record<number, User>;

export interface BaseUser {
    _id: number;
    uname: string;
    mail: string;
    avatar: string;
    school?: string;
    displayName?: string;
    studentId?: string;
}
export type BaseUserDict = Record<number, BaseUser>;

export interface ProblemConfig {
    redirect?: [string, string];
    count: number;
    time?: number;
    memory?: number;
    memoryMax: number;
    memoryMin: number;
    timeMax: number;
    timeMin: number;
    langs?: string[];
    time_limit_rate?: Record<string, number>;
    memory_limit_rate?: Record<string, number>;
    type: string;
    maxScore: number;
    mode?: 'text' | 'compile';
    subType?: string;
    target?: string;
    hackable?: boolean;
    /**
     * 客观题的学生端题目描述符（**无标准答案**），parseConfig 对
     * type=objective 生成——普通题目页/比赛/homework 的结构化
     * 渲染器消费（PLAN 2026-07 P3.2 Rev.11）。
     */
    questions?: ClientQuestion[];
    /** 客观题选项（questionKey → 选项文本），与 questions[].choices 同源。 */
    options?: Record<string, string[]>;
    /** 编译型程序填空/代码实现题的学生端安全描述，不含私有完整模板。 */
    template?: {
        lang?: string;
        surface: ClientStructuredCodeSegment[];
    };
}

export type Content = string | Record<string, string>;

export interface Document {
    _id: ObjectId;
    docId: any;
    docType: number;
    domainId: string;
    owner: number;
    maintainer?: number[];
}

declare module './model/problem' {
    interface ProblemDoc {
        docType: document['TYPE_PROBLEM'];
        docId: number;
        pid: string;
        title: string;
        content: string;
        nSubmit: number;
        nAccept: number;
        tag: string[];
        data: FileInfo[];
        additional_file: FileInfo[];
        hidden?: boolean;
        lockHidden?: boolean;
        html?: boolean;
        stats?: any;
        difficulty?: number;
        /**
         * 赛时通过率（原赛通过数据）：题目在原始比赛（牛客/杭电等外站）
         * 当时的通过/提交数。来源：real_pass_percent 老插件数据一次性迁移
         * + /manage/realpass 手动录入。比赛/考试进行中会在题面剥离
         * （见 handler/problem.ts 的 contest-mode strip）。
         */
        origStat?: {
            accepted: number;
            submitted: number;
            updatedBy: number;
            updatedAt: Date;
        };
        sort?: string;
        reference?: {
            domainId: string;
            pid: number;
        };

        /** Missing only on legacy problems, where it means programming. */
        problemKind?: import('@hydrooj/common').ProblemKind;
        /** Missing means the legacy owner/maintainer authorization model. */
        authoringMode?: 'managed';
        /** Explicit statement protocol. Missing means pre-P3.25 legacy Markdown. */
        statementFormat?: import('./lib/programming-statement').ProgrammingStatementFormat;
        /** Canonical editable source for structured-v1 programming statements. */
        programmingStatement?: import('./lib/programming-statement').ProgrammingStatement;
        /** Author-only canonical anti-AI marker anchors; never expose this raw shape to students. */
        antiAiMarkers?: import('./lib/anti-ai-marker').AntiAiMarkerDocument;
        /** Canonical source identity for a managed programming problem. */
        sourceMeta?: {
            template:
                | 'pat_basic'
                | 'pat_advanced'
                | 'gplt_national'
                | 'gplt_provincial'
                | 'cauc'
                | 'self'
                | 'nowcoder_summer'
                | 'hdu_summer'
                | 'hdu_spring';
            year: number;
            season?: 'spring' | 'summer' | 'autumn' | 'winter';
            level?: 'L1' | 'L2' | 'L3';
            round?: number;
        };
        /** Internal managed-authoring state; never part of public problem projections. */
        managedAuthoring?: {
            workingTitle: string;
            selectedMindmapNodeIds?: ObjectId[];
            metadataStatus: 'draft' | 'confirmed';
            pendingTrainingPlacement?: {
                trainingId: ObjectId;
                chapterId: number;
            };
            approvedBy?: number;
            approvedAt?: Date;
        };
        /** Immutable identity and local-content fingerprint for deterministic contest batch imports. */
        batchImport?: {
            batchId: string;
            sourceProblemCode: string;
            identity: string;
            fingerprint: string;
        };
        /** Equality-only partial-index discriminator; absent on all non-batch and legacy problems. */
        hasBatchImportIdentity?: true;
        /** The one knowledge map that owns this problem's canonical knowledge selections. */
        knowledgeMapId?: ObjectId;
        /** Canonical knowledge selections for dedicated structured problems; `tag` is server-derived from these nodes. */
        knowledgeNodeIds?: ObjectId[];
        /** Explicit lifecycle for function and compile-mode program-fill problems. */
        codeEvaluationStatus?: 'draft' | 'ready';
        structureRevision?: number;
        structureLockedAt?: Date;
        structureLockReason?: 'first_submission' | 'container_started';
        archivedAt?: Date;
        archivedBy?: number;
        archiveReason?: string;

        /** string (errormsg) */
        config: string | ProblemConfig;
    }
}
export type { ProblemDoc } from './model/problem';
export type ProblemDict = NumericDictionary<ProblemDoc>;

export interface StatusDocBase {
    _id: ObjectId;
    docId: any;
    docType: number;
    domainId: string;
    uid: number;
}

export interface ProblemStatusDoc extends StatusDocBase {
    docId: number;
    docType: 10;
    rid?: ObjectId;
    score?: number;
    status?: number;
    star?: boolean;
}

export type ProblemDataWriteOperation = 'files-upload' | 'files-rename' | 'files-delete' | 'generate-testdata-request' | 'statement-edit';

export interface ProblemDataWriteConfirmation {
    requestId: string;
    domainId: string;
    pid: number;
    actor: number;
    operation: ProblemDataWriteOperation;
    containerFingerprint: string;
    issuedAt: number;
}

export type RecordDoc = {
    [K in keyof RecordPayload]: K extends 'hackTarget' | 'contest' | 'contestTeamId' ? ObjectId : RecordPayload[K];
} & {
    _id: ObjectId;
    notify?: boolean;
    /** Short-lived, fact-bound admin confirmation carried to an async generation callback. */
    dataWriteActiveContainerConfirmation?: ProblemDataWriteConfirmation;
    /** Server-validated practice context snapshot carried to the asynchronous judge callback. */
    practiceContext?: import('./model/practice-integrity').TrustedPracticeContextReference;
};

export interface RecordHistoryDoc extends RecordJudgeInfo {
    _id: ObjectId;
    rid: ObjectId;
}

export interface RecordStatDoc {
    _id: ObjectId;
    domainId: string;
    pid: number;
    uid: number;
    time: number;
    memory: number;
    length: number;
    lang: string;
}

export interface ScoreboardNode {
    type: 'string' | 'rank' | 'user' | 'email' | 'record' | 'records' | 'problem' | 'solved' | 'time' | 'total_score';
    value: string; // 显示分数
    raw?: any;
    team?: {
        name: string;
        captainUid: number;
        memberUids: number[];
    };
    score?: number; // 原始分数（100，不含赛制加成）
    scorePercentage?: number; // 按该题实际满分归一化后的展示百分比
    style?: string;
    hover?: string;
}
export type ScoreboardRow = ScoreboardNode[] & { raw?: any };

export type PenaltyRules = Dictionary<number>;

export interface TrainingNode {
    _id: number;
    title: string;
    content?: string;
    requireNids: number[];
    pids: number[];
    /**
     * Krypton 课程模块（PLAN 2026-07-02 §10）：章节引用的比赛/作业 tid 列表
     * （引用制——比赛在比赛模块独立创建，章节只存 tid）。仅 course 用。
     */
    tids?: ObjectId[];
    /** Course chapter live-reference to a problem set. Members stay on the set. */
    problemSetId?: ObjectId;
    /** When omitted, the chapter references the whole problem set. */
    stageIds?: number[];
}

export interface Tdoc extends Document {
    docId: ObjectId;
    docType: document['TYPE_CONTEST'];
    beginAt: Date;
    endAt: Date;
    attend: number;
    title: string;
    content: string;
    rule: string;
    pids: number[];
    rated?: boolean;
    _code?: string;
    assign?: string[];
    files?: FileInfo[];
    privateFiles?: FileInfo[];
    allowViewCode?: boolean;
    allowPrint?: boolean;
    keepScoreboardHidden?: boolean;

    // ── Krypton: per-contest ACM participation identity ────────────────
    /** Missing is intentionally equivalent to `individual` for every legacy contest. */
    participationMode?: 'individual' | 'team';
    /** CAS revision used only when changing participationMode. */
    participationRevision?: number;
    /** Closed pre-contest batch used to materialize this contest's independent roster snapshot. */
    teamBatchId?: ObjectId;
    /** Management-only pre-binding; runtime authorization never reads TeamBatch data through this field. */
    plannedTeamBatchId?: ObjectId;
    teamBatchSnapshotHash?: string;
    teamBatchSnapshotAt?: Date;
    teamBatchSnapshotCount?: number;

    // For contest
    lockAt?: Date;
    unlocked?: boolean;
    /** Durable retry marker for a persisted contest edit whose status recalculation has not been acknowledged yet. */
    statusRecalcToken?: string;
    /** Exact retry set for an auto-hide visibility transition that has not completed. */
    autoHidePendingPids?: number[];
    /** Complete set of problems still owned by this contest's auto-hide lifecycle. */
    autoHideProblemPids?: number[];
    autoHide?: boolean;
    balloon?: Record<number, string | { color: string; name: string }>;
    score?: Record<number, number>;
    langs?: string[];

    /**
     * In hours
     * 在比赛有效时间内选择特定的 X 小时参加比赛（从首次打开比赛算起）
     */
    duration: number;

    // For homework
    penaltySince?: Date;
    penaltyRules?: PenaltyRules;

    // For training
    description?: string;
    dag?: TrainingNode[];

    // ── Krypton: client-required contest & Vigil anti-cheat ───────────────
    /**
     * `vigilEnabled` — whether this contest is wired to Vigil anti-cheat.
     * `entryMode`    — `open` allows normal browser entry; `client_required`
     *                  forces the Qt Client. `client_required` implies
     *                  `vigilEnabled = true`.
     * The lockout-window fields control how many minutes before/after the
     * contest the normal-browser-login lockout is active for in-scope
     * students (default 60/30). They only matter when entryMode is
     * client_required.
     */
    vigilEnabled?: boolean;
    /** Durable acknowledgement marker for an enabled → disabled Vigil mirror deletion. */
    vigilDeletePending?: boolean;
    entryMode?: 'open' | 'client_required';
    approvalMode?: 'strict' | 'auto';
    lockdownMode?: boolean;
    networkLockdownMode?: boolean;
    networkLockdownFailurePolicy?: 'strict' | 'report_only' | 'off';
    networkWhitelistHosts?: string[];
    networkWhitelistIps?: string[];
    networkWhitelistPorts?: number[];
    pauseOnDisconnect?: boolean;
    screenshotIntervalMs?: number;
    exclusive?: boolean;
    clientLoginBlockBeforeMinutes?: number;
    clientLoginBlockAfterMinutes?: number;

    // ── Krypton: live media + recording + 8-class event detection ─────────
    /**
     * `liveEnabled`    — client pushes RTMP screen stream to SRS. Default true.
     * `recordEnabled`  — SRS dvr writes mp4 (300 students × 1080p × 2h ≈ 510 GB
     *                    per session). Default false. Only meaningful when
     *                    `liveEnabled = true`.
     * `cameraEnabled`  — client pushes a second RTMP stream from the webcam.
     *                    Default true (lab assumes physical proctoring).
     * `screenshotJitterMs` — random jitter added to/subtracted from
     *                    `screenshotIntervalMs` per capture so students cannot
     *                    predict timing. Default 30000 (60s ± 30s).
     * `vigilProcessWhitelist` — additional allow-listed executable names on
     *                    top of the Vigil server's global whitelist.
     *                    Anything else triggers
     *                    `process_started_unauthorized` event.
     */
    liveEnabled?: boolean;
    recordEnabled?: boolean;
    cameraEnabled?: boolean;
    screenshotJitterMs?: number;
    vigilProcessWhitelist?: string[];

    /**
     * Krypton participant scope — independent of legacy `assign`.
     *
     * `participantScopeMode = 'none'`   → fall back to legacy Hydro access control.
     * `participantScopeMode = 'schools'`→ restrict to `participantSchoolIds`.
     * `participantScopeMode = 'groups'` → restrict to `participantGroupIds`.
     *
     * The two list fields are mutually exclusive (school mode ignores the
     * group list and vice versa). When a non-`none` mode is selected the
     * effective check is `(legacy Hydro access) AND (Krypton scope hit)`.
     */
    participantScopeMode?: 'none' | 'schools' | 'groups';
    participantSchoolIds?: ObjectId[];
    participantGroupIds?: ObjectId[];
}

export interface TrainingDoc extends Omit<Tdoc, 'docType'> {
    docType: document['TYPE_TRAINING'];
    description: string;
    pin?: number;
    dag: TrainingNode[];
    /**
     * docType 40 容器类型：新建题集写 `problem_set`；无 kind 或旧
     * `training` 在读取时解释为题集；`course` 只表示课程。未知 kind fail closed。
     */
    kind?: 'training' | 'course' | 'problem_set';
    /** 课程可见范围：绑定的 userbind 班级 id（空 = 全域可见）。仅 course。 */
    courseGroupIds?: ObjectId[];
    /** Optional public knowledge map rendered inside a course workspace. */
    mindmapId?: ObjectId;
    /** 课程学期等元信息（自由文本），仅展示用。仅 course。 */
    term?: string;
    /**
     * Problem-set discovery audience. Missing means public legacy behaviour.
     * `public:false` with empty groupIds is redeem/course-only.
     */
    problemSetAudience?: {
        public: boolean;
        groupIds: ObjectId[];
    };
}

export interface DomainDoc extends Record<string, any> {
    _id: string;
    owner: number;
    roles: Dictionary<string>;
    avatar: string;
    bulletin: string;
    _join?: any;
    host?: string[];
}

// Message
export interface MessageDoc {
    from: number;
    to: number | number[];
    content: string;
    flag: number;
}

// Blacklist
export interface BlacklistDoc {
    /**
     * @example ip:1.1.1.1
     * @example mail:foo.com
     */
    _id: string;
    expireAt: Date;
}

// Discussion
export type { DiscussionDoc } from './model/discussion';
declare module './model/discussion' {
    interface DiscussionDoc {
        docType: document['TYPE_DISCUSSION'];
        docId: ObjectId;
        parentType: number;
        parentId: ObjectId | number | string;
        title: string;
        content: string;
        ip: string;
        pin: boolean;
        highlight: boolean;
        updateAt: Date;
        nReply: number;
        views: number;
        edited?: boolean;
        editor?: number;
        react: Record<string, number>;
        sort: number;
        lastRCount: number;
        lock?: boolean;
        hidden?: boolean;
    }
}

export interface DiscussionReplyDoc extends Document {
    docType: document['TYPE_DISCUSSION_REPLY'];
    docId: ObjectId;
    parentType: document['TYPE_DISCUSSION'];
    parentId: ObjectId;
    ip: string;
    content: string;
    reply: DiscussionTailReplyDoc[];
    edited?: boolean;
    editor?: number;
    react: Record<string, number>;
}

export interface DiscussionTailReplyDoc {
    _id: ObjectId;
    owner: number;
    content: string;
    ip: string;
    edited?: boolean;
    editor?: number;
}

export interface ContestClarificationDoc extends Document {
    docType: document['TYPE_CONTEST_CLARIFICATION'];
    docId: ObjectId;
    parentType: document['TYPE_CONTEST'];
    parentId: ObjectId;
    // 0: contest -1: technique [pid]: problem
    subject: number;
    ip: string;
    content: string;
    reply: DiscussionTailReplyDoc[];
}

export interface ContestPrintDoc extends Document {
    docType: document['TYPE_CONTEST_PRINT'];
    docId: ObjectId;
    parentType: document['TYPE_CONTEST'];
    parentId: ObjectId;
    title: string;
    content: string;
    status: PrintTaskStatus;
}

export interface TokenDoc {
    _id: string;
    tokenType: number;
    createAt: Date;
    updateAt: Date;
    expireAt: Date;
    [key: string]: any;
}

/**
 * Per-channel attribute constraints for an auth token. Each consuming plugin
 * interprets the keys relevant to its channel (e.g. krypton-userbind reads
 * `schools`/`years`, krypton-tasks reads `scoreLevels`). Loose by design so a
 * new channel can add keys without a schema migration. See lib/auth-token.ts.
 */
export interface ScopeFilters {
    /** userbind schoolId hex strings the token may touch. */
    schools?: string[];
    /** enrollmentYear cohorts the token may touch. */
    years?: number[];
    /** PAT/GPLT/CSP level keys the token may enter scores for. */
    scoreLevels?: string[];
    [key: string]: unknown;
}

/**
 * A user-bound API access token ("kat" = Krypton Access Token). The plaintext
 * is shown once at issue and never persisted — only its SHA-256 `hash` is
 * stored. `uid: null` means a pure service token (vigil-style, channel-only).
 * See lib/auth-token.ts for the lifecycle + resolution logic.
 */
export interface AuthTokenDoc {
    _id: ObjectId;
    /** SHA-256 hex of the presented token. Unique. */
    hash: string;
    /** Non-secret prefix (e.g. `kat_AbCd…`) for identifying the token in lists. */
    display: string;
    domainId: string;
    /** Bound Hydro user, or null for a pure service token. */
    uid: number | null;
    /** Endpoint channels this token may reach. */
    channels: string[];
    /** Permission-bitmask cap (decimal string; bigint is not BSON-native). null = PERM_ALL. */
    scopeMask: string | null;
    /** Per-channel attribute filters. */
    scopeFilters: ScopeFilters;
    label: string;
    createdBy: number;
    createdAt: Date;
    lastUsedAt: Date | null;
    /** null = never expires; a past date is reaped by the TTL index. */
    expiresAt: Date | null;
    revoked: boolean;
}

/**
 * One problem imported by the crawler tool. Dedups re-crawls (unique on
 * (domainId, sourceUrl)) and carries the external key (cid + problemId) so the
 * testdata-align step can match a contest's testdata zip back to the problem.
 * See handler/crawler.ts + docs/PLAN-2026-06-11-crawler-tool.md.
 */
export interface CrawlerImportDoc {
    _id: ObjectId;
    domainId: string;
    /** Created problem's docId. */
    docId: number;
    /** Created problem's pid (may be ''). */
    pid: string;
    /** Source site, e.g. 'hdu' | 'pta'. */
    source: string;
    /** Dedup key. */
    sourceUrl: string;
    /** Contest id for testdata matching (null if N/A). */
    cid: number | null;
    /** Problem number/letter within the contest, for testdata matching. */
    problemId: string | null;
    /** Crawled limits, applied to config.yaml when testdata is attached. */
    timeLimit: string;
    memoryLimit: string;
    createdBy: number;
    createdAt: Date;
    updatedAt?: Date;
}

export interface OplogDoc extends Record<string, any> {
    _id: ObjectId;
    type: string;
}

export interface ContestStat extends Record<string, any> {
    detail: Record<number, Record<string, any>>;
    unrank?: boolean;
}

export interface ScoreboardConfig {
    isExport: boolean;
    showDisplayName: boolean;
    lockAt?: Date;
}

export type Feature = 'scoreboard' | 'download';

export interface ContestRule<T = any> {
    _originalRule?: Partial<ContestRule<T>>;
    TEXT: string;
    hidden?: boolean;
    features?: Feature[];
    check: (args: any) => any;
    statusSort: Record<string, 1 | -1>;
    submitAfterAccept: boolean;
    showScoreboard: (tdoc: Tdoc, now: Date) => boolean;
    showSelfRecord: (tdoc: Tdoc, now: Date) => boolean;
    showRecord: (tdoc: Tdoc, now: Date) => boolean;
    stat: (this: ContestRule<T>, tdoc: Tdoc, journal: any[]) => ContestStat & T;
    scoreboardHeader: (
        this: ContestRule<T>,
        config: ScoreboardConfig,
        _: (s: string) => string,
        tdoc: Tdoc,
        pdict: ProblemDict,
    ) => Promise<ScoreboardRow>;
    scoreboardRow: (
        this: ContestRule<T>,
        config: ScoreboardConfig,
        _: (s: string) => string,
        tdoc: Tdoc,
        pdict: ProblemDict,
        udoc: BaseUser,
        rank: number,
        tsdoc: ContestStat & T,
        meta?: any,
    ) => Promise<ScoreboardRow>;
    scoreboard: (
        this: ContestRule<T>,
        config: ScoreboardConfig,
        _: (s: string) => string,
        tdoc: Tdoc,
        pdict: ProblemDict,
        cursor: FindCursor<ContestStat & T>,
    ) => Promise<[board: ScoreboardRow[], udict: BaseUserDict]>;
    ranked: (tdoc: Tdoc, cursor: FindCursor<ContestStat & T>) => Promise<[number, ContestStat & T][]>;
    applyProjection: (tdoc: Tdoc, rdoc: RecordDoc, user: User) => RecordDoc;
}

export type ContestRules = Dictionary<ContestRule>;
export type ProblemImporter = (url: string, handler: any) => Promise<[ProblemDoc, fs.ReadStream?]> | [ProblemDoc, fs.ReadStream?];

export interface Script {
    run: (args: any, report: Function) => any;
    description: string;
    validate: any;
}

export interface Task {
    _id: ObjectId;
    type: string;
    subType?: string;
    priority: number;
    [key: string]: any;
}

export interface Schedule {
    _id: ObjectId;
    type: string;
    subType?: string;
    executeAfter: Date;
    [key: string]: any;
}

export interface FileNode {
    /** File Path In S3 */
    _id: string;
    /** Actual File Path */
    path: string;
    lastUsage?: Date;
    lastModified?: Date;
    etag?: string;
    /** Size: in bytes */
    size?: number;
    /** AutoDelete */
    autoDelete?: Date;
    /** fileId if linked to an existing file */
    link?: string;
    owner?: number;
    operator?: number[];
    meta?: Record<string, string | number>;
}

export interface EventDoc {
    ack: string[];
    event: number | string;
    payload: string;
    expire: Date;
    trace?: string;
}

export interface OpCountDoc {
    _id: ObjectId;
    op: string;
    ident: string;
    expireAt: Date;
    opcount: number;
}

export type { OauthMap, OAuthProvider, OAuthUserResponse } from './model/oauth';

export interface DiscussionHistoryDoc {
    title?: string;
    content: string;
    domainId: string;
    docId: ObjectId;
    /** Create time */
    time: Date;
    uid: number;
    ip: string;
}

export interface ContestBalloonDoc {
    _id: ObjectId;
    domainId: string;
    tid: ObjectId;
    pid: number;
    uid: number;
    /** Stable team identity for team-mode ACM; uid remains the true submitting actor. */
    contestTeamId?: ObjectId;
    /** Unique participant identity: `u:<uid>` for individuals or `t:<teamId>` for teams. */
    identityKey?: string;
    /** Equality-only partial-index marker for records carrying identityKey. */
    identityIndexed?: true;
    first?: boolean;
    /** Sent by */
    sent?: number;
    sentAt?: Date;
}

export interface LockDoc {
    _id: ObjectId;
    key: string;
    lockAt: Date;
    daemonId: string;
}

declare module './service/db' {
    interface Collections {
        blacklist: BlacklistDoc;
        domain: DomainDoc;
        'domain.user': any;
        record: RecordDoc;
        'record.stat': RecordStatDoc;
        'record.history': RecordHistoryDoc;
        document: any;
        'document.status': StatusDocBase &
            {
                [K in keyof DocStatusType]: { docType: K } & DocStatusType[K];
            }[keyof DocStatusType];
        'discussion.history': DiscussionHistoryDoc;
        user: Udoc;
        'user.preference': UserPreferenceDoc;
        vuser: VUdoc;
        'user.group': GDoc;
        check: System;
        message: MessageDoc;
        token: TokenDoc;
        'authtoken.tokens': AuthTokenDoc;
        'crawler.imported': CrawlerImportDoc;
        status: any;
        oauth: OauthMap;
        system: System;
        task: Task;
        storage: FileNode;
        oplog: OplogDoc;
        event: EventDoc;
        opcount: OpCountDoc;
        schedule: Schedule;
        'contest.balloon': ContestBalloonDoc;
        'contest.teams': import('./model/contest-team').ContestTeamDoc;
        'contest.teamBatches': import('./model/contest-team-batch').TeamBatchDoc;
        'contest.teamBatchTeams': import('./model/contest-team-batch').TeamBatchTeamDoc;
        'contest.teamBatchInvites': import('./model/contest-team-batch').TeamBatchInviteDoc;
        'contest.teamCodeSnapshots': import('./model/contest-team-code').TeamCodeSnapshotDoc;
        'contest.teamCodeSnapshotCounters': import('./model/contest-team-code').TeamCodeSnapshotCounterDoc;
        'contest.teamStatuses': import('./model/contest-team-status').TeamContestStatusDoc;
        'practice.integrityRevisions': import('./model/practice-integrity').PracticeIntegrityRevisionDoc;
        'practice.contexts': import('./model/practice-integrity').PracticeContextDoc;
        'practice.contextualCompletions': import('./model/contextual-completion').ContextualCompletionDoc;
        'access.entitlements': import('./model/problem-set-access').AccessEntitlementDoc;
        'redemption.batches': import('./model/redemption').RedemptionCodeBatchDoc;
        'redemption.codes': import('./model/redemption').RedemptionCodeDoc;
        'redemption.redemptions': import('./model/redemption').RedemptionDoc;
        'endpoint.enrollmentBatches': import('./model/endpoint-enrollment').EndpointEnrollmentBatchDoc;
        'endpoint.registrations': import('./model/endpoint-enrollment').EndpointRegistrationDoc;
        'exam.events': import('./model/exam-event').ExamEventDoc;
        'exam.classrooms': import('./lib/classsignin-classroom-migration').ExamClassroomDoc;
        'exam.classroomImportBatches': import('./lib/classsignin-classroom-migration').ClassSigninClassroomMigrationBatchDoc;
        'exam.seatOperationalProfiles': import('./model/exam-seat-operational-profile').ExamSeatOperationalProfileDoc;
        'exam.endpointSeatBindings': import('./model/endpoint-seat-binding').EndpointSeatBindingDoc;
        'exam.endpointSeatPairingWindows': import('./model/endpoint-seat-binding').EndpointSeatPairingWindowDoc;
        'exam.policyTemplates': import('./model/exam-network-config').ExamPolicyTemplateDoc;
        'exam.targetAssignments': import('./model/exam-network-config').ExamTargetAssignmentDoc;
        'exam.eventNetworkConfigs': import('./model/exam-network-config').ExamEventNetworkConfigDoc;
        'exam.networkExecutions': import('./model/exam-network-execution').ExamNetworkExecutionDoc;
        'exam.rosterRevisions': import('./model/exam-seat-plan').ExamRosterRevisionDoc;
        'exam.seatPlans': import('./model/exam-seat-plan').ExamSeatPlanDoc;
        'exam.seatAssignments': import('./model/exam-seat-assignment').ExamSeatAssignmentRevisionDoc;
        'exam.seatAssignmentPublications': import('./model/exam-seat-assignment').ExamSeatAssignmentPublicationDoc;
        'exam.preloginBatches': import('./model/exam-prelogin').ExamPreloginBatchDoc;
        'exam.preloginTickets': import('./model/exam-prelogin').ExamPreloginTicketDoc;
        lock: LockDoc;
    }
}

export interface UserbindModelBridge {
    listSchools(domainId: string): Promise<Array<{ _id: ObjectId; domainId: string; name: string }>>;
    listUserGroups(
        domainId: string,
        schoolId?: ObjectId,
    ): Promise<Array<{ _id: ObjectId; domainId: string; schoolId: ObjectId; name: string; archivedAt?: Date | null }>>;
    getSchool(domainId: string, schoolId: ObjectId): Promise<{ _id: ObjectId; domainId: string; name: string } | null>;
    findStudentByUserId(domainId: string, userId: number): Promise<{ schoolId?: ObjectId; groupIds?: ObjectId[] } | null>;
    findStudentsByUserIds(domainId: string, userIds: number[]): Promise<Record<string, { studentId: string; realName: string }>>;
    searchBoundStudents(
        domainId: string,
        query: string,
        limit?: number,
    ): Promise<Array<{ boundUserId: number; studentId: string; realName: string }>>;
    findBoundStudentsByGroupIds(
        domainId: string,
        groupIds: ObjectId[],
    ): Promise<Array<{ boundUserId: number | null; groupIds: ObjectId[]; studentId: string; realName: string }>>;
    loadExamRosterUserbindSnapshot(
        domainId: string,
        schoolId: ObjectId,
        selectedGroupIds: ObjectId[] | null,
    ): Promise<{
        domainId: string;
        schoolId: ObjectId;
        schoolName: string;
        selectionKind: 'groups' | 'school';
        selectedGroupIds: ObjectId[];
        groups: Array<{
            groupId: ObjectId;
            schoolId: ObjectId;
            name: string;
            archivedAt: Date | null;
            fingerprint: string;
        }>;
        students: Array<{
            studentRecordId: ObjectId;
            schoolId: ObjectId;
            studentId: string;
            realName: string;
            groupIds: ObjectId[];
            boundUserId: number | null;
        }>;
        fingerprint: string;
    }>;
}

export interface Model {
    blacklist: typeof import('./model/blacklist').default;
    builtin: typeof import('./model/builtin');
    contest: typeof import('./model/contest');
    contestTeam: Omit<typeof import('./model/contest-team'), 'apply'>;
    contestTeamBatch: Omit<typeof import('./model/contest-team-batch'), 'apply'>;
    contestTeamCode: Omit<typeof import('./model/contest-team-code'), 'apply'>;
    contestTeamStatus: Omit<typeof import('./model/contest-team-status'), 'apply'>;
    discussion: typeof import('./model/discussion');
    document: Omit<typeof import('./model/document'), 'apply'>;
    domain: typeof import('./model/domain').default;
    message: typeof import('./model/message').default;
    opcount: typeof import('./model/opcount');
    problem: typeof import('./model/problem').default;
    record: typeof import('./model/record').default;
    setting: typeof import('./model/setting');
    solution: typeof import('./model/solution').default;
    system: typeof import('./model/system').default;
    task: typeof import('./model/task').default;
    schedule: typeof import('./model/schedule').default;
    oplog: typeof import('./model/oplog');
    token: typeof import('./model/token').default;
    training: typeof import('./model/training');
    practiceIntegrity: Pick<
        typeof import('./model/practice-integrity'),
        | 'assertTrustedPracticeContextBinding'
        | 'canonicalPracticePolicy'
        | 'canonicalTrustedPracticeContextReference'
        | 'combinePracticePolicies'
        | 'practiceContextColl'
        | 'practiceIntegrityRevisionColl'
        | 'practiceIntegrityService'
        | 'trustedPracticeContextReference'
    >;
    contextualCompletion: Pick<typeof import('./model/contextual-completion'), 'contextualCompletionColl' | 'contextualCompletionService'>;
    endpointEnrollment: Pick<
        typeof import('./model/endpoint-enrollment'),
        'endpointEnrollmentBatchColl' | 'endpointEnrollmentBatchService' | 'endpointRegistrationColl' | 'endpointRegistrationService'
    >;
    endpointSeatBinding: Pick<
        typeof import('./model/endpoint-seat-binding'),
        'endpointSeatBindingColl' | 'endpointSeatPairingWindowColl' | 'endpointSeatBindingService'
    >;
    examEvent: Pick<typeof import('./model/exam-event'), 'examEventColl' | 'examEventService'>;
    examClassroom: Pick<typeof import('./model/exam-classroom'), 'examClassroomColl' | 'examClassroomMigrationBatchColl' | 'examClassroomService'>;
    examSeatOperationalProfile: Pick<
        typeof import('./model/exam-seat-operational-profile'),
        'examSeatOperationalProfileColl' | 'examSeatOperationalProfileService'
    >;
    examNetworkConfig: Pick<
        typeof import('./model/exam-network-config'),
        | 'examPolicyTemplateColl'
        | 'examTargetAssignmentColl'
        | 'examEventNetworkConfigColl'
        | 'examNetworkConfigService'
        | 'loadExamTargetRevisionEndpointIds'
        | 'registerExamTargetResolver'
        | 'requireExamTargetResolver'
        | 'registerExamNetworkControlPlaneResolver'
        | 'requireExamNetworkControlPlaneResolver'
    >;
    examNetworkExecution: Pick<typeof import('./model/exam-network-execution'), 'examNetworkExecutionColl' | 'examNetworkExecutionService'>;
    examSeatPlan: Pick<typeof import('./model/exam-seat-plan'), 'examRosterRevisionColl' | 'examSeatPlanColl' | 'examSeatPlanService'>;
    examSeatAssignment: Pick<
        typeof import('./model/exam-seat-assignment'),
        'examSeatAssignmentColl' | 'examSeatAssignmentPublicationColl' | 'examSeatAssignmentService'
    >;
    examPrelogin: Pick<typeof import('./model/exam-prelogin'), 'examPreloginBatchColl' | 'examPreloginTicketColl'>;
    user: typeof import('./model/user').default;
    oauth: typeof import('./model/oauth').default;
    storage: typeof import('./model/storage').default;
    rp: typeof import('./script/rating').RpTypes;
    /** Optional bridge exposed when @hydrooj/krypton-userbind is loaded. */
    userbind?: UserbindModelBridge;
}

export interface GeoIP {
    provider: string;
    lookup: (ip: string, locale?: string) => any;
}

export interface ProblemSearchResponse {
    hits: string[];
    total: number;
    countRelation: 'eq' | 'gte';
}
export interface ProblemSearchOptions {
    limit?: number;
    skip?: number;
}

export type ProblemSearch = (domainId: string, q: string, options?: ProblemSearchOptions) => Promise<ProblemSearchResponse>;

export type UIInjectableFields = 'ProblemAdd' | 'Notification' | 'Nav' | 'UserDropdown' | 'DomainManage' | 'ControlPanel';
export interface UI {
    nodes: Record<UIInjectableFields, any[]>;
    getNodes: typeof import('./lib/ui').getNodes;
    inject: typeof import('./lib/ui').inject;
}

export interface ModuleInterfaces {
    hash: (password: string, salt: string, user: User) => boolean | string | Promise<string>;
    problemSearch: ProblemSearch;
}

export interface HydroGlobal {
    version: Record<string, string>;
    model: Model;
    script: Record<string, Script>;
    module: { [K in keyof ModuleInterfaces]: Record<string, ModuleInterfaces[K]> };
    ui: UI;
    error: typeof import('./error');
    Logger: typeof import('./logger').Logger;
    logger: typeof import('./logger').logger;
    locales: Record<string, Record<string, string> & Record<symbol, Record<string, string>>>;
}

declare global {
    namespace NodeJS {
        interface Global {
            Hydro: HydroGlobal;
            addons: string[];
        }
    }
    /** @deprecated */
    var bus: Context; // eslint-disable-line
    var app: Context; // eslint-disable-line
    var Hydro: HydroGlobal; // eslint-disable-line
    var addons: Record<string, string>; // eslint-disable-line
}
