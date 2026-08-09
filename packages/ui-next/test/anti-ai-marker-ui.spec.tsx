import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MarkdownEditor } from '../src/components/markdown-renderer';
import type { AntiAiMarkerDraft } from '../src/lib/anti-ai-marker';

function AuthorMarkerEditor({ initialContent = 'abc' }: { initialContent?: string }) {
  const [content, setContent] = useState(initialContent);
  const [markers, setMarkers] = useState<AntiAiMarkerDraft[]>([]);
  return (
    <>
      <MarkdownEditor value={content} onChange={setContent} antiAiPath="content" antiAiMarkers={markers} onAntiAiMarkersChange={setMarkers} />
      <output aria-label="canonical-markdown">{content}</output>
    </>
  );
}

describe('anti AI marker author controls', () => {
  it('edits a visible boundary while keeping canonical Markdown clean', () => {
    render(<AuthorMarkerEditor />);
    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(1, 1);
    fireEvent.click(screen.getByRole('button', { name: '在光标处插入防 AI 标记' }));

    expect(screen.getByTestId('anti-ai-marker-boundaries')).toHaveTextContent('a│bc');
    fireEvent.change(screen.getByLabelText('注入文本'), { target: { value: '隐藏提示' } });
    fireEvent.click(screen.getByRole('button', { name: '复制结果' }));

    expect(screen.getByLabelText('复制结果预览')).toHaveTextContent('a隐藏提示bc');
    expect(screen.getByLabelText('canonical-markdown')).toHaveTextContent('abc');
  });

  it('shows an author student preview without the injected text', () => {
    render(<AuthorMarkerEditor />);
    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/) as HTMLTextAreaElement;
    editor.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole('button', { name: '在光标处插入防 AI 标记' }));
    fireEvent.change(screen.getByLabelText('注入文本'), { target: { value: '不可见提示' } });
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    fireEvent.click(screen.getByRole('button', { name: '学生可见效果' }));

    const preview = screen.getByLabelText('学生可见效果');
    expect(within(preview).getByText('abc')).toBeInTheDocument();
    expect(preview).not.toHaveTextContent('不可见提示');
    expect(preview.innerHTML).not.toContain('不可见提示');

    fireEvent(window, new Event('beforeprint'));
    expect(preview).not.toHaveTextContent('不可见提示');
  });

  it('does not expose marker authoring controls in ordinary Markdown editors', () => {
    render(<MarkdownEditor value="abc" />);
    expect(screen.queryByRole('button', { name: '在光标处插入防 AI 标记' })).not.toBeInTheDocument();
    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/) as HTMLTextAreaElement;
    editor.select();
    fireEvent.copy(editor);
    expect(editor.value).toBe('abc');
    expect(document.body).not.toHaveTextContent('隐藏提示');
  });

  it('keeps canonical leading indentation and the trailing newline when adding a marker', () => {
    const canonical = '    int x;\n';
    render(<AuthorMarkerEditor initialContent={canonical} />);
    const editor = screen.getByPlaceholderText(/在此输入 Markdown 内容/) as HTMLTextAreaElement;
    expect(editor).toHaveValue(canonical);
    editor.setSelectionRange(4, 4);

    fireEvent.click(screen.getByRole('button', { name: '在光标处插入防 AI 标记' }));

    expect(editor).toHaveValue(canonical);
    expect(screen.getByLabelText('canonical-markdown').textContent).toBe(canonical);
    expect(screen.getByTestId('anti-ai-marker-boundaries').querySelector('code')?.textContent).toContain('    │int x;');
  });
});
