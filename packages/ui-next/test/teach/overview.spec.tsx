// A static import fails collection while the overview tab module is absent.
import type { ProblemKind, TeachTab, TeachType } from '@hydrooj/common';
import { teachStatusOf } from '@hydrooj/common';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import type {
  TeachAudienceSummary,
  TeachLinks,
  TeachPaper,
  TeachPaperProblem,
  TeachStats,
  TeachWorkbenchPayload,
} from '../../src/pages/teach/model.ts';
import { paperFromPayload, paperSummary } from '../../src/pages/teach/paper.ts';

const overviewLoaders = import.meta.glob('../../src/pages/teach/tabs/overview.tsx');

const OVERVIEW_SOURCE = 'src/pages/teach/tabs/overview.tsx';
const NOW_ISO = '2031-06-15T00:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SLACK_MS = 20_000;
const DAY_MS = 24 * HOUR_MS;
const MISSING = '\u2014';
const SEPARATOR = ' \u00B7 ';
const COPY_LINE = '复制自 王老师《数据结构 小测 3》';
const READINESS_DESCRIPTION = '开始前确认这几项。点「去处理」直接跳到对应页签。';
const PASS_RATE_DESCRIPTION = '通过人数 / 尝试人数';
const NO_PROBLEM_DETAIL = '去「题目」页签加题';
const PASS_MISSING_DETAIL = '不设则没有补考，只看是否交卷';
const VIGIL_OFF_DETAIL = '未开启 · 在「高级」里配置';
const PERSONAL_DETAIL = '学生点「开始作答」后计时';
const LATE_DENIED_DETAIL = '截止后不能再提交';
const LOCK_OFF_DETAIL = '在「设置」里可以设置';
const INTEGRITY_DETAIL = '在「高级」里配置';
const REDEEM_DETAIL = '在「高级」里管理兑换码';
const THREE_DAYS = '3 天 4 小时';
const TWO_HOURS = '2 小时 5 分钟';
const LAYOUT_CLASS = 'lg:grid-cols-[minmax(0,1fr)_20rem]';
const OWNER_NAME = '陈老师';
const GROUP_NAME = '软工 2501';
const OTHER_GROUP = '计科 2401';
const SCHOOL_NAME = '中国民航大学';
const FIRST_TITLE = '括号匹配';
const SECOND_TITLE = '表达式求值';

const IDS: Record<TeachType, string> = {
  practice: '64b7c3a2e4b0f96d1a2c3d15',
  homework: '64b7c3a2e4b0f96d1a2c3d12',
  exam: '64b7c3a2e4b0f96d1a2c3d11',
  acm: '64b7c3a2e4b0f96d1a2c3d13',
  oi: '64b7c3a2e4b0f96d1a2c3d14',
};

type AudienceMode = TeachAudienceSummary['mode'];
type EntryMode = 'open' | 'client_required';

interface ReadinessItem {
  state: 'ok' | 'todo' | 'opt';
  title: string;
  detail: string;
  tab: TeachTab | null;
}

interface OverviewProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface OverviewApi {
  OverviewTab: ComponentType<OverviewProps>;
  readinessItems: (payload: TeachWorkbenchPayload) => ReadinessItem[];
}

interface Fixture {
  type: TeachType;
  id?: string;
  rule?: string;
  title?: string;
  beginAt?: string | null;
  endAt?: string | null;
  durationMinutes?: number | null;
  penaltySince?: string | null;
  lockAt?: string | null;
  audienceMode?: AudienceMode;
  groupNames?: string[];
  schoolNames?: string[];
  boundStudentCount?: number | null;
  maintainers?: Array<{ uid: number; name: string }>;
  copiedFrom?: TeachWorkbenchPayload['container']['copiedFrom'];
  schoolShared?: TeachWorkbenchPayload['container']['schoolShared'];
  examPassScore?: number | null;
  examAttemptLimit?: number | null;
  vigilEnabled?: boolean;
  entryMode?: EntryMode;
  problems?: TeachPaperProblem[];
  stages?: TeachPaper['stages'];
  examPaperQuotas?: TeachPaper['examPaperQuotas'];
  participantCount?: number;
  startedCount?: number | null;
  finalizedCount?: number | null;
  submittedCount?: number | null;
  recordCount?: number | null;
  audienceCount?: number | null;
  problemStats?: TeachStats['problemStats'];
  canGrade?: boolean;
  redemption?: string | null;
  ownerName?: string;
}

interface StatPair {
  label: string;
  value: string;
}

let fetchMock: ReturnType<typeof vi.fn> = vi.fn();
let overviewApi: OverviewApi | null = null;

function at(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString();
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function overviewLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(overviewLoaders)) {
    if (key.endsWith(OVERVIEW_SOURCE) && typeof load === 'function') return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadOverview(): Promise<OverviewApi> {
  if (overviewApi) return overviewApi;
  const load = overviewLoader();
  expect(typeof load, OVERVIEW_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${OVERVIEW_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('overview module must be an object');
  overviewApi = {
    OverviewTab: asComponent(readField(imported, 'OverviewTab'), 'OverviewTab'),
    readinessItems: asFunction(readField(imported, 'readinessItems'), 'readinessItems'),
  };
  return overviewApi;
}

function problem(docId: number, title: string, score: number | null, kind: ProblemKind = 'programming'): TeachPaperProblem {
  return {
    docId,
    pid: `P${docId}`,
    title,
    kind,
    score,
    hidden: false,
    mine: true,
    difficulty: null,
  };
}

function defaultRule(type: TeachType): string {
  if (type === 'practice') return 'problem_set';
  return type;
}

function defaultScore(type: TeachType): number | null {
  if (type === 'acm' || type === 'practice') return null;
  return 20;
}

function build(spec: Fixture): TeachWorkbenchPayload {
  const type = spec.type;
  const id = spec.id ?? IDS[type];
  const problems = spec.problems ?? [problem(101, FIRST_TITLE, defaultScore(type))];
  const mode = spec.audienceMode ?? 'all';
  const boundStudentCount = spec.boundStudentCount !== undefined
    ? spec.boundStudentCount
    : (mode === 'groups' ? 41 : null);
  const beginAt = spec.beginAt !== undefined ? spec.beginAt : (type === 'practice' ? null : at(-HOUR_MS));
  const endAt = spec.endAt !== undefined ? spec.endAt : (type === 'practice' ? null : at(3 * DAY_MS + 4 * HOUR_MS + SLACK_MS));
  const canGrade = spec.canGrade ?? false;
  const redemption = type === 'practice' ? (spec.redemption ?? null) : null;
  const links: TeachLinks = {
    studentView: `/student/${id}`,
    scoreboard: type === 'practice' ? null : `/scoreboard/${id}`,
    manage: type === 'homework' || type === 'practice' ? null : `/manage/${id}`,
    users: type === 'homework' || type === 'practice' ? null : `/users/${id}`,
    clarification: type === 'homework' || type === 'practice' ? null : `/clarification/${id}`,
    grading: canGrade ? `/grading/${id}` : null,
    teams: null,
    balloon: type === 'acm' ? `/balloon/${id}` : null,
    print: type === 'acm' || type === 'oi' ? `/print/${id}` : null,
    code: type === 'acm' || type === 'oi' ? `/code/${id}` : null,
    files: `/files/${id}`,
    redemption,
  };
  const stages = spec.stages !== undefined
    ? spec.stages
    : (type === 'practice'
      ? [{ id: 1, title: '阶段一', requireIds: [], pids: problems.map((entry) => entry.docId) }]
      : null);
  const audienceCount = spec.audienceCount !== undefined ? spec.audienceCount : boundStudentCount;
  const personal = spec.durationMinutes !== undefined ? spec.durationMinutes : null;
  return {
    container: {
      type,
      id,
      rule: spec.rule ?? defaultRule(type),
      title: spec.title ?? '题目集',
      status: teachStatusOf({ type, beginAt, endAt }, new Date(NOW_MS)),
      beginAt,
      endAt,
      durationMinutes: personal,
      penaltySince: spec.penaltySince !== undefined ? spec.penaltySince : (type === 'homework' ? endAt : null),
      lockAt: spec.lockAt !== undefined ? spec.lockAt : null,
      audience: {
        mode,
        groupNames: spec.groupNames ?? (mode === 'groups' ? [GROUP_NAME] : []),
        schoolNames: spec.schoolNames ?? (mode === 'schools' ? [SCHOOL_NAME] : []),
        boundStudentCount,
      },
      owner: { uid: 7, name: spec.ownerName ?? OWNER_NAME },
      maintainers: spec.maintainers ?? [],
      createdAt: '2026-10-09T04:00:00.000Z',
      schoolShared: spec.schoolShared ?? null,
      copiedFrom: spec.copiedFrom ?? null,
      examPassScore: type === 'exam' ? (spec.examPassScore ?? null) : null,
      examAttemptLimit: type === 'exam' ? (spec.examAttemptLimit ?? null) : null,
      participationMode: 'individual',
      vigilEnabled: spec.vigilEnabled ?? false,
      entryMode: spec.entryMode ?? 'open',
      links,
    },
    paper: {
      problems,
      stages,
      examPaperQuotas: spec.examPaperQuotas !== undefined ? spec.examPaperQuotas : null,
    },
    stats: {
      participantCount: spec.participantCount ?? 12,
      startedCount: spec.startedCount !== undefined ? spec.startedCount : (type === 'exam' || personal !== null ? 4 : null),
      finalizedCount: spec.finalizedCount !== undefined ? spec.finalizedCount : (type === 'exam' ? 6 : null),
      submittedCount: spec.submittedCount !== undefined ? spec.submittedCount : (type === 'practice' ? null : 8),
      recordCount: spec.recordCount !== undefined ? spec.recordCount : (type === 'practice' ? null : 15),
      audienceCount,
      problemStats: spec.problemStats !== undefined ? spec.problemStats : null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade,
      canManageTeamBatches: false,
      isSystemAdmin: false,
      canPin: false,
    },
  };
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function elementWithTokens(tokens: readonly string[]): HTMLElement {
  const found = [...document.querySelectorAll('*')].find((element) => {
    const actual = classTokens(element);
    return tokens.every((token) => actual.includes(token));
  });
  if (!(found instanceof HTMLElement)) throw new TypeError(tokens.join(' '));
  return found;
}

function panelByHeading(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError(title);
  return panel;
}

function readinessRow(title: string): HTMLElement {
  const panel = panelByHeading('准备情况');
  const titleNode = within(panel).getByText(title, { exact: true });
  let current: HTMLElement | null = titleNode;
  let best: HTMLElement | null = null;
  let bestCount = 0;
  while (current && panel.contains(current)) {
    const parent = current.parentElement;
    if (parent) {
      const iconRows = [...parent.children].filter((child) => child instanceof HTMLElement && child.querySelector('svg'));
      if (iconRows.length > bestCount && iconRows.some((row) => row.contains(titleNode))) {
        const match = iconRows.find((row) => row.contains(titleNode));
        if (match instanceof HTMLElement) {
          best = match;
          bestCount = iconRows.length;
        }
      }
    }
    current = current.parentElement;
  }
  if (!best) throw new TypeError(`readiness row ${title}`);
  return best;
}

function expectIcon(row: HTMLElement, iconClass: string, toneClass: string) {
  const icon = [...row.querySelectorAll('svg')].find((svg) => classTokens(svg).includes(iconClass));
  if (!(icon instanceof SVGElement)) throw new TypeError(iconClass);
  const tokens = classTokens(icon);
  expect(tokens).toContain(iconClass);
  expect(tokens).toContain(toneClass);
  expect(tokens).toContain('size-4');
  expect(tokens).toContain('shrink-0');
}

function statsGrid(): HTMLElement {
  const grids = [...document.querySelectorAll('*')].filter((element) => {
    const tokens = classTokens(element);
    return tokens.includes('grid-cols-2') && tokens.includes('md:grid-cols-4');
  });
  const last = grids.at(-1);
  if (!(last instanceof HTMLElement)) throw new TypeError('stat grid');
  return last;
}

function statPairs(): StatPair[] {
  return [...statsGrid().querySelectorAll('.text-2xl')].map((node) => {
    const root = node.parentElement?.parentElement;
    const label = root?.querySelector('.text-xs');
    return {
      label: (label?.textContent ?? '').trim(),
      value: (node.textContent ?? '').trim(),
    };
  });
}

function detailFor(term: string): string {
  const panel = panelByHeading('基本信息');
  const label = within(panel).getByText(term, { exact: true });
  expect(label.tagName).toBe('DT');
  const value = label.parentElement?.querySelector('dd');
  if (!(value instanceof HTMLElement)) throw new TypeError(term);
  return (value.textContent ?? '').trim();
}

function controlNames(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll('a, button')].map((node) => (node.textContent ?? '').replace(/\s+/g, '').trim());
}

function controlByName(panel: HTMLElement, name: string): HTMLElement {
  const found = within(panel).queryByRole('button', { name }) ?? within(panel).queryByRole('link', { name });
  if (!(found instanceof HTMLElement)) throw new TypeError(name);
  return found;
}

function bootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: NOW_ISO,
    user: {
      id: 7,
      name: 'teacher',
      signedIn: true,
    } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function renderOverview(payload: TeachWorkbenchPayload, onNavigateTab: (tab: TeachTab) => void = vi.fn()) {
  const api = overviewApi;
  if (!api) throw new TypeError('overview module is not loaded');
  // BootstrapProvider mounts the single DialogHost; unmount the previous tree before rendering another one.
  cleanup();
  return render(
    <BootstrapProvider bootstrap={bootstrap()}>
      <api.OverviewTab payload={payload} onNavigateTab={onNavigateTab} />
    </BootstrapProvider>,
  );
}

function expectNoPrimary() {
  const root = elementWithTokens([LAYOUT_CLASS]);
  expect(root.querySelector('[data-slot="button"][data-variant="primary"]')).toBeNull();
}

function addedDetail(payload: TeachWorkbenchPayload): string {
  const summary = paperSummary(paperFromPayload(payload.paper, payload.container));
  const prefix = `共 ${payload.paper.problems.length} 道${SEPARATOR}`;
  return summary.startsWith(prefix) ? summary.slice(prefix.length) : summary;
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
  vi.stubGlobal('fetch', fetchMock);
});

describe('readiness items', () => {
  it('puts an unset exam pass line on the settings tab', async () => {
    const api = await loadOverview();
    const payload = build({
      type: 'exam',
      problems: [problem(101, FIRST_TITLE, 20), problem(102, SECOND_TITLE, 20)],
      audienceMode: 'groups',
      examPassScore: null,
      vigilEnabled: false,
    });
    expect(addedDetail(payload)).toBe('满分 40');
    expect(api.readinessItems(payload)).toEqual([
      { state: 'ok', title: '已添加 2 道题', detail: '满分 40', tab: null },
      { state: 'ok', title: '已指定 1 个用户组', detail: `${GROUP_NAME} · 共 41 名已绑定学生`, tab: null },
      { state: 'todo', title: '还没设置及格线', detail: PASS_MISSING_DETAIL, tab: 'settings' },
      { state: 'opt', title: '机房监考（可选）', detail: VIGIL_OFF_DETAIL, tab: 'advanced' },
    ]);
  });

  it('makes zero problems the first todo for every type', async () => {
    const api = await loadOverview();
    const types: TeachType[] = ['practice', 'homework', 'exam', 'acm', 'oi'];
    for (const type of types) {
      const items = api.readinessItems(build({ type, problems: [] }));
      expect(items[0], type).toEqual({
        state: 'todo',
        title: '还没有题目',
        detail: NO_PROBLEM_DETAIL,
        tab: 'problems',
      });
    }
  });

  it('describes a pass line, an open vigil room, and a school audience', async () => {
    const api = await loadOverview();
    const payload = build({
      type: 'exam',
      audienceMode: 'schools',
      examPassScore: 60,
      examAttemptLimit: 3,
      vigilEnabled: true,
      entryMode: 'open',
    });
    expect(api.readinessItems(payload)).toEqual([
      { state: 'ok', title: '已添加 1 道题', detail: '满分 20', tab: null },
      { state: 'ok', title: `给谁做：${SCHOOL_NAME}`, detail: '按学生记录所在学校', tab: null },
      { state: 'ok', title: '及格线 60 分', detail: '最多考 3 次', tab: null },
      { state: 'ok', title: '已开启机房监考', detail: '普通网页可进入', tab: null },
    ]);
  });

  it('requires the client when vigil entry is client required', async () => {
    const api = await loadOverview();
    const items = api.readinessItems(build({
      type: 'exam',
      problems: [],
      examPassScore: 60,
      examAttemptLimit: 2,
      vigilEnabled: true,
      entryMode: 'client_required',
    }));
    expect(items[3]).toEqual({
      state: 'ok',
      title: '已开启机房监考',
      detail: '必须通过客户端进入',
      tab: null,
    });
  });

  it('sends redeem-only audience to the advanced tab', async () => {
    const api = await loadOverview();
    const items = api.readinessItems(build({
      type: 'exam',
      audienceMode: 'redeem_only',
      examPassScore: null,
    }));
    expect(items[1]).toEqual({
      state: 'opt',
      title: '只能通过兑换码进入',
      detail: REDEEM_DETAIL,
      tab: 'advanced',
    });
  });

  it('keeps every group name and the bound-student count', async () => {
    const api = await loadOverview();
    const items = api.readinessItems(build({
      type: 'homework',
      audienceMode: 'groups',
      groupNames: [OTHER_GROUP, GROUP_NAME],
      boundStudentCount: 72,
    }));
    const audience = items[1];
    expect(audience).toMatchObject({ state: 'ok', title: '已指定 2 个用户组', tab: null });
    expect(audience?.detail).toContain(OTHER_GROUP);
    expect(audience?.detail).toContain(GROUP_NAME);
    expect(audience?.detail.endsWith(' · 共 72 名已绑定学生')).toBe(true);
  });

  it('lets everyone log in when the audience is all', async () => {
    const api = await loadOverview();
    const items = api.readinessItems(build({ type: 'acm', audienceMode: 'all' }));
    expect(items[1]).toEqual({ state: 'ok', title: '给谁做：所有人', detail: '登录即可看到', tab: null });
  });

  it('uses the draw summary without the plain problem prefix', async () => {
    const api = await loadOverview();
    const payload = build({
      type: 'exam',
      problems: [problem(101, FIRST_TITLE, 10), problem(102, SECOND_TITLE, 10)],
      examPaperQuotas: { programming: 1 },
      examPassScore: 60,
      examAttemptLimit: 1,
      vigilEnabled: true,
      entryMode: 'client_required',
    });
    expect(addedDetail(payload)).toBe('题库 2 道 · 每人 1 道 · 满分 10');
    expect(api.readinessItems(payload)[0]).toEqual({
      state: 'ok',
      title: '已添加 2 道题',
      detail: '题库 2 道 · 每人 1 道 · 满分 10',
      tab: null,
    });
  });

  it('prefers a personal limit over a late window', async () => {
    const api = await loadOverview();
    const endAt = at(48 * HOUR_MS);
    const payload = build({
      type: 'homework',
      problems: [problem(101, FIRST_TITLE, 10), problem(102, SECOND_TITLE, 15)],
      durationMinutes: 90,
      penaltySince: at(0),
      endAt,
      audienceMode: 'all',
    });
    expect(addedDetail(payload)).toBe('满分 25');
    expect(api.readinessItems(payload)).toEqual([
      { state: 'ok', title: '已添加 2 道题', detail: '满分 25', tab: null },
      { state: 'ok', title: '给谁做：所有人', detail: '登录即可看到', tab: null },
      { state: 'ok', title: '个人限时 90 分钟', detail: PERSONAL_DETAIL, tab: null },
    ]);
  });

  it('counts late hours from the penalty start to the end', async () => {
    const api = await loadOverview();
    const endAt = at(48 * HOUR_MS);
    const items = api.readinessItems(build({
      type: 'homework',
      durationMinutes: null,
      penaltySince: at(0),
      beginAt: at(-HOUR_MS),
      endAt,
      audienceMode: 'all',
    }));
    expect(items[2]).toEqual({
      state: 'ok',
      title: '允许迟交',
      detail: '截止后 48 小时内按规则扣分',
      tab: null,
    });
  });

  it('rejects late work when the penalty window is not later than the end', async () => {
    const api = await loadOverview();
    const endAt = at(DAY_MS);
    const sameEnd = api.readinessItems(build({
      type: 'homework',
      durationMinutes: null,
      penaltySince: endAt,
      endAt,
      audienceMode: 'all',
    }));
    const missingPenalty = api.readinessItems(build({
      type: 'homework',
      durationMinutes: null,
      penaltySince: null,
      endAt,
      audienceMode: 'all',
    }));
    const denied = { state: 'ok', title: '不允许迟交', detail: LATE_DENIED_DETAIL, tab: null };
    expect(sameEnd[2]).toEqual(denied);
    expect(missingPenalty[2]).toEqual(denied);
  });

  it('reports an acm lock and leaves an unlocked contest as optional', async () => {
    const api = await loadOverview();
    const endAt = at(10 * HOUR_MS);
    const locked = build({
      type: 'acm',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      audienceMode: 'all',
      vigilEnabled: false,
      endAt,
      beginAt: at(-5 * HOUR_MS),
      lockAt: at(10 * HOUR_MS - 60 * MINUTE_MS),
    });
    expect(addedDetail(locked)).toBe('A\u2013B');
    expect(api.readinessItems(locked)).toEqual([
      { state: 'ok', title: '已添加 2 道题', detail: 'A\u2013B', tab: null },
      { state: 'ok', title: '给谁做：所有人', detail: '登录即可看到', tab: null },
      { state: 'opt', title: '机房监考（可选）', detail: VIGIL_OFF_DETAIL, tab: 'advanced' },
      { state: 'ok', title: '封榜', detail: '结束前 60 分钟', tab: null },
    ]);
    const unlocked = api.readinessItems(build({
      type: 'acm',
      lockAt: null,
      vigilEnabled: true,
      entryMode: 'client_required',
      audienceMode: 'all',
    }));
    expect(unlocked[2]).toEqual({
      state: 'ok',
      title: '已开启机房监考',
      detail: '必须通过客户端进入',
      tab: null,
    });
    expect(unlocked[3]).toEqual({
      state: 'opt',
      title: '不封榜',
      detail: LOCK_OFF_DETAIL,
      tab: 'settings',
    });
  });

  it('keeps practice integrity optional and strips a multi-stage summary', async () => {
    const api = await loadOverview();
    const staged = build({
      type: 'practice',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      stages: [
        { id: 1, title: '基础', requireIds: [], pids: [101] },
        { id: 2, title: '进阶', requireIds: [1], pids: [102] },
      ],
      audienceMode: 'all',
    });
    expect(addedDetail(staged)).toBe('2 个阶段');
    expect(api.readinessItems(staged)).toEqual([
      { state: 'ok', title: '已添加 2 道题', detail: '2 个阶段', tab: null },
      { state: 'ok', title: '给谁做：所有人', detail: '登录即可看到', tab: null },
      { state: 'opt', title: '真实性训练策略（可选）', detail: INTEGRITY_DETAIL, tab: 'advanced' },
    ]);
    const singleStage = build({
      type: 'practice',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      stages: [{ id: 1, title: '阶段一', requireIds: [], pids: [101, 102] }],
    });
    expect(api.readinessItems(singleStage)[0]?.detail).toBe('共 2 道');
  });

  it('does not mix exam, homework, acm, and practice rows', async () => {
    const api = await loadOverview();
    const titles = (payload: TeachWorkbenchPayload) => api.readinessItems(payload).map((entry) => entry.title);
    expect(titles(build({ type: 'oi', vigilEnabled: false }))).toEqual([
      '已添加 1 道题',
      '给谁做：所有人',
      '机房监考（可选）',
    ]);
    expect(titles(build({ type: 'homework', durationMinutes: null, audienceMode: 'all' }))).not.toContain('机房监考（可选）');
    expect(titles(build({ type: 'practice' }))).not.toContain('机房监考（可选）');
    expect(titles(build({ type: 'exam', examPassScore: null }))).not.toContain('不封榜');
    expect(titles(build({ type: 'acm', lockAt: null }))).not.toContain('还没设置及格线');
  });
});

describe('overview readiness', () => {
  it('opens settings from the missing pass-line action', async () => {
    const api = await loadOverview();
    const payload = build({ type: 'exam', examPassScore: null, vigilEnabled: false, audienceMode: 'groups' });
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    renderOverview(payload, onNavigateTab);
    expect(screen.getByText(READINESS_DESCRIPTION)).toBeInTheDocument();
    const passRow = readinessRow('还没设置及格线');
    expectIcon(passRow, 'lucide-circle-alert', 'text-warning-fg');
    expect(classTokens(within(passRow).getByText('还没设置及格线'))).toContain('text-sm');
    expect(classTokens(within(passRow).getByText(PASS_MISSING_DETAIL))).toEqual(expect.arrayContaining(['text-xs', 'text-fg-subtle']));
    const action = within(passRow).getByRole('button', { name: '去处理' });
    expect(action).toHaveAttribute('data-variant', 'secondary');
    expect(action).toHaveAttribute('data-size', 'sm');
    await userEvent.setup().click(action);
    expect(onNavigateTab).toHaveBeenCalledWith('settings');
    expect(api.readinessItems(payload).some((entry) => entry.title === '还没设置及格线' && entry.tab === 'settings')).toBe(true);
  });

  it('opens the tab stored on each ready action', async () => {
    const api = await loadOverview();
    const payload = build({ type: 'exam', problems: [], examPassScore: null, vigilEnabled: false });
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    renderOverview(payload, onNavigateTab);
    const linked = api.readinessItems(payload).filter((entry) => entry.tab !== null);
    const buttons = within(panelByHeading('准备情况')).getAllByRole('button', { name: '去处理' });
    expect(buttons).toHaveLength(linked.length);
    const user = userEvent.setup();
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      const entry = linked[index];
      if (!button || !entry?.tab) throw new TypeError('readiness action');
      await user.click(button);
      expect(onNavigateTab).toHaveBeenLastCalledWith(entry.tab);
    }
    expectIcon(readinessRow('还没有题目'), 'lucide-circle-alert', 'text-warning-fg');
    expectIcon(readinessRow('给谁做：所有人'), 'lucide-circle-check', 'text-success-fg');
    expectIcon(readinessRow('机房监考（可选）'), 'lucide-circle', 'text-fg-subtle');
  });

  it('hides the action when a row has no tab', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'homework',
      audienceMode: 'all',
      durationMinutes: null,
      penaltySince: null,
    }));
    expect(screen.queryByRole('button', { name: '去处理' })).toBeNull();
    expectIcon(readinessRow('不允许迟交'), 'lucide-circle-check', 'text-success-fg');
  });
});

describe('pass rates', () => {
  it('skips practice and numbers acm problems a and b', async () => {
    await loadOverview();
    const stats = [
      { docId: 102, accepted: 0, attempted: 5 },
      { docId: 101, accepted: 3, attempted: 4 },
    ];
    const practice = build({
      type: 'practice',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      problemStats: stats,
    });
    renderOverview(practice);
    expect(screen.queryByRole('heading', { name: '各题通过率' })).toBeNull();

    const acm = build({
      type: 'acm',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      problemStats: stats,
      participantCount: 214,
      recordCount: 1931,
    });
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    renderOverview(acm, onNavigateTab);
    const panel = panelByHeading('各题通过率');
    expect(within(panel).getByText(PASS_RATE_DESCRIPTION)).toBeInTheDocument();
    const grades = within(panel).getByRole('button', { name: '看成绩' });
    expect(grades).toHaveAttribute('data-variant', 'ghost');
    expect(grades).toHaveAttribute('data-size', 'sm');
    await userEvent.setup().click(grades);
    expect(onNavigateTab).toHaveBeenCalledWith('grades');

    const first = within(panel).getByText(FIRST_TITLE, { exact: true });
    const second = within(panel).getByText(SECOND_TITLE, { exact: true });
    expect(classTokens(first)).toContain('truncate');
    expect(classTokens(second)).toContain('truncate');
    const letterA = within(panel).getByText('A', { exact: true });
    const letterB = within(panel).getByText('B', { exact: true });
    expect(letterA.compareDocumentPosition(letterB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(letterA.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(classTokens(within(panel).getByText('3 / 4', { exact: true }))).toEqual(expect.arrayContaining(['tabular', 'text-xs']));
    expect(classTokens(within(panel).getByText('0 / 5', { exact: true }))).toEqual(expect.arrayContaining(['tabular', 'text-xs']));

    const barFor = (titleNode: HTMLElement): HTMLElement => {
      let current: HTMLElement | null = titleNode;
      while (current && panel.contains(current)) {
        const bars = [...current.querySelectorAll('[role="progressbar"]')];
        const only = bars.length === 1 ? bars[0] : null;
        if (only instanceof HTMLElement) return only;
        current = current.parentElement;
      }
      throw new TypeError('progress');
    };
    const firstBar = barFor(first);
    const secondBar = barFor(second);
    expect(firstBar).toHaveAttribute('aria-valuenow', '75');
    expect(secondBar).toHaveAttribute('aria-valuenow', '0');
    expect(classTokens(firstBar)).toContain('h-1');
    expect(classTokens(secondBar)).toContain('h-1');
  });

  it('hides the panel when a contest has no problem stats', async () => {
    await loadOverview();
    renderOverview(build({ type: 'acm', problemStats: [] }));
    expect(screen.queryByRole('heading', { name: '各题通过率' })).toBeNull();
    renderOverview(build({ type: 'oi', problemStats: null }));
    expect(screen.queryByRole('heading', { name: '各题通过率' })).toBeNull();
  });

  it('numbers homework rows from the paper order', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'homework',
      problems: [problem(101, FIRST_TITLE, 10), problem(102, SECOND_TITLE, 10)],
      problemStats: [
        { docId: 102, accepted: 1, attempted: 2 },
        { docId: 101, accepted: 2, attempted: 2 },
      ],
      audienceCount: 41,
      submittedCount: 8,
      durationMinutes: null,
    }));
    expect(screen.getByRole('heading', { name: '各题通过率' })).toBeInTheDocument();
    expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('A', { exact: true })).toBeNull();
    const firstNumber = screen.getByText('1', { exact: true });
    const secondNumber = screen.getByText('2', { exact: true });
    expect(firstNumber.compareDocumentPosition(secondNumber) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('overview stats', () => {
  it('counts practice work, problems, and stages', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'practice',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      stages: [
        { id: 1, title: '基础', requireIds: [], pids: [101] },
        { id: 2, title: '进阶', requireIds: [1], pids: [102] },
        { id: 3, title: '综合', requireIds: [2], pids: [] },
      ],
      participantCount: 53,
    }));
    expect(statPairs()).toEqual([
      { label: '在做', value: '53' },
      { label: '题目', value: '2' },
      { label: '阶段', value: '3' },
    ]);
    expect(screen.queryByText('距截止')).toBeNull();
    const grid = statsGrid();
    expect(classTokens(grid.parentElement as Element)).not.toContain('p-4');
  });

  it('shows homework audience, submissions, and the time until the deadline', async () => {
    await loadOverview();
    const endAt = at(3 * DAY_MS + 4 * HOUR_MS + SLACK_MS);
    renderOverview(build({
      type: 'homework',
      audienceMode: 'groups',
      boundStudentCount: 72,
      audienceCount: null,
      submittedCount: 68,
      participantCount: 70,
      durationMinutes: null,
      beginAt: at(2 * HOUR_MS + 5 * MINUTE_MS),
      endAt,
    }));
    expect(statPairs()).toEqual([
      { label: '应交', value: MISSING },
      { label: '已提交', value: '68' },
      { label: '距截止', value: THREE_DAYS },
    ]);
    expect(screen.queryByText('已开始')).toBeNull();
    expect(screen.queryByText('距开考')).toBeNull();
  });

  it('counts the homework deadline to an earlier penalty start', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'homework',
      audienceMode: 'groups',
      boundStudentCount: 72,
      audienceCount: 72,
      submittedCount: 68,
      durationMinutes: null,
      beginAt: at(-HOUR_MS),
      penaltySince: at(2 * DAY_MS + SLACK_MS),
      endAt: at(4 * DAY_MS + SLACK_MS),
    }));
    expect(statPairs()).toEqual([
      { label: '应交', value: '72' },
      { label: '已提交', value: '68' },
      { label: '距截止', value: '2 天' },
    ]);

    renderOverview(build({
      type: 'homework',
      audienceMode: 'groups',
      boundStudentCount: 72,
      audienceCount: 72,
      submittedCount: 68,
      durationMinutes: null,
      beginAt: at(-2 * HOUR_MS),
      penaltySince: at(-HOUR_MS),
      endAt: at(2 * DAY_MS + SLACK_MS),
    }));
    expect(statPairs()).toEqual([
      { label: '应交', value: '72' },
      { label: '已提交', value: '68' },
      { label: '距截止', value: '已结束' },
    ]);
  });

  it('adds started students only when homework has a personal limit', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'homework',
      durationMinutes: 90,
      audienceCount: 72,
      submittedCount: 68,
      startedCount: 11,
      participantCount: 70,
      endAt: at(2 * HOUR_MS + 5 * MINUTE_MS + SLACK_MS),
    }));
    expect(statPairs()).toEqual([
      { label: '应交', value: '72' },
      { label: '已提交', value: '68' },
      { label: '已开始', value: '11' },
      { label: '距截止', value: TWO_HOURS },
    ]);
  });

  it('counts who should sit an exam and how far the window is', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'exam',
      audienceMode: 'groups',
      boundStudentCount: 41,
      audienceCount: 41,
      participantCount: 9,
      startedCount: 4,
      finalizedCount: 2,
      beginAt: at(2 * HOUR_MS + 5 * MINUTE_MS + SLACK_MS),
      endAt: at(3 * DAY_MS),
    }));
    expect(statPairs()).toEqual([
      { label: '应考', value: '41' },
      { label: '已开考', value: '4' },
      { label: '已交卷', value: '2' },
      { label: '距开考', value: TWO_HOURS },
    ]);

    renderOverview(build({
      type: 'exam',
      audienceCount: 41,
      participantCount: 9,
      startedCount: 4,
      finalizedCount: 2,
      beginAt: at(-HOUR_MS),
      endAt: at(2 * HOUR_MS + 5 * MINUTE_MS + SLACK_MS),
    }));
    expect(statPairs().at(-1)).toEqual({ label: '距结束', value: TWO_HOURS });

    renderOverview(build({
      type: 'exam',
      audienceCount: 41,
      startedCount: 4,
      finalizedCount: 2,
      beginAt: at(-2 * HOUR_MS),
      endAt: at(-MINUTE_MS),
    }));
    expect(statPairs().at(-1)).toEqual({ label: '距结束', value: '已结束' });
  });

  it('counts acm and oi entries, records, problems, and the meet window', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'acm',
      problems: [problem(101, FIRST_TITLE, null), problem(102, SECOND_TITLE, null)],
      participantCount: 214,
      recordCount: 1931,
      beginAt: at(2 * HOUR_MS + 5 * MINUTE_MS + SLACK_MS),
      endAt: at(DAY_MS),
    }));
    expect(statPairs()).toEqual([
      { label: '参赛', value: '214' },
      { label: '提交', value: '1931' },
      { label: '题目', value: '2' },
      { label: '距开赛', value: TWO_HOURS },
    ]);
    expect(screen.queryByText('距开考')).toBeNull();

    renderOverview(build({
      type: 'oi',
      rule: 'ioi',
      problems: [problem(101, FIRST_TITLE, 100)],
      participantCount: 28,
      recordCount: 0,
      beginAt: at(-HOUR_MS),
      endAt: at(-MINUTE_MS),
    }));
    expect(statPairs()).toEqual([
      { label: '参赛', value: '28' },
      { label: '提交', value: '0' },
      { label: '题目', value: '1' },
      { label: '距结束', value: '已结束' },
    ]);
  });
});

describe('quick links', () => {
  it('links practice to the student view, grades, and redemption', async () => {
    await loadOverview();
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    const hidden = build({ type: 'practice', redemption: null });
    renderOverview(hidden, onNavigateTab);
    expect(controlNames(panelByHeading('快捷入口'))).toEqual(['学生视角', '学习进度']);

    const shown = build({ type: 'practice', redemption: '/redeem/practice' });
    renderOverview(shown, onNavigateTab);
    const panel = screen.getAllByRole('heading', { name: '快捷入口' }).at(-1)?.closest('[data-slot="panel"]');
    if (!(panel instanceof HTMLElement)) throw new TypeError('quick links');
    expect(controlNames(panel)).toEqual(['学生视角', '学习进度', '兑换码']);
    const student = controlByName(panel, '学生视角');
    expect(student.tagName).toBe('A');
    expect(student).toHaveAttribute('href', shown.container.links.studentView);
    expect(student).toHaveAttribute('target', '_blank');
    expect(student.querySelector('.lucide-external-link')).not.toBeNull();
    const progress = controlByName(panel, '学习进度');
    expect(progress.querySelector('.lucide-chevron-right')).not.toBeNull();
    await userEvent.setup().click(progress);
    expect(onNavigateTab).toHaveBeenCalledWith('grades');
    const redeem = controlByName(panel, '兑换码');
    expect(redeem).toHaveAttribute('href', '/redeem/practice');
    expect(redeem).toHaveAttribute('target', '_blank');
  });

  it('links homework to the student view, records, and files', async () => {
    await loadOverview();
    const payload = build({ type: 'homework' });
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    renderOverview(payload, onNavigateTab);
    const panel = panelByHeading('快捷入口');
    expect(controlNames(panel)).toEqual(['学生视角', '全部提交', '附件文件']);
    expect(controlByName(panel, '学生视角')).toHaveAttribute('href', payload.container.links.studentView);
    expect(controlByName(panel, '附件文件')).toHaveAttribute('href', payload.container.links.files);
    expect(controlByName(panel, '附件文件')).toHaveAttribute('target', '_blank');
    const records = controlByName(panel, '全部提交');
    expect(records.querySelector('.lucide-chevron-right')).not.toBeNull();
    await userEvent.setup().click(records);
    expect(onNavigateTab).toHaveBeenCalledWith('records');
  });

  it('links an exam to the paper, clarifications, grading, and seats', async () => {
    await loadOverview();
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    renderOverview(build({ type: 'exam', canGrade: false }), onNavigateTab);
    expect(controlNames(panelByHeading('快捷入口'))).toEqual(['预览试卷', '答疑与公告', '座位与机房']);

    const payload = build({ type: 'exam', canGrade: true });
    renderOverview(payload, onNavigateTab);
    const panel = screen.getAllByRole('heading', { name: '快捷入口' }).at(-1)?.closest('[data-slot="panel"]');
    if (!(panel instanceof HTMLElement)) throw new TypeError('exam links');
    expect(controlNames(panel)).toEqual(['预览试卷', '答疑与公告', '主观题阅卷', '座位与机房']);
    expect(controlByName(panel, '预览试卷')).toHaveAttribute('href', payload.container.links.studentView);
    expect(controlByName(panel, '预览试卷')).toHaveAttribute('target', '_blank');
    expect(controlByName(panel, '答疑与公告')).toHaveAttribute('href', payload.container.links.clarification);
    expect(controlByName(panel, '主观题阅卷')).toHaveAttribute('href', '/grading/64b7c3a2e4b0f96d1a2c3d11');
    const seats = controlByName(panel, '座位与机房');
    expect(seats.querySelector('.lucide-chevron-right')).not.toBeNull();
    await userEvent.setup().click(seats);
    expect(onNavigateTab).toHaveBeenCalledWith('advanced');
  });

  it('links acm and oi to clarifications, the scoreboard, users, and records', async () => {
    await loadOverview();
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    const acm = build({ type: 'acm' });
    renderOverview(acm, onNavigateTab);
    const panel = panelByHeading('快捷入口');
    expect(controlNames(panel)).toEqual(['答疑与公告', '排行榜', '参赛选手', '全部提交']);
    expect(controlByName(panel, '答疑与公告')).toHaveAttribute('href', acm.container.links.clarification);
    expect(controlByName(panel, '答疑与公告')).toHaveAttribute('target', '_blank');
    expect(controlByName(panel, '排行榜')).toHaveAttribute('href', acm.container.links.scoreboard);
    expect(controlByName(panel, '排行榜')).toHaveAttribute('target', '_blank');
    expect(controlByName(panel, '参赛选手')).toHaveAttribute('href', acm.container.links.users);
    await userEvent.setup().click(controlByName(panel, '全部提交'));
    expect(onNavigateTab).toHaveBeenCalledWith('records');

    renderOverview(build({ type: 'oi' }), onNavigateTab);
    const oiPanel = screen.getAllByRole('heading', { name: '快捷入口' }).at(-1)?.closest('[data-slot="panel"]');
    if (!(oiPanel instanceof HTMLElement)) throw new TypeError('oi links');
    expect(controlNames(oiPanel)).toEqual(['答疑与公告', '排行榜', '参赛选手', '全部提交']);
  });
});

describe('basic information', () => {
  it('shows the copy source and the shared state', async () => {
    await loadOverview();
    const onNavigateTab = vi.fn<(tab: TeachTab) => void>();
    renderOverview(build({
      type: 'homework',
      maintainers: [{ uid: 8, name: '王老师' }, { uid: 9, name: '李老师' }],
      copiedFrom: {
        type: 'homework',
        id: IDS.exam,
        title: '数据结构 小测 3',
        ownerName: '王老师',
      },
      schoolShared: { sharedAt: NOW_ISO, sharedByName: OWNER_NAME },
    }), onNavigateTab);
    expect(detailFor('所有者')).toBe(OWNER_NAME);
    expect(detailFor('协作者')).toContain('王老师');
    expect(detailFor('协作者')).toContain('李老师');
    expect(detailFor('来源')).toBe(COPY_LINE);
    expect(screen.getByText(COPY_LINE)).toBeInTheDocument();
    expect(detailFor('学校共享')).toBe('共享中');
    expect(detailFor('创建于').length).toBeGreaterThan(0);
    const edit = within(panelByHeading('基本信息')).getByRole('button', { name: '编辑设置' });
    expect(edit).toHaveAttribute('data-variant', 'secondary');
    expect(edit).toHaveAttribute('data-size', 'sm');
    await userEvent.setup().click(edit);
    expect(onNavigateTab).toHaveBeenCalledWith('settings');
  });

  it('says there is no collaborator and the set is not shared', async () => {
    await loadOverview();
    renderOverview(build({ type: 'exam', maintainers: [], copiedFrom: null, schoolShared: null }));
    expect(detailFor('协作者')).toBe('无');
    expect(detailFor('学校共享')).toBe('未共享');
    expect(screen.queryByText('来源', { exact: true })).toBeNull();
    expect(screen.queryByText(/复制自/)).toBeNull();
  });

  it('hides collaborators on a practice set', async () => {
    await loadOverview();
    renderOverview(build({
      type: 'practice',
      maintainers: [{ uid: 8, name: '王老师' }],
      copiedFrom: null,
    }));
    expect(screen.queryByText('协作者', { exact: true })).toBeNull();
    expect(detailFor('所有者')).toBe(OWNER_NAME);
  });
});

describe('overview layout', () => {
  it('uses the two-column shell and no primary button', async () => {
    await loadOverview();
    const payload = build({
      type: 'exam',
      examPassScore: null,
      vigilEnabled: false,
      problemStats: [{ docId: 101, accepted: 1, attempted: 2 }],
      canGrade: true,
    });
    renderOverview(payload);
    const root = elementWithTokens(['grid', 'gap-6', LAYOUT_CLASS]);
    const left = root.firstElementChild;
    const aside = root.querySelector('aside');
    if (!(left instanceof HTMLElement) || !(aside instanceof HTMLElement)) throw new TypeError('columns');
    expect(classTokens(left)).toEqual(expect.arrayContaining(['flex', 'min-w-0', 'flex-col', 'gap-6']));
    expect(classTokens(aside)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-4']));
    expect(left.contains(panelByHeading('准备情况'))).toBe(true);
    expect(left.contains(statsGrid())).toBe(true);
    expect(left.contains(panelByHeading('各题通过率'))).toBe(true);
    expect(aside.contains(panelByHeading('快捷入口'))).toBe(true);
    expect(aside.contains(panelByHeading('基本信息'))).toBe(true);
    expectNoPrimary();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
