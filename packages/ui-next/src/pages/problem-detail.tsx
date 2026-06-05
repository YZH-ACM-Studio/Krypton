import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
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
  History,
  Loader2,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs-compound';
import { MarkdownView } from '@/components/markdown-renderer';
import { KryptonIDE, type RecordEntry, getStatus, getLangEntry } from '@/components/krypton-ide';
import { useRecordSocket } from '@/hooks/use-record-socket';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { extractSamples, type SampleCase } from '@/lib/samples';
import { cn } from '@/lib/cn';

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

function formatTime(ms: number | undefined | null): string {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  if (!query) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
}

function normalizeId(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value && '$oid' in value) {
    return String((value as { $oid?: unknown }).$oid || '');
  }
  return String(value);
}

function objectIdTimestamp(value: unknown): number | null {
  const id = normalizeId(value);
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  return parseInt(id.slice(0, 8), 16) * 1000;
}

function dateTimestamp(value: unknown): number | null {
  if (!value) return null;
  const raw = typeof value === 'object' && value && '$date' in value
    ? (value as { $date?: unknown }).$date
    : value;
  const ts = new Date(raw as any).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function formatRecordTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mergeRecordEntries(...lists: RecordEntry[][]): RecordEntry[] {
  const byRid = new Map<string, RecordEntry>();
  lists.flat().forEach((entry) => {
    if (!entry.rid) return;
    const prev = byRid.get(entry.rid);
    byRid.set(entry.rid, prev ? { ...prev, ...entry, timestamp: entry.timestamp || prev.timestamp } : entry);
  });
  return Array.from(byRid.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

// Sentinel contest IDs for non-submission records — pretest and generate
// (see RecordModel.RECORD_PRETEST / RECORD_GENERATE on the backend). These
// records must never appear in the per-problem 提交记录 list — they are
// self-tests / system-internal runs, not real submissions.
const PRETEST_CONTEST_ID = '000000000000000000000000';
const GENERATE_CONTEST_ID = '000000000000000000000001';

function isPretestOrGenerate(rdoc: R): boolean {
  const contest = normalizeId(rdoc.contest);
  if (!contest) return false;
  return contest === PRETEST_CONTEST_ID || contest === GENERATE_CONTEST_ID;
}

function recordEntryFromRdoc(rdoc: R, recordDetailRoute: string): RecordEntry | null {
  const rid = normalizeId(rdoc._id ?? rdoc.rid);
  if (!rid) return null;
  // Defensive: even if the backend leaks a pretest/generate record
  // (older releases didn't filter the sentinel contest IDs), drop it
  // here so the IDE submission panel only ever lists real submissions.
  if (isPretestOrGenerate(rdoc)) return null;
  const status = Number(rdoc.status);
  const score = Number(rdoc.score);
  const recordUrl = replaceRouteTokens(recordDetailRoute, { RID: rid });
  return {
    rid,
    url: recordUrl || rdoc.url || `/record/${rid}`,
    lang: String(rdoc.lang || ''),
    status: Number.isFinite(status) ? status : 0,
    time: typeof rdoc.time === 'number' ? rdoc.time : undefined,
    memory: typeof rdoc.memory === 'number' ? rdoc.memory : undefined,
    score: Number.isFinite(score) ? score : undefined,
    timestamp: objectIdTimestamp(rdoc._id ?? rdoc.rid)
      ?? dateTimestamp(rdoc.submitAt ?? rdoc.judgeAt ?? rdoc.timestamp)
      ?? Date.now(),
  };
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

/** Contest entry banner with live countdown and a back-to-contest link. */
function ContestBanner({ tdoc, mode, letter, contestUrl }: {
  tdoc: R;
  mode: string;
  letter: string | null;
  contestUrl: string;
}) {
  const isHomework = tdoc.rule === 'homework';
  const begin = (() => {
    if (!tdoc.beginAt) return 0;
    const d = new Date(tdoc.beginAt);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  })();
  const end = (() => {
    if (!tdoc.endAt) return 0;
    const d = new Date(tdoc.endAt);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  })();
  const now = Date.now();
  const running = now >= begin && now < end;
  const ended = now >= end;

  // Live countdown when running
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  // Use tick to silence unused warning while letting state drive re-render
  void tick;

  const remaining = running ? Math.max(0, end - Date.now()) : 0;
  const remH = Math.floor(remaining / 3_600_000);
  const remM = Math.floor((remaining / 60_000) % 60);
  const remS = Math.floor((remaining / 1000) % 60);
  const pad = (n: number) => String(n).padStart(2, '0');

  const phaseColor = running
    ? 'border-green-300 bg-green-50/40 dark:border-green-900/50 dark:bg-green-950/20'
    : ended
      ? 'border-muted-foreground/20 bg-muted/30'
      : 'border-amber-300 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20';

  const modeBadge = (() => {
    switch (mode) {
      case 'contest': return <Badge variant="default" className="text-[10px]">比赛中</Badge>;
      case 'view': return <Badge variant="outline" className="text-[10px]">观看模式</Badge>;
      case 'correction': return <Badge variant="secondary" className="text-[10px]">订正模式</Badge>;
      case 'none': return null;
      default: return null;
    }
  })();

  return (
    <Card className={phaseColor}>
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <a href={contestUrl} className="flex items-center gap-1.5 text-sm font-medium hover:underline">
          <ChevronRight className="size-3.5 rotate-180" />
          返回 {isHomework ? '作业' : '比赛'}
        </a>
        <span className="text-muted-foreground">|</span>
        <span className="text-sm font-medium truncate min-w-0 max-w-[40ch]">{tdoc.title || '比赛'}</span>
        {letter ? (
          <Badge variant="outline" className="text-[10px] font-mono">题 {letter}</Badge>
        ) : null}
        {modeBadge}
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <span className="flex items-center gap-1 text-sm">
              <Clock className="size-3.5" />
              <span className="font-mono tabular-nums">
                {remH > 0 ? `${remH}:` : ''}{pad(remM)}:{pad(remS)}
              </span>
              <span className="text-xs text-muted-foreground">剩余</span>
            </span>
          ) : ended ? (
            <span className="text-xs text-muted-foreground">已结束</span>
          ) : (
            <span className="text-xs text-muted-foreground">未开始</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

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
    <div ref={containerRef} className="krypton-split flex flex-1 overflow-hidden">
      <div style={{ width: `${leftPct}%` }} className="krypton-split-pane shrink-0 overflow-hidden">
        {left}
      </div>
      <div
        className="krypton-split-handle w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div className="krypton-split-pane flex-1 overflow-hidden">
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

// Pretty label lookup defers to `getLangEntry` from the IDE so we share the
// same modifier-aware label generator (e.g. `cc.cc14o2` → "C++14 (O2)").
function langLabel(id: string): string {
  if (id === '_') return '任意语言';
  return getLangEntry(id).label;
}

interface LangGroup {
  family: string;
  familyLabel: string;
  variants: { id: string; suffix: string; fullLabel: string }[];
}

/**
 * Bucket a flat list of Hydro lang ids into per-family display groups.
 * Each variant's label is reduced to its suffix after the family prefix
 * ("C++14" inside the "C++" family becomes the chip "14"; "C++14 (O2)"
 * becomes "14 (O2)"). Single-language families (Java, Go, ...) collapse
 * to a single empty-suffix variant which the renderer omits the chips
 * row for.
 */
function organizeAllowedLangs(ids: string[]): LangGroup[] {
  const groups = new Map<string, LangGroup>();
  for (const id of ids) {
    if (id === '_') continue;
    const dotIdx = id.indexOf('.');
    const family = dotIdx > 0 ? id.slice(0, dotIdx) : id;
    const familyLabel = langLabel(family);
    const variantLabel = langLabel(id);
    let suffix = variantLabel;
    if (variantLabel === familyLabel) {
      suffix = '';
    } else if (variantLabel.startsWith(familyLabel)) {
      suffix = variantLabel.slice(familyLabel.length).trim();
    }
    if (!groups.has(family)) {
      groups.set(family, { family, familyLabel, variants: [] });
    }
    groups.get(family)!.variants.push({ id, suffix, fullLabel: variantLabel });
  }
  // Deterministic family ordering — common langs first, then alphabetical.
  const FAMILY_PRIORITY = ['c', 'cc', 'py3', 'py', 'java', 'js', 'go', 'rs'];
  return Array.from(groups.values()).sort((a, b) => {
    const ia = FAMILY_PRIORITY.indexOf(a.family);
    const ib = FAMILY_PRIORITY.indexOf(b.family);
    if (ia !== ib) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.familyLabel.localeCompare(b.familyLabel);
  });
}

function LimitsSection({ config }: { config: R }) {
  if (typeof config === 'string' || !config) return null;

  const timeMin = parseConfigTimeMS(config.timeMin);
  const timeMax = parseConfigTimeMS(config.timeMax);
  const memMin = parseConfigMemoryMB(config.memoryMin);
  const memMax = parseConfigMemoryMB(config.memoryMax);
  const langs: string[] = config.langs || [];

  const baseTimeMs = parseConfigTimeMS(config.time);
  const baseMemMb = parseConfigMemoryMB(config.memory);
  const displayTimeMin = baseTimeMs ?? timeMin;
  const displayTimeMax = baseTimeMs ?? timeMax ?? timeMin;
  const displayMemMin = baseMemMb ?? memMin;
  const displayMemMax = baseMemMb ?? memMax ?? memMin;
  const languageBaseTimeMs = baseTimeMs ?? displayTimeMax ?? displayTimeMin;
  const languageBaseMemMb = baseMemMb ?? displayMemMax ?? displayMemMin;

  // Per-language absolute limits, derived from the rates the editor wrote.
  // Display only when both a base value and a rate map exist.
  const timeRates: Record<string, number> = (config.time_limit_rate && typeof config.time_limit_rate === 'object')
    ? config.time_limit_rate : {};
  const memRates: Record<string, number> = (config.memory_limit_rate && typeof config.memory_limit_rate === 'object')
    ? config.memory_limit_rate : {};
  const perLangKeys = Array.from(new Set([...Object.keys(timeRates), ...Object.keys(memRates)]));

  const hasTimeVariation = baseTimeMs == null && displayTimeMin !== displayTimeMax;
  const hasMemoryVariation = baseMemMb == null && displayMemMin !== displayMemMax;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Cpu className="size-3.5" />
        限制
      </h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <Clock className="size-3.5 text-muted-foreground" />
          <div>
            <p className="text-[11px] text-muted-foreground">时间</p>
            <p className="font-mono text-xs font-medium">
              {hasTimeVariation
                ? `${formatTime(displayTimeMin)} — ${formatTime(displayTimeMax)}`
                : formatTime(displayTimeMax ?? displayTimeMin)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <HardDrive className="size-3.5 text-muted-foreground" />
          <div>
            <p className="text-[11px] text-muted-foreground">内存</p>
            <p className="font-mono text-xs font-medium">
              {hasMemoryVariation
                ? `${formatConfigMemory(displayMemMin)} — ${formatConfigMemory(displayMemMax)}`
                : formatConfigMemory(displayMemMax ?? displayMemMin)}
            </p>
          </div>
        </div>
      </div>
      {perLangKeys.length > 0 ? (
        <div className="pt-1 space-y-1">
          <p className="text-[11px] text-muted-foreground">分语言限制</p>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-normal">语言</th>
                  <th className="px-2 py-1 text-right font-normal">时间</th>
                  <th className="px-2 py-1 text-right font-normal">内存</th>
                </tr>
              </thead>
              <tbody>
                {perLangKeys.map((id) => {
                  const tr = Number(timeRates[id]);
                  const mr = Number(memRates[id]);
                  const absMs = languageBaseTimeMs != null && Number.isFinite(tr) && tr > 0 ? languageBaseTimeMs * tr : null;
                  const absMb = languageBaseMemMb != null && Number.isFinite(mr) && mr > 0 ? languageBaseMemMb * mr : null;
                  return (
                    <tr key={id} className="border-t">
                      <td className="px-2 py-1">
                        <span className="font-medium">{langLabel(id)}</span>
                        {langLabel(id) !== id ? (
                          <span className="ml-1 font-mono text-[9px] text-muted-foreground">{id}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">
                        {absMs != null ? formatHumanTime(absMs) : '默认'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">
                        {absMb != null ? formatHumanMemory(absMb) : '默认'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {langs.length > 0 && (
        <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            允许的语言
          </p>
          {langs.includes('_') ? (
            <div className="text-[11px] text-muted-foreground">任意语言</div>
          ) : (
            <AllowedLangs ids={langs} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact two-column language listing: family label on the left,
 * variant chips on the right. Groups are sorted by FAMILY_PRIORITY so
 * the most common langs (C / C++ / Python) appear first.
 */
function AllowedLangs({ ids }: { ids: string[] }) {
  const groups = useMemo(() => organizeAllowedLangs(ids), [ids]);
  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const onlyBaseVariant = g.variants.length === 1 && g.variants[0].suffix === '';
        return (
          <div key={g.family} className="flex items-baseline gap-2 text-[11px]">
            <span className="min-w-[60px] shrink-0 font-medium">{g.familyLabel}</span>
            {onlyBaseVariant ? (
              // Single-variant families collapse to a green check; no chip soup.
              <span className="text-emerald-600 dark:text-emerald-400">✓</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {g.variants.map((v) => (
                  <Badge
                    key={v.id}
                    variant="outline"
                    className="px-1.5 py-0 text-[10px]"
                    title={v.fullLabel}
                  >
                    {v.suffix || v.fullLabel}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Parse a Hydro time string ('1s', '1500ms') → milliseconds; tolerant. */
function parseConfigTimeMS(input: any): number | null {
  if (input == null) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?\d*\.?\d+)\s*(ms|s)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return (m[2] === 'ms' || !m[2]) ? Math.round(v) : Math.round(v * 1000);
}

function parseConfigMemoryMB(input: any): number | null {
  if (input == null) return null;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?\d*\.?\d+)\s*(b|k|kb|m|mb|g|gb)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const u = m[2] || 'mb';
  if (u === 'b') return v / (1024 * 1024);
  if (u === 'k' || u === 'kb') return v / 1024;
  if (u === 'g' || u === 'gb') return v * 1024;
  return v;
}

function formatHumanTime(ms: number): string {
  if (ms < 1000 || ms % 1000 !== 0) return `${Math.round(ms)}ms`;
  return `${ms / 1000}s`;
}

function formatHumanMemory(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}GB`;
  if (mb < 1) return `${Math.round(mb * 1024)}KB`;
  return `${Math.round(mb)}MB`;
}

function formatConfigMemory(mb: number | undefined | null): string {
  if (mb == null || !Number.isFinite(mb)) return '—';
  return formatHumanMemory(mb);
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

  /* ── Contest mode ── */
  const tdoc: R | null = data.tdoc || null;
  const tsdoc: R | null = data.tsdoc || null;
  const examMode: R | null = data.examMode || null;
  const examUrls: R = examMode?.urls || {};
  const mode: string = data.mode || 'normal';
  // mode ∈ 'normal' | 'view' | 'contest' | 'correction' | 'none' (from problem.ts ProblemDetailHandler)
  // Contest mode shows banner + locks down external links; correction reopens them.
  const inContest = !!tdoc && tdoc.docId && mode !== 'normal';
  const isHomework = tdoc?.rule === 'homework';
  const tid = tdoc?.docId ? String(tdoc.docId) : null;
  const contestUrl = tid
    ? (examUrls.overview || replaceRouteTokens(isHomework ? bs.urls.homeworkDetail : bs.urls.contestDetail, { TID: tid }))
    : null;
  const recordDetailRoute = examUrls.record || bs.urls.recordDetail;
  const pretestRecordRoute = buildUrlWithQuery(bs.urls.recordDetail, { tid });
  // Alphabetic id "A" / "B" / "C" from contest problem order
  const contestPids: any[] = Array.isArray(tdoc?.pids) ? tdoc!.pids : [];
  const contestIdx = inContest ? contestPids.findIndex((x) => String(x) === String(pdoc.docId)) : -1;
  const contestLetter = contestIdx >= 0 ? String.fromCharCode(65 + contestIdx) : null;
  // Inside contest, drop the raw pid prefix from the title; the letter takes its place.
  const baseTitle = pdoc.title || pdoc.pid || '题目';
  const title = inContest && contestLetter ? `${contestLetter}. ${baseTitle}` : baseTitle;
  // During contests, hide external resources (solutions/discussions/stats) and other-user info.
  // Re-open them in 'correction' mode after the contest ends.
  const showExternals = !inContest || mode === 'correction';

  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const [ideMode, setIdeMode] = useState(false);
  // Submit and pretest endpoints must carry tid so the record is attributed to the contest.
  const contestQS = tid ? `?tid=${tid}` : '';
  const submitUrl = `${problemUrl}/submit${contestQS}`;
  const problemCanPretest = config.type === 'default' || config.type === undefined || config.type == null;
  const ideCacheKey = `${bs.user?.id || 0}/${bs.domain?.id || 'default'}/${pid}`;
  const preferredLang = bs.locale?.startsWith('zh') ? 'zh' : 'en';
  // `samples` is still needed for the IDE/pretest panel even though the
  // problem-statement markdown now renders sample blocks inline (see
  // MarkdownView → splitMarkdownBySamples).
  const samples = useMemo(() => extractSamples(content), [content]);

  /* ── Records state for IDE mode ── */
  const [ideRecords, setIdeRecords] = useState<RecordEntry[]>([]);
  const [showIdeRecords, setShowIdeRecords] = useState(false);
  const [ideRecordsLoaded, setIdeRecordsLoaded] = useState(false);
  const [ideRecordsLoading, setIdeRecordsLoading] = useState(false);
  const [ideRecordsError, setIdeRecordsError] = useState<string | null>(null);
  const [ideRecordsPct, setIdeRecordsPct] = useState(70); // top content takes 70%
  const recordsDragging = useRef(false);
  const recordsPanelRef = useRef<HTMLDivElement>(null);

  const handleRecordsChange = useCallback((records: RecordEntry[]) => {
    setIdeRecords((prev) => mergeRecordEntries(prev, records));
  }, []);
  const handleToggleRecords = useCallback(() => {
    setShowIdeRecords((p) => !p);
  }, []);

  const loadIdeRecords = useCallback(async () => {
    if (!bs.user?.signedIn || !pid) return;
    setIdeRecordsLoading(true);
    setIdeRecordsError(null);
    try {
      const url = buildUrlWithQuery(bs.urls.records, {
        pid,
        tid: tid || undefined,
        uidOrName: bs.user.id,
      });
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rdocs = Array.isArray(json.rdocs)
        ? json.rdocs
        : Array.isArray(json.page?.data?.rdocs)
          ? json.page.data.rdocs
          : [];
      const entries = rdocs
        .map((rdoc: R) => recordEntryFromRdoc(rdoc, recordDetailRoute))
        .filter(Boolean) as RecordEntry[];
      setIdeRecords((prev) => mergeRecordEntries(prev, entries));
      setIdeRecordsLoaded(true);
    } catch (e: any) {
      setIdeRecordsError(e?.message || '加载提交记录失败');
      setIdeRecordsLoaded(true);
    } finally {
      setIdeRecordsLoading(false);
    }
  }, [bs.urls.records, bs.user?.id, bs.user?.signedIn, pid, recordDetailRoute, tid]);

  useEffect(() => {
    if (showIdeRecords && !ideRecordsLoaded && !ideRecordsLoading) {
      void loadIdeRecords();
    }
  }, [showIdeRecords, ideRecordsLoaded, ideRecordsLoading, loadIdeRecords]);

  useRecordSocket({
    filters: {
      pid: String(pid),
      tid: tid || undefined,
      uidOrName: bs.user?.id || undefined,
    },
    onRdoc: (rdoc) => {
      const entry = recordEntryFromRdoc(rdoc, recordDetailRoute);
      if (!entry) return;
      setIdeRecords((prev) => mergeRecordEntries(prev, [entry]));
    },
    disabled: !ideMode || !showIdeRecords || !bs.user?.signedIn || !pid,
  });

  /* Mouse handler for records panel height drag */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!recordsDragging.current || !recordsPanelRef.current) return;
      const rect = recordsPanelRef.current.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setIdeRecordsPct(Math.max(20, Math.min(85, pct)));
    };
    const onMouseUp = () => {
      if (recordsDragging.current) {
        recordsDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

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
            <div ref={recordsPanelRef} className="flex h-full flex-col">
              {/* Problem content area */}
              <ScrollArea
                viewportClassName="p-4 sm:p-6 space-y-4"
                style={{ height: showIdeRecords ? `${ideRecordsPct}%` : '100%' }}
              >
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

                {/* Problem statement (sample blocks render inline) */}
                <MarkdownView content={content} preferredLang={preferredLang} />
              </ScrollArea>

              {/* Records panel — bottom of left side */}
              {showIdeRecords && (
                <>
                  {/* Drag handle for records height */}
                  <div
                    className="h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
                    onMouseDown={() => {
                      recordsDragging.current = true;
                      document.body.style.cursor = 'row-resize';
                      document.body.style.userSelect = 'none';
                    }}
                  />
                  <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: `${100 - ideRecordsPct}%` }}>
                    <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 shrink-0">
                      <History className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">提交记录</span>
                      <span className="text-[10px] text-muted-foreground">({ideRecords.length})</span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => setShowIdeRecords(false)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        收起
                      </button>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {ideRecordsLoading && ideRecords.length === 0 ? (
                        <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          加载提交记录
                        </div>
                      ) : ideRecordsError && ideRecords.length === 0 ? (
                        <div className="flex h-full items-center justify-center gap-2 px-4 text-xs text-destructive">
                          <XCircle className="size-3.5" />
                          {ideRecordsError}
                        </div>
                      ) : ideRecords.length === 0 ? (
                        <div className="flex h-full items-center justify-center px-4 text-xs text-muted-foreground">
                          暂无个人提交记录
                        </div>
                      ) : (
                        <table className="min-w-[620px] w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/20 text-muted-foreground">
                              <th className="px-3 py-1.5 text-left font-medium">状态</th>
                              <th className="px-3 py-1.5 text-left font-medium">语言</th>
                              <th className="px-3 py-1.5 text-right font-medium">分数</th>
                              <th className="px-3 py-1.5 text-right font-medium">时间</th>
                              <th className="px-3 py-1.5 text-right font-medium">内存</th>
                              <th className="px-3 py-1.5 text-left font-medium">提交时间</th>
                              <th className="px-3 py-1.5 text-left font-medium" />
                            </tr>
                          </thead>
                          <tbody>
                            {ideRecords.map((r) => {
                              const st = getStatus(r.status);
                              return (
                                <tr key={r.rid} className="border-b last:border-0 hover:bg-muted/20">
                                  <td className={cn('whitespace-nowrap px-3 py-1.5 font-medium', st.className)}>
                                    {r.status >= 20 ? (
                                      <span className="inline-flex items-center gap-1">
                                        <Loader2 className="size-3 animate-spin" />
                                        {st.label}
                                      </span>
                                    ) : (
                                      st.label
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5">{getLangEntry(r.lang).label}</td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                    {r.score != null ? r.score : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                    {r.time != null ? `${r.time} ms` : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                    {r.memory != null ? formatMemory(r.memory) : '—'}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                                    {formatRecordTimestamp(r.timestamp)}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <a
                                      href={r.url}
                                      className="text-primary hover:underline"
                                    >
                                      详情
                                    </a>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          }
          right={
            <KryptonIDE
              langs={config.langs || []}
              defaultLang={config.langs?.[0]}
              submitUrl={submitUrl}
              canPretest={problemCanPretest}
              cacheKey={ideCacheKey}
              samples={samples}
              onRecordsChange={handleRecordsChange}
              onToggleRecords={handleToggleRecords}
              onOpenRecords={() => setShowIdeRecords(true)}
              recordUrlTemplate={recordDetailRoute}
              pretestRecordUrlTemplate={pretestRecordRoute}
              showRecordsButton
              recordsVisible={showIdeRecords}
              recordsCount={ideRecords.length}
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
      {/* Contest mode banner — visible whenever we entered via a contest tid */}
      {inContest && contestUrl ? (
        <ContestBanner
          tdoc={tdoc!}
          mode={mode}
          letter={contestLetter}
          contestUrl={contestUrl}
        />
      ) : null}

      {/* Breadcrumb + title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {inContest && contestUrl ? (
              <>
                <a href={examUrls.overview || (isHomework ? bs.urls.homework : bs.urls.contests)} className="hover:text-primary">{isHomework ? '作业' : '比赛'}</a>
                <ChevronRight className="size-3" />
                <a href={contestUrl} className="hover:text-primary truncate max-w-[200px]">{tdoc?.title || '比赛'}</a>
                <ChevronRight className="size-3" />
                <span className="font-mono">{contestLetter || pid}</span>
              </>
            ) : (
              <>
                <a href={bs.urls.problems} className="hover:text-primary">题库</a>
                <ChevronRight className="size-3" />
                <span className="font-mono">{pid}</span>
              </>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-lg font-bold leading-tight sm:text-xl">{title}</h1>
            {statusBadge(psdoc.status)}
            {/* Hide difficulty during contest (gives away problem hardness) */}
            {!inContest ? difficultyBadge(difficulty) : null}
          </div>
          {/* Hide tags during contest (gives away algorithm) */}
          {!inContest && tags.length > 0 && (
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
          {!examMode?.enabled ? <Button asChild size="sm" variant="outline">
            <a href={submitUrl}>
              <Send className="mr-1 size-3.5" />
              提交
            </a>
          </Button> : null}
          {!inContest ? (
            <Button asChild size="sm" variant="ghost">
              <a href={`${problemUrl}/edit`}>
                <Edit3 className="mr-1 size-3.5" />
                编辑
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Dense info bar — during contest, hide owner/solutions/discussions to avoid info leak */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2">
        <InfoChip icon={Send} label="提交" value={nSubmit} />
        <InfoChip icon={CheckCircle2} label="通过" value={<span className="text-green-600 dark:text-green-400">{nAccept}</span>} />
        <InfoChip icon={Trophy} label="通过率" value={`${rate}%`} />
        {!inContest ? <InfoChip icon={User} label="出题人" value={udoc.uname || `UID ${udoc._id || '?'}`} /> : null}
        {showExternals && solutionCount > 0 && <InfoChip icon={BookOpen} label="题解" value={solutionCount} />}
        {showExternals && discussionCount > 0 && <InfoChip icon={MessageSquare} label="讨论" value={discussionCount} />}
      </div>

      {/* Main content area: two-column layout */}
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* Left: statement only (mini tabs removed — submit moved to its own page
            and "题解" is reachable via the sidebar quick links / its own button). */}
        <div className="min-w-0 space-y-3">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <MarkdownView content={content} preferredLang={preferredLang} />
            </CardContent>
          </Card>
          {showExternals && solutionCount > 0 ? (
            <Card>
              <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <BookOpen className="size-3.5" />
                  共 {solutionCount} 篇题解
                </span>
                <a href={`${problemUrl}/solution`} className="text-primary hover:underline">查看全部 →</a>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Right: sidebar info panel */}
        <aside className="space-y-4">
          {/* Limits */}
          <Card>
            <CardContent className="p-4">
              <LimitsSection config={config} />
            </CardContent>
          </Card>

          {/* Related contests — hide during contest (would reveal source) */}
          {showExternals && (ctdocs.length > 0 || htdocs.length > 0) && (
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

          {/* Quick links — hide solution/discussion/stats during contest */}
          {showExternals ? (
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
          ) : (
            <Card>
              <CardContent className="p-4 space-y-1">
                <a href={`${problemUrl}/files${contestQS}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                  <FileText className="size-3" />
                  附件
                </a>
                {contestUrl ? (
                  <a href={contestUrl} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <ChevronRight className="size-3 rotate-180" />
                    返回比赛
                  </a>
                ) : null}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </motion.div>
  );
}
