import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { assemblePracticeRosterMembers, serializePracticeRosterProblems, uniqueBoundUserIds } from '../src/lib/practice-roster';

describe('practice roster assembly', () => {
    it('joins bound students, group names and completed pids without inventing extra members', () => {
        const groupA = new ObjectId('66c100000000000000000001');
        const groupB = new ObjectId('66c100000000000000000002');
        const members = assemblePracticeRosterMembers({
            memberUids: [8, 9],
            udict: { 8: { uname: 'alice' }, 9: { uname: 'bob' } },
            students: {
                '8': { realName: '爱丽丝', studentId: '20260001', groupIds: [groupA, groupB] },
                '9': { realName: '鲍勃', studentId: '20260002', groupIds: [] },
            },
            groupNameById: new Map([
                [String(groupA), '计科'],
                [String(groupB), '软工'],
            ]),
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
                groupIds: [String(groupA), String(groupB)],
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
});
