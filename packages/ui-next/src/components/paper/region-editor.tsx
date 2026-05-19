/**
 * CodeMirror 6 editor with read-only ranges outside of `regions`. Built for
 * PRD §1.7 — fill_function visual editor.
 *
 * Student mode (default): only the ranges listed in `regions` are editable;
 * everything else is dimmed and changes inside locked ranges are dropped via
 * a `changeFilter`. Region content can be any number of lines.
 *
 * The component is fully controlled: parent owns `regionContents` (a map of
 * regionId → string) and receives `onChange` whenever any region's content
 * changes. The editor view holds the "live" spliced view of `template` +
 * current regionContents.
 */
import { useEffect, useMemo, useRef } from 'react';
import { EditorState, Extension, Compartment, StateField, StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { rust } from '@codemirror/lang-rust';
import { oneDark } from '@codemirror/theme-one-dark';

export interface RegionDef {
  id: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  prompt?: string;
}

export interface RegionEditorProps {
  lang: string;
  templateSource: string;
  regions: RegionDef[];
  regionContents: Record<string, string>;
  onChange: (regionId: string, content: string) => void;
  readOnly?: boolean;
  height?: string | number;
  dark?: boolean;
}

function langExtension(lang: string): Extension {
  switch (lang) {
    case 'cpp': case 'c': case 'cc': return cpp();
    case 'python': case 'py': return python();
    case 'java': return java();
    case 'go': return go();
    case 'rust': case 'rs': return rust();
    default: return [];
  }
}

/** Compute the live source = template with each region replaced by regionContents[id]. */
function buildLiveSource(
  templateSource: string,
  regions: RegionDef[],
  regionContents: Record<string, string>,
): { source: string; liveRanges: Array<{ from: number; to: number; id: string }> } {
  const lines = templateSource.split('\n');
  // Compute offset table: cumulative chars up to each line.
  const sortedRegions = [...regions].sort((a, b) => {
    if (a.start.line !== b.start.line) return b.start.line - a.start.line;
    return b.start.col - a.start.col;
  });
  for (const region of sortedRegions) {
    const { start, end } = region;
    if (start.line >= lines.length || end.line >= lines.length) continue;
    const before = lines[start.line].slice(0, start.col);
    const after = lines[end.line].slice(end.col);
    const content = regionContents[region.id] ?? '';
    const contentLines = content.split('\n');
    if (contentLines.length === 1) {
      lines.splice(start.line, end.line - start.line + 1, before + contentLines[0] + after);
    } else {
      const newLines = [
        before + contentLines[0],
        ...contentLines.slice(1, -1),
        contentLines[contentLines.length - 1] + after,
      ];
      lines.splice(start.line, end.line - start.line + 1, ...newLines);
    }
  }

  // Re-scan to compute current live ranges of each region in the resulting source.
  // We compute them by walking regions in original order, accumulating offsets.
  const source = lines.join('\n');
  // Recompute ranges in the *spliced* source.
  const liveRanges: Array<{ from: number; to: number; id: string }> = [];
  const liveLines = source.split('\n');
  // Build a per-line offset table.
  const lineOffsets: number[] = [0];
  for (let i = 0; i < liveLines.length; i++) {
    lineOffsets.push(lineOffsets[i] + liveLines[i].length + 1);
  }

  // For the live range computation we replay the splice tracking offsets.
  // Approach: walk regions in original order (top-to-bottom), maintain
  // `(lineDelta, currentLine)` and current spliced source line list.
  const sortedAsc = [...regions].sort((a, b) => {
    if (a.start.line !== b.start.line) return a.start.line - b.start.line;
    return a.start.col - b.start.col;
  });
  let lineDelta = 0;
  for (const region of sortedAsc) {
    const newStartLine = region.start.line + lineDelta;
    const content = regionContents[region.id] ?? '';
    const contentLines = content.split('\n');
    const endLineInLive = newStartLine + contentLines.length - 1;
    const endColInLive = contentLines.length === 1
      ? region.start.col + contentLines[0].length
      : contentLines[contentLines.length - 1].length;

    const from = lineOffsets[newStartLine] + region.start.col;
    const to = lineOffsets[endLineInLive] + endColInLive;
    liveRanges.push({ from, to, id: region.id });

    const oldLines = (region.end.line - region.start.line + 1);
    const newLines = contentLines.length;
    lineDelta += (newLines - oldLines);
  }
  return { source, liveRanges };
}

/** Decoration: dim non-editable regions. */
const readOnlyMark = Decoration.mark({ class: 'krypton-readonly-range' });

const setEditableRangesEffect = StateEffect.define<Array<{ from: number; to: number }>>();
const editableRangesField = StateField.define<Array<{ from: number; to: number }>>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setEditableRangesEffect)) return e.value;
    }
    return value;
  },
});

function buildReadOnlyDecorations(editableRanges: Array<{ from: number; to: number }>, docLength: number): DecorationSet {
  if (editableRanges.length === 0) {
    return Decoration.set([readOnlyMark.range(0, docLength)]);
  }
  const sorted = [...editableRanges].sort((a, b) => a.from - b.from);
  const out: any[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.from > cursor) out.push(readOnlyMark.range(cursor, r.from));
    cursor = Math.max(cursor, r.to);
  }
  if (cursor < docLength) out.push(readOnlyMark.range(cursor, docLength));
  return Decoration.set(out);
}

export function RegionEditor({
  lang, templateSource, regions, regionContents, onChange,
  readOnly = false, height = 480, dark = false,
}: RegionEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveRangesRef = useRef<Array<{ from: number; to: number; id: string }>>([]);
  const themeCompartment = useMemo(() => new Compartment(), []);

  // Build initial source on first mount only.
  const initial = useMemo(() => buildLiveSource(templateSource, regions, regionContents), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hostRef.current) return;
    liveRangesRef.current = initial.liveRanges;

    const decoCompartment = new Compartment();

    const state = EditorState.create({
      doc: initial.source,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langExtension(lang),
        editableRangesField,
        EditorView.editable.of(!readOnly),
        // Filter writes outside live ranges.
        EditorState.changeFilter.of((tr) => {
          if (readOnly) return false;
          if (!tr.docChanged) return true;
          let allowed = true;
          tr.changes.iterChangedRanges((fromA, toA) => {
            // fromA/toA refer to positions in the OLD doc before this transaction.
            const live = liveRangesRef.current;
            const inside = live.some((r) => fromA >= r.from && toA <= r.to);
            if (!inside) allowed = false;
          });
          return allowed;
        }),
        EditorView.updateListener.of((upd) => {
          if (!upd.docChanged) return;
          // Recompute live ranges by walking the document and re-extracting each region.
          const doc = upd.state.doc;
          const liveRanges: Array<{ from: number; to: number; id: string }> = [];
          let runningDelta = 0;
          const sortedAsc = [...regions].sort((a, b) => {
            if (a.start.line !== b.start.line) return a.start.line - b.start.line;
            return a.start.col - b.start.col;
          });
          // For each region we approximate via tracking original anchors; this is
          // sufficient because edits are constrained to inside ranges, so the
          // text outside doesn't shift unexpectedly.
          // We compute by replaying applied changes against the previous live ranges.
          const prev = liveRangesRef.current;
          let delta = 0;
          for (let i = 0; i < prev.length; i++) {
            const orig = prev[i];
            const region = sortedAsc.find((r) => r.id === orig.id)!;
            const adjustedFrom = orig.from + delta;
            // Recompute "to" by reading what's currently between (from, ?) up to the next
            // anchor — but simpler is to keep `orig.from` fixed and let `to` move via the
            // change ranges. Since edits stay inside the range, the delta is the doc
            // length change for transactions whose changes fall inside this region's old
            // (fromB..toB) we add to delta.
            // For simplicity here we infer by mapping the original `to` through `tr.changes`.
            const mappedTo = upd.changes.mapPos(orig.to, 1);
            liveRanges.push({ from: adjustedFrom, to: mappedTo, id: orig.id });
            // Compute new delta accumulator for next region: the size change inside this
            // region affects all subsequent ones.
            delta += (mappedTo - adjustedFrom) - (orig.to - orig.from);
            // Notify parent of this region's new content.
            const newContent = doc.sliceString(adjustedFrom, mappedTo);
            if (newContent !== (regionContents[orig.id] ?? '')) {
              onChange(orig.id, newContent);
            }
          }
          liveRangesRef.current = liveRanges;
          // Refresh decorations.
          upd.view.dispatch({
            effects: setEditableRangesEffect.of(liveRanges.map(({ from, to }) => ({ from, to }))),
          });
        }),
        decoCompartment.of(
          EditorView.decorations.compute(['doc'], (s) =>
            buildReadOnlyDecorations(liveRangesRef.current.map(({ from, to }) => ({ from, to })), s.doc.length)
          ),
        ),
        themeCompartment.of(dark ? oneDark : []),
        EditorView.theme({
          '.krypton-readonly-range': {
            backgroundColor: 'rgba(120, 120, 120, 0.08)',
            opacity: '0.85',
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;
    // Initialize editable range decorations.
    view.dispatch({
      effects: setEditableRangesEffect.of(liveRangesRef.current.map(({ from, to }) => ({ from, to }))),
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // We only re-init on lang/template/region shape changes — content changes flow through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, templateSource, JSON.stringify(regions)]);

  // React to dark mode toggle without recreating editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : []) });
  }, [dark, themeCompartment]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-md border bg-card text-card-foreground"
      style={{ minHeight: height, maxHeight: typeof height === 'number' ? height + 200 : undefined }}
    />
  );
}
