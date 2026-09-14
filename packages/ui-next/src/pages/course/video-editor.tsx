import { useRef, useState } from 'react';
import { FileUploader } from '@/components/uploader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { cn } from '@/lib/cn';
import type { CourseAuthorVideo } from './types';
import { CourseSectionHeader } from './ui';

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

export function CourseVideoEditor({
  courseId,
  chapterId,
  sectionId,
  videos,
  onChange,
}: {
  courseId: string;
  chapterId: number;
  sectionId: number | null;
  videos: CourseAuthorVideo[];
  onChange: (videos: CourseAuthorVideo[]) => void;
}) {
  const [title, setTitle] = useState('课程视频');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <section className="space-y-3" aria-labelledby={`course-video-editor-${chapterId}-${sectionId || 0}`}>
      <CourseSectionHeader
        id={`course-video-editor-${chapterId}-${sectionId || 0}`}
        title={sectionId == null ? '章节视频' : '小节视频'}
        description="本站 mp4/webm，单文件 512MB。确认片长后学生才能看到。最多 8 条。"
        count={videos.length}
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {videos.length ? (
        <ol className="space-y-2">
          {videos.map((video) => (
            <li key={video.id} className="krypton-course-row flex min-h-11 items-center gap-2 px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">{video.title}</span>
              <span className={cn('krypton-course-meta', video.confirmed ? '' : 'text-amber-700 dark:text-amber-400')}>
                {video.confirmed ? `${Math.round(video.durationMs / 1000)} 秒` : '待确认片长'}
              </span>
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setPending(video)}>
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
              <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => void remove(video)}>
                删除
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {videos.length < 8 ? (
        <div className="space-y-2">
          <label className="block space-y-1 text-xs">
            新视频标题
            <Input value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-10" />
          </label>
          <FileUploader
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
              title,
            }}
            onUploaded={(_name, body) => {
              const next = asVideo(body?.video);
              onChange([...videos, next]);
              setPending(next);
            }}
          />
        </div>
      ) : (
        <p className="krypton-course-meta">已到 8 条上限。</p>
      )}
      {pending ? (
        <div className="krypton-course-inset space-y-2 p-3">
          <p className="text-xs font-medium">确认片长：{pending.title}</p>
          <video
            ref={previewRef}
            className="w-full rounded-md bg-black"
            src={`/course/${courseId}/video/${pending.id}/play`}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              const durationMs = Math.round(event.currentTarget.duration * 1000);
              if (!pending.confirmed && durationMs > 0) void confirmDuration(pending, durationMs).catch((err) => setError(err.message));
            }}
          />
        </div>
      ) : null}
    </section>
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
        换片
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border p-2">
      <label className="flex items-center gap-2 text-xs">
        <Checkbox checked={requireRewatch} onChange={() => setRequireRewatch((current) => !current)} />
        要求重看
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
            onError(err instanceof Error ? err.message : '换片失败');
          }
        }}
      />
    </div>
  );
}
