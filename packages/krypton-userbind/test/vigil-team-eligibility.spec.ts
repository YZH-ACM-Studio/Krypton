import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { resolveVigilTeamEligibility } from '../src/vigil-team-eligibility';

const contestId = new ObjectId('64a000000000000000000201');
const teamId = new ObjectId('64a000000000000000000202');

describe('P1.19 Vigil team candidate eligibility', () => {
    it('keeps individual contests independent of team membership', async () => {
        let lookups = 0;
        const result = await resolveVigilTeamEligibility('system', { docId: contestId }, 10, async () => {
            lookups += 1;
            return null;
        });

        expect(result).to.deep.equal({ eligible: true });
        expect(lookups).to.equal(0);
    });

    it('includes captains and members returned by the finalized active roster', async () => {
        for (const uid of [10, 11]) {
            const seen: unknown[] = [];
            const result = await resolveVigilTeamEligibility('system', { docId: contestId, participationMode: 'team' }, uid, async (...args) => {
                seen.push(args);
                return { teamId };
            });

            expect(result).to.deep.equal({ eligible: true, contestId, teamId: teamId.toHexString() });
            expect(seen).to.deep.equal([['system', contestId, uid]]);
        }
    });

    it('excludes outsiders and inactive-team members absent from the active roster', async () => {
        for (const uid of [12, 13]) {
            const result = await resolveVigilTeamEligibility('system', { _id: contestId, participationMode: 'team' }, uid, async () => null);

            expect(result).to.deep.equal({ eligible: false, contestId, reason: 'active_team_required' });
        }
    });

    it('fails fast when a team contest candidate has no contest id', async () => {
        let thrown: unknown;
        try {
            await resolveVigilTeamEligibility('system', { participationMode: 'team' }, 10, async () => ({ teamId }));
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.be.instanceOf(Error);
        expect((thrown as Error).message).to.equal('Team contest candidate is missing its contest id');
    });
});
