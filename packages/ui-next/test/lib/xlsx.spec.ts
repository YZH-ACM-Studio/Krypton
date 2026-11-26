// @vitest-environment node
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildZipBlob } from '../../src/lib/download-zip';
import { buildXlsx, gradeCellValue, xlsxSheetName } from '../../src/lib/xlsx';

const decoder = new TextDecoder();

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
] as const;

function findEocd(bytes: Uint8Array, view: DataView) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIG) return offset;
  }
  throw new Error('zip end of central directory not found');
}

function textOf(method: number, data: Uint8Array) {
  if (method === 0) return decoder.decode(data);
  if (method === 8) return decoder.decode(inflateRawSync(data));
  throw new Error(`unsupported zip method ${method}`);
}

function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocd(bytes, view);
  const totalEntryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map<string, string>();
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
    entries.set(name, textOf(method, data));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readBlob(blob: Blob) {
  expect(blob).to.be.instanceOf(Blob);
  return readZip(new Uint8Array(await blob.arrayBuffer()));
}

type XlsxSheets = Parameters<typeof buildXlsx>[0];

async function openXlsx(sheets: XlsxSheets) {
  const blob = await buildXlsx(sheets);
  expect(blob.type).to.equal(XLSX_MIME);
  return readBlob(blob);
}

function localNames(xml: string) {
  return xml.replace(/<(\/?)[\w.-]+:/g, '<$1');
}

function blocks(xml: string, tag: string) {
  const source = localNames(xml);
  return source.match(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g')) ?? [];
}

function part(entries: Map<string, string>, name: string) {
  const text = entries.get(name);
  expect(text).to.be.a('string');
  return text ?? '';
}

function worksheetNames(entries: Map<string, string>) {
  return [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/sheet(\d+)\.xml$/)?.[1] ?? 0);
      const rightNumber = Number(right.match(/sheet(\d+)\.xml$/)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });
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

function rawTextNodes(xml: string) {
  return [...localNames(xml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]);
}

function inlineString(cell: string) {
  if (!/\bt="inlineStr"/.test(cell)) return null;
  const match = cell.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
  return match ? unescapeXml(match[1]) : null;
}

function numericValue(cell: string) {
  const type = cell.match(/\bt="([^"]*)"/);
  if (type && type[1] !== 'n') return null;
  const match = cell.match(/<v>([\s\S]*?)<\/v>/);
  if (!match) return null;
  const literal = match[1].trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(literal)) return null;
  return Number(literal);
}

function boldFontIndexes(styles: string) {
  const fonts = localNames(styles).match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/);
  expect(fonts).to.not.equal(null);
  const indexes: number[] = [];
  for (const [index, font] of blocks(fonts?.[1] ?? '', 'font').entries()) {
    const tag = font.match(/<b\b([^>]*)>/);
    if (!tag) continue;
    if (/\bval="(?:0|false)"/.test(tag[1])) continue;
    indexes.push(index);
  }
  return indexes;
}

function styleIndexesForFont(styles: string, fontIndex: number) {
  const cellXfs = localNames(styles).match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  expect(cellXfs).to.not.equal(null);
  const indexes: number[] = [];
  for (const [index, xf] of blocks(cellXfs?.[1] ?? '', 'xf').entries()) {
    const fontId = xf.match(/\bfontId="(\d+)"/);
    if (fontId && Number(fontId[1]) === fontIndex) indexes.push(index);
  }
  return indexes;
}

function cellStyleIndex(cell: string) {
  const match = cell.match(/\bs="(\d+)"/);
  return match ? Number(match[1]) : 0;
}

function attr(xml: string, attribute: string) {
  const match = xml.match(new RegExp(`\\b${attribute}="([^"]*)"`));
  return match ? unescapeXml(match[1]) : '';
}

describe('buildZipBlob', () => {
  it('stores entry text in a zip blob and honors an explicit mime type', async () => {
    const blob = await buildZipBlob([{ name: 'note.txt', content: 'hello' }]);
    expect(blob.type).to.equal('application/zip');
    expect((await readBlob(blob)).get('note.txt')).to.equal('hello');

    const typed = await buildZipBlob([{ name: 'note.txt', content: 'hello' }], XLSX_MIME);
    expect(typed.type).to.equal(XLSX_MIME);
  });
});

describe('buildXlsx', () => {
  it('writes the required parts, inline strings, a numeric cell, and no cell for null', async () => {
    const entries = await openXlsx([{
      name: '成绩',
      rows: [['学号', '总分'], ['2401', 95], ['2402', null]],
    }]);

    for (const name of REQUIRED_PARTS) {
      expect(part(entries, name).length).to.be.greaterThan(0);
    }
    const sheets = worksheetNames(entries);
    expect(sheets.length).to.be.at.least(1);
    expect(REQUIRED_PARTS.length + sheets.length).to.be.greaterThan(5);
    expect(part(entries, 'xl/workbook.xml')).to.include('name="成绩"');

    const sheet = part(entries, sheets[0] ?? '');
    const rows = blocks(sheet, 'row');
    expect(rows).to.have.length(3);
    const headerCells = blocks(rows[0] ?? '', 'c');
    const scoreCells = blocks(rows[1] ?? '', 'c');
    const missingCells = blocks(rows[2] ?? '', 'c');
    expect(headerCells.map((cell) => inlineString(cell))).to.deep.equal(['学号', '总分']);
    expect(scoreCells).to.have.length(2);
    expect(inlineString(scoreCells[0] ?? '')).to.equal('2401');
    expect(numericValue(scoreCells[1] ?? '')).to.equal(95);
    expect(scoreCells[1] ?? '').to.include('<v>');
    expect(missingCells).to.have.length(1);
    expect(inlineString(missingCells[0] ?? '')).to.equal('2402');
    expect(rows.flatMap((row) => blocks(row, 'c'))).to.have.length(5);

    const styles = part(entries, 'xl/styles.xml');
    const boldFonts = boldFontIndexes(styles);
    expect(boldFonts).to.have.length(1);
    const boldStyles = styleIndexesForFont(styles, boldFonts[0] ?? -1);
    expect(boldStyles.length).to.be.greaterThan(0);
    for (const cell of headerCells) {
      expect(boldStyles).to.include(cellStyleIndex(cell));
    }
    for (const cell of [...scoreCells, ...missingCells]) {
      expect(boldStyles).to.not.include(cellStyleIndex(cell));
    }
  });

  it('escapes ampersand, less-than, greater-than, quote, and apostrophe in inline strings', async () => {
    const tricky = 'Tom & Jerry <3> "ok" it\'s';
    const entries = await openXlsx([{ name: '成绩', rows: [[tricky]] }]);
    const sheet = part(entries, worksheetNames(entries)[0] ?? '');
    const raw = rawTextNodes(sheet).find((node) => unescapeXml(node) === tricky);
    expect(raw).to.be.a('string');
    const text = raw ?? '';
    expect(text).to.not.include('<');
    expect(text).to.not.match(/&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/);
    expect(text).to.match(/&amp;|&#0*38;|&#x0*26;/i);
    expect(text).to.match(/&lt;|&#0*60;|&#x0*3c;/i);
    expect(text).to.match(/&gt;|&#0*62;|&#x0*3e;/i);
    expect(text).to.match(/&quot;|&#0*34;|&#x0*22;/i);
    expect(text).to.match(/&apos;|&#0*39;|&#x0*27;/i);
  });

  it('writes column widths into a cols element', async () => {
    const entries = await openXlsx([{
      name: '成绩',
      columnWidths: [18, 9.5],
      rows: [['学号', '总分']],
    }]);
    const sheet = part(entries, worksheetNames(entries)[0] ?? '');
    const cols = localNames(sheet).match(/<cols\b[^>]*>[\s\S]*?<\/cols>/);
    expect(cols?.[0]).to.be.a('string');
    const colsXml = cols?.[0] ?? '';
    expect(/width="(?:18|18\.0+)"/.test(colsXml)).to.equal(true);
    expect(/width="9\.50*"/.test(colsXml)).to.equal(true);
  });

  it('applies each column width to the 1-based column in array order', async () => {
    const entries = await openXlsx([{
      name: '成绩',
      columnWidths: [18, 9.5],
      rows: [['学号', '总分']],
    }]);
    const cols = blocks(part(entries, worksheetNames(entries)[0] ?? ''), 'col').map((col) => ({
      min: attr(col, 'min'),
      max: attr(col, 'max'),
      width: attr(col, 'width'),
    }));
    expect(cols).to.deep.equal([
      { min: '1', max: '1', width: '18' },
      { min: '2', max: '2', width: '9.5' },
    ]);
  });

  it('writes one worksheet part per sheet in the given order', async () => {
    const entries = await openXlsx([
      { name: '总表', rows: [['姓名'], ['张三']] },
      { name: '作业', rows: [['姓名'], ['李四']] },
    ]);
    expect(worksheetNames(entries)).to.have.length(2);
    const workbook = part(entries, 'xl/workbook.xml');
    const totalAt = workbook.indexOf('name="总表"');
    const homeworkAt = workbook.indexOf('name="作业"');
    expect(totalAt).to.be.at.least(0);
    expect(homeworkAt).to.be.greaterThan(totalAt);
    const sheets = worksheetNames(entries).map((name) => part(entries, name));
    expect(sheets.some((xml) => rawTextNodes(xml).some((node) => unescapeXml(node) === '张三'))).to.equal(true);
    expect(sheets.some((xml) => rawTextNodes(xml).some((node) => unescapeXml(node) === '李四'))).to.equal(true);
  });

  it('escapes xml metacharacters in the workbook sheet name', async () => {
    const name = 'A & B <C> "D" \'E\'';
    const entries = await openXlsx([{ name, rows: [['x']] }]);
    const raw = part(entries, 'xl/workbook.xml').match(/<sheet\b[^>]* name="([^"]*)"/)?.[1] ?? '';
    expect(unescapeXml(raw)).to.equal(name);
    expect(raw).to.not.include('<');
    expect(raw).to.match(/&amp;|&#0*38;|&#x0*26;/i);
    expect(raw).to.match(/&lt;|&#0*60;|&#x0*3c;/i);
    expect(raw).to.match(/&gt;|&#0*62;|&#x0*3e;/i);
    expect(raw).to.match(/&quot;|&#0*34;|&#x0*22;/i);
    expect(raw).to.match(/&apos;|&#0*39;|&#x0*27;/i);
  });

  it('wires each workbook sheet to its own worksheet and keeps styles on a distinct relationship', async () => {
    const entries = await openXlsx([
      { name: '总表', rows: [['姓名'], ['张三']] },
      { name: '作业', rows: [['姓名'], ['李四']] },
    ]);
    const sheetNodes = blocks(part(entries, 'xl/workbook.xml'), 'sheet');
    const relNodes = blocks(part(entries, 'xl/_rels/workbook.xml.rels'), 'Relationship');
    expect(sheetNodes).to.have.length(2);
    expect(new Set(relNodes.map((node) => attr(node, 'Id'))).size).to.equal(relNodes.length);
    const byId = new Map(relNodes.map((node) => [attr(node, 'Id'), node]));
    const expected = [
      { name: '总表', text: '张三' },
      { name: '作业', text: '李四' },
    ];
    expected.forEach((item, index) => {
      const node = sheetNodes[index] ?? '';
      expect(attr(node, 'name')).to.equal(item.name);
      const rel = byId.get(attr(node, 'r:id')) ?? '';
      expect(attr(rel, 'Target')).to.equal(`worksheets/sheet${index + 1}.xml`);
      const xml = part(entries, `xl/${attr(rel, 'Target')}`);
      expect(rawTextNodes(xml).some((text) => unescapeXml(text) === item.text)).to.equal(true);
    });
    const styles = relNodes.filter((node) => attr(node, 'Target') === 'styles.xml');
    expect(styles).to.have.length(1);
    expect(sheetNodes.map((node) => attr(node, 'r:id'))).to.not.include(attr(styles[0] ?? '', 'Id'));
  });
});

describe('xlsxSheetName', () => {
  it('drops the forbidden characters in the acceptance example, including the fullwidth colon', () => {
    expect(xlsxSheetName('第一章\uFF1A循环/数组[期中]', new Set())).to.equal('第一章循环数组期中');
  });

  it('drops ascii [ ] : * ? / and backslash', () => {
    expect(xlsxSheetName('a[b]c:d*e?f/g\\h', new Set())).to.equal('abcdefgh');
  });

  it('truncates a name to 31 characters', () => {
    expect(xlsxSheetName('题'.repeat(32), new Set())).to.equal('题'.repeat(31));
  });

  it('appends a space and (2), then (3), when the name is already taken', () => {
    expect(xlsxSheetName('成绩', new Set(['成绩']))).to.equal('成绩 (2)');
    expect(xlsxSheetName('成绩', new Set(['成绩', '成绩 (2)']))).to.equal('成绩 (3)');
  });

  it('keeps a suffixed name within 31 characters', () => {
    // Excel refuses a sheet name longer than 31 characters, so the suffix uses that budget.
    const base = '题'.repeat(31);
    const withTwo = `${'题'.repeat(27)} (2)`;
    expect(xlsxSheetName('题'.repeat(40), new Set([base]))).to.equal(withTwo);
    expect(xlsxSheetName('题'.repeat(40), new Set([base, withTwo]))).to.equal(`${'题'.repeat(27)} (3)`);
  });

  it('uses sheet plus a number when the name is empty or only forbidden characters', () => {
    expect(xlsxSheetName('', new Set())).to.equal('Sheet1');
    expect(xlsxSheetName('', new Set(['Sheet1']))).to.equal('Sheet2');
    expect(xlsxSheetName('[]:*?/\\', new Set())).to.equal('Sheet1');
  });
});

describe('gradeCellValue', () => {
  it('turns integer and decimal text into numbers and keeps other text', () => {
    expect(gradeCellValue('95')).to.equal(95);
    expect(gradeCellValue('87.5')).to.equal(87.5);
    expect(gradeCellValue('-12')).to.equal(-12);
    expect(gradeCellValue('-3.5')).to.equal(-3.5);
    expect(gradeCellValue('\u2014')).to.equal(null);
    expect(gradeCellValue('')).to.equal(null);
    expect(gradeCellValue('未提交')).to.equal('未提交');
    expect(gradeCellValue('95分')).to.equal('95分');
    expect(gradeCellValue('87.5.1')).to.equal('87.5.1');
  });
});
