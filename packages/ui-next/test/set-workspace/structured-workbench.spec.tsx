import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStructuredBench, type WorkspaceStructuredBenchProps } from '../../src/pages/set-workspace/structured-workbench';

const surface: ClientStructuredCodeSegment[] = [
  { type: 'code', code: 'int add() {\n  // visible' },
  { type: 'region', id: 'first', title: '第一空', description: '返回一个数', prompt: 'return 1;' },
  { type: 'code', code: '}\nint next() {' },
  { type: 'region', id: 'second', title: '第二空' },
  { type: 'code', code: '}' },
];

function Harness(props: Partial<WorkspaceStructuredBenchProps>) {
  const [values, setValues] = useState({ first: 'return 1;', second: '' });
  return (
    <WorkspaceStructuredBench
      surface={surface}
      values={values}
      onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
      kind="program_fill"
      lang="c"
      primaryAction={<button>提交</button>}
      {...props}
    />
  );
}

function editor(label = '第一空代码编辑器'): EditorView {
  const view = EditorView.findFromDOM(screen.getByLabelText(label));
  if (!view) throw new Error('CodeMirror editor is missing');
  return view;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('structured workspace bench', () => {
  it('cycles Tab both ways, locates a blank from the list, and keeps inputs and space preview in sync', () => {
    render(<Harness />);
    const first = screen.getByRole('textbox', { name: '第一空' });
    const second = screen.getByRole('textbox', { name: '第二空' });
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.change(first, { target: { value: 'return  2;\r\n' } });
    expect(first).toHaveValue('return  2;');
    fireEvent.click(screen.getByRole('button', { name: '空格' }));
    expect(screen.getByLabelText('空格预览')).toHaveTextContent('return··2;');
    fireEvent.click(screen.getByRole('tab', { name: '分空列表' }));
    expect(screen.getByRole('textbox', { name: '第一空' })).toHaveValue('return  2;');
    fireEvent.click(screen.getAllByRole('button', { name: '在代码中定位' })[1]);
    expect(screen.getByRole('tab', { name: '原位代码' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: '第二空' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '跳到第 1 空' }));
    const sameBlank = screen.getByRole('button', { name: '跳到第 1 空' });
    act(() => sameBlank.focus());
    fireEvent.click(sameBlank);
    expect(screen.getByRole('textbox', { name: '第一空' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '清空此空' }));
    expect(screen.getByText('已填 0 / 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自测' })).not.toBeInTheDocument();
  });

  it('retains CodeMirror selection and undo while editing, changing focus and collapsing public segments', () => {
    render(<Harness kind="function" />);
    const view = editor();
    act(() =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'return 22;' },
        selection: { anchor: 8 },
        userEvent: 'input',
      }),
    );
    expect(editor()).toBe(view);
    expect(view.state.selection.main.head).toBe(8);
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(screen.getByLabelText('第二空代码编辑器')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '作答区 2' }));
    expect(screen.getByLabelText('第二空代码编辑器')).toHaveFocus();
    expect(screen.getByLabelText('第一空代码编辑器')).not.toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: '公开代码' })[0]);
    expect(screen.queryByText('// visible', { exact: false })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '单区聚焦' }));
    expect(editor()).toBe(view);
    expect(view.state.selection.main.head).toBe(8);
    act(() => { undo(view); });
    expect(editor().state.doc.toString()).toBe('return 1;');
  });

  it('blocks external paste, beforeinput, drop and CodeMirror insertion transactions without reading their payloads', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Harness kind="function" prohibitExternalCodeInjection onChange={onChange} />);
    const content = screen.getByLabelText('第一空代码编辑器');
    const getData = vi.fn(() => 'external');
    for (const type of ['paste', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: { getData } });
      fireEvent(content, event);
      expect(event.defaultPrevented).toBe(true);
    }
    const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: 'external' });
    fireEvent(content, before);
    expect(before.defaultPrevented).toBe(true);
    for (const userEvent of ['input.paste', 'input.drop', 'move.drop']) {
      act(() => editor().dispatch({ changes: { from: 0, insert: 'external' }, userEvent }));
      expect(editor().state.doc.toString()).toBe('return 1;');
    }
    expect(getData).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('禁止粘贴或拖入外部代码');
    rerender(<Harness prohibitExternalCodeInjection onChange={onChange} />);
    fireEvent.paste(screen.getByRole('textbox', { name: '第一空' }), { clipboardData: { getData } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('locks editing and submission shortcuts when read-only', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness readOnly onSubmit={onSubmit} />);
    expect(screen.getByRole('textbox', { name: '第一空' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('结构化代码工作台'), { key: 'F10' });
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<Harness kind="function" readOnly />);
    expect(screen.getByLabelText('第一空代码编辑器')).toHaveAttribute('contenteditable', 'false');
  });

  it('runs structured JSON through the shared pretest and opens the exact sample through its handle', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ rid: 'pretest-rid' }), { headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = { current: null as { openSampleTab: (id: number) => void } | null };
    const onSubmit = vi.fn();
    const { unmount } = render(
      <Harness
        pretestApiRef={api}
        onSubmit={onSubmit}
        pretest={{
          url: '/p/1/submit?tid=exam',
          resolveRecordUrl: (rid) => `/record/${rid}?tid=exam`,
          samples: [
            { id: 1, input: 'first', output: '1' },
            { id: 2, input: 'second', output: '2' },
          ],
        }}
      />,
    );
    act(() => api.current?.openSampleTab(2));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '第一空' }), { key: 'F9' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request: unknown[] = fetchMock.mock.calls[0];
    expect(request[0]).toBe('/p/1/submit?tid=exam');
    const init = request[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      lang: 'c',
      code: '{"first":"return 1;","second":""}',
      pretest: true,
      input: ['second'],
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '第一空' }), { key: 'F10' });
    expect(onSubmit).toHaveBeenCalledOnce();
    unmount();
    expect(init.signal?.aborted).toBe(true);
  });
});
