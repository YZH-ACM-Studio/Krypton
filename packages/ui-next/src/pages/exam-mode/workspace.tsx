/**
 * Contest Workspace — the universal `/exam-mode/:tid` page for all rules
 * EXCEPT `exam` (which falls back to the existing paper UI).
 *
 * The workspace shows the minimum a student needs while running under
 * the Qt Client: contest header, problem list, jump-out links to the
 * existing per-contest scoreboard / clarification / print / my-submissions
 * routes. It intentionally does NOT show the full site nav — the Qt
 * Client expects this to be a single-purpose shell.
 *
 * Admin preview mode is signaled by `data.previewMode === true`. When
 * true, we show a banner explaining "this is preview, no Vigil session
 * created" and disable any action button that would write data.
 */
import { BookOpen, ChevronRight, Clock, Code, ListChecks, MessageCircle, Printer, Trophy, Users } from 'lucide-react';
import { ExamHomeShell } from '@/components/layout/exam-shell';
import { MarkdownView } from '@/components/markdown-renderer';
import { readTeamExamModeContext, TeamExamModeSummary } from '@/components/team-exam-mode';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateTime } from '@/components/ui/datetime';
import { StatusDot } from '@/components/ui/display';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

function getAlphabeticId(index: number) {
  if (index < 0) return '?';
  let n = index + 1;
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

interface WorkspaceTdoc {
  docId: string;
  _id?: string;
  title: string;
  rule: string;
  entryMode?: 'open' | 'client_required';
  beginAt: string;
  endAt: string;
  content?: string;
  pids?: number[];
  allowPrint?: boolean;
  allowViewCode?: boolean;
}

interface WorkspaceData {
  tdoc: WorkspaceTdoc;
  pdict: Record<string, { docId: number; pid?: string; title: string }>;
  previewMode?: boolean;
  currentUserId?: number;
  examMode?: unknown;
}

const RULE_LABEL: Record<string, string> = {
  acm: 'XCPC',
  oi: 'OI',
  ioi: 'IOI',
  strictioi: 'IOI Strict',
  ledo: 'Ledo',
  homework: '作业',
};

export function ContestWorkspaceContent() {
  const bs = useBootstrap();
  const data = bs.page.data as WorkspaceData;
  const tdoc = data.tdoc;
  const pdict = data.pdict || {};
  const previewMode = !!data.previewMode;
  const currentUserId = data.currentUserId || bs.user?.id;
  const tid = String(tdoc._id || tdoc.docId);
  const examMode = data.examMode || {};
  const examModeRecord =
    examMode && typeof examMode === 'object' && !Array.isArray(examMode)
      ? (examMode as { enabled?: unknown; urls?: Record<string, string> })
      : {};
  const urls = examModeRecord.urls || {};
  const teamContext = readTeamExamModeContext(examMode);
  const adminPreview = previewMode || teamContext?.teamRole === 'admin_preview';

  const ruleLabel = RULE_LABEL[tdoc.rule] || tdoc.rule;
  const now = Date.now();
  const begin = new Date(tdoc.beginAt).getTime();
  const end = new Date(tdoc.endAt).getTime();
  const inWindow = begin <= now && now < end;
  const notStarted = now < begin;
  const ended = now >= end;

  return (
    <div className="space-y-6">
      {adminPreview ? (
        <Alert tone="warning" title="管理员预览模式">
          未通过 Qt Client 接入。不会创建 Vigil 会话；提交按钮已禁用。
        </Alert>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Badge variant="outline" className="font-mono">
            {ruleLabel}
          </Badge>
          {notStarted ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-fg">
              <StatusDot tone="info" />
              未开始
            </span>
          ) : null}
          {inWindow ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-fg">
              <StatusDot tone="success" pulse />
              进行中
            </span>
          ) : null}
          {ended ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
              <StatusDot />
              已结束
            </span>
          ) : null}
          {tdoc.entryMode === 'client_required' ? <Badge variant="outline">客户端强制</Badge> : null}
        </div>
        <div className="mt-3 min-w-0 break-words">
          <h2 className="text-lg font-semibold">{tdoc.title}</h2>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-fg-muted">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Clock className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <DateTime value={tdoc.beginAt} />
            <span>～</span>
            <DateTime value={tdoc.endAt} />
          </span>
        </div>
      </Panel>

      {teamContext?.teamInfo ? (
        <div data-team-exam-workspace={teamContext.teamRole}>
          <Panel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
                  <Users className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{teamContext.teamInfo.name}</p>
                  <p className="text-xs text-fg-subtle">
                    {teamContext.teamInfo.memberUids.length} 人队伍 · <TeamExamModeSummary context={teamContext} includeTeamName={false} />
                  </p>
                </div>
              </div>
              {teamContext.teamRole === 'member' ? (
                <Badge variant="soft" tone="warning" className="self-start">
                  可看题与本队记录，不可运行或提交
                </Badge>
              ) : null}
            </div>
          </Panel>
        </div>
      ) : null}

      {tdoc.content ? (
        <Panel
          title={(
            <span className="inline-flex items-center gap-2">
              <BookOpen className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              比赛说明
            </span>
          )}
        >
          <MarkdownView content={tdoc.content} />
        </Panel>
      ) : null}

      <Panel
        title={(
          <span className="inline-flex items-center gap-2">
            <ListChecks className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            题目列表
          </span>
        )}
      >
        {!tdoc.pids || tdoc.pids.length === 0 ? (
          <p className="text-sm text-fg-muted">该比赛没有题目</p>
        ) : (
          <ul className="divide-y divide-line">
            {tdoc.pids.map((pid, index) => {
              const pdoc = pdict[String(pid)];
              const label = getAlphabeticId(index);
              const href = urls.problem ? String(urls.problem).replace('__PID__', String(pid)) : `/p/${pid}?tid=${tid}`;
              return (
                <li key={pid} className="min-w-0">
                  <a
                    href={href}
                    className="flex min-w-0 items-center gap-3 rounded-sm py-3 outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="shrink-0 font-mono text-sm font-semibold text-fg-subtle">{label}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{pdoc?.title || `P${pid}`}</span>
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="secondary" className="w-full justify-start">
          <a href={urls.ranking || `/contest/${tid}/scoreboard`}>
            <Trophy />
            榜单
          </a>
        </Button>
        <Button asChild variant="secondary" className="w-full justify-start">
          <a href={urls.announcements || `/contest/${tid}/clarification`}>
            <MessageCircle />
            澄清
          </a>
        </Button>
        {tdoc.allowPrint ? (
          <Button asChild variant="secondary" className="w-full justify-start">
            <a href={urls.print || `/contest/${tid}/print`}>
              <Printer />
              打印
            </a>
          </Button>
        ) : null}
        {/* Legacy standalone workspace only. Client shell keeps personal submissions inside the IDE/history panel. */}
        {!examModeRecord.enabled ? (
          <Button asChild variant="secondary" className="w-full justify-start">
            <a href={`/record?tid=${tid}&uidOrName=${currentUserId}`}>
              <Code />
              我的提交
            </a>
          </Button>
        ) : null}
      </div>

      {ended ? <Alert tone="neutral">该比赛已经结束。仍可查看题目与榜单，但无法提交。</Alert> : null}
    </div>
  );
}

export function ContestWorkspacePage() {
  return (
    <ExamHomeShell>
      <ContestWorkspaceContent />
    </ExamHomeShell>
  );
}
