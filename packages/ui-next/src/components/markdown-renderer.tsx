/**
 * MarkdownRenderer — full Markdown + LaTeX/KaTeX + syntax‐highlighting renderer.
 *
 * Supports:
 *  - GitHub Flavoured Markdown (tables, strikethrough, task lists, autolinks)
 *  - Math: inline `$…$` and display `$$…$$` via remark-math + rehype-katex
 *  - Fenced‐code syntax highlighting via rehype-highlight
 *  - Multi‐language content with mini tab bar
 *  - View mode (read‐only) and Edit mode (side‐by‐side / toggled)
 */

import {
  type ReactNode,
  startTransition,
  useCallback,
  useMemo,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  KaTeX & highlight.js stylesheets are loaded once via CSS imports   */
/* ------------------------------------------------------------------ */

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, rehypeHighlight];

/* ------------------------------------------------------------------ */
/*  Content can be a plain string or a Record<lang, string>            */
/* ------------------------------------------------------------------ */

export type ContentValue = string | Record<string, string>;

const LANG_LABELS: Record<string, string> = {
  zh: '中文',
  'zh-CN': '中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
};

function resolveLangLabel(key: string): string {
  return LANG_LABELS[key] || key;
}

/** Parse content — if it looks like JSON `{"en":"…","zh":"…"}`, parse it. */
function parseContent(content: ContentValue): Record<string, string> {
  if (typeof content === 'object' && content !== null) return content;
  if (typeof content !== 'string') return { default: String(content ?? '') };
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const allStrings = Object.values(parsed).every((v) => typeof v === 'string');
        if (allStrings && Object.keys(parsed).length > 0) return parsed as Record<string, string>;
      }
    } catch {
      /* not JSON, treat as raw markdown */
    }
  }
  return { default: trimmed };
}

function pickInitialLang(langs: Record<string, string>, preferred?: string): string {
  const keys = Object.keys(langs);
  if (keys.length === 0) return 'default';
  if (preferred && langs[preferred]) return preferred;
  // Prefer zh variants, then en, then first key
  for (const pref of ['zh', 'zh-CN', 'zh_CN', 'en']) {
    if (langs[pref]) return pref;
  }
  return keys[0];
}

/* ------------------------------------------------------------------ */
/*  Mini tab bar for switching languages                               */
/* ------------------------------------------------------------------ */

function LangTabs({
  langs,
  active,
  onChange,
}: {
  langs: string[];
  active: string;
  onChange: (lang: string) => void;
}) {
  if (langs.length <= 1) return null;
  return (
    <div className="mb-3 flex gap-0.5 rounded-md bg-muted p-0.5">
      {langs.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => onChange(lang)}
          className={cn(
            'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
            active === lang
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {resolveLangLabel(lang)}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  View‐only renderer                                                 */
/* ------------------------------------------------------------------ */

export interface MarkdownViewProps {
  content: ContentValue;
  /** CSS class for the outer wrapper */
  className?: string;
  /** Preferred language code — e.g. "zh" or "en" */
  preferredLang?: string;
}

export function MarkdownView({
  content,
  className,
  preferredLang,
}: MarkdownViewProps) {
  const langs = useMemo(() => parseContent(content), [content]);
  const keys = Object.keys(langs);
  const [activeLang, setActiveLang] = useState(() =>
    pickInitialLang(langs, preferredLang),
  );
  const md = langs[activeLang] || langs[keys[0]] || '';

  return (
    <div className={className}>
      <LangTabs
        langs={keys.length > 1 ? keys : []}
        active={activeLang}
        onChange={setActiveLang}
      />
      <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-pre:bg-muted prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
        >
          {md}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editable renderer (side‐by‐side with live preview)                 */
/* ------------------------------------------------------------------ */

export interface MarkdownEditorProps {
  /** Field name for the form */
  name?: string;
  /** Initial value */
  value: ContentValue;
  /** Callback when content changes */
  onChange?: (value: string) => void;
  className?: string;
  /** Preferred language code */
  preferredLang?: string;
  /** Height of the editor area */
  minHeight?: number;
}

export function MarkdownEditor({
  name,
  value,
  onChange,
  className,
  preferredLang,
  minHeight = 300,
}: MarkdownEditorProps) {
  const langs = useMemo(() => parseContent(value), [value]);
  const keys = Object.keys(langs);
  const [activeLang, setActiveLang] = useState(() =>
    pickInitialLang(langs, preferredLang),
  );
  const [source, setSource] = useState(() => langs[activeLang] || '');
  const [showPreview, setShowPreview] = useState(true);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      startTransition(() => {
        setSource(v);
        onChange?.(v);
      });
    },
    [onChange],
  );

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <LangTabs
          langs={keys.length > 1 ? keys : []}
          active={activeLang}
          onChange={(lang) => {
            setActiveLang(lang);
            const text = langs[lang] || '';
            setSource(text);
            onChange?.(text);
          }}
        />
        <button
          type="button"
          onClick={() => setShowPreview((p) => !p)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {showPreview ? '隐藏预览' : '显示预览'}
        </button>
      </div>

      <div className={cn('grid gap-4', showPreview && 'md:grid-cols-2')}>
        {/* Editor pane */}
        <div>
          <textarea
            name={name}
            value={source}
            onChange={handleChange}
            className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            style={{ minHeight }}
            spellCheck={false}
          />
        </div>

        {/* Preview pane */}
        {showPreview ? (
          <div
            className="overflow-auto rounded-md border p-4"
            style={{ minHeight }}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-pre:bg-muted prose-pre:text-sm prose-code:before:content-none prose-code:after:content-none">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
              >
                {source}
              </ReactMarkdown>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
