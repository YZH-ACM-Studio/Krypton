import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { DomainsPage, FilesPage } from '../src/pages/misc.tsx';
import { ProblemHackPage } from '../src/pages/problem-hack.tsx';
import { ProblemMinePage } from '../src/pages/problem-mine.tsx';
import { AboutPage } from '../src/pages/wiki.tsx';

function makeBootstrap(
  templateName: string,
  data: Record<string, unknown>,
  overrides: Partial<KryptonBootstrap> = {},
): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-07-26T00:00:00.000Z',
    user: {
      id: 2,
      name: 'root',
      mail: 'root@example.test',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'root',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      problemDetail: '/p/__PID__',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data },
    ...overrides,
  };
}

function renderPage(
  page: React.ReactNode,
  templateName: string,
  data: Record<string, unknown>,
  overrides?: Partial<KryptonBootstrap>,
) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(templateName, data, overrides)}>{page}</BootstrapProvider>,
  );
}

describe('legacy page bootstrap boundaries', () => {
  it('renders configured about sections and stable anchor navigation', () => {
    renderPage(
      <AboutPage />,
      'about.html',
      {
        sections: [
          { id: 'mission', title: '平台使命', content: '**可靠** 的评测服务' },
          { title: '使用范围', content: '教学与竞赛' },
        ],
      },
    );

    expect(screen.getByRole('heading', { name: '关于 Krypton OJ' })).not.to.equal(null);
    expect(screen.getByRole('link', { name: '平台使命' }).getAttribute('href')).to.equal('#mission');
    expect(screen.getByRole('link', { name: '使用范围' }).getAttribute('href')).to.equal('#使用范围');
    expect(screen.getByText('可靠')).not.to.equal(null);
    expect(screen.getByText('教学与竞赛')).not.to.equal(null);
  });

  it('falls back to the site introduction when no about sections are configured', () => {
    renderPage(<AboutPage />, 'about.html', {});

    expect(screen.getByText('Krypton OJ 是面向信息学教学与竞赛的在线评测系统。')).not.to.equal(null);
    expect(screen.getByRole('link', { name: 'Krypton OJ' }).getAttribute('href')).to.equal('#about');
  });

  it('renders domain membership, pinned state and management actions', () => {
    renderPage(
      <DomainsPage />,
      'domain_list.html',
      {
        ddocs: [
          { _id: 'class-a', name: '班级 A', bulletin: '# 本周训练', owner: 9 },
          { _id: 'system', name: '主域', owner: 1 },
        ],
        canManage: { 'class-a': true },
        role: { 'class-a': 'student', system: 'default' },
      },
      {
        user: {
          ...makeBootstrap('domain_list.html', {}).user,
          pinnedDomains: ['class-a'],
        },
      },
    );

    expect(screen.getByRole('heading', { name: '我的域' })).not.to.equal(null);
    expect(screen.getByText('本周训练')).not.to.equal(null);
    expect(screen.getByText('student')).not.to.equal(null);
    expect(screen.getByRole('link', { name: '管理' }).getAttribute('href')).to.equal('/d/class-a/domain/dashboard');
    expect(screen.getByTitle('取消置顶')).not.to.equal(null);
    expect(screen.getByRole('button', { name: '退出' })).not.to.equal(null);
  });

  it('renders managed files with the existing download URL and size display', () => {
    renderPage(
      <FilesPage />,
      'home_files.html',
      {
        files: [
          { name: 'statement.pdf', size: 3072 },
          { filename: 'fallback.txt', size: 0 },
        ],
      },
    );

    expect(screen.getByText('statement.pdf')).not.to.equal(null);
    expect(screen.getByText('3 KB')).not.to.equal(null);
    expect(screen.getByText('fallback.txt')).not.to.equal(null);
    expect(screen.getAllByRole('link', { name: '下载' }).map((link) => link.getAttribute('href'))).to.deep.equal([
      '/file/2/statement.pdf',
      '/file/2/fallback.txt',
    ]);
  });

  it('keeps the hack target identity and problem route in the submission form', () => {
    renderPage(
      <ProblemHackPage />,
      'problem_hack.html',
      {
        pdoc: { docId: 7, pid: 'CAUC0007', title: '构造反例' },
        rid: 'record-12345678',
      },
    );

    expect(screen.getByRole('heading', { name: 'Hack 提交' })).not.to.equal(null);
    expect(screen.getByText(/#12345678 · 构造反例/)).not.to.equal(null);
    expect(screen.getByRole('link').getAttribute('href')).to.equal('/p/CAUC0007');
    expect(screen.getByRole('button', { name: '提交 Hack' }).closest('form')?.getAttribute('enctype')).to.equal(
      'multipart/form-data',
    );
  });

  it('renders the author problem list, visibility and pagination', () => {
    renderPage(
      <ProblemMinePage />,
      'problem_mine.html',
      {
        pdocs: [
          {
            docId: 42,
            pid: 'CAUC0042',
            title: '并查集',
            tag: ['数据结构', '图论'],
            hidden: true,
            nAccept: 12,
            nSubmit: 34,
          },
        ],
        page: 2,
        pcount: 4,
        ppcount: 3,
        canCreate: true,
      },
    );

    expect(screen.getByText('共 4 题')).not.to.equal(null);
    expect(screen.getByRole('link', { name: '新建题目' }).getAttribute('href')).to.equal('/problem/create');
    expect(screen.getByRole('link', { name: '并查集' }).getAttribute('href')).to.equal('/p/CAUC0042');
    expect(screen.getByText('隐藏')).not.to.equal(null);
    expect(screen.getByText('12 / 34')).not.to.equal(null);
    expect(screen.getByRole('link', { name: '上一页' }).getAttribute('href')).to.equal('/problem/mine?page=1');
    expect(screen.getByRole('link', { name: '下一页' }).getAttribute('href')).to.equal('/problem/mine?page=3');
  });
});
