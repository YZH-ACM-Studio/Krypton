import { ObjectId } from 'mongodb';
import {
    EXAM_PAPER_HOUR_MS,
    examPaperQuotaTotal,
    examShowsVerdict,
    feedbackOpen,
    groupByPta,
    homeworkKindRevealsVerdict,
    isExamPaperFinalized,
    isExamPaperStarted,
    isExamPaperWindowClosed,
    isOnePerPageKind,
    letterLabel,
    type ProblemKind,
    type SetCodePolicy,
    type SetPermissions,
    ptaKindName,
    ptaLabel,
    readExamPaperQuotas,
    readStoredSetConfig,
    judgePointMaximum, paperPointEntry, paperProblemMaximum, roundPaperPoints, type SetPaperPoints,
    STATUS,
    teachTypeOfContestRule,
} from '@hydrooj/common';
import type { Tdoc } from '../interface';
import type ProblemModel from '../model/problem';
import { homeworkShowsObjectiveVerdict } from './homework-objective-verdict';
import { getSetResultVisibility } from './set-result-visibility';

export type WsKind = 'homework' | 'paper' | 'contest';
export type WsFlavor = 'homework' | 'paper' | 'acm' | 'ioi' | 'oi';
export type WsPhase = 'upcoming' | 'ready' | 'answering' | 'submitted' | 'ended';
export type WsLockReason = 'not_started' | 'not_open' | 'need_start' | 'need_attend' | 'client_only' | 'view_closed';
export type CellState = 'empty' | 'draft' | 'submitted' | 'correct' | 'wrong' | 'partial';

export interface WsItem {
    excluded?: boolean;
    rawMax?: number;
    pid: number;
    label: string;
    title: string;
    kind: ProblemKind;
    score: number;
    state: CellState;
    submits: number;
    lastScore: number | null;
    feedback?: { score: boolean; verdict: boolean; details: boolean };
}

export interface WsGroup {
    kind: ProblemKind;
    no: number | null;
    name: string;
    scoreEach: number | null;
    items: WsItem[];
}

export interface WsInfoRow {
    label: string;
    text?: string;
    at?: string;
    range?: [string, string];
}

export interface WsAnnouncement {
    id: string;
    subject: string;
    content: string;
    createdAt: string;
}

export interface WsClarification {
    id: string;
    subject: string;
    content: string;
    createdAt: string;
    replies: Array<{ content: string; createdAt: string }>;
}

export interface SetWorkspace {
    rules?: { autoSaveBeforeEnd: boolean; prohibitCodePaste: boolean; showDifficulty: boolean; discussion: boolean };
    kind: WsKind;
    flavor: WsFlavor;
    codePolicy?: SetCodePolicy;
    tid: string;
    title: string;
    description: string;
    mode: 'browser' | 'client' | 'preview';
    phase: WsPhase;
    locked: { reason: WsLockReason } | null;
    numbering: 'pta' | 'letter';
    window: {
        beginAt: string;
        endAt: string;
        dueAt: string | null;
        durationMinutes: number | null;
        startAt: string | null;
        personalEndAt: string | null;
        lockAt: string | null;
    };
    groups: WsGroup[];
    totals: {
        problemCount: number;
        maxScore: number | null;
        answered: number;
        score: number | null;
        accepted: number | null;
        showScore: boolean;
    };
    verdictVisible: boolean;
    /** Homework students only. False hides objective right/wrong; function and programming stay visible. */
    objectiveVerdictVisible: boolean;
    team: { teamName: string; role: 'captain' | 'member' } | null;
    paper: {
        score: number | null;
        passed: boolean | null;
        judging: boolean;
        passScore: number | null;
        attemptLimit: number | null;
        attemptsUsed: number;
        canRetake: boolean;
        submitByKind: boolean;
        lockedKinds: string[];
    } | null;
    announcements: WsAnnouncement[];
    clarifications: WsClarification[];
    info: WsInfoRow[];
    student: { name: string; studentId: string | null };
    action: {
        canStart: boolean;
        canFinalize: boolean;
        canAttend: boolean;
        canUnrank: boolean;
        canSubmit: boolean;
        attended: boolean;
        canRetake: boolean;
        invitationRequired?: boolean;
    };
    officialRound?: { id: string; roundNo: number; startedAt: string; closedAt: string | null } | null;
    urls: {
        back: string | null;
        manage: string | null;
        overview: string;
        problem: string | null;
        submit: string | null;
        pretest: string | null;
        submitCode: string | null;
        recordDetail: string;
        records: string;
        ranking: string | null;
        clarify: string | null;
        print: string | null;
        start: string | null;
        attend: string | null;
        draftList: string | null;
        saveAnswers?: string | null;
        draftUpsert: string | null;
        submitKind: string | null;
        lockKind: string | null;
        finalize: string | null;
        virtual: string | null;
        practice: string | null;
        discussion?: string | null;
        teamProblem: string | null;
        // Optional so existing link builders stay assignable. buildSetWorkspace always sets both.
        verifyObjective?: string | null;
        verifySubmit?: string | null;
    };
}

export interface DraftFacts {
    answers: Record<string, string | string[]> | null;
    submittedAnswers: Record<string, string | string[]> | null;
    code: string | null;
    version?: number;
    score?: number | null;
    judgeResult: Record<string, 'correct' | 'wrong' | 'partial'> | null;
}

export interface JournalFacts {
    submits: number;
    lastStatus: number | null;
    lastScore: number | null;
}

export interface SetWorkspaceInput {
    permissions?: SetPermissions | null;
    kind: WsKind;
    tdoc: Tdoc;
    tsdoc: Record<string, unknown> | null;
    now: Date;
    mode: SetWorkspace['mode'];
    problems: Array<{ pid: number; title: string; kind: ProblemKind; score: number; excluded?: boolean; rawMax?: number; judged?: boolean }>;
    drafts: Map<number, DraftFacts>;
    journal: Map<number, JournalFacts>;
    paperFacts: SetWorkspace['paper'];
    officialRound?: { id: string; roundNo: number; scoreLocked?: true; startedAt: Date; closedAt: Date | null } | null;
    canRetakeRound?: boolean;
    invitationRequired?: boolean;
    officialResult?: { maxPoints?: number; score: number | null; accepted: number | null; showScore: boolean };
    canAttend: boolean;
    canUnrank: boolean;
    canShowScoreboard: boolean;
    postContestPracticeOpen: boolean;
    postContestViewClosed: boolean;
    virtualAvailable: boolean;
    canClarify: boolean;
    team: SetWorkspace['team'];
    announcements: WsAnnouncement[];
    clarifications: WsClarification[];
    student: SetWorkspace['student'];
    urls: SetWorkspace['urls'];
}

type ProblemInput = SetWorkspaceInput['problems'][number];

export async function scoreWorkspaceProblems(
    model: Pick<typeof ProblemModel, 'getList'>,
    domainId: string,
    tdoc: { score?: unknown; setPoints?: SetPaperPoints; setConfig?: unknown },
    problems: ReadonlyArray<Omit<ProblemInput, 'score'>>,
): Promise<ProblemInput[]> {
    if (!problems.length) return [];
    const configs = tdoc.setPoints ? null : await model.getList(domainId, problems.map(({ pid }) => pid), true, true, ['docId', 'config'], true);
    return problems.map((problem) => {
        const entry = tdoc.setPoints && paperPointEntry(tdoc.setPoints, problem.pid);
        const rawMax = entry?.rawMax ?? judgePointMaximum(problem.kind, configs?.[problem.pid]?.config);
        return { ...problem, score: entry?.excluded ? 0 : paperProblemMaximum(tdoc, problem.pid, rawMax),
            ...(tdoc.setConfig || entry ? { rawMax } : {}), ...(entry?.excluded ? { excluded: true } : {}) };
    });
}

interface DurationFacts {
    minutes: number | null;
    ms: number;
}

interface ClockFacts {
    beginAt: Date;
    endAt: Date;
    nowAt: Date;
    duration: DurationFacts;
    startAt: Date | null;
    personalEndAt: Date | null;
}

const FLAVOR_BY_RULE: Record<string, WsFlavor> = {
    homework: 'homework',
    exam: 'paper',
    contest: 'ioi',
    acm: 'acm',
    ioi: 'ioi',
    strictioi: 'ioi',
    oi: 'oi',
    ledo: 'oi',
};

const KIND_BY_FLAVOR: Record<WsFlavor, WsKind> = {
    homework: 'homework',
    paper: 'paper',
    acm: 'contest',
    ioi: 'contest',
    oi: 'contest',
};

const CONTEST_TYPE_TEXT: Record<'acm' | 'ioi' | 'oi', string> = {
    acm: '考试 · ACM',
    ioi: '考试 · IOI',
    oi: '考试 · OI',
};

const CONTEST_RULE_TEXT: Record<'acm' | 'ioi' | 'oi', string> = {
    acm: 'ACM · 每次错误提交罚时 20 分钟',
    ioi: 'IOI · 按测试点给分',
    oi: 'OI · 结束后公布成绩',
};

function requireDate(value: unknown, field: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new TypeError(`${field} must be a Date`);
    }
    return value;
}

function optionalDate(value: unknown, field: string): Date | null {
    if (value == null) return null;
    return requireDate(value, field);
}

function requireWsKind(kind: WsKind): WsKind {
    if (kind !== 'homework' && kind !== 'paper' && kind !== 'contest') {
        throw new TypeError(`unknown workspace kind: ${String(kind)}`);
    }
    return kind;
}

function requireMode(mode: SetWorkspace['mode']): SetWorkspace['mode'] {
    if (mode !== 'browser' && mode !== 'client' && mode !== 'preview') {
        throw new TypeError(`unknown workspace mode: ${String(mode)}`);
    }
    return mode;
}

function flavorOf(rule: unknown): WsFlavor {
    if (typeof rule !== 'string') throw new TypeError('rule must be a string');
    const flavor = FLAVOR_BY_RULE[rule];
    if (!flavor) throw new TypeError(`unknown contest rule: ${rule}`);
    return flavor;
}

function assertKind(kind: WsKind, flavor: WsFlavor): void {
    if (KIND_BY_FLAVOR[flavor] !== kind) {
        throw new TypeError(`workspace kind ${kind} does not match rule flavor ${flavor}`);
    }
}

function readDuration(duration: unknown): DurationFacts {
    if (duration == null) return { minutes: null, ms: 0 };
    if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        throw new TypeError('duration must be a finite number');
    }
    if (!(duration > 0)) return { minutes: null, ms: 0 };
    return { minutes: Math.round(duration * 60), ms: duration * EXAM_PAPER_HOUR_MS };
}

function clockOf(tdoc: Tdoc, tsdoc: Record<string, unknown> | null, now: Date, round?: SetWorkspaceInput['officialRound']): ClockFacts {
    const beginAt = requireDate(tdoc.beginAt, 'beginAt');
    const endAt = requireDate(tdoc.endAt, 'endAt');
    const nowAt = requireDate(now, 'now');
    const configured = hasStoredSet(tdoc);
    const duration = readDuration(configured ? readStoredSetConfig(tdoc).settings.personalLimit.hours : tdoc.duration);
    const startAt = optionalDate(configured ? round?.startedAt : tsdoc?.startAt, 'startAt');
    const personalEndAt = duration.ms > 0 && startAt
        ? new Date(Math.min(startAt.getTime() + duration.ms, endAt.getTime()))
        : null;
    return { beginAt, endAt, nowAt, duration, startAt, personalEndAt };
}

function dueDate(tdoc: Tdoc, endAt: Date): Date | null {
    if (hasStoredSet(tdoc)) {
        const late = readStoredSetConfig(tdoc).settings.late;
        return late.enabled ? late.onTimeAt : null;
    }
    if (tdoc.rule !== 'homework' || tdoc.penaltySince == null) return null;
    const penalty = requireDate(tdoc.penaltySince, 'penaltySince');
    if (penalty.getTime() >= endAt.getTime()) return null;
    return penalty;
}

function attended(tsdoc: Record<string, unknown> | null): boolean {
    return tsdoc?.attend === 1;
}

/** Key-sorted JSON. Array elements are sorted so reordered answers compare equal (C3). */
function canonicalJson(value: unknown): string {
    const text = JSON.stringify(canonicalize(value));
    if (typeof text !== 'string') throw new TypeError('canonicalJson cannot encode this value');
    return text;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        const items = value.map((item) => canonicalize(item));
        items.sort((left, right) => {
            const a = JSON.stringify(left);
            const b = JSON.stringify(right);
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        });
        return items;
    }
    if (value !== null && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
        return sorted;
    }
    return value;
}

function hasAnswerKeys(answers: DraftFacts['answers']): boolean {
    return !!answers && !Array.isArray(answers) && Object.keys(answers).length > 0;
}

function homeworkDraftOpen(draft: DraftFacts | undefined): boolean {
    if (!draft || !hasAnswerKeys(draft.answers)) return false;
    return canonicalJson(draft.answers) !== canonicalJson(draft.submittedAnswers ?? null);
}

function draftPresent(draft: DraftFacts | undefined): boolean {
    if (!draft) return false;
    if (hasAnswerKeys(draft.answers)) return true;
    return typeof draft.code === 'string' && draft.code.length > 0;
}

function journalState(facts: JournalFacts | undefined, partialOnScore: boolean): CellState {
    if (!facts) return 'empty';
    if (facts.lastStatus === STATUS.STATUS_ACCEPTED) return 'correct';
    if (partialOnScore && typeof facts.lastScore === 'number' && facts.lastScore > 0) return 'partial';
    if (facts.submits > 0 || facts.lastStatus !== null) return 'wrong';
    return 'empty';
}

function judgeState(result: DraftFacts['judgeResult']): CellState {
    if (!result || Object.keys(result).length === 0) return 'submitted';
    const values = Object.values(result);
    if (values.every((value) => value === 'correct')) return 'correct';
    if (values.every((value) => value === 'wrong')) return 'wrong';
    return 'partial';
}

/** Handed in only after finalize, or after the personal window (plus grace) closes. `phase === 'ended'` is the contest clock, not a submit. */
function paperHandedIn(tdoc: Tdoc, tsdoc: Record<string, unknown> | null, now: Date): boolean {
    return isExamPaperFinalized(tsdoc)
        || (isExamPaperStarted(tsdoc) && isExamPaperWindowClosed(tdoc, tsdoc, now));
}

function objectiveConcealed(flavor: WsFlavor, concealObjective: boolean, kind: ProblemKind): boolean {
    return flavor === 'homework' && concealObjective && !homeworkKindRevealsVerdict(kind);
}

function itemState(
    flavor: WsFlavor,
    handedIn: boolean,
    verdictVisible: boolean,
    concealObjective: boolean,
    problem: ProblemInput,
    draft: DraftFacts | undefined,
    facts: JournalFacts | undefined,
): CellState {
    if (objectiveConcealed(flavor, concealObjective, problem.kind)) {
        const judged = facts != null && (facts.submits > 0 || facts.lastStatus !== null);
        if (homeworkDraftOpen(draft) || hasAnswerKeys(draft?.answers) || judged) return 'submitted';
        return 'empty';
    }
    if (flavor === 'homework') {
        if (homeworkDraftOpen(draft)) return 'draft';
        return journalState(facts, true);
    }
    if (flavor === 'paper') {
        if (handedIn) {
            if (!verdictVisible) return draftPresent(draft) ? 'submitted' : 'empty';
            if (isOnePerPageKind(problem.kind)) return journalState(facts, true);
            return judgeState(draft?.judgeResult ?? null);
        }
        if (draftPresent(draft)) return 'draft';
        if (isOnePerPageKind(problem.kind) && verdictVisible) return journalState(facts, true);
        return 'empty';
    }
    return journalState(facts, flavor !== 'acm');
}

function scoreEachOf(scores: readonly number[]): number | null {
    if (scores.length === 0) return null;
    const first = scores[0];
    for (const score of scores) {
        if (score !== first) return null;
    }
    return first;
}

function sumScores(problems: readonly ProblemInput[]): number {
    let total = 0;
    for (const problem of problems) {
        if (typeof problem.score !== 'number' || !Number.isFinite(problem.score)) {
            throw new TypeError('problem score must be a finite number');
        }
        total += problem.score;
    }
    return total;
}

function sumLastScores(problems: readonly ProblemInput[], journal: Map<number, JournalFacts>): number {
    let total = 0;
    for (const problem of problems) {
        const score = journal.get(problem.pid)?.lastScore;
        if (score == null) continue;
        if (typeof score !== 'number' || !Number.isFinite(score)) {
            throw new TypeError('lastScore must be a finite number');
        }
        total += score;
    }
    return total;
}

function textRow(label: string, text: string): WsInfoRow {
    return { label, text };
}

function atRow(label: string, at: string): WsInfoRow {
    return { label, at };
}

function rangeRow(label: string, beginAt: Date, endAt: Date): WsInfoRow {
    return { label, range: [beginAt.toISOString(), endAt.toISOString()] };
}

function limitRow(minutes: number | null): WsInfoRow | null {
    if (minutes === null) return null;
    return textRow('个人限时', `${minutes} 分钟，开始后计时`);
}

function homeworkInfo(tdoc: Tdoc, beginAt: Date, endAt: Date, minutes: number | null): WsInfoRow[] {
    const rows: WsInfoRow[] = [
        textRow('类型', '作业'),
        rangeRow('开放', beginAt, endAt),
    ];
    const due = dueDate(tdoc, endAt);
    if (due) {
        rows.push(atRow('截止', due.toISOString()));
        rows.push(textRow('迟交', `到 ${endAt.toISOString()}，按老师设置扣分`));
    }
    const limit = limitRow(minutes);
    if (limit) rows.push(limit);
    return rows;
}

function paperProblemCount(tdoc: Tdoc): number {
    const quotas = readExamPaperQuotas(tdoc.examPaperQuotas);
    if (quotas) return examPaperQuotaTotal(quotas);
    if (!Array.isArray(tdoc.pids)) throw new TypeError('pids must be an array');
    return tdoc.pids.length;
}

function paperInfo(tdoc: Tdoc, beginAt: Date, endAt: Date, minutes: number | null): WsInfoRow[] {
    const rows: WsInfoRow[] = [
        textRow('类型', '考试 · 试卷'),
        rangeRow('开放', beginAt, endAt),
    ];
    const limit = limitRow(minutes);
    if (limit) rows.push(limit);
    rows.push(textRow('题目', `${paperProblemCount(tdoc)} 题`));
    rows.push(textRow('对错', examShowsVerdict(tdoc) ? '提交后显示' : '只显示分数'));
    if (typeof tdoc.examPassScore === 'number' && tdoc.examPassScore > 0) {
        rows.push(textRow('及格线', `${tdoc.examPassScore} 分`));
    }
    if (typeof tdoc.examAttemptLimit === 'number' && tdoc.examAttemptLimit >= 1) {
        rows.push(textRow('可考次数', `最多 ${tdoc.examAttemptLimit} 次`));
    }
    return rows;
}

function contestInfo(flavor: 'acm' | 'ioi' | 'oi', tdoc: Tdoc, beginAt: Date, endAt: Date): WsInfoRow[] {
    const rows: WsInfoRow[] = [
        textRow('类型', CONTEST_TYPE_TEXT[flavor]),
        rangeRow('时间', beginAt, endAt),
        textRow('赛制', CONTEST_RULE_TEXT[flavor]),
        textRow('参赛', tdoc.participationMode === 'team' ? '团队赛' : '个人赛'),
    ];
    if (tdoc.entryMode === 'client_required') rows.push(textRow('进入方式', '机房客户端'));
    const lockAt = optionalDate(tdoc.lockAt, 'lockAt');
    if (lockAt) rows.push(atRow('封榜', lockAt.toISOString()));
    return rows;
}

function rewriteDescription(kind: WsKind, mode: SetWorkspace['mode'], docId: ObjectId, content: string): string {
    const id = docId.toHexString();
    const base = kind === 'paper' && mode !== 'client'
        ? `../contest/${id}/file/public/`
        : `./${id}/file/public/`;
    return content.replace(/\(file:\/\//g, `(${base}`).replace(/="file:\/\//g, `="${base}`);
}

function workspaceLock(
    kind: WsKind,
    mode: SetWorkspace['mode'],
    phase: WsPhase,
    tdoc: Tdoc,
    postContestViewClosed: boolean,
): SetWorkspace['locked'] {
    if (mode === 'preview') return null;
    if (tdoc.entryMode === 'client_required' && mode === 'browser' && phase !== 'ended') {
        return { reason: 'client_only' };
    }
    if (phase === 'upcoming') return { reason: kind === 'homework' ? 'not_open' : 'not_started' };
    if (phase === 'ready') {
        const timedHomework = kind === 'homework' && readDuration(tdoc.duration).minutes !== null;
        let configured = false;
        try {
            readStoredSetConfig(tdoc);
            configured = true;
        } catch (error) {
            if (!(error instanceof TypeError) || error.message !== 'set_config_missing') throw error;
        }
        if (kind === 'paper' || timedHomework || configured) return { reason: 'need_start' };
        return { reason: 'need_attend' };
    }
    if (phase === 'ended' && postContestViewClosed) return { reason: 'view_closed' };
    return null;
}

function buildItem(
    problem: ProblemInput,
    label: string,
    hideTitle: boolean,
    flavor: WsFlavor,
    handedIn: boolean,
    verdictVisible: boolean,
    concealObjective: boolean,
    drafts: Map<number, DraftFacts>,
    journal: Map<number, JournalFacts>,
): WsItem {
    const facts = journal.get(problem.pid);
    const concealed = objectiveConcealed(flavor, concealObjective, problem.kind);
    return {
        pid: problem.pid,
        label,
        title: hideTitle ? '' : problem.title,
        kind: problem.kind,
        score: problem.score,
        ...(problem.excluded ? { excluded: true } : {}),
        ...(problem.rawMax != null ? { rawMax: problem.rawMax } : {}),
        state: itemState(flavor, handedIn, verdictVisible, concealObjective, problem, drafts.get(problem.pid), facts),
        submits: concealed ? 0 : facts?.submits ?? 0,
        lastScore: concealed ? null : facts ? facts.lastScore : null,
    };
}

function buildGroups(
    flavor: WsFlavor,
    problems: SetWorkspaceInput['problems'],
    hideTitle: boolean,
    handedIn: boolean,
    verdictVisible: boolean,
    concealObjective: boolean,
    drafts: Map<number, DraftFacts>,
    journal: Map<number, JournalFacts>,
): WsGroup[] {
    const make = (problem: ProblemInput, label: string) => buildItem(
        problem,
        label,
        hideTitle,
        flavor,
        handedIn,
        verdictVisible,
        concealObjective,
        drafts,
        journal,
    );
    if (flavor === 'acm' || flavor === 'ioi' || flavor === 'oi') {
        return [{
            kind: 'programming',
            no: null,
            name: '题目',
            scoreEach: scoreEachOf(problems.map((problem) => problem.score)),
            items: problems.map((problem, index) => make(problem, letterLabel(index))),
        }];
    }
    return groupByPta(problems).map((group) => ({
        kind: group.kind,
        no: group.no,
        name: ptaKindName(group.kind),
        scoreEach: scoreEachOf(group.items.map((problem) => problem.score)),
        items: group.items.map((problem, index) => make(problem, ptaLabel(group.kind, index))),
    }));
}

function hasStoredSet(tdoc: Tdoc): boolean {
    try {
        readStoredSetConfig(tdoc);
        return true;
    } catch (error) {
        if (error instanceof TypeError && error.message === 'set_config_missing') return false;
        throw error;
    }
}

export function workspacePhase(input: Pick<SetWorkspaceInput, 'kind' | 'tdoc' | 'tsdoc' | 'now' | 'officialRound'>): WsPhase {
    const kind = requireWsKind(input.kind);
    const clock = clockOf(input.tdoc, input.tsdoc, input.now, input.officialRound);
    if (clock.nowAt.getTime() < clock.beginAt.getTime()) return 'upcoming';
    if (clock.nowAt.getTime() >= clock.endAt.getTime()) return 'ended';
    if (hasStoredSet(input.tdoc)) {
        if (!input.officialRound) return 'ready';
        if (input.officialRound.closedAt || (clock.personalEndAt && clock.nowAt >= clock.personalEndAt)) return 'submitted';
        return 'answering';
    }
    if (kind === 'paper') {
        const started = isExamPaperStarted(input.tsdoc);
        const closed = started && isExamPaperWindowClosed(input.tdoc, input.tsdoc, clock.nowAt);
        if (isExamPaperFinalized(input.tsdoc) || closed) return 'submitted';
        return started ? 'answering' : 'ready';
    }
    const configured = hasStoredSet(input.tdoc);
    if (kind === 'homework') {
        if (configured || clock.duration.minutes !== null) {
            if (!clock.startAt) return 'ready';
            if (clock.personalEndAt && clock.nowAt.getTime() >= clock.personalEndAt.getTime()) return 'submitted';
            return 'answering';
        }
        return attended(input.tsdoc) ? 'answering' : 'ready';
    }
    if (!attended(input.tsdoc)) return 'ready';
    if (configured && !clock.startAt) return 'ready';
    if (clock.personalEndAt && clock.nowAt.getTime() >= clock.personalEndAt.getTime()) return 'submitted';
    return 'answering';
}

export function workspaceInfo(kind: WsKind, tdoc: Tdoc): WsInfoRow[] {
    const wsKind = requireWsKind(kind);
    const beginAt = requireDate(tdoc.beginAt, 'beginAt');
    const endAt = requireDate(tdoc.endAt, 'endAt');
    if (hasStoredSet(tdoc)) {
        const { purpose, settings } = readStoredSetConfig(tdoc);
        const labels = { homework: '作业', exam: '考试', contest: '比赛' };
        const rows = [textRow('类型', labels[purpose]), rangeRow('开放', beginAt, endAt)];
        const limit = limitRow(readDuration(settings.personalLimit.hours).minutes);
        if (limit) rows.push(limit);
        if (settings.late.enabled) rows.push(atRow('按时提交截止', settings.late.onTimeAt.toISOString()));
        rows.push(textRow('提前交卷', settings.earlyHandIn ? '允许' : '到时自动结束本轮'));
        rows.push(textRow('重新作答', `最多 ${settings.retake.extra} 次`));
        if (settings.retake.passScore !== null) rows.push(textRow('及格线', `${settings.retake.passScore} 分`));
        return rows;
    }
    const flavor = flavorOf(tdoc.rule);
    assertKind(wsKind, flavor);
    const minutes = readDuration(tdoc.duration).minutes;
    if (flavor === 'homework') return homeworkInfo(tdoc, beginAt, endAt, minutes);
    if (flavor === 'paper') return paperInfo(tdoc, beginAt, endAt, minutes);
    return contestInfo(flavor, tdoc, beginAt, endAt);
}

function verifyWorkspaceUrls(
    mode: SetWorkspace['mode'],
    rule: unknown,
    tid: string,
): { verifyObjective: string | null; verifySubmit: string | null } {
    if (mode !== 'preview') return { verifyObjective: null, verifySubmit: null };
    const teachType = teachTypeOfContestRule(rule);
    return {
        verifyObjective: `/teach/${teachType}/${tid}/verify/objective`,
        verifySubmit: `/teach/${teachType}/${tid}/verify/submit`,
    };
}

function workspaceWindow(tdoc: Tdoc, tsdoc: Record<string, unknown> | null, now: Date, round?: SetWorkspaceInput['officialRound']): SetWorkspace['window'] {
    const clock = clockOf(tdoc, tsdoc, now, round);
    const due = dueDate(tdoc, clock.endAt);
    const lockAt = optionalDate(tdoc.lockAt, 'lockAt');
    return {
        beginAt: clock.beginAt.toISOString(),
        endAt: clock.endAt.toISOString(),
        dueAt: due ? due.toISOString() : null,
        durationMinutes: clock.duration.minutes,
        startAt: clock.startAt ? clock.startAt.toISOString() : null,
        personalEndAt: clock.personalEndAt ? clock.personalEndAt.toISOString() : null,
        lockAt: lockAt ? lockAt.toISOString() : null,
    };
}

export function buildSetWorkspace(input: SetWorkspaceInput): SetWorkspace {
    const kind = requireWsKind(input.kind);
    const mode = requireMode(input.mode);
    const config = hasStoredSet(input.tdoc) ? readStoredSetConfig(input.tdoc) : null;
    const flavor = config
        ? kind === 'contest' ? (config.settings.codePolicy === 'acm' ? 'acm' : 'ioi') : kind
        : flavorOf(input.tdoc.rule);
    assertKind(kind, flavor);
    if (!(input.tdoc.docId instanceof ObjectId)) throw new TypeError('docId must be an ObjectId');
    if (typeof input.tdoc.title !== 'string') throw new TypeError('title must be a string');
    if (typeof input.tdoc.content !== 'string') throw new TypeError('content must be a string');
    const phase = workspacePhase(input);
    const accessEnded = input.permissions?.afterEnd === false && input.now >= input.tdoc.endAt;
    const locked = workspaceLock(kind, mode, phase, input.tdoc, input.postContestViewClosed || accessEnded);
    const objectiveFeedback = config?.settings.feedback.objective;
    const objectiveOpen = config && objectiveFeedback ? feedbackOpen(objectiveFeedback.when, config.settings.feedback.gradesReleased, input.now, input.officialRound?.closedAt ?? null, input.tdoc.endAt) : true;
    const verdictVisible = config ? true : flavor !== 'paper' || mode === 'preview' || examShowsVerdict(input.tdoc);
    const concealObjective = config
        ? mode !== 'preview' && (!objectiveOpen || objectiveFeedback?.reveal !== 'full')
        : flavor === 'homework' && mode !== 'preview' && !homeworkShowsObjectiveVerdict(input.tdoc);
    const handedIn = flavor === 'paper' && paperHandedIn(input.tdoc, input.tsdoc, input.now);
    const problems = input.officialRound?.scoreLocked && input.tdoc.setPoints ? input.problems.map((problem) => ({
        ...problem, excluded: false,
        score: paperProblemMaximum({ score: input.tdoc.score }, problem.pid, paperPointEntry(input.tdoc.setPoints, problem.pid).rawMax),
    })) : input.problems;
    const groups = buildGroups(
        config ? 'paper' : flavor,
        problems,
        locked !== null,
        handedIn,
        verdictVisible,
        concealObjective,
        input.drafts,
        input.journal,
    );
    if (config) {
        for (const group of groups) {
            for (const item of group.items) {
                const draft = input.drafts.get(item.pid);
                const facts = input.journal.get(item.pid);
                const problem = problems.find((candidate) => candidate.pid === item.pid);
                const visibility = getSetResultVisibility(config.settings, { kind: item.kind, judged: item.kind === 'programming' || item.kind === 'function' || problem?.judged === true }, { now: input.now, endAt: input.tdoc.endAt, roundClosedAt: input.officialRound?.closedAt ?? null });
                item.feedback = visibility;
                const hasAnswer = hasAnswerKeys(draft?.answers) || (facts?.submits ?? 0) > 0;
                item.state = !visibility.verdict ? hasAnswer ? 'submitted' : 'empty' : draft?.judgeResult ? judgeState(draft.judgeResult)
                    : facts?.lastStatus != null ? journalState(facts, true)
                        : hasAnswer ? 'submitted' : 'empty';
                item.submits = facts?.submits ?? 0;
                item.lastScore = visibility.score ? draft?.score ?? facts?.lastScore ?? null : null;
            }
        }
    }
    const answered = groups.reduce((count, group) => count + group.items.filter((item) => item.state !== 'empty').length, 0);
    const contestLike = !config && (flavor === 'acm' || flavor === 'ioi' || flavor === 'oi');
    const scoredProblems = !config && concealObjective
        ? problems.filter((problem) => homeworkKindRevealsVerdict(problem.kind))
        : problems;
    const score = config ? input.officialResult?.score ?? null : flavor === 'acm'
        ? null
        : flavor === 'paper'
            ? (input.paperFacts ? input.paperFacts.score : null)
            : sumLastScores(scoredProblems, input.journal);
    const showScore = config ? !config.settings.experience?.hideTotalScore && input.officialResult?.showScore === true : flavor === 'paper'
        ? (phase === 'ended' || phase === 'submitted') && verdictVisible && score !== null
        : !concealObjective || scoredProblems.length > 0;
    return {
        ...(config ? { rules: {
            autoSaveBeforeEnd: config.settings.experience?.autoSaveBeforeEnd === true,
            prohibitCodePaste: config.settings.experience?.prohibitCodePaste === true,
            showDifficulty: config.settings.experience?.showDifficulty === true,
            discussion: config.settings.experience?.discussion !== false,
        } } : {}),
        kind,
        flavor,
        ...(config ? { codePolicy: config.settings.codePolicy } : {}),
        tid: input.tdoc.docId.toHexString(),
        title: input.tdoc.title,
        description: rewriteDescription(kind, mode, input.tdoc.docId, input.tdoc.content),
        mode,
        phase,
        locked,
        numbering: contestLike ? 'letter' : 'pta',
        window: workspaceWindow(input.tdoc, input.tsdoc, input.now, input.officialRound),
        ...(config ? { officialRound: input.officialRound ? { ...input.officialRound, startedAt: input.officialRound.startedAt.toISOString(), closedAt: input.officialRound.closedAt?.toISOString() ?? null } : null } : {}),
        groups,
        totals: {
            problemCount: input.problems.length,
            maxScore: (config ? config.settings.codePolicy === 'acm' : flavor === 'acm') ? null : input.officialResult?.maxPoints ?? roundPaperPoints(sumScores(scoredProblems)),
            answered,
            score: config && !showScore ? null : score,
            accepted: config ? showScore ? input.officialResult?.accepted ?? null : null : flavor === 'acm'
                ? groups.reduce((count, group) => count + group.items.filter((item) => item.state === 'correct').length, 0)
                : null,
            showScore,
        },
        verdictVisible,
        objectiveVerdictVisible: !concealObjective,
        team: input.team,
        paper: config ? null : kind === 'paper' ? input.paperFacts : null,
        announcements: accessEnded ? [] : config?.settings.experience?.announcement && (input.officialRound || mode === 'preview')
            ? [{ id: 'set-announcement', subject: '作答公告', content: config.settings.experience.announcement, createdAt: input.tdoc.beginAt.toISOString() }, ...input.announcements]
            : input.announcements,
        clarifications: accessEnded ? [] : input.clarifications,
        info: workspaceInfo(kind, input.tdoc),
        student: input.student,
        action: {
            canStart: input.permissions?.problems !== 'hidden' && phase === 'ready' && !!input.urls.start && mode !== 'preview' && input.invitationRequired !== true && input.team?.role !== 'member'
                && (!config?.settings.personalLimit.requireFullWindow || input.now.getTime() + (config.settings.personalLimit.hours ?? 0) * EXAM_PAPER_HOUR_MS <= input.tdoc.endAt.getTime()),
            canFinalize: (!input.permissions || input.permissions.problems === 'answer') && (config ? config.settings.earlyHandIn && !!input.urls.finalize : kind === 'paper') && phase === 'answering' && mode !== 'preview' && input.team?.role !== 'member',
            canAttend: input.invitationRequired === true ? mode !== 'preview' : input.canAttend,
            canUnrank: input.canUnrank,
            canSubmit: (!input.permissions || input.permissions.problems === 'answer') && mode !== 'preview' && input.team?.role !== 'member' && (
                (phase === 'answering' && locked === null)
                || (contestLike && phase === 'ended' && input.postContestPracticeOpen)
            ),
            attended: attended(input.tsdoc),
            canRetake: (!input.permissions || input.permissions.problems === 'answer') && input.invitationRequired !== true && input.team?.role !== 'member' && (config ? input.canRetakeRound === true : input.paperFacts?.canRetake === true),
            ...(input.invitationRequired !== undefined ? { invitationRequired: input.invitationRequired } : {}),
        },
        urls: {
            ...input.urls,
            ...(config ? { discussion: !accessEnded && config.settings.experience?.discussion !== false && input.permissions?.problems !== 'hidden'
                ? mode === 'client' ? `/exam-mode/${input.tdoc.docId.toHexString()}/discussion` : `/discuss/contest/${input.tdoc.docId.toHexString()}` : null } : {}),
            ...(config?.settings.experience?.allowSelfTest === false ? { pretest: null } : {}),
            ...verifyWorkspaceUrls(mode, input.tdoc.rule, input.tdoc.docId.toHexString()),
        },
    };
}
