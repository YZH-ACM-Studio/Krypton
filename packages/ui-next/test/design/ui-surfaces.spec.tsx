// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, AvatarFallback, AvatarImage } from '../../src/components/ui/avatar';
import { Card, CardContent } from '../../src/components/ui/card';
import { Separator } from '../../src/components/ui/separator';

const packageRoot = resolve(import.meta.dirname, '../..');

interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
  as?: 'section' | 'div';
}

interface DescriptionListProps {
  items: ReadonlyArray<{ term: ReactNode; detail: ReactNode }>;
  columns?: 1 | 2;
}

interface FormFieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  inline?: boolean;
  children?: ReactNode;
  className?: string;
}

interface FormRowProps {
  columns?: 1 | 2 | 3 | 4;
  children?: ReactNode;
  className?: string;
}

interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(packageRoot, relativePath), 'utf8');
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function renderedRoot(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('expected a single root element');
  }
  return root;
}

function ownText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => (node.textContent ?? '').trim())
    .join('');
}

function contentContainer(root: HTMLElement, text: string): HTMLElement {
  const match = [...root.querySelectorAll('*')].find((element) => ownText(element) === text);
  if (!(match instanceof HTMLElement)) {
    throw new TypeError('expected the panel content container');
  }
  return match;
}

function requiredMark(root: ParentNode): HTMLElement {
  const match = [...root.querySelectorAll('*')].find((element) => ownText(element) === '*');
  if (!(match instanceof HTMLElement)) {
    throw new TypeError('expected the required mark');
  }
  return match;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) {
    return undefined;
  }
  return Reflect.get(record, key);
}

function isComponent<Props extends object>(value: unknown): value is ComponentType<Props> {
  return typeof value === 'function';
}

function fileForSpecifier(specifier: string): string {
  const prefix = '../../';
  if (!specifier.startsWith(prefix)) {
    throw new TypeError(`unexpected module specifier ${specifier}`);
  }
  return resolve(packageRoot, `${specifier.slice(prefix.length)}.tsx`);
}

async function loadComponent<Props extends object>(specifier: string, name: string): Promise<ComponentType<Props>> {
  if (!existsSync(fileForSpecifier(specifier))) {
    throw new TypeError(`${name} is not exported from ${specifier}`);
  }
  const loaded: unknown = await import(specifier);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new TypeError(`${name} module is not an object`);
  }
  const component = readField(loaded, name);
  if (!isComponent<Props>(component)) {
    throw new TypeError(`${name} is not a function`);
  }
  return component;
}

describe('panel', () => {
  it('renders a section, puts the action in the header, and drops body padding when flush', async () => {
    const Panel = await loadComponent<PanelProps>('../../src/components/ui/panel', 'Panel');
    const view = render(createElement(Panel, {
      title: '用户',
      actions: createElement('button', { type: 'button' }, 'a'),
      children: 'x',
    }));
    const root = renderedRoot(view.container);
    const title = screen.getByRole('heading', { level: 3, name: '用户' });
    const button = screen.getByRole('button', { name: 'a' });
    const header = button.closest('header');

    expect(root.tagName).toBe('SECTION');
    expect(root).toHaveAttribute('data-slot', 'panel');
    expect(root).toContainElement(title);
    if (!(header instanceof HTMLElement)) {
      throw new TypeError('expected the action to sit in the header');
    }
    expect(root).toContainElement(header);
    expect(header).toContainElement(button);
    expect(classTokens(contentContainer(root, 'x'))).toContain('p-4');
    view.unmount();

    const flushed = render(createElement(Panel, {
      title: '用户',
      flush: true,
      children: 'x',
    }));
    const flushedRoot = renderedRoot(flushed.container);

    expect(flushedRoot.tagName).toBe('SECTION');
    expect(classTokens(contentContainer(flushedRoot, 'x'))).not.toContain('p-4');
  });

  it('renders a div when as is div and keeps the panel slot', async () => {
    const Panel = await loadComponent<PanelProps>('../../src/components/ui/panel', 'Panel');
    const view = render(createElement(Panel, {
      as: 'div',
      title: '用户',
      children: 'x',
    }));
    const root = renderedRoot(view.container);

    expect(root.tagName).toBe('DIV');
    expect(root).toHaveAttribute('data-slot', 'panel');
    expect(screen.getByRole('heading', { level: 3, name: '用户' })).toBeInTheDocument();
  });

  it('renders the footer on the sunken surface', async () => {
    const Panel = await loadComponent<PanelProps>('../../src/components/ui/panel', 'Panel');
    const view = render(createElement(Panel, {
      footer: 'f',
      children: 'x',
    }));
    const footer = renderedRoot(view.container).querySelector('footer');

    if (!(footer instanceof HTMLElement)) {
      throw new TypeError('expected a footer');
    }
    expect(footer).toHaveTextContent('f');
    expect(classTokens(footer)).toContain('bg-surface-sunken/50');
  });

  it('renders the description in the header', async () => {
    const Panel = await loadComponent<PanelProps>('../../src/components/ui/panel', 'Panel');
    const view = render(createElement(Panel, {
      title: '用户',
      description: '说明',
      children: 'x',
    }));
    const description = screen.getByText('说明');
    const header = description.closest('header');

    expect(renderedRoot(view.container)).toContainElement(description);
    if (!(header instanceof HTMLElement)) {
      throw new TypeError('expected the description to sit in the header');
    }
    expect(header).toContainElement(description);
  });
});

describe('description list', () => {
  it('renders terms and details, and uses two columns from sm', async () => {
    const DescriptionList = await loadComponent<DescriptionListProps>('../../src/components/ui/panel', 'DescriptionList');
    const view = render(createElement(DescriptionList, {
      columns: 2,
      items: [
        { term: '学号', detail: '1001' },
        { term: '姓名', detail: '张三' },
      ],
    }));
    const root = renderedRoot(view.container);

    expect(root.tagName).toBe('DL');
    expect(classTokens(root)).toContain('sm:grid-cols-2');
    expect(screen.getByText('学号').tagName).toBe('DT');
    expect(screen.getByText('1001').tagName).toBe('DD');
    expect(screen.getByText('姓名').tagName).toBe('DT');
    expect(screen.getByText('张三').tagName).toBe('DD');
  });
});

describe('card', () => {
  it('keeps the card slots and uses the panel surface', () => {
    const view = render(
      <Card>
        <CardContent>x</CardContent>
      </Card>,
    );
    const root = renderedRoot(view.container);
    const content = root.querySelector('[data-slot="card-content"]');

    expect(root).toHaveAttribute('data-slot', 'card');
    if (!(content instanceof HTMLElement)) {
      throw new TypeError('expected card content');
    }
    expect(content).toHaveAttribute('data-slot', 'card-content');
    expect(content).toHaveTextContent('x');
    expect(classTokens(root)).toContain('rounded-lg');
    expect(classTokens(root)).toContain('border-line');
    expect(classTokens(root)).not.toContain('rounded-xl');
    expect(classTokens(root)).not.toContain('bg-card');
    expect(classTokens(content)).toContain('p-4');
    expect(classTokens(content)).not.toContain('p-5');
  });
});

describe('form field', () => {
  it('shows the error instead of the hint and marks required in danger', async () => {
    const FormField = await loadComponent<FormFieldProps>('../../src/components/ui/form', 'FormField');
    const view = render(createElement(FormField, {
      label: '名称',
      required: true,
      error: '已占用',
      hint: '提示',
      children: 'control',
    }));
    const alert = screen.getByRole('alert');

    expect(alert).toHaveTextContent('已占用');
    expect(view.container.textContent ?? '').not.toContain('提示');
    expect(classTokens(requiredMark(view.container))).toContain('text-danger-fg');
  });

  it('shows the hint when there is no error', async () => {
    const FormField = await loadComponent<FormFieldProps>('../../src/components/ui/form', 'FormField');
    render(createElement(FormField, {
      label: '名称',
      hint: '提示',
      children: 'control',
    }));

    expect(screen.getByText('提示')).toBeInTheDocument();
  });

  it('shows 可选 when optional is set', async () => {
    const FormField = await loadComponent<FormFieldProps>('../../src/components/ui/form', 'FormField');
    render(createElement(FormField, {
      label: '时间',
      optional: true,
      children: 'control',
    }));

    expect(screen.getByText('可选')).toBeInTheDocument();
  });

  it('places an inline field on a two-column grid from sm', async () => {
    const FormField = await loadComponent<FormFieldProps>('../../src/components/ui/form', 'FormField');
    const view = render(createElement(FormField, {
      inline: true,
      label: 'x',
      children: 'control',
    }));

    expect(renderedRoot(view.container).getAttribute('class') ?? '').toContain('sm:grid-cols-');
  });

  it('points the label at the control', async () => {
    const FormField = await loadComponent<FormFieldProps>('../../src/components/ui/form', 'FormField');
    render(createElement(FormField, {
      label: '名称',
      htmlFor: 'name-input',
      children: createElement('input', { id: 'name-input' }),
    }));

    expect(screen.getByLabelText('名称')).toHaveAttribute('id', 'name-input');
  });

  it('moves an inline hint under the label and keeps it out of the control column', async () => {
    const FormField = await loadComponent<FormFieldProps>('../../src/components/ui/form', 'FormField');
    render(createElement(FormField, {
      inline: true,
      label: '名称',
      hint: '提示',
      children: 'control',
    }));
    const label = screen.getByText('名称');
    const hint = screen.getByText('提示');
    const column = label.parentElement;

    if (!(column instanceof HTMLElement)) {
      throw new TypeError('expected the label column');
    }
    expect(column).toContainElement(hint);
    const control = column.nextElementSibling;
    if (!(control instanceof HTMLElement)) {
      throw new TypeError('expected the control column');
    }
    expect(control).not.toHaveTextContent('提示');
  });
});

describe('form row', () => {
  it('splits columns from the sm breakpoint', async () => {
    const FormRow = await loadComponent<FormRowProps>('../../src/components/ui/form', 'FormRow');
    const view = render(createElement(FormRow, {
      columns: 2,
      children: 'a',
    }));
    const tokens = classTokens(renderedRoot(view.container));

    expect(tokens).toContain('sm:grid-cols-2');
    expect(tokens).not.toContain('md:grid-cols-2');
  });
});

describe('alert', () => {
  it('uses alert for danger, status otherwise, and dismisses from 关闭', async () => {
    const Alert = await loadComponent<AlertProps>('../../src/components/ui/alert', 'Alert');
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const danger = render(createElement(Alert, {
      tone: 'danger',
      title: '失败',
      onDismiss,
    }));

    expect(renderedRoot(danger.container)).toHaveAttribute('role', 'alert');
    expect(danger.container).toHaveTextContent('失败');
    const close = screen.getByRole('button', { name: '关闭' });
    expect(close).toHaveAttribute('aria-label', '关闭');
    await user.click(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    danger.unmount();

    const info = render(createElement(Alert, {
      tone: 'info',
      title: '说明',
    }));

    expect(renderedRoot(info.container)).toHaveAttribute('role', 'status');
    expect(info.container).toHaveTextContent('说明');
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
  });

  it('defaults to the info tone', async () => {
    const Alert = await loadComponent<AlertProps>('../../src/components/ui/alert', 'Alert');
    const view = render(createElement(Alert, {
      title: '说明',
    }));
    const root = renderedRoot(view.container);

    expect(root).toHaveAttribute('role', 'status');
    expect(classTokens(root)).toContain('bg-info-soft');
    expect(classTokens(root)).not.toContain('bg-danger-soft');
  });

  it('renders the action and the body', async () => {
    const Alert = await loadComponent<AlertProps>('../../src/components/ui/alert', 'Alert');
    const view = render(createElement(Alert, {
      title: '失败',
      children: '请稍后再试',
      action: createElement('button', { type: 'button' }, '重试'),
    }));
    const body = screen.getByText('请稍后再试');

    expect(view.container).toContainElement(screen.getByRole('button', { name: '重试' }));
    expect(classTokens(body)).toContain('text-fg-muted');
  });
});

describe('empty state', () => {
  it('renders the title and the action', async () => {
    const EmptyState = await loadComponent<EmptyStateProps>('../../src/components/ui/empty-state', 'EmptyState');
    const view = render(createElement(EmptyState, {
      title: '还没有提交记录',
      action: createElement('button', { type: 'button' }, '去题库'),
    }));
    const root = renderedRoot(view.container);

    expect(root).toHaveTextContent('还没有提交记录');
    expect(root).toContainElement(screen.getByRole('button', { name: '去题库' }));
  });

  it('renders the description', async () => {
    const EmptyState = await loadComponent<EmptyStateProps>('../../src/components/ui/empty-state', 'EmptyState');
    render(createElement(EmptyState, {
      title: '还没有提交记录',
      description: '去创建一条',
    }));

    expect(screen.getByText('去创建一条')).toBeInTheDocument();
  });

  it('uses the compact padding only when compact is set', async () => {
    const EmptyState = await loadComponent<EmptyStateProps>('../../src/components/ui/empty-state', 'EmptyState');
    const compact = render(createElement(EmptyState, {
      title: '空',
      compact: true,
    }));
    const compactTokens = classTokens(renderedRoot(compact.container));

    expect(compactTokens).toContain('py-8');
    expect(compactTokens).not.toContain('py-16');
    compact.unmount();

    const regular = render(createElement(EmptyState, {
      title: '空',
    }));
    const regularTokens = classTokens(renderedRoot(regular.container));

    expect(regularTokens).toContain('py-16');
    expect(regularTokens).not.toContain('py-8');
  });
});

describe('separator', () => {
  it('paints the separator with bg-line', () => {
    const view = render(<Separator />);
    const root = renderedRoot(view.container);

    expect(root).toHaveAttribute('data-slot', 'separator');
    expect(classTokens(root)).toContain('bg-line');
  });

  it('keeps a horizontal hairline and a vertical hairline', () => {
    const horizontal = render(<Separator />);
    const horizontalTokens = classTokens(renderedRoot(horizontal.container));

    expect(horizontalTokens).toContain('h-px');
    expect(horizontalTokens).toContain('w-full');
    horizontal.unmount();

    const vertical = render(<Separator orientation="vertical" />);
    const verticalTokens = classTokens(renderedRoot(vertical.container));

    expect(verticalTokens).toContain('h-full');
    expect(verticalTokens).toContain('w-px');
  });
});

describe('avatar', () => {
  it('restyles the shell and fallback, and still hides a broken image', () => {
    const view = render(
      <Avatar>
        <AvatarImage
          alt="头像"
          src="/missing.png"
        />
        <AvatarFallback>测</AvatarFallback>
      </Avatar>,
    );
    const root = renderedRoot(view.container);
    const fallback = root.querySelector('[data-slot="avatar-fallback"]');
    const image = screen.getByRole('img', { name: '头像' });

    expect(root).toHaveAttribute('data-slot', 'avatar');
    expect(classTokens(root)).toEqual(expect.arrayContaining(['ring-2', 'ring-surface']));
    if (!(fallback instanceof HTMLElement)) {
      throw new TypeError('expected the avatar fallback');
    }
    expect(fallback).toHaveAttribute('data-slot', 'avatar-fallback');
    expect(classTokens(fallback)).toEqual(expect.arrayContaining([
      'bg-surface-active',
      'text-fg-muted',
      'font-medium',
    ]));
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('data-slot', 'avatar-image');
    fireEvent.error(image);
    expect(image.style.display).toBe('none');
    expect(fallback).toHaveTextContent('测');
  });
});

describe('form source', () => {
  it('does not keep CardBody', () => {
    expect(sourceOf('src/components/ui/form.tsx').includes('CardBody')).toBe(false);
  });
});
