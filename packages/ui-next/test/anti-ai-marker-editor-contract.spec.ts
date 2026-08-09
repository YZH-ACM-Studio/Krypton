import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('p1.6 problem editor marker wiring', () => {
  it('submits marker input and a structure revision from every existing problem editor', () => {
    for (const file of [
      'src/pages/problem-edit.tsx',
      'src/pages/basic-objective-editors.tsx',
      'src/pages/subjective-editor.tsx',
      'src/pages/structured-code-editors.tsx',
    ]) {
      const source = read(file);
      expect(source, file).toMatch(/(?:formData|fd)\.set\('antiAiMarkers'/);
      expect(source, file).toContain('expectedStructureRevision');
      expect(source, file).toContain('serializeAntiAiMarkerInput');
    }
  });

  it('keeps marker drafts out of native FormData until the conditional canonical serializer runs', () => {
    for (const file of ['src/pages/basic-objective-editors.tsx', 'src/pages/subjective-editor.tsx', 'src/pages/structured-code-editors.tsx']) {
      const source = read(file);
      expect(source, file).not.toMatch(/<input[^>]+name="antiAiMarkers"/);
      expect(source, file).toContain("formData.set('antiAiMarkers', JSON.stringify(serializeAntiAiMarkerInput(antiAiMarkers)))");
    }
  });

  it('assigns a canonical path to legacy and every structured Markdown section', () => {
    const programming = read('src/pages/problem-edit.tsx');
    const statement = read('src/components/programming-statement.tsx');
    expect(programming).toContain('antiAiPath="content"');
    for (const path of [
      'programmingStatement.background',
      'programmingStatement.description',
      'programmingStatement.input',
      'programmingStatement.output',
      'programmingStatement.hints',
    ]) {
      expect(statement, path).toContain(path);
    }
    expect(statement).toMatch(/programmingStatement\.examples\.\$\{index\}\.note/);
  });
});
