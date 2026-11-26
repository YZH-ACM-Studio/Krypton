import { buildZipBlob } from './download-zip';
import type { MdInline } from './markdown-blocks';

export type DocxBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; inlines: MdInline[] }
  | { kind: 'code'; text: string }
  | {
    kind: 'image';
    data: Uint8Array;
    contentType: 'image/png' | 'image/jpeg' | 'image/gif';
    widthPx: number;
    heightPx: number;
  }
  | { kind: 'blankLines'; count: number };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Word sz is half-points: title 二号 (22pt), heading 四号 (14pt), body 五号 (10.5pt).
const TITLE_HALF_POINTS = 44;
const HEADING_HALF_POINTS = 28;
const BODY_HALF_POINTS = 21;
const MONOSPACE_FONT = 'Courier New';
// 1px at 96 DPI is 914400/96 EMU. Pictures wider than 15cm scale down to that width.
const EMU_PER_PX = 914400 / 96;
const MAX_WIDTH_EMU = 15 * 360000;

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

// A4 with 3cm side margins, so the 15cm picture cap matches the text width.
const SECT_PR = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1701" w:bottom="1440" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

const STYLES_XML = `${XML_HEAD}
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Times New Roman"/>
        <w:sz w:val="${BODY_HALF_POINTS}"/>
        <w:szCs w:val="${BODY_HALF_POINTS}"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;

interface PackedImage {
  fileName: string;
  relId: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif';
  bytes: Uint8Array;
  cx: number;
  cy: number;
}

function hasIllegalXmlChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) return true;
  }
  return false;
}

function escapeXml(text: string): string {
  if (hasIllegalXmlChar(text)) throw new Error('docx text contains a character XML cannot store');
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function pictureExtent(widthPx: number, heightPx: number): { cx: number; cy: number } {
  const rawCx = widthPx * EMU_PER_PX;
  const rawCy = heightPx * EMU_PER_PX;
  if (rawCx <= MAX_WIDTH_EMU) return { cx: rawCx, cy: rawCy };
  return { cx: MAX_WIDTH_EMU, cy: Math.round((rawCy * MAX_WIDTH_EMU) / rawCx) };
}

function emuAttr(value: number): string {
  if (!Number.isFinite(value)) throw new Error('docx image extent is not finite');
  return String(value);
}

function imageExtension(contentType: PackedImage['contentType']): 'png' | 'gif' | 'jpg' {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/jpeg':
      return 'jpg';
    default: {
      const unexpected: never = contentType;
      throw new Error(`docx image content type is not png, jpeg, or gif: ${String(unexpected)}`);
    }
  }
}

function runProperties(options: { bold?: boolean; italic?: boolean; code?: boolean; size?: number }): string {
  const parts: string[] = [];
  // CT_RPr requires rFonts before b, i, sz, and szCs.
  if (options.code) {
    parts.push(`<w:rFonts w:ascii="${MONOSPACE_FONT}" w:hAnsi="${MONOSPACE_FONT}" w:cs="${MONOSPACE_FONT}" w:eastAsia="${MONOSPACE_FONT}"/>`);
  }
  if (options.bold) parts.push('<w:b/>');
  if (options.italic) parts.push('<w:i/>');
  if (options.size !== undefined) {
    parts.push(`<w:sz w:val="${options.size}"/>`, `<w:szCs w:val="${options.size}"/>`);
  }
  if (parts.length === 0) return '';
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

function runs(text: string, props: string): string {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  return lines.map((line, lineIndex) => {
    const breakXml = lineIndex === 0 ? '' : '<w:br/>';
    return `<w:r>${props}${breakXml}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
  }).join('');
}

function paragraph(inner: string, center: boolean): string {
  const pPr = center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
  return `<w:p>${pPr}${inner}</w:p>`;
}

function textParagraph(text: string, props: string, center = false): string {
  return paragraph(text.length === 0 ? '' : runs(text, props), center);
}

function inlinesParagraph(inlines: readonly MdInline[]): string {
  const inner = inlines.map((inline) => runs(inline.text, runProperties({
    bold: inline.bold === true,
    italic: inline.italic === true,
    code: inline.code === true,
  }))).join('');
  return paragraph(inner, false);
}

function codeParagraphs(text: string): string {
  const props = runProperties({ code: true });
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  return lines.map((line) => textParagraph(line, props)).join('');
}

function blankParagraphs(count: number): string {
  if (!Number.isInteger(count) || count < 0) throw new Error('docx blankLines count must be a non-negative integer');
  return '<w:p/>'.repeat(count);
}

function drawingXml(id: number, name: string, relId: string, cx: number, cy: number): string {
  const cxAttr = emuAttr(cx);
  const cyAttr = emuAttr(cy);
  const safeName = escapeXml(name);
  return [
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">',
    `<wp:extent cx="${cxAttr}" cy="${cyAttr}"/>`,
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
    `<wp:docPr id="${id}" name="${safeName}"/>`,
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>',
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>',
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${safeName}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>`,
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/>',
    `<a:ext cx="${cxAttr}" cy="${cyAttr}"/>`,
    '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>',
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>',
  ].join('');
}

function imageParagraph(block: Extract<DocxBlock, { kind: 'image' }>, images: PackedImage[]): string {
  if (!(block.data instanceof Uint8Array)) throw new Error('docx image data must be a Uint8Array');
  if (!Number.isFinite(block.widthPx) || block.widthPx <= 0 || !Number.isFinite(block.heightPx) || block.heightPx <= 0) {
    throw new Error('docx image size must be a positive finite number of pixels');
  }
  const ext = imageExtension(block.contentType);
  const index = images.length + 1;
  const fileName = `image${index}.${ext}`;
  const relId = `rId${index + 1}`;
  const { cx, cy } = pictureExtent(block.widthPx, block.heightPx);
  images.push({
    fileName,
    relId,
    contentType: block.contentType,
    bytes: new Uint8Array(block.data),
    cx,
    cy,
  });
  return paragraph(`<w:r>${drawingXml(index, fileName, relId, cx, cy)}</w:r>`, false);
}

function renderBlock(block: DocxBlock, images: PackedImage[]): string {
  switch (block.kind) {
    case 'title':
      return textParagraph(block.text, runProperties({ bold: true, size: TITLE_HALF_POINTS }), true);
    case 'heading':
      return textParagraph(block.text, runProperties({ bold: true, size: HEADING_HALF_POINTS }));
    case 'paragraph':
      return inlinesParagraph(block.inlines);
    case 'code':
      return codeParagraphs(block.text);
    case 'image':
      return imageParagraph(block, images);
    case 'blankLines':
      return blankParagraphs(block.count);
    default: {
      const unexpected: never = block;
      throw new Error(`docx block kind is unknown: ${JSON.stringify(unexpected)}`);
    }
  }
}

function contentTypesXml(images: readonly PackedImage[]): string {
  const seen = new Set<string>();
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
  ];
  for (const image of images) {
    const ext = image.fileName.slice(image.fileName.lastIndexOf('.') + 1);
    if (seen.has(ext)) continue;
    seen.add(ext);
    defaults.push(`<Default Extension="${ext}" ContentType="${image.contentType}"/>`);
  }
  const overrides = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  ];
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}${overrides.join('')}</Types>`;
}

function documentRels(images: readonly PackedImage[]): string {
  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ];
  for (const image of images) {
    rels.push(`<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`);
  }
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
}

function documentXml(body: string): string {
  return `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${SECT_PR}</w:body></w:document>`;
}

export async function buildDocx(blocks: readonly DocxBlock[]): Promise<Blob> {
  if (!Array.isArray(blocks)) throw new Error('docx blocks must be an array');
  const images: PackedImage[] = [];
  const body = blocks.map((block) => renderBlock(block, images)).join('');
  return buildZipBlob([
    { name: '[Content_Types].xml', content: contentTypesXml(images) },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'word/document.xml', content: documentXml(body) },
    { name: 'word/_rels/document.xml.rels', content: documentRels(images) },
    { name: 'word/styles.xml', content: STYLES_XML },
    ...images.map((image) => ({
      name: `word/media/${image.fileName}`,
      content: image.bytes,
    })),
  ], DOCX_MIME);
}
