import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { ValidationError } from '../src/error';
import {
    boundUserIdsForStats,
    courseStatsQueryGroupIds,
    normalizeRequestedGroupIds,
    parseStatsGroupIds,
    statsGroupOption,
} from '../src/lib/stats-group-scope';

describe('stats group scope', () => {
    const groupA = new ObjectId();
    const groupB = new ObjectId();
    const allowed = new Set([groupA.toHexString(), groupB.toHexString()]);

    it('treats blank and duplicate tokens as no extra selection', () => {
        expect(normalizeRequestedGroupIds(undefined)).to.deep.equal([]);
        expect(normalizeRequestedGroupIds(['', '  ', groupA.toHexString(), groupA.toHexString().toUpperCase()])).to.deep.equal([
            groupA.toHexString(),
        ]);
        expect(parseStatsGroupIds(['', '   '], allowed)).to.equal(null);
    });

    it('accepts an allowed subset and rejects unknown or malformed ids', () => {
        const selected = parseStatsGroupIds([groupB.toHexString().toUpperCase(), groupB.toHexString()], allowed);
        expect(selected?.map((id) => id.toHexString())).to.deep.equal([groupB.toHexString()]);
        expect(() => parseStatsGroupIds(['timtomtamted'], allowed)).to.throw(ValidationError);
        expect(() => parseStatsGroupIds([new ObjectId().toHexString()], allowed)).to.throw(ValidationError);
        expect(() => parseStatsGroupIds(['not-a-group'], allowed)).to.throw(ValidationError);
    });

    it('keeps each bound account once and drops unbound rows', () => {
        expect(
            boundUserIdsForStats([
                { boundUserId: 4 },
                { boundUserId: 4 },
                { boundUserId: 1 },
                { boundUserId: null },
                { boundUserId: 2.5 },
                { boundUserId: 8 },
            ]),
        ).to.deep.equal([4, 8]);
    });

    it('serializes a group option without inventing a name', () => {
        const archivedAt = new Date('2026-09-01T00:00:00.000Z');
        expect(statsGroupOption({ _id: groupA, name: ' 一班 ', archivedAt })).to.deep.equal({
            _id: groupA.toHexString(),
            name: '一班',
            archivedAt: archivedAt.toISOString(),
        });
        expect(statsGroupOption({ _id: groupB, name: '   ' })).to.deep.equal({
            _id: groupB.toHexString(),
            name: groupB.toHexString(),
            archivedAt: null,
        });
    });

    it('queries every course group until a subset is selected', () => {
        const courseIds = [groupA, groupB];
        expect(courseStatsQueryGroupIds(courseIds, null).map((id) => id.toHexString())).to.deep.equal([
            groupA.toHexString(),
            groupB.toHexString(),
        ]);
        expect(courseStatsQueryGroupIds(courseIds, [groupA]).map((id) => id.toHexString())).to.deep.equal([groupA.toHexString()]);
    });
});
