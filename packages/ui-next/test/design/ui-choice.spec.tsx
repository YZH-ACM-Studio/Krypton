// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../src/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../../src/components/ui/radio-group';
import { Switch } from '../../src/components/ui/switch';

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function tokensOf(root: Element): string[] {
  return [root, ...root.querySelectorAll('*')].flatMap((element) => classTokens(element));
}

function hasToken(root: Element, token: string): boolean {
  return tokensOf(root).includes(token);
}

/** Checked paint may be a direct class or the peer variant, because the native input can be uncontrolled. */
function hasCheckedToken(root: Element, token: string): boolean {
  return hasToken(root, token) || hasToken(root, `peer-checked:${token}`);
}

function asHtml(element: Element | null): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('expected an html element');
  }
  return element;
}

function asInput(element: Element): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    throw new TypeError('expected an input');
  }
  return element;
}

function requireForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) {
    throw new TypeError('expected a form');
  }
  return form;
}

function radioDot(root: HTMLElement): HTMLElement {
  const dot = [...root.querySelectorAll('span')].find((span) => {
    const tokens = classTokens(span);
    return tokens.includes('bg-brand') && tokens.includes('scale-0');
  });
  if (!(dot instanceof HTMLElement)) {
    throw new TypeError('expected the radio dot');
  }
  return dot;
}

describe('checkbox', () => {
  it('submits name=value from the native checkbox when defaultChecked', () => {
    const view = render(
      <form>
        <Checkbox name="agree" value="1" defaultChecked />
      </form>,
    );
    const form = requireForm(view.container);
    const input = asInput(screen.getByRole('checkbox'));

    expect(input).toHaveAttribute('type', 'checkbox');
    expect(input).toHaveAttribute('name', 'agree');
    expect(input).toHaveAttribute('value', '1');
    expect(input).toBeChecked();
    expect(new FormData(form).get('agree')).toBe('1');
  });

  it('calls onCheckedChange with true before onChange', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onCheckedChange = vi.fn((checked: boolean) => {
      order.push(`checked:${String(checked)}`);
    });
    const onChange = vi.fn(() => {
      order.push('change');
    });
    render(<Checkbox aria-label="同意" onCheckedChange={onCheckedChange} onChange={onChange} />);

    await user.click(screen.getByRole('checkbox', { name: '同意' }));

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(order).toEqual(['checked:true', 'change']);
  });

  it('sets the indeterminate DOM property', async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="半选" indeterminate />);
    const input = asInput(screen.getByRole('checkbox', { name: '半选' }));

    expect(input.indeterminate).toBe(true);

    await user.click(input);

    expect(input.indeterminate).toBe(true);
  });

  it('wraps label and description so the label text toggles the checkbox', async () => {
    const user = userEvent.setup();
    render(<Checkbox label="同意" description="说明" />);
    const checkbox = asInput(screen.getByLabelText('同意'));
    const caption = screen.getByText('同意');
    const description = screen.getByText('说明');
    const label = checkbox.closest('label');

    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(checkbox).not.toBeChecked();
    expect(label).toBeInstanceOf(HTMLLabelElement);
    if (!(label instanceof HTMLLabelElement)) {
      throw new TypeError('expected a label');
    }
    expect(classTokens(label)).toEqual(expect.arrayContaining(['inline-flex', 'items-start', 'gap-2.5']));
    expect(label).toContainElement(checkbox);
    expect(label).toContainElement(description);
    expect(classTokens(caption)).toEqual(expect.arrayContaining(['text-sm', 'text-fg']));
    expect(classTokens(description)).toEqual(expect.arrayContaining(['text-xs', 'text-fg-subtle']));
    expect(checkbox.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await user.click(caption);

    expect(checkbox).toBeChecked();
  });

  it('does not add a label wrapper when label is omitted', () => {
    const view = render(<Checkbox aria-label="同意" />);

    expect(view.container.querySelector('label')).toBeNull();
    expect(screen.getByRole('checkbox', { name: '同意' })).toBeInTheDocument();
  });

  it('puts className on the input parent and not on the input', () => {
    render(<Checkbox className="ml-2" aria-label="同意" />);
    const input = screen.getByRole('checkbox', { name: '同意' });
    const parent = asHtml(input.parentElement);

    expect(classTokens(input)).not.toContain('ml-2');
    expect(classTokens(parent)).toContain('ml-2');
  });

  it('keeps className on the original control when a label is present', () => {
    render(<Checkbox className="ml-2" label="同意" />);
    const input = screen.getByRole('checkbox');
    const parent = asHtml(input.parentElement);

    expect(classTokens(input)).not.toContain('ml-2');
    expect(classTokens(parent)).toContain('ml-2');
    expect(parent.tagName).not.toBe('LABEL');
  });

  it('draws the check as an svg immediately after the peer input', () => {
    render(<Checkbox aria-label="同意" />);
    const input = screen.getByRole('checkbox', { name: '同意' });
    const icon = input.nextElementSibling;

    expect(classTokens(input)).toContain('peer');
    expect(icon?.tagName.toLowerCase()).toBe('svg');
    if (!(icon instanceof Element)) {
      throw new TypeError('expected the check icon');
    }
    expect(classTokens(icon)).toEqual(
      expect.arrayContaining([
        '[stroke-dashoffset:1]',
        'peer-checked:[stroke-dashoffset:0]',
        'transition-[stroke-dashoffset]',
        'duration-(--dur-2)',
        'ease-(--ease-out)',
      ]),
    );
    const path = icon.firstElementChild;
    expect(path?.tagName.toLowerCase()).toBe('path');
    expect(path?.getAttribute('d')).toBe('M3.5 8.5l3 3 6-7');
    expect(path?.getAttribute('pathLength')).toBe('1');
    expect(path?.getAttribute('stroke-dasharray')).toBe('1');
  });

  it('paints an unchecked surface box and a checked brand box', () => {
    const off = render(<Checkbox aria-label="关" />);
    const offRoot = asHtml(screen.getByRole('checkbox', { name: '关' }).parentElement);
    expect(tokensOf(offRoot)).toEqual(expect.arrayContaining(['rounded-sm', 'border-line-strong', 'bg-surface', 'shadow-xs', 'size-4']));
    off.unmount();

    render(<Checkbox defaultChecked aria-label="开" />);
    const onRoot = asHtml(screen.getByRole('checkbox', { name: '开' }).parentElement);
    expect(hasCheckedToken(onRoot, 'bg-brand')).toBe(true);
    expect(hasCheckedToken(onRoot, 'border-brand')).toBe(true);
    expect(hasCheckedToken(onRoot, 'text-on-brand')).toBe(true);
  });

  it('uses the 14px box for size sm', () => {
    render(<Checkbox size="sm" aria-label="同意" />);
    const root = asHtml(screen.getByRole('checkbox', { name: '同意' }).parentElement);

    expect(hasToken(root, 'size-3.5')).toBe(true);
  });

  it('forwards the ref to the native checkbox', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} aria-label="同意" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.type).toBe('checkbox');
  });

  it('forwards a callback ref to the native checkbox', () => {
    const seenA: Array<HTMLInputElement | null> = [];
    const seenB: Array<HTMLInputElement | null> = [];
    const refA = (node: HTMLInputElement | null) => {
      seenA.push(node);
    };
    const refB = (node: HTMLInputElement | null) => {
      seenB.push(node);
    };
    const view = render(<Checkbox ref={refA} aria-label="同意" />);
    const input = asInput(screen.getByRole('checkbox', { name: '同意' }));

    expect(seenA.at(-1)).toBe(input);

    view.rerender(<Checkbox ref={refB} aria-label="同意" />);

    expect(seenB.at(-1)).toBe(input);
    expect(seenA.at(-1)).toBeNull();
  });

  it('moves an object ref onto the same input when the ref identity changes', () => {
    const refA = createRef<HTMLInputElement>();
    const refB = createRef<HTMLInputElement>();
    const view = render(<Checkbox ref={refA} aria-label="同意" />);
    const input = asInput(screen.getByRole('checkbox', { name: '同意' }));

    expect(refA.current).toBe(input);

    view.rerender(<Checkbox ref={refB} aria-label="同意" />);

    expect(refB.current).toBe(input);
    expect(refA.current).toBeNull();
  });

  it('updates the indeterminate property when the prop changes', async () => {
    const user = userEvent.setup();
    const view = render(<Checkbox aria-label="半选" indeterminate={false} />);
    expect(asInput(screen.getByRole('checkbox', { name: '半选' })).indeterminate).toBe(false);

    view.rerender(<Checkbox aria-label="半选" indeterminate />);
    const input = asInput(screen.getByRole('checkbox', { name: '半选' }));
    expect(input.indeterminate).toBe(true);

    await user.click(input);

    expect(input.indeterminate).toBe(true);

    view.rerender(<Checkbox aria-label="半选" indeterminate={false} />);
    expect(asInput(screen.getByRole('checkbox', { name: '半选' })).indeterminate).toBe(false);

    view.rerender(<Checkbox aria-label="半选" indeterminate />);
    expect(asInput(screen.getByRole('checkbox', { name: '半选' })).indeterminate).toBe(true);

    view.rerender(<Checkbox label="半选" indeterminate />);
    expect(asInput(screen.getByRole('checkbox', { name: '半选' })).indeterminate).toBe(true);
  });

  it('ignores description when label is omitted', () => {
    const view = render(<Checkbox aria-label="同意" description="说明" />);

    expect(view.container.querySelector('label')).toBeNull();
    expect(screen.queryByText('说明')).toBeNull();
    expect(screen.getByRole('checkbox', { name: '同意' })).toBeInTheDocument();
  });

  it('draws a minus bar instead of the check when indeterminate', () => {
    render(<Checkbox aria-label="半选" indeterminate />);
    const input = screen.getByRole('checkbox', { name: '半选' });
    const icon = input.nextElementSibling;
    if (!(icon instanceof Element)) {
      throw new TypeError('expected the indeterminate icon');
    }
    const path = icon.firstElementChild;
    expect(path?.tagName.toLowerCase()).toBe('path');
    expect(path?.getAttribute('d')).toBe('M4 8h8');
  });
});

describe('radio group', () => {
  it('unchecks the first native radio after the second item with the same name is clicked', async () => {
    const user = userEvent.setup();
    render(
      <form>
        <RadioGroupItem name="color" value="red" aria-label="红" defaultChecked />
        <RadioGroupItem name="color" value="blue" aria-label="蓝" />
      </form>,
    );
    const first = asInput(screen.getByRole('radio', { name: '红' }));
    const second = asInput(screen.getByRole('radio', { name: '蓝' }));

    expect(first).toHaveAttribute('type', 'radio');
    expect(second).toHaveAttribute('type', 'radio');
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();

    await user.click(second);

    expect(second).toBeChecked();
    expect(first).not.toBeChecked();
  });

  it('puts className on the radio input', () => {
    render(<RadioGroupItem className="ml-2" name="color" value="red" aria-label="红" />);
    const input = screen.getByRole('radio', { name: '红' });

    expect(classTokens(input)).toContain('ml-2');
  });

  it('exposes a radiogroup for the existing group wrapper', () => {
    render(
      <RadioGroup aria-label="颜色">
        <RadioGroupItem name="color" value="red" aria-label="红" />
      </RadioGroup>,
    );

    expect(screen.getByRole('radiogroup', { name: '颜色' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '红' })).toBeInTheDocument();
  });

  it('colors the label and description with fg tokens', () => {
    render(<RadioGroupItem name="tone" value="info" label="提示" description="说明" />);

    expect(classTokens(screen.getByText('提示'))).toEqual(expect.arrayContaining(['text-sm', 'text-fg']));
    expect(classTokens(screen.getByText('说明'))).toEqual(expect.arrayContaining(['text-xs', 'text-fg-subtle']));
  });

  it('scales a brand dot from scale-0 to scale-100 with the dur-2 ease-out transition', () => {
    const off = render(<RadioGroupItem name="tone" value="info" aria-label="关" />);
    const offRoot = asHtml(screen.getByRole('radio', { name: '关' }).closest('label'));
    expect(tokensOf(offRoot)).toEqual(
      expect.arrayContaining(['size-4', 'rounded-full', 'bg-brand', 'scale-0', 'transition-transform', 'duration-(--dur-2)', 'ease-(--ease-out)']),
    );
    off.unmount();

    render(<RadioGroupItem name="tone" value="info" aria-label="开" defaultChecked />);
    const onRoot = asHtml(screen.getByRole('radio', { name: '开' }).closest('label'));
    expect(hasCheckedToken(onRoot, 'scale-100')).toBe(true);
    expect(hasCheckedToken(onRoot, 'border-brand')).toBe(true);
  });

  it('forwards the ref to the native radio', () => {
    const ref = createRef<HTMLInputElement>();
    render(<RadioGroupItem ref={ref} name="color" value="red" aria-label="红" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.type).toBe('radio');
  });

  it('uses an 8px dot at md and a 6px dot at sm', () => {
    const md = render(<RadioGroupItem name="tone" value="info" aria-label="中" />);
    const mdRoot = asHtml(screen.getByRole('radio', { name: '中' }).closest('label'));
    expect(classTokens(radioDot(mdRoot))).toContain('size-2');
    expect(classTokens(radioDot(mdRoot))).not.toContain('size-1.5');
    md.unmount();

    render(<RadioGroupItem name="tone" value="info" size="sm" aria-label="小" />);
    const smRoot = asHtml(screen.getByRole('radio', { name: '小' }).closest('label'));
    expect(hasToken(smRoot, 'size-3.5')).toBe(true);
    expect(classTokens(radioDot(smRoot))).toContain('size-1.5');
    expect(classTokens(radioDot(smRoot))).not.toContain('size-2');
  });

  it('shows a label without a description and a description without a label', () => {
    const labelOnly = render(<RadioGroupItem name="tone" value="a" label="仅标题" />);
    expect(classTokens(screen.getByText('仅标题'))).toEqual(expect.arrayContaining(['text-sm', 'text-fg']));
    expect(screen.queryByText('仅说明')).toBeNull();
    labelOnly.unmount();

    render(<RadioGroupItem name="tone" value="b" aria-label="说明项" description="仅说明" />);
    expect(classTokens(screen.getByText('仅说明'))).toEqual(expect.arrayContaining(['text-xs', 'text-fg-subtle']));
    expect(screen.queryByText('仅标题')).toBeNull();
  });

  it('honors an explicit id on the input and the label', () => {
    render(<RadioGroupItem id="tone-info" name="tone" value="info" label="提示" />);
    const input = asInput(screen.getByRole('radio', { name: '提示' }));
    const label = asHtml(input.closest('label'));

    expect(input).toHaveAttribute('id', 'tone-info');
    expect(label).toHaveAttribute('for', 'tone-info');
  });
});

describe('switch', () => {
  it('calls onCheckedChange(true) and keeps role=switch on the native checkbox', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="启用" onCheckedChange={onCheckedChange} />);
    const input = asInput(screen.getByRole('switch', { name: '启用' }));

    expect(input).toHaveAttribute('type', 'checkbox');
    expect(input).toHaveAttribute('role', 'switch');

    await user.click(input);

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('calls onCheckedChange before onChange', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onCheckedChange = vi.fn((checked: boolean) => {
      order.push(`checked:${String(checked)}`);
    });
    const onChange = vi.fn(() => {
      order.push('change');
    });
    render(<Switch aria-label="启用" onCheckedChange={onCheckedChange} onChange={onChange} />);

    await user.click(screen.getByRole('switch', { name: '启用' }));

    expect(order).toEqual(['checked:true', 'change']);
  });

  it('puts className on the wrapping span', () => {
    render(<Switch className="x" aria-label="启用" />);
    const input = screen.getByRole('switch', { name: '启用' });
    const wrap = asHtml(input.parentElement);

    expect(wrap.tagName).toBe('SPAN');
    expect(classTokens(wrap)).toContain('x');
    expect(classTokens(input)).not.toContain('x');
  });

  it('uses the md track, a white shadowed thumb, and a css translate', () => {
    const off = render(<Switch aria-label="启用" />);
    const offRoot = asHtml(screen.getByRole('switch', { name: '启用' }).parentElement);
    expect(tokensOf(offRoot)).toEqual(
      expect.arrayContaining([
        'bg-line-strong',
        'h-5',
        'w-9',
        'size-4',
        'bg-white',
        'shadow-sm',
        'transition-transform',
        'duration-(--dur-2)',
        'ease-(--ease-out)',
      ]),
    );
    expect(tokensOf(offRoot).some((token) => token.includes('translate-x'))).toBe(true);
    off.unmount();

    render(<Switch defaultChecked aria-label="启用" />);
    const onRoot = asHtml(screen.getByRole('switch', { name: '启用' }).parentElement);
    expect(hasCheckedToken(onRoot, 'bg-brand')).toBe(true);
  });

  it('uses the sm track and 12px thumb', () => {
    render(<Switch size="sm" aria-label="启用" />);
    const root = asHtml(screen.getByRole('switch', { name: '启用' }).parentElement);

    expect(hasToken(root, 'h-4')).toBe(true);
    expect(hasToken(root, 'w-7')).toBe(true);
    expect(hasToken(root, 'size-3')).toBe(true);
    expect(hasToken(root, 'w-9')).toBe(false);
    expect(hasToken(root, 'size-4')).toBe(false);
  });

  it('does not import motion for the thumb', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/components/ui/switch.tsx'), 'utf8');

    expect(source.includes("from 'motion")).toBe(false);
    expect(source.includes('from "motion')).toBe(false);
    expect(source.includes('motion/react')).toBe(false);
  });

  it('forwards the ref to the native switch input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Switch ref={ref} aria-label="启用" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toHaveAttribute('role', 'switch');
  });

  it('slides the md thumb 16px and the sm thumb 12px', () => {
    const md = render(<Switch aria-label="中" />);
    const mdRoot = asHtml(screen.getByRole('switch', { name: '中' }).parentElement);
    expect(hasToken(mdRoot, 'size-4')).toBe(true);
    expect(hasToken(mdRoot, 'peer-checked:translate-x-4')).toBe(true);
    expect(hasToken(mdRoot, 'peer-checked:translate-x-3')).toBe(false);
    md.unmount();

    render(<Switch size="sm" aria-label="小" />);
    const smRoot = asHtml(screen.getByRole('switch', { name: '小' }).parentElement);
    expect(hasToken(smRoot, 'size-3')).toBe(true);
    expect(hasToken(smRoot, 'peer-checked:translate-x-3')).toBe(true);
    expect(hasToken(smRoot, 'peer-checked:translate-x-4')).toBe(false);
  });
});
