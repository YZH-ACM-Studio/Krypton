import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '../src/components/ui/switch';

function getNamedForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('expected a form');
  return form;
}

describe('Switch', () => {
  it('exposes role switch, not checkbox', () => {
    render(<Switch aria-label="启用" />);
    expect(screen.getByRole('switch', { name: '启用' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('toggles aria-checked and checked on click and Space', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="启用" />);
    const control = screen.getByRole('switch', { name: '启用' });

    expect(screen.getByRole('switch', { name: '启用', checked: false })).not.toBeChecked();

    await user.click(control);
    expect(screen.getByRole('switch', { name: '启用', checked: true })).toBeChecked();

    expect(control).toHaveFocus();
    await user.keyboard('[Space]');
    expect(screen.getByRole('switch', { name: '启用', checked: false })).not.toBeChecked();
  });

  it('toggles when a wrapping label is clicked', async () => {
    const user = userEvent.setup();
    render(
      <label>
        <Switch />
        启用通知
      </label>,
    );

    await user.click(screen.getByText('启用通知'));
    expect(screen.getByRole('switch', { checked: true })).toBeChecked();
  });

  it('calls onCheckedChange with the boolean state alongside onChange', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const onChange = vi.fn();
    render(<Switch aria-label="启用" onCheckedChange={onCheckedChange} onChange={onChange} />);

    await user.click(screen.getByRole('switch', { name: '启用' }));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('switch', { name: '启用' }));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('submits name=value in FormData only when checked', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <Switch name="notify" value="on" aria-label="通知" />
      </form>,
    );
    const form = getNamedForm(container);

    expect(new FormData(form).get('notify')).toBeNull();

    await user.click(screen.getByRole('switch', { name: '通知' }));
    expect(new FormData(form).get('notify')).toBe('on');
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const onChange = vi.fn();
    render(<Switch aria-label="启用" disabled onCheckedChange={onCheckedChange} onChange={onChange} />);

    const control = screen.getByRole('switch', { name: '启用' });
    await user.click(control);

    expect(control).not.toBeChecked();
    expect(screen.getByRole('switch', { name: '启用', checked: false })).toBeInTheDocument();
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('honors defaultChecked when uncontrolled', async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="启用" defaultChecked />);

    const control = screen.getByRole('switch', { name: '启用', checked: true });
    expect(control).toBeChecked();

    await user.click(control);
    expect(screen.getByRole('switch', { name: '启用', checked: false })).not.toBeChecked();
  });
});
