import type { ChangeDesc, Text } from '@codemirror/state';

export interface StructuredLineRange {
  key: string;
  startLine: number;
  endLine: number;
  state: 'public' | 'answer';
  invalid?: boolean;
}

function lineBoundary(doc: Text, line: number): number | null {
  if (line < 0 || line > doc.lines) return null;
  return line === doc.lines ? doc.length : doc.line(line + 1).from;
}

/** Map whole-line ranges through one exact CodeMirror change set. */
export function mapStructuredLineRanges<T extends StructuredLineRange>(startDoc: Text, nextDoc: Text, changes: ChangeDesc, ranges: T[]): T[] {
  return ranges.map((range) => {
    if (range.invalid) return range;
    const oldStart = lineBoundary(startDoc, range.startLine);
    const oldEnd = lineBoundary(startDoc, range.endLine);
    if (oldStart === null || oldEnd === null || oldEnd <= oldStart) return { ...range, invalid: true };
    const mappedStart = changes.mapPos(oldStart, -1);
    // At a boundary before another line, newly inserted lines belong to the
    // default-private side. At the physical end of the document, edits extend
    // the final marked range because there is no following private line.
    const mappedEnd = changes.mapPos(oldEnd, range.endLine === startDoc.lines ? 1 : -1);
    if (mappedEnd <= mappedStart) return { ...range, invalid: true };
    const startLine = nextDoc.lineAt(mappedStart);
    if (startLine.from !== mappedStart) return { ...range, invalid: true };
    let endLine: number;
    if (mappedEnd === nextDoc.length) endLine = nextDoc.lines;
    else {
      const endBoundary = nextDoc.lineAt(mappedEnd);
      if (endBoundary.from !== mappedEnd) return { ...range, invalid: true };
      endLine = endBoundary.number - 1;
    }
    if (endLine <= startLine.number - 1) return { ...range, invalid: true };
    return { ...range, startLine: startLine.number - 1, endLine };
  });
}
