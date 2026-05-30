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
import { createPortal } from 'react-dom';

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
  indentUnit,
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
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';

import { oneDark } from '@codemirror/theme-one-dark';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
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
  // Non-submission "config / data" languages used by file editing dialogs.
  // These don't correspond to Hydro submit langs; passing the id to KryptonIDE
  // simply enables syntax highlighting.
  yaml: { label: 'YAML', extension: yaml },
  yml: { label: 'YAML', extension: yaml },
  json: { label: 'JSON', extension: json },
  txt: { label: 'Text', extension: () => [] },
  // Submission languages below
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

/**
 * Cached longest-first key list for `getLangEntry`'s prefix fallback.
 * Computed once on first access — `LANGUAGES` is module-scoped const.
 */
let LANG_KEYS_DESC: string[] | null = null;
function langKeysDesc(): string[] {
  if (!LANG_KEYS_DESC) {
    LANG_KEYS_DESC = Object.keys(LANGUAGES).sort((a, b) => b.length - a.length);
  }
  return LANG_KEYS_DESC;
}

/**
 * Pretty labels for the Hydro language-id "modifier" suffix — the bit
 * tacked onto a base variant id to indicate a compile flag or toolchain.
 * `cc.cc14o2` → base `cc.cc14` + modifier `o2` → label "C++14 (O2)".
 */
const MODIFIER_LABELS: Record<string, string> = {
  o2: ' (O2)',
  o3: ' (O3)',
  gcc: ' (GCC)',
  clang: ' (Clang)',
  msvc: ' (MSVC)',
  fpc: ' (Free Pascal)',
  pp: ' (Free Pascal)',
};

function decorateLabel(baseLabel: string, modifier: string): string {
  if (!modifier) return baseLabel;
  const key = modifier.toLowerCase().replace(/^[._-]+/, '');
  return baseLabel + (MODIFIER_LABELS[key] ?? ` (${key})`);
}

/**
 * Look up the CodeMirror language config for a Hydro language id.
 *
 * Hydro uses `{family}.{variant}[modifier]` naming. The `variant` may
 * carry a compile-flag suffix appended directly to the version token,
 * e.g. `cc.cc14o2` (C++14 with -O2) or `cc.cc20gcc` (force g++).
 * The `LANGUAGES` registry only lists the bare versions because the
 * compile flag doesn't change the *grammar*. To get a useful menu
 * label we inherit the base entry's extension but synthesise the label
 * as `{base.label} ({modifier})`, so listing `cc.cc14` and `cc.cc14o2`
 * side by side shows "C++14" and "C++14 (O2)" respectively.
 */
export function getLangEntry(id: string): LangEntry {
  if (LANGUAGES[id]) return LANGUAGES[id];
  for (const key of langKeysDesc()) {
    if (id.startsWith(key) && id !== key) {
      const base = LANGUAGES[key];
      const modifier = id.slice(key.length);
      return {
        label: decorateLabel(base.label, modifier),
        extension: base.extension,
      };
    }
  }
  // Last-ditch: try the `{family}` segment (e.g. an unknown variant
  // like `cc.something_exotic` still picks up the cc highlighter).
  const dotIdx = id.indexOf('.');
  if (dotIdx > 0) {
    const family = id.slice(0, dotIdx);
    if (LANGUAGES[family]) {
      return {
        label: id,  // unknown variant — show the raw id so the user can tell which
        extension: LANGUAGES[family].extension,
      };
    }
  }
  return { label: id, extension: () => [] };
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

function normalizeConfig(value: Partial<IdeConfig> = {}): IdeConfig {
  const fontSize = Number(value.fontSize);
  const tabSize = Number(value.tabSize);
  const theme = value.theme && ['light', 'dark', 'oneDark'].includes(value.theme)
    ? value.theme
    : DEFAULT_CONFIG.theme;
  return {
    ...DEFAULT_CONFIG,
    ...value,
    fontSize: [12, 13, 14, 15, 16, 18, 20, 22, 24].includes(fontSize)
      ? fontSize
      : DEFAULT_CONFIG.fontSize,
    tabSize: [2, 4, 8].includes(tabSize) ? tabSize : DEFAULT_CONFIG.tabSize,
    theme,
    wordWrap: typeof value.wordWrap === 'boolean' ? value.wordWrap : DEFAULT_CONFIG.wordWrap,
    fontFamily: value.fontFamily || DEFAULT_CONFIG.fontFamily,
  };
}

function loadConfig(): IdeConfig {
  try {
    const raw = localStorage.getItem(IDE_CONFIG_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw));
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
                  <SimpleSelect
                    value={String(config.fontSize)}
                    onValueChange={(v) => onChange({ ...config, fontSize: +v })}
                    size="sm"
                    className="w-auto min-w-[6rem]"
                    ariaLabel="字号"
                    options={[12, 13, 14, 15, 16, 18, 20, 22, 24].map((s) => ({
                      value: String(s), label: `${s}px`,
                    }))}
                  />
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
                  <SimpleSelect
                    value={config.theme}
                    onValueChange={(v) => onChange({ ...config, theme: v as ThemeName })}
                    size="sm"
                    className="w-auto min-w-[8rem]"
                    ariaLabel="主题"
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                      { value: 'oneDark', label: 'One Dark' },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="字体">
                  <SimpleSelect
                    value={config.fontFamily}
                    onValueChange={(v) => onChange({ ...config, fontFamily: v })}
                    size="sm"
                    className="w-auto min-w-[10rem]"
                    ariaLabel="字体"
                    options={FONT_OPTIONS.map((f) => ({ value: f, label: f }))}
                  />
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
  score?: number;
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
      <ScrollArea orientation="both" className="flex-1 min-h-0">
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
      </ScrollArea>
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
  /** Detail URL template for a submitted record, e.g. `/exam-mode/:tid/record/__RID__`. */
  recordUrlTemplate?: string;
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
  /** Called when a fresh submit should make the external records panel visible */
  onOpenRecords?: () => void;
  /** Whether to show the records toggle button */
  showRecordsButton?: boolean;
  /** External records panel visibility, used to style the toolbar button */
  recordsVisible?: boolean;
  /** Number of records displayed by the external panel */
  recordsCount?: number;

  /* ── Editor modes ───────────────────────────────────────────── */

  /**
   * Editor mode.
   *  - `full` (default): submit/pretest toolbar, records, settings — full IDE.
   *  - `simple`: just the editor + syntax highlighting. No submit, no pretest,
   *    no records, no language menu. Used for embedded YAML / config editing.
   *  - `readonly`: `simple` + editor is non-editable.
   */
  mode?: 'full' | 'simple' | 'readonly';
  /**
   * Controlled value. When provided, the editor mirrors this string and
   * fires `onValueChange` on every keystroke. Required for `simple`/`readonly`
   * use because there's no submit button to flush state.
   */
  value?: string;
  /** Controlled value change handler. */
  onValueChange?: (value: string) => void;
}

export function KryptonIDE({
  langs,
  defaultLang,
  defaultCode = '',
  submitUrl,
  recordUrlTemplate,
  canPretest = false,
  onSubmit,
  className,
  minHeight = 400,
  cacheKey,
  samples = [],
  onRecordsChange,
  onToggleRecords,
  onOpenRecords,
  showRecordsButton = false,
  recordsVisible,
  recordsCount = 0,
  mode = 'full',
  value,
  onValueChange,
}: KryptonIDEProps) {
  const isSimple = mode === 'simple' || mode === 'readonly';
  const isReadOnly = mode === 'readonly';
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
  // Language dropdown rendered via Portal — the toolbar uses `overflow-x-auto`
  // which (per CSS spec) forces `overflow-y` to non-visible and would clip a
  // normally-positioned absolute dropdown. Portal + fixed positioning avoids it.
  const langButtonRef = useRef<HTMLButtonElement>(null);
  const langDropdownRef = useRef<HTMLDivElement>(null);
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
  const [langMenuPos, setLangMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [showPretest, setShowPretest] = useState(false);
  const [pretestHeight, setPretestHeight] = useState(200);
  // Per-tab loading + result state. A single pretest run owns a set of
  // tabIds (1 tab for "运行此自测" / F9, all non-empty tabs for "运行全部自测")
  // and writes per-tab results back into the map. Aborting a run clears
  // its own tabIds from `pretestRunning` only.
  const [pretestRunning, setPretestRunning] = useState<Set<string>>(new Set());
  const [pretestResults, setPretestResults] = useState<Map<string, PretestResult>>(new Map());
  const pretestLoading = pretestRunning.size > 0;
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

  /**
   * Sync sample-derived tabs whenever the actual sample CONTENT changes.
   *
   * Using `samples` directly as a dep was a footgun: parent components
   * routinely pass a fresh array (especially when defaulting to `[]`),
   * which made this effect fire every render and call setPretestTabs
   * with a new array reference every time → infinite re-render loop.
   * We use a serialised signature instead so identity churn is ignored.
   */
  const samplesKey = useMemo(
    () => samples.map((s) => `${s.id}|${(s.input || '').length}|${(s.output || '').length}`).join('\n'),
    [samples],
  );
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
      const next = [...sampleTabs, ...customTabs];
      // Cheap equality check — same length + same ids + same data lengths means we're done.
      if (prev.length === next.length
        && prev.every((t, i) => t.id === next[i].id && t.input === next[i].input && t.expectedOutput === next[i].expectedOutput)) {
        return prev;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samplesKey]);

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
      indentUnit.of(' '.repeat(config.tabSize)),
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
      /* Read-only flag for `mode='readonly'` */
      ...(isReadOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      /* Controlled value: emit onValueChange on each keystroke */
      ...(onValueChange ? [EditorView.updateListener.of((update) => {
        if (update.docChanged) onValueChange(update.state.doc.toString());
      })] : []),
    ];
  }, [selectedLang, config, codeCacheKey, isReadOnly, onValueChange]);

  /* ── Create / reconfigure editor ── */
  useEffect(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: compartmentRef.current.reconfigure(extensions),
      });
      return;
    }

    // Controlled `value` (simple/readonly mode) wins; otherwise fall back to
    // defaultCode or the cached document.
    let initialDoc = value != null ? value : defaultCode;
    if (value == null && codeCacheKey) {
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

  /* ── External value sync (controlled mode) ──
   *  When the caller changes `value` (e.g. swapping the file being edited),
   *  replace the editor document. Skip when the change came from our own
   *  keystrokes by comparing strings. */
  useEffect(() => {
    if (value == null) return;
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

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

  const resolveRecordUrl = useCallback((rid: string, fallback?: string) => {
    if (recordUrlTemplate) {
      return recordUrlTemplate.replace(/__RID__/g, encodeURIComponent(rid));
    }
    return fallback || `/record/${rid}`;
  }, [recordUrlTemplate]);

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
        const rid = data.rid ? String(data.rid) : '';
        if (rid) {
          const url = resolveRecordUrl(rid, data.url || `/record/${rid}`);
          const entry: RecordEntry = {
            rid,
            url,
            lang: selectedLang,
            status: 20,
            timestamp: Date.now(),
          };
          setRecords((prev) => [entry, ...prev]);
          setShowRecords(true);
          onOpenRecords?.();
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
  }, [submitUrl, selectedLang, getCode, onSubmit, onOpenRecords, submitting, submitCooldown, pollRecord, resolveRecordUrl]);

  /* ── Pretest handler ──
   *  Runs one or more tabs in a single backend pretest request. The judge
   *  treats `input: string[]` as N test cases sharing one record; the
   *  response rdoc's `testCases[i]` maps back to the i-th tab. We fan
   *  results out into `pretestResults` so the per-tab panel + tab badges
   *  light up independently.
   *
   *  Why a single request instead of N sequential POSTs:
   *   - one rate-limiter consumption (limit.pretest defaults to 60/min)
   *   - one judge queue slot, so "run all" stays atomic
   *   - results stream in together — easier to render partial progress
   */
  const runPretestForTabs = useCallback(async (tabIds: string[]) => {
    if (!submitUrl || !canPretest) return;
    const tabs = tabIds
      .map((id) => pretestTabs.find((t) => t.id === id))
      .filter((t): t is PretestTab => !!t && t.input.length > 0);
    if (tabs.length === 0) return;

    // Any in-flight pretest gets aborted — only one run owns the controller.
    pretestAbort.current?.abort();
    const abort = new AbortController();
    pretestAbort.current = abort;
    const runningIds = tabs.map((t) => t.id);
    setPretestRunning(new Set(runningIds));
    setPretestCooldown(3);
    setPretestResults((prev) => {
      const m = new Map(prev);
      runningIds.forEach((id) => m.delete(id));
      return m;
    });

    const distributeFromRdoc = (rdoc: any) => {
      setPretestResults((prev) => {
        const m = new Map(prev);
        const cases = Array.isArray(rdoc.testCases) ? rdoc.testCases : [];
        runningIds.forEach((tabId, i) => {
          const tc = cases[i];
          // testCases settle one at a time. If this tab's case hasn't
          // landed yet, show the record-level status (pending / compile
          // error / etc.) so the tab badge isn't blank.
          m.set(tabId, tc
            ? {
                status: tc.status,
                time: tc.time,
                memory: tc.memory,
                testCases: [tc],
                compilerTexts: rdoc.compilerTexts,
                judgeTexts: rdoc.judgeTexts,
              }
            : {
                status: rdoc.status ?? 0,
                compilerTexts: rdoc.compilerTexts,
                judgeTexts: rdoc.judgeTexts,
              });
        });
        return m;
      });
    };

    const setErrorForAll = (status: number, error?: string) => {
      setPretestResults((prev) => {
        const m = new Map(prev);
        runningIds.forEach((id) => m.set(id, { status, error }));
        return m;
      });
    };

    try {
      const code = getCode();
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lang: selectedLang, code, pretest: true, input: tabs.map((t) => t.input) }),
        signal: abort.signal,
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const rid = data.rid;
      if (!rid) throw new Error('No rid in response');

      const recordUrl = data.url || `/record/${rid}`;

      // Multi-case runs need more headroom — judge time scales with N.
      const maxAttempts = tabs.length > 1 ? 90 : 60;
      for (let i = 0; i < maxAttempts; i++) {
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
        distributeFromRdoc(rdoc);

        // Final status: 1-19
        if (s > 0 && s < 20) {
          setPretestResultTab('output');
          return;
        }
      }

      setErrorForAll(8, '评测超时，请稍后重试');
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setErrorForAll(8, e.message || '请求失败');
      }
    } finally {
      setPretestRunning((prev) => {
        const s = new Set(prev);
        runningIds.forEach((id) => s.delete(id));
        return s;
      });
    }
  }, [submitUrl, canPretest, pretestTabs, selectedLang, getCode]);

  /** Toolbar "运行全部自测" — run every non-empty pretest tab in one request. */
  const handleRunAll = useCallback(() => {
    if (!showPretest) {
      setShowPretest(true);
      return;
    }
    runPretestForTabs(pretestTabs.map((t) => t.id));
  }, [showPretest, pretestTabs, runPretestForTabs]);

  /** F9 + per-tab ▶ — run only the currently-active tab (fast iteration). */
  const handleRunActive = useCallback(() => {
    if (!showPretest) {
      setShowPretest(true);
      return;
    }
    runPretestForTabs([activeTab.id]);
  }, [showPretest, activeTab.id, runPretestForTabs]);

  /* ── Ref bridge so keymap closures always call latest handlers ── */
  submitRef.current = handleSubmit;
  pretestRef.current = handleRunActive;

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

  /* ── Click-outside closes; scroll/resize re-position so dropdown follows the button ── */
  useEffect(() => {
    if (!showLangMenu) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (langButtonRef.current?.contains(t)) return;
      if (langDropdownRef.current?.contains(t)) return;
      setShowLangMenu(false);
    };
    const reposition = () => {
      const btn = langButtonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // If the button has scrolled out of viewport, close the menu;
      // otherwise update fixed position so the dropdown tracks the button.
      const offscreen = r.bottom < 0 || r.top > window.innerHeight
        || r.right < 0 || r.left > window.innerWidth;
      if (offscreen) {
        setShowLangMenu(false);
      } else {
        setLangMenuPos({ top: r.bottom + 4, left: r.left });
      }
    };
    document.addEventListener('mousedown', handler);
    // Capture phase to catch nested scroll containers (e.g. the toolbar's own overflow-x-auto).
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
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
      {/* ── Toolbar (hidden in simple/readonly mode) ── */}
      {!isSimple ? (
      <ScrollArea
        orientation="horizontal"
        className="shrink-0 border-b bg-muted/50"
        viewportClassName="px-2 py-1 [&>div]:!flex [&>div]:items-center [&>div]:gap-1"
      >
        {/* Language selector — button stays in toolbar, dropdown portals to body */}
        <button
          ref={langButtonRef}
          type="button"
          onClick={() => {
            if (showLangMenu) {
              setShowLangMenu(false);
              return;
            }
            const r = langButtonRef.current?.getBoundingClientRect();
            if (r) setLangMenuPos({ top: r.bottom + 4, left: r.left });
            setShowLangMenu(true);
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          {langLabel}
          <ChevronDown className="size-3" />
        </button>
        {showLangMenu && langMenuPos && createPortal(
          <ScrollArea
            ref={langDropdownRef as any}
            style={{ position: 'fixed', top: langMenuPos.top, left: langMenuPos.left }}
            className="z-[60] max-h-64 w-48 rounded-lg border bg-popover shadow-lg"
            viewportClassName="p-1"
          >
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
          </ScrollArea>,
          document.body,
        )}

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
              onClick={handleRunAll}
              title="一次评测所有非空自测 tab"
            >
              {pretestLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : pretestCooldown > 0 ? (
                <Clock className="size-3" />
              ) : (
                <Play className="size-3" />
              )}
              {pretestCooldown > 0 ? `${pretestCooldown}s` : '运行全部自测'}
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
          <Button
            type="button"
            variant={(recordsVisible ?? showRecords) ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleRecords}
            className="h-7 gap-1 px-2 text-xs"
            title={(recordsVisible ?? showRecords) ? '收起提交记录' : '展开提交记录'}
          >
            <History className="size-3" />
            <span>提交记录</span>
            {recordsCount > 0 ? (
              <span className="ml-0.5 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                {recordsCount}
              </span>
            ) : null}
          </Button>
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
      </ScrollArea>
      ) : null}

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
      {!isSimple && showPretest && canPretest && (
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

          {/* Tab bar — each tab carries an inline pass/fail/judging badge
              so "运行全部自测" results are scannable without clicking through
              every tab. */}
          <div className="flex items-center gap-0 border-b bg-muted/30 px-1 shrink-0 overflow-x-auto overflow-y-hidden" style={{ scrollbarWidth: 'none' }}>
            {pretestTabs.map((tab) => {
              const tabResult = pretestResults.get(tab.id);
              const tabBusy = pretestRunning.has(tab.id);
              const status = tabResult?.status ?? null;
              const isAccepted = status === 1;
              // 1 = AC; ≥2 and <20 = some kind of failure (WA/RE/TLE/CE/etc.)
              const isFinalFail = status !== null && status >= 2 && status < 20;
              return (
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
                  {tabBusy ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : isAccepted ? (
                    <CheckCircle2 className="size-3 text-green-500" />
                  ) : isFinalFail ? (
                    <XCircle className="size-3 text-red-500" />
                  ) : null}
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
              );
            })}
            <button
              type="button"
              onClick={addCustomTab}
              className="flex items-center gap-0.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
              title="添加自定义测试"
            >
              <Plus className="size-3" />
            </button>
            <div className="flex-1" />
            {/* Per-tab run button — runs only the active tab; F9 shortcut */}
            <button
              type="button"
              disabled={pretestLoading || pretestCooldown > 0 || !activeTab.input.trim()}
              onClick={handleRunActive}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 shrink-0"
              title="运行当前自测 (F9)"
            >
              {pretestRunning.has(activeTab.id) ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              运行此自测
              <kbd className="ml-0.5 rounded border bg-muted px-1 text-[10px] font-normal">F9</kbd>
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

            {/* Right: result panel — bound to the currently-active tab. Each
                tab keeps its own latest result in `pretestResults`, so
                switching tabs while a "运行全部自测" pass is mid-judge shows
                the per-tab progress without races. */}
            <div className="krypton-split-pane flex flex-col min-w-0 min-h-0 overflow-hidden" style={{ width: `${100 - pretestLeftPct}%` }}>
              {(() => {
                const result = pretestResults.get(activeTab.id) || null;
                const thisTabRunning = pretestRunning.has(activeTab.id);
                if (thisTabRunning && !result) {
                  return (
                    <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {pretestRunning.size > 1 ? `评测中… (${pretestRunning.size} 个 tab)` : '评测中…'}
                    </div>
                  );
                }
                if (result) {
                  return (
                    <PretestResultInline
                      result={result}
                      expectedOutput={activeTab.expectedOutput}
                      activeResultTab={pretestResultTab}
                      onResultTabChange={setPretestResultTab}
                    />
                  );
                }
                return (
                  <div className="flex flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                    <div>按 F9 或点击"运行此自测"测试当前 tab</div>
                    <div className="text-[10px]">"运行全部自测" 一次评测所有非空 tab</div>
                  </div>
                );
              })()}
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
