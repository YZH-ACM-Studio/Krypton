import type { Tdoc } from '../interface';
import { ValidationError } from '../error';
import { getParticipationMode, isTeamBatchFinalizationPending } from '../model/contest-participation';
import { withContestTeamBoundary } from '../model/contest-team-gate';
import { storedSetConfigOrNull } from './set-publication';
import { projectStudentContestTdoc } from './exam-paper';
import { setPermissionsFor } from './set-permissions';

/** The active/latest formal round owns its paper, including after hand-in and retries. */
export async function currentSetProblemPids(tdoc: Tdoc, uid: number, manager: boolean): Promise<number[] | null> {
    const config = storedSetConfigOrNull(tdoc);
    if (!config) return null;
    if (manager) return [...tdoc.pids];
    if (config.publication !== 'published') return [];
    const permissions = await setPermissionsFor(tdoc, uid);
    if (permissions && (permissions.problems === 'hidden' || (Date.now() >= tdoc.endAt.getTime() && !permissions.afterEnd))) return [];
    return withContestTeamBoundary(tdoc.domainId, tdoc.docId, async () => {
        let teamId;
        if (getParticipationMode(tdoc) === 'team') {
            if (isTeamBatchFinalizationPending(tdoc)) return [];
            const { getTeamByMember } = require('../model/contest-team') as typeof import('../model/contest-team');
            const team = await getTeamByMember(tdoc.domainId, tdoc.docId, uid);
            if (!team) return [];
            teamId = team.teamId;
        }
        const { readParticipantPaper } = require('../model/set-round') as typeof import('../model/set-round');
        const paper = await readParticipantPaper(tdoc.domainId, tdoc.docId, uid, teamId);
        if (!paper) return [];
        if (paper.some((pid) => !tdoc.pids.includes(pid))) throw new ValidationError('pids');
        return paper;
    });
}

export async function projectCurrentSetTdoc(tdoc: Tdoc, uid: number, manager: boolean,
    legacyStatus?: Parameters<typeof projectStudentContestTdoc>[1]): Promise<Tdoc> {
    const pids = await currentSetProblemPids(tdoc, uid, manager);
    if (pids === null || manager) return projectStudentContestTdoc(tdoc, legacyStatus, manager);
    const visible = new Set(pids);
    const copy = { ...tdoc, pids };
    const { authorization: _authorization, ...settings } = storedSetConfigOrNull(tdoc)!.settings;
    copy.setConfig = { ...storedSetConfigOrNull(tdoc)!, settings: {
        ...settings, ...(settings.experience ? { experience: { ...settings.experience, announcement: '' } } : {}),
    } };
    if (tdoc.setPoints) copy.setPoints = Object.fromEntries(Object.entries(tdoc.setPoints).filter(([pid]) => visible.has(Number(pid))));
    if (tdoc.score) copy.score = Object.fromEntries(Object.entries(tdoc.score).filter(([pid]) => visible.has(Number(pid))));
    if (tdoc.balloon) copy.balloon = Object.fromEntries(Object.entries(tdoc.balloon).filter(([pid]) => visible.has(Number(pid))));
    for (const field of ['autoHideProblemPids', 'autoHidePendingPids'] as const) {
        if (Array.isArray(tdoc[field])) copy[field] = tdoc[field].filter((pid) => visible.has(pid));
    }
    return copy;
}
