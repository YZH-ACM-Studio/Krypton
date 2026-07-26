// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractSamples, resolveContentString, splitMarkdownBySamples, stripSampleBlocks } from '../src/lib/samples';

const paired = '# Statement\n\n```input1\n1 2\n```\n\n```output1\n3\n```\n';

describe('extractSamples', () => {
  it('returns an empty list for null, undefined, and empty content', () => {
    expect(extractSamples(null)).to.deep.equal([]);
    expect(extractSamples(undefined)).to.deep.equal([]);
    expect(extractSamples('')).to.deep.equal([]);
  });

  it('pairs numbered input/output fences from plain markdown', () => {
    expect(extractSamples(paired)).to.deep.equal([{ id: 1, input: '1 2', output: '3' }]);
  });

  it('treats bare input/output fences as case 1', () => {
    expect(extractSamples('```input\na\n```\n```output\nb\n```')).to.deep.equal([{ id: 1, input: 'a', output: 'b' }]);
  });

  it('sorts multiple cases numerically and fills missing halves with empty strings', () => {
    const md = '```input10\nten\n```\n```output10\nTEN\n```\n```input2\ntwo\n```\n```output3\nTHREE\n```';
    expect(extractSamples(md)).to.deep.equal([
      { id: 2, input: 'two', output: '' },
      { id: 3, input: '', output: 'THREE' },
      { id: 10, input: 'ten', output: 'TEN' },
    ]);
  });

  it('matches fences case-insensitively and at the very start of the source', () => {
    expect(extractSamples('```Input1\nx\n```\n```OUTPUT1\ny\n```')).to.deep.equal([{ id: 1, input: 'x', output: 'y' }]);
  });

  it('accepts longer fences only when the closing length matches', () => {
    expect(extractSamples('````input1\nhas ``` inside\n````\n````output1\nok\n````')).to.deep.equal([
      { id: 1, input: 'has ``` inside', output: 'ok' },
    ]);
  });

  it('trims trailing whitespace from bodies but keeps interior blank lines', () => {
    expect(extractSamples('```input1\na\n\nb\t \n```\n```output1\n\n```')).to.deep.equal([
      { id: 1, input: 'a\n\nb', output: '' },
    ]);
  });

  it('ignores ordinary code fences without an input/output tag', () => {
    expect(extractSamples('```cpp\nint main() {}\n```')).to.deep.equal([]);
  });

  it('prefers the zh entry of a JSON multilingual blob', () => {
    const blob = JSON.stringify({
      en: '```input1\nen-in\n```\n```output1\nen-out\n```',
      zh: '```input1\nzh-in\n```\n```output1\nzh-out\n```',
    });
    expect(extractSamples(blob)).to.deep.equal([{ id: 1, input: 'zh-in', output: 'zh-out' }]);
  });

  it('falls back to the next language when the preferred one has no samples', () => {
    const content = {
      zh: 'no samples here',
      en: '```input1\nen-in\n```\n```output1\nen-out\n```',
    };
    expect(extractSamples(content)).to.deep.equal([{ id: 1, input: 'en-in', output: 'en-out' }]);
  });

  it('treats malformed JSON-looking content as raw markdown', () => {
    const md = '{"broken": \n```input1\nin\n```\n```output1\nout\n```\n}';
    expect(extractSamples(md)).to.deep.equal([{ id: 1, input: 'in', output: 'out' }]);
  });

  it('skips non-string values in an already-parsed record', () => {
    const content = { zh: 42, en: '```input1\nin\n```\n```output1\nout\n```' } as unknown as Record<string, string>;
    expect(extractSamples(content)).to.deep.equal([{ id: 1, input: 'in', output: 'out' }]);
  });
});

describe('resolveContentString', () => {
  it('returns the trimmed string for plain markdown', () => {
    expect(resolveContentString('  hello world  ')).to.equal('hello world');
  });

  it('returns an empty string for empty content', () => {
    expect(resolveContentString('')).to.equal('');
    expect(resolveContentString({})).to.equal('');
  });

  it('prefers zh, then en, then the first declared key', () => {
    expect(resolveContentString({ en: 'EN', zh: 'ZH' })).to.equal('ZH');
    expect(resolveContentString({ fr: 'FR', en: 'EN' })).to.equal('EN');
    expect(resolveContentString({ fr: 'FR', de: 'DE' })).to.equal('FR');
  });

  it('parses a JSON multilingual string before choosing a language', () => {
    expect(resolveContentString('{"en":"EN","zh":"ZH"}')).to.equal('ZH');
  });
});

describe('splitMarkdownBySamples', () => {
  it('returns an empty list for empty markdown', () => {
    expect(splitMarkdownBySamples('')).to.deep.equal([]);
  });

  it('returns one md chunk when there are no sample fences', () => {
    expect(splitMarkdownBySamples('# Title\n\nplain prose')).to.deep.equal([{ kind: 'md', md: '# Title\n\nplain prose' }]);
  });

  it('keeps prose before and after a sample group in original order', () => {
    const md = 'before\n\n```input1\nin\n```\n\n```output1\nout\n```\n\nafter';
    expect(splitMarkdownBySamples(md)).to.deep.equal([
      { kind: 'md', md: 'before' },
      { kind: 'sample', samples: [{ id: 1, input: 'in', output: 'out' }] },
      { kind: 'md', md: 'after' },
    ]);
  });

  it('merges consecutive whitespace-separated fences into one sample chunk', () => {
    const md = '```input1\na\n```\n\n```output1\nb\n```\n\n```input2\nc\n```\n\n```output2\nd\n```';
    expect(splitMarkdownBySamples(md)).to.deep.equal([
      {
        kind: 'sample',
        samples: [
          { id: 1, input: 'a', output: 'b' },
          { id: 2, input: 'c', output: 'd' },
        ],
      },
    ]);
  });

  it('splits sample groups separated by prose into distinct chunks', () => {
    const md = '```input1\na\n```\n```output1\nb\n```\n\nmiddle\n\n```input2\nc\n```\n```output2\nd\n```';
    // Interior prose keeps its leading newlines: only trailing newlines are
    // trimmed for chunks that precede a sample group.
    expect(splitMarkdownBySamples(md)).to.deep.equal([
      { kind: 'sample', samples: [{ id: 1, input: 'a', output: 'b' }] },
      { kind: 'md', md: '\n\nmiddle' },
      { kind: 'sample', samples: [{ id: 2, input: 'c', output: 'd' }] },
    ]);
  });

  it('emits no empty md chunk when a sample sits at the start or end', () => {
    const md = '```input1\na\n```\n```output1\nb\n```\n\n';
    const chunks = splitMarkdownBySamples(md);
    expect(chunks).to.have.length(1);
    expect(chunks[0].kind).to.equal('sample');
  });
});

describe('stripSampleBlocks', () => {
  it('returns falsy input unchanged', () => {
    expect(stripSampleBlocks('')).to.equal('');
  });

  it('removes sample fences and collapses the leftover blank lines', () => {
    const md = 'before\n\n```input1\nin\n```\n\n```output1\nout\n```\n\nafter';
    expect(stripSampleBlocks(md)).to.equal('before\n\nafter');
  });

  it('keeps ordinary code fences intact', () => {
    const md = '```cpp\nint main() {}\n```\n\n```input1\nin\n```';
    expect(stripSampleBlocks(md)).to.equal('```cpp\nint main() {}\n```');
  });

  it('strips bare and numbered variants alike', () => {
    const md = '```input\na\n```\n\n```output\nb\n```\n\n```input3\nc\n```';
    expect(stripSampleBlocks(md)).to.equal('');
  });
});
