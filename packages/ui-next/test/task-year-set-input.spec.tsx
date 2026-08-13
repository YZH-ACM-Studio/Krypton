import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TaskYearSetInput } from '../src/components/task-year-set-input.tsx';

function Harness({ initial = [] }: { initial?: number[] }) {
  const [years, setYears] = useState(initial);
  return <TaskYearSetInput value={years} onChange={setYears} inputLabel="输入入学年份" scopeKey="node-a:years" />;
}

describe('task year set input', () => {
  it('keeps a partially typed year until the user explicitly adds it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole('spinbutton', { name: '输入入学年份' });
    await user.type(input, '2023');

    expect(input).toHaveValue(2023);
    expect(screen.queryByText('2023 年')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加入学年份' }));

    expect(input).toHaveValue(null);
    expect(screen.getByText('2023 年')).toBeInTheDocument();
  });

  it('keeps the year set unique and allows removing an existing year', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[2023]} />);

    const input = screen.getByRole('spinbutton', { name: '输入入学年份' });
    await user.type(input, '2023');
    await user.click(screen.getByRole('button', { name: '添加入学年份' }));

    expect(screen.getAllByText('2023 年')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '移除 2023 年' }));
    expect(screen.queryByText('2023 年')).not.toBeInTheDocument();
  });

  it('does not carry an unfinished draft into another task node', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TaskYearSetInput value={[]} onChange={() => undefined} inputLabel="输入入学年份" scopeKey="node-a:years" />);
    const input = screen.getByRole('spinbutton', { name: '输入入学年份' });
    await user.type(input, '202');
    expect(input).toHaveValue(202);

    rerender(<TaskYearSetInput value={[]} onChange={() => undefined} inputLabel="输入入学年份" scopeKey="node-b:years" />);

    expect(screen.getByRole('spinbutton', { name: '输入入学年份' })).toHaveValue(null);
  });

  it('fails closed instead of silently dropping an invalid stored year', () => {
    render(<TaskYearSetInput value={[2023, 'invalid']} onChange={() => undefined} inputLabel="输入入学年份" scopeKey="node-a:years" />);

    expect(screen.getByRole('alert')).toHaveTextContent('现有年份配置格式无效');
    expect(screen.queryByRole('spinbutton', { name: '输入入学年份' })).not.toBeInTheDocument();
  });
});
