/**
 * Paper answer-sheet page — the heart of Phase 2.
 *
 * Server provides:
 *   bs.page.data.tdoc        : the exam contest doc
 *   bs.page.data.pdict       : { pid -> pdoc }
 *   bs.page.data.cells       : PaperCell[]  (server-built, see handler/paper.ts)
 *   bs.page.data.now         : server time
 *   bs.page.data.inWindow    : whether contest is active
 *
 * Client owns:
 *   - per-cell draft state (in-memory + sync to server)
 *   - tab + cell selection
 *   - locked kinds (mirror of server state)
 *
 * Saves are explicit (PRD §1.6): student clicks "保存"; unsaved tab switches
 * trigger a confirm dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import { Save, Send, Lock as LockIcon } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkdownView } from '@/components/markdown-renderer';
import {
  TabBar, CellNavigator, SingleChoiceRenderer, MultiChoiceRenderer,
  BlankRenderer, FillProgramRenderer, Countdown, PaperStatusPill, CellCard,
  groupCellsByKind, type PaperCell, type QuestionKind,
} from '@/components/paper/paper-shell';
import { RegionEditor } from '@/components/paper/region-editor';

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
    /** Question-rendering-only metadata that the teacher provides per question (parsed from problem content or config). */
    options?: Record<string, string[]>;
  };
}

interface TdocLike {
  docId: string;
  title: string;
  beginAt: string;
  endAt: string;
}

interface DraftState {
  answers: Record<string, string | string[]>;  // for objective entries
  code?: string;                                 // for default + submit_answer
  regionContents?: Record<string, string>;       // for fill_function
  lang?: string;
  lockedKinds: QuestionKind[];
  problemFingerprint?: string;
  dirty: boolean;
  lastSavedAt?: number;
}

const EMPTY_DRAFT: DraftState = {
  answers: {},
  lockedKinds: [],
  dirty: false,
};

export function ExamPaperPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc: TdocLike;
    pdict: Record<number, PdocLike>;
    cells: PaperCell[];
    now: number;
    inWindow: boolean;
  };
  const { tdoc, pdict, cells, inWindow } = data;
  const tid = tdoc.docId;

  // Group cells by kind for tab rendering.
  const groups = useMemo(() => groupCellsByKind(cells), [cells]);
  const kinds = useMemo(() => Array.from(groups.keys()), [groups]);
  const [activeKind, setActiveKind] = useState<QuestionKind | null>(kinds[0] ?? null);
  const [activeCellIndex, setActiveCellIndex] = useState(0);
  const tabCells = activeKind ? (groups.get(activeKind) || []) : [];
  const activeCell = tabCells[activeCellIndex];

  // Drafts: keyed by pid for problem-level state.
  const [drafts, setDrafts] = useState<Record<number, DraftState>>({});
  const [lockedKinds, setLockedKinds] = useState<Set<QuestionKind>>(new Set());

  // Load all drafts from server on mount.
  useEffect(() => {
    fetch(`/paper/${tid}/draft`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((res) => {
        const map: Record<number, DraftState> = {};
        const locked = new Set<QuestionKind>();
        for (const d of (res.drafts || [])) {
          map[d.pid] = {
            answers: d.answers || {},
            code: d.code,
            regionContents: d.answers,
            lang: d.lang,
            lockedKinds: d.lockedKinds || [],
            problemFingerprint: d.problemFingerprint,
            dirty: false,
            lastSavedAt: d.updatedAt ? new Date(d.updatedAt).getTime() : undefined,
          };
          for (const k of (d.lockedKinds || [])) locked.add(k as QuestionKind);
        }
        setDrafts(map);
        setLockedKinds(locked);
      })
      .catch(() => { /* offline mode: keep empty */ });
  }, [tid]);

  // Helpers
  const getDraft = (pid: number): DraftState => drafts[pid] ?? EMPTY_DRAFT;
  const updateDraft = (pid: number, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? EMPTY_DRAFT), ...patch, dirty: true },
    }));
  };

  const saveDraft = async (pid: number) => {
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

  const lockKind = async (kind: QuestionKind) => {
    if (!window.confirm(`确认锁定「${kind}」类的所有题目？锁定后将无法再修改这一类的答案，但仍可在交卷前编辑其它类型。`)) return;
    const form = new URLSearchParams({ kind });
    const res = await fetch(`/paper/${tid}/lock-kind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      alert('锁定失败：' + res.statusText);
      return;
    }
    setLockedKinds((prev) => new Set([...prev, kind]));
  };

  const submitProgrammingProblem = async (pid: number) => {
    await saveDraft(pid);
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

  // Track dirty across drafts for the warning bar
  const anyDirty = Object.values(drafts).some((d) => d.dirty);

  // Auto-detect tab switch warning.
  const switchKind = (next: QuestionKind) => {
    if (anyDirty && !window.confirm('当前题目还有未保存的修改，切换 tab 将不会自动保存。确定要切换吗？')) return;
    setActiveKind(next);
    setActiveCellIndex(0);
  };

  if (!activeKind || !activeCell) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">本场考试没有题目。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      {/* Header bar */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-3">
        <div className="space-y-0.5">
          <h1 className="font-semibold">{tdoc.title}</h1>
          <p className="text-xs text-muted-foreground">{bs.user.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <Countdown endAt={new Date(tdoc.endAt).getTime()} onExpire={finalize} />
          <Button onClick={finalize} variant="default" className="gap-1">
            <Send className="size-4" /> 交卷
          </Button>
        </div>
      </div>

      <TabBar groups={groups} current={activeKind} onChange={switchKind} lockedKinds={lockedKinds} />

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        {/* Sidebar: cell navigator + lock-this-kind */}
        <aside className="space-y-3">
          <CellNavigator
            cells={tabCells}
            activeIndex={activeCellIndex}
            onJump={setActiveCellIndex}
            answeredIndices={new Set(tabCells.map((c, i) => {
              const draft = drafts[c.pid];
              if (!draft) return -1;
              if (c.questionKey) {
                const v = draft.answers[c.questionKey];
                return v && (Array.isArray(v) ? v.length > 0 : v.length > 0) ? i : -1;
              }
              if (c.kind === 'fill_function') {
                return Object.keys(draft.regionContents || {}).length > 0 ? i : -1;
              }
              return draft.code ? i : -1;
            }).filter((i) => i >= 0))}
            lockedKindForCell={lockedKinds.has(activeKind)}
          />
          {!['default', 'fill_function'].includes(activeKind) && !lockedKinds.has(activeKind) && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1"
              onClick={() => lockKind(activeKind)}
            >
              <LockIcon className="size-4" />提交本类
            </Button>
          )}
        </aside>

        {/* Main area: current cell */}
        <main className="space-y-3">
          <CellEditor
            cell={activeCell}
            pdoc={pdict[activeCell.pid]}
            draft={getDraft(activeCell.pid)}
            locked={lockedKinds.has(activeCell.kind)}
            disabled={!inWindow}
            onAnswerChange={(answer) => {
              if (!activeCell.questionKey) return;
              updateDraft(activeCell.pid, {
                answers: { ...getDraft(activeCell.pid).answers, [activeCell.questionKey]: answer },
              });
            }}
            onCodeChange={(code, lang) => {
              updateDraft(activeCell.pid, { code, lang });
            }}
            onRegionChange={(regionId, content) => {
              const draft = getDraft(activeCell.pid);
              updateDraft(activeCell.pid, {
                regionContents: { ...(draft.regionContents || {}), [regionId]: content },
              });
            }}
          />

          {/* Per-cell action bar */}
          <div className="flex items-center justify-between gap-2 rounded-md border bg-card p-3">
            <PaperStatusPill
              saved={!!getDraft(activeCell.pid).lastSavedAt}
              dirty={getDraft(activeCell.pid).dirty}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveDraft(activeCell.pid)}
                disabled={lockedKinds.has(activeCell.kind) || !inWindow}
              >
                <Save className="size-4" />保存
              </Button>
              {['default', 'fill_function'].includes(activeCell.kind) && (
                <Button
                  size="sm"
                  onClick={() => submitProgrammingProblem(activeCell.pid)}
                  disabled={!inWindow}
                >
                  <Send className="size-4" />提交评测
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Per-cell editor switch ──────────────────────────────────────────────

function CellEditor({
  cell, pdoc, draft, locked, disabled, onAnswerChange, onCodeChange, onRegionChange,
}: {
  cell: PaperCell;
  pdoc: PdocLike | undefined;
  draft: DraftState;
  locked: boolean;
  disabled: boolean;
  onAnswerChange: (answer: string | string[]) => void;
  onCodeChange: (code: string, lang?: string) => void;
  onRegionChange: (regionId: string, content: string) => void;
}) {
  if (!pdoc) {
    return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">题目数据缺失</p></CardContent></Card>;
  }

  const title = `第 ${cell.questionKey || pdoc.docId} 题`;
  const isLocked = locked || disabled;

  // Determine the per-question options for choice questions. Conventionally
  // stored as `pdoc.config.options[questionKey] = ['A 内容', 'B 内容', ...]`.
  const options = pdoc.config.options?.[cell.questionKey || ''] || ['选项 A', '选项 B', '选项 C', '选项 D'];

  if (cell.kind === 'single') {
    const v = (draft.answers[cell.questionKey!] as string) || '';
    return (
      <CellCard title={title} score={cell.score} prompt={cell.prompt} locked={isLocked}>
        <ProblemBody pdoc={pdoc} />
        <SingleChoiceRenderer value={v || null} options={options} onChange={onAnswerChange} disabled={isLocked} />
      </CellCard>
    );
  }
  if (cell.kind === 'multi') {
    const v = (draft.answers[cell.questionKey!] as string[]) || [];
    return (
      <CellCard title={title} score={cell.score} prompt={cell.prompt} locked={isLocked}>
        <ProblemBody pdoc={pdoc} />
        <MultiChoiceRenderer value={v} options={options} onChange={onAnswerChange} disabled={isLocked} />
      </CellCard>
    );
  }
  if (cell.kind === 'blank') {
    const v = (draft.answers[cell.questionKey!] as string) || '';
    return (
      <CellCard title={title} score={cell.score} prompt={cell.prompt} locked={isLocked}>
        <ProblemBody pdoc={pdoc} />
        <BlankRenderer value={v} onChange={onAnswerChange} disabled={isLocked} />
      </CellCard>
    );
  }
  if (cell.kind === 'fill_program') {
    const v = (draft.answers[cell.questionKey!] as string) || '';
    return (
      <CellCard title={title} score={cell.score} prompt={cell.prompt} locked={isLocked}>
        <ProblemBody pdoc={pdoc} />
        <FillProgramRenderer value={v} onChange={onAnswerChange} disabled={isLocked} />
      </CellCard>
    );
  }
  if (cell.kind === 'fill_function') {
    const tmpl = pdoc.config?.template;
    if (!tmpl) {
      return <CellCard title={pdoc.title} score={cell.score} locked={isLocked}>
        <p className="text-sm text-destructive">题目模板缺失。</p>
      </CellCard>;
    }
    return (
      <CellCard title={pdoc.title} score={cell.score} prompt={cell.prompt} locked={isLocked}>
        <ProblemBody pdoc={pdoc} />
        <RegionEditor
          lang={tmpl.lang}
          templateSource={tmpl.source}
          regions={tmpl.regions}
          regionContents={draft.regionContents || {}}
          onChange={onRegionChange}
          readOnly={isLocked}
        />
      </CellCard>
    );
  }
  // default / submit_answer
  return (
    <CellCard title={pdoc.title} score={cell.score} prompt={cell.prompt} locked={isLocked}>
      <ProblemBody pdoc={pdoc} />
      <textarea
        value={draft.code || ''}
        onChange={(e) => onCodeChange(e.target.value, draft.lang)}
        disabled={isLocked}
        rows={18}
        spellCheck={false}
        className="w-full rounded-md border bg-card p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        placeholder="// 在此输入你的代码"
      />
      <div className="mt-2 flex items-center gap-2">
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
    </CellCard>
  );
}

function ProblemBody({ pdoc }: { pdoc: PdocLike }) {
  if (!pdoc.content) return null;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <MarkdownView value={pdoc.content} />
    </div>
  );
}
