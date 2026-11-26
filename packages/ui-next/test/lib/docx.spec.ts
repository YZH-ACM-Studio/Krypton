// @vitest-environment node
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildDocx, type DocxBlock } from '../../src/lib/docx';
import { markdownBlocks, type MdBlock, type MdInline } from '../../src/lib/markdown-blocks';

const decoder = new TextDecoder();

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
] as const;

// 1px at 96 DPI is 914400/96 EMU. Pictures wider than 15cm scale down to that width.
const EMU_PER_PX = 914400 / 96;
const MAX_WIDTH_EMU = 15 * 360000;
const MONOSPACE = /mono|courier|consolas|menlo|monaco|inconsolata|cascadia|lucida console|source code|fixedsys|fira code|iosevka|anonymous pro/i;

type Toggle = 'on' | 'off' | 'absent';

interface StyleFacts {
  bold: Toggle;
  italic: Toggle;
  align: 'center' | 'other' | 'absent';
  size: number | null;
  fonts: string[];
  basedOn: string;
}

interface RunFacts {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number | null;
  fonts: string[];
}

function findEocd(bytes: Uint8Array, view: DataView) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIG) return offset;
  }
  throw new Error('zip end of central directory not found');
}

function inflate(method: number, data: Uint8Array) {
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip method ${method}`);
}

function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocd(bytes, view);
  const totalEntryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map<string, Uint8Array>();
  let pos = centralOffset;
  for (let index = 0; index < totalEntryCount; index += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CENTRAL_SIG) {
      throw new Error('zip central directory is truncated');
    }
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== LOCAL_SIG) {
      throw new Error(`zip local header missing for ${name}`);
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, inflate(method, data));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function localXml(xml: string) {
  return xml
    .replace(/<(\/?)[\w.-]+:/g, '<$1')
    .replace(/(\s)[\w.-]+:([A-Za-z_][\w.-]*)=/g, '$1$2=');
}

function elementParents(xml: string, tag: string): { parent: string | null; ancestors: string[] }[] {
  const ancestors: string[] = [];
  const found: { parent: string | null; ancestors: string[] }[] = [];
  for (const match of localXml(xml).matchAll(/<\/?([A-Za-z_][\w.-]*)\b[^>]*>/g)) {
    const whole = match[0];
    const name = match[1] ?? '';
    if (whole.startsWith('</')) {
      const opened = ancestors.pop();
      if (opened !== name) throw new Error(`docx xml closes ${name} before ${opened ?? 'the root'}`);
      continue;
    }
    if (name === tag) {
      found.push({
        parent: ancestors.length === 0 ? null : ancestors[ancestors.length - 1],
        ancestors: [...ancestors],
      });
    }
    if (!/\/\s*>$/.test(whole)) ancestors.push(name);
  }
  return found;
}

function xmlBlocks(xml: string, tag: string) {
  const source = localXml(xml);
  return source.match(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')) ?? [];
}

function first(xml: string, tag: string) {
  return xmlBlocks(xml, tag)[0] ?? '';
}

function unescapeXml(text: string) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(xml: string, name: string) {
  const match = localXml(xml).match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? unescapeXml(match[1]) : '';
}

function textNodes(xml: string) {
  return [...localXml(xml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => unescapeXml(match[1] ?? ''));
}

function rawTextNodes(xml: string) {
  return [...localXml(xml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1] ?? '');
}

function paragraphText(paragraph: string) {
  return textNodes(paragraph).join('');
}

function bodyParagraphs(documentXml: string) {
  const body = localXml(documentXml).match(/<body\b[^>]*>([\s\S]*)<\/body>/);
  return xmlBlocks(body?.[1] ?? '', 'p');
}

function visibleText(documentXml: string) {
  return bodyParagraphs(documentXml).map((paragraph) => {
    const parts = localXml(paragraph).split(/<br\b[^>]*>/);
    return parts.map((part) => textNodes(part).join('')).join('\n');
  }).join('\n');
}

function partText(entries: Map<string, Uint8Array>, name: string) {
  const bytes = entries.get(name);
  expect(bytes).to.be.instanceOf(Uint8Array);
  return decoder.decode(bytes ?? new Uint8Array());
}

function expectBytes(entries: Map<string, Uint8Array>, name: string, expected: Uint8Array) {
  const actual = entries.get(name);
  expect(actual).to.be.instanceOf(Uint8Array);
  expect(Array.from(actual ?? [])).to.deep.equal(Array.from(expected));
}

function targetPath(target: string) {
  let path = target.replaceAll('\\', '/');
  if (path.startsWith('./')) path = path.slice(2);
  if (path.startsWith('/')) path = path.slice(1);
  if (path.startsWith('word/')) path = path.slice('word/'.length);
  return path;
}

function relationships(xml: string) {
  return xmlBlocks(xml, 'Relationship').map((node) => ({
    id: attr(node, 'Id'),
    type: attr(node, 'Type'),
    target: targetPath(attr(node, 'Target')),
  }));
}

function toggle(xml: string, tag: string): Toggle {
  const match = localXml(xml).match(new RegExp(`<${tag}\\b([^>]*)>`));
  if (!match) return 'absent';
  if (/\bval="(?:0|false|off)"/.test(match[1] ?? '')) return 'off';
  return 'on';
}

function mergedToggle(xml: string, tags: readonly string[]): Toggle {
  const states = tags.map((tag) => toggle(xml, tag));
  if (states.includes('on')) return 'on';
  if (states.includes('off')) return 'off';
  return 'absent';
}

function readSize(xml: string) {
  const source = localXml(xml);
  const size = source.match(/<sz\b[^>]*\sval="(\d+(?:\.\d+)?)"/);
  if (size) return Number(size[1]);
  const complex = source.match(/<szCs\b[^>]*\sval="(\d+(?:\.\d+)?)"/);
  return complex ? Number(complex[1]) : null;
}

function readFonts(xml: string) {
  const fonts: string[] = [];
  const source = localXml(xml);
  for (const tag of source.matchAll(/<rFonts\b([^>]*)>/g)) {
    const body = tag[1] ?? '';
    for (const name of body.matchAll(/\b(?:ascii|hAnsi|cs|eastAsia)="([^"]*)"/g)) {
      fonts.push(unescapeXml(name[1] ?? ''));
    }
  }
  return fonts;
}

function alignment(xml: string): StyleFacts['align'] {
  const match = localXml(xml).match(/<jc\b[^>]*\sval="([^"]*)"/);
  if (!match) return 'absent';
  return match[1] === 'center' ? 'center' : 'other';
}

function parseStyles(xml: string) {
  const styles = new Map<string, StyleFacts>();
  for (const style of xmlBlocks(xml, 'style')) {
    const id = attr(style, 'styleId');
    if (!id) continue;
    const props = xmlBlocks(style, 'rPr').join('');
    styles.set(id, {
      bold: mergedToggle(props, ['b', 'bCs']),
      italic: mergedToggle(props, ['i', 'iCs']),
      align: alignment(style),
      size: readSize(props),
      fonts: readFonts(props),
      basedOn: attr(first(style, 'basedOn'), 'val'),
    });
  }
  return styles;
}

function styleChain(styleId: string, styles: Map<string, StyleFacts>) {
  const chain: StyleFacts[] = [];
  const seen = new Set<string>();
  let current = styleId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const style = styles.get(current);
    if (!style) break;
    chain.push(style);
    current = style.basedOn;
  }
  return chain;
}

function chainToggle(chain: readonly StyleFacts[], key: 'bold' | 'italic'): Toggle {
  for (const style of chain) {
    if (style[key] !== 'absent') return style[key];
  }
  return 'absent';
}

function nearestToggle(states: readonly Toggle[]) {
  for (const state of states) {
    if (state === 'on') return true;
    if (state === 'off') return false;
  }
  return false;
}

function nearestSize(sizes: readonly (number | null)[]) {
  for (const size of sizes) {
    if (size !== null) return size;
  }
  return null;
}

function paragraphCentered(paragraph: string, styles: Map<string, StyleFacts>) {
  const pPr = first(paragraph, 'pPr');
  const own = alignment(pPr);
  if (own === 'center') return true;
  if (own === 'other') return false;
  const chain = styleChain(attr(first(pPr, 'pStyle'), 'val'), styles);
  for (const style of chain) {
    if (style.align === 'center') return true;
    if (style.align === 'other') return false;
  }
  return false;
}

function runsOf(paragraph: string, styles: Map<string, StyleFacts>): RunFacts[] {
  const pPr = first(paragraph, 'pPr');
  const paragraphChain = styleChain(attr(first(pPr, 'pStyle'), 'val'), styles);
  const mark = xmlBlocks(pPr, 'rPr').join('');
  return xmlBlocks(paragraph, 'r').map((run) => {
    const direct = xmlBlocks(run, 'rPr').join('');
    const runChain = styleChain(attr(first(direct, 'rStyle'), 'val'), styles);
    const fonts = [
      ...readFonts(direct),
      ...runChain.flatMap((style) => style.fonts),
      ...readFonts(mark),
      ...paragraphChain.flatMap((style) => style.fonts),
    ];
    return {
      text: textNodes(run).join(''),
      bold: nearestToggle([
        mergedToggle(direct, ['b', 'bCs']),
        chainToggle(runChain, 'bold'),
        mergedToggle(mark, ['b', 'bCs']),
        chainToggle(paragraphChain, 'bold'),
      ]),
      italic: nearestToggle([
        mergedToggle(direct, ['i', 'iCs']),
        chainToggle(runChain, 'italic'),
        mergedToggle(mark, ['i', 'iCs']),
        chainToggle(paragraphChain, 'italic'),
      ]),
      size: nearestSize([
        readSize(direct),
        nearestSize(runChain.map((style) => style.size)),
        readSize(mark),
        nearestSize(paragraphChain.map((style) => style.size)),
      ]),
      fonts,
    };
  });
}

function paragraphByText(documentXml: string, text: string) {
  return bodyParagraphs(documentXml).find((paragraph) => paragraphText(paragraph) === text) ?? '';
}

function runByText(paragraph: string, styles: Map<string, StyleFacts>, text: string) {
  return runsOf(paragraph, styles).find((run) => run.text === text);
}

function extentPairs(documentXml: string) {
  const pairs: Array<{ cx: number; cy: number }> = [];
  for (const tag of localXml(documentXml).matchAll(/<(?:extent|ext)\b[^>]*>/g)) {
    const cx = tag[0].match(/\bcx="(\d+(?:\.\d+)?)"/);
    const cy = tag[0].match(/\bcy="(\d+(?:\.\d+)?)"/);
    if (cx && cy) pairs.push({ cx: Number(cx[1]), cy: Number(cy[1]) });
  }
  return pairs;
}

function expectedExtent(widthPx: number, heightPx: number) {
  const rawCx = widthPx * EMU_PER_PX;
  const rawCy = heightPx * EMU_PER_PX;
  if (rawCx <= MAX_WIDTH_EMU) return { cx: rawCx, cy: rawCy };
  return { cx: MAX_WIDTH_EMU, cy: Math.round((rawCy * MAX_WIDTH_EMU) / rawCx) };
}

function expectExtent(documentXml: string, widthPx: number, heightPx: number) {
  const pairs = extentPairs(documentXml);
  const expected = expectedExtent(widthPx, heightPx);
  expect(pairs.length).to.be.greaterThan(0);
  for (const pair of pairs) {
    expect(pair).to.deep.equal(expected);
  }
}

function inlineText(inlines: readonly MdInline[]) {
  return inlines.map((inline) => inline.text).join('');
}

function plainInlines(inlines: readonly MdInline[]) {
  return inlines.map((inline) => {
    const next: MdInline = { text: inline.text };
    if (inline.bold === true) next.bold = true;
    if (inline.italic === true) next.italic = true;
    if (inline.code === true) next.code = true;
    return next;
  });
}

/** A generic `block.kind !== kind` check does not narrow a union to one member; a type guard does. */
function isKind<K extends MdBlock['kind']>(block: MdBlock, kind: K): block is Extract<MdBlock, { kind: K }> {
  return block.kind === kind;
}

function asKind<K extends MdBlock['kind']>(block: MdBlock | undefined, kind: K): Extract<MdBlock, { kind: K }> {
  expect(block?.kind).to.equal(kind);
  if (!block || !isKind(block, kind)) {
    throw new Error(`expected ${kind}`);
  }
  return block;
}

function codeSource(text: string) {
  return text.replace(/\n$/, '');
}

async function openDocx(blocksToWrite: DocxBlock[]) {
  const blob = await buildDocx(blocksToWrite);
  expect(blob).to.be.instanceOf(Blob);
  expect(blob.type).to.equal(DOCX_MIME);
  return readZip(new Uint8Array(await blob.arrayBuffer()));
}

describe('markdownBlocks', () => {
  it('splits the acceptance sample into a heading, paragraph, list, code block, and image', () => {
    const blocks = markdownBlocks('# 题目\n\n已知 $a+b$。\n\n- x\n- y\n\n```cpp\nint a;\n```\n\n![图](u.png)');
    expect(blocks.map((block) => block.kind)).to.deep.equal(['heading', 'paragraph', 'list', 'code', 'image']);

    const heading = asKind(blocks[0], 'heading');
    expect(heading.level).to.equal(1);
    expect(plainInlines(heading.inlines)).to.deep.equal([{ text: '题目' }]);

    const paragraph = asKind(blocks[1], 'paragraph');
    expect(inlineText(paragraph.inlines)).to.equal('已知 $a+b$。');
    expect(inlineText(paragraph.inlines)).to.include('$a+b$');

    const list = asKind(blocks[2], 'list');
    expect(list.ordered).to.equal(false);
    expect(list.items).to.have.length(2);
    expect(list.items.map((item) => inlineText(item))).to.deep.equal(['x', 'y']);

    const code = asKind(blocks[3], 'code');
    expect(codeSource(code.text)).to.equal('int a;');
    expect(code.text).to.not.include('```');
    expect(code.text).to.not.include('cpp');

    expect(blocks[4]).to.deep.equal({ kind: 'image', url: 'u.png', alt: '图' });
  });

  it('reads atx headings at levels 1, 2, and 3, including inline marks', () => {
    const blocks = markdownBlocks('# **一级**\n\n## 二级\n\n### 三级');
    expect(blocks.map((block) => block.kind)).to.deep.equal(['heading', 'heading', 'heading']);
    const firstHeading = asKind(blocks[0], 'heading');
    const secondHeading = asKind(blocks[1], 'heading');
    const thirdHeading = asKind(blocks[2], 'heading');
    expect(firstHeading.level).to.equal(1);
    expect(plainInlines(firstHeading.inlines)).to.deep.equal([{ text: '一级', bold: true }]);
    expect(secondHeading.level).to.equal(2);
    expect(inlineText(secondHeading.inlines)).to.equal('二级');
    expect(thirdHeading.level).to.equal(3);
    expect(inlineText(thirdHeading.inlines)).to.equal('三级');
  });

  it('splits paragraphs on a blank line and does not keep the following paragraph in a list', () => {
    const paragraphs = markdownBlocks('第一段\n\n第二段');
    expect(paragraphs.map((block) => block.kind)).to.deep.equal(['paragraph', 'paragraph']);
    expect(inlineText(asKind(paragraphs[0], 'paragraph').inlines)).to.equal('第一段');
    expect(inlineText(asKind(paragraphs[1], 'paragraph').inlines)).to.equal('第二段');

    const listed = markdownBlocks('- x\n\n后');
    expect(listed.map((block) => block.kind)).to.deep.equal(['list', 'paragraph']);
    expect(inlineText(asKind(listed[1], 'paragraph').inlines)).to.equal('后');
  });

  it('reads dash, star, and numbered lists', () => {
    const dashed = asKind(markdownBlocks('- x\n- **y**')[0], 'list');
    expect(dashed.ordered).to.equal(false);
    expect(dashed.items.map((item) => plainInlines(item))).to.deep.equal([
      [{ text: 'x' }],
      [{ text: 'y', bold: true }],
    ]);

    const starred = asKind(markdownBlocks('* 甲\n* 乙')[0], 'list');
    expect(starred.ordered).to.equal(false);
    expect(starred.items.map((item) => inlineText(item))).to.deep.equal(['甲', '乙']);

    const numbered = asKind(markdownBlocks('1. 甲\n2. 乙')[0], 'list');
    expect(numbered.ordered).to.equal(true);
    expect(numbered.items.map((item) => inlineText(item))).to.deep.equal(['甲', '乙']);
  });

  it('keeps fenced code as one block, including indentation and a blank line inside it', () => {
    const blocks = markdownBlocks('```\na\n\n  b\n**粗**\n```\n\n后');
    expect(blocks.map((block) => block.kind)).to.deep.equal(['code', 'paragraph']);
    expect(codeSource(asKind(blocks[0], 'code').text)).to.equal('a\n\n  b\n**粗**');
    expect(inlineText(asKind(blocks[1], 'paragraph').inlines)).to.equal('后');
  });

  it('keeps a dollar-dollar math block as source text', () => {
    const blocks = markdownBlocks('前文\n\n$$\nx^2+1\n$$\n\n后文');
    expect(blocks.map((block) => block.kind)).to.deep.equal(['paragraph', 'math', 'paragraph']);
    const math = asKind(blocks[1], 'math');
    expect(math.text).to.not.include('$$');
    expect(math.text.trim()).to.equal('x^2+1');
    expect(inlineText(asKind(blocks[0], 'paragraph').inlines)).to.equal('前文');
    expect(inlineText(asKind(blocks[2], 'paragraph').inlines)).to.equal('后文');
  });

  it('leaves inline dollar math as literal text, including marks inside it', () => {
    const block = asKind(markdownBlocks('见 $a*b*c$ 与 $x**y**$')[0], 'paragraph');
    expect(inlineText(block.inlines)).to.equal('见 $a*b*c$ 与 $x**y**$');
    expect(plainInlines(block.inlines).some((inline) => inline.bold || inline.italic || inline.code)).to.equal(false);
  });

  it('leaves a fourth-level atx line as ordinary text', () => {
    const blocks = markdownBlocks('#### 不是标题');
    expect(blocks).to.have.length(1);
    const paragraph = asKind(blocks[0], 'paragraph');
    expect(inlineText(paragraph.inlines)).to.equal('#### 不是标题');
  });

  it('reads a standalone image, including a path url', () => {
    expect(markdownBlocks('![示意图](/p/12/file/a.png)')).to.deep.equal([
      { kind: 'image', url: '/p/12/file/a.png', alt: '示意图' },
    ]);
  });

  it('splits inline images out of the surrounding text and leaves images inside code', () => {
    const blocks = markdownBlocks('见 ![图](/p/12/file/a.png) 和 ![表](/p/12/file/b.png)');
    expect(blocks).to.deep.equal([
      { kind: 'paragraph', inlines: [{ text: '见 ' }] },
      { kind: 'image', url: '/p/12/file/a.png', alt: '图' },
      { kind: 'paragraph', inlines: [{ text: ' 和 ' }] },
      { kind: 'image', url: '/p/12/file/b.png', alt: '表' },
    ]);
    expect(blocks.filter((block) => block.kind === 'paragraph').every((block) => (
      block.kind === 'paragraph' && block.inlines.every((inline) => !inline.text.includes('!['))
    ))).to.equal(true);
    const fenced = markdownBlocks('```\n![图](u.png)\n```');
    expect(fenced).to.deep.equal([{ kind: 'code', text: '![图](u.png)' }]);
  });

  it('marks bold, italic, and code inlines and leaves other syntax as text', () => {
    const marked = asKind(markdownBlocks('见 **粗体**、*斜体* 和 `代码`')[0], 'paragraph');
    expect(plainInlines(marked.inlines)).to.deep.equal([
      { text: '见 ' },
      { text: '粗体', bold: true },
      { text: '、' },
      { text: '斜体', italic: true },
      { text: ' 和 ' },
      { text: '代码', code: true },
    ]);

    const literal = asKind(markdownBlocks('`*不是斜体*`')[0], 'paragraph');
    expect(plainInlines(literal.inlines)).to.deep.equal([{ text: '*不是斜体*', code: true }]);

    const plain = markdownBlocks('[这里](https://example.com)\n\n> 引用一段');
    expect(plain.map((block) => block.kind)).to.deep.equal(['paragraph', 'paragraph']);
    expect(inlineText(asKind(plain[0], 'paragraph').inlines)).to.equal('[这里](https://example.com)');
    expect(plainInlines(asKind(plain[0], 'paragraph').inlines).some((inline) => inline.bold || inline.italic || inline.code)).to.equal(false);
    expect(inlineText(asKind(plain[1], 'paragraph').inlines)).to.equal('> 引用一段');

    const ticks = asKind(markdownBlocks('行内 ``` 不是代码')[0], 'paragraph');
    expect(inlineText(ticks.inlines)).to.include('```');
  });
});

describe('buildDocx', () => {
  it('writes a minimal document when there are no blocks', async () => {
    const entries = await openDocx([]);
    for (const name of REQUIRED_PARTS) {
      expect(partText(entries, name).length).to.be.greaterThan(0);
    }
    const document = partText(entries, 'word/document.xml');
    expect(document).to.include('w:body');
    const rootRels = partText(entries, '_rels/.rels');
    expect(rootRels).to.include('word/document.xml');
    expect(rootRels).to.include('officeDocument');
    expect(partText(entries, '[Content_Types].xml')).to.include('wordprocessingml.document.main+xml');
  });

  it('writes the title, escapes less-than, and points the image relationship at image1.png', async () => {
    const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 255);
    const entries = await openDocx([
      { kind: 'title', text: '期中试卷' },
      { kind: 'paragraph', inlines: [{ text: 'x < y & z' }] },
      {
        kind: 'image',
        data: png,
        contentType: 'image/png',
        widthPx: 96,
        heightPx: 48,
      },
    ]);
    const document = partText(entries, 'word/document.xml');
    expect(document).to.include('期中试卷');
    expect(document).to.include('&lt;');
    expect(document).to.match(/&amp;|&#0*38;|&#x0*26;/i);
    expect(textNodes(document)).to.include('期中试卷');
    expect(textNodes(document)).to.include('x < y & z');
    for (const raw of rawTextNodes(document)) {
      expect(raw).to.not.include('<');
      expect(raw).to.not.match(/&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/);
    }

    expectBytes(entries, 'word/media/image1.png', png);
    expect(partText(entries, '[Content_Types].xml')).to.include('image/png');
    const imageRel = relationships(partText(entries, 'word/_rels/document.xml.rels'))
      .find((rel) => rel.target === 'media/image1.png');
    expect(imageRel).to.not.equal(undefined);
    expect(imageRel?.type ?? '').to.include('image');
    const documentLocal = localXml(document);
    expect(documentLocal).to.include(`embed="${imageRel?.id ?? ''}"`);
    expect(documentLocal).to.match(/<drawing\b/);
    expect(documentLocal).to.match(/<inline\b/);
    expect(documentLocal).to.not.match(/<anchor\b/);
    // An inline picture is run content: drawing's parent is r, and that run sits inside p.
    const drawings = elementParents(documentLocal, 'drawing');
    expect(drawings).to.have.length(1);
    const drawing = drawings[0];
    expect(drawing.parent).to.equal('r');
    expect(drawing.ancestors).to.include('p');
  });

  it('centers and bolds a large title, and bolds a heading', async () => {
    const entries = await openDocx([
      { kind: 'title', text: '期中试卷' },
      { kind: 'heading', text: '第一节' },
      { kind: 'paragraph', inlines: [{ text: '正文' }] },
    ]);
    const document = partText(entries, 'word/document.xml');
    const styles = parseStyles(partText(entries, 'word/styles.xml'));
    const title = paragraphByText(document, '期中试卷');
    const heading = paragraphByText(document, '第一节');
    expect(title).to.not.equal('');
    expect(heading).to.not.equal('');
    expect(paragraphCentered(title, styles)).to.equal(true);
    const titleRuns = runsOf(title, styles).filter((run) => run.text.length > 0);
    expect(titleRuns.length).to.be.greaterThan(0);
    for (const run of titleRuns) {
      expect(run.bold).to.equal(true);
      expect(run.size ?? 0).to.be.at.least(28);
    }
    const headingRuns = runsOf(heading, styles).filter((run) => run.text.length > 0);
    expect(headingRuns.length).to.be.greaterThan(0);
    for (const run of headingRuns) {
      expect(run.bold).to.equal(true);
    }
    const visible = visibleText(document);
    expect(visible.indexOf('期中试卷')).to.be.at.least(0);
    expect(visible.indexOf('第一节')).to.be.greaterThan(visible.indexOf('期中试卷'));
    expect(visible.indexOf('正文')).to.be.greaterThan(visible.indexOf('第一节'));
  });

  it('draws the title larger than a heading', async () => {
    const entries = await openDocx([
      { kind: 'title', text: '期中试卷' },
      { kind: 'heading', text: '第一节' },
    ]);
    const document = partText(entries, 'word/document.xml');
    const styles = parseStyles(partText(entries, 'word/styles.xml'));
    const titleRun = runByText(paragraphByText(document, '期中试卷'), styles, '期中试卷');
    const headingRun = runByText(paragraphByText(document, '第一节'), styles, '第一节');
    expect(titleRun?.size ?? 0).to.be.greaterThan(headingRun?.size ?? 0);
  });

  it('writes code as monospace lines and keeps each line\'s whitespace', async () => {
    const entries = await openDocx([
      { kind: 'code', text: '  int a;\n\treturn 1;' },
    ]);
    const document = partText(entries, 'word/document.xml');
    const styles = parseStyles(partText(entries, 'word/styles.xml'));
    expect(visibleText(document).replaceAll('\r\n', '\n')).to.include('  int a;\n\treturn 1;');
    const codeParagraphs = bodyParagraphs(document).filter((paragraph) => {
      const text = paragraphText(paragraph);
      return text.includes('int a;') || text.includes('return 1;');
    });
    expect(codeParagraphs.length).to.be.greaterThan(0);
    const fonts = codeParagraphs.flatMap((paragraph) => runsOf(paragraph, styles).flatMap((run) => run.fonts));
    expect(fonts.join('\n')).to.match(MONOSPACE);
  });

  it('converts image pixels to emus at 96 dpi and scales a picture wider than 15cm', async () => {
    expect(expectedExtent(96, 48)).to.deep.equal({ cx: 914400, cy: 457200 });
    expect(expectedExtent(1000, 400)).to.deep.equal({ cx: 5400000, cy: 2160000 });

    const fitted = await openDocx([
      {
        kind: 'image',
        data: Uint8Array.of(1, 2, 3),
        contentType: 'image/png',
        widthPx: 96,
        heightPx: 48,
      },
    ]);
    const fittedDocument = partText(fitted, 'word/document.xml');
    expect(localXml(fittedDocument)).to.match(/<inline\b/);
    expectExtent(fittedDocument, 96, 48);

    const wide = await openDocx([
      {
        kind: 'image',
        data: Uint8Array.of(4, 5, 6),
        contentType: 'image/png',
        widthPx: 1000,
        heightPx: 400,
      },
    ]);
    const wideDocument = partText(wide, 'word/document.xml');
    expect(localXml(wideDocument)).to.match(/<inline\b/);
    expectExtent(wideDocument, 1000, 400);
  });

  it('writes one empty paragraph per blank line', async () => {
    const between = await openDocx([
      { kind: 'paragraph', inlines: [{ text: '上' }] },
      { kind: 'blankLines', count: 3 },
      { kind: 'paragraph', inlines: [{ text: '下' }] },
    ]);
    const texts = bodyParagraphs(partText(between, 'word/document.xml')).map((paragraph) => paragraphText(paragraph));
    const upper = texts.indexOf('上');
    const lower = texts.indexOf('下');
    expect(upper).to.be.at.least(0);
    expect(lower).to.be.greaterThan(upper);
    expect(texts.slice(upper + 1, lower)).to.deep.equal(['', '', '']);

    const onlyBlank = await openDocx([{ kind: 'blankLines', count: 2 }]);
    const blankDocument = partText(onlyBlank, 'word/document.xml');
    expect(blankDocument).to.include('w:body');
    const blankTexts = bodyParagraphs(blankDocument).map((paragraph) => paragraphText(paragraph));
    expect(blankTexts.filter((text) => text.trim() !== '')).to.have.length(0);
    const emptyCount = blankTexts.filter((text) => text === '').length;
    expect(emptyCount).to.be.at.least(2);
    expect(emptyCount).to.be.at.most(3);
  });

  it('renders paragraph bold, italic, and monospace code inlines', async () => {
    const entries = await openDocx([
      {
        kind: 'paragraph',
        inlines: [
          { text: '前' },
          { text: '粗', bold: true },
          { text: '斜', italic: true },
          { text: '码', code: true },
        ],
      },
    ]);
    const document = partText(entries, 'word/document.xml');
    const styles = parseStyles(partText(entries, 'word/styles.xml'));
    const paragraph = paragraphByText(document, '前粗斜码');
    expect(paragraph).to.not.equal('');
    const plain = runByText(paragraph, styles, '前');
    const bold = runByText(paragraph, styles, '粗');
    const italic = runByText(paragraph, styles, '斜');
    const code = runByText(paragraph, styles, '码');
    expect(plain?.bold).to.equal(false);
    expect(plain?.italic).to.equal(false);
    expect(bold?.bold).to.equal(true);
    expect(bold?.italic).to.equal(false);
    expect(italic?.bold).to.equal(false);
    expect(italic?.italic).to.equal(true);
    expect((code?.fonts ?? []).join('\n')).to.match(MONOSPACE);
  });

  it('stores later images as imageN with an extension for png, gif, and jpeg', async () => {
    const png = Uint8Array.of(10, 20, 30, 40);
    const gif = Uint8Array.of(50, 60, 70, 80);
    const jpeg = Uint8Array.of(90, 100, 110, 120);
    const entries = await openDocx([
      {
        kind: 'image', data: png, contentType: 'image/png', widthPx: 8, heightPx: 4,
      },
      {
        kind: 'image', data: gif, contentType: 'image/gif', widthPx: 8, heightPx: 4,
      },
      {
        kind: 'image', data: jpeg, contentType: 'image/jpeg', widthPx: 8, heightPx: 4,
      },
    ]);
    expectBytes(entries, 'word/media/image1.png', png);
    expectBytes(entries, 'word/media/image2.gif', gif);
    const jpegName = [...entries.keys()].find((name) => /^word\/media\/image3\.jpe?g$/.test(name));
    expect(jpegName).to.be.a('string');
    expectBytes(entries, jpegName ?? '', jpeg);
    const contentTypes = partText(entries, '[Content_Types].xml');
    expect(contentTypes).to.include('image/png');
    expect(contentTypes).to.include('image/gif');
    expect(contentTypes).to.include('image/jpeg');
    const rels = relationships(partText(entries, 'word/_rels/document.xml.rels'));
    expect(rels.some((rel) => rel.target === 'media/image1.png' && rel.type.includes('image'))).to.equal(true);
    expect(rels.some((rel) => rel.target === 'media/image2.gif' && rel.type.includes('image'))).to.equal(true);
    expect(rels.some((rel) => rel.target === targetPath(jpegName ?? '').replace(/^word\//, '') && rel.type.includes('image'))).to.equal(true);
  });
});
