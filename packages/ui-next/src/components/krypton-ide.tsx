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
 *  - Configurable font size, tab size, word wrap, and font
 *  - Editor colors follow the app color mode
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

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
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentUnit, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
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

import { cn } from '@/lib/cn';
import { useColorMode } from '@/lib/use-color-mode';
import { readAlternatePlainText } from '@/lib/clipboard-text';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import {
  distributePretestRecord,
  isTerminalJudgeStatus,
  normalizePretestLineEndings,
  parseRecordResponse,
  preferredPretestResultTab,
  pretestActualOutput,
  pretestOutputsMatch,
  selfTestVerdict,
  type PretestResult,
} from '@/lib/pretest-results';
import { READ_ONLY_CODE_EXTENSIONS, resolveReadOnlyCodeLanguage } from '@/lib/readonly-code-policy';
import { Button } from '@/components/ui/button';
import { confirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/display';
import { Popover } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileUp,
  History,
  Loader2,
  Maximize2,
  Minus,
  Minimize2,
  Play,
  Plus,
  Printer,
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
  LANG_KEYS_DESC ||= Object.keys(LANGUAGES).sort((a, b) => b.length - a.length);
  return LANG_KEYS_DESC;
}

function sameOriginSubmissionUrl(raw: string): string {
  const target = new URL(raw, window.location.href);
  if (target.origin !== window.location.origin) throw new Error('提交响应包含非本站地址');
  return `${target.pathname}${target.search}${target.hash}`;
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
        label: id, // unknown variant — show the raw id so the user can tell which
        extension: LANGUAGES[family].extension,
      };
    }
  }
  return { label: id, extension: () => [] };
}

/* ================================================================== */
/*  Themes                                                             */
/* ================================================================== */

/** Syntax colors match `styles.css` `.hljs-*` tokens. */
const kryptonHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--brand-fg)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string), tags.inserted], color: 'var(--success-fg)' },
  { tag: [tags.number, tags.literal, tags.bool], color: 'var(--orange-fg)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--info-fg)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--violet-fg)' },
  { tag: [tags.propertyName, tags.variableName, tags.attributeName], color: 'var(--warning-fg)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment, tags.quote], color: 'var(--fg-subtle)' },
  { tag: tags.meta, color: 'var(--fg-muted)' },
  { tag: [tags.deleted, tags.invalid], color: 'var(--danger-fg)' },
]);

const editorThemeCache = new Map<boolean, Extension>();

/** `isDark` selects CodeMirror chrome; painted colors stay on CSS variables. */
function kryptonEditorTheme(isDark: boolean): Extension {
  const cached = editorThemeCache.get(isDark);
  if (cached) return cached;
  const theme: Extension = [
    EditorView.theme(
      {
        '&': { backgroundColor: 'var(--surface)', color: 'var(--fg)' },
        '.cm-gutters': {
          backgroundColor: 'var(--surface-sunken)',
          color: 'var(--fg-subtle)',
          borderRight: '1px solid var(--line)',
        },
        '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hover)' },
        '.cm-activeLine': { backgroundColor: 'var(--surface-hover)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
        '& .cm-selectionBackground, ::selection': {
          backgroundColor: 'var(--selection)',
        },
        // Base theme paints the focused selection at (0, 5, 0). Match that path so the token wins.
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: 'var(--selection)',
        },
        '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--brand-soft)' },
        '& .cm-foldPlaceholder': {
          backgroundColor: 'var(--surface-sunken)',
          'border': '1px solid var(--line)',
          color: 'var(--fg-subtle)',
        },
      },
      // ds-allow DS010: CodeMirror theme flag, not a Tailwind dark: variant
      { dark: isDark },
    ),
    syntaxHighlighting(kryptonHighlightStyle),
  ];
  editorThemeCache.set(isDark, theme);
  return theme;
}

/* ================================================================== */
/*  IDE config persistence                                             */
/* ================================================================== */

interface IdeConfig {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  fontFamily: string;
}

const IDE_CONFIG_KEY = 'krypton:ide-config';
const LANG_KEY = 'krypton:ide-lang';
const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20, 22, 24];

const DEFAULT_CONFIG: IdeConfig = {
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
  fontFamily: 'JetBrains Mono',
};

function normalizeConfig(value: Partial<IdeConfig> = {}): IdeConfig {
  const fontSize = Number(value.fontSize);
  const tabSize = Number(value.tabSize);
  return {
    fontSize: FONT_SIZE_OPTIONS.includes(fontSize) ? fontSize : DEFAULT_CONFIG.fontSize,
    tabSize: [2, 4, 8].includes(tabSize) ? tabSize : DEFAULT_CONFIG.tabSize,
    wordWrap: typeof value.wordWrap === 'boolean' ? value.wordWrap : DEFAULT_CONFIG.wordWrap,
    fontFamily: value.fontFamily || DEFAULT_CONFIG.fontFamily,
  };
}

function loadConfig(): IdeConfig {
  try {
    const raw = localStorage.getItem(IDE_CONFIG_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw));
  } catch {
    /* empty */
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(c: IdeConfig) {
  try {
    localStorage.setItem(IDE_CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* empty */
  }
}

/* ================================================================== */
/*  Status helpers                                                     */
/* ================================================================== */

interface StatusDisplay {
  label: string;
  className: string;
}

const STATUS_MAP: Record<number, StatusDisplay> = {
  0: { label: '等待中', className: 'text-fg-subtle' },
  1: { label: '通过 (Accepted)', className: 'text-success-fg' },
  2: { label: '答案错误 (Wrong Answer)', className: 'text-danger-fg' },
  3: { label: '时间超限 (TLE)', className: 'text-danger-fg' },
  4: { label: '内存超限 (MLE)', className: 'text-danger-fg' },
  5: { label: '输出超限 (OLE)', className: 'text-danger-fg' },
  6: { label: '运行错误 (RE)', className: 'text-danger-fg' },
  7: { label: '编译错误 (CE)', className: 'text-warning-fg' },
  8: { label: '系统错误 (SE)', className: 'text-warning-fg' },
  9: { label: '已取消', className: 'text-fg-subtle' },
  10: { label: '未知错误', className: 'text-danger-fg' },
  11: { label: 'Hacked', className: 'text-danger-fg' },
  12: { label: '人工已评分', className: 'text-success-fg' },
  20: { label: '评测中…', className: 'text-info-fg' },
  21: { label: '编译中…', className: 'text-info-fg' },
  22: { label: '等待中…', className: 'text-fg-subtle' },
  30: { label: '已忽略', className: 'text-fg-subtle' },
  31: { label: '格式错误', className: 'text-danger-fg' },
  32: { label: 'Hack 成功', className: 'text-success-fg' },
  33: { label: 'Hack 失败', className: 'text-danger-fg' },
};

export function getStatus(s: number): StatusDisplay {
  return STATUS_MAP[s] || { label: `Status ${s}`, className: 'text-fg-subtle' };
}

/** Thrown values surfaced to the user (Error / DOMException from fetch). */
interface ErrorLike {
  name?: string;
  message?: string;
}

/* ================================================================== */
/*  Small UI primitives (used only inside this file)                   */
/* ================================================================== */

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

const FONT_OPTIONS = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'Menlo', 'Consolas'];

function LanguageMenuList({
  langs,
  selectedLang,
  onSelect,
  onClose,
}: {
  langs: readonly string[];
  selectedLang: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const current = root.querySelector<HTMLButtonElement>('[data-selected="true"]') ?? root.querySelector('button');
    current?.focus();
  }, []);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const buttons = [...(listRef.current?.querySelectorAll('button') ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' || (event.key === 'ArrowDown' && index < 0)
      ? 0
      : event.key === 'End' || (event.key === 'ArrowUp' && index < 0)
        ? buttons.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % buttons.length
          : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div ref={listRef} aria-label="编程语言" className="flex flex-col gap-0.5" onKeyDown={onKeyDown}>
      {langs.map((id) => {
        const entry = getLangEntry(id);
        const selected = id === selectedLang;
        return (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={selected ? 'soft' : 'ghost'}
            data-selected={selected ? 'true' : undefined}
            onClick={() => {
              onSelect(id);
              onClose();
            }}
            className="w-full justify-start"
          >
            {selected ? <Check /> : null}
            <span className="min-w-0 truncate">{entry.label}</span>
            <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{id}</span>
          </Button>
        );
      })}
    </div>
  );
}

function LanguageMenu({
  langs,
  selectedLang,
  label,
  onSelect,
}: {
  langs: readonly string[];
  selectedLang: string;
  label: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Popover
      placement="bottom-start"
      className="p-1"
      trigger={({ ref, onClick, 'aria-expanded': expanded }) => (
        <Button ref={ref} type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-haspopup="true" onClick={onClick}>
          <span className="max-w-24 truncate">{label}</span>
          <ChevronDown />
        </Button>
      )}
    >
      {(close) => <LanguageMenuList langs={langs} selectedLang={selectedLang} onSelect={onSelect} onClose={close} />}
    </Popover>
  );
}

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
      <DialogContent size="md" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>IDE 设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 p-5">
          <MiniTabs
            size="sm"
            aria-label="设置分类"
            value={tab}
            onValueChange={setTab}
            items={categories.map((cat) => ({ value: cat.id, label: cat.label }))}
          />
          <div className="space-y-5">
            {tab === 'editor' && (
              <>
                <SettingRow label="字号">
                  <SimpleSelect
                    value={String(config.fontSize)}
                    onValueChange={(v) => onChange({ ...config, fontSize: +v })}
                    size="sm"
                    className="w-auto min-w-24"
                    ariaLabel="字号"
                    options={FONT_SIZE_OPTIONS.map((s) => ({
                      value: String(s),
                      label: `${s}px`,
                    }))}
                  />
                </SettingRow>

                <SettingRow label="Tab 宽度">
                  <MiniTabs
                    size="sm"
                    aria-label="Tab 宽度"
                    value={String(config.tabSize)}
                    onValueChange={(v) => onChange({ ...config, tabSize: Number(v) })}
                    items={[2, 4, 8].map((s) => ({ value: String(s), label: String(s) }))}
                  />
                </SettingRow>

                <SettingRow label="自动换行">
                  <Switch checked={config.wordWrap} onCheckedChange={(v) => onChange({ ...config, wordWrap: v })} aria-label="自动换行" />
                </SettingRow>
              </>
            )}

            {tab === 'appearance' && (
              <SettingRow label="字体">
                <SimpleSelect
                  value={config.fontFamily}
                  onValueChange={(v) => onChange({ ...config, fontFamily: v })}
                  size="sm"
                  className="w-full min-w-0 sm:w-auto"
                  ariaLabel="字体"
                  options={FONT_OPTIONS.map((f) => ({ value: f, label: f }))}
                />
              </SettingRow>
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
  const a = normalizePretestLineEndings(actual).split('\n');
  const b = normalizePretestLineEndings(expected).split('\n');
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

/**
 * Display verdict for a self-test run.
 *
 * The judge backend returns `STATUS_ACCEPTED` (1) for ANY program that merely
 * compiles and runs — a self-test is NOT diffed against an expected answer
 * server-side. So a raw `status === 1` must NOT be surfaced as "通过/AC": that
 * implies the output matched the expected output. We re-derive the verdict on
 * the client from the user-supplied expected output:
 *   - 'ac'      ran AND expected provided AND output matches
 *   - 'wa'      ran AND expected provided AND output differs (shown even though
 *               the backend said AC — this is the whole point)
 *   - 'ran'     ran AND no expected output to compare against (neutral)
 *   - 'fail'    a real failure status (WA/RE/TLE/MLE/CE/… : 2..19)
 *   - 'pending' still judging / queued (>=20 or 0)
 *   - 'none'    no result yet
 */
export function PretestResultInline({
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
  // The judge returns AC for any program that compiles+runs (it does NOT diff
  // the self-test output), so derive the shown verdict from the user's
  // expected output instead of the raw backend status. See selfTestVerdict.
  const verdict = selfTestVerdict(result, expectedOutput);
  const verdictDisplay =
    verdict === 'ac'
      ? { label: '通过 (Accepted)', className: 'text-success-fg' }
      : verdict === 'wa'
        ? { label: '答案错误 (Wrong Answer)', className: 'text-danger-fg' }
        : verdict === 'ran'
          ? { label: '运行完成', className: 'text-fg-subtle' }
          : status;
  const time = result.time != null ? `${result.time} ms` : '—';
  const memory = result.memory != null ? (result.memory >= 1024 ? `${(result.memory / 1024).toFixed(1)} MB` : `${result.memory} KB`) : '—';
  const actualOutput = pretestActualOutput(result);
  const compilerOutput = result.compilerTexts?.join('\n') || '';
  const stderr = result.stderr || '';
  const hasExpected = expectedOutput.trim().length > 0;
  const outputMatch = hasExpected && pretestOutputsMatch(actualOutput, expectedOutput);

  const tabs: { id: 'output' | 'diff' | 'compiler'; label: string; show: boolean }[] = [
    { id: 'output', label: '输出', show: true },
    { id: 'diff', label: hasExpected ? (outputMatch ? '✓ 匹配' : '✗ 差异') : '比对', show: hasExpected },
    { id: 'compiler', label: '编译', show: !!(compilerOutput || stderr) },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Result header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1">
        {verdict === 'ac' ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-success-fg" />
        ) : verdict === 'ran' ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-fg-subtle" />
        ) : (
          <XCircle className="size-3.5 shrink-0 text-danger-fg" />
        )}
        <span className={cn('min-w-0 truncate text-xs font-medium', verdictDisplay.className)}>{verdictDisplay.label}</span>
        <span className="shrink-0 text-2xs text-fg-subtle tabular">
          {time} · {memory}
        </span>
        {hasExpected && (
          <span className={cn('ml-auto shrink-0 text-2xs font-medium', outputMatch ? 'text-success-fg' : 'text-danger-fg')}>
            {outputMatch ? '输出匹配' : '输出不匹配'}
          </span>
        )}
      </div>

      {/* Result sub-tabs */}
      <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-line bg-surface-sunken px-1 scrollbar-none">
        {tabs
          .filter((t) => t.show)
          .map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={activeResultTab === tab.id ? 'soft' : 'ghost'}
              size="sm"
              onClick={() => onResultTabChange(tab.id)}
              className="shrink-0"
            >
              {tab.label}
            </Button>
          ))}
      </div>

      {/* Result content */}
      <ScrollArea orientation="both" className="flex-1 min-h-0">
        {activeResultTab === 'output' && <pre className="p-2 font-mono text-xs whitespace-pre-wrap break-all">{actualOutput || '(无输出)'}</pre>}

        {activeResultTab === 'diff' && hasExpected && (
          <div className="p-2 font-mono text-xs">
            {diffLines(actualOutput, expectedOutput).map((line, i) => (
              <div
                key={i}
                className={cn(
                  'px-1',
                  line.type === 'add' && 'bg-danger-soft text-danger-fg',
                  line.type === 'del' && 'bg-success-soft text-success-fg',
                )}
              >
                <span className="inline-block w-4 text-fg-subtle select-none">
                  {line.type === 'same' ? ' ' : line.type === 'add' ? '+' : '-'}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </div>
        )}

        {activeResultTab === 'compiler' && (
          <div className="p-2 space-y-2">
            {compilerOutput && <pre className="font-mono text-xs whitespace-pre-wrap break-all">{compilerOutput}</pre>}
            {stderr && <pre className="font-mono text-xs break-all whitespace-pre-wrap text-danger-fg">{stderr}</pre>}
          </div>
        )}

        {result.error && <div className="mx-2 mt-2 rounded-md bg-danger-soft p-2 text-xs text-danger-fg">{result.error}</div>}
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
  /** JSON polling URL template for pretest records. Pretests are not contest records. */
  pretestRecordUrlTemplate?: string;
  /** Whether pretest is available for this problem */
  canPretest?: boolean;
  /** Fallback submit handler when submitUrl is not provided */
  onSubmit?: (lang: string, code: string) => void;
  /** Custom CSS class */
  className?: string;
  /** Minimum editor height in px. Defaults to 0 when `className` includes `h-full`. */
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
  /** Extra toolbar actions rendered immediately after the records toggle. */
  toolbarAfterRecords?: ReactNode;
  /** Reload the authoritative bootstrap after a revision/role conflict. */
  reloadOnConflict?: boolean;
  /** Team Exam Mode read-only viewer: expose zoom controls while removing file-import DOM. */
  teamReadOnlyView?: boolean;
  /** Captain-only virtual print using the current unsaved editor buffer. */
  onSendToTeammates?: (buffer: { language: string; code: string }) => void;
  /** Effective server-issued practice policy: reject paste, drop, and file import while preserving normal editing. */
  prohibitExternalCodeInjection?: boolean;
  /** Opaque server-issued context attached to IDE submit and pretest requests. */
  practiceContextId?: string;
  /** Keep one draft per language inside a controlled practice identity. */
  isolateDraftByLanguage?: boolean;

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
  pretestRecordUrlTemplate,
  canPretest = false,
  onSubmit,
  className,
  minHeight: minHeightProp,
  cacheKey,
  samples = [],
  onRecordsChange,
  onToggleRecords,
  onOpenRecords,
  showRecordsButton = false,
  recordsVisible,
  recordsCount = 0,
  toolbarAfterRecords,
  reloadOnConflict = false,
  teamReadOnlyView = false,
  onSendToTeammates,
  prohibitExternalCodeInjection = false,
  practiceContextId,
  isolateDraftByLanguage = false,
  mode = 'full',
  value,
  onValueChange,
}: KryptonIDEProps) {
  const isSimple = mode === 'simple' || mode === 'readonly';
  const isReadOnly = mode === 'readonly';
  const fillsParentHeight = /\bh-full\b/.test(className ?? '');
  const minHeight = minHeightProp ?? (fillsParentHeight ? 0 : 400);
  const editorTheme = kryptonEditorTheme(useColorMode() === 'dark');
  /* ── refs ── */
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentRef = useRef(new Compartment());
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const codeCacheKeyRef = useRef<string | null>(null);
  const pretestAbort = useRef<AbortController | null>(null);
  const submitRef = useRef<() => void>(() => {});
  const pretestRef = useRef<() => void>(() => {});
  const pretestDragging = useRef(false);
  const pretestHDragging = useRef(false);
  const pretestVDragging = useRef(false);
  const pretestPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  /* ── state ── */
  const [selectedLang, setSelectedLang] = useState(() => {
    if (!isReadOnly) {
      try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved && (langs.length === 0 || langs.includes(saved))) return saved;
      } catch {
        /* empty */
      }
    }
    return isReadOnly ? resolveReadOnlyCodeLanguage(defaultLang, langs) : defaultLang || langs[0] || 'cc.cc17';
  });
  const [showPretest, setShowPretest] = useState(false);
  const [pretestHeight, setPretestHeight] = useState(200);
  // Per-tab loading + result state. A single pretest run owns a set of
  // tabIds (1 tab for the active case / F9, or every sample plus populated
  // custom tabs for the toolbar run-all action)
  // and writes per-tab results back into the map. Aborting a run clears
  // its own tabIds from `pretestRunning` only.
  const [pretestRunning, setPretestRunning] = useState<Set<string>>(new Set());
  const [pretestResults, setPretestResults] = useState<Map<string, PretestResult>>(new Map());
  const pretestLoading = pretestRunning.size > 0;
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [pasteError, setPasteError] = useState('');
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
  interface PretestTab {
    id: string;
    label: string;
    input: string;
    expectedOutput: string;
  }
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
  const samplesKey = useMemo(() => samples.map((s) => `${s.id}|${(s.input || '').length}|${(s.output || '').length}`).join('\n'), [samples]);
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
      if (
        prev.length === next.length &&
        prev.every((t, i) => t.id === next[i].id && t.input === next[i].input && t.expectedOutput === next[i].expectedOutput)
      ) {
        return prev;
      }
      return next;
    });
  }, [samplesKey]);

  const updateTabField = useCallback((tabId: string, field: 'input' | 'expectedOutput', nextValue: string) => {
    setPretestTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, [field]: nextValue } : t)));
  }, []);

  const addCustomTab = useCallback(() => {
    const id = `custom-${Date.now()}`;
    setPretestTabs((prev) => [
      ...prev,
      { id, label: `自定义 ${prev.filter((t) => t.id.startsWith('custom')).length + 1}`, input: '', expectedOutput: '' },
    ]);
    setActiveTestTab(id);
  }, []);

  const removeTab = useCallback(
    (tabId: string) => {
      setPretestTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) next.push({ id: 'custom', label: '自定义', input: '', expectedOutput: '' });
        return next;
      });
      setActiveTestTab((cur) => (cur === tabId ? pretestTabs[0]?.id || 'custom' : cur));
    },
    [pretestTabs],
  );

  /* ── config persistence ── */
  const updateConfig = useCallback((c: IdeConfig) => {
    setConfig(c);
    saveConfig(c);
  }, []);

  /* ── persist selected language ── */
  useEffect(() => {
    if (isReadOnly) return;
    try {
      localStorage.setItem(LANG_KEY, selectedLang);
    } catch {
      /* empty */
    }
  }, [isReadOnly, selectedLang]);

  /* A read-only record owns its language. Never reuse the author's cached
   * IDE choice, and update highlighting when another record opens. */
  useEffect(() => {
    if (!isReadOnly) return;
    setSelectedLang(resolveReadOnlyCodeLanguage(defaultLang, langs));
  }, [defaultLang, isReadOnly, langs]);

  /* ── helpers ── */
  const codeCacheKey =
    !isReadOnly && cacheKey ? `krypton:code:${cacheKey}${isolateDraftByLanguage ? `:${encodeURIComponent(selectedLang)}` : ''}` : null;
  codeCacheKeyRef.current = codeCacheKey;
  const previousCodeCacheKey = useRef(codeCacheKey);
  const getCode = useCallback(() => viewRef.current?.state.doc.toString() || '', []);

  const rejectExternalCodeInjection = useCallback(() => {
    setPasteError('当前真实性训练禁止粘贴或拖入外部代码，请在编辑器中直接编写。');
  }, []);

  /* ── CodeMirror extensions ── */
  const extensions = useMemo((): Extension[] => {
    const lang = getLangEntry(selectedLang);
    const fontCSS = `"${config.fontFamily}", "JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", "Menlo", monospace`;
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      highlightSelectionMatches(),
      ...(!isReadOnly
        ? [
            EditorView.domEventHandlers({
              paste(event, view) {
                if (prohibitExternalCodeInjection) {
                  event.preventDefault();
                  rejectExternalCodeInjection();
                  return true;
                }
                const data = event.clipboardData;
                if (!data) return false;
                if (data.getData('text/plain')) {
                  setPasteError('');
                  return false;
                }
                const alternate = readAlternatePlainText(data);
                if (!alternate) {
                  if (data.getData('text/uri-list')) {
                    setPasteError('');
                    return false;
                  }
                  const types = Array.from(data.types);
                  console.warn('[KryptonIDE] Clipboard paste rejected: no plain-text flavor', { types });
                  setPasteError('剪贴板没有可读取的纯文本代码，请在来源 IDE 中重新复制后再试。');
                  return true;
                }
                view.dispatch(view.state.replaceSelection(view.state.toText(alternate)), {
                  userEvent: 'input.paste',
                  scrollIntoView: true,
                });
                setPasteError('');
                return true;
              },
              beforeinput(event) {
                if (prohibitExternalCodeInjection && (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop')) {
                  event.preventDefault();
                  rejectExternalCodeInjection();
                  return true;
                }
                return false;
              },
              drop(event) {
                if (!prohibitExternalCodeInjection) return false;
                event.preventDefault();
                rejectExternalCodeInjection();
                return true;
              },
            }),
            ...(prohibitExternalCodeInjection
              ? [
                  EditorState.changeFilter.of((transaction) => {
                    const prohibited =
                      transaction.docChanged &&
                      (transaction.isUserEvent('input.paste') || transaction.isUserEvent('input.drop') || transaction.isUserEvent('move.drop'));
                    if (prohibited) rejectExternalCodeInjection();
                    return !prohibited;
                  }),
                ]
              : []),
          ]
        : []),
      ...(isReadOnly ? [] : [history(), dropCursor(), indentOnInput(), closeBrackets(), autocompletion(), rectangularSelection(), crosshairCursor()]),
      keymap.of(
        isReadOnly
          ? [...searchKeymap, ...foldKeymap]
          : [
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
              ...lintKeymap,
              indentWithTab,
              {
                key: 'F9',
                run: () => {
                  pretestRef.current();
                  return true;
                },
              },
              {
                key: 'F10',
                run: () => {
                  submitRef.current();
                  return true;
                },
                preventDefault: true,
              },
            ],
      ),
      lang.extension(),
      editorTheme,
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
          const save = () => {
            try {
              localStorage.setItem(codeCacheKey, update.state.doc.toString());
            } catch {
              /* empty */
            }
          };
          if (isolateDraftByLanguage) save();
          else cacheTimer.current = setTimeout(save, 500);
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
      ...(isReadOnly ? READ_ONLY_CODE_EXTENSIONS : []),
      /* Controlled value: emit onValueChange on each keystroke */
      ...(!isReadOnly && onValueChange
        ? [
            EditorView.updateListener.of((update) => {
              if (update.docChanged) onValueChange(update.state.doc.toString());
            }),
          ]
        : []),
    ];
  }, [
    selectedLang,
    config,
    editorTheme,
    codeCacheKey,
    isReadOnly,
    onValueChange,
    prohibitExternalCodeInjection,
    rejectExternalCodeInjection,
    isolateDraftByLanguage,
  ]);

  /* ── Create the editor once. Reconfigure keeps the cursor, selection, scroll, and undo stack. ── */
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent || viewRef.current) return;

    // Controlled `value` (simple/readonly mode) wins; otherwise fall back to
    // defaultCode or the cached document.
    let initialDoc = value ?? defaultCode;
    const initialCacheKey = codeCacheKeyRef.current;
    if (value == null && initialCacheKey) {
      const cached = localStorage.getItem(initialCacheKey);
      if (cached !== null) initialDoc = cached;
    }

    const state = EditorState.create({
      doc: initialDoc,
      extensions: compartmentRef.current.of(extensions),
    });
    const view = new EditorView({ state, parent });
    viewRef.current = view;

    return () => {
      clearTimeout(cacheTimer.current);
      const key = codeCacheKeyRef.current;
      if (key) {
        try {
          localStorage.setItem(key, view.state.doc.toString());
        } catch {
          /* The existing IDE cache is best-effort; submit remains available. */
        }
      }
      view.destroy();
      viewRef.current = null;
    };
    // Mount only. A later extensions change must not destroy this view.
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartmentRef.current.reconfigure(extensions),
    });
  }, [extensions]);

  useEffect(() => {
    if (!isolateDraftByLanguage || previousCodeCacheKey.current === codeCacheKey) return;
    previousCodeCacheKey.current = codeCacheKey;
    const view = viewRef.current;
    if (!view) return;
    let next = defaultCode;
    if (codeCacheKey) {
      try {
        next = localStorage.getItem(codeCacheKey) ?? defaultCode;
      } catch {
        next = defaultCode;
      }
    }
    if (view.state.doc.toString() !== next) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    }
  }, [codeCacheKey, defaultCode, isolateDraftByLanguage]);

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
        const res = await fetchHydroResponse(url, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(await readHydroResponseError(res, '加载提交状态失败'));
        const rdoc = parseRecordResponse(await res.json());
        const s = rdoc.status;
        setRecords((prev) => prev.map((r) => (r.rid === rid ? { ...r, status: s, score: rdoc.score, time: rdoc.time, memory: rdoc.memory } : r)));
        if (isTerminalJudgeStatus(s)) return;
      } catch (error) {
        console.error('Problem record polling failed', {
          rid,
          url,
          attempt: i + 1,
          error,
        });
      }
    }
    console.error('Problem record polling timed out', { rid, url, attempts: 120 });
  }, []);

  const resolveRecordUrl = useCallback(
    (rid: string, fallback?: string) => {
      if (recordUrlTemplate) {
        return recordUrlTemplate.replace(/__RID__/g, encodeURIComponent(rid));
      }
      return fallback || `/record/${rid}`;
    },
    [recordUrlTemplate],
  );

  const resolvePretestRecordUrl = useCallback(
    (rid: string, fallback?: string) => {
      if (pretestRecordUrlTemplate) {
        return pretestRecordUrlTemplate.replace(/__RID__/g, encodeURIComponent(rid));
      }
      return fallback || `/record/${rid}`;
    },
    [pretestRecordUrlTemplate],
  );

  /* ── Submit handler ── */
  const handleSubmit = useCallback(async () => {
    if (isReadOnly) return;
    if (submitting || submitCooldown > 0) return;
    const code = getCode();
    if (!code.trim()) return;

    if (!submitUrl) {
      onSubmit?.(selectedLang, code);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetchHydroResponse(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lang: selectedLang, code, ...(practiceContextId ? { practiceContextId } : {}) }),
        credentials: 'same-origin',
      });
      if (res.status === 409 && reloadOnConflict) {
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error(await readHydroResponseError(res, '提交失败'));
      if (res.redirected) throw new Error('提交响应发生了非预期重定向');

      const data: unknown = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('提交响应不是有效对象');
      }
      const payload = data as Record<string, unknown>;
      let rid = '';
      if (payload.rid !== undefined) {
        if (typeof payload.rid !== 'string' || !payload.rid.trim()) throw new Error('提交响应包含无效记录编号');
        rid = payload.rid.trim();
      }
      let responseUrl = '';
      if (payload.url !== undefined) {
        if (typeof payload.url !== 'string' || !payload.url.trim()) throw new Error('提交响应包含无效跳转地址');
        responseUrl = sameOriginSubmissionUrl(payload.url.trim());
      }
      if (rid) {
        const url = sameOriginSubmissionUrl(resolveRecordUrl(rid, responseUrl || `/record/${rid}`));
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
      if (responseUrl) {
        window.location.href = responseUrl;
        return;
      }
      throw new Error('提交响应缺少记录编号或跳转地址');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '提交失败，请检查网络后重试';
      setSubmitError(message);
      console.error('Problem submission failed', {
        submitUrl,
        language: selectedLang,
        error,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    submitUrl,
    selectedLang,
    getCode,
    isReadOnly,
    onSubmit,
    onOpenRecords,
    submitting,
    submitCooldown,
    pollRecord,
    reloadOnConflict,
    resolveRecordUrl,
    practiceContextId,
  ]);

  /* ── Pretest handler ──
   *  Runs one or more tabs in a single backend pretest request. The judge
   *  treats `input: string[]` as N test cases sharing one record. Cases may
   *  finish out of order, so the response's one-based `case.id` is the only
   *  binding key; array position is merely completion order. We fan results
   *  out into `pretestResults` so each tab stays independent.
   *
   *  Why a single request instead of N sequential POSTs:
   *   - one rate-limiter consumption (limit.pretest defaults to 60/min)
   *   - one judge queue slot, so "run all" stays atomic
   *   - results stream in together — easier to render partial progress
   */
  const runPretestForTabs = useCallback(
    async (tabIds: string[], includeEmpty = false) => {
      if (isReadOnly) return;
      if (!submitUrl || !canPretest) return;
      const tabs = tabIds
        .map((id) => pretestTabs.find((t) => t.id === id))
        .filter((t): t is PretestTab => !!t && (includeEmpty || t.id.startsWith('sample-') || t.input.length > 0 || t.expectedOutput.length > 0));
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

      const distributeFromRdoc = (rdoc: PretestResult) => {
        const distributed = distributePretestRecord(rdoc, runningIds);
        setPretestResults((prev) => {
          const m = new Map(prev);
          for (const [tabId, result] of distributed) m.set(tabId, result);
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
        const res = await fetchHydroResponse(submitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            lang: selectedLang,
            code,
            pretest: true,
            input: tabs.map((t) => t.input),
            ...(practiceContextId ? { practiceContextId } : {}),
          }),
          signal: abort.signal,
          credentials: 'same-origin',
        });
        if (res.status === 409 && reloadOnConflict) {
          window.location.reload();
          return;
        }
        if (!res.ok) throw new Error(await readHydroResponseError(res, '自测提交失败'));

        const data = await res.json();
        const rid = data.rid ? String(data.rid) : '';
        if (!rid) throw new Error('自测提交响应中没有记录编号');

        const recordUrl = resolvePretestRecordUrl(rid, data.url || `/record/${rid}`);

        // Multi-case runs need more headroom — judge time scales with N.
        const maxAttempts = tabs.length > 1 ? 90 : 60;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          if (abort.signal.aborted) return;

          const rRes = await fetchHydroResponse(recordUrl, {
            headers: { Accept: 'application/json' },
            signal: abort.signal,
            credentials: 'same-origin',
          });
          if (!rRes.ok) throw new Error(await readHydroResponseError(rRes, '评测记录加载失败'));
          const contentType = rRes.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            throw new Error('评测记录接口返回了非 JSON，请检查记录轮询地址');
          }
          const rdoc = parseRecordResponse(await rRes.json());
          const s = rdoc.status;
          distributeFromRdoc(rdoc);

          if (isTerminalJudgeStatus(s)) {
            setPretestResultTab(preferredPretestResultTab(rdoc));
            return;
          }
        }

        setErrorForAll(8, '评测超时，请稍后重试');
      } catch (e) {
        if ((e as ErrorLike).name !== 'AbortError') {
          setErrorForAll(8, (e as ErrorLike).message || '请求失败');
        }
      } finally {
        setPretestRunning((prev) => {
          const s = new Set(prev);
          runningIds.forEach((id) => s.delete(id));
          return s;
        });
      }
    },
    [submitUrl, canPretest, pretestTabs, selectedLang, getCode, isReadOnly, reloadOnConflict, resolvePretestRecordUrl, practiceContextId],
  );

  /** Toolbar run-all control — run all samples and populated custom tabs in one request. */
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
    runPretestForTabs([activeTab.id], true);
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

      // Horizontal drag (left/right split); stacked accordion uses vertical motion.
      if (pretestHDragging.current && pretestPanelRef.current) {
        const rect = pretestPanelRef.current.getBoundingClientRect();
        const stacked =
          typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px), (max-height: 500px)').matches;
        const pct = stacked ? ((e.clientY - rect.top) / rect.height) * 100 : ((e.clientX - rect.left) / rect.width) * 100;
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
    const flushDraft = () => {
      clearTimeout(cacheTimer.current);
      if (!codeCacheKey || !viewRef.current) return;
      try {
        localStorage.setItem(codeCacheKey, viewRef.current.state.doc.toString());
      } catch {
        /* The existing IDE cache is best-effort; submit remains available. */
      }
    };
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [codeCacheKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pretestAbort.current?.abort();
    };
  }, []);

  /* ── Escape exits fullscreen. An open language popover consumes Escape first. ── */
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
  }, [submitCooldown > 0]);

  /* ── Pretest cooldown timer ── */
  useEffect(() => {
    if (pretestCooldown <= 0) return;
    const t = setInterval(() => setPretestCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [pretestCooldown > 0]);

  /* ── File upload handler ── */
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isReadOnly || prohibitExternalCodeInjection) {
        if (prohibitExternalCodeInjection) rejectExternalCodeInjection();
        e.target.value = '';
        return;
      }
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
    [isReadOnly, prohibitExternalCodeInjection, rejectExternalCodeInjection],
  );

  /* ── Reset code handler ── */
  const handleReset = useCallback(async () => {
    if (isReadOnly) return;
    if (!(await confirmDialog('未保存的修改会被默认代码替换。', { title: '重置代码？', confirmLabel: '重置', destructive: true }))) return;
    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: defaultCode },
      });
    }
    if (codeCacheKey) {
      try {
        localStorage.removeItem(codeCacheKey);
      } catch {
        /* empty */
      }
    }
  }, [defaultCode, codeCacheKey, isReadOnly]);

  const handleLanguageChange = useCallback(
    (next: string) => {
      if (next === selectedLang) return;
      if (isolateDraftByLanguage && codeCacheKey) {
        clearTimeout(cacheTimer.current);
        try {
          localStorage.setItem(codeCacheKey, getCode());
        } catch {
          /* The existing IDE cache is best-effort; submit remains available. */
        }
      }
      setSelectedLang(next);
    },
    [codeCacheKey, getCode, isolateDraftByLanguage, selectedLang],
  );

  /* ── Derived values ── */
  const availableLangs = langs.length > 0 ? langs : Object.keys(LANGUAGES);
  const langLabel = getLangEntry(selectedLang).label;
  const readOnlyFontIndex = Math.max(0, FONT_SIZE_OPTIONS.indexOf(config.fontSize));

  /* ── Render ── */
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface',
        fillsParentHeight && 'min-h-0',
        fullscreen && 'fixed inset-0 z-50 h-dvh rounded-none pb-safe pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      {/* ── Toolbar (hidden in simple/readonly mode) ── */}
      {!isSimple ? (
        <div className="flex min-w-0 shrink-0 items-center border-b border-line bg-surface-sunken">
        <ScrollArea
          orientation="horizontal"
          viewportLayout="flex"
          className="min-w-0 flex-1"
          viewportClassName="px-2 py-1 [&>div]:items-center [&>div]:gap-1"
        >
          <LanguageMenu langs={availableLangs} selectedLang={selectedLang} label={langLabel} onSelect={handleLanguageChange} />

          {/* Pretest toggle + Run */}
          {canPretest && submitUrl && (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowPretest((p) => !p)}>
                <Terminal />
                自测
                {showPretest ? <ChevronUp /> : <ChevronDown />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-[7.25rem] shrink-0" // ds-allow DS004: 倒计时把「运行全部自测」换成秒数时，间距档位没有能稳住这行文案的宽度，按钮一缩旁边的提交就会移位
                disabled={pretestLoading || pretestCooldown > 0}
                onClick={handleRunAll}
                title="一次评测所有样例和已填写的自定义 tab"
              >
                {pretestLoading ? (
                  <Loader2 className="animate-spin" />
                ) : pretestCooldown > 0 ? (
                  <Clock />
                ) : (
                  <Play />
                )}
                {pretestCooldown > 0 ? `${pretestCooldown}s` : '运行全部自测'}
              </Button>
            </>
          )}

          {onSendToTeammates ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                onSendToTeammates({
                  language: selectedLang,
                  code: viewRef.current?.state.doc.toString() || '',
                })
              }
            >
              <Printer />
              发送给队友
            </Button>
          ) : null}

          {/* Records toggle */}
          {showRecordsButton && (
            <Button
              type="button"
              variant={(recordsVisible ?? showRecords) ? 'secondary' : 'ghost'}
              size="sm"
              onClick={onToggleRecords}
              title={(recordsVisible ?? showRecords) ? '收起提交记录' : '展开提交记录'}
            >
              <History />
              <span>提交记录</span>
              {recordsCount > 0 ? (
                <span className="rounded-sm bg-surface-active px-1 font-mono text-2xs text-fg-subtle tabular">{recordsCount}</span>
              ) : null}
            </Button>
          )}
          {toolbarAfterRecords}

          <div className="flex-1" />

          {/* Upload file */}
          {!prohibitExternalCodeInjection ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              onClick={() => fileInputRef.current?.click()}
              aria-label="上传代码文件"
              title="上传代码文件"
            >
              <FileUp />
            </Button>
          ) : null}

          {/* Reset code */}
          <Button type="button" variant="danger-soft" size="sm" iconOnly onClick={handleReset} aria-label="重置代码" title="重置代码">
            <RotateCcw />
          </Button>

          {/* Settings */}
          <Button type="button" variant="ghost" size="sm" iconOnly onClick={() => setShowSettings(true)} aria-label="设置" title="设置">
            <Settings2 />
          </Button>

          {/* Fullscreen */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setFullscreen((p) => !p)}
            aria-label={fullscreen ? '退出全屏' : '全屏'}
            title={fullscreen ? '退出全屏' : '全屏'}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </ScrollArea>
          {(submitUrl || onSubmit) && (
            <div className="flex shrink-0 items-center self-stretch border-l border-line px-2">
              <Button type="button" variant="primary" size="sm" className="shrink-0" disabled={submitting || submitCooldown > 0} onClick={handleSubmit}>
                {submitting ? <Loader2 className="animate-spin" /> : submitCooldown > 0 ? <Clock /> : <Send />}
                {submitCooldown > 0 ? `${submitCooldown}s` : '提交'}
                <Kbd className="hidden sm:inline-flex">F10</Kbd>
              </Button>
            </div>
          )}
        </div>
      ) : isReadOnly && teamReadOnlyView ? (
        <div data-readonly-code-toolbar className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1 text-xs">
          <span className="min-w-0 truncate font-medium">{langLabel}</span>
          <span className="shrink-0 text-fg-subtle">只读</span>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="缩小只读代码字号"
            title="缩小字号"
            disabled={readOnlyFontIndex === 0}
            onClick={() => updateConfig({ ...config, fontSize: FONT_SIZE_OPTIONS[Math.max(0, readOnlyFontIndex - 1)] })}
          >
            <Minus />
          </Button>
          <span className="min-w-10 shrink-0 text-center font-mono text-fg-subtle tabular">{config.fontSize}px</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="放大只读代码字号"
            title="放大字号"
            disabled={readOnlyFontIndex === FONT_SIZE_OPTIONS.length - 1}
            onClick={() => updateConfig({ ...config, fontSize: FONT_SIZE_OPTIONS[Math.min(FONT_SIZE_OPTIONS.length - 1, readOnlyFontIndex + 1)] })}
          >
            <Plus />
          </Button>
        </div>
      ) : null}

      {submitError ? (
        <div role="alert" className="shrink-0 border-b border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {submitError}
        </div>
      ) : null}

      {pasteError ? (
        <div role="alert" className="shrink-0 border-b border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-fg">
          {pasteError}
        </div>
      ) : null}

      {/* ── Editor area ── */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden bg-surface"
        style={{
          minHeight: fullscreen ? undefined : minHeight,
        }}
      />

      {/* ── Status bar ── */}
      <div className="flex items-center border-t border-line bg-surface-sunken px-3 py-0.5 text-2xs text-fg-subtle">
        <span className="shrink-0 tabular">
          Ln {cursorPos.line}, Col {cursorPos.col}
        </span>
        <div className="flex-1" />
        <span className="min-w-0 truncate">{langLabel}</span>
      </div>

      {/* ── Pretest panel (multi-tab, inline results) ── */}
      {!isSimple && showPretest && canPretest && (
        <div className="flex flex-col border-t border-line" style={{ height: pretestHeight, minHeight: 120 }}>
          {/* Drag handle — top edge for panel height */}
          <div
            className="h-1.5 shrink-0 cursor-row-resize bg-line transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-brand"
            onMouseDown={() => {
              pretestDragging.current = true;
              document.body.style.cursor = 'row-resize';
              document.body.style.userSelect = 'none';
            }}
          />

          {/* Tab bar — each tab carries an inline pass/fail/judging badge
              so "运行全部自测" results are scannable without clicking through
              every tab. */}
          <div className="flex shrink-0 items-center gap-0 overflow-x-auto overflow-y-hidden border-b border-line bg-surface-sunken px-1 scrollbar-none">
            {pretestTabs.map((tab) => {
              const tabResult = pretestResults.get(tab.id);
              const tabBusy = pretestRunning.has(tab.id);
              // Badge reflects whether the program output matches THIS tab's
              // expected output — not the raw backend AC (which only means
              // "compiled & ran"; the self-test isn't diffed server-side).
              const tabVerdict = selfTestVerdict(tabResult, tab.expectedOutput || '');
              const canCloseCustom =
                tab.id.startsWith('custom') && pretestTabs.filter((item) => item.id.startsWith('custom') || item.id === 'custom').length > 1;
              return (
                <div key={tab.id} className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant={activeTestTab === tab.id ? 'soft' : 'ghost'}
                    size="sm"
                    onClick={() => setActiveTestTab(tab.id)}
                    className="shrink-0"
                  >
                    {tabBusy ? (
                      <Loader2 className="animate-spin text-fg-subtle" />
                    ) : tabVerdict === 'ac' ? (
                      <CheckCircle2 className="text-success-fg" />
                    ) : tabVerdict === 'ran' ? (
                      <CheckCircle2 className="text-fg-subtle" />
                    ) : tabVerdict === 'wa' || tabVerdict === 'fail' ? (
                      <XCircle className="text-danger-fg" />
                    ) : null}
                    <span className="max-w-24 truncate">{tab.label}</span>
                  </Button>
                  {canCloseCustom ? (
                    <Button type="button" variant="ghost" size="sm" iconOnly aria-label={`关闭${tab.label}`} onClick={() => removeTab(tab.id)}>
                      <XCircle />
                    </Button>
                  ) : null}
                </div>
              );
            })}
            <Button type="button" variant="ghost" size="sm" iconOnly onClick={addCustomTab} aria-label="添加自定义测试" title="添加自定义测试">
              <Plus />
            </Button>
            <div className="flex-1" />
            {/* Per-tab run button — runs only the active tab; F9 shortcut */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pretestLoading || pretestCooldown > 0}
              onClick={handleRunActive}
              title="运行当前自测 (F9)"
            >
              {pretestRunning.has(activeTab.id) ? <Loader2 className="animate-spin" /> : <Play />}
              运行此自测
              <Kbd className="hidden sm:inline-flex">F9</Kbd>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPretest(false)}>
              收起
            </Button>
          </div>

          {/* Tab content: own split class so page `.krypton-split` 46% stacking never applies. */}
          <div
            ref={pretestPanelRef}
            className="krypton-pretest-split relative flex min-h-0 flex-1 overflow-hidden max-md:flex-col [@media(max-height:500px)]:flex-col"
          >
            {/* Crosshair at intersection of horizontal and vertical drag handles */}
            <div
              className="absolute z-10 cursor-move bg-line transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-brand max-md:hidden [@media(max-height:500px)]:hidden"
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
            <div
              className="krypton-pretest-split-pane flex min-h-0 min-w-0 flex-col overflow-hidden max-md:!h-auto max-md:!w-full max-md:flex-1 [@media(max-height:500px)]:!h-auto [@media(max-height:500px)]:!w-full [@media(max-height:500px)]:flex-1"
              style={{ width: `${pretestLeftPct}%` }}
            >
              {/* Input section */}
              <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: `${pretestInputPct}%` }}>
                <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1">
                  <span className="text-2xs font-medium text-fg-subtle">输入</span>
                  {isSampleTab && <span className="text-2xs text-fg-subtle">· 样例（只读）</span>}
                </div>
                {isSampleTab ? (
                  <pre className="min-h-0 w-full flex-1 overflow-auto bg-bg p-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {activeTab.input || '(空)'}
                  </pre>
                ) : (
                  <Textarea
                    value={activeTab.input}
                    onChange={(e) => updateTabField(activeTestTab, 'input', e.target.value)}
                    placeholder="在此输入测试数据…"
                    className="min-h-0 flex-1 resize-none rounded-none border-0 bg-bg p-2 font-mono text-xs shadow-none"
                  />
                )}
              </div>

              {/* Vertical drag handle (between input and expected output) */}
              <div
                className="h-1 shrink-0 cursor-row-resize bg-line transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-brand"
                onMouseDown={() => {
                  pretestVDragging.current = true;
                  document.body.style.cursor = 'row-resize';
                  document.body.style.userSelect = 'none';
                }}
              />

              {/* Expected output section */}
              <div className="flex flex-col min-h-0 overflow-hidden" style={{ height: `${100 - pretestInputPct}%` }}>
                <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1">
                  <span className="min-w-0 truncate text-2xs font-medium text-fg-subtle">期望输出{isSampleTab ? '' : '（可选）'}</span>
                </div>
                {isSampleTab ? (
                  <pre className="min-h-0 w-full flex-1 overflow-auto bg-bg p-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {activeTab.expectedOutput || '(空)'}
                  </pre>
                ) : (
                  <Textarea
                    value={activeTab.expectedOutput}
                    onChange={(e) => updateTabField(activeTestTab, 'expectedOutput', e.target.value)}
                    placeholder="输入期望输出以便自动比对…"
                    className="min-h-0 flex-1 resize-none rounded-none border-0 bg-bg p-2 font-mono text-xs shadow-none"
                  />
                )}
              </div>
            </div>

            {/* Horizontal drag handle (between left and right) — has special cursor at intersection with vertical handle */}
            <div
              className="krypton-pretest-split-handle w-1 shrink-0 cursor-col-resize bg-line transition-colors duration-(--dur-1) ease-(--ease-standard) hover:bg-brand max-md:h-1.5 max-md:!w-full max-md:cursor-row-resize [@media(max-height:500px)]:h-1.5 [@media(max-height:500px)]:!w-full [@media(max-height:500px)]:cursor-row-resize"
              onMouseDown={() => {
                pretestHDragging.current = true;
                const stacked =
                  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px), (max-height: 500px)').matches;
                document.body.style.cursor = stacked ? 'row-resize' : 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />

            {/* Right: result panel — bound to the currently-active tab. Each
                tab keeps its own latest result in `pretestResults`, so
                switching tabs while a "运行全部自测" pass is mid-judge shows
                the per-tab progress without races. */}
            <div
              className="krypton-pretest-split-pane flex min-h-0 min-w-0 flex-col overflow-hidden max-md:!h-auto max-md:!w-full max-md:flex-1 [@media(max-height:500px)]:!h-auto [@media(max-height:500px)]:!w-full [@media(max-height:500px)]:flex-1"
              style={{ width: `${100 - pretestLeftPct}%` }}
            >
              {(() => {
                const result = pretestResults.get(activeTab.id) || null;
                const thisTabRunning = pretestRunning.has(activeTab.id);
                if (thisTabRunning && !result) {
                  return (
                    <div className="flex flex-1 items-center justify-center gap-2 text-xs text-fg-subtle">
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
                  <div className="flex flex-1 flex-col items-center justify-center gap-1 px-3 text-center text-xs text-fg-subtle">
                    <div>按 F9 或点击"运行此自测"测试当前 tab</div>
                    <div className="text-2xs">"运行全部自测" 一次评测所有样例和已填写的自定义 tab</div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Dialogs ── */}
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} config={config} onChange={updateConfig} />

      {/* ── Hidden file input ── */}
      {(!isReadOnly || !teamReadOnlyView) && !prohibitExternalCodeInjection ? (
        <input
          ref={fileInputRef}
          type="file"
          accept=".c,.cc,.cpp,.cxx,.h,.hpp,.py,.java,.js,.ts,.go,.rs,.rb,.cs,.hs,.php,.kt,.pas,.txt"
          className="hidden"
          aria-label="上传代码文件"
          onChange={handleFileUpload}
        />
      ) : null}
    </div>
  );
}
