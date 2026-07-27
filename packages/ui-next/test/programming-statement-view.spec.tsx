import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgrammingStatementView, type ProgrammingStatementViewData } from '../src/components/programming-statement.tsx';

function statementWithExample(): ProgrammingStatementViewData {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    description: { state: 'present', content: '求和。' },
    input: { state: 'present', content: '两个整数。' },
    output: { state: 'present', content: '它们的和。' },
    examples: {
      items: [
        {
          input: '1 2\n',
          inputEmpty: false,
          output: '3\n',
          outputEmpty: false,
          note: '',
        },
      ],
    },
    limits: { complete: true, time: 1000, memory: 256 },
  };
}

describe('programming statement examples', () => {
  it('copies structured sample input and output through the shared sample control', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ProgrammingStatementView statement={statementWithExample()} limits={<span>1 s / 256 MB</span>} />);

    fireEvent.click(screen.getByRole('button', { name: '复制样例 1 输入' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('1 2\n'));

    fireEvent.click(screen.getByRole('button', { name: '复制样例 1 输出' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('3\n'));
  });

  it('copies an explicitly empty structured sample and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const statement = statementWithExample();
    const example = statement.examples?.items[0];
    if (!example) throw new Error('Test fixture must include one example');
    example.input = '';
    example.inputEmpty = true;

    render(<ProgrammingStatementView statement={statement} limits={<span>1 s / 256 MB</span>} />);

    fireEvent.click(screen.getByRole('button', { name: '复制样例 1 输入' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(''));
    expect(screen.getByRole('button', { name: '复制样例 1 输入' })).toHaveTextContent('已复制');
  });
});
