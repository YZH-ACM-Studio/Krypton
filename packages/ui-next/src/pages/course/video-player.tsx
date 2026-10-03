import { useEffect, useRef, useState } from 'react';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import {
  clampPlaybackRate,
  COURSE_VIDEO_HEARTBEAT_MS,
  COURSE_VIDEO_RATES,
  coveragePercent,
  heartbeatCovered,
  shouldBlockForwardSeek,
} from '@/lib/course-video-watch';
import type { CourseStudentVideo } from './types';

export function CourseVideoPlayer({
  courseId,
  video,
}: {
  courseId: string;
  video: CourseStudentVideo;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const lastLegal = useRef(video.lastPosition || 0);
  const beatFrom = useRef(video.lastPosition || 0);
  const ignoreSeek = useRef(false);
  const [rate, setRate] = useState(1);
  const [coverage, setCoverage] = useState(coveragePercent(video.coverageRatio));
  const [completed, setCompleted] = useState(video.completed);
  const [error, setError] = useState('');

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    node.currentTime = video.lastPosition || 0;
    lastLegal.current = video.lastPosition || 0;
    beatFrom.current = video.lastPosition || 0;
    const blockSeek = () => {
      if (ignoreSeek.current) return;
      if (shouldBlockForwardSeek(node.currentTime, lastLegal.current)) {
        ignoreSeek.current = true;
        node.currentTime = lastLegal.current;
        ignoreSeek.current = false;
        void sendBeat(node, { seekForwardAttempts: 1, coveredFrom: lastLegal.current });
      }
    };
    const onTime = () => {
      if (!node.paused && document.visibilityState === 'visible') {
        lastLegal.current = Math.max(lastLegal.current, node.currentTime);
      }
    };
    const onRate = () => {
      const next = clampPlaybackRate(node.playbackRate);
      if (next !== node.playbackRate) node.playbackRate = next;
      setRate(next);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') node.pause();
    };
    node.addEventListener('seeking', blockSeek);
    node.addEventListener('timeupdate', onTime);
    node.addEventListener('ratechange', onRate);
    document.addEventListener('visibilitychange', onHidden);
    const timer = window.setInterval(() => {
      if (node.paused || document.visibilityState !== 'visible') return;
      void sendBeat(node, {});
    }, COURSE_VIDEO_HEARTBEAT_MS);
    return () => {
      node.removeEventListener('seeking', blockSeek);
      node.removeEventListener('timeupdate', onTime);
      node.removeEventListener('ratechange', onRate);
      document.removeEventListener('visibilitychange', onHidden);
      window.clearInterval(timer);
    };
  }, [video.id, video.contentRevision, video.lastPosition]);

  async function sendBeat(
    node: HTMLVideoElement,
    extra: { seekForwardAttempts?: number; coveredFrom?: number },
  ) {
    const from = extra.coveredFrom ?? beatFrom.current;
    const to = node.currentTime;
    const covered = heartbeatCovered(from, to);
    beatFrom.current = to;
    if (!covered && !extra.seekForwardAttempts) return;
    const body = new URLSearchParams({
      contentRevision: String(video.contentRevision),
      position: String(node.currentTime),
      playbackRate: String(clampPlaybackRate(node.playbackRate)),
      visible: document.visibilityState === 'visible' ? 'true' : 'false',
      seekForwardAttempts: String(extra.seekForwardAttempts || 0),
      ...(covered ? { covered: JSON.stringify(covered) } : {}),
    });
    try {
      const response = await fetchHydroResponse(`/course/${courseId}/video/${video.id}/progress`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '观看进度保存失败'));
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('观看进度响应无效');
      const rec = payload as Record<string, unknown>;
      if (typeof rec.coverageRatio === 'number') setCoverage(coveragePercent(rec.coverageRatio));
      if (rec.completed === true) setCompleted(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '观看进度保存失败');
    }
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{video.title}</h3>
            <p className="mt-0.5 text-xs text-fg-subtle">
              {completed ? '已看完' : `已覆盖 ${coverage}%`}
              <span className="ml-2">按播放规则看完，不是监考证明。</span>
            </p>
          </div>
          <MiniTabs
            aria-label="播放速度"
            size="sm"
            value={String(rate)}
            onValueChange={(next) => {
              const item = Number(next);
              const node = ref.current;
              if (!node || !Number.isFinite(item)) return;
              node.playbackRate = item;
              setRate(item);
            }}
            items={COURSE_VIDEO_RATES.map((item) => ({ value: String(item), label: `${item}×` }))}
          />
        </div>
        <video
          ref={ref}
          className="block aspect-video w-full min-w-0 rounded-lg bg-surface-sunken object-contain"
          src={video.playUrl}
          controls
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          playsInline
          preload="metadata"
          onContextMenu={(event) => event.preventDefault()}
        />
        {error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export function CourseVideoPlaylist({ courseId, videos }: { courseId: string; videos: CourseStudentVideo[] }) {
  if (!videos.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {videos.map((video) => (
        <CourseVideoPlayer key={`${video.id}:${video.contentRevision}`} courseId={courseId} video={video} />
      ))}
    </div>
  );
}
