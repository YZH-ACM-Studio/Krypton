import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSubjectiveEditor } from '../../src/pages/set-workspace/subjective-editor';

function Harness({ initial = '', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <WorkspaceSubjectiveEditor value={value} onChange={setValue} disabled={disabled} />;
}

afterEach(() => vi.useRealTimers());

describe('subjective workspace editor', () => {
  it.each([
    ['三级标题', '### 选中'], ['加粗', '**选中**'], ['斜体', '*选中*'], ['行内代码', '`选中`'],
    ['代码块', '```\n选中\n```'], ['行内公式', '$选中$'], ['独立公式', '$$\n选中\n$$'],
    ['无序列表', '- 选中'], ['对比表格', '| 选中 | 说明 |\n| --- | --- |\n| 内容 | 内容 |'],
  ])('formats the selected text with %s', (name, expected) => {
    render(<Harness initial="选中" />);
    const input = screen.getByRole('textbox', { name: '主观题答案' }) as HTMLTextAreaElement;
    input.setSelectionRange(0, 2);
    fireEvent.click(screen.getByRole('button', { name }));
    expect(input).toHaveValue(expected);
    expect(input).toHaveFocus();
  });

  it('keeps surrounding text and selection when formatting, and separates inserted block syntax', () => {
    render(<Harness initial="前文 中间 后文" />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    input.setSelectionRange(3, 5);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(input).toHaveValue('前文 **中间** 后文');
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(7);
    fireEvent.click(screen.getByRole('button', { name: '独立公式' }));
    expect(input).toHaveValue('前文 **\n$$\n中间\n$$\n** 后文');
  });

  it('renders the same GFM and math preview and preserves the textarea through mode and height changes', () => {
    render(<Harness initial={'### 结论\n\n$x^2$\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |'} />);
    const input = screen.getByRole('textbox');
    fireEvent.click(screen.getByRole('tab', { name: '分栏预览' }));
    const preview = screen.getByLabelText('答案预览');
    expect(within(preview).getByRole('heading', { name: '结论', level: 3 })).toBeInTheDocument();
    expect(within(preview).getByRole('table')).toBeInTheDocument();
    expect(preview.querySelector('.katex')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    expect(input).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '增高' }));
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '编辑' }));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(screen.queryByText('小问核对')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /提纲/ })).not.toBeInTheDocument();
  });

  it('counts non-whitespace Unicode characters and lines, and locks content changes', () => {
    render(<Harness initial={' 中 文\n\t😀 '} disabled />);
    expect(screen.getByText('净字数 3')).toBeInTheDocument();
    expect(screen.getByText('行数 2')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
    for (const button of within(screen.getByRole('toolbar', { name: '答案格式' })).getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '恢复草稿快照' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    expect(screen.getByLabelText('答案预览')).toHaveTextContent('中 文');
  });

  it('restores a staged draft from the current page without making a network save', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: '恢复草稿快照' })).toHaveTextContent('恢复草稿快照');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '尚未提交的论证' } });
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    fireEvent.change(input, { target: { value: '' } });
    vi.useRealTimers();
    await user.click(screen.getByRole('combobox', { name: '恢复草稿快照' }));
    const snapshot = screen.getByRole('option', { name: /编辑快照/ });
    expect(snapshot).toHaveTextContent('尚未提交的论证');
    await user.click(snapshot);
    expect(input).toHaveValue('尚未提交的论证');
    expect(screen.getByRole('combobox', { name: '恢复草稿快照' })).toHaveTextContent('恢复草稿快照');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retain a pending selection after restoring identical content', async () => {
    const user = userEvent.setup();
    render(<Harness initial="abcdef" />);
    await user.click(screen.getByRole('combobox', { name: '恢复草稿快照' }));
    await user.click(screen.getByRole('option', { name: /进入页面/ }));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    act(() => {
      input.focus();
      input.setSelectionRange(2, 2);
    });
    await user.keyboard('XY');
    expect(input).toHaveValue('abXYcdef');
    expect(input.selectionStart).toBe(4);
  });
});
