import { buildZipBlob } from './download-zip';

/** A cell value. `null` omits the cell. The first row of a sheet is the header. */
export type XlsxCell = string | number | null;

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  columnWidths?: number[];
}

const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Excel forbids []:*?/\ . The acceptance name also uses a fullwidth colon.
const SHEET_FORBIDDEN = /[[\]:*?/\\\uFF1A]/g;
const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/;
// cellXfs[1] is the only bold style. Header cells reference it with s="1".
const HEADER_STYLE = 1;

const STYLES_XML = `${XML_HEAD}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function hasIllegalXmlChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) return true;
  }
  return false;
}

function escapeXml(text: string): string {
  if (hasIllegalXmlChar(text)) throw new Error('xlsx text contains a character XML cannot store');
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetters(column: number): string {
  let n = column;
  let letters = '';
  while (n > 0) {
    n -= 1;
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  }
  return letters;
}

/** Sheet name: drop []:*?/\\ and the fullwidth colon, cut to 31 characters, and suffix " (2)", " (3)", … on collision. An empty name becomes Sheet<n>. */
export function xlsxSheetName(raw: string, taken: ReadonlySet<string>): string {
  const cleaned = raw.replace(SHEET_FORBIDDEN, '');
  if (cleaned.length === 0) {
    for (let n = 1; ; n += 1) {
      const name = `Sheet${n}`;
      if (name.length > 31) throw new Error('xlsx sheet name cannot be made unique');
      if (!taken.has(name)) return name;
    }
  }
  const initial = cleaned.slice(0, 31);
  if (!taken.has(initial)) return initial;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    if (suffix.length >= 31) throw new Error('xlsx sheet name cannot be made unique');
    const candidate = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Grade text to a cell: integer or decimal text becomes a number; an em dash or empty string becomes null; anything else stays text. */
export function gradeCellValue(text: string): XlsxCell {
  if (text === '' || text === '\u2014') return null;
  if (!NUMBER_TEXT.test(text)) return text;
  const value = Number(text);
  return Object.is(value, -0) ? 0 : value;
}

function columnXml(widths: number[] | undefined): string {
  if (!widths || widths.length === 0) return '';
  const cols = widths.map((width, index) => {
    if (!Number.isFinite(width) || width < 0) throw new Error('xlsx column width must be a non-negative finite number');
    const column = index + 1;
    return `<col min="${column}" max="${column}" width="${String(width)}" customWidth="1"/>`;
  }).join('');
  return `<cols>${cols}</cols>`;
}

function cellXml(value: XlsxCell, column: number, row: number, header: boolean): string | null {
  if (value === null) return null;
  const ref = `${columnLetters(column)}${row}`;
  const style = header ? ` s="${HEADER_STYLE}"` : '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`xlsx cell ${ref} is not a finite number`);
    const literal = Object.is(value, -0) ? '0' : String(value);
    return `<c r="${ref}"${style}><v>${literal}</v></c>`;
  }
  if (typeof value !== 'string') throw new Error(`xlsx cell ${ref} must be a string, number, or null`);
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows.map((row, index) => {
    const rowNumber = index + 1;
    const cells = row.map((value, column) => cellXml(value, column + 1, rowNumber, index === 0)).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${columnXml(sheet.columnWidths)}<sheetData>${rows}</sheetData></worksheet>`;
}

function contentTypes(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

function workbookXml(sheets: XlsxSheet[]): string {
  const items = sheets.map((sheet, index) => (
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join('');
  return `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${items}</sheets></workbook>`;
}

function workbookRels(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join('');
  const stylesId = sheetCount + 1;
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Blob> {
  return buildZipBlob([
    { name: '[Content_Types].xml', content: contentTypes(sheets.length) },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'xl/workbook.xml', content: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels(sheets.length) },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet),
    })),
  ], SHEET_MIME);
}
