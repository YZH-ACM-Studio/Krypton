/**
 * Paper answer-sheet page — the heart of Phase 2 / V2 rewrite.
 *
 * Layout:
 *   ExamDetailShell { topbar, section nav (md+ icon rail / <md bottom tabs) }
 *     section=overview      → OverviewSection
 *     section=problems      → ProblemsSection (md+ collapsible sub-sidebar; <md kind+cell strips)
 *     section=announcements → AnnouncementsSection
 *     section=ranking       → RankingSection
 *
 * Server provides: tdoc, pdict, cells, broadcasts, scoreboard, allowSubmitByKind, etc.
 */
import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { Lock, PanelLeftClose, PanelLeftOpen, Save, Send } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExamDetailShell, type ExamSection, useExamSection } from '@/components/layout/exam-shell';
import { MarkdownView } from '@/components/markdown-renderer';
import {
  BlankRenderer,
  CellCard,
  CellNavigator,
  type CellStatus,
  examPaperSurfaceTitle,
  FillProgramRenderer,
  firstPaperKind,
  groupCellsByKind,
  KIND_LABELS,
  MiniTabBar,
  MultiChoiceRenderer,
  type PaperCell,
  PaperStatusPill,
  type QuestionKind,
  SingleChoiceRenderer,
} from '@/components/paper/paper-shell';
import { AnnouncementsSection, OverviewSection, RankingSection } from '@/components/paper/sections';
import { StructuredRegionInputs } from '@/components/structured-region-inputs';
import { Button } from '@/components/ui/button';
import { alertDialog, confirmDialog } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface PdocLike {
  docId: number;
  title: string;
  content: string;
  config: {
    type?: string;
    mode?: 'text' | 'compile';
    subType?: string;
    answers?: Record<string, unknown>;
    template?: {
      lang?: string;
      surface: ClientStructuredCodeSegment[];
    };
    langs?: string[];
    options?: Record<string, string[]>;
  };
}

interface TdocLike {
  docId: string;
  _id: string;
  title: string;
  content?: string;
  beginAt: string;
  endAt: string;
  rule: string;
  owner: number;
  lockdownMode?: boolean;
  approvalMode?: string;
}

interface DraftState {
  answers: Record<string, string | string[]>;
  code?: string;
  regionContents?: Record<string, string>;
  lang?: string;
  lockedKinds: QuestionKind[];
  judgeResult?: Record<string, 'correct' | 'wrong' | 'partial'>;
  recordStatus?: string;
  problemFingerprint?: string;
  dirty: boolean;
  lastSavedAt?: number;
}

const EMPTY_DRAFT: DraftState = {
  answers: {},
  lockedKinds: [],
  dirty: false,
};

interface ExamModeStudentView {
  studentId?: string;
  realName?: string;
}

/** JSON-serialized `PaperDraft` row from GET /paper/:tid/draft — dates arrive as ISO strings. */
interface SavedDraftRow {
  pid: number;
  answers?: Record<string, string | string[]>;
  code?: string;
  lang?: string;
  lockedKinds?: QuestionKind[];
  judgeResult?: Record<string, 'correct' | 'wrong' | 'partial'>;
  problemFingerprint?: string;
  updatedAt?: string;
}

interface DraftListResponse {
  drafts: SavedDraftRow[];
  recordStatus?: Record<string, string>;
}

const SUBSIDEBAR_KEY = 'krypton:exam-subsidebar-collapsed';
const STRUCTURED_REGION_KINDS: QuestionKind[] = ['program_fill_text', 'program_fill_compile', 'function'];

function readSubsidebarCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(SUBSIDEBAR_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // private mode / quota
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
}

function parseSavedRegionContents(pdoc: PdocLike | undefined, rawCode: unknown): Record<string, string> | undefined {
  if (!pdoc || !['program_fill', 'function'].includes(pdoc.config.type || '')) return undefined;
  if (typeof rawCode !== 'string') throw new Error(`题目 ${pdoc.docId} 的 region 草稿缺少 code`);
  const parsed = JSON.parse(rawCode);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`题目 ${pdoc.docId} 的 region 草稿格式错误`);
  }
  const expected = (pdoc.config.template?.surface || [])
    .filter((segment): segment is Extract<ClientStructuredCodeSegment, { type: 'region' }> => segment.type === 'region')
    .map((region) => region.id)
    .sort();
  const actual = Object.keys(parsed).sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error(`题目 ${pdoc.docId} 的 region 草稿与当前模板不匹配`);
  }
  if (actual.some((id) => typeof parsed[id] !== 'string')) {
    throw new Error(`题目 ${pdoc.docId} 的 region 草稿包含非文本值`);
  }
  return parsed as Record<string, string>;
}

export function ExamPaperPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc: TdocLike;
    pdict: Record<number, PdocLike>;
    cells: PaperCell[];
    now: number;
    inWindow: boolean;
    canFinalize: boolean;
    paperStarted?: boolean;
    paperFinalized?: boolean;
    canStartPaper?: boolean;
    canViewPaper?: boolean;
    contestBeginAt?: string;
    contestEndAt?: string;
    durationHours?: number | null;
    paperOutline?: { questionCount: number; kinds: Array<{ kind: string; count: number }> };
    paperPreview?: boolean;
    owner: { uid: number; uname: string } | null;
    broadcasts: Array<{ _id: string; content: string; createdAt: string }>;
    scoreboard: Array<{ rank: number; uid: number; uname: string; realName?: string; studentId?: string; score: number }>;
    showScoreboard: boolean;
    allowSubmitByKind: boolean;
    examShowVerdict?: boolean;
    examPassScore?: number | null;
    examAttemptLimit?: number;
    examAttemptsUsed?: number;
    examScore?: number;
    examJudging?: boolean;
    examPassed?: boolean;
    canRetake?: boolean;
    examMinProblemsToPass?: number | null;
    examMode?: { student?: ExamModeStudentView | null };
  };
  const { tdoc, pdict, cells, inWindow, canFinalize, paperPreview, broadcasts, scoreboard, showScoreboard, allowSubmitByKind } = data;
  const paperStarted = data.paperStarted === true;
  const paperFinalized = data.paperFinalized === true;
  const canViewPaper = paperPreview === true || data.paperStarted !== false;
  const examStudent = data.examMode?.student;
  const tid = tdoc.docId;
  const [section, setSection] = useExamSection('overview');
  const [starting, setStarting] = useState(false);
  const paperLocked = data.paperStarted === false && paperPreview !== true;
  const visibleSection = paperLocked && section === 'problems' ? 'overview' : section;

  useEffect(() => {
    if (paperLocked && section === 'problems') {
      setSection('overview');
    }
  }, [paperLocked, section, setSection]);

  const startPaper = async () => {
    const retake = data.canRetake === true;
    if (!(await confirmDialog(
      retake
        ? '将清空上一轮本场答卷并重新计时。开了抽卷会再抽一卷。确定再考一次？'
        : '开始后将按个人时长计时，试卷不能重抽。确定开始答题？',
      { title: retake ? '再考一次' : '开始答题' },
    ))) return;
    setStarting(true);
    try {
      const res = await fetchHydroResponse(
        `/paper/${tid}/start`,
        { method: 'POST', headers: { Accept: 'application/json' } },
        '开始答题失败',
      );
      if (!res.ok) throw new Error(await readHydroResponseError(res, '开始答题失败'));
      window.location.hash = '#problems';
      window.location.reload();
    } catch (error) {
      setStarting(false);
      await alertDialog(error instanceof Error ? error.message : '开始答题失败');
    }
  };

  return (
    <ExamDetailShell
      title={tdoc.title}
      subtitle={paperPreview ? '管理员预览' : undefined}
      section={visibleSection as ExamSection}
      onSectionChange={(next) => {
        if (paperLocked && next === 'problems') {
          setSection('overview');
          return;
        }
        setSection(next);
      }}
    >
      {visibleSection === 'overview' && (
        <OverviewSection
          data={{
            tdoc,
            cells,
            owner: data.owner,
            inWindow,
            now: data.now,
            signedInUser: {
              name: bs.user.name,
              studentId: examStudent?.studentId,
              realName: examStudent?.realName,
            },
            paperStarted,
            paperFinalized,
            paperPreview: paperPreview === true,
            canStartPaper: data.canStartPaper === true,
            contestBeginAt: data.contestBeginAt,
            contestEndAt: data.contestEndAt,
            durationHours: data.durationHours,
            paperOutline: data.paperOutline,
            starting,
            examShowVerdict: paperPreview === true || data.examShowVerdict !== false,
            examPassScore: data.examPassScore,
            examAttemptLimit: data.examAttemptLimit,
            examAttemptsUsed: data.examAttemptsUsed,
            examScore: data.examScore,
            examJudging: data.examJudging === true,
            examPassed: data.examPassed === true,
            canRetake: data.canRetake === true,
            examMinProblemsToPass: data.examMinProblemsToPass,
          }}
          onEnterProblems={() => setSection('problems')}
          onStartPaper={startPaper}
        />
      )}
      {visibleSection === 'problems' && canViewPaper && (
        <ProblemsSection tdoc={tdoc} tid={tid} pdict={pdict} cells={cells} inWindow={inWindow && !paperFinalized} canFinalize={canFinalize && !paperFinalized} paperPreview={paperPreview === true} paperFinalized={paperFinalized} allowSubmitByKind={allowSubmitByKind && !paperFinalized} examShowVerdict={paperPreview === true || data.examShowVerdict !== false} />
      )}
      {visibleSection === 'announcements' && <AnnouncementsSection broadcasts={broadcasts || []} />}
      {visibleSection === 'ranking' && <RankingSection scoreboard={scoreboard || []} showScoreboard={showScoreboard} signedInUid={bs.user.id} />}
    </ExamDetailShell>
  );
}

// ─── Problems section — the meat of the exam UI ──────────────────────────

function ProblemsSection({
  tid,
  pdict,
  cells,
  inWindow,
  canFinalize,
  paperPreview,
  paperFinalized,
  allowSubmitByKind,
  examShowVerdict,
}: {
  tdoc: TdocLike;
  tid: string;
  pdict: Record<number, PdocLike>;
  cells: PaperCell[];
  inWindow: boolean;
  canFinalize: boolean;
  paperPreview: boolean;
  paperFinalized: boolean;
  allowSubmitByKind: boolean;
  examShowVerdict: boolean;
}) {
  const groups = useMemo(() => groupCellsByKind(cells), [cells]);
  const [activeKind, setActiveKind] = useState<QuestionKind | null>(() => firstPaperKind(groups));
  const tabCells = activeKind ? groups.get(activeKind) || [] : [];

  const [drafts, setDrafts] = useState<Record<number, DraftState>>({});
  const [draftLoadState, setDraftLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draftLoadError, setDraftLoadError] = useState('');
  const [lockedKinds, setLockedKinds] = useState<Set<QuestionKind>>(new Set());
  const [saving, setSaving] = useState(false);
  const [activeCellIndex, setActiveCellIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(readSubsidebarCollapsed);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((p) => {
      const n = !p;
      try {
        localStorage.setItem(SUBSIDEBAR_KEY, n ? '1' : '0');
      } catch {}
      return n;
    });
  }, []);
  // ⌘/Ctrl + B to toggle.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCollapsed]);

  // Load drafts on mount.
  useEffect(() => {
    setDraftLoadState('loading');
    setDraftLoadError('');
    fetchHydroResponse(`/paper/${tid}/draft`, { headers: { Accept: 'application/json' } }, '答题草稿加载失败')
      .then(async (response) => {
        if (!response.ok) throw new Error(await readHydroResponseError(response, '答题草稿加载失败'));
        const body: DraftListResponse = await response.json();
        if (!Array.isArray(body?.drafts)) throw new Error('草稿接口响应缺少 drafts 数组');
        return body;
      })
      .then((res) => {
        const map: Record<number, DraftState> = {};
        const locked = new Set<QuestionKind>();
        const recordStatus: Record<string, string> = res.recordStatus || {};
        for (const d of res.drafts || []) {
          map[d.pid] = {
            answers: d.answers || {},
            code: d.code,
            regionContents: parseSavedRegionContents(pdict[d.pid], d.code),
            lang: d.lang,
            lockedKinds: d.lockedKinds || [],
            judgeResult: d.judgeResult || {},
            recordStatus: recordStatus[String(d.pid)],
            problemFingerprint: d.problemFingerprint,
            dirty: false,
            lastSavedAt: d.updatedAt ? new Date(d.updatedAt).getTime() : undefined,
          };
          for (const k of d.lockedKinds || []) locked.add(k);
        }
        setDrafts(map);
        setLockedKinds(locked);
        setDraftLoadState('ready');
      })
      .catch((error) => {
        console.error('Failed to load exam drafts', error);
        setDraftLoadError(error instanceof Error ? error.message : '答题草稿加载失败');
        setDraftLoadState('error');
      });
  }, [pdict, tid]);

  const draftReady = draftLoadState === 'ready';
  const getDraft = (pid: number): DraftState => drafts[pid] ?? EMPTY_DRAFT;
  const updateDraft = (pid: number, patch: Partial<DraftState>) => {
    if (!draftReady) {
      console.error('Rejected exam draft edit before server drafts were ready', { pid, draftLoadState });
      return;
    }
    setDrafts((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? EMPTY_DRAFT), ...patch, dirty: true },
    }));
  };

  // Compute status for each cell in the active tab.
  const statuses: CellStatus[] = useMemo(() => {
    return tabCells.map((c) => {
      const draft = drafts[c.pid];
      if (examShowVerdict && c.questionKey && draft?.judgeResult?.[c.questionKey]) {
        const r = draft.judgeResult[c.questionKey];
        return r;
      }
      if (examShowVerdict && !c.questionKey && draft?.recordStatus) {
        // Programming cell: status code 1 means AC for hydrojudge.
        const s = String(draft.recordStatus);
        if (s === '1') return 'correct';
        if (s !== '0' && s !== '') return 'wrong';
      }
      if (!draft) return 'unanswered';
      if (c.questionKey) {
        const v = draft.answers?.[c.questionKey];
        const filled = v && (Array.isArray(v) ? v.length > 0 : String(v).length > 0);
        return filled ? 'answered' : 'unanswered';
      }
      if (!c.questionKey && STRUCTURED_REGION_KINDS.includes(c.kind)) {
        return Object.keys(draft.regionContents || {}).length > 0 ? 'answered' : 'unanswered';
      }
      return draft.code ? 'answered' : 'unanswered';
    });
  }, [tabCells, drafts, examShowVerdict]);

  // Save all dirty drafts in active tab.
  const dirtyCountInTab = useMemo(() => {
    const pids = new Set(tabCells.map((c) => c.pid));
    return Array.from(pids).filter((pid) => drafts[pid]?.dirty).length;
  }, [tabCells, drafts]);

  const saveCurrentTab = async () => {
    setSaving(true);
    const pids = Array.from(new Set(tabCells.map((c) => c.pid)));
    try {
      await Promise.all(
        pids.map(async (pid) => {
          const draft = drafts[pid];
          if (!draft?.dirty) return;
          await saveDraftForPid(pid);
        }),
      );
      return true;
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveDraftForPid = async (pid: number) => {
    if (!draftReady) throw new Error('服务端草稿尚未成功加载，禁止保存');
    const draft = drafts[pid];
    if (!draft) return;
    const pdoc = pdict[pid];
    if (!pdoc) return;

    const body: Record<string, string> = {};
    const type = pdoc.config?.type || 'default';
    if (type === 'objective') {
      body.answers = JSON.stringify(draft.answers);
    } else if (['program_fill', 'function'].includes(type)) {
      const regions = (pdoc.config.template?.surface || []).filter(
        (segment): segment is Extract<ClientStructuredCodeSegment, { type: 'region' }> => segment.type === 'region',
      );
      body.code = JSON.stringify(Object.fromEntries(regions.map((region) => [region.id, draft.regionContents?.[region.id] || ''])));
      body.lang = type === 'program_fill' && pdoc.config.mode === 'text' ? '_' : draft.lang || pdoc.config?.template?.lang || 'cpp';
    } else if (type === 'default' || type === 'submit_answer') {
      body.code = draft.code || '';
      if (draft.lang) body.lang = draft.lang;
    }

    const form = new URLSearchParams(body);
    const res = await fetchHydroResponse(
      `/paper/${tid}/draft/${pid}`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
      '保存失败',
    );
    if (!res.ok) throw new Error(await readHydroResponseError(res, '保存失败'));
    setDrafts((prev) => ({
      ...prev,
      [pid]: { ...prev[pid]!, dirty: false, lastSavedAt: Date.now() },
    }));
  };

  const lockCurrentKind = async () => {
    if (!activeKind) return;
    if (!allowSubmitByKind) return;
    if (!['single', 'multi', 'blank', 'fill_program'].includes(activeKind)) return;
    if (!(await confirmDialog(`确认提交「${KIND_LABELS[activeKind]}」类的全部答案？提交后将立即批改并锁定该类，无法再修改。`, { destructive: true }))) return;
    // Save first to ensure latest state is on server.
    if (!(await saveCurrentTab())) return;
    const form = new URLSearchParams({ kind: activeKind });
    let res: Response;
    try {
      res = await fetchHydroResponse(
        `/paper/${tid}/lock-kind`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        },
        '提交本类失败',
      );
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : '提交本类失败');
      return;
    }
    if (!res.ok) {
      await alertDialog(await readHydroResponseError(res, '提交本类失败'));
      return;
    }
    const body: { judgeResults?: Record<string, NonNullable<DraftState['judgeResult']>> } = await res.json();
    setLockedKinds((prev) => new Set([...prev, activeKind]));
    setDrafts((prev) => {
      const next = { ...prev };
      const judgeMap = examShowVerdict ? body.judgeResults || {} : {};
      const pids = new Set(tabCells.map((c) => c.pid));
      for (const pid of pids) {
        if (!next[pid]) continue;
        const results = judgeMap[String(pid)];
        next[pid] = {
          ...next[pid],
          ...(results ? { judgeResult: { ...(next[pid].judgeResult || {}), ...results } } : {}),
          lockedKinds: [...(next[pid].lockedKinds || []), activeKind],
        };
      }
      return next;
    });
  };

  const submitProgramming = async (pid: number) => {
    try {
      await saveDraftForPid(pid);
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : '保存失败');
      return;
    }
    let res: Response;
    try {
      res = await fetchHydroResponse(
        `/paper/${tid}/submit-code/${pid}`,
        {
          method: 'POST',
          headers: { Accept: 'application/json' },
        },
        '提交失败',
      );
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : '提交失败');
      return;
    }
    if (!res.ok) {
      await alertDialog(await readHydroResponseError(res, '提交失败'));
      return;
    }
    const { rid }: { rid: string } = await res.json();
    await alertDialog(`已提交评测，评测记录 ID: ${rid}`);
  };

  const finalize = async () => {
    if (paperPreview || !canFinalize) {
      await alertDialog('预览不能交卷');
      return;
    }
    if (!(await confirmDialog('确认交卷？交卷后将不能再编辑答案。', { destructive: true }))) return;
    try {
      await Promise.all(
        Object.entries(drafts)
          .filter(([, draft]) => draft.dirty)
          .map(([pid]) => saveDraftForPid(Number(pid))),
      );
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : '保存失败，未交卷');
      return;
    }
    let res: Response;
    try {
      res = await fetchHydroResponse(
        `/paper/${tid}/finalize`,
        {
          method: 'POST',
          headers: { Accept: 'application/json' },
        },
        '交卷失败',
      );
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : '交卷失败');
      return;
    }
    if (!res.ok) {
      await alertDialog(await readHydroResponseError(res, '交卷失败'));
      return;
    }
    const { count }: { count: number } = await res.json();
    await alertDialog(`交卷成功，已生成 ${count} 份评测记录。`);
    window.location.href = `/paper/${tid}#ranking`;
  };

  const switchKind = async (next: QuestionKind) => {
    if (dirtyCountInTab > 0 && !(await confirmDialog('当前题目还有未保存的修改，切换 tab 将不会自动保存。确定要切换吗？'))) return;
    setActiveKind(next);
    setActiveCellIndex(0);
  };

  // Jump to a specific cell index — scrolls the main area.
  const mainRef = useRef<HTMLDivElement>(null);
  const jumpToCell = (i: number) => {
    setActiveCellIndex(i);
    const el = document.getElementById(`cell-${i}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!activeKind || tabCells.length === 0) {
    return <div className="flex min-h-0 flex-1 items-center justify-center p-10 text-sm text-muted-foreground">本场考试没有题目。</div>;
  }

  const isObjectiveTab = ['single', 'multi', 'blank', 'fill_program'].includes(activeKind);
  const showLockButton = allowSubmitByKind && isObjectiveTab && !lockedKinds.has(activeKind);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="sticky top-0 z-30 flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b bg-background/85 px-4 py-2 backdrop-blur-xl">
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? '展开侧边栏 (⌘+B)' : '收起侧边栏 (⌘+B)'}
          className="hidden size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
        <PaperStatusPill dirtyCount={dirtyCountInTab} saving={saving} />
        <div className="hidden text-xs text-muted-foreground sm:block">
          {KIND_LABELS[activeKind]} · 共 {tabCells.length} 题
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {showLockButton ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 md:hidden"
              onClick={lockCurrentKind}
              disabled={!inWindow || !draftReady}
            >
              <Lock className="size-4" />
              提交「{KIND_LABELS[activeKind]}」
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            onClick={saveCurrentTab}
            disabled={!inWindow || !draftReady || saving || dirtyCountInTab === 0}
          >
            <Save className="size-4" />
            保存
          </Button>
          {paperPreview ? <span className="text-xs text-muted-foreground">预览不能交卷</span> : null}
        </div>
        {paperFinalized ? (
          <span className="shrink-0 text-xs text-muted-foreground">已交卷</span>
        ) : (
          <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={finalize} disabled={!canFinalize || !draftReady}>
            <Send className="size-4" />
            交卷
          </Button>
        )}
      </div>

      {draftLoadState === 'loading' ? (
        <p role="status" className="shrink-0 border-b px-4 py-3 text-sm text-muted-foreground">
          正在加载服务端草稿，加载完成前暂不可作答。
        </p>
      ) : null}
      {draftLoadState === 'error' ? (
        <p role="alert" className="shrink-0 border-b border-destructive/40 px-4 py-3 text-sm text-destructive">
          草稿加载失败：{draftLoadError} 已阻止作答、保存和交卷，请刷新重试。
        </p>
      ) : null}

      <div className="flex min-h-0 min-w-0 shrink-0 flex-col border-b md:hidden">
        <MiniTabBar groups={groups} current={activeKind} onChange={switchKind} lockedKinds={lockedKinds} />
      </div>

      <div className="flex min-h-0 flex-1">
        {!collapsed && (
          <aside className="hidden min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r bg-card/30 md:flex">
            <MiniTabBar groups={groups} current={activeKind} onChange={switchKind} lockedKinds={lockedKinds} />
            <ScrollArea className="min-h-0 flex-1">
              <CellNavigator cells={tabCells} activeIndex={activeCellIndex} statuses={statuses} onJump={jumpToCell} />
            </ScrollArea>
            <div className="border-t bg-card/40 p-2.5">
              {showLockButton ? (
                <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={lockCurrentKind} disabled={!inWindow || !draftReady}>
                  <Lock className="size-4" />
                  提交「{KIND_LABELS[activeKind]}」
                </Button>
              ) : (
                <p className="text-center text-[11px] text-muted-foreground">
                  {lockedKinds.has(activeKind) ? '该类已提交并锁定。' : isObjectiveTab ? '本场考试统一在交卷时批改。' : '编程题需逐题提交评测。'}
                </p>
              )}
            </div>
          </aside>
        )}

        <ScrollArea viewportRef={mainRef} className="min-h-0 min-w-0 flex-1">
          <div className="space-y-5 p-4 sm:p-6">
            {tabCells.map((cell, i) => (
              <div key={`${cell.pid}-${cell.questionKey ?? 'P'}-${i}`}>
                <CellEditor
                  cellIndex={i}
                  cell={cell}
                  pdoc={pdict[cell.pid]}
                  draft={getDraft(cell.pid)}
                  status={statuses[i]}
                  locked={lockedKinds.has(cell.kind)}
                  disabled={!inWindow || !draftReady}
                  cellNavigator={
                    i === activeCellIndex ? (
                      <div className="md:hidden">
                        <CellNavigator
                          cells={tabCells}
                          activeIndex={activeCellIndex}
                          statuses={statuses}
                          onJump={jumpToCell}
                          orientation="row"
                        />
                      </div>
                    ) : undefined
                  }
                  onAnswerChange={(answer) => {
                    if (!cell.questionKey) return;
                    updateDraft(cell.pid, {
                      answers: { ...getDraft(cell.pid).answers, [cell.questionKey]: answer },
                    });
                  }}
                  onCodeChange={(code, lang) => {
                    updateDraft(cell.pid, { code, lang });
                  }}
                  onRegionChange={(regionId, content) => {
                    const draft = getDraft(cell.pid);
                    updateDraft(cell.pid, {
                      regionContents: { ...(draft.regionContents || {}), [regionId]: content },
                    });
                  }}
                  onSubmitProgramming={['default', ...STRUCTURED_REGION_KINDS].includes(cell.kind) ? () => submitProgramming(cell.pid) : undefined}
                />
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Per-cell editor switch ──────────────────────────────────────────────

function CellEditor({
  cell,
  cellIndex,
  pdoc,
  draft,
  status,
  locked,
  disabled,
  cellNavigator,
  onAnswerChange,
  onCodeChange,
  onRegionChange,
  onSubmitProgramming,
}: {
  cell: PaperCell;
  cellIndex: number;
  pdoc: PdocLike | undefined;
  draft: DraftState;
  status: CellStatus;
  locked: boolean;
  disabled: boolean;
  cellNavigator?: ReactNode;
  onAnswerChange: (answer: string | string[]) => void;
  onCodeChange: (code: string, lang?: string) => void;
  onRegionChange: (regionId: string, content: string) => void;
  onSubmitProgramming?: () => void;
}) {
  if (!pdoc) {
    return <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">题目数据缺失</div>;
  }

  const title = examPaperSurfaceTitle(cellIndex + 1);
  const isLocked = locked || disabled;
  const options = pdoc.config.options?.[cell.questionKey || ''] || ['选项 A', '选项 B', '选项 C', '选项 D'];

  return (
    <CellCard
      id={`cell-${cellIndex}`}
      title={title}
      score={cell.score}
      kindLabel={KIND_LABELS[cell.kind]}
      prompt={cell.prompt}
      locked={isLocked}
      status={status}
      belowTitle={cellNavigator}
    >
      {pdoc.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <MarkdownView content={pdoc.content} />
        </div>
      )}
      {(cell.kind === 'single' || cell.kind === 'true_false') && (
        <SingleChoiceRenderer
          name={`paper-${cell.pid}-${cell.questionKey}`}
          value={(draft.answers[cell.questionKey!] as string) || null}
          options={options}
          onChange={onAnswerChange}
          disabled={isLocked}
        />
      )}
      {cell.kind === 'multi' && (
        <MultiChoiceRenderer
          value={(draft.answers[cell.questionKey!] as string[]) || []}
          options={options}
          onChange={onAnswerChange}
          disabled={isLocked}
        />
      )}
      {cell.kind === 'blank' && (
        <BlankRenderer value={(draft.answers[cell.questionKey!] as string) || ''} onChange={onAnswerChange} disabled={isLocked} />
      )}
      {cell.kind === 'fill_program' && !!cell.questionKey && (
        <FillProgramRenderer value={(draft.answers[cell.questionKey!] as string) || ''} onChange={onAnswerChange} disabled={isLocked} />
      )}
      {cell.kind === 'subjective' && (
        <div className="space-y-1.5">
          <textarea
            value={(draft.answers[cell.questionKey!] as string) || ''}
            onChange={(e) => onAnswerChange(e.target.value)}
            disabled={isLocked}
            rows={6}
            className="w-full rounded-md border bg-background p-3 text-base disabled:opacity-60 md:text-sm"
            placeholder="在此作答（主观题）"
          />
          <p className="text-[11px] text-muted-foreground">本题为主观题，交卷后由老师人工评分。</p>
        </div>
      )}
      {!cell.questionKey && STRUCTURED_REGION_KINDS.includes(cell.kind) && pdoc.config.template && (
        <StructuredRegionInputs
          surface={pdoc.config.template.surface}
          values={draft.regionContents || {}}
          onChange={onRegionChange}
          lang={pdoc.config.template.lang || ''}
          readOnly={isLocked}
          singleLine={cell.kind === 'program_fill_text' || cell.kind === 'program_fill_compile'}
        />
      )}
      {!cell.questionKey && STRUCTURED_REGION_KINDS.includes(cell.kind) && !pdoc.config.template && (
        <p className="text-sm text-destructive">题目模板缺失。</p>
      )}
      {(cell.kind === 'default' || cell.kind === 'submit_answer') && (
        <>
          <textarea
            value={draft.code || ''}
            onChange={(e) => onCodeChange(e.target.value, draft.lang)}
            disabled={isLocked}
            rows={16}
            spellCheck={false}
            className="w-full rounded-md border bg-card p-3 font-mono text-base focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 md:text-sm"
            placeholder="// 在此输入你的代码"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">语言:</label>
            <SimpleSelect
              value={draft.lang || pdoc.config?.langs?.[0] || 'cpp'}
              onValueChange={(v) => onCodeChange(draft.code || '', v)}
              disabled={isLocked}
              size="sm"
              className="w-auto min-w-[6rem] text-xs"
              options={(pdoc.config?.langs || ['cpp', 'python', 'java']).map((l) => ({
                value: l,
                label: l,
              }))}
            />
          </div>
        </>
      )}
      {onSubmitProgramming && (
        <div className="flex justify-end pt-1">
          <Button size="sm" className="gap-1.5" onClick={onSubmitProgramming} disabled={isLocked}>
            <Send className="size-4" />
            提交评测
          </Button>
        </div>
      )}
    </CellCard>
  );
}
