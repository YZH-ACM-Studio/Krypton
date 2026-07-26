import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, downloadZip, type ZipDownloadTarget } from '../src/lib/download-zip';

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

let capturedBlobs: Blob[];
let revokedUrls: string[];
let clickedAnchors: HTMLAnchorElement[];
let anchorConnectedAtClick: boolean[];

beforeEach(() => {
  vi.useFakeTimers();
  capturedBlobs = [];
  revokedUrls = [];
  clickedAnchors = [];
  anchorConnectedAtClick = [];
  URL.createObjectURL = (object: Blob | MediaSource) => {
    capturedBlobs.push(object as Blob);
    return `blob:test-${capturedBlobs.length}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revokedUrls.push(url);
  };
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clickedAnchors.push(this);
    anchorConnectedAtClick.push(document.body.contains(this));
  });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

interface ParsedLocalEntry {
  headerOffset: number;
  versionNeeded: number;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  name: string;
  data: Uint8Array;
}

interface ParsedCentralEntry {
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  name: string;
  localHeaderOffset: number;
}

function parseZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = bytes.length - 22;
  expect(view.getUint32(eocdOffset, true)).to.equal(EOCD_SIG);
  const eocd = {
    offset: eocdOffset,
    diskEntryCount: view.getUint16(eocdOffset + 8, true),
    totalEntryCount: view.getUint16(eocdOffset + 10, true),
    centralSize: view.getUint32(eocdOffset + 12, true),
    centralOffset: view.getUint32(eocdOffset + 16, true),
    commentLength: view.getUint16(eocdOffset + 20, true),
  };

  const locals: ParsedLocalEntry[] = [];
  let pos = 0;
  while (pos + 4 <= bytes.length && view.getUint32(pos, true) === LOCAL_SIG) {
    const compressedSize = view.getUint32(pos + 18, true);
    const nameLength = view.getUint16(pos + 26, true);
    const extraLength = view.getUint16(pos + 28, true);
    const dataStart = pos + 30 + nameLength + extraLength;
    locals.push({
      headerOffset: pos,
      versionNeeded: view.getUint16(pos + 4, true),
      flags: view.getUint16(pos + 6, true),
      method: view.getUint16(pos + 8, true),
      dosTime: view.getUint16(pos + 10, true),
      dosDate: view.getUint16(pos + 12, true),
      crc: view.getUint32(pos + 14, true),
      compressedSize,
      uncompressedSize: view.getUint32(pos + 22, true),
      name: decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLength)),
      data: bytes.slice(dataStart, dataStart + compressedSize),
    });
    pos = dataStart + compressedSize;
  }

  const centrals: ParsedCentralEntry[] = [];
  pos = eocd.centralOffset;
  while (pos + 4 <= bytes.length && view.getUint32(pos, true) === CENTRAL_SIG) {
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    centrals.push({
      versionMadeBy: view.getUint16(pos + 4, true),
      versionNeeded: view.getUint16(pos + 6, true),
      flags: view.getUint16(pos + 8, true),
      method: view.getUint16(pos + 10, true),
      dosTime: view.getUint16(pos + 12, true),
      dosDate: view.getUint16(pos + 14, true),
      crc: view.getUint32(pos + 16, true),
      compressedSize: view.getUint32(pos + 20, true),
      uncompressedSize: view.getUint32(pos + 24, true),
      name: decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)),
      localHeaderOffset: view.getUint32(pos + 42, true),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }

  return { eocd, locals, centrals };
}

async function downloadZipBytes(filename: string, targets: ZipDownloadTarget[]) {
  await downloadZip(filename, targets);
  expect(capturedBlobs).to.have.length(1);
  return new Uint8Array(await capturedBlobs[0].arrayBuffer());
}

async function expectRejection(promise: Promise<unknown>, message: string) {
  let failure: unknown;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  expect(failure).to.be.instanceOf(Error);
  expect((failure as Error).message).to.equal(message);
}

describe('downloadZip binary layout', () => {
  it('emits only the end-of-central-directory record for an empty target list', async () => {
    const bytes = await downloadZipBytes('empty.zip', []);

    expect(bytes.length).to.equal(22);
    const { eocd, locals, centrals } = parseZip(bytes);
    expect(locals).to.have.length(0);
    expect(centrals).to.have.length(0);
    expect(eocd.diskEntryCount).to.equal(0);
    expect(eocd.totalEntryCount).to.equal(0);
    expect(eocd.centralSize).to.equal(0);
    expect(eocd.centralOffset).to.equal(0);
    expect(eocd.commentLength).to.equal(0);
    expect(capturedBlobs[0].type).to.equal('application/zip');
    expect(clickedAnchors).to.have.length(1);
    expect(clickedAnchors[0].download).to.equal('empty.zip');
  });

  it('stores string content uncompressed with a published crc-32 vector', async () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const bytes = await downloadZipBytes('fox.zip', [{ name: 'fox.txt', content: text }]);

    const { eocd, locals, centrals } = parseZip(bytes);
    expect(eocd.totalEntryCount).to.equal(1);
    expect(locals).to.have.length(1);
    expect(centrals).to.have.length(1);

    const local = locals[0];
    expect(local.versionNeeded).to.equal(20);
    expect(local.flags).to.equal(0x0800);
    expect(local.method).to.equal(0);
    expect(local.crc).to.equal(0x414fa339);
    expect(local.compressedSize).to.equal(43);
    expect(local.uncompressedSize).to.equal(43);
    expect(local.name).to.equal('fox.txt');
    expect(decoder.decode(local.data)).to.equal(text);

    const central = centrals[0];
    expect(central.versionMadeBy).to.equal(20);
    expect(central.versionNeeded).to.equal(20);
    expect(central.flags).to.equal(0x0800);
    expect(central.method).to.equal(0);
    expect(central.crc).to.equal(0x414fa339);
    expect(central.compressedSize).to.equal(43);
    expect(central.uncompressedSize).to.equal(43);
    expect(central.name).to.equal('fox.txt');
    expect(central.localHeaderOffset).to.equal(0);
  });

  it('lays out local headers, central directory and eocd math consistently for multiple entries', async () => {
    const secondData = new Uint8Array([0, 1, 2, 3, 255]);
    const bytes = await downloadZipBytes('multi.zip', [
      { name: 'a.txt', content: 'abc' },
      { name: 'dir/b.bin', content: secondData },
    ]);

    const { eocd, locals, centrals } = parseZip(bytes);
    expect(eocd.diskEntryCount).to.equal(2);
    expect(eocd.totalEntryCount).to.equal(2);

    // entry 1 local segment: 30 header + 5 name + 3 data = 38
    // entry 2 local segment: 30 header + 9 name + 5 data = 44
    expect(locals.map((entry) => entry.headerOffset)).to.deep.equal([0, 38]);
    expect(centrals.map((entry) => entry.localHeaderOffset)).to.deep.equal([0, 38]);
    expect(eocd.centralOffset).to.equal(82);
    // central headers: (46 + 5) + (46 + 9) = 106
    expect(eocd.centralSize).to.equal(106);
    expect(bytes.length).to.equal(82 + 106 + 22);

    expect(locals.map((entry) => entry.name)).to.deep.equal(['a.txt', 'dir/b.bin']);
    expect(centrals.map((entry) => entry.name)).to.deep.equal(['a.txt', 'dir/b.bin']);
    expect(locals[1].data).to.deep.equal(secondData);
    for (let i = 0; i < 2; i++) {
      expect(centrals[i].crc).to.equal(locals[i].crc);
      expect(centrals[i].compressedSize).to.equal(locals[i].compressedSize);
      expect(centrals[i].uncompressedSize).to.equal(locals[i].uncompressedSize);
    }
  });

  it('encodes utf-8 entry names by byte length and flags them as utf-8', async () => {
    const name = '题目/数据.txt'; // 17 bytes in utf-8, 8 code points
    const bytes = await downloadZipBytes('cjk.zip', [{ name, content: 'x' }]);

    const { eocd, locals, centrals } = parseZip(bytes);
    expect(locals[0].name).to.equal(name);
    expect(centrals[0].name).to.equal(name);
    expect(locals[0].flags).to.equal(0x0800);
    // local segment = 30 + 17 name bytes + 1 data byte
    expect(eocd.centralOffset).to.equal(48);
    // central header = 46 + 17 name bytes
    expect(eocd.centralSize).to.equal(63);
  });

  it('stamps entries with the dos-encoded current date and time', async () => {
    vi.setSystemTime(new Date(2026, 6, 26, 12, 34, 57));
    const bytes = await downloadZipBytes('dated.zip', [{ name: 'a.txt', content: 'abc' }]);

    const { locals, centrals } = parseZip(bytes);
    // 12h,34m,57s -> (12 << 11) | (34 << 5) | 28
    expect(locals[0].dosTime).to.equal(25692);
    // 2026-07-26 -> ((2026 - 1980) << 9) | (7 << 5) | 26
    expect(locals[0].dosDate).to.equal(23802);
    expect(centrals[0].dosTime).to.equal(25692);
    expect(centrals[0].dosDate).to.equal(23802);
  });

  it('clamps pre-dos-epoch dates to year 1980', async () => {
    vi.setSystemTime(new Date(1975, 3, 5, 1, 2, 4));
    const bytes = await downloadZipBytes('old.zip', [{ name: 'a.txt', content: 'abc' }]);

    const { locals } = parseZip(bytes);
    // year clamps to 1980 (high 7 bits zero); month and day pass through
    expect(locals[0].dosDate).to.equal((4 << 5) | 5);
    expect(locals[0].dosTime).to.equal((1 << 11) | (2 << 5) | 2);
  });
});

describe('downloadZip content sources', () => {
  it('produces identical entries for string, blob, arraybuffer and uint8array content', async () => {
    const raw = encoder.encode('abc');
    const bytes = await downloadZipBytes('forms.zip', [
      { name: 'as-string.txt', content: 'abc' },
      { name: 'as-blob.txt', content: new Blob(['abc']) },
      { name: 'as-arraybuffer.txt', content: raw.slice().buffer },
      { name: 'as-uint8array.txt', content: raw.slice() },
    ]);

    const { locals } = parseZip(bytes);
    expect(locals).to.have.length(4);
    for (const entry of locals) {
      expect(entry.data).to.deep.equal(raw);
      expect(entry.crc).to.equal(0x352441c2);
      expect(entry.compressedSize).to.equal(3);
    }
  });

  it('treats missing content as an empty file', async () => {
    const bytes = await downloadZipBytes('hollow.zip', [{ name: 'empty.txt' }]);

    const { locals } = parseZip(bytes);
    expect(locals).to.have.length(1);
    expect(locals[0].compressedSize).to.equal(0);
    expect(locals[0].uncompressedSize).to.equal(0);
    expect(locals[0].crc).to.equal(0);
    expect(locals[0].data).to.deep.equal(new Uint8Array(0));
  });

  it('fetches url targets with same-origin credentials and prefers the url over inline content', async () => {
    const fetchCalls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return new Response(new Uint8Array([9, 8, 7]));
    };

    const bytes = await downloadZipBytes('remote.zip', [
      { name: 'remote.bin', url: '/assets/remote.bin', content: 'inline is ignored' },
    ]);

    expect(fetchCalls).to.have.length(1);
    expect(fetchCalls[0].input).to.equal('/assets/remote.bin');
    expect(fetchCalls[0].init?.credentials).to.equal('same-origin');
    const { locals } = parseZip(bytes);
    expect(locals[0].data).to.deep.equal(new Uint8Array([9, 8, 7]));
  });

  it('rejects with the normalized entry name and status when a url target fails', async () => {
    globalThis.fetch = async () => new Response('nope', { status: 404 });

    await expectRejection(
      downloadZip('broken.zip', [{ name: '/dir//remote.bin', url: '/assets/remote.bin' }]),
      'dir/remote.bin: HTTP 404',
    );
    expect(capturedBlobs).to.have.length(0);
    expect(clickedAnchors).to.have.length(0);
  });
});

describe('downloadZip entry name normalization', () => {
  it('normalizes backslashes, leading slashes, duplicate slashes and dot segments', async () => {
    const bytes = await downloadZipBytes('names.zip', [
      { name: '\\windows\\style.txt', content: '1' },
      { name: '/leading/slash.md', content: '2' },
      { name: 'a/./b/../c.txt', content: '3' },
      { name: 'dir//double.txt', content: '4' },
    ]);

    const { locals, centrals } = parseZip(bytes);
    const expected = [
      'windows/style.txt',
      'leading/slash.md',
      // '..' segments are dropped, not resolved against the previous segment
      'a/b/c.txt',
      'dir/double.txt',
    ];
    expect(locals.map((entry) => entry.name)).to.deep.equal(expected);
    expect(centrals.map((entry) => entry.name)).to.deep.equal(expected);
  });

  it('rejects names that normalize to nothing without creating a download', async () => {
    for (const name of ['', '.', '..', '/', '\\', './/..']) {
      await expectRejection(downloadZip('bad.zip', [{ name, content: 'x' }]), 'Invalid zip entry name');
    }
    expect(capturedBlobs).to.have.length(0);
    expect(clickedAnchors).to.have.length(0);
    expect(revokedUrls).to.have.length(0);
  });
});

describe('downloadBlob orchestration', () => {
  it('clicks a temporary anchor wired to the object url and removes it afterwards', () => {
    const blob = new Blob(['payload']);
    downloadBlob('report.zip', blob);

    expect(capturedBlobs).to.have.length(1);
    expect(capturedBlobs[0]).to.equal(blob);
    expect(clickedAnchors).to.have.length(1);
    const anchor = clickedAnchors[0];
    expect(anchor.getAttribute('href')).to.equal('blob:test-1');
    expect(anchor.download).to.equal('report.zip');
    expect(anchor.rel).to.equal('noopener');
    expect(anchorConnectedAtClick).to.deep.equal([true]);
    expect(anchor.isConnected).to.equal(false);
  });

  it('revokes the object url only after the 30 second grace period', () => {
    downloadBlob('report.zip', new Blob(['payload']));

    expect(revokedUrls).to.deep.equal([]);
    vi.advanceTimersByTime(29_999);
    expect(revokedUrls).to.deep.equal([]);
    vi.advanceTimersByTime(1);
    expect(revokedUrls).to.deep.equal(['blob:test-1']);
  });
});
