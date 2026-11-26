import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { CourseVideoStatsPage } from '../../src/pages/course/video-stats.tsx';

function bootstrap(pageData: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-21T10:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'course_videos.html', data: pageData },
  };
}

function renderStats(pageData: Record<string, unknown>) {
  return render(
    <BootstrapProvider bootstrap={bootstrap(pageData)}>
      <CourseVideoStatsPage />
    </BootstrapProvider>,
  );
}

const rosterData = {
  tdoc: { docId: 'course-1', title: '消防课程' },
  videos: [],
  groupHeadcount: 0,
  unbound: [],
  members: [],
  groups: [],
  groupIds: [],
};

describe('course watch stats inside the course workbench shell', () => {
  it('shows the workbench breadcrumb and tabs, with 观看统计 selected', () => {
    renderStats(rosterData);

    const breadcrumb = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: '课程' }).getAttribute('href')).toBe('/teach/courses');
    expect(within(breadcrumb).getByText('消防课程')).toBeTruthy();

    expect(screen.getByRole('tab', { name: '观看统计', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '章节' }).getAttribute('href')).toBe('/course/course-1/edit');
    expect(screen.getByRole('tab', { name: '学生与可见性' }).getAttribute('href')).toBe('/course/course-1/edit?tab=students');
    expect(screen.getByRole('tab', { name: '结业考试' }).getAttribute('href')).toBe('/course/course-1/edit?tab=exam');
    expect(screen.getByRole('tab', { name: '导图' }).getAttribute('href')).toBe('/course/course-1/edit?tab=mindmap');
    expect(screen.getByRole('tab', { name: '设置' }).getAttribute('href')).toBe('/course/course-1/edit?tab=settings');
  });

  it('never sends the teacher back to the student course page', () => {
    renderStats(rosterData);

    expect(screen.queryByRole('link', { name: '返回课程' })).toBeNull();
    const studentView = screen.getByRole('link', { name: '学生视角' });
    expect(studentView.getAttribute('href')).toBe('/course/course-1');
    expect(studentView.getAttribute('target')).toBe('_blank');
  });

  it('keeps the shell when the course has no class to report on', () => {
    renderStats({ ...rosterData, rosterUnavailable: 'no_groups' });

    expect(screen.getByRole('tab', { name: '观看统计', selected: true })).toBeTruthy();
    expect(screen.getByText('没有绑定班级，无法出观看名单')).toBeTruthy();
    expect(screen.getByRole('link', { name: '去设置班级' }).getAttribute('href')).toBe('/course/course-1/edit?tab=students');
    expect(screen.queryByRole('link', { name: '导出 CSV' })).toBeNull();
  });
});
