export interface ScoreboardExportCapabilityInput {
    ownsContest: boolean;
    canEditContest: boolean;
    isSystemAdmin: boolean;
    hasPrivateIdentityData: boolean;
    teamMode: boolean;
}

export interface ScoreboardExportCapabilities {
    canExportImage: boolean;
    canIncludePrivateIdentity: boolean;
}

export function getScoreboardExportCapabilities(input: ScoreboardExportCapabilityInput): ScoreboardExportCapabilities {
    return {
        canExportImage: input.ownsContest || input.canEditContest || input.isSystemAdmin,
        canIncludePrivateIdentity: input.isSystemAdmin && input.hasPrivateIdentityData && !input.teamMode,
    };
}

export function getScoreboardSnapshotMode(realtime: boolean, locked: boolean): 'frozen' | 'realtime' {
    return !realtime && locked ? 'frozen' : 'realtime';
}
