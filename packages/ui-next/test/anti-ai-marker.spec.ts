import { describe, expect, it } from 'vitest';
import {
  antiAiCopyPreview,
  createAntiAiMarker,
  readAntiAiMarkerDrafts,
  remapAntiAiMarkers,
  serializeAntiAiMarkerInput,
  type AntiAiMarkerDraft,
} from '../src/lib/anti-ai-marker';

function marker(offset: number, affinity: 'before' | 'after' = 'after'): AntiAiMarkerDraft {
  return createAntiAiMarker('content', offset, '隐藏提示', affinity, 'marker_0001');
}

describe('anti AI marker authoring state', () => {
  it('maps exact insertions before and at a marker without guessing', () => {
    expect(remapAntiAiMarkers([marker(3)], 'content', 'abcdef', 'abXcdef')[0].anchor.offset).toBe(4);
    expect(remapAntiAiMarkers([marker(3, 'before')], 'content', 'abcdef', 'abcXdef')[0].anchor.offset).toBe(3);
    expect(remapAntiAiMarkers([marker(3, 'after')], 'content', 'abcdef', 'abcXdef')[0].anchor.offset).toBe(4);
  });

  it('marks a deletion or replacement crossing the boundary as a blocking conflict', () => {
    const [removed] = remapAntiAiMarkers([marker(3)], 'content', 'abcdef', 'abef');
    expect(removed.conflict).toContain('跨过');
    expect(() => serializeAntiAiMarkerInput([removed])).toThrow('尚未重新定位');
    const [afterUnrelatedEdit] = remapAntiAiMarkers([removed], 'content', 'abef', 'abefx');
    expect(afterUnrelatedEdit).toEqual(removed);
    expect(() => serializeAntiAiMarkerInput([afterUnrelatedEdit])).toThrow('尚未重新定位');
    expect(remapAntiAiMarkers([marker(4, 'before')], 'content', 'abcdef', 'abef')[0].conflict).toContain('跨过');
    expect(remapAntiAiMarkers([marker(4, 'after')], 'content', 'abcdef', 'abef')[0].anchor.offset).toBe(2);
  });

  it('keeps other statement paths untouched and produces an explicit copy-result preview', () => {
    const other = createAntiAiMarker('programmingStatement.hints', 1, '提示词', 'after', 'marker_0002');
    expect(remapAntiAiMarkers([other], 'content', 'abc', 'abcd')).toEqual([other]);
    expect(antiAiCopyPreview('abcd', [marker(2)])).toBe('ab隐藏提示cd');
  });

  it('serializes no internal contexts and preserves an existing marker revision', () => {
    const input = serializeAntiAiMarkerInput([{ ...marker(2), revision: 7 }]);
    expect(input).toEqual({
      schemaVersion: 1,
      markers: [
        {
          id: 'marker_0001',
          anchor: { path: 'content', offset: 2, affinity: 'after' },
          injectionText: '隐藏提示',
          revision: 7,
        },
      ],
    });
  });

  it('requires author marker identity while ignoring extra keys and optional anchor context', () => {
    const stored = {
      schemaVersion: 1,
      extra: true,
      markers: [
        {
          id: 'marker_0001',
          unknown: true,
          anchor: { path: 'content', offset: 2, affinity: 'after' as const, before: 'ab', after: 'cd', extra: 'ignored' },
          injectionText: '隐藏提示',
          revision: 3,
        },
      ],
    };
    const expected = [{ ...marker(2), revision: 3 }];
    expect(readAntiAiMarkerDrafts(stored)).toEqual(expected);
    expect(
      readAntiAiMarkerDrafts({
        schemaVersion: 1,
        markers: [
          {
            id: 'marker_0001',
            anchor: { path: 'content', offset: 2, affinity: 'after' },
            injectionText: '隐藏提示',
            revision: 3,
          },
        ],
      }),
    ).toEqual(expected);
    expect(() =>
      readAntiAiMarkerDrafts({
        schemaVersion: 1,
        markers: [{ id: 'marker_0001', injectionText: '隐藏提示', revision: 3 }],
      }),
    ).toThrow('invalid');
    expect(() =>
      readAntiAiMarkerDrafts({
        schemaVersion: 1,
        markers: [
          {
            id: 'marker_0001',
            anchor: { path: 'content', offset: 2 },
            injectionText: '隐藏提示',
            revision: 3,
          },
        ],
      }),
    ).toThrow('invalid');
  });
});
