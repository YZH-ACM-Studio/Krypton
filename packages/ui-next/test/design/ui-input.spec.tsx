// @vitest-environment jsdom
import { createRef, type ComponentProps, type ComponentType, type ReactNode, type Ref } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DateTime } from '../../src/components/ui/datetime';
import * as inputModule from '../../src/components/ui/input';
import * as textareaModule from '../../src/components/ui/textarea';

const FIELD_CHROME = ['rounded-md', 'border', 'border-line-strong', 'bg-surface', 'shadow-xs', 'hover:border-fg-disabled'] as const;
const FOCUS_RING = ['border-brand', 'ring-3', 'ring-ring/40'] as const;
const BARE_FOCUS = ['focus:', 'focus-visible:'] as const;
const SHELL_FOCUS = ['focus-within:'] as const;
const DISABLED_CHROME = ['bg-surface-sunken', 'text-fg-disabled', 'cursor-not-allowed'] as const;
const SHELL_DISABLED = [
  'has-disabled:bg-surface-sunken',
  'has-disabled:text-fg-disabled',
  'has-disabled:cursor-not-allowed',
] as const;
const CONTROL_HEIGHT = {
  sm: 'h-(--control-sm)',
  md: 'h-(--control-md)',
  lg: 'h-(--control-lg)',
} as const;
const CONTROL_TEXT = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-md',
} as const;

type ControlSize = keyof typeof CONTROL_HEIGHT;

interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: ControlSize;
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

type SearchInputProps = InputProps & { shortcut?: string };

type TextareaProps = ComponentProps<'textarea'> & {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
};

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function readExport(record: unknown, key: string): unknown {
  if (typeof record !== 'object' || record === null || !(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key);
}

function isRenderable(value: unknown): value is ComponentType<never> {
  if (typeof value === 'function') {
    return true;
  }
  if (typeof value !== 'object' || value === null || !('render' in value)) {
    return false;
  }
  return typeof Reflect.get(value, 'render') === 'function';
}

function requireComponent<Props>(record: unknown, key: string): ComponentType<Props> {
  const value = readExport(record, key);
  if (!isRenderable(value)) {
    throw new TypeError(`${key} must be a component`);
  }
  return value as ComponentType<Props>;
}

const Input = requireComponent<InputProps>(inputModule, 'Input');
const Textarea = requireComponent<TextareaProps>(textareaModule, 'Textarea');

function loadSearchInput(): ComponentType<SearchInputProps> | undefined {
  const value = readExport(inputModule, 'SearchInput');
  if (!isRenderable(value)) {
    return undefined;
  }
  return value as ComponentType<SearchInputProps>;
}

function asInput(value: Element | null): HTMLInputElement {
  expect(value).toBeInstanceOf(HTMLInputElement);
  if (!(value instanceof HTMLInputElement)) {
    throw new TypeError('expected an input');
  }
  return value;
}

function asShell(value: Element | null): HTMLElement {
  expect(value).toBeInstanceOf(HTMLElement);
  if (!(value instanceof HTMLElement)) {
    throw new TypeError('expected an input shell');
  }
  return value;
}

function asTextarea(value: Element | null): HTMLTextAreaElement {
  expect(value).toBeInstanceOf(HTMLTextAreaElement);
  if (!(value instanceof HTMLTextAreaElement)) {
    throw new TypeError('expected a textarea');
  }
  return value;
}

function asTime(value: Element | null): HTMLTimeElement {
  expect(value).toBeInstanceOf(HTMLTimeElement);
  if (!(value instanceof HTMLTimeElement)) {
    throw new TypeError('expected a time element');
  }
  return value;
}

function fieldInput(container: ParentNode): HTMLInputElement {
  const input = asInput(container.querySelector('input'));
  expect(container.querySelectorAll('input')).toHaveLength(1);
  expect(input).toHaveAttribute('data-slot', 'input');
  return input;
}

function inputShell(container: ParentNode): HTMLElement {
  const shell = asShell(container.querySelector('[data-slot="input-shell"]'));
  expect(container.querySelectorAll('[data-slot="input-shell"]')).toHaveLength(1);
  return shell;
}

function hasPrefixedToken(element: Element, prefixes: readonly string[], token: string): boolean {
  const tokens = classTokens(element);
  return prefixes.some((prefix) => tokens.includes(`${prefix}${token}`));
}

function hasAnyToken(element: Element, tokens: readonly string[]): boolean {
  const present = classTokens(element);
  return tokens.some((token) => present.includes(token));
}

function expectChrome(element: Element): void {
  expect(classTokens(element)).toEqual(expect.arrayContaining([...FIELD_CHROME]));
}

function expectFocusRing(element: Element, prefixes: readonly string[]): void {
  for (const token of FOCUS_RING) {
    expect(hasPrefixedToken(element, prefixes, token), `${prefixes.join('|')}${token}`).toBe(true);
  }
}

function expectDisabledChrome(element: Element): void {
  for (const token of DISABLED_CHROME) {
    expect(hasAnyToken(element, [token, `disabled:${token}`, `has-disabled:${token}`]), token).toBe(true);
  }
}

/** A shell is not itself disabled, so only has-disabled: paints the icon area. */
function expectShellDisabled(shell: Element): void {
  expect(classTokens(shell)).toEqual(expect.arrayContaining([...SHELL_DISABLED]));
}

function expectDangerBorder(element: Element): void {
  const tokens = classTokens(element);
  expect(tokens.includes('border-danger') || tokens.some((token) => token.endsWith(':border-danger'))).toBe(true);
}

function expectControlSize(element: Element, size: ControlSize): void {
  expect(classTokens(element)).toContain(CONTROL_HEIGHT[size]);
  expect(classTokens(element)).toContain(CONTROL_TEXT[size]);
  for (const key of ['sm', 'md', 'lg'] as const) {
    if (key !== size) {
      expect(classTokens(element)).not.toContain(CONTROL_HEIGHT[key]);
    }
  }
}

describe('input', () => {
  it('renders one input, with className and the md control size, when nothing is adorned', () => {
    const view = render(<Input className="w-40" name="q" />);
    const input = fieldInput(view.container);

    expect(view.container.querySelector('[data-slot="input-shell"]')).toBeNull();
    expect(input).toHaveAttribute('name', 'q');
    expect(classTokens(input)).toContain('w-40');
    expectControlSize(input, 'md');
    expect(classTokens(input)).toContain('placeholder:text-fg-subtle');
    expectChrome(input);
    expectFocusRing(input, BARE_FOCUS);
  });

  it('moves className onto the shell when leading is set and keeps the adornment inside', () => {
    const view = render(<Input className="w-40" leading={<span data-testid="l" />} />);
    const shell = inputShell(view.container);
    const input = fieldInput(view.container);

    expect(shell.contains(input)).toBe(true);
    expect(shell.contains(screen.getByTestId('l'))).toBe(true);
    expect(classTokens(shell)).toContain('w-40');
    expect(classTokens(input)).not.toContain('w-40');
    expect(classTokens(input)).toContain('placeholder:text-fg-subtle');
    expectChrome(shell);
    expectFocusRing(shell, SHELL_FOCUS);
  });

  it('moves className onto the shell when only trailing is set', () => {
    const view = render(<Input className="w-40" trailing={<span data-testid="t" />} />);
    const shell = inputShell(view.container);
    const input = fieldInput(view.container);

    expect(shell.contains(input)).toBe(true);
    expect(shell.contains(screen.getByTestId('t'))).toBe(true);
    expect(classTokens(shell)).toContain('w-40');
    expect(classTokens(input)).not.toContain('w-40');
  });

  it('keeps both adornments inside one shell', () => {
    const view = render(
      <Input
        className="w-40"
        leading={<span data-testid="l" />}
        trailing={<span data-testid="t" />}
      />,
    );
    const shell = inputShell(view.container);
    const input = fieldInput(shell);

    expect(classTokens(shell)).toContain('w-40');
    expect(classTokens(input)).not.toContain('w-40');
    expect(shell.contains(screen.getByTestId('l'))).toBe(true);
    expect(shell.contains(screen.getByTestId('t'))).toBe(true);
    expect(screen.getByTestId('l').compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(input.compareDocumentPosition(screen.getByTestId('t')) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('points ref at the input whether or not a shell is rendered', () => {
    const bare = createRef<HTMLInputElement>();
    const bareView = render(<Input ref={bare} name="bare" />);
    const bareInput = fieldInput(bareView.container);

    expect(bare.current).toBeInstanceOf(HTMLInputElement);
    expect(bare.current).toBe(bareInput);
    bareView.unmount();

    const adorned = createRef<HTMLInputElement>();
    const adornedView = render(<Input ref={adorned} leading={<span data-testid="l" />} />);
    const adornedInput = fieldInput(adornedView.container);
    const shell = inputShell(adornedView.container);

    expect(adorned.current).toBeInstanceOf(HTMLInputElement);
    expect(adorned.current).toBe(adornedInput);
    expect(adorned.current).not.toBe(shell);
  });

  it('forwards input attributes to the inner input when a shell is present', () => {
    const view = render(
      <Input
        disabled
        id="query"
        leading={<span data-testid="l" />}
        name="q"
        placeholder="查找"
      />,
    );
    const input = fieldInput(view.container);
    const shell = inputShell(view.container);

    expect(shell.contains(input)).toBe(true);
    expect(input).toHaveAttribute('name', 'q');
    expect(input).toHaveAttribute('id', 'query');
    expect(input).toHaveAttribute('placeholder', '查找');
    expect(input).toBeDisabled();
    expect(shell).not.toHaveAttribute('name');
    expect(shell).not.toHaveAttribute('id');
  });

  it('sets aria-invalid and a danger border when invalid is true', () => {
    const view = render(<Input invalid />);
    const input = fieldInput(view.container);

    expect(view.container.querySelector('[data-slot="input-shell"]')).toBeNull();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expectDangerBorder(input);
  });

  it('sets aria-invalid on both the shell and the input', () => {
    const view = render(<Input invalid leading={<span data-testid="l" />} />);
    const shell = inputShell(view.container);
    const input = fieldInput(view.container);

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(shell).toHaveAttribute('aria-invalid', 'true');
    expectDangerBorder(shell);
  });

  it('does not set aria-invalid when invalid is omitted or false', () => {
    const omitted = render(<Input />);
    expect(fieldInput(omitted.container)).not.toHaveAttribute('aria-invalid');
    omitted.unmount();

    const explicit = render(<Input invalid={false} />);
    expect(fieldInput(explicit.container)).not.toHaveAttribute('aria-invalid');
  });

  it('keeps a caller aria-invalid value instead of replacing it', () => {
    const plain = render(<Input aria-invalid="false" />);
    expect(fieldInput(plain.container)).toHaveAttribute('aria-invalid', 'false');
    plain.unmount();

    const overridden = render(<Input invalid aria-invalid="grammar" />);
    expect(fieldInput(overridden.container)).toHaveAttribute('aria-invalid', 'grammar');
    overridden.unmount();

    const shelled = render(
      <Input
        aria-invalid="false"
        invalid
        leading={<span data-testid="l" />}
      />,
    );
    expect(fieldInput(shelled.container)).toHaveAttribute('aria-invalid', 'false');
  });

  it('uses the disabled field colors on a disabled input', () => {
    const view = render(<Input disabled />);
    const input = fieldInput(view.container);

    expect(input).toBeDisabled();
    expectDisabledChrome(input);
  });

  it('uses has-disabled colors on a shelled input so the icon area is disabled too', () => {
    const view = render(<Input disabled leading={<span data-testid="l" />} />);
    const shell = inputShell(view.container);
    const icon = screen.getByTestId('l');

    expect(fieldInput(view.container)).toBeDisabled();
    expect(shell.contains(icon)).toBe(true);
    expectShellDisabled(shell);
  });

  it('selects the control height and text size from size', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const view = render(<Input size={size} />);
      expectControlSize(fieldInput(view.container), size);
      view.unmount();
    }
  });

  it('adds tabular only when type is number', () => {
    const numberView = render(<Input type="number" />);
    const numberInput = fieldInput(numberView.container);

    expect(numberInput).toHaveAttribute('type', 'number');
    expect(classTokens(numberInput)).toContain('tabular');
    numberView.unmount();

    const textView = render(<Input type="text" />);
    expect(classTokens(fieldInput(textView.container))).not.toContain('tabular');
  });

  it('stays a single input when a conditional adornment is false', () => {
    const view = render(<Input className="w-40" leading={false} trailing={false} />);

    expect(view.container.querySelector('[data-slot="input-shell"]')).toBeNull();
    expect(classTokens(fieldInput(view.container))).toContain('w-40');
  });

  it('keeps boolean false aria-invalid from the caller when invalid is also set', () => {
    const view = render(<Input aria-invalid={false} invalid />);

    expect(fieldInput(view.container)).toHaveAttribute('aria-invalid', 'false');
  });

  it('puts the caller aria-invalid on the shell as well as the input', () => {
    const overridden = render(
      <Input
        aria-invalid="false"
        invalid
        leading={<span data-testid="l" />}
      />,
    );

    expect(fieldInput(overridden.container)).toHaveAttribute('aria-invalid', 'false');
    expect(inputShell(overridden.container)).toHaveAttribute('aria-invalid', 'false');
    overridden.unmount();

    const supplied = render(<Input aria-invalid="grammar" leading={<span data-testid="l" />} />);

    expect(fieldInput(supplied.container)).toHaveAttribute('aria-invalid', 'grammar');
    expect(inputShell(supplied.container)).toHaveAttribute('aria-invalid', 'grammar');
  });

  it('puts the chosen control size on the shell', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const view = render(<Input leading={<span data-testid="l" />} size={size} />);

      expectControlSize(inputShell(view.container), size);
      view.unmount();
    }
  });

  it('adds tabular on a number input inside a shell', () => {
    const view = render(<Input leading={<span data-testid="l" />} type="number" />);
    const input = fieldInput(view.container);

    expect(input).toHaveAttribute('type', 'number');
    expect(classTokens(input)).toContain('tabular');
  });

  it('does not render a leading slot when only trailing is set', () => {
    const view = render(<Input trailing={<span data-testid="t" />} />);
    const shell = inputShell(view.container);
    const input = fieldInput(view.container);

    expect(shell.firstElementChild).toBe(input);
    expect(shell.contains(screen.getByTestId('t'))).toBe(true);
  });
});

describe('searchInput', () => {
  it('renders a search field with a leading icon and no shortcut key by default', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput />);
    const input = fieldInput(view.container);
    const shell = inputShell(view.container);
    const icon = shell.querySelector('svg');

    expect(input).toHaveAttribute('type', 'search');
    expect(view.container.querySelector('kbd')).toBeNull();
    expect(shell.contains(input)).toBe(true);
    expect(icon?.tagName.toLowerCase()).toBe('svg');
    if (!(icon instanceof Element)) {
      throw new TypeError('expected the search icon');
    }
    expect(shell.contains(icon)).toBe(true);
    expect(icon.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders the shortcut in a kbd only when shortcut is passed', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput shortcut="/" />);
    const input = fieldInput(view.container);
    const shell = inputShell(view.container);
    const kbd = view.container.querySelector('kbd');

    expect(input).toHaveAttribute('type', 'search');
    expect(kbd).toBeInstanceOf(HTMLElement);
    if (!(kbd instanceof HTMLElement)) {
      throw new TypeError('expected a kbd');
    }
    expect(view.container.querySelectorAll('kbd')).toHaveLength(1);
    expect(shell.contains(kbd)).toBe(true);
    expect(kbd.textContent?.trim()).toBe('/');
    expect(input.compareDocumentPosition(kbd) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('still honors invalid on a search field and does not invent a shortcut', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput invalid />);
    const input = fieldInput(view.container);

    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(view.container.querySelector('kbd')).toBeNull();
  });

  it('renders the passed shortcut text, not only a slash', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput shortcut="Esc" />);
    const kbd = view.container.querySelector('kbd');

    expect(kbd).toBeInstanceOf(HTMLElement);
    if (!(kbd instanceof HTMLElement)) {
      throw new TypeError('expected a kbd');
    }
    expect(kbd.textContent?.trim()).toBe('Esc');
  });

  it('uses a caller leading node instead of the search icon', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput leading={<span data-testid="lead">Go</span>} />);
    const shell = inputShell(view.container);

    expect(shell.contains(screen.getByTestId('lead'))).toBe(true);
    expect(shell.querySelector('svg')).toBeNull();
  });

  it('stays type search when the caller also passes a type', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput type="text" />);

    expect(fieldInput(view.container)).toHaveAttribute('type', 'search');
  });

  it('uses has-disabled colors on the search shell and its icon', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput disabled />);
    const shell = inputShell(view.container);
    const icon = shell.querySelector('svg');

    expect(fieldInput(view.container)).toBeDisabled();
    expect(fieldInput(view.container)).toHaveAttribute('type', 'search');
    expect(icon?.tagName.toLowerCase()).toBe('svg');
    if (!(icon instanceof Element)) {
      throw new TypeError('expected the search icon');
    }
    expect(shell.contains(icon)).toBe(true);
    expectShellDisabled(shell);
  });

  it('keeps a caller trailing node on the search field', () => {
    const SearchInput = loadSearchInput();

    expect(SearchInput, 'SearchInput').toBeTruthy();
    if (!SearchInput) {
      throw new TypeError('expected SearchInput');
    }

    const view = render(<SearchInput trailing={<span data-testid="unit">ms</span>} />);
    const input = fieldInput(view.container);
    const unit = screen.getByTestId('unit');

    expect(inputShell(view.container).contains(unit)).toBe(true);
    expect(input.compareDocumentPosition(unit) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('textarea', () => {
  it('sets aria-invalid and the multiline field classes', () => {
    const view = render(<Textarea invalid />);
    const textarea = asTextarea(view.container.querySelector('textarea'));

    expect(view.container.querySelectorAll('textarea')).toHaveLength(1);
    expect(textarea).toHaveAttribute('data-slot', 'textarea');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(classTokens(textarea)).toEqual(expect.arrayContaining(['min-h-20', 'px-2.5', 'py-2', 'text-sm', 'resize-y']));
    expect(classTokens(textarea)).toContain('placeholder:text-fg-subtle');
    expectChrome(textarea);
    expectFocusRing(textarea, BARE_FOCUS);
    expectDangerBorder(textarea);
  });

  it('does not set aria-invalid when invalid is false', () => {
    const view = render(<Textarea invalid={false} />);

    expect(asTextarea(view.container.querySelector('textarea'))).not.toHaveAttribute('aria-invalid');
  });

  it('keeps the textarea ref and caller className on the textarea', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const view = render(<Textarea ref={ref} className="font-mono" />);
    const textarea = asTextarea(view.container.querySelector('textarea'));

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toBe(textarea);
    expect(classTokens(textarea)).toContain('font-mono');
    expect(classTokens(textarea)).toContain('min-h-20');
  });

  it('uses the disabled field colors on a disabled textarea', () => {
    const view = render(<Textarea disabled />);
    const textarea = asTextarea(view.container.querySelector('textarea'));

    expect(textarea).toBeDisabled();
    expectDisabledChrome(textarea);
  });

  it('keeps a caller aria-invalid on the textarea', () => {
    const grammar = render(<Textarea aria-invalid="grammar" invalid />);

    expect(asTextarea(grammar.container.querySelector('textarea'))).toHaveAttribute('aria-invalid', 'grammar');
    grammar.unmount();

    const explicitFalse = render(<Textarea aria-invalid={false} />);

    expect(asTextarea(explicitFalse.container.querySelector('textarea'))).toHaveAttribute('aria-invalid', 'false');
  });

  it('does not set aria-invalid when invalid is omitted', () => {
    const view = render(<Textarea />);

    expect(asTextarea(view.container.querySelector('textarea'))).not.toHaveAttribute('aria-invalid');
  });
});

describe('dateTime', () => {
  it('adds tabular on the time element without changing the datetime value', () => {
    const view = render(<DateTime value={new Date('2026-10-02T06:32:00Z')} mode="datetime" />);
    const time = asTime(view.container.querySelector('time'));

    expect(view.container.querySelectorAll('time')).toHaveLength(1);
    expect(time).toHaveAttribute('dateTime', '2026-10-02T06:32:00.000Z');
    expect(time.textContent).toBe('2026-10-02 14:32');
    expect(classTokens(time)).toContain('tabular');
  });

  it('keeps a caller className when tabular is added', () => {
    const view = render(
      <DateTime
        className="text-fg-subtle"
        mode="datetime"
        value={new Date('2026-10-02T06:32:00Z')}
      />,
    );
    const time = asTime(view.container.querySelector('time'));

    expect(classTokens(time)).toContain('tabular');
    expect(classTokens(time)).toContain('text-fg-subtle');
  });

  it('adds the component fallback color and tabular without a caller color class', () => {
    const view = render(<DateTime className="font-medium" fallback="无" value={null} />);
    const time = asTime(view.container.querySelector('time'));

    expect(time.textContent).toBe('无');
    expect(classTokens(time)).toContain('tabular');
    expect(classTokens(time)).toContain('text-fg-subtle');
    expect(classTokens(time)).toContain('font-medium');
    expect(classTokens(time)).not.toContain('text-fg-muted');
  });
});
