import type { Tdoc } from '../interface';
import type { ContestTeamDoc } from './contest-team';
import { getParticipationMode } from './contest-participation';

export const VIGIL_TEAM_PROTOCOL_VERSION = 2;

export interface VigilTeamCapabilities {
    canBrowseProblems: boolean;
    canViewTeamRecords: boolean;
    canEditCode: boolean;
    canRun: boolean;
    canSubmit: boolean;
    canUseVirtualPrint: boolean;
    canMinimize: boolean;
}

export interface VigilContestRoleResolution {
    protocolVersion: number;
    minClientProtocolVersion: number;
    participationMode: 'individual' | 'team';
    eligible: boolean;
    reason?: string;
    teamId?: string;
    role: 'individual' | 'captain' | 'member' | 'none';
    teamRevision?: number;
    capabilities?: VigilTeamCapabilities;
}

const deniedTeamCapabilities: VigilTeamCapabilities = {
    canBrowseProblems: false,
    canViewTeamRecords: false,
    canEditCode: false,
    canRun: false,
    canSubmit: false,
    canUseVirtualPrint: false,
    canMinimize: false,
};

export function buildVigilContestRoleResolution(
    tdoc: Tdoc,
    team: ContestTeamDoc | null,
    uid: number,
    reason?: string,
): VigilContestRoleResolution {
    if (getParticipationMode(tdoc) !== 'team') {
        return {
            protocolVersion: 1,
            minClientProtocolVersion: 0,
            participationMode: 'individual',
            eligible: true,
            role: 'individual',
        };
    }
    if (!team || !team.active || !team.memberUids.includes(uid)) {
        return {
            protocolVersion: VIGIL_TEAM_PROTOCOL_VERSION,
            minClientProtocolVersion: VIGIL_TEAM_PROTOCOL_VERSION,
            participationMode: 'team',
            eligible: false,
            reason: reason || 'active_team_required',
            role: 'none',
            capabilities: { ...deniedTeamCapabilities },
        };
    }
    const captain = team.captainUid === uid;
    return {
        protocolVersion: VIGIL_TEAM_PROTOCOL_VERSION,
        minClientProtocolVersion: VIGIL_TEAM_PROTOCOL_VERSION,
        participationMode: 'team',
        eligible: true,
        teamId: team.teamId.toHexString(),
        role: captain ? 'captain' : 'member',
        teamRevision: team.revision,
        capabilities: {
            canBrowseProblems: true,
            canViewTeamRecords: true,
            canEditCode: captain,
            canRun: captain,
            canSubmit: captain,
            canUseVirtualPrint: captain,
            canMinimize: captain,
        },
    };
}
