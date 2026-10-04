import { describe, expect, it } from 'vitest';
import { mergeFetchedProblemTitles, type ProblemOption } from '../src/lib/multi-select-presets';

const row = (pid: string): ProblemOption => ({ docId: Number(pid) || 0, pid, title: '' });

describe('mergeFetchedProblemTitles', () => {
  it('fills titles for rows still selected, in their current order', () => {
    const fetched = [{ docId: 1, pid: 'P1', title: 'A' }, { docId: 2, pid: 'P2', title: 'B' }];
    const merged = mergeFetchedProblemTitles([row('P2'), row('P1')], ['P1', 'P2'], fetched);
    expect(merged.map((p) => p.title)).toEqual(['B', 'A']);
  });

  it('does not add back a row removed before the request returned', () => {
    const fetched = [{ docId: 1, pid: 'P1', title: 'A' }, { docId: 2, pid: 'P2', title: 'B' }];
    const merged = mergeFetchedProblemTitles([row('P2')], ['P1', 'P2'], fetched);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.pid).toBe('P2');
  });

  it('keeps a row as is when no title came back', () => {
    const kept = row('P3');
    const merged = mergeFetchedProblemTitles([kept], ['P3'], [{ docId: 0, pid: 'P3', title: '' }]);
    expect(merged[0]).toBe(kept);
  });
});
