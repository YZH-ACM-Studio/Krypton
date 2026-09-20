import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '../src/components/ui/dialog.tsx';
import { MultiSelect } from '../src/components/ui/multi-select.tsx';
import { calculateAnchoredPopoverBox } from '../src/components/ui/tooltip-position.ts';

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

  it('portals the dropdown onto document.body so overflow parents cannot clip it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByPlaceholderText('搜索班级');
    await user.click(input);
    const option = screen.getByRole('button', { name: /一年级一班/ });
    expect(input.closest('.relative')?.contains(option)).to.equal(false);
    expect(document.body.contains(option)).to.equal(true);
  });

  it('pressing Escape inside a Dialog only closes the open menu', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    function DialogHarness() {
      const [value, setValue] = useState<Option[]>([]);
      return (
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>选择班级</DialogTitle>
            <MultiSelect
              options={OPTIONS}
              value={value}
              onChange={setValue}
              getKey={(item) => item.id}
              getLabel={(item) => item.label}
              placeholder="搜索班级"
            />
          </DialogContent>
        </Dialog>
      );
    }
    render(<DialogHarness />);
    const input = screen.getByPlaceholderText('搜索班级');
    await user.click(input);
    expect(screen.getByRole('button', { name: /一年级一班/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /一年级一班/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '选择班级' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clicking a Dialog submit button closes the open menu and still fires the button click', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    function DialogHarness() {
      const [value, setValue] = useState<Option[]>([]);
      return (
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>选择班级</DialogTitle>
            <MultiSelect
              options={OPTIONS}
              value={value}
              onChange={setValue}
              getKey={(item) => item.id}
              getLabel={(item) => item.label}
              placeholder="搜索班级"
            />
            <button type="button" onClick={onSubmit}>
              提交
            </button>
          </DialogContent>
        </Dialog>
      );
    }
    render(<DialogHarness />);
    await user.click(screen.getByPlaceholderText('搜索班级'));
    expect(screen.getByRole('button', { name: /一年级一班/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '提交' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /一年级一班/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '选择班级' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clicking the Dialog overlay closes the open menu without closing the Dialog', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    function DialogHarness() {
      const [value, setValue] = useState<Option[]>([]);
      return (
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>选择班级</DialogTitle>
            <MultiSelect
              options={OPTIONS}
              value={value}
              onChange={setValue}
              getKey={(item) => item.id}
              getLabel={(item) => item.label}
              placeholder="搜索班级"
            />
          </DialogContent>
        </Dialog>
      );
    }
    render(<DialogHarness />);
    await user.click(screen.getByPlaceholderText('搜索班级'));
    expect(screen.getByRole('button', { name: /一年级一班/ })).toBeInTheDocument();
    const overlay = document.querySelector('[data-krypton-dialog-root="true"]')?.firstElementChild;
    if (!(overlay instanceof HTMLElement)) throw new Error('Dialog overlay is missing');
    await user.click(overlay);
    expect(screen.queryByRole('button', { name: /一年级一班/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '选择班级' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('multiSelect remaining-viewport placement', () => {
  it('flips above the trigger when remaining space below is smaller', () => {
    const below = calculateAnchoredPopoverBox(
      { left: 16, top: 40, right: 216, bottom: 80, width: 200, height: 40 },
      { width: 320, height: 568 },
    );
    expect(below.side).to.equal('bottom');
    expect(below.top).to.equal(84);
    expect(below.maxHeight).to.equal(484);

    const above = calculateAnchoredPopoverBox(
      { left: 16, top: 500, right: 216, bottom: 540, width: 200, height: 40 },
      { width: 320, height: 568 },
    );
    expect(above.side).to.equal('top');
    expect(above.bottom).to.equal(72);
    expect(above.maxHeight).to.equal(496);
  });
});
