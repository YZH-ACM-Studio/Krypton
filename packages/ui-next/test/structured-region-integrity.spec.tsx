import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StructuredRegionInputs } from '../src/components/structured-region-inputs';

const surface: ClientStructuredCodeSegment[] = [
  { type: 'code', code: 'int solve() {' },
  { type: 'region', id: 'body', title: '函数体' },
  { type: 'code', code: '}' },
];

describe('structured answer integrity input gate', () => {
  it('rejects paste and drop for multi-line CodeMirror regions without reading payloads', async () => {
    const onChange = vi.fn();
    render(<StructuredRegionInputs surface={surface} values={{ body: '' }} onChange={onChange} lang="cc.cc20" prohibitExternalCodeInjection />);
    const editor = await waitFor(() => document.querySelector<HTMLElement>('.cm-content')!);
    const getData = vi.fn(() => 'return copied();');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { types: ['text/plain'], getData } });

    await act(async () => editor.dispatchEvent(paste));

    expect(paste.defaultPrevented).toBe(true);
    expect(getData).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('当前真实性训练禁止粘贴或拖入外部代码');
  });

  it('rejects paste in single-line regions but keeps typed onChange values', () => {
    const onChange = vi.fn();
    render(<StructuredRegionInputs surface={surface} values={{ body: '' }} onChange={onChange} singleLine prohibitExternalCodeInjection />);
    const input = screen.getByPlaceholderText('填写第 1 空代码');

    const getData = vi.fn(() => 'copied');
    fireEvent.paste(input, { clipboardData: { types: ['text/plain'], getData } });
    expect(getData).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('当前真实性训练禁止粘贴或拖入外部代码');

    fireEvent.change(input, { target: { value: 'i++' } });
    expect(onChange).toHaveBeenLastCalledWith('body', 'i++');
  });
});
