import { Bell, HelpCircle, Lock, MessageSquare, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { ExamContestShell } from '@/components/layout/exam-shell';
import { useBootstrap } from '@/lib/bootstrap';
import { formatRelativeTime } from '@/lib/format';
import { ContestScoreboardPage } from '@/pages/contests';
import { ContestPrintPage, ContestProblemListPage } from '@/pages/contest-manage';
import { DiscussionCreatePage } from '@/pages/discussion-manage';
import { DiscussionDetailPage, DiscussionsPage } from '@/pages/discussions';
import { ProblemDetailPage } from '@/pages/problem-detail';
import { RecordDetailPage } from '@/pages/records';
import { ContestWorkspaceContent } from '@/pages/exam-mode/workspace';

type R = Record<string, any>;

function clarificationSubjectLabel(tdoc: R, pdict: Record<string, R>, subject: unknown) {
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
  tc: R;
  tdoc: R;
  pdict: Record<string, R>;
  locale: string;
  kind: 'broadcast' | 'question';
}) {
  const isBroadcast = kind === 'broadcast';
  return (
    <Card key={String(tc._id)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {isBroadcast ? <Bell className="size-4 text-primary" /> : <MessageSquare className="size-4 text-primary" />}
          <Badge variant={isBroadcast ? 'default' : 'outline'}>
            {isBroadcast ? '比赛公告' : '我的提问'}
          </Badge>
          <Badge variant="outline">{clarificationSubjectLabel(tdoc, pdict, tc.subject)}</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {tc.updateAt ? formatRelativeTime(tc.updateAt, locale) : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <MarkdownView content={tc.content || ''} preferredLang={locale} />
        {Array.isArray(tc.reply) && tc.reply.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              {isBroadcast ? '补充说明' : '裁判回复'}
            </p>
            {tc.reply.map((reply: R, index: number) => (
              <div key={String(reply._id || index)} className="rounded-md bg-muted/40 p-3">
                <MarkdownView content={reply.content || ''} preferredLang={locale} />
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExamAnnouncementsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const tdoc: R = data.tdoc || {};
  const pdict: Record<string, R> = data.pdict || {};
  const tcdocs: R[] = data.tcdocs || [];
  const pids: Array<string | number> = Array.isArray(tdoc.pids) ? tdoc.pids : [];
  const broadcasts = tcdocs.filter((tc) => Number(tc.owner || 0) === 0);
  const questions = tcdocs.filter((tc) => Number(tc.owner || 0) !== 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">公告与答疑</h1>
        <p className="text-sm text-muted-foreground">{tdoc.title}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="size-4" />
            提交提问
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="clarification" />
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">主题</span>
              <select
                name="subject"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                defaultValue="0"
            >
              <option value="0">比赛整体</option>
              <option value="-1">技术问题</option>
              {pids.map((pid, index) => (
                <option key={String(pid)} value={String(pid)}>
                    {String.fromCharCode(65 + index)}. {pdict[String(pid)]?.title || `P${pid}`}
                  </option>
                ))}
              </select>
            </label>
            <MarkdownEditor name="content" value="" minHeight={150} preferredLang={bs.locale} />
            <Button type="submit" size="sm">
              <Send className="mr-1 size-3.5" />
              发送
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">比赛公告</h2>
          <p className="text-xs text-muted-foreground">裁判广播与公开说明</p>
        </div>
        {broadcasts.length ? broadcasts.map((tc) => (
          <ClarificationCard key={String(tc._id)} tc={tc} tdoc={tdoc} pdict={pdict} locale={bs.locale} kind="broadcast" />
        )) : (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <HelpCircle className="size-4" />
              暂无比赛公告
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">我的提问 / 答疑</h2>
          <p className="text-xs text-muted-foreground">仅显示与你相关的问题和回复</p>
        </div>
        {questions.length ? questions.map((tc) => (
          <ClarificationCard key={String(tc._id)} tc={tc} tdoc={tdoc} pdict={pdict} locale={bs.locale} kind="question" />
        )) : (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <HelpCircle className="size-4" />
              暂无我的提问
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

const START_GATED_TEMPLATES = new Set([
  'contest_problemlist.html',
  'problem_detail.html',
  'contest_print.html',
]);

function isContestBeforeStart(tdoc: R) {
  const begin = new Date(tdoc?.beginAt).getTime();
  return Number.isFinite(begin) && Date.now() < begin;
}

function BeforeStartGate({ tdoc }: { tdoc: R }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-blue-500" />
          考试尚未开始
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>题目、题面和打印将在开赛后开放。</p>
        {tdoc?.beginAt && (
          <p>
            开始时间：<DateTime value={tdoc.beginAt} />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function renderExamContestContent(template: string, data: R) {
  if (START_GATED_TEMPLATES.has(template) && isContestBeforeStart(data.tdoc || {}) && !data.previewMode) {
    return <BeforeStartGate tdoc={data.tdoc || {}} />;
  }

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
  const data = bs.page.data || {};
  const template = String(data.examMode?.contentTemplate || 'contest_workspace.html');
  return (
    <ExamContestShell>
      {renderExamContestContent(template, data)}
    </ExamContestShell>
  );
}
