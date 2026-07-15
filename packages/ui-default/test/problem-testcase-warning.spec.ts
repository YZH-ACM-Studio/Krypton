import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import nunjucks from 'nunjucks';
import { describe, it } from 'node:test';

const template = readFileSync(resolve(process.cwd(), 'packages/ui-default/templates/partials/problem_description.html'), 'utf8');

interface StringPrototypeWithFormat {
  format?: (...values: unknown[]) => string;
}

function renderProblemDescription(pdoc: Record<string, unknown>, tdoc: Record<string, unknown> | null = null): string {
  const env = new nunjucks.Environment(undefined, { autoescape: true });
  env.addGlobal('_', (value: string) => value);
  env.addGlobal('Array', Array);
  env.addGlobal('typeof', (value: unknown) => typeof value);
  env.addGlobal('instanceof', (value: unknown, constructor: new (...args: any[]) => unknown) => value instanceof constructor);
  env.addFilter('content', (value) => value);

  const prototype = String.prototype as unknown as StringPrototypeWithFormat;
  const originalFormat = prototype.format;
  prototype.format = function format(...values: unknown[]) {
    return values.reduce<string>((output, value, index) => output.replaceAll(`{${index}}`, String(value)), String(this));
  };
  try {
    return env.renderString(template, { pdoc, renderredContent: 'statement', tdoc });
  } finally {
    if (originalFormat) prototype.format = originalFormat;
    else delete prototype.format;
  }
}

describe('ui-default problem testcase warning', () => {
  it('renders the warning only for parsed local configs without testcases', () => {
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
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
      ['configured testcase', { config: { type: 'default', count: 1 } }, false],
    ];

    for (const [name, pdoc, expected] of cases) {
      const output = renderProblemDescription(pdoc);
      expect(output.includes('No testdata at current.'), name).to.equal(expected);
    }
  });

  it('keeps a config parse error visible without adding the no-testdata warning', () => {
    const output = renderProblemDescription({ config: 'Cannot parse: invalid yaml' });

    expect(output).to.include('Cannot parse: invalid yaml');
    expect(output).not.to.include('No testdata at current.');
  });

  it('preserves the legacy warning behavior for exam pages', () => {
    const exam = { rule: 'exam' };

    expect(renderProblemDescription({ config: { count: 0 }, data: [{ name: 'config.yaml' }] }, exam)).not.to.include('No testdata at current.');
    expect(renderProblemDescription({ config: { count: 0 }, data: [] }, exam)).to.include('No testdata at current.');
  });
});
