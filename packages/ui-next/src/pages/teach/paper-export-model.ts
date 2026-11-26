import { parseProblemKind } from '@hydrooj/common';
import type { ProblemKind } from '@hydrooj/common';
import type { DocxBlock } from '@/lib/docx';
import { fetchHydroResponse } from '@/lib/error-presenter';
import type { MdBlock, MdInline } from '@/lib/markdown-blocks';
import { markdownBlocks } from '@/lib/markdown-blocks';

const PAPER_TYPES = ['homework', 'exam', 'acm', 'oi', 'practice'] as const;
const PAPER_KEYS = ['title', 'type', 'answers', 'grouped', 'sections'] as const;
const SECTION_KEYS = ['kind', 'heading', 'drawNote', 'items'] as const;
const ITEM_KEYS = ['label', 'pid', 'title', 'score', 'kind', 'statement', 'options', 'answer'] as const;
const ANSWER_MARK = '\uFF1A';
const WRITING_LINE_COUNT = 3;
const NO_STANDARD_ANSWER = new Set<ProblemKind>(['programming', 'program_fill', 'function', 'subjective']);
// handler/after injects this count on every templated body for PRIV_EDIT_SYSTEM, including JSON.
const INJECTED_BODY_FIELD = 'pendingBindingRequests';
// MarkdownView picks a language pack in this order, then the first key. Empty text does not count.
const STATEMENT_LANG_ORDER = ['zh', 'zh-CN', 'zh_CN', 'en'] as const;

export const PAPER_IDENTITY_LINE = `姓名 ${'_'.repeat(6)}  学号 ${'_'.repeat(6)}  班级 ${'_'.repeat(6)}`;
export const PAPER_JUDGE_BLANK = '（\u3000\u3000）';
export const PAPER_NO_ANSWER = '（无标准答案）';

export type TeachPaperContainerType = (typeof PAPER_TYPES)[number];

export interface TeachPaperItem {
  label: string;
  pid: number;
  title: string;
  score: number | null;
  kind: ProblemKind;
  statement: string;
  options: string[] | null;
  answer: string | null;
}

export interface TeachPaperSection {
  kind: ProblemKind | null;
  heading: string;
  drawNote: string | null;
  items: TeachPaperItem[];
}

export interface TeachPaperExport {
  title: string;
  type: TeachPaperContainerType;
  answers: boolean;
  grouped: boolean;
  sections: TeachPaperSection[];
}

export interface PaperExportImage {
  data: Uint8Array;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif';
  widthPx: number;
  heightPx: number;
}

type JsonRecord = Record<string, unknown>;

function invalid(path: string): never {
  throw new TypeError(`teach_paper_invalid:${path}`);
}

function join(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function asRecord(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path);
  return value as JsonRecord;
}

function assertKeys(record: JsonRecord, keys: readonly string[], path: string): void {
  const present = Object.keys(record);
  if (present.length !== keys.length) invalid(path);
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) invalid(`${path}.${key}`);
  }
}

function readRequired(record: JsonRecord, key: string, parent: string): unknown {
  const path = join(parent, key);
  if (!Object.hasOwn(record, key)) invalid(path);
  return record[key];
}

function readString(record: JsonRecord, key: string, parent: string): string {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (typeof value !== 'string') invalid(path);
  return value;
}

function readStringOrNull(record: JsonRecord, key: string, parent: string): string | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  if (typeof value !== 'string') invalid(path);
  return value;
}

function readBoolean(record: JsonRecord, key: string, parent: string): boolean {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function readInteger(record: JsonRecord, key: string, parent: string): number {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(path);
  return value;
}

function readScore(record: JsonRecord, key: string, parent: string): number | null {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path);
  return value;
}

function readUnion<T extends string>(record: JsonRecord, key: string, parent: string, allowed: readonly T[]): T {
  const path = join(parent, key);
  const value = readRequired(record, key, parent);
  if (typeof value !== 'string') invalid(path);
  for (const option of allowed) {
    if (value === option) return option;
  }
  invalid(path);
}

function readKind(value: unknown, path: string): ProblemKind {
  try {
    return parseProblemKind(value);
  } catch (error) {
    if (error instanceof TypeError) invalid(path);
    throw error;
  }
}

function readSectionKind(value: unknown, path: string, grouped: boolean): ProblemKind | null {
  if (!grouped) {
    if (value !== null) invalid(path);
    return null;
  }
  return readKind(value, path);
}

function readOptions(value: unknown, path: string): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) invalid(path);
  return value.map((item, index) => {
    if (typeof item !== 'string') invalid(`${path}[${index}]`);
    return item;
  });
}

function readAnswer(value: unknown, path: string, answers: boolean): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid(path);
  if (!answers) invalid(path);
  return value;
}

function readItem(value: unknown, path: string, answers: boolean): TeachPaperItem {
  const record = asRecord(value, path);
  assertKeys(record, ITEM_KEYS, path);
  return {
    label: readString(record, 'label', path),
    pid: readInteger(record, 'pid', path),
    title: readString(record, 'title', path),
    score: readScore(record, 'score', path),
    kind: readKind(readRequired(record, 'kind', path), join(path, 'kind')),
    statement: readString(record, 'statement', path),
    options: readOptions(readRequired(record, 'options', path), join(path, 'options')),
    answer: readAnswer(readRequired(record, 'answer', path), join(path, 'answer'), answers),
  };
}

function readSection(value: unknown, path: string, grouped: boolean, answers: boolean): TeachPaperSection {
  const record = asRecord(value, path);
  assertKeys(record, SECTION_KEYS, path);
  const itemsValue = readRequired(record, 'items', path);
  if (!Array.isArray(itemsValue)) invalid(join(path, 'items'));
  return {
    kind: readSectionKind(readRequired(record, 'kind', path), join(path, 'kind'), grouped),
    heading: readString(record, 'heading', path),
    drawNote: readStringOrNull(record, 'drawNote', path),
    items: itemsValue.map((item, index) => readItem(item, `${join(path, 'items')}[${index}]`, answers)),
  };
}

function paperRecord(raw: unknown): JsonRecord {
  const record = asRecord(raw, 'paper');
  if (!Object.hasOwn(record, INJECTED_BODY_FIELD)) return record;
  const next: JsonRecord = {};
  for (const key of Object.keys(record)) {
    if (key === INJECTED_BODY_FIELD) continue;
    next[key] = record[key];
  }
  return next;
}

export function parseTeachPaperExport(raw: unknown): TeachPaperExport {
  const record = paperRecord(raw);
  assertKeys(record, PAPER_KEYS, 'paper');
  const answers = readBoolean(record, 'answers', 'paper');
  const grouped = readBoolean(record, 'grouped', 'paper');
  const sectionsValue = readRequired(record, 'sections', 'paper');
  if (!Array.isArray(sectionsValue)) invalid('paper.sections');
  return {
    title: readString(record, 'title', 'paper'),
    type: readUnion(record, 'type', 'paper', PAPER_TYPES),
    answers,
    grouped,
    sections: sectionsValue.map((section, index) => readSection(section, `paper.sections[${index}]`, grouped, answers)),
  };
}

export function paperItemLabel(item: Pick<TeachPaperItem, 'label' | 'score'>): string {
  if (item.score === null) return item.label;
  return `${item.label}（${item.score} 分）`;
}

export function paperOptionLine(index: number, text: string): string {
  if (!Number.isInteger(index) || index < 0 || index > 25) {
    throw new Error(`试卷选项超出 A–Z：${index}`);
  }
  return `${String.fromCharCode(65 + index)}. ${text}`;
}

export function paperShowsOptions(kind: ProblemKind): boolean {
  return kind === 'single' || kind === 'multi';
}

export function paperShowsJudgeBlank(kind: ProblemKind): boolean {
  return kind === 'true_false';
}

export function paperWritingLines(kind: ProblemKind): number {
  if (kind === 'blank' || kind === 'subjective') return WRITING_LINE_COUNT;
  return 0;
}

export function paperAnswerText(kind: ProblemKind, answer: string | null): string {
  if (NO_STANDARD_ANSWER.has(kind) || answer === null || answer === '') return PAPER_NO_ANSWER;
  return `答案${ANSWER_MARK}${answer}`;
}

function inlineText(inlines: readonly MdInline[]): string {
  return inlines.map((inline) => inline.text).join('');
}

function copyInlines(inlines: readonly MdInline[]): MdInline[] {
  return inlines.map((inline) => {
    const next: MdInline = { text: inline.text };
    if (inline.bold === true) next.bold = true;
    if (inline.italic === true) next.italic = true;
    if (inline.code === true) next.code = true;
    return next;
  });
}

function imageContentType(header: string | null): PaperExportImage['contentType'] | null {
  if (typeof header !== 'string') return null;
  const mime = header.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') return mime;
  return null;
}

function readCachedImage(value: PaperExportImage | undefined): PaperExportImage | null {
  if (value === undefined) return null;
  if (!(value.data instanceof Uint8Array)) return null;
  if (value.contentType !== 'image/png' && value.contentType !== 'image/jpeg' && value.contentType !== 'image/gif') return null;
  if (!Number.isFinite(value.widthPx) || !Number.isFinite(value.heightPx) || value.widthPx <= 0 || value.heightPx <= 0) return null;
  return {
    data: value.data,
    contentType: value.contentType,
    widthPx: value.widthPx,
    heightPx: value.heightPx,
  };
}

async function fetchImage(url: string): Promise<PaperExportImage | null> {
  try {
    const response = await fetchHydroResponse(url, { credentials: 'same-origin' }, '试卷图片加载失败');
    if (!response.ok) return null;
    const contentType = imageContentType(response.headers.get('content-type'));
    if (contentType === null) return null;
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0) return null;
    const bitmap = await createImageBitmap(new Blob([data], { type: contentType }));
    const widthPx = bitmap.width;
    const heightPx = bitmap.height;
    bitmap.close();
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) return null;
    return { data, contentType, widthPx, heightPx };
  } catch {
    return null;
  }
}

async function resolveImage(
  url: string,
  images: ReadonlyMap<string, PaperExportImage>,
  resolved: Map<string, PaperExportImage | null>,
): Promise<PaperExportImage | null> {
  if (resolved.has(url)) return resolved.get(url) ?? null;
  const cached = readCachedImage(images.get(url));
  const image = cached ?? await fetchImage(url);
  resolved.set(url, image);
  return image;
}

function imageFallback(alt: string): DocxBlock {
  return { kind: 'paragraph', inlines: [{ text: `[图片${ANSWER_MARK}${alt}]` }] };
}

async function convertBlock(
  block: MdBlock,
  images: ReadonlyMap<string, PaperExportImage>,
  resolved: Map<string, PaperExportImage | null>,
): Promise<DocxBlock[]> {
  switch (block.kind) {
    case 'heading':
      return [{ kind: 'heading', text: inlineText(block.inlines) }];
    case 'paragraph':
      return [{ kind: 'paragraph', inlines: copyInlines(block.inlines) }];
    case 'list':
      return block.items.map((item, index) => ({
        kind: 'paragraph' as const,
        inlines: [{ text: block.ordered ? `${index + 1}. ` : '- ' }, ...copyInlines(item)],
      }));
    case 'code':
      return [{ kind: 'code', text: block.text }];
    case 'math':
      return [{ kind: 'paragraph', inlines: [{ text: `$$${block.text}$$` }] }];
    case 'image': {
      const image = await resolveImage(block.url, images, resolved);
      if (!image) return [imageFallback(block.alt)];
      return [{
        kind: 'image',
        data: image.data,
        contentType: image.contentType,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
      }];
    }
    default: {
      const unexpected: never = block;
      throw new Error(`unknown markdown block: ${JSON.stringify(unexpected)}`);
    }
  }
}

function statementMarkdown(statement: string): string {
  const trimmed = statement.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return statement;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return statement;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return statement;
  const keys = Object.keys(parsed);
  if (keys.length === 0) return statement;
  const langs: Record<string, string> = {};
  for (const key of keys) {
    const value: unknown = Reflect.get(parsed, key);
    if (typeof value !== 'string') return statement;
    langs[key] = value;
  }
  for (const lang of STATEMENT_LANG_ORDER) {
    const text = langs[lang];
    if (text) return text;
  }
  const first = keys[0];
  if (first === undefined) return statement;
  return langs[first] ?? '';
}

async function statementBlocks(
  statement: string,
  images: ReadonlyMap<string, PaperExportImage>,
  resolved: Map<string, PaperExportImage | null>,
): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = [];
  for (const block of markdownBlocks(statementMarkdown(statement))) {
    blocks.push(...await convertBlock(block, images, resolved));
  }
  return blocks;
}

export async function paperDocxBlocks(
  paper: TeachPaperExport,
  images: ReadonlyMap<string, PaperExportImage>,
): Promise<DocxBlock[]> {
  if (!(images instanceof Map)) throw new TypeError('paper images must be a map');
  const resolved = new Map<string, PaperExportImage | null>();
  const blocks: DocxBlock[] = [{ kind: 'title', text: paper.title }];
  if (!paper.answers) blocks.push({ kind: 'paragraph', inlines: [{ text: PAPER_IDENTITY_LINE }] });
  for (const section of paper.sections) {
    if (section.heading !== '') blocks.push({ kind: 'heading', text: section.heading });
    if (section.drawNote) blocks.push({ kind: 'paragraph', inlines: [{ text: section.drawNote }] });
    for (const item of section.items) {
      blocks.push({ kind: 'paragraph', inlines: [{ text: paperItemLabel(item), bold: true }] });
      blocks.push(...await statementBlocks(item.statement, images, resolved));
      if (paperShowsOptions(item.kind) && item.options !== null) {
        item.options.forEach((option, index) => {
          blocks.push({ kind: 'paragraph', inlines: [{ text: paperOptionLine(index, option) }] });
        });
      }
      if (paperShowsJudgeBlank(item.kind)) {
        blocks.push({ kind: 'paragraph', inlines: [{ text: PAPER_JUDGE_BLANK }] });
      }
      const writingLines = paperWritingLines(item.kind);
      if (writingLines > 0) blocks.push({ kind: 'blankLines', count: writingLines });
      if (paper.answers) {
        blocks.push({ kind: 'paragraph', inlines: [{ text: paperAnswerText(item.kind, item.answer) }] });
      }
    }
  }
  return blocks;
}
