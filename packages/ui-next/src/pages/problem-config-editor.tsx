/**
 * Problem config editor — judge configuration UI rebuilt from scratch.
 *
 * Layout: 3-column Kanban (Files | Cases | Subtasks).
 * Workflow: Files → pair into Cases → assign Cases to Subtasks → set scoring & deps.
 *
 * Bidirectional sync: structured form ⇄ raw YAML. Form edits regenerate
 * the YAML (losing comments on structural changes). YAML edits, when
 * valid, push state back into the form.
 *
 * Responsive: 3 cols on desktop, 2 cols on tablet (files + cases merge
 * into MiniTabs), single column read-only with raw YAML on mobile.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  FileCode,
  Files,
  FolderOpen,
  Grid3X3,
  GripVertical,
  FileEdit,
  Link2,
  Lock,
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
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KryptonIDE } from '@/components/krypton-ide';
import { FileUploader } from '@/components/uploader';
import { MultiSelect } from '@/components/ui/multi-select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { COMMON_LANG_OPTIONS as PRESET_LANG_OPTIONS, type LangOption, resolveLangs } from '@/lib/multi-select-presets';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';
import {
  JudgeConfig,
  JudgeCase,
  JudgeSubtask,
  ProblemType,
  CheckerType,
  parseJudgeConfig,
  serializeJudgeConfig,
  autoPair,
  classify,
  validateConfig,
  emptyConfig,
  parseTimeMS, parseMemoryMB, formatTime, formatMemory, splitTime, splitMemory, joinTime, joinMemory,
} from '@/lib/judge-config';

type R = Record<string, any>;

const PROBLEM_TYPES: { value: ProblemType; label: string; desc: string }[] = [
  { value: 'default', label: '传统评测', desc: '标准输入输出，逐用例判分' },
  { value: 'objective', label: '客观题', desc: '选择/填空' },
  { value: 'fill_function', label: '函数填空', desc: '填入指定函数体' },
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

export function ProblemConfigEditor({ problemUrl, pdoc, files, initialYaml }: {
  problemUrl: string;
  pdoc: R;
  files: R[];
  initialYaml: string;
}) {
  // --- state ---
  const [yamlText, setYamlText] = useState(initialYaml);
  const initialParse = useMemo(() => parseJudgeConfig(initialYaml), [initialYaml]);
  const [config, setConfig] = useState<JudgeConfig>(initialParse.config);
  const [yamlError, setYamlError] = useState<string | undefined>(initialParse.error);
  const [viewMode, setViewMode] = useState<'visual' | 'yaml'>('visual');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
  const lastSource = useRef<'form' | 'yaml'>('form');
  const [mobileTab, setMobileTab] = useState<'files' | 'cases' | 'subtasks'>('files');
  // File being edited in the modal — null = closed.
  const [editingFile, setEditingFile] = useState<R | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // --- yaml → form sync (debounced) ---
  const onYamlChange = useCallback((next: string) => {
    lastSource.current = 'yaml';
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
    setConfig((c) => mut(c));
  }, []);

  // --- validation ---
  const issues = useMemo(() => validateConfig(config, fileSet), [config, fileSet]);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warnCount = issues.filter((i) => i.level === 'warning').length;

  // --- save ---
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const currentYaml = lastSource.current === 'form'
        ? serializeJudgeConfig(config, { preserveSource: yamlText })
        : yamlText;
      if (currentYaml !== yamlText) setYamlText(currentYaml);
      const formData = new FormData();
      formData.append('operation', 'upload_file');
      formData.append('type', 'testdata');
      formData.append('filename', 'config.yaml');
      formData.append('file', new Blob([currentYaml], { type: 'text/yaml' }), 'config.yaml');
      const res = await fetch(`${problemUrl}/files`, {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        setSaveMsg('已保存');
        setTimeout(() => setSaveMsg(null), 1800);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveMsg(data?.error || '保存失败');
      }
    } catch (e: any) {
      setSaveMsg(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [config, yamlText, problemUrl]);

  // --- drag handlers ---
  // Activation distance was 4px — that's so small that even an accidental
  // wobble while pointing at a file slot already triggers a drop. Bump to 10px
  // (≈ 3mm on a typical display) so a click is unambiguously a click and a
  // drag needs intent. The dedicated drag handle below also helps separate
  // clicks from drags.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }));

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
          subtasks: cfg.subtasks.map((s) => s.id === stid ? { ...s, cases: s.cases.filter((_, i) => i !== idx) } : s),
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
          subtasks: cfg.subtasks.map((s) => s.id === stid ? { ...s, cases: s.cases.map((c, i) => i === idx ? { ...c, ...patch } : c) } : s),
        };
      }
      return { ...cfg, cases: (cfg.cases || []).map((c, i) => i === idx ? { ...c, ...patch } : c) };
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
      if (cfg.cases) delete (newConfig as any).cases;
      return newConfig;
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
      subtasks: (cfg.subtasks || []).map((s) => s.id === stid ? { ...s, ...patch } : s),
    }));
  };

  /* ── responsive viewport detection ── */
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.innerWidth >= 1024) return 'desktop';
    if (window.innerWidth >= 640) return 'tablet';
    return 'mobile';
  });
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setViewport(w >= 1024 ? 'desktop' : w >= 640 ? 'tablet' : 'mobile');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <motion.div
      // Viewport-constrained flex layout — keeps the 3 kanban columns inside
      // the visible area with internal scroll, and the AppShell footer
      // anchored to the bottom of the viewport. The calc accounts for the
      // AppShell topbar (3rem) + main padding (varies) + this page's
      // breathing room; everything below the kanban (sticky footer) is
      // outside this motion.div but still inside the main ScrollArea.
      className="flex h-[calc(100dvh-5rem)] min-h-[520px] flex-col gap-4 sm:h-[calc(100dvh-6rem)] xl:h-[calc(100dvh-7rem)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={problemUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">评测配置</h1>
          <p className="text-sm text-muted-foreground">{pdoc.title || pdoc.pid || '题目'}</p>
        </div>
        <div className="flex items-center gap-2">
          {errorCount > 0 ? (
            <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" />{errorCount} 错误</Badge>
          ) : warnCount > 0 ? (
            <Badge variant="outline" className="gap-1 border-amber-400 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3" />{warnCount} 警告</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-green-500 text-green-600 dark:text-green-400"><CheckCircle2 className="size-3" />OK</Badge>
          )}
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            <Save className="size-3.5" />
            {saving ? '保存中…' : saveMsg ?? '保存'}
          </Button>
        </div>
      </div>

      {/* View-mode tabs: 可视化 vs 原始 YAML (双向同步保留) */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <MiniTabs
          size="md"
          value={viewMode}
          onValueChange={(v) => setViewMode(v as 'visual' | 'yaml')}
          items={[
            { value: 'visual', label: '可视化' },
            { value: 'yaml', label: '原始 YAML' },
          ]}
        />
        {yamlError ? (
          <Badge variant="destructive" className="text-[10px]">YAML 解析错误：未应用最新编辑</Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">两侧实时双向同步</span>
        )}
      </div>

      {viewMode === 'yaml' ? (
        // ── YAML mode: full-width KryptonIDE simple editor on the raw text
        <Card className="flex min-h-0 flex-1 flex-col">
          {yamlError ? (
            <CardContent className="shrink-0 border-b bg-destructive/5 p-2 text-xs text-destructive">
              ⚠ {yamlError}
            </CardContent>
          ) : null}
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <KryptonIDE
              mode="simple"
              langs={[]}
              defaultLang="yaml"
              value={yamlText}
              onValueChange={onYamlChange}
              minHeight={420}
              className="h-full rounded-none border-0"
            />
          </CardContent>
          <CardContent className="shrink-0 border-t bg-muted/20 py-2 text-[11px] text-muted-foreground">
            修改 YAML 会同步回左侧可视化；可视化变更也会重新格式化此处（注释会尽量保留）。
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Basic config strip */}
          <div className="shrink-0">
            <BasicConfigStrip config={config} updateConfig={updateConfig} files={files} />
          </div>

          {/* Mobile read-only notice */}
          {viewport === 'mobile' ? (
            <Card className="shrink-0">
              <CardContent className="p-4 text-sm text-muted-foreground space-y-2">
                <p>当前为小屏只读视图。如需配置测试点、拖拽用例，请使用桌面端。</p>
                <p>可切到「原始 YAML」标签直接编辑。</p>
              </CardContent>
            </Card>
          ) : null}

          {/* Issues panel */}
          {issues.length > 0 ? (
            <div className="shrink-0">
              <IssuesPanel issues={issues} />
            </div>
          ) : null}

          {/* Main kanban area — flex-1 so the 3 columns fill remaining
              vertical space; each column then scrolls internally. */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            {viewport === 'mobile' ? null : viewport === 'desktop' ? (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1.2fr)] xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.3fr)]">
            <FilesColumn files={files} usedInPairs={usedInPairs} problemUrl={problemUrl} addCase={addCase} onOpenFile={setEditingFile} />
            <CasesColumn config={config} fileSet={fileSet} addCase={addCase} removeCase={removeCase} updateCase={updateCase} addSubtaskFromCases={(cases) => {
              const existing = config.subtasks || [];
              const nextId = (existing.length ? Math.max(...existing.map((s) => s.id ?? 0)) : 0) + 1;
              const newSt: JudgeSubtask = { id: nextId, score: 0, type: 'min', cases };
              updateConfig((cfg) => {
                const nextSubs = [...existing, newSt];
                const out: JudgeConfig = { ...cfg, subtasks: nextSubs };
                // remove these cases from flat list
                if (cfg.cases) {
                  out.cases = cfg.cases.filter((c) => !cases.some((cc) => cc.input === c.input && cc.output === c.output));
                  if (out.cases.length === 0) delete (out as any).cases;
                }
                return out;
              });
            }} autoPairAll={() => {
              const result = autoPair(fileNames);
              updateConfig((cfg) => ({ ...cfg, cases: result.pairs, subtasks: undefined }));
            }} />
            <SubtasksColumn config={config} updateSubtask={updateSubtask} removeSubtask={removeSubtask} addSubtask={addSubtask} removeCase={removeCase} updateCase={updateCase} />
          </div>
        ) : (
          // tablet
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.3fr] gap-3">
            <div className="flex min-h-0 flex-col">
              <MiniTabs
                value={mobileTab === 'subtasks' ? 'cases' : mobileTab}
                onValueChange={(v) => setMobileTab(v as any)}
                items={[
                  { value: 'files', label: '文件' },
                  { value: 'cases', label: '用例' },
                ]}
              />
              <div className="mt-3 min-h-0 flex-1">
                {mobileTab === 'files'
                  ? <FilesColumn files={files} usedInPairs={usedInPairs} problemUrl={problemUrl} addCase={addCase} onOpenFile={setEditingFile} />
                  : <CasesColumn config={config} fileSet={fileSet} addCase={addCase} removeCase={removeCase} updateCase={updateCase}
                      addSubtaskFromCases={() => {}} autoPairAll={() => {
                        const result = autoPair(fileNames);
                        updateConfig((cfg) => ({ ...cfg, cases: result.pairs, subtasks: undefined }));
                      }} />
                }
              </div>
            </div>
            <SubtasksColumn config={config} updateSubtask={updateSubtask} removeSubtask={removeSubtask} addSubtask={addSubtask} removeCase={removeCase} updateCase={updateCase} />
          </div>
        )}

            {/* DragOverlay */}
            <DragOverlay>
              {draggedItem ? <DragPreview item={draggedItem} /> : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {/* File edit dialog */}
      {editingFile ? (
        <FileEditDialog
          file={editingFile}
          problemUrl={problemUrl}
          onClose={() => setEditingFile(null)}
        />
      ) : null}
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  File edit dialog — opens an in-page YAML / cpp / py editor on the */
/*  selected testdata file. Reuses KryptonIDE in simple mode so the    */
/*  editor surface is identical to the submit IDE without any of the   */
/*  submit / pretest / records chrome.                                  */
/* ────────────────────────────────────────────────────────────────── */

/** Map filename extension → KryptonIDE language hint for highlighting. */
function detectLanguage(filename: string): string {
  const m = filename.toLowerCase().match(/\.([^.]+)$/);
  if (!m) return 'txt';
  const ext = m[1];
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'json') return 'json';
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'h' || ext === 'hpp' || ext === 'c') return 'cc.cc17';
  if (ext === 'py') return 'py';
  if (ext === 'java') return 'java';
  if (ext === 'go') return 'go';
  if (ext === 'rs') return 'rs';
  if (ext === 'js' || ext === 'mjs' || ext === 'ts') return 'js';
  return 'txt';
}

/** Bytes → human-readable like `12 KB`. */
function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const MAX_FILE_EDIT_BYTES = 1 * 1024 * 1024; // 1 MB cap — heavy testdata stays read-only via raw URL

function FileEditDialog({ file, problemUrl, onClose }: {
  file: R;
  problemUrl: string;
  onClose: () => void;
}) {
  const filename: string = file.name;
  const size: number = file.size ?? 0;
  const tooBig = size > MAX_FILE_EDIT_BYTES;
  const lang = useMemo(() => detectLanguage(filename), [filename]);
  const fileUrl = useMemo(
    () => `${problemUrl}/file/${encodeURIComponent(filename)}?type=testdata&noDisposition=1`,
    [problemUrl, filename],
  );
  const [content, setContent] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [readonly, setReadonly] = useState(tooBig);

  // Load file content on open
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setContent(null);
    if (tooBig) {
      setLoadError(`文件过大 (${bytesLabel(size)})，请下载后用本地编辑器修改。`);
      return;
    }
    fetch(fileUrl, {
      headers: { Accept: 'text/plain' },
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((txt) => {
        if (cancelled) return;
        setContent(txt);
        setOriginalContent(txt);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e?.message || '加载失败');
      });
    return () => { cancelled = true; };
  }, [fileUrl, size, tooBig]);

  const dirty = content != null && content !== originalContent;

  const handleSave = useCallback(async () => {
    if (content == null) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const form = new FormData();
      form.append('operation', 'upload_file');
      form.append('type', 'testdata');
      form.append('filename', filename);
      form.append('file', new Blob([content], { type: 'text/plain' }), filename);
      const res = await fetch(`${problemUrl}/files`, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
      });
      if (res.ok || res.redirected) {
        setOriginalContent(content);
        setSaveMsg('已保存');
        setTimeout(() => setSaveMsg(null), 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveMsg(data?.error || `保存失败 (${res.status})`);
      }
    } catch (e: any) {
      setSaveMsg(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [content, filename, problemUrl]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="h-[88vh] w-[92vw] max-w-none max-h-[92vh]"
        onClose={onClose}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="size-4" />
            <span className="font-mono">{filename}</span>
            <Badge variant="outline" className="text-[10px]">{bytesLabel(size)}</Badge>
            <Badge variant="secondary" className="text-[10px]">{lang.toUpperCase()}</Badge>
            {dirty ? <Badge variant="default" className="text-[10px]">未保存</Badge> : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          {loadError ? (
            <div className="rounded border border-amber-300 bg-amber-50/40 p-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              {loadError}
              <div className="mt-2">
                <Button asChild variant="outline" size="sm">
                  <a href={fileUrl} download={filename}>
                    <Download className="size-3.5 mr-1" />下载文件
                  </a>
                </Button>
              </div>
            </div>
          ) : content == null ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">加载中…</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
              <KryptonIDE
                mode={readonly ? 'readonly' : 'simple'}
                langs={[]}
                defaultLang={lang}
                value={content}
                onValueChange={setContent}
                minHeight={420}
                className="h-full"
              />
            </div>
          )}

          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!tooBig && content != null ? (
                <label className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={readonly}
                    onChange={() => setReadonly(!readonly)}
                  />
                  只读
                </label>
              ) : null}
              {saveMsg ? <span className="text-foreground">{saveMsg}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>关闭</Button>
              <Button
                onClick={handleSave}
                disabled={!dirty || saving || readonly || tooBig}
              >
                <Save className="size-3.5 mr-1" />
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Basic config strip                                                */
/* ────────────────────────────────────────────────────────────────── */

function BasicConfigStrip({ config, updateConfig, files }: { config: JudgeConfig; updateConfig: (m: (c: JudgeConfig) => JudgeConfig) => void; files: R[] }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
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
            <DurationInput
              value={config.time}
              onChange={(v) => updateConfig((c) => ({ ...c, time: v }))}
              placeholder="默认 1"
              size="md"
            />
          </Field>
          <Field label="内存限制">
            <MemoryInput
              value={config.memory}
              onChange={(v) => updateConfig((c) => ({ ...c, memory: v }))}
              placeholder="默认 256"
              size="md"
            />
          </Field>
          {/* Global score mode only applies when there are NO subtasks —
              each subtask carries its own `type`. Hiding it under that
              condition removes a confusing always-visible global switch. */}
          {!(config.subtasks && config.subtasks.length > 0) ? (
            <Field label="扁平算分模式">
              <SimpleSelect
                value={config.score || ''}
                onValueChange={(v) => updateConfig((c) => ({ ...c, score: (v || undefined) as any }))}
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
              onValueChange={(v) => updateConfig((c) => ({
                ...c,
                checker_type: v as CheckerType,
                // Preserve the file path when switching among checker-types
                // that need a file (lemon/syzoj/testlib/custom), drop it
                // when going back to a fileless type.
                checker: CHECKER_TYPES_NEEDING_FILE.includes(v as CheckerType) ? c.checker : undefined,
              }))}
              size="sm"
              options={CHECKER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
        </div>

        {/* Conditional fields per checker / type */}
        {(config.checker_type === 'float'
          || (config.checker_type && CHECKER_TYPES_NEEDING_FILE.includes(config.checker_type as CheckerType))
          || config.type === 'interactive'
          || config.type === 'communication'
          || config.type === 'submit_answer'
          || showAdvanced) ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-2 border-t">
            {config.checker_type === 'float' ? (
              <>
                <Field label="相对误差">
                  <Input type="number" step="any" value={config.float_relative ?? ''} placeholder="1e-6"
                    onChange={(e) => updateConfig((c) => ({ ...c, float_relative: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} />
                </Field>
                <Field label="绝对误差">
                  <Input type="number" step="any" value={config.float_absolute ?? ''} placeholder="1e-6"
                    onChange={(e) => updateConfig((c) => ({ ...c, float_absolute: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} />
                </Field>
              </>
            ) : null}
            {config.checker_type && CHECKER_TYPES_NEEDING_FILE.includes(config.checker_type as CheckerType) ? (
              <Field
                label="Checker 文件"
                hint="先在「测试数据」面板上传 checker 源码（如 .cc/.cpp），这里选中即可"
              >
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
                <Input value={config.filename || ''} placeholder="#1.in" onChange={(e) => updateConfig((c) => ({ ...c, filename: e.target.value || undefined }))} />
              </Field>
            ) : null}
            {showAdvanced ? (
              <Field label="允许语言">
                <MultiSelect<LangOption>
                  options={PRESET_LANG_OPTIONS}
                  value={resolveLangs(config.langs || [])}
                  onChange={(next) => updateConfig((c) => ({
                    ...c,
                    langs: next.length ? next.map((o) => o.value) : undefined,
                  }))}
                  getKey={(o) => o.value}
                  getLabel={(o) => `${o.label} (${o.value})`}
                  renderChip={(o) => <span className="font-mono">{o.label}</span>}
                  renderOption={(o, { selected }) => (
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{o.label}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{o.value}</span>
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
        {showAdvanced ? (
          <PerLangLimits config={config} updateConfig={updateConfig} />
        ) : null}

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? '收起高级' : '高级（语言限制 / 语言时空 / 其他）'}
        </button>
      </CardContent>
    </Card>
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
function PerLangLimits({ config, updateConfig }: {
  config: JudgeConfig;
  updateConfig: (m: (c: JudgeConfig) => JudgeConfig) => void;
}) {
  const baseTimeMs = parseTimeMS(config.time);
  const baseMemMb = parseMemoryMB(config.memory);
  const hasTimeBase = baseTimeMs != null;
  const hasMemoryBase = baseMemMb != null;
  const canAddLanguageLimit = hasTimeBase || hasMemoryBase;

  // Union of langs that have any rate set
  const langKeys = Array.from(new Set([
    ...Object.keys(config.time_limit_rate || {}),
    ...Object.keys(config.memory_limit_rate || {}),
  ]));
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
    <div className="rounded-md border bg-muted/10 p-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium">按语言时空限制</p>
          <p className="text-[10px] text-muted-foreground">
            基准 {baseTimeMs ? formatTime(baseTimeMs) : '未设'} / {baseMemMb ? formatMemory(baseMemMb) : '未设'}；填入实际限制，保存时自动换算为倍率
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <SimpleSelect
              value=""
              onValueChange={(v) => { if (v) addLang(v); }}
              size="sm"
              disabled={!canAddLanguageLimit}
              className="w-auto min-w-[10rem] text-[11px]"
              placeholder={canAddLanguageLimit ? '+ 添加语言…' : '先填写默认限制'}
              ariaLabel="添加语言时空限制"
              options={COMMON_LANG_OPTIONS
                .filter((o) => !langKeys.includes(o.value))
                .map((o) => ({ value: o.value, label: o.label }))}
            />
            <input
              value={pendingLang}
              onChange={(e) => setPendingLang(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLang(pendingLang); } }}
              placeholder="或自定义 id"
              disabled={!canAddLanguageLimit}
              title={canAddLanguageLimit ? undefined : '先填写上方默认时间限制或默认内存限制'}
              className="w-28 rounded border bg-background px-1.5 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          {!canAddLanguageLimit ? (
            <p className="text-[10px] text-amber-700 dark:text-amber-300">
              先填写上方默认时间限制或默认内存限制后，才能添加语言覆写。
            </p>
          ) : null}
        </div>
      </div>

      {!canAddLanguageLimit ? (
        <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>语言限制保存的是“相对默认限制的倍率”。当前没有默认时空基准，所以下拉框会保持禁用。</span>
        </div>
      ) : null}

      {langKeys.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-muted-foreground">尚未为任何语言设置覆写</p>
      ) : (
        <div className="space-y-1.5">
          {/* Header */}
          <div className="grid grid-cols-[1fr_minmax(0,140px)_minmax(0,140px)_24px] gap-2 text-[10px] text-muted-foreground">
            <span>语言</span>
            <span>时间</span>
            <span>内存</span>
            <span />
          </div>
          {langKeys.map((id) => {
            const tr = config.time_limit_rate?.[id];
            const mr = config.memory_limit_rate?.[id];
            const langTimeAbs = baseTimeMs && typeof tr === 'number'
              ? formatTime(baseTimeMs * tr) : '';
            const langMemAbs = baseMemMb && typeof mr === 'number'
              ? formatMemory(baseMemMb * mr) : '';
            const label = COMMON_LANG_OPTIONS.find((o) => o.value === id)?.label || id;
            return (
              <div key={id} className="grid grid-cols-[1fr_minmax(0,140px)_minmax(0,140px)_24px] items-center gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate" title={id}>{label}</p>
                  {label !== id ? <p className="font-mono text-[9px] text-muted-foreground truncate">{id}</p> : null}
                </div>
                <DurationInput
                  value={langTimeAbs}
                  onChange={(v) => updateLangTime(id, v)}
                  placeholder={baseTimeMs ? formatTime(baseTimeMs) : '未设基准'}
                  disabled={!hasTimeBase}
                />
                <MemoryInput
                  value={langMemAbs}
                  onChange={(v) => updateLangMemory(id, v)}
                  placeholder={baseMemMb ? formatMemory(baseMemMb) : '未设基准'}
                  disabled={!hasMemoryBase}
                />
                <button
                  type="button"
                  onClick={() => removeLang(id)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="移除"
                >
                  <X className="size-3" />
                </button>
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
    <label className="block space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function FilePicker({ value, files, onChange }: { value: string; files: R[]; onChange: (v: string) => void }) {
  return (
    <SimpleSelect
      value={value}
      onValueChange={onChange}
      size="sm"
      placeholder="— 选择文件 —"
      options={[
        { value: '', label: '— 选择文件 —' },
        ...files.map((f) => ({ value: f.name, label: f.name })),
      ]}
    />
  );
}

/**
 * Number-plus-unit picker for a Hydro time string ("2s" / "1500ms").
 * Empty value renders the placeholder (e.g. "默认 1s"). Output is `undefined`
 * when value is cleared, so the config object drops the override entirely.
 */
function DurationInput({ value, onChange, placeholder, className, size = 'sm', disabled }: {
  value?: string;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const split = splitTime(value);
  const inputCls = size === 'sm' ? 'h-7 text-[11px] px-1.5' : 'h-8 text-xs px-2';
  return (
    <div className={`flex items-center gap-1 ${className || ''}`}>
      <input
        type="number"
        step="any"
        min={0}
        value={split.value}
        onChange={(e) => onChange(joinTime(e.target.value, split.unit))}
        placeholder={placeholder}
        disabled={disabled}
        className={`flex-1 min-w-0 rounded border bg-background tabular-nums disabled:cursor-not-allowed disabled:opacity-60 ${inputCls}`}
      />
      <SimpleSelect
        value={split.unit}
        onValueChange={(v) => onChange(joinTime(split.value, v as 'ms' | 's'))}
        size="sm"
        disabled={disabled}
        className={`w-auto min-w-[4rem] ${inputCls}`}
        options={[
          { value: 'ms', label: 'ms' },
          { value: 's', label: 's' },
        ]}
      />
    </div>
  );
}

/** Number-plus-unit picker for a Hydro memory string ("256m" / "1g" / "512k"). */
function MemoryInput({ value, onChange, placeholder, className, size = 'sm', disabled }: {
  value?: string;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const split = splitMemory(value);
  const inputCls = size === 'sm' ? 'h-7 text-[11px] px-1.5' : 'h-8 text-xs px-2';
  return (
    <div className={`flex items-center gap-1 ${className || ''}`}>
      <input
        type="number"
        step="any"
        min={0}
        value={split.value}
        onChange={(e) => onChange(joinMemory(e.target.value, split.unit))}
        placeholder={placeholder}
        disabled={disabled}
        className={`flex-1 min-w-0 rounded border bg-background tabular-nums disabled:cursor-not-allowed disabled:opacity-60 ${inputCls}`}
      />
      <SimpleSelect
        value={split.unit}
        onValueChange={(v) => onChange(joinMemory(split.value, v as 'k' | 'm' | 'g'))}
        size="sm"
        disabled={disabled}
        className={`w-auto min-w-[4rem] ${inputCls}`}
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
    <Card className={errors.length ? 'border-destructive/40' : 'border-amber-300 dark:border-amber-900/50'}>
      <CardContent className="p-3 space-y-1.5">
        {errors.map((i, idx) => (
          <div key={`e${idx}`} className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <span>{i.message}{i.subtaskId != null ? ` (subtask #${i.subtaskId})` : ''}</span>
          </div>
        ))}
        {warnings.map((i, idx) => (
          <div key={`w${idx}`} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <span>{i.message}{i.subtaskId != null ? ` (subtask #${i.subtaskId})` : ''}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Column 1 — Files                                                  */
/* ────────────────────────────────────────────────────────────────── */

function FilesColumn({ files, usedInPairs, problemUrl, addCase, onOpenFile }: {
  files: R[];
  usedInPairs: Set<string>;
  problemUrl: string;
  addCase: (c: JudgeCase) => void;
  onOpenFile: (file: R) => void;
}) {
  const [filter, setFilter] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  // Hide files already referenced by some case — keeps the pool focused on
  // "what still needs assigning". To move a file between cases, drag it
  // straight in the Cases column instead.
  const visibleFiles = useMemo(() => files.filter((f) => !usedInPairs.has(f.name)), [files, usedInPairs]);
  const filtered = useMemo(() => filter
    ? visibleFiles.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
    : visibleFiles
  , [visibleFiles, filter]);

  const stats = useMemo(() => {
    let inputs = 0, outputs = 0, other = 0;
    for (const f of files) {
      const cls = classify(f.name);
      if (cls.kind === 'input') inputs++;
      else if (cls.kind === 'output') outputs++;
      else other++;
    }
    return { inputs, outputs, other, unused: files.length - usedInPairs.size };
  }, [files, usedInPairs]);

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-1.5">
            <FolderOpen className="size-4" />
            文件池
          </CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="size-3 mr-1" />
            上传
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[10px]">
          <Stat label="输入" value={stats.inputs} color="text-blue-500" />
          <Stat label="输出" value={stats.outputs} color="text-purple-500" />
          <Stat label="其他" value={stats.other} color="text-muted-foreground" />
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="搜索文件…"
          className="text-xs h-8"
        />
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full" viewportClassName="p-2 pt-0">
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {files.length === 0 ? '暂无文件，先上传一些' : usedInPairs.size === files.length ? '所有文件已分配' : '无匹配文件'}
          </p>
        ) : (
          <div className="space-y-1">
            {filtered.map((f) => (
              <FileRow
                key={f.name}
                f={f}
                onOpen={() => onOpenFile(f)}
              />
            ))}
          </div>
        )}
        </ScrollArea>
      </CardContent>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="w-full max-w-xl" onClose={() => setUploadOpen(false)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="size-4" />
              上传测试数据
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <FileUploader
              endpoint={`${problemUrl}/files`}
              fieldName="file"
              meta={{ type: 'testdata' }}
              maxFileSize={256 * 1024 * 1024}
              maxFiles={200}
              onBatchComplete={() => {
                // Refresh so the new files appear in the pool
                setTimeout(() => window.location.reload(), 600);
              }}
            />
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setUploadOpen(false)}>关闭</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FileRow({ f, onOpen }: { f: R; onOpen?: () => void }) {
  const cls = classify(f.name);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `file:${f.name}`,
    data: { kind: 'file', name: f.name, cls: cls.kind } satisfies DraggedItem,
  });
  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-1 rounded border text-xs transition-all ${isDragging ? 'opacity-30' : 'hover:border-primary/40 hover:bg-accent/30'}`}
    >
      {/* Drag handle — ONLY this small grip area triggers drag. */}
      <span
        {...attributes}
        {...listeners}
        title="拖动以分配"
        className="flex items-center justify-center px-1 py-1.5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
      >
        <GripVertical className="size-3.5" />
      </span>
      <FileTypeBadge cls={cls.kind} />
      {/* Click body opens the file editor; not draggable. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 px-1 py-1.5 text-left font-mono truncate hover:text-primary"
        title="点击编辑文件"
      >
        {f.name}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 text-muted-foreground hover:text-foreground"
        title="编辑文件"
      >
        <FileEdit className="size-3.5" />
      </button>
    </div>
  );
}

function FileTypeBadge({ cls }: { cls: 'input' | 'output' | 'other' }) {
  if (cls === 'input') return <span className="size-1.5 rounded-full bg-blue-500" />;
  if (cls === 'output') return <span className="size-1.5 rounded-full bg-purple-500" />;
  return <span className="size-1.5 rounded-full bg-muted-foreground/30" />;
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded border bg-muted/20 p-1 text-center">
      <p className={`font-mono font-semibold ${color}`}>{value}</p>
      <p className="text-muted-foreground">{label}</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Column 2 — Cases (flat pool when no subtasks)                     */
/* ────────────────────────────────────────────────────────────────── */

function CasesColumn({ config, fileSet, addCase, removeCase, updateCase, addSubtaskFromCases, autoPairAll }: {
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
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  };

  const selectedCases = useMemo(() => [...selected].map((i) => flatCases[i]).filter(Boolean), [selected, flatCases]);

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-1.5">
            <Link2 className="size-4" />
            测试用例 {hasSubtasks ? '(已分组)' : `(${flatCases.length})`}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={autoPairAll} title="按命名自动配对所有文件">
              自动配对
            </Button>
            <Button size="sm" variant="outline" onClick={() => addCase({ input: '', output: '' })}>
              <Plus className="size-3 mr-1" />
              空对
            </Button>
          </div>
        </div>
        {selected.size > 0 ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{selected.size} 已选</span>
            <Button size="sm" variant="outline" onClick={() => {
              addSubtaskFromCases(selectedCases);
              setSelected(new Set());
            }}>
              建为测试点
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清除</Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent
        className={`min-h-0 flex-1 p-0 transition-colors ${isOver ? 'bg-primary/5 border-primary' : ''}`}
      >
        <ScrollArea viewportRef={dropRef} className="h-full" viewportClassName="p-2 space-y-1.5">
        {/* Header note when in subtask mode — but we STILL render flat cases below if any,
            so that cases dragged back from a subtask don't vanish into thin air. */}
        {hasSubtasks ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-[11px] text-muted-foreground">
            已使用 Subtask 分组。拖文件到右侧测试点；从测试点拖回的用例会暂存在下方"未分组"区。
          </div>
        ) : null}
        {!hasSubtasks && flatCases.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-xs text-muted-foreground">
            把文件从左侧拖到此处自动配对。
            <br />
            或点击「自动配对」一键完成。
          </div>
        ) : null}
        {flatCases.length > 0 ? (
          <>
            {hasSubtasks ? (
              <p className="px-1 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                未分组（{flatCases.length}）
              </p>
            ) : null}
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
      </CardContent>
    </Card>
  );
}

function CaseRow({ c, idx, fileSet, selected, onToggleSelect, onRemove, onUpdate, stid }: {
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
      className={`rounded border bg-card text-xs transition-all ${isDragging ? 'opacity-30' : ''} ${selected ? 'border-primary' : ''}`}
    >
      <div className="flex items-center gap-1 p-1.5">
        {onToggleSelect ? (
          <Checkbox checked={selected} onChange={onToggleSelect} />
        ) : null}
        {/* Dedicated drag handle — only this grip triggers drag, so the input fields stay typeable. */}
        <span
          {...attributes}
          {...listeners}
          className="flex items-center cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground shrink-0"
          title="拖动用例"
        >
          <GripVertical className="size-3.5" />
        </span>
        <span className="font-mono text-[10px] text-muted-foreground w-5 shrink-0 text-center">#{idx + 1}</span>
        <div className="flex-1 grid grid-cols-2 gap-1">
          <div
            ref={dropInputRef}
            className={`flex items-center gap-1 rounded border px-1.5 py-1 ${overInput ? 'border-primary bg-primary/5' : inputMissing ? 'border-destructive/40 bg-destructive/5' : 'border-border'}`}
          >
            <span className="size-1.5 rounded-full bg-blue-500 shrink-0" />
            <input
              value={c.input}
              onChange={(e) => onUpdate({ input: e.target.value })}
              placeholder="input"
              className="bg-transparent text-[11px] font-mono outline-none flex-1 min-w-0"
            />
          </div>
          <div
            ref={dropOutputRef}
            className={`flex items-center gap-1 rounded border px-1.5 py-1 ${overOutput ? 'border-primary bg-primary/5' : outputMissing ? 'border-destructive/40 bg-destructive/5' : 'border-border'}`}
          >
            <span className="size-1.5 rounded-full bg-purple-500 shrink-0" />
            <input
              value={c.output}
              onChange={(e) => onUpdate({ output: e.target.value })}
              placeholder="output"
              className="bg-transparent text-[11px] font-mono outline-none flex-1 min-w-0"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="高级"
        >
          <Settings className="size-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-3" />
        </button>
      </div>
      {expanded ? (
        <div className="grid grid-cols-2 gap-2 border-t bg-muted/20 p-1.5">
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">时间覆写</span>
            <DurationInput
              value={c.time}
              onChange={(v) => onUpdate({ time: v })}
              placeholder="留空 = 默认"
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">内存覆写</span>
            <MemoryInput
              value={c.memory}
              onChange={(v) => onUpdate({ memory: v })}
              placeholder="留空 = 默认"
            />
          </label>
          <label className="col-span-2 space-y-0.5">
            <span className="text-[10px] text-muted-foreground">测试点提示（PTA 风格，显示在评测详情该测试点旁）</span>
            <textarea
              value={c.hint || ''}
              onChange={(e) => onUpdate({ hint: e.target.value || undefined })}
              placeholder="留空 = 无提示"
              rows={2}
              className="w-full resize-y rounded border bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-primary"
            />
          </label>
          <label className="col-span-2 flex items-center gap-1.5">
            <Checkbox checked={!!c.hintPublic} onChange={() => onUpdate({ hintPublic: !c.hintPublic })} />
            <span className="text-[10px] text-muted-foreground">对外公开（题库/训练显示；比赛进行中自动隐藏，赛后恢复）</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Column 3 — Subtasks                                               */
/* ────────────────────────────────────────────────────────────────── */

function SubtasksColumn({ config, updateSubtask, removeSubtask, addSubtask, removeCase, updateCase }: {
  config: JudgeConfig;
  updateSubtask: (stid: number, patch: Partial<JudgeSubtask>) => void;
  removeSubtask: (stid: number) => void;
  addSubtask: () => void;
  removeCase: (idx: number, stid?: number) => void;
  updateCase: (idx: number, patch: Partial<JudgeCase>, stid?: number) => void;
}) {
  const subtasks = config.subtasks || [];
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-1.5">
            <Grid3X3 className="size-4" />
            测试点 ({subtasks.length})
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={addSubtask}>
              <Plus className="size-3 mr-1" />
              新建
            </Button>
          </div>
        </div>
        {subtasks.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            总分 {subtasks.reduce((n, s) => n + (s.score || 0), 0)} 分
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 p-0">
        <ScrollArea className="h-full" viewportClassName="p-2 space-y-2">
        {/* SVG layer for dep lines */}
        {subtasks.length > 0 ? <SubtaskDepLines subtasks={subtasks} /> : null}
        {subtasks.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-xs text-muted-foreground">
            <p className="mb-2">还没有测试点</p>
            <Button size="sm" variant="outline" onClick={addSubtask}>
              <Plus className="size-3 mr-1" />
              新建第一个测试点
            </Button>
          </div>
        ) : (
          subtasks.map((s) => (
            <SubtaskCard
              key={s.id}
              subtask={s}
              allIds={subtasks.map((x) => x.id!).filter((id) => id !== s.id)}
              onUpdate={(patch) => updateSubtask(s.id!, patch)}
              onRemove={() => removeSubtask(s.id!)}
              onUpdateCase={(idx, patch) => updateCase(idx, patch, s.id)}
              onRemoveCase={(idx) => removeCase(idx, s.id)}
            />
          ))
        )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function SubtaskDepLines({ subtasks }: { subtasks: JudgeSubtask[] }) {
  // SVG drawn absolutely on top of the column. For each subtask with `if`,
  // draw a line from the right edge of the dependency to the left edge of
  // this card. The actual coords are unknown until paint; we use data-*
  // selectors and resize observers in a separate component if needed.
  // For a pragmatic v1: just render a small chip label on each card.
  return null;
}

function SubtaskCard({ subtask, allIds, onUpdate, onRemove, onUpdateCase, onRemoveCase }: {
  subtask: JudgeSubtask;
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
    <div
      ref={setNodeRef}
      className={`rounded-md border bg-card transition-all ${isOver ? 'border-primary bg-primary/5' : ''}`}
    >
      <div className="flex items-center gap-2 border-b bg-muted/30 p-2">
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="text-muted-foreground hover:text-foreground">
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <span className="font-mono text-[10px] text-muted-foreground">#{subtask.id}</span>
        <span className="font-medium text-sm flex-1">Subtask {subtask.id}</span>
        <Input
          type="number"
          value={subtask.score ?? ''}
          onChange={(e) => onUpdate({ score: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
          placeholder="分数"
          className="w-16 text-xs h-7"
        />
        <SimpleSelect
          value={subtask.type || 'min'}
          onValueChange={(v) => onUpdate({ type: v as any })}
          size="sm"
          className="w-auto min-w-[5rem] text-[11px]"
          options={[
            { value: 'min', label: 'min' },
            { value: 'sum', label: 'sum' },
            { value: 'max', label: 'max' },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowDepPicker(!showDepPicker)}
          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground border"
          title="依赖"
        >
          if: [{(subtask.if || []).join(', ') || '—'}]
        </button>
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {showDepPicker ? (
        <div className="border-b bg-muted/10 p-2">
          <p className="mb-1 text-[10px] text-muted-foreground">依赖测试点（必须先通过）：</p>
          <div className="flex flex-wrap gap-1">
            {allIds.length === 0 ? <span className="text-[11px] text-muted-foreground">没有其它测试点</span> :
              allIds.map((id) => {
                const enabled = (subtask.if || []).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      const ifs = subtask.if || [];
                      onUpdate({ if: enabled ? ifs.filter((x) => x !== id) : [...ifs, id] });
                    }}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                  >
                    #{id}
                  </button>
                );
              })}
          </div>
        </div>
      ) : null}

      {!collapsed ? (
        <div className="p-1.5 space-y-1">
          {subtask.cases.length === 0 ? (
            <p className="rounded border border-dashed p-3 text-center text-[11px] text-muted-foreground">
              拖测试用例到这里
            </p>
          ) : (
            subtask.cases.map((c, i) => (
              <CaseRow
                key={i}
                c={c}
                idx={i}
                fileSet={new Set()}
                stid={subtask.id}
                onRemove={() => onRemoveCase(i)}
                onUpdate={(patch) => onUpdateCase(i, patch)}
              />
            ))
          )}
          {/* Subtask-level overrides — apply to every case in this subtask
              unless the case sets its own. */}
          <div className="mt-1 grid grid-cols-2 gap-2 border-t pt-1.5">
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">组级时间覆写</span>
              <DurationInput
                value={subtask.time}
                onChange={(v) => onUpdate({ time: v })}
                placeholder="留空 = 默认"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted-foreground">组级内存覆写</span>
              <MemoryInput
                value={subtask.memory}
                onChange={(v) => onUpdate({ memory: v })}
                placeholder="留空 = 默认"
              />
            </label>
          </div>
        </div>
      ) : (
        <div className="p-1.5 text-[11px] text-muted-foreground">
          {subtask.cases.length} 用例
        </div>
      )}
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
        const c: JudgeCase = active.cls === 'input'
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
        const updateInList = (list: JudgeCase[]) => list.map((c, i) =>
          i === over.idx ? { ...c, [target]: active.name } : c
        );
        if (over.stid != null && cfg.subtasks) {
          return {
            ...cfg,
            subtasks: cfg.subtasks.map((s) => s.id === over.stid ? { ...s, cases: updateInList(s.cases) } : s),
          };
        }
        return { ...cfg, cases: updateInList(cfg.cases || []) };
      });
      return;
    }
    // File dropped on subtask: create new case in subtask
    if (over.kind === 'subtask') {
      updateConfig((cfg) => {
        const c: JudgeCase = active.cls === 'output'
          ? { input: '', output: active.name }
          : { input: active.name, output: '' };
        return {
          ...cfg,
          subtasks: (cfg.subtasks || []).map((s) => s.id === over.stid ? { ...s, cases: [...s.cases, c] } : s),
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
            subtasks: (newConfig.subtasks || []).map((s) => s.id === active.fromStid ? { ...s, cases: s.cases.filter((_, i) => i !== active.fromIdx) } : s),
          };
        } else {
          newConfig = { ...newConfig, cases: (newConfig.cases || []).filter((_, i) => i !== active.fromIdx) };
        }
        // Add to target
        newConfig = {
          ...newConfig,
          subtasks: (newConfig.subtasks || []).map((s) => s.id === over.stid ? { ...s, cases: [...s.cases, active.case] } : s),
        };
        return newConfig;
      });
      return;
    }
    // Case dropped back to pool: move out of subtask
    if (over.kind === 'case-pool' && active.fromStid != null) {
      updateConfig((cfg) => {
        const newSubs = (cfg.subtasks || []).map((s) => s.id === active.fromStid ? { ...s, cases: s.cases.filter((_, i) => i !== active.fromIdx) } : s);
        return { ...cfg, cases: [...(cfg.cases || []), active.case], subtasks: newSubs };
      });
      return;
    }
  }
}

function DragPreview({ item }: { item: DraggedItem }) {
  if (item.kind === 'file') {
    return (
      <div className="rounded border bg-card px-2 py-1 text-xs shadow-lg flex items-center gap-1.5">
        <FileTypeBadge cls={item.cls} />
        <span className="font-mono">{item.name}</span>
      </div>
    );
  }
  return (
    <div className="rounded border bg-card px-2 py-1 text-xs shadow-lg flex items-center gap-2">
      <span className="size-1.5 rounded-full bg-blue-500" />
      <span className="font-mono">{item.case.input || '—'}</span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <span className="size-1.5 rounded-full bg-purple-500" />
      <span className="font-mono">{item.case.output || '—'}</span>
    </div>
  );
}
