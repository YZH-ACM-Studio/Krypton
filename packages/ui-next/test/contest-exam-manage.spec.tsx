import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ExamContestManagePage } from '../src/pages/contest-exam-manage';
import { ContestManagePage, ContestUserPage } from '../src/pages/contest-manage';

const uiRoot = resolve(import.meta.dirname, '..');

function source(relative: string) {
  return readFileSync(resolve(uiRoot, relative), 'utf8');
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function bootstrap(pageData: Record<string, unknown>, templateName = 'contest_manage.html'): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-09-18T10:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
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
    page: { templateName, data: pageData },
  };
}

function examManagePage(overrides: Record<string, unknown> = {}) {
  return {
    tdoc: {
      docId: '6aacef7ef6e8b68176be808b',
      title: '实验室安全准入考试',
      rule: 'exam',
      owner: 2,
      pids: [11, 12],
      score: { 11: 2, 12: 2 },
      allowPrint: true,
    },
    pdict: {
      11: { title: '焊头的中心温度大概是', pid: 'SF0001', problemKind: 'single' },
      12: { title: '发生器着火应', pid: 'SF0002', problemKind: 'single' },
    },
    files: [{ name: '公式.pdf', size: 1024 }],
    privateFiles: [{ name: '答案.docx', size: 2048 }],
    scopeGroups: [],
    ...overrides,
  };
}

function acmManagePage(overrides: Record<string, unknown> = {}) {
  return {
    tdoc: {
      docId: 'acm1',
      title: '校赛',
      rule: 'acm',
      owner: 2,
      pids: [1],
      score: { 1: 100 },
    },
    pdict: {
      1: { title: 'A + B', pid: 'P1001' },
    },
    files: [],
    privateFiles: [],
    submissionStats: {
      total: 4,
      accepted: 1,
      participants: 2,
      participantUnit: 'user',
      byProblem: [],
      byHour: [],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exam contest management', () => {
  it('keeps ACM management copy and submission stats on the shared page', () => {
    const page = source('src/pages/contest-manage.tsx');
    expect(page).to.include('比赛管理');
    expect(page).to.include('aria-label="比赛管理功能"');
    expect(page).to.include('提交统计');
    expect(page).to.include("label: '参赛选手'");
    expect(page).to.include("label: '气球分发'");
    expect(page).to.match(/String\(tdoc\.rule\) === 'exam'[\s\S]{0,240}ExamContestManagePage/);
  });

  it('renders an exam workspace without ACM contest-admin chrome', () => {
    render(
      <BootstrapProvider bootstrap={bootstrap(examManagePage())}>
        <ExamContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '考试管理' })).to.exist;
    expect(screen.getByRole('navigation', { name: '考试管理' })).to.exist;
    expect(screen.getByRole('link', { name: '考生名单' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/user',
    );
    expect(screen.getByRole('link', { name: '编辑考试' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/edit',
    );
    expect(screen.getByRole('link', { name: '答疑' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/clarification',
    );
    expect(screen.getByRole('link', { name: '打印服务' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/print',
    );
    expect(screen.getByText('题目分值')).to.exist;
    expect(screen.getByText('公开文件').textContent).to.match(/1/);
    expect(screen.getByText('私有材料').textContent).to.match(/1/);
    expect(screen.getByRole('link', { name: '下载 公式.pdf' }).getAttribute('href')).to.equal(
      '/contest/6aacef7ef6e8b68176be808b/file/public/%E5%85%AC%E5%BC%8F.pdf',
    );
    expect(document.querySelectorAll('button[name="operation"][value="upload_file"]').length).to.equal(2);
    expect(screen.queryByRole('heading', { name: '比赛管理' })).to.equal(null);
    expect(screen.queryByText('参赛选手')).to.equal(null);
    expect(screen.queryByText('提交统计')).to.equal(null);
    expect(screen.queryByText('比赛管理功能')).to.equal(null);
    expect(screen.queryByRole('link', { name: /气球/ })).to.equal(null);
    expect(screen.queryByText('AC 数')).to.equal(null);
  });

  it('routes contest_manage exam onto the exam workspace and still shows seat entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [] })),
    );
    render(
      <BootstrapProvider bootstrap={bootstrap(examManagePage())}>
        <ContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '考试管理' })).to.exist;
    expect(screen.getByText('机房座位与赛前预启动')).to.exist;
    expect(screen.queryByRole('heading', { name: '比赛管理' })).to.equal(null);
    expect(screen.queryByLabelText('比赛管理功能')).to.equal(null);
  });

  it('does not restyle ACM contest_manage as the exam workspace', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ events: [], schools: [] })),
    );
    render(
      <BootstrapProvider bootstrap={bootstrap(acmManagePage())}>
        <ContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '比赛管理' })).to.exist;
    expect(screen.getByLabelText('比赛管理功能')).to.exist;
    expect(screen.getByText('提交统计')).to.exist;
    expect(screen.getByRole('link', { name: '参赛选手' })).to.exist;
    expect(screen.getByRole('link', { name: '气球分发' }).getAttribute('href')).to.equal('/contest/acm1/balloon');
    expect(screen.queryByRole('heading', { name: '考试管理' })).to.equal(null);
    expect(screen.queryByText('考生名单')).to.equal(null);
  });

  it('labels the exam user list as 考生名单 and keeps ACM 参赛选手', () => {
    render(
      <BootstrapProvider
        bootstrap={bootstrap(
          {
            tdoc: { docId: 'exam1', title: '期末考', rule: 'exam', pids: [] },
            tsdocs: [],
          },
          'contest_user.html',
        )}
      >
        <ContestUserPage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '考生名单' })).to.exist;
    expect(screen.getByLabelText('考生管理')).to.exist;
    expect(screen.getByText('暂无考生')).to.exist;
    expect(screen.queryByRole('heading', { name: '参赛选手' })).to.equal(null);
    expect(screen.queryByText('打星参赛（不计正式名次）')).to.equal(null);
  });
});
