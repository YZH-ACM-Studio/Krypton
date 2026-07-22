import type { ObjectId } from 'mongodb';

interface VigilCandidateContest {
    _id?: ObjectId;
    docId?: ObjectId;
    participationMode?: 'individual' | 'team';
}

interface ActiveContestTeam {
    teamId: ObjectId;
}

export interface VigilTeamEligibility {
    eligible: boolean;
    contestId?: ObjectId;
    teamId?: string;
    reason?: 'active_team_required';
}

export type FindActiveContestTeam = (domainId: string, contestId: ObjectId, uid: number) => Promise<ActiveContestTeam | null>;

/** Team contests are selectable in Vigil only for members of the finalized active roster. */
export async function resolveVigilTeamEligibility(
    domainId: string,
    tdoc: VigilCandidateContest,
    uid: number,
    findActiveTeam: FindActiveContestTeam,
): Promise<VigilTeamEligibility> {
    if (tdoc.participationMode !== 'team') return { eligible: true };
    const contestId = tdoc.docId || tdoc._id;
    if (!contestId) throw new Error('Team contest candidate is missing its contest id');
    const team = await findActiveTeam(domainId, contestId, uid);
    if (!team) return { eligible: false, contestId, reason: 'active_team_required' };
    return { eligible: true, contestId, teamId: team.teamId.toHexString() };
}
