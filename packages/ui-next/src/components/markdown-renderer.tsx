/**
 * MarkdownRenderer — full Markdown + LaTeX/KaTeX + syntax-highlighting + HTML renderer.
 *
 * Supports:
 *  - GitHub Flavoured Markdown (tables, strikethrough, task lists, autolinks)
 *  - Math: inline `$…$` and display `$$…$$` via remark-math + rehype-katex
 *  - Fenced-code syntax highlighting via rehype-highlight
 *  - Raw HTML passthrough via rehype-raw (sanitised by rehype-sanitize)
 *  - Multi-language content with mini tab bar
 *  - View mode (read-only) and Edit mode (side-by-side live preview)
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Plugin config                                                      */
/* ------------------------------------------------------------------ */

const remarkPlugins = [remarkGfm, remarkMath];

// Allow KaTeX-generated elements and common HTML through sanitizer
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'span', 'div', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup',
    'msub', 'mfrac', 'munderover', 'mtable', 'mtr', 'mtd', 'annotation',
    'svg', 'path', 'line', 'rect', 'circle',
    'center', 'font', 'u', 'mark', 'details', 'summary', 'kbd', 'var',
    'sub', 'sup', 'ins', 'del', 'abbr', 'ruby', 'rt', 'rp',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class', 'style', 'id'],
    span: [...(defaultSchema.attributes?.span || []), 'className', 'class', 'style', 'aria-hidden'],
    div: [...(defaultSchema.attributes?.div || []), 'className', 'class', 'style'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    td: ['align', 'colSpan', 'rowSpan'],
    th: ['align', 'colSpan', 'rowSpan'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    a: ['href', 'title', 'target', 'rel'],
    font: ['color', 'size', 'face'],
    code: ['className', 'class'],
    pre: ['className', 'class'],
  },
};

const rehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
  rehypeHighlight,
];

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
/*  Core Markdown renderer (shared by view and editor preview)         */
/* ------------------------------------------------------------------ */

const PROSE_CLASS =
  'prose prose-sm dark:prose-invert max-w-none ' +
  'prose-headings:scroll-mt-20 ' +
  'prose-pre:bg-muted prose-pre:text-sm ' +
  'prose-code:before:content-none prose-code:after:content-none ' +
  'prose-img:rounded-md prose-img:shadow-sm ' +
  'prose-table:text-sm ' +
  'prose-a:text-primary prose-a:no-underline hover:prose-a:underline';

function MarkdownContent({ source }: { source: string }) {
  return (
    <div className={PROSE_CLASS}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as any}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  View-only renderer                                                 */
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
      <MarkdownContent source={md} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editable renderer — left edit, right live preview                   */
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
  minHeight = 400,
}: MarkdownEditorProps) {
  const langs = useMemo(() => parseContent(value), [value]);
  const keys = Object.keys(langs);
  const [activeLang, setActiveLang] = useState(() =>
    pickInitialLang(langs, preferredLang),
  );
  const [source, setSource] = useState(() => langs[activeLang] || '');
  const [preview, setPreview] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Debounced preview update
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      startTransition(() => setPreview(source));
    }, 150);
    return () => clearTimeout(timerRef.current);
  }, [source]);

  // Synchronize scroll (editor → preview)
  const handleScroll = useCallback(() => {
    const ed = editorRef.current;
    const pv = previewRef.current;
    if (!ed || !pv) return;
    const ratio = ed.scrollTop / (ed.scrollHeight - ed.clientHeight || 1);
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight || 1);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setSource(v);
      onChange?.(v);
    },
    [onChange],
  );

  // Handle tab key in textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const newVal = val.substring(0, start) + '  ' + val.substring(end);
        setSource(newVal);
        onChange?.(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [onChange],
  );

  return (
    <div className={cn('space-y-2', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <LangTabs
          langs={keys.length > 1 ? keys : []}
          active={activeLang}
          onChange={(lang) => {
            setActiveLang(lang);
            const text = langs[lang] || '';
            setSource(text);
            setPreview(text);
            onChange?.(text);
          }}
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>左侧编辑</span>
          <span className="text-border">|</span>
          <span>右侧预览</span>
        </div>
      </div>

      {/* Side-by-side panels */}
      <div className="grid grid-cols-2 gap-0 overflow-hidden rounded-lg border">
        {/* Editor pane */}
        <div className="relative border-r">
          <div className="absolute left-0 top-0 px-2 py-2.5 text-right font-mono text-xs leading-6.5 text-muted-foreground/40 select-none pointer-events-none">
            {source.split('\n').map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={editorRef}
            name={name}
            value={source}
            onChange={handleChange}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            className="w-full resize-none bg-background py-2 pl-10 pr-3 font-mono text-sm leading-6.5 focus:outline-none"
            style={{ minHeight, height: minHeight }}
            spellCheck={false}
            placeholder={'在此输入 Markdown 内容…\n支持 LaTeX 公式: $x^2$ 或 $$\\sum_{i=1}^n$$\n支持 HTML 标签'}
          />
        </div>

        {/* Preview pane */}
        <div
          ref={previewRef}
          className="overflow-auto bg-card p-4"
          style={{ minHeight, maxHeight: Math.max(minHeight, 600) }}
        >
          {preview ? (
            <MarkdownContent source={preview} />
          ) : (
            <p className="text-sm text-muted-foreground italic">预览区域</p>
          )}
        </div>
      </div>
    </div>
  );
}
