import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { DomainDashboardPage, ManageDashboardPage, StatusPage } from '../src/pages/admin.tsx';

function makeBootstrap(templateName: string, data: Record<string, unknown>, userId = 2): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-07-26T00:00:00.000Z',
    user: { id: userId, name: 'root', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      problems: '/p',
      records: '/record',
      discussions: '/discuss',
      domainPermission: '/domain/permission',
      status: '/manage/status',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data },
  };
}

function renderPage(page: React.ReactNode, templateName: string, data: Record<string, unknown>, userId = 2) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(templateName, data, userId)}>{page}</BootstrapProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin dashboard pages', () => {
  it('renders domain counters, owner identity and owner-only destructive action', () => {
    renderPage(
      <DomainDashboardPage />,
      'domain_dashboard.html',
      {
        pcount: 12,
        ucount: 34,
        rcount: 56,
        dcount: 7,
        domain: { _id: 'system', name: '主域', owner: 2 },
        owner: { _id: 2, uname: 'root' },
      },
      2,
    );

    expect(screen.getByRole('heading', { name: '域管理' })).not.to.equal(null);
    expect(screen.getByText('12')).not.to.equal(null);
    expect(screen.getByText('34')).not.to.equal(null);
    expect(screen.getByText('56')).not.to.equal(null);
    expect(screen.getByText('root')).not.to.equal(null);
    expect(screen.getByRole('button', { name: '删除域' })).not.to.equal(null);
    expect(screen.getByText(/Hydro 自带，按 UID 分组授权/)).not.to.equal(null);
  });

  it('does not offer domain deletion to a non-owner', () => {
    renderPage(
      <DomainDashboardPage />,
      'domain_dashboard.html',
      {
        domain: { _id: 'class-a', name: '班级 A', owner: 9 },
        owner: { _id: 9, uname: 'teacher' },
      },
      2,
    );

    expect(screen.queryByRole('button', { name: '删除域' })).to.equal(null);
    expect(screen.getByRole('button', { name: '初始化讨论节点' })).not.to.equal(null);
  });

  it('exposes management destinations and protects restart with confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage(<ManageDashboardPage />, 'manage_dashboard.html', {});

    expect(screen.getByRole('link', { name: /系统设置/ }).getAttribute('href')).to.equal('/manage/setting');
    expect(screen.getByRole('link', { name: /赛时通过率/ }).getAttribute('href')).to.equal('/manage/realpass');
    expect(screen.getByRole('link', { name: /系统状态/ }).getAttribute('href')).to.equal('/manage/status');

    const restartButton = screen.getByRole('button', { name: '重启服务' });
    const form = restartButton.closest('form');
    expect(form).not.to.equal(null);
    expect(fireEvent.submit(form!)).to.equal(false);
    expect(confirm).toHaveBeenCalledWith('确定要重启服务吗？');
  });

  it('summarizes judge health, compiler versions and language commands', () => {
    renderPage(<StatusPage />, 'status.html', {
      ServerVersion: 'Krypton 2.0',
      dbVersion: 'MongoDB 8',
      JudgeCount: 3,
      stats: [
        {
          _id: 'judge-online-1234',
          isOnline: true,
          status: 'Ready',
          memory: { used: 512 * 1024 * 1024, total: 1024 * 1024 * 1024 },
          osinfo: { distro: 'Ubuntu', release: '24.04', arch: 'x64' },
          cpu: { manufacturer: 'AMD', brand: 'EPYC', speed: 3.2 },
          reqCount: 18,
        },
        {
          _id: 'judge-offline-1234',
          isOnline: false,
          updateAt: '2026-07-25T12:00:00.000Z',
          memory: { used: 0, total: 0 },
        },
      ],
      compilers: [{ key: ['cc.cc20', 'cc.cc17'], message: 'g++ 14.1.0' }],
      languages: { 'C++20': 'g++ -std=c++20' },
    });

    expect(screen.getByRole('heading', { name: '系统状态' })).not.to.equal(null);
    expect(screen.getByText('Krypton 2.0')).not.to.equal(null);
    expect(screen.getByText('MongoDB 8')).not.to.equal(null);
    expect(screen.getByText('1/2')).not.to.equal(null);
    expect(screen.getByText('Ready')).not.to.equal(null);
    expect(screen.getByText('离线')).not.to.equal(null);
    expect(screen.getByText('g++ 14.1.0')).not.to.equal(null);
    expect(screen.getByText('g++ -std=c++20')).not.to.equal(null);
  });
});
