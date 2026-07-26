import { describe, expect, it } from 'vitest';
import { createEmptyStructuredRegionDraft, parseStructuredRegionDraft } from '../src/lib/structured-region-draft';

const FIRST = 'r_abcdefghijkl';
const SECOND = 'r_mnopqrstuvwx';

describe('structured region local draft', () => {
  it('restores only the exact current string-valued region map in source order', () => {
    expect(parseStructuredRegionDraft(JSON.stringify({ [SECOND]: 'second();', [FIRST]: 'first();' }), [FIRST, SECOND], true)).to.deep.equal({
      [FIRST]: 'first();',
      [SECOND]: 'second();',
    });
    expect(createEmptyStructuredRegionDraft([FIRST, SECOND])).to.deep.equal({ [FIRST]: '', [SECOND]: '' });
  });

  it('rejects stale, incomplete, malformed, and multi-line program-fill caches', () => {
    for (const raw of [
      '{',
      '[]',
      JSON.stringify({ [FIRST]: 'first();' }),
      JSON.stringify({ [FIRST]: 'first();', [SECOND]: 'second();', stale: 'hidden();' }),
      JSON.stringify({ [FIRST]: 'first();', [SECOND]: 2 }),
      JSON.stringify({ [FIRST]: 'first();\nnext();', [SECOND]: 'second();' }),
    ]) {
      expect(parseStructuredRegionDraft(raw, [FIRST, SECOND], true), raw).to.equal(null);
    }
  });

  it('keeps multi-line code implementation drafts while enforcing the same exact key set', () => {
    const raw = JSON.stringify({ [FIRST]: 'int solve() {\n  return 1;\n}', [SECOND]: 'class Answer {};\n' });
    expect(parseStructuredRegionDraft(raw, [FIRST, SECOND], false)).to.deep.equal(JSON.parse(raw));
  });

  it('fails loudly when the server surface itself contains invalid or duplicate ids', () => {
    expect(() => createEmptyStructuredRegionDraft([FIRST, FIRST])).to.throw(/unique non-empty/);
    expect(() => parseStructuredRegionDraft('{}', [''], true)).to.throw(/unique non-empty/);
  });
});
