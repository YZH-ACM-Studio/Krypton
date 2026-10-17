import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TeachType } from '@hydrooj/common';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../src/lib/bootstrap.tsx';
import { PRIV } from '../../src/lib/perms.ts';
import { parseContestSnapshot } from '../../src/pages/teach/legacy-forms.ts';
import type { TeachWorkbenchPayload } from '../../src/pages/teach/model.ts';
import { LegacySnapshotProvider } from '../../src/pages/teach/settings-kit.tsx';

// A static import fails collection while contest-sections.tsx is absent.
const sectionLoaders = import.meta.glob('../../src/pages/teach/advanced/contest-sections.tsx');

const SECTION_SOURCE = 'src/pages/teach/advanced/contest-sections.tsx';
const SECTION_FILE = resolve(import.meta.dirname, '../../src/pages/teach/advanced/contest-sections.tsx');
const CONTEST_ID = '64b7c3a2e4b0f96d1a2c3d4e';
const BEGIN_ISO = '2026-10-16T06:30:00.000Z';
const TITLE = '机考联调';
const PIDS = '8,9';
const EDIT_PATH = `/contest/${CONTEST_ID}/edit`;
const RESYNC_PATH = `/d/system/api/admin/vigilguard/resync/${CONTEST_ID}`;
const BATCH_ID = '64b7c3a2e4b0f96d1a2c3d42';
const LIVE_LABEL = '实时屏幕直播';
const CAMERA_LABEL = '摄像头直播（防替考）';
const RESYNC_LABEL = '重新同步到 Vigil';
const SAVE_LABEL = '保存这一段';
const READINESS_LABEL = '运行检查';
const RATING_LABEL = '计入 Rating';
const VIGIL_FIELD_NAMES = [
  'vigilEnabled',
  'entryMode',
  'approvalMode',
  'lockdownMode',
  'networkLockdownMode',
  'networkLockdownFailurePolicy',
  'networkWhitelistHosts',
  'networkWhitelistIps',
  'networkWhitelistPorts',
  'pauseOnDisconnect',
  'screenshotIntervalMs',
  'exclusive',
  'clientLoginBlockBeforeMinutes',
  'clientLoginBlockAfterMinutes',
  'liveEnabled',
  'recordEnabled',
  'cameraEnabled',
  'screenshotJitterMs',
  'vigilProcessWhitelist',
] as const;

interface SectionProps {
  payload: TeachWorkbenchPayload;
}

interface RecordedCall {
  method: string;
  pathname: string;
  body: string;
}

interface RoutedCall {
  method: string;
  url: URL;
  body: string;
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

function sectionLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(sectionLoaders)) {
    if (key.endsWith(SECTION_SOURCE)) return load;
  }
  return undefined;
}

async function loadSection(name: string): Promise<ComponentType<SectionProps>> {
  const load = sectionLoader();
  expect(typeof load, SECTION_SOURCE).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${SECTION_SOURCE} must exist`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError('contest sections module must be an object');
  return asComponent(readField(imported, name), name);
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

async function readRequestBody(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }
    return params.toString();
  }
  if (body instanceof Blob) return body.text();
  return '';
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(snapshot: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = await readRequestBody(init?.body);
    const call: RoutedCall = { method, url, body };
    calls.push({ method, pathname: url.pathname, body });
    return routeFetch(snapshot, call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function routeFetch(snapshot: Record<string, unknown>, call: RoutedCall): Response {
  if (call.method === 'GET' && call.url.pathname === EDIT_PATH) return jsonResponse(snapshot);
  if (call.method === 'POST' && new URLSearchParams(call.body).get('operation') === 'check_team_readiness') {
    return jsonResponse({
      ok: true,
      readiness: {
        result: 'pass',
        teamCount: 2,
        memberCount: 5,
        canFinalize: false,
        canStart: true,
        items: [],
      },
    });
  }
  if (call.method === 'POST' && call.url.pathname === RESYNC_PATH) return jsonResponse({ ok: true, vigilEnabled: true });
  if (call.method === 'POST' && call.url.pathname === EDIT_PATH) return jsonResponse({ tid: CONTEST_ID });
  return jsonResponse({ error: `unexpected ${call.method} ${call.url.pathname}` }, 404);
}

function pageBootstrap(priv: number): KryptonBootstrap {
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
      priv,
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

function contestEdit(tdocPatch: Record<string, unknown>, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const tdoc: Record<string, unknown> = {
    _id: CONTEST_ID,
    title: TITLE,
    content: '说明',
    rule: 'acm',
    beginAt: BEGIN_ISO,
    endAt: '2026-10-16T09:30:00.000Z',
    pids: [8, 9],
    vigilEnabled: true,
    liveEnabled: true,
    cameraEnabled: true,
    recordEnabled: false,
    participationMode: 'individual',
    ...tdocPatch,
  };
  return {
    page_name: 'contest_edit',
    inviteCode: 'abc123',
    duration: 3,
    pids: PIDS,
    beginAt: BEGIN_ISO,
    participationRevision: 1,
    teamModeClearConfirmation: '',
    scopeSchools: [],
    scopeGroups: [],
    canAutoHideProblems: true,
    activeTeamCount: 0,
    recordCount: 0,
    canManageTeamBatches: false,
    canUpdatePlannedTeamBatch: false,
    teamBatches: [],
    ...extras,
    tdoc,
  };
}

function workbench(options: {
  type: TeachType;
  rule: string;
  team: boolean;
  systemAdmin: boolean;
  manageBatches: boolean;
}): TeachWorkbenchPayload {
  return {
    container: {
      type: options.type,
      id: CONTEST_ID,
      rule: options.rule,
      title: TITLE,
      status: 'upcoming',
      beginAt: BEGIN_ISO,
      endAt: '2026-10-16T09:30:00.000Z',
      durationMinutes: 180,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 4, name: 'wang' },
      maintainers: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: options.team ? 'team' : 'individual',
      vigilEnabled: true,
      entryMode: 'open',
      links: {
        studentView: `/contest/${CONTEST_ID}`,
        scoreboard: `/contest/${CONTEST_ID}/scoreboard`,
        manage: `/contest/${CONTEST_ID}/management`,
        users: `/contest/${CONTEST_ID}/user`,
        clarification: `/contest/${CONTEST_ID}/clarification`,
        grading: null,
        teams: options.team ? `/contest/${CONTEST_ID}/team` : null,
        balloon: null,
        print: null,
        code: null,
        files: `/contest/${CONTEST_ID}/management`,
        redemption: null,
      },
    },
    paper: { problems: [], stages: null, examPaperQuotas: null },
    stats: {
      participantCount: 0,
      startedCount: null,
      finalizedCount: null,
      submittedCount: 0,
      recordCount: 0,
      audienceCount: null,
      problemStats: null,
    },
    capabilities: {
      canDelete: true,
      canShare: true,
      canGrade: false,
      canManageTeamBatches: options.manageBatches,
      isSystemAdmin: options.systemAdmin,
      canPin: false,
    },
  };
}

function checkedSnapshot(raw: Record<string, unknown>): Record<string, unknown> {
  parseContestSnapshot(raw);
  return raw;
}

function renderSection(Section: ComponentType<SectionProps>, type: TeachType, payload: TeachWorkbenchPayload, priv: number) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(priv)}>
      <LegacySnapshotProvider type={type} id={CONTEST_ID}>
        <Section payload={payload} />
      </LegacySnapshotProvider>
    </BootstrapProvider>,
  );
}

function updateBody(calls: RecordedCall[]): URLSearchParams | null {
  const posted = calls.find((call) => {
    if (call.method !== 'POST' || call.pathname !== EDIT_PATH) return false;
    return new URLSearchParams(call.body).get('operation') === 'update';
  });
  return posted ? new URLSearchParams(posted.body) : null;
}

describe('vigil entry section', () => {
  it('keeps every vigil field name from the old contest form', () => {
    expect(existsSync(SECTION_FILE), SECTION_FILE).toBe(true);
    const source = readFileSync(SECTION_FILE, 'utf8');
    expect(source).toContain('function VigilEntrySection');
    for (const name of VIGIL_FIELD_NAMES) expect(source, name).toContain(name);
  });

  it('hides the resync control from a teacher who is not a system admin', async () => {
    const raw = checkedSnapshot(contestEdit({}));
    const Section = await loadSection('VigilEntrySection');
    installFetch(raw);
    renderSection(Section, 'acm', workbench({
      type: 'acm',
      rule: 'acm',
      team: false,
      systemAdmin: false,
      manageBatches: false,
    }), 0);
    expect(await screen.findByText('启用 Vigil 反作弊')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RESYNC_LABEL })).toBeNull();
    expect(screen.queryByRole('heading', { name: RESYNC_LABEL })).toBeNull();
  });

  it('posts the existing vigil resync route when a system admin clicks it', async () => {
    const raw = checkedSnapshot(contestEdit({}));
    const Section = await loadSection('VigilEntrySection');
    const calls = installFetch(raw);
    renderSection(Section, 'acm', workbench({
      type: 'acm',
      rule: 'acm',
      team: false,
      systemAdmin: true,
      manageBatches: false,
    }), PRIV.PRIV_EDIT_SYSTEM);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: RESYNC_LABEL }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.pathname === RESYNC_PATH)).toBe(true);
    });
  });

  it('turns a client-required contest back to a normal page and keeps Vigil on', async () => {
    const raw = checkedSnapshot(contestEdit({ entryMode: 'client_required', vigilEnabled: true }));
    const Section = await loadSection('VigilEntrySection');
    installFetch(raw);
    renderSection(Section, 'acm', workbench({
      type: 'acm',
      rule: 'acm',
      team: false,
      systemAdmin: false,
      manageBatches: false,
    }), 0);
    const user = userEvent.setup();
    const vigil = await screen.findByRole('switch', { name: '启用 Vigil 反作弊' });
    expect(vigil).toBeChecked();
    await user.click(vigil);
    expect(vigil).toBeChecked();
    expect(screen.getByText('普通网页可进入（Vigil 可选）')).toBeInTheDocument();
  });

  it('saves cleared live and camera switches as false and keeps the snapshot title and pids', async () => {
    const raw = checkedSnapshot(contestEdit({}));
    const Section = await loadSection('VigilEntrySection');
    const calls = installFetch(raw);
    renderSection(Section, 'acm', workbench({
      type: 'acm',
      rule: 'acm',
      team: false,
      systemAdmin: false,
      manageBatches: false,
    }), 0);
    const user = userEvent.setup();
    const live = await screen.findByRole('switch', { name: LIVE_LABEL });
    const camera = screen.getByRole('switch', { name: CAMERA_LABEL });
    expect(live).toBeChecked();
    expect(camera).toBeChecked();
    await user.click(live);
    await user.click(camera);
    await user.click(screen.getByRole('button', { name: SAVE_LABEL }));
    await waitFor(() => expect(updateBody(calls)).not.toBeNull());
    const body = updateBody(calls);
    if (!body) throw new Error('missing contest update');
    expect(body.get('liveEnabled')).toBe('false');
    expect(body.get('cameraEnabled')).toBe('false');
    expect(body.get('title')).toBe(TITLE);
    expect(body.get('pids')).toBe(PIDS);
  });
});

describe('planned team batch section', () => {
  it('disables the batch selector when updates are closed and posts the readiness check', async () => {
    const raw = checkedSnapshot(contestEdit(
      { rule: 'acm', participationMode: 'team' },
      {
        canManageTeamBatches: true,
        canUpdatePlannedTeamBatch: false,
        teamBatches: [{
          batchId: BATCH_ID,
          name: '第一批',
          status: 'open',
          teamCount: 2,
          memberCount: 5,
        }],
      },
    ));
    const Section = await loadSection('PlannedTeamBatchSection');
    const calls = installFetch(raw);
    renderSection(Section, 'acm', workbench({
      type: 'acm',
      rule: 'acm',
      team: true,
      systemAdmin: false,
      manageBatches: true,
    }), 0);
    const user = userEvent.setup();
    expect(await screen.findByRole('combobox')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: READINESS_LABEL }));
    await waitFor(() => {
      expect(calls.some((call) => (
        call.method === 'POST' && new URLSearchParams(call.body).get('operation') === 'check_team_readiness'
      ))).toBe(true);
    });
  });
});

describe('other contest settings section', () => {
  it('shows the rating switch for an oi contest and hides it for an exam', async () => {
    const oi = checkedSnapshot(contestEdit({ rule: 'oi' }));
    const Section = await loadSection('OtherContestSettingsSection');
    installFetch(oi);
    const first = renderSection(Section, 'oi', workbench({
      type: 'oi',
      rule: 'oi',
      team: false,
      systemAdmin: false,
      manageBatches: false,
    }), 0);
    expect(await screen.findByText(RATING_LABEL)).toBeInTheDocument();
    first.unmount();

    const exam = checkedSnapshot(contestEdit({ rule: 'exam' }));
    installFetch(exam);
    renderSection(Section, 'exam', workbench({
      type: 'exam',
      rule: 'exam',
      team: false,
      systemAdmin: false,
      manageBatches: false,
    }), 0);
    expect(await screen.findByRole('button', { name: SAVE_LABEL })).toBeInTheDocument();
    expect(screen.queryByText(RATING_LABEL)).toBeNull();
  });
});
