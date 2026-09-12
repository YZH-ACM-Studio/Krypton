import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  mapStructuredLineRanges,
  markOverlappingStructuredLineRangesInvalid,
  mergePublicRanges,
  overlaps,
  subtractPublicRanges,
  type StructuredLineRange,
} from '../src/lib/structured-code-ranges';

const answer: StructuredLineRange = { key: 'answer', startLine: 1, endLine: 2, state: 'answer' };

function mapChange(source: string, changes: { from: number; to?: number; insert?: string }, range = answer) {
  const state = EditorState.create({ doc: source });
  const transaction = state.update({ changes });
  return mapStructuredLineRanges(state.doc, transaction.newDoc, transaction.changes, [range])[0];
}

describe('p3.21 structured whole-line change mapping', () => {
  it('shifts a range after whole lines are inserted before it', () => {
    expect(mapChange('a\nb\nc', { from: 0, insert: 'x\n' })).to.deep.include({ startLine: 2, endLine: 3 });
  });

  it('expands a range when a line is inserted inside it', () => {
    expect(mapChange('a\nb\nc', { from: 3, insert: '\nnew' })).to.deep.include({ startLine: 1, endLine: 3 });
  });

  it('keeps lines inserted at a non-final end boundary private', () => {
    expect(mapChange('a\nb\nc', { from: 4, insert: 'x\n' })).to.deep.include({ startLine: 1, endLine: 2 });
  });

  it('extends a final marked range when the document itself is extended', () => {
    expect(mapChange('a\nb', { from: 3, insert: '\nx' })).to.deep.include({ startLine: 1, endLine: 3 });
  });

  it('keeps an unmarked trailing empty line private at the physical end', () => {
    expect(mapChange('a\nb\n', { from: 4, insert: 'x\n' })).to.deep.include({ startLine: 1, endLine: 2 });
  });

  it('keeps same-line edits mapped and invalidates whole-region deletion', () => {
    expect(mapChange('a\nb\nc', { from: 2, to: 3, insert: 'body' })).to.deep.include({ startLine: 1, endLine: 2 });
    expect(mapChange('a\nb\nc', { from: 2, to: 4, insert: '' })).to.deep.include({ invalid: true });
  });

  it('keeps an already invalid range invalid without guessing a recovery', () => {
    const invalid = { ...answer, invalid: true };
    expect(mapChange('a\nb\nc', { from: 0, insert: 'x\n' }, invalid)).to.deep.equal(invalid);
  });
});

describe('structured whole-line range set operations', () => {
  it('treats whole-line bounds as half-open so adjacent ranges do not overlap', () => {
    expect(overlaps({ startLine: 0, endLine: 2 }, { startLine: 2, endLine: 4 })).to.equal(false);
    expect(overlaps({ startLine: 0, endLine: 3 }, { startLine: 2, endLine: 4 })).to.equal(true);
    expect(overlaps({ startLine: 1, endLine: 2 }, { startLine: 0, endLine: 3 })).to.equal(true);
    expect(overlaps({ startLine: 0, endLine: 2 }, { startLine: 0, endLine: 2 })).to.equal(true);
    expect(overlaps({ startLine: 0, endLine: 1 }, { startLine: 2, endLine: 3 })).to.equal(false);
  });

  it('subtracts public coverage and only mints a right-hand key when both remnants exist', () => {
    const original = { key: 'p', startLine: 0, endLine: 6, invalid: false };
    expect(subtractPublicRanges([original], { startLine: 6, endLine: 8 })).to.deep.equal([original]);
    expect(subtractPublicRanges([original], { startLine: 6, endLine: 8 })[0]).to.equal(original);
    expect(subtractPublicRanges([original], { startLine: 0, endLine: 6 })).to.deep.equal([]);
    expect(subtractPublicRanges([original], { startLine: 0, endLine: 2 })).to.deep.equal([{ key: 'p', startLine: 2, endLine: 6, invalid: false }]);
    expect(subtractPublicRanges([original], { startLine: 4, endLine: 6 })).to.deep.equal([{ key: 'p', startLine: 0, endLine: 4, invalid: false }]);
    expect(subtractPublicRanges([original], { startLine: 2, endLine: 4 })).to.deep.equal([
      { key: 'p', startLine: 0, endLine: 2, invalid: false },
      { key: 'p:right:2:4', startLine: 4, endLine: 6, invalid: false },
    ]);
    expect(subtractPublicRanges([{ key: 'p', startLine: 0, endLine: 5, invalid: true }], { startLine: 2, endLine: 4 })).to.deep.equal([
      { key: 'p', startLine: 0, endLine: 2, invalid: true },
      { key: 'p:right:2:4', startLine: 4, endLine: 5, invalid: true },
    ]);
  });

  it('merges adjacent valid public ranges and skips invalid ranges instead of absorbing them', () => {
    const left = { key: 'a', startLine: 0, endLine: 2, invalid: false };
    const right = { key: 'b', startLine: 2, endLine: 4, invalid: false };
    expect(mergePublicRanges([right, left])).to.deep.equal([{ key: 'a', startLine: 0, endLine: 4, invalid: false }]);
    expect(mergePublicRanges([left, { key: 'gap', startLine: 3, endLine: 5, invalid: false }])).to.deep.equal([
      left,
      { key: 'gap', startLine: 3, endLine: 5, invalid: false },
    ]);
    expect(left.endLine).to.equal(2);

    const invalid = { key: 'bad', startLine: 1, endLine: 3, invalid: true };
    expect(mergePublicRanges([left, invalid, { key: 'c', startLine: 2, endLine: 5, invalid: false }])).to.deep.equal([
      { key: 'a', startLine: 0, endLine: 2, invalid: false },
      { key: 'bad', startLine: 1, endLine: 3, invalid: true },
      { key: 'c', startLine: 2, endLine: 5, invalid: false },
    ]);
    expect(
      mergePublicRanges([
        { key: 'a', startLine: 0, endLine: 2, invalid: false },
        { key: 'b', startLine: 2, endLine: 4, invalid: false },
        { key: 'bad', startLine: 3, endLine: 5, invalid: true },
      ]),
    ).to.deep.equal([
      { key: 'a', startLine: 0, endLine: 4, invalid: false },
      { key: 'bad', startLine: 3, endLine: 5, invalid: true },
    ]);
  });

  it('marks every overlapping key invalid without clearing an already invalid isolated range', () => {
    const publicRange = { key: 'public', startLine: 0, endLine: 3, invalid: false };
    const answerRange = { key: 'answer', startLine: 2, endLine: 4, invalid: false };
    const isolatedInvalid = { key: 'stale', startLine: 8, endLine: 9, invalid: true };
    const disjoint = { key: 'ok', startLine: 5, endLine: 6, invalid: false };
    expect(markOverlappingStructuredLineRangesInvalid([publicRange, answerRange, isolatedInvalid, disjoint])).to.deep.equal([
      { key: 'public', startLine: 0, endLine: 3, invalid: true },
      { key: 'answer', startLine: 2, endLine: 4, invalid: true },
      { key: 'stale', startLine: 8, endLine: 9, invalid: true },
      { key: 'ok', startLine: 5, endLine: 6, invalid: false },
    ]);
    expect(publicRange.invalid).to.equal(false);

    const stalePublic = { key: 'stale-public', startLine: 0, endLine: 4, invalid: true };
    const liveAnswer = { key: 'live-answer', startLine: 1, endLine: 2, invalid: false };
    expect(markOverlappingStructuredLineRangesInvalid([stalePublic], [stalePublic, liveAnswer])).to.deep.equal([
      { key: 'stale-public', startLine: 0, endLine: 4, invalid: true },
    ]);
    expect(markOverlappingStructuredLineRangesInvalid([liveAnswer], [stalePublic, liveAnswer])).to.deep.equal([
      { key: 'live-answer', startLine: 1, endLine: 2, invalid: true },
    ]);
  });

  it('applies public subtract-insert-merge while leaving invalid public ranges unmerged', () => {
    const current = [{ key: 'p', startLine: 0, endLine: 6, invalid: false }];
    const target = { startLine: 2, endLine: 4 };
    expect(
      mergePublicRanges([...subtractPublicRanges(current, target), { key: 'public-new-1', startLine: 2, endLine: 4, invalid: false }]),
    ).to.deep.equal([{ key: 'p', startLine: 0, endLine: 6, invalid: false }]);

    const invalid = [{ key: 'bad', startLine: 0, endLine: 6, invalid: true }];
    expect(
      mergePublicRanges([...subtractPublicRanges(invalid, target), { key: 'public-new-1', startLine: 2, endLine: 4, invalid: false }]),
    ).to.deep.equal([
      { key: 'bad', startLine: 0, endLine: 2, invalid: true },
      { key: 'public-new-1', startLine: 2, endLine: 4, invalid: false },
      { key: 'bad:right:2:4', startLine: 4, endLine: 6, invalid: true },
    ]);
  });

  it('lets mark-answer subtract public coverage without merging remnants', () => {
    const current = [{ key: 'p', startLine: 0, endLine: 6, invalid: false }];
    expect(subtractPublicRanges(current, { startLine: 2, endLine: 4 })).to.deep.equal([
      { key: 'p', startLine: 0, endLine: 2, invalid: false },
      { key: 'p:right:2:4', startLine: 4, endLine: 6, invalid: false },
    ]);
  });

  it('drops complete overlapping answer ranges while subtracting public coverage for mark-private', () => {
    const publics = [{ key: 'p', startLine: 0, endLine: 4, invalid: false }];
    const regions = [
      { key: 'r1', startLine: 0, endLine: 2 },
      { key: 'r2', startLine: 3, endLine: 4 },
    ];
    const target = { startLine: 0, endLine: 2 };
    expect(subtractPublicRanges(publics, target)).to.deep.equal([{ key: 'p', startLine: 2, endLine: 4, invalid: false }]);
    expect(regions.filter((region) => !overlaps(region, target))).to.deep.equal([{ key: 'r2', startLine: 3, endLine: 4 }]);
  });
});
