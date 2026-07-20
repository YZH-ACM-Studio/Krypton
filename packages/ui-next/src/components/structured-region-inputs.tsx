import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { structuredCodeLanguageExtension } from '@/lib/structured-code-language';

function StructuredRegionCodeEditor({
  value,
  onChange,
  lang,
  readOnly,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  lang: string;
  readOnly: boolean;
  label: string;
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
  }, [label, lang, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
  }, [value]);

  return <div ref={hostRef} className="overflow-hidden rounded-lg border bg-background" />;
}

export function StructuredRegionInputs({
  surface,
  values,
  onChange,
  lang = '',
  singleLine = false,
  readOnly = false,
}: {
  surface: ClientStructuredCodeSegment[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  lang?: string;
  singleLine?: boolean;
  readOnly?: boolean;
}) {
  const controls = useRef(new Map<string, HTMLInputElement>());
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

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/10" aria-label="连续代码作答区">
      <div className="overflow-x-auto font-mono text-sm">
        {surface.length ? (
          surface.map((segment, index) => {
            if (segment.type === 'code') {
              return (
                <pre key={`code-${index}`} className="m-0 min-w-max whitespace-pre px-4 py-2 leading-6 text-foreground">
                  <code>{segment.code || ' '}</code>
                </pre>
              );
            }
            const regionIndex = regionIds.indexOf(segment.id);
            const label = segment.title || segment.prompt || `作答区 ${regionIndex + 1}`;
            return (
              <label key={segment.id} className="block border-y border-primary/25 bg-primary/[0.055] px-3 py-2">
                <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2 font-sans text-xs font-medium text-foreground">
                  <span>{label}</span>
                  {segment.description ? <span className="font-normal text-muted-foreground">{segment.description}</span> : null}
                </span>
                {singleLine ? (
                  <Input
                    ref={(element) => {
                      if (element) controls.current.set(segment.id, element);
                      else controls.current.delete(segment.id);
                    }}
                    value={values[segment.id] || ''}
                    onChange={(event) => onChange(segment.id, event.target.value.replace(/[\r\n]/g, ''))}
                    onKeyDown={(event) => moveFocus(event, segment.id)}
                    disabled={readOnly}
                    placeholder={segment.prompt || `填写第 ${regionIndex + 1} 空代码`}
                    className="h-9 min-h-9 min-w-[18rem] font-mono"
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
                  />
                )}
              </label>
            );
          })
        ) : (
          <p className="px-4 py-5 font-sans text-sm text-muted-foreground">当前没有公开代码或作答区。</p>
        )}
      </div>
    </div>
  );
}
