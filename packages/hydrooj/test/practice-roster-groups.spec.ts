import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { projectPracticeRosterGroups } from '../src/lib/practice-roster';

const groupA = new ObjectId('66c300000000000000000001');
const groupB = new ObjectId('66c300000000000000000002');
const groupC = new ObjectId('66c300000000000000000003');
const groupUnknown = new ObjectId('66c300000000000000000099');
const schoolA = new ObjectId('66c3000000000000000000a1');
const schoolB = new ObjectId('66c3000000000000000000a2');
const groupAId = String(groupA);
const groupBId = String(groupB);
const groupCId = String(groupC);
const groupUnknownId = String(groupUnknown);
const schoolAId = String(schoolA);
const schoolBId = String(schoolB);
const archivedAt = new Date('2026-01-01T00:00:00.000Z');

const groupNameById = new Map([
    [groupAId, '计科'],
    [groupBId, '软工'],
    [groupCId, '网安'],
]);

describe('projectPracticeRosterGroups', () => {
    it('intersects student groups with the audience allowlist', () => {
        expect(projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId, groupCId],
            groupNameById,
            audienceGroupIds: [groupBId, groupUnknownId],
        })).to.deep.equal({
            groupIds: [groupBId],
            groups: ['软工'],
        });
    });

    it('drops group ids with unknown or empty names', () => {
        expect(projectPracticeRosterGroups({
            groupIds: [groupAId, groupUnknownId, groupCId, groupBId],
            groupNameById: new Map([
                [groupAId, '计科'],
                [groupCId, ''],
                [groupBId, '软工'],
            ]),
        })).to.deep.equal({
            groupIds: [groupAId, groupBId],
            groups: ['计科', '软工'],
        });
    });

    it('drops archived groups when no audience is set', () => {
        expect(projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId],
            groupNameById,
            groupCatalogById: new Map([
                [groupAId, { id: groupAId, name: '计科', archivedAt }],
                [groupBId, { id: groupBId, name: '软工', archivedAt: null }],
            ]),
        })).to.deep.equal({
            groupIds: [groupBId],
            groups: ['软工'],
        });
    });

    it('keeps archived groups that are in the audience', () => {
        expect(projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId],
            groupNameById,
            audienceGroupIds: [groupAId, groupBId],
            groupCatalogById: new Map([
                [groupAId, { id: groupAId, name: '计科', archivedAt }],
                [groupBId, { id: groupBId, name: '软工', archivedAt: null }],
            ]),
        })).to.deep.equal({
            groupIds: [groupAId, groupBId],
            groups: ['计科', '软工'],
        });
    });

    it('drops school-mismatched groups when no audience is set', () => {
        expect(projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId],
            groupNameById,
            studentSchoolId: schoolAId,
            groupCatalogById: new Map([
                [groupAId, { id: groupAId, name: '计科', schoolId: schoolAId }],
                [groupBId, { id: groupBId, name: '软工', schoolId: schoolBId }],
            ]),
        })).to.deep.equal({
            groupIds: [groupAId],
            groups: ['计科'],
        });
    });
});
