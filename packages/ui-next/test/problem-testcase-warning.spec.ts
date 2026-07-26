import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldShowNoTestdataWarning } from '../src/lib/problem-testcase-warning.ts';

const workspaceRoot = resolve(import.meta.dirname, '../..');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P1.9 problem testcase warning contract', () => {
  it('decides from parsed testcase semantics rather than file presence', () => {
    const cases: Array<[string, Parameters<typeof shouldShowNoTestdataWarning>[0], boolean]> = [
      ['missing config', {}, false],
      ['null config', { config: null }, false],
      ['parse failure', { config: 'Cannot parse: invalid yaml' }, false],
      ['invalid array config', { config: [] }, false],
      ['reference problem', { config: { type: 'default', count: 0 }, reference: 'remote/1' }, false],
      ['remote judge', { config: { type: 'remote_judge', count: 0 } }, false],
      ['text program fill', { config: { type: 'program_fill', mode: 'text', count: 0 } }, false],
      ['default without cases', { config: { type: 'default', count: 0 } }, true],
      ['function without cases', { config: { type: 'function', count: 0 } }, true],
      ['compiled program fill without cases', { config: { type: 'program_fill', mode: 'compile', count: 0 } }, true],
      ['submit answer without cases', { config: { type: 'submit_answer', count: 0 } }, true],
      ['numeric testcase count', { config: { type: 'default', count: 1 } }, false],
      ['serialized testcase count', { config: { type: 'default', count: '1' } }, false],
    ];

    for (const [name, pdoc, expected] of cases) {
      expect(shouldShowNoTestdataWarning(pdoc), name).to.equal(expected);
    }

    expect(shouldShowNoTestdataWarning({ config: { type: 'default', count: 0 } }, true), 'exam mode').to.equal(false);
  });

  it('uses the parsed testcase count instead of the testdata file count in ui-default', () => {
    const template = read('ui-default/templates/partials/problem_description.html');

    expect(template).to.include("pdoc.config and typeof(pdoc.config) == 'object'");
    expect(template).to.include('not instanceof(pdoc.config, Array)');
    expect(template).to.include("pdoc.config.type != 'remote_judge'");
    expect(template).to.include("pdoc.config.type == 'program_fill' and pdoc.config.mode == 'text'");
    expect(template).to.include('not pdoc.config.count and not pdoc.reference');
    expect(template).to.include('preserveExamWarning and not pdoc.data.length');
  });

  it('shows the same warning in both normal and IDE ui-next problem views', () => {
    const detail = read('ui-next/src/pages/problem-detail.tsx');

    expect(detail).to.include('此题没有测试点');
    expect(detail).to.include('const showNoTestdataWarning = shouldShowNoTestdataWarning(pdoc, !!examMode?.enabled);');
    expect(detail.match(/<NoTestdataWarning \/>/g)).to.have.length(2);
  });
});
