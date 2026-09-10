import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AntiAiCopyBoundary, createAntiAiMarkerRehypePlugins } from '../src/components/anti-ai-copy-boundary';
import { MarkdownView } from '../src/components/markdown-renderer';
import { ProgrammingStatementView, type ProgrammingStatementViewData } from '../src/components/programming-statement';
import { readAntiAiMarkerClientView, type AntiAiMarkerClientMarker } from '../src/lib/anti-ai-marker';

function marker(id: string, offset: number, injectionText: string, path = 'content'): AntiAiMarkerClientMarker {
  return { id, path, offset, injectionText };
}

function clipboard(overrides: Partial<DataTransfer> = {}) {
  const values = new Map<string, string>();
  return {
    values,
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    clearData: vi.fn((type?: string) => {
      if (type) values.delete(type);
      else values.clear();
    }),
    ...overrides,
  };
}

function setSelection(start: Node, startOffset: number, end: Node, endOffset: number, reverse = false) {
  const selection = window.getSelection();
  if (!selection) throw new Error('selection unavailable');
  selection.removeAllRanges();
  if (reverse && typeof selection.setBaseAndExtent === 'function') {
    selection.setBaseAndExtent(end, endOffset, start, startOffset);
    return;
  }
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  selection.addRange(range);
}

function selectContents(node: Node) {
  const selection = window.getSelection();
  if (!selection) throw new Error('selection unavailable');
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.addRange(range);
}

function textNode(container: HTMLElement, text: string): Text {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.textContent?.includes(text)) return current as Text;
  }
  throw new Error(`text node not found: ${text}`);
}

function controlledMarkdown(source: string, markers: AntiAiMarkerClientMarker[]) {
  return render(
    <AntiAiCopyBoundary markers={markers}>
      <MarkdownView content={source} antiAiPath="content" antiAiMarkers={markers} />
    </AntiAiCopyBoundary>,
  );
}

describe('controlled statement anti AI copy', () => {
  it('injects at the selected semantic position in both plain text and rich HTML', () => {
    const source = 'alpha **bold** omega';
    const markers = [marker('marker_bold', source.indexOf('bold') + 2, '<隐藏提示>')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const alpha = textNode(scope, 'alpha');
    const omega = textNode(scope, 'omega');
    setSelection(alpha, 0, omega, omega.textContent!.length);
    const data = clipboard();

    expect(fireEvent.copy(scope, { clipboardData: data })).toBe(false);
    expect(data.values.get('text/plain')).toBe('alpha bo<隐藏提示>ld omega');
    expect(data.values.get('text/html')).toContain('<strong>bo&lt;隐藏提示&gt;ld</strong>');
    expect(container.querySelector('[data-anti-ai-marker-id="marker_bold"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container).not.toHaveTextContent('隐藏提示');
  });

  it('does not intercept a partial selection that does not cross the marker', () => {
    const source = 'alpha beta';
    const markers = [marker('marker_after_alpha', source.indexOf('beta'), '隐藏')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const text = textNode(scope, 'alpha');
    setSelection(text, 0, text, 5);
    const data = clipboard();

    expect(fireEvent.copy(container.querySelector('[data-anti-ai-copy-scope]')!, { clipboardData: data })).toBe(true);
    expect(data.setData).not.toHaveBeenCalled();
  });

  it('does not inject when a selection leaves the statement boundary', () => {
    const source = 'alpha beta';
    const markers = [marker('marker_boundary', source.indexOf('beta'), '隐藏')];
    const { container } = render(
      <div>
        <AntiAiCopyBoundary markers={markers}>
          <MarkdownView content={source} antiAiPath="content" antiAiMarkers={markers} />
        </AntiAiCopyBoundary>
        <pre data-editor-code>student code</pre>
      </div>,
    );
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const alpha = textNode(scope, 'alpha');
    const editor = textNode(container.querySelector<HTMLElement>('[data-editor-code]')!, 'student code');
    setSelection(alpha, 0, editor, editor.textContent!.length);
    const data = clipboard();

    expect(fireEvent.copy(scope, { clipboardData: data })).toBe(true);
    expect(data.setData).not.toHaveBeenCalled();
  });

  it('keeps multiple markers ordered across elements for a reverse selection', () => {
    const source = 'left **middle** right';
    const markers = [
      marker('marker_left', source.indexOf('left') + 2, '[一]'),
      marker('marker_middle', source.indexOf('middle') + 3, '[二]'),
      marker('marker_right', source.indexOf('right') + 2, '[三]'),
    ];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const left = textNode(scope, 'le');
    const right = textNode(scope, 'ght');
    setSelection(left, 0, right, right.textContent!.length, true);
    const data = clipboard();

    fireEvent.copy(container.querySelector('[data-anti-ai-copy-scope]')!, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('le[一]ft mid[二]dle ri[三]ght');
    expect(data.values.get('text/html')).toContain('le[一]ft');
    expect(data.values.get('text/html')).toContain('<strong>mid[二]dle</strong>');
    expect(data.values.get('text/html')).toContain('ri[三]ght');
  });

  it('keeps multiple markers at distinct offsets in the same text node', () => {
    const source = 'abcdef';
    const markers = [marker('marker_same_1', 2, '[甲]'), marker('marker_same_2', 4, '[乙]')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const first = textNode(scope, 'ab');
    const last = textNode(scope, 'ef');
    setSelection(first, 0, last, last.textContent!.length);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('ab[甲]cd[乙]ef');
  });

  it('uses canonical id order when multiple markers share one boundary', () => {
    const source = 'abcd';
    const markers = [marker('marker_shared_b', 2, '[乙]'), marker('marker_shared_a', 2, '[甲]')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const first = textNode(scope, 'ab');
    const last = textNode(scope, 'cd');
    setSelection(first, 0, last, last.textContent!.length);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('ab[甲][乙]cd');
  });

  it('locates a marker inside a fenced code block without changing the rendered code', () => {
    const source = 'before\n\n```cpp\nint value;\n```\n\nafter';
    const markers = [marker('marker_code', source.indexOf('value') + 3, '/*隐藏*/')];
    const { container } = controlledMarkdown(source, markers);
    const code = container.querySelector('code')!;
    expect(code).toHaveTextContent('int value;');
    const firstText = textNode(code, 'int');
    const lastText = textNode(code, 'ue;');
    setSelection(firstText, 0, lastText, lastText.textContent!.length);
    const data = clipboard();

    fireEvent.copy(container.querySelector('[data-anti-ai-copy-scope]')!, { clipboardData: data });
    expect(data.values.get('text/plain')).toContain('val/*隐藏*/ue');
    expect(data.values.get('text/html')).toContain('/*隐藏*/');
    expect(code).not.toHaveTextContent('隐藏');
  });

  it.each([
    ['HTML entity source', 'A &amp; B', (source: string) => source.indexOf('amp;') + 1],
    ['link URL', '[click](https://example.com)', (source: string) => source.indexOf('example')],
    ['Markdown delimiter', '**bold**', (source: string) => source.lastIndexOf('*')],
  ])('rejects a marker inside non-visible %s syntax instead of guessing a nearby DOM position', (_label, source, locate) => {
    expect(() => controlledMarkdown(source, [marker('marker_syntax_hidden', locate(source), '[不可移动]')])).toThrow(
      /cannot be mapped|non-visible Markdown syntax|cannot be rendered/,
    );
  });

  it('preserves blank lines while serializing a marked code block', () => {
    const source = '```cpp\na\n\nb\n```';
    const markers = [marker('marker_code_blank', source.indexOf('\nb\n') + 1, '[代码]')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const code = scope.querySelector('code')!;
    selectContents(code);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toContain('a\n\n[代码]b');
  });

  it('keeps legacy sample cards while injecting a marker inside sample text', () => {
    const source = '说明\n\n```input1\n123\n```\n\n```output1\n456\n```';
    const markers = [marker('marker_sample', source.indexOf('123') + 1, '[样例提示]')];
    const { container } = controlledMarkdown(source, markers);
    expect(screen.getByText('样例输入 #1')).toBeInTheDocument();
    const input = screen.getByText('样例输入 #1').closest('div')?.parentElement?.querySelector('pre');
    if (!input) throw new Error('sample input missing');
    const first = textNode(input, '1');
    const last = textNode(input, '23');
    setSelection(first, 0, last, last.textContent!.length);
    const data = clipboard();

    fireEvent.copy(container.querySelector('[data-anti-ai-copy-scope]')!, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('1[样例提示]23');
    expect(input).toHaveTextContent('123');
    expect(input).not.toHaveTextContent('样例提示');
  });

  it.each([
    ['sample info string', (source: string) => source.indexOf('input1') + 1],
    ['sample closing fence', (source: string) => source.indexOf('```\n\n```output1') + 1],
    ['space between sample fences', (source: string) => source.indexOf('\n\n```output1') + 1],
  ])('rejects an anti AI marker in the %s instead of moving it into visible sample text', (_label, locate) => {
    const source = '```input1\n123\n```\n\n```output1\n456\n```';
    const markers = [marker('marker_sample_invalid', locate(source), '[不可移动]')];

    expect(() => controlledMarkdown(source, markers)).toThrow('Anti AI sample marker is outside visible sample text');
  });

  it.each([
    ['before the first sample', '说明\n\n```input1\n123\n```\n\n```output1\n456\n```', (source: string) => source.indexOf('```input1') - 1],
    ['after the sample group', '```input1\n123\n```\n\n```output1\n456\n```\n\n说明', (source: string) => source.lastIndexOf('说明') - 1],
  ])('rejects a marker in trimmed whitespace %s', (_label, source, locate) => {
    expect(() => controlledMarkdown(source, [marker('marker_trimmed_gap', locate(source), '[不可移动]')])).toThrow(
      'Anti AI marker has no exact render chunk',
    );
  });

  it('supports structured statement paths and selections across sections', () => {
    const statement: ProgrammingStatementViewData = {
      schemaVersion: 1,
      locale: 'zh-CN',
      background: { content: '背景正文' },
      description: { state: 'present', content: '描述正文' },
      input: { state: 'absent', content: '' },
      output: { state: 'absent', content: '' },
      limits: { complete: true, time: '1s', memory: '256m' },
    };
    const markers = [marker('marker_structured', 2, '[结构提示]', 'programmingStatement.description')];
    const { container } = render(
      <AntiAiCopyBoundary markers={markers}>
        <ProgrammingStatementView statement={statement} limits={<span>1 s / 256 MB</span>} antiAiMarkers={markers} />
      </AntiAiCopyBoundary>,
    );
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const background = textNode(scope, '背景正文');
    const descriptionEnd = container.querySelector('[data-anti-ai-marker-id="marker_structured"]')?.nextSibling;
    if (!descriptionEnd) throw new Error('structured marker suffix missing');
    setSelection(background, 0, descriptionEnd, descriptionEnd.textContent!.length);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toContain('描述[结构提示]正文');
  });

  it.each([
    ['single-key object', { zh: 'abcdef' }],
    ['single-key JSON', JSON.stringify({ zh: 'abcdef' })],
    ['localized default key', { default: 'abcdef' }],
  ])('keeps the canonical localized path for %s', (_label, content) => {
    const path = `content.${Object.keys(typeof content === 'string' ? JSON.parse(content) : content)[0]}`;
    const markers = [marker('marker_localized', 3, '[本地化]', path)];
    const { container } = render(
      <AntiAiCopyBoundary markers={markers}>
        <MarkdownView content={content} antiAiPath="content" antiAiMarkers={markers} />
      </AntiAiCopyBoundary>,
    );
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    selectContents(scope.querySelector('.krypton-prose')!);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('abc[本地化]def');
  });

  it('switches marker paths together with the active localized language', () => {
    const markers = [marker('marker_zh_lang', 2, '[中]', 'content.zh'), marker('marker_en_lang', 2, '[EN]', 'content.en')];
    const { container } = render(
      <AntiAiCopyBoundary markers={markers}>
        <MarkdownView content={{ zh: '中文题面', en: 'English' }} preferredLang="zh" antiAiPath="content" antiAiMarkers={markers} />
      </AntiAiCopyBoundary>,
    );
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    selectContents(scope.querySelector('.krypton-prose')!);
    const zhData = clipboard();
    fireEvent.copy(scope, { clipboardData: zhData });
    expect(zhData.values.get('text/plain')).toBe('中文[中]题面');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    selectContents(scope.querySelector('.krypton-prose')!);
    const enData = clipboard();
    fireEvent.copy(scope, { clipboardData: enData });
    expect(enData.values.get('text/plain')).toBe('En[EN]glish');
  });

  it('serializes paragraphs, explicit breaks, and list items from the same injected fragment', () => {
    const source = 'alpha\n\nbeta\n\nline<br>break\n\n- first\n- second';
    const markers = [marker('marker_blocks', source.indexOf('beta') + 2, '[块]')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    selectContents(scope);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('alpha\n\nbe[块]ta\n\nline\nbreak\n\nfirst\nsecond');
    expect(data.values.get('text/html')).toContain('<p>be[块]ta</p>');
  });

  it('keeps table sections and rows separated in plain text', () => {
    const source = '| H1 | H2 |\n| --- | --- |\n| A | B |\n| C | D |';
    const markers = [marker('marker_table', source.lastIndexOf('B'), '[表]')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    selectContents(scope);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('H1\tH2\nA\t[表]B\nC\tD');
    expect(data.values.get('text/html')).toContain('<table>');
  });

  it('treats a rendered LaTeX formula as an atomic marker boundary', () => {
    const source = 'before $a+b$ after';
    const formulaStart = source.indexOf('$a+b$');
    const formulaEnd = formulaStart + '$a+b$'.length;
    const markers = [
      marker('marker_math_start_a', formulaStart, '[前甲]'),
      marker('marker_math_start_b', formulaStart, '[前乙]'),
      marker('marker_math_inside', source.indexOf('+'), '[内部]'),
      marker('marker_math_end', formulaEnd, '[后]'),
    ];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const formula = scope.querySelector<HTMLElement>('.katex')!;
    const visibleFormula = formula.querySelector<HTMLElement>('.katex-html')!;
    const before = textNode(scope, 'before');
    const firstGlyph = textNode(visibleFormula, 'a');
    const inside = textNode(visibleFormula, 'b');
    const after = textNode(scope, 'after');

    setSelection(before, 0, before, before.data.length);
    const touchesStart = clipboard();
    expect(fireEvent.copy(scope, { clipboardData: touchesStart })).toBe(true);
    expect(touchesStart.setData).not.toHaveBeenCalled();

    setSelection(after, 0, after, after.data.length);
    const touchesEnd = clipboard();
    expect(fireEvent.copy(scope, { clipboardData: touchesEnd })).toBe(true);
    expect(touchesEnd.setData).not.toHaveBeenCalled();

    setSelection(inside, 0, inside, inside.textContent!.length);
    const internalData = clipboard();
    expect(fireEvent.copy(scope, { clipboardData: internalData })).toBe(true);
    expect(internalData.setData).not.toHaveBeenCalled();

    setSelection(before, 0, inside, 0);
    const startData = clipboard();
    fireEvent.copy(scope, { clipboardData: startData });
    expect(startData.values.get('text/plain')).toContain('[前甲][前乙]');
    expect(startData.values.get('text/plain')).not.toContain('[内部]');
    expect(startData.values.get('text/plain')).not.toContain('[后]');

    setSelection(inside, 0, after, after.textContent!.length);
    const endData = clipboard();
    fireEvent.copy(scope, { clipboardData: endData });
    expect(endData.values.get('text/plain')).not.toContain('[前甲]');
    expect(endData.values.get('text/plain')).not.toContain('[内部]');
    expect(endData.values.get('text/plain')).toContain('[后]');

    setSelection(before, 0, after, after.textContent!.length);
    const fullData = clipboard();
    fireEvent.copy(scope, { clipboardData: fullData });
    expect(fullData.values.get('text/plain')).toContain('[前甲][前乙]a[内部]+b[后]');
    expect(fullData.values.get('text/html')).toContain('[内部]');

    selectContents(formula);
    const formulaData = clipboard();
    fireEvent.copy(scope, { clipboardData: formulaData });
    expect(formulaData.values.get('text/plain')).toBe('a[内部]+b');
    expect(formulaData.values.get('text/html')).toContain('a[内部]+b');

    setSelection(firstGlyph, 0, inside, inside.data.length);
    const glyphData = clipboard();
    fireEvent.copy(scope, { clipboardData: glyphData });
    expect(glyphData.values.get('text/plain')).toBe('a[内部]+b');

    setSelection(firstGlyph, 0, inside, inside.data.length, true);
    const reverseGlyphData = clipboard();
    fireEvent.copy(scope, { clipboardData: reverseGlyphData });
    expect(reverseGlyphData.values.get('text/plain')).toBe('a[内部]+b');
  });

  it('blocks native copy before validating crossed atomic marker metadata', () => {
    const source = 'before $a$ after';
    const { container } = controlledMarkdown(source, [marker('marker_math_corrupt', source.indexOf('$a$'), '[公式]')]);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const carrier = scope.querySelector<HTMLElement>('[data-anti-ai-atomic-start]')!;
    carrier.setAttribute('data-anti-ai-atomic-start', 'invalid!');
    const before = textNode(scope, 'before');
    const glyph = textNode(scope.querySelector<HTMLElement>('.katex-html')!, 'a');
    setSelection(before, 0, glyph, glyph.data.length);
    const data = clipboard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(fireEvent.copy(scope, { clipboardData: data })).toBe(false);
    expect(data.clearData).toHaveBeenCalledWith('text/plain');
    expect(data.clearData).toHaveBeenCalledWith('text/html');
    expect(screen.getByRole('alert')).toHaveTextContent('复制或剪切失败');
  });

  it('uses the same marker-aware serializer for cut', () => {
    const source = 'alpha beta';
    const { container } = controlledMarkdown(source, [marker('marker_cut', 6, '[剪切]')]);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    selectContents(scope);
    const data = clipboard();

    expect(fireEvent.cut(scope, { clipboardData: data })).toBe(false);
    expect(data.values.get('text/plain')).toBe('alpha [剪切]beta');
    expect(data.values.get('text/html')).toContain('[剪切]');
  });

  it('keeps per-tree LaTeX marker state when one plugin instance processes more than one tree', () => {
    const plugins = createAntiAiMarkerRehypePlugins('$a$', [marker('marker_math_repeat', 0, '[公式]')]);
    const makeTree = () => ({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-inline'] },
          position: { start: { offset: 0 }, end: { offset: 3 } },
          children: [{ type: 'text', value: 'a' }],
        },
      ],
    });
    for (const tree of [makeTree(), makeTree()]) {
      plugins.beforeKatex()(tree);
      expect(tree.children[0].properties).toMatchObject({ 'data-anti-ai-atomic-start': 'marker_math_repeat' });
      plugins.afterTransforms()(tree);
    }
  });

  it('shows a failure and blocks native copy if both MIME formats cannot be written', () => {
    const source = 'alpha beta';
    const markers = [marker('marker_failure', 6, '隐藏')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const first = textNode(scope, 'alpha');
    const last = textNode(scope, 'beta');
    setSelection(first, 0, last, last.textContent!.length);
    let writes = 0;
    const data = clipboard({
      setData: vi.fn(() => {
        writes += 1;
        if (writes === 2) throw new Error('clipboard denied');
      }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(fireEvent.copy(container.querySelector('[data-anti-ai-copy-scope]')!, { clipboardData: data })).toBe(false);
    expect(data.clearData).toHaveBeenCalledWith('text/plain');
    expect(data.clearData).toHaveBeenCalledWith('text/html');
    expect(screen.getByRole('alert')).toHaveTextContent('复制或剪切失败');
    expect(warn).toHaveBeenCalledWith(
      'Controlled statement copy failed',
      expect.objectContaining({
        stage: 'clipboard-write',
        contextId: 'unavailable',
        name: 'Error',
        message: 'clipboard denied',
      }),
    );
  });

  it('blocks native copy when clipboardData is unavailable or cleanup also fails', () => {
    const source = 'alpha beta';
    const markers = [marker('marker_fail_closed', 6, '隐藏')];
    const { container } = controlledMarkdown(source, markers);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    selectContents(scope);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(fireEvent.copy(scope)).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('复制或剪切失败');

    const data = clipboard({
      setData: vi.fn(() => {
        throw new Error('write denied');
      }),
      clearData: vi.fn((mimeType: string) => {
        if (mimeType === 'text/plain') throw new Error('cleanup denied');
      }),
    });
    expect(fireEvent.copy(scope, { clipboardData: data })).toBe(false);
    expect(data.clearData).toHaveBeenCalledWith('text/html');
    expect(warn).toHaveBeenCalledWith(
      'Controlled statement clipboard cleanup failed',
      expect.objectContaining({
        stage: 'clipboard-cleanup',
        contextId: 'unavailable',
        name: 'Error',
        message: 'cleanup denied',
      }),
    );
  });

  it('ignores extra formula index keys while still injecting at the recorded index', () => {
    const source = 'before $a+b$ after';
    const { container } = controlledMarkdown(source, [marker('marker_math_inside', source.indexOf('+'), '[内部]')]);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const carrier = scope.querySelector<HTMLElement>('[data-anti-ai-atomic-indexes]')!;
    carrier.setAttribute('data-anti-ai-atomic-indexes', JSON.stringify([{ id: 'marker_math_inside', index: 1, extra: true }]));
    selectContents(scope.querySelector('.katex')!);
    const data = clipboard();

    fireEvent.copy(scope, { clipboardData: data });
    expect(data.values.get('text/plain')).toBe('a[内部]+b');
  });

  it('blocks copy when formula index JSON is missing required fields', () => {
    const source = 'before $a+b$ after';
    const { container } = controlledMarkdown(source, [marker('marker_math_inside', source.indexOf('+'), '[内部]')]);
    const scope = container.querySelector<HTMLElement>('[data-anti-ai-copy-scope]')!;
    const carrier = scope.querySelector<HTMLElement>('[data-anti-ai-atomic-indexes]')!;
    carrier.setAttribute('data-anti-ai-atomic-indexes', JSON.stringify([{ id: 'marker_math_inside', extra: true }]));
    selectContents(scope.querySelector('.katex')!);
    const data = clipboard();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(fireEvent.copy(scope, { clipboardData: data })).toBe(false);
    expect(data.clearData).toHaveBeenCalledWith('text/plain');
    expect(data.clearData).toHaveBeenCalledWith('text/html');
    expect(screen.getByRole('alert')).toHaveTextContent('复制或剪切失败');
  });

  it('rejects malformed client marker views before rendering a controlled page', () => {
    expect(
      readAntiAiMarkerClientView({
        schemaVersion: 1,
        extra: true,
        markers: [{ id: 'marker_extra', path: 'content', offset: 2, injectionText: '隐藏', unknown: true }],
      }),
    ).toEqual({
      schemaVersion: 1,
      markers: [{ id: 'marker_extra', path: 'content', offset: 2, injectionText: '隐藏' }],
    });
    expect(() =>
      readAntiAiMarkerClientView({
        schemaVersion: 1,
        markers: [{ id: 'marker_invalid', path: 'content', offset: -1, injectionText: '隐藏' }],
      }),
    ).toThrow('antiAiMarkerView marker 0 is invalid');
    expect(() =>
      readAntiAiMarkerClientView({
        schemaVersion: 1,
        markers: [{ id: 'marker_missing', path: 'content', offset: 0 }],
      }),
    ).toThrow('antiAiMarkerView marker 0 is invalid');
  });
});
