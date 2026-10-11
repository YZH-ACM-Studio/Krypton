import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateVigilTokenCache, listContestRecordings, VigilOfflineError, type VigilRecording } from '../src/lib/vigil-api';
import { hasRecordingTiming, probeRecordingDuration } from '../src/pages/vigil/recording-timeline';

function recording(n: number): VigilRecording {
  return {
    recordingId: `rec-${n}`, machineId: `machine-${n}`, uid: n, streamType: 'screen',
    filename: 'test.mp4', url: '/test.mp4', size: 1024, durationMs: 1000,
    startTs: '2026-10-11T10:00:00.123456', endTs: '2026-10-11T10:00:01.123456',
  };
}

function servePages(handler: (url: URL) => unknown) {
  invalidateVigilTokenCache();
  const fetch = vi.fn(async (input: string | URL | Request) => {
    if (String(input) === '/api/admin/vigil/dashboard-token') {
      return new Response(JSON.stringify({
        token: 'test-token', vigilBaseUrl: 'http://vigil.example',
        expiresAt: Date.now() + 3600000,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    const data = handler(new URL(String(input)));
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.useRealTimers());

describe('complete recording index', () => {
  it('loads more than 1000 records, preserving cursor precision and old student recordings', async () => {
    const rows = Array.from({ length: 1005 }, (_, n) => recording(n));
    let count = 0;
    servePages((url) => {
      expect(url.pathname).toBe('/api/admin/vigil/proctor/contests/test/recordings');
      expect(url.searchParams.get('limit')).toBe('200');
      if (count > 0) {
        expect(url.searchParams.get('beforeRecordingId')).toBe(`rec-${count * 200 - 1}`);
        expect(url.searchParams.get('beforeStartTs')).toBe(rows[0].startTs);
      }
      return rows.slice(count++ * 200, count * 200);
    });
    const all = await listContestRecordings('test');
    expect(all).toEqual(rows);
    expect(all.find((row) => row.uid === 1004)?.recordingId).toBe('rec-1004');
    expect(count).toBe(6);
  });

  it('does not return partial success when a later page fails', async () => {
    let count = 0;
    servePages(() => {
      if (count++ > 0) throw new Error('page unavailable');
      return Array.from({ length: 200 }, (_, n) => recording(n));
    });
    await expect(listContestRecordings('test')).rejects.toBeInstanceOf(VigilOfflineError);
  });

  it('rejects a server that ignores the cursor instead of looping or hiding duplicates', async () => {
    let count = 0;
    servePages(() => {
      count++;
      return Array.from({ length: 200 }, (_, n) => recording(n));
    });
    await expect(listContestRecordings('test')).rejects.toThrow('分页重复');
    expect(count).toBe(2);
  });

  it('fetches the empty last page when the count is an exact page multiple', async () => {
    let count = 0;
    servePages(() => count++ === 0 ? Array.from({ length: 200 }, (_, n) => recording(n)) : []);
    expect(await listContestRecordings('test')).toHaveLength(200);
    expect(count).toBe(2);
  });
});

describe('legacy recording durations', () => {
  function fakeVideo(duration: number) {
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: duration });
    vi.spyOn(video, 'load').mockImplementation(() => {});
    vi.spyOn(document, 'createElement').mockReturnValue(video);
    return video;
  }

  it('does not treat callback timestamps or nonfinite durations as real recording timing', () => {
    expect(hasRecordingTiming(recording(1))).toBe(true);
    expect(hasRecordingTiming({ ...recording(1), durationMs: 0 })).toBe(false);
    expect(hasRecordingTiming({ ...recording(1), endTs: recording(1).startTs })).toBe(false);
    expect(hasRecordingTiming({ ...recording(1), startTs: 'invalid' })).toBe(false);
    expect(hasRecordingTiming({ ...recording(1), durationMs: Infinity })).toBe(false);
  });

  it('reads legacy duration without persisting or changing a recording', async () => {
    const video = fakeVideo(7600.933);
    const result = probeRecordingDuration('/test.mp4');
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(await result).toBe(7600.933);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.onerror).toBeNull();
  });

  it('reports media read failure instead of silently returning zero', async () => {
    const video = fakeVideo(0);
    const result = expect(probeRecordingDuration('/test.mp4')).rejects.toThrow('无法读取录像时长');
    video.dispatchEvent(new Event('error'));
    await result;
  });

  it('rejects invalid metadata duration', async () => {
    const video = fakeVideo(Infinity);
    const result = expect(probeRecordingDuration('/test.mp4')).rejects.toThrow('录像时长无效');
    video.dispatchEvent(new Event('loadedmetadata'));
    await result;
  });

  it('times out metadata loads and releases the media source', async () => {
    vi.useFakeTimers();
    const video = fakeVideo(0);
    const result = expect(probeRecordingDuration('/test.mp4')).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(video.getAttribute('src')).toBeNull();
  });
});
