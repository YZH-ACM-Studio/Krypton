import { ObjectId } from 'mongodb';
import { Time } from '@hydrooj/utils/lib/utils';
import type { Tdoc } from '../interface';
import { getParticipationMode } from '../model/contest-participation';

export const VIRTUAL_CONTEST_RULES = ['acm', 'oi', 'ioi', 'ledo', 'strictioi'] as const;
export type VirtualContestRule = (typeof VIRTUAL_CONTEST_RULES)[number];
export type VirtualContestAttemptStatus = 'active' | 'ended' | 'cancelled' | 'voided';

export interface VirtualContestSnapshot {
    rule: VirtualContestRule;
    pids: number[];
    score: Record<number, number>;
    title: string;
    durationMs: number;
    lockOffsetMs: number | null;
    sourceBeginAt: Date;
    sourceEndAt: Date;
    langs: string[];
}

export interface VirtualContestEligibility {
    allowed: boolean;
    reason?:
        | 'not_ended'
        | 'rule_unsupported'
        | 'team_contest'
        | 'virtual_disabled'
        | 'has_subjective'
        | 'has_manual_grade'
        | 'invalid_schedule'
        | 'no_problems'
        | 'invite_required'
        | 'missing_problems';
}

export function isVirtualContestRule(rule: unknown): rule is VirtualContestRule {
    return typeof rule === 'string' && (VIRTUAL_CONTEST_RULES as readonly string[]).includes(rule);
}

export function contestAllowsVirtual(tdoc: Pick<Tdoc, 'allowVirtual'>): boolean {
    return tdoc.allowVirtual !== false;
}

export function isContestGloballyEnded(tdoc: Pick<Tdoc, 'endAt'>, now = new Date()): boolean {
    if (!(tdoc.endAt instanceof Date) || Number.isNaN(tdoc.endAt.getTime())) throw new TypeError('Contest endAt must be a valid Date.');
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Virtual contest time must be a valid Date.');
    return tdoc.endAt.getTime() <= now.getTime();
}

export function virtualContestDurationMs(tdoc: Pick<Tdoc, 'beginAt' | 'endAt' | 'duration'>): number {
    if (!(tdoc.beginAt instanceof Date) || Number.isNaN(tdoc.beginAt.getTime())) throw new TypeError('Contest beginAt must be a valid Date.');
    if (!(tdoc.endAt instanceof Date) || Number.isNaN(tdoc.endAt.getTime())) throw new TypeError('Contest endAt must be a valid Date.');
    if (tdoc.beginAt.getTime() >= tdoc.endAt.getTime()) throw new TypeError('Contest beginAt must be before endAt.');
    if (typeof tdoc.duration === 'number' && tdoc.duration > 0) return Math.round(tdoc.duration * Time.hour);
    return tdoc.endAt.getTime() - tdoc.beginAt.getTime();
}

export function virtualContestLockOffsetMs(tdoc: Pick<Tdoc, 'beginAt' | 'lockAt'>): number | null {
    if (!tdoc.lockAt) return null;
    if (!(tdoc.beginAt instanceof Date) || Number.isNaN(tdoc.beginAt.getTime())) throw new TypeError('Contest beginAt must be a valid Date.');
    if (!(tdoc.lockAt instanceof Date) || Number.isNaN(tdoc.lockAt.getTime())) throw new TypeError('Contest lockAt must be a valid Date.');
    const offset = tdoc.lockAt.getTime() - tdoc.beginAt.getTime();
    return offset > 0 ? offset : null;
}

export function evaluateVirtualContestEligibility(
    tdoc: Pick<Tdoc, 'rule' | 'beginAt' | 'endAt' | 'allowVirtual' | 'participationMode' | 'pids' | '_code'> & { duration?: number },
    input: {
        now?: Date;
        hasSubjective?: boolean;
        hasManualGrade?: boolean;
        missingProblems?: boolean;
        attended?: boolean;
    } = {},
): VirtualContestEligibility {
    const now = input.now || new Date();
    try {
        virtualContestDurationMs(tdoc);
    } catch (error) {
        if (error instanceof TypeError) return { allowed: false, reason: 'invalid_schedule' };
        throw error;
    }
    if (!Array.isArray(tdoc.pids) || !tdoc.pids.length) return { allowed: false, reason: 'no_problems' };
    if (!isVirtualContestRule(tdoc.rule)) return { allowed: false, reason: 'rule_unsupported' };
    if (getParticipationMode(tdoc as Tdoc) === 'team') return { allowed: false, reason: 'team_contest' };
    if (!contestAllowsVirtual(tdoc)) return { allowed: false, reason: 'virtual_disabled' };
    if (input.hasSubjective) return { allowed: false, reason: 'has_subjective' };
    if (input.hasManualGrade) return { allowed: false, reason: 'has_manual_grade' };
    if (input.missingProblems) return { allowed: false, reason: 'missing_problems' };
    if (tdoc._code && input.attended !== true) return { allowed: false, reason: 'invite_required' };
    if (!isContestGloballyEnded(tdoc, now)) return { allowed: false, reason: 'not_ended' };
    return { allowed: true };
}

export function buildVirtualContestSnapshot(tdoc: Tdoc): VirtualContestSnapshot {
    if (!isVirtualContestRule(tdoc.rule)) throw new TypeError('virtual contest snapshot requires a supported rule');
    const pids = Array.from(new Set((tdoc.pids || []).map(Number))).filter((pid) => Number.isSafeInteger(pid) && pid > 0);
    if (!pids.length) throw new TypeError('virtual contest snapshot requires problem ids');
    const score: Record<number, number> = {};
    for (const pid of pids) {
        const value = tdoc.score?.[pid];
        if (typeof value === 'number' && Number.isFinite(value)) score[pid] = value;
    }
    return {
        rule: tdoc.rule,
        pids,
        score,
        title: String(tdoc.title || ''),
        durationMs: virtualContestDurationMs(tdoc),
        lockOffsetMs: virtualContestLockOffsetMs(tdoc),
        sourceBeginAt: tdoc.beginAt,
        sourceEndAt: tdoc.endAt,
        langs: Array.isArray(tdoc.langs) ? tdoc.langs.map(String) : [],
    };
}

export function virtualAttemptWindow(startAt: Date, durationMs: number): { startAt: Date; endAt: Date } {
    if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) throw new TypeError('Virtual attempt startAt must be a valid Date.');
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new TypeError('Virtual attempt duration must be a positive integer.');
    const alignedStart = new Date(Math.floor(startAt.getTime() / 1000) * 1000);
    return { startAt: alignedStart, endAt: new Date(alignedStart.getTime() + durationMs) };
}

export function isVirtualAttemptOpen(
    attempt: { status: VirtualContestAttemptStatus; startAt: Date; endAt: Date },
    now = new Date(),
): boolean {
    if (attempt.status !== 'active') return false;
    return attempt.startAt.getTime() <= now.getTime() && now.getTime() < attempt.endAt.getTime();
}

export function isVirtualContestScoreFrozen(
    attempt: { status: VirtualContestAttemptStatus; startAt: Date; endAt: Date; snapshot: Pick<VirtualContestSnapshot, 'lockOffsetMs'> },
    now = new Date(),
): boolean {
    if (attempt.status !== 'active') return false;
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Virtual contest time must be a valid Date.');
    if (now.getTime() >= attempt.endAt.getTime()) return false;
    if (attempt.snapshot.lockOffsetMs == null) return false;
    return now.getTime() >= attempt.startAt.getTime() + attempt.snapshot.lockOffsetMs;
}

export function syntheticVirtualContestDoc(input: {
    domainId: string;
    sourceContestId: ObjectId;
    snapshot: VirtualContestSnapshot;
    startAt: Date;
    endAt: Date;
    unlocked?: boolean;
}): Tdoc {
    return {
        domainId: input.domainId,
        docId: input.sourceContestId,
        docType: 30,
        rule: input.snapshot.rule,
        pids: input.snapshot.pids,
        score: input.snapshot.score,
        title: input.snapshot.title,
        langs: input.snapshot.langs,
        beginAt: input.startAt,
        endAt: input.endAt,
        lockAt: input.snapshot.lockOffsetMs != null ? new Date(input.startAt.getTime() + input.snapshot.lockOffsetMs) : undefined,
        unlocked: input.unlocked === true,
        attend: 0,
        content: '',
        duration: 0,
    } as Tdoc;
}

export function officialAttemptBlocksNewStart(status: VirtualContestAttemptStatus | undefined): boolean {
    return status === 'active' || status === 'ended';
}

export function virtualContestSnapshotFingerprint(
    snapshot: Pick<VirtualContestSnapshot, 'rule' | 'pids' | 'score' | 'durationMs' | 'lockOffsetMs'>,
): string {
    const score: Record<string, number> = {};
    for (const pid of Object.keys(snapshot.score || {})
        .map(Number)
        .filter((value) => Number.isSafeInteger(value))
        .sort((left, right) => left - right)) {
        score[String(pid)] = snapshot.score[pid];
    }
    return JSON.stringify({
        rule: snapshot.rule,
        pids: snapshot.pids,
        score,
        durationMs: snapshot.durationMs,
        lockOffsetMs: snapshot.lockOffsetMs ?? null,
    });
}

export function ridCreatedDuringVirtualAttempt(
    rid: ObjectId,
    attempt: { startAt: Date; endAt: Date },
): boolean {
    const createdAt = rid.getTimestamp().getTime();
    const startFloor = Math.floor(attempt.startAt.getTime() / 1000) * 1000;
    return createdAt >= startFloor && createdAt < attempt.endAt.getTime();
}

export function compareVirtualAttemptRank(
    sort: Record<string, number>,
    left: Record<string, unknown>,
    right: Record<string, unknown>,
): number {
    for (const [key, direction] of Object.entries(sort || {})) {
        const leftValue = typeof left[key] === 'number' && Number.isFinite(left[key]) ? (left[key] as number) : 0;
        const rightValue = typeof right[key] === 'number' && Number.isFinite(right[key]) ? (right[key] as number) : 0;
        if (leftValue === rightValue) continue;
        return direction < 0 ? rightValue - leftValue : leftValue - rightValue;
    }
    return 0;
}

export function rankVirtualAttempts<T>(
    attempts: T[],
    sort: Record<string, number>,
    statsOf: (attempt: T) => Record<string, unknown>,
): Array<[number, T]> {
    const sorted = [...attempts].sort((left, right) => compareVirtualAttemptRank(sort, statsOf(left), statsOf(right)));
    const ranked: Array<[number, T]> = [];
    let lastRank = 0;
    for (let index = 0; index < sorted.length; index++) {
        if (index === 0 || compareVirtualAttemptRank(sort, statsOf(sorted[index - 1]), statsOf(sorted[index])) !== 0) {
            lastRank = index + 1;
        }
        ranked.push([lastRank, sorted[index]]);
    }
    return ranked;
}

export function canViewVirtualContestRecord(input: {
    attempt: { uid: number; status: VirtualContestAttemptStatus };
    viewerUid: number;
    canManage: boolean;
    viewerHasEnded: boolean;
}): boolean {
    if (input.canManage) return true;
    if (input.attempt.uid === input.viewerUid) return true;
    return input.attempt.status === 'ended' && input.viewerHasEnded;
}
