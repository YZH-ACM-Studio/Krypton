import { describe, expect, it } from 'vitest';
import {
  practiceRosterExamLabel,
  practiceRosterExamScoreText,
  practiceRosterMatrixCell,
  readPracticeRosterExamFact,
  rosterExamGroupColumns,
  rosterGroupColumns,
  type PracticeRosterMember,
} from '../src/components/practice-roster';

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

  it('does not treat an unstarted exam as 0 points and averages only settled papers', () => {
    const withExam: PracticeRosterMember[] = [
      { ...members[0], exam: { state: 'finalized', attemptsUsed: 1, score: 92, passed: true } },
      { ...members[1], exam: { state: 'finalized', attemptsUsed: 1, score: 50, passed: false } },
      { ...members[2], exam: { state: 'not_started', attemptsUsed: 0 } },
    ];
    expect(practiceRosterExamLabel(withExam[2].exam)).to.equal('未开考');
    expect(practiceRosterExamScoreText(withExam[2].exam)).to.equal('—');
    expect(practiceRosterExamScoreText(withExam[0].exam)).to.equal('92');
    expect(practiceRosterExamLabel(withExam[0].exam)).to.equal('已及格');
    const columns = rosterExamGroupColumns(withExam, [groupA]);
    expect(columns[0]).to.include({ memberCount: 2, finalizedCount: 2, passedCount: 1 });
    expect(columns[0].averageScore).to.equal(71);
    expect(() => readPracticeRosterExamFact({ state: 'not_started', attemptsUsed: 0, score: 0 }, 'exam')).to.throw(
      /score cannot appear before the paper is submitted/,
    );
  });
});
