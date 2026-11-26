import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Play, Plus, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { distributePretestRecord, isTerminalJudgeStatus, normalizePretestLineEndings, parseRecordResponse,
  preferredPretestResultTab, pretestActualOutput, pretestOutputsMatch, selfTestVerdict, type PretestResult } from '@/lib/pretest-results';
import type { SampleCase } from '@/lib/samples';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/display';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

export interface IdePretestOptions {
  getCode: () => string;
  getLang: () => string;
  canPretest: boolean;
  pretestUrl?: string;
  submitUrl?: string;
  resolveRecordUrl: (rid: string, fallback?: string) => string;
  samples?: SampleCase[];
  practiceContextId?: string;
  reloadOnConflict?: boolean;
}

export interface IdePretestHandle {
  openSampleTab: (sampleId: number) => void;
}

interface PretestTab {
  id: string;
  label: string;
  input: string;
  expectedOutput: string;
}

export function useIdePretest({ getCode, getLang, canPretest, pretestUrl, submitUrl, resolveRecordUrl,
  samples = [], practiceContextId, reloadOnConflict = false }: IdePretestOptions) {
  const pretestAbort = useRef<AbortController | null>(null);
  const customSequence = useRef(0);
  const [showPretest, setShowPretest] = useState(false);
  const [pretestRunning, setPretestRunning] = useState<Set<string>>(new Set());
  const [pretestResults, setPretestResults] = useState<Map<string, PretestResult>>(new Map());
  const [pretestCooldown, setPretestCooldown] = useState(0);
  const pretestLoading = pretestRunning.size > 0;
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
  const [selectedTestTab, setActiveTestTab] = useState(pretestTabs[0]?.id || 'custom');
  const [pretestResultTab, setPretestResultTab] = useState<'output' | 'diff' | 'compiler'>('output');
  const activeTab = pretestTabs.find((t) => t.id === selectedTestTab) || pretestTabs[pretestTabs.length - 1];
  const activeTestTab = activeTab.id;
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
  const samplesKey = useMemo(() => JSON.stringify(samples), [samples]);
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
      // Preserve custom inputs and avoid updating state for identical sample contents.
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
    const id = `custom-${++customSequence.current}`;
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

  const runPretestForTabs = useCallback(
    async (tabIds: string[], includeEmpty = false) => {
      if (pretestCooldown > 0) return;
      const endpoint = pretestUrl || submitUrl;
      if (!endpoint || !canPretest) return;
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
        if (abort.signal.aborted) return;
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
        const res = await fetchHydroResponse(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            lang: getLang(),
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

        const data: unknown = await res.json();
        if (!data || typeof data !== 'object' || !('rid' in data) || typeof data.rid !== 'string' || !data.rid) {
          throw new Error('自测提交响应中没有记录编号');
        }
        const rid = data.rid;
        const fallbackUrl = 'url' in data && typeof data.url === 'string' ? data.url : `/record/${rid}`;
        if (!rid) throw new Error('自测提交响应中没有记录编号');

        const recordUrl = resolveRecordUrl(rid, fallbackUrl);

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
        if (!abort.signal.aborted) {
          setErrorForAll(8, e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (pretestAbort.current === abort) {
          pretestAbort.current = null;
          setPretestRunning(new Set());
        }
      }
    },
    [submitUrl, pretestUrl, canPretest, pretestTabs, getLang, getCode, pretestCooldown, reloadOnConflict, resolveRecordUrl, practiceContextId],
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

  const copySampleToCustom = useCallback(() => {
    if (!isSampleTab) return;
    const id = `custom-${++customSequence.current}`;
    setPretestTabs((prev) => [...prev, { ...activeTab, id, label: `自定义 ${prev.filter((tab) => tab.id.startsWith('custom')).length + 1}` }]);
    setActiveTestTab(id);
  }, [activeTab, isSampleTab]);

  const openSampleTab = useCallback((sampleId: number) => {
    const id = `sample-${sampleId}`;
    if (!samples.some((sample) => sample.id === sampleId)) throw new Error(`样例 ${sampleId} 不存在`);
    setActiveTestTab(id);
    setShowPretest(true);
  }, [samples]);

  useEffect(() => () => { pretestAbort.current?.abort(); }, []);
  useEffect(() => {
    if (pretestCooldown <= 0) return;
    const timer = setInterval(() => setPretestCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [pretestCooldown > 0]);

  return { showPretest, setShowPretest, pretestRunning, pretestResults, pretestLoading, pretestCooldown,
    pretestTabs, activeTestTab, setActiveTestTab, activeTab, isSampleTab, pretestResultTab, setPretestResultTab,
    updateTabField, addCustomTab, removeTab, copySampleToCustom, openSampleTab, handleRunActive, handleRunAll };
}

export type IdePretestController = ReturnType<typeof useIdePretest>;

export function IdePretestPanel({ pretest }: { pretest: IdePretestController }) {
  const { showPretest, setShowPretest, pretestRunning, pretestResults, pretestLoading, pretestCooldown,
    pretestTabs, activeTestTab, setActiveTestTab, activeTab, isSampleTab, pretestResultTab, setPretestResultTab,
    updateTabField, addCustomTab, removeTab, copySampleToCustom, handleRunActive } = pretest;
  const panelRef = useRef<HTMLDivElement>(null);
  const pretestPanelRef = useRef<HTMLDivElement>(null);
  const pretestDragging = useRef(false);
  const pretestHDragging = useRef(false);
  const pretestVDragging = useRef(false);
  const [pretestHeight, setPretestHeight] = useState(200);
  const [pretestLeftPct, setPretestLeftPct] = useState(50);
  const [pretestInputPct, setPretestInputPct] = useState(65);
  /* ── Pretest panel resize via drag (top edge, horizontal split, vertical split) ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!pretestDragging.current && !pretestHDragging.current && !pretestVDragging.current) return;
      e.preventDefault();

      // Top-edge drag (panel height)
      if (pretestDragging.current) {
        const parent = panelRef.current?.parentElement;
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
      onUp();
    };
  }, []);

  if (!showPretest) return null;
  return (
        <div ref={panelRef} className="flex min-h-0 flex-col border-t border-line" style={{ height: pretestHeight, minHeight: 120 }}>
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
                  {isSampleTab && <Button type="button" variant="ghost" size="sm" className="ml-auto shrink-0" onClick={copySampleToCustom}>复制到自定义</Button>}
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
  );
}

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
