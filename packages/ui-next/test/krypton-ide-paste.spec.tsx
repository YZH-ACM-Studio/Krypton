import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KryptonIDE } from '../src/components/krypton-ide';

interface ClipboardFixture {
  types: readonly string[];
  getData: (type: string) => string;
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
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

async function editorContent(): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>('.cm-content');
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
}

describe('krypton IDE clipboard compatibility', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('rejects every clipboard flavor without reading its contents in a controlled no-injection context', async () => {
    const onValueChange = vi.fn();
    const getData = vi.fn(() => 'do not inspect me');
    render(
      <KryptonIDE mode="simple" langs={['cc.cc20']} value="typed code" onValueChange={onValueChange} minHeight={120} prohibitExternalCodeInjection />,
    );

    await pasteIntoEditor({ types: ['text/plain', 'text/html'], getData });

    expect(screen.getByRole('alert')).toHaveTextContent('当前真实性训练禁止粘贴或拖入外部代码');
    expect(getData).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('上传代码文件')).not.toBeInTheDocument();
  });

  it.each(['insertFromPaste', 'insertFromDrop'])('blocks beforeinput %s while leaving ordinary text insertion alone', async (inputType) => {
    const onValueChange = vi.fn();
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} prohibitExternalCodeInjection />);
    const editor = await editorContent();
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data: 'external code' });

    await act(async () => {
      editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('当前真实性训练禁止粘贴或拖入外部代码');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('blocks text drop before CodeMirror can create a document transaction', async () => {
    const onValueChange = vi.fn();
    const getData = vi.fn(() => 'external code');
    render(<KryptonIDE mode="simple" langs={['cc.cc20']} value="" onValueChange={onValueChange} minHeight={120} prohibitExternalCodeInjection />);
    const editor = await editorContent();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['text/plain'], getData } });

    await act(async () => {
      editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(getData).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

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

  it('persists an isolated controlled draft before the debounce window or unmount', async () => {
    const storageKey = 'krypton:code:integrity-refresh:cc.cc20';
    localStorage.removeItem(storageKey);
    const view = render(
      <KryptonIDE
        langs={['cc.cc20']}
        defaultLang="cc.cc20"
        defaultCode="template"
        cacheKey="integrity-refresh"
        isolateDraftByLanguage
        minHeight={120}
      />,
    );

    await pasteIntoEditor({ types: ['text/plain'], getData: () => 'latest draft' });

    expect(localStorage.getItem(storageKey)).toBe('latest drafttemplate');
    view.unmount();
    expect(localStorage.getItem(storageKey)).toBe('latest drafttemplate');
    localStorage.removeItem(storageKey);
  });

  it('treats a cached empty isolated draft as intentional instead of restoring the template', async () => {
    const storageKey = 'krypton:code:integrity-empty:cc.cc20';
    localStorage.setItem(storageKey, '');
    const view = render(
      <KryptonIDE
        langs={['cc.cc20']}
        defaultLang="cc.cc20"
        defaultCode="template must stay hidden"
        cacheKey="integrity-empty"
        isolateDraftByLanguage
        minHeight={120}
      />,
    );

    expect((await editorContent()).textContent).toBe('');
    view.unmount();
    localStorage.removeItem(storageKey);
  });
});
