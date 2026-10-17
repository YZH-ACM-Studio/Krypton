import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TeachType } from '@hydrooj/common';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { PRIV } from '../src/lib/perms.ts';
import { VigilEntrySection } from '../src/pages/teach/advanced/contest-sections.tsx';
import { parseContestSnapshot } from '../src/pages/teach/legacy-forms.ts';
import type { TeachWorkbenchPayload } from '../src/pages/teach/model.ts';
import { LegacySnapshotProvider, WorkbenchDirtyProvider } from '../src/pages/teach/settings-kit.tsx';

const workspace = resolve(import.meta.dirname, '../../..');
const CONTEST_ID = '66bf00000000000000000101';
const BEGIN_ISO = '2026-08-20T01:00:00.000Z';
const TITLE = '2026 校赛';
const EDIT_PATH = `/contest/${CONTEST_ID}/edit`;
const RESYNC_PATH = `/d/system/api/admin/vigilguard/resync/${CONTEST_ID}`;
const RESYNC_LABEL = '重新同步到 Vigil';
const RESYNC_ERROR = 'Vigil bridge: vigil.baseUrl not configured';

function source(path: string) {
  return readFileSync(resolve(workspace, path), 'utf8');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function contestEdit(): Record<string, unknown> {
  return {
    page_name: 'contest_edit',
    inviteCode: '',
    duration: 3,
    pids: '',
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
    tdoc: {
      _id: CONTEST_ID,
      title: TITLE,
      content: '说明',
      rule: 'acm',
      beginAt: BEGIN_ISO,
      endAt: '2026-08-20T04:00:00.000Z',
      pids: [],
      vigilEnabled: true,
      entryMode: 'client_required',
      participationMode: 'individual',
      owner: 2,
    },
  };
}

function pageBootstrap(priv: number): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-08-15T00:00:00.000Z',
    user: {
      id: 2,
      name: 'operator',
      mail: 'operator@example.com',
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

function workbench(systemAdmin: boolean): TeachWorkbenchPayload {
  return {
    container: {
      type: 'acm' satisfies TeachType,
      id: CONTEST_ID,
      rule: 'acm',
      title: TITLE,
      status: 'upcoming',
      beginAt: BEGIN_ISO,
      endAt: '2026-08-20T04:00:00.000Z',
      durationMinutes: 180,
      penaltySince: null,
      lockAt: null,
      audience: {
        mode: 'all',
        groupNames: [],
        schoolNames: [],
        boundStudentCount: null,
      },
      owner: { uid: 2, name: 'operator' },
      maintainers: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      schoolShared: null,
      copiedFrom: null,
      examPassScore: null,
      examAttemptLimit: null,
      participationMode: 'individual',
      vigilEnabled: true,
      entryMode: 'client_required',
      links: {
        studentView: `/contest/${CONTEST_ID}`,
        scoreboard: `/contest/${CONTEST_ID}/scoreboard`,
        manage: `/contest/${CONTEST_ID}/management`,
        users: `/contest/${CONTEST_ID}/user`,
        clarification: `/contest/${CONTEST_ID}/clarification`,
        grading: null,
        teams: null,
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
      canManageTeamBatches: false,
      isSystemAdmin: systemAdmin,
      canPin: false,
    },
  };
}

function renderSection(priv: number, systemAdmin: boolean) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(priv)}>
      <WorkbenchDirtyProvider>
        <LegacySnapshotProvider type="acm" id={CONTEST_ID}>
          <VigilEntrySection payload={workbench(systemAdmin)} />
        </LegacySnapshotProvider>
      </WorkbenchDirtyProvider>
    </BootstrapProvider>,
  );
}

function installFetch(snapshot: Record<string, unknown>, resyncStatus: number, resyncBody: unknown) {
  const posts: string[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url.pathname === EDIT_PATH) return jsonResponse(snapshot);
    if (method === 'POST' && url.pathname === RESYNC_PATH) {
      posts.push(url.pathname);
      return jsonResponse(resyncBody, resyncStatus);
    }
    return jsonResponse({ error: `unexpected ${method} ${url.pathname}` }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contest Vigil resync control', () => {
  it('keeps the existing PRIV_EDIT_SYSTEM resync route and does not surface tokens', () => {
    const sections = source('packages/ui-next/src/pages/teach/advanced/contest-sections.tsx');
    const manage = source('packages/ui-next/src/pages/contest-manage.tsx');
    const handler = source('packages/krypton-vigilguard/src/handler.ts');
    expect(sections).toContain('/api/admin/vigilguard/resync/');
    expect(sections).toContain('isSystemAdmin(bootstrap.user.priv)');
    expect(sections).toContain('将已保存的比赛配置重新推送到 Vigil。未保存的修改不会包含在内。');
    expect(sections).not.toContain('serviceToken');
    expect(sections).not.toContain('dashboardToken');
    expect(manage).not.toContain('VigilContestResyncControl');
    expect(manage).not.toContain('重新同步到 Vigil');
    expect(handler).toContain("ctx.Route('vigilguard_resync', '/api/admin/vigilguard/resync/:tid', VigilGuardResyncContestHandler, PRIV.PRIV_EDIT_SYSTEM)");
  });

  it('hides the resync control from contest teachers without PRIV_EDIT_SYSTEM', async () => {
    const raw = contestEdit();
    parseContestSnapshot(raw);
    installFetch(raw, 200, { ok: true, vigilEnabled: true });
    renderSection(0, false);
    expect(await screen.findByText('启用 Vigil 反作弊')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RESYNC_LABEL })).toBeNull();
    expect(screen.queryByRole('heading', { name: RESYNC_LABEL })).toBeNull();
  });

  it('lets a system admin POST the existing resync route for the current contest', async () => {
    const raw = contestEdit();
    parseContestSnapshot(raw);
    const posts = installFetch(raw, 200, { ok: true, vigilEnabled: true });
    renderSection(PRIV.PRIV_EDIT_SYSTEM, true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: RESYNC_LABEL }));
    await waitFor(() => expect(posts).toEqual([RESYNC_PATH]));
    expect(await screen.findByText('已将当前已保存的比赛配置重新推送到 Vigil。')).toBeInTheDocument();
  });

  it('shows the existing handler error when Vigil resync is rejected', async () => {
    const raw = contestEdit();
    parseContestSnapshot(raw);
    installFetch(raw, 502, { ok: false, error: RESYNC_ERROR });
    renderSection(PRIV.PRIV_EDIT_SYSTEM, true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: RESYNC_LABEL }));
    expect(await screen.findByText(RESYNC_ERROR)).toBeInTheDocument();
  });
});
