import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    assemblePracticeRosterMembers,
    projectPracticeRosterGroups,
    serializePracticeRosterProblems,
    uniqueBoundUserIds,
    type PracticeRosterGroupCatalogEntry,
} from '../src/lib/practice-roster';

const groupA = new ObjectId('66c100000000000000000001');
const groupB = new ObjectId('66c100000000000000000002');
const groupUnknown = new ObjectId('66c100000000000000000099');
const schoolA = new ObjectId('66c200000000000000000001');
const schoolB = new ObjectId('66c200000000000000000002');
const groupAId = String(groupA);
const groupBId = String(groupB);
const groupUnknownId = String(groupUnknown);
const schoolAId = String(schoolA);
const schoolBId = String(schoolB);

const namedGroups = new Map([
    [groupAId, '计科'],
    [groupBId, '软工'],
]);

function catalogEntry(
    id: string,
    extras: Omit<PracticeRosterGroupCatalogEntry, 'id' | 'name'> & { name?: string } = {},
): PracticeRosterGroupCatalogEntry {
    const { name, ...rest } = extras;
    return { id, name: name ?? namedGroups.get(id) ?? '', ...rest };
}

describe('practice roster assembly', () => {
    it('joins bound students, group names and completed pids without inventing extra members', () => {
        const members = assemblePracticeRosterMembers({
            memberUids: [8, 9],
            udict: { 8: { uname: 'alice' }, 9: { uname: 'bob' } },
            students: {
                8: { realName: '爱丽丝', studentId: '20260001', groupIds: [groupA, groupB] },
                9: { realName: '鲍勃', studentId: '20260002', groupIds: [] },
            },
            groupNameById: namedGroups,
            completedPidsByUid: new Map([
                [8, new Set([1, 2])],
                [9, new Set()],
            ]),
            total: 3,
        });
        expect(members).to.deep.equal([
            {
                uid: 8,
                uname: 'alice',
                realName: '爱丽丝',
                studentId: '20260001',
                groupIds: [groupAId, groupBId],
                groups: ['计科', '软工'],
                done: 2,
                total: 3,
                completedPids: [1, 2],
            },
            {
                uid: 9,
                uname: 'bob',
                realName: '鲍勃',
                studentId: '20260002',
                groupIds: [],
                groups: [],
                done: 0,
                total: 3,
                completedPids: [],
            },
        ]);
    });

    it('serializes visible problems and ignores unbound student records', () => {
        expect(serializePracticeRosterProblems([7], { 7: { title: 'A+B', pid: 'P1000', docId: 7 } })).to.deep.equal([
            { pid: 7, title: 'A+B', pidLabel: 'P1000' },
        ]);
        expect(uniqueBoundUserIds([{ boundUserId: 8 }, { boundUserId: 1 }, { boundUserId: null }, { boundUserId: 8 }])).to.deep.equal([8]);
    });

    it('intersects audience groups and drops extra classes', () => {
        const members = assemblePracticeRosterMembers({
            memberUids: [8],
            udict: { 8: { uname: 'alice' } },
            students: {
                8: { realName: '爱丽丝', studentId: '20260001', groupIds: [groupA, groupB] },
            },
            groupNameById: namedGroups,
            completedPidsByUid: new Map(),
            total: 0,
            audienceGroupIds: [groupAId],
        });
        expect(members[0].groupIds).to.deep.equal([groupAId]);
        expect(members[0].groups).to.deep.equal(['计科']);
        expect(members[0].groupIds).to.have.length(members[0].groups.length);
    });

    it('omits unknown group ids from both arrays and does not invent names', () => {
        const projected = projectPracticeRosterGroups({
            groupIds: [groupAId, groupUnknownId, groupBId],
            groupNameById: namedGroups,
        });
        expect(projected).to.deep.equal({
            groupIds: [groupAId, groupBId],
            groups: ['计科', '软工'],
        });
        const members = assemblePracticeRosterMembers({
            memberUids: [8],
            udict: { 8: { uname: 'alice' } },
            students: {
                8: { realName: '爱丽丝', studentId: '20260001', groupIds: [groupA, groupUnknown, groupB] },
            },
            groupNameById: namedGroups,
            completedPidsByUid: new Map(),
            total: 0,
        });
        expect(members[0].groupIds).to.deep.equal([groupAId, groupBId]);
        expect(members[0].groups).to.deep.equal(['计科', '软工']);
        expect(members[0].groups).to.not.include(groupUnknownId);
    });

    it('drops archived groups when no audience is set and a catalog is present', () => {
        const groupCatalogById = new Map([
            [groupAId, catalogEntry(groupAId, { archivedAt: new Date('2026-01-01T00:00:00.000Z') })],
            [groupBId, catalogEntry(groupBId, { archivedAt: null })],
        ]);
        const projected = projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId],
            groupNameById: namedGroups,
            groupCatalogById,
        });
        expect(projected).to.deep.equal({
            groupIds: [groupBId],
            groups: ['软工'],
        });
        const members = assemblePracticeRosterMembers({
            memberUids: [8],
            udict: { 8: { uname: 'alice' } },
            students: {
                8: { realName: '爱丽丝', studentId: '20260001', groupIds: [groupA, groupB] },
            },
            groupNameById: namedGroups,
            completedPidsByUid: new Map(),
            total: 0,
            groupCatalogById,
        });
        expect(members[0].groupIds).to.deep.equal([groupBId]);
        expect(members[0].groups).to.deep.equal(['软工']);
    });

    it('keeps same-school groups and drops other-school groups when studentSchoolId is set', () => {
        const groupCatalogById = new Map([
            [groupAId, catalogEntry(groupAId, { schoolId: schoolAId })],
            [groupBId, catalogEntry(groupBId, { schoolId: schoolBId })],
        ]);
        const projected = projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId],
            groupNameById: namedGroups,
            studentSchoolId: schoolAId,
            groupCatalogById,
        });
        expect(projected).to.deep.equal({
            groupIds: [groupAId],
            groups: ['计科'],
        });
        const members = assemblePracticeRosterMembers({
            memberUids: [8],
            udict: { 8: { uname: 'alice' } },
            students: {
                8: {
                    realName: '爱丽丝',
                    studentId: '20260001',
                    schoolId: schoolA,
                    groupIds: [groupA, groupB],
                },
            },
            groupNameById: namedGroups,
            completedPidsByUid: new Map(),
            total: 0,
            groupCatalogById,
        });
        expect(members[0].groupIds).to.deep.equal([groupAId]);
        expect(members[0].groups).to.deep.equal(['计科']);
    });

    it('does not drop archived audience groups when audience is non-empty', () => {
        const groupCatalogById = new Map([
            [groupAId, catalogEntry(groupAId, { archivedAt: new Date('2025-09-01T00:00:00.000Z'), schoolId: schoolAId })],
            [groupBId, catalogEntry(groupBId, { schoolId: schoolAId })],
        ]);
        const projected = projectPracticeRosterGroups({
            groupIds: [groupAId, groupBId],
            groupNameById: namedGroups,
            audienceGroupIds: [groupAId],
            studentSchoolId: schoolAId,
            groupCatalogById,
        });
        expect(projected).to.deep.equal({
            groupIds: [groupAId],
            groups: ['计科'],
        });
        const members = assemblePracticeRosterMembers({
            memberUids: [8],
            udict: { 8: { uname: 'alice' } },
            students: {
                8: {
                    realName: '爱丽丝',
                    studentId: '20260001',
                    schoolId: schoolA,
                    groupIds: [groupA, groupB],
                },
            },
            groupNameById: namedGroups,
            completedPidsByUid: new Map(),
            total: 0,
            audienceGroupIds: [groupAId],
            groupCatalogById,
        });
        expect(members[0].groupIds).to.deep.equal([groupAId]);
        expect(members[0].groups).to.deep.equal(['计科']);
        expect(members[0]).to.not.have.property('displayGroups');
    });
});
