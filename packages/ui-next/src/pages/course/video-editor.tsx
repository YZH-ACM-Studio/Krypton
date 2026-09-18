import { useRef, useState } from 'react';
import { Film, Trash2 } from 'lucide-react';
import { FileUploader } from '@/components/uploader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { cn } from '@/lib/cn';
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
      <Card>
        <CardContent className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Film className="size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm font-medium">先保存课程，再上传视频</p>
          <p className="text-sm text-muted-foreground">保存后这一章就可以拖入 mp4 / webm。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {videos.length ? (
        <ul className="space-y-2">
          {videos.map((video) => (
            <li key={video.id}>
              <Card>
                <CardContent className="flex items-center gap-3 p-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Film className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{video.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{video.filename}</p>
                  </div>
                  {video.confirmed ? (
                    <Badge variant="secondary">{durationLabel(video.durationMs)}</Badge>
                  ) : (
                    <Badge variant="outline">待确认</Badge>
                  )}
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setPending(video)}>
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
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:bg-destructive/10"
                    onClick={() => void remove(video)}
                    aria-label={`删除${video.title}`}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </Button>
                </CardContent>
              </Card>
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
        <p className="text-sm text-muted-foreground">本章最多 8 个视频。</p>
      )}
      {pending ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            <p className="text-sm font-medium">{pending.confirmed ? '预览' : '打开预览以确认时长'}</p>
            <video
              ref={previewRef}
              className={cn('w-full rounded-lg bg-black')}
              src={`/course/${courseId}/video/${pending.id}/play`}
              controls
              preload="metadata"
              onLoadedMetadata={(event) => {
                const durationMs = Math.round(event.currentTarget.duration * 1000);
                if (!pending.confirmed && durationMs > 0) void confirmDuration(pending, durationMs).catch((err) => setError(err.message));
              }}
            />
          </CardContent>
        </Card>
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
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setOpen(true)}>
        替换
      </Button>
    );
  }
  return (
    <div className="min-w-52 space-y-2 rounded-lg border bg-background p-2">
      <label className="flex items-center gap-2 text-xs">
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
      <Button type="button" variant="ghost" size="sm" className="h-8 w-full" onClick={() => setOpen(false)}>
        取消
      </Button>
    </div>
  );
}
