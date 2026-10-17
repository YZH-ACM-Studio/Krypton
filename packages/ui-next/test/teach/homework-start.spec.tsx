import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { HomeworkDetailPage } from '../../src/pages/homework.tsx';

const NOW = Date.parse('2026-10-16T08:00:00.000Z');
const SERVER = Date.parse('2026-10-16T07:00:00.000Z');
const PROBLEM_TITLE = '两数之和';
const START_HEADING = '这份作业有个人限时';
const TONES = ['text-fg', 'text-warning-fg', 'text-danger-fg'] as const;

type CountdownTone = (typeof TONES)[number];

interface HomeworkStartFixture {
  required: boolean;
  durationMinutes: number | null;
  startAt: string | null;
  personalEndAt: string | null;
}

interface HomeworkDetailData {
  tdoc: {
    docId: number;
    title: string;
    penaltySince: string;
    endAt: string;
    content: string;
    pids: number[];
  };
  pids?: number[];
  pdict?: Record<string, { title: string; nAccept: number; nSubmit: number }>;
  homeworkStart?: HomeworkStartFixture;
}

function startCopy(minutes: number): string {
  return `个人限时 ${minutes} 分钟。点「开始作答」后开始计时，到时自动截止；开始前看不到题目。`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function remainingLabel(offsetMs: number): string {
  const totalSeconds = Math.floor(offsetMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `剩余 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function detail(homeworkStart?: HomeworkStartFixture): HomeworkDetailData {
  const data: HomeworkDetailData = {
    tdoc: {
      docId: 42,
      title: '第一次作业',
      penaltySince: '2099-01-01T00:00:00.000Z',
      endAt: '2099-01-02T00:00:00.000Z',
      content: '请独立完成。',
      pids: [1001],
    },
    pids: [1001],
    pdict: {
      1001: { title: PROBLEM_TITLE, nAccept: 3, nSubmit: 8 },
    },
  };
  if (homeworkStart) data.homeworkStart = homeworkStart;
  return data;
}

/** personalEndAt is the deadline. startAt + duration would leave a different remainder. */
function started(offsetMs: number, clock = NOW): HomeworkStartFixture {
  return {
    required: false,
    durationMinutes: 90,
    startAt: new Date(clock - 10 * 60_000).toISOString(),
    personalEndAt: new Date(clock + offsetMs).toISOString(),
  };
}

function makeBootstrap(data: HomeworkDetailData, generatedAt = new Date(NOW).toISOString()): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt,
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      homework: '/homework',
      homeworkDetail: '/homework/__TID__',
      problemDetail: '/p/__PID__',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'homework_detail.html', data },
  };
}

function renderPage(data: HomeworkDetailData, generatedAt?: string) {
  return render(
    <BootstrapProvider bootstrap={makeBootstrap(data, generatedAt)}>
      <HomeworkDetailPage />
    </BootstrapProvider>,
  );
}

function classTokens(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter((token) => token.length > 0);
}

function compactText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, '');
}

function countdownNode(label: string): HTMLElement {
  const compact = label.replace(/\s+/g, '');
  const matches = screen.getAllByText((_, element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (!compactText(element).includes(compact)) return false;
    const tokens = classTokens(element);
    return tokens.includes('font-mono') && tokens.includes('tabular');
  });
  return matches.slice().sort((left, right) => compactText(left).length - compactText(right).length)[0];
}

function expectTone(element: HTMLElement, tone: CountdownTone) {
  const tokens = classTokens(element);
  expect(tokens).toContain('font-mono');
  expect(tokens).toContain('tabular');
  expect(tokens).toContain(tone);
  for (const other of TONES) {
    if (other !== tone) expect(tokens).not.toContain(other);
  }
}

function expectProblemList() {
  expect(screen.getByRole('heading', { name: '题目列表' })).toBeInTheDocument();
  expect(screen.getAllByText(PROBLEM_TITLE).length).toBeGreaterThan(0);
  expect(screen.getAllByText('3/8').length).toBeGreaterThan(0);
  const link = screen.getByRole('link', { name: new RegExp(PROBLEM_TITLE) });
  expect(link.getAttribute('href')).toBe('/p/1001?tid=42');
}

function expectNoProblemList() {
  expect(screen.queryByRole('heading', { name: '题目列表' })).toBeNull();
  expect(screen.queryAllByText(PROBLEM_TITLE)).toHaveLength(0);
  expect(screen.queryAllByText('3/8')).toHaveLength(0);
  expect(screen.queryByRole('link', { name: new RegExp(PROBLEM_TITLE) })).toBeNull();
}

function expectNoStart() {
  expect(screen.queryByRole('button', { name: '开始作答' })).toBeNull();
  expect(screen.queryByRole('heading', { name: START_HEADING })).toBeNull();
}

function expectNoCountdown() {
  expect(screen.queryByText(/剩余/)).toBeNull();
  expect(screen.queryByText('已到时间')).toBeNull();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('homework start for students', () => {
  it('shows a start form in place of the problem list when a personal limit is required', () => {
    renderPage(detail({
      required: true,
      durationMinutes: 40,
      startAt: null,
      personalEndAt: null,
    }));

    const button = screen.getByRole('button', { name: '开始作答' });
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.getAttribute('data-variant')).toBe('primary');
    const form = button.closest('form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post');
    expect(button.closest('footer')).not.toBeNull();
    const panel = screen.getByRole('heading', { name: START_HEADING }).closest('[data-slot="panel"]');
    expect(panel?.contains(button)).toBe(true);
    const operation = form?.querySelector('input[name="operation"]');
    if (!(operation instanceof HTMLInputElement)) {
      throw new TypeError('start form is missing a hidden operation input');
    }
    expect(operation.type).toBe('hidden');
    expect(operation.value).toBe('start');
    expect(screen.getByText(startCopy(40))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '第一次作业' })).toBeInTheDocument();
    expect(screen.getByText('请独立完成。')).toBeInTheDocument();
    expectNoProblemList();
    expect(screen.queryByText(/剩余/)).toBeNull();
  });

  it('colors the countdown as a warning when four minutes remain', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    renderPage(detail(started(4 * 60_000)));

    expectTone(countdownNode(remainingLabel(4 * 60_000)), 'text-warning-fg');
    expectProblemList();
    expectNoStart();
  });

  it('colors four server minutes as a warning when the classroom clock is ten minutes fast', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER + 10 * 60_000);
    renderPage(detail(started(4 * 60_000, SERVER)), new Date(SERVER).toISOString());

    expect(screen.queryByText('已到时间')).toBeNull();
    expectTone(countdownNode(remainingLabel(4 * 60_000)), 'text-warning-fg');
    expectProblemList();
    expectNoStart();
  });

  it('keeps the existing problem list when older pages omit homeworkStart', () => {
    const omitted = renderPage(detail());
    expect(screen.getByRole('heading', { name: '第一次作业' })).toBeInTheDocument();
    expect(screen.getByText('请独立完成。')).toBeInTheDocument();
    expectProblemList();
    expectNoStart();
    expectNoCountdown();
    omitted.unmount();

    renderPage(detail({
      required: false,
      durationMinutes: null,
      startAt: null,
      personalEndAt: null,
    }));
    expectProblemList();
    expectNoStart();
    expectNoCountdown();
  });

  it('renders tdoc problem ids when older pages omit homeworkStart and the problem dictionary', () => {
    renderPage({
      tdoc: {
        docId: 42,
        title: '第一次作业',
        penaltySince: '2099-01-01T00:00:00.000Z',
        endAt: '2099-01-02T00:00:00.000Z',
        content: '请独立完成。',
        pids: [1001],
      },
    });

    expect(screen.queryByText('暂无题目')).toBeNull();
    expect(screen.getByRole('heading', { name: '题目列表' })).toBeInTheDocument();
    expect(screen.getAllByText('Problem 1001').length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: /Problem 1001/ });
    expect(link.getAttribute('href')).toBe('/p/1001?tid=42');
    expectNoStart();
    expectNoCountdown();
  });

  it('colors remaining time above five minutes, at five minutes, and at one minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const cases: Array<{ offsetMs: number; tone: CountdownTone }> = [
      { offsetMs: 5 * 60_000 + 1000, tone: 'text-fg' },
      { offsetMs: 5 * 60_000, tone: 'text-warning-fg' },
      { offsetMs: 61_000, tone: 'text-warning-fg' },
      { offsetMs: 60_000, tone: 'text-danger-fg' },
    ];
    for (const sample of cases) {
      const view = renderPage(detail(started(sample.offsetMs)));
      expectTone(countdownNode(remainingLabel(sample.offsetMs)), sample.tone);
      expectProblemList();
      view.unmount();
    }
  });

  it('ticks the countdown every second and shows 已到时间 at zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const running = renderPage(detail(started(4 * 60_000)));
    expect(countdownNode(remainingLabel(4 * 60_000))).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(countdownNode(remainingLabel(4 * 60_000 - 1000))).toBeInTheDocument();
    expect(countdownNode(remainingLabel(4 * 60_000 - 1000))).toHaveClass('text-warning-fg');
    running.unmount();

    vi.setSystemTime(NOW);
    renderPage(detail(started(0)));
    expect(screen.getByText('已到时间')).toBeInTheDocument();
    expect(screen.queryByText(/剩余/)).toBeNull();
    expect(screen.queryByText('00:00:00')).toBeNull();
    expectProblemList();
    expectNoStart();
  });
});
