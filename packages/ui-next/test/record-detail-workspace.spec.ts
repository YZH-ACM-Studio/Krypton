import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  defaultRecordDetailTab,
  paginateRecordCases,
  recordCodeDownloadAvailable,
  recordDetailMode,
  recordDetailTabs,
  resolveRecordIdentity,
  summarizeRecordCases,
} from '../src/lib/record-detail-workspace';

describe('P2.34 record detail workspace', () => {
  it('opens code first and omits unavailable tabs', () => {
    expect(recordDetailTabs({ hasCode: true, caseCount: 4 })).to.deep.equal(['overview', 'cases', 'code']);
    expect(defaultRecordDetailTab({ hasCode: true, caseCount: 4 })).to.equal('code');
    expect(recordDetailTabs({ hasCode: false, caseCount: 4 })).to.deep.equal(['overview', 'cases']);
    expect(defaultRecordDetailTab({ hasCode: false, caseCount: 4 })).to.equal('cases');
    expect(recordDetailTabs({ hasCode: false, caseCount: 0 })).to.deep.equal(['overview']);
    expect(defaultRecordDetailTab({ hasCode: false, caseCount: 0 })).to.equal('overview');
  });

  it('keeps case rendering bounded at fifty rows and clamps stale pages', () => {
    const one = [{ id: 1 }];
    const fifty = Array.from({ length: 50 }, (_, index) => ({ id: index + 1 }));
    const fiftyOne = Array.from({ length: 51 }, (_, index) => ({ id: index + 1 }));
    const cases = Array.from({ length: 125 }, (_, index) => ({ id: index + 1 }));
    expect(paginateRecordCases(one, 1)).to.deep.include({ totalPages: 1, start: 1, end: 1 });
    expect(paginateRecordCases(fifty, 1)).to.deep.include({ totalPages: 1, start: 1, end: 50 });
    expect(paginateRecordCases(fiftyOne, 2)).to.deep.include({ totalPages: 2, start: 51, end: 51 });
    expect(paginateRecordCases(cases, 1)).to.deep.include({ page: 1, totalPages: 3, start: 1, end: 50 });
    expect(paginateRecordCases(cases, 2).items.map((item) => item.id)).to.deep.equal(Array.from({ length: 50 }, (_, index) => index + 51));
    expect(paginateRecordCases(cases, 99)).to.deep.include({ page: 3, start: 101, end: 125 });
    expect(paginateRecordCases([], -2)).to.deep.include({ page: 1, totalPages: 1, start: 0, end: 0 });
    expect(() => paginateRecordCases(cases, 1, 0)).to.throw('pageSize must be a positive integer');
  });

  it('uses Hydro canonical pass, progress, fail, and ignored status semantics', () => {
    expect(
      summarizeRecordCases([
        { status: 1 },
        { status: 12 },
        { status: 32 },
        { status: 0 },
        { status: 20 },
        { status: 21 },
        { status: 22 },
        { status: 2 },
        { status: 7 },
        { status: 9 },
        { status: 31 },
      ]),
    ).to.deep.equal({
      accepted: 3,
      active: 4,
      failed: 2,
      other: 2,
      total: 11,
    });
  });

  it('selects the code-only Exam Mode view without changing other contest routes', () => {
    expect(recordDetailMode({ hasExamMode: true, hasContestContext: true, postContestPractice: false })).to.equal('exam-code');
    expect(recordDetailMode({ hasExamMode: false, hasContestContext: true, postContestPractice: false })).to.equal('legacy-contest');
    expect(recordDetailMode({ hasExamMode: false, hasContestContext: true, postContestPractice: true })).to.equal('workspace');
    expect(recordDetailMode({ hasExamMode: false, hasContestContext: false, postContestPractice: false })).to.equal('workspace');
  });

  it('treats the server download capability as authoritative in code-only mode', () => {
    expect(
      recordCodeDownloadAvailable({
        mode: 'exam-code',
        serverAvailable: false,
        hasInlineCode: true,
        hasCodeFile: true,
        hasHackFile: false,
      }),
    ).to.equal(false);
    expect(
      recordCodeDownloadAvailable({
        mode: 'exam-code',
        serverAvailable: true,
        hasInlineCode: false,
        hasCodeFile: false,
        hasHackFile: false,
      }),
    ).to.equal(true);
    expect(
      recordCodeDownloadAvailable({
        mode: 'workspace',
        serverAvailable: false,
        hasInlineCode: true,
        hasCodeFile: false,
        hasHackFile: false,
      }),
    ).to.equal(true);
  });

  it('uses the record user and only renders server-gated student identity', () => {
    expect(resolveRecordIdentity({ user: { uname: ' student ' }, uid: 867 })).to.deep.equal({
      username: 'student',
      student: null,
    });
    expect(
      resolveRecordIdentity({
        user: { uname: 'student' },
        uid: 867,
        student: { studentId: ' 240000001 ', realName: ' 学生甲 ' },
      }),
    ).to.deep.equal({
      username: 'student',
      student: { studentId: '240000001', realName: '学生甲' },
    });
    expect(resolveRecordIdentity({ user: null, uid: 867, student: null })).to.deep.equal({
      username: '#867',
      student: null,
    });
  });

  it('preserves record routes while exposing copy and full case details', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/records.tsx'), 'utf8');
    expect(source).to.include('const examUrls: R = data.examMode?.urls || {}');
    expect(source).to.include('function normalizeId(value: unknown): string');
    expect(source).to.include('practice: postContestPracticeRecordAccess');
    expect(source).to.include('useRecordSocket({');
    expect(source).to.include('recordDetailMode({');
    expect(source).to.include('!!data.examMode || data.examRecordCodeOnly === true');
    expect(source).to.include("detailMode === 'exam-code'");
    expect(source).to.include("disabled: !rdoc._id || detailMode === 'exam-code'");
    expect(source).to.include('serverAvailable: data.examRecordDownloadAvailable');
    expect(source).to.include('data.udoc || getUser(bs.udict, rdoc.uid)');
    expect(source).to.include('data.recordStudent');
    expect(source).to.include("copyState === 'copied' ? '提交代码已复制'");
    expect(source).to.include('role="status" aria-live="polite"');
    expect(source).to.include('<details');
  });
});
