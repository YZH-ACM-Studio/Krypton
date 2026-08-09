export interface ClipboardTextData {
  readonly types: readonly string[];
  getData(type: string): string;
}

export function normalizeClipboardLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Read standards-compatible plain-text variants that CodeMirror's exact
 * `text/plain` lookup does not see. HTML and vendor payloads are deliberately
 * ignored: source code must enter the editor through a plain-text flavor.
 */
export function readAlternatePlainText(data: ClipboardTextData): string | null {
  for (const type of data.types) {
    const normalizedType = type.trim().toLowerCase();
    const parameterSeparator = normalizedType.indexOf(';');
    if (parameterSeparator === -1 || normalizedType.slice(0, parameterSeparator).trim() !== 'text/plain') continue;
    const text = data.getData(type);
    if (text) return normalizeClipboardLineEndings(text);
  }

  const legacyText = data.getData('Text');
  if (legacyText) return normalizeClipboardLineEndings(legacyText);
  return null;
}
