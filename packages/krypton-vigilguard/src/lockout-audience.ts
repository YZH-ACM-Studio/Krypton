export interface BrowserLockoutAudience {
    participationMode: 'individual' | 'team';
    hasFinalizedTeamRoster: boolean;
    isActiveTeamMember: boolean;
    hasExplicitParticipantScope: boolean;
    participantScopeMatches: boolean;
    hasLegacyAssign: boolean;
    legacyAssignMatches: boolean;
    hasInviteCode: boolean;
    attended: boolean;
}

/**
 * Decide whether one contest targets a user for ordinary-browser lockout.
 *
 * The caller remains responsible for the lockout window and operator bypass.
 */
export function isBrowserLockoutAudience(input: BrowserLockoutAudience): boolean {
    if (input.participationMode === 'team') {
        return input.hasFinalizedTeamRoster && input.isActiveTeamMember;
    }
    if (input.hasExplicitParticipantScope && !input.participantScopeMatches) return false;
    if (input.hasLegacyAssign && !input.legacyAssignMatches) return false;
    if (input.hasInviteCode) return input.attended;
    if (input.hasExplicitParticipantScope || input.hasLegacyAssign) return true;
    return input.attended;
}
