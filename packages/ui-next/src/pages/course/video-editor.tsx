import { useRef, useState } from 'react';
import { Film, Trash2 } from 'lucide-react';
import { FileUploader } from '@/components/uploader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { Switch } from '@/components/ui/switch';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import type { CourseAuthorVideo } from './types';

const MAX_BYTES = 512 * 1024 * 1024;

function asVideo(value: unknown): CourseAuthorVideo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('视频响应无效');
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== 'string' || typeof rec.title !== 'string') throw new TypeError('视频响应无效');
  if (rec.ext !== 'mp4' && rec.ext !== 'webm') throw new TypeError('视频响应无效');
  if (typeof rec.filename !== 'string' || typeof rec.size !== 'number') throw new TypeError('视频响应无效');
  if (typeof rec.durationMs !== 'number' || typeof rec.confirmed !== 'boolean' || typeof rec.contentRevision !== 'number') {
    throw new TypeError('视频响应无效');
  }
  return {
    id: rec.id,
    title: rec.title,
    filename: rec.filename,
    ext: rec.ext,
    size: rec.size,
    durationMs: rec.durationMs,
    confirmed: rec.confirmed,
    contentRevision: rec.contentRevision,
  };
}

function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${seconds}秒`;
}

export function CourseVideoEditor({
  courseId,
  chapterId,
  sectionId,
  videos,
  onChange,
  locked,
}: {
  courseId: string;
  chapterId: number;
  sectionId: number | null;
  videos: CourseAuthorVideo[];
  onChange: (videos: CourseAuthorVideo[]) => void;
  locked?: boolean;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState<CourseAuthorVideo | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const endpoint = `/course/${courseId}/video`;

  const postForm = async (fields: Record<string, string>) => {
    const body = new URLSearchParams({ ...fields });
    const response = await fetchHydroResponse(endpoint, {
      method: 'POST',
      body,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await readHydroResponseError(response, '视频操作失败'));
    return response.json() as Promise<Record<string, unknown>>;
  };

  const confirmDuration = async (video: CourseAuthorVideo, durationMs: number) => {
    const payload = await postForm({
      operation: 'confirm',
      videoId: video.id,
      durationMs: String(Math.round(durationMs)),
    });
    const next = asVideo(payload.video);
    onChange(videos.map((item) => (item.id === next.id ? next : item)).concat(videos.some((item) => item.id === next.id) ? [] : [next]));
    setPending(null);
  };

  const remove = async (video: CourseAuthorVideo) => {
    const name = video.title.trim() || video.filename;
    const accepted = await confirmDialog('删除后不能恢复。', {
      title: `删除视频「${name}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    setError('');
    try {
      await postForm({ operation: 'delete', videoId: video.id });
      onChange(videos.filter((item) => item.id !== video.id));
      if (pending?.id === video.id) setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法删除视频');
    }
  };

  if (locked) {
    return (
      <EmptyState
        compact
        icon={<Film strokeWidth={1.5} />}
        title="先保存课程，再上传视频"
        description="保存后这一章就可以拖入 mp4 / webm。"
      />
    );
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {videos.length ? (
        <ul className="space-y-2">
          {videos.map((video) => (
            <li key={video.id}>
              <Panel>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-active text-fg-subtle">
                    <Film className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{video.title}</p>
                    <p className="truncate text-xs text-fg-subtle">{video.filename}</p>
                  </div>
                  {video.confirmed ? (
                    <Badge tone="neutral">{durationLabel(video.durationMs)}</Badge>
                  ) : (
                    <Badge tone="warning">待确认</Badge>
                  )}
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPending(video)}>
                    预览
                  </Button>
                  <ReplaceVideoButton
                    endpoint={endpoint}
                    video={video}
                    onReplaced={(next) => {
                      onChange(videos.map((item) => (item.id === next.id ? next : item)));
                      setPending(next);
                    }}
                    onError={setError}
                  />
                  <Button
                    type="button"
                    variant="danger-soft"
                    size="sm"
                    iconOnly
                    onClick={() => void remove(video)}
                    aria-label={`删除${video.title}`}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </Button>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      ) : null}
      {videos.length < 8 ? (
        <FileUploader
          key={`${chapterId}-${sectionId || 0}`}
          endpoint={endpoint}
          maxFiles={1}
          maxFileSize={MAX_BYTES}
          uploadConcurrency={1}
          retryOnFailure={false}
          accept={['video/mp4', 'video/webm', '.mp4', '.webm']}
          meta={{
            operation: 'upload',
            chapterId: String(chapterId),
            sectionId: sectionId == null ? '0' : String(sectionId),
          }}
          onUploaded={(_name, body) => {
            const next = asVideo(body?.video);
            onChange([...videos, next]);
            setPending(next);
          }}
        />
      ) : (
        <p className="text-sm text-fg-muted">本章最多 8 个视频。</p>
      )}
      {pending ? (
        <Panel>
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">{pending.confirmed ? '预览' : '打开预览以确认时长'}</p>
            <video
              ref={previewRef}
              className="w-full rounded-lg bg-surface-sunken"
              src={`/course/${courseId}/video/${pending.id}/play`}
              controls
              preload="metadata"
              onLoadedMetadata={(event) => {
                const durationMs = Math.round(event.currentTarget.duration * 1000);
                if (!pending.confirmed && durationMs > 0) void confirmDuration(pending, durationMs).catch((err) => setError(err.message));
              }}
            />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function ReplaceVideoButton({
  endpoint,
  video,
  onReplaced,
  onError,
}: {
  endpoint: string;
  video: CourseAuthorVideo;
  onReplaced: (video: CourseAuthorVideo) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [requireRewatch, setRequireRewatch] = useState(true);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        替换
      </Button>
    );
  }
  return (
    <div className="w-full basis-full space-y-2 rounded-lg border border-line bg-surface-sunken p-2">
      <label className="flex min-h-10 items-center gap-2 text-xs text-fg">
        <Switch checked={requireRewatch} onChange={() => setRequireRewatch((current) => !current)} />
        替换后要求重看
      </label>
      <FileUploader
        endpoint={endpoint}
        maxFiles={1}
        maxFileSize={MAX_BYTES}
        uploadConcurrency={1}
        retryOnFailure={false}
        accept={['video/mp4', 'video/webm', '.mp4', '.webm']}
        meta={{ operation: 'replace', videoId: video.id, requireRewatch: requireRewatch ? 'true' : 'false', title: video.title }}
        onUploaded={(_name, body) => {
          try {
            onReplaced(asVideo(body?.video));
            setOpen(false);
          } catch (err) {
            onError(err instanceof Error ? err.message : '无法替换视频');
          }
        }}
      />
      <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
        取消
      </Button>
    </div>
  );
}
