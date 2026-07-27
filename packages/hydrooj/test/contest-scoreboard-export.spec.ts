import { expect } from 'chai';
import { describe, it } from 'node:test';
import { getScoreboardExportCapabilities, getScoreboardSnapshotMode } from '../src/lib/contest-scoreboard-export';

describe('contest scoreboard image export', () => {
    it('allows owners, maintainers represented by own(), contest editors, and system admins', () => {
        const base = { hasPrivateIdentityData: false, teamMode: false };
        expect(getScoreboardExportCapabilities({ ...base, ownsContest: true, canEditContest: false, isSystemAdmin: false }).canExportImage).to.equal(
            true,
        );
        expect(getScoreboardExportCapabilities({ ...base, ownsContest: false, canEditContest: true, isSystemAdmin: false }).canExportImage).to.equal(
            true,
        );
        expect(getScoreboardExportCapabilities({ ...base, ownsContest: false, canEditContest: false, isSystemAdmin: true }).canExportImage).to.equal(
            true,
        );
        expect(getScoreboardExportCapabilities({ ...base, ownsContest: false, canEditContest: false, isSystemAdmin: false }).canExportImage).to.equal(
            false,
        );
    });

    it('offers private identity only to system admins on individual scoreboards with identity data', () => {
        const base = { ownsContest: false, canEditContest: false, isSystemAdmin: true };
        expect(getScoreboardExportCapabilities({ ...base, hasPrivateIdentityData: true, teamMode: false }).canIncludePrivateIdentity).to.equal(true);
        expect(getScoreboardExportCapabilities({ ...base, hasPrivateIdentityData: false, teamMode: false }).canIncludePrivateIdentity).to.equal(
            false,
        );
        expect(getScoreboardExportCapabilities({ ...base, hasPrivateIdentityData: true, teamMode: true }).canIncludePrivateIdentity).to.equal(false);
        expect(
            getScoreboardExportCapabilities({
                ownsContest: true,
                canEditContest: false,
                isSystemAdmin: false,
                hasPrivateIdentityData: true,
                teamMode: false,
            }).canIncludePrivateIdentity,
        ).to.equal(false);
    });

    it('marks only a non-realtime, currently locked response as a frozen snapshot', () => {
        expect(getScoreboardSnapshotMode(false, true)).to.equal('frozen');
        expect(getScoreboardSnapshotMode(false, false)).to.equal('realtime');
        expect(getScoreboardSnapshotMode(true, true)).to.equal('realtime');
    });
});
