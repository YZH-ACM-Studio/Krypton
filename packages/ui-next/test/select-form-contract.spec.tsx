import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimpleSelect } from '../src/components/ui/select';

const options = [
  { value: 'acm', label: 'XCPC' },
  { value: 'oi', label: 'OI' },
];

describe('team contest rule form contract', () => {
  it('submits exactly one canonical ACM rule in team mode', () => {
    const participationMode = 'team';
    const markup = renderToStaticMarkup(
      <form>
        <SimpleSelect name={participationMode === 'team' ? undefined : 'rule'} value="oi" disabled options={options} />
        <input type="hidden" name="rule" value="acm" />
      </form>,
    );

    expect(markup.match(/name="rule"/g)).to.have.length(1);
    expect(markup).not.to.include('name="rule" value="oi"');
    expect(markup).to.include('name="rule" value="acm"');
    expect(readFileSync(resolve(import.meta.dirname, '../src/pages/contest-manage.tsx'), 'utf8')).to.include(
      "name={participationMode === 'team' ? undefined : 'rule'}",
    );
  });
});
