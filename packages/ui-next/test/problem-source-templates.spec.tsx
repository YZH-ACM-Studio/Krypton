import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { INITIAL_SOURCE_TEMPLATES, type SourceTemplateView } from '@hydrooj/common';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { ProblemSourceTemplatesPage } from '../src/pages/problem-source-templates';

const template: SourceTemplateView = { ...INITIAL_SOURCE_TEMPLATES[5], revision: 3, references: 2 };

function renderPage(templates: SourceTemplateView[] = [template]) {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-11-14T00:00:00Z',
    user: { id: 2, name: 'admin', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { problems: '/p' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'problem_source_template.html',
      data: {
        templates,
        sourceTemplateUrl: '/p/source-templates',
        pidNamespaceUrl: '/p/pid-namespaces',
        problemReviewUrl: '/p/review',
        pidNamespaces: [{ namespaceId: 'builtin:self', name: '自命题 P5', pidPattern: 'P5xxx' }],
      },
    },
  };
  return render(
    <BootstrapProvider bootstrap={bootstrap}>
      <ProblemSourceTemplatesPage />
    </BootstrapProvider>,
  );
}

function captureRequest() {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ message: '配置已经变化，请刷新后重试' }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return async () => {
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const options = fetch.mock.calls[0] as unknown as [string, RequestInit];
    return new URLSearchParams(String(options[1].body));
  };
}

it('locks referenced rules and deletion while allowing name and enabled-state changes', async () => {
  const request = captureRequest();
  const user = userEvent.setup();
  renderPage();
  expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '编辑' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByLabelText('固定来源标签')).toBeDisabled();
  expect(dialog.getByLabelText('年份')).toBeDisabled();
  expect(dialog.getByText(/当前有 2 道题引用/)).toBeInTheDocument();
  const name = dialog.getByLabelText('名称');
  await user.clear(name);
  await user.type(name, '校内题目');
  await user.click(dialog.getByRole('switch'));
  await user.click(dialog.getByRole('button', { name: '保存' }));
  const body = await request();
  expect(body.get('id')).toBe('self');
  expect(body.get('expectedRevision')).toBe('3');
  expect(JSON.parse(body.get('definition')!)).toEqual({
    label: '校内题目',
    enabled: false,
    fields: ['year'],
    fixedTags: ['自命题'],
    trainingAnchorTag: '自命题',
    pidNamespaceId: 'builtin:self',
    yearTagSuffix: '自命题',
  });
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存' })).toBeEnabled());
});

it('creates a template with no additional fields and defaults its source tag from its name', async () => {
  const request = captureRequest();
  const user = userEvent.setup();
  renderPage([]);
  expect(screen.getByText('还没有来源模板')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '新建来源模板' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('名称'), '教材例题');
  await user.click(dialog.getByRole('button', { name: '保存' }));
  const body = await request();
  expect(body.get('operation')).toBe('create');
  expect(JSON.parse(body.get('definition')!)).toEqual({
    label: '教材例题',
    enabled: true,
    fields: [],
    fixedTags: ['教材例题'],
    trainingAnchorTag: '教材例题',
    pidNamespaceId: 'builtin:self',
  });
});

it('automatically requires year when annual tags are enabled', async () => {
  const user = userEvent.setup();
  renderPage([]);
  await user.click(screen.getByRole('button', { name: '新建来源模板' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('名称'), '教材');
  await user.click(dialog.getByLabelText('生成年份标签'));
  expect(dialog.getByLabelText('年份')).toBeChecked();
  expect(dialog.getByLabelText('年份')).toBeDisabled();
  expect(dialog.getByText(`${new Date().getFullYear()}教材`)).toBeInTheDocument();
  await user.click(dialog.getByLabelText('生成年份标签'));
  expect(dialog.getByLabelText('年份')).toBeEnabled();
});

it('confirms unreferenced deletion with the template name before sending its revision', async () => {
  const request = captureRequest();
  const user = userEvent.setup();
  renderPage([{ ...template, references: 0 }]);
  await user.click(screen.getByRole('button', { name: '删除' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/“自命题”当前没有题目引用/)).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: '删除' }));
  const body = await request();
  expect(Object.fromEntries(body)).toEqual({ operation: 'delete', id: 'self', expectedRevision: '3' });
});
