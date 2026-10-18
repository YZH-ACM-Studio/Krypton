import { ObjectId } from 'mongodb';
import {
    EXAM_PAPER_HOUR_MS,
    examPaperQuotaTotal,
    isExamPaperStarted,
    readExamPaperQuotas,
    studentContestProblemPids,
} from '@hydrooj/common';
import type { Tdoc } from '../interface';
import { getParticipationMode } from '../model/contest-participation';

export type StudentSetsTab = 'running' | 'upcoming' | 'practice' | 'ended';
export type ContestWindow = 'upcoming' | 'running' | 'ended';
export type ContestFlavor = 'paper' | 'acm' | 'ioi' | 'oi' | 'homework';

export type ContestProgress =
    | { answered: number }
    | { accepted: number }
    | { score: number }
    | null;

export interface ContestRow {
    kind: 'exam' | 'homework';
    id: string;
    flavor: ContestFlavor;
    title: string;
    href: string;
    beginAt: string;
    endAt: string;
    dueAt: string | null;
    durationMinutes: number | null;
    startAt: string | null;
    personalEndAt: string | null;
    attended: boolean;
    clientRequired: boolean;
    team: boolean;
    problemCount: number;
    progress: ContestProgress;
    finalized: boolean;
    done: boolean;
}

export interface TeamRow {
    kind: 'team';
    id: string;
    title: string;
    href: string;
    description: string;
    myState: 'none' | 'invited' | 'joined';
    inviteCount: number;
    memberCount: number | null;
}

export interface ContestRowStatus {
    attend?: number;
    startAt?: Date;
    detail?: unknown;
    accept?: number;
    score?: number;
    paperFinalizedAt?: Date;
    examPaperPids?: number[];
}

export interface SerializeContestRowInput {
    tdoc: Tdoc;
    tsdoc: ContestRowStatus | null;
    href: string;
    draftCount: number | null;
    now: Date;
}

export interface StudentSetCounts {
    running: number;
    upcoming: number;
    practice: number;
}

const FLAVOR_BY_RULE: Record<string, ContestFlavor> = {
    exam: 'paper',
    acm: 'acm',
    ioi: 'ioi',
    strictioi: 'ioi',
    oi: 'oi',
    ledo: 'oi',
    homework: 'homework',
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

function requireText(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
    return value;
}

function finiteOrZero(value: unknown, field: string): number {
    if (value == null) return 0;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${field} must be a finite number`);
    }
    return value;
}

function readDuration(duration: unknown): { minutes: number | null; ms: number } {
    if (duration == null) return { minutes: null, ms: 0 };
    if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        throw new TypeError('duration must be a finite number');
    }
    if (!(duration > 0)) return { minutes: null, ms: 0 };
    return { minutes: Math.round(duration * 60), ms: duration * EXAM_PAPER_HOUR_MS };
}

function detailKeys(detail: unknown): Set<string> {
    if (detail == null) return new Set();
    if (typeof detail !== 'object' || Array.isArray(detail)) {
        throw new TypeError('homework detail must be an object');
    }
    return new Set(Object.keys(detail));
}

function homeworkAnswered(pids: readonly number[], detail: unknown): number {
    const keys = detailKeys(detail);
    let answered = 0;
    for (const pid of pids) {
        if (keys.has(String(pid))) answered += 1;
    }
    return answered;
}

function draftAnswered(draftCount: number | null): number {
    if (typeof draftCount !== 'number' || !Number.isInteger(draftCount) || draftCount < 0) {
        throw new TypeError('draftCount must be a non-negative integer for a started paper');
    }
    return draftCount;
}

function contestPids(tdoc: Tdoc): number[] {
    if (!Array.isArray(tdoc.pids)) throw new TypeError('pids must be an array');
    return tdoc.pids;
}

function problemCountOf(tdoc: Tdoc, tsdoc: ContestRowStatus | null, started: boolean): number {
    if (tdoc.rule === 'exam' && !started) {
        const quotas = readExamPaperQuotas(tdoc.examPaperQuotas);
        if (quotas) return examPaperQuotaTotal(quotas);
    }
    return studentContestProblemPids(tdoc, tsdoc).length;
}

function dueAtOf(rule: string, penaltySince: Date | null, endAt: Date): string | null {
    if (rule !== 'homework' || !penaltySince) return null;
    if (penaltySince.getTime() >= endAt.getTime()) return null;
    return penaltySince.toISOString();
}

function progressOf(
    flavor: ContestFlavor,
    answered: number,
    started: boolean,
    finalized: boolean,
    attended: boolean,
    tsdoc: ContestRowStatus | null,
    draftCount: number | null,
): ContestProgress {
    if (flavor === 'homework') return { answered };
    if (flavor === 'paper') {
        if (started && !finalized) return { answered: draftAnswered(draftCount) };
        return null;
    }
    if (!attended || !tsdoc) return null;
    if (flavor === 'acm') return { accepted: finiteOrZero(tsdoc.accept, 'accept') };
    return { score: finiteOrZero(tsdoc.score, 'score') };
}

function rowDone(
    flavor: ContestFlavor,
    finalized: boolean,
    started: boolean,
    problemCount: number,
    answered: number,
    personalEndMs: number | null,
    now: Date,
): boolean {
    const reachedPersonalEnd = personalEndMs !== null && now.getTime() >= personalEndMs;
    if (flavor === 'paper') return finalized || (started && reachedPersonalEnd);
    if (flavor === 'homework') {
        return (problemCount > 0 && answered === problemCount) || reachedPersonalEnd;
    }
    return reachedPersonalEnd;
}

export function classifyWindow(beginAt: Date, endAt: Date, now: Date): ContestWindow {
    const beginMs = requireDate(beginAt, 'beginAt').getTime();
    const endMs = requireDate(endAt, 'endAt').getTime();
    const nowMs = requireDate(now, 'now').getTime();
    if (nowMs < beginMs) return 'upcoming';
    if (nowMs < endMs) return 'running';
    return 'ended';
}

export function flavorOf(rule: string): ContestFlavor {
    if (typeof rule !== 'string') throw new TypeError('rule must be a string');
    const flavor = FLAVOR_BY_RULE[rule];
    if (!flavor) throw new TypeError(`unknown contest rule: ${rule}`);
    return flavor;
}

export function serializeContestRow(input: SerializeContestRowInput): ContestRow {
    const { tdoc, tsdoc, draftCount } = input;
    const href = requireText(input.href, 'href');
    const now = requireDate(input.now, 'now');
    if (!(tdoc.docId instanceof ObjectId)) throw new TypeError('docId must be an ObjectId');
    const beginAt = requireDate(tdoc.beginAt, 'beginAt');
    const endAt = requireDate(tdoc.endAt, 'endAt');
    const title = requireText(tdoc.title, 'title');
    const flavor = flavorOf(tdoc.rule);
    const pids = contestPids(tdoc);
    const duration = readDuration(tdoc.duration);
    const startAt = optionalDate(tsdoc?.startAt, 'startAt');
    const started = isExamPaperStarted(tsdoc);
    const personalEndMs = duration.minutes === null || !startAt
        ? null
        : Math.min(startAt.getTime() + duration.ms, endAt.getTime());
    const finalized = flavor === 'paper' && optionalDate(tsdoc?.paperFinalizedAt, 'paperFinalizedAt') !== null;
    const attended = tsdoc?.attend === 1;
    const answered = flavor === 'homework' ? homeworkAnswered(pids, tsdoc?.detail) : 0;
    const problemCount = problemCountOf(tdoc, tsdoc, started);
    return {
        kind: flavor === 'homework' ? 'homework' : 'exam',
        id: tdoc.docId.toHexString(),
        flavor,
        title,
        href,
        beginAt: beginAt.toISOString(),
        endAt: endAt.toISOString(),
        dueAt: dueAtOf(tdoc.rule, optionalDate(tdoc.penaltySince, 'penaltySince'), endAt),
        durationMinutes: duration.minutes,
        startAt: startAt ? startAt.toISOString() : null,
        personalEndAt: personalEndMs === null ? null : new Date(personalEndMs).toISOString(),
        attended,
        clientRequired: tdoc.entryMode === 'client_required',
        team: getParticipationMode(tdoc) === 'team',
        problemCount,
        progress: progressOf(flavor, answered, started, finalized, attended, tsdoc, draftCount),
        finalized,
        done: rowDone(flavor, finalized, started, problemCount, answered, personalEndMs, now),
    };
}

function compareId(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function instant(iso: string, field: string): number {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new TypeError(`${field} is not a time`);
    return ms;
}

function runningGroup(row: ContestRow | TeamRow): number {
    if (row.kind === 'team') return 0;
    return row.done ? 2 : 1;
}

function urgencyMs(row: ContestRow, now: Date): number {
    if (row.personalEndAt) return instant(row.personalEndAt, 'personalEndAt');
    if (row.kind === 'homework' && row.dueAt) {
        const due = instant(row.dueAt, 'dueAt');
        if (now.getTime() < due) return due;
    }
    return instant(row.endAt, 'endAt');
}

export function sortRunning(rows: readonly (ContestRow | TeamRow)[], now: Date): (ContestRow | TeamRow)[] {
    const nowDate = requireDate(now, 'now');
    return rows.slice().sort((left, right) => {
        const group = runningGroup(left) - runningGroup(right);
        if (group !== 0) return group;
        if (left.kind === 'team' || right.kind === 'team') return compareId(left.id, right.id);
        if (!left.done && !right.done) {
            const byUrgency = urgencyMs(left, nowDate) - urgencyMs(right, nowDate);
            if (byUrgency !== 0) return byUrgency;
        } else {
            const byEnd = instant(left.endAt, 'endAt') - instant(right.endAt, 'endAt');
            if (byEnd !== 0) return byEnd;
        }
        return compareId(left.id, right.id);
    });
}

export function sortUpcoming(rows: readonly ContestRow[]): ContestRow[] {
    return rows.slice().sort((left, right) => {
        const byBegin = instant(left.beginAt, 'beginAt') - instant(right.beginAt, 'beginAt');
        if (byBegin !== 0) return byBegin;
        return compareId(left.id, right.id);
    });
}

export function pickDefaultTab(counts: StudentSetCounts): StudentSetsTab {
    if (counts.running > 0) return 'running';
    if (counts.upcoming > 0) return 'upcoming';
    return 'practice';
}
