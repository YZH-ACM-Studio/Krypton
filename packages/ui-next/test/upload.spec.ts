import { expect } from 'chai';
import { afterEach, describe, it } from 'node:test';
import { uploadUserFile } from '../src/lib/upload.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('user image upload', () => {
  it('returns an inline image URL after the file endpoint accepts the upload', async () => {
    globalThis.fetch = async () => new Response(null, { status: 200 });
    const file = new File(['image'], 'award.jpg', { type: 'image/jpeg' });

    const url = await uploadUserFile(file, 2);

    expect(url).to.match(/^\/file\/2\/up-\d+-[a-z0-9]+\.jpg\?noDisposition=1$/);
  });
});
