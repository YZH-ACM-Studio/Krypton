import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveChapterId, useChapterQuery, withChapterQuery } from '../src/pages/course/chapter-query.ts';

const CHAPTERS = [{ _id: 2 }, { _id: 5 }, { _id: 9 }];
const SECTIONED = [
  { _id: 2, sections: [{ _id: 1 }, { _id: 2 }] },
  { _id: 5, sections: [{ _id: 1 }] },
  { _id: 9, sections: [] },
];

describe('resolveChapterId', () => {
  it('treats blank and non-numeric raw values as absent', () => {
    expect(resolveChapterId([2, 5], ' ')).to.equal(2);
    expect(resolveChapterId([2, 5], 'abc')).to.equal(2);
  });

  it('falls back to the first id when the preferred id is not offered', () => {
    expect(resolveChapterId([2, 5], null, 7)).to.equal(2);
    expect(resolveChapterId([2, 5], 'nope', 7)).to.equal(2);
  });

  it('supports a chapter id of zero as the first chapter', () => {
    expect(resolveChapterId([0, 3], 'nope')).to.equal(0);
    expect(resolveChapterId([0, 3], '0')).to.equal(0);
  });
});

describe('withChapterQuery', () => {
  it('replaces an existing chapter parameter and keeps other parts of the url', () => {
    expect(withChapterQuery('https://oj.test/c?a=1&chapter=3#top', 9)).to.equal('https://oj.test/c?a=1&chapter=9#top');
  });

  it('rejects relative hrefs', () => {
    expect(() => withChapterQuery('/course/1', 9)).to.throw(TypeError);
  });
});

describe('useChapterQuery', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/course/1');
  });

  it('canonicalizes a missing chapter parameter via replaceState on mount', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { result } = renderHook(() => useChapterQuery(CHAPTERS));
    expect(result.current.activeId).to.equal(2);
    expect(window.location.search).to.equal('?chapter=2');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('honors a valid deep link without rewriting the url', () => {
    window.history.replaceState(null, '', '/course/1?chapter=5');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => useChapterQuery(CHAPTERS));
    expect(result.current.activeId).to.equal(5);
    expect(window.location.search).to.equal('?chapter=5');
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('rewrites an invalid deep link to the preferred chapter', () => {
    window.history.replaceState(null, '', '/course/1?chapter=404');
    const { result } = renderHook(() => useChapterQuery(CHAPTERS, 9));
    expect(result.current.activeId).to.equal(9);
    expect(window.location.search).to.equal('?chapter=9');
  });

  it('pushes history when selecting a chapter and replaces when asked to', () => {
    const { result } = renderHook(() => useChapterQuery(CHAPTERS));
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    act(() => result.current.selectChapter(5));
    expect(result.current.activeId).to.equal(5);
    expect(window.location.search).to.equal('?chapter=5');
    expect(pushSpy).toHaveBeenCalledTimes(1);

    act(() => result.current.selectChapter(9, true));
    expect(result.current.activeId).to.equal(9);
    expect(window.location.search).to.equal('?chapter=9');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores selection of a chapter that is not offered', () => {
    const { result } = renderHook(() => useChapterQuery(CHAPTERS));
    const pushSpy = vi.spyOn(window.history, 'pushState');
    act(() => result.current.selectChapter(999));
    expect(result.current.activeId).to.equal(2);
    expect(window.location.search).to.equal('?chapter=2');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('re-syncs from the location on popstate', () => {
    const { result } = renderHook(() => useChapterQuery(CHAPTERS));
    expect(result.current.activeId).to.equal(2);
    act(() => {
      window.history.pushState(null, '', '/course/1?chapter=9');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.activeId).to.equal(9);
  });

  it('honors a valid chapter and section deep link', () => {
    window.history.replaceState(null, '', '/course/1?chapter=2&section=2');
    const { result } = renderHook(() => useChapterQuery(SECTIONED));
    expect(result.current.activeId).to.equal(2);
    expect(result.current.activeSectionId).to.equal(2);
    expect(window.location.search).to.equal('?chapter=2&section=2');
  });

  it('drops an invalid section on a valid chapter', () => {
    window.history.replaceState(null, '', '/course/1?chapter=5&section=9');
    const { result } = renderHook(() => useChapterQuery(SECTIONED));
    expect(result.current.activeId).to.equal(5);
    expect(result.current.activeSectionId).to.equal(null);
    expect(window.location.search).to.equal('?chapter=5');
  });

  it('does not apply a section from an invalid chapter onto the fallback chapter', () => {
    window.history.replaceState(null, '', '/course/1?chapter=404&section=1');
    const { result } = renderHook(() => useChapterQuery(SECTIONED, 5));
    expect(result.current.activeId).to.equal(5);
    expect(result.current.activeSectionId).to.equal(null);
    expect(window.location.search).to.equal('?chapter=5');
  });

  it('selects a section and clears it when returning to the chapter', () => {
    const { result } = renderHook(() => useChapterQuery(SECTIONED));
    act(() => result.current.selectSection(2, 2));
    expect(result.current.activeId).to.equal(2);
    expect(result.current.activeSectionId).to.equal(2);
    expect(window.location.search).to.equal('?chapter=2&section=2');
    act(() => result.current.selectChapter(2));
    expect(result.current.activeSectionId).to.equal(null);
    expect(window.location.search).to.equal('?chapter=2');
  });

  it('stays inert when no chapters exist', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { result } = renderHook(() => useChapterQuery([]));
    expect(result.current.activeId).to.equal(null);
    act(() => result.current.selectChapter(1));
    expect(result.current.activeId).to.equal(null);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.location.search).to.equal('');
  });
});
