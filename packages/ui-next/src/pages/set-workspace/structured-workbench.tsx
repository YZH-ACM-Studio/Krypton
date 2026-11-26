import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import hljs from 'highlight.js/lib/common';
import { ChevronDown, ChevronRight, History, Play } from 'lucide-react';
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { IdePretestPanel, useIdePretest, type IdePretestHandle } from '@/components/ide-pretest-panel';
import { getLangEntry, kryptonEditorTheme } from '@/components/krypton-ide';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/display';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Verdict } from '@/components/ui/verdict';
import { cn } from '@/lib/cn';
import type { SampleCase } from '@/lib/samples';
import { structuredCodeLanguageExtension } from '@/lib/structured-code-language';
import { useColorMode } from '@/lib/use-color-mode';

const INJECTION_ERROR = '当前真实性训练禁止粘贴或拖入外部代码，请直接填写作答区。';

/** Only the visible segment is numbered; no original source coordinates exist here. */
function PublicCode({ code, lang }: { code: string; lang: string }) {
  const html = useMemo(() => {
    const base = lang.split('.')[0];
    const language = ({ cc: 'cpp', py: 'python', js: 'javascript', ts: 'typescript', rs: 'rust' } as Record<string, string>)[base] ?? base;
    return hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : null;
  }, [code, lang]);
  return (
    <div className="flex min-w-0 font-mono leading-6">
      <pre
        aria-hidden="true"
        className="m-0 w-11 shrink-0 select-none border-r border-line-subtle bg-surface-sunken px-2 py-2 text-right text-fg-subtle"
      >
        {code
          .split('\n')
          .map((_, index) => index + 1)
          .join('\n')}
      </pre>
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre px-3 py-2 text-fg">
        {html === null ? <code>{code || ' '}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
    </div>
  );
}

function FunctionRegionEditor({
  value,
  onChange,
  lang,
  label,
  readOnly,
  prohibitExternalCodeInjection,
  onReject,
  onFocus,
  focusRef,
}: {
  value: string;
  onChange: (value: string) => void;
  lang: string;
  label: string;
  readOnly: boolean;
  prohibitExternalCodeInjection: boolean;
  onReject: () => void;
  onFocus: () => void;
  focusRef: (focus: (() => void) | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const options = useRef({ onChange, onReject, onFocus, readOnly, prohibitExternalCodeInjection });
  options.current = { onChange, onReject, onFocus, readOnly, prohibitExternalCodeInjection };
  const initialValue = useRef(value);
  const syncing = useRef(false);
  const settings = useRef(new Compartment());
  const theme = kryptonEditorTheme(useColorMode() === 'dark');

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const reject = (event: Event) => {
      if (!options.current.prohibitExternalCodeInjection) return false;
      event.preventDefault();
      options.current.onReject();
      return true;
    };
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          structuredCodeLanguageExtension(lang),
          settings.current.of([]),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.domEventHandlers({
            focus() {
              options.current.onFocus();
            },
            paste: reject,
            drop: reject,
            beforeinput(event) {
              return (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') && reject(event);
            },
          }),
          EditorState.changeFilter.of((transaction) => {
            const blocked =
              options.current.prohibitExternalCodeInjection &&
              transaction.docChanged &&
              (transaction.isUserEvent('input.paste') || transaction.isUserEvent('input.drop') || transaction.isUserEvent('move.drop'));
            if (blocked) options.current.onReject();
            return !blocked;
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current) options.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', minHeight: '12rem', fontSize: 'inherit' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
            '.cm-gutters': { minWidth: '2.75rem' },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [label, lang]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: settings.current.reconfigure([theme, EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [theme, readOnly, label, lang]);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncing.current = true;
    try {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    } finally {
      syncing.current = false;
    }
  }, [value, label, lang]);
  useLayoutEffect(() => {
    focusRef(() => viewRef.current?.focus());
    return () => focusRef(null);
  }, [focusRef]);
  return <div ref={hostRef} className="min-h-48 min-w-0 flex-1" />;
}

export interface WorkspaceStructuredBenchProps {
  surface: ClientStructuredCodeSegment[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  kind: 'program_fill' | 'function';
  lang: string;
  readOnly?: boolean;
  prohibitExternalCodeInjection?: boolean;
  primaryAction: ReactNode;
  onSubmit?: () => void;
  statusExtra?: ReactNode;
  result?: { status: number; score?: number };
  recordsVisible?: boolean;
  recordsCount?: number;
  onToggleRecords?: () => void;
  pretest?: { url: string; resolveRecordUrl: (rid: string) => string; samples: SampleCase[] };
  pretestApiRef?: Ref<IdePretestHandle>;
}

export function WorkspaceStructuredBench({
  surface,
  values,
  onChange,
  kind,
  lang,
  readOnly = false,
  prohibitExternalCodeInjection = false,
  primaryAction,
  onSubmit,
  statusExtra,
  result,
  recordsVisible = true,
  recordsCount = 0,
  onToggleRecords,
  pretest: pretestOptions,
  pretestApiRef,
}: WorkspaceStructuredBenchProps) {
  const regions = surface.filter((segment) => segment.type === 'region');
  if (new Set(regions.map((region) => region.id)).size !== regions.length) {
    throw new Error('structured code surface contains duplicate region ids');
  }
  const fill = kind === 'program_fill';
  const [view, setView] = useState<'inline' | 'list'>('inline');
  const [selectedId, setSelectedId] = useState(regions[0]?.id ?? '');
  const active = regions.find((region) => region.id === selectedId) ?? regions[0];
  const activeIndex = regions.findIndex((region) => region.id === active?.id);
  const [focused, setFocused] = useState(false);
  const [showSpaces, setShowSpaces] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [integrityError, setIntegrityError] = useState('');
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const editors = useRef(new Map<string, () => void>());
  const sections = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const reject = useCallback(() => setIntegrityError(INJECTION_ERROR), []);
  const pretest = useIdePretest({
    getCode: () => JSON.stringify(Object.fromEntries(regions.map((region) => [region.id, values[region.id] ?? '']))),
    getLang: () => lang,
    canPretest: !!pretestOptions && !readOnly,
    pretestUrl: pretestOptions?.url,
    resolveRecordUrl: (rid) => {
      if (!pretestOptions) throw new Error('自测记录地址缺失');
      return pretestOptions.resolveRecordUrl(rid);
    },
    samples: pretestOptions?.samples,
  });
  useImperativeHandle(pretestApiRef, () => ({ openSampleTab: pretest.openSampleTab }), [pretest.openSampleTab]);
  const focusMountedRegion = (id: string) => {
    sections.current.get(id)?.scrollIntoView?.({ block: 'nearest' });
    if (fill) inputs.current.get(id)?.focus();
    else editors.current.get(id)?.();
  };
  const focusRegion = (id: string, inline = false) => {
    setSelectedId(id);
    if (inline) setView('inline');
    if ((inline && view !== 'inline') || (!fill && focused && id !== active?.id)) pendingFocus.current = id;
    else focusMountedRegion(id);
  };
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    focusMountedRegion(id);
  });
  const regionInput = (region: (typeof regions)[number], index: number) => (
    <Input
      ref={(element) => {
        if (element) inputs.current.set(region.id, element);
        else inputs.current.delete(region.id);
      }}
      aria-label={region.title || region.prompt || `第 ${index + 1} 空`}
      value={values[region.id] ?? ''}
      placeholder={region.prompt || `填写第 ${index + 1} 空代码`}
      disabled={readOnly}
      className="min-w-0 w-full font-mono text-inherit"
      autoComplete="off"
      spellCheck={false}
      onFocus={() => setSelectedId(region.id)}
      onChange={(event) => onChange(region.id, event.target.value.replace(/[\r\n]/g, ''))}
      onPaste={(event) => {
        if (prohibitExternalCodeInjection) {
          event.preventDefault();
          reject();
        }
      }}
      onDrop={(event) => {
        if (prohibitExternalCodeInjection) {
          event.preventDefault();
          reject();
        }
      }}
      onBeforeInput={(event) => {
        const inputType = (event.nativeEvent as InputEvent).inputType;
        if (prohibitExternalCodeInjection && (inputType === 'insertFromPaste' || inputType === 'insertFromDrop')) {
          event.preventDefault();
          reject();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        focusRegion(regions[(index + (event.shiftKey ? regions.length - 1 : 1)) % regions.length].id);
      }}
    />
  );

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
      aria-label="结构化代码工作台"
      onKeyDownCapture={(event) => {
        if (event.key === 'F9' && pretestOptions && !readOnly) {
          event.preventDefault();
          event.stopPropagation();
          pretest.handleRunActive();
        }
        if (event.key === 'F10' && onSubmit && !readOnly) {
          event.preventDefault();
          event.stopPropagation();
          onSubmit();
        }
      }}
    >
      <div className="flex shrink-0 items-center border-b border-line bg-surface-sunken">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3 py-1.5">
          <Badge variant="outline" size="sm">
            {lang === '_' ? '文本比对' : getLangEntry(lang).label}
          </Badge>
          {fill ? (
            <MiniTabs
              aria-label="填空视图"
              value={view}
              onValueChange={setView}
              className="shrink-0"
              items={[
                { value: 'inline', label: '原位代码' },
                { value: 'list', label: '分空列表' },
              ]}
            />
          ) : (
            <>
              <MiniTabs
                aria-label="当前作答区"
                value={active?.id ?? ''}
                onValueChange={(id) => focusRegion(id)}
                className="shrink-0"
                items={regions.map((region, index) => ({ value: region.id, label: `作答区 ${index + 1}` }))}
              />
              <Button
                variant="ghost"
                size="sm"
                className="w-24 shrink-0"
                aria-pressed={focused}
                onClick={() => setFocused((value) => !value)}
              >
                {focused ? '单区聚焦' : '全部展开'}
              </Button>
            </>
          )}
          {pretestOptions ? (
            <>
              <Button
                variant={pretest.showPretest ? 'secondary' : 'ghost'}
                size="sm"
                className="shrink-0"
                aria-pressed={pretest.showPretest}
                onClick={() => pretest.setShowPretest((value) => !value)}
              >
                自测
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-32 shrink-0"
                disabled={readOnly || pretest.pretestLoading || pretest.pretestCooldown > 0}
                onClick={pretest.handleRunAll}
              >
                <Play className="size-3.5" />
                {pretest.pretestCooldown > 0 ? <span className="tabular">{`冷却 ${pretest.pretestCooldown}s`}</span> : '运行全部自测'}
              </Button>
            </>
          ) : null}
          {onToggleRecords ? (
            <Button
              variant={recordsVisible ? 'secondary' : 'ghost'}
              size="sm"
              className="shrink-0"
              aria-pressed={recordsVisible}
              onClick={onToggleRecords}
            >
              <History className="size-3.5" />
              提交记录<span className="tabular">{recordsCount}</span>
            </Button>
          ) : null}
          {fill ? (
            <>
              {regions.map((region, index) => (
                <Button
                  key={region.id}
                  variant={region.id === active?.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className="shrink-0"
                  iconOnly
                  aria-label={`跳到第 ${index + 1} 空`}
                  onClick={() => focusRegion(region.id)}
                >
                  {index < 20 ? String.fromCharCode(0x2460 + index) : index + 1}
                </Button>
              ))}
              <Button
                variant={showSpaces ? 'secondary' : 'ghost'}
                size="sm"
                className="w-16 shrink-0"
                aria-pressed={showSpaces}
                onClick={() => setShowSpaces((value) => !value)}
              >
                空格
              </Button>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center border-l border-line px-3 py-1.5">{primaryAction}</div>
      </div>
      {fill && active ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-xs">
          <span className="shrink-0 font-medium tabular">{`第 ${activeIndex + 1} 空`}</span>
          <span
            className="min-w-0 flex-1 truncate text-fg-muted"
            title={[active.title, active.description, active.prompt].filter(Boolean).join(' · ')}
          >
            {[active.title, active.description, active.prompt].filter(Boolean).join(' · ')}
          </span>
          {showSpaces ? (
            <code className="max-w-48 truncate text-brand-fg" aria-label="空格预览">
              {(values[active.id] ?? '').replace(/ /g, '·')}
            </code>
          ) : null}
          <Button variant="ghost" size="sm" disabled={readOnly || !values[active.id]} onClick={() => onChange(active.id, '')}>
            清空此空
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto text-sm">
        {fill && view === 'list'
          ? regions.map((region, index) => {
              const position = surface.indexOf(region);
              const preceding = surface[position - 1];
              return (
                <section
                  key={region.id}
                  ref={(element) => {
                    if (element) sections.current.set(region.id, element);
                    else sections.current.delete(region.id);
                  }}
                  className="shrink-0 border-b border-line-subtle p-3"
                >
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="font-medium">{region.title || `第 ${index + 1} 空`}</span>
                    <span className="flex-1 text-fg-muted">{region.description}</span>
                    <Button variant="ghost" size="sm" onClick={() => focusRegion(region.id, true)}>
                      在代码中定位
                    </Button>
                  </div>
                  {preceding?.type === 'code' ? (
                    <pre className="mb-2 overflow-x-auto font-mono text-xs text-fg-subtle">
                      {preceding.code.split('\n').slice(-3).join('\n')}
                    </pre>
                  ) : null}
                  {regionInput(region, index)}
                </section>
              );
            })
          : surface.map((segment, index) => {
              if (segment.type === 'code') {
                return (
                  <div key={`code-${index}`} className="shrink-0">
                    {!fill ? (
                      <div className="border-b border-line-subtle px-2 py-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={!collapsed.has(index)}
                          onClick={() =>
                            setCollapsed((current) => {
                              const next = new Set(current);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(index) ? <ChevronRight /> : <ChevronDown />}公开代码
                        </Button>
                      </div>
                    ) : null}
                    {fill || !collapsed.has(index) ? <PublicCode code={segment.code} lang={lang} /> : null}
                  </div>
                );
              }
              const regionIndex = regions.indexOf(segment);
              const hidden = !fill && focused && segment.id !== active?.id;
              return (
                <section
                  key={segment.id}
                  hidden={hidden}
                  ref={(element) => {
                    if (element) sections.current.set(segment.id, element);
                    else sections.current.delete(segment.id);
                  }}
                  className={cn('min-w-0 border-y border-brand-line', hidden ? 'hidden' : !fill && focused ? 'flex min-h-64 flex-1 flex-col' : 'shrink-0')}
                >
                  {fill ? (
                    <div className="flex items-stretch bg-brand-soft">
                      <span className="flex w-11 shrink-0 items-center justify-center border-r border-brand-line font-mono text-brand-fg tabular">{`#${regionIndex + 1}`}</span>
                      <div className="min-w-0 flex-1 px-3 py-2">{regionInput(segment, regionIndex)}</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex shrink-0 items-baseline gap-2 bg-brand-soft px-3 py-2 text-xs">
                        <span className="font-medium text-brand-fg">{segment.title || `作答区 ${regionIndex + 1}`}</span>
                        <span className="text-fg-muted">{segment.description || segment.prompt}</span>
                      </div>
                      <FunctionRegionEditor
                        value={values[segment.id] ?? ''}
                        onChange={(value) => onChange(segment.id, value)}
                        lang={lang}
                        label={`${segment.title || `作答区 ${regionIndex + 1}`}代码编辑器`}
                        readOnly={readOnly}
                        prohibitExternalCodeInjection={prohibitExternalCodeInjection}
                        onReject={reject}
                        onFocus={() => setSelectedId(segment.id)}
                        focusRef={(focus) => {
                          if (focus) editors.current.set(segment.id, focus);
                          else editors.current.delete(segment.id);
                        }}
                      />
                    </>
                  )}
                </section>
              );
            })}
      </div>
      {integrityError ? <Alert tone="warning">{integrityError}</Alert> : null}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface-sunken px-3 py-1 text-2xs text-fg-subtle">
        <span className="tabular">{`已填 ${regions.filter((region) => values[region.id]?.trim()).length} / ${regions.length}`}</span>
        {active ? <span className="tabular">{`当前${fill ? '空' : '作答区'} ${activeIndex + 1}`}</span> : null}
        {fill ? (
          <span>
            <Kbd>Tab</Kbd> / <Kbd>Shift+Tab</Kbd> 切空
          </span>
        ) : null}
        {result ? <Verdict status={result.status} score={result.score} compact /> : null}
        {statusExtra}
      </div>
      {pretestOptions ? <IdePretestPanel pretest={pretest} /> : null}
    </div>
  );
}
