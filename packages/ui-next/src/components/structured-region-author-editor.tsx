import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { useEffect, useMemo, useRef } from 'react';
import { structuredCodeLanguageExtension } from '@/lib/structured-code-language';
import { mapStructuredLineRanges, type StructuredLineRange } from '@/lib/structured-code-ranges';

export type AuthorLineRange = StructuredLineRange;

export interface AuthorLineSelection {
  startLine: number;
  endLine: number;
  expanded: boolean;
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

/** Map whole-line ranges through the exact CodeMirror transaction. */
export function mapAuthorLineRanges(update: ViewUpdate, ranges: AuthorLineRange[]): AuthorLineRange[] {
  if (!update.docChanged) return ranges;
  return mapStructuredLineRanges(update.startState.doc, update.state.doc, update.changes, ranges);
}

export function StructuredRegionAuthorEditor({
  lang,
  source,
  ranges,
  onSourceChange,
  onSelectionChange,
}: {
  lang: string;
  source: string;
  ranges: AuthorLineRange[];
  onSourceChange: (source: string, ranges: AuthorLineRange[]) => void;
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
    () => JSON.stringify(ranges.map(({ key, startLine, endLine, state, invalid }) => ({ key, startLine, endLine, state, invalid: !!invalid }))),
    [ranges],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const rangeSnapshot = ranges.map((range) => ({ ...range }));
    const language = new Compartment();
    let gutterAnchor: number | null = null;
    const rangeForLine = (line: number) => rangeSnapshot.find((range) => range.startLine <= line && line < range.endLine);
    const selectGutterLines = (view: EditorView, lineFrom: number) => {
      if (gutterAnchor === null) gutterAnchor = lineFrom;
      const from = Math.min(gutterAnchor, lineFrom);
      const toLine = view.state.doc.lineAt(Math.max(gutterAnchor, lineFrom));
      view.dispatch({ selection: { anchor: from, head: toLine.to }, scrollIntoView: true });
    };
    const state = EditorState.create({
      doc: sourceRef.current,
      extensions: [
        lineNumbers({
          formatNumber: (lineNo) => {
            const range = rangeForLine(lineNo - 1);
            const marker = range?.invalid ? '!' : range?.state === 'public' ? '公' : range?.state === 'answer' ? '答' : '私';
            return `${marker} ${lineNo}`;
          },
          domEventHandlers: {
            mousedown(view, line, event) {
              if ((event as MouseEvent).button !== 0) return false;
              gutterAnchor = line.from;
              selectGutterLines(view, line.from);
              event.preventDefault();
              return true;
            },
            mousemove(view, line, event) {
              if (gutterAnchor === null || !((event as MouseEvent).buttons & 1)) return false;
              selectGutterLines(view, line.from);
              event.preventDefault();
              return true;
            },
            mouseup() {
              gutterAnchor = null;
              return false;
            },
          },
        }),
        history(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        language.of(structuredCodeLanguageExtension(lang)),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) sourceChangeRef.current(update.state.doc.toString(), mapAuthorLineRanges(update, rangeSnapshot));
          if (update.docChanged || update.selectionSet) selectionChangeRef.current(selectedWholeLines(update.state));
        }),
        EditorView.decorations.compute(['doc'], (current) => {
          const decorations: Array<{ from: number; value: Decoration }> = [];
          for (const range of rangeSnapshot) {
            if (range.startLine < 0 || range.endLine <= range.startLine || range.endLine > current.doc.lines) continue;
            for (let line = range.startLine; line < range.endLine; line++) {
              const className = range.invalid
                ? 'krypton-structured-line-invalid'
                : range.state === 'public'
                  ? 'krypton-structured-line-public'
                  : 'krypton-structured-line-answer';
              decorations.push({ from: current.doc.line(line + 1).from, value: Decoration.line({ class: className }) });
            }
          }
          return Decoration.set(
            decorations.sort((a, b) => a.from - b.from).map(({ from, value }) => value.range(from)),
            true,
          );
        }),
        EditorView.theme({
          '&': { height: '100%', minHeight: '28rem', fontSize: '13px' },
          '.cm-scroller': { height: '100%', overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
          '.cm-gutters': { minHeight: '100%' },
          '.cm-content': { minHeight: '100%', padding: '12px 0' },
          '.cm-lineNumbers .cm-gutterElement': { minWidth: '4.5rem', cursor: 'pointer' },
          '.krypton-structured-line-public': { backgroundColor: 'color-mix(in srgb, #16a34a 12%, transparent)' },
          '.krypton-structured-line-answer': { backgroundColor: 'color-mix(in srgb, var(--primary) 14%, transparent)' },
          '.krypton-structured-line-invalid': { backgroundColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)' },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    selectionChangeRef.current(selectedWholeLines(state));
    const clearGutterAnchor = () => {
      gutterAnchor = null;
    };
    window.addEventListener('mouseup', clearGutterAnchor);
    return () => {
      window.removeEventListener('mouseup', clearGutterAnchor);
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

  return (
    <div
      ref={hostRef}
      className="h-[32rem] min-h-[28rem] overflow-hidden rounded-xl border bg-background"
      aria-label="私有完整模板编辑器；行号前公、答、私分别表示公开、作答和私有"
    />
  );
}
