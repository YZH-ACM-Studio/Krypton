// paper-export-model.ts is new and may be absent until the export lands.
// @vitest-environment node
import type { ProblemKind } from '@hydrooj/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocxBlock } from '../../src/lib/docx.ts';
import type { MdInline } from '../../src/lib/markdown-blocks.ts';

const modelLoaders = import.meta.glob('../../src/pages/teach/paper-export-model.ts');
const MODEL_SOURCE = 'src/pages/teach/paper-export-model.ts';

const TITLE = '一次函数测验';
const IDENTITY_LINE = `姓名 ${'_'.repeat(6)}  学号 ${'_'.repeat(6)}  班级 ${'_'.repeat(6)}`;
const JUDGE_BLANK = '（\u3000\u3000）';
const ANSWER_B = '答案\uFF1AB';
const ANSWER_MULTI = '答案\uFF1AA, C';
const ANSWER_TRUE = '答案\uFF1A对';
const ANSWER_BLANK = '答案\uFF1AO(1)';
const NO_ANSWER = '（无标准答案）';
const DRAW_NOTE = '每人抽 2 道';
const IMAGE_URL = 'https://files.example/diagram.png';
const IMAGE_ALT = '[图片\uFF1A示意图]';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TRUE_FALSE_HEADING = '一、判断题（每题 2 分，共 2 分）';
const SINGLE_HEADING = '二、单选题（每题 5 分，共 5 分）';
const MULTI_HEADING = '三、多选题（每题 4 分，共 4 分）';
const BLANK_HEADING = '四、填空题（每题 3 分，共 3 分）';
const PROGRAM_HEADING = '七、编程题（共 10 分）';
const SUBJECTIVE_HEADING = '八、主观题（共 8 分）';
const PROGRAM_STATEMENT = '实现一个栈。\n\n```cpp\nint a;\n```';

interface PaperExportImage {
  data: Uint8Array;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif';
  widthPx: number;
  heightPx: number;
}

interface TeachPaperItem {
  label: string;
  pid: number;
  title: string;
  score: number | null;
  kind: ProblemKind;
  statement: string;
  options: string[] | null;
  answer: string | null;
}

interface TeachPaperSection {
  kind: ProblemKind | null;
  heading: string;
  drawNote: string | null;
  items: TeachPaperItem[];
}

interface TeachPaperExport {
  title: string;
  type: 'homework' | 'exam' | 'acm' | 'oi' | 'practice';
  answers: boolean;
  grouped: boolean;
  sections: TeachPaperSection[];
}

type PaperImages = ReadonlyMap<string, PaperExportImage>;
type ParseTeachPaperExport = (raw: unknown) => unknown;
type PaperDocxBlocks = (paper: TeachPaperExport, images: PaperImages) => unknown;

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function moduleLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(modelLoaders)) {
    if (!key.endsWith(MODEL_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadExportModel(): Promise<object> {
  const load = moduleLoader();
  expect(typeof load, `${MODEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MODEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (!isRecord(imported)) throw new TypeError(`${MODEL_SOURCE} must be a module`);
  return imported;
}

function parserOf(value: unknown): ParseTeachPaperExport {
  if (typeof value !== 'function') throw new TypeError('parseTeachPaperExport must be a function');
  return value as ParseTeachPaperExport;
}

function blocksOf(value: unknown): PaperDocxBlocks {
  if (typeof value !== 'function') throw new TypeError('paperDocxBlocks must be a function');
  return value as PaperDocxBlocks;
}

function readString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new TypeError(`${where} must be a string`);
  return value;
}

function readInlines(value: unknown, where: string): MdInline[] {
  if (!Array.isArray(value)) throw new TypeError(`${where} must be inlines`);
  return value.map((inline, index) => {
    if (!isRecord(inline)) throw new TypeError(`${where}[${index}] must be an inline`);
    const next: MdInline = { text: readString(inline.text, `${where}[${index}].text`) };
    if (inline.bold !== undefined) {
      if (typeof inline.bold !== 'boolean') throw new TypeError(`${where}[${index}].bold`);
      next.bold = inline.bold;
    }
    if (inline.italic !== undefined) {
      if (typeof inline.italic !== 'boolean') throw new TypeError(`${where}[${index}].italic`);
      next.italic = inline.italic;
    }
    if (inline.code !== undefined) {
      if (typeof inline.code !== 'boolean') throw new TypeError(`${where}[${index}].code`);
      next.code = inline.code;
    }
    return next;
  });
}

function readBlock(value: unknown, where: string): DocxBlock {
  if (!isRecord(value)) throw new TypeError(`${where} must be a block`);
  const { kind } = value;
  if (kind === 'title' || kind === 'heading' || kind === 'code') {
    return { kind, text: readString(value.text, `${where}.text`) };
  }
  if (kind === 'paragraph') return { kind, inlines: readInlines(value.inlines, `${where}.inlines`) };
  if (kind === 'blankLines') {
    if (typeof value.count !== 'number' || !Number.isInteger(value.count)) throw new TypeError(`${where}.count`);
    return { kind, count: value.count };
  }
  if (kind === 'image') {
    if (!(value.data instanceof Uint8Array)) throw new TypeError(`${where}.data`);
    const { contentType } = value;
    if (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'image/gif') {
      throw new TypeError(`${where}.contentType`);
    }
    if (typeof value.widthPx !== 'number' || typeof value.heightPx !== 'number') throw new TypeError(`${where}.size`);
    return {
      kind,
      data: value.data,
      contentType,
      widthPx: value.widthPx,
      heightPx: value.heightPx,
    };
  }
  throw new TypeError(`${where} has an unknown kind`);
}

function readBlocks(value: unknown): DocxBlock[] {
  if (!Array.isArray(value)) throw new TypeError('paperDocxBlocks must return blocks');
  return value.map((block, index) => readBlock(block, `blocks[${index}]`));
}

function blockText(block: DocxBlock): string {
  if (block.kind === 'title' || block.kind === 'heading' || block.kind === 'code') return block.text;
  if (block.kind === 'paragraph') return block.inlines.map((inline) => inline.text).join('');
  return '';
}

function position(blocks: readonly DocxBlock[], needle: string): number {
  return blocks.findIndex((block) => blockText(block).includes(needle));
}

function between(blocks: readonly DocxBlock[], startNeedle: string, endNeedle: string | null): DocxBlock[] {
  const start = position(blocks, startNeedle);
  if (start < 0) throw new TypeError(`missing ${startNeedle}`);
  if (endNeedle === null) return blocks.slice(start + 1);
  const end = blocks.findIndex((block, index) => index > start && blockText(block).includes(endNeedle));
  if (end < 0) throw new TypeError(`missing ${endNeedle} after ${startNeedle}`);
  return blocks.slice(start + 1, end);
}

function scoredLabel(label: string, score: number): string {
  return `${label}（${score} 分）`;
}

function expectScoredLabel(blocks: readonly DocxBlock[], label: string, score: number): void {
  const text = scoredLabel(label, score);
  expect(blocks.some((block) => block.kind === 'paragraph' && blockText(block) === text)).toBe(true);
}

function blankLineCount(blocks: readonly DocxBlock[]): number | null {
  const found = blocks.filter((block) => block.kind === 'blankLines');
  if (found.length !== 1) return null;
  const block = found[0];
  return block && block.kind === 'blankLines' ? block.count : null;
}

function item(fields: TeachPaperItem): TeachPaperItem {
  return fields;
}

function homeworkPaper(answers: boolean): TeachPaperExport {
  return {
    title: TITLE,
    type: 'homework',
    answers,
    grouped: true,
    sections: [
      {
        kind: 'true_false',
        heading: TRUE_FALSE_HEADING,
        drawNote: null,
        items: [
          item({
            label: '1-1',
            pid: 11,
            title: '栈的基本操作',
            score: 2,
            kind: 'true_false',
            statement: '栈是后进先出。',
            options: null,
            answer: answers ? '对' : null,
          }),
        ],
      },
      {
        kind: 'single',
        heading: SINGLE_HEADING,
        drawNote: DRAW_NOTE,
        items: [
          item({
            label: '2-1',
            pid: 21,
            title: '循环队列长度',
            score: 5,
            kind: 'single',
            statement: '下列哪个是栈？',
            options: ['栈', '队列', '数组'],
            answer: answers ? 'B' : null,
          }),
        ],
      },
      {
        kind: 'multi',
        heading: MULTI_HEADING,
        drawNote: null,
        items: [
          item({
            label: '3-1',
            pid: 31,
            title: '栈的操作',
            score: 4,
            kind: 'multi',
            statement: '哪些是栈的基本操作？',
            options: ['压栈', '弹栈', '查找'],
            answer: answers ? 'A, C' : null,
          }),
        ],
      },
      {
        kind: 'blank',
        heading: BLANK_HEADING,
        drawNote: null,
        items: [
          item({
            label: '4-1',
            pid: 41,
            title: '入栈复杂度',
            score: 3,
            kind: 'blank',
            statement: '入栈的时间复杂度是多少？',
            options: null,
            answer: answers ? 'O(1)' : null,
          }),
        ],
      },
      {
        kind: 'programming',
        heading: PROGRAM_HEADING,
        drawNote: null,
        items: [
          item({
            label: '7-1',
            pid: 71,
            title: '实现栈',
            score: 10,
            kind: 'programming',
            statement: PROGRAM_STATEMENT,
            options: null,
            answer: null,
          }),
        ],
      },
      {
        kind: 'subjective',
        heading: SUBJECTIVE_HEADING,
        drawNote: null,
        items: [
          item({
            label: '8-1',
            pid: 81,
            title: '栈的用途',
            score: 8,
            kind: 'subjective',
            statement: '说明栈的用途。',
            options: null,
            answer: null,
          }),
        ],
      },
    ],
  };
}

function acmPaper(): TeachPaperExport {
  return {
    title: '新生赛',
    type: 'acm',
    answers: false,
    grouped: false,
    sections: [
      {
        kind: null,
        heading: '',
        drawNote: null,
        items: [
          item({
            label: 'A',
            pid: 1,
            title: 'A+B',
            score: null,
            kind: 'programming',
            statement: '计算 A+B。',
            options: null,
            answer: null,
          }),
          item({
            label: 'B',
            pid: 2,
            title: 'A-B',
            score: null,
            kind: 'programming',
            statement: '计算 A-B。',
            options: null,
            answer: null,
          }),
        ],
      },
    ],
  };
}

const NO_STANDARD_KINDS = ['programming', 'program_fill', 'function', 'subjective'] as const;

function singleItemPaper(kind: ProblemKind, answer: string | null, statement: string): TeachPaperExport {
  return {
    title: TITLE,
    type: 'homework',
    answers: true,
    grouped: true,
    sections: [
      {
        kind,
        heading: '一、题目（共 1 分）',
        drawNote: null,
        items: [
          item({
            label: '1-1',
            pid: 11,
            title: '题',
            score: 1,
            kind,
            statement,
            options: null,
            answer,
          }),
        ],
      },
    ],
  };
}

function imagePaper(): TeachPaperExport {
  return {
    title: TITLE,
    type: 'exam',
    answers: false,
    grouped: true,
    sections: [
      {
        kind: 'programming',
        heading: PROGRAM_HEADING,
        drawNote: null,
        items: [
          item({
            label: '7-1',
            pid: 71,
            title: '看图',
            score: 10,
            kind: 'programming',
            statement: `看图作答。\n\n![示意图](${IMAGE_URL})`,
            options: null,
            answer: null,
          }),
        ],
      },
    ],
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const PNG = decodeBase64(PNG_BASE64);

function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input, 'http://krypton.local');
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  throw new TypeError('unexpected fetch input');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function parsePaper(raw: unknown): Promise<unknown> {
  const parseTeachPaperExport = parserOf(readField(await loadExportModel(), 'parseTeachPaperExport'));
  return parseTeachPaperExport(raw);
}

async function renderBlocks(paper: TeachPaperExport, images: PaperImages = new Map()): Promise<DocxBlock[]> {
  const paperDocxBlocks = blocksOf(readField(await loadExportModel(), 'paperDocxBlocks'));
  return readBlocks(await paperDocxBlocks(paper, images));
}

function mockCalls(value: unknown): readonly unknown[][] {
  if ((typeof value !== 'function' && typeof value !== 'object') || value === null) {
    throw new TypeError('expected a vitest mock');
  }
  const mock: unknown = Reflect.get(value, 'mock');
  if (!isRecord(mock) || !Array.isArray(mock.calls)) throw new TypeError('expected a vitest mock');
  return mock.calls.flatMap((call) => (Array.isArray(call) ? [call] : []));
}

function installImageFetch(png: Uint8Array | null): void {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = requestUrl(input);
    if (png && url.href === IMAGE_URL) {
      return Promise.resolve(new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    }
    return Promise.resolve(new Response('missing', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
  }));
  vi.stubGlobal('createImageBitmap', vi.fn(() => {
    if (!png) return Promise.reject(new TypeError('image decode failed'));
    return Promise.resolve({ width: 1, height: 1, close: () => undefined });
  }));
}

describe('parseTeachPaperExport', () => {
  it('reads a grouped homework paper and an ungrouped contest paper', async () => {
    const homework = homeworkPaper(false);
    const answered = homeworkPaper(true);
    await expect(parsePaper(homework)).resolves.toEqual(homework);
    await expect(parsePaper(answered)).resolves.toEqual(answered);
    await expect(parsePaper(acmPaper())).resolves.toEqual(acmPaper());
  });

  it('rejects a payload that is not the paper export', async () => {
    const parseTeachPaperExport = parserOf(readField(await loadExportModel(), 'parseTeachPaperExport'));
    const homework = homeworkPaper(false);
    const invalid: unknown[] = [
      null,
      [],
      1,
      { ...homework, title: 1 },
      { ...homework, type: 'ioi' },
      { ...homework, answers: 'yes' },
      { ...homework, grouped: 'yes' },
      { ...homework, sections: null },
      { ...homework, sections: [{ ...homework.sections[0], kind: 'essay' }] },
      {
        ...homework,
        sections: [
          {
            kind: 'single',
            heading: SINGLE_HEADING,
            drawNote: null,
            items: [{ ...homework.sections[1]?.items[0], pid: '21' }],
          },
        ],
      },
      {
        ...homework,
        sections: [
          {
            kind: 'single',
            heading: SINGLE_HEADING,
            drawNote: null,
            items: [{ ...homework.sections[1]?.items[0], options: 'A' }],
          },
        ],
      },
      {
        ...homework,
        sections: [
          {
            kind: 'single',
            heading: SINGLE_HEADING,
            drawNote: null,
            items: [{ ...homework.sections[1]?.items[0], score: '5' }],
          },
        ],
      },
      {
        ...homework,
        sections: [
          {
            kind: 'single',
            heading: SINGLE_HEADING,
            drawNote: null,
            items: [{ ...homework.sections[1]?.items[0], answer: 1 }],
          },
        ],
      },
    ];
    for (const raw of invalid) {
      await expect(Promise.resolve().then(() => parseTeachPaperExport(raw))).rejects.toThrow();
    }
  });

  it('rejects a blank paper that still carries an answer', async () => {
    const paper = homeworkPaper(false);
    const section = paper.sections[0];
    const first = section?.items[0];
    if (!section || !first) throw new TypeError('fixture missing item');
    section.items = [{ ...first, answer: '对' }];
    await expect(parsePaper(paper)).rejects.toThrow();
  });

  it('rejects an ungrouped section whose kind is not null', async () => {
    const paper = acmPaper();
    const section = paper.sections[0];
    if (!section) throw new TypeError('fixture missing section');
    section.kind = 'programming';
    await expect(parsePaper(paper)).rejects.toThrow();
  });

  it('rejects a paper payload with an unknown field', async () => {
    await expect(parsePaper({ ...homeworkPaper(false), note: 'extra' })).rejects.toThrow();
  });
});

describe('paperDocxBlocks', () => {
  beforeEach(() => {
    installImageFetch(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a blank paper with the name line and no answers', async () => {
    const blocks = await renderBlocks(homeworkPaper(false));
    expect(blocks.some((block) => block.kind === 'title' && block.text === TITLE)).toBe(true);
    expect(blocks.some((block) => block.kind === 'paragraph' && blockText(block) === IDENTITY_LINE)).toBe(true);
    expect(blocks.map(blockText).join('\n')).not.toContain('答案\uFF1A');
    expect(blocks.map(blockText).join('\n')).not.toContain(NO_ANSWER);
    for (const heading of [TRUE_FALSE_HEADING, SINGLE_HEADING, MULTI_HEADING, BLANK_HEADING, PROGRAM_HEADING, SUBJECTIVE_HEADING]) {
      expect(blocks.some((block) => block.kind === 'heading' && block.text.includes(heading))).toBe(true);
    }
    expect(blocks.map(blockText).join('\n')).toContain(DRAW_NOTE);
    expectScoredLabel(blocks, '1-1', 2);
    expectScoredLabel(blocks, '2-1', 5);
    expectScoredLabel(blocks, '3-1', 4);
    expectScoredLabel(blocks, '4-1', 3);
    expectScoredLabel(blocks, '7-1', 10);
    expectScoredLabel(blocks, '8-1', 8);
    expect(between(blocks, scoredLabel('1-1', 2), scoredLabel('2-1', 5)).map(blockText).join('\n')).toContain(JUDGE_BLANK);
    expect(between(blocks, scoredLabel('2-1', 5), scoredLabel('3-1', 4)).map(blockText).join('\n')).toContain('A. 栈');
    expect(between(blocks, scoredLabel('2-1', 5), scoredLabel('3-1', 4)).map(blockText).join('\n')).toContain('B. 队列');
    expect(between(blocks, scoredLabel('2-1', 5), scoredLabel('3-1', 4)).map(blockText).join('\n')).toContain('C. 数组');
    expect(between(blocks, scoredLabel('3-1', 4), scoredLabel('4-1', 3)).map(blockText).join('\n')).toContain('A. 压栈');
    expect(blankLineCount(between(blocks, scoredLabel('4-1', 3), scoredLabel('7-1', 10)))).toBe(3);
    expect(between(blocks, scoredLabel('7-1', 10), scoredLabel('8-1', 8)).some((block) => block.kind === 'blankLines')).toBe(false);
    expect(between(blocks, scoredLabel('7-1', 10), scoredLabel('8-1', 8)).some((block) => block.kind === 'code' && block.text.includes('int a;'))).toBe(true);
    expect(between(blocks, scoredLabel('7-1', 10), scoredLabel('8-1', 8)).map(blockText).join('\n')).toContain('实现一个栈。');
    expect(blankLineCount(between(blocks, scoredLabel('8-1', 8), null))).toBe(3);
  });

  it('puts choice answers and a no-answer mark on the answer paper', async () => {
    const blocks = await renderBlocks(homeworkPaper(true));
    expect(blocks.some((block) => block.kind === 'paragraph' && blockText(block) === IDENTITY_LINE)).toBe(false);
    expectScoredLabel(blocks, '1-1', 2);
    expectScoredLabel(blocks, '2-1', 5);
    expectScoredLabel(blocks, '3-1', 4);
    expectScoredLabel(blocks, '4-1', 3);
    expectScoredLabel(blocks, '7-1', 10);
    expectScoredLabel(blocks, '8-1', 8);
    expect(position(blocks, scoredLabel('2-1', 5))).toBeGreaterThanOrEqual(0);
    expect(position(blocks, ANSWER_B)).toBeGreaterThan(position(blocks, scoredLabel('2-1', 5)));
    expect(position(blocks, ANSWER_B)).toBeLessThan(position(blocks, scoredLabel('3-1', 4)));
    expect(position(blocks, ANSWER_MULTI)).toBeGreaterThan(position(blocks, scoredLabel('3-1', 4)));
    expect(position(blocks, ANSWER_MULTI)).toBeLessThan(position(blocks, scoredLabel('4-1', 3)));
    expect(position(blocks, ANSWER_TRUE)).toBeGreaterThan(position(blocks, scoredLabel('1-1', 2)));
    expect(position(blocks, ANSWER_TRUE)).toBeLessThan(position(blocks, scoredLabel('2-1', 5)));
    expect(position(blocks, ANSWER_BLANK)).toBeGreaterThan(position(blocks, scoredLabel('4-1', 3)));
    expect(position(blocks, ANSWER_BLANK)).toBeLessThan(position(blocks, scoredLabel('7-1', 10)));
    expect(position(blocks, NO_ANSWER)).toBeGreaterThan(position(blocks, scoredLabel('7-1', 10)));
    expect(position(blocks, NO_ANSWER)).toBeLessThan(position(blocks, scoredLabel('8-1', 8)));
    const afterSubjective = between(blocks, scoredLabel('8-1', 8), null).map(blockText).join('\n');
    expect(afterSubjective).toContain(NO_ANSWER);
    expect(blankLineCount(between(blocks, scoredLabel('4-1', 3), scoredLabel('7-1', 10)))).toBe(3);
  });

  // Word export passes an empty map, so a hit must come from fetch and createImageBitmap.
  it('embeds a fetched png and writes alt text when the image cannot be read', async () => {
    installImageFetch(PNG);
    const embedded = await renderBlocks(imagePaper(), new Map());
    const image = embedded.find((block) => block.kind === 'image');
    expect(mockCalls(globalThis.fetch).map((call) => requestUrl(call[0]).href)).toContain(IMAGE_URL);
    expect(mockCalls(globalThis.createImageBitmap).length).toBeGreaterThan(0);
    expect(image && image.kind === 'image' && image.contentType === 'image/png' && image.widthPx === 1 && image.heightPx === 1 && sameBytes(image.data, PNG)).toBe(true);
    expect(embedded.map(blockText).join('\n')).toContain('看图作答。');

    installImageFetch(null);
    const failed = await renderBlocks(imagePaper(), new Map());
    expect(failed.some((block) => block.kind === 'image')).toBe(false);
    expect(failed.map(blockText).join('\n')).toContain(IMAGE_ALT);
    expect(failed.map(blockText).join('\n')).toContain('看图作答。');
  });

  it('keeps the latex source of a display formula', async () => {
    const blocks = await renderBlocks(singleItemPaper('programming', null, '已知。\n\n$$\na+b\n$$'));
    expect(blocks.map(blockText).join('\n')).toContain('$$a+b$$');
  });

  it('labels a contest item without a score as the letter only', async () => {
    const texts = (await renderBlocks(acmPaper())).map(blockText);
    expect(texts).toContain('A');
    expect(texts).toContain('B');
    expect(texts.join('\n')).not.toContain('分');
  });

  it('marks code and subjective items as having no standard answer', async () => {
    for (const kind of NO_STANDARD_KINDS) {
      const text = (await renderBlocks(singleItemPaper(kind, '参考代码', '题面。'))).map(blockText).join('\n');
      expect(text, kind).toContain(NO_ANSWER);
      expect(text, kind).not.toContain('答案\uFF1A');
    }
  });
});
