import type { TeachTab, TeachType } from '@hydrooj/common';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import {
  legacyEditPath,
  parseContestSnapshot,
  parseHomeworkSnapshot,
  parsePracticeSnapshot,
} from '../../src/pages/teach/legacy-forms.ts';
import type { TeachCapabilities, TeachLinks, TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider, WorkbenchDirtyProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while advanced.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/teach/tabs/advanced.tsx');

const TAB_SOURCE = 'src/pages/teach/tabs/advanced.tsx';
const HOMEWORK_ID = '64b7c3a2e4b0f96d1a2c3d40';
const PRACTICE_ID = '64b7c3a2e4b0f96d1a2c3d41';
const ACM_ID = '64b7c3a2e4b0f96d1a2c3d42';
const EXAM_ID = '64b7c3a2e4b0f96d1a2c3d43';
const OI_ID = '64b7c3a2e4b0f96d1a2c3d44';
const SCHOOL_ID = '64b7c3a2e4b0f96d1a2c3d50';
const SEAT_INVITE_CODE = 'seat-invite';
const CREATE_SEAT_LABEL = '创建考试活动并安排座位';

const PRACTICE_HEADING = '练习的高级功能';
const SETTINGS_HEADING = '设置';
// PLAN gives this sentence to both the practice panel and every other type's settings panel.
const ADVANCED_DESCRIPTION = '大多数情况用不到这些。';
const RELATED_HEADING = '相关页面';
const RELATED_DESCRIPTION = '这些页面保持原样，在新标签页打开。';

const STAGE_TITLE = '阶段与先修';
const STAGE_DESCRIPTION = '把题目分成几个阶段，学生做完前一阶段才能进入下一阶段。';
const INTEGRITY_TITLE = '真实性训练策略';
const INTEGRITY_DESCRIPTION = '禁外部代码注入、移除独立提交表单、防 AI 复制注入。发布后不可改。';
const VIGIL_TITLE = '机房监考（Vigil）与入场方式';
const VIGIL_DESCRIPTION = '普通网页可进入 / 必须通过客户端进入；审批方式；网络锁。';
const BATCH_TITLE = '队伍批次预绑定';
const BATCH_DESCRIPTION = '赛前把一个组队批次预绑定到这场比赛。';
const VERIFIER_TITLE = '验证人';
const VERIFIER_DESCRIPTION = '开赛前帮你检查题目和数据的人。';
const OTHER_TITLE = '其它设置';
const SEAT_TITLE = '座位与机房';
const SEAT_DESCRIPTION = '排座位、预登录、考场网络。';
const STAR_TITLE = '指定打星名单';
const STAR_DESCRIPTION = '只对个人 ACM / IOI。';

const USERS_TITLE = '参赛选手';
const USERS_DESCRIPTION = '查看报名名单、手动加人、处理打星。';
const CLARIFICATION_TITLE = '答疑与公告';
const CLARIFICATION_DESCRIPTION = '回复学生提问，向全体广播通知。';
const GRADING_TITLE = '主观题阅卷';
const GRADING_DESCRIPTION = '逐题给主观题打分。';
const TEAMS_TITLE = '队伍与组队批次';
const TEAMS_DESCRIPTION = '赛前组队、锁定阵容、生成队伍快照。';
const BALLOON_TITLE = '气球分发';
const BALLOON_DESCRIPTION = '现场赛气球。';
const PRINT_TITLE = '打印服务';
const PRINT_DESCRIPTION = '现场打印代码。';
const CODE_TITLE = '导出代码';
const CODE_DESCRIPTION = '下载全部提交代码。';
const FILES_TITLE = '附件文件';
const FILES_DESCRIPTION = '公开文件给学生下载，私有材料只有管理者能看。';
const PRACTICE_FILES_DESCRIPTION = '给学生下载的资料。';
const REDEMPTION_TITLE = '兑换码';
const REDEMPTION_DESCRIPTION = '让名单外的人通过兑换码进入整个练习或某个阶段。';

const LINK_TITLES = [
  USERS_TITLE,
  CLARIFICATION_TITLE,
  GRADING_TITLE,
  TEAMS_TITLE,
  STAR_TITLE,
  BALLOON_TITLE,
  PRINT_TITLE,
  CODE_TITLE,
  FILES_TITLE,
  REDEMPTION_TITLE,
  SEAT_TITLE,
] as const;

const KNOWN_TITLES = new Set<string>([
  ...LINK_TITLES,
  STAGE_TITLE,
  INTEGRITY_TITLE,
  VIGIL_TITLE,
  BATCH_TITLE,
  VERIFIER_TITLE,
  OTHER_TITLE,
  SEAT_TITLE,
]);

interface AdvancedTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface SectionSpec {
  title: string;
  description?: string;
}

interface RelatedRow {
  title: string;
  description: string;
  href: string;
}

interface RecordedCall {
  method: string;
  pathname: string;
  search: string;
}

interface RoutedCall {
  method: string;
  url: URL;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent<Props>(value: unknown, key: string): ComponentType<Props> {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as ComponentType<Props>;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (!key.endsWith(TAB_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadAdvancedTab(): Promise<ComponentType<AdvancedTabProps>> {
  const load = tabLoader();
  expect(typeof load, TAB_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('advanced tab module must be an object');
  return asComponent<AdvancedTabProps>(readField(imported, 'AdvancedTab'), 'AdvancedTab');
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(documents: Record<string, Record<string, unknown>>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, pathname: url.pathname, search: url.search });
    return routeFetch(documents, { method, url });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function routeFetch(documents: Record<string, Record<string, unknown>>, call: RoutedCall): Response {
  if (call.method === 'GET' && call.url.pathname.startsWith('/practice-integrity/')) {
    return jsonResponse({ published: null, draft: null });
  }
  if (call.method === 'GET' && call.url.pathname === '/api/admin/exam-events') {
    return jsonResponse({ events: [], schools: [] });
  }
  const document = documents[call.url.pathname];
  if (call.method === 'GET' && document) return jsonResponse(document);
  if (call.method === 'POST' && document) return jsonResponse({ ok: true });
  return jsonResponse({
    error: { message: `不该请求 ${call.method} ${call.url.pathname}` },
  }, 404);
}

function pageBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-16T00:00:00.000Z',
    user: {
      id: 4,
      name: 'wang',
      mail: 'wang@example.com',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'teacher',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: true,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      problems: '/p',
      contests: '/contest',
      homework: '/homework',
      training: '/training',
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
      domainDashboard: '/domain',
      domainPermission: '/domain/perm',
      manage: '/manage',
      status: '/status',
      problemDetail: '/p/:pid',
      contestDetail: '/contest/:tid',
      homeworkDetail: '/homework/:tid',
      trainingDetail: '/training/:tid',
      discussionDetail: '/discuss/:did',
      discussionNode: '/discuss/node/:node',
      userDetail: '/user/:uid',
      recordDetail: '/record/:rid',
    },
    udict: {},
    page: { templateName: 'teach_workbench.html', data: {} },
  };
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function bodyText(): string {
  return normalized(document.body.textContent);
}

interface SeatAudienceFixture {
  inviteCode: string;
  participantScopeMode: 'schools';
  participantSchoolIds: string[];
}

function contestDocument(
  id: string,
  rule: string,
  team: boolean,
  manageBatches: boolean,
  seat?: SeatAudienceFixture,
): Record<string, unknown> {
  // Serialized contest edit JSON drops tdoc._code. The invite code is only the top-level inviteCode.
  const tdoc: Record<string, unknown> = {
    _id: id,
    title: '题目集',
    content: '说明',
    rule,
    beginAt: '2026-10-20T01:00:00.000Z',
    endAt: '2026-10-20T03:00:00.000Z',
    pids: [11],
    participationMode: team ? 'team' : 'individual',
    vigilEnabled: false,
  };
  if (seat) {
    tdoc.participantScopeMode = seat.participantScopeMode;
    tdoc.participantSchoolIds = [...seat.participantSchoolIds];
  }
  const raw: Record<string, unknown> = {
    page_name: 'contest_edit',
    inviteCode: seat?.inviteCode ?? 'keep-invite',
    duration: 2,
    pids: [11],
    beginAt: '2026-10-20T01:00:00.000Z',
    participationRevision: 1,
    teamModeClearConfirmation: '',
    scopeSchools: [],
    scopeGroups: [],
    canAutoHideProblems: false,
    activeTeamCount: 0,
    recordCount: 0,
    canManageTeamBatches: manageBatches,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
    tdoc,
  };
  parseContestSnapshot(raw);
  return raw;
}

function homeworkDocument(id: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    page_name: 'homework_edit',
    extensionDays: 0,
    penaltyRules: {},
    dateBeginText: '2026-10-20',
    timeBeginText: '09:00',
    datePenaltyText: '2026-10-27',
    timePenaltyText: '23:59',
    participantScopeMode: 'none',
    participantGroupIds: [],
    scopeGroups: [],
    tdoc: {
      _id: id,
      title: '题目集',
      content: '说明',
      pids: [11],
    },
  };
  parseHomeworkSnapshot(raw);
  return raw;
}

function practiceDocument(id: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    page_name: 'problem_set_edit',
    groups: [],
    audience: { public: false, groupIds: ['g1'] },
    dag: [{ _id: 2, title: '入门', requireNids: [], pids: [11] }],
    tdoc: {
      _id: id,
      title: '题目集',
      content: '说明',
      description: '简介',
      pin: false,
    },
  };
  parsePracticeSnapshot(raw);
  return raw;
}

function baseLinks(type: TeachType, id: string): TeachLinks {
  if (type === 'practice') {
    return {
      studentView: `/problem-sets/${id}`,
      scoreboard: null,
      manage: null,
      users: null,
      clarification: null,
      grading: null,
      teams: null,
      balloon: null,
      print: null,
      code: null,
      files: `/problem-sets/${id}/file`,
      redemption: null,
    };
  }
  if (type === 'homework') {
    return {
      studentView: `/homework/${id}`,
      scoreboard: `/homework/${id}/scoreboard`,
      manage: null,
      users: null,
      clarification: null,
      grading: null,
      teams: null,
      balloon: null,
      print: null,
      code: null,
      files: `/homework/${id}/file`,
      redemption: null,
    };
  }
  return {
    studentView: `/contest/${id}`,
    scoreboard: `/contest/${id}/scoreboard`,
    manage: `/contest/${id}/management`,
    users: `/contest/${id}/user`,
    clarification: `/contest/${id}/clarification`,
    grading: null,
    teams: null,
    balloon: null,
    print: null,
    code: null,
    files: `/contest/${id}/management`,
    redemption: null,
  };
}

function capabilities(manageBatches: boolean): TeachCapabilities {
  return {
    canDelete: true,
    canShare: true,
    canGrade: false,
    canManageTeamBatches: manageBatches,
    isSystemAdmin: false,
    canPin: false,
  };
}

function workbench(options: {
  type: TeachType;
  id: string;
  rule: string;
  team?: boolean;
  manageBatches?: boolean;
  links?: Partial<TeachLinks>;
}): TeachWorkbenchPayload {
  const team = options.team ?? false;
  const manageBatches = options.manageBatches ?? false;
  return {
    container: {
      type: options.type,
      id: options.id,
      rule: options.rule,
      title: '题目集',
      status: options.type === 'practice' ? 'open' : 'upcoming',
      beginAt: options.type === 'practice' ? null : '2026-10-20T01:00:00.000Z',
      endAt: options.type === 'practice' ? null : '2026-10-20T03:00:00.000Z',
      durationMinutes: null,
      penaltySince: options.type === 'homework' ? '2026-10-27T15:59:00.000Z' : null,
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 4, name: '王老师' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: team ? 'team' : 'individual',
      vigilEnabled: false,
      entryMode: 'open',
      links: { ...baseLinks(options.type, options.id), ...options.links },
    },
    paper: {
      problems: [],
      stages: options.type === 'practice'
        ? [{ id: 2, title: '入门', requireIds: [], pids: [11] }]
        : null,
      examPaperQuotas: null,
    },
    stats: {
      participantCount: 0,
      startedCount: null,
      finalizedCount: null,
      submittedCount: options.type === 'practice' ? null : 0,
      recordCount: options.type === 'practice' ? null : 0,
      audienceCount: null,
      problemStats: null,
    },
    capabilities: capabilities(manageBatches),
  };
}

function editDocument(value: TeachWorkbenchPayload, snapshotManageBatches: boolean): Record<string, unknown> {
  const { type, id, rule } = value.container;
  const team = value.container.participationMode === 'team';
  if (type === 'practice') return practiceDocument(id);
  if (type === 'homework') return homeworkDocument(id);
  return contestDocument(id, rule, team, snapshotManageBatches);
}

function renderTab(
  AdvancedTab: ComponentType<AdvancedTabProps>,
  value: TeachWorkbenchPayload,
  snapshotManageBatches = value.capabilities.canManageTeamBatches,
  editRaw?: Record<string, unknown>,
): RecordedCall[] {
  const calls = installFetch({
    [legacyEditPath(value.container.type, value.container.id)]: editRaw ?? editDocument(value, snapshotManageBatches),
  });
  render(
    <BootstrapProvider bootstrap={pageBootstrap()}>
      <WorkbenchDirtyProvider>
        <LegacySnapshotProvider type={value.container.type} id={value.container.id}>
          <AdvancedTab payload={value} onNavigateTab={() => undefined} />
        </LegacySnapshotProvider>
      </WorkbenchDirtyProvider>
    </BootstrapProvider>,
  );
  return calls;
}

function panelByHeading(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError(`panel ${title}`);
  return panel;
}

function panelDescription(panel: HTMLElement): string {
  const header = panel.querySelector('header');
  const text = header?.querySelector('p');
  return normalized(text?.textContent);
}

function expectFlush(panel: HTMLElement): void {
  const header = panel.querySelector('header');
  const body = header?.nextElementSibling;
  if (!(body instanceof HTMLElement)) throw new TypeError('panel body');
  expect(classTokens(body)).not.toContain('p-4');
}

function expectPanel(title: string, description: string): HTMLElement {
  const panel = panelByHeading(title);
  expect(panelDescription(panel)).toBe(description);
  expectFlush(panel);
  return panel;
}

function summaryTitle(summary: Element): string {
  const title = [...summary.querySelectorAll('*')].find((node) => {
    const tokens = classTokens(node);
    const text = normalized(node.textContent);
    return text.length > 0 && tokens.includes('text-sm') && tokens.includes('font-medium') && KNOWN_TITLES.has(text);
  });
  if (!(title instanceof Element)) throw new TypeError(`summary title in ${normalized(summary.textContent)}`);
  return normalized(title.textContent);
}

function summaryTitles(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll('summary')].map((summary) => summaryTitle(summary));
}

function summaryOf(panel: HTMLElement, title: string): HTMLElement {
  const found = [...panel.querySelectorAll('summary')].find((summary) => summaryTitle(summary) === title);
  if (!(found instanceof HTMLElement)) throw new TypeError(`summary ${title}`);
  return found;
}

function expectIconBox(summary: HTMLElement): void {
  const icon = [...summary.querySelectorAll('*')].find((node) => {
    const tokens = classTokens(node);
    return tokens.includes('size-8') && tokens.includes('rounded-md') && tokens.includes('bg-surface-active');
  });
  expect(icon).toBeInstanceOf(Element);
}

function chevronOf(summary: HTMLElement): Element {
  const chevron = [...summary.querySelectorAll('svg')].find((node) => classTokens(node).includes('lucide-chevron-right'));
  if (!(chevron instanceof Element)) throw new TypeError('chevron');
  expect(chevron.tagName.toLowerCase()).toBe('svg');
  return chevron;
}

function expectChevron(summary: HTMLElement): void {
  chevronOf(summary);
}

function expectChevronRotated(summary: HTMLElement): void {
  const tokens = classTokens(chevronOf(summary));
  expect(tokens.some((token) => token.split(':').includes('rotate-90'))).toBe(true);
}

function expectFocusRing(summary: HTMLElement): void {
  const marked = [summary, ...summary.querySelectorAll('*')].some((node) => (
    classTokens(node).some((token) => token.includes('focus-visible'))
  ));
  expect(marked).toBe(true);
}

function expectPadding(details: HTMLDetailsElement): void {
  const padded = [...details.querySelectorAll('*')].find((node) => {
    if (node.closest('summary')) return false;
    const tokens = classTokens(node);
    return tokens.includes('px-4') && tokens.includes('pb-4');
  });
  expect(padded).toBeInstanceOf(Element);
}

function expectSections(panel: HTMLElement, sections: readonly SectionSpec[]): void {
  const details = [...panel.querySelectorAll('details')].filter((node): node is HTMLDetailsElement => (
    node instanceof HTMLDetailsElement
  ));
  expect(details).toHaveLength(sections.length);
  const parent = details[0]?.parentElement;
  if (sections.length > 0) {
    if (!(parent instanceof HTMLElement)) throw new TypeError('section list');
    expect(classTokens(parent)).toContain('divide-y');
    expect(classTokens(parent)).toContain('divide-line-subtle');
    for (const node of details) expect(node.parentElement).toBe(parent);
  }
  expect(summaryTitles(panel)).toEqual(sections.map((section) => section.title));
  for (const section of sections) {
    const summary = summaryOf(panel, section.title);
    if (section.description) expect(normalized(summary.textContent)).toContain(section.description);
    expectIconBox(summary);
    expectChevron(summary);
    expectFocusRing(summary);
    const detailsNode = summary.parentElement;
    if (!(detailsNode instanceof HTMLDetailsElement)) throw new TypeError(section.title);
    expectPadding(detailsNode);
  }
}

function relatedAnchors(panel: HTMLElement): HTMLAnchorElement[] {
  return [...panel.querySelectorAll('a')].filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
}

function linkTitle(anchor: HTMLElement): string {
  const text = normalized(anchor.textContent);
  const found = LINK_TITLES.filter((title) => text.includes(title));
  expect(found, text).toHaveLength(1);
  const title = found[0];
  if (!title) throw new TypeError(text);
  return title;
}

function expectExternalAnchor(anchor: HTMLAnchorElement): void {
  expect(anchor).toHaveAttribute('target', '_blank');
  expect((anchor.getAttribute('rel') ?? '').split(/\s+/).filter((token) => token.length > 0)).toContain('noopener');
  const icon = [...anchor.querySelectorAll('svg')].find((node) => classTokens(node).includes('lucide-external-link'));
  if (!(icon instanceof Element)) throw new TypeError(`external icon ${normalized(anchor.textContent)}`);
  expect(icon.tagName.toLowerCase()).toBe('svg');
}

function expectRelated(panel: HTMLElement, rows: readonly RelatedRow[], starHref: string | null): void {
  expect(panel.querySelector('details')).toBeNull();
  const anchors = relatedAnchors(panel);
  for (const anchor of anchors) expectExternalAnchor(anchor);
  const titles = anchors.map((anchor) => linkTitle(anchor));
  expect(titles.filter((title) => title !== STAR_TITLE)).toEqual(rows.map((item) => item.title));
  for (const item of rows) {
    const anchor = anchors.filter((candidate) => linkTitle(candidate) === item.title)[0];
    if (!(anchor instanceof HTMLAnchorElement)) throw new TypeError(item.title);
    expect(anchor).toHaveAttribute('href', item.href);
    expect(normalized(anchor.textContent)).toContain(item.description);
  }
  const starIndex = titles.indexOf(STAR_TITLE);
  if (starIndex >= 0) {
    if (typeof starHref !== 'string') throw new TypeError(STAR_TITLE);
    const star = anchors[starIndex];
    if (!(star instanceof HTMLAnchorElement)) throw new TypeError(STAR_TITLE);
    expect(star).toHaveAttribute('href', starHref);
    expect(normalized(star.textContent)).toContain(STAR_DESCRIPTION);
    expect([CLARIFICATION_TITLE, TEAMS_TITLE]).toContain(titles[starIndex - 1]);
  }
}

function linkRow(title: string, description: string, href: string | null): RelatedRow | null {
  if (!href) return null;
  return { title, description, href };
}

function rowsOf(items: Array<RelatedRow | null>): RelatedRow[] {
  return items.filter((item): item is RelatedRow => item !== null);
}

function contestRows(links: TeachLinks, type: TeachType): RelatedRow[] {
  return rowsOf([
    linkRow(USERS_TITLE, USERS_DESCRIPTION, links.users),
    linkRow(CLARIFICATION_TITLE, CLARIFICATION_DESCRIPTION, links.clarification),
    type === 'exam' ? linkRow(GRADING_TITLE, GRADING_DESCRIPTION, links.grading) : null,
    type === 'acm' ? linkRow(TEAMS_TITLE, TEAMS_DESCRIPTION, links.teams) : null,
    type === 'acm' ? linkRow(BALLOON_TITLE, BALLOON_DESCRIPTION, links.balloon) : null,
    type === 'homework' ? null : linkRow(PRINT_TITLE, PRINT_DESCRIPTION, links.print),
    type === 'homework' ? null : linkRow(CODE_TITLE, CODE_DESCRIPTION, links.code),
    linkRow(FILES_TITLE, FILES_DESCRIPTION, links.files),
  ]);
}

function sectionBodyText(panel: HTMLElement, title: string): string {
  const summary = summaryOf(panel, title);
  const details = summary.parentElement;
  if (!(details instanceof HTMLElement)) throw new TypeError(title);
  const parts: string[] = [];
  for (const child of details.children) {
    if (child.tagName.toLowerCase() === 'summary') continue;
    const text = normalized(child.textContent);
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

function teamBatchBodyReady(text: string): boolean {
  if (text.includes('赛前组队批次')) return true;
  return /组队/.test(text) && /先|打开|开启|需要|须/.test(text);
}

async function openSection(user: UserEvent, panel: HTMLElement, title: string): Promise<void> {
  const summary = summaryOf(panel, title);
  const details = summary.parentElement;
  if (!(details instanceof HTMLDetailsElement)) throw new TypeError(title);
  if (!details.open) await user.click(summary);
  expect(details.open).toBe(true);
  expectChevronRotated(summary);
}

const CONTEST_SECTIONS: SectionSpec[] = [
  { title: VIGIL_TITLE, description: VIGIL_DESCRIPTION },
  { title: VERIFIER_TITLE, description: VERIFIER_DESCRIPTION },
  { title: OTHER_TITLE },
];

describe('advanced tab', () => {
  it('builds legacy edit fixtures that the snapshot parser accepts', () => {
    parseHomeworkSnapshot(homeworkDocument(HOMEWORK_ID));
    parsePracticeSnapshot(practiceDocument(PRACTICE_ID));
    parseContestSnapshot(contestDocument(ACM_ID, 'acm', true, true));
    parseContestSnapshot(contestDocument(EXAM_ID, 'exam', false, true));
    parseContestSnapshot(contestDocument(EXAM_ID, 'exam', false, false, {
      inviteCode: SEAT_INVITE_CODE,
      participantScopeMode: 'schools',
      participantSchoolIds: [SCHOOL_ID],
    }));
    parseContestSnapshot(contestDocument(OI_ID, 'oi', true, true));
  });

  it('shows only the related-pages panel for homework and hides print and code', async () => {
    const value = workbench({
      type: 'homework',
      id: HOMEWORK_ID,
      rule: 'homework',
      links: {
        users: `/homework/${HOMEWORK_ID}/user`,
        clarification: `/homework/${HOMEWORK_ID}/clarification`,
        grading: `/manage/grading/${HOMEWORK_ID}`,
        print: `/homework/${HOMEWORK_ID}/print`,
        code: `/homework/${HOMEWORK_ID}/code`,
      },
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value);

    expect(await screen.findByRole('heading', { name: RELATED_HEADING })).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: SETTINGS_HEADING })).toBeNull();
    expect(screen.queryByRole('heading', { name: PRACTICE_HEADING })).toBeNull();
    expect(document.querySelector('details')).toBeNull();
    expect(bodyText()).not.toContain(PRINT_TITLE);
    expect(bodyText()).not.toContain(CODE_TITLE);
    expect(bodyText()).not.toContain(GRADING_TITLE);
    expect(bodyText()).not.toContain(VIGIL_TITLE);
    expect(bodyText()).not.toContain(BATCH_TITLE);
    expect(bodyText()).not.toContain(STAGE_TITLE);

    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, contestRows(value.container.links, 'homework'), null);
    expect(relatedAnchors(related).map((anchor) => anchor.getAttribute('href'))).not.toContain(`/homework/${HOMEWORK_ID}/print`);
    expect(relatedAnchors(related).map((anchor) => anchor.getAttribute('href'))).not.toContain(`/manage/grading/${HOMEWORK_ID}`);
  });

  it('shows practice stage and integrity sections and keeps redemption with the files link', async () => {
    const value = workbench({
      type: 'practice',
      id: PRACTICE_ID,
      rule: 'problem_set',
      links: {
        users: `/problem-sets/${PRACTICE_ID}/user`,
        print: `/problem-sets/${PRACTICE_ID}/print`,
        code: `/problem-sets/${PRACTICE_ID}/code`,
        redemption: '/manage/redemption-codes',
      },
    });
    const AdvancedTab = await loadAdvancedTab();
    const calls = renderTab(AdvancedTab, value);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: PRACTICE_HEADING })).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: SETTINGS_HEADING })).toBeNull();
    const settings = expectPanel(PRACTICE_HEADING, ADVANCED_DESCRIPTION);
    expectSections(settings, [
      { title: STAGE_TITLE, description: STAGE_DESCRIPTION },
      { title: INTEGRITY_TITLE, description: INTEGRITY_DESCRIPTION },
    ]);
    expect(bodyText()).not.toContain(VIGIL_TITLE);
    expect(bodyText()).not.toContain(PRINT_TITLE);
    expect(bodyText()).not.toContain(USERS_TITLE);

    await openSection(user, settings, STAGE_TITLE);
    expect(await screen.findByPlaceholderText('阶段名称')).toBeTruthy();
    expect(screen.getByRole('button', { name: '加一个阶段' })).toBeTruthy();

    await openSection(user, settings, INTEGRITY_TITLE);
    expect(await screen.findByText('禁止粘贴或拖入外部代码')).toBeTruthy();
    await waitFor(() => {
      expect(calls.some((call) => (
        call.method === 'GET' && call.pathname === `/practice-integrity/problemSet/${PRACTICE_ID}`
      ))).toBe(true);
    });

    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, [
      { title: REDEMPTION_TITLE, description: REDEMPTION_DESCRIPTION, href: '/manage/redemption-codes' },
      { title: FILES_TITLE, description: PRACTICE_FILES_DESCRIPTION, href: `/problem-sets/${PRACTICE_ID}/file` },
    ], null);
  });

  it('hides the redemption row when the practice link is null', async () => {
    const value = workbench({
      type: 'practice',
      id: PRACTICE_ID,
      rule: 'problem_set',
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value);

    expect(await screen.findByRole('heading', { name: RELATED_HEADING })).toBeTruthy();
    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, [
      { title: FILES_TITLE, description: PRACTICE_FILES_DESCRIPTION, href: value.container.links.files },
    ], null);
    expect(bodyText()).not.toContain(REDEMPTION_TITLE);
  });

  it('hides team-batch prebind for acm when canManageTeamBatches is false', async () => {
    const value = workbench({
      type: 'acm',
      id: ACM_ID,
      rule: 'acm',
      team: true,
      manageBatches: false,
      links: {
        balloon: `/contest/${ACM_ID}/balloon`,
        print: `/contest/${ACM_ID}/print`,
        code: `/contest/${ACM_ID}/code`,
        grading: `/manage/grading/${ACM_ID}`,
      },
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value, true);

    expect(await screen.findByRole('heading', { name: SETTINGS_HEADING })).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(2);
    const settings = expectPanel(SETTINGS_HEADING, ADVANCED_DESCRIPTION);
    expectSections(settings, CONTEST_SECTIONS);
    expect(bodyText()).not.toContain(BATCH_TITLE);
    expect(bodyText()).not.toContain('赛前组队批次');
    expect(bodyText()).not.toContain(SEAT_TITLE);
    expect(bodyText()).not.toContain(GRADING_TITLE);

    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, contestRows(value.container.links, 'acm'), value.container.links.users);
    expect(relatedAnchors(related).every((anchor) => anchor.getAttribute('target') === '_blank')).toBe(true);
  });

  it('shows team-batch prebind for acm when canManageTeamBatches is true', async () => {
    const value = workbench({
      type: 'acm',
      id: ACM_ID,
      rule: 'acm',
      team: true,
      manageBatches: true,
      links: {
        teams: `/contest/${ACM_ID}/team`,
        balloon: `/contest/${ACM_ID}/balloon`,
        print: `/contest/${ACM_ID}/print`,
        code: `/contest/${ACM_ID}/code`,
      },
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value, true);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: SETTINGS_HEADING })).toBeTruthy();
    const settings = expectPanel(SETTINGS_HEADING, ADVANCED_DESCRIPTION);
    expectSections(settings, [
      CONTEST_SECTIONS[0],
      { title: BATCH_TITLE, description: BATCH_DESCRIPTION },
      CONTEST_SECTIONS[1],
      CONTEST_SECTIONS[2],
    ]);
    await openSection(user, settings, BATCH_TITLE);
    expect(await screen.findByText('赛前组队批次')).toBeTruthy();

    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, contestRows(value.container.links, 'acm'), value.container.links.users);
    const titles = relatedAnchors(related).map((anchor) => linkTitle(anchor)).filter((title) => title !== STAR_TITLE);
    expect(titles).toEqual([
      USERS_TITLE,
      CLARIFICATION_TITLE,
      TEAMS_TITLE,
      BALLOON_TITLE,
      PRINT_TITLE,
      CODE_TITLE,
      FILES_TITLE,
    ]);
  });

  it('does not leave individual acm team-batch prebind blank', async () => {
    const value = workbench({
      type: 'acm',
      id: ACM_ID,
      rule: 'acm',
      team: false,
      manageBatches: true,
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value, true);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: SETTINGS_HEADING })).toBeTruthy();
    const settings = expectPanel(SETTINGS_HEADING, ADVANCED_DESCRIPTION);
    expectSections(settings, [
      CONTEST_SECTIONS[0],
      { title: BATCH_TITLE, description: BATCH_DESCRIPTION },
      CONTEST_SECTIONS[1],
      CONTEST_SECTIONS[2],
    ]);
    await openSection(user, settings, BATCH_TITLE);
    await waitFor(() => {
      const text = sectionBodyText(settings, BATCH_TITLE);
      if (!teamBatchBodyReady(text)) {
        throw new Error(`个人 ACM 的队伍批次预绑定展开后没有说明或控件：${text || '（空）'}`);
      }
    });
  });

  it('lists exam sections in order and drops null related links', async () => {
    const value = workbench({
      type: 'exam',
      id: EXAM_ID,
      rule: 'exam',
      manageBatches: true,
      links: {
        grading: `/manage/grading/${EXAM_ID}`,
        balloon: `/contest/${EXAM_ID}/balloon`,
        teams: `/contest/${EXAM_ID}/team`,
      },
    });
    const AdvancedTab = await loadAdvancedTab();
    const calls = renderTab(AdvancedTab, value, true);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: SETTINGS_HEADING })).toBeTruthy();
    const settings = expectPanel(SETTINGS_HEADING, ADVANCED_DESCRIPTION);
    expectSections(settings, [
      ...CONTEST_SECTIONS,
      { title: SEAT_TITLE, description: SEAT_DESCRIPTION },
    ]);
    expect(bodyText()).not.toContain(BATCH_TITLE);
    expect(bodyText()).not.toContain(PRINT_TITLE);
    expect(bodyText()).not.toContain(CODE_TITLE);
    expect(bodyText()).not.toContain(BALLOON_TITLE);
    expect(bodyText()).not.toContain(TEAMS_TITLE);

    await openSection(user, settings, VIGIL_TITLE);
    expect(await screen.findByText('启用 Vigil 反作弊')).toBeTruthy();
    await openSection(user, settings, VERIFIER_TITLE);
    expect(await screen.findByText('验比赛人')).toBeTruthy();
    await openSection(user, settings, OTHER_TITLE);
    expect(await screen.findByText('允许语言（留空为全部）')).toBeTruthy();
    await openSection(user, settings, SEAT_TITLE);
    expect(await screen.findByText('机房座位与赛前预启动')).toBeTruthy();
    await waitFor(() => {
      expect(calls.some((call) => (
        call.method === 'GET'
        && call.pathname === '/api/admin/exam-events'
        && new URLSearchParams(call.search).get('contestId') === EXAM_ID
      ))).toBe(true);
    });

    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, contestRows(value.container.links, 'exam'), value.container.links.users);
  });

  it('refuses automatic seating for an invite-code exam limited to one school', async () => {
    const value = workbench({
      type: 'exam',
      id: EXAM_ID,
      rule: 'exam',
    });
    const editRaw = contestDocument(EXAM_ID, 'exam', false, false, {
      inviteCode: SEAT_INVITE_CODE,
      participantScopeMode: 'schools',
      participantSchoolIds: [SCHOOL_ID],
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value, false, editRaw);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: SETTINGS_HEADING })).toBeTruthy();
    const settings = expectPanel(SETTINGS_HEADING, ADVANCED_DESCRIPTION);
    await openSection(user, settings, SEAT_TITLE);
    await waitFor(() => {
      const warning = screen.queryByText(/仅邀请码/);
      const create = screen.queryByRole('button', { name: CREATE_SEAT_LABEL });
      if (!warning || create) {
        throw new Error(`邀请码考试不应安排座位；warning=${Boolean(warning)} create=${Boolean(create)}`);
      }
    });
  });

  it('lists oi sections without seats or team-batch prebind', async () => {
    const value = workbench({
      type: 'oi',
      id: OI_ID,
      rule: 'oi',
      team: true,
      manageBatches: true,
      links: {
        grading: `/manage/grading/${OI_ID}`,
        balloon: `/contest/${OI_ID}/balloon`,
        teams: `/contest/${OI_ID}/team`,
        print: `/contest/${OI_ID}/print`,
        code: `/contest/${OI_ID}/code`,
      },
    });
    const AdvancedTab = await loadAdvancedTab();
    renderTab(AdvancedTab, value, true);

    expect(await screen.findByRole('heading', { name: SETTINGS_HEADING })).toBeTruthy();
    const settings = expectPanel(SETTINGS_HEADING, ADVANCED_DESCRIPTION);
    expectSections(settings, CONTEST_SECTIONS);
    expect(bodyText()).not.toContain(BATCH_TITLE);
    expect(bodyText()).not.toContain(SEAT_TITLE);
    expect(bodyText()).not.toContain(GRADING_TITLE);
    expect(bodyText()).not.toContain(BALLOON_TITLE);
    expect(bodyText()).not.toContain(TEAMS_TITLE);

    const related = expectPanel(RELATED_HEADING, RELATED_DESCRIPTION);
    expectRelated(related, contestRows(value.container.links, 'oi'), value.container.links.users);
    expect(relatedAnchors(related).every((anchor) => anchor.getAttribute('target') === '_blank')).toBe(true);
  });
});
