export interface ZipDownloadTarget {
  name: string;
  content?: string | Blob | ArrayBuffer | Uint8Array;
  url?: string;
}

interface ResolvedZipEntry {
  name: string;
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDos(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function normalizeZipPath(name: string) {
  const normalized = name
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  if (!normalized) throw new Error('Invalid zip entry name');
  return normalized;
}

function assertZip32Size(size: number, name: string) {
  if (size > 0xffffffff) throw new Error(`File is too large for ZIP32: ${name}`);
}

async function toBytes(target: ZipDownloadTarget) {
  if (target.url) {
    const res = await fetch(target.url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`${target.name}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const content = target.content ?? '';
  if (typeof content === 'string') return encoder.encode(content);
  if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function writeLocalHeader(entry: ResolvedZipEntry) {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, entry.dosTime, true);
  view.setUint16(12, entry.dosDate, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(entry.nameBytes, 30);
  return header;
}

function writeCentralHeader(entry: ResolvedZipEntry) {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.offset, true);
  header.set(entry.nameBytes, 46);
  return header;
}

function writeEndOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadZip(filename: string, targets: ZipDownloadTarget[]) {
  const parts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  const entries: ResolvedZipEntry[] = [];
  const timestamp = dateToDos();
  let offset = 0;

  for (const target of targets) {
    const name = normalizeZipPath(target.name);
    const data = await toBytes({ ...target, name });
    assertZip32Size(data.length, name);
    assertZip32Size(offset, name);
    const entry: ResolvedZipEntry = {
      name,
      nameBytes: encoder.encode(name),
      data,
      crc: crc32(data),
      offset,
      dosTime: timestamp.dosTime,
      dosDate: timestamp.dosDate,
    };
    const localHeader = writeLocalHeader(entry);
    parts.push(localHeader, data);
    offset += localHeader.length + data.length;
    entries.push(entry);
  }

  const centralOffset = offset;
  for (const entry of entries) {
    const centralHeader = writeCentralHeader(entry);
    centralParts.push(centralHeader);
    offset += centralHeader.length;
  }
  const centralSize = offset - centralOffset;
  assertZip32Size(centralOffset, filename);
  assertZip32Size(centralSize, filename);
  parts.push(...centralParts, writeEndOfCentralDirectory(entries.length, centralSize, centralOffset));

  downloadBlob(filename, new Blob(parts, { type: 'application/zip' }));
}
