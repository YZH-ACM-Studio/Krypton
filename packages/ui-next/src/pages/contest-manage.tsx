/**
 * Contest management pages — edit, manage, problem list, users, balloon,
 * clarification, print.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Palette,
  Printer,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ContestParticipationField } from '@/components/contest-participation-field';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { TEAM_DIALOG_BUTTON_CLASS, TeamDialogBody, TeamDialogContent, TeamDialogFooter } from '@/components/team-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { MultiSelect } from '@/components/ui/multi-select';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import {
  COMMON_LANG_OPTIONS,
  type LangOption,
  resolveLangs,
  searchProblems,
  fetchProblemsByIds,
  type ProblemOption,
} from '@/lib/multi-select-presets';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { getContestProblemStatus, getPersonalPracticeStatus, type PersonalPracticeStatusSnapshot } from '@/lib/contest-exam-display';
import { formatDateTime, formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';
import { isSystemAdmin } from '@/lib/perms';

/**
 * Loose server-payload record — kept only for payloads whose shape is not
 * modelled precisely (e.g. the exam status journal entries below). Everything
 * else on these pages has a narrow interface.
 */
type R = Record<string, unknown>;

/** Minimal projection of a problem doc as used on these management pages. */
interface ProblemBrief {
  title?: string;
}

/** Per-problem balloon config stored on the contest doc (legacy value: bare color string). */
interface ContestBalloonConfig {
  color?: string;
  name?: string;
}

/** A contest file entry (`tdoc.files` / `tdoc.privateFiles`), JSON-serialized. */
interface ContestFileInfo {
  _id?: string;
  name: string;
  size?: number;
  etag?: string;
  lastModified?: string;
}

/** JSON-serialized contest document — only the fields these pages read. */
interface ContestDoc {
  _id?: string;
  docId?: string;
  title?: string;
  content?: string;
  rule?: string;
  owner?: number;
  maintainer?: number[];
  pids?: number[];
  beginAt?: string;
  endAt?: string;
  lockAt?: string;
  /** Flexible per-user duration (hours); absent = fixed window. */
  duration?: number;
  rated?: boolean;
  assign?: string[];
  _code?: string;
  code?: string;
  langs?: string[];
  score?: Record<string, number>;
  balloon?: Record<string, ContestBalloonConfig | string>;
  autoHide?: boolean;
  allowViewCode?: boolean;
  allowPrint?: boolean;
  keepScoreboardHidden?: boolean;
  verifiers?: number[];
  participationMode?: string;
  teamBatchId?: string;
  plannedTeamBatchId?: string;
  vigilEnabled?: boolean;
  entryMode?: string;
  approvalMode?: string;
  lockdownMode?: boolean;
  networkLockdownMode?: boolean;
  networkLockdownFailurePolicy?: string;
  pauseOnDisconnect?: boolean;
  exclusive?: boolean;
  liveEnabled?: boolean;
  cameraEnabled?: boolean;
  recordEnabled?: boolean;
  screenshotIntervalMs?: number;
  screenshotJitterMs?: number;
  clientLoginBlockBeforeMinutes?: number;
  clientLoginBlockAfterMinutes?: number;
  vigilProcessWhitelist?: string[];
  networkWhitelistHosts?: string[];
  networkWhitelistIps?: string[];
  networkWhitelistPorts?: string[];
  participantScopeMode?: ParticipantScopeMode;
  participantSchoolIds?: string[];
  participantGroupIds?: string[];
}

type ParticipantScopeMode = 'none' | 'schools' | 'groups';
type ContestEntryMode = 'open' | 'client_required';
type ContestApprovalMode = 'strict' | 'auto';
type NetworkFailurePolicy = 'strict' | 'report_only' | 'off';

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? (udict[String(uid)] ?? null) : null;
}

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

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] || char,
  );
}

function formatObjectIdTime(id: unknown, locale: string) {
  const value = String(id || '');
  if (!/^[0-9a-f]{24}$/i.test(value)) return '';
  const timestamp = Number.parseInt(value.slice(0, 8), 16) * 1000;
  if (!Number.isFinite(timestamp)) return '';
  return formatDateTime(timestamp, locale);
}

function toDate(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInput(value: unknown) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTimeInput(value: unknown) {
  const date = toDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateTimeInput(dateText: string, timeText: string, durationHours: string) {
  const begin = new Date(`${dateText}T${timeText || '00:00'}`);
  const duration = Number(durationHours);
  if (Number.isNaN(begin.getTime()) || !Number.isFinite(duration)) return '';
  begin.setMinutes(begin.getMinutes() + Math.round(duration * 60));
  return `${formatDateInput(begin)} ${formatTimeInput(begin)}`;
}

function formatCommaValue(value: unknown) {
  return Array.isArray(value) ? value.join(',') : String(value || '');
}

interface BalloonColorRow {
  pid: string;
  label: string;
  title: string;
  color: string;
  name: string;
}

const DEFAULT_BALLOON_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function clarificationSubjectLabel(tdoc: ContestDoc, pdict: Record<string, ProblemBrief>, subject: unknown) {
  const pids: Array<string | number> = tdoc.pids || [];
  const numeric = Number(subject);
  if (numeric === -1) return '技术问题';
  if (numeric === 0 || subject == null) return '通用';
  const byPidIndex = pids.findIndex((pid) => String(pid) === String(subject));
  const legacyIndex = Number.isInteger(numeric) && numeric >= 0 && numeric < pids.length ? numeric : -1;
  const index = byPidIndex >= 0 ? byPidIndex : legacyIndex;
  if (index >= 0) {
    const pid = pids[index];
    const problem: ProblemBrief = pdict[String(pid)] || {};
    return `${getAlphabeticId(index)} — ${problem.title || `P${pid}`}`;
  }
  return String(subject);
}

function normalizeBalloonRows(tdoc: ContestDoc, pdict: Record<string, ProblemBrief>): BalloonColorRow[] {
  const pids: Array<string | number> = tdoc.pids || [];
  const existing: Record<string, ContestBalloonConfig | string> = tdoc.balloon || {};
  return pids.map((pid, index) => {
    const key = String(pid);
    const config: ContestBalloonConfig | string = existing[key] || existing[Number(pid)] || {};
    const problem: ProblemBrief = pdict[key] || {};
    const isObject = config && typeof config === 'object';
    return {
      pid: key,
      label: getAlphabeticId(index),
      title: problem.title || `P${key}`,
      color: isObject
        ? config.color || DEFAULT_BALLOON_COLORS[index % DEFAULT_BALLOON_COLORS.length]
        : String(config || DEFAULT_BALLOON_COLORS[index % DEFAULT_BALLOON_COLORS.length]),
      name: isObject ? config.name || problem.title || '' : problem.title || '',
    };
  });
}

function serializeBalloonRows(rows: BalloonColorRow[]) {
  return rows
    .map((row) => [`${row.pid}:`, `  color: ${JSON.stringify(row.color || '#ffffff')}`, `  name: ${JSON.stringify(row.name || '')}`].join('\n'))
    .join('\n');
}

/* ---------- Contest Edit ---------- */

// Cheap "keep all panels mounted, just toggle visibility" tab nav. Built
// inline here because the shared <Tabs> component (components/ui/tabs.tsx)
// only renders the active panel — that breaks form submission because
// inputs in inactive panels never get serialized. For editor forms we
// want them all live.
function MiniTabsNav<T extends string>({ items, active, onChange }: { items: { value: T; label: string }[]; active: T; onChange: (next: T) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-1 text-muted-foreground">
      {items.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
            active === tab.value ? 'bg-background text-foreground shadow' : 'hover:text-foreground/80'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface ScopeOption {
  _id: string;
  name: string;
  schoolName?: string;
}
/** Raw school catalog row (`data.scopeSchools`, from krypton-userbind). */
interface ScopeSchoolPayload {
  _id: unknown;
  name: string;
}
/** Raw user-group catalog row (`data.scopeGroups`, from krypton-userbind). */
interface ScopeGroupPayload {
  _id: unknown;
  name: string;
  schoolId?: unknown;
  archivedAt?: unknown;
}
interface UserOption {
  _id: number;
  uname?: string;
  mail?: string;
  avatarUrl?: string;
}

/** One entry of `data.teamBatches` as shipped by the contest edit handler. */
interface TeamBatchSummary {
  batchId?: string;
  name?: string;
  status?: 'open' | 'closed';
  teamCount?: number;
  memberCount?: number;
  closedAt?: string;
}

type TeamReadinessLevel = 'pass' | 'warning' | 'block';
interface TeamReadinessItem {
  level: TeamReadinessLevel;
  code: string;
  title: string;
  message: string;
}
/** JSON shape of `contestTeamBatch.checkContestReadiness` (TeamBatchReadinessReport). */
interface TeamReadinessReport {
  checkId?: string;
  checkedAt?: string;
  result: TeamReadinessLevel;
  teamCount: number;
  memberCount: number;
  snapshotHash?: string;
  canFinalize: boolean;
  canStart: boolean;
  items: TeamReadinessItem[];
}
/** Response of the `check_team_readiness` contest-edit operation. */
interface TeamReadinessResponse {
  ok?: boolean;
  message?: string;
  error?: string;
  readiness?: TeamReadinessReport;
}

type ManagementSection = 'overview' | 'edit' | 'users' | 'clarification' | 'balloon' | 'print';

function contestId(tdoc: ContestDoc) {
  return String(tdoc.docId || tdoc._id || '');
}

function contestDetailUrl(bs: ReturnType<typeof useBootstrap>, tdoc: ContestDoc) {
  return replaceRouteTokens(bs.urls.contestDetail, { TID: contestId(tdoc) });
}

/** Exam-shell URL overrides injected by the exam-mode handler. */
interface ExamModeUrls {
  overview?: string;
  problem?: string;
  record?: string;
}

interface ContestExamModePageData {
  examMode?: {
    enabled?: boolean;
    urls?: ExamModeUrls;
  } | null;
}

interface ContestEditPageData {
  activeTeamCount?: number;
  beginAt?: string;
  canAutoHideProblems?: boolean;
  canManageTeamBatches?: boolean;
  canUpdatePlannedTeamBatch?: boolean;
  duration?: number;
  page_name?: string;
  participationRevision?: number;
  pids?: string;
  rules?: Record<string, string>;
  scopeGroups?: ScopeGroupPayload[];
  scopeSchools?: ScopeSchoolPayload[];
  tdoc?: ContestDoc;
  teamBatches?: TeamBatchSummary[];
  teamModeClearConfirmation?: string;
}

interface ContestManagePageData {
  files?: ContestFileInfo[];
  pdict?: Record<string, ProblemBrief>;
  privateFiles?: ContestFileInfo[];
  submissionStats?: ContestSubmissionStats | null;
  tdoc?: ContestDoc;
}

interface ContestProblemListPageData extends ContestExamModePageData {
  canViewContestRecord?: boolean;
  canViewRecord?: boolean;
  liveStats?: Record<string, ContestLiveProblemStat>;
  liveStatsParticipantUnit?: 'team' | 'user';
  pdict?: Record<string, ProblemBrief>;
  personalPracticeStatusByPid?: Record<string, PersonalPracticeStatusSnapshot & { rid?: unknown }>;
  postContestPractice?: {
    eligible?: boolean;
  } | null;
  problemStatusByPid?: Record<string, R>;
  psdict?: Record<string, R>;
  rdocs?: ContestRecordDoc[];
  showScore?: boolean;
  tcdocs?: ClarificationDoc[];
  tdoc?: ContestDoc;
  visiblePids?: number[];
}

interface ContestUserPageData {
  tdoc?: ContestDoc;
  tsdocs?: ContestUserStatusDoc[];
  udict?: Record<string, GenericUserDoc>;
}

interface ContestBalloonPageData {
  bdocs?: BalloonDoc[];
  pdict?: Record<string, ProblemBrief>;
  tdoc?: ContestDoc;
  teamDict?: Record<string, ContestTeamBrief>;
  udict?: Record<string, GenericUserDoc>;
}

interface ContestClarificationPageData {
  pdict?: Record<string, ProblemBrief>;
  tcdocs?: ClarificationDoc[];
  tdoc?: ContestDoc;
  udict?: Record<string, GenericUserDoc>;
}

interface ContestPrintPageData {
  canEdit?: boolean;
  isAdmin?: boolean;
  tdoc?: ContestDoc;
}

function examModeUrls(bs: ReturnType<typeof useBootstrap>): ExamModeUrls | null {
  return (bs.page.data as ContestExamModePageData | null | undefined)?.examMode?.urls || null;
}

function contestProblemUrl(bs: ReturnType<typeof useBootstrap>, tdoc: ContestDoc, pid: string | number) {
  const urls = examModeUrls(bs);
  if (urls?.problem) return String(urls.problem).replace('__PID__', String(pid));
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  return `${problemUrl}?tid=${encodeURIComponent(contestId(tdoc))}`;
}

interface ManagementItem {
  key: ManagementSection | 'scoreboard' | 'records' | 'code' | 'grading';
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  show?: boolean;
}

function managementItems(tdoc: ContestDoc, contestUrl: string, canGradeSubjective: boolean): ManagementItem[] {
  const isACM = tdoc.rule === 'acm';
  const items: ManagementItem[] = [
    { key: 'overview', label: '概览与文件', href: `${contestUrl}/management`, icon: LayoutDashboard },
    { key: 'edit', label: '编辑比赛', href: `${contestUrl}/edit`, icon: Settings },
    { key: 'users', label: '参赛选手', href: `${contestUrl}/user`, icon: Users },
    { key: 'clarification', label: '答疑管理', href: `${contestUrl}/clarification`, icon: MessageSquare },
    {
      key: 'grading',
      label: '主观题阅卷',
      href: `/manage/grading/${encodeURIComponent(contestId(tdoc))}`,
      icon: ClipboardCheck,
      show: canGradeSubjective,
    },
    { key: 'balloon', label: '气球分发', href: `${contestUrl}/balloon`, icon: Trophy, show: isACM },
    { key: 'print', label: '打印服务', href: `${contestUrl}/print`, icon: Printer, show: !!tdoc.allowPrint },
    { key: 'scoreboard', label: '排行榜', href: `${contestUrl}/scoreboard`, icon: Trophy },
    { key: 'records', label: '全部提交', href: `/record?tid=${encodeURIComponent(contestId(tdoc))}`, icon: Send },
    { key: 'code', label: '导出代码', href: `${contestUrl}/code`, icon: Download },
  ];
  return items.filter((item) => item.show !== false);
}

function ContestManagementChrome({ tdoc, active, children }: { tdoc: ContestDoc; active: ManagementSection; children: React.ReactNode }) {
  const bs = useBootstrap();
  const tid = contestId(tdoc);
  if (!tid) return <>{children}</>;
  const contestUrl = contestDetailUrl(bs, tdoc);
  const canGradeSubjective =
    ['exam', 'homework', 'oi'].includes(String(tdoc.rule)) && (Number(tdoc.owner) === bs.user.id || isSystemAdmin(bs.user.priv));
  const items = managementItems(tdoc, contestUrl, canGradeSubjective);
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="rounded-xl border bg-card p-3">
          <a href={contestUrl} className="group block rounded-lg px-2 py-2 hover:bg-accent/40">
            <p className="line-clamp-2 text-sm font-medium group-hover:text-primary">{tdoc.title || '比赛'}</p>
            <p className="mt-1 text-xs text-muted-foreground">返回比赛详情</p>
          </a>
          <div className="my-2 h-px bg-border" />
          <nav className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const current = item.key === active;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    current ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {!['overview', 'edit', 'users', 'clarification', 'balloon', 'print'].includes(String(item.key)) ? (
                    <ExternalLink className="size-3 opacity-60" />
                  ) : null}
                </a>
              );
            })}
          </nav>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}

export function ContestEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestEditPageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const rules: Record<string, string> = data.rules || {};
  const isEdit = data.page_name === 'contest_edit';
  const canAutoHideProblems = !!data.canAutoHideProblems;
  const defaultRated = isEdit ? !!tdoc.rated : true;
  const defaultAutoHide = isEdit ? !!tdoc.autoHide : canAutoHideProblems;
  const defaultAllowViewCode = isEdit ? !!tdoc.allowViewCode : true;
  const contestUrl = isEdit ? replaceRouteTokens(bs.urls.contestDetail, { TID: String(tdoc.docId || tdoc._id) }) : bs.urls.contests;
  const initialBeginAt = data.beginAt || tdoc.beginAt || '';
  const [beginDate, setBeginDate] = useState(formatDateInput(initialBeginAt));
  const [beginTime, setBeginTime] = useState(formatTimeInput(initialBeginAt));
  const [duration, setDuration] = useState(String(data.duration || 2));
  const [rule, setRule] = useState(String(tdoc.rule || 'acm'));
  const initialParticipationMode: 'individual' | 'team' = tdoc.participationMode === 'team' ? 'team' : 'individual';
  const [participationMode, setParticipationMode] = useState<'individual' | 'team'>(initialParticipationMode);
  const finalizedTeamBatchId = String(tdoc.teamBatchId || '');
  const persistedPlannedTeamBatchId = String(tdoc.plannedTeamBatchId || '');
  const [plannedTeamBatchId, setPlannedTeamBatchId] = useState(persistedPlannedTeamBatchId || finalizedTeamBatchId);
  const teamBatches: TeamBatchSummary[] = data.teamBatches || [];
  const selectedTeamBatch = teamBatches.find((batch) => String(batch.batchId) === plannedTeamBatchId) || null;
  const canUpdatePlannedTeamBatch = !!data.canUpdatePlannedTeamBatch && !finalizedTeamBatchId;
  const canFinalizePlannedTeamBatch =
    isEdit &&
    canUpdatePlannedTeamBatch &&
    !!persistedPlannedTeamBatchId &&
    plannedTeamBatchId === persistedPlannedTeamBatchId &&
    selectedTeamBatch?.status === 'closed';
  const activeTeamCount = Number(data.activeTeamCount || 0);
  const [rated, setRated] = useState(defaultRated);
  const [modeClearOpen, setModeClearOpen] = useState(false);
  const [modeClearConfirmed, setModeClearConfirmed] = useState(false);
  const [finalizeTeamBatchOpen, setFinalizeTeamBatchOpen] = useState(false);
  const [teamReadiness, setTeamReadiness] = useState<TeamReadinessReport | null>(null);
  const [teamReadinessLoading, setTeamReadinessLoading] = useState(false);
  const [teamReadinessError, setTeamReadinessError] = useState('');
  const formRef = useRef<HTMLFormElement | null>(null);
  const primarySubmitRef = useRef<HTMLButtonElement | null>(null);
  const [permission, setPermission] = useState(() => {
    if (tdoc.assign?.length) return 'assign';
    if (tdoc._code || tdoc.code) return 'invite';
    return 'public';
  });
  const endAtDate = toDate(tdoc.endAt);
  const lockAtDate = toDate(tdoc.lockAt);
  const lockMinutes = endAtDate && lockAtDate ? Math.max(0, Math.round((endAtDate.getTime() - lockAtDate.getTime()) / 60000)) : '';

  // MultiSelect state — pids resolved async on mount, langs from preset map.
  const initialPidCsv: string = (typeof data.pids === 'string' ? data.pids : '') || '';
  const initialPidIds = initialPidCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const [pidValue, setPidValue] = useState<ProblemOption[]>(() =>
    initialPidIds.map((id) => ({
      docId: Number(id) || 0,
      pid: id,
      title: '',
    })),
  );
  useEffect(() => {
    if (!initialPidIds.length) return;
    let cancelled = false;
    fetchProblemsByIds(initialPidIds).then((res) => {
      if (!cancelled) setPidValue(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const initialLangIds: string[] = Array.isArray(tdoc.langs) ? tdoc.langs : [];
  const [langValue, setLangValue] = useState<LangOption[]>(() => resolveLangs(initialLangIds));

  // ── Krypton: client-required & participant scope ─────────────────────
  const [activeTab, setActiveTab] = useState<'basic' | 'access' | 'scope' | 'vigil' | 'settings'>('basic');
  const [vigilEnabled, setVigilEnabled] = useState<boolean>(!!tdoc.vigilEnabled);
  const [entryMode, setEntryMode] = useState<ContestEntryMode>(tdoc.entryMode === 'client_required' ? 'client_required' : 'open');
  const [approvalMode, setApprovalMode] = useState<ContestApprovalMode>(tdoc.approvalMode === 'auto' ? 'auto' : 'strict');
  const [lockdownMode, setLockdownMode] = useState<boolean>(!!tdoc.lockdownMode);
  const [networkTouched, setNetworkTouched] = useState<boolean>(tdoc.networkLockdownMode != null);
  const [networkLockdownMode, setNetworkLockdownMode] = useState<boolean>(
    tdoc.networkLockdownMode != null ? !!tdoc.networkLockdownMode : !!tdoc.lockdownMode,
  );
  const [networkFailurePolicy, setNetworkFailurePolicy] = useState<NetworkFailurePolicy>(
    tdoc.networkLockdownFailurePolicy === 'report_only' ? 'report_only' : tdoc.networkLockdownFailurePolicy === 'off' ? 'off' : 'strict',
  );
  const [scopeMode, setScopeMode] = useState<ParticipantScopeMode>(tdoc.participantScopeMode || 'none');

  // Scope option catalog comes pre-loaded from the handler (data.scopeSchools,
  // data.scopeGroups). Each is `{_id, name}` (groups also carry `schoolId`).
  const schoolCatalog: ScopeOption[] = (data.scopeSchools || []).map((s: ScopeSchoolPayload) => ({
    _id: String(s._id),
    name: s.name,
  }));
  const initialSchoolIds: string[] = (tdoc.participantSchoolIds || []).map((id) => String(id));
  const initialGroupIds: string[] = (tdoc.participantGroupIds || []).map((id) => String(id));
  // 已归档组不进常规选择器（PLAN §9）；但已被本比赛引用的历史值保留可解析。
  const groupCatalog: ScopeOption[] = (data.scopeGroups || [])
    .filter((g: ScopeGroupPayload) => !g.archivedAt || initialGroupIds.includes(String(g._id)))
    .map((g: ScopeGroupPayload) => {
      const parent = (data.scopeSchools || []).find((s: ScopeSchoolPayload) => String(s._id) === String(g.schoolId));
      return {
        _id: String(g._id),
        name: g.archivedAt ? `${g.name}（已归档）` : g.name,
        schoolName: parent?.name,
      };
    });
  const [schoolValue, setSchoolValue] = useState<ScopeOption[]>(
    initialSchoolIds.map((id) => schoolCatalog.find((s) => s._id === id) || { _id: id, name: id }),
  );
  const [groupValue, setGroupValue] = useState<ScopeOption[]>(
    initialGroupIds.map((id) => groupCatalog.find((g) => g._id === id) || { _id: id, name: id }),
  );

  // client_required forces vigilEnabled true
  useEffect(() => {
    if (entryMode === 'client_required' && !vigilEnabled) setVigilEnabled(true);
  }, [entryMode, vigilEnabled]);
  // vigilEnabled=false forces entryMode=open
  useEffect(() => {
    if (!vigilEnabled && entryMode !== 'open') setEntryMode('open');
  }, [vigilEnabled, entryMode]);
  useEffect(() => {
    if (!networkTouched) setNetworkLockdownMode(lockdownMode);
  }, [lockdownMode, networkTouched]);
  useEffect(() => {
    if (!networkLockdownMode && networkFailurePolicy !== 'off') setNetworkFailurePolicy('off');
    if (networkLockdownMode && networkFailurePolicy === 'off') setNetworkFailurePolicy('strict');
  }, [networkLockdownMode, networkFailurePolicy]);
  useEffect(() => {
    if (participationMode !== 'team') return;
    if (rule !== 'acm') setRule('acm');
    if (!vigilEnabled) setVigilEnabled(true);
    if (entryMode !== 'client_required') setEntryMode('client_required');
    if (rated) setRated(false);
  }, [participationMode, rule, vigilEnabled, entryMode, rated]);

  const runTeamReadinessCheck = async () => {
    if (!isEdit) return;
    setTeamReadinessLoading(true);
    setTeamReadinessError('');
    try {
      const response = await fetch(window.location.href, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ operation: 'check_team_readiness' }),
      });
      const text = await response.text();
      let payload: TeamReadinessResponse = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        if (!response.ok) throw new Error(text || '赛前检查失败');
      }
      if (!response.ok || !payload.ok) throw new Error(String(payload.message || payload.error || text || '赛前检查失败'));
      setTeamReadiness(payload.readiness || null);
    } catch (error) {
      setTeamReadiness(null);
      setTeamReadinessError(error instanceof Error ? error.message : '赛前检查失败');
    } finally {
      setTeamReadinessLoading(false);
    }
  };

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑比赛' : '创建比赛'}</h1>
      </div>

      <ContestManagementChrome tdoc={tdoc} active="edit">
        <Card>
          <CardContent className="p-6">
            <form
              ref={formRef}
              method="post"
              className="space-y-4"
              onSubmit={(event) => {
                const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                const isPrimaryUpdate =
                  !submitter || (submitter.name === 'operation' && submitter.value === 'update' && !submitter.hasAttribute('formaction'));
                if (
                  isPrimaryUpdate &&
                  initialParticipationMode === 'team' &&
                  participationMode === 'individual' &&
                  Number(data.activeTeamCount || 0) > 0 &&
                  !modeClearConfirmed
                ) {
                  event.preventDefault();
                  setModeClearOpen(true);
                }
              }}
            >
              <input type="hidden" name="participationRevision" value={Number(data.participationRevision || 0)} />
              <input type="hidden" name="teamModeClearConfirmation" value={modeClearConfirmed ? String(data.teamModeClearConfirmation || '') : ''} />
              <MiniTabsNav
                items={[
                  { value: 'basic', label: '基本信息' },
                  { value: 'access', label: '访问控制' },
                  { value: 'scope', label: '参赛范围' },
                  { value: 'vigil', label: '客户端与反作弊' },
                  { value: 'settings', label: '比赛设置' },
                ]}
                active={activeTab}
                onChange={(v) => setActiveTab(v)}
              />

              {/* ─── Tab 1: 基本信息 ─── */}
              <div className="space-y-4" hidden={activeTab !== 'basic'}>
                <div className="space-y-1.5">
                  <label htmlFor="title" className="text-sm font-medium">
                    比赛标题
                  </label>
                  <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className={rule === 'acm' ? 'space-y-1.5' : 'space-y-1.5 sm:col-span-2'}>
                    <label htmlFor="rule" className="text-sm font-medium">
                      赛制
                    </label>
                    <SimpleSelect
                      id="rule"
                      name={participationMode === 'team' ? undefined : 'rule'}
                      value={rule}
                      disabled={participationMode === 'team'}
                      onValueChange={setRule}
                      options={Object.entries(rules).map(([k, v]) => ({
                        value: k,
                        label: v as string,
                      }))}
                    />
                    {participationMode === 'team' ? <input type="hidden" name="rule" value="acm" /> : null}
                  </div>
                  <ContestParticipationField
                    rule={rule}
                    value={participationMode}
                    onValueChange={(value) => {
                      setParticipationMode(value);
                      setModeClearConfirmed(false);
                    }}
                  />
                </div>

                {participationMode === 'team' ? (
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <label className="text-sm font-medium">赛前组队批次</label>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          可选。开放批次只建立管理关联，组队仍可继续；关闭后再由管理员显式锁定阵容并生成本场独立快照。
                        </p>
                      </div>
                      {finalizedTeamBatchId ? (
                        <Badge variant="outline">已定版 · 不自动同步</Badge>
                      ) : persistedPlannedTeamBatchId ? (
                        <Badge variant={selectedTeamBatch?.status === 'closed' ? 'secondary' : 'outline'}>
                          {selectedTeamBatch?.status === 'closed' ? '已预绑定 · 待定版' : '已预绑定 · 开放组队中'}
                        </Badge>
                      ) : null}
                    </div>
                    <SimpleSelect
                  name={canUpdatePlannedTeamBatch ? 'plannedTeamBatchId' : undefined}
                      value={plannedTeamBatchId}
                      onValueChange={setPlannedTeamBatchId}
                      disabled={!canUpdatePlannedTeamBatch}
                      options={[
                        { value: '', label: '不预绑定批次（保持现有比赛内组队方式）' },
                        ...teamBatches.map((batch) => ({
                          value: String(batch.batchId),
                          label: `${batch.status === 'open' ? '开放' : '已关闭'} · ${batch.name} · ${Number(batch.teamCount || 0)} 队 / ${Number(batch.memberCount || 0)} 人`,
                        })),
                      ]}
                    />
                    {!canUpdatePlannedTeamBatch && persistedPlannedTeamBatchId ? (
                      <input type="hidden" name="plannedTeamBatchId" value={persistedPlannedTeamBatchId} />
                    ) : null}
                    {selectedTeamBatch ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/70 px-3 py-2.5 text-xs ring-1 ring-foreground/8">
                        <span className="text-muted-foreground">
                          当前批次：{Number(selectedTeamBatch.teamCount || 0)} 支队伍 · {Number(selectedTeamBatch.memberCount || 0)} 名成员 ·
                          {selectedTeamBatch.status === 'open' ? ' 仍可继续组队' : ' 阵容已冻结'}
                        </span>
                        {canFinalizePlannedTeamBatch ? (
                          <Button type="button" size="sm" onClick={() => setFinalizeTeamBatchOpen(true)}>
                            <ClipboardCheck className="size-4" /> 锁定阵容并生成快照
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {finalizedTeamBatchId ? (
                      <p className="text-xs text-muted-foreground">本场运行时只读取已定版的 ContestTeam；后续批次变化不会同步到比赛。</p>
                    ) : activeTeamCount > 0 ? (
                      <p className="text-xs text-amber-600">本场已经存在比赛内队伍，不能再更换或绑定赛前批次。</p>
                    ) : plannedTeamBatchId ? (
                      <p className="text-xs text-muted-foreground">预绑定不会创建临时队伍；定版时任一成员资格失败都会整批拒绝。</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">也可以不使用批次，继续沿用比赛内直接组队。</p>
                    )}
                    {isEdit && data.canManageTeamBatches ? (
                      <div className="mt-4 space-y-3 border-t pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">赛前就绪检查</p>
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              只读检查已保存配置；不会自动关批、定版或探测客户端安装。
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={teamReadinessLoading || plannedTeamBatchId !== (persistedPlannedTeamBatchId || finalizedTeamBatchId)}
                            onClick={runTeamReadinessCheck}
                          >
                            <RefreshCw className={`size-4 ${teamReadinessLoading ? 'animate-spin' : ''}`} />
                            {teamReadiness ? '重新检查' : '运行检查'}
                          </Button>
                        </div>
                        {plannedTeamBatchId !== (persistedPlannedTeamBatchId || finalizedTeamBatchId) ? (
                          <p className="text-xs text-amber-600">请先保存批次选择，再运行赛前检查。</p>
                        ) : null}
                        {teamReadinessError ? (
                          <div className="rounded-xl bg-destructive/8 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/20">
                            {teamReadinessError}
                          </div>
                        ) : null}
                        {teamReadiness ? (
                          <div className="space-y-3 rounded-2xl bg-background/75 p-3 ring-1 ring-foreground/8">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={
                                    teamReadiness.result === 'pass'
                                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                                      : teamReadiness.result === 'warning'
                                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                                  }
                                >
                                  {teamReadiness.result === 'block'
                                    ? '存在阻断'
                                    : teamReadiness.canFinalize
                                      ? '可定版，尚不可开赛'
                                      : teamReadiness.canStart
                                        ? teamReadiness.result === 'warning'
                                          ? '可以开赛，有提醒'
                                          : '可以开赛'
                                        : '尚不可开赛'}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {Number(teamReadiness.teamCount || 0)} 队 · {Number(teamReadiness.memberCount || 0)} 人
                                </span>
                              </div>
                              {teamReadiness.canFinalize ? (
                                <Button type="button" size="sm" onClick={() => setFinalizeTeamBatchOpen(true)}>
                                  <ClipboardCheck className="size-4" /> 锁定阵容并生成快照
                                </Button>
                              ) : null}
                            </div>
                            {teamReadiness.snapshotHash ? (
                              <p className="break-all font-mono text-[10px] text-muted-foreground">snapshot {teamReadiness.snapshotHash}</p>
                            ) : null}
                            {(['block', 'warning', 'pass'] as const).map((level) => {
                              const levelItems = (teamReadiness.items || []).filter((item) => item.level === level);
                              if (!levelItems.length) return null;
                              const LevelIcon = level === 'pass' ? CheckCircle2 : AlertTriangle;
                              return (
                                <div key={level} className="space-y-1.5">
                                  {levelItems.map((item) => (
                                    <div key={item.code} className="flex items-start gap-2 rounded-xl bg-muted/35 px-3 py-2">
                                      <LevelIcon
                                        className={`mt-0.5 size-4 shrink-0 ${
                                          level === 'pass' ? 'text-emerald-500' : level === 'warning' ? 'text-amber-500' : 'text-destructive'
                                        }`}
                                      />
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium">{item.title}</p>
                                        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{item.message}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="beginAtDate" className="text-sm font-medium">
                      开始日期
                    </label>
                    <Input
                      id="beginAtDate"
                      name="beginAtDate"
                      type="date"
                      value={beginDate}
                      onChange={(e) => setBeginDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="beginAtTime" className="text-sm font-medium">
                      开始时间
                    </label>
                    <Input
                      id="beginAtTime"
                      name="beginAtTime"
                      type="time"
                      value={beginTime}
                      onChange={(e) => setBeginTime(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="duration" className="text-sm font-medium">
                      时长 (小时)
                    </label>
                    <Input
                      id="duration"
                      name="duration"
                      type="number"
                      step="0.5"
                      min="0"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">结束时间</label>
                    <Input value={formatDateTimeInput(beginDate, beginTime, duration)} readOnly className="text-muted-foreground" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">题目列表</label>
                  <MultiSelect<ProblemOption>
                    loadOptions={(q) => searchProblems(q, 20)}
                    value={pidValue}
                    onChange={setPidValue}
                    getKey={(p) => String(p.docId || p.pid)}
                    getLabel={(p) => `${p.pid || p.docId} ${p.title || ''}`.trim()}
                    renderChip={(p) => (
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">{p.pid || p.docId}</span>
                        {p.title ? <span className="truncate max-w-[140px]">{p.title}</span> : null}
                      </span>
                    )}
                    renderOption={(p) => (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[11px] text-muted-foreground shrink-0">{p.pid || p.docId}</span>
                        <span className="truncate flex-1">{p.title || '—'}</span>
                        {p.difficulty ? (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Lv.{p.difficulty}
                          </Badge>
                        ) : null}
                        {p.nSubmit ? (
                          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                            {p.nAccept ?? 0}/{p.nSubmit}
                          </span>
                        ) : null}
                      </div>
                    )}
                    name="pids"
                    placeholder="搜索题目 (pid / 标题)…"
                    minHeight={48}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="content" className="text-sm font-medium">
                    比赛说明 (Markdown)
                  </label>
                  <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={320} />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">允许语言（留空为全部）</label>
                  <MultiSelect<LangOption>
                    options={COMMON_LANG_OPTIONS}
                    value={langValue}
                    onChange={setLangValue}
                    getKey={(o) => o.value}
                    getLabel={(o) => `${o.label} (${o.value})`}
                    renderChip={(o) => <span className="font-mono">{o.label}</span>}
                    renderOption={(o) => (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{o.label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{o.value}</span>
                      </div>
                    )}
                    name="langs"
                    placeholder="留空 = 全部"
                  />
                </div>
              </div>

              {/* ─── Tab 2: 访问控制 ─── */}
              <div className="space-y-4" hidden={activeTab !== 'access'}>
                <div className="space-y-3 rounded-md border bg-muted/20 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="maintainer" className="text-sm font-medium">
                        比赛维护者
                      </label>
                      <Input id="maintainer" name="maintainer" defaultValue={formatCommaValue(tdoc.maintainer)} placeholder="UID，逗号分隔" />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="permission" className="text-sm font-medium">
                        访问控制
                      </label>
                      <SimpleSelect
                        id="permission"
                        value={permission}
                        onValueChange={setPermission}
                        options={[
                          { value: 'public', label: '公开' },
                          { value: 'invite', label: '需要邀请码' },
                          { value: 'assign', label: '指定用户 / 旧用户组' },
                        ]}
                      />
                    </div>
                  </div>
                  {permission === 'invite' && (
                    <div className="space-y-1.5">
                      <label htmlFor="code" className="text-sm font-medium">
                        邀请码
                      </label>
                      <Input id="code" name="code" defaultValue={tdoc._code || tdoc.code || ''} placeholder="留空表示不设置邀请码" />
                    </div>
                  )}
                  {permission === 'assign' && (
                    <div className="space-y-1.5">
                      <label htmlFor="assign" className="text-sm font-medium">
                        分配给（旧用户组，兼容字段）
                      </label>
                      <Input id="assign" name="assign" defaultValue={formatCommaValue(tdoc.assign)} placeholder="用户组 / UID，逗号分隔" />
                      <p className="text-[11px] text-muted-foreground">新比赛建议使用「参赛范围」标签页里的 Krypton 学校 / 用户组。</p>
                    </div>
                  )}
                </div>

                {/* Contest-level verifier panel — only meaningful for an unstarted
                  contest whose problems are still hidden. Once contest opens
                  the unhide worker clears the hidden flag (unless lockHidden);
                  permits become moot regardless. */}
                {tdoc._id ? <ContestVerifierPanel tid={String(tdoc._id)} verifiers={tdoc.verifiers || []} /> : null}
              </div>

              {/* ─── Tab 3: 参赛范围 (Krypton) ─── */}
              <div className="space-y-4" hidden={activeTab !== 'scope'}>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">参赛范围模式</label>
                  <SimpleSelect
                    value={scopeMode}
                    onValueChange={(v) => setScopeMode(v as ParticipantScopeMode)}
                    options={[
                      { value: 'none', label: '不限（仅看老 Hydro 访问控制）' },
                      { value: 'schools', label: '按学校限定' },
                      { value: 'groups', label: '按用户组限定' },
                    ]}
                  />
                  <input type="hidden" name="participantScopeMode" value={scopeMode} />
                  <p className="text-[11px] text-muted-foreground">范围与老 Hydro 访问控制取 AND（同时满足）。学校与用户组互斥。</p>
                </div>

                {scopeMode === 'schools' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">学校</label>
                    <MultiSelect<ScopeOption>
                      options={schoolCatalog}
                      value={schoolValue}
                      onChange={setSchoolValue}
                      getKey={(o) => o._id}
                      getLabel={(o) => o.name}
                      name="participantSchoolIds"
                      placeholder="选择学校…"
                    />
                  </div>
                )}

                {scopeMode === 'groups' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">用户组</label>
                    <MultiSelect<ScopeOption>
                      options={groupCatalog}
                      value={groupValue}
                      onChange={setGroupValue}
                      getKey={(o) => o._id}
                      getLabel={(o) => (o.schoolName ? `${o.name}（${o.schoolName}）` : o.name)}
                      name="participantGroupIds"
                      placeholder="选择用户组…"
                    />
                  </div>
                )}

                {/* Keep the OTHER mode's id list out of the post so the
                  back-end normalization can rely on emptiness. */}
                {scopeMode !== 'schools' && <input type="hidden" name="participantSchoolIds" value="" />}
                {scopeMode !== 'groups' && <input type="hidden" name="participantGroupIds" value="" />}
              </div>

              {/* ─── Tab 4: 客户端与反作弊 (Krypton) ─── */}
              <div className="space-y-4" hidden={activeTab !== 'vigil'}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={vigilEnabled} disabled={participationMode === 'team'} onCheckedChange={(v) => setVigilEnabled(!!v)} />
                  启用 Vigil 反作弊
                  <span className="ml-auto text-[11px] text-muted-foreground">开启后比赛的会话会被推送到 Vigil Server</span>
                </label>
                <input type="hidden" name="vigilEnabled" value={vigilEnabled ? 'true' : 'false'} />

                {vigilEnabled && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">进入模式</label>
                        <SimpleSelect
                          value={entryMode}
                          disabled={participationMode === 'team'}
                          onValueChange={(v) => setEntryMode(v as ContestEntryMode)}
                          options={[
                            { value: 'open', label: '普通网页可进入（Vigil 可选）' },
                            { value: 'client_required', label: '必须通过 Qt Client 进入' },
                          ]}
                        />
                        <input type="hidden" name="entryMode" value={entryMode} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">审批模式</label>
                        <SimpleSelect
                          value={approvalMode}
                          onValueChange={(v) => setApprovalMode(v as ContestApprovalMode)}
                          options={[
                            { value: 'auto', label: 'auto（已绑定且命中范围的学生自动通过）' },
                            { value: 'strict', label: 'strict（全部进入老师审批）' },
                          ]}
                        />
                        <input type="hidden" name="approvalMode" value={approvalMode} />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={lockdownMode} onCheckedChange={(v) => setLockdownMode(!!v)} />
                        启用客户端锁屏 / 热键拦截
                      </label>
                      <input type="hidden" name="lockdownMode" value={lockdownMode ? 'true' : 'false'} />
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox name="pauseOnDisconnect" value="true" defaultChecked={!!tdoc.pauseOnDisconnect} />
                        断线时暂停
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox name="exclusive" value="true" defaultChecked={!!tdoc.exclusive} />
                        锁定当前比赛工作台（不显示比赛切换器）
                      </label>
                    </div>

                    {/* 实时媒体三开关 */}
                    <div className="space-y-3 rounded-md border bg-muted/20 p-4">
                      <h3 className="text-sm font-medium">实时媒体</h3>
                      <p className="text-xs text-muted-foreground">
                        推流到 SRS 媒体服务器；老师在反作弊详情页可看实时画面。<strong>失败不影响考试</strong>。
                      </p>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox name="liveEnabled" value="true" defaultChecked={tdoc.liveEnabled !== false} />
                          实时屏幕直播
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox name="cameraEnabled" value="true" defaultChecked={tdoc.cameraEnabled !== false} />
                          摄像头直播（防替考）
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox name="recordEnabled" value="true" defaultChecked={!!tdoc.recordEnabled} />
                          服务器录屏 mp4（存储压力大，默认关闭）
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">截图间隔 (ms)</label>
                        <Input type="number" name="screenshotIntervalMs" min={1000} step={1000} defaultValue={tdoc.screenshotIntervalMs || 60000} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">截图抖动 (ms)</label>
                        <Input type="number" name="screenshotJitterMs" min={0} step={1000} defaultValue={tdoc.screenshotJitterMs ?? 30000} />
                        <p className="text-[11px] text-muted-foreground">实际 = 间隔 ± rand(0, 抖动)，防学生预判</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">封锁开始（分钟）</label>
                        <Input type="number" name="clientLoginBlockBeforeMinutes" min={0} defaultValue={tdoc.clientLoginBlockBeforeMinutes ?? 60} />
                        <p className="text-[11px] text-muted-foreground">比赛开始前 N 分钟开始拒绝普通网页登录</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">封锁结束（分钟）</label>
                        <Input type="number" name="clientLoginBlockAfterMinutes" min={0} defaultValue={tdoc.clientLoginBlockAfterMinutes ?? 30} />
                        <p className="text-[11px] text-muted-foreground">比赛结束后 N 分钟解除拒绝</p>
                      </div>
                    </div>

                    {/* 进程白名单 */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">进程白名单（每行一个，加在服务器全局默认之上）</label>
                      <textarea
                        name="vigilProcessWhitelist"
                        defaultValue={(tdoc.vigilProcessWhitelist || []).join('\n')}
                        rows={5}
                        className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                        placeholder={'Code.exe\npython.exe\nmsedge.exe'}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        不在白名单的进程启动会触发 <code>process_started_unauthorized</code> 事件
                      </p>
                    </div>

                    <div className="space-y-4 rounded-md border bg-muted/20 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <h3 className="flex items-center gap-2 text-sm font-medium">
                            <WifiOff className="size-4" />
                            考试网络锁
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            进入考试 WebView 后，只允许访问默认白名单和下方附加白名单；系统层由客户端服务执行，WebView 内也会拦截非白名单 URL。
                          </p>
                        </div>
                        <label className="flex shrink-0 items-center gap-2 text-sm">
                          <Checkbox
                            checked={networkLockdownMode}
                            onCheckedChange={(v) => {
                              setNetworkTouched(true);
                              setNetworkLockdownMode(!!v);
                            }}
                          />
                          启用网络锁
                        </label>
                      </div>
                      <input type="hidden" name="networkLockdownMode" value={networkLockdownMode ? 'true' : 'false'} />

                      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">失败策略</label>
                          <SimpleSelect
                            value={networkFailurePolicy}
                            onValueChange={(v) => setNetworkFailurePolicy(v as NetworkFailurePolicy)}
                            options={[
                              { value: 'strict', label: 'strict：失败则不进入考试' },
                              { value: 'report_only', label: 'report_only：失败上报后放行' },
                              { value: 'off', label: 'off：不启用系统网络锁' },
                            ]}
                          />
                          <input type="hidden" name="networkLockdownFailurePolicy" value={networkFailurePolicy} />
                        </div>
                        <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
                          默认白名单会自动包含 OJ、Vigil Server、回环、DNS/DHCP 基础连接。下方只填写这场比赛额外允许的地址。
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">附加域名 / Host</label>
                          <textarea
                            name="networkWhitelistHosts"
                            defaultValue={(tdoc.networkWhitelistHosts || []).join('\n')}
                            rows={4}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                            placeholder={'docs.school.edu.cn\n*.school.edu.cn'}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">附加 IP / CIDR</label>
                          <textarea
                            name="networkWhitelistIps"
                            defaultValue={(tdoc.networkWhitelistIps || []).join('\n')}
                            rows={4}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                            placeholder={'10.1.234.2\n10.1.0.0/16'}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">附加端口</label>
                          <textarea
                            name="networkWhitelistPorts"
                            defaultValue={(tdoc.networkWhitelistPorts || []).join('\n')}
                            rows={4}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                            placeholder={'80\n443\n8765'}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ─── Tab 5: 比赛设置 ─── */}
              <div className="space-y-4" hidden={activeTab !== 'settings'}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="lock" className="text-sm font-medium">
                      封榜时间 (剩余分钟)
                    </label>
                    <Input id="lock" name="lock" type="number" min="0" defaultValue={lockMinutes} placeholder="留空表示不封榜" />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="contestDuration" className="text-sm font-medium">
                      弹性时长 (小时)
                    </label>
                    <Input
                      id="contestDuration"
                      name="contestDuration"
                      type="number"
                      min="0"
                      step="0.5"
                      defaultValue={tdoc.duration || ''}
                      placeholder="留空表示不限制"
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="rated" value="true" checked={rated} disabled={participationMode === 'team'} onCheckedChange={setRated} />
                    计入 Rating
                  </label>
                  {participationMode === 'team' ? <input type="hidden" name="rated" value="false" /> : null}
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="autoHide" value="true" defaultChecked={defaultAutoHide} disabled={!canAutoHideProblems} />
                    比赛中自动隐藏题目（赛后自动公开）
                  </label>
                  {!canAutoHideProblems && defaultAutoHide ? <input type="hidden" name="autoHide" value="true" /> : null}
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="allowViewCode" value="true" defaultChecked={defaultAllowViewCode} />
                    允许查看代码
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="allowPrint" value="true" defaultChecked={tdoc.allowPrint} />
                    允许打印
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="keepScoreboardHidden" value="true" defaultChecked={tdoc.keepScoreboardHidden} />
                    赛后保持榜单隐藏
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button ref={primarySubmitRef} type="submit" name="operation" value="update">
                  <Save className="mr-1 size-4" />
                  {isEdit ? '保存修改' : '创建比赛'}
                </Button>
                {isEdit && (
                  <Button type="submit" name="operation" value="update" variant="outline" formAction={`${bs.urls.contests}/create`}>
                    <Copy className="mr-1 size-4" />
                    复制为新比赛
                  </Button>
                )}
                {isEdit && (
                  <Button
                    type="submit"
                    name="operation"
                    value="delete"
                    variant="destructive"
                    size="sm"
                    formNoValidate
                    onClick={(e) => {
                      if (!confirm('确定要删除此比赛吗？')) e.preventDefault();
                    }}
                  >
                    <Trash2 className="mr-1 size-3" />
                    删除比赛
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
        <Dialog open={modeClearOpen} onOpenChange={setModeClearOpen}>
          <TeamDialogContent
            titleId="clear-contest-teams-dialog-title"
            descriptionId="clear-contest-teams-dialog-description"
            title="停用本场全部队伍？"
            description="切回个人模式会释放当前阵容，但不会删除历史队伍文档。"
            icon={<AlertTriangle className="size-5" />}
            tone="destructive"
            onClose={() => setModeClearOpen(false)}
            className="sm:w-[30rem]"
          >
            <TeamDialogBody className="pb-6">
              <div className="rounded-2xl bg-destructive/5 p-4 ring-1 ring-destructive/20">
                <p className="text-sm font-semibold text-destructive">将停用 {Number(data.activeTeamCount || 0)} 支有效队伍</p>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">之后需要重新组队，才能再次启用团队赛。</p>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">只有比赛尚未开始且没有任何提交时允许执行。</p>
            </TeamDialogBody>
            <TeamDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setModeClearOpen(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setModeClearConfirmed(true);
                  setModeClearOpen(false);
                  window.setTimeout(() => {
                    if (!formRef.current || !primarySubmitRef.current) throw new Error('Contest update submitter is unavailable.');
                    formRef.current.requestSubmit(primarySubmitRef.current);
                  }, 0);
                }}
                className={TEAM_DIALOG_BUTTON_CLASS}
              >
                停用队伍并保存
              </Button>
            </TeamDialogFooter>
          </TeamDialogContent>
        </Dialog>
        <Dialog open={finalizeTeamBatchOpen} onOpenChange={setFinalizeTeamBatchOpen}>
          <TeamDialogContent
            titleId="finalize-team-batch-dialog-title"
            descriptionId="finalize-team-batch-dialog-description"
            title="锁定阵容并生成快照？"
            description="系统会重新校验整批成员，并为本场比赛生成一份不可自动同步的独立队伍快照。"
            icon={<ClipboardCheck className="size-5" />}
            onClose={() => setFinalizeTeamBatchOpen(false)}
            className="sm:w-[30rem]"
          >
            <form method="post" className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="operation" value="finalize_team_batch" />
              <input type="hidden" name="plannedTeamBatchId" value={persistedPlannedTeamBatchId} />
              <TeamDialogBody>
                <div className="rounded-2xl bg-muted/45 p-4 ring-1 ring-foreground/8">
                  <p className="text-sm font-semibold">{selectedTeamBatch?.name || '当前预绑定批次'}</p>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {Number(selectedTeamBatch?.teamCount || 0)} 支队伍 · {Number(selectedTeamBatch?.memberCount || 0)}{' '}
                    名成员。定版成功后，批次仍可供其他比赛独立使用。
                  </p>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  比赛开始、已有提交、已有比赛队伍或成员资格变化时，服务端会拒绝且不会留下半批队伍。
                </p>
              </TeamDialogBody>
              <TeamDialogFooter>
                <Button type="button" variant="secondary" onClick={() => setFinalizeTeamBatchOpen(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
                  取消
                </Button>
                <Button type="submit" className={TEAM_DIALOG_BUTTON_CLASS}>
                  确认定版
                </Button>
              </TeamDialogFooter>
            </form>
          </TeamDialogContent>
        </Dialog>
      </ContestManagementChrome>
    </motion.div>
  );
}

/* ---------- Contest verifier panel ---------- */

function ContestVerifierPanel({ tid, verifiers }: { tid: string; verifiers: number[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">验比赛人</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">邀请后将自动对所有比赛题目（含将来添加的）授权可见，比赛开始 / 删除时自动清理。</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          邀请
        </Button>
      </div>
      {verifiers.length === 0 ? (
        <p className="text-xs text-muted-foreground">还没有验比赛人</p>
      ) : (
        <ul className="space-y-1">
          {verifiers.map((uid) => (
            <li key={uid} className="flex items-center justify-between text-sm">
              <span>UID {uid}</span>
              <form
                method="post"
                action={`/contest/${tid}/verifiers/remove`}
                onSubmit={(e) => {
                  if (!confirm(`确定移除 UID ${uid}？该用户对所有比赛题目的查看权将被撤销。`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="uid" value={uid} />
                <Button type="submit" size="sm" variant="ghost" className="h-7 text-xs text-destructive">
                  移除
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="w-full sm:w-[480px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>邀请验比赛人</DialogTitle>
          </DialogHeader>
          <form method="post" action={`/contest/${tid}/verifiers`} className="space-y-3 p-5">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="cv-uid">
                用户 UID
              </label>
              <Input id="cv-uid" name="uid" type="number" min={2} required />
            </div>
            {/* Role hidden; same C1 simplification as the problem-edit panel. */}
            <input type="hidden" name="role" value="verifier" />
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="cv-note">
                附言（可选）
              </label>
              <Input id="cv-note" name="note" placeholder="例：帮忙验一下比赛 P1-P4" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">发送邀请</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Contest Manage (files) ---------- */

interface SubmissionProblemStat {
  pid: number;
  total: number;
  accepted: number;
}
interface SubmissionHourStat {
  hour: string;
  count: number;
}
/** JSON shape of the management-page submission statistics aggregate. */
interface ContestSubmissionStats {
  total: number;
  accepted: number;
  participants: number;
  participantUnit: 'team' | 'user';
  byProblem: SubmissionProblemStat[];
  byHour: SubmissionHourStat[];
}

export function ContestManagePage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestManagePageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const files: ContestFileInfo[] = data.files || [];
  const privateFiles: ContestFileInfo[] = data.privateFiles || [];
  const pdict: Record<string, ProblemBrief> = data.pdict || {};
  // tdoc.pids is the canonical, de-duplicated, ordered list of problem docIds.
  // pdict is keyed by BOTH docId and pid (ProblemModel.getList merges r + l),
  // so iterating Object.entries(pdict) renders problems with a custom pid twice
  // — drive the table off pids instead.
  const pids: number[] = tdoc.pids || [];
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const [selectedPublic, setSelectedPublic] = useState<Set<string>>(new Set());
  const [selectedPrivate, setSelectedPrivate] = useState<Set<string>>(new Set());
  const [activeManageTab, setActiveManageTab] = useState<'score' | 'stats' | 'public' | 'private'>('score');
  const submissionStats: ContestSubmissionStats | null = data.submissionStats || null;

  const toggleContestFile = (selected: Set<string>, setSelected: (next: Set<string>) => void, name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const FileSection = ({
    title,
    fileList,
    type,
    selected,
    setSelected,
  }: {
    title: string;
    fileList: ContestFileInfo[];
    type: string;
    selected: Set<string>;
    setSelected: (next: Set<string>) => void;
  }) => (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />
          {title} ({fileList.length})
        </CardTitle>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <form method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
              <Upload className="mr-1 size-3" />
              上传
            </Button>
          </form>
          {selected.size > 0 && (
            <form
              method="post"
              onSubmit={(event) => {
                if (!window.confirm(`确认删除选中的 ${selected.size} 个文件吗？`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="operation" value="delete_files" />
              <input type="hidden" name="type" value={type} />
              {Array.from(selected).map((name) => (
                <input key={name} type="hidden" name="files" value={name} />
              ))}
              <Button type="submit" size="sm" variant="destructive">
                <Trash2 className="mr-1 size-3" />
                删除 ({selected.size})
              </Button>
            </form>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {fileList.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selected.size === fileList.length && fileList.length > 0}
                    onChange={() => setSelected(selected.size === fileList.length ? new Set() : new Set(fileList.map((file) => file.name)))}
                  />
                </TableHead>
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-28 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileList.map((f) => (
                <TableRow key={f.name}>
                  <TableCell>
                    <Checkbox checked={selected.has(f.name)} onChange={() => toggleContestFile(selected, setSelected, f.name)} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{f.name}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-1">
                      <Button asChild variant="ghost" size="icon" className="size-7">
                        <a href={`${contestUrl}/file/${type}/${encodeURIComponent(f.name)}`}>
                          <Download className="size-3" />
                        </a>
                      </Button>
                      <form method="post" className="inline">
                        <input type="hidden" name="files" value={f.name} />
                        <input type="hidden" name="type" value={type} />
                        <Button type="submit" name="operation" value="delete_files" variant="ghost" size="icon" className="size-7">
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">暂无文件</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">比赛管理</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <ContestManagementChrome tdoc={tdoc} active="overview">
        <div className="space-y-4">
          <MiniTabs<'score' | 'stats' | 'public' | 'private'>
            value={activeManageTab}
            onValueChange={setActiveManageTab}
            items={[
              { value: 'score' as const, label: '题目分值', count: pids.length, icon: ListChecks },
              ...(submissionStats ? [{ value: 'stats' as const, label: '提交统计', count: submissionStats.total || 0, icon: Clock }] : []),
              { value: 'public' as const, label: '公开文件', count: files.length, icon: FolderOpen },
              { value: 'private' as const, label: '私有材料', count: privateFiles.length, icon: ShieldCheck },
            ]}
            size="md"
            aria-label="比赛管理功能"
          />

          {activeManageTab === 'score' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">题目分值</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {pids.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16 text-center">#</TableHead>
                        <TableHead>题目</TableHead>
                        <TableHead className="w-32 text-right">分值</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pids.map((pid, idx) => {
                        const p: ProblemBrief = pdict[String(pid)] || {};
                        return (
                          <TableRow key={String(pid)}>
                            <TableCell className="text-center font-mono font-semibold">{getAlphabeticId(idx)}</TableCell>
                            <TableCell className="text-sm">{p.title || `P${pid}`}</TableCell>
                            <TableCell className="text-right">
                              <form method="post" className="flex items-center justify-end gap-1">
                                <input type="hidden" name="operation" value="set_score" />
                                <input type="hidden" name="pid" value={pid} />
                                <Input name="score" type="number" min="1" defaultValue={tdoc.score?.[pid] || 100} className="w-20 text-right" />
                                <Button type="submit" size="icon" variant="ghost" className="size-7">
                                  <Save className="size-3" />
                                </Button>
                              </form>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="p-6 text-center text-sm text-muted-foreground">该比赛还没有题目</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {activeManageTab === 'stats' && submissionStats ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">提交统计</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    ['总提交', submissionStats.total ?? 0],
                    ['AC 数', submissionStats.accepted ?? 0],
                    [submissionStats.participantUnit === 'team' ? '提交队伍' : '提交人数', submissionStats.participants ?? 0],
                    [
                      submissionStats.participantUnit === 'team' ? '队均提交' : '人均提交',
                      submissionStats.participants ? (submissionStats.total / submissionStats.participants).toFixed(1) : '—',
                    ],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border bg-muted/20 px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">{label}</div>
                      <div className="font-mono text-sm font-medium">{value}</div>
                    </div>
                  ))}
                </div>

                {(submissionStats.byProblem || []).length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">按题分布</div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16 text-center">#</TableHead>
                          <TableHead>题目</TableHead>
                          <TableHead className="w-24 text-right">提交</TableHead>
                          <TableHead className="w-24 text-right">AC</TableHead>
                          <TableHead className="w-40">AC 率</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {submissionStats.byProblem.map((row) => {
                          const idx = pids.indexOf(row.pid);
                          const p: ProblemBrief = pdict[String(row.pid)] || {};
                          const rate = row.total ? row.accepted / row.total : 0;
                          return (
                            <TableRow key={String(row.pid)}>
                              <TableCell className="text-center font-mono font-semibold">{idx >= 0 ? getAlphabeticId(idx) : '—'}</TableCell>
                              <TableCell className="text-sm">{p.title || `P${row.pid}`}</TableCell>
                              <TableCell className="text-right font-mono">{row.total}</TableCell>
                              <TableCell className="text-right font-mono">{row.accepted}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(rate * 100)}%` }} />
                                  </div>
                                  <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">{Math.round(rate * 100)}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}

                {(submissionStats.byHour || []).length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">按小时提交</div>
                    <div className="space-y-1">
                      {(() => {
                        const rows = submissionStats.byHour;
                        const max = Math.max(...rows.map((r) => r.count), 1);
                        return rows.map((r) => (
                          <div key={r.hour} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 font-mono text-[11px] text-muted-foreground">{String(r.hour).replace('T', ' ')}:00</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                            </div>
                            <span className="w-10 shrink-0 text-right font-mono text-[11px]">{r.count}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {activeManageTab === 'public' ? (
            <FileSection title="公开文件" fileList={files} type="public" selected={selectedPublic} setSelected={setSelectedPublic} />
          ) : null}

          {activeManageTab === 'private' ? (
            <FileSection title="私有文件" fileList={privateFiles} type="private" selected={selectedPrivate} setSelected={setSelectedPrivate} />
          ) : null}
        </div>
      </ContestManagementChrome>
    </motion.div>
  );
}

/* ---------- Contest Problem List ---------- */

/** A jury reply attached to a clarification document. */
interface ClarificationReplyDoc {
  _id?: string;
  content?: string;
}
/** JSON-serialized contest clarification (discussion) document. */
interface ClarificationDoc {
  _id?: string;
  owner?: number;
  subject?: unknown;
  content?: string;
  updateAt?: string;
  reply?: ClarificationReplyDoc[];
}
/** JSON-serialized record row as rendered in the "my submissions" table. */
interface ContestRecordDoc {
  _id?: string;
  pid?: number;
  status?: number;
  statusText?: string;
  lang?: string;
  time?: number;
  memory?: number;
}
/** Per-problem live pass statistics (P1.4, ACM only). */
interface ContestLiveProblemStat {
  acUsers?: number;
  triedUsers?: number;
  acSubmits?: number;
  totalSubmits?: number;
}

export function ContestProblemListPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestProblemListPageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const pdict: Record<string, ProblemBrief> = data.pdict || {};
  const problemStatusByPid: Record<string, R> = data.problemStatusByPid || {};
  const personalPracticeStatusByPid: Record<string, PersonalPracticeStatusSnapshot & { rid?: unknown }> = data.personalPracticeStatusByPid || {};
  const tcdocs: ClarificationDoc[] = data.tcdocs || [];
  const rdocs: ContestRecordDoc[] = data.rdocs || [];
  const pids: number[] = data.visiblePids || tdoc.pids || [];
  const tid = tdoc.docId || tdoc._id;
  const urls = examModeUrls(bs);
  const contestUrl = urls?.overview || replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const recordDetailUrl = (rid: string) =>
    urls?.record ? String(urls.record).replace('__RID__', rid) : replaceRouteTokens(bs.urls.recordDetail, { RID: rid });
  const practiceRecordDetailUrl = (rid: string) => {
    const base = recordDetailUrl(rid);
    const query = new URLSearchParams({ tid: String(tid), practice: '1' });
    return `${base}${base.includes('?') ? '&' : '?'}${query.toString()}`;
  };
  const showScore = data.showScore;
  const inExamMode = !!data.examMode?.enabled;
  const canViewRecord = !!data.canViewRecord;
  const canViewContestRecord = data.canViewContestRecord ?? canViewRecord;
  const showPostContestPractice = data.postContestPractice?.eligible === true;
  // P1.4：本场每题通过统计（仅 ACM；考试壳 examMode 下后端不下发、前端也不渲染——红线1）。
  const liveStats: Record<string, ContestLiveProblemStat> | null = tdoc.rule === 'acm' && !data.examMode && data.liveStats ? data.liveStats : null;
  const liveStatsUnit = data.liveStatsParticipantUnit === 'team' ? '队' : '人';
  const teamMode = tdoc.participationMode === 'team';
  const [workspaceTab, setWorkspaceTab] = useState<'problems' | 'submissions' | 'clarifications'>('problems');

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">比赛题目</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <MiniTabs
        value={workspaceTab}
        onValueChange={setWorkspaceTab}
        items={[
          { value: 'problems', label: '题目', count: pids.length, icon: ListChecks },
          { value: 'submissions', label: teamMode ? '本队提交' : '我的提交', count: rdocs.length, icon: Send },
          { value: 'clarifications', label: '澄清', count: tcdocs.length, icon: MessageSquare },
        ]}
        size="md"
        aria-label="比赛入口"
      />

      {workspaceTab === 'problems' ? (
        <div className="space-y-3">
          {showPostContestPractice ? (
            <div
              role="note"
              className="flex items-start gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-4 py-3 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-300" />
              <span>赛后补题按个人记录评测，不会改动原比赛成绩、罚时或排行榜。</span>
            </div>
          ) : null}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-center">#</TableHead>
                    <TableHead>题目</TableHead>
                    {showPostContestPractice ? (
                      <>
                        <TableHead className="w-28 text-center">赛时结果</TableHead>
                        <TableHead className="w-36 text-center">个人补题</TableHead>
                      </>
                    ) : inExamMode ? (
                      <TableHead className="w-28 text-center">我的状态</TableHead>
                    ) : null}
                    {liveStats && <TableHead className="w-32 text-right">本场通过</TableHead>}
                    {showScore && <TableHead className="w-20 text-right">分值</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pids.map((pid, idx) => {
                    const p: ProblemBrief = pdict[String(pid)] || {};
                    const ls = liveStats?.[String(pid)];
                    const statusDoc = showPostContestPractice ? data.psdict?.[String(pid)] || null : problemStatusByPid[String(pid)] || null;
                    const status =
                      statusDoc?.rid && !canViewContestRecord
                        ? ({ label: '已提交', title: '比赛规则暂不公开赛时结果', code: 'pending' } as const)
                        : getContestProblemStatus(statusDoc?.status);
                    const practiceStatusDoc = personalPracticeStatusByPid[String(pid)] || null;
                    const practiceStatus = getPersonalPracticeStatus(practiceStatusDoc);
                    const badgeClass = (value: ReturnType<typeof getContestProblemStatus>) =>
                      value?.code === 'pass'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : value?.code === 'fail'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : value?.code === 'progress'
                            ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                            : 'border-border bg-muted/50 text-muted-foreground';
                    const statusClass = badgeClass(status);
                    const practiceStatusClass = badgeClass(practiceStatus);
                    return (
                      <TableRow
                        key={String(pid)}
                        className={status?.code === 'pass' ? 'bg-emerald-500/[0.035] hover:bg-emerald-500/[0.065]' : undefined}
                      >
                        <TableCell className="text-center font-mono font-semibold">{getAlphabeticId(idx)}</TableCell>
                        <TableCell>
                          <a href={contestProblemUrl(bs, tdoc, pid)} className="text-sm text-primary hover:underline">
                            {p.title || `P${pid}`}
                          </a>
                        </TableCell>
                        {showPostContestPractice || inExamMode ? (
                          <TableCell className="text-center">
                            {status && statusDoc?.rid && canViewContestRecord ? (
                              <a
                                href={recordDetailUrl(String(statusDoc.rid))}
                                className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <Badge variant="outline" className={statusClass} title={status.title}>
                                  {status.label}
                                </Badge>
                              </a>
                            ) : (
                              <Badge variant="outline" className={statusClass} title={status?.title || '尚未提交'}>
                                {status?.label || '未提交'}
                              </Badge>
                            )}
                          </TableCell>
                        ) : null}
                        {showPostContestPractice ? (
                          <TableCell className="text-center">
                            {practiceStatus && practiceStatusDoc?.rid ? (
                              <a
                                href={practiceRecordDetailUrl(String(practiceStatusDoc.rid))}
                                className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <Badge variant="outline" className={practiceStatusClass} title={practiceStatus.title}>
                                  {practiceStatus.label}
                                </Badge>
                              </a>
                            ) : (
                              <Badge variant="outline" className={practiceStatusClass} title="尚未补题">
                                未提交
                              </Badge>
                            )}
                          </TableCell>
                        ) : null}
                        {liveStats && (
                          <TableCell
                            className="text-right font-mono text-xs text-muted-foreground"
                            title={`AC 提交 ${ls?.acSubmits ?? 0} / 总提交 ${ls?.totalSubmits ?? 0}`}
                          >
                            <span className={ls?.acUsers ? 'text-green-600 dark:text-green-400' : ''}>{ls?.acUsers ?? 0}</span>/{ls?.triedUsers ?? 0}{' '}
                            {liveStatsUnit}
                          </TableCell>
                        )}
                        {showScore && <TableCell className="text-right font-mono text-sm">{tdoc.score?.[pid] || 100}</TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {workspaceTab === 'submissions' ? (
        <Card>
          <CardContent className="p-0">
            {rdocs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">状态</TableHead>
                    <TableHead>题目</TableHead>
                    <TableHead className="w-24">语言</TableHead>
                    <TableHead className="w-24 text-right">时间</TableHead>
                    <TableHead className="w-24 text-right">内存</TableHead>
                    <TableHead className="w-40 text-right">提交时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rdocs.map((rdoc) => {
                    const problem: ProblemBrief = pdict[String(rdoc.pid)] || {};
                    return (
                      <TableRow key={String(rdoc._id)}>
                        <TableCell>
                          <a href={recordDetailUrl(String(rdoc._id))} className="text-xs font-medium text-primary hover:underline">
                            {rdoc.statusText || rdoc.status || 'Submitted'}
                          </a>
                        </TableCell>
                        <TableCell className="text-sm">{problem.title || `P${rdoc.pid}`}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{rdoc.lang || '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{rdoc.time != null ? `${rdoc.time}ms` : '—'}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{rdoc.memory != null ? `${rdoc.memory}KB` : '—'}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{formatObjectIdTime(rdoc._id, bs.locale) || '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">暂无提交</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Clarifications */}
      {workspaceTab === 'clarifications' && tcdocs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="size-4" />
              答疑 ({tcdocs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tcdocs.map((tc) => (
              <div key={String(tc._id)} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{clarificationSubjectLabel(tdoc, pdict, tc.subject)}</Badge>
                  <span className="text-xs text-muted-foreground">{tc.updateAt ? formatRelativeTime(tc.updateAt, bs.locale) : ''}</span>
                </div>
                <MarkdownView content={tc.content || ''} className="mt-2" preferredLang={bs.locale} />
                {Array.isArray(tc.reply) && tc.reply.length > 0 ? (
                  <div className="mt-3 space-y-2 border-l pl-3">
                    {tc.reply.map((reply) => (
                      <div key={String(reply._id || reply.content)} className="rounded-md bg-muted/30 p-3">
                        <div className="mb-1 text-xs text-muted-foreground">
                          Jury{reply._id ? ` · ${formatObjectIdTime(reply._id, bs.locale)}` : ''}
                        </div>
                        <MarkdownView content={reply.content || ''} preferredLang={bs.locale} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Submit clarification */}
      {workspaceTab === 'clarifications' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">提交答疑</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="post" className="space-y-3">
              <input type="hidden" name="operation" value="clarification" />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">主题</label>
                <SimpleSelect
                  name="subject"
                  defaultValue="0"
                  options={[
                    { value: '0', label: '通用' },
                    { value: '-1', label: '技术问题' },
                    ...pids.map((pid, idx) => {
                      const p: ProblemBrief = pdict[String(pid)] || {};
                      return {
                        value: String(pid),
                        label: `${getAlphabeticId(idx)} — ${p.title || `P${pid}`}`,
                      };
                    }),
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">内容 (Markdown)</label>
                <MarkdownEditor name="content" value="" minHeight={180} preferredLang={bs.locale} />
              </div>
              <Button type="submit">发送</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </motion.div>
  );
}

/* ---------- Contest User ---------- */

/** JSON-serialized contest participation status row (`tsdocs`). */
interface ContestUserStatusDoc {
  uid: number;
  attend?: number;
  unrank?: boolean;
  startAt?: string;
  endAt?: string;
}

export function ContestUserPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestUserPageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const tsdocs: ContestUserStatusDoc[] = data.tsdocs || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const [userTab, setUserTab] = useState<'list' | 'add'>('list');
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);
  const searchUsers = useCallback(
    async (query: string): Promise<UserOption[]> => {
      const q = query.trim();
      if (!q) return [];
      const domainId = encodeURIComponent(bs.domain?.id || 'system');
      const response = await fetch(`/d/${domainId}/api/users`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          args: { search: q, limit: 10, exact: false },
          projection: ['_id', 'uname', 'mail', 'avatarUrl'],
        }),
      });
      if (!response.ok) return [];
      const users = await response.json();
      return Array.isArray(users) ? users : [];
    },
    [bs.domain?.id],
  );

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">参赛选手</h1>
          <p className="text-sm text-muted-foreground">
            {tdoc.title} — 共 {tsdocs.length} 人
          </p>
        </div>
      </div>

      <ContestManagementChrome tdoc={tdoc} active="users">
        <div className="space-y-4">
          <MiniTabs
            value={userTab}
            onValueChange={setUserTab}
            items={[
              { value: 'list', label: '选手列表', count: tsdocs.length, icon: Users },
              { value: 'add', label: '添加选手', icon: UserPlus },
            ]}
            size="md"
            aria-label="选手管理"
          />

          {userTab === 'add' ? (
            <Card>
              <CardContent className="p-4">
                <form method="post" className="space-y-4">
                  <input type="hidden" name="operation" value="add_user" />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">用户</label>
                    <MultiSelect<UserOption>
                      value={selectedUsers}
                      onChange={setSelectedUsers}
                      loadOptions={searchUsers}
                      getKey={(u) => String(u._id)}
                      getLabel={(u) => `${u.uname || `uid:${u._id}`} ${u._id} ${u.mail || ''}`}
                      renderChip={(u) => (
                        <span className="inline-flex items-center gap-1">
                          <span>{u.uname || `uid:${u._id}`}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">#{u._id}</span>
                        </span>
                      )}
                      renderOption={(u) => (
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">
                            {u.uname || `uid:${u._id}`}
                            <span className="ml-2 font-mono text-[11px] text-muted-foreground">UID {u._id}</span>
                          </span>
                          {u.mail ? <span className="truncate text-[11px] text-muted-foreground">{u.mail}</span> : null}
                        </span>
                      )}
                      name="uids"
                      placeholder="输入 UID / 用户名 / 邮箱搜索"
                      emptyText="没有找到用户"
                      minHeight={44}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name="unrank" value="true" />
                      不计入排名
                    </label>
                    <Button type="submit" disabled={selectedUsers.length === 0}>
                      <UserPlus className="mr-1 size-4" />
                      添加选手
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {userTab === 'list' ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead className="w-20 text-center">状态</TableHead>
                      <TableHead className="w-36 text-right">开始时间</TableHead>
                      <TableHead className="w-36 text-right">结束时间</TableHead>
                      <TableHead className="w-20 text-center">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tsdocs.map((ts) => {
                      const u = getUser(udict, ts.uid);
                      return (
                        <TableRow key={String(ts.uid)}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="size-6">
                                <AvatarFallback className="text-[10px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                              </Avatar>
                              <span className="text-sm">{u?.uname || `UID ${ts.uid}`}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            {ts.attend ? (
                              <Badge variant={ts.unrank ? 'outline' : 'default'} className="text-xs">
                                {ts.unrank ? '不计排名' : '参赛中'}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                未参赛
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {ts.startAt ? formatDateTime(ts.startAt, bs.locale) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {ts.endAt ? formatDateTime(ts.endAt, bs.locale) : '-'}
                          </TableCell>
                          <TableCell className="text-center">
                            <form method="post" className="inline">
                              <input type="hidden" name="operation" value="rank" />
                              <input type="hidden" name="uid" value={String(ts.uid)} />
                              <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                                {ts.unrank ? '恢复排名' : '取消排名'}
                              </Button>
                            </form>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {tsdocs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          暂无选手
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </ContestManagementChrome>
    </motion.div>
  );
}

/* ---------- Contest Balloon ---------- */

/** JSON-serialized balloon task document. */
interface BalloonDoc {
  _id?: string;
  uid?: number;
  pid?: number | string;
  first?: boolean;
  /** Uid of the deliverer once the balloon has been sent. */
  sent?: number;
  sentAt?: string;
  contestTeamId?: string;
}
/** Team projection shipped in `data.teamDict` for team-mode balloons. */
interface ContestTeamBrief {
  teamId?: string;
  name?: string;
  captainUid?: number;
  memberUids?: number[];
}

export function ContestBalloonPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestBalloonPageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const bdocs: BalloonDoc[] = data.bdocs || [];
  const pdict: Record<string, ProblemBrief> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const teamDict: Record<string, ContestTeamBrief> = data.teamDict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const [balloonRows, setBalloonRows] = useState<BalloonColorRow[]>(() => normalizeBalloonRows(tdoc, pdict));
  const [balloonTab, setBalloonTab] = useState<'pending' | 'sent' | 'all'>('pending');
  const pendingBalloons = bdocs.filter((b) => !b.sent);
  const sentBalloons = bdocs.filter((b) => b.sent);
  const visibleBalloons = balloonTab === 'pending' ? pendingBalloons : balloonTab === 'sent' ? sentBalloons : bdocs;

  const updateBalloonRow = (pid: string, patch: Partial<BalloonColorRow>) => {
    setBalloonRows((rows) => rows.map((row) => (row.pid === pid ? { ...row, ...patch } : row)));
  };

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">气球分发</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <ContestManagementChrome tdoc={tdoc} active="balloon">
        <div className="space-y-4">
          <MiniTabs
            value={balloonTab}
            onValueChange={setBalloonTab}
            items={[
              { value: 'pending', label: '待处理', count: pendingBalloons.length, icon: Clock },
              { value: 'sent', label: '已送达', count: sentBalloons.length, icon: CheckCircle2 },
              { value: 'all', label: '全部', count: bdocs.length, icon: Trophy },
            ]}
            size="md"
            aria-label="气球任务"
          />

          {balloonRows.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <form method="post" className="space-y-3">
                <input type="hidden" name="operation" value="set_color" />
                <input type="hidden" name="color" value={serializeBalloonRows(balloonRows)} readOnly />
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-medium">题目气球配置</h2>
                    <p className="text-xs text-muted-foreground">为每道题设置发放时显示的颜色和气球名称。</p>
                  </div>
                  <Button type="submit" size="sm">
                    <Palette className="mr-1 size-3" />
                    保存颜色
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {balloonRows.map((row) => (
                    <div key={row.pid} className="grid gap-2 rounded-md border bg-muted/20 p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-semibold">
                          {row.label}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.title}</p>
                          <p className="text-xs text-muted-foreground">P{row.pid}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-[2.75rem_1fr] gap-2">
                        <input
                          type="color"
                          value={row.color}
                          className="h-9 w-11 cursor-pointer rounded-md border bg-background p-1"
                          onChange={(e) => updateBalloonRow(row.pid, { color: e.target.value })}
                          aria-label={`${row.label} 题气球颜色`}
                        />
                        <Input value={row.name} onChange={(e) => updateBalloonRow(row.pid, { name: e.target.value })} placeholder="气球名称" />
                      </div>
                    </div>
                  ))}
                </div>
              </form>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">状态</TableHead>
                    <TableHead className="w-28">编号</TableHead>
                    <TableHead>题目</TableHead>
                    <TableHead className="w-44">队伍 / 提交者</TableHead>
                    <TableHead className="w-36">送达者</TableHead>
                    <TableHead className="w-28 text-center">奖励</TableHead>
                    <TableHead className="w-20 text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBalloons.map((b) => {
                    const u = getUser(udict, b.uid);
                    const team = b.contestTeamId ? teamDict[String(b.contestTeamId)] : null;
                    const sentBy = getUser(udict, b.sent);
                    const p: ProblemBrief = pdict[String(b.pid)] || {};
                    const index = (tdoc.pids || []).map(String).indexOf(String(b.pid));
                    const config: ContestBalloonConfig | string = (tdoc.balloon || {})[String(b.pid)] || {};
                    const sent = Boolean(b.sent);
                    const submitTime = formatObjectIdTime(b._id, bs.locale);
                    return (
                      <TableRow key={String(b._id)}>
                        <TableCell>
                          <Badge variant={sent ? 'default' : 'outline'} className="text-xs">
                            {sent ? '已送达' : '待处理'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{String(b._id || '').slice(0, 8) || '-'}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-3 rounded-full border"
                              style={{ backgroundColor: typeof config === 'object' ? config.color : undefined }}
                            />
                            <span className="font-semibold">{getAlphabeticId(index)}</span>
                            <span className="min-w-0 truncate">
                              {typeof config === 'object' && config.name ? config.name : p.title || `P${b.pid}`}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{team?.name || u?.uname || `UID ${b.uid}`}</div>
                          {team ? <div className="text-xs text-muted-foreground">提交者：{u?.uname || `UID ${b.uid}`}</div> : null}
                          {submitTime && <div className="text-xs text-muted-foreground">{submitTime}</div>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {sentBy ? (
                            <>
                              <div>{sentBy.uname || `UID ${b.sent}`}</div>
                              {b.sentAt && <div className="text-xs text-muted-foreground">{formatDateTime(b.sentAt, bs.locale)}</div>}
                            </>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">{b.first ? '首个通过' : '-'}</TableCell>
                        <TableCell className="text-center">
                          {!sent && (
                            <form method="post" className="inline">
                              <input type="hidden" name="operation" value="done" />
                              <input type="hidden" name="balloon" value={String(b._id)} />
                              <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                                完成
                              </Button>
                            </form>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visibleBalloons.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                        暂无气球任务
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </ContestManagementChrome>
    </motion.div>
  );
}

/* ---------- Contest Clarification ---------- */

export function ContestClarificationPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestClarificationPageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const tcdocs: ClarificationDoc[] = data.tcdocs || [];
  const pdict: Record<string, ProblemBrief> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const tid = tdoc.docId || tdoc._id;
  const contestUrl = replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const pids: number[] = tdoc.pids || [];
  const [clarificationTab, setClarificationTab] = useState<'broadcast' | 'pending' | 'all'>('all');
  const pendingClarifications = tcdocs.filter((tc) => tc.owner && (!Array.isArray(tc.reply) || tc.reply.length === 0));
  const visibleClarifications = clarificationTab === 'pending' ? pendingClarifications : tcdocs;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">答疑管理</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <ContestManagementChrome tdoc={tdoc} active="clarification">
        <div className="space-y-4">
          <MiniTabs
            value={clarificationTab}
            onValueChange={setClarificationTab}
            items={[
              { value: 'broadcast', label: '广播', icon: MessageSquare },
              { value: 'pending', label: '待回复', count: pendingClarifications.length, icon: HelpCircle },
              { value: 'all', label: '全部答疑', count: tcdocs.length, icon: ListChecks },
            ]}
            size="md"
            aria-label="答疑管理"
          />

          {clarificationTab === 'broadcast' ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">发布通知</CardTitle>
              </CardHeader>
              <CardContent>
                <form method="post" className="space-y-3">
                  <input type="hidden" name="operation" value="clarification" />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SimpleSelect
                      name="subject"
                      defaultValue="0"
                      className="sm:col-span-1"
                      options={[
                        { value: '0', label: '通用通知' },
                        { value: '-1', label: '技术问题' },
                        ...pids.map((pid, idx) => {
                          const p: ProblemBrief = pdict[String(pid)] || {};
                          return {
                            value: String(pid),
                            label: `${getAlphabeticId(idx)} — ${p.title || `P${pid}`}`,
                          };
                        }),
                      ]}
                    />
                    <div className="hidden sm:col-span-2 sm:block" />
                    <div className="sm:col-span-3">
                      <MarkdownEditor name="content" value="" minHeight={180} preferredLang={bs.locale} />
                    </div>
                  </div>
                  <Button type="submit">
                    <MessageSquare className="mr-1 size-4" />
                    发送
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {clarificationTab !== 'broadcast' && visibleClarifications.length > 0 ? (
            <div className="space-y-3">
              {visibleClarifications.map((tc) => {
                const u = getUser(udict, tc.owner);
                return (
                  <Card key={String(tc._id)}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <Avatar className="size-6">
                          <AvatarFallback className="text-[9px]">{makeInitials(u?.uname || '?')}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{u?.uname || '管理员'}</span>
                        <Badge variant="outline" className="text-xs">
                          {clarificationSubjectLabel(tdoc, pdict, tc.subject)}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">{tc.updateAt ? formatRelativeTime(tc.updateAt, bs.locale) : ''}</span>
                      </div>
                      <MarkdownView content={tc.content || ''} className="mt-3" preferredLang={bs.locale} />
                      {Array.isArray(tc.reply) && tc.reply.length > 0 ? (
                        <div className="mt-3 space-y-2 border-l pl-3">
                          {tc.reply.map((reply) => (
                            <div key={String(reply._id || reply.content)} className="rounded-md bg-muted/30 p-3">
                              <div className="mb-1 text-xs text-muted-foreground">
                                Jury{reply._id ? ` · ${formatObjectIdTime(reply._id, bs.locale)}` : ''}
                              </div>
                              <MarkdownView content={reply.content || ''} preferredLang={bs.locale} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {tc.owner ? (
                        <form method="post" className="mt-4 space-y-2 border-t pt-3">
                          <input type="hidden" name="operation" value="clarification" />
                          <input type="hidden" name="did" value={String(tc._id)} />
                          <MarkdownEditor name="content" value="" minHeight={140} preferredLang={bs.locale} />
                          <Button type="submit" size="sm" variant="outline">
                            回复
                          </Button>
                        </form>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : clarificationTab !== 'broadcast' ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">暂无答疑</CardContent>
            </Card>
          ) : null}
        </div>
      </ContestManagementChrome>
    </motion.div>
  );
}

/* ---------- Contest Print ---------- */

/** JSON-serialized print task document. */
interface PrintTaskDoc {
  _id?: string;
  owner?: number;
  title?: string;
  content?: string;
  status?: string;
}
/** Response envelope of the print-page POST operations. */
interface PrintOperationResponse {
  tasks?: PrintTaskDoc[];
  udict?: Record<string, GenericUserDoc>;
  task?: PrintTaskDoc;
  udoc?: GenericUserDoc;
}

export function ContestPrintPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ContestPrintPageData;
  const tdoc: ContestDoc = data.tdoc || {};
  const tid = tdoc.docId || tdoc._id;
  const urls = examModeUrls(bs);
  const contestUrl = urls?.overview || replaceRouteTokens(bs.urls.contestDetail, { TID: String(tid) });
  const isPrintAdmin = Boolean(data.isAdmin || data.canEdit || String(bs.user.id) === String(tdoc.owner));
  const [tasks, setTasks] = useState<PrintTaskDoc[]>([]);
  const [udict, setUdict] = useState<Record<string, GenericUserDoc>>({});
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [printTab, setPrintTab] = useState<'submit' | 'queue' | 'kiosk'>('queue');

  const postPrintOperation = async (payload: Record<string, string>): Promise<PrintOperationResponse> => {
    const response = await fetch(window.location.href, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || '请求失败');
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };

  const refreshTasks = async () => {
    setLoadingTasks(true);
    try {
      const result = await postPrintOperation({ operation: 'get_print_task' });
      setTasks(result.tasks || []);
      setUdict(result.udict || {});
    } finally {
      setLoadingTasks(false);
    }
  };

  const printTask = (task: PrintTaskDoc, owner: Partial<GenericUserDoc>) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600,popup=1');
    if (!printWindow) return;
    const lines = String(task.content || '').split('\n');
    const clipped: string[] = [];
    let visualLines = 0;
    for (const line of lines) {
      visualLines += Math.max(1, Math.ceil(line.length / 100));
      if (visualLines > 300) break;
      clipped.push(line);
    }
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(task.title || 'Print')}</title>
          <style>
            body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 12px; font-size: 13px; line-height: 1.35; }
            .header { border-bottom: 1px solid #bbb; margin-bottom: 10px; padding-bottom: 6px; }
            .meta { display: flex; justify-content: space-between; gap: 16px; }
            pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="meta">
              <span>[${escapeHtml(owner.uname || `UID ${task.owner}`)}] ${escapeHtml(owner.school || '')} ${escapeHtml(owner.displayName || '')}</span>
              <span>${escapeHtml(formatObjectIdTime(task._id, bs.locale))}</span>
            </div>
            <div class="meta">
              <span>Filename: ${escapeHtml(task.title || '')}</span>
              <span>By Hydro</span>
            </div>
          </div>
          <pre>${escapeHtml(clipped.join('\n'))}</pre>
        </body>
      </html>
    `);
    printWindow.document.close();
    window.setTimeout(() => printWindow.print(), 300);
  };

  useEffect(() => {
    refreshTasks().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!kioskEnabled) return undefined;
    let active = true;
    const loop = async () => {
      while (active) {
        try {
          const result = await postPrintOperation({ operation: 'allocate_print_task' });
          if (result.task) {
            printTask(result.task, result.udoc || {});
            await postPrintOperation({ operation: 'update_print_task', taskId: String(result.task._id), status: 'printed' });
            await refreshTasks();
          } else {
            await new Promise((resolve) => {
              window.setTimeout(resolve, 5000);
            });
          }
        } catch {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 5000);
          });
        }
      }
    };
    loop();
    return () => {
      active = false;
    };
  }, [kioskEnabled]);

  const PrintChrome = ({ children }: { children: React.ReactNode }) =>
    urls ? (
      <>{children}</>
    ) : (
      <ContestManagementChrome tdoc={tdoc} active="print">
        {children}
      </ContestManagementChrome>
    );

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">打印服务</h1>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <PrintChrome>
        <div className="space-y-4">
          <MiniTabs
            value={printTab}
            onValueChange={setPrintTab}
            items={[
              { value: 'submit', label: '提交打印', icon: Upload },
              { value: 'queue', label: '打印队列', count: tasks.length, icon: FileText },
              { value: 'kiosk', label: '打印亭', icon: Printer, disabled: !isPrintAdmin },
            ]}
            size="md"
            aria-label="打印服务"
          />

          {printTab === 'submit' ? (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Printer className="size-4" />
                  提交打印
                </CardTitle>
                <form method="post" encType="multipart/form-data" className="flex items-center gap-2">
                  <input type="hidden" name="operation" value="print" />
                  <input type="file" name="file" className="text-xs" />
                  <Button type="submit" size="sm" variant="outline">
                    <Upload className="mr-1 size-3.5" />
                    上传文件
                  </Button>
                </form>
              </CardHeader>
              <CardContent>
                <form method="post" className="space-y-4">
                  <input type="hidden" name="operation" value="print" />
                  <div className="space-y-1.5">
                    <label htmlFor="title" className="text-sm font-medium">
                      标题
                    </label>
                    <Input id="title" name="title" placeholder="文件标题" required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">内容</label>
                    <textarea
                      name="content"
                      rows={12}
                      className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                      placeholder="粘贴要打印的代码或文本..."
                      required
                    />
                  </div>
                  <Button type="submit">
                    <Printer className="mr-1 size-4" />
                    提交打印
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {printTab === 'kiosk' && isPrintAdmin ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">打印亭模式</p>
                  <p className="text-xs text-muted-foreground">开启后自动领取待打印任务、打开系统打印对话并标记为已打印。</p>
                </div>
                <Button type="button" variant={kioskEnabled ? 'default' : 'outline'} onClick={() => setKioskEnabled((value) => !value)}>
                  <Printer className="mr-1 size-4" />
                  {kioskEnabled ? '打印亭已开启' : '开启打印亭'}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {printTab !== 'submit' ? (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4" />
                  打印队列
                </CardTitle>
                <Button type="button" size="sm" variant="outline" onClick={() => refreshTasks().catch((error) => alert(error.message))}>
                  <RefreshCw className="mr-1 size-3.5" />
                  {loadingTasks ? '刷新中' : '刷新'}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">用户</TableHead>
                      <TableHead>标题</TableHead>
                      <TableHead className="w-40">时间</TableHead>
                      <TableHead className="w-24 text-center">状态</TableHead>
                      {isPrintAdmin && <TableHead className="w-24 pr-5 text-right">操作</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isPrintAdmin ? 5 : 4} className="py-8 text-center text-sm text-muted-foreground">
                          暂无打印任务
                        </TableCell>
                      </TableRow>
                    ) : (
                      tasks.map((task) => {
                        const owner: Partial<GenericUserDoc> = udict[String(task.owner)] || {};
                        return (
                          <TableRow key={String(task._id)}>
                            <TableCell className="pl-5 text-sm">{owner.uname || `UID ${task.owner}`}</TableCell>
                            <TableCell className="font-mono text-sm">{task.title || '—'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatObjectIdTime(task._id, bs.locale) || '—'}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={String(task.status).includes('printed') ? 'secondary' : 'outline'} className="text-xs">
                                {String(task.status || 'pending')}
                              </Badge>
                            </TableCell>
                            {isPrintAdmin && (
                              <TableCell className="pr-5 text-right">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    postPrintOperation({ operation: 'update_print_task', taskId: String(task._id), status: 'pending' })
                                      .then(refreshTasks)
                                      .catch((error) => alert(error.message))
                                  }
                                >
                                  重新打印
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </PrintChrome>
    </motion.div>
  );
}
