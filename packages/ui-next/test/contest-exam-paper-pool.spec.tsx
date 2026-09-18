import { useState } from 'react';
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
  examPaperBankCanAddAll,
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
    expect(examPaperBankCanAddAll('', '')).to.equal(false);
    expect(examPaperBankCanAddAll('单选', '')).to.equal(true);
    expect(examPaperBankCanAddAll('', 'single')).to.equal(true);
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ pdocs: [], pcount: 0, ppcount: 0, pidNamespaces: [] }), { status: 200 })),
    );
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
        const url = new URL(String(input), 'http://local.test');
        expect(url.searchParams.get('quick')).to.equal(null);
        if (url.searchParams.get('kind') === 'single') {
          return new Response(
            JSON.stringify({
              pdocs: [{ docId: 21, pid: 'P21', title: '新单选', problemKind: 'single' }],
              pcount: 1,
              ppcount: 1,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ pdocs: [], pcount: 0, ppcount: 0, pidNamespaces: [] }),
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
    await user.click(screen.getByRole('button', { name: '加入所选本页' }));
    expect(onChange).toHaveBeenCalledWith(['11', '21']);
  });

  it('adds every matching page and a whole pid namespace', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://local.test');
        if (url.searchParams.get('pidNamespaceId') === 'hdu') {
          return new Response(
            JSON.stringify({
              pdocs: [
                { docId: 31, pid: 'HDU1001', title: 'HDU 1', problemKind: 'programming' },
                { docId: 32, pid: 'HDU1002', title: 'HDU 2', problemKind: 'programming' },
              ],
              pcount: 2,
              ppcount: 1,
              pidNamespaces: [{ namespaceId: 'hdu', name: 'HDU', enabled: true }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.searchParams.get('q') === '期末') {
          const page = url.searchParams.get('page') === '2' ? 2 : 1;
          return new Response(
            JSON.stringify({
              pdocs: [{ docId: page === 1 ? 21 : 22, pid: page === 1 ? 'P21' : 'P22', title: page === 1 ? '卷一' : '卷二', problemKind: 'single' }],
              pcount: 2,
              ppcount: 2,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            pdocs: [],
            pcount: 0,
            ppcount: 0,
            pidNamespaces: [{ namespaceId: 'hdu', name: 'HDU', enabled: true }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    function StatefulPool() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <ContestExamPaperPool
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(
      <BootstrapProvider bootstrap={bootstrap()}>
        <StatefulPool />
      </BootstrapProvider>,
    );

    await user.type(screen.getByPlaceholderText('题号、标题或标签'), '期末');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('卷一')).to.exist;
    await user.click(screen.getByRole('button', { name: '加入全部匹配（2）' }));
    expect(onChange).toHaveBeenCalledWith(['21', '22']);

    await user.click(screen.getByLabelText('题号命名空间'));
    await user.click(await screen.findByRole('option', { name: 'HDU' }));
    await user.click(screen.getByRole('button', { name: '加入该命名空间全部题目' }));
    expect(onChange).toHaveBeenCalledWith(['21', '22', '31', '32']);
  });
});
