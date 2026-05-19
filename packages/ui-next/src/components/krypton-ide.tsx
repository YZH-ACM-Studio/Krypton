/**
 * KryptonIDE — Full-featured code editor built on CodeMirror 6.
 *
 * Features:
 *  - Syntax highlighting for C/C++, Python, Java, JavaScript, Go, Rust
 *  - Language selector with per-problem filtering
 *  - Submit (F10) and Run/Pretest (F9) with inline fetch
 *  - Collapsible pretest input panel
 *  - Pretest result dialog
 *  - Settings dialog (left-right category split)
 *  - Code caching to localStorage
 *  - Fullscreen toggle
 *  - Configurable font size, tab size, word wrap, theme
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';

import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';

import { oneDark } from '@codemirror/theme-one-dark';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ClipboardCopy,
  FileUp,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { SampleCase } from '@/lib/samples';

/* ================================================================== */
/*  Language registry                                                  */
/* ================================================================== */

interface LangEntry {
  label: string;
  extension: () => Extension;
}

const LANGUAGES: Record<string, LangEntry> = {
  'cc.cc20': { label: 'C++20', extension: cpp },
  'cc.cc17': { label: 'C++17', extension: cpp },
  'cc.cc14': { label: 'C++14', extension: cpp },
  'cc.cc11': { label: 'C++11', extension: cpp },
  cc: { label: 'C++', extension: cpp },
  c: { label: 'C', extension: cpp },
  py3: { label: 'Python 3', extension: python },
  py: { label: 'Python', extension: python },
  java: { label: 'Java', extension: java },
  js: { label: 'JavaScript', extension: javascript },
  go: { label: 'Go', extension: go },
  rs: { label: 'Rust', extension: rust },
  pas: { label: 'Pascal', extension: () => [] },
  rb: { label: 'Ruby', extension: () => [] },
  cs: { label: 'C#', extension: () => [] },
  hs: { label: 'Haskell', extension: () => [] },
  php: { label: 'PHP', extension: () => [] },
  kt: { label: 'Kotlin', extension: () => [] },
};

export function getLangEntry(id: string): LangEntry {
  return LANGUAGES[id] || { label: id, extension: () => [] };
}

/* ================================================================== */
/*  Themes                                                             */
/* ================================================================== */

type ThemeName = 'light' | 'dark' | 'oneDark';

/** Background colour per theme — used for the editor container too. */
const THEME_BG: Record<ThemeName, string> = {
  light: '#ffffff',
  dark: '#1e1e2e',
  oneDark: '#282c34',
};

function themeExtension(name: ThemeName): Extension {
  if (name === 'oneDark') return oneDark;
  if (name === 'dark') {
    return EditorView.theme(
      {
        '&': { backgroundColor: '#1e1e2e', color: '#cdd6f4' },
        '.cm-gutters': { backgroundColor: '#181825', color: '#6c7086', borderRight: '1px solid #313244' },
        '.cm-activeLineGutter': { backgroundColor: '#313244' },
        '.cm-activeLine': { backgroundColor: '#31324420' },
        '&.cm-focused .cm-cursor': { borderLeftColor: '#89b4fa' },
        '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#45475a' },
        '.cm-selectionBackground': { backgroundColor: '#45475a' },
      },
      { dark: true },
    );
  }
  return EditorView.theme({
    '&': { backgroundColor: '#ffffff', color: '#1e293b' },
    '.cm-gutters': { backgroundColor: '#f8fafc', color: '#94a3b8', borderRight: '1px solid #e2e8f0' },
    '.cm-activeLineGutter': { backgroundColor: '#f1f5f9' },
    '.cm-activeLine': { backgroundColor: '#f1f5f910' },
  });
}

/* ================================================================== */
/*  IDE config persistence                                             */
/* ================================================================== */

interface IdeConfig {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  theme: ThemeName;
  fontFamily: string;
}

const IDE_CONFIG_KEY = 'krypton:ide-config';
const LANG_KEY = 'krypton:ide-lang';

const DEFAULT_CONFIG: IdeConfig = {
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
  theme: 'oneDark',
  fontFamily: 'JetBrains Mono',
};

function loadConfig(): IdeConfig {
  try {
    const raw = localStorage.getItem(IDE_CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* empty */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(c: IdeConfig) {
  try { localStorage.setItem(IDE_CONFIG_KEY, JSON.stringify(c)); } catch { /* empty */ }
}

/* ================================================================== */
/*  Status helpers                                                     */
/* ================================================================== */

interface StatusDisplay { label: string; className: string }

const STATUS_MAP: Record<number, StatusDisplay> = {
  0: { label: '等待中', className: 'text-muted-foreground' },
  1: { label: '通过 (Accepted)', className: 'text-green-500' },
  2: { label: '答案错误 (Wrong Answer)', className: 'text-red-500' },
  3: { label: '时间超限 (TLE)', className: 'text-red-500' },
  4: { label: '内存超限 (MLE)', className: 'text-red-500' },
  5: { label: '输出超限 (OLE)', className: 'text-red-500' },
  6: { label: '运行错误 (RE)', className: 'text-red-500' },
  7: { label: '编译错误 (CE)', className: 'text-yellow-500' },
  8: { label: '系统错误 (SE)', className: 'text-yellow-500' },
  9: { label: '已取消', className: 'text-muted-foreground' },
  10: { label: '未知错误', className: 'text-red-500' },
  11: { label: 'Hacked', className: 'text-red-500' },
  20: { label: '评测中…', className: 'text-blue-500' },
  21: { label: '编译中…', className: 'text-blue-500' },
  22: { label: '等待中…', className: 'text-muted-foreground' },
  30: { label: '格式错误', className: 'text-red-500' },
};

export function getStatus(s: number): StatusDisplay {
  return STATUS_MAP[s] || { label: `Status ${s}`, className: 'text-muted-foreground' };
}

/* ================================================================== */
/*  Small UI primitives (used only inside this file)                   */
/* ================================================================== */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
      title={checked ? '关闭' : '开启'}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'inline-block size-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4.5' : 'translate-x-0.75',
        )}
      />
    </button>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

/* ================================================================== */
/*  Settings dialog                                                    */
/* ================================================================== */

const FONT_OPTIONS = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'SF Mono',
  'Menlo',
  'Consolas',
];

function SettingsDialog({
  open,
  onOpenChange,
  config,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: IdeConfig;
  onChange: (c: IdeConfig) => void;
}) {
  const [tab, setTab] = useState<'editor' | 'appearance'>('editor');

  const categories = [
    { id: 'editor' as const, label: '编辑器' },
    { id: 'appearance' as const, label: '外观' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:w-130" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>IDE 设置</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-75 flex-col sm:flex-row">
          {/* Left nav */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/30 p-2 sm:block sm:w-36 sm:space-y-0.5 sm:border-b-0 sm:border-r">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setTab(cat.id)}
                className={cn(
                  'flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors',
                  tab === cat.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {cat.label}
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 space-y-5 p-5">
            {tab === 'editor' && (
              <>
                <SettingRow label="字号">
                  <select
                    value={config.fontSize}
                    onChange={(e) => onChange({ ...config, fontSize: +e.target.value })}
                    className="rounded-md border bg-background px-3 py-1.5 text-sm"
                    title="字号"
                  >
                    {[12, 13, 14, 15, 16, 18, 20, 22, 24].map((s) => (
                      <option key={s} value={s}>
                        {s}px
                      </option>
                    ))}
                  </select>
                </SettingRow>

                <SettingRow label="Tab 宽度">
                  <div className="flex gap-1">
                    {[2, 4, 8].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => onChange({ ...config, tabSize: s })}
                        className={cn(
                          'rounded-md border px-3 py-1 text-sm transition-colors',
                          config.tabSize === s
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'hover:bg-accent',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="自动换行">
                  <Toggle
                    checked={config.wordWrap}
                    onChange={(v) => onChange({ ...config, wordWrap: v })}
                  />
                </SettingRow>
              </>
            )}

            {tab === 'appearance' && (
              <>
                <SettingRow label="主题">
                  <select
                    value={config.theme}
                    onChange={(e) =>
                      onChange({ ...config, theme: e.target.value as ThemeName })
                    }
                    className="rounded-md border bg-background px-3 py-1.5 text-sm"
                    title="主题"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="oneDark">One Dark</option>
                  </select>
                </SettingRow>

                <SettingRow label="字体">
                  <select
                    value={config.fontFamily}
                    onChange={(e) => onChange({ ...config, fontFamily: e.target.value })}
                    className="rounded-md border bg-background px-3 py-1.5 text-sm"
                    title="字体"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </SettingRow>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/*  Pretest result dialog (kept for reference, unused)                 */
/* ================================================================== */

interface PretestResult {
  status?: number;
  time?: number;
  memory?: number;
  compilerTexts?: string[];
  judgeTexts?: string[];
  testCases?: Array<{
    status: number;
    time: number;
    memory: number;
    message?: string;
  }>;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface RecordEntry {
  rid: string;
  url: string;
  lang: string;
  status: number;
  time?: number;
  memory?: number;
  timestamp: number;
}

/* ================================================================== */
/*  Inline pretest result (shown inside the pretest panel)             */
/* ================================================================== */

function diffLines(actual: string, expected: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const a = actual.split('\n');
  const b = expected.split('\n');
  const maxLen = Math.max(a.length, b.length);
  const result: { type: 'same' | 'add' | 'del'; text: string }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const aLine = a[i] ?? '';
    const bLine = b[i] ?? '';
    if (aLine === bLine) {
      result.push({ type: 'same', text: aLine });
    } else {
      if (i < b.length) result.push({ type: 'del', text: bLine });
      if (i < a.length) result.push({ type: 'add', text: aLine });
    }
  }
  return result;
}

function PretestResultInline({
  result,
  expectedOutput,
  activeResultTab,
  onResultTabChange,
}: {
  result: PretestResult;
  expectedOutput: string;
  activeResultTab: 'output' | 'diff' | 'compiler';
  onResultTabChange: (t: 'output' | 'diff' | 'compiler') => void;
}) {
  const status = getStatus(result.status ?? 8);
  const isAccepted = result.status === 1;
  const time = result.time != null ? `${result.time} ms` : '—';
  const memory =
    result.memory != null
      ? result.memory >= 1024
        ? `${(result.memory / 1024).toFixed(1)} MB`
        : `${result.memory} KB`
      : '—';
  const actualOutput =
    result.testCases?.[0]?.message
    || result.stdout
    || result.judgeTexts?.join('\n')
    || '';
  const compilerOutput = result.compilerTexts?.join('\n') || '';
  const stderr = result.stderr || '';
  const hasExpected = expectedOutput.trim().length > 0;
  const outputMatch = hasExpected && actualOutput.trim() === expectedOutput.trim();

  const tabs: { id: 'output' | 'diff' | 'compiler'; label: string; show: boolean }[] = [
    { id: 'output', label: '输出', show: true },
    { id: 'diff', label: hasExpected ? (outputMatch ? '✓ 匹配' : '✗ 差异') : '比对', show: hasExpected },
    { id: 'compiler', label: '编译', show: !!(compilerOutput || stderr) },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Result header */}
      <div className="flex items-center gap-2 bg-muted/20 px-3 py-1 border-b shrink-0">
        {isAccepted ? (
          <CheckCircle2 className="size-3.5 text-green-500" />
        ) : (
          <XCircle className="size-3.5 text-red-500" />
        )}
        <span className={cn('text-xs font-medium', status.className)}>{status.label}</span>
        <span className="text-[10px] text-muted-foreground">{time} · {memory}</span>
        {hasExpected && (
          <span className={cn('text-[10px] font-medium ml-auto', outputMatch ? 'text-green-500' : 'text-red-500')}>
            {outputMatch ? '输出匹配' : '输出不匹配'}
          </span>
        )}
      </div>

      {/* Result sub-tabs */}
      <div className="flex items-center gap-0 border-b bg-muted/10 px-1 shrink-0">
        {tabs.filter((t) => t.show).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onResultTabChange(tab.id)}
            className={cn(
              'px-3 py-1 text-[11px] transition-colors border-b -mb-px',
              activeResultTab === tab.id
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Result content */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeResultTab === 'output' && (
          <pre className="p-2 font-mono text-xs whitespace-pre-wrap break-all">
            {actualOutput || '(无输出)'}
          </pre>
        )}

        {activeResultTab === 'diff' && hasExpected && (
          <div className="p-2 font-mono text-xs">
            {diffLines(actualOutput, expectedOutput).map((line, i) => (
              <div
                key={i}
                className={cn(
                  'px-1',
                  line.type === 'add' && 'bg-red-500/10 text-red-600 dark:text-red-400',
                  line.type === 'del' && 'bg-green-500/10 text-green-600 dark:text-green-400',
                )}
              >
                <span className="inline-block w-4 text-muted-foreground select-none">
                  {line.type === 'same' ? ' ' : line.type === 'add' ? '+' : '-'}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </div>
        )}

        {activeResultTab === 'compiler' && (
          <div className="p-2 space-y-2">
            {compilerOutput && (
              <pre className="font-mono text-xs whitespace-pre-wrap break-all">{compilerOutput}</pre>
            )}
            {stderr && (
              <pre className="font-mono text-xs whitespace-pre-wrap break-all text-red-500">{stderr}</pre>
            )}
          </div>
        )}

        {result.error && (
          <div className="mx-2 mt-2 rounded-md bg-red-500/10 p-2 text-xs text-red-500">
            {result.error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main KryptonIDE component                                          */
/* ================================================================== */

export interface KryptonIDEProps {
  /** Available language IDs (from problem config) */
  langs: string[];
  /** Initial selected language */
  defaultLang?: string;
  /** Initial source code */
  defaultCode?: string;
  /** POST URL for submit / pretest (e.g. /p/:pid/submit) */
  submitUrl?: string;
  /** Whether pretest is available for this problem */
  canPretest?: boolean;
  /** Fallback submit handler when submitUrl is not provided */
  onSubmit?: (lang: string, code: string) => void;
  /** Custom CSS class */
  className?: string;
  /** Minimum editor height in px */
  minHeight?: number;
  /** localStorage key suffix for code caching (e.g. "uid/domain/pid") */
  cacheKey?: string;
  /** Auto-detected sample test cases from the problem statement */
  samples?: SampleCase[];
  /** Called when records list changes (for external rendering) */
  onRecordsChange?: (records: RecordEntry[]) => void;
  /** Called when user toggles the records panel */
  onToggleRecords?: () => void;
  /** Whether to show the records toggle button */
  showRecordsButton?: boolean;
}

export function KryptonIDE({
  langs,
  defaultLang,
  defaultCode = '',
  submitUrl,
  canPretest = false,
  onSubmit,
  className,
  minHeight = 400,
  cacheKey,
  samples = [],
  onRecordsChange,
  onToggleRecords,
  showRecordsButton = false,
}: KryptonIDEProps) {
  /* ── refs ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentRef = useRef(new Compartment());
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pretestAbort = useRef<AbortController | null>(null);
  const submitRef = useRef<() => void>(() => {});
  const pretestRef = useRef<() => void>(() => {});
  const pretestDragging = useRef(false);
  const pretestHDragging = useRef(false);
  const pretestVDragging = useRef(false);
  const pretestPanelRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  /* ── state ── */
  const [selectedLang, setSelectedLang] = useState(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && (langs.length === 0 || langs.includes(saved))) return saved;
    } catch { /* empty */ }
    return defaultLang || langs[0] || 'cc.cc17';
  });
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showPretest, setShowPretest] = useState(false);
  const [pretestHeight, setPretestHeight] = useState(200);
  const [pretestLoading, setPretestLoading] = useState(false);
  const [pretestResult, setPretestResult] = useState<PretestResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [config, setConfig] = useState<IdeConfig>(loadConfig);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [submitCooldown, setSubmitCooldown] = useState(0);
  const [pretestCooldown, setPretestCooldown] = useState(0);
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [showRecords, setShowRecords] = useState(false);

  /* ── Notify parent when records change ── */
  useEffect(() => {
    onRecordsChange?.(records);
  }, [records, onRecordsChange]);

  /* ── Pretest tabs: sample cases + custom tab ── */
  type PretestTab = { id: string; label: string; input: string; expectedOutput: string };
  const [pretestTabs, setPretestTabs] = useState<PretestTab[]>(() => {
    const tabs: PretestTab[] = samples.map((s) => ({
      id: `sample-${s.id}`,
      label: `样例 ${s.id}`,
      input: s.input,
      expectedOutput: s.output,
    }));
    tabs.push({ id: 'custom', label: '自定义', input: '', expectedOutput: '' });
    return tabs;
  });
  const [activeTestTab, setActiveTestTab] = useState(pretestTabs[0]?.id || 'custom');
  const [pretestResultTab, setPretestResultTab] = useState<'output' | 'diff' | 'compiler'>('output');
  const [pretestLeftPct, setPretestLeftPct] = useState(50); // horizontal split: left(input) vs right(result)
  const [pretestInputPct, setPretestInputPct] = useState(65); // vertical split within left: input vs expected output
  const activeTab = pretestTabs.find((t) => t.id === activeTestTab) || pretestTabs[pretestTabs.length - 1];
  const isSampleTab = activeTab.id.startsWith('sample-');

  /* ── sync samples if they change ── */
  useEffect(() => {
    setPretestTabs((prev) => {
      const custom = prev.filter((t) => t.id === 'custom' || t.id.startsWith('custom-'));
      const sampleTabs: PretestTab[] = samples.map((s) => ({
        id: `sample-${s.id}`,
        label: `样例 ${s.id}`,
        input: s.input,
        expectedOutput: s.output,
      }));
      const customTabs = custom.length > 0 ? custom : [{ id: 'custom', label: '自定义', input: '', expectedOutput: '' }];
      return [...sampleTabs, ...customTabs];
    });
  }, [samples]);

  const updateTabField = useCallback((tabId: string, field: 'input' | 'expectedOutput', value: string) => {
    setPretestTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, [field]: value } : t)),
    );
  }, []);

  const addCustomTab = useCallback(() => {
    const id = `custom-${Date.now()}`;
    setPretestTabs((prev) => [...prev, { id, label: `自定义 ${prev.filter((t) => t.id.startsWith('custom')).length + 1}`, input: '', expectedOutput: '' }]);
    setActiveTestTab(id);
  }, []);

  const removeTab = useCallback((tabId: string) => {
    setPretestTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) next.push({ id: 'custom', label: '自定义', input: '', expectedOutput: '' });
      return next;
    });
    setActiveTestTab((cur) => (cur === tabId ? (pretestTabs[0]?.id || 'custom') : cur));
  }, [pretestTabs]);

  /* ── config persistence ── */
  const updateConfig = useCallback((c: IdeConfig) => {
    setConfig(c);
    saveConfig(c);
  }, []);

  /* ── persist selected language ── */
  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, selectedLang); } catch { /* empty */ }
  }, [selectedLang]);

  /* ── helpers ── */
  const codeCacheKey = cacheKey ? `krypton:code:${cacheKey}` : null;
  const getCode = useCallback(() => viewRef.current?.state.doc.toString() || '', []);

  /* ── CodeMirror extensions ── */
  const extensions = useMemo((): Extension[] => {
    const lang = getLangEntry(selectedLang);
    const fontCSS = `"${config.fontFamily}", "JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", "Menlo", monospace`;
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        { key: 'F9', run: () => { pretestRef.current(); return true; } },
        { key: 'F10', run: () => { submitRef.current(); return true; }, preventDefault: true },
      ]),
      lang.extension(),
      themeExtension(config.theme),
      /* Fix: make .cm-editor fill the container so ALL lines have background */
      EditorView.theme({
        '&': { height: '100%', fontSize: `${config.fontSize}px` },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: fontCSS },
        '.cm-gutters': { fontFamily: fontCSS },
      }),
      ...(config.wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.tabSize.of(config.tabSize),
      /* Code caching – debounced write to localStorage */
      EditorView.updateListener.of((update) => {
        if (update.docChanged && codeCacheKey) {
          clearTimeout(cacheTimer.current);
          cacheTimer.current = setTimeout(() => {
            try { localStorage.setItem(codeCacheKey, update.state.doc.toString()); } catch { /* empty */ }
          }, 500);
        }
      }),
      /* Cursor position tracking */
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          setCursorPos({ line: line.number, col: pos - line.from + 1 });
        }
      }),
    ];
  }, [selectedLang, config, codeCacheKey]);

  /* ── Create / reconfigure editor ── */
  useEffect(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: compartmentRef.current.reconfigure(extensions),
      });
      return;
    }

    let initialDoc = defaultCode;
    if (codeCacheKey) {
      const cached = localStorage.getItem(codeCacheKey);
      if (cached) initialDoc = cached;
    }

    const state = EditorState.create({
      doc: initialDoc,
      extensions: compartmentRef.current.of(extensions),
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  /* ── Poll a submitted record for final status ── */
  const pollRecord = useCallback(async (rid: string, url: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!mountedRef.current) return;
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        const data = await res.json();
        const rdoc = data.rdoc || data;
        const s: number = rdoc.status ?? 0;
        setRecords((prev) =>
          prev.map((r) =>
            r.rid === rid ? { ...r, status: s, time: rdoc.time, memory: rdoc.memory } : r,
          ),
        );
        if (s > 0 && s < 20) return;
      } catch {
        break;
      }
    }
  }, []);

  /* ── Submit handler ── */
  const handleSubmit = useCallback(async () => {
    if (submitting || submitCooldown > 0) return;
    const code = getCode();
    if (!code.trim()) return;

    if (!submitUrl) {
      onSubmit?.(selectedLang, code);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lang: selectedLang, code }),
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data = await res.json();
        const rid = data.rid;
        if (rid) {
          const url = data.url || `/record/${rid}`;
          const entry: RecordEntry = {
            rid,
            url,
            lang: selectedLang,
            status: 20,
            timestamp: Date.now(),
          };
          setRecords((prev) => [entry, ...prev]);
          setShowRecords(true);
          setSubmitCooldown(3);
          pollRecord(rid, url);
          return;
        }
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      }
      onSubmit?.(selectedLang, code);
    } catch {
      onSubmit?.(selectedLang, code);
    } finally {
      setSubmitting(false);
    }
  }, [submitUrl, selectedLang, getCode, onSubmit, submitting, submitCooldown, pollRecord]);

  /* ── Pretest handler (runs a single test with given input) ── */
  const runPretest = useCallback(async (input: string) => {
    if (!submitUrl || pretestLoading || !canPretest) return;

    pretestAbort.current?.abort();
    const abort = new AbortController();
    pretestAbort.current = abort;
    setPretestLoading(true);
    setPretestCooldown(3);
    setPretestResult(null);

    try {
      const code = getCode();
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lang: selectedLang, code, pretest: true, input: [input] }),
        signal: abort.signal,
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const rid = data.rid;
      if (!rid) throw new Error('No rid in response');

      const recordUrl = data.url || `/record/${rid}`;

      // Poll for final result (max 60 s)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (abort.signal.aborted) return;

        const rRes = await fetch(recordUrl, {
          headers: { Accept: 'application/json' },
          signal: abort.signal,
          credentials: 'same-origin',
        });
        const rData = await rRes.json();
        const rdoc = rData.rdoc || rData;
        const s: number = rdoc.status ?? 0;

        // Final status: 1-19
        if (s > 0 && s < 20) {
          setPretestResult(rdoc);
          setPretestResultTab('output');
          return;
        }
      }

      setPretestResult({ status: 8, error: '评测超时，请稍后重试' });
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setPretestResult({ status: 8, error: e.message || '请求失败' });
      }
    } finally {
      setPretestLoading(false);
    }
  }, [submitUrl, selectedLang, pretestLoading, canPretest, getCode]);

  /** Toolbar "运行全部自测" — run current active tab */
  const handlePretest = useCallback(() => {
    if (!showPretest) {
      setShowPretest(true);
      return;
    }
    runPretest(activeTab.input);
  }, [showPretest, activeTab, runPretest]);

  /* ── Ref bridge so keymap closures always call latest handlers ── */
  submitRef.current = handleSubmit;
  pretestRef.current = handlePretest;

  /* ── Pretest panel resize via drag (top edge, horizontal split, vertical split) ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      e.preventDefault();

      // Top-edge drag (panel height)
      if (pretestDragging.current) {
        const parent = containerRef.current?.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const newH = rect.bottom - e.clientY;
        setPretestHeight(Math.max(120, Math.min(rect.height * 0.6, newH)));
      }

      // Horizontal drag (left/right split)
      if (pretestHDragging.current && pretestPanelRef.current) {
        const rect = pretestPanelRef.current.getBoundingClientRect();
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setPretestLeftPct(Math.max(20, Math.min(80, pct)));
      }

      // Vertical drag (input / expected output split within left column)
      if (pretestVDragging.current && pretestPanelRef.current) {
        const rect = pretestPanelRef.current.getBoundingClientRect();
        const pct = ((e.clientY - rect.top) / rect.height) * 100;
        setPretestInputPct(Math.max(20, Math.min(80, pct)));
      }
    };
    const onUp = () => {
      const wasDragging = pretestDragging.current || pretestHDragging.current || pretestVDragging.current;
      pretestDragging.current = false;
      pretestHDragging.current = false;
      pretestVDragging.current = false;
      if (wasDragging) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  /* ── Cleanup ── */
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      pretestAbort.current?.abort();
      clearTimeout(cacheTimer.current);
    };
  }, []);

  /* ── Click-outside to close language menu ── */
  useEffect(() => {
    if (!showLangMenu) return;
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLangMenu]);

  /* ── Escape to exit fullscreen ── */
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreen]);

  /* ── Submit cooldown timer ── */
  useEffect(() => {
    if (submitCooldown <= 0) return;
    const t = setInterval(() => setSubmitCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [submitCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Pretest cooldown timer ── */
  useEffect(() => {
    if (pretestCooldown <= 0) return;
    const t = setInterval(() => setPretestCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pretestCooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── File upload handler ── */
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        if (viewRef.current) {
          viewRef.current.dispatch({
            changes: { from: 0, to: viewRef.current.state.doc.length, insert: text },
          });
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [],
  );

  /* ── Reset code handler ── */
  const handleReset = useCallback(() => {
    if (!confirm('确定要重置代码吗？这将清除所有未保存的更改。')) return;
    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: defaultCode },
      });
    }
    if (codeCacheKey) {
      try {
        localStorage.removeItem(codeCacheKey);
      } catch { /* empty */ }
    }
  }, [defaultCode, codeCacheKey]);

  /* ── Derived values ── */
  const availableLangs = langs.length > 0 ? langs : Object.keys(LANGUAGES);
  const langLabel = getLangEntry(selectedLang).label;
  const themeBg = THEME_BG[config.theme];

  /* ── Render ── */
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border bg-background',
        fullscreen && 'fixed inset-0 z-50 rounded-none',
        className,
      )}
    >
      {/* ── Toolbar ── */}
      <div className="krypton-scrollbar flex items-center gap-1 overflow-x-auto border-b bg-muted/50 px-2 py-1">
        {/* Language selector */}
        <div className="relative" ref={langMenuRef}>
          <button
            type="button"
            onClick={() => setShowLangMenu((p) => !p)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            {langLabel}
            <ChevronDown className="size-3" />
          </button>
          {showLangMenu && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
              {availableLangs.map((id) => {
                const entry = getLangEntry(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSelectedLang(id);
                      setShowLangMenu(false);
                    }}
                    className={cn(
                      'flex w-full items-center rounded px-2 py-1.5 text-xs hover:bg-accent',
                      id === selectedLang && 'bg-accent font-medium',
                    )}
                  >
                    {entry.label}
                    <span className="ml-auto text-[10px] text-muted-foreground">{id}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Pretest toggle + Run */}
        {canPretest && submitUrl && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={() => setShowPretest((p) => !p)}
            >
              <Terminal className="size-3" />
              自测
              {showPretest ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              disabled={pretestLoading || pretestCooldown > 0}
              onClick={handlePretest}
            >
              {pretestLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : pretestCooldown > 0 ? (
                <Clock className="size-3" />
              ) : (
                <Play className="size-3" />
              )}
              {pretestCooldown > 0 ? `${pretestCooldown}s` : '运行全部自测'}
              <kbd className="ml-0.5 rounded border bg-muted px-1 text-[10px] font-normal">F9</kbd>
            </Button>
          </>
        )}

        {/* Submit */}
        {(submitUrl || onSubmit) && (
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={submitting || submitCooldown > 0}
            onClick={handleSubmit}
          >
            {submitting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : submitCooldown > 0 ? (
              <Clock className="size-3" />
            ) : (
              <Send className="size-3" />
            )}
            {submitCooldown > 0 ? `${submitCooldown}s` : '提交'}
            <kbd className="ml-0.5 rounded bg-primary-foreground/20 px-1 text-[10px] font-normal">
              F10
            </kbd>
          </Button>
        )}

        {/* Records toggle — right next to submit */}
        {showRecordsButton && (
          <button
            type="button"
            onClick={onToggleRecords}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="提交记录"
          >
            <History className="size-3.5" />
          </button>
        )}

        <div className="flex-1" />

        {/* Upload file */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="上传代码文件"
        >
          <FileUp className="size-3.5" />
        </button>

        {/* Reset code */}
        <button
          type="button"
          onClick={handleReset}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="重置代码"
        >
          <RotateCcw className="size-3.5" />
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="设置"
        >
          <Settings2 className="size-3.5" />
        </button>

        {/* Fullscreen */}
        <button
          type="button"
          onClick={() => setFullscreen((p) => !p)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={fullscreen ? '退出全屏' : '全屏'}
        >
          {fullscreen ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </button>
      </div>

      {/* ── Editor area ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{
          minHeight: fullscreen ? undefined : minHeight,
          backgroundColor: themeBg,
        }}
      />

      {/* ── Status bar ── */}
      <div className="flex items-center border-t bg-muted/40 px-3 py-0.5 text-[11px] text-muted-foreground">
        <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
        <div className="flex-1" />
        <span>{langLabel}</span>
      </div>

      {/* ── Pretest panel (multi-tab, inline results) ── */}
      {showPretest && canPretest && (
        <div className="border-t flex flex-col" style={{ height: pretestHeight, minHeight: 120 }}>
          {/* Drag handle — top edge for panel height */}
          <div
            className="h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
            onMouseDown={() => {
              pretestDragging.current = true;
              document.body.style.cursor = 'row-resize';
              document.body.style.userSelect = 'none';
            }}
          />

          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b bg-muted/30 px-1 shrink-0 overflow-x-auto overflow-y-hidden" style={{ scrollbarWidth: 'none' }}>
            {pretestTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTestTab(tab.id)}
                className={cn(
                  'flex items-center gap-1 whitespace-nowrap px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px shrink-0',
                  activeTestTab === tab.id
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                {/* close button for custom tabs (only if more than one custom tab) */}
                {tab.id.startsWith('custom') && pretestTabs.filter((t) => t.id.startsWith('custom') || t.id === 'custom').length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeTab(tab.id); } }}
                    className="ml-1 rounded-full p-0.5 hover:bg-accent"
                  >
                    <XCircle className="size-3" />
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={addCustomTab}
              className="flex items-center gap-0.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
              title="添加自定义测试"
            >
              <Plus className="size-3" />
            </button>
            <div className="flex-1" />
            {/* Per-tab run button */}
            <button
              type="button"
              disabled={pretestLoading || pretestCooldown > 0}
              onClick={() => runPretest(activeTab.input)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 shrink-0"
              title="运行当前测试"
            >
              {pretestLoading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              运行
            </button>
            <button
              type="button"
              onClick={() => setShowPretest(false)}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              收起
            </button>
          </div>

          {/* Tab content: resizable 2-column layout (input left, result right) */}
          <div ref={pretestPanelRef} className="krypton-split flex flex-1 min-h-0 overflow-hidden relative">
            {/* Crosshair at intersection of horizontal and vertical drag handles */}
            <div
              className="absolute z-10 cursor-move bg-border transition-colors hover:bg-primary/60 active:bg-primary/80"
              style={{
                left: `calc(${pretestLeftPct}% - 3px)`,
                top: `calc(${pretestInputPct}% - 3px)`,
                width: 7,
                height: 7,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                pretestHDragging.current = true;
                pretestVDragging.current = true;
                document.body.style.cursor = 'move';
                document.body.style.userSelect = 'none';
              }}
            />
            {/* Left: input + expected output (vertically resizable) */}
            <div className="krypton-split-pane flex flex-col min-w-0 min-h-0 overflow-hidden" style={{ width: `${pretestLeftPct}%` }}>
              {/* Input section */}
              <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: `${pretestInputPct}%` }}>
                <div className="flex items-center gap-2 bg-muted/20 px-3 py-1 border-b shrink-0">
                  <span className="text-[11px] font-medium text-muted-foreground">输入</span>
                  {isSampleTab && <span className="text-[10px] text-muted-foreground/60">· 样例（只读）</span>}
                </div>
                {isSampleTab ? (
                  <pre className="flex-1 w-full overflow-auto bg-muted/10 p-2 font-mono text-xs whitespace-pre-wrap break-all min-h-0">
                    {activeTab.input || '(空)'}
                  </pre>
                ) : (
                  <textarea
                    value={activeTab.input}
                    onChange={(e) => updateTabField(activeTestTab, 'input', e.target.value)}
                    placeholder="在此输入测试数据…"
                    className="flex-1 w-full resize-none border-0 bg-background p-2 font-mono text-xs focus:outline-none min-h-0"
                  />
                )}
              </div>

              {/* Vertical drag handle (between input and expected output) */}
              <div
                className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
                onMouseDown={() => {
                  pretestVDragging.current = true;
                  document.body.style.cursor = 'row-resize';
                  document.body.style.userSelect = 'none';
                }}
              />

              {/* Expected output section */}
              <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: `${100 - pretestInputPct}%` }}>
                <div className="flex items-center gap-2 bg-muted/20 px-3 py-1 border-b shrink-0">
                  <span className="text-[11px] font-medium text-muted-foreground">期望输出{isSampleTab ? '' : '（可选）'}</span>
                </div>
                {isSampleTab ? (
                  <pre className="flex-1 w-full overflow-auto bg-muted/10 p-2 font-mono text-xs whitespace-pre-wrap break-all min-h-0">
                    {activeTab.expectedOutput || '(空)'}
                  </pre>
                ) : (
                  <textarea
                    value={activeTab.expectedOutput}
                    onChange={(e) => updateTabField(activeTestTab, 'expectedOutput', e.target.value)}
                    placeholder="输入期望输出以便自动比对…"
                    className="flex-1 w-full resize-none border-0 bg-background p-2 font-mono text-xs focus:outline-none min-h-0"
                  />
                )}
              </div>
            </div>

            {/* Horizontal drag handle (between left and right) — has special cursor at intersection with vertical handle */}
            <div
              className="krypton-split-handle w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
              onMouseDown={() => {
                pretestHDragging.current = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />

            {/* Right: result panel */}
            <div className="krypton-split-pane flex flex-col min-w-0 min-h-0 overflow-hidden" style={{ width: `${100 - pretestLeftPct}%` }}>
              {pretestLoading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  评测中…
                </div>
              ) : pretestResult ? (
                <PretestResultInline
                  result={pretestResult}
                  expectedOutput={activeTab.expectedOutput}
                  activeResultTab={pretestResultTab}
                  onResultTabChange={setPretestResultTab}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                  按 F9 或点击"运行"开始自测
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Dialogs ── */}
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        config={config}
        onChange={updateConfig}
      />

      {/* ── Hidden file input ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".c,.cc,.cpp,.cxx,.h,.hpp,.py,.java,.js,.ts,.go,.rs,.rb,.cs,.hs,.php,.kt,.pas,.txt"
        className="hidden"
        aria-label="上传代码文件"
        onChange={handleFileUpload}
      />
    </div>
  );
}
