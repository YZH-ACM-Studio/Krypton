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

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ReactMarkdown, { type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/cn';
import { antiAiCopyPreview, createAntiAiMarker, remapAntiAiMarkers, type AntiAiMarkerDraft } from '@/lib/anti-ai-marker';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { splitMarkdownBySamples } from '@/lib/samples';
import { SampleBlocks } from '@/components/sample-blocks';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

/* ------------------------------------------------------------------ */
/*  Plugin config                                                      */
/* ------------------------------------------------------------------ */

const remarkPlugins = [remarkGfm, remarkMath] as NonNullable<ReactMarkdownOptions['remarkPlugins']>;

// Allow KaTeX-generated elements and common HTML through sanitizer
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'span',
    'div',
    'math',
    'semantics',
    'mrow',
    'mi',
    'mo',
    'mn',
    'msup',
    'msub',
    'mfrac',
    'munderover',
    'mtable',
    'mtr',
    'mtd',
    'annotation',
    'svg',
    'path',
    'line',
    'rect',
    'circle',
    'center',
    'font',
    'u',
    'mark',
    'details',
    'summary',
    'kbd',
    'var',
    'sub',
    'sup',
    'ins',
    'del',
    'abbr',
    'ruby',
    'rt',
    'rp',
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

const rehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex, rehypeHighlight] as NonNullable<
  ReactMarkdownOptions['rehypePlugins']
>;

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
  return { default: content };
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

function LangTabs({ langs, active, onChange }: { langs: string[]; active: string; onChange: (lang: string) => void }) {
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
            active === lang ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
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

// Markdown styling lives in styles.css under `.krypton-prose`. We don't pull
// in @tailwindcss/typography, so `prose` classes are no-ops; the manual rules
// keep headings / lists / code blocks legible in both light and dark themes.
const PROSE_CLASS = 'krypton-prose';

type FileUrlResolver = (filename: string, original: string) => string;

function normalizePreviewSource(source: string, resolveFileUrl?: FileUrlResolver): string {
  if (!resolveFileUrl) return source;
  return source.replace(/file:\/\/([^ \n)\\"]+)/g, (raw, fileinfo: string) => {
    const filenamePart = fileinfo.split('?')[0];
    let filename = filenamePart;
    try {
      filename = decodeURIComponent(filenamePart);
    } catch {
      /* keep the original encoded filename */
    }
    return resolveFileUrl(filename, fileinfo) || raw;
  });
}

function MarkdownContent({ source, resolveFileUrl }: { source: string; resolveFileUrl?: FileUrlResolver }) {
  const renderedSource = useMemo(() => normalizePreviewSource(source, resolveFileUrl), [source, resolveFileUrl]);
  return (
    <div className={PROSE_CLASS}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {renderedSource}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Editor preview: detect ```inputN/```outputN sample blocks and render
 * them in place (inline) as dedicated "样例" cards, so the preview
 * matches the detail page and respects the author's ordering.
 */
function PreviewWithSamples({ source, resolveFileUrl }: { source: string; resolveFileUrl?: FileUrlResolver }) {
  const chunks = useMemo(() => splitMarkdownBySamples(source), [source]);
  if (chunks.length === 0) return <MarkdownContent source={source} resolveFileUrl={resolveFileUrl} />;
  return (
    <>
      {chunks.map((chunk, i) =>
        chunk.kind === 'md' ? (
          <MarkdownContent key={i} source={chunk.md || ''} resolveFileUrl={resolveFileUrl} />
        ) : (
          <SampleBlocks key={i} samples={chunk.samples || []} suppressHeader />
        ),
      )}
    </>
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

export function MarkdownView({ content, className, preferredLang }: MarkdownViewProps) {
  const langs = useMemo(() => parseContent(content), [content]);
  const keys = Object.keys(langs);
  const [activeLang, setActiveLang] = useState(() => pickInitialLang(langs, preferredLang));
  const md = langs[activeLang] || langs[keys[0]] || '';
  const chunks = useMemo(() => splitMarkdownBySamples(md), [md]);

  return (
    <div className={className}>
      <LangTabs langs={keys.length > 1 ? keys : []} active={activeLang} onChange={setActiveLang} />
      {chunks.length > 0 ? (
        chunks.map((chunk, i) =>
          chunk.kind === 'md' ? (
            <MarkdownContent key={i} source={chunk.md || ''} />
          ) : (
            <SampleBlocks key={i} samples={chunk.samples || []} suppressHeader />
          ),
        )
      ) : (
        <MarkdownContent source={md} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editable renderer — left edit, right live preview                   */
/* ------------------------------------------------------------------ */

function imageExtension(type: string): string {
  const ext = type.split('/')[1]?.toLowerCase() || 'png';
  return ext === 'jpeg' ? 'jpg' : ext;
}

function makeUploadToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

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
  /** Optional endpoint for pasted image uploads. */
  pasteUpload?: {
    endpoint: string;
    meta?: Record<string, string>;
    makeUrl?: (filename: string) => string;
    /** Authorize this upload and return any operation-bound form fields. */
    authorize?: () => Promise<Record<string, string> | false>;
  };
  /** Resolve file:// attachments inside the live preview without changing the saved markdown. */
  previewFileUrl?: FileUrlResolver;
  /** Author-only anti-AI marker path. Omit outside problem statement editors. */
  antiAiPath?: string;
  antiAiMarkers?: AntiAiMarkerDraft[];
  onAntiAiMarkersChange?: (markers: AntiAiMarkerDraft[]) => void;
}

export function MarkdownEditor({
  name,
  value,
  onChange,
  className,
  preferredLang,
  minHeight = 400,
  pasteUpload,
  previewFileUrl,
  antiAiPath,
  antiAiMarkers = [],
  onAntiAiMarkersChange,
}: MarkdownEditorProps) {
  const initialLangs = useMemo(() => parseContent(value), [value]);
  const [drafts, setDrafts] = useState(() => initialLangs);
  const keys = Object.keys(drafts);
  const isMultiLang = keys.length > 1 || (keys.length === 1 && keys[0] !== 'default');
  const [activeLang, setActiveLang] = useState(() => pickInitialLang(initialLangs, preferredLang));
  const [source, setSource] = useState(() => initialLangs[activeLang] || '');
  const [preview, setPreview] = useState('');
  const sourceRef = useRef(source);
  const externalValueRef = useRef(value);
  const antiAiMarkersRef = useRef(antiAiMarkers);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [antiAiPreview, setAntiAiPreview] = useState<'student' | 'copy' | null>(null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const activeAntiAiPath = antiAiPath ? (isMultiLang && activeLang !== 'default' ? `${antiAiPath}.${activeLang}` : antiAiPath) : undefined;
  const activeAntiAiMarkers = activeAntiAiPath
    ? antiAiMarkers.filter((marker) => marker.anchor.path === activeAntiAiPath).sort((left, right) => left.anchor.offset - right.anchor.offset)
    : [];

  useEffect(() => {
    antiAiMarkersRef.current = antiAiMarkers;
  }, [antiAiMarkers]);

  // A parent may replace this editor's canonical section, for example when
  // structured samples are reordered. Synchronize that external replacement
  // without routing it through commitSource: it is already canonical and its
  // marker paths were remapped by the parent in the same operation.
  useEffect(() => {
    if (externalValueRef.current === value) return;
    externalValueRef.current = value;
    const nextDrafts = parseContent(value);
    const nextActiveLang = Object.hasOwn(nextDrafts, activeLang) ? activeLang : pickInitialLang(nextDrafts, preferredLang);
    const nextSource = nextDrafts[nextActiveLang] || '';
    sourceRef.current = nextSource;
    setDrafts(nextDrafts);
    setActiveLang(nextActiveLang);
    setSource(nextSource);
    setPreview(nextSource);
  }, [activeLang, preferredLang, value]);

  const commitSource = useCallback(
    (nextSource: string) => {
      const previousSource = sourceRef.current;
      if (activeAntiAiPath && onAntiAiMarkersChange && previousSource !== nextSource) {
        const nextMarkers = remapAntiAiMarkers(antiAiMarkersRef.current, activeAntiAiPath, previousSource, nextSource);
        antiAiMarkersRef.current = nextMarkers;
        onAntiAiMarkersChange(nextMarkers);
      }
      sourceRef.current = nextSource;
      setSource(nextSource);
      if (isMultiLang) {
        setDrafts((current) => {
          const next = { ...current, [activeLang]: nextSource };
          onChange?.(JSON.stringify(next));
          return next;
        });
      } else {
        onChange?.(nextSource);
      }
    },
    [activeAntiAiPath, activeLang, isMultiLang, onAntiAiMarkersChange, onChange],
  );

  const addAntiAiMarker = useCallback(() => {
    if (!activeAntiAiPath || !onAntiAiMarkersChange) return;
    const offset = editorRef.current?.selectionStart ?? sourceRef.current.length;
    const marker = createAntiAiMarker(activeAntiAiPath, offset, '');
    const nextMarkers = [...antiAiMarkersRef.current, marker];
    antiAiMarkersRef.current = nextMarkers;
    onAntiAiMarkersChange(nextMarkers);
    setEditingMarkerId(marker.id);
  }, [activeAntiAiPath, onAntiAiMarkersChange]);

  const updateAntiAiMarker = useCallback(
    (id: string, update: (marker: AntiAiMarkerDraft) => AntiAiMarkerDraft) => {
      const nextMarkers = antiAiMarkersRef.current.map((marker) => (marker.id === id ? update(marker) : marker));
      antiAiMarkersRef.current = nextMarkers;
      onAntiAiMarkersChange?.(nextMarkers);
    },
    [onAntiAiMarkersChange],
  );

  const focusAntiAiMarker = useCallback((marker: AntiAiMarkerDraft) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.selectionStart = editor.selectionEnd = Math.min(marker.anchor.offset, editor.value.length);
  }, []);

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
      commitSource(e.target.value);
    },
    [commitSource],
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
        const newVal = `${val.substring(0, start)}  ${val.substring(end)}`;
        commitSource(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [commitSource],
  );

  const replaceInsertedText = useCallback(
    (needle: string, replacement: string) => {
      const current = sourceRef.current;
      const index = current.indexOf(needle);
      if (index < 0) return;
      commitSource(current.slice(0, index) + replacement + current.slice(index + needle.length));
    },
    [commitSource],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!pasteUpload?.endpoint) return;
      const items = Array.from(e.clipboardData?.items || []);
      const item = items.find((i) => /^image\/(?:png|jpe?g|gif|webp)$/i.test(i.type));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;

      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart ?? sourceRef.current.length;
      const end = ta.selectionEnd ?? start;
      let authorizationMeta: Record<string, string> = {};
      if (pasteUpload.authorize) {
        try {
          const authorization = await pasteUpload.authorize();
          if (authorization === false) return;
          authorizationMeta = authorization;
        } catch (error) {
          console.error('Markdown image upload authorization failed', error);
          return;
        }
      }

      const ext = imageExtension(file.type);
      const token = makeUploadToken();
      const filename = `${token}.${ext}`;
      const placeholder = `![image](uploading-${token})`;
      const current = sourceRef.current;
      commitSource(current.slice(0, start) + placeholder + current.slice(end));
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + placeholder.length;
      });

      const form = new FormData();
      for (const [key, val] of Object.entries(pasteUpload.meta || {})) form.append(key, val);
      for (const [key, val] of Object.entries(authorizationMeta)) form.set(key, val);
      if (!form.has('operation')) form.append('operation', 'upload_file');
      if (!form.has('filename')) form.append('filename', filename);
      form.append('file', file, filename);

      try {
        const res = await fetchHydroResponse(
          pasteUpload.endpoint,
          {
            method: 'POST',
            body: form,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          },
          '图片上传失败',
        );
        if (!res.ok) {
          replaceInsertedText(placeholder, await readHydroResponseError(res, '图片上传失败'));
          return;
        }
        const url = pasteUpload.makeUrl ? pasteUpload.makeUrl(filename) : filename;
        replaceInsertedText(placeholder, `![image](${url})`);
      } catch (err) {
        console.error('Markdown image upload failed', err);
        replaceInsertedText(placeholder, '图片上传失败');
      }
    },
    [commitSource, pasteUpload, replaceInsertedText],
  );

  return (
    <div className={cn('space-y-2', className)}>
      {isMultiLang && name ? <input type="hidden" name={name} value={JSON.stringify(drafts)} readOnly /> : null}
      {/* Header bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <LangTabs
          langs={keys.length > 1 ? keys : []}
          active={activeLang}
          onChange={(lang) => {
            setActiveLang(lang);
            const text = drafts[lang] || '';
            sourceRef.current = text;
            setSource(text);
            setPreview(text);
          }}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          {activeAntiAiPath ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={addAntiAiMarker}>
                在光标处插入防 AI 标记
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAntiAiPreview('student')}>
                学生可见效果
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAntiAiPreview('copy')}>
                复制结果
              </Button>
            </>
          ) : (
            <>
              <span>左侧编辑</span>
              <span className="text-border">|</span>
              <span>右侧预览</span>
            </>
          )}
        </div>
      </div>

      {activeAntiAiPath && activeAntiAiMarkers.length ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/[0.04] p-3"
          data-testid="anti-ai-marker-boundaries"
        >
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">当前区块的防 AI 边界</p>
          {activeAntiAiMarkers.map((marker) => {
            const contextStart = Math.max(0, marker.anchor.offset - 14);
            const contextEnd = Math.min(source.length, marker.anchor.offset + 14);
            return (
              <div key={marker.id} className="rounded-md border bg-background/80 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-200"
                    onClick={() => focusAntiAiMarker(marker)}
                  >
                    防 AI · 位置 {marker.anchor.offset}
                  </button>
                  <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {source.slice(contextStart, marker.anchor.offset)}│{source.slice(marker.anchor.offset, contextEnd)}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const offset = editorRef.current?.selectionStart ?? marker.anchor.offset;
                      updateAntiAiMarker(marker.id, (current) => ({
                        ...current,
                        anchor: { ...current.anchor, offset },
                        conflict: undefined,
                      }));
                    }}
                  >
                    移到光标
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingMarkerId(editingMarkerId === marker.id ? null : marker.id)}
                  >
                    {editingMarkerId === marker.id ? '收起' : '编辑'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      const nextMarkers = antiAiMarkersRef.current.filter((item) => item.id !== marker.id);
                      antiAiMarkersRef.current = nextMarkers;
                      onAntiAiMarkersChange?.(nextMarkers);
                    }}
                  >
                    删除
                  </Button>
                </div>
                {marker.conflict ? <p className="mt-2 text-xs text-destructive">{marker.conflict}</p> : null}
                {editingMarkerId === marker.id ? (
                  <label className="mt-3 block space-y-1.5 text-xs font-medium">
                    注入文本
                    <textarea
                      value={marker.injectionText}
                      onChange={(event) => updateAntiAiMarker(marker.id, (current) => ({ ...current, injectionText: event.target.value }))}
                      rows={4}
                      className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm font-normal"
                    />
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {activeAntiAiPath && antiAiPreview ? (
        <section className="rounded-lg border bg-muted/15 p-4" aria-label={antiAiPreview === 'student' ? '学生可见效果' : '复制结果预览'}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">
              {antiAiPreview === 'student' ? '学生可见效果（不显示隐藏文本）' : '复制结果（显式展示注入文本）'}
            </h4>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAntiAiPreview(null)}>
              关闭
            </Button>
          </div>
          {antiAiPreview === 'student' ? (
            <PreviewWithSamples source={source} resolveFileUrl={previewFileUrl} />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-xs">
              {antiAiCopyPreview(source, activeAntiAiMarkers)}
            </pre>
          )}
        </section>
      ) : null}

      {/* Side-by-side panels. Both panes share the same height + scroll
          behavior so the editor doesn't look stunted next to a tall preview.
          Height is driven by the `--md-shell-h` variable, which the CSS file
          flips to `auto` on mobile so the panes stack with a sensible floor. */}
      <div
        className="krypton-md-shell grid grid-cols-1 gap-0 overflow-hidden rounded-lg border md:grid-cols-2"
        style={{ '--md-shell-h': `${minHeight}px` } as CSSProperties}
      >
        {/* Editor pane */}
        <div className="relative h-full min-h-0 border-b md:border-b-0 md:border-r">
          <div className="pointer-events-none absolute left-0 top-0 select-none px-2 py-2.5 text-right font-mono text-xs leading-[1.625rem] text-muted-foreground/40">
            {source.split('\n').map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={editorRef}
            name={isMultiLang ? undefined : name}
            value={source}
            onChange={handleChange}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="krypton-markdown-editor h-full w-full resize-none bg-background py-2 pl-10 pr-3 font-mono text-sm leading-[1.625rem] focus:outline-none"
            spellCheck={false}
            placeholder={'在此输入 Markdown 内容…\n支持 LaTeX 公式: $x^2$ 或 $$\\sum_{i=1}^n$$\n支持 HTML 标签'}
          />
        </div>

        {/* Preview pane */}
        <ScrollArea viewportRef={previewRef} orientation="both" className="h-full min-h-0 bg-card" viewportClassName="p-4">
          {preview ? (
            <PreviewWithSamples source={preview} resolveFileUrl={previewFileUrl} />
          ) : (
            <p className="text-sm italic text-muted-foreground">预览区域</p>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
