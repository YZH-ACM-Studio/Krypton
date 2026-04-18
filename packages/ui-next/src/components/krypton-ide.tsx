/**
 * KryptonIDE — A full-featured code editor built on CodeMirror 6.
 *
 * Features:
 *  - Syntax highlighting for C/C++, Python, Java, JavaScript, Go, Rust
 *  - Auto-closing brackets/quotes
 *  - Line numbers, active-line highlight, bracket matching
 *  - Search & replace (Ctrl/Cmd+F)
 *  - Code folding
 *  - Customizable themes (light / dark / One Dark)
 *  - Configurable font size, tab size, word wrap
 *  - Language selector
 *  - LSP-ready interface (placeholder hooks)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';

// Language support
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';

// Themes
import { oneDark } from '@codemirror/theme-one-dark';

import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  Moon,
  Play,
  Settings2,
  Sun,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Language registry                                                  */
/* ------------------------------------------------------------------ */

interface LangEntry {
  label: string;
  extension: () => Extension;
  /** CodeMirror language name for file-type detection */
  cmName?: string;
}

const LANGUAGES: Record<string, LangEntry> = {
  'cc.cc17': { label: 'C++17', extension: cpp },
  'cc.cc20': { label: 'C++20', extension: cpp },
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

/* ------------------------------------------------------------------ */
/*  Theme helpers                                                      */
/* ------------------------------------------------------------------ */

type ThemeName = 'light' | 'dark' | 'oneDark';

function themeExtension(name: ThemeName): Extension {
  if (name === 'oneDark') return oneDark;
  if (name === 'dark') {
    return EditorView.theme({
      '&': { backgroundColor: '#1e1e2e', color: '#cdd6f4' },
      '.cm-gutters': { backgroundColor: '#181825', color: '#6c7086', borderRight: '1px solid #313244' },
      '.cm-activeLineGutter': { backgroundColor: '#313244' },
      '.cm-activeLine': { backgroundColor: '#31324420' },
      '&.cm-focused .cm-cursor': { borderLeftColor: '#89b4fa' },
      '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#45475a' },
      '.cm-selectionBackground': { backgroundColor: '#45475a' },
    }, { dark: true });
  }
  // Light (default)
  return EditorView.theme({
    '&': { backgroundColor: '#ffffff', color: '#1e293b' },
    '.cm-gutters': { backgroundColor: '#f8fafc', color: '#94a3b8', borderRight: '1px solid #e2e8f0' },
    '.cm-activeLineGutter': { backgroundColor: '#f1f5f9' },
    '.cm-activeLine': { backgroundColor: '#f1f5f910' },
  });
}

/* ------------------------------------------------------------------ */
/*  LSP interface (placeholder for future implementation)              */
/* ------------------------------------------------------------------ */

export interface LspClient {
  /** Request completion items at a position */
  complete?: (params: { uri: string; line: number; character: number }) => Promise<Array<{ label: string; kind?: string; detail?: string }>>;
  /** Request hover info */
  hover?: (params: { uri: string; line: number; character: number }) => Promise<{ contents: string } | null>;
  /** Request diagnostics */
  diagnostics?: (params: { uri: string }) => Promise<Array<{ line: number; character: number; message: string; severity: string }>>;
}

/* ------------------------------------------------------------------ */
/*  IDE Config panel                                                   */
/* ------------------------------------------------------------------ */

interface IdeConfig {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  theme: ThemeName;
}

function ConfigPanel({
  config,
  onChange,
  open,
}: {
  config: IdeConfig;
  onChange: (c: IdeConfig) => void;
  open: boolean;
}) {
  if (!open) return null;
  return (
    <div className="absolute right-2 top-10 z-50 w-56 rounded-lg border bg-popover p-3 shadow-lg">
      <h4 className="mb-2 text-xs font-semibold">编辑器设置</h4>

      <label className="mb-2 flex items-center justify-between text-xs">
        <span>字号</span>
        <select
          value={config.fontSize}
          onChange={(e) => onChange({ ...config, fontSize: +e.target.value })}
          className="rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          {[12, 13, 14, 15, 16, 18, 20].map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
      </label>

      <label className="mb-2 flex items-center justify-between text-xs">
        <span>Tab 宽度</span>
        <select
          value={config.tabSize}
          onChange={(e) => onChange({ ...config, tabSize: +e.target.value })}
          className="rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          {[2, 4, 8].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      <label className="mb-2 flex items-center justify-between text-xs">
        <span>自动换行</span>
        <input
          type="checkbox"
          checked={config.wordWrap}
          onChange={(e) => onChange({ ...config, wordWrap: e.target.checked })}
          className="accent-primary"
        />
      </label>

      <label className="flex items-center justify-between text-xs">
        <span>主题</span>
        <select
          value={config.theme}
          onChange={(e) => onChange({ ...config, theme: e.target.value as ThemeName })}
          className="rounded border bg-background px-1.5 py-0.5 text-xs"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="oneDark">One Dark</option>
        </select>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main KryptonIDE component                                          */
/* ------------------------------------------------------------------ */

export interface KryptonIDEProps {
  /** Available language IDs (from problem config) */
  langs: string[];
  /** Initial selected language */
  defaultLang?: string;
  /** Initial source code */
  defaultCode?: string;
  /** Called when user submits */
  onSubmit?: (lang: string, code: string) => void;
  /** LSP client (optional, for future use) */
  lsp?: LspClient;
  /** Custom class */
  className?: string;
  /** Minimum editor height in px */
  minHeight?: number;
}

export function KryptonIDE({
  langs,
  defaultLang,
  defaultCode = '',
  onSubmit,
  lsp,
  className,
  minHeight = 400,
}: KryptonIDEProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentRef = useRef(new Compartment());
  const [selectedLang, setSelectedLang] = useState(defaultLang || langs[0] || 'cc.cc17');
  const [showConfig, setShowConfig] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [config, setConfig] = useState<IdeConfig>({
    fontSize: 14,
    tabSize: 4,
    wordWrap: false,
    theme: 'oneDark',
  });

  // Build extensions
  const extensions = useMemo((): Extension[] => {
    const lang = getLangEntry(selectedLang);
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
      ]),
      lang.extension(),
      themeExtension(config.theme),
      EditorView.theme({
        '&': { fontSize: `${config.fontSize}px` },
        '.cm-content': { fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", "Menlo", monospace' },
        '.cm-gutters': { fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace' },
      }),
      ...(config.wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.tabSize.of(config.tabSize),
    ];
  }, [selectedLang, config]);

  // Create / reconfigure editor
  useEffect(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      // Reconfigure the compartment with new extensions
      viewRef.current.dispatch({
        effects: compartmentRef.current.reconfigure(extensions),
      });
      return;
    }

    const state = EditorState.create({
      doc: defaultCode,
      extensions: compartmentRef.current.of(extensions),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once; reconfigure on extension changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  const handleSubmit = useCallback(() => {
    const code = viewRef.current?.state.doc.toString() || '';
    onSubmit?.(selectedLang, code);
  }, [selectedLang, onSubmit]);

  const getCode = useCallback(() => {
    return viewRef.current?.state.doc.toString() || '';
  }, []);

  const availableLangs = langs.length > 0 ? langs : Object.keys(LANGUAGES);
  const langLabel = getLangEntry(selectedLang).label;

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border bg-background',
        fullscreen && 'fixed inset-0 z-50 rounded-none',
        className,
      )}
    >
      {/* Toolbar */}
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

        <div className="flex-1" />

        {/* Config */}
        <button
          type="button"
          onClick={() => { setShowConfig((p) => !p); setShowLangMenu(false); }}
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
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>

        {/* Submit */}
        {onSubmit && (
          <Button size="sm" onClick={handleSubmit} className="ml-1 h-7 gap-1 text-xs">
            <Play className="size-3" />
            提交
          </Button>
        )}
      </div>

      {/* Config panel */}
      <ConfigPanel config={config} onChange={setConfig} open={showConfig} />

      {/* Editor area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ minHeight: fullscreen ? undefined : minHeight }}
        onClick={() => { setShowConfig(false); setShowLangMenu(false); }}
      />
    </div>
  );
}
