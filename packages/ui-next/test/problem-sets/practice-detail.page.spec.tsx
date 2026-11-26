import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { replaceRouteTokens } from '../../src/lib/format.ts';
import { practiceProblemEntryUrl } from '../../src/lib/practice-integrity.ts';
import { TrainingDetailPage } from '../../src/pages/training.tsx';

const TID = '64b8000000000000000000b1';
const PROBLEM_URL = '/p/__PID__';
const STAGE_BASIC = 1;
const STAGE_NEXT = 2;
const STAGE_LOCKED = 3;
const BASIC_TITLE = '阶段 1 · 基础';
const NEXT_TITLE = '阶段 2 · 进阶';
const LOCKED_TITLE = '阶段 3 · 综合';
const LOCK_COPY = `完成「${BASIC_TITLE}」后解锁`;
const NEXT_LOCK_COPY = `完成「${NEXT_TITLE}」后解锁`;
const HIDDEN_PID = 999;
const BASIC_PID = 101;
const NEXT_PID = 102;
const LOCKED_PID = 103;
const BASIC_LABEL = 'P1001';
const BASIC_PROBLEM = '两数之和';
const NEXT_PROBLEM = '链表反转';
const LOCKED_PROBLEM = '综合应用';
const SEARCH_PLACEHOLDER = '在这个练习里搜题号或标题';
const EMPTY_SEARCH = '没有匹配的题目';
const START_LABEL = '开始练习';
const CONTINUE_LABEL = '继续练习';
const NO_STAGE = '还没有可以进入的阶段';

interface StageNode {
  _id: number;
  title: string;
  requireNids: number[];
  pids: number[];
}

interface StageStatusFixture {
  isOpen?: boolean;
  isDone?: boolean;
  hasAccess?: boolean;
  lockReason?: 'prereq' | 'no_access';
  donePids: number[];
}

interface DetailFixture {
  lockedRequireNids?: number[];
  completedProblemCount?: number;
  nsdict?: Record<number, StageStatusFixture>;
  psdict?: Record<string, { status?: number; score?: number }>;
  integrityControlled?: boolean;
  canManage?: boolean;
  files?: Array<{ name: string }>;
}

function stageNode(id: number, title: string, requireNids: number[], pids: number[]): StageNode {
  return { _id: id, title, requireNids, pids };
}

function stageEntryUrl(pid: number, stageId: number): string {
  return practiceProblemEntryUrl(replaceRouteTokens(PROBLEM_URL, { PID: String(pid) }), {
    containerKind: 'problemSet',
    containerId: TID,
    scopeKind: 'stage',
    scopeId: stageId,
  });
}

function bootstrap(fixture: DetailFixture = {}): KryptonBootstrap {
  const basic = stageNode(STAGE_BASIC, BASIC_TITLE, [], [HIDDEN_PID, BASIC_PID]);
  const next = stageNode(STAGE_NEXT, NEXT_TITLE, [], [NEXT_PID]);
  const locked = stageNode(STAGE_LOCKED, LOCKED_TITLE, fixture.lockedRequireNids ?? [STAGE_BASIC], [LOCKED_PID]);
  const nsdict: Record<number, StageStatusFixture> = fixture.nsdict ?? {
    [STAGE_BASIC]: { isOpen: true, hasAccess: true, donePids: [] },
    [STAGE_NEXT]: { isOpen: true, hasAccess: true, donePids: [] },
    [STAGE_LOCKED]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
  };
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-18T00:00:00.000Z',
    user: {
      id: 7,
      name: 'student',
      mail: '',
      signedIn: true,
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
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      training: '/problem-sets',
      trainingDetail: '/problem-sets/__TID__',
      problemDetail: PROBLEM_URL,
    } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'problem_set_detail.html',
      data: {
        tdoc: {
          docId: TID,
          title: '指针专项练习',
          dag: [basic, next, locked],
          ...(fixture.files ? { files: fixture.files } : {}),
        },
        ndict: { [STAGE_BASIC]: basic, [STAGE_NEXT]: next, [STAGE_LOCKED]: locked },
        nsdict,
        pdict: {
          [BASIC_PID]: { docId: BASIC_PID, pid: BASIC_LABEL, title: BASIC_PROBLEM },
          [NEXT_PID]: { docId: NEXT_PID, pid: 'P1002', title: NEXT_PROBLEM },
          [LOCKED_PID]: { docId: LOCKED_PID, pid: 'P1003', title: LOCKED_PROBLEM },
        },
        psdict: fixture.psdict ?? {},
        tsdoc: {},
        access: { enrolled: false, sources: [{ kind: 'public' }] },
        completedProblemCount: fixture.completedProblemCount ?? 0,
        totalProblemCount: 3,
        integrityControlled: fixture.integrityControlled === true,
        canManage: fixture.canManage === true,
        canViewRoster: false,
        udoc: { uname: '竞赛组' },
      },
    },
  };
}

function renderDetail(fixture?: DetailFixture): void {
  render(
    <BootstrapProvider bootstrap={bootstrap(fixture)}>
      <TrainingDetailPage />
    </BootstrapProvider>,
  );
}

function exactLabel(element: HTMLElement, text: string): boolean {
  for (const node of element.querySelectorAll('*')) {
    if (node.children.length > 0) continue;
    if ((node.textContent ?? '').trim() === text) return true;
  }
  return false;
}

function stageTrigger(title: string): HTMLElement {
  const found = screen.getAllByRole('button').filter((button) => exactLabel(button, title));
  expect(found, title).toHaveLength(1);
  const button = found[0];
  if (!button) throw new TypeError(`missing stage ${title}`);
  return button;
}

function expectExpanded(title: string, expanded: boolean): void {
  expect(stageTrigger(title)).toHaveAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function expectStagesReplaced(): void {
  const buttons = screen.queryAllByRole('button');
  expect(buttons.filter((button) => exactLabel(button, BASIC_TITLE))).toHaveLength(0);
  expect(buttons.filter((button) => exactLabel(button, NEXT_TITLE))).toHaveLength(0);
  expect(buttons.filter((button) => exactLabel(button, LOCKED_TITLE))).toHaveLength(0);
}

function primaryAction(): HTMLElement {
  const actions = [...document.querySelectorAll('[data-variant="primary"]')].filter((node): node is HTMLElement => node instanceof HTMLElement);
  expect(actions).toHaveLength(1);
  const action = actions[0];
  if (!action) throw new TypeError('primary action is missing');
  return action;
}

describe('practice detail page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/problem-sets/${TID}`);
  });

  it('leaves a locked stage collapsed and names the unfinished prerequisite', async () => {
    renderDetail();

    expect(screen.getByText(LOCK_COPY)).toBeTruthy();
    const locked = stageTrigger(LOCKED_TITLE);
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(LOCKED_PROBLEM)).toBeNull();

    await userEvent.click(locked);

    expect(stageTrigger(LOCKED_TITLE)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(LOCKED_PROBLEM)).toBeNull();
    expect(screen.getByText(BASIC_PROBLEM)).toBeTruthy();
  });

  it('names the first unfinished prerequisite when its only problem is already done', () => {
    const sharedDone = [NEXT_PID];
    renderDetail({
      lockedRequireNids: [STAGE_NEXT],
      nsdict: {
        [STAGE_BASIC]: { isOpen: true, hasAccess: true, donePids: sharedDone },
        [STAGE_NEXT]: { isOpen: true, hasAccess: true, isDone: false, donePids: sharedDone },
        [STAGE_LOCKED]: { hasAccess: true, lockReason: 'prereq', donePids: sharedDone },
      },
    });

    expect(stageTrigger(LOCKED_TITLE)).toHaveTextContent(NEXT_LOCK_COPY);
  });

  it('expands the first unfinished enterable stage by default', () => {
    renderDetail();

    expectExpanded(BASIC_TITLE, true);
    expectExpanded(NEXT_TITLE, false);
    expectExpanded(LOCKED_TITLE, false);
    const table = screen.getByRole('table');
    const hrefs = [...table.querySelectorAll('a')].map((node) => node.getAttribute('href'));
    expect(hrefs).toContain(stageEntryUrl(BASIC_PID, STAGE_BASIC));
    expect(screen.getByText(BASIC_PROBLEM)).toBeTruthy();
    expect(screen.getByText('还没开始')).toBeTruthy();
    expect(screen.queryByText(NEXT_PROBLEM)).toBeNull();
    expect(screen.queryByText(LOCKED_PROBLEM)).toBeNull();
  });

  it('expands the stage named by the chapter query', () => {
    window.history.replaceState(null, '', `/problem-sets/${TID}?chapter=${STAGE_NEXT}`);
    renderDetail();

    expectExpanded(NEXT_TITLE, true);
    expectExpanded(BASIC_TITLE, false);
    expectExpanded(LOCKED_TITLE, false);
    expect(screen.getByText(NEXT_PROBLEM)).toBeTruthy();
    expect(screen.queryByText(BASIC_PROBLEM)).toBeNull();
    expect(screen.queryByText(LOCKED_PROBLEM)).toBeNull();
  });

  it('links the only primary action to the first unfinished enterable problem', () => {
    renderDetail();

    const action = primaryAction();
    expect(action).toHaveAccessibleName(START_LABEL);
    expect(action).toHaveAttribute('href', stageEntryUrl(BASIC_PID, STAGE_BASIC));
    expect(screen.queryByRole('link', { name: '管理' })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  });

  it('continues at the next unfinished enterable problem after the first visible one is done', () => {
    renderDetail({
      completedProblemCount: 1,
      nsdict: {
        [STAGE_BASIC]: { isOpen: true, hasAccess: true, donePids: [BASIC_PID] },
        [STAGE_NEXT]: { isOpen: true, hasAccess: true, donePids: [] },
        [STAGE_LOCKED]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
      },
    });

    const action = primaryAction();
    expect(action).toHaveAccessibleName(CONTINUE_LABEL);
    expect(action).toHaveAttribute('href', stageEntryUrl(NEXT_PID, STAGE_NEXT));
  });

  it('keeps continuing from the first enterable problem when every enterable problem is done', () => {
    renderDetail({
      completedProblemCount: 3,
      nsdict: {
        [STAGE_BASIC]: { isOpen: true, hasAccess: true, donePids: [BASIC_PID] },
        [STAGE_NEXT]: { isOpen: true, hasAccess: true, donePids: [NEXT_PID] },
        [STAGE_LOCKED]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
      },
    });

    const action = primaryAction();
    expect(action).toBeEnabled();
    expect(action).toHaveAccessibleName(CONTINUE_LABEL);
    expect(action).toHaveAttribute('href', stageEntryUrl(BASIC_PID, STAGE_BASIC));
    expect(screen.getByText('已全部完成')).toBeTruthy();
    expect(screen.queryByText(NO_STAGE)).toBeNull();
  });

  it('does not expand a locked stage named by the chapter query', () => {
    window.history.replaceState(null, '', `/problem-sets/${TID}?chapter=${STAGE_LOCKED}`);
    renderDetail();

    expectExpanded(LOCKED_TITLE, false);
    expectExpanded(BASIC_TITLE, true);
    expect(screen.queryByText(LOCKED_PROBLEM)).toBeNull();
    expect(screen.getByText(BASIC_PROBLEM)).toBeTruthy();
  });

  it('marks a stage problem from donePids and ignores global status when integrity is on', () => {
    renderDetail({
      nsdict: {
        [STAGE_BASIC]: { isOpen: true, hasAccess: true, donePids: [BASIC_PID] },
        [STAGE_NEXT]: { isOpen: true, hasAccess: true, donePids: [] },
        [STAGE_LOCKED]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
      },
      psdict: { [BASIC_PID]: { status: 2, score: 0 } },
    });
    expect(screen.getByRole('img', { name: '已通过' })).toBeTruthy();
    expect(screen.getByText('已通过')).toBeTruthy();
  });

  it('shows a global wrong and partial mark when integrity is off', () => {
    renderDetail({ psdict: { [BASIC_PID]: { status: 2, score: 0 } } });
    expect(screen.getByRole('img', { name: '未通过' })).toBeTruthy();
    expect(screen.getByText('未通过')).toBeTruthy();
  });

  it('shows a partial mark from a global score when integrity is off', () => {
    renderDetail({ psdict: { [BASIC_PID]: { status: 2, score: 40 } } });
    expect(screen.getByRole('img', { name: '部分得分' })).toBeTruthy();
    expect(screen.getByText('部分得分')).toBeTruthy();
  });

  it('does not fall back to a global wrong mark when integrity is on', () => {
    renderDetail({
      integrityControlled: true,
      psdict: { [BASIC_PID]: { status: 2, score: 0 } },
    });
    expect(screen.getByRole('img', { name: '未做' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '未通过' })).toBeNull();
    expect(screen.queryByText('未通过')).toBeNull();
  });

  it('hides the file link from a student', () => {
    renderDetail({ files: [{ name: '讲义.pdf' }] });
    expect(screen.queryByRole('link', { name: '附件' })).toBeNull();
  });

  it('shows the file link to someone who can manage the practice', () => {
    renderDetail({ canManage: true, files: [{ name: '讲义.pdf' }] });
    expect(screen.getByRole('link', { name: '附件' })).toHaveAttribute('href', `/problem-sets/${TID}/file`);
  });

  it('disables the primary action when no stage can be entered', () => {
    renderDetail({
      nsdict: {
        [STAGE_BASIC]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
        [STAGE_NEXT]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
        [STAGE_LOCKED]: { hasAccess: true, lockReason: 'prereq', donePids: [] },
      },
    });

    const action = primaryAction();
    expect(action).toBeDisabled();
    expect(action).not.toHaveAttribute('href');
    expect(screen.getByText(NO_STAGE)).toBeTruthy();
  });

  it('replaces stages with a result table when the search matches', async () => {
    renderDetail();

    await userEvent.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), BASIC_LABEL);

    const table = screen.getByRole('table');
    expect(table).toHaveTextContent(BASIC_LABEL);
    expect(table).toHaveTextContent(BASIC_PROBLEM);
    expect(table).toHaveTextContent(BASIC_TITLE);
    expect(table).not.toHaveTextContent(NEXT_PROBLEM);
    expectStagesReplaced();

    expect(within(table).getByRole('link', { name: BASIC_PROBLEM })).toHaveAttribute('href', stageEntryUrl(BASIC_PID, STAGE_BASIC));
    await userEvent.click(within(table).getByRole('button', { name: BASIC_TITLE }));

    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toHaveValue('');
    expectExpanded(BASIC_TITLE, true);
  });

  it('shows an empty search message when nothing matches', async () => {
    renderDetail();

    await userEvent.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'ZZZNOMATCH');

    expect(screen.getByText(EMPTY_SEARCH)).toBeTruthy();
    expectStagesReplaced();
  });
});
