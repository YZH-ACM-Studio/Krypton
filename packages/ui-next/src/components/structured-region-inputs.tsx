import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { structuredCodeLanguageExtension } from '@/lib/structured-code-language';

function StructuredRegionCodeEditor({
  value,
  onChange,
  lang,
  readOnly,
  label,
  prohibitExternalCodeInjection,
  onExternalCodeInjection,
}: {
  value: string;
  onChange: (value: string) => void;
  lang: string;
  readOnly: boolean;
  label: string;
  prohibitExternalCodeInjection: boolean;
  onExternalCodeInjection: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        structuredCodeLanguageExtension(lang),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        ...(prohibitExternalCodeInjection
          ? [
              EditorView.domEventHandlers({
                paste(event) {
                  event.preventDefault();
                  onExternalCodeInjection();
                  return true;
                },
                beforeinput(event) {
                  if (event.inputType !== 'insertFromPaste' && event.inputType !== 'insertFromDrop') return false;
                  event.preventDefault();
                  onExternalCodeInjection();
                  return true;
                },
                drop(event) {
                  event.preventDefault();
                  onExternalCodeInjection();
                  return true;
                },
              }),
              EditorState.changeFilter.of((transaction) => {
                const prohibited =
                  transaction.docChanged &&
                  (transaction.isUserEvent('input.paste') || transaction.isUserEvent('input.drop') || transaction.isUserEvent('move.drop'));
                if (prohibited) onExternalCodeInjection();
                return !prohibited;
              }),
            ]
          : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncingRef.current) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { minHeight: '8rem', fontSize: '13px' },
          '.cm-scroller': {
            minHeight: '8rem',
            maxHeight: '24rem',
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          },
          '.cm-content, .cm-gutter': { minHeight: '8rem' },
          '.cm-content': { padding: '10px 0' },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [label, lang, onExternalCodeInjection, prohibitExternalCodeInjection, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
  }, [value]);

  return <div ref={hostRef} className="min-w-0 w-full overflow-hidden rounded-lg border border-line bg-bg" />;
}

export function StructuredRegionInputs({
  surface,
  values,
  onChange,
  lang = '',
  singleLine = false,
  readOnly = false,
  prohibitExternalCodeInjection = false,
}: {
  surface: ClientStructuredCodeSegment[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  lang?: string;
  singleLine?: boolean;
  readOnly?: boolean;
  prohibitExternalCodeInjection?: boolean;
}) {
  const controls = useRef(new Map<string, HTMLInputElement>());
  const [integrityError, setIntegrityError] = useState('');
  const rejectExternalCodeInjection = useCallback(() => {
    setIntegrityError('当前真实性训练禁止粘贴或拖入外部代码，请直接填写作答区。');
  }, []);
  const regions = surface.filter((segment) => segment.type === 'region');
  const regionIds = regions.map((region) => region.id);
  if (!Array.isArray(surface)) throw new TypeError('structured code surface must be an array');
  if (new Set(regionIds).size !== regionIds.length) throw new Error('structured code surface contains duplicate region ids');

  const moveFocus = (event: React.KeyboardEvent, id: string) => {
    if (event.key !== 'Tab') return;
    const index = regionIds.indexOf(id);
    const targetId = regionIds[index + (event.shiftKey ? -1 : 1)];
    if (!targetId) return;
    const target = controls.current.get(targetId);
    if (!target) throw new Error(`structured code keyboard target ${targetId} is not mounted`);
    event.preventDefault();
    target.focus();
  };

  const rejectSingleLineInjection = (event: React.FormEvent<HTMLInputElement>) => {
    if (!prohibitExternalCodeInjection) return;
    const native = event.nativeEvent as InputEvent;
    if (native.inputType !== 'insertFromPaste' && native.inputType !== 'insertFromDrop') return;
    event.preventDefault();
    rejectExternalCodeInjection();
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface-sunken" aria-label="连续代码作答区">
      <div className="min-w-0 font-mono text-sm">
        {surface.length ? (
          surface.map((segment, index) => {
            if (segment.type === 'code') {
              return (
                <pre key={`code-${index}`} className="m-0 overflow-x-auto whitespace-pre px-4 py-2 leading-6 text-fg">
                  <code className="inline-block min-w-max">{segment.code || ' '}</code>
                </pre>
              );
            }
            const regionIndex = regionIds.indexOf(segment.id);
            const label = segment.title || segment.prompt || `作答区 ${regionIndex + 1}`;
            return (
              <label key={segment.id} className="block min-w-0 border-y border-brand-line bg-brand-soft px-3 py-2">
                <span className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 font-sans text-xs font-medium text-fg">
                  <span className="min-w-0">{label}</span>
                  {segment.description ? <span className="min-w-0 font-normal text-fg-subtle">{segment.description}</span> : null}
                </span>
                {singleLine ? (
                  <Input
                    ref={(element) => {
                      if (element) controls.current.set(segment.id, element);
                      else controls.current.delete(segment.id);
                    }}
                    value={values[segment.id] || ''}
                    onChange={(event) => onChange(segment.id, event.target.value.replace(/[\r\n]/g, ''))}
                    onBeforeInput={rejectSingleLineInjection}
                    onPaste={(event) => {
                      if (!prohibitExternalCodeInjection) return;
                      event.preventDefault();
                      rejectExternalCodeInjection();
                    }}
                    onDrop={(event) => {
                      if (!prohibitExternalCodeInjection) return;
                      event.preventDefault();
                      rejectExternalCodeInjection();
                    }}
                    onKeyDown={(event) => moveFocus(event, segment.id)}
                    disabled={readOnly}
                    placeholder={segment.prompt || `填写第 ${regionIndex + 1} 空代码`}
                    className="h-9 min-h-9 min-w-0 w-full font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                ) : (
                  <StructuredRegionCodeEditor
                    value={values[segment.id] || ''}
                    onChange={(value) => onChange(segment.id, value)}
                    lang={lang}
                    readOnly={readOnly}
                    label={`${label}代码编辑器`}
                    prohibitExternalCodeInjection={prohibitExternalCodeInjection}
                    onExternalCodeInjection={rejectExternalCodeInjection}
                  />
                )}
              </label>
            );
          })
        ) : (
          <p className="px-4 py-5 font-sans text-sm text-fg-muted">当前没有公开代码或作答区。</p>
        )}
      </div>
      {integrityError ? (
        <p role="alert" className="border-t border-warning-line bg-warning-soft px-3 py-2 font-sans text-sm text-warning-fg">
          {integrityError}
        </p>
      ) : null}
    </div>
  );
}
