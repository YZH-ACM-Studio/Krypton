import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompetitiveCompanionBridge, HydroCompanionMarkup } from '../src/components/competitive-companion-bridge';

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

describe('Hydro companion markup', () => {
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

describe('Competitive Companion bridge', () => {
  it('keeps the send action and tells the student to parse with Hydro', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 0 }));
    vi.stubGlobal('fetch', fetchImpl);
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
    expect(screen.getByText(/Parse with → Hydro/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发送到 CPH' }));
    expect(await screen.findByRole('button', { name: '已发送到 CPH' })).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
