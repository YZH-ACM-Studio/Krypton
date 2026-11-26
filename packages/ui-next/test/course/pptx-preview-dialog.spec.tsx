import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { alignPptxSlideViewport, fitSlideScale, PptxPreviewDialog, type PptxPreviewHandle } from '../../src/pages/course/pptx-preview-dialog';

vi.mock('pptx-preview', () => {
  return {
    init(host: HTMLElement, options: { width?: number; height?: number }) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pptx-preview-wrapper';
      const slide = document.createElement('div');
      slide.className = 'pptx-preview-slide-wrapper';
      slide.style.top = '-90px';
      slide.style.height = '720px';
      slide.textContent = '整数类型的取值范围';
      wrapper.style.height = `${options.height ?? 0}px`;
      wrapper.append(slide);
      host.append(wrapper);
      const previewer = {
        slideCount: 14,
        currentIndex: 0,
        wrapper,
        htmlRender: {
          options: { viewPort: { width: options.width, height: options.height } },
          renderPort: { width: 960, height: 720 },
        },
        preview: () => Promise.resolve(undefined),
        renderNextSlide() {
          previewer.currentIndex += 1;
          const viewHeight = previewer.htmlRender.options.viewPort?.height ?? 0;
          slide.style.top = `${(viewHeight - 720) / 2}px`;
        },
        renderPreSlide() {
          previewer.currentIndex = Math.max(0, previewer.currentIndex - 1);
        },
        destroy() {
          host.replaceChildren();
        },
      };
      return previewer;
    },
  };
});

function previewHandle(viewportHeight: number, renderWidth: number, renderHeight: number): PptxPreviewHandle & { slide: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.height = `${viewportHeight}px`;
  wrapper.style.overflowY = 'auto';
  const slide = document.createElement('div');
  slide.className = 'pptx-preview-slide-wrapper';
  slide.style.top = `${(viewportHeight - renderHeight) / 2}px`;
  slide.style.height = `${renderHeight}px`;
  slide.style.margin = '0 auto 10px';
  wrapper.append(slide);
  return {
    wrapper,
    slide,
    htmlRender: {
      options: { viewPort: { width: renderWidth, height: viewportHeight } },
      renderPort: { width: renderWidth, height: renderHeight },
    },
  };
}

describe('alignPptxSlideViewport', () => {
  it('drops the negative top that hides the top of a 4:3 slide in a 16:9 viewport', () => {
    const handle = previewHandle(540, 960, 720);
    expect(handle.slide.style.top).toBe('-90px');

    const box = alignPptxSlideViewport(handle);

    expect(box).toEqual({ width: 960, height: 720 });
    expect(handle.slide.style.top).toBe('0px');
    expect(handle.slide.style.margin).toBe('0px');
    expect(handle.wrapper.style.height).toBe('720px');
    expect(handle.wrapper.style.overflow).toBe('hidden');
    expect(handle.wrapper.style.background).toBe('white');
    expect(handle.htmlRender?.options.viewPort).toEqual({ width: 960, height: 720 });
    const viewHeight = handle.htmlRender?.options.viewPort?.height ?? 0;
    expect((viewHeight - 720) / 2).toBe(0);
  });

  it('keeps a 16:9 slide that already fills the viewport', () => {
    const handle = previewHandle(540, 960, 540);

    expect(alignPptxSlideViewport(handle)).toEqual({ width: 960, height: 540 });
    expect(handle.slide.style.top).toBe('0px');
  });

  it('leaves the fallback box alone when the library did not report a size', () => {
    const wrapper = document.createElement('div');
    wrapper.style.height = '540px';
    const handle: PptxPreviewHandle = {
      wrapper,
      htmlRender: { options: { viewPort: { width: 960, height: 540 } }, renderPort: { width: Number.NaN, height: 720 } },
    };

    expect(alignPptxSlideViewport(handle)).toEqual({ width: 960, height: 540 });
    expect(wrapper.style.height).toBe('540px');
  });
});

describe('pptx preview dialog', () => {
  it('shows the top of a tall slide and keeps it visible on the next page', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(8)))));
    render(<PptxPreviewDialog open title="第二章.pptx" src="/course/1/file/第二章.pptx?preview=1" onOpenChange={vi.fn()} />);

    const slide = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('.pptx-preview-slide-wrapper');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(slide.style.top).toBe('0px');
    expect(slide.parentElement?.style.height).toBe('720px');
    expect(screen.getByText('第 1 / 14 页')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '下一页' }));

    expect(slide.style.top).toBe('0px');
    expect(screen.getByText('第 2 / 14 页')).toBeInTheDocument();
  });
});

describe('fitSlideScale', () => {
  it('shrinks a tall slide to the frame height so fullscreen does not crop it', () => {
    expect(fitSlideScale(1920, 1080, 960, 720)).toBeCloseTo(1080 / 720);
  });

  it('shrinks a wide slide to the frame width', () => {
    expect(fitSlideScale(800, 900, 960, 540)).toBeCloseTo(800 / 960);
  });

  it('stays at 1 until the frame or the slide has a size', () => {
    expect(fitSlideScale(0, 400, 960, 540)).toBe(1);
    expect(fitSlideScale(800, 0, 960, 540)).toBe(1);
    expect(fitSlideScale(800, 600, 0, 540)).toBe(1);
  });
});
