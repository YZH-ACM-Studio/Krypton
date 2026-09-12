import type { ChangeDesc, Text } from '@codemirror/state';

export interface StructuredLineSpan {
  startLine: number;
  endLine: number;
}

export interface StructuredLineRange extends StructuredLineSpan {
  key: string;
  state: 'public' | 'answer';
  invalid?: boolean;
}

export function overlaps(left: StructuredLineSpan, right: StructuredLineSpan) {
  return left.startLine < right.endLine && right.startLine < left.endLine;
}

export function subtractPublicRanges<T extends StructuredLineSpan & { key: string }>(ranges: T[], removal: StructuredLineSpan): T[] {
  return ranges.flatMap((range) => {
    if (!overlaps(range, removal)) return [range];
    const next: T[] = [];
    if (range.startLine < removal.startLine) next.push({ ...range, endLine: removal.startLine });
    if (removal.endLine < range.endLine) {
      next.push({
        ...range,
        key: next.length ? `${range.key}:right:${removal.startLine}:${removal.endLine}` : range.key,
        startLine: removal.endLine,
      });
    }
    return next;
  });
}

export function mergePublicRanges<T extends StructuredLineSpan & { invalid?: boolean }>(ranges: T[]): T[] {
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const result: T[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && !previous.invalid && !range.invalid && range.startLine <= previous.endLine) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
    } else result.push({ ...range });
  }
  return result;
}

/** Mark every range whose key overlaps any pair in overlapSource, keeping prior invalid flags. */
export function markOverlappingStructuredLineRangesInvalid<T extends StructuredLineSpan & { key: string; invalid?: boolean }>(
  ranges: T[],
  overlapSource: Array<StructuredLineSpan & { key: string }> = ranges,
): Array<T & { invalid: boolean }> {
  const conflicted = new Set<string>();
  for (let left = 0; left < overlapSource.length; left++) {
    for (let right = left + 1; right < overlapSource.length; right++) {
      if (overlaps(overlapSource[left], overlapSource[right])) {
        conflicted.add(overlapSource[left].key);
        conflicted.add(overlapSource[right].key);
      }
    }
  }
  return ranges.map((range) => ({ ...range, invalid: !!range.invalid || conflicted.has(range.key) }));
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
