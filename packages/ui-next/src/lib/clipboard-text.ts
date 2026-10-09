export interface ClipboardTextData {
  readonly types: readonly string[];
  getData(type: string): string;
}

export function normalizeClipboardLineEndings(text: string): string {
  return text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
}

export function clipboardTextHasContent(text: string): boolean {
  return normalizeClipboardLineEndings(text).trim().length > 0;
}

function plainTextCharset(type: string): string | null {
  const normalizedType = type.trim().toLowerCase();
  const parameterSeparator = normalizedType.indexOf(';');
  if (parameterSeparator === -1 || normalizedType.slice(0, parameterSeparator).trim() !== 'text/plain') return null;
  const charset = normalizedType.slice(parameterSeparator + 1).match(/charset\s*=\s*"?([^";]+)"?/);
  return (charset?.[1] || '').trim().toLowerCase();
}

function plainTextPreference(charset: string): number {
  if (charset === 'utf-8' || charset === 'utf8') return 0;
  if (charset.startsWith('utf-16')) return 1;
  if (charset === 'us-ascii' || charset === 'ascii') return 3;
  return 2;
}

/**
 * Read a plain-text flavor CodeMirror's exact `text/plain` lookup does not see.
 * UTF-8 wins over an earlier US-ASCII flavor. JetBrains rich-text copies that
 * expose only editor HTML are reduced to the code text.
 */
export function readAlternatePlainText(data: ClipboardTextData): string | null {
  const parameterized = data.types
    .map((type) => ({ type, charset: plainTextCharset(type) }))
    .filter((entry): entry is { type: string; charset: string } => entry.charset !== null)
    .sort((left, right) => plainTextPreference(left.charset) - plainTextPreference(right.charset));
  for (const entry of parameterized) {
    const text = data.getData(entry.type);
    if (clipboardTextHasContent(text)) return normalizeClipboardLineEndings(text);
  }

  const legacyText = data.getData('Text');
  if (clipboardTextHasContent(legacyText)) return normalizeClipboardLineEndings(legacyText);
  return readEditorHtmlText(data);
}

function clipboardMarksEditorCopy(types: readonly string[]): boolean {
  return types.some((type) => type.toLowerCase().includes('jetbrains'));
}

function editorHtmlText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const root = document.querySelector('pre') ?? document.body;
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (node.tagName === 'BR') return '\n';
    const text = Array.from(node.childNodes).map(visit).join('');
    if (node === root || node.tagName === 'PRE') return text;
    if (node.tagName === 'DIV' || node.tagName === 'P' || node.tagName === 'LI' || node.tagName === 'TR') {
      return text.endsWith('\n') ? text : `${text}\n`;
    }
    return text;
  };
  return visit(root).replace(/\n$/, '');
}

function readEditorHtmlText(data: ClipboardTextData): string | null {
  const html = data.getData('text/html');
  if (!html.trim()) return null;
  const editorCopy = clipboardMarksEditorCopy(data.types) || /<pre[\s>/]/i.test(html) || /jetbrains/i.test(html);
  if (!editorCopy) return null;
  const text = normalizeClipboardLineEndings(editorHtmlText(html));
  return clipboardTextHasContent(text) ? text : null;
}
