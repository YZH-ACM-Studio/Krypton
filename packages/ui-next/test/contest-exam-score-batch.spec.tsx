import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ContestExamScoreBatch,
  examScoreRows,
  filterExamScoreRows,
} from '../src/pages/contest-exam-score-batch';
import { examScoresFromTdoc, examScoresPayload, examPaperScoreWeight } from '../src/pages/contest-exam-paper-pool';

describe('exam contest score helpers', () => {
  it('filters by kind and query, and serializes only current pool scores', () => {
    const rows = examScoreRows(
      [11, 12, 13],
      {
        11: { pid: 'P11', title: '判断题', problemKind: 'true_false' },
        12: { pid: 'P12', title: '多选题', problemKind: 'multi' },
        13: { title: '编程', problemKind: 'programming' },
      },
      { 11: 2, 12: 3 },
    );
    expect(rows.map((row) => [row.pid, row.kind, row.score])).to.deep.equal([
      [11, 'true_false', 2],
      [12, 'multi', 3],
      [13, 'programming', 100],
    ]);
    expect(filterExamScoreRows(rows, 'true_false', '').map((row) => row.pid)).to.deep.equal([11]);
    expect(filterExamScoreRows(rows, '', '多选').map((row) => row.pid)).to.deep.equal([12]);
    expect(examPaperScoreWeight({ 11: 2 }, '11')).to.equal(2);
    expect(examScoresFromTdoc(['11', '12'], { 11: 2 })).to.deep.equal({ 11: 2, 12: 100 });
    expect(examScoresPayload(['11', '12', 'P1001'], { 11: 2, 99: 8 })).to.equal('{"11":2,"12":100}');
  });
});

describe('exam contest score batch UI', () => {
  it('filters by kind, selects visible rows, and posts set_scores for the selection', async () => {
    const user = userEvent.setup();
    render(
      <ContestExamScoreBatch
        pids={[11, 12]}
        pdict={{
          11: { pid: 'P11', title: '判断题', problemKind: 'true_false' },
          12: { pid: 'P12', title: '多选题', problemKind: 'multi' },
        }}
        scores={{ 11: 2, 12: 100 }}
      />,
    );

    await user.click(screen.getByRole('button', { name: '判断 1' }));
    expect(screen.getByText('判断题')).to.exist;
    expect(screen.queryByText('多选题')).to.equal(null);

    await user.click(screen.getByRole('button', { name: '全选当前筛选' }));
    const batch = document.querySelector('form input[name="operation"][value="set_scores"]')?.closest('form');
    expect(batch).not.to.equal(null);
    expect((batch?.querySelector('input[name="pids"]') as HTMLInputElement).value).to.equal('11');
    expect((batch?.querySelector('input[name="score"]') as HTMLInputElement).value).to.equal('2');
    expect(screen.getByRole('button', { name: '所选设为该分（1）' })).to.exist;
  });
});
