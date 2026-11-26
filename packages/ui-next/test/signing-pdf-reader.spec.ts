// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import { readSigningPdfText, signingPdfOutputScale } from '../src/pages/collect/signing-pdf-reader';

function chunk(str: string): TextContent {
  return {
    items: [{ str, dir: 'ltr', transform: [1, 0, 0, 1, 0, 0], width: 20, height: 10, fontName: 'test', hasEOL: false }],
    styles: {},
    lang: 'zh',
  };
}

describe('signing PDF browser compatibility', () => {
  it('reads all Chinese text on a stream without async iteration and releases its lock', async () => {
    const stream = new ReadableStream<TextContent>({
      start(controller) {
        controller.enqueue(chunk('实验室安全'));
        controller.enqueue(chunk('我已阅读并知情'));
        controller.close();
      },
    });
    Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
    expect(await readSigningPdfText(stream)).toBe('实验室安全 我已阅读并知情');
    expect(stream.locked).toBe(false);
  });

  it('surfaces a failed PDF text stream instead of marking the document ready', async () => {
    const stream = new ReadableStream<TextContent>({
      start(controller) {
        controller.error(new Error('text transport failed'));
      },
    });
    await expect(readSigningPdfText(stream)).rejects.toThrow('text transport failed');
    expect(stream.locked).toBe(false);
  });

  it('renders fit-width Chinese text above a low resolution mobile bitmap', () => {
    expect(320 * signingPdfOutputScale(320, 453, 3)).toBeGreaterThanOrEqual(1400);
    expect(signingPdfOutputScale(600, 849, 3)).toBe(3);
    expect(signingPdfOutputScale(320, 453, 3, 2)).toBe(6);
  });

  it('bounds canvas allocation when zooming large pages', () => {
    const scale = signingPdfOutputScale(2400, 3400, 4, 2);
    expect(2400 * 3400 * scale * scale).toBeLessThanOrEqual(8_000_001);
    expect(3400 * scale).toBeLessThanOrEqual(4096);
    expect(10000 * signingPdfOutputScale(100, 10000, 4, 2)).toBeLessThanOrEqual(4096);
  });
});
