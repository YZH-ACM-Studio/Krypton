import { ObjectId } from 'mongodb';
import { ContestTeamConflictError, ValidationError } from '../error';
import type { Tdoc } from '../interface';

export type ContestParticipationMode = 'individual' | 'team';

export function getParticipationMode(tdoc: Pick<Tdoc, 'participationMode'>): ContestParticipationMode {
    return tdoc.participationMode === 'team' ? 'team' : 'individual';
}

export function isTeamBatchFinalizationPending(tdoc: Pick<Tdoc, 'participationMode' | 'plannedTeamBatchId' | 'teamBatchId'>): boolean {
    return getParticipationMode(tdoc) === 'team' && !!tdoc.plannedTeamBatchId && !tdoc.teamBatchId;
}

export function teamModeClearConfirmation(tid: ObjectId, participationRevision: number): string {
    return `TEAM-MODE-CLEAR:${tid.toHexString()}:${participationRevision}`;
}

export interface ContestParticipationTransitionInput {
    tid: ObjectId;
    current: Pick<Tdoc, 'participationMode' | 'participationRevision' | 'beginAt'>;
    next: Pick<Tdoc, 'participationMode' | 'beginAt'>;
    now: Date;
    recordCount: number;
    activeTeamCount: number;
    expectedRevision?: number;
    clearConfirmation?: string;
}

export interface ContestParticipationTransitionPlan {
    changed: boolean;
    currentRevision: number;
    nextRevision: number;
    clearActiveTeams: boolean;
}

/** Decide a participation-mode transition after callers have read the two required counts. */
export function planParticipationModeTransition(input: ContestParticipationTransitionInput): ContestParticipationTransitionPlan {
    const previousMode = getParticipationMode(input.current);
    const nextMode = getParticipationMode(input.next);
    const currentRevision = input.current.participationRevision ?? 0;
    if (previousMode === nextMode) {
        return { changed: false, currentRevision, nextRevision: currentRevision, clearActiveTeams: false };
    }
    if (input.expectedRevision !== currentRevision) throw new ContestTeamConflictError('participation_revision_mismatch');
    if (input.now >= input.current.beginAt || input.now >= input.next.beginAt) throw new ContestTeamConflictError('contest_started');
    if (input.recordCount > 0) throw new ContestTeamConflictError('contest_has_records');
    if (previousMode === 'individual' && nextMode === 'team' && input.activeTeamCount > 0) {
        throw new ContestTeamConflictError('active_team_cleanup_incomplete');
    }
    const clearActiveTeams = previousMode === 'team' && nextMode === 'individual';
    if (clearActiveTeams && input.activeTeamCount > 0 && input.clearConfirmation !== teamModeClearConfirmation(input.tid, currentRevision)) {
        throw new ContestTeamConflictError('team_cleanup_confirmation_required');
    }
    return { changed: true, currentRevision, nextRevision: currentRevision + 1, clearActiveTeams };
}

/** Apply the immutable cross-field contract without touching legacy individual contests. */
export function normalizeParticipationConfig<T extends Partial<Tdoc> & Pick<Tdoc, 'rule'>>(tdoc: T): T {
    if (tdoc.participationMode !== undefined && !['individual', 'team'].includes(tdoc.participationMode)) {
        throw new ValidationError('participationMode');
    }
    if (getParticipationMode(tdoc) !== 'team') return tdoc;
    if (tdoc.rule !== 'acm') throw new ValidationError('participationMode', 'rule', 'Team participation is only supported by ACM contests.');
    tdoc.vigilEnabled = true;
    tdoc.entryMode = 'client_required';
    tdoc.rated = false;
    return tdoc;
}
