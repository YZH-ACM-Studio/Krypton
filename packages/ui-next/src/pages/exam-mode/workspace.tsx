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
import { motion } from 'motion/react';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Eye,
  ListChecks,
  Lock,
  MessageCircle,
  Printer,
  Trophy,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTime } from '@/components/ui/datetime';
import { ExamHomeShell } from '@/components/layout/exam-shell';
import { MarkdownView } from '@/components/markdown-renderer';

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
  const examMode = (data as any).examMode || {};
  const urls = examMode.urls || {};

  const ruleLabel = RULE_LABEL[tdoc.rule] || tdoc.rule;
  const now = Date.now();
  const begin = new Date(tdoc.beginAt).getTime();
  const end = new Date(tdoc.endAt).getTime();
  const inWindow = begin <= now && now < end;
  const notStarted = now < begin;
  const ended = now >= end;
  const shouldHideProblems = notStarted && !previewMode;

  return (
    <div className="space-y-6">
        {previewMode && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <Eye className="size-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-medium text-amber-700 dark:text-amber-200">管理员预览模式</p>
              <p className="text-amber-700/80 dark:text-amber-200/80">
                未通过 Qt Client 接入。不会创建 Vigil 会话；提交按钮已禁用。
              </p>
            </div>
          </div>
        )}

        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-xl border bg-card p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs">{ruleLabel}</Badge>
            {notStarted && <Badge variant="outline" className="border-blue-500/40 text-blue-500">未开始</Badge>}
            {inWindow && <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">进行中</Badge>}
            {ended && <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">已结束</Badge>}
            {tdoc.entryMode === 'client_required' && (
              <Badge variant="outline" className="border-rose-500/40 text-rose-500">客户端强制</Badge>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-semibold">{tdoc.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              <DateTime value={tdoc.beginAt} />
              <span>～</span>
              <DateTime value={tdoc.endAt} />
            </span>
          </div>
        </motion.header>

        {tdoc.content && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4" />
                比赛说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MarkdownView content={tdoc.content} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4" />
              题目列表
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shouldHideProblems ? (
              <div className="flex items-start gap-3 rounded-lg border border-blue-500/25 bg-blue-500/5 p-4 text-sm">
                <Lock className="mt-0.5 size-4 shrink-0 text-blue-500" />
                <div className="space-y-1">
                  <p className="font-medium text-blue-700 dark:text-blue-200">考试尚未开始</p>
                  <p className="text-muted-foreground">
                    题目将在 <DateTime value={tdoc.beginAt} /> 后开放，请先停留在概览等待开赛。
                  </p>
                </div>
              </div>
            ) : (!tdoc.pids || tdoc.pids.length === 0) ? (
              <p className="text-sm text-muted-foreground">该比赛没有题目</p>
            ) : (
              <ul className="divide-y">
                {tdoc.pids.map((pid, index) => {
                  const pdoc = pdict[String(pid)];
                  const label = getAlphabeticId(index);
                  const href = urls.problem
                    ? String(urls.problem).replace('__PID__', String(pid))
                    : `/p/${pid}?tid=${tid}`;
                  return (
                    <li key={pid}>
                      <a
                        href={href}
                        className="flex items-center gap-3 py-3 hover:bg-muted/40"
                      >
                        <span className="font-mono text-sm font-semibold text-muted-foreground">{label}</span>
                        <span className="flex-1 truncate text-sm">{pdoc?.title || `P${pid}`}</span>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Button asChild variant="outline" className="justify-start gap-2 h-auto py-3">
            <a href={urls.ranking || `/contest/${tid}/scoreboard`}>
              <Trophy className="size-4" />
              榜单
            </a>
          </Button>
          <Button asChild variant="outline" className="justify-start gap-2 h-auto py-3">
            <a href={urls.announcements || `/contest/${tid}/clarification`}>
              <MessageCircle className="size-4" />
              澄清
            </a>
          </Button>
          {tdoc.allowPrint && !shouldHideProblems && (
            <Button asChild variant="outline" className="justify-start gap-2 h-auto py-3">
              <a href={urls.print || `/contest/${tid}/print`}>
                <Printer className="size-4" />
                打印
              </a>
            </Button>
          )}
          {/* Legacy standalone workspace only. Client shell keeps personal submissions inside the IDE/history panel. */}
          {!examMode.enabled ? <Button asChild variant="outline" className="justify-start gap-2 h-auto py-3">
            <a href={`/record?tid=${tid}&uidOrName=${currentUserId}`}>
              <Code className="size-4" />
              我的提交
            </a>
          </Button> : null}
        </div>

        {ended && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" />
            该比赛已经结束。仍可查看题目与榜单，但无法提交。
          </div>
        )}
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
