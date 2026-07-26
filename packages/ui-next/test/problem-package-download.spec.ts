import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadProblemFiles, downloadProblemPackage } from '../src/lib/problem-package.ts';

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as any).document;
const originalWindow = (globalThis as any).window;
const originalCreateObjectURL = (URL as any).createObjectURL;
const originalRevokeObjectURL = (URL as any).revokeObjectURL;

const selectedNames = [
  ...Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, '0')),
  ...Array.from({ length: 7 }, (_, index) => String(index + 201)),
].flatMap((prefix) => [`${prefix}.in`, `${prefix}.out`]);

interface CapturedRequest {
  contentType: string;
  operation: string;
  type: string;
  files: unknown;
}

let capturedRequests: CapturedRequest[];
let downloadedEntries: string[];
let browserDownloads: number;

function parseProductionRequest(init: RequestInit | undefined): CapturedRequest {
  const contentType = new Headers(init?.headers).get('content-type') || '';
  const rawBody = String(init?.body || '');
  if (contentType.startsWith('application/json')) {
    return { contentType, ...JSON.parse(rawBody) };
  }

  const params = new URLSearchParams(rawBody);
  const repeatedFiles = params.getAll('files');
  // co-body uses qs with its default arrayLimit=20. On the 21st repeated
  // value, qs materializes a numeric-key object instead of an array.
  const files = repeatedFiles.length > 20 ? Object.fromEntries(repeatedFiles.map((file, index) => [String(index), file])) : repeatedFiles;
  return {
    contentType,
    operation: params.get('operation') || '',
    type: params.get('type') || '',
    files,
  };
}

function productionTypesSet(value: unknown): Set<unknown> {
  if (Array.isArray(value)) return new Set(value);
  return value ? new Set([value]) : new Set();
}

beforeEach(() => {
  capturedRequests = [];
  downloadedEntries = [];
  browserDownloads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/files')) {
      const request = parseProductionRequest(init);
      capturedRequests.push(request);
      const links: Record<string, string> = {};
      for (const file of productionTypesSet(request.files)) {
        const filename = String(file);
        links[filename] = `https://download.test/${encodeURIComponent(filename)}`;
      }
      return Response.json({ links });
    }
    if (url.startsWith('https://download.test/')) {
      const filename = decodeURIComponent(url.slice('https://download.test/'.length));
      downloadedEntries.push(filename);
      if (filename === '[object Object]') return new Response('missing', { status: 500 });
      return new Response(filename);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  (globalThis as any).document = {
    body: { appendChild() {} },
    createElement: () => ({
      href: '',
      download: '',
      rel: '',
      click() {
        browserDownloads += 1;
      },
      remove() {},
    }),
  };
  (globalThis as any).window = { setTimeout: () => 0 };
  (URL as any).createObjectURL = () => 'blob:problem-package-test';
  (URL as any).revokeObjectURL = () => {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).document = originalDocument;
  (globalThis as any).window = originalWindow;
  (URL as any).createObjectURL = originalCreateObjectURL;
  (URL as any).revokeObjectURL = originalRevokeObjectURL;
});

async function expectIncompleteLinkResponse(incomplete: 'missing' | 'empty') {
  capturedRequests = [];
  downloadedEntries = [];
  browserDownloads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.endsWith('/files')) throw new Error(`Unexpected fetch: ${url}`);
    const request = parseProductionRequest(init);
    capturedRequests.push(request);
    const links = Object.fromEntries(selectedNames.map((name) => [name, `https://download.test/${encodeURIComponent(name)}`]));
    if (incomplete === 'missing') delete links[selectedNames.at(-1)!];
    else links[selectedNames.at(-1)!] = '';
    return Response.json({ links });
  };

  let failure: unknown;
  try {
    await downloadProblemFiles({
      pdoc: { docId: 2860, pid: 'P4034', title: 'incomplete links' },
      problemUrl: '/p/P4034',
      files: selectedNames,
      type: 'testdata',
    });
  } catch (error) {
    failure = error;
  }

  expect(failure).to.be.instanceOf(Error);
  expect((failure as Error).message).to.equal(`服务器未返回下载链接：${selectedNames.at(-1)}`);
  expect(capturedRequests).to.have.length(1);
  expect(downloadedEntries).to.deep.equal([]);
  expect(browserDownloads).to.equal(0);
}

describe('problem package bulk download protocol', () => {
  it('packages more than 20 testdata files without requesting [object Object]', async () => {
    await downloadProblemPackage({
      pdoc: { docId: 2860, pid: 'P4034', title: 'bulk package' },
      problemUrl: '/p/P4034',
      testdata: selectedNames.map((name) => ({ name, size: 1 })),
      content: 'statement',
    });

    expect(capturedRequests).to.have.length(1);
    expect(capturedRequests[0].files).to.deep.equal(selectedNames);
    expect(downloadedEntries).to.deep.equal(selectedNames);
    expect(downloadedEntries).not.to.include('[object Object]');
    expect(browserDownloads).to.equal(1);
  });

  it('downloads every selected file when the selection exceeds 20 entries', async () => {
    await downloadProblemFiles({
      pdoc: { docId: 2860, pid: 'P4034', title: 'bulk files' },
      problemUrl: '/p/P4034',
      files: selectedNames,
      type: 'testdata',
    });

    expect(capturedRequests).to.have.length(1);
    expect(capturedRequests[0].files).to.deep.equal(selectedNames);
    expect(downloadedEntries).to.deep.equal(selectedNames);
    expect(browserDownloads).to.equal(1);
  });

  it('rejects an incomplete link response before requesting files or creating a ZIP', async () => {
    await expectIncompleteLinkResponse('missing');
    await expectIncompleteLinkResponse('empty');
  });
});
