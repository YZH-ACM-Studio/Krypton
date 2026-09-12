import { describe, expect, it } from 'vitest';
import {
  COLLECT_DEFAULT_FILE_NAME_TEMPLATE,
  COLLECT_DEFAULT_PACK_LAYOUT,
  COLLECT_NAME_TOKENS,
  renderAssignedFileName,
  renderPackEntryName,
} from '../src/pages/collect/name-format.ts';

const PREVIEW = {
  uid: 1,
  studentId: '24000001',
  realName: '张三',
  slotTitle: '实验报告',
  index: 1,
  ext: 'pdf',
  originalName: 'lab.pdf',
};

describe('collect name-format preview', () => {
  it('keeps the locked token list and defaults', () => {
    expect([...COLLECT_NAME_TOKENS]).to.deep.equal([
      'studentId',
      'realName',
      'slotTitle',
      'index',
      'ext',
      'originalStem',
      'originalName',
    ]);
    expect(COLLECT_DEFAULT_FILE_NAME_TEMPLATE).to.equal('{originalName}');
    expect(COLLECT_DEFAULT_PACK_LAYOUT).to.equal('nested');
  });

  it('renders the teacher example for nested and flat layouts', () => {
    const assigned = renderAssignedFileName(COLLECT_DEFAULT_FILE_NAME_TEMPLATE, PREVIEW);
    expect(assigned).to.equal('lab.pdf');
    expect(renderPackEntryName('nested', '24000001-张三', '实验报告', assigned)).to.equal('24000001-张三/实验报告/lab.pdf');
    expect(renderPackEntryName('flat', '24000001-张三', '实验报告', assigned)).to.equal('lab.pdf');
  });

  it('applies the real extension after token replacement', () => {
    expect(renderAssignedFileName('{studentId}_{realName}_{slotTitle}', PREVIEW)).to.equal('24000001_张三_实验报告.pdf');
    expect(renderAssignedFileName('{originalStem}_{index}.{ext}', PREVIEW)).to.equal('lab_1.pdf');
  });

  it('uses unbound-UID{uid} when studentId is empty and uid is present', () => {
    expect(renderAssignedFileName('{studentId}', { ...PREVIEW, studentId: '' })).to.equal('unbound-UID1.pdf');
    expect(renderAssignedFileName('{studentId}', { ...PREVIEW, studentId: '  ' })).to.equal('unbound-UID1.pdf');
  });
});
