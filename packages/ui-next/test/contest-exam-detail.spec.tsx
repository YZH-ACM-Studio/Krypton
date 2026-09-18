import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ContestDetailPage } from '../src/pages/contests';

const uiRoot = resolve(import.meta.dirname, '..');

function source(relative: string) {
  return readFileSync(resolve(uiRoot, relative), 'utf8');
}

function bootstrap(pageData: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-09-18T10:00:00.000Z',
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      contests: '/contest',
      contestDetail: '/contest/__TID__',
      records: '/record',
      discussionNode: '/discuss/__TYPE__/__NAME__',
      homework: '/homework',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'contest_detail.html', data: pageData },
  };
}

function examPage(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    tdoc: {
      docId: '6aacef7ef6e8b68176be808b',
      title: '实验室安全准入考试',
      rule: 'exam',
      beginAt: new Date(now - 3_600_000).toISOString(),
      endAt: new Date(now + 3_600_000).toISOString(),
      attend: 12,
      duration: 2,
      examPassScore: 60,
      examAttemptLimit: 3,
      content: '开考后不能重抽。',
    },
    tsdoc: {},
    pids: [],
    attended: false,
    canManageContest: false,
    canViewRecord: false,
    ...overrides,
  };
}

function renderDetail(pageData: Record<string, unknown>) {
  return render(
    <BootstrapProvider bootstrap={bootstrap(pageData)}>
      <ContestDetailPage />
    </BootstrapProvider>,
  );
}

describe('exam contest detail landing', () => {
  it('keeps ACM copy on the shared contest detail page', () => {
    const page = source('src/pages/contests.tsx');
    expect(page).to.include('参加比赛');
    expect(page).to.include('比赛入口');
    expect(page).to.include('进入题目');
    expect(page).to.include('打星参赛（不计正式名次）');
  });

  it('shows exam copy and the attend form before a student registers', () => {
    renderDetail(examPage());
    expect(screen.getByRole('heading', { name: '实验室安全准入考试' })).to.exist;
    expect(screen.getByRole('button', { name: '报名考试' })).to.exist;
    expect(screen.getByText('及格分').closest('div')?.textContent).to.match(/60/);
    expect(screen.getByText('最多考几次').closest('div')?.textContent).to.match(/3 次/);
    expect(screen.getAllByText('个人时长').some((node) => node.closest('div')?.textContent?.includes('2 小时'))).to.equal(true);
    expect(screen.getByText('开考后不能重抽。')).to.exist;
    expect(screen.getByText('开考后可见')).to.exist;
    expect(screen.queryByRole('button', { name: '参加比赛' })).to.equal(null);
    expect(screen.queryByText('比赛入口')).to.equal(null);
    expect(screen.queryByText('打星参赛（不计正式名次）')).to.equal(null);
    expect(document.querySelector('input[name="operation"][value="attend"]')).not.to.equal(null);
    expect(screen.queryByRole('link', { name: /澄清答疑/ })).to.equal(null);
    expect(screen.queryByRole('link', { name: /气球/ })).to.equal(null);
  });

  it('sends attended students to exam-mode and keeps manager-only clarification', () => {
    renderDetail(
      examPage({
        attended: true,
        tsdoc: { attend: 1 },
        canViewRecord: true,
      }),
    );
    const enter = screen.getAllByRole('link', { name: /进入考试/ });
    expect(enter.some((node) => node.getAttribute('href') === '/exam-mode/6aacef7ef6e8b68176be808b')).to.equal(true);
    expect(screen.queryByRole('button', { name: '报名考试' })).to.equal(null);
    expect(screen.getAllByRole('link', { name: /我的提交/ }).length).to.be.greaterThan(0);
    expect(screen.queryByRole('link', { name: /澄清答疑/ })).to.equal(null);
  });

  it('keeps the same manage, scoreboard, discussion, print and file routes', () => {
    renderDetail(
      examPage({
        canManageContest: true,
        canViewRecord: true,
        attended: true,
        pids: [11, 12],
        files: [{ name: '公式.pdf' }],
        tdoc: {
          ...(examPage().tdoc as Record<string, unknown>),
          allowPrint: true,
          hidden: true,
          entryMode: 'client_required',
        },
      }),
    );
    expect(screen.getByText('须用客户端')).to.exist;
    expect(screen.getByText('已隐藏')).to.exist;
    expect(screen.getByText('2 题')).to.exist;
    expect(screen.getByRole('link', { name: '管理' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/management',
    );
    expect(screen.getByRole('link', { name: '编辑考试' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/edit',
    );
    expect(screen.getByRole('link', { name: '考生名单' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/user',
    );
    expect(screen.getAllByRole('link', { name: /澄清答疑/ })[0].getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/clarification',
    );
    expect(screen.getAllByRole('link', { name: /排行榜/ })[0].getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/scoreboard',
    );
    expect(screen.getByRole('link', { name: /讨论区/ }).getAttribute('href')).to.equal(
      '/discuss/contest/6aacef7ef6e8b68176be808b',
    );
    expect(screen.getByRole('link', { name: /打印服务/ }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/print',
    );
    expect(screen.getByRole('link', { name: '公式.pdf' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/file/private/%E5%85%AC%E5%BC%8F.pdf',
    );
    expect(screen.queryByRole('link', { name: /气球/ })).to.equal(null);
  });

  it('lets anyone open the finished exam the same way ACM lets anyone view ended problems', () => {
    const now = Date.now();
    renderDetail(
      examPage({
        tdoc: {
          ...(examPage().tdoc as Record<string, unknown>),
          beginAt: new Date(now - 7_200_000).toISOString(),
          endAt: new Date(now - 3_600_000).toISOString(),
        },
        attended: false,
      }),
    );
    const review = screen.getAllByRole('link', { name: /查看考试/ });
    expect(review.some((node) => node.getAttribute('href') === '/exam-mode/6aacef7ef6e8b68176be808b')).to.equal(true);
    expect(screen.queryByRole('button', { name: '报名考试' })).to.equal(null);
    expect(screen.getByText('整场已结束')).to.exist;
  });

  it('does not restyle ACM contest_detail as the exam landing', () => {
    const now = Date.now();
    renderDetail({
      tdoc: {
        docId: 'acm1',
        title: '校赛',
        rule: 'acm',
        beginAt: new Date(now - 3_600_000).toISOString(),
        endAt: new Date(now + 3_600_000).toISOString(),
        attend: 4,
      },
      tsdoc: {},
      pids: [1],
      attended: false,
    });
    expect(screen.getByRole('button', { name: '参加比赛' })).to.exist;
    expect(screen.getByText('比赛入口')).to.exist;
    expect(screen.queryByRole('button', { name: '报名考试' })).to.equal(null);
    expect(screen.queryByText('考生说明')).to.equal(null);
  });
});
