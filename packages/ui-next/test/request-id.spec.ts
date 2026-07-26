import { describe, expect, it } from 'vitest';
import { createRequestId } from '../src/lib/request-id.ts';

describe('hTTP-compatible request IDs', () => {
  it('uses native randomUUID when the browser provides it', () => {
    const expected = '11111111-2222-4333-8444-555555555555';
    const actual = createRequestId({
      randomUUID: () => expected,
      getRandomValues: () => {
        throw new Error('fallback must not run');
      },
    });

    expect(actual).to.equal(expected);
  });

  it('constructs an RFC 4122 UUID v4 when only getRandomValues is available', () => {
    const actual = createRequestId({
      getRandomValues: (bytes) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return bytes;
      },
    });

    expect(actual).to.equal('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('fails explicitly when secure randomness is unavailable', () => {
    expect(() => createRequestId({})).to.throw('当前浏览器不支持安全的请求标识生成');
  });
});
