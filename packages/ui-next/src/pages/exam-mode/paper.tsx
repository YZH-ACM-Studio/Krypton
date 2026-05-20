/**
 * Paper answer-sheet page — the heart of Phase 2 / V2 rewrite.
 *
 * Layout:
 *   ExamDetailShell { topbar, thin-icon-sidebar (overview/problems/announcements/ranking) }
 *     section=overview      → OverviewSection
 *     section=problems      → ProblemsSection (collapsible sub-sidebar + scroll-snap cards)
 *     section=announcements → AnnouncementsSection
 *     section=ranking       → RankingSection
 *
 * Server provides: tdoc, pdict, cells, broadcasts, scoreboard, allowSubmitByKind, etc.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Lock, PanelLeftClose, PanelLeftOpen, Save, Send,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/markdown-renderer';
import { ExamDetailShell, useExamSection, type ExamSection } from '@/components/layout/exam-shell';
import {
  BlankRenderer, CellCard, CellNavigator, Countdown, FillProgramRenderer,
  groupCellsByKind, KIND_LABELS, MiniTabBar, MultiChoiceRenderer, PaperStatusPill,
  SingleChoiceRenderer, type CellStatus, type PaperCell, type QuestionKind,
} from '@/components/paper/paper-shell';
import { RegionEditor } from '@/components/paper/region-editor';
import {
  AnnouncementsSection, OverviewSection, RankingSection,
} from '@/components/paper/sections';

interface PdocLike {
  docId: number;
  title: string;
  content: string;
  config: {
    type?: string;
    answers?: Record<string, any>;
    template?: {
      lang: string;
      source: string;
      regions: Array<{ id: string; start: { line: number; col: number }; end: { line: number; col: number }; prompt?: string }>;
      sourceHash: string;
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

const SUBSIDEBAR_KEY = 'krypton:exam-subsidebar-collapsed';

export function ExamPaperPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc: TdocLike;
    pdict: Record<number, PdocLike>;
    cells: PaperCell[];
    now: number;
    inWindow: boolean;
    owner: { uid: number; uname: string } | null;
    broadcasts: Array<{ _id: string; content: string; createdAt: string }>;
    scoreboard: Array<{ rank: number; uid: number; uname: string; realName?: string; studentId?: string; score: number }>;
    showScoreboard: boolean;
    allowSubmitByKind: boolean;
  };
  const { tdoc, pdict, cells, inWindow, broadcasts, scoreboard, showScoreboard, allowSubmitByKind } = data;
  const tid = tdoc.docId;
  const [section, setSection] = useExamSection('overview');

  return (
    <ExamDetailShell
      title={tdoc.title}
      subtitle={
        <Countdown endAt={new Date(tdoc.endAt).getTime()} />
      }
      section={section as ExamSection}
      onSectionChange={(s) => setSection(s)}
    >
      {section === 'overview' && (
        <OverviewSection
          data={{
            tdoc, cells, owner: data.owner, inWindow, now: data.now,
            signedInUser: {
              name: bs.user.name,
              studentId: (bs.user as any).studentId,
              realName: (bs.user as any).realName,
            },
          }}
          onEnterProblems={() => setSection('problems')}
        />
      )}
      {section === 'problems' && (
        <ProblemsSection
          tdoc={tdoc}
          tid={tid}
          pdict={pdict}
          cells={cells}
          inWindow={inWindow}
          allowSubmitByKind={allowSubmitByKind}
        />
      )}
      {section === 'announcements' && (
        <AnnouncementsSection broadcasts={broadcasts || []} />
      )}
      {section === 'ranking' && (
        <RankingSection
          scoreboard={scoreboard || []}
          showScoreboard={showScoreboard}
          signedInUid={bs.user.id}
        />
      )}
    </ExamDetailShell>
  );
}

// ─── Problems section — the meat of the exam UI ──────────────────────────

function ProblemsSection({
  tdoc, tid, pdict, cells, inWindow, allowSubmitByKind,
}: {
  tdoc: TdocLike;
  tid: string;
  pdict: Record<number, PdocLike>;
  cells: PaperCell[];
  inWindow: boolean;
  allowSubmitByKind: boolean;
}) {
  const bs = useBootstrap();

  const groups = useMemo(() => groupCellsByKind(cells), [cells]);
  const kinds = useMemo(() => Array.from(groups.keys()), [groups]);
  const [activeKind, setActiveKind] = useState<QuestionKind | null>(kinds[0] ?? null);
  const tabCells = activeKind ? (groups.get(activeKind) || []) : [];

  const [drafts, setDrafts] = useState<Record<number, DraftState>>({});
  const [lockedKinds, setLockedKinds] = useState<Set<QuestionKind>>(new Set());
  const [saving, setSaving] = useState(false);
  const [activeCellIndex, setActiveCellIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SUBSIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((p) => {
      const n = !p;
      try { localStorage.setItem(SUBSIDEBAR_KEY, n ? '1' : '0'); } catch {}
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
    fetch(`/paper/${tid}/draft`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((res) => {
        const map: Record<number, DraftState> = {};
        const locked = new Set<QuestionKind>();
        const recordStatus: Record<string, string> = res.recordStatus || {};
        for (const d of (res.drafts || [])) {
          map[d.pid] = {
            answers: d.answers || {},
            code: d.code,
            regionContents: d.answers,
            lang: d.lang,
            lockedKinds: d.lockedKinds || [],
            judgeResult: d.judgeResult || {},
            recordStatus: recordStatus[String(d.pid)],
            problemFingerprint: d.problemFingerprint,
            dirty: false,
            lastSavedAt: d.updatedAt ? new Date(d.updatedAt).getTime() : undefined,
          };
          for (const k of (d.lockedKinds || [])) locked.add(k as QuestionKind);
        }
        setDrafts(map);
        setLockedKinds(locked);
      })
      .catch(() => {});
  }, [tid]);

  const getDraft = (pid: number): DraftState => drafts[pid] ?? EMPTY_DRAFT;
  const updateDraft = (pid: number, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? EMPTY_DRAFT), ...patch, dirty: true },
    }));
  };

  // Compute status for each cell in the active tab.
  const statuses: CellStatus[] = useMemo(() => {
    return tabCells.map((c) => {
      const draft = drafts[c.pid];
      if (c.questionKey && draft?.judgeResult?.[c.questionKey]) {
        const r = draft.judgeResult[c.questionKey];
        return r;
      }
      if (!c.questionKey && draft?.recordStatus) {
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
      if (c.kind === 'fill_function') {
        return Object.keys(draft.regionContents || {}).length > 0 ? 'answered' : 'unanswered';
      }
      return draft.code ? 'answered' : 'unanswered';
    });
  }, [tabCells, drafts]);

  // Save all dirty drafts in active tab.
  const dirtyCountInTab = useMemo(() => {
    const pids = new Set(tabCells.map((c) => c.pid));
    return Array.from(pids).filter((pid) => drafts[pid]?.dirty).length;
  }, [tabCells, drafts]);

  const saveCurrentTab = async () => {
    setSaving(true);
    const pids = Array.from(new Set(tabCells.map((c) => c.pid)));
    try {
      await Promise.all(pids.map(async (pid) => {
        const draft = drafts[pid];
        if (!draft?.dirty) return;
        await saveDraftForPid(pid);
      }));
    } finally {
      setSaving(false);
    }
  };
  const saveDraftForPid = async (pid: number) => {
    const draft = drafts[pid];
    if (!draft) return;
    const pdoc = pdict[pid];
    if (!pdoc) return;

    const body: any = {};
    const type = pdoc.config?.type || 'default';
    if (type === 'objective') {
      body.answers = JSON.stringify(draft.answers);
    } else if (type === 'fill_function') {
      body.code = JSON.stringify(draft.regionContents || {});
      body.lang = draft.lang || pdoc.config?.template?.lang || 'cpp';
    } else if (type === 'default' || type === 'submit_answer') {
      body.code = draft.code || '';
      if (draft.lang) body.lang = draft.lang;
    }

    const form = new URLSearchParams(body);
    const res = await fetch(`/paper/${tid}/draft/${pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      alert('保存失败：' + res.statusText);
      return;
    }
    setDrafts((prev) => ({
      ...prev,
      [pid]: { ...prev[pid]!, dirty: false, lastSavedAt: Date.now() },
    }));
  };

  const lockCurrentKind = async () => {
    if (!activeKind) return;
    if (!allowSubmitByKind) return;
    if (!['single', 'multi', 'blank', 'fill_program'].includes(activeKind)) return;
    if (!window.confirm(
      `确认提交「${KIND_LABELS[activeKind]}」类的全部答案？提交后将立即批改并锁定该类，无法再修改。`,
    )) return;
    // Save first to ensure latest state is on server.
    await saveCurrentTab();
    const form = new URLSearchParams({ kind: activeKind });
    const res = await fetch(`/paper/${tid}/lock-kind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      alert('提交本类失败：' + res.statusText);
      return;
    }
    const body = await res.json();
    setLockedKinds((prev) => new Set([...prev, activeKind]));
    // Merge per-pid judgeResults back.
    setDrafts((prev) => {
      const next = { ...prev };
      const judgeMap = body.judgeResults || {};
      for (const [pidStr, results] of Object.entries(judgeMap)) {
        const pid = Number(pidStr);
        if (next[pid]) {
          next[pid] = {
            ...next[pid],
            judgeResult: { ...(next[pid].judgeResult || {}), ...(results as any) },
            lockedKinds: [...(next[pid].lockedKinds || []), activeKind],
          };
        }
      }
      return next;
    });
  };

  const submitProgramming = async (pid: number) => {
    await saveDraftForPid(pid);
    const res = await fetch(`/paper/${tid}/submit-code/${pid}`, { method: 'POST' });
    if (!res.ok) {
      alert('提交失败：' + res.statusText);
      return;
    }
    const { rid } = await res.json();
    alert('已提交评测，评测记录 ID: ' + rid);
  };

  const finalize = async () => {
    if (!window.confirm('确认交卷？交卷后将不能再编辑答案。')) return;
    const res = await fetch(`/paper/${tid}/finalize`, { method: 'POST' });
    if (!res.ok) {
      alert('交卷失败：' + res.statusText);
      return;
    }
    const { count } = await res.json();
    alert(`交卷成功，已生成 ${count} 份评测记录。`);
    window.location.href = `/c/${tid}/scoreboard`;
  };

  const switchKind = (next: QuestionKind) => {
    if (dirtyCountInTab > 0 && !window.confirm('当前题目还有未保存的修改，切换 tab 将不会自动保存。确定要切换吗？')) return;
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
    return (
      <div className="flex h-full items-center justify-center p-10 text-sm text-muted-foreground">
        本场考试没有题目。
      </div>
    );
  }

  const isObjectiveTab = ['single', 'multi', 'blank', 'fill_program'].includes(activeKind);
  const showLockButton = allowSubmitByKind && isObjectiveTab && !lockedKinds.has(activeKind);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Sticky top bar within problems section */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/85 px-4 py-2 backdrop-blur-xl">
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? '展开侧边栏 (⌘+B)' : '收起侧边栏 (⌘+B)'}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
        <PaperStatusPill dirtyCount={dirtyCountInTab} saving={saving} />
        <div className="ml-2 hidden text-xs text-muted-foreground sm:block">
          {KIND_LABELS[activeKind]} · 共 {tabCells.length} 题
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={saveCurrentTab}
          disabled={!inWindow || saving || dirtyCountInTab === 0}
        >
          <Save className="size-4" />保存
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={finalize}
          disabled={!inWindow}
        >
          <Send className="size-4" />交卷
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sub-sidebar */}
        {!collapsed && (
          <aside className="flex w-56 shrink-0 flex-col border-r bg-card/30">
            <MiniTabBar
              groups={groups}
              current={activeKind}
              onChange={switchKind}
              lockedKinds={lockedKinds}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CellNavigator
                cells={tabCells}
                activeIndex={activeCellIndex}
                statuses={statuses}
                onJump={jumpToCell}
              />
            </div>
            {/* Bottom: 提交本类 (only when contest config opens it) */}
            <div className="border-t bg-card/40 p-2.5">
              {showLockButton ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={lockCurrentKind}
                  disabled={!inWindow}
                >
                  <Lock className="size-4" />
                  提交「{KIND_LABELS[activeKind]}」
                </Button>
              ) : (
                <p className="text-center text-[11px] text-muted-foreground">
                  {lockedKinds.has(activeKind)
                    ? '该类已提交并锁定。'
                    : isObjectiveTab
                      ? '本场考试统一在交卷时批改。'
                      : '编程题需逐题提交评测。'}
                </p>
              )}
            </div>
          </aside>
        )}

        {/* Main scroll area */}
        <main
          ref={mainRef}
          className="min-w-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-4xl space-y-5 p-6">
            {tabCells.map((cell, i) => (
              <div key={`${cell.pid}-${cell.questionKey ?? 'P'}-${i}`}>
                <CellEditor
                  cellIndex={i}
                  cell={cell}
                  pdoc={pdict[cell.pid]}
                  draft={getDraft(cell.pid)}
                  status={statuses[i]}
                  locked={lockedKinds.has(cell.kind)}
                  disabled={!inWindow}
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
                  onSubmitProgramming={['default', 'fill_function'].includes(cell.kind)
                    ? () => submitProgramming(cell.pid)
                    : undefined}
                />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Per-cell editor switch ──────────────────────────────────────────────

function CellEditor({
  cell, cellIndex, pdoc, draft, status, locked, disabled,
  onAnswerChange, onCodeChange, onRegionChange, onSubmitProgramming,
}: {
  cell: PaperCell;
  cellIndex: number;
  pdoc: PdocLike | undefined;
  draft: DraftState;
  status: CellStatus;
  locked: boolean;
  disabled: boolean;
  onAnswerChange: (answer: string | string[]) => void;
  onCodeChange: (code: string, lang?: string) => void;
  onRegionChange: (regionId: string, content: string) => void;
  onSubmitProgramming?: () => void;
}) {
  if (!pdoc) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">题目数据缺失</div>
    );
  }

  const title = cell.questionKey ? `第 ${cell.questionKey} 题` : pdoc.title;
  const isLocked = locked || disabled;
  const options = pdoc.config.options?.[cell.questionKey || ''] || ['选项 A', '选项 B', '选项 C', '选项 D'];

  return (
    <CellCard
      id={`cell-${cellIndex}`}
      title={title}
      score={cell.score}
      prompt={cell.prompt}
      locked={isLocked}
      status={status}
    >
      {pdoc.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <MarkdownView value={pdoc.content} />
        </div>
      )}
      {cell.kind === 'single' && (
        <SingleChoiceRenderer
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
        <BlankRenderer
          value={(draft.answers[cell.questionKey!] as string) || ''}
          onChange={onAnswerChange}
          disabled={isLocked}
        />
      )}
      {cell.kind === 'fill_program' && (
        <FillProgramRenderer
          value={(draft.answers[cell.questionKey!] as string) || ''}
          onChange={onAnswerChange}
          disabled={isLocked}
        />
      )}
      {cell.kind === 'fill_function' && pdoc.config.template && (
        <RegionEditor
          lang={pdoc.config.template.lang}
          templateSource={pdoc.config.template.source}
          regions={pdoc.config.template.regions}
          regionContents={draft.regionContents || {}}
          onChange={onRegionChange}
          readOnly={isLocked}
        />
      )}
      {cell.kind === 'fill_function' && !pdoc.config.template && (
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
            className="w-full rounded-md border bg-card p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            placeholder="// 在此输入你的代码"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">语言:</label>
            <select
              value={draft.lang || (pdoc.config?.langs?.[0] || 'cpp')}
              onChange={(e) => onCodeChange(draft.code || '', e.target.value)}
              disabled={isLocked}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {(pdoc.config?.langs || ['cpp', 'python', 'java']).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </>
      )}
      {onSubmitProgramming && (
        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={onSubmitProgramming}
            disabled={isLocked}
          >
            <Send className="size-4" />提交评测
          </Button>
        </div>
      )}
    </CellCard>
  );
}
