import { STATUS } from '@hydrooj/common';

export interface ProblemCounts { nAccept: number; nSubmit: number }

// One entry per participant and problem, across all their visible rounds.
export type ParticipantProblemCounts = Map<number, ProblemCounts | 'hidden' | 'incomplete'>;

export function includeRoundProblem(counts: ParticipantProblemCounts, pid: number, visible: boolean, incomplete: boolean) {
    const current = counts.get(pid);
    if (!visible) {
        if (current === undefined) counts.set(pid, 'hidden');
    } else if (incomplete) {
        counts.set(pid, 'incomplete');
    } else if (!current || current === 'hidden') {
        counts.set(pid, { nAccept: 0, nSubmit: 0 });
    }
}

export function countSetSubmission(counts: ParticipantProblemCounts, pid: number, status: number) {
    if (!Number.isSafeInteger(status)) throw new TypeError(`set_scoreboard_submission_status_invalid:${pid}`);
    const count = counts.get(pid);
    if (!count || typeof count !== 'object' || status === STATUS.STATUS_CANCELED || status === STATUS.STATUS_IGNORED) return;
    count.nSubmit++;
    if (status === STATUS.STATUS_ACCEPTED) count.nAccept = 1;
}

export function setBoardProblemCounts(
    pids: readonly number[], problems: Record<number, Partial<ProblemCounts>>, participants: readonly ParticipantProblemCounts[],
) {
    for (const pid of pids) {
        const total = { nAccept: 0, nSubmit: 0 };
        let visible = false;
        let hidden = false;
        let incomplete = false;
        for (const participant of participants) {
            const count = participant.get(pid);
            if (count === 'incomplete') {
                incomplete = true;
                break;
            }
            if (count === 'hidden') hidden = true;
            if (count && typeof count === 'object') {
                visible = true;
                total.nAccept += count.nAccept;
                total.nSubmit += count.nSubmit;
            }
        }
        if (incomplete || (hidden && !visible)) {
            delete problems[pid].nAccept;
            delete problems[pid].nSubmit;
        } else {
            Object.assign(problems[pid], total);
        }
    }
}
