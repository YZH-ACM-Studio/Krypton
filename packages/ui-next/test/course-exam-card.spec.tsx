import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CourseExamCard } from '../src/pages/course/course-exam-card';
import type { CourseChapter, CourseExamBinding, CourseExamContestPreview } from '../src/pages/course/types';

const exam: CourseExamBinding = { contestId: '6aaccbf482d5641e9491a12b', gate: 'all' };
const contest: CourseExamContestPreview = {
  docId: '6aaccbf482d5641e9491a12b',
  title: '实验室安全结业考试测试',
};
const chapters: CourseChapter[] = [
  {
    _id: 1,
    title: '一',
    content: '',
    pids: [],
    loosePids: [],
    videos: [
      {
        id: 'cv_one',
        title: '实验室安全事故案例',
        durationMs: 10_000,
        contentRevision: 1,
        playUrl: '/play/1',
        lastPosition: 0,
        coverageRatio: 0,
        completed: false,
        completedAt: null,
      },
    ],
    sections: [],
    completedPids: [],
    tids: [],
    progress: 0,
    doneCount: 0,
    totalCount: 0,
  },
];

describe('course exam card manager preview', () => {
  it('hides the remaining-video list for managers and keeps it for students', () => {
    const { rerender } = render(
      <CourseExamCard exam={exam} contest={contest} chapters={chapters} canManage={false} />,
    );
    expect(screen.getByText('还需看完 1 个视频')).to.exist;
    expect(screen.getByText('实验室安全事故案例')).to.exist;
    expect(screen.queryByRole('link', { name: '预览考试' })).to.equal(null);

    rerender(<CourseExamCard exam={exam} contest={contest} chapters={chapters} canManage />);
    expect(screen.queryByText('还需看完 1 个视频')).to.equal(null);
    expect(screen.queryByText('实验室安全事故案例')).to.equal(null);
    expect(screen.getByText(/学生需看完规定视频后才能参加/)).to.exist;
    expect(screen.getByText(/预览不能交卷/)).to.exist;
    expect(screen.getByRole('link', { name: '预览考试' })).to.exist;
    expect(screen.queryByRole('link', { name: '进入考试' })).to.equal(null);
  });
});
