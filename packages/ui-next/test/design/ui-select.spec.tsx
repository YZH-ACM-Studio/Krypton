// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from '../../src/components/ui/multi-select';
import { calculateAnchoredPopoverBox } from '../../src/components/ui/tooltip-position';
import {
  renderSimpleSelectOptions,
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
  SimpleSelect,
  type SimpleSelectOption,
  type SimpleSelectProps,
} from '../../src/components/ui/select';

function readSource(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '../../', relativePath), 'utf8');
}

function isReactNode(value: unknown): value is ReactNode {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isReactNode(entry));
  }
  return isValidElement(value);
}

/** SelectItem needs Radix context, so the hint is asserted from the option children instead of opening the menu. */
function optionChildren(option: SimpleSelectOption): ReactNode {
  const node = renderSimpleSelectOptions([option])[0];
  if (!isValidElement(node)) {
    throw new TypeError('expected a select option element');
  }
  const props: unknown = node.props;
  if (typeof props !== 'object' || props === null || !('children' in props) || !isReactNode(props.children)) {
    throw new TypeError('expected option children');
  }
  return props.children;
}

function hintedOption(): SimpleSelectOption {
  return Object.assign({ value: 'a', label: 'A' } satisfies SimpleSelectOption, { hint: '罚时' });
}

function withInvalid(props: SimpleSelectProps): SimpleSelectProps {
  return Object.assign({}, props, { invalid: true });
}

function hiddenInput(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector(`input[type="hidden"][name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError('expected a hidden input');
  }
  return input;
}

function classTokens(className: string | null | undefined): string[] {
  return (className ?? '').split(/\s+/).filter((token) => token.length > 0);
}

interface Choice {
  id: string;
  label: string;
}

const CHOICES: Choice[] = [
  { id: 'a', label: '甲' },
  { id: 'b', label: '乙' },
];

const LONG_CHOICES: Choice[] = Array.from({ length: 30 }, (_, index) => ({
  id: `row-${index}`,
  label: `第${index}项`,
}));

const CAPPED_TRIGGER = new DOMRect(8, 40, 180, 32);
const CAPPED_VIEWPORT = { width: 400, height: 120 };

function paddingTokens(className: string | null | undefined): string[] {
  return classTokens(className).filter((token) => /^(?:p|px|py|pt|pr|pb|pl)-/.test(token));
}

function scrollViewport(menu: HTMLElement): HTMLElement {
  const viewport = menu.querySelector('[data-radix-scroll-area-viewport]');
  if (!(viewport instanceof HTMLElement)) {
    throw new TypeError('expected a scroll viewport');
  }
  return viewport;
}

function renderChoices(props?: { value?: Choice[]; minHeight?: number }) {
  return render(
    <MultiSelect<Choice>
      options={CHOICES}
      value={props?.value ?? []}
      onChange={() => {}}
      getKey={(item) => item.id}
      getLabel={(item) => item.label}
      placeholder="搜索"
      minHeight={props?.minHeight}
    />,
  );
}

function choiceShell(): HTMLElement {
  const input = screen.getByRole('textbox');
  const shell = input.parentElement?.parentElement;
  if (!(shell instanceof HTMLElement)) {
    throw new TypeError('expected the multi-select trigger');
  }
  return shell;
}

function openChoiceMenu(): HTMLElement {
  fireEvent.focus(screen.getByRole('textbox'));
  const menu = document.querySelector('[data-state="open"]');
  expect(menu).toBeInstanceOf(HTMLElement);
  if (!(menu instanceof HTMLElement)) {
    throw new TypeError('expected an open menu');
  }
  return menu;
}

describe('simple select', () => {
  it('renders an option hint on the right in subtle text', () => {
    const markup = renderToStaticMarkup(<div>{optionChildren(hintedOption())}</div>);

    expect(markup).toContain('罚时');
    expect(markup).toContain('ml-auto');
    expect(markup).toContain('text-xs');
    expect(markup).toContain('text-fg-subtle');
  });

  it('marks the trigger aria-invalid when invalid', () => {
    render(
      <SimpleSelect
        {...withInvalid({
          name: 'rule',
          defaultValue: 'acm',
          options: [{ value: 'acm', label: 'ACM' }],
        })}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps an empty string on the hidden input for an empty default value', () => {
    const view = render(
      <SimpleSelect
        name="rule"
        defaultValue=""
        options={[
          { value: '', label: '不限' },
          { value: 'acm', label: 'ACM' },
        ]}
      />,
    );

    expect(hiddenInput(view.container, 'rule').value).toBe('');
  });

  it('uses z-50 and drops the arbitrary select menu z-index', () => {
    const source = readSource('src/components/ui/select.tsx');

    expect(source.includes('z-[250]')).toBe(false);
    expect(source.includes('z-50')).toBe(true);
  });

  it('sizes the trigger with the control height for sm and md', () => {
    const view = render(<SimpleSelect options={[{ value: 'acm', label: 'ACM' }]} defaultValue="acm" />);
    const medium = screen.getByRole('combobox');

    expect(classTokens(medium.className)).toContain('h-(--control-md)');
    expect(classTokens(medium.className)).toContain('text-sm');
    expect(classTokens(medium.className)).not.toContain('h-(--control-sm)');

    view.rerender(<SimpleSelect size="sm" options={[{ value: 'acm', label: 'ACM' }]} defaultValue="acm" />);
    const small = screen.getByRole('combobox');

    expect(classTokens(small.className)).toContain('h-(--control-sm)');
    expect(classTokens(small.className)).toContain('text-xs');
    expect(classTokens(small.className)).not.toContain('h-(--control-md)');
  });

  it('rotates the chevron with the open-state transition', () => {
    render(<SimpleSelect options={[{ value: 'acm', label: 'ACM' }]} />);
    const chevron = screen.getByRole('combobox').querySelector('svg');

    expect(chevron).toBeInstanceOf(SVGElement);
    expect(classTokens(chevron?.getAttribute('class'))).toContain('group-data-[state=open]:rotate-180');
    expect(classTokens(chevron?.getAttribute('class'))).toContain('duration-(--dur-2)');
    expect(classTokens(chevron?.getAttribute('class'))).toContain('ease-(--ease-out)');
  });

  it('does not mark a valid trigger as aria-invalid', () => {
    render(<SimpleSelect options={[{ value: 'acm', label: 'ACM' }]} />);

    expect(screen.getByRole('combobox').hasAttribute('aria-invalid')).toBe(false);
  });

  it('renders a numeric zero hint', () => {
    const markup = renderToStaticMarkup(<div>{optionChildren({ value: 'a', label: 'A', hint: 0 })}</div>);

    expect(markup).toContain('>0<');
    expect(markup).toContain('text-fg-subtle');
  });

  it('keeps the hint on the option and out of the selected value', () => {
    render(
      <Select open onOpenChange={() => {}} defaultValue="a">
        <SelectTrigger aria-label="规则">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {renderSimpleSelectOptions([
            { value: 'a', label: 'A', hint: '罚时' },
            { value: 'b', label: 'B' },
          ])}
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: '规则', hidden: true });
    const listbox = screen.getByRole('listbox');
    const selected = screen.getByRole('option', { name: 'A' });
    const check = selected.querySelector('svg');

    expect(trigger.textContent).toContain('A');
    expect(trigger.textContent).not.toContain('罚时');
    expect(selected.textContent).toContain('罚时');
    expect(classTokens(listbox.className)).toContain('z-50');
    expect(classTokens(listbox.className)).toContain('shadow-pop');
    expect(classTokens(listbox.className)).toContain('rounded-lg');
    expect(classTokens(listbox.className)).toContain('border-line');
    expect(classTokens(listbox.className)).toContain('bg-surface-raised');
    expect(classTokens(listbox.className)).toContain('data-[state=open]:animate-[kr-pop-in_var(--dur-3)_var(--ease-out)]');
    expect(classTokens(listbox.className)).toContain('data-[state=closed]:animate-[kr-pop-out_var(--dur-2)_var(--ease-in)]');
    expect(classTokens(listbox.className)).toContain('w-(--radix-select-trigger-width)');
    expect(check).toBeInstanceOf(SVGElement);
    expect(classTokens(check?.getAttribute('class'))).toContain('text-brand-fg');
  });
});

describe('multi select', () => {
  it('drops z-250 from the menu source', () => {
    const source = readSource('src/components/ui/multi-select.tsx');

    expect(source.includes('z-250')).toBe(false);
    expect(source.includes('z-[250]')).toBe(false);
    expect(source.includes('z-50')).toBe(true);
  });

  it('uses the control-lg min height unless a pixel minHeight is set', () => {
    const view = renderChoices();
    const omitted = choiceShell();

    expect(classTokens(omitted.className)).toContain('min-h-(--control-lg)');
    expect(omitted.style.minHeight).toBe('');

    view.rerender(
      <MultiSelect<Choice>
        options={CHOICES}
        value={[]}
        onChange={() => {}}
        getKey={(item) => item.id}
        getLabel={(item) => item.label}
        placeholder="搜索"
        minHeight={48}
      />,
    );
    const explicit = choiceShell();

    expect(explicit.style.minHeight).toBe('48px');
    expect(classTokens(explicit.className)).not.toContain('min-h-(--control-lg)');
  });

  it('opens a raised menu from the trigger edge and highlights the current row', () => {
    renderChoices();
    const menu = openChoiceMenu();
    const shell = choiceShell();
    const chevron = [...shell.querySelectorAll('svg')].find((svg) => classTokens(svg.getAttribute('class')).includes('transition-transform'));
    const current = screen.getByRole('button', { name: '甲' });
    const other = screen.getByRole('button', { name: '乙' });

    expect(menu.getAttribute('data-state')).toBe('open');
    expect(menu.style.transformOrigin).toBe('top center');
    expect(classTokens(menu.className)).toContain('z-50');
    expect(classTokens(menu.className)).toContain('shadow-pop');
    expect(classTokens(menu.className)).toContain('rounded-lg');
    expect(classTokens(menu.className)).toContain('bg-surface-raised');
    expect(classTokens(menu.className)).toContain('data-[state=open]:animate-[kr-pop-in_var(--dur-3)_var(--ease-out)]');
    expect(classTokens(menu.className)).toContain('data-[state=closed]:animate-[kr-pop-out_var(--dur-2)_var(--ease-in)]');
    expect(classTokens(chevron?.getAttribute('class'))).toContain('rotate-180');
    expect(classTokens(chevron?.getAttribute('class'))).toContain('duration-(--dur-2)');
    expect(classTokens(chevron?.getAttribute('class'))).toContain('ease-(--ease-out)');
    expect(classTokens(current.className)).toContain('bg-surface-hover');
    expect(classTokens(current.className)).not.toContain('hover:bg-surface-hover');
    expect(classTokens(other.className)).toContain('hover:bg-surface-hover');
    expect(classTokens(other.className)).not.toContain('bg-surface-hover');
  });

  it('keeps the last row reachable when a long menu is height capped', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(CAPPED_TRIGGER);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(CAPPED_VIEWPORT.height);
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(CAPPED_VIEWPORT.width);
    try {
      render(
        <MultiSelect<Choice>
          options={LONG_CHOICES}
          value={[]}
          onChange={() => {}}
          getKey={(item) => item.id}
          getLabel={(item) => item.label}
          placeholder="搜索"
        />,
      );
      const menu = openChoiceMenu();
      const cap = calculateAnchoredPopoverBox(CAPPED_TRIGGER, CAPPED_VIEWPORT);
      const last = screen.getByRole('button', { name: '第29项' });
      const viewport = scrollViewport(menu);
      const padded = [...viewport.querySelectorAll('*')].find(
        (element) => element instanceof HTMLElement && classTokens(element.className).includes('p-1'),
      );

      expect(cap.maxHeight).toBeGreaterThan(0);
      expect(cap.maxHeight).toBeLessThan(LONG_CHOICES.length * 24);
      expect(menu.style.maxHeight).toBe(`${cap.maxHeight}px`);
      expect(viewport.contains(last)).toBe(true);
      // Padding on the overflow-hidden maxHeight root clips the tail; keep p-1 inside the scrollport.
      expect(paddingTokens(menu.className)).toEqual([]);
      expect(padded).toBeInstanceOf(HTMLElement);
      if (!(padded instanceof HTMLElement)) {
        throw new TypeError('expected menu padding inside the scrollport');
      }
      expect(padded.contains(last)).toBe(true);
    } finally {
      rectSpy.mockRestore();
      heightSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });

  it('renders a selected chip with the neutral badge surface', () => {
    renderChoices({ value: [{ id: 'a', label: '甲' }] });
    const chip = screen.getByText('甲').parentElement;

    expect(chip).toBeInstanceOf(HTMLElement);
    expect(classTokens(chip?.className)).toContain('bg-surface-active');
    expect(classTokens(chip?.className)).toContain('rounded-sm');
    expect(classTokens(chip?.className)).toContain('text-fg');
    expect(screen.getByRole('button', { name: '移除' })).toBeInTheDocument();
  });
});
