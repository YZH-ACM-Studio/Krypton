import { useState, useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  Edit3,
  FileText,
  HardDrive,
  MessageSquare,
  Send,
  Tag,
  Trophy,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs-compound';
import { MarkdownView } from '@/components/markdown-renderer';
import { KryptonIDE } from '@/components/krypton-ide';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusBadge(status: number | undefined) {
  if (status === 1)
    return (
      <Badge className="gap-1 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
        <CheckCircle2 className="size-3" />
        已通过
      </Badge>
    );
  if (status === 2)
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" />
        未通过
      </Badge>
    );
  return null;
}

function formatMemory(kb: number | undefined): string {
  if (!kb) return '—';
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

function difficultyBadge(d: number | undefined) {
  if (!d) return null;
  const colors: Record<number, string> = {
    1: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    2: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    3: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    4: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
    5: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };
  const labels: Record<number, string> = { 1: '入门', 2: '普及', 3: '提高', 4: '省选', 5: 'NOI' };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${colors[d] || 'bg-muted'}`}>
      {labels[d] || `Lv.${d}`}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Resizable split pane                                               */
/* ------------------------------------------------------------------ */

function ResizableSplit({
  left,
  right,
  defaultLeftPercent = 40,
  minPercent = 20,
  maxPercent = 80,
}: {
  left: ReactNode;
  right: ReactNode;
  defaultLeftPercent?: number;
  minPercent?: number;
  maxPercent?: number;
}) {
  const [leftPct, setLeftPct] = useState(defaultLeftPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.max(minPercent, Math.min(maxPercent, pct)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [minPercent, maxPercent]);

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      <div style={{ width: `${leftPct}%` }} className="shrink-0 overflow-hidden">
        {left}
      </div>
      <div
        className="w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div className="flex-1 overflow-hidden">
        {right}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Info bar — dense row of stats                                      */
/* ------------------------------------------------------------------ */

function InfoChip({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Limits table per language                                          */
/* ------------------------------------------------------------------ */

const LANG_DISPLAY: Record<string, string> = {
  c: 'C',
  cc: 'C++',
  'cc.cc98': 'C++98',
  'cc.cc11': 'C++11',
  'cc.cc14': 'C++14',
  'cc.cc17': 'C++17',
  'cc.cc20': 'C++20',
  'cc.cc23': 'C++23',
  java: 'Java',
  py3: 'Python 3',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  js: 'JavaScript',
  rb: 'Ruby',
  cs: 'C#',
  pas: 'Pascal',
  php: 'PHP',
  hs: 'Haskell',
  kt: 'Kotlin',
  _: '任意语言',
};

function LimitsSection({ config }: { config: R }) {
  if (typeof config === 'string' || !config) return null;

  const timeMin = config.timeMin;
  const timeMax = config.timeMax;
  const memMin = config.memoryMin;
  const memMax = config.memoryMax;
  const langs: string[] = config.langs || [];

  const hasVariation = timeMin !== timeMax || memMin !== memMax;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Cpu className="size-3.5" />
        限制
      </h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <div>
            <p className="text-[11px] text-muted-foreground">时间</p>
            <p className="font-mono text-xs font-medium">
              {hasVariation && timeMin !== timeMax
                ? `${formatTime(timeMin)} — ${formatTime(timeMax)}`
                : formatTime(timeMax || timeMin)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <HardDrive className="size-3.5 text-muted-foreground" />
          <div>
            <p className="text-[11px] text-muted-foreground">内存</p>
            <p className="font-mono text-xs font-medium">
              {hasVariation && memMin !== memMax
                ? `${formatMemory(memMin)} — ${formatMemory(memMax)}`
                : formatMemory(memMax || memMin)}
            </p>
          </div>
        </div>
      </div>
      {langs.length > 0 && (
        <div className="pt-1">
          <p className="mb-1 text-[11px] text-muted-foreground">允许的语言</p>
          <div className="flex flex-wrap gap-1">
            {langs.map((l) => (
              <Badge key={l} variant="outline" className="text-[10px] px-1.5 py-0">
                {LANG_DISPLAY[l] || l}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ProblemDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const udoc: R = data.udoc || {};
  const psdoc: R = data.psdoc || {};
  const config: R = typeof pdoc.config === 'object' ? pdoc.config : {};
  const title = pdoc.title || pdoc.pid || '题目';
  const content = pdoc.content || '';
  const nSubmit = pdoc.nSubmit || 0;
  const nAccept = pdoc.nAccept || 0;
  const tags: string[] = pdoc.tag || [];
  const pid = pdoc.pid || pdoc.docId || '';
  const difficulty = pdoc.difficulty;
  const solutionCount = data.solutionCount || 0;
  const discussionCount = data.discussionCount || 0;
  const ctdocs: R[] = data.ctdocs || [];
  const htdocs: R[] = data.htdocs || [];
  const rate = nSubmit > 0 ? Math.round((nAccept / nSubmit) * 100) : 0;

  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const [ideMode, setIdeMode] = useState(false);
  const submitUrl = `${problemUrl}/submit`;
  const problemCanPretest = config.type === 'default' || config.type === undefined || config.type == null;
  const ideCacheKey = `${bs.user?.id || 0}/${bs.domain?.id || 'default'}/${pid}`;
  const preferredLang = bs.locale?.startsWith('zh') ? 'zh' : 'en';

  /* Fullscreen IDE mode */
  if (ideMode) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {/* IDE top bar */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
          <Code2 className="size-4 text-primary" />
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">— {pid}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setIdeMode(false)}
          >
            <X className="size-3.5" />
            退出 IDE
          </Button>
        </div>
        {/* Resizable split view */}
        <ResizableSplit
          left={
            <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Problem header */}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold leading-tight">{title}</h1>
                  {statusBadge(psdoc.status)}
                  {difficultyBadge(difficulty)}
                </div>
                {tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                        <Tag className="mr-0.5 size-2.5" />
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Info chips */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2">
                <InfoChip icon={User} label="出题人" value={udoc.uname || `UID ${udoc._id || '?'}`} />
                <InfoChip icon={Send} label="提交" value={nSubmit} />
                <InfoChip icon={CheckCircle2} label="通过" value={<span className="text-green-600 dark:text-green-400">{nAccept}</span>} />
                <InfoChip icon={Trophy} label="通过率" value={`${rate}%`} />
              </div>

              {/* Limits */}
              <LimitsSection config={config} />

              {/* Problem statement */}
              <MarkdownView content={content} preferredLang={preferredLang} />
            </div>
          }
          right={
            <KryptonIDE
              langs={config.langs || []}
              defaultLang={config.langs?.[0]}
              submitUrl={submitUrl}
              canPretest={problemCanPretest}
              cacheKey={ideCacheKey}
              className="h-full rounded-none border-0"
            />
          }
          defaultLeftPercent={40}
        />
      </div>
    );
  }

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Breadcrumb + title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <a href={bs.urls.problems} className="hover:text-primary">题库</a>
            <ChevronRight className="size-3" />
            <span className="font-mono">{pid}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-lg font-bold leading-tight sm:text-xl">{title}</h1>
            {statusBadge(psdoc.status)}
            {difficultyBadge(difficulty)}
          </div>
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
                  <Tag className="mr-0.5 size-2.5" />
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="default" className="gap-1" onClick={() => setIdeMode(true)}>
            <Code2 className="size-3.5" />
            IDE 模式
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`${problemUrl}/submit`}>
              <Send className="mr-1 size-3.5" />
              提交
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={`${problemUrl}/edit`}>
              <Edit3 className="mr-1 size-3.5" />
              编辑
            </a>
          </Button>
        </div>
      </div>

      {/* Dense info bar */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2">
        <InfoChip icon={Send} label="提交" value={nSubmit} />
        <InfoChip icon={CheckCircle2} label="通过" value={<span className="text-green-600 dark:text-green-400">{nAccept}</span>} />
        <InfoChip icon={Trophy} label="通过率" value={`${rate}%`} />
        <InfoChip icon={User} label="出题人" value={udoc.uname || `UID ${udoc._id || '?'}`} />
        {solutionCount > 0 && <InfoChip icon={BookOpen} label="题解" value={solutionCount} />}
        {discussionCount > 0 && <InfoChip icon={MessageSquare} label="讨论" value={discussionCount} />}
      </div>

      {/* Main content area: two-column layout */}
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* Left: Tabs for content / submit */}
        <div className="min-w-0">
          <Tabs defaultValue="statement">
            <TabsList>
              <TabsTrigger value="statement" className="gap-1 text-xs">
                <FileText className="size-3.5" />
                题面
              </TabsTrigger>
              <TabsTrigger value="submit" className="gap-1 text-xs">
                <Send className="size-3.5" />
                提交
              </TabsTrigger>
              {solutionCount > 0 && (
                <TabsTrigger value="solutions" className="gap-1 text-xs">
                  <BookOpen className="size-3.5" />
                  题解({solutionCount})
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="statement" className="mt-3">
              <Card>
                <CardContent className="p-4 sm:p-6">
                  <MarkdownView content={content} preferredLang={preferredLang} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="submit" className="mt-3">
              <Card>
                <CardContent className="p-0 overflow-hidden">
                  <KryptonIDE
                    langs={config.langs || []}
                    defaultLang={config.langs?.[0]}
                    submitUrl={submitUrl}
                    canPretest={problemCanPretest}
                    cacheKey={ideCacheKey}
                    minHeight={450}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="solutions" className="mt-3">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">
                    共 {solutionCount} 篇题解 —{' '}
                    <a href={`${problemUrl}/solution`} className="text-primary hover:underline">查看全部</a>
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: sidebar info panel */}
        <aside className="space-y-4">
          {/* Limits */}
          <Card>
            <CardContent className="p-4">
              <LimitsSection config={config} />
            </CardContent>
          </Card>

          {/* Related contests */}
          {(ctdocs.length > 0 || htdocs.length > 0) && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trophy className="size-3.5" />
                  相关比赛 & 作业
                </h3>
                <div className="space-y-1">
                  {[...ctdocs, ...htdocs].slice(0, 5).map((td) => (
                    <a
                      key={String(td._id)}
                      href={replaceRouteTokens(bs.urls.contestDetail, { TID: String(td._id) })}
                      className="block truncate text-xs text-primary hover:underline"
                    >
                      {td.title || String(td._id)}
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick links */}
          <Card>
            <CardContent className="p-4 space-y-1">
              <a href={`${problemUrl}/solution`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                <BookOpen className="size-3" />
                题解 ({solutionCount})
              </a>
              <a href={`${problemUrl}/discuss`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                <MessageSquare className="size-3" />
                讨论 ({discussionCount})
              </a>
              <a href={`${problemUrl}/statistics`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                <Trophy className="size-3" />
                统计
              </a>
              <a href={`${problemUrl}/files`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                <FileText className="size-3" />
                附件
              </a>
            </CardContent>
          </Card>
        </aside>
      </div>
    </motion.div>
  );
}
