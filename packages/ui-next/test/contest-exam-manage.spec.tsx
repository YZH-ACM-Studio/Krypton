import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { PRIV } from '../src/lib/perms';
import {
  ExamContestManagePage,
  examContestId,
  isExamRule,
  readExamManageData,
} from '../src/pages/contest-exam-manage';
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
    expect(page).to.match(/isExamRule\(tdoc\.rule\)[\s\S]{0,240}ExamContestManagePage/);
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

describe('exam contest management mutations', () => {
  it('rejects lookalike exam rules instead of coercing them with String()', () => {
    expect(isExamRule('exam')).to.equal(true);
    expect(isExamRule('Exam')).to.equal(false);
    expect(isExamRule('exam ')).to.equal(false);
    expect(isExamRule(['exam'])).to.equal(false);
    expect(isExamRule({ toString: () => 'exam' })).to.equal(false);
    expect(isExamRule(true)).to.equal(false);
    expect(String(['exam'])).to.equal('exam');
  });

  it('drops malformed ids, scores, files and print/owner flags instead of stringifying them', () => {
    const view = readExamManageData({
      tdoc: {
        docId: { $oid: '6aacef7ef6e8b68176be808b' },
        _id: ['6aacef7ef6e8b68176be808b'],
        title: 2026,
        rule: ['exam'],
        owner: '2',
        allowPrint: 1,
        pids: ['11', 12.5, null, 13],
        score: { 13: 0, 14: 1.5, 15: '2', 16: -4, 17: 3 },
      },
      files: '公式.pdf',
      privateFiles: [{ name: '' }, { name: '../答案.docx', size: -8 }, null, { title: 'x' }],
      pdict: [{ title: '不应出现' }, 'x'],
      submissionStats: { total: 99, accepted: 98, participants: 1, participantUnit: 'team' },
    });
    expect(view.tdoc.docId).to.equal(undefined);
    expect(view.tdoc._id).to.equal(undefined);
    expect(examContestId(view.tdoc)).to.equal('');
    expect(view.tdoc.title).to.equal('考试');
    expect(view.tdoc.rule).to.equal('exam');
    expect(view.tdoc.owner).to.equal(undefined);
    expect(view.tdoc.allowPrint).to.equal(false);
    expect(view.tdoc.pids).to.deep.equal([13]);
    expect(view.tdoc.score).to.deep.equal({ 17: 3 });
    expect(view.files).to.deep.equal([]);
    expect(view.privateFiles).to.deep.equal([{ name: '../答案.docx', size: -8 }]);
    expect(view.pdict).to.deep.equal({});
    expect(view).not.to.have.property('submissionStats');
  });

  it('keeps a usable id only from a string or integer, including _id fallback', () => {
    const fromString = readExamManageData({ tdoc: { docId: '6aacef7ef6e8b68176be808b' } });
    const fromInt = readExamManageData({ tdoc: { docId: 42 } });
    const fallback = readExamManageData({ tdoc: { docId: { oid: 'nope' }, _id: '66bf00000000000000000101' } });
    expect(examContestId(fromString.tdoc)).to.equal('6aacef7ef6e8b68176be808b');
    expect(examContestId(fromInt.tdoc)).to.equal('42');
    expect(examContestId(fallback.tdoc)).to.equal('66bf00000000000000000101');
    expect(readExamManageData(null).tdoc.title).to.equal('考试');
    expect(readExamManageData([]).tdoc.pids).to.deep.equal([]);
    expect(readExamManageData({ tdoc: [] }).tdoc.docId).to.equal(undefined);
  });

  it('does not treat array/capitalized/padded rules as exam on the manage switch', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ events: [], schools: [] })));
    for (const rule of [['exam'], 'Exam', 'exam '] as const) {
      const { unmount } = render(
        <BootstrapProvider bootstrap={bootstrap(acmManagePage({ tdoc: { ...(acmManagePage().tdoc as Record<string, unknown>), rule } }))}>
          <ContestManagePage />
        </BootstrapProvider>,
      );
      expect(screen.getByRole('heading', { name: '比赛管理' })).to.exist;
      expect(screen.getByRole('link', { name: '气球分发' })).to.exist;
      expect(screen.queryByRole('heading', { name: '考试管理' })).to.equal(null);
      unmount();
    }
  });

  it('ignores ACM submission stats and lookalike print flags on an exam workspace', () => {
    render(
      <BootstrapProvider
        bootstrap={bootstrap(
          examManagePage({
            submissionStats: { total: 40, accepted: 12, participants: 8, participantUnit: 'team', byProblem: [], byHour: [] },
            tdoc: {
              ...(examManagePage().tdoc as Record<string, unknown>),
              allowPrint: 'true',
              owner: '2',
              balloon: { 11: '#f00' },
            },
          }),
        )}
      >
        <ExamContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '考试管理' })).to.exist;
    expect(screen.queryByText('提交统计')).to.equal(null);
    expect(screen.queryByText('AC 数')).to.equal(null);
    expect(screen.queryByRole('link', { name: /气球/ })).to.equal(null);
    expect(screen.queryByRole('link', { name: '打印服务' })).to.equal(null);
    expect(screen.queryByRole('link', { name: '主观题阅卷' })).to.equal(null);
  });

  it('encodes hostile file names and hides chrome when the contest id is not a real id', () => {
    render(
      <BootstrapProvider
        bootstrap={bootstrap({
          tdoc: {
            docId: { $oid: '6aacef7ef6e8b68176be808b' },
            title: '<script>alert(1)</script>',
            rule: 'exam',
            pids: ['11', 12.5],
            score: { 11: 0 },
          },
          files: [{ name: '../etc/passwd' }, { name: '<img src=x onerror=alert(1)>' }, { name: '' }],
        })}
      >
        <ExamContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '考试管理' })).to.exist;
    expect(screen.getByText('<script>alert(1)</script>')).to.exist;
    expect(screen.queryByRole('navigation', { name: '考试管理' })).to.equal(null);
    expect(screen.getByRole('link', { name: '返回考试详情' }).getAttribute('href')).to.equal('/contest');
    expect(screen.getByText('该考试还没有题目')).to.exist;
    expect(screen.getByRole('link', { name: '下载 ../etc/passwd' }).getAttribute('href')).to.equal(
      '/file/public/..%2Fetc%2Fpasswd',
    );
    expect(screen.getByRole('link', { name: '下载 <img src=x onerror=alert(1)>' }).getAttribute('href')).to.contain(
      encodeURIComponent('<img src=x onerror=alert(1)>'),
    );
    expect(document.querySelectorAll('script').length).to.equal(0);
  });

  it('shows grading only for the integer owner or a system admin', () => {
    const { unmount } = render(
      <BootstrapProvider bootstrap={bootstrap(examManagePage({ tdoc: { ...(examManagePage().tdoc as Record<string, unknown>), owner: 9 } }))}>
        <ExamContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.queryByRole('link', { name: '主观题阅卷' })).to.equal(null);
    unmount();

    render(
      <BootstrapProvider
        bootstrap={{
          ...bootstrap(examManagePage({ tdoc: { ...(examManagePage().tdoc as Record<string, unknown>), owner: 9 } })),
          user: { id: 2, name: 'admin', signedIn: true, priv: PRIV.PRIV_EDIT_SYSTEM } as KryptonBootstrap['user'],
        }}
      >
        <ExamContestManagePage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('link', { name: '主观题阅卷' }).getAttribute('href')).to.equal(
      '/manage/grading/6aacef7ef6e8b68176be808b',
    );
  });

  it('does not relabel users as 考生 when rule only looks like exam', () => {
    render(
      <BootstrapProvider
        bootstrap={bootstrap(
          {
            tdoc: { docId: 'exam1', title: '期末考', rule: ['exam'], pids: [] },
            tsdocs: [],
          },
          'contest_user.html',
        )}
      >
        <ContestUserPage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '参赛选手' })).to.exist;
    expect(screen.getByLabelText('选手管理')).to.exist;
    expect(screen.queryByRole('heading', { name: '考生名单' })).to.equal(null);
  });
});
