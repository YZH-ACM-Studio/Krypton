import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('user profile completions', () => {
  it('replaces the tag histogram with problem-set and knowledge-node counts', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/user.tsx'), 'utf8');
    expect(source).to.include('题集完成');
    expect(source).to.include('知识点完成');
    expect(source).to.include('problemSetCompletions');
    expect(source).to.include('knowledgeNodeCompletions');
    expect(source).not.to.include('常通过标签');
  });

  it('renders completion rows as a ranked list with full titles', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/user.tsx'), 'utf8');
    expect(source).to.include('function CompletionList');
    expect(source).to.include('break-words');
    expect(source).to.include('item.subtitle');
    expect(source).not.to.include('w-24 truncate');
    expect(source).not.to.include('function CompletionHistogram');
  });
});
