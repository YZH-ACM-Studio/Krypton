import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MultiSelect } from '../src/components/ui/multi-select.tsx';

interface Option {
  id: string;
  label: string;
}

const OPTIONS: Option[] = [
  { id: 'g1', label: '一年级一班' },
  { id: 'g2', label: '二年级二班' },
];

function Harness() {
  const [value, setValue] = useState<Option[]>([]);
  return (
    <MultiSelect
      options={OPTIONS}
      value={value}
      onChange={setValue}
      getKey={(item) => item.id}
      getLabel={(item) => item.label}
      placeholder="搜索班级"
    />
  );
}

describe('multiSelect search query', () => {
  it('clears the typed query after clicking a match so the next search can start immediately', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByPlaceholderText('搜索班级');
    await user.type(input, '一年');

    expect(input).toHaveValue('一年');
    expect(screen.getByRole('button', { name: /一年级一班/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /二年级二班/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /一年级一班/ }));

    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: /二年级二班/ })).toBeInTheDocument();
  });

  it('also clears the query when confirming a highlighted match with Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByPlaceholderText('搜索班级');
    await user.type(input, '二年');
    expect(input).toHaveValue('二年');
    await user.keyboard('{Enter}');

    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: /一年级一班/ })).toBeInTheDocument();
  });
});
