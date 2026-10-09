import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import {
    assertAddedRosterUids,
    assertUnrankRosterCanEnable,
    canonicalizeRosterUids,
    publicUnrankRoster,
    readUnrankRoster,
    resolveAttendUnrank,
    rosterUidChanges,
    unrankUpdatesForRoster,
} from '../src/lib/contest-unrank-roster';

describe('contest unrank roster', () => {
    it('keeps a missing switch off and rejects a list without the switch', () => {
        expect(readUnrankRoster({}).kind).to.equal('off');
        expect(readUnrankRoster({ unrankRosterEnabled: false }).kind).to.equal('off');
        expect(() => readUnrankRoster({ unrankRosterUids: [] })).to.throw(ValidationError);
    });

    it('reads an opened but unsaved switch separately from a saved list', () => {
        expect(readUnrankRoster({ unrankRosterEnabled: true }).kind).to.equal('unlocked');
        expect(readUnrankRoster({ unrankRosterEnabled: true, unrankRosterUids: [] })).to.deep.equal({ kind: 'locked', uids: [] });
        expect(readUnrankRoster({ unrankRosterEnabled: true, unrankRosterUids: [2, 9] }).kind).to.equal('locked');
        expect(() => readUnrankRoster({ unrankRosterEnabled: true, unrankRosterUids: [9, 2] })).to.throw(ValidationError);
    });

    it('only allows the switch on an individual ACM or IOI contest', () => {
        expect(() => assertUnrankRosterCanEnable('acm', 'individual')).to.not.throw();
        expect(() => assertUnrankRosterCanEnable('IOI', undefined)).to.not.throw();
        expect(() => assertUnrankRosterCanEnable('oi', 'individual')).to.throw(ValidationError);
        expect(() => assertUnrankRosterCanEnable('acm', 'team')).to.throw(ValidationError);
    });

    it('sorts and dedupes a submitted list, and only checks newly added accounts', () => {
        expect(canonicalizeRosterUids([4, 2, 4, 9])).to.deep.equal([2, 4, 9]);
        expect(rosterUidChanges([2, 4], [4, 9])).to.deep.equal({ added: [9], removed: [2] });
        expect(() => assertAddedRosterUids([9], new Set([9]), true)).to.not.throw();
        expect(() => assertAddedRosterUids([8], new Set([9]), true)).to.throw(ValidationError);
        expect(() => assertAddedRosterUids([9], new Set([9]), false)).to.throw(ValidationError);
        expect(() => assertAddedRosterUids([], new Set(), false)).to.not.throw();
    });

    it('ignores a self-star request after the list is saved', () => {
        const locked = readUnrankRoster({ unrankRosterEnabled: true, unrankRosterUids: [7] });
        expect(resolveAttendUnrank(locked, 7, false)).to.equal(true);
        expect(resolveAttendUnrank(locked, 8, true)).to.equal(false);
        expect(resolveAttendUnrank({ kind: 'unlocked' }, 8, true)).to.equal(true);
        expect(resolveAttendUnrank({ kind: 'off' }, 8, false)).to.equal(undefined);
    });

    it('rewrites existing attendance to match the saved list', () => {
        expect(unrankUpdatesForRoster([
            { uid: 7, unrank: false },
            { uid: 8, unrank: true },
            { uid: 9, unrank: true },
        ], new Set([7, 9]))).to.deep.equal([
            { uid: 7, unrank: true },
            { uid: 8, unrank: false },
        ]);
    });

    it('tells the current user whether the saved list includes them without exposing the list', () => {
        expect(publicUnrankRoster({ unrankRosterEnabled: true, unrankRosterUids: [7] }, 7)).to.deep.equal({
            enabled: true,
            saved: true,
            viewerIncluded: true,
        });
        expect(publicUnrankRoster({ unrankRosterEnabled: true }, 7).saved).to.equal(false);
    });
});
