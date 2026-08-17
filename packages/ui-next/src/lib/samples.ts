/**
 * Extract sample input/output pairs from markdown content.
 *
 * Detects fenced code blocks with language tags like:
 *   ```input1    ```output1
 *   ```input2    ```output2
 *
 * This is the same convention used by Hydro OJ problem templates.
 */

export interface SampleCase {
  id: number;
  input: string;
  output: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Coerce a `pdoc.content` value (which may be a plain markdown string,
 * a JSON-encoded multilingual blob like `'{"zh":"…","en":"…"}'`, or an
 * already-parsed `Record<string, string>`) into a flat language map.
 *
 * Always returns an object so callers can iterate values; never returns
 * `null`/`undefined`.
 */
function normalizeContent(content: string | Record<string, string> | null | undefined): Record<string, string> {
  if (!content) return {};
  if (typeof content === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(content)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') out[k] = v;
        }
        if (Object.keys(out).length > 0) return out;
      }
    } catch {
      /* fall through and treat as raw markdown */
    }
  }
  return { default: trimmed };
}

/**
 * Match input/output fenced code blocks.
 *
 * Recognizes:
 *   - ```input1    ```output1            (numbered, primary convention)
 *   - ```input     ```output             (bare, treated as id=1)
 *
 * The opening fence may use 3+ backticks and have trailing whitespace
 * before the newline. The closing fence must match the opening length.
 */
function decodeBasicEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function* iterateSampleBlocks(md: string): Generator<{ kind: 'input' | 'output'; id: number; body: string }> {
  // Use a tolerant pattern that accepts any 3+ backticks, optional indent, and optional id.
  const re = /(?:^|\n)[ \t]{0,3}(`{3,})(input|output)(\d*)[^\S\n]*\n([\s\S]*?)\n[ \t]{0,3}\1(?=\s|$)/gi;
  for (let m = re.exec(md); m !== null; m = re.exec(md)) {
    const kind = m[2].toLowerCase() as 'input' | 'output';
    const id = m[3] ? Number.parseInt(m[3], 10) : 1;
    const body = m[4].replace(/\s+$/u, '');
    yield { kind, id, body };
  }
}

function* iterateHydroHtmlSampleBlocks(html: string): Generator<{ kind: 'input' | 'output'; id: number; body: string }> {
  const re = /<(?:code|pre)[^>]*class="[^"]*language-(input|output)(\d*)[^"]*"[^>]*>([\s\S]*?)<\/(?:code|pre)>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const kind = m[1].toLowerCase() as 'input' | 'output';
    const id = m[2] ? Number.parseInt(m[2], 10) : 1;
    const body = decodeBasicEntities(m[3].replace(/<[^>]+>/g, '')).replace(/\s+$/u, '');
    yield { kind, id, body };
  }
}

function headingKind(label: string): 'input' | 'output' | null {
  const normalized = label.replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^(输入样例|样例输入|sample input)$/.test(normalized)) return 'input';
  if (/^(输出样例|样例输出|sample output)$/.test(normalized)) return 'output';
  return null;
}

function* iterateHeadingSampleBlocks(md: string): Generator<{ kind: 'input' | 'output'; id: number; body: string }> {
  const re =
    /(?:^|\n)(?:#{1,6}\s*|\*{0,2})(输入样例|样例输入|输出样例|样例输出|Sample\s+Input|Sample\s+Output)\s*(\d*)(?:\*{0,2})[^\n]*\n+```[^\n]*\n([\s\S]*?)\n```/gi;
  for (let m = re.exec(md); m !== null; m = re.exec(md)) {
    const kind = headingKind(m[1]);
    if (!kind) continue;
    const id = m[2] ? Number.parseInt(m[2], 10) : 1;
    yield { kind, id, body: m[3].replace(/\s+$/u, '') };
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse markdown source to find `\`\`\`inputN` / `\`\`\`outputN` pairs.
 *
 * Accepts any shape `pdoc.content` can take:
 *   - plain markdown string
 *   - JSON-encoded multilingual string (`'{"zh":"…"}'`)
 *   - already-parsed `Record<string, string>`
 *
 * When multiple languages are present, the first language that yields
 * any sample is used (zh-preferred order).
 */
export function extractSamples(content: string | Record<string, string> | null | undefined): SampleCase[] {
  const langs = normalizeContent(content);
  const keys = Object.keys(langs);
  if (keys.length === 0) return [];

  // Prefer zh-family then en, then declaration order — same as MarkdownView.
  const ordered = [...keys.filter((k) => /^zh/i.test(k)), ...keys.filter((k) => /^en/i.test(k)), ...keys.filter((k) => !/^zh|^en/i.test(k))];

  for (const k of ordered) {
    const samples = extractFromMarkdown(langs[k]);
    if (samples.length > 0) return samples;
  }
  return [];
}

function pairSampleBlocks(blocks: Iterable<{ kind: 'input' | 'output'; id: number; body: string }>): SampleCase[] {
  const inputs = new Map<number, string>();
  const outputs = new Map<number, string>();
  for (const blk of blocks) {
    (blk.kind === 'input' ? inputs : outputs).set(blk.id, blk.body);
  }
  const ids = [...new Set([...inputs.keys(), ...outputs.keys()])].sort((a, b) => a - b);
  return ids.map((id) => ({
    id,
    input: inputs.get(id) ?? '',
    output: outputs.get(id) ?? '',
  }));
}

/** Pull paired sample cases from a single markdown or legacy Hydro HTML string. */
function extractFromMarkdown(md: string): SampleCase[] {
  const fromFences = pairSampleBlocks(iterateSampleBlocks(md));
  if (fromFences.length) return fromFences;
  const fromHtml = pairSampleBlocks(iterateHydroHtmlSampleBlocks(md));
  if (fromHtml.length) return fromHtml;
  return pairSampleBlocks(iterateHeadingSampleBlocks(md));
}

/** Parse content from JSON format (same as markdown-renderer.tsx) */
export function resolveContentString(content: string | Record<string, string>): string {
  const langs = normalizeContent(content);
  const keys = Object.keys(langs);
  if (keys.length === 0) return '';
  const preferred = keys.find((k) => /^zh/i.test(k)) || keys.find((k) => /^en/i.test(k)) || keys[0];
  return langs[preferred];
}

/**
 * Split markdown into chunks: prose segments interleaved with sample groups,
 * preserving the **original position** of each sample.
 *
 * Use this instead of `extractSamples` + `stripSampleBlocks` when you want
 * the sample cards to render *where the author put them* rather than all
 * pushed to the bottom of the page.
 *
 * Consecutive sample fences with only whitespace between them are merged
 * into one chunk (so one group of `\`\`\`input1` + `\`\`\`output1` + `\`\`\`input2`
 * + `\`\`\`output2` becomes a single chunk with 2 cases).
 */
export interface MarkdownChunk {
  kind: 'md' | 'sample';
  md?: string;
  samples?: SampleCase[];
}

export interface PositionedSampleCase extends SampleCase {
  inputSourceStart?: number;
  inputSourceEnd?: number;
  outputSourceStart?: number;
  outputSourceEnd?: number;
}

export interface PositionedMarkdownChunk {
  kind: 'md' | 'sample';
  md?: string;
  samples?: PositionedSampleCase[];
  sourceStart: number;
  sourceEnd: number;
}

export function splitMarkdownBySamplesPositioned(md: string): PositionedMarkdownChunk[] {
  if (!md) return [];

  interface Blk {
    start: number;
    end: number;
    kind: 'input' | 'output';
    id: number;
    body: string;
    bodyStart: number;
    bodyEnd: number;
  }
  const blocks: Blk[] = [];
  // Same regex as `iterateSampleBlocks` but with positions.
  const re = /(^|\n)(`{3,})(input|output)(\d*)[^\S\n]*\n([\s\S]*?)\n\2(?=\s|$)/gi;
  for (let m = re.exec(md); m !== null; m = re.exec(md)) {
    const leadingNl = m[1] ? 1 : 0;
    const body = m[5].replace(/\s+$/u, '');
    const openingEnd = m[0].indexOf('\n', leadingNl) + 1;
    const bodyStart = m.index + openingEnd;
    blocks.push({
      start: m.index + leadingNl,
      end: m.index + m[0].length,
      kind: m[3].toLowerCase() as 'input' | 'output',
      id: m[4] ? Number.parseInt(m[4], 10) : 1,
      body,
      bodyStart,
      bodyEnd: bodyStart + body.length,
    });
  }

  if (blocks.length === 0) {
    return [{ kind: 'md', md, sourceStart: 0, sourceEnd: md.length }];
  }

  // Group consecutive blocks separated only by whitespace.
  const groups: { start: number; end: number; samples: PositionedSampleCase[] }[] = [];
  let cur: Blk[] = [blocks[0]];
  const flushGroup = (blks: Blk[]) => {
    const inputs = new Map<number, Blk>();
    const outputs = new Map<number, Blk>();
    for (const b of blks) (b.kind === 'input' ? inputs : outputs).set(b.id, b);
    const ids = [...new Set([...inputs.keys(), ...outputs.keys()])].sort((a, b) => a - b);
    groups.push({
      start: blks[0].start,
      end: blks[blks.length - 1].end,
      samples: ids.map((id) => ({
        id,
        input: inputs.get(id)?.body ?? '',
        output: outputs.get(id)?.body ?? '',
        ...(inputs.has(id) ? { inputSourceStart: inputs.get(id)!.bodyStart, inputSourceEnd: inputs.get(id)!.bodyEnd } : {}),
        ...(outputs.has(id) ? { outputSourceStart: outputs.get(id)!.bodyStart, outputSourceEnd: outputs.get(id)!.bodyEnd } : {}),
      })),
    });
  };
  for (let i = 1; i < blocks.length; i++) {
    const between = md.slice(cur[cur.length - 1].end, blocks[i].start);
    if (/^\s*$/.test(between)) {
      cur.push(blocks[i]);
    } else {
      flushGroup(cur);
      cur = [blocks[i]];
    }
  }
  flushGroup(cur);

  const chunks: PositionedMarkdownChunk[] = [];
  let cursor = 0;
  for (const g of groups) {
    if (g.start > cursor) {
      const text = md.slice(cursor, g.start).replace(/\n+$/, '');
      if (text.trim()) chunks.push({ kind: 'md', md: text, sourceStart: cursor, sourceEnd: cursor + text.length });
    }
    chunks.push({ kind: 'sample', samples: g.samples, sourceStart: g.start, sourceEnd: g.end });
    cursor = g.end;
  }
  if (cursor < md.length) {
    const raw = md.slice(cursor);
    const text = raw.replace(/^\n+/, '');
    if (text.trim()) chunks.push({ kind: 'md', md: text, sourceStart: cursor + raw.length - text.length, sourceEnd: md.length });
  }
  return chunks;
}

export function splitMarkdownBySamples(md: string): MarkdownChunk[] {
  return splitMarkdownBySamplesPositioned(md).map((chunk) => ({
    kind: chunk.kind,
    ...(chunk.md !== undefined ? { md: chunk.md } : {}),
    ...(chunk.samples
      ? {
          samples: chunk.samples.map(({ id, input, output }) => ({ id, input, output })),
        }
      : {}),
  }));
}

/**
 * Strip sample fenced code blocks (```inputN / ```outputN) from markdown source
 * so they are not rendered as normal code blocks by MarkdownView.
 *
 * Handles bare `input`/`output` (no number) as well as numbered variants,
 * and accepts 3+ backticks in the opening fence.
 *
 * @deprecated Prefer `splitMarkdownBySamples` so samples render in place.
 * Kept for callers that need a strip-only behavior (e.g. plaintext export).
 */
export function stripSampleBlocks(md: string): string {
  if (!md) return md;
  return md
    .replace(/(^|\n)(`{3,})(?:input|output)\d*[^\S\n]*\n[\s\S]*?\n\2(?=\s|$)/gi, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
