import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompetitiveCompanionBridge, ContestCompanionBridge, HydroCompanionMarkup } from '../src/components/competitive-companion-bridge';

function parseLikeHydro(root: HTMLElement) {
  const name = root.querySelector('.section__title')?.lastChild?.textContent?.trim();
  const blocks = [...root.querySelectorAll('.sample > pre > code')].map((node) => node.textContent || '');
  const tests: Array<{ input: string; output: string }> = [];
  for (let i = 0; i < blocks.length - 1; i += 2) {
    tests.push({ input: blocks[i], output: blocks[i + 1] });
  }
  const timeLimit = Number.parseInt(/(\d+)ms/.exec(root.querySelector('.icon-stopwatch')?.textContent || '')?.[1] || '', 10);
  const memoryLimit = Number.parseInt(/(\d+)MiB/.exec(root.querySelector('.icon-comparison')?.textContent || '')?.[1] || '', 10);
  return { name, tests, timeLimit, memoryLimit };
}

describe('hydro companion markup', () => {
  it('exposes the selectors Competitive Companion HydroProblemParser scrapes', () => {
    const { container } = render(
      <HydroCompanionMarkup
        name="#H1000. A + B Problem"
        timeLimitMs={1000}
        memoryLimitMb={256}
        tests={[
          { input: '1 2\n', output: '3\n' },
          { input: '3 4\n', output: '7\n' },
        ]}
      />,
    );
    expect(parseLikeHydro(container)).to.deep.equal({
      name: '#H1000. A + B Problem',
      tests: [
        { input: '1 2\n', output: '3\n' },
        { input: '3 4\n', output: '7\n' },
      ],
      timeLimit: 1000,
      memoryLimit: 256,
    });
    expect(container.querySelector('[data-krypton-companion="hydro"]')).toHaveAttribute('hidden');
  });
});

describe('competitive companion bridge', () => {
  it('keeps the send action and tells the student to parse with Hydro', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    render(
      <CompetitiveCompanionBridge
        name="#P5. 样例题"
        group="Krypton"
        url="http://10.1.234.2/p/P5"
        timeLimitMs={2000}
        memoryLimitMb={128}
        tests={[{ input: '0\n', output: '0\n' }]}
      />,
    );
    expect(screen.getByRole('button', { name: '发送到 CPH' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回传提交' })).not.toBeInTheDocument();
    expect(screen.getByText(/Parse with → Hydro/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发送到 CPH' }));
    expect(await screen.findByRole('button', { name: '已发送到 CPH' })).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalled();
    fetchImpl.mockRestore();
  });

  it('offers submit-back only when the page asks for it', async () => {
    const user = userEvent.setup();
    render(
      <CompetitiveCompanionBridge
        name="#P5. 样例题"
        group="Krypton"
        url="http://10.1.234.2/p/P5"
        timeLimitMs={2000}
        memoryLimitMb={128}
        tests={[]}
        canSubmitBack
        submitUrl="/p/P5/submit"
        allowedLangs={['cc.cc17', 'py.py3']}
      />,
    );
    await user.click(screen.getByRole('button', { name: '回传提交' }));
    expect(screen.getByRole('heading', { name: '从 CPH 回传提交' })).toBeInTheDocument();
    expect(screen.getByText(/只支持 Codeforces \/ CSES/)).toBeInTheDocument();
  });
});

describe('contest companion bridge', () => {
  it('hides the contest import action when the contest is not an individual ACM/IOI contest', () => {
    const { container } = render(
      <ContestCompanionBridge
        eligibility={{ allowed: false, reason: 'team', message: '团队赛不能整场导入 CPH' }}
        contestTitle="队赛"
        origin="http://oj.test"
        problems={[{ letter: 'A', title: 'A', href: '/p/1' }]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('imports an eligible contest as a companion batch', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
        return new Response(null, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          pdoc: {
            title: 'Add',
            pid: 'H1',
            problemKind: 'programming',
            content: '```input1\n1\n```\n```output1\n1\n```',
            config: { type: 'default', time: 1000, memory: 256 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    render(
      <ContestCompanionBridge
        eligibility={{ allowed: true }}
        contestTitle="校赛"
        origin="http://oj.test"
        problems={[{ letter: 'A', title: 'Add', href: '/p/1?tid=t' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '整场导入 CPH' }));
    expect(await screen.findByRole('button', { name: '已整场导入' })).toBeInTheDocument();
    expect(screen.getByText(/已导入 1 题/)).toBeInTheDocument();
    const sent = fetchImpl.mock.calls.find(([url]) => String(url) === 'http://127.0.0.1:27121/');
    expect(sent).not.to.equal(undefined);
    fetchImpl.mockRestore();
  });
});
