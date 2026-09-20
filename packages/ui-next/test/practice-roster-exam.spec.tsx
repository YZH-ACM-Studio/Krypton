import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PracticeRosterCard, type PracticeRosterMember } from '../src/components/practice-roster';

const members: PracticeRosterMember[] = [
  {
    uid: 8,
    uname: 'alice',
    realName: '爱丽丝',
    studentId: '20260001',
    groups: ['计科'],
    groupIds: ['g1'],
    done: 0,
    total: 0,
    completedPids: [],
    exam: { state: 'finalized', attemptsUsed: 1, score: 92, passed: true },
  },
  {
    uid: 9,
    uname: 'lyra',
    realName: '李嫣容',
    studentId: '2026051026',
    groups: ['计科'],
    groupIds: ['g1'],
    done: 0,
    total: 0,
    completedPids: [],
    exam: { state: 'not_started', attemptsUsed: 0 },
  },
];

describe('practice roster exam columns', () => {
  it('shows settled exam scores and does not print 0 for people who never started', () => {
    render(
      <PracticeRosterCard
        members={members}
        title="实验室安全与防护"
        exam={{ title: '实验室安全准入考试', passScore: 60, attemptLimit: 2 }}
      />,
    );
    expect(screen.getByText('实验室安全准入考试')).toBeInTheDocument();
    expect(screen.getByText('已及格')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('未开考')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0/0')).toEqual(null);
    expect(screen.getByText(/人均 92.0 分/)).toBeInTheDocument();
  });
});
