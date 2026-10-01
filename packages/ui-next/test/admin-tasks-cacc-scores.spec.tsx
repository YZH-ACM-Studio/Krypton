import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { AdminTasksScoresPage } from '../src/pages/admin-tasks/index.tsx';

const UID = 7;

interface ScoreRow {
  _id: string;
  studentDocId: string;
  year: number;
  stage: 'regional' | 'final';
  award: 'first' | 'second' | 'third' | 'participant';
  createdAt: string;
}

const SCORES: ScoreRow[] = [
  { _id: 's1', studentDocId: 'd1', year: 2026, stage: 'regional', award: 'second', createdAt: '2026-05-01T00:00:00.000Z' },
  { _id: 's2', studentDocId: 'd2', year: 2025, stage: 'final', award: 'participant', createdAt: '2025-06-01T00:00:00.000Z' },
];

function pageData(overrides: { scores?: ScoreRow[]; year?: number; level?: string } = {}): unknown {
  return {
    tab: 'cacc',
    scores: overrides.scores ?? SCORES,
    stayEvents: [],
    schools: [],
    udict: {},
    studentDict: {
      d1: { studentId: '20240001', realName: '张三', schoolId: 'sch', boundUserId: null },
      d2: { studentId: '20240002', realName: '李四', schoolId: 'sch', boundUserId: null },
    },
    settings: { maxPatScore: 100, maxGpltScore: 290, maxCspScore: 500 },
    level: overrides.level ?? '',
    year: overrides.year ?? 0,
  };
}

function pageBootstrap(data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-01T00:00:00.000Z',
    user: {
      id: UID,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'teacher',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'admin_tasks_scores.html', data },
  };
}

function renderScores(data: unknown) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(data)}>
      <AdminTasksScoresPage />
    </BootstrapProvider>,
  );
}

function tabLabels(): string[] {
  return screen.getAllByRole('tab').map((tab) => (tab.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function fieldValue(root: ParentNode, name: string): string {
  const input = root.querySelector(`input[name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input ${name}`);
  return input.value;
}

function formsWithOperation(operation: string): HTMLFormElement[] {
  return [...document.querySelectorAll('form')].filter((node): node is HTMLFormElement => {
    return node instanceof HTMLFormElement && node.querySelector('input[name="operation"]') instanceof HTMLInputElement && fieldValue(node, 'operation') === operation;
  });
}

function rowByStudentId(studentId: string): HTMLTableRowElement {
  const row = screen.getByText(studentId).closest('tr');
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`missing row for ${studentId}`);
  return row;
}

describe('admin tasks CACC scores', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  function mockLocationAssign(): ReturnType<typeof vi.fn> {
    const assign = vi.fn();
    // jsdom's Location.assign is not configurable, so spyOn cannot replace it.
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    return assign;
  }

  it('places the CACC tab after CSP 认证 and before 留校次数', () => {
    renderScores(pageData());
    const labels = tabLabels();
    const csp = labels.indexOf('CSP 认证');
    const cacc = labels.indexOf('CACC');
    const stay = labels.indexOf('留校次数');
    expect(csp).toBeGreaterThanOrEqual(0);
    expect(cacc).toBe(csp + 1);
    expect(stay).toBe(cacc + 1);
    expect(screen.getByRole('tab', { name: 'CACC' })).toHaveAttribute('href', '/admin/tasks/scores?tab=cacc');
    expect(screen.getByText('录入 PAT / GPLT / CSP / CACC 等外部比赛成绩；这些成绩会被任务点用作完成判定的输入。')).toBeInTheDocument();
  });

  it('shows each CACC row student id, stage, and award', () => {
    renderScores(pageData());
    const regional = rowByStudentId('20240001');
    expect(regional).toHaveTextContent('区域赛');
    expect(regional).toHaveTextContent('二等奖');
    expect(regional).not.toHaveTextContent('三等奖');
    const final = rowByStudentId('20240002');
    expect(final).toHaveTextContent('决赛');
    expect(final).toHaveTextContent('参赛');
    expect(screen.getByText('批量导入只升不降：库里已有更高等级的行会跳过并列在结果里；要改成更低等级，请用下方单条录入。')).toBeInTheDocument();
    expect(screen.getByText('学号,年份,区域赛|决赛,一等奖|二等奖|三等奖|参赛', { exact: false })).toBeInTheDocument();
  });

  it('renders the single-entry form with operation cacc and named fields', () => {
    renderScores(pageData());
    const forms = formsWithOperation('cacc');
    expect(forms).toHaveLength(1);
    const form = forms[0];
    if (!form) throw new Error('missing cacc entry form');
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/admin/tasks/scores?tab=cacc');
    expect(fieldValue(form, 'operation')).toBe('cacc');
    expect(form.querySelector('input[name="studentId"]')).toBeInstanceOf(HTMLInputElement);
    expect(form.querySelector('input[name="year"]')).toBeInstanceOf(HTMLInputElement);
    expect(fieldValue(form, 'stage')).toBe('regional');
    expect(fieldValue(form, 'award')).toBe('third');
    expect(screen.getByText('单条录入会直接覆盖该学生同年同级别的已有等级。')).toBeInTheDocument();
  });

  it('renders a cacc_delete form with the row id', () => {
    renderScores(pageData());
    for (const [studentId, id] of [
      ['20240001', 's1'],
      ['20240002', 's2'],
    ] as const) {
      const row = rowByStudentId(studentId);
      const form = row.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error(`missing delete form for ${studentId}`);
      expect(form.getAttribute('action')).toBe('/admin/tasks/scores?tab=cacc');
      expect(fieldValue(form, 'operation')).toBe('cacc_delete');
      expect(fieldValue(form, 'id')).toBe(id);
    }
    expect(formsWithOperation('cacc_delete')).toHaveLength(2);
  });

  it('shows 还没有 CACC 成绩 when there are no scores', () => {
    renderScores(pageData({ scores: [] }));
    expect(screen.getByText('还没有 CACC 成绩')).toBeInTheDocument();
    expect(screen.queryByText('20240001')).not.toBeInTheDocument();
    expect(formsWithOperation('cacc_delete')).toHaveLength(0);
  });

  it('assigns the filtered scores url from the initial year and stage', async () => {
    const assign = mockLocationAssign();
    const user = userEvent.setup();
    renderScores(pageData({ year: 2026, level: 'final' }));
    await user.click(screen.getByRole('button', { name: '筛选' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/admin/tasks/scores?tab=cacc&year=2026&level=final');
  });

  it('assigns only the cacc tab when year and stage are empty', async () => {
    const assign = mockLocationAssign();
    const user = userEvent.setup();
    renderScores(pageData({ year: 0, level: '' }));
    await user.click(screen.getByRole('button', { name: '筛选' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/admin/tasks/scores?tab=cacc');
  });
});
