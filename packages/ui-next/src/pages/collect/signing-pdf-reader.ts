import type { TextContent } from 'pdfjs-dist/types/src/display/api';

// PDF.js 5's getTextContent uses ReadableStream async iteration, which Android
// WeChat does not consistently expose. The standard reader works on that engine.
export async function readSigningPdfText(stream: ReadableStream<TextContent>): Promise<string> {
  const reader = stream.getReader();
  const text: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text.join(' ');
      for (const item of value.items) if ('str' in item) text.push(item.str);
    }
  } finally {
    reader.releaseLock();
  }
}

export function signingPdfOutputScale(width: number, height: number, pixelRatio: number, pinchScale = 1): number {
  // Keep small Chinese text sharp even at fit width. Bound both canvas memory
  // and its longest edge; zoom always re-renders the PDF instead of stretching it.
  return Math.min(Math.max(pixelRatio * pinchScale, 2, 1400 / width), Math.sqrt(8_000_000 / (width * height)), 4096 / Math.max(width, height));
}
