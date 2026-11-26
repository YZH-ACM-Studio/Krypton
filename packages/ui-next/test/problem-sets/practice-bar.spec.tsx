// A static import fails collection while src/components/practice-bar.tsx is absent.
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap, type KryptonUrls, type KryptonUser } from '../../src/lib/bootstrap.tsx';
import { ProblemDetailPage } from '../../src/pages/problem-detail.tsx';

const barLoaders = import.meta.glob('../../src/components/practice-bar.tsx');
const BAR_SOURCE = 'src/components/practice-bar.tsx';

const PRACTICE_TITLE = '指针专项练习';
const PRACTICE_HREF = '/problem-sets/64b8000000000000000000b1?chapter=2';
const STAGE_TITLE = '阶段 2 · 进阶';
const POSITION = '第 2 / 3 题';
const PREV_HREF = '/p/1001?practiceContainerKind=problemSet&practiceContainerId=64b8000000000000000000b1&practiceScopeKind=stage&practiceScopeId=2';
const NEXT_HREF = '/p/1003?practiceContainerKind=problemSet&practiceContainerId=64b8000000000000000000b1&practiceScopeKind=stage&practiceScopeId=2';
const DONE_LABEL = '已完成';
const DONE_COUNT = '4 / 12';
const PROBLEM_PATH = '/p/P1002';

interface PracticeBar {
  title: string;
  href: string;
  stageTitle: string;
  index: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
  doneCount: number;
  totalCount: number;
}

interface PracticeBarModule {
  parsePracticeBar: (raw: unknown) => PracticeBar | null;
  PracticeBarStrip: (props: { bar: PracticeBar }) => ReactElement;
}

const URLS: KryptonUrls = {
  home: '/',
  problems: '/p',
  contests: '/contest',
  homework: '/homework',
  training: '/problem-sets',
  ranking: '/ranking',
  discussions: '/discuss',
  domains: '/domains',
  messages: '/messages',
  login: '/login',
  register: '/register',
  logout: '/logout',
  settings: '/settings',
  security: '/security',
  files: '/files',
  records: '/records',
  domainDashboard: '/domain/dashboard',
  domainPermission: '/domain/permission',
  manage: '/manage',
  status: '/status',
  problemDetail: '/p/__PID__',
  contestDetail: '/contest/__TID__',
  homeworkDetail: '/homework/__TID__',
  trainingDetail: '/problem-sets/__TID__',
  discussionDetail: '/discuss/__DID__',
  discussionNode: '/discuss/node/__NID__',
  userDetail: '/user/__UID__',
  recordDetail: '/record/__RID__',
};

function readField(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function isParser(value: unknown): value is PracticeBarModule['parsePracticeBar'] {
  return typeof value === 'function';
}

function isStrip(value: unknown): value is PracticeBarModule['PracticeBarStrip'] {
  return typeof value === 'function';
}

async function loadPracticeBar(): Promise<PracticeBarModule> {
  const load = Object.values(barLoaders).find((item) => typeof item === 'function');
  expect(typeof load, `${BAR_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${BAR_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${BAR_SOURCE} must be a module`);
  const parsePracticeBar = readField(imported, 'parsePracticeBar');
  const PracticeBarStrip = readField(imported, 'PracticeBarStrip');
  expect(typeof parsePracticeBar, 'parsePracticeBar').toBe('function');
  expect(typeof PracticeBarStrip, 'PracticeBarStrip').toBe('function');
  if (!isParser(parsePracticeBar) || !isStrip(PracticeBarStrip)) {
    throw new TypeError('practice bar exports are missing');
  }
  return { parsePracticeBar, PracticeBarStrip };
}

function openBar(overrides: Partial<PracticeBar> = {}): PracticeBar {
  return {
    title: PRACTICE_TITLE,
    href: PRACTICE_HREF,
    stageTitle: STAGE_TITLE,
    index: 2,
    total: 3,
    prevHref: PREV_HREF,
    nextHref: NEXT_HREF,
    doneCount: 4,
    totalCount: 12,
    ...overrides,
  };
}

function expectOpenBar() {
  const back = screen.getByRole('link', { name: PRACTICE_TITLE });
  expect(back).toHaveAttribute('href', PRACTICE_HREF);
  expect(screen.getByText(STAGE_TITLE)).toBeInTheDocument();
  expect(screen.getByText(POSITION)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '上一题' })).toHaveAttribute('href', PREV_HREF);
  expect(screen.getByRole('link', { name: '下一题' })).toHaveAttribute('href', NEXT_HREF);
  expect(screen.getByText(DONE_LABEL)).toBeInTheDocument();
  expect(screen.getByText(DONE_COUNT)).toBeInTheDocument();
}

function expectBarAbsent() {
  expect(screen.queryByRole('link', { name: PRACTICE_TITLE })).toBeNull();
  expect(screen.queryByText(STAGE_TITLE)).toBeNull();
  expect(screen.queryByText(POSITION)).toBeNull();
  expect(screen.queryByRole('link', { name: '上一题' })).toBeNull();
  expect(screen.queryByRole('button', { name: '上一题' })).toBeNull();
  expect(screen.queryByRole('link', { name: '下一题' })).toBeNull();
  expect(screen.queryByRole('button', { name: '下一题' })).toBeNull();
  expect(screen.queryByText(DONE_LABEL)).toBeNull();
}

function user(): KryptonUser {
  return {
    id: 7,
    name: 'student',
    mail: '',
    signedIn: false,
    theme: 'light',
    viewLang: 'zh_CN',
    unreadMessages: 0,
    rp: 0,
    bio: '',
    priv: 0,
    role: 'default',
    tfa: false,
    authn: false,
    pinnedDomains: [],
    canBrowseProblemBank: false,
  };
}

function pageBootstrap(practiceBar?: PracticeBar): KryptonBootstrap {
  const data: Record<string, unknown> = {
    mode: 'normal',
    pdoc: {
      docId: 1002,
      pid: 'P1002',
      title: 'A+B Problem',
      content: '计算 A 与 B 的和。',
    },
  };
  if (practiceBar) data.practiceBar = practiceBar;
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-18T06:00:00.000Z',
    user: user(),
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: URLS,
    udict: {},
    page: { templateName: 'problem_detail.html', data },
  };
}

function renderProblemPage(practiceBar?: PracticeBar) {
  window.history.replaceState(null, '', PROBLEM_PATH);
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(practiceBar)}>
      <ProblemDetailPage />
    </BootstrapProvider>,
  );
}

describe('practice bar on the problem page', () => {
  it('renders the return link, stage name, position, and both navigation links', async () => {
    const { PracticeBarStrip } = await loadPracticeBar();
    render(<PracticeBarStrip bar={openBar()} />);

    expectOpenBar();
  });

  it('disables the previous control when there is no previous problem', async () => {
    const { PracticeBarStrip } = await loadPracticeBar();
    render(<PracticeBarStrip bar={openBar({ prevHref: null })} />);

    expect(screen.getByRole('link', { name: PRACTICE_TITLE })).toHaveAttribute('href', PRACTICE_HREF);
    expect(screen.getByText(POSITION)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: '上一题' })).toBeNull();
    expect(screen.getByRole('link', { name: '下一题' })).toHaveAttribute('href', NEXT_HREF);
  });

  it('disables the next control when there is no next problem', async () => {
    const { PracticeBarStrip } = await loadPracticeBar();
    render(<PracticeBarStrip bar={openBar({ nextHref: null })} />);

    expect(screen.getByRole('link', { name: '上一题' })).toHaveAttribute('href', PREV_HREF);
    expect(screen.getByRole('button', { name: '下一题' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: '下一题' })).toBeNull();
  });

  it('returns null when the payload is missing and throws on a bad shape', async () => {
    const { parsePracticeBar } = await loadPracticeBar();
    const sample = openBar();

    expect(parsePracticeBar(undefined)).toBeNull();
    expect(parsePracticeBar(sample)).toEqual(sample);

    const badShapes: unknown[] = [
      'bad',
      [],
      {},
      { ...sample, index: '2' },
      { ...sample, prevHref: 1 },
      { ...sample, title: 1 },
    ];
    for (const raw of badShapes) {
      expect(() => parsePracticeBar(raw)).toThrow(TypeError);
    }
  });

  it('renders the problem page when the stage title is empty', async () => {
    const { parsePracticeBar } = await loadPracticeBar();
    const blank = openBar({ stageTitle: '' });

    expect(parsePracticeBar(blank)).toEqual(blank);
    renderProblemPage(blank);
    expect(screen.getByRole('link', { name: PRACTICE_TITLE })).toHaveAttribute('href', PRACTICE_HREF);
    expect(screen.getByText(POSITION)).toBeInTheDocument();
  });

  it('shows the bar on the problem page when practiceBar is present', () => {
    renderProblemPage(openBar());

    expect(screen.getByRole('heading', { name: 'A+B Problem' })).toBeInTheDocument();
    expectOpenBar();
  });

  it('leaves the problem page without a bar when practiceBar is absent', () => {
    renderProblemPage();

    expect(screen.getByRole('heading', { name: 'A+B Problem' })).toBeInTheDocument();
    expectBarAbsent();
  });
});
