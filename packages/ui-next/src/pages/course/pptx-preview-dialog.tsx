import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { fetchHydroResponse } from '@/lib/error-presenter';

/** pptx-preview lays a deck out in points, then scales it to this width. */
const SLIDE_BASE_WIDTH = 960;
const SLIDE_BASE_HEIGHT = 540;

interface PptxRenderPort {
  width: number;
  height: number;
}

interface PptxHtmlRender {
  options: {
    viewPort?: {
      width?: number;
      height?: number;
    };
  };
  renderPort?: PptxRenderPort;
}

export interface PptxPreviewHandle {
  wrapper: HTMLElement;
  htmlRender?: PptxHtmlRender;
}

interface PptxPreviewer extends PptxPreviewHandle {
  slideCount: number;
  currentIndex: number;
  preview: (file: ArrayBuffer) => Promise<unknown>;
  renderNextSlide: () => void;
  renderPreSlide: () => void;
  destroy: () => void;
}

export interface SlideBox {
  width: number;
  height: number;
}

const DEFAULT_SLIDE_BOX: SlideBox = { width: SLIDE_BASE_WIDTH, height: SLIDE_BASE_HEIGHT };

function positiveSize(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * pptx-preview sizes the viewport to the width we pass in, then centers the
 * scaled slide with `top: (viewportHeight - slideHeight) / 2`. A deck taller
 * than 16:9 (a 4:3 page becomes 960×720 inside a 960×540 box) gets a negative
 * top. The wrapper is `overflow-y: auto`, and a negative offset cannot be
 * scrolled back into view, so the top of the page stays clipped in the dialog
 * and after fullscreen scales that same box.
 *
 * Pin the viewport to the rendered slide and drop the centering offset.
 * Later page turns read the same viewport height, so they stay top-aligned.
 */
export function alignPptxSlideViewport(previewer: PptxPreviewHandle): SlideBox {
  const render = previewer.htmlRender;
  const port = render?.renderPort;
  const width = port?.width;
  const height = port?.height;
  if (!render || !positiveSize(width) || !positiveSize(height)) return DEFAULT_SLIDE_BOX;
  const viewPort = render.options.viewPort ?? (render.options.viewPort = {});
  viewPort.width = width;
  viewPort.height = height;
  const wrapper = previewer.wrapper;
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = 'hidden';
  // Paper stays white in both themes. A token would turn transparent slide areas dark.
  wrapper.style.background = 'white';
  wrapper.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper').forEach((slide) => {
    slide.style.top = '0px';
    slide.style.margin = '0';
  });
  return { width, height };
}

/** Largest scale that keeps the whole slide inside the frame. */
export function fitSlideScale(frameWidth: number, frameHeight: number, slideWidth: number, slideHeight: number): number {
  if (!positiveSize(frameWidth) || !positiveSize(frameHeight) || !positiveSize(slideWidth) || !positiveSize(slideHeight)) return 1;
  return Math.min(frameWidth / slideWidth, frameHeight / slideHeight);
}

function frameContentBox(frame: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(frame);
  const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  return {
    width: frame.clientWidth - padX,
    height: frame.clientHeight - padY,
  };
}

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
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<PptxPreviewer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [slideBox, setSlideBox] = useState<SlideBox>(DEFAULT_SLIDE_BOX);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!open) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    setError('');
    setLoading(true);
    setIndex(0);
    setCount(0);
    setSlideBox(DEFAULT_SLIDE_BOX);
    void (async () => {
      try {
        const response = await fetchHydroResponse(src, { credentials: 'include' }, '这份 PPT 没有打开。');
        if (!response.ok) throw new Error('这份 PPT 没有打开。');
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const { init } = await import('pptx-preview');
        if (cancelled) return;
        host.replaceChildren();
        const previewer = init(host, { width: SLIDE_BASE_WIDTH, height: SLIDE_BASE_HEIGHT, mode: 'slide' }) as PptxPreviewer;
        previewerRef.current = previewer;
        await previewer.preview(bytes);
        if (cancelled) {
          previewer.destroy();
          return;
        }
        setSlideBox(alignPptxSlideViewport(previewer));
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

  useEffect(() => {
    const stage = stageRef.current;
    return () => {
      if (stage && document.fullscreenElement === stage) void document.exitFullscreen();
    };
  }, [open]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!open || !frame) return undefined;
    const measure = () => {
      const stage = stageRef.current;
      const box = frameContentBox(frame);
      setFullscreen(stage != null && document.fullscreenElement === stage);
      setScale(fitSlideScale(box.width, box.height, slideBox.width, slideBox.height));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(frame);
    document.addEventListener('fullscreenchange', measure);
    return () => {
      observer?.disconnect();
      document.removeEventListener('fullscreenchange', measure);
    };
  }, [open, slideBox.width, slideBox.height]);

  async function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch (cause) {
      console.error(cause);
      setError('浏览器没有进入全屏。');
    }
  }

  function turn(direction: 'next' | 'previous') {
    const previewer = previewerRef.current;
    if (!previewer) return;
    if (direction === 'next') previewer.renderNextSlide();
    else previewer.renderPreSlide();
    // The library recenters every page. Pin the viewport again so a taller
    // deck does not slide its top back out of the frame.
    setSlideBox(alignPptxSlideViewport(previewer));
    setIndex((previewer.currentIndex || 0) + 1);
    setCount(previewer.slideCount || count);
  }

  const visualWidth = slideBox.width * scale;
  const visualHeight = slideBox.height * scale;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="max-sm:h-[85dvh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>静态预览。动画、切换和嵌入视频不会播放。</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col overflow-x-hidden overflow-y-hidden">
          <div
            ref={stageRef}
            className={cn('flex h-full min-h-0 flex-1 flex-col gap-3', fullscreen && 'bg-surface p-4 sm:p-6')}
          >
            {error ? <p className="shrink-0 text-sm text-danger-fg">{error}</p> : null}
            {loading ? <p className="shrink-0 text-sm text-fg-muted">正在打开幻灯片…</p> : null}
            <div
              ref={frameRef}
              className={cn(
                'flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-md bg-surface-sunken',
                fullscreen ? 'p-0' : 'p-2',
              )}
            >
              <div className="relative shrink-0 overflow-hidden" style={{ width: visualWidth, height: visualHeight }}>
                <div
                  ref={hostRef}
                  className="absolute top-0 left-0 origin-top-left [&_.pptx-preview-wrapper-next]:hidden [&_.pptx-preview-wrapper-pagination]:hidden"
                  style={{ width: slideBox.width, height: slideBox.height, transform: `scale(${scale})` }}
                />
              </div>
            </div>
            {count > 0 ? (
              <div className="flex shrink-0 items-center justify-between gap-3">
                <p className="text-sm text-fg-muted tabular">{`第 ${index} / ${count} 页`}</p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" disabled={index <= 1} onClick={() => turn('previous')}>上一页</Button>
                  <Button type="button" variant="secondary" size="sm" disabled={index >= count} onClick={() => turn('next')}>下一页</Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => { void toggleFullscreen(); }}>
                    {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                    {fullscreen ? '退出全屏' : '全屏'}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
