import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { searchTrainingProblems } from '../src/pages/training-search.ts';

const dag = [
  { _id: 1, title: '入门', pids: [101, 202, 999] },
  { _id: 2, title: '图论', pids: [101, 303] },
];

const pdict = {
  101: { docId: 101, pid: 'PAT-A1001', title: 'A+B Format' },
  202: { docId: 202, pid: 'L2-001', title: 'Emergency Rescue' },
  303: { docId: 303, title: 'Graph Walk' },
};

const psdict = {
  101: { status: 1 },
  202: { status: 2 },
};

describe('P3.24 training problem search', () => {
  it('searches every chapter by public PID, internal docId, and title', () => {
    expect(searchTrainingProblems({ dag, pdict, psdict, query: ' pat-a1001 ' }).results.map((row) => row.docId)).to.deep.equal([101]);
    expect(searchTrainingProblems({ dag, pdict, psdict, query: '202' }).results.map((row) => row.docId)).to.deep.equal([202]);
    expect(searchTrainingProblems({ dag, pdict, psdict, query: 'GRAPH' }).results.map((row) => row.docId)).to.deep.equal([303]);
  });

  it('deduplicates repeated references and keeps all chapter locations', () => {
    const result = searchTrainingProblems({ dag, pdict, psdict, query: '1001' });
    expect(result.total).to.equal(1);
    expect(result.results[0]).to.deep.include({
      docId: 101,
      displayPid: 'PAT-A1001',
      title: 'A+B Format',
      status: 'accepted',
    });
    expect(result.results[0].chapters).to.deep.equal([
      { id: 1, title: '入门' },
      { id: 2, title: '图论' },
    ]);
  });

  it('derives personal status and never exposes problems omitted from pdict', () => {
    expect(searchTrainingProblems({ dag, pdict, psdict, query: 'rescue' }).results[0].status).to.equal('attempted');
    expect(searchTrainingProblems({ dag, pdict, psdict, query: 'walk' }).results[0].status).to.equal('unattempted');
    expect(searchTrainingProblems({ dag, pdict, psdict: { ...psdict, 303: { status: 0 } }, query: 'walk' }).results[0].status).to.equal('attempted');
    expect(searchTrainingProblems({ dag, pdict, psdict, query: '999' })).to.deep.equal({ total: 0, results: [] });
  });

  it('returns no rows for an empty query and applies a deterministic display limit', () => {
    expect(searchTrainingProblems({ dag, pdict, psdict, query: '   ' })).to.deep.equal({ total: 0, results: [] });
    const result = searchTrainingProblems({ dag, pdict, psdict, query: 'a', limit: 1 });
    expect(result.total).to.equal(2);
    expect(result.results.map((row) => row.docId)).to.deep.equal([101]);
  });

  it('connects the search results to existing problem and chapter navigation', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/training.tsx'), 'utf8');
    expect(source).to.include('searchTrainingProblems({ dag, pdict, psdict, query: problemQuery })');
    expect(source).to.include('aria-label="搜索当前训练中的题目"');
    expect(source).to.include('selectChapter(chapter.id)');
    expect(source).to.include('replaceRouteTokens(bs.urls.problemDetail, { PID: String(row.docId) })');
  });
});
