// Small markdown splitter for paper export. Not a full CommonMark parser:
// ATX headings 1–3, blank-line paragraphs, `-` / `*` / `1.` lists, fenced code,
// `$$` math kept as source, standalone images, and `**` / `*` / `` ` `` marks.
// Anything else stays as text. Inline `$...$` and `$$...$$` stay literal so
// marks inside math are not eaten. `$` / `$$` and backtick closers stay on
// the same line; an unmatched run is ordinary text.

export interface MdInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: MdInline[] }
  | { kind: 'paragraph'; inlines: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'math'; text: string }
  | { kind: 'image'; url: string; alt: string };

function withMark(inline: MdInline, mark: 'bold' | 'italic'): MdInline {
  const next: MdInline = { text: inline.text };
  if (inline.bold === true || mark === 'bold') next.bold = true;
  if (inline.italic === true || mark === 'italic') next.italic = true;
  if (inline.code === true) next.code = true;
  return next;
}

function lineLimit(source: string, index: number): number {
  const lineBreak = source.indexOf('\n', index);
  return lineBreak < 0 ? source.length : lineBreak;
}

function readLiteralMath(source: string, index: number): { text: string; next: number } | null {
  if (source[index] !== '$') return null;
  const markerLength = source[index + 1] === '$' ? 2 : 1;
  const marker = markerLength === 2 ? '$$' : '$';
  const end = source.indexOf(marker, index + markerLength);
  if (end < 0 || end + markerLength > lineLimit(source, index)) return null;
  return { text: source.slice(index, end + markerLength), next: end + markerLength };
}

function backtickRun(source: string, index: number): number {
  let length = 0;
  while (source[index + length] === '`') length += 1;
  return length;
}

function closingBackticks(source: string, from: number, length: number, limit: number): number {
  let cursor = from;
  while (cursor < limit) {
    if (source[cursor] !== '`') {
      cursor += 1;
      continue;
    }
    const run = backtickRun(source, cursor);
    if (run === length) return cursor;
    cursor += run;
  }
  return -1;
}

function parseInlines(source: string): MdInline[] {
  const inlines: MdInline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer.length === 0) return;
    inlines.push({ text: buffer });
    buffer = '';
  };
  let index = 0;
  while (index < source.length) {
    if (source[index] === '`') {
      const length = backtickRun(source, index);
      const end = closingBackticks(source, index + length, length, lineLimit(source, index));
      if (end < 0) {
        buffer += '`'.repeat(length);
        index += length;
        continue;
      }
      const text = source.slice(index + length, end);
      if (text.length === 0) {
        buffer += source.slice(index, end + length);
        index = end + length;
        continue;
      }
      flush();
      inlines.push({ text, code: true });
      index = end + length;
      continue;
    }
    if (source.startsWith('$', index)) {
      const literal = readLiteralMath(source, index);
      if (!literal) {
        buffer += '$';
        index += 1;
        continue;
      }
      buffer += literal.text;
      index = literal.next;
      continue;
    }
    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2);
      if (end < 0) {
        buffer += '**';
        index += 2;
        continue;
      }
      flush();
      for (const part of parseInlines(source.slice(index + 2, end))) inlines.push(withMark(part, 'bold'));
      index = end + 2;
      continue;
    }
    if (source.startsWith('*', index)) {
      const end = source.indexOf('*', index + 1);
      if (end < 0) {
        buffer += '*';
        index += 1;
        continue;
      }
      flush();
      for (const part of parseInlines(source.slice(index + 1, end))) inlines.push(withMark(part, 'italic'));
      index = end + 1;
      continue;
    }
    buffer += source[index] ?? '';
    index += 1;
  }
  flush();
  return inlines;
}

function isOpeningFence(line: string): boolean {
  return /^[ \t]*```/.test(line);
}

function isClosingFence(line: string): boolean {
  return /^[ \t]*`{3,}[ \t]*$/.test(line);
}

function isMathFence(line: string): boolean {
  return line.trim() === '$$';
}

function oneLineMath(line: string): string | null {
  const match = /^\$\$(.*)\$\$$/.exec(line.trim());
  if (!match) return null;
  return match[1] ?? '';
}

function closingDestination(line: string, open: number): number {
  let depth = 0;
  for (let index = open; index < line.length; index += 1) {
    const char = line[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isDestinationTitle(rest: string): boolean {
  if (rest.length < 2) return false;
  const open = rest[0];
  let close = '';
  if (open === '"' || open === "'") close = open;
  else if (open === '(') close = ')';
  return close !== '' && rest.endsWith(close);
}

function destinationUrl(inside: string): string | null {
  const body = inside.trim();
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) return null;
      depth -= 1;
    } else if (depth === 0 && (char === ' ' || char === '\t')) {
      const rest = body.slice(index).trim();
      if (isDestinationTitle(rest)) return body.slice(0, index).trim();
    }
  }
  if (depth !== 0) return null;
  return body;
}

function imageAt(source: string, index: number): { url: string; alt: string; next: number } | null {
  if (!source.startsWith('![', index)) return null;
  const altEnd = source.indexOf(']', index + 2);
  if (altEnd < 0 || source[altEnd + 1] !== '(') return null;
  const close = closingDestination(source, altEnd + 1);
  if (close < 0) return null;
  const url = destinationUrl(source.slice(altEnd + 2, close));
  if (url === null) return null;
  return { alt: source.slice(index + 2, altEnd), url, next: close + 1 };
}

function imageOf(line: string): { url: string; alt: string } | null {
  const trimmed = line.trim();
  const leading = line.indexOf(trimmed);
  const image = imageAt(line, leading < 0 ? 0 : leading);
  if (!image || image.next !== leading + trimmed.length) return null;
  return { alt: image.alt, url: image.url };
}

type MarkdownPiece = { kind: 'text'; text: string } | { kind: 'image'; url: string; alt: string };

/** Split images out of ordinary text. Fenced code is handled earlier; inline code and math stay literal. */
function splitImages(source: string): MarkdownPiece[] {
  const pieces: MarkdownPiece[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer.length === 0) return;
    pieces.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  let index = 0;
  while (index < source.length) {
    if (source[index] === '`') {
      const length = backtickRun(source, index);
      const end = closingBackticks(source, index + length, length, lineLimit(source, index));
      const stop = end < 0 ? index + length : end + length;
      buffer += source.slice(index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('$', index)) {
      const literal = readLiteralMath(source, index);
      if (literal) {
        buffer += literal.text;
        index = literal.next;
        continue;
      }
    }
    const image = imageAt(source, index);
    if (image) {
      flush();
      pieces.push({ kind: 'image', url: image.url, alt: image.alt });
      index = image.next;
      continue;
    }
    buffer += source[index] ?? '';
    index += 1;
  }
  flush();
  return pieces;
}

function pushTextBlock(blocks: MdBlock[], text: string, heading: { level: 1 | 2 | 3 } | null): void {
  if (text.length === 0) return;
  if (heading) blocks.push({ kind: 'heading', level: heading.level, inlines: parseInlines(text) });
  else blocks.push({ kind: 'paragraph', inlines: parseInlines(text) });
}

function pushPieces(blocks: MdBlock[], pieces: readonly MarkdownPiece[], heading: { level: 1 | 2 | 3 } | null): void {
  let headingLeft = heading;
  for (const piece of pieces) {
    if (piece.kind === 'image') {
      blocks.push({ kind: 'image', url: piece.url, alt: piece.alt });
      headingLeft = null;
      continue;
    }
    pushTextBlock(blocks, piece.text, headingLeft);
    headingLeft = null;
  }
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

function headingOf(line: string): { level: 1 | 2 | 3; content: string } | null {
  let level = 0;
  while (level < 3 && line[level] === '#') level += 1;
  if (level === 0 || line[level] === '#') return null;
  if (!isSpace(line[level])) return null;
  let cursor = level;
  while (isSpace(line[cursor])) cursor += 1;
  const content = line.slice(cursor);
  if (level === 1) return { level: 1, content };
  if (level === 2) return { level: 2, content };
  return { level: 3, content };
}

function listItemOf(line: string): { ordered: boolean; content: string } | null {
  let cursor = 0;
  while (isSpace(line[cursor])) cursor += 1;
  if (line[cursor] === '-' || line[cursor] === '*') {
    cursor += 1;
    if (!isSpace(line[cursor])) return null;
    while (isSpace(line[cursor])) cursor += 1;
    return { ordered: false, content: line.slice(cursor) };
  }
  if (line[cursor] !== undefined && line[cursor] >= '0' && line[cursor] <= '9') {
    while (line[cursor] !== undefined && line[cursor] >= '0' && line[cursor] <= '9') cursor += 1;
    if (line[cursor] !== '.') return null;
    cursor += 1;
    if (!isSpace(line[cursor])) return null;
    while (isSpace(line[cursor])) cursor += 1;
    return { ordered: true, content: line.slice(cursor) };
  }
  return null;
}

function isBlockBoundary(line: string): boolean {
  return line.trim() === ''
    || isOpeningFence(line)
    || isMathFence(line)
    || oneLineMath(line) !== null
    || imageOf(line) !== null
    || headingOf(line) !== null
    || listItemOf(line) !== null;
}

function pushCode(lines: readonly string[], start: number, blocks: MdBlock[]): number {
  const collected: string[] = [];
  let index = start + 1;
  while (index < lines.length && !isClosingFence(lines[index] ?? '')) {
    collected.push(lines[index] ?? '');
    index += 1;
  }
  if (index < lines.length) index += 1;
  blocks.push({ kind: 'code', text: collected.join('\n') });
  return index;
}

function pushMath(lines: readonly string[], start: number, blocks: MdBlock[]): number {
  const collected: string[] = [];
  let index = start + 1;
  while (index < lines.length && !isMathFence(lines[index] ?? '')) {
    collected.push(lines[index] ?? '');
    index += 1;
  }
  if (index < lines.length) index += 1;
  blocks.push({ kind: 'math', text: collected.join('\n') });
  return index;
}

function pushList(lines: readonly string[], start: number, blocks: MdBlock[]): number {
  const first = listItemOf(lines[start] ?? '');
  if (!first) throw new Error('markdown list started on a line that is not a list item');
  let items: MdInline[][] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push({ kind: 'list', ordered: first.ordered, items });
    items = [];
  };
  let index = start;
  while (index < lines.length) {
    const item = listItemOf(lines[index] ?? '');
    if (!item || item.ordered !== first.ordered) break;
    const pieces = splitImages(item.content);
    if (pieces.some((piece) => piece.kind === 'image')) {
      flush();
      pushPieces(blocks, pieces, null);
    } else {
      items.push(parseInlines(item.content));
    }
    index += 1;
  }
  flush();
  return index;
}

function pushParagraph(lines: readonly string[], start: number, blocks: MdBlock[]): number {
  const collected: string[] = [];
  let index = start;
  while (index < lines.length && !isBlockBoundary(lines[index] ?? '')) {
    collected.push(lines[index] ?? '');
    index += 1;
  }
  if (collected.length === 0) throw new Error('markdown paragraph started on a block boundary');
  pushPieces(blocks, splitImages(collected.join('\n')), null);
  return index;
}

function consume(lines: readonly string[], index: number, blocks: MdBlock[]): number {
  const line = lines[index] ?? '';
  if (line.trim() === '') return index + 1;
  if (isOpeningFence(line)) return pushCode(lines, index, blocks);
  if (isMathFence(line)) return pushMath(lines, index, blocks);
  const math = oneLineMath(line);
  if (math !== null) {
    blocks.push({ kind: 'math', text: math });
    return index + 1;
  }
  const image = imageOf(line);
  if (image) {
    blocks.push({ kind: 'image', url: image.url, alt: image.alt });
    return index + 1;
  }
  const heading = headingOf(line);
  if (heading) {
    pushPieces(blocks, splitImages(heading.content), { level: heading.level });
    return index + 1;
  }
  if (listItemOf(line)) return pushList(lines, index, blocks);
  return pushParagraph(lines, index, blocks);
}

export function markdownBlocks(source: string): MdBlock[] {
  if (typeof source !== 'string') throw new Error('markdown source must be a string');
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const blocks: MdBlock[] = [];
  let index = 0;
  while (index < lines.length) index = consume(lines, index, blocks);
  return blocks;
}
