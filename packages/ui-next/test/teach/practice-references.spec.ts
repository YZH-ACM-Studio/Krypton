// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TeachPaper } from '../../src/pages/teach/model';
import {
  insertItems, moveItem, paperChangeCount, paperFromPayload, paperNumbering,
  paperStagesForSave, removeItem,
} from '../../src/pages/teach/paper';
import { composeReducer, initialComposeState } from '../../src/pages/teach/compose/draft';

function payload(): TeachPaper {
  const stages = [
    { id: 32, title: '2022秋', requireIds: [], pids: [2854, 2855] },
    { id: 28, title: '2021秋', requireIds: [32], pids: [2854] },
    { id: 27, title: '2021夏', requireIds: [], pids: [2854] },
    { id: 26, title: '2021春', requireIds: [], pids: [2854] },
  ];
  return {
    stages,
    // The deployed workbench sends metadata for every chapter reference.
    problems: stages.flatMap((stage) => stage.pids.map((docId) => ({
      docId, pid: `P${docId}`, title: `题目 ${docId}`, kind: 'programming' as const,
      score: null, hidden: false, mine: true, difficulty: null,
    }))),
    examPaperQuotas: null,
  };
}

function paper() {
  return paperFromPayload(payload(), { type: 'practice', rule: 'problem_set' });
}

describe('practice chapter references', () => {
  it('round-trips every chapter, prerequisite and ordered reference without multiplying duplicates', () => {
    const input = payload();
    const before = structuredClone(input);
    const state = paperFromPayload(input, { type: 'practice', rule: 'problem_set' });
    expect(state.items.map(({ stageId, docId }) => [stageId, docId])).toEqual([
      [32, 2854], [32, 2855], [28, 2854], [27, 2854], [26, 2854],
    ]);
    expect(paperStagesForSave(state)).toEqual(input.stages);
    expect(input).toEqual(before);
    expect(paperChangeCount(state, state)).toBe(0);
    expect([...paperNumbering(state)]).toEqual([[2854, '1'], [2855, '2']]);
  });

  it('removes only the clicked chapter reference and records an unsaved change', () => {
    const base = paper();
    const draft = initialComposeState(base, 'upcoming');
    const next = composeReducer(draft, { type: 'remove', docId: 2854, stageId: 28 });
    expect(paperStagesForSave(next.current).map((stage) => stage.pids)).toEqual([
      [2854, 2855], [], [2854], [2854],
    ]);
    expect(paperChangeCount(base, next.current)).toBe(1);
    expect(paperStagesForSave(base)).toEqual(payload().stages);
  });

  it('moves one reference, reorders within its exact chapter, and leaves other references intact', () => {
    const base = paper();
    const reordered = moveItem(base, 2855, { beforeDocId: 2854, stageId: 32 }, 32);
    expect(paperStagesForSave(reordered)[0]?.pids).toEqual([2855, 2854]);
    const moved = moveItem(base, 2855, { beforeDocId: 2854, stageId: 27 }, 32);
    expect(paperStagesForSave(moved).map((stage) => stage.pids)).toEqual([
      [2854], [2854], [2855, 2854], [2854],
    ]);
    expect(paperChangeCount(base, moved)).toBe(1);
    // Dropping onto an existing reference cannot silently remove the source.
    expect(moveItem(base, 2854, { beforeDocId: null, stageId: 28 }, 32)).toBe(base);
  });

  it('rejects an ambiguous unscoped removal instead of deleting all copies', () => {
    expect(() => removeItem(paper(), 2854)).toThrow('paper_item_ambiguous');
  });

  it('deduplicates additions within a chapter, not across chapters', () => {
    const base = paper();
    const item = base.items.find((entry) => entry.docId === 2855);
    if (!item) throw new Error('fixture missing');
    const added = insertItems(base, [item, item], { beforeDocId: 2854, stageId: 28 });
    expect(paperStagesForSave(added).map((stage) => stage.pids)).toEqual([
      [2854, 2855], [2855, 2854], [2854], [2854],
    ]);
    expect(paperChangeCount(base, added)).toBe(1);
  });
});
