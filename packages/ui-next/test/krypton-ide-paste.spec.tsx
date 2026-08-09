import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KryptonIDE } from '../src/components/krypton-ide';

interface ClipboardFixture {
  types: readonly string[];
  getData: (type: string) => string;
}

async function pasteIntoEditor(clipboardData: ClipboardFixture): Promise<void> {
  const editor = await waitFor(() => {
    const element = document.querySelector<HTMLElement>('.cm-content');
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  await act(async () => {
    editor.dispatchEvent(event);
  });
}

describe('krypton IDE clipboard compatibility', () => {
  it('accepts JetBrains parameterized plain text when the exact text/plain flavor is empty', async () => {
    const onValueChange = vi.fn();
    const source = 'int main() {\r\n\treturn 0;\r\n}\r\n';
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['application/x-jetbrains-editor', 'text/html', 'text/plain;charset=utf-8'],
      getData: (type) => (type === 'text/plain;charset=utf-8' ? source : ''),
    });

    expect(onValueChange).toHaveBeenLastCalledWith('int main() {\n\treturn 0;\n}\n');
  });

  it('prefers parameterized plain text over the URI fallback in a multi-format clipboard', async () => {
    const onValueChange = vi.fn();
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['text/uri-list', 'text/plain;charset=utf-8'],
      getData: (type) => {
        if (type === 'text/uri-list') return 'file:///C:/Main.java';
        if (type === 'text/plain;charset=utf-8') return 'class Main {}';
        return '';
      },
    });

    expect(onValueChange).toHaveBeenLastCalledWith('class Main {}');
  });

  it('shows a visible error instead of silently consuming a clipboard without plain text', async () => {
    const onValueChange = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getData = vi.fn((type: string) => (type === 'text/html' ? '<b>int main()</b>' : ''));
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['application/x-jetbrains-editor', 'text/plain-vendor', 'text/html'],
      getData,
    });

    expect(screen.getByRole('alert')).toHaveTextContent('剪贴板没有可读取的纯文本代码');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[KryptonIDE] Clipboard paste rejected: no plain-text flavor', {
      types: ['application/x-jetbrains-editor', 'text/plain-vendor', 'text/html'],
    });
    expect(getData).not.toHaveBeenCalledWith('text/plain-vendor');
    expect(getData).not.toHaveBeenCalledWith('text/html');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('<b>int main()</b>');
  });

  it('reports an empty advertised plain-text flavor instead of silently doing nothing', async () => {
    const onValueChange = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['text/plain;charset=utf-8'],
      getData: () => '',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('剪贴板没有可读取的纯文本代码');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('reports an empty clipboard type list instead of letting CodeMirror consume it silently', async () => {
    const onValueChange = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: [],
      getData: () => '',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('剪贴板没有可读取的纯文本代码');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[KryptonIDE] Clipboard paste rejected: no plain-text flavor', { types: [] });
  });

  it('leaves the standard text/plain path to CodeMirror and preserves Unicode, tabs, and the final newline', async () => {
    const onValueChange = vi.fn();
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['text/plain', 'text/plain;charset=utf-8', 'text/html'],
      getData: (type) => {
        if (type === 'text/plain') return '// 中文\r\n\treturn 0;\r\n';
        if (type === 'text/plain;charset=utf-8') return 'wrong alternate';
        return '';
      },
    });

    expect(onValueChange).toHaveBeenLastCalledWith('// 中文\n\treturn 0;\n');
  });

  it('accepts the legacy Text alias when Edge exposes no exact plain-text value', async () => {
    const onValueChange = vi.fn();
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['application/x-jetbrains-editor'],
      getData: (type) => (type === 'Text' ? 'cout << 1;\r' : ''),
    });

    expect(onValueChange).toHaveBeenLastCalledWith('cout << 1;\n');
  });

  it('pastes a long alternate plain-text payload without truncation', async () => {
    const onValueChange = vi.fn();
    const source = `${'x'.repeat(256 * 1024)}\r\n`;
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} />);

    await pasteIntoEditor({
      types: ['application/x-jetbrains-editor', 'text/plain;charset=UTF-8'],
      getData: (type) => (type === 'text/plain;charset=UTF-8' ? source : ''),
    });

    expect(onValueChange).toHaveBeenLastCalledWith(`${'x'.repeat(256 * 1024)}\n`);
  });
});
