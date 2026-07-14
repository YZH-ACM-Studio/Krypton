import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { useEffect, useMemo, useRef } from 'react';

export interface AuthorLineRegion {
  key: string;
  startLine: number;
  endLine: number;
  invalid?: boolean;
}

export interface AuthorLineSelection {
  startLine: number;
  endLine: number;
  expanded: boolean;
}

function languageExtension(lang: string): Extension {
  const base = lang.toLowerCase().split('.')[0];
  if (['c', 'cc', 'cpp'].includes(base)) return cpp();
  if (['py', 'python'].includes(base)) return python();
  if (base === 'java') return java();
  if (['js', 'javascript', 'ts', 'typescript'].includes(base)) return javascript({ typescript: ['ts', 'typescript'].includes(base) });
  if (base === 'go') return go();
  if (['rs', 'rust'].includes(base)) return rust();
  return [];
}

function selectedWholeLines(state: EditorState): AuthorLineSelection | null {
  const range = state.selection.main;
  if (range.empty) return null;
  const start = state.doc.lineAt(range.from);
  const lastSelectedPosition = Math.max(range.from, range.to - 1);
  const end = state.doc.lineAt(lastSelectedPosition);
  return {
    startLine: start.number - 1,
    endLine: end.number,
    expanded: range.from !== start.from || range.to !== end.to,
  };
}

export function StructuredRegionAuthorEditor({
  lang,
  source,
  regions,
  onSourceChange,
  onSelectionChange,
}: {
  lang: string;
  source: string;
  regions: AuthorLineRegion[];
  onSourceChange: (source: string) => void;
  onSelectionChange: (selection: AuthorLineSelection | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sourceRef = useRef(source);
  const sourceChangeRef = useRef(onSourceChange);
  const selectionChangeRef = useRef(onSelectionChange);
  sourceRef.current = source;
  sourceChangeRef.current = onSourceChange;
  selectionChangeRef.current = onSelectionChange;
  const geometryKey = useMemo(
    () => JSON.stringify(regions.map(({ key, startLine, endLine, invalid }) => ({ key, startLine, endLine, invalid: !!invalid }))),
    [regions],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const regionSnapshot = regions.map((region) => ({ ...region }));
    const language = new Compartment();
    const state = EditorState.create({
      doc: sourceRef.current,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        language.of(languageExtension(lang)),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) sourceChangeRef.current(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) selectionChangeRef.current(selectedWholeLines(update.state));
        }),
        EditorView.decorations.compute(['doc'], (current) => {
          const decorations: Array<{ from: number; value: Decoration }> = [];
          for (const region of regionSnapshot) {
            if (region.startLine < 0 || region.endLine <= region.startLine || region.endLine > current.doc.lines) continue;
            for (let line = region.startLine; line < region.endLine; line++) {
              decorations.push({
                from: current.doc.line(line + 1).from,
                value: Decoration.line({ class: region.invalid ? 'krypton-region-line-invalid' : 'krypton-region-line' }),
              });
            }
          }
          return Decoration.set(
            decorations.sort((a, b) => a.from - b.from).map(({ from, value }) => value.range(from)),
            true,
          );
        }),
        EditorView.theme({
          '&': { minHeight: '28rem', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
          '.cm-content': { padding: '12px 0' },
          '.krypton-region-line': { backgroundColor: 'color-mix(in srgb, var(--primary) 12%, transparent)' },
          '.krypton-region-line-invalid': { backgroundColor: 'color-mix(in srgb, var(--destructive) 18%, transparent)' },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    selectionChangeRef.current(selectedWholeLines(state));
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [geometryKey, lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: source } });
  }, [source]);

  return <div ref={hostRef} className="overflow-hidden rounded-lg border bg-background" aria-label="私有完整模板编辑器" />;
}
