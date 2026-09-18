import { describe, expect, it } from 'vitest';
import { filterWatchMembers, watchMemberStatus, type StatsMember } from '../src/pages/course/video-stats';

function member(partial: Partial<StatsMember> & Pick<StatsMember, 'uid' | 'done' | 'total'>): StatsMember {
  return {
    studentId: '',
    realName: '',
    uname: '',
    videos: [],
    ...partial,
  };
}

describe('course video stats filters', () => {
  it('classifies done / in-progress / not-started', () => {
    expect(watchMemberStatus({ done: 3, total: 3 })).to.equal('done');
    expect(watchMemberStatus({ done: 1, total: 3 })).to.equal('in_progress');
    expect(watchMemberStatus({ done: 0, total: 3 })).to.equal('not_started');
    expect(watchMemberStatus({ done: 0, total: 0 })).to.equal('not_started');
  });

  it('filters by completion and name', () => {
    const members = [
      member({ uid: 1, done: 2, total: 2, studentId: '2401', realName: '张三' }),
      member({ uid: 2, done: 1, total: 2, studentId: '2402', realName: '李四' }),
      member({ uid: 3, done: 0, total: 2, studentId: '2403', uname: 'wang' }),
    ];
    expect(filterWatchMembers(members, 'done', '').map((row) => row.uid)).to.deep.equal([1]);
    expect(filterWatchMembers(members, 'incomplete', '').map((row) => row.uid)).to.deep.equal([2, 3]);
    expect(filterWatchMembers(members, 'all', '李').map((row) => row.uid)).to.deep.equal([2]);
    expect(filterWatchMembers(members, 'all', '2403').map((row) => row.uid)).to.deep.equal([3]);
  });
});
