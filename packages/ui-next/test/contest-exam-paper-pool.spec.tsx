import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import {
  ContestExamPaperPool,
  examPaperHistoryCurrent,
  examPaperHistoryInit,
  examPaperHistoryPush,
  examPaperHistoryRedo,
  examPaperHistoryUndo,
  filterExamPaperPoolRows,
  moveExamPaperPoolBlock,
  parseExamPaperPidTokens,
  uniqueExamPaperPids,
} from '../src/pages/contest-exam-paper-pool';

function bootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-15T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      contests: '/contest',
      contestDetail: '/contest/:TID',
      problemDetail: '/p/:PID',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'contest_edit.html', data: {} },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exam paper pool helpers', () => {
  it('parses and deduplicates pasted tokens', () => {
    expect(parseExamPaperPidTokens('12, 12\nP1001；13')).to.deep.equal(['12', 'P1001', '13']);
    expect(uniqueExamPaperPids(['12', '12', ' 13 '])).to.deep.equal(['12', '13']);
  });

  it('moves a selected block and filters the pool', () => {
    expect(moveExamPaperPoolBlock(['1', '2', '3', '4'], ['2', '3'], -1)).to.deep.equal(['2', '3', '1', '4']);
    expect(moveExamPaperPoolBlock(['1', '2', '3'], ['1'], -1)).to.deep.equal(['1', '2', '3']);
    expect(
      filterExamPaperPoolRows(
        [
          { key: '11', docId: 11, pid: 'P11', title: '单选题', kind: 'single' },
          { key: '12', docId: 12, pid: 'P12', title: '编程入门', kind: 'programming' },
        ],
        'single',
        '单选',
      ).map((row) => row.key),
    ).to.deep.equal(['11']);
  });

  it('undoes and redoes pool snapshots', () => {
    let history = examPaperHistoryPush(examPaperHistoryInit(['11']), ['11', '12']);
    history = examPaperHistoryPush(history, ['11']);
    const undone = examPaperHistoryUndo(history);
    expect(undone).not.to.equal(null);
    expect(examPaperHistoryCurrent(undone!)).to.deep.equal(['11', '12']);
    expect(examPaperHistoryCurrent(examPaperHistoryRedo(undone!)!)).to.deep.equal(['11']);
  });
});

describe('exam paper pool UI', () => {
  it('filters, multi-selects, removes, and undoes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <ContestExamPaperPool
          value={['11', '12']}
          onChange={onChange}
          pdict={{
            11: { title: '单选题', pid: 'P11', problemKind: 'single' },
            12: { title: '编程入门', pid: 'P12', problemKind: 'programming' },
          }}
        />
      </BootstrapProvider>,
    );

    expect(screen.getByText('题池')).to.exist;
    expect((document.querySelector('input[name="pids"]') as HTMLInputElement).value).to.equal('11,12');
    expect(screen.getByText('单选题')).to.exist;
    expect(screen.getByText('编程入门')).to.exist;

    await user.click(screen.getByRole('button', { name: '单选 1' }));
    expect(screen.queryByText('编程入门')).to.equal(null);
    expect(screen.getByText('单选题')).to.exist;

    await user.click(screen.getByRole('button', { name: '全选当前筛选' }));
    await user.click(screen.getByRole('button', { name: '移除所选' }));
    expect(onChange).toHaveBeenCalledWith(['12']);

    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(onChange).toHaveBeenCalledWith(['11', '12']);
  });

  it('searches the bank with a kind filter and adds the selected hits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).to.include('kind=single');
        expect(url).not.to.include('quick=true');
        return new Response(
          JSON.stringify({
            pdocs: [{ docId: 21, pid: 'P21', title: '新单选', problemKind: 'single' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <ContestExamPaperPool value={['11']} onChange={onChange} pdict={{ 11: { title: '旧单选', problemKind: 'single' } }} />
      </BootstrapProvider>,
    );

    await user.type(screen.getByPlaceholderText('题号、标题或标签'), '单选');
    await user.click(screen.getByLabelText('搜索题型'));
    await user.click(screen.getByRole('option', { name: '单选' }));
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('新单选')).to.exist;
    await user.click(screen.getByRole('button', { name: '加入所选结果' }));
    expect(onChange).toHaveBeenCalledWith(['11', '21']);
  });
});
