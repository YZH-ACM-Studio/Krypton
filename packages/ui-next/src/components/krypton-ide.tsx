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
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Send,
  Settings2,
  Terminal,
  XCircle,
} from 'lucide-react';

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

function getLangEntry(id: string): LangEntry {
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

function getStatus(s: number): StatusDisplay {
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
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function OutputBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">
        {content || '(空)'}
      </pre>
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
      <DialogContent className="w-130" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>IDE 设置</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-75">
          {/* Left nav */}
          <nav className="w-36 shrink-0 border-r bg-muted/30 p-2 space-y-0.5">
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
/*  Pretest result dialog                                              */
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

function PretestResultDialog({
  open,
  onOpenChange,
  result,
  input,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: PretestResult | null;
  input: string;
}) {
  if (!result) return null;

  const status = getStatus(result.status ?? 8);
  const isAccepted = result.status === 1;
  const time = result.time != null ? `${result.time} ms` : '—';
  const memory =
    result.memory != null
      ? result.memory >= 1024
        ? `${(result.memory / 1024).toFixed(1)} MB`
        : `${result.memory} KB`
      : '—';
  const output =
    result.testCases?.[0]?.message ||
    result.stdout ||
    result.judgeTexts?.join('\n') ||
    '';
  const compilerOutput = result.compilerTexts?.join('\n') || '';
  const stderr = result.stderr || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-125 max-w-[95vw]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>自测结果</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6 pt-2">
          {/* Status banner */}
          <div className="flex items-center gap-3">
            {isAccepted ? (
              <CheckCircle2 className="size-8 shrink-0 text-green-500" />
            ) : (
              <XCircle className="size-8 shrink-0 text-red-500" />
            )}
            <div>
              <p className={cn('text-lg font-bold', status.className)}>{status.label}</p>
              <p className="text-xs text-muted-foreground">
                用时 {time} · 内存 {memory}
              </p>
            </div>
          </div>

          <OutputBlock label="输入" content={input} />
          {output && <OutputBlock label="输出" content={output} />}
          {compilerOutput && <OutputBlock label="编译信息" content={compilerOutput} />}
          {stderr && <OutputBlock label="错误输出" content={stderr} />}

          {result.error && (
            <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">
              {result.error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  const [pretestInput, setPretestInput] = useState('');
  const [pretestHeight, setPretestHeight] = useState(150);
  const [pretestLoading, setPretestLoading] = useState(false);
  const [pretestResult, setPretestResult] = useState<PretestResult | null>(null);
  const [showPretestResult, setShowPretestResult] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [config, setConfig] = useState<IdeConfig>(loadConfig);

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

  /* ── Submit handler ── */
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
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
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      }
      // Fallback
      onSubmit?.(selectedLang, code);
    } catch {
      onSubmit?.(selectedLang, code);
    } finally {
      setSubmitting(false);
    }
  }, [submitUrl, selectedLang, getCode, onSubmit, submitting]);

  /* ── Pretest handler ── */
  const handlePretest = useCallback(async () => {
    if (!submitUrl || pretestLoading || !canPretest) return;

    // Auto-show panel if hidden
    if (!showPretest) {
      setShowPretest(true);
      return;
    }

    pretestAbort.current?.abort();
    const abort = new AbortController();
    pretestAbort.current = abort;
    setPretestLoading(true);

    try {
      const code = getCode();
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lang: selectedLang, code, pretest: true, input: [pretestInput] }),
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
          setShowPretestResult(true);
          return;
        }
      }

      setPretestResult({ status: 8, error: '评测超时，请稍后重试' });
      setShowPretestResult(true);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setPretestResult({ status: 8, error: e.message || '请求失败' });
        setShowPretestResult(true);
      }
    } finally {
      setPretestLoading(false);
    }
  }, [submitUrl, selectedLang, pretestInput, pretestLoading, canPretest, showPretest, getCode]);

  /* ── Ref bridge so keymap closures always call latest handlers ── */
  submitRef.current = handleSubmit;
  pretestRef.current = handlePretest;

  /* ── Pretest panel resize via drag ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!pretestDragging.current) return;
      e.preventDefault();
      // The parent container is the IDE root; measure from its bottom
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const newH = rect.bottom - e.clientY;
      setPretestHeight(Math.max(60, Math.min(rect.height * 0.6, newH)));
    };
    const onUp = () => {
      if (!pretestDragging.current) return;
      pretestDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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
      pretestAbort.current?.abort();
      clearTimeout(cacheTimer.current);
    };
  }, []);

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
      <div className="flex items-center gap-1 border-b bg-muted/50 px-2 py-1">
        {/* Language selector */}
        <div className="relative">
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
              disabled={pretestLoading}
              onClick={handlePretest}
            >
              {pretestLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              运行
              <kbd className="ml-0.5 rounded border bg-muted px-1 text-[10px] font-normal">F9</kbd>
            </Button>
          </>
        )}

        {/* Submit */}
        {(submitUrl || onSubmit) && (
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Send className="size-3" />
            )}
            提交
            <kbd className="ml-0.5 rounded bg-primary-foreground/20 px-1 text-[10px] font-normal">
              F10
            </kbd>
          </Button>
        )}

        <div className="flex-1" />

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
        onClick={() => setShowLangMenu(false)}
      />

      {/* ── Pretest input panel (collapsible, resizable height) ── */}
      {showPretest && canPretest && (
        <div className="border-t" style={{ height: pretestHeight, minHeight: 60 }}>
          {/* Drag handle — top edge */}
          <div
            className="h-1.5 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/40 active:bg-primary/60"
            onMouseDown={() => {
              pretestDragging.current = true;
              document.body.style.cursor = 'row-resize';
              document.body.style.userSelect = 'none';
            }}
          />
          <div className="flex h-[calc(100%-6px)] flex-col">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
              <Terminal className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">自测输入</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setShowPretest(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                收起
              </button>
            </div>
            <textarea
              value={pretestInput}
              onChange={(e) => setPretestInput(e.target.value)}
              placeholder="在此输入测试数据…"
              className="block flex-1 w-full resize-none border-0 bg-background p-3 font-mono text-xs focus:outline-none"
            />
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
      <PretestResultDialog
        open={showPretestResult}
        onOpenChange={setShowPretestResult}
        result={pretestResult}
        input={pretestInput}
      />
    </div>
  );
}
