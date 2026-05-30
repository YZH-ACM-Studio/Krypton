/**
 * Independent submit page rendered at /p/:pid/submit.
 *
 * Two-pane layout: left = problem statement + samples (read-only,
 * collapsed when narrow). Right = KryptonIDE in `simple` mode with the
 * submit button + language picker we render ourselves.
 *
 * Replaces the old "提交" tab inside the detail page (Q5) — the user can
 * still bounce to /:pid for the full info bar, but the actual code
 * editor lives here with full-height real estate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, Loader2, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleSelect } from '@/components/ui/select';
import { MarkdownView } from '@/components/markdown-renderer';
import { KryptonIDE } from '@/components/krypton-ide';
import { SampleBlocks } from '@/components/sample-blocks';
import { useBootstrap } from '@/lib/bootstrap';
import { extractSamples, stripSampleBlocks } from '@/lib/samples';
import { replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

export function ProblemSubmitPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const tdoc: R | null = data.tdoc || null;
  const langRange: Record<string, string> = data.langRange || {};
  const config: R = typeof pdoc.config === 'object' ? pdoc.config : {};
  const content = pdoc.content || '';
  const pid = pdoc.pid || pdoc.docId || '';
  const baseTitle = pdoc.title || String(pid);
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const tid = tdoc?.docId ? String(tdoc.docId) : null;
  const contestQS = tid ? `?tid=${tid}` : '';
  const submitUrl = `${problemUrl}/submit${contestQS}`;
  const preferredLang = bs.locale?.startsWith('zh') ? 'zh' : 'en';
  const samples = useMemo(() => extractSamples(content), [content]);
  const stripped = useMemo(() => (samples.length ? maybeStripJsonContent(content) : content), [content, samples]);

  // Alphabetic letter when entering via contest
  const contestPids: any[] = Array.isArray(tdoc?.pids) ? tdoc!.pids : [];
  const contestIdx = tdoc ? contestPids.findIndex((x) => String(x) === String(pdoc.docId)) : -1;
  const contestLetter = contestIdx >= 0 ? String.fromCharCode(65 + contestIdx) : null;
  const title = contestLetter ? `${contestLetter}. ${baseTitle}` : baseTitle;

  // Code state — KryptonIDE in simple mode is controlled via value/onValueChange.
  const cacheKey = `krypton:submit:${bs.user?.id || 0}/${bs.domain?.id || 'default'}/${pid}${tid ? `:${tid}` : ''}`;
  const langKey = `krypton:submit-lang:${pid}${tid ? `:${tid}` : ''}`;
  const availableLangs = useMemo(() => Object.keys(langRange), [langRange]);
  const [lang, setLang] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(langKey);
      if (saved && (availableLangs.length === 0 || availableLangs.includes(saved))) return saved;
    } catch { /* */ }
    return availableLangs[0] || 'cc.cc17';
  });
  const [code, setCode] = useState<string>(() => {
    try { return localStorage.getItem(cacheKey) || ''; } catch { return ''; }
  });

  // Persist code (debounced) + lang (immediate)
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(cacheTimer.current);
    cacheTimer.current = setTimeout(() => {
      try { localStorage.setItem(cacheKey, code); } catch { /* */ }
    }, 400);
    return () => clearTimeout(cacheTimer.current);
  }, [code, cacheKey]);
  useEffect(() => {
    try { localStorage.setItem(langKey, lang); } catch { /* */ }
  }, [lang, langKey]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!code.trim()) { setSubmitError('代码不能为空'); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.append('lang', lang);
      form.append('code', code);
      if (tid) form.append('tid', tid);
      const res = await fetch(submitUrl, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });
      // Hydro responds with a 302 to /record/:rid after submit. Browsers
      // expose the redirect Location on opaque responses, so we fall back
      // to letting the form-style flow take over if needed.
      if (res.status === 200) {
        const json = await res.json().catch(() => ({}));
        if (json.rid || json.url) {
          window.location.href = json.url || replaceRouteTokens(bs.urls.recordDetail, { RID: String(json.rid) });
          return;
        }
      }
      // Fallback — let the browser handle the navigation natively.
      const native = document.createElement('form');
      native.method = 'POST';
      native.action = submitUrl;
      const fields: Record<string, string> = { lang, code };
      if (tid) fields.tid = tid;
      for (const [k, v] of Object.entries(fields)) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = k;
        inp.value = v;
        native.appendChild(inp);
      }
      document.body.appendChild(native);
      native.submit();
    } catch (e: any) {
      setSubmitError(e?.message || '提交失败');
      setSubmitting(false);
    }
  }, [code, lang, tid, submitUrl, submitting, bs.urls.recordDetail]);

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tdoc && contestLetter ? (
          <>
            <a href={tdoc.rule === 'homework' ? bs.urls.homework : bs.urls.contests} className="hover:text-primary">
              {tdoc.rule === 'homework' ? '作业' : '比赛'}
            </a>
            <ChevronRight className="size-3" />
            <a href={replaceRouteTokens(tdoc.rule === 'homework' ? bs.urls.homeworkDetail : bs.urls.contestDetail, { TID: tid! })} className="hover:text-primary truncate max-w-[200px]">{tdoc.title || '比赛'}</a>
          </>
        ) : (
          <a href={bs.urls.problems} className="hover:text-primary">题库</a>
        )}
        <ChevronRight className="size-3" />
        <a href={`${problemUrl}${contestQS}`} className="hover:text-primary truncate max-w-[260px]">{title}</a>
        <ChevronRight className="size-3" />
        <span className="text-foreground">提交代码</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">提交代码</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`${problemUrl}${contestQS}`}>返回题面</a>
          </Button>
        </div>
      </div>

      {/* Full-width editor — the page is dedicated to pasting + submitting.
          The statement is one click away via "返回题面". */}
      <div className="space-y-3 min-w-0">
        {/* Language picker + meta */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">语言</label>
          <SimpleSelect
            value={lang}
            onValueChange={setLang}
            size="sm"
            className="w-auto min-w-[8rem]"
            options={
              availableLangs.length === 0
                ? [{ value: lang, label: lang }]
                : availableLangs.map((id) => ({ value: id, label: langRange[id] || id }))
            }
          />
          {config.time ? <Badge variant="outline" className="text-[10px]">{config.time}</Badge> : null}
          {config.memory ? <Badge variant="outline" className="text-[10px]">{config.memory}</Badge> : null}
          <span className="ml-auto text-[11px] text-muted-foreground">已自动缓存草稿</span>
        </div>

        {/* Editor in simple mode */}
        <div className="rounded-md border overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 480 }}>
          <KryptonIDE
            mode="simple"
            langs={availableLangs}
            defaultLang={lang}
            value={code}
            onValueChange={setCode}
            minHeight={480}
            className="h-full"
          />
        </div>

        {/* Submit row */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {submitError ? <span className="text-destructive">{submitError}</span> : <span>{code.length} 字符</span>}
          </div>
          <Button onClick={handleSubmit} disabled={submitting} size="lg" className="gap-1.5">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {submitting ? '提交中…' : '提交'}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** Best-effort: if content is a JSON multi-lang blob, strip sample blocks
 *  from each value; otherwise treat as plain markdown. */
function maybeStripJsonContent(content: any): any {
  if (content == null) return content;
  if (typeof content === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(content)) {
      out[k] = typeof v === 'string' ? stripSampleBlocks(v) : (v as string);
    }
    return out;
  }
  if (typeof content !== 'string') return content;
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          out[k] = typeof v === 'string' ? stripSampleBlocks(v) : (v as string);
        }
        return out;
      }
    } catch { /* fall through */ }
  }
  return stripSampleBlocks(trimmed);
}
