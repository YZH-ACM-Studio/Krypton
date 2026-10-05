import { Bell, HelpCircle, MessageSquare, Send } from 'lucide-react';
import { ExamContestShell } from '@/components/layout/exam-shell';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { formatRelativeTime } from '@/lib/format';
import { ContestScoreboardPage } from '@/pages/contests';
import { ContestPrintPage, ContestProblemListPage } from '@/pages/contest-manage';
import { DiscussionCreatePage } from '@/pages/discussion-manage';
import { DiscussionDetailPage, DiscussionsPage } from '@/pages/discussions';
import { ContestWorkspaceContent } from '@/pages/exam-mode/workspace';
import { ProblemDetailPage } from '@/pages/problem-detail';
import { RecordDetailPage } from '@/pages/records';

interface ExamContestDocument {
  beginAt?: string | number | Date;
  pids?: Array<string | number>;
  title?: string;
}

interface ExamContestProblem {
  title?: string;
}

interface ClarificationReply {
  _id?: unknown;
  content?: string;
}

interface ClarificationDocument {
  _id?: unknown;
  subject?: unknown;
  updateAt?: unknown;
  content?: string;
  reply?: ClarificationReply[];
  owner?: unknown;
}

interface ExamContestPageData {
  canSubmitClarification?: boolean;
  examMode?: { contentTemplate?: string };
  tdoc?: ExamContestDocument;
  pdict?: Record<string, ExamContestProblem>;
  tcdocs?: ClarificationDocument[];
  previewMode?: boolean;
}

function clarificationSubjectLabel(tdoc: ExamContestDocument, pdict: Record<string, ExamContestProblem>, subject: unknown) {
  const key = String(subject ?? '0');
  if (!subject || key === '0') return '比赛整体';
  if (key === '-1') return '技术问题';
  const pids: Array<string | number> = Array.isArray(tdoc.pids) ? tdoc.pids : [];
  const index = pids.findIndex((pid) => String(pid) === key);
  const letter = index >= 0 ? String.fromCharCode(65 + index) : key;
  return `${letter}. ${pdict[key]?.title || `P${key}`}`;
}

function ClarificationCard({
  tc,
  tdoc,
  pdict,
  locale,
  kind,
}: {
  tc: ClarificationDocument;
  tdoc: ExamContestDocument;
  pdict: Record<string, ExamContestProblem>;
  locale: string;
  kind: 'broadcast' | 'question';
}) {
  const isBroadcast = kind === 'broadcast';
  return (
    <Panel
      title={(
        <span className="flex w-full min-w-0 flex-wrap items-center gap-2">
          {isBroadcast ? <Bell className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" /> : <MessageSquare className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />}
          <Badge variant="soft" tone={isBroadcast ? 'brand' : 'neutral'}>{isBroadcast ? '比赛公告' : '我的提问'}</Badge>
          <Badge variant="outline" className="max-w-full min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{clarificationSubjectLabel(tdoc, pdict, tc.subject)}</span>
          </Badge>
          <span className="text-xs font-normal text-fg-subtle">{tc.updateAt ? formatRelativeTime(tc.updateAt, locale) : ''}</span>
        </span>
      )}
    >
      <div className="space-y-3">
        <MarkdownView content={tc.content || ''} preferredLang={locale} />
        {Array.isArray(tc.reply) && tc.reply.length > 0 ? (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-xs font-medium text-fg-subtle">{isBroadcast ? '补充说明' : '裁判回复'}</p>
            {tc.reply.map((reply, index) => (
              <div key={String(reply._id || index)} className="rounded-md bg-surface-sunken p-3">
                <MarkdownView content={reply.content || ''} preferredLang={locale} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ExamAnnouncementsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ExamContestPageData;
  const tdoc = data.tdoc || {};
  const pdict = data.pdict || {};
  const tcdocs = data.tcdocs || [];
  const pids: Array<string | number> = Array.isArray(tdoc.pids) ? tdoc.pids : [];
  const broadcasts = tcdocs.filter((tc) => Number(tc.owner || 0) === 0);
  const questions = tcdocs.filter((tc) => Number(tc.owner || 0) !== 0);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">公告与答疑</h2>
        <p className="min-w-0 break-words text-sm text-fg-muted">{tdoc.title}</p>
      </div>

      {data.canSubmitClarification === true && data.previewMode !== true ? (
        <Panel
          title={(
            <span className="inline-flex items-center gap-2">
              <Send className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              提交提问
            </span>
          )}
        >
          <form method="post" className="space-y-5">
            <input type="hidden" name="operation" value="clarification" />
            <FormField label="主题" htmlFor="exam-clarification-subject">
              <SimpleSelect
                id="exam-clarification-subject"
                name="subject"
                defaultValue="0"
                options={[
                  { value: '0', label: '比赛整体' },
                  { value: '-1', label: '技术问题' },
                  ...pids.map((pid, index) => ({
                    value: String(pid),
                    label: `${String.fromCharCode(65 + index)}. ${pdict[String(pid)]?.title || `P${pid}`}`,
                  })),
                ]}
              />
            </FormField>
            <MarkdownEditor name="content" value="" minHeight={150} preferredLang={bs.locale} />
            <Button type="submit" size="sm" variant="primary">
              <Send />
              发送
            </Button>
          </form>
        </Panel>
      ) : null}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">比赛公告</h3>
          <p className="text-xs text-fg-subtle">裁判广播与公开说明</p>
        </div>
        {broadcasts.length ? (
          broadcasts.map((tc) => <ClarificationCard key={String(tc._id)} tc={tc} tdoc={tdoc} pdict={pdict} locale={bs.locale} kind="broadcast" />)
        ) : (
          <EmptyState compact icon={<HelpCircle />} title="暂无比赛公告" />
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">我的提问 / 答疑</h3>
          <p className="text-xs text-fg-subtle">仅显示与你相关的问题和回复</p>
        </div>
        {questions.length ? (
          questions.map((tc) => <ClarificationCard key={String(tc._id)} tc={tc} tdoc={tdoc} pdict={pdict} locale={bs.locale} kind="question" />)
        ) : (
          <EmptyState compact icon={<HelpCircle />} title="暂无我的提问" />
        )}
      </section>
    </div>
  );
}

function renderExamContestContent(template: string, _data: ExamContestPageData) {
  switch (template) {
    case 'contest_workspace.html':
      return <ContestWorkspaceContent />;
    case 'contest_problemlist.html':
      return <ContestProblemListPage />;
    case 'exam_announcements.html':
      return <ExamAnnouncementsPage />;
    case 'problem_detail.html':
      return <ProblemDetailPage />;
    case 'contest_scoreboard.html':
      return <ContestScoreboardPage />;
    case 'contest_print.html':
      return <ContestPrintPage />;
    case 'record_detail.html':
      return <RecordDetailPage />;
    case 'discussion_main_or_node.html':
      return <DiscussionsPage />;
    case 'discussion_detail.html':
      return <DiscussionDetailPage />;
    case 'discussion_create.html':
      return <DiscussionCreatePage />;
    default:
      return <ContestWorkspaceContent />;
  }
}

export function ExamContestPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ExamContestPageData;
  const template = String(data.examMode?.contentTemplate || 'contest_workspace.html');
  return <ExamContestShell>{renderExamContestContent(template, data)}</ExamContestShell>;
}
