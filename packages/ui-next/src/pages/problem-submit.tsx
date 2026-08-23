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
import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { ChevronRight, Loader2, Play, Send } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KryptonIDE, PretestResultInline } from '@/components/krypton-ide';
import { StructuredRegionInputs } from '@/components/structured-region-inputs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/ui/select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { practiceDraftIdentity, practiceProblemEntryUrl, readPracticeIntegrityPageContext } from '@/lib/practice-integrity';
import { parseRecordResponse, preferredPretestResultTab, type PretestResult, type PretestResultTab } from '@/lib/pretest-results';
import { createEmptyStructuredRegionDraft, parseStructuredRegionDraft } from '@/lib/structured-region-draft';

interface StructuredSubmitConfig {
  type?: string;
  mode?: string;
  time?: string | number;
  memory?: string | number;
  template?: {
    surface?: ClientStructuredCodeSegment[];
    lang?: string;
  };
}

interface SubmitProblemDocument {
  pid?: string | number;
  docId?: string | number;
  title?: string;
  problemKind?: string;
  structureRevision?: number;
  config?: StructuredSubmitConfig;
}

interface SubmitContestDocument {
  docId?: string | number;
  pids?: unknown[];
  rule?: string;
  title?: string;
}

interface SubmitPageData {
  pdoc?: SubmitProblemDocument;
  tdoc?: SubmitContestDocument | null;
  langRange?: Record<string, string>;
  practiceIntegrity?: unknown;
  virtualContestActive?: boolean;
}

export function ProblemSubmitPage() {
  const bs = useBootstrap();
  const data = bs.page.data as SubmitPageData;
  const pdoc = data.pdoc || {};
  const tdoc = data.tdoc || null;
  const langRange: Record<string, string> = data.langRange || {};
  const config = pdoc.config || {};
  const pid = pdoc.pid || pdoc.docId || '';
  const baseTitle = pdoc.title || String(pid);
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const tid = tdoc?.docId ? String(tdoc.docId) : null;
  const virtualContestActive = data.virtualContestActive === true;
  const contestQS = tid ? (virtualContestActive ? `?tid=${tid}&virtual=1` : `?tid=${tid}`) : '';
  const submitUrl = `${problemUrl}/submit${contestQS}`;
  const practiceIntegrity = readPracticeIntegrityPageContext(data.practiceIntegrity);
  const practiceControlled = practiceIntegrity?.controlled === true;
  const practicePolicy = practiceControlled ? practiceIntegrity.policy! : null;
  const practiceContextId = practiceControlled ? practiceIntegrity.contextId : undefined;
  const practiceDraftScope = practiceIntegrity ? practiceDraftIdentity(practiceIntegrity) : null;
  const problemDetailUrl = practiceIntegrity
    ? practiceProblemEntryUrl(problemUrl, practiceIntegrity.entry, practiceIntegrity.mode === 'preview')
    : `${problemUrl}${contestQS}`;
  const isStructuredAnswer =
    ['program_fill', 'function'].includes(String(config.type)) && ['program_fill', 'function'].includes(String(pdoc.problemKind));
  const textProgramFill = config.type === 'program_fill' && config.mode === 'text';
  const compiledStructuredAnswer = isStructuredAnswer && !textProgramFill;
  const surface: ClientStructuredCodeSegment[] = Array.isArray(config.template?.surface) ? config.template.surface : [];
  const regions = useMemo(() => surface.filter((segment) => segment.type === 'region'), [surface]);
  const regionIds = useMemo(() => regions.map((region) => region.id), [regions]);
  const singleLineRegion = pdoc.problemKind === 'program_fill';

  // Alphabetic letter when entering via contest
  const contestPids: unknown[] = Array.isArray(tdoc?.pids) ? tdoc.pids : [];
  const contestIdx = tdoc ? contestPids.findIndex((x) => String(x) === String(pdoc.docId)) : -1;
  const contestLetter = contestIdx >= 0 ? String.fromCharCode(65 + contestIdx) : null;
  const title = contestLetter ? `${contestLetter}. ${baseTitle}` : baseTitle;

  // Code state — KryptonIDE in simple mode is controlled via value/onValueChange.
  const structureKey = isStructuredAnswer ? `:${Number(pdoc.structureRevision) || 0}` : '';
  const baseCacheKey = `krypton:submit:${bs.user?.id || 0}/${bs.domain?.id || 'default'}/${pid}${tid ? `:${tid}` : ''}${structureKey}`;
  const langKey = `krypton:submit-lang:${pid}${tid ? `:${tid}` : ''}${practiceDraftScope ? `:practice:${practiceDraftScope}` : ''}`;
  const availableLangs = useMemo(() => Object.keys(langRange), [langRange]);
  const [lang, setLang] = useState<string>(() => {
    if (isStructuredAnswer) return textProgramFill ? '_' : config.template?.lang || availableLangs[0] || '';
    try {
      const saved = localStorage.getItem(langKey);
      if (saved && (availableLangs.length === 0 || availableLangs.includes(saved))) return saved;
    } catch {
      /* */
    }
    return availableLangs[0] || 'cc.cc17';
  });
  const cacheKey = practiceDraftScope ? `${baseCacheKey}:practice:${practiceDraftScope}:lang:${encodeURIComponent(lang)}` : baseCacheKey;
  const [code, setCode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(cacheKey);
      if (saved !== null) {
        if (!isStructuredAnswer) return saved;
        const restored = parseStructuredRegionDraft(saved, regionIds, singleLineRegion);
        if (restored) return JSON.stringify(restored);
      }
    } catch {
      /* */
    }
    return isStructuredAnswer ? JSON.stringify(createEmptyStructuredRegionDraft(regionIds)) : '';
  });
  const previousCacheKey = useRef(cacheKey);
  const regionValues = useMemo(() => {
    if (!isStructuredAnswer) return {};
    return parseStructuredRegionDraft(code, regionIds, singleLineRegion) || createEmptyStructuredRegionDraft(regionIds);
  }, [code, isStructuredAnswer, regionIds, singleLineRegion]);
  const updateRegion = (id: string, value: string) => {
    if (!regionIds.includes(id)) throw new Error(`structured region ${id} is not part of the current problem`);
    setCode(JSON.stringify(Object.fromEntries(regionIds.map((currentId) => [currentId, currentId === id ? value : regionValues[currentId] || '']))));
  };

  // Persist code (debounced) + lang (immediate)
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipPersistForKey = useRef<string | null>(null);
  const latestDraft = useRef({ key: cacheKey, value: code });
  latestDraft.current = { key: cacheKey, value: code };
  useEffect(() => {
    if (previousCacheKey.current === cacheKey) return;
    const oldCacheKey = previousCacheKey.current;
    previousCacheKey.current = cacheKey;
    skipPersistForKey.current = cacheKey;
    try {
      localStorage.setItem(oldCacheKey, code);
      const saved = localStorage.getItem(cacheKey);
      if (saved === null) {
        setCode(isStructuredAnswer ? JSON.stringify(createEmptyStructuredRegionDraft(regionIds)) : '');
      } else if (!isStructuredAnswer) {
        setCode(saved);
      } else {
        const restored = parseStructuredRegionDraft(saved, regionIds, singleLineRegion);
        setCode(JSON.stringify(restored || createEmptyStructuredRegionDraft(regionIds)));
      }
    } catch {
      setCode(isStructuredAnswer ? JSON.stringify(createEmptyStructuredRegionDraft(regionIds)) : '');
    }
  }, [cacheKey, code, isStructuredAnswer, regionIds, singleLineRegion]);
  useEffect(() => {
    clearTimeout(cacheTimer.current);
    if (skipPersistForKey.current === cacheKey) {
      skipPersistForKey.current = null;
      return;
    }
    const save = () => {
      try {
        localStorage.setItem(cacheKey, code);
      } catch {
        /* */
      }
    };
    if (practiceControlled) save();
    else cacheTimer.current = setTimeout(save, 400);
    return () => clearTimeout(cacheTimer.current);
  }, [code, cacheKey, practiceControlled]);
  useEffect(() => {
    const flushDraft = () => {
      clearTimeout(cacheTimer.current);
      try {
        localStorage.setItem(latestDraft.current.key, latestDraft.current.value);
      } catch {
        /* */
      }
    };
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(langKey, lang);
    } catch {
      /* */
    }
  }, [lang, langKey]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selfTestInput, setSelfTestInput] = useState('');
  const [selfTestExpected, setSelfTestExpected] = useState('');
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestError, setSelfTestError] = useState('');
  const [selfTestResult, setSelfTestResult] = useState<PretestResult | null>(null);
  const [selfTestResultTab, setSelfTestResultTab] = useState<PretestResultTab>('output');
  const selfTestAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      selfTestAbort.current?.abort();
    },
    [],
  );

  const handleSelfTest = useCallback(async () => {
    if (!compiledStructuredAnswer || selfTestRunning) return;
    selfTestAbort.current?.abort();
    const abort = new AbortController();
    selfTestAbort.current = abort;
    setSelfTestRunning(true);
    setSelfTestError('');
    setSelfTestResult(null);
    try {
      const response = await fetchHydroResponse(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          lang,
          code,
          pretest: true,
          input: [selfTestInput],
          ...(practiceContextId ? { practiceContextId } : {}),
        }),
        credentials: 'same-origin',
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '自测提交失败'));
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('自测提交响应不是有效对象');
      const ridValue = (payload as { rid?: unknown }).rid;
      if (typeof ridValue !== 'string' || !ridValue.trim()) throw new Error('自测提交响应缺少记录编号');
      const recordUrl = `${replaceRouteTokens(bs.urls.recordDetail, { RID: ridValue.trim() })}${contestQS}`;

      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (abort.signal.aborted) return;
        const recordResponse = await fetchHydroResponse(recordUrl, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          signal: abort.signal,
        });
        if (!recordResponse.ok) throw new Error(await readHydroResponseError(recordResponse, '自测记录加载失败'));
        const result = parseRecordResponse(await recordResponse.json());
        setSelfTestResult(result);
        if (result.status > 0 && result.status < 20) {
          setSelfTestResultTab(preferredPretestResultTab(result));
          return;
        }
      }
      throw new Error('自测等待超时，请稍后重试');
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return;
      const message = (error as { message?: unknown } | null)?.message;
      const detail = typeof message === 'string' && message ? message : '自测失败';
      setSelfTestError(detail);
      console.error('Structured problem self-test failed', { pid, tid, error });
    } finally {
      if (selfTestAbort.current === abort) {
        selfTestAbort.current = null;
        setSelfTestRunning(false);
      }
    }
  }, [bs.urls.recordDetail, code, compiledStructuredAnswer, contestQS, lang, pid, practiceContextId, selfTestInput, selfTestRunning, submitUrl, tid]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!code.trim()) {
      setSubmitError('作答内容不能为空');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const form = new FormData();
      form.append('lang', lang);
      form.append('code', code);
      if (tid) form.append('tid', tid);
      if (practiceContextId) form.append('practiceContextId', practiceContextId);
      const res = await fetchHydroResponse(submitUrl, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });
      // Hydro responds with a 302 to /record/:rid after submit. Browsers
      // expose the redirect Location on opaque responses, so we fall back
      // to letting the form-style flow take over if needed.
      if (res.status === 200) {
        const json = (await res.json().catch(() => ({}))) as { rid?: unknown; url?: string };
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
      if (practiceContextId) fields.practiceContextId = practiceContextId;
      for (const [k, v] of Object.entries(fields)) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = k;
        inp.value = v;
        native.appendChild(inp);
      }
      document.body.appendChild(native);
      native.submit();
    } catch (error) {
      const message = (error as { message?: unknown } | null)?.message;
      setSubmitError(typeof message === 'string' && message ? message : '提交失败');
      setSubmitting(false);
    }
  }, [code, lang, tid, practiceContextId, submitUrl, submitting, bs.urls.recordDetail]);

  return (
    <motion.div className="space-y-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tdoc && contestLetter ? (
          <>
            <a href={tdoc.rule === 'homework' ? bs.urls.homework : bs.urls.contests} className="hover:text-primary">
              {tdoc.rule === 'homework' ? '作业' : '比赛'}
            </a>
            <ChevronRight className="size-3" />
            <a
              href={replaceRouteTokens(tdoc.rule === 'homework' ? bs.urls.homeworkDetail : bs.urls.contestDetail, { TID: tid! })}
              className="hover:text-primary truncate max-w-[200px]"
            >
              {tdoc.title || '比赛'}
            </a>
          </>
        ) : (
          <a href={bs.urls.problems} className="hover:text-primary">
            题库
          </a>
        )}
        <ChevronRight className="size-3" />
        <a href={problemDetailUrl} className="hover:text-primary truncate max-w-[260px]">
          {title}
        </a>
        <ChevronRight className="size-3" />
        <span className="text-foreground">提交代码</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{isStructuredAnswer ? '提交作答' : '提交代码'}</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={problemDetailUrl}>返回题面</a>
          </Button>
        </div>
      </div>

      {/* Full-width editor — the page is dedicated to pasting + submitting.
          The statement is one click away via "返回题面". */}
      <div className="space-y-3 min-w-0">
        {/* Language picker + meta */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">语言</label>
          {isStructuredAnswer ? (
            <Badge variant="outline">{textProgramFill ? '文本比对' : lang}</Badge>
          ) : (
            <SimpleSelect
              value={lang}
              onValueChange={setLang}
              size="sm"
              className="w-auto min-w-[8rem]"
              options={
                availableLangs.length === 0 ? [{ value: lang, label: lang }] : availableLangs.map((id) => ({ value: id, label: langRange[id] || id }))
              }
            />
          )}
          {config.time ? (
            <Badge variant="outline" className="text-[10px]">
              {config.time}
            </Badge>
          ) : null}
          {config.memory ? (
            <Badge variant="outline" className="text-[10px]">
              {config.memory}
            </Badge>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground">已自动缓存草稿</span>
        </div>

        {/* Editor in simple mode */}
        {isStructuredAnswer ? (
          <div className="border-y border-border/70 py-5">
            <StructuredRegionInputs
              surface={surface}
              values={regionValues}
              onChange={updateRegion}
              lang={config.template?.lang || lang}
              singleLine={singleLineRegion}
              prohibitExternalCodeInjection={practicePolicy?.prohibitExternalCodeInjection === true}
            />
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 480 }}>
            <KryptonIDE
              mode="simple"
              langs={availableLangs}
              defaultLang={lang}
              value={code}
              onValueChange={setCode}
              prohibitExternalCodeInjection={practicePolicy?.prohibitExternalCodeInjection === true}
              minHeight={480}
              className="h-full"
            />
          </div>
        )}

        {compiledStructuredAnswer ? (
          <section className="space-y-3 rounded-xl border border-border/70 p-4" aria-labelledby="structured-self-test-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="structured-self-test-heading" className="text-sm font-semibold">
                  自定义输入自测
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">运行当前作答拼接出的完整程序；期望输出可留空，留空时只展示实际输出。</p>
              </div>
              <Button type="button" variant="outline" disabled={selfTestRunning} onClick={handleSelfTest} className="min-h-11 gap-1.5">
                {selfTestRunning ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Play className="size-4" />}
                {selfTestRunning ? '运行中…' : '运行自测'}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium">标准输入</span>
                <textarea
                  value={selfTestInput}
                  onChange={(event) => setSelfTestInput(event.target.value)}
                  className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  spellCheck={false}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium">期望输出（可选）</span>
                <textarea
                  value={selfTestExpected}
                  onChange={(event) => setSelfTestExpected(event.target.value)}
                  className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  spellCheck={false}
                />
              </label>
            </div>
            {selfTestError ? (
              <p role="alert" className="text-sm text-destructive">
                {selfTestError}
              </p>
            ) : null}
            {selfTestResult ? (
              <div className="min-h-56 overflow-hidden rounded-lg border" aria-live="polite">
                <PretestResultInline
                  result={selfTestResult}
                  expectedOutput={selfTestExpected}
                  activeResultTab={selfTestResultTab}
                  onResultTabChange={setSelfTestResultTab}
                />
              </div>
            ) : null}
          </section>
        ) : textProgramFill ? (
          <p className="rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground">文本比对模式不执行程序，请填写后直接提交。</p>
        ) : null}

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
