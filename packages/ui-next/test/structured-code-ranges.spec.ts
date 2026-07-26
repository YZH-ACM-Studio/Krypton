import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { mapStructuredLineRanges, type StructuredLineRange } from '../src/lib/structured-code-ranges';

const answer: StructuredLineRange = { key: 'answer', startLine: 1, endLine: 2, state: 'answer' };

function mapChange(source: string, changes: { from: number; to?: number; insert?: string }, range = answer) {
  const state = EditorState.create({ doc: source });
  const transaction = state.update({ changes });
  return mapStructuredLineRanges(state.doc, transaction.newDoc, transaction.changes, [range])[0];
}

describe('P3.21 structured whole-line change mapping', () => {
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
