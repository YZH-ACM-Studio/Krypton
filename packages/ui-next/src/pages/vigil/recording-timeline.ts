import type { VigilRecording } from '@/lib/vigil-api';
import { parseVigilTimestamp } from '@/pages/vigil/timestamp';

export function hasRecordingTiming(recording: VigilRecording): boolean {
  const start = parseVigilTimestamp(recording.startTs)?.getTime();
  const end = parseVigilTimestamp(recording.endTs)?.getTime();
  return Number.isFinite(recording.durationMs) && recording.durationMs > 0
    && start != null && end != null && end > start;
}

/** Legacy records have no persisted duration. Read media metadata without writing it back. */
export function probeRecordingDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const finish = (error: string | null) => {
      const seconds = video.duration;
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (error) reject(new Error(error));
      else if (!Number.isFinite(seconds) || seconds <= 0) reject(new Error('录像时长无效，无法构建播放进度。'));
      else resolve(seconds);
    };
    const timeout = setTimeout(() => finish('读取录像时长超时，请重试。'), 10_000);
    video.onloadedmetadata = () => finish(null);
    video.onerror = () => finish('无法读取录像时长，请检查录像是否可访问后重试。');
    video.src = url;
  });
}
