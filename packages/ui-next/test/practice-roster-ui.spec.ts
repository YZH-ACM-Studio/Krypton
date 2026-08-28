import { describe, expect, it } from 'vitest';
import { practiceRosterMatrixCell, rosterGroupColumns, type PracticeRosterMember } from '../src/components/practice-roster';

const groupA = '66c300000000000000000001';
const groupB = '66c300000000000000000002';

const members: PracticeRosterMember[] = [
  {
    uid: 8,
    uname: 'alice',
    realName: '爱丽丝',
    studentId: '1',
    groups: ['计科', '软工'],
    groupIds: [groupA, groupB],
    done: 2,
    total: 2,
    completedPids: [1, 2],
  },
  {
    uid: 9,
    uname: 'bob',
    realName: '鲍勃',
    studentId: '2',
    groups: ['计科'],
    groupIds: [groupA],
    done: 1,
    total: 2,
    completedPids: [1],
  },
  {
    uid: 10,
    uname: 'cara',
    realName: '卡拉',
    studentId: '3',
    groups: [],
    groupIds: [],
    done: 0,
    total: 2,
    completedPids: [],
  },
];

describe('practice roster group matrix', () => {
  it('counts a student in every group they belong to and keeps an ungrouped column', () => {
    const columns = rosterGroupColumns(members);
    expect(columns.map((column) => column.id)).to.deep.equal([groupA, groupB, '__ungrouped__']);
    expect(columns[0]).to.include({ memberCount: 2, allDoneCount: 1 });
    expect(columns[1]).to.include({ memberCount: 1, allDoneCount: 1 });
    expect(columns[2]).to.include({ memberCount: 1, allDoneCount: 0 });
    expect(practiceRosterMatrixCell(members, groupA, 1)).to.deep.equal({ completed: 2, total: 2 });
    expect(practiceRosterMatrixCell(members, groupA, 2)).to.deep.equal({ completed: 1, total: 2 });
    expect(practiceRosterMatrixCell(members, '__ungrouped__', 1)).to.deep.equal({ completed: 0, total: 1 });
    expect(rosterGroupColumns(members, [groupA]).map((column) => column.id)).to.deep.equal([groupA, '__ungrouped__']);
  });
});
