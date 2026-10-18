import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type PptxPreviewer = {
  slideCount: number;
  currentIndex: number;
  preview: (file: ArrayBuffer) => Promise<unknown>;
  renderNextSlide: () => void;
  renderPreSlide: () => void;
  destroy: () => void;
};

export function isPptxCourseFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pptx');
}

export function PptxPreviewDialog({
  open,
  title,
  src,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  src: string;
  onOpenChange: (open: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<PptxPreviewer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    setError('');
    setLoading(true);
    setIndex(0);
    setCount(0);
    void (async () => {
      try {
        const response = await fetch(src, { credentials: 'include' });
        if (!response.ok) throw new Error('这份 PPT 没有打开。');
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const { init } = await import('pptx-preview');
        if (cancelled) return;
        host.replaceChildren();
        const previewer = init(host, { width: 960, height: 540, mode: 'slide' }) as PptxPreviewer;
        previewerRef.current = previewer;
        await previewer.preview(bytes);
        if (cancelled) {
          previewer.destroy();
          return;
        }
        setCount(previewer.slideCount || 0);
        setIndex((previewer.currentIndex || 0) + 1);
      } catch (cause) {
        console.error(cause);
        if (!cancelled) setError('这份 PPT 预览失败。可以下载后用 PowerPoint 打开。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      previewerRef.current?.destroy();
      previewerRef.current = null;
      host.replaceChildren();
    };
  }, [open, src]);

  function turn(direction: 'next' | 'previous') {
    const previewer = previewerRef.current;
    if (!previewer) return;
    if (direction === 'next') previewer.renderNextSlide();
    else previewer.renderPreSlide();
    setIndex((previewer.currentIndex || 0) + 1);
    setCount(previewer.slideCount || count);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>静态预览。动画、切换和嵌入视频不会播放。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
          {loading ? <p className="text-sm text-fg-muted">正在打开幻灯片…</p> : null}
          <div
            ref={hostRef}
            className="max-h-[70vh] overflow-auto rounded-md bg-surface-sunken [&_.pptx-preview-wrapper-next]:hidden [&_.pptx-preview-wrapper-pagination]:hidden"
          />
          {count > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-fg-muted tabular">{`第 ${index} / ${count} 页`}</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={index <= 1} onClick={() => turn('previous')}>上一页</Button>
                <Button type="button" variant="secondary" size="sm" disabled={index >= count} onClick={() => turn('next')}>下一页</Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
