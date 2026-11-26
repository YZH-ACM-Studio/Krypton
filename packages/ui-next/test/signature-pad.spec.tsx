import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignaturePad, signaturePoint } from '../src/pages/collect/signature-pad';

const contexts = new Map<
  HTMLCanvasElement,
  { stroke: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn>; lineTo: ReturnType<typeof vi.fn> }
>();

function touch(canvas: HTMLCanvasElement, type: string, id: number, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'changedTouches', { value: [{ identifier: id, clientX, clientY }] });
  fireEvent(canvas, event);
  return event;
}

function resizeDesktop(initial: boolean) {
  let desktop = initial;
  const media = new Map<string, MediaQueryList>();
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    let target = media.get(query);
    if (!target) {
      target = Object.assign(new EventTarget(), {
        matches: desktop && query === '(min-width: 1024px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      });
      media.set(query, target);
    }
    return target;
  });
  return (next: boolean) =>
    act(() => {
      desktop = next;
      for (const [query, target] of media) {
        const matches = desktop && query === '(min-width: 1024px)';
        Object.defineProperty(target, 'matches', { value: matches });
        target.dispatchEvent(Object.assign(new Event('change'), { matches }));
      }
    });
}

beforeEach(() => {
  contexts.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 300,
    bottom: 300,
    right: 800,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = { stroke: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(), lineTo: vi.fn() };
      contexts.set(this, ctx);
    }
    return { ...ctx, beginPath: vi.fn(), moveTo: vi.fn() } as unknown as CanvasRenderingContext2D;
  });
});

describe('signature confirmation flow', () => {
  it('preserves a desktop draft across breakpoints and restores submission for the confirmed mobile preview', () => {
    const resize = resizeDesktop(true);
    const ref = createRef<HTMLCanvasElement>();
    const onChange = vi.fn();
    render(<SignaturePad canvasRef={ref} disabled={false} onChange={onChange} />);
    const pad = screen.getByLabelText('手写签名区域，请用鼠标写下完整姓名') as HTMLCanvasElement;
    touch(pad, 'touchstart', 1, 10, 10);
    touch(pad, 'touchmove', 1, 100, 70);
    touch(pad, 'touchend', 1, 100, 70);
    resize(false);
    expect(pad).not.toBeVisible();
    resize(true);
    expect(screen.getByLabelText('手写签名区域，请用鼠标写下完整姓名')).toBe(pad);
    expect(screen.getByRole('button', { name: '确认签名' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '确认签名' }));
    fireEvent.click(screen.getByRole('button', { name: '重新签字' }));
    const copies = contexts.get(pad)!.drawImage.mock.calls.length;
    expect(onChange).toHaveBeenLastCalledWith(false);
    resize(false);
    expect(ref.current).toBeVisible();
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '签字' }));
    fireEvent.click(screen.getByRole('button', { name: '清空重写' }));
    fireEvent.click(screen.getByRole('button', { name: '取消本次书写' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(contexts.get(ref.current!)!.drawImage).toHaveBeenCalledOnce();
    resize(true);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(pad).toBeVisible();
    expect(contexts.get(pad)!.drawImage).toHaveBeenCalledTimes(copies);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('offers an inline desktop canvas and confirms it without opening a fullscreen dialog', () => {
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ ...original(query), matches: query === '(min-width: 1024px)' }));
    const ref = createRef<HTMLCanvasElement>();
    const onChange = vi.fn();
    render(<SignaturePad canvasRef={ref} disabled={false} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: '签字' })).not.toBeInTheDocument();
    const pad = screen.getByLabelText('手写签名区域，请用鼠标写下完整姓名') as HTMLCanvasElement;
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 3 }, isPrimary: { value: true } });
      fireEvent(pad, event);
    };
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 100, 70);
    pointer('pointerup', 100, 70);
    expect(onChange).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '确认签名' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(contexts.get(ref.current!)?.drawImage).toHaveBeenCalledWith(pad, 0, 0);
    expect(ref.current).toBeVisible();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('only accepts touch drawing in the full screen dialog and requires confirmation before preview', () => {
    const ref = createRef<HTMLCanvasElement>();
    const onChange = vi.fn();
    render(<SignaturePad canvasRef={ref} disabled={false} onChange={onChange} />);
    const preview = ref.current!;
    expect(preview).not.toBeVisible();
    touch(preview, 'touchstart', 1, 10, 10);
    touch(preview, 'touchmove', 1, 60, 50);
    expect(onChange).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '签字' }));
    expect(document.body.style.overflow).toBe('hidden');
    const pad = screen.getByLabelText('全屏手写签名区域') as HTMLCanvasElement;
    expect(screen.getByRole('button', { name: '确认签名' })).toBeDisabled();
    expect(touch(pad, 'touchstart', 7, 20, 20).defaultPrevented).toBe(true);
    touch(pad, 'touchmove', 7, 100, 60);
    touch(pad, 'touchend', 7, 100, 60);
    expect(contexts.get(pad)?.stroke).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '确认签名' }));
    expect(contexts.get(preview)?.drawImage).toHaveBeenCalledWith(pad, 0, 0);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(preview).toBeVisible();
    expect(document.body.style.overflow).toBe('');
  });

  it('ignores a second finger and stops drawing after the tracked touch is cancelled', () => {
    render(<SignaturePad canvasRef={createRef<HTMLCanvasElement>()} disabled={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '签字' }));
    const pad = screen.getByLabelText('全屏手写签名区域') as HTMLCanvasElement;
    touch(pad, 'touchstart', 1, 20, 20);
    touch(pad, 'touchstart', 2, 100, 100);
    touch(pad, 'touchmove', 2, 120, 120);
    expect(contexts.get(pad)?.stroke).not.toHaveBeenCalled();
    touch(pad, 'touchmove', 1, 40, 40);
    touch(pad, 'touchcancel', 1, 40, 40);
    touch(pad, 'touchmove', 1, 60, 60);
    expect(contexts.get(pad)?.stroke).toHaveBeenCalledOnce();
  });

  it('cancel does not confirm or copy the draft into the preview', () => {
    const ref = createRef<HTMLCanvasElement>();
    const onChange = vi.fn();
    render(<SignaturePad canvasRef={ref} disabled={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '签字' }));
    const pad = screen.getByLabelText('全屏手写签名区域') as HTMLCanvasElement;
    touch(pad, 'touchstart', 1, 10, 10);
    touch(pad, 'touchmove', 1, 100, 70);
    fireEvent.click(screen.getByRole('button', { name: '取消本次书写' }));
    expect(onChange).not.toHaveBeenCalledWith(true);
    expect(ref.current).not.toBeVisible();
    expect(contexts.get(ref.current!)?.drawImage.mock.calls.length ?? 0).toBe(0);
  });

  it('maps portrait touch coordinates into the horizontal signature without mirroring', () => {
    const rect = { left: 20, top: 30, width: 300, height: 800 };
    expect(signaturePoint(rect, 320, 30, true)).toEqual({ x: 0, y: 0 });
    expect(signaturePoint(rect, 20, 830, true)).toEqual({ x: 1600, y: 600 });
    expect(signaturePoint(rect, 245, 230, true)).toEqual({ x: 400, y: 150 });
  });
});
