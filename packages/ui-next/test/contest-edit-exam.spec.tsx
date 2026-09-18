import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { ContestEditExam } from '../src/pages/contest-edit-exam.tsx';
import { ContestEditPage } from '../src/pages/contest-manage.tsx';

const CONTEST_ID = '66bf00000000000000000101';

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ events: [], schools: [], pdocs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
}

function pageBootstrap(pageName: 'contest_create' | 'contest_edit', tdoc: Record<string, unknown>): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-15T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      contests: '/contest',
      contestDetail: '/contest/:TID',
      problemDetail: '/p/:PID',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'contest_edit.html',
      data: {
        page_name: pageName,
        tdoc,
        rules: { acm: 'ACM', exam: '考试' },
        duration: 2,
        pids: Array.isArray(tdoc.pids) ? (tdoc.pids as number[]).join(',') : '',
        pdict: { 11: { title: '单选', problemKind: 'single' } },
        beginAt: typeof tdoc.beginAt === 'string' ? tdoc.beginAt : '',
        scopeSchools: [],
        scopeGroups: [],
        teamBatches: [],
      },
    },
  };
}

function namedInput(name: string): HTMLInputElement | null {
  return document.querySelector(`input[name="${name}"]`);
}

function hiddenInput(name: string): HTMLInputElement | null {
  return document.querySelector(`input[type="hidden"][name="${name}"]`);
}

function primaryUpdateSubmit(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll('button[type="submit"][name="operation"][value="update"]')).find(
      (button) => !button.hasAttribute('formaction'),
    ) as HTMLButtonElement | undefined ?? null
  );
}

function renderEdit(pageName: 'contest_create' | 'contest_edit', tdoc: Record<string, unknown>, search = '/contest/create') {
  stubFetch();
  window.history.replaceState(null, '', search);
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(pageName, tdoc)}>
      <ContestEditPage />
    </BootstrapProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('contest edit exam render', () => {
  it('keeps contest_create empty tdoc on the ACM tree with ACM rated default', () => {
    renderEdit('contest_create', {});
    expect(screen.getByRole('heading', { name: '创建比赛' })).to.exist;
    expect(screen.queryByRole('heading', { name: '创建考试' })).to.equal(null);
    expect(screen.getByText('参赛身份')).to.exist;
    expect(namedInput('examPaperQuotas')).to.equal(null);
    const rated = namedInput('rated');
    expect(rated).to.exist;
    expect(rated?.type).to.equal('checkbox');
    expect(rated?.checked).to.equal(true);
    expect(hiddenInput('rated')).to.equal(null);
  });

  it('renders contest_create ?rule=exam as 创建考试 with hidden exam defaults', () => {
    renderEdit('contest_create', {}, '/contest/create?rule=exam');
    expect(screen.getByRole('heading', { name: '创建考试' })).to.exist;
    expect(screen.queryByRole('heading', { name: '创建比赛' })).to.equal(null);
    expect(hiddenInput('rated')?.value).to.equal('false');
    expect(hiddenInput('autoHide')?.value).to.equal('false');
    expect(hiddenInput('allowViewCode')?.value).to.equal('false');
    expect(hiddenInput('vigilEnabled')?.value).to.equal('false');
    expect(hiddenInput('participationMode')?.value).to.equal('individual');
    expect(hiddenInput('hidden')?.value).to.equal('false');
    expect(screen.getByText('不在列表中显示')).to.exist;
    expect(screen.getByRole('tab', { name: '这场考试' })).to.exist;
    expect(screen.getByRole('tab', { name: /试卷/ })).to.exist;
    expect(screen.getByRole('tab', { name: '谁能考' })).to.exist;
    expect(screen.getByRole('tab', { name: '考生说明' })).to.exist;
    expect(screen.queryByRole('tab', { name: '反作弊' })).to.equal(null);
    const wallClock = screen.getByLabelText('整场关门（小时）') as HTMLInputElement;
    expect(wallClock.name).to.equal('duration');
    expect(wallClock.value).to.equal('2');
    const personalClock = screen.getByLabelText('开考后个人时长（小时）') as HTMLInputElement;
    expect(personalClock.name).to.equal('contestDuration');
    expect(personalClock.value).to.equal('');
    expect(screen.queryByText('计入 Rating')).to.equal(null);
    expect(screen.queryByText('允许赛后虚拟参赛')).to.equal(null);
    expect(screen.queryByLabelText('封榜时间 (剩余分钟)')).to.equal(null);
    expect(screen.queryByText('参赛身份')).to.equal(null);
    expect(screen.queryByText('1–3 人团队 ACM')).to.equal(null);
    expect(screen.queryByText('客户端与反作弊')).to.equal(null);
    expect(screen.queryByText('启用 Vigil 反作弊')).to.equal(null);
    expect(screen.queryByText('重新同步到 Vigil')).to.equal(null);
    expect(screen.queryByText('机房座位与赛前预启动')).to.equal(null);
    expect(screen.queryByText('删除考试')).to.equal(null);
    expect(screen.queryByText('复制为新考试')).to.equal(null);
    expect(namedInput('courseExam')).to.equal(null);
    expect(namedInput('examEvent')).to.equal(null);
    expect(document.querySelector('[name="courseExam"]')).to.equal(null);
    expect(document.querySelector('[name="examEvent"]')).to.equal(null);
    expect(namedInput('liveEnabled')).to.equal(null);
    expect(namedInput('cameraEnabled')).to.equal(null);
  });

  it('renders contest_edit exam as 编辑考试 and persists hidden rated', () => {
    renderEdit(
      'contest_edit',
      {
        title: '2026 期末',
        beginAt: '2026-08-20T01:00:00.000Z',
        endAt: '2026-08-20T04:00:00.000Z',
        _id: CONTEST_ID,
        docId: CONTEST_ID,
        rule: 'exam',
        owner: 2,
        pids: [11],
        files: [],
        rated: true,
        examPaperQuotas: { single: 1 },
        hidden: true,
      },
      `/contest/${CONTEST_ID}/edit`,
    );
    expect(screen.getByRole('heading', { name: '编辑考试' })).to.exist;
    expect(screen.queryByRole('heading', { name: '编辑比赛' })).to.equal(null);
    expect(screen.getByText('题池')).to.exist;
    expect(screen.getByText('撤销')).to.exist;
    expect(screen.getByText('按题型抽题')).to.exist;
    expect(namedInput('examPaperQuotas')?.value).to.equal(JSON.stringify({ single: 1 }));
    expect(hiddenInput('rated')?.value).to.equal('true');
    expect(hiddenInput('hidden')?.value).to.equal('true');
    expect(screen.getByText('不在列表中显示')).to.exist;
    expect(screen.getByRole('tab', { name: '反作弊' })).to.exist;
    expect(screen.getByText('客户端与反作弊')).to.exist;
    expect(screen.getByText('启用 Vigil 反作弊')).to.exist;
    expect(screen.getByText('复制为新考试')).to.exist;
    expect(screen.getByText('删除考试')).to.exist;
    expect(namedInput('courseExam')).to.equal(null);
    expect(namedInput('examEvent')).to.equal(null);
    expect(namedInput('liveEnabled')).to.equal(null);
    expect(namedInput('cameraEnabled')).to.equal(null);
  });

  it('posts stored liveEnabled and cameraEnabled on edit so handler defaults cannot flip them', () => {
    renderEdit(
      'contest_edit',
      {
        title: '2026 期末',
        beginAt: '2026-08-20T01:00:00.000Z',
        endAt: '2026-08-20T04:00:00.000Z',
        _id: CONTEST_ID,
        docId: CONTEST_ID,
        rule: 'exam',
        owner: 2,
        pids: [11],
        files: [],
        vigilEnabled: true,
        liveEnabled: false,
        cameraEnabled: false,
      },
      `/contest/${CONTEST_ID}/edit`,
    );
    expect(hiddenInput('liveEnabled')?.value).to.equal('false');
    expect(hiddenInput('cameraEnabled')?.value).to.equal('false');
  });

  it('refuses seat children on contest_create and keeps them on contest_edit', () => {
    stubFetch();
    window.history.replaceState(null, '', '/contest/create?rule=exam');
    const { unmount } = render(
      <BootstrapProvider bootstrap={pageBootstrap('contest_create', {})}>
        <ContestEditExam rule="exam" onRuleChange={() => undefined}>
          <div>机房座位与赛前预启动</div>
        </ContestEditExam>
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '创建考试' })).to.exist;
    expect(screen.queryByText('机房座位与赛前预启动')).to.equal(null);
    unmount();

    window.history.replaceState(null, '', `/contest/${CONTEST_ID}/edit`);
    render(
      <BootstrapProvider
        bootstrap={pageBootstrap('contest_edit', {
          title: '2026 期末',
          _id: CONTEST_ID,
          docId: CONTEST_ID,
          rule: 'exam',
        })}
      >
        <ContestEditExam rule="exam" onRuleChange={() => undefined}>
          <div>机房座位与赛前预启动</div>
        </ContestEditExam>
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '编辑考试' })).to.exist;
    expect(screen.getByText('机房座位与赛前预启动')).to.exist;
  });

  it('uses operation=update on the primary submit without formaction', () => {
    renderEdit('contest_create', {}, '/contest/create?rule=exam');
    const primary = primaryUpdateSubmit();
    expect(primary).to.exist;
    expect(primary?.getAttribute('name')).to.equal('operation');
    expect(primary?.getAttribute('value')).to.equal('update');
    expect(primary?.hasAttribute('formaction')).to.equal(false);
    expect(primary?.getAttribute('formAction') ?? '').to.equal('');
  });
});
