/**
 * Problem config editor — judge configuration UI rebuilt from scratch.
 *
 * Layout: Files / Cases / Subtasks kanban.
 * Workflow: Files → pair into Cases → assign Cases to Subtasks → set scoring & deps.
 *
 * Bidirectional sync: structured form ⇄ raw YAML. Form edits regenerate
 * the YAML (losing comments on structural changes). YAML edits, when
 * valid, push state back into the form.
 *
 * Responsive: the programming-editor sidebar at lg makes window-width
 * 3-column layouts fake. Files and Cases share MiniTabs beside Subtasks.
 * Mobile is a read-only notice; use the YAML tab to edit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Grid3X3,
  GripVertical,
  FileEdit,
  Link2,
  Plus,
  Save,
  Settings,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Stat, StatusDot } from '@/components/ui/display';
import { Panel } from '@/components/ui/panel';
import { Toolbar, Workspace } from '@/components/ui/page';
import { KryptonIDE } from '@/components/krypton-ide';
import { FileUploader } from '@/components/uploader';
import { MultiSelect } from '@/components/ui/multi-select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { ProblemTestdataFileDialog } from '@/components/problem-testdata-file-dialog';
import {
  type ProblemDataWriteConfirmationResult,
  type ProblemDataWriteGuardState,
  type ProblemDataWriteOperation,
  prepareProblemDataWrite,
  useProblemDataWriteGuard,
} from '@/components/problem-data-write-guard';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { COMMON_LANG_OPTIONS as PRESET_LANG_OPTIONS, type LangOption, resolveLangs } from '@/lib/multi-select-presets';
import { readProblemConfigUploadSuccess } from '@/lib/problem-save-response';
import '@/lib/bootstrap';
import '@/lib/format';
import {
  JudgeConfig,
  JudgeCase,
  JudgeSubtask,
  ProblemType,
  CheckerType,
  ScoreMode,
  parseJudgeConfig,
  serializeJudgeConfig,
  autoPair,
  classify,
  validateConfig,
  parseTimeMS,
  parseMemoryMB,
  formatTime,
  formatMemory,
  splitTime,
  splitMemory,
  joinTime,
  joinMemory,
} from '@/lib/judge-config';

/** Minimal slice of the problem document this editor reads (header title fallback). */
interface ProblemDocSummary {
  title?: string;
  pid?: string | number;
}

/** Testdata file entry (Hydro `FileInfo`) as served in `data.testdata`. */
interface ProblemFileEntry {
  name: string;
  size?: number;
}

const PROBLEM_TYPES: { value: ProblemType; label: string; desc: string }[] = [
  { value: 'default', label: '传统评测', desc: '标准输入输出，逐用例判分' },
  { value: 'submit_answer', label: '提交答案', desc: '上传答案文件' },
  { value: 'interactive', label: '交互题', desc: '需要 interactor' },
  { value: 'communication', label: '通信题', desc: '需要 user + manager' },
];

const CHECKER_OPTIONS: { value: CheckerType; label: string; desc: string }[] = [
  { value: 'default', label: '默认', desc: '逐 token 严格比较' },
  { value: 'strict', label: '严格', desc: '逐字节比较，包括空白' },
  { value: 'float', label: '浮点', desc: '浮点容差，需指定精度' },
  { value: 'lemon', label: 'Lemon', desc: 'Lemon 风格 checker — 需上传 checker 文件' },
  { value: 'syzoj', label: 'SYZOJ', desc: 'SYZOJ 风格 checker — 需上传 checker 文件' },
  { value: 'testlib', label: 'Testlib', desc: 'Testlib 风格 checker — 需上传 checker 文件' },
  { value: 'custom', label: '自定义', desc: '使用上传的 checker 文件' },
];

/** All checker types that require a `checker:` file path in the YAML. */
const CHECKER_TYPES_NEEDING_FILE: CheckerType[] = ['lemon', 'syzoj', 'testlib', 'custom'];

/* ────────────────────────────────────────────────────────────────── */
/*  Top-level page                                                    */
/* ────────────────────────────────────────────────────────────────── */

export function ProblemConfigEditor({
  problemUrl,
  pdoc,
  files: looseFiles,
  initialYaml,
  dataWriteGuard,
  embedded = false,
}: {
  problemUrl: string;
  pdoc: ProblemDocSummary;
  /** Entries arrive from the untyped page-bootstrap payload; narrowed below. */
  files: Partial<ProblemFileEntry>[];
  initialYaml: string;
  dataWriteGuard?: ProblemDataWriteGuardState;
  embedded?: boolean;
}) {
  // `data.testdata` entries are Hydro `FileInfo` objects (always named); the
  // payload is untyped upstream, so narrow once here and keep the rest of the
  // tree strictly typed.
  const files = looseFiles as ProblemFileEntry[];
  // --- state ---
  const [yamlText, setYamlText] = useState(initialYaml);
  const initialParse = useMemo(() => parseJudgeConfig(initialYaml), [initialYaml]);
  const initialSubmittedYaml = initialParse.error ? initialYaml : serializeJudgeConfig(initialParse.config, { preserveSource: initialYaml });
  const [config, setConfig] = useState<JudgeConfig>(initialParse.config);
  const [yamlError, setYamlError] = useState<string | undefined>(initialParse.error);
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [savedYaml, setSavedYaml] = useState(initialSubmittedYaml);
  const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
  const lastSource = useRef<'form' | 'yaml'>(initialParse.error ? 'yaml' : 'form');
  const editVersion = useRef(0);
  const [mobileTab, setMobileTab] = useState<'files' | 'cases' | 'subtasks'>('files');
  // File being edited in the modal — null = closed.
  const [editingFile, setEditingFile] = useState<ProblemFileEntry | null>(null);
  const prepareDataWrite = useCallback(
    (operation: ProblemDataWriteOperation) => prepareProblemDataWrite(`${problemUrl}/files`, operation),
    [problemUrl],
  );
  const dataGuard = useProblemDataWriteGuard(dataWriteGuard, 'data', prepareDataWrite);

  // --- file pool with classification ---
  const fileSet = useMemo(() => new Set(files.map((f) => f.name)), [files]);
  const fileNames = useMemo(() => files.map((f) => f.name), [files]);

  // --- referenced files (used by some case / subtask) ---
  const usedInPairs = useMemo(() => {
    const used = new Set<string>();
    const pushCases = (cases: JudgeCase[]) => {
      for (const c of cases) {
        if (c.input) used.add(c.input);
        if (c.output) used.add(c.output);
      }
    };
    if (config.subtasks) for (const s of config.subtasks) pushCases(s.cases);
    if (config.cases) pushCases(config.cases);
    return used;
  }, [config]);

  // --- form → yaml sync (debounced) ---
  useEffect(() => {
    if (lastSource.current !== 'form') return;
    const t = setTimeout(() => {
      const next = serializeJudgeConfig(config, { preserveSource: yamlText });
      if (next !== yamlText) setYamlText(next);
    }, 200);
    return () => clearTimeout(t);
  }, [config]);

  // --- yaml → form sync (debounced) ---
  const onYamlChange = useCallback((next: string) => {
    lastSource.current = 'yaml';
    editVersion.current += 1;
    setSaveError('');
    setSaveMsg(null);
    setYamlText(next);
    const parsed = parseJudgeConfig(next);
    if (parsed.error) {
      setYamlError(parsed.error);
    } else {
      setYamlError(undefined);
      setConfig(parsed.config);
    }
  }, []);

  const updateConfig = useCallback((mut: (c: JudgeConfig) => JudgeConfig) => {
    lastSource.current = 'form';
    editVersion.current += 1;
    setSaveError('');
    setSaveMsg(null);
    setConfig((c) => mut(c));
  }, []);

  const currentYaml = lastSource.current === 'form' ? serializeJudgeConfig(config, { preserveSource: yamlText }) : yamlText;
  const dirty = currentYaml !== savedYaml;
  const navigationGuard = useUnsavedChangesGuard(dirty || saving);

  // --- validation ---
  const issues = useMemo(() => validateConfig(config, fileSet), [config, fileSet]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warnCount = issues.filter((i) => i.level === 'warning').length;

  // --- save ---
  const handleSave = useCallback(async () => {
    const confirmation = await dataGuard.confirm('保存评测配置', 'files-upload');
    if (!confirmation) return;
    const savedVersion = editVersion.current;
    const submittedYaml = currentYaml;
    setSaving(true);
    setSaveError('');
    setSaveMsg(null);
    try {
      if (submittedYaml !== yamlText) setYamlText(submittedYaml);
      const formData = new FormData();
      formData.append('operation', 'upload_file');
      formData.append('type', 'testdata');
      formData.append('filename', 'config.yaml');
      if (typeof confirmation === 'string') formData.append('activeContainerConfirmation', confirmation);
      formData.append('file', new Blob([submittedYaml], { type: 'text/yaml' }), 'config.yaml');
      const res = await fetchHydroResponse(`${problemUrl}/files`, {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(await readHydroResponseError(res, '保存失败'));
      await readProblemConfigUploadSuccess(res);
      setSavedYaml(submittedYaml);
      setSaveMsg(editVersion.current === savedVersion ? '已保存' : '提交时版本已保存，当前修改尚未保存');
      setTimeout(() => setSaveMsg(null), 1800);
    } catch (e) {
      console.error('Failed to save problem judge config', e);
      setSaveError((e instanceof Error && e.message) || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [currentYaml, dataGuard, problemUrl, yamlText]);

  // --- drag handlers ---
  // Activation distance was 4px — that's so small that even an accidental
  // wobble while pointing at a file slot already triggers a drop. Bump to 10px
  // (≈ 3mm on a typical display) so a click is unambiguously a click and a
  // drag needs intent. The dedicated drag handle below also helps separate
  // clicks from drags.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    setDraggedItem(e.active.data.current as DraggedItem);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const active = e.active.data.current as DraggedItem | undefined;
    const over = e.over?.data.current as DropTarget | undefined;
    setDraggedItem(null);
    if (!active || !over) return;
    handleDrop(active, over, updateConfig);
  };

  // --- handlers for case / subtask manipulation ---
  const addCase = (c: JudgeCase) => {
    updateConfig((cfg) => {
      if (cfg.subtasks && cfg.subtasks.length > 0) {
        // append to first subtask
        const newSubs = [...cfg.subtasks];
        newSubs[0] = { ...newSubs[0], cases: [...newSubs[0].cases, c] };
        return { ...cfg, subtasks: newSubs };
      }
      return { ...cfg, cases: [...(cfg.cases || []), c] };
    });
  };
  const removeCase = (idx: number, stid?: number) => {
    updateConfig((cfg) => {
      if (stid != null && cfg.subtasks) {
        return {
          ...cfg,
          subtasks: cfg.subtasks.map((s) => (s.id === stid ? { ...s, cases: s.cases.filter((_, i) => i !== idx) } : s)),
        };
      }
      return { ...cfg, cases: (cfg.cases || []).filter((_, i) => i !== idx) };
    });
  };
  const updateCase = (idx: number, patch: Partial<JudgeCase>, stid?: number) => {
    updateConfig((cfg) => {
      if (stid != null && cfg.subtasks) {
        return {
          ...cfg,
          subtasks: cfg.subtasks.map((s) => (s.id === stid ? { ...s, cases: s.cases.map((c, i) => (i === idx ? { ...c, ...patch } : c)) } : s)),
        };
      }
      return { ...cfg, cases: (cfg.cases || []).map((c, i) => (i === idx ? { ...c, ...patch } : c)) };
    });
  };

  const ensureSubtasks = (cfg: JudgeConfig): JudgeSubtask[] => {
    if (cfg.subtasks && cfg.subtasks.length > 0) return cfg.subtasks;
    // Migrate from flat cases
    if (cfg.cases && cfg.cases.length > 0) {
      return [{ id: 1, score: 100, type: 'min', cases: [...cfg.cases] }];
    }
    return [];
  };

  const addSubtask = () => {
    updateConfig((cfg) => {
      const existing = ensureSubtasks(cfg);
      const nextId = (existing.length ? Math.max(...existing.map((s) => s.id ?? 0)) : 0) + 1;
      const newSt: JudgeSubtask = { id: nextId, score: 0, type: 'min', cases: [] };
      const newConfig: JudgeConfig = { ...cfg, subtasks: [...existing, newSt] };
      if (cfg.cases) delete newConfig.cases;
      return newConfig;
    });
  };
  const addSubtaskFromCases = (cases: JudgeCase[]) => {
    const existing = config.subtasks || [];
    const nextId = (existing.length ? Math.max(...existing.map((s) => s.id ?? 0)) : 0) + 1;
    const newSt: JudgeSubtask = { id: nextId, score: 0, type: 'min', cases };
    updateConfig((cfg) => {
      const nextSubs = [...existing, newSt];
      const out: JudgeConfig = { ...cfg, subtasks: nextSubs };
      if (cfg.cases) {
        out.cases = cfg.cases.filter((c) => !cases.some((cc) => cc.input === c.input && cc.output === c.output));
        if (out.cases.length === 0) delete out.cases;
      }
      return out;
    });
  };
  const removeSubtask = (stid: number) => {
    updateConfig((cfg) => {
      const subs = (cfg.subtasks || []).filter((s) => s.id !== stid);
      // remove from `if` of other subtasks
      const cleaned = subs.map((s) => ({ ...s, if: s.if?.filter((d) => d !== stid) }));
      return { ...cfg, subtasks: cleaned };
    });
  };
  const updateSubtask = (stid: number, patch: Partial<JudgeSubtask>) => {
    updateConfig((cfg) => ({
      ...cfg,
      subtasks: (cfg.subtasks || []).map((s) => (s.id === stid ? { ...s, ...patch } : s)),
    }));
  };

  return (
    <Workspace className={cn('min-w-0 max-w-full', embedded && 'h-auto')}>
      <Toolbar className="flex min-h-10 w-full max-w-full shrink-0 flex-col items-stretch gap-3 border-b border-line bg-surface px-2 py-2 sm:flex-row sm:items-center">
        <span className="min-w-0 truncate text-sm font-semibold text-fg">评测配置</span>
        {!embedded ? (
          <Button asChild variant="ghost" size="sm" iconOnly>
            <a href={problemUrl} aria-label="返回题目">
              <ArrowLeft />
            </a>
          </Button>
        ) : null}
        {!embedded ? <span className="min-w-0 truncate text-xs text-fg-muted">{pdoc.title || pdoc.pid || '题目'}</span> : null}
        <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <span aria-live="polite" className="min-w-0 text-xs text-pretty text-fg-subtle">
            {saving ? '保存中' : saveError ? '保存失败' : dirty ? '有未保存修改' : saveMsg || '已载入服务器版本'}
          </span>
          {errorCount > 0 ? (
            <Badge tone="danger" size="sm">
              <AlertTriangle />
              {errorCount} 错误
            </Badge>
          ) : warnCount > 0 ? (
            <Badge tone="warning" size="sm">
              <AlertTriangle />
              {warnCount} 警告
            </Badge>
          ) : (
            <Badge tone="success" size="sm">
              <CheckCircle2 />
              OK
            </Badge>
          )}
          <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={saving || dataGuard.blocked}>
            <Save />
            {saving ? '保存中…' : dirty ? '保存修改' : '保存'}
          </Button>
        </div>
      </Toolbar>

      <div className={cn('flex min-w-0 max-w-full flex-col gap-3 p-3', !embedded && 'min-h-0 flex-1 overflow-y-auto')}>
      {dataGuard.notice}

      {saveError ? (
        <p role="alert" className="shrink-0 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {saveError}
        </p>
      ) : null}

      {/* View-mode tabs: 可视化 vs 原始 YAML (双向同步保留) */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <MiniTabs
          size="sm"
          value={viewMode}
          onValueChange={(v) => setViewMode(v as 'visual' | 'yaml')}
          items={[
            { value: 'visual', label: '可视化' },
            { value: 'yaml', label: '原始 YAML' },
          ]}
        />
        {yamlError ? (
          <Badge tone="danger" size="sm">
            YAML 解析错误：未应用最新编辑
          </Badge>
        ) : (
          <span className="text-2xs text-fg-subtle">两侧实时双向同步</span>
        )}
      </div>

      {viewMode === 'yaml' ? (
        // ── YAML mode: full-width KryptonIDE simple editor on the raw text
        <Panel
          as="div"
          flush
          className="flex min-h-0 flex-1 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col"
          footer="修改 YAML 会同步回左侧可视化；可视化变更也会重新格式化此处（注释会尽量保留）。"
        >
          {yamlError ? <Alert tone="danger" className="m-3 shrink-0">⚠ {yamlError}</Alert> : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            <KryptonIDE
              mode="simple"
              langs={[]}
              defaultLang="yaml"
              value={yamlText}
              onValueChange={onYamlChange}
              minHeight={420}
              className="h-full rounded-none border-0"
            />
          </div>
        </Panel>
      ) : (
        <>
          {/* Basic config strip */}
          <div className="shrink-0">
            <BasicConfigStrip config={config} updateConfig={updateConfig} files={files} />
          </div>

          <Panel className="shrink-0 sm:hidden">
            <div className="space-y-2 text-sm text-fg-muted">
              <p>当前为小屏只读视图。如需配置测试点、拖拽用例，请使用桌面端。</p>
              <p>可切到「原始 YAML」标签直接编辑。</p>
            </div>
          </Panel>

          {/* Issues panel */}
          {issues.length > 0 ? (
            <div className="shrink-0">
              <IssuesPanel issues={issues} />
            </div>
          ) : null}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="hidden min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 sm:grid">
              <div className="flex min-h-0 min-w-0 flex-col">
                <MiniTabs
                  value={mobileTab === 'subtasks' ? 'cases' : mobileTab}
                  onValueChange={(v) => setMobileTab(v as 'files' | 'cases')}
                  items={[
                    { value: 'files', label: '文件' },
                    { value: 'cases', label: '用例' },
                  ]}
                />
                <div className="mt-3 min-h-0 min-w-0 flex-1">
                  {mobileTab === 'files' ? (
                    <FilesColumn
                      files={files}
                      usedInPairs={usedInPairs}
                      problemUrl={problemUrl}
                      addCase={addCase}
                      onOpenFile={setEditingFile}
                      confirmWrite={dataGuard.confirm}
                    />
                  ) : (
                    <CasesColumn
                      config={config}
                      fileSet={fileSet}
                      addCase={addCase}
                      removeCase={removeCase}
                      updateCase={updateCase}
                      addSubtaskFromCases={addSubtaskFromCases}
                      autoPairAll={() => {
                        const result = autoPair(fileNames);
                        updateConfig((cfg) => ({ ...cfg, cases: result.pairs, subtasks: undefined }));
                      }}
                    />
                  )}
                </div>
              </div>
              <SubtasksColumn
                config={config}
                fileSet={fileSet}
                updateSubtask={updateSubtask}
                removeSubtask={removeSubtask}
                addSubtask={addSubtask}
                removeCase={removeCase}
                updateCase={updateCase}
              />
            </div>

            <DragOverlay>{draggedItem ? <DragPreview item={draggedItem} /> : null}</DragOverlay>
          </DndContext>
        </>
      )}
      </div>

      {editingFile ? (
        <ProblemTestdataFileDialog file={editingFile} problemUrl={problemUrl} onClose={() => setEditingFile(null)} confirmWrite={dataGuard.confirm} />
      ) : null}
      {dataGuard.dialog}
      {navigationGuard.guardDialog}
    </Workspace>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Basic config strip                                                */
/* ────────────────────────────────────────────────────────────────── */

function BasicConfigStrip({
  config,
  updateConfig,
  files,
}: {
  config: JudgeConfig;
  updateConfig: (m: (c: JudgeConfig) => JudgeConfig) => void;
  files: ProblemFileEntry[];
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="题目类型">
            <SimpleSelect
              value={config.type}
              onValueChange={(v) => updateConfig((c) => ({ ...c, type: v as ProblemType }))}
              size="sm"
              options={PROBLEM_TYPES.map((p) => ({ value: p.value, label: p.label }))}
            />
          </Field>
          <Field label="时间限制">
            <DurationInput value={config.time} onChange={(v) => updateConfig((c) => ({ ...c, time: v }))} placeholder="默认 1" size="md" />
          </Field>
          <Field label="内存限制">
            <MemoryInput value={config.memory} onChange={(v) => updateConfig((c) => ({ ...c, memory: v }))} placeholder="默认 256" size="md" />
          </Field>
          {/* Global score mode only applies when there are NO subtasks —
              each subtask carries its own `type`. Hiding it under that
              condition removes a confusing always-visible global switch. */}
          {!config.subtasks || config.subtasks.length <= 0 ? (
            <Field label="扁平算分模式">
              <SimpleSelect
                value={config.score || ''}
                onValueChange={(v) => updateConfig((c) => ({ ...c, score: (v || undefined) as ScoreMode | undefined }))}
                size="sm"
                ariaLabel="扁平算分模式"
                options={[
                  { value: '', label: '默认（min）' },
                  { value: 'sum', label: 'sum 求和' },
                  { value: 'min', label: 'min 最小值' },
                  { value: 'max', label: 'max 最大值' },
                ]}
              />
            </Field>
          ) : null}
          <Field label="Checker">
            <SimpleSelect
              value={config.checker_type || 'default'}
              onValueChange={(v) =>
                updateConfig((c) => ({
                  ...c,
                  checker_type: v as CheckerType,
                  // Preserve the file path when switching among checker-types
                  // that need a file (lemon/syzoj/testlib/custom), drop it
                  // when going back to a fileless type.
                  checker: CHECKER_TYPES_NEEDING_FILE.includes(v as CheckerType) ? c.checker : undefined,
                }))
              }
              size="sm"
              options={CHECKER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
        </div>

        {/* Conditional fields per checker / type */}
        {config.checker_type === 'float' ||
        (config.checker_type && CHECKER_TYPES_NEEDING_FILE.includes(config.checker_type as CheckerType)) ||
        config.type === 'interactive' ||
        config.type === 'communication' ||
        config.type === 'submit_answer' ||
        showAdvanced ? (
          <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {config.checker_type === 'float' ? (
              <>
                <Field label="相对误差">
                  <Input
                    type="number"
                    step="any"
                    value={config.float_relative ?? ''}
                    placeholder="1e-6"
                    onChange={(e) =>
                      updateConfig((c) => ({ ...c, float_relative: e.target.value === '' ? undefined : Number.parseFloat(e.target.value) }))
                    }
                  />
                </Field>
                <Field label="绝对误差">
                  <Input
                    type="number"
                    step="any"
                    value={config.float_absolute ?? ''}
                    placeholder="1e-6"
                    onChange={(e) =>
                      updateConfig((c) => ({ ...c, float_absolute: e.target.value === '' ? undefined : Number.parseFloat(e.target.value) }))
                    }
                  />
                </Field>
              </>
            ) : null}
            {config.checker_type && CHECKER_TYPES_NEEDING_FILE.includes(config.checker_type as CheckerType) ? (
              <Field label="Checker 文件">
                <FilePicker value={config.checker || ''} files={files} onChange={(v) => updateConfig((c) => ({ ...c, checker: v }))} />
              </Field>
            ) : null}
            {config.type === 'interactive' ? (
              <Field label="Interactor 文件">
                <FilePicker value={config.interactor || ''} files={files} onChange={(v) => updateConfig((c) => ({ ...c, interactor: v }))} />
              </Field>
            ) : null}
            {config.type === 'communication' ? (
              <>
                <Field label="User 文件">
                  <FilePicker value={config.user || ''} files={files} onChange={(v) => updateConfig((c) => ({ ...c, user: v }))} />
                </Field>
                <Field label="Manager 文件">
                  <FilePicker value={config.manager || ''} files={files} onChange={(v) => updateConfig((c) => ({ ...c, manager: v }))} />
                </Field>
              </>
            ) : null}
            {config.type === 'submit_answer' ? (
              <Field label="文件名模板">
                <Input
                  value={config.filename || ''}
                  placeholder="#1.in"
                  onChange={(e) => updateConfig((c) => ({ ...c, filename: e.target.value || undefined }))}
                />
              </Field>
            ) : null}
            {showAdvanced ? (
              <Field label="允许语言">
                <MultiSelect<LangOption>
                  options={PRESET_LANG_OPTIONS}
                  value={resolveLangs(config.langs || [])}
                  onChange={(next) =>
                    updateConfig((c) => ({
                      ...c,
                      langs: next.length ? next.map((o) => o.value) : undefined,
                    }))
                  }
                  getKey={(o) => o.value}
                  getLabel={(o) => `${o.label} (${o.value})`}
                  renderChip={(o) => <span className="font-mono">{o.label}</span>}
                  renderOption={(o, { selected: _selected }) => (
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{o.label}</span>
                      <span className="font-mono text-2xs text-fg-subtle">{o.value}</span>
                    </div>
                  )}
                  placeholder="留空 = 不限制"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {/* Per-language absolute time / memory limits — written to YAML as
            rates relative to the global base. */}
        {showAdvanced ? <PerLangLimits config={config} updateConfig={updateConfig} /> : null}

        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '收起高级' : '高级（语言限制 / 语言时空 / 其他）'}
        </Button>
      </div>
    </Panel>
  );
}

// Local alias — keeps the existing PerLangLimits code untouched while we
// dedupe to a single source of lang options.
const COMMON_LANG_OPTIONS = PRESET_LANG_OPTIONS;

/**
 * Per-language absolute time/memory limit editor.
 *
 * The judge runtime only understands rates, but punching `1.5×` and
 * `2×` numbers by hand is error-prone. So the UI presents absolute
 * values per lang, computed by `rate × base`, and writes the rate back
 * (= user-entered absolute / base) at serialize time.
 *
 * If the global base isn't set yet, we display a hint and let the user
 * input nothing — keeping ratios empty is safer than writing infinities.
 */
function PerLangLimits({ config, updateConfig }: { config: JudgeConfig; updateConfig: (m: (c: JudgeConfig) => JudgeConfig) => void }) {
  const baseTimeMs = parseTimeMS(config.time);
  const baseMemMb = parseMemoryMB(config.memory);
  const hasTimeBase = baseTimeMs != null;
  const hasMemoryBase = baseMemMb != null;
  const canAddLanguageLimit = hasTimeBase || hasMemoryBase;

  // Union of langs that have any rate set
  const langKeys = Array.from(new Set([...Object.keys(config.time_limit_rate || {}), ...Object.keys(config.memory_limit_rate || {})]));
  const [pendingLang, setPendingLang] = useState('');

  const addLang = (id: string) => {
    if (!canAddLanguageLimit) return;
    if (!id.trim()) return;
    if (langKeys.includes(id)) return;
    // Seed with rate 1 (= same as base) so the user just tweaks the number.
    updateConfig((c) => ({
      ...c,
      time_limit_rate: hasTimeBase ? { ...(c.time_limit_rate || {}), [id]: 1 } : c.time_limit_rate,
      memory_limit_rate: hasMemoryBase ? { ...(c.memory_limit_rate || {}), [id]: 1 } : c.memory_limit_rate,
    }));
    setPendingLang('');
  };

  const removeLang = (id: string) => {
    updateConfig((c) => {
      const t = { ...(c.time_limit_rate || {}) };
      const m = { ...(c.memory_limit_rate || {}) };
      delete t[id];
      delete m[id];
      return {
        ...c,
        time_limit_rate: Object.keys(t).length ? t : undefined,
        memory_limit_rate: Object.keys(m).length ? m : undefined,
      };
    });
  };

  const updateLangTime = (id: string, absoluteValue: string | undefined) => {
    if (baseTimeMs == null) return; // can't compute rate without a base
    updateConfig((c) => {
      const rates = { ...(c.time_limit_rate || {}) };
      if (!absoluteValue) {
        delete rates[id];
      } else {
        const ms = parseTimeMS(absoluteValue);
        if (ms != null && ms > 0) {
          rates[id] = +(ms / baseTimeMs).toFixed(4);
        }
      }
      return { ...c, time_limit_rate: Object.keys(rates).length ? rates : undefined };
    });
  };

  const updateLangMemory = (id: string, absoluteValue: string | undefined) => {
    if (baseMemMb == null) return;
    updateConfig((c) => {
      const rates = { ...(c.memory_limit_rate || {}) };
      if (!absoluteValue) {
        delete rates[id];
      } else {
        const mb = parseMemoryMB(absoluteValue);
        if (mb != null && mb > 0) {
          rates[id] = +(mb / baseMemMb).toFixed(4);
        }
      }
      return { ...c, memory_limit_rate: Object.keys(rates).length ? rates : undefined };
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg">按语言时空限制</p>
          <p className="text-2xs text-fg-subtle">
            基准 {baseTimeMs ? formatTime(baseTimeMs) : '未设'} / {baseMemMb ? formatMemory(baseMemMb) : '未设'}；填入实际限制，保存时自动换算为倍率
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <SimpleSelect
              value=""
              onValueChange={(v) => {
                if (v) addLang(v);
              }}
              size="sm"
              disabled={!canAddLanguageLimit}
              className="w-40"
              placeholder={canAddLanguageLimit ? '+ 添加语言…' : '先填写默认限制'}
              ariaLabel="添加语言时空限制"
              options={COMMON_LANG_OPTIONS.filter((o) => !langKeys.includes(o.value)).map((o) => ({ value: o.value, label: o.label }))}
            />
            <Input
              value={pendingLang}
              onChange={(e) => setPendingLang(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLang(pendingLang);
                }
              }}
              placeholder="或自定义 id"
              disabled={!canAddLanguageLimit}
              title={canAddLanguageLimit ? undefined : '先填写上方默认时间限制或默认内存限制'}
              size="sm"
              className="w-28"
            />
          </div>
          {!canAddLanguageLimit ? (
            <p className="text-2xs text-warning-fg">先填写上方默认时间限制或默认内存限制后，才能添加语言覆写。</p>
          ) : null}
        </div>
      </div>

      {!canAddLanguageLimit ? (
        <Alert tone="warning">语言限制保存的是“相对默认限制的倍率”。当前没有默认时空基准，所以下拉框会保持禁用。</Alert>
      ) : null}

      {langKeys.length === 0 ? (
        <p className="py-2 text-center text-2xs text-fg-subtle">尚未为任何语言设置覆写</p>
      ) : (
        <div className="flex flex-col gap-2">
          {langKeys.map((id) => {
            const tr = config.time_limit_rate?.[id];
            const mr = config.memory_limit_rate?.[id];
            const langTimeAbs = baseTimeMs && typeof tr === 'number' ? formatTime(baseTimeMs * tr) : '';
            const langMemAbs = baseMemMb && typeof mr === 'number' ? formatMemory(baseMemMb * mr) : '';
            const label = COMMON_LANG_OPTIONS.find((o) => o.value === id)?.label || id;
            return (
              <div key={id} className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface p-2">
                <div className="min-w-0 flex-1 basis-full sm:basis-40">
                  <p className="truncate text-xs font-medium text-fg" title={id}>
                    {label}
                  </p>
                  {label !== id ? <p className="truncate font-mono text-2xs text-fg-subtle">{id}</p> : null}
                </div>
                <label className="min-w-0 flex-1 basis-36">
                  <span className="mb-1 block text-2xs text-fg-subtle">时间</span>
                  <DurationInput
                    value={langTimeAbs}
                    onChange={(v) => updateLangTime(id, v)}
                    placeholder={baseTimeMs ? formatTime(baseTimeMs) : '未设基准'}
                    disabled={!hasTimeBase}
                  />
                </label>
                <label className="min-w-0 flex-1 basis-36">
                  <span className="mb-1 block text-2xs text-fg-subtle">内存</span>
                  <MemoryInput
                    value={langMemAbs}
                    onChange={(v) => updateLangMemory(id, v)}
                    placeholder={baseMemMb ? formatMemory(baseMemMb) : '未设基准'}
                    disabled={!hasMemoryBase}
                  />
                </label>
                <Button type="button" variant="danger-soft" size="sm" iconOnly className="self-center" onClick={() => removeLang(id)} aria-label="移除" title="移除">
                  <X />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-2xs text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}

function FilePicker({ value, files, onChange }: { value: string; files: ProblemFileEntry[]; onChange: (v: string) => void }) {
  return (
    <SimpleSelect
      value={value}
      onValueChange={onChange}
      size="sm"
      placeholder="— 选择文件 —"
      options={[{ value: '', label: '— 选择文件 —' }, ...files.map((f) => ({ value: f.name, label: f.name }))]}
    />
  );
}

/**
 * Number-plus-unit picker for a Hydro time string ("2s" / "1500ms").
 * Empty value renders the placeholder (e.g. "默认 1s"). Output is `undefined`
 * when value is cleared, so the config object drops the override entirely.
 */
function DurationInput({
  value,
  onChange,
  placeholder,
  className,
  size = 'sm',
  disabled,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const split = splitTime(value);
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        type="number"
        step="any"
        min={0}
        value={split.value}
        onChange={(e) => onChange(joinTime(e.target.value, split.unit))}
        placeholder={placeholder}
        disabled={disabled}
        size={size === 'md' ? 'md' : 'sm'}
        className="min-w-0 flex-1"
      />
      <SimpleSelect
        value={split.unit}
        onValueChange={(v) => onChange(joinTime(split.value, v as 'ms' | 's'))}
        size="sm"
        disabled={disabled}
        className="w-16 shrink-0"
        options={[
          { value: 'ms', label: 'ms' },
          { value: 's', label: 's' },
        ]}
      />
    </div>
  );
}

/** Number-plus-unit picker for a Hydro memory string ("256m" / "1g" / "512k"). */
function MemoryInput({
  value,
  onChange,
  placeholder,
  className,
  size = 'sm',
  disabled,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const split = splitMemory(value);
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        type="number"
        step="any"
        min={0}
        value={split.value}
        onChange={(e) => onChange(joinMemory(e.target.value, split.unit))}
        placeholder={placeholder}
        disabled={disabled}
        size={size === 'md' ? 'md' : 'sm'}
        className="min-w-0 flex-1"
      />
      <SimpleSelect
        value={split.unit}
        onValueChange={(v) => onChange(joinMemory(split.value, v as 'k' | 'm' | 'g'))}
        size="sm"
        disabled={disabled}
        className="w-16 shrink-0"
        options={[
          { value: 'k', label: 'KB' },
          { value: 'm', label: 'MB' },
          { value: 'g', label: 'GB' },
        ]}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Issues panel                                                      */
/* ────────────────────────────────────────────────────────────────── */

function IssuesPanel({ issues }: { issues: ReturnType<typeof validateConfig> }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return (
    <div className="flex flex-col gap-2">
      {errors.map((i, idx) => (
        <Alert key={`e${idx}`} tone="danger">
          {i.message}
          {i.subtaskId != null ? ` (subtask #${i.subtaskId})` : ''}
        </Alert>
      ))}
      {warnings.map((i, idx) => (
        <Alert key={`w${idx}`} tone="warning">
          {i.message}
          {i.subtaskId != null ? ` (subtask #${i.subtaskId})` : ''}
        </Alert>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Column 1 — Files                                                  */
/* ────────────────────────────────────────────────────────────────── */

function FilesColumn({
  files,
  usedInPairs,
  problemUrl,
  addCase: _addCase,
  onOpenFile,
  confirmWrite,
}: {
  files: ProblemFileEntry[];
  usedInPairs: Set<string>;
  problemUrl: string;
  addCase: (c: JudgeCase) => void;
  onOpenFile: (file: ProblemFileEntry) => void;
  confirmWrite: (action: string, operation?: ProblemDataWriteOperation) => Promise<ProblemDataWriteConfirmationResult>;
}) {
  const [filter, setFilter] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadConfirmationRequestId, setUploadConfirmationRequestId] = useState('');
  const openUpload = useCallback(async () => {
    const confirmation = await confirmWrite('上传测试数据', 'files-upload');
    if (!confirmation) return;
    setUploadConfirmationRequestId(typeof confirmation === 'string' ? confirmation : '');
    setUploadOpen(true);
  }, [confirmWrite]);
  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    setUploadConfirmationRequestId('');
  }, []);
  // Hide files already referenced by some case — keeps the pool focused on
  // "what still needs assigning". To move a file between cases, drag it
  // straight in the Cases column instead.
  const visibleFiles = useMemo(() => files.filter((f) => !usedInPairs.has(f.name)), [files, usedInPairs]);
  const filtered = useMemo(
    () => (filter ? visibleFiles.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())) : visibleFiles),
    [visibleFiles, filter],
  );

  const stats = useMemo(() => {
    let inputs = 0;
    let outputs = 0;
    let other = 0;
    for (const f of files) {
      const cls = classify(f.name);
      if (cls.kind === 'input') inputs++;
      else if (cls.kind === 'output') outputs++;
      else other++;
    }
    return { inputs, outputs, other, unused: files.length - usedInPairs.size };
  }, [files, usedInPairs]);

  return (
    <Panel
      as="div"
      flush
      className="flex h-full min-h-0 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col"
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <FolderOpen className="size-4 shrink-0" />
          <span className="truncate">文件池</span>
        </span>
      }
      actions={
        <Button type="button" size="sm" variant="secondary" onClick={() => void openUpload()}>
          <Upload />
          上传
        </Button>
      }
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle px-3 py-2">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="输入" value={stats.inputs} />
          <Stat label="输出" value={stats.outputs} />
          <Stat label="其他" value={stats.other} />
        </div>
        <Input size="sm" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索文件…" />
      </div>
      <ScrollArea
        viewportLayout="flex"
        className="min-h-0 flex-1"
        viewportClassName="p-2 [&>div]:w-full [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-1.5"
      >
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-fg-muted">
            {files.length === 0 ? '暂无文件，先上传一些' : usedInPairs.size === files.length ? '所有文件已分配' : '无匹配文件'}
          </p>
        ) : (
          filtered.map((f) => <FileRow key={f.name} f={f} onOpen={() => onOpenFile(f)} />)
        )}
      </ScrollArea>

      <Dialog open={uploadOpen} onOpenChange={(open) => (open ? setUploadOpen(true) : closeUpload())}>
        <DialogContent className="w-full max-w-xl" onClose={closeUpload}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="size-4" />
              上传测试数据
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 p-5">
            <FileUploader
              endpoint={`${problemUrl}/files`}
              fieldName="file"
              meta={{
                type: 'testdata',
                ...(uploadConfirmationRequestId ? { activeContainerConfirmation: uploadConfirmationRequestId } : {}),
              }}
              maxFileSize={null}
              maxFiles={null}
              uploadConcurrency={1}
              retryOnFailure={false}
              onBatchComplete={() => {
                // Refresh so the new files appear in the pool
                setTimeout(() => window.location.reload(), 600);
              }}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={closeUpload}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function FileRow({ f, onOpen }: { f: ProblemFileEntry; onOpen?: () => void }) {
  const cls = classify(f.name);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `file:${f.name}`,
    data: { kind: 'file', name: f.name, cls: cls.kind } satisfies DraggedItem,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group flex w-full min-w-0 items-center gap-1 rounded-md border border-line text-xs',
        isDragging ? 'invisible' : 'hover:border-brand-line hover:bg-surface-hover',
      )}
    >
      {/* Drag handle — ONLY this grip starts a drag, including keyboard via listeners. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        className="cursor-grab active:cursor-grabbing"
        aria-label="拖动以分配"
        title="拖动以分配"
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <span className="shrink-0">
        <FileTypeBadge cls={cls.kind} />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onOpen}
        title={f.name}
        className="min-w-0 flex-1 shrink justify-start overflow-hidden"
      >
        <span className="min-w-0 truncate font-mono" title={f.name}>
          {f.name}
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        onClick={onOpen}
        aria-label="编辑文件"
        title="编辑文件"
        className="invisible group-hover:visible focus-visible:visible"
      >
        <FileEdit />
      </Button>
    </div>
  );
}

function FileTypeBadge({ cls }: { cls: 'input' | 'output' | 'other' }) {
  if (cls === 'input') return <StatusDot tone="info" />;
  if (cls === 'output') return <StatusDot tone="violet" />;
  return <StatusDot />;
}

/* ────────────────────────────────────────────────────────────────── */
/*  Column 2 — Cases (flat pool when no subtasks)                     */
/* ────────────────────────────────────────────────────────────────── */

function CasesColumn({
  config,
  fileSet,
  addCase,
  removeCase,
  updateCase,
  addSubtaskFromCases,
  autoPairAll,
}: {
  config: JudgeConfig;
  fileSet: Set<string>;
  addCase: (c: JudgeCase) => void;
  removeCase: (idx: number, stid?: number) => void;
  updateCase: (idx: number, patch: Partial<JudgeCase>, stid?: number) => void;
  addSubtaskFromCases: (cases: JudgeCase[]) => void;
  autoPairAll: () => void;
}) {
  const flatCases = config.cases || [];
  const hasSubtasks = (config.subtasks?.length || 0) > 0;
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: 'drop:case-pool',
    data: { kind: 'case-pool' } satisfies DropTarget,
  });

  const toggleSel = (i: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };

  const selectedCases = useMemo(() => [...selected].map((i) => flatCases[i]).filter(Boolean), [selected, flatCases]);

  return (
    <Panel
      as="div"
      flush
      className={cn(
        'flex h-full min-h-0 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col',
        isOver && 'border-brand bg-brand-soft',
      )}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Link2 className="size-4 shrink-0" />
          <span className="truncate">测试用例 {hasSubtasks ? '(已分组)' : `(${flatCases.length})`}</span>
        </span>
      }
      actions={
        <>
          <Button type="button" size="sm" variant="secondary" onClick={autoPairAll} title="按命名自动配对所有文件">
            自动配对
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => addCase({ input: '', output: '' })}>
            <Plus />
            空对
          </Button>
        </>
      }
    >
      {selected.size > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-2 text-xs">
          <span className="text-fg-subtle">{selected.size} 已选</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              addSubtaskFromCases(selectedCases);
              setSelected(new Set());
            }}
          >
            建为测试点
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            清除
          </Button>
        </div>
      ) : null}
      <ScrollArea
        viewportRef={dropRef}
        viewportLayout="flex"
        className="min-h-0 flex-1"
        viewportClassName="p-2 [&>div]:w-full [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-1.5"
      >
        {/* Header note when in subtask mode — but we STILL render flat cases below if any,
            so that cases dragged back from a subtask don't vanish into thin air. */}
        {hasSubtasks ? (
          <div className="rounded-md border border-dashed border-line bg-surface-sunken p-3 text-center text-2xs text-fg-subtle">
            已使用 Subtask 分组。拖文件到右侧测试点；从测试点拖回的用例会暂存在下方"未分组"区。
          </div>
        ) : null}
        {!hasSubtasks && flatCases.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-surface-sunken p-6 text-center text-xs text-fg-muted">
            把文件从左侧拖到此处自动配对。
            <br />
            或点击「自动配对」一键完成。
          </div>
        ) : null}
        {flatCases.length > 0 ? (
          <>
            {hasSubtasks ? <p className="px-1 pt-1 text-2xs text-fg-subtle">未分组（{flatCases.length}）</p> : null}
            {flatCases.map((c, i) => (
              <CaseRow
                key={i}
                c={c}
                idx={i}
                fileSet={fileSet}
                selected={selected.has(i)}
                onToggleSelect={() => toggleSel(i)}
                onRemove={() => removeCase(i)}
                onUpdate={(patch) => updateCase(i, patch)}
              />
            ))}
          </>
        ) : null}
      </ScrollArea>
    </Panel>
  );
}

function CaseRow({
  c,
  idx,
  fileSet,
  selected,
  onToggleSelect,
  onRemove,
  onUpdate,
  stid,
}: {
  c: JudgeCase;
  idx: number;
  fileSet: Set<string>;
  selected?: boolean;
  onToggleSelect?: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<JudgeCase>) => void;
  stid?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `case:${stid ?? 'flat'}:${idx}`,
    data: { kind: 'case', case: c, fromStid: stid, fromIdx: idx } satisfies DraggedItem,
  });
  const inputMissing = c.input && !fileSet.has(c.input);
  const outputMissing = c.output && !fileSet.has(c.output);

  // Two drop slots: input + output
  const { setNodeRef: dropInputRef, isOver: overInput } = useDroppable({
    id: `drop:case:${stid ?? 'flat'}:${idx}:input`,
    data: { kind: 'case-input', stid, idx } satisfies DropTarget,
  });
  const { setNodeRef: dropOutputRef, isOver: overOutput } = useDroppable({
    id: `drop:case:${stid ?? 'flat'}:${idx}:output`,
    data: { kind: 'case-output', stid, idx } satisfies DropTarget,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn('rounded-lg border bg-surface text-xs', isDragging && 'invisible', selected ? 'border-brand' : 'border-line')}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1 p-1.5">
        {onToggleSelect ? <Checkbox checked={selected} onChange={onToggleSelect} /> : null}
        {/* Dedicated drag handle — only this grip triggers drag, so the input fields stay typeable. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          className="cursor-grab active:cursor-grabbing"
          aria-label="拖动用例"
          title="拖动用例"
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </Button>
        <span className="w-5 shrink-0 text-center font-mono text-2xs text-fg-subtle">#{idx + 1}</span>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 sm:grid-cols-2">
          <div
            ref={dropInputRef}
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1',
              overInput ? 'border-brand bg-brand-soft' : inputMissing ? 'border-danger-line bg-danger-soft' : 'border-line',
            )}
          >
            <StatusDot tone="info" />
            <Input
              value={c.input}
              onChange={(e) => onUpdate({ input: e.target.value })}
              placeholder="input"
              size="sm"
              invalid={Boolean(inputMissing)}
              className="min-w-0 flex-1 font-mono"
            />
          </div>
          <div
            ref={dropOutputRef}
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1',
              overOutput ? 'border-brand bg-brand-soft' : outputMissing ? 'border-danger-line bg-danger-soft' : 'border-line',
            )}
          >
            <StatusDot tone="violet" />
            <Input
              value={c.output}
              onChange={(e) => onUpdate({ output: e.target.value })}
              placeholder="output"
              size="sm"
              invalid={Boolean(outputMissing)}
              className="min-w-0 flex-1 font-mono"
            />
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => setExpanded(!expanded)} aria-label="高级" title="高级">
          <Settings />
        </Button>
        <Button type="button" variant="danger-soft" size="sm" iconOnly onClick={onRemove} aria-label="移除用例">
          <X />
        </Button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-1 gap-2 border-t border-line bg-surface-sunken p-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-2xs text-fg-subtle">时间覆写</span>
            <DurationInput value={c.time} onChange={(v) => onUpdate({ time: v })} placeholder="留空 = 默认" />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-fg-subtle">内存覆写</span>
            <MemoryInput value={c.memory} onChange={(v) => onUpdate({ memory: v })} placeholder="留空 = 默认" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-2xs text-fg-subtle">测试点提示（PTA 风格，显示在评测详情该测试点旁）</span>
            <Textarea
              value={c.hint || ''}
              onChange={(e) => onUpdate({ hint: e.target.value || undefined })}
              placeholder="留空 = 无提示"
              rows={2}
            />
          </label>
          <label className="flex items-center gap-1.5 sm:col-span-2">
            <Switch checked={!!c.hintPublic} onChange={() => onUpdate({ hintPublic: !c.hintPublic })} />
            <span className="text-2xs text-fg-subtle">提示对外公开（题库/训练显示；比赛进行中自动隐藏，赛后恢复）</span>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-2xs text-fg-subtle">讲解视频链接（显示在评测详情该测试点旁）</span>
            <Input
              type="url"
              size="sm"
              value={c.videoUrl || ''}
              onChange={(e) => onUpdate({ videoUrl: e.target.value.trim() || undefined })}
              placeholder="https://…（留空 = 无视频）"
            />
          </label>
          <label className="flex items-center gap-1.5 sm:col-span-2">
            <Switch checked={c.videoPublic ?? !!c.hintPublic} onChange={() => onUpdate({ videoPublic: !(c.videoPublic ?? !!c.hintPublic) })} />
            <span className="text-2xs text-fg-subtle">视频对外公开（未单独设置时跟随提示的公开状态）</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Column 3 — Subtasks                                               */
/* ────────────────────────────────────────────────────────────────── */

function SubtasksColumn({
  config,
  fileSet,
  updateSubtask,
  removeSubtask,
  addSubtask,
  removeCase,
  updateCase,
}: {
  config: JudgeConfig;
  fileSet: Set<string>;
  updateSubtask: (stid: number, patch: Partial<JudgeSubtask>) => void;
  removeSubtask: (stid: number) => void;
  addSubtask: () => void;
  removeCase: (idx: number, stid?: number) => void;
  updateCase: (idx: number, patch: Partial<JudgeCase>, stid?: number) => void;
}) {
  const subtasks = config.subtasks || [];
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-fg">
          <Grid3X3 className="size-4 shrink-0" />
          <span className="truncate">测试点 ({subtasks.length})</span>
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={addSubtask}>
          <Plus />
          新建
        </Button>
      </div>
      {subtasks.length > 0 ? (
        <p className="shrink-0 pb-2 text-2xs text-fg-subtle">总分 {subtasks.reduce((n, s) => n + (s.score || 0), 0)} 分</p>
      ) : null}
      <ScrollArea
        viewportLayout="flex"
        className="min-h-0 flex-1"
        viewportClassName="[&>div]:w-full [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-2"
      >
        {subtasks.length > 0 ? <SubtaskDepLines subtasks={subtasks} /> : null}
        {subtasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-surface-sunken p-6 text-center text-xs text-fg-muted">
            <p className="mb-2">还没有测试点</p>
            <Button type="button" size="sm" variant="secondary" onClick={addSubtask}>
              <Plus />
              新建第一个测试点
            </Button>
          </div>
        ) : (
          subtasks.map((s) => (
            <SubtaskEditor
              key={s.id}
              subtask={s}
              fileSet={fileSet}
              allIds={subtasks.map((x) => x.id!).filter((id) => id !== s.id)}
              onUpdate={(patch) => updateSubtask(s.id!, patch)}
              onRemove={() => removeSubtask(s.id!)}
              onUpdateCase={(idx, patch) => updateCase(idx, patch, s.id)}
              onRemoveCase={(idx) => removeCase(idx, s.id)}
            />
          ))
        )}
      </ScrollArea>
    </section>
  );
}

function SubtaskDepLines({ subtasks: _subtasks }: { subtasks: JudgeSubtask[] }) {
  // SVG drawn absolutely on top of the column. For each subtask with `if`,
  // draw a line from the right edge of the dependency to the left edge of
  // this card. The actual coords are unknown until paint; we use data-*
  // selectors and resize observers in a separate component if needed.
  // For a pragmatic v1: just render a small chip label on each card.
  return null;
}

function SubtaskEditor({
  subtask,
  fileSet,
  allIds,
  onUpdate,
  onRemove,
  onUpdateCase,
  onRemoveCase,
}: {
  subtask: JudgeSubtask;
  fileSet: Set<string>;
  allIds: number[];
  onUpdate: (patch: Partial<JudgeSubtask>) => void;
  onRemove: () => void;
  onUpdateCase: (idx: number, patch: Partial<JudgeCase>) => void;
  onRemoveCase: (idx: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showDepPicker, setShowDepPicker] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:subtask:${subtask.id}`,
    data: { kind: 'subtask', stid: subtask.id! } satisfies DropTarget,
  });

  return (
    <div ref={setNodeRef} className="min-w-0">
      <Panel as="div" flush className={cn(isOver && 'border-brand bg-brand-soft')}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-surface-sunken px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={collapsed ? '展开测试点' : '收起测试点'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">#{subtask.id}</span>
          <span className="min-w-0 flex-1 basis-24 truncate text-sm font-medium text-fg">Subtask {subtask.id}</span>
          <Input
            type="number"
            size="sm"
            value={subtask.score ?? ''}
            onChange={(e) => onUpdate({ score: e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10) })}
            placeholder="分数"
            aria-label="分数"
            className="w-16 shrink-0"
          />
          <SimpleSelect
            value={subtask.type || 'min'}
            onValueChange={(v) => onUpdate({ type: v as ScoreMode })}
            size="sm"
            className="w-20 shrink-0"
            ariaLabel="算分模式"
            options={[
              { value: 'min', label: 'min' },
              { value: 'sum', label: 'sum' },
              { value: 'max', label: 'max' },
            ]}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowDepPicker(!showDepPicker)} title="依赖">
            if: [{(subtask.if || []).join(', ') || '—'}]
          </Button>
          <Button type="button" variant="danger-soft" size="sm" iconOnly aria-label="删除测试点" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>

        {showDepPicker ? (
          <div className="border-b border-line-subtle bg-surface-sunken px-3 py-2">
            <p className="mb-1 text-2xs text-fg-subtle">依赖测试点（必须先通过）：</p>
            <div className="flex flex-wrap gap-1">
              {allIds.length === 0 ? (
                <span className="text-2xs text-fg-subtle">没有其它测试点</span>
              ) : (
                allIds.map((id) => {
                  const enabled = (subtask.if || []).includes(id);
                  return (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={enabled ? 'soft' : 'secondary'}
                      onClick={() => {
                        const ifs = subtask.if || [];
                        onUpdate({ if: enabled ? ifs.filter((x) => x !== id) : [...ifs, id] });
                      }}
                    >
                      #{id}
                    </Button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {!collapsed ? (
          <div className="flex flex-col gap-1 p-2">
            {subtask.cases.length === 0 ? (
              <p className="rounded-md border border-dashed border-line p-3 text-center text-2xs text-fg-subtle">拖测试用例到这里</p>
            ) : (
              subtask.cases.map((c, i) => (
                <CaseRow
                  key={i}
                  c={c}
                  idx={i}
                  fileSet={fileSet}
                  stid={subtask.id}
                  onRemove={() => onRemoveCase(i)}
                  onUpdate={(patch) => onUpdateCase(i, patch)}
                />
              ))
            )}
            {/* Subtask-level overrides — apply to every case in this subtask
                unless the case sets its own. */}
            <div className="mt-1 grid grid-cols-1 gap-2 border-t border-line pt-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-2xs text-fg-subtle">组级时间覆写</span>
                <DurationInput value={subtask.time} onChange={(v) => onUpdate({ time: v })} placeholder="留空 = 默认" />
              </label>
              <label className="space-y-1">
                <span className="text-2xs text-fg-subtle">组级内存覆写</span>
                <MemoryInput value={subtask.memory} onChange={(v) => onUpdate({ memory: v })} placeholder="留空 = 默认" />
              </label>
            </div>
          </div>
        ) : (
          <div className="p-2 text-2xs text-fg-subtle">{subtask.cases.length} 用例</div>
        )}
      </Panel>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Drag types & handlers                                             */
/* ────────────────────────────────────────────────────────────────── */

type DraggedItem =
  | { kind: 'file'; name: string; cls: 'input' | 'output' | 'other' }
  | { kind: 'case'; case: JudgeCase; fromStid?: number; fromIdx: number };

type DropTarget =
  | { kind: 'case-pool' }
  | { kind: 'case-input'; stid?: number; idx: number }
  | { kind: 'case-output'; stid?: number; idx: number }
  | { kind: 'subtask'; stid: number };

function handleDrop(active: DraggedItem, over: DropTarget, updateConfig: (m: (c: JudgeConfig) => JudgeConfig) => void) {
  if (active.kind === 'file') {
    // File dropped on case-pool: create new case
    if (over.kind === 'case-pool') {
      updateConfig((cfg) => {
        const c: JudgeCase =
          active.cls === 'input'
            ? { input: active.name, output: '' }
            : active.cls === 'output'
              ? { input: '', output: active.name }
              : { input: active.name, output: '' };
        if (cfg.subtasks && cfg.subtasks.length > 0) {
          // Add to first subtask
          const newSubs = [...cfg.subtasks];
          newSubs[0] = { ...newSubs[0], cases: [...newSubs[0].cases, c] };
          return { ...cfg, subtasks: newSubs };
        }
        return { ...cfg, cases: [...(cfg.cases || []), c] };
      });
      return;
    }
    // File dropped on existing case slot (fill input or output)
    if (over.kind === 'case-input' || over.kind === 'case-output') {
      const target = over.kind === 'case-input' ? 'input' : 'output';
      updateConfig((cfg) => {
        const updateInList = (list: JudgeCase[]) => list.map((c, i) => (i === over.idx ? { ...c, [target]: active.name } : c));
        if (over.stid != null && cfg.subtasks) {
          return {
            ...cfg,
            subtasks: cfg.subtasks.map((s) => (s.id === over.stid ? { ...s, cases: updateInList(s.cases) } : s)),
          };
        }
        return { ...cfg, cases: updateInList(cfg.cases || []) };
      });
      return;
    }
    // File dropped on subtask: create new case in subtask
    if (over.kind === 'subtask') {
      updateConfig((cfg) => {
        const c: JudgeCase = active.cls === 'output' ? { input: '', output: active.name } : { input: active.name, output: '' };
        return {
          ...cfg,
          subtasks: (cfg.subtasks || []).map((s) => (s.id === over.stid ? { ...s, cases: [...s.cases, c] } : s)),
        };
      });
      return;
    }
  }
  if (active.kind === 'case') {
    // Case dropped on subtask: move there
    if (over.kind === 'subtask') {
      updateConfig((cfg) => {
        if (active.fromStid === over.stid) return cfg;
        // Remove from source
        let newConfig = cfg;
        if (active.fromStid != null) {
          newConfig = {
            ...newConfig,
            subtasks: (newConfig.subtasks || []).map((s) =>
              s.id === active.fromStid ? { ...s, cases: s.cases.filter((_, i) => i !== active.fromIdx) } : s,
            ),
          };
        } else {
          newConfig = { ...newConfig, cases: (newConfig.cases || []).filter((_, i) => i !== active.fromIdx) };
        }
        // Add to target
        newConfig = {
          ...newConfig,
          subtasks: (newConfig.subtasks || []).map((s) => (s.id === over.stid ? { ...s, cases: [...s.cases, active.case] } : s)),
        };
        return newConfig;
      });
      return;
    }
    // Case dropped back to pool: move out of subtask
    if (over.kind === 'case-pool' && active.fromStid != null) {
      updateConfig((cfg) => {
        const newSubs = (cfg.subtasks || []).map((s) =>
          s.id === active.fromStid ? { ...s, cases: s.cases.filter((_, i) => i !== active.fromIdx) } : s,
        );
        return { ...cfg, cases: [...(cfg.cases || []), active.case], subtasks: newSubs };
      });
    }
  }
}

function DragPreview({ item }: { item: DraggedItem }) {
  if (item.kind === 'file') {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-pop">
        <FileTypeBadge cls={item.cls} />
        <span className="font-mono">{item.name}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-pop">
      <StatusDot tone="info" />
      <span className="font-mono">{item.case.input || '—'}</span>
      <ArrowRight className="size-3 text-fg-subtle" />
      <StatusDot tone="violet" />
      <span className="font-mono">{item.case.output || '—'}</span>
    </div>
  );
}
