import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contest list create exam link', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/pages/contests.tsx'), 'utf8');

  it('keeps create contest query-free and adds create exam with rule=exam', () => {
    expect(source).to.include('<a href={`${bs.urls.contests}/create`}>创建比赛</a>');
    expect(source).to.include('<a href={`${bs.urls.contests}/create?rule=exam`}>创建考试</a>');
    expect(source).not.to.include('<a href={`${bs.urls.contests}/create?rule=exam`}>创建比赛</a>');
    expect(source).not.to.include('<a href={`${bs.urls.contests}/create`}>创建考试</a>');
  });

  it('does not change the contest list rule filter', () => {
    expect(source).to.include('name="rule"');
    expect(source).to.include('defaultValue={currentRule}');
    expect(source).to.include('options={[{ value: \'\', label: \'全部\' }, ...Object.entries(rules).map(([key, label]) => ({ value: key, label }))]}');
  });
});
