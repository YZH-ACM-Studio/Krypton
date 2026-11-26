import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Expand, Eraser, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useBreakpoint, useMediaQuery } from '@/components/ui/media';

const WIDTH = 1600;
const HEIGHT = 600;

export function signaturePoint(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, clientX: number, clientY: number, rotated: boolean) {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return { x: (rotated ? y : x) * WIDTH, y: (rotated ? 1 - x : y) * HEIGHT };
}

function useSignatureInput(ref: RefObject<HTMLCanvasElement | null>, disabled: boolean, rotated: boolean, onChange: (ink: boolean) => void) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || disabled) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建签名画板');
    let active: { type: 'pointer' | 'touch'; id: number } | null = null;
    const begin = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const point = signaturePoint(rect, clientX, clientY, rotated);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineWidth = (2 * WIDTH) / (rotated ? rect.height : rect.width);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Exported handwriting is always black on transparent, independent of theme.
      ctx.strokeStyle = 'black';
    };
    const move = (clientX: number, clientY: number) => {
      const point = signaturePoint(canvas.getBoundingClientRect(), clientX, clientY, rotated);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      onChange(true);
    };
    const down = (event: globalThis.PointerEvent) => {
      // Touch uses non-passive native listeners, including WebViews whose pointer
      // events/capture are incomplete. Never process the same touch twice.
      if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary || active) return;
      event.preventDefault();
      active = { type: 'pointer', id: event.pointerId };
      canvas.setPointerCapture?.(event.pointerId);
      begin(event.clientX, event.clientY);
    };
    const pointerMove = (event: globalThis.PointerEvent) => {
      if (active?.type === 'pointer' && active.id === event.pointerId) move(event.clientX, event.clientY);
    };
    const pointerEnd = (event: globalThis.PointerEvent) => {
      if (active?.type === 'pointer' && active.id === event.pointerId) active = null;
    };
    const touchStart = (event: TouchEvent) => {
      event.preventDefault();
      if (active || !event.changedTouches.length) return;
      const touch = event.changedTouches[0];
      active = { type: 'touch', id: touch.identifier };
      begin(touch.clientX, touch.clientY);
    };
    const touchMove = (event: TouchEvent) => {
      event.preventDefault();
      if (active?.type !== 'touch') return;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === active?.id);
      if (touch) move(touch.clientX, touch.clientY);
    };
    const touchEnd = (event: TouchEvent) => {
      event.preventDefault();
      if (active?.type === 'touch' && Array.from(event.changedTouches).some((item) => item.identifier === active?.id)) active = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('lostpointercapture', pointerEnd);
    canvas.addEventListener('touchstart', touchStart, { passive: false });
    canvas.addEventListener('touchmove', touchMove, { passive: false });
    canvas.addEventListener('touchend', touchEnd, { passive: false });
    canvas.addEventListener('touchcancel', touchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd);
      canvas.removeEventListener('pointercancel', pointerEnd);
      canvas.removeEventListener('lostpointercapture', pointerEnd);
      canvas.removeEventListener('touchstart', touchStart);
      canvas.removeEventListener('touchmove', touchMove);
      canvas.removeEventListener('touchend', touchEnd);
      canvas.removeEventListener('touchcancel', touchEnd);
    };
  }, [ref, disabled, rotated, onChange]);
}

function FullscreenSignature({
  source,
  hasInk,
  onClose,
  onConfirm,
}: {
  source: RefObject<HTMLCanvasElement | null>;
  hasInk: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [draftInk, setDraftInk] = useState(hasInk);
  const canvas = useRef<HTMLCanvasElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const touchDevice = useMediaQuery('(pointer: coarse)');
  const rotated = (touchDevice || size.width < 640) && size.height > size.width;
  const width = rotated ? size.height : size.width;
  const height = rotated ? size.width : size.height;
  const canvasWidth = Math.max(1, Math.min(width - 32, ((height - 96) * WIDTH) / HEIGHT));
  useSignatureInput(canvas, false, rotated, setDraftInk);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || !source.current) throw new Error('全屏签名画板尚未就绪');
    const ctx = element.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建全屏签名画板');
    ctx.drawImage(source.current, 0, 0);
  }, [source]);
  useLayoutEffect(() => {
    if (!body.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  const confirm = () => {
    const target = source.current;
    const ctx = target?.getContext('2d');
    if (!target || !ctx || !canvas.current) throw new Error('无法保存全屏签名，请重试');
    // Both canvases keep the same backing dimensions: open/close/rotation never
    // resamples handwriting, and only this copy is used by the submit pipeline.
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(canvas.current, 0, 0);
    onConfirm();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      closeOnOverlayClick={false}
    >
      <DialogContent size="screen" showCloseButton={false}>
        <DialogBody className="relative flex overflow-hidden p-0">
          <div ref={body} className="absolute inset-0">
            <div
              data-signature-landscape={rotated}
              className="absolute flex flex-col bg-surface"
              style={{
                width,
                height,
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%)${rotated ? ' rotate(90deg)' : ''}`,
                padding:
                  'max(8px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
              }}
            >
              <div className="flex shrink-0 items-center justify-between gap-2">
                <DialogTitle>手写签名</DialogTitle>
                <Button variant="ghost" size="sm" iconOnly aria-label="取消本次书写" onClick={onClose}>
                  <X />
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div
                  className="overflow-hidden rounded-md border border-line-strong bg-white"
                  style={{ width: canvasWidth, height: (canvasWidth * HEIGHT) / WIDTH }}
                >
                  <canvas
                    ref={canvas}
                    width={WIDTH}
                    height={HEIGHT}
                    className="block h-full w-full touch-none select-none"
                    aria-label="全屏手写签名区域"
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    canvas.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
                    setDraftInk(false);
                  }}
                >
                  <Eraser />
                  清空重写
                </Button>
                <p className="text-xs text-fg-subtle">写下完整姓名，确认后预览。</p>
                <Button variant="primary" disabled={!draftInk} onClick={confirm}>
                  确认签名
                </Button>
              </div>
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DesktopSignature({
  source,
  hasInk,
  disabled,
  editing,
  onConfirm,
  onCancel,
}: {
  source: RefObject<HTMLCanvasElement | null>;
  hasInk: boolean;
  disabled: boolean;
  editing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [draftInk, setDraftInk] = useState(hasInk);
  useSignatureInput(canvas, disabled, false, setDraftInk);
  useEffect(() => {
    if (!editing) return;
    if (!canvas.current || !source.current) throw new Error('签名画板尚未就绪');
    const ctx = canvas.current.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建签名画板');
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(source.current, 0, 0);
    setDraftInk(hasInk);
  }, [source, editing, hasInk]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">在下方写下完整姓名，确认后预览并提交。</p>
      <div className="overflow-hidden rounded-md border border-line-strong bg-white">
        <canvas
          ref={canvas}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full touch-none select-none"
          aria-label="手写签名区域，请用鼠标写下完整姓名"
          aria-disabled={disabled}
        />
      </div>
      <div className="flex justify-between gap-2">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            canvas.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
            setDraftInk(false);
          }}
        >
          清空重写
        </Button>
        <div className="flex gap-2">
          {hasInk && (
            <Button variant="secondary" disabled={disabled} onClick={onCancel}>
              取消
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={disabled || !draftInk}
            onClick={() => {
              const target = source.current;
              const ctx = target?.getContext('2d');
              if (!target || !ctx || !canvas.current) throw new Error('无法保存签名，请重试');
              ctx.clearRect(0, 0, WIDTH, HEIGHT);
              ctx.drawImage(canvas.current, 0, 0);
              onConfirm();
            }}
          >
            确认签名
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SignaturePad({
  canvasRef,
  disabled,
  onChange,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  disabled: boolean;
  onChange: (ink: boolean) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [editingDesktop, setEditingDesktop] = useState(true);
  const desktopWidth = useBreakpoint('lg');
  const coarse = useMediaQuery('(pointer: coarse)');
  const desktop = desktopWidth && !coarse;
  useEffect(() => {
    onChange(confirmed && (!desktop || !editingDesktop));
  }, [confirmed, desktop, editingDesktop, onChange]);
  const confirm = () => {
    setConfirmed(true);
    setEditingDesktop(false);
    onChange(true);
    setFullscreen(false);
  };
  return (
    <div className="space-y-3">
      <div hidden={!desktop || !editingDesktop}>
        <DesktopSignature
          source={canvasRef}
          hasInk={confirmed}
          editing={editingDesktop}
          disabled={disabled || !desktop || !editingDesktop}
          onConfirm={confirm}
          onCancel={() => setEditingDesktop(false)}
        />
      </div>
      {desktop ? (
        !editingDesktop && (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setEditingDesktop(true);
            }}
          >
            重新签字
          </Button>
        )
      ) : (
        <>
          <p className="text-sm text-fg-muted">点击“签字”写下姓名，确认后预览并提交。</p>
          <Button type="button" variant="secondary" className="w-full" disabled={disabled} onClick={() => setFullscreen(true)}>
            <Expand />
            签字
          </Button>
        </>
      )}
      <div hidden={!confirmed || (desktop && editingDesktop)} className="space-y-2">
        <p className="text-sm font-medium text-fg">签名预览</p>
        <div className="overflow-hidden rounded-md border border-line bg-white">
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="block h-auto w-full" role="img" aria-label="已确认的手写签名预览" />
        </div>
        <p className="text-xs text-fg-subtle">请核对上方笔迹。需要修改时可重新签字；确认无误后点击下方“提交签署”。</p>
      </div>
      {fullscreen && <FullscreenSignature source={canvasRef} hasInk={confirmed} onClose={() => setFullscreen(false)} onConfirm={confirm} />}
    </div>
  );
}
