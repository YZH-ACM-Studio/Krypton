import { Download, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { isPptxCourseFile, PptxPreviewDialog } from './pptx-preview-dialog';

const ROW_LINK = 'rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

export function CourseFileRow({
  name,
  downloadHref,
  previewHref,
  extra,
}: {
  name: string;
  downloadHref: string;
  previewHref?: string;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const canPreview = Boolean(previewHref) && isPptxCourseFile(name);
  return (
    <li className="flex min-h-11 items-center gap-2 px-3 py-2">
      <FileText className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{name}</span>
      {canPreview && previewHref ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>预览</Button>
      ) : null}
      <Button asChild variant="ghost" size="sm" iconOnly className="shrink-0">
        <a href={downloadHref} aria-label={`下载${name}`} className={cn(ROW_LINK)}>
          <Download className="size-4" aria-hidden="true" />
        </a>
      </Button>
      {extra}
      {canPreview && previewHref ? (
        <PptxPreviewDialog open={open} title={name} src={previewHref} onOpenChange={setOpen} />
      ) : null}
    </li>
  );
}

export function courseFileDownloadHref(courseId: string, filename: string, chapterId?: number): string {
  const name = encodeURIComponent(filename);
  if (chapterId === undefined) return `/course/${courseId}/file/${name}`;
  return `/course/${courseId}/chapter/${chapterId}/file/${name}`;
}

export function courseFilePreviewHref(courseId: string, filename: string, chapterId?: number): string {
  return `${courseFileDownloadHref(courseId, filename, chapterId)}?preview=1`;
}

export function CoursewareList({
  titleId,
  title,
  courseId,
  chapterId,
  files,
  extra,
}: {
  titleId: string;
  title: string;
  courseId: string;
  chapterId?: number;
  files: readonly { name: string }[];
  extra?: (file: { name: string }) => ReactNode;
}) {
  if (!files.length) return null;
  return (
    <ul className="divide-y divide-line-subtle" aria-labelledby={titleId} aria-label={title}>
      {files.map((file) => (
        <CourseFileRow
          key={file.name}
          name={file.name}
          downloadHref={courseFileDownloadHref(courseId, file.name, chapterId)}
            previewHref={courseFilePreviewHref(courseId, file.name, chapterId)}
            extra={extra?.(file)}
          />
      ))}
    </ul>
  );
}
