import type { Tdoc } from '../interface';
import { effectiveLockoutWindow } from './contest-lockout';

const POST_CONTEST_PRACTICE_RULES = new Set(['acm', 'oi', 'ioi', 'ledo', 'strictioi']);

export interface PostContestPracticeState {
    supported: boolean;
    open: boolean;
    eligible: boolean;
    availableAt: Date | null;
}

export type PostContestProblemMode = 'view' | 'contest' | 'correction' | 'none';

export function isPostContestPracticeRule(rule: unknown): boolean {
    return typeof rule === 'string' && POST_CONTEST_PRACTICE_RULES.has(rule);
}

export function getPostContestPracticeAvailableAt(tdoc: Tdoc): Date | null {
    if (!isPostContestPracticeRule(tdoc.rule)) return null;
    if (!(tdoc.beginAt instanceof Date) || Number.isNaN(tdoc.beginAt.getTime())) {
        throw new TypeError('Contest beginAt must be a valid Date.');
    }
    if (!(tdoc.endAt instanceof Date) || Number.isNaN(tdoc.endAt.getTime())) {
        throw new TypeError('Contest endAt must be a valid Date.');
    }
    if (tdoc.beginAt >= tdoc.endAt) throw new TypeError('Contest beginAt must be before endAt.');
    if (tdoc.entryMode === undefined || tdoc.entryMode === 'open') return new Date(tdoc.endAt);
    if (tdoc.entryMode !== 'client_required') {
        throw new TypeError('Contest entryMode must be open or client_required.');
    }
    const lockoutWindow = effectiveLockoutWindow(tdoc);
    if (!lockoutWindow) throw new TypeError('Client-required contest must have an effective lockout window.');
    return new Date(lockoutWindow.blockEnd);
}

export function getPostContestPracticeState(tdoc: Tdoc, tsdoc: { attend?: number } | null | undefined, now = new Date()): PostContestPracticeState {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Post-contest practice time must be a valid Date.');
    const availableAt = getPostContestPracticeAvailableAt(tdoc);
    const supported = availableAt !== null;
    const open = supported && now >= availableAt;
    return {
        supported,
        open,
        eligible: open && tsdoc?.attend === 1,
        availableAt,
    };
}

export function canUsePostContestPractice(tdoc: Tdoc, tsdoc: { attend?: number } | null | undefined, now = new Date()): boolean {
    return getPostContestPracticeState(tdoc, tsdoc, now).eligible;
}

export function canAccessPostContestPracticeRecord(
    tdoc: Tdoc,
    tsdoc: { attend?: number } | null | undefined,
    context: { pid: number; actorUid: number; recordUid: number },
    now = new Date(),
): boolean {
    if (!Array.isArray(tdoc.pids) || tdoc.pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
        throw new TypeError('Contest problem ids must be positive integers.');
    }
    if (!Number.isSafeInteger(context.pid) || context.pid <= 0) {
        throw new TypeError('Practice record pid must be a positive integer.');
    }
    if (!Number.isSafeInteger(context.actorUid) || context.actorUid <= 0 || !Number.isSafeInteger(context.recordUid) || context.recordUid <= 0) {
        throw new TypeError('Practice record user ids must be positive integers.');
    }
    return context.actorUid === context.recordUid && tdoc.pids.includes(context.pid) && canUsePostContestPractice(tdoc, tsdoc, now);
}

export function getContestSubmissionScope<T>(
    tdoc: Tdoc,
    tsdoc: { attend?: number } | null | undefined,
    contestId: T,
    now = new Date(),
): { postContestPractice: boolean; recordContestId: T | undefined } {
    const postContestPractice = canUsePostContestPractice(tdoc, tsdoc, now);
    return {
        postContestPractice,
        recordContestId: postContestPractice ? undefined : contestId,
    };
}

export function resolvePostContestProblemMode(
    tdoc: Tdoc,
    tsdoc: { attend?: number; startAt?: Date; endAt?: Date } | null | undefined,
    access: {
        canManageContest: boolean;
        canViewDirectly: boolean;
        subjective: boolean;
    },
    now = new Date(),
): PostContestProblemMode | null {
    const practice = getPostContestPracticeState(tdoc, tsdoc, now);
    if (!practice.supported) return null;

    const participantEndAt = tsdoc?.endAt instanceof Date && tsdoc.endAt < tdoc.endAt ? tsdoc.endAt : tdoc.endAt;
    const ongoing = tdoc.beginAt <= now && now < participantEndAt;
    if (tsdoc?.attend === 1 && ongoing) return 'contest';
    if (practice.eligible && !access.subjective) return 'correction';
    if (access.canManageContest || access.canViewDirectly) return 'view';
    return 'none';
}
