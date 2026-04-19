/**
 * Extract sample input/output pairs from markdown content.
 *
 * Detects fenced code blocks with language tags like:
 *   ```input1    ```output1
 *   ```input2    ```output2
 *
 * This is the same convention used by Hydro OJ problem templates.
 */

export interface SampleCase {
  id: number;
  input: string;
  output: string;
}

/**
 * Parse markdown source to find `\`\`\`inputN` / `\`\`\`outputN` pairs.
 * Content may be a plain string or a JSON `{"zh":"…","en":"…"}` object.
 */
export function extractSamples(content: string | Record<string, string>): SampleCase[] {
  const md = typeof content === 'string' ? content : Object.values(content)[0] || '';
  if (!md) return [];

  // Collect all inputN and outputN blocks
  const inputs = new Map<number, string>();
  const outputs = new Map<number, string>();

  // Match ```inputN ... ``` and ```outputN ... ```
  const fenceRe = /```(input|output)(\d+)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(md)) !== null) {
    const type = m[1].toLowerCase();
    const id = parseInt(m[2], 10);
    const body = m[3].replace(/\n$/, ''); // trim trailing newline
    if (type === 'input') {
      inputs.set(id, body);
    } else {
      outputs.set(id, body);
    }
  }

  // Build pairs sorted by id
  const ids = [...new Set([...inputs.keys(), ...outputs.keys()])].sort((a, b) => a - b);
  return ids.map((id) => ({
    id,
    input: inputs.get(id) ?? '',
    output: outputs.get(id) ?? '',
  }));
}

/** Parse content from JSON format (same as markdown-renderer.tsx) */
export function resolveContentString(content: string | Record<string, string>): string {
  if (typeof content !== 'string') return Object.values(content)[0] || '';
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return Object.values(parsed).find((v): v is string => typeof v === 'string') || trimmed;
      }
    } catch { /* not JSON */ }
  }
  return trimmed;
}

/**
 * Strip sample fenced code blocks (```inputN / ```outputN) from markdown source
 * so they are not rendered as normal code blocks by MarkdownView.
 */
export function stripSampleBlocks(md: string): string {
  return md.replace(/```(?:input|output)\d+\s*\n[\s\S]*?```/gi, '').trim();
}
