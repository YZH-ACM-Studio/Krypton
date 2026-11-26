import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const IDE_STACK_QUERY = '(max-width: 767px), (max-height: 500px)';

function readStackedIdeSplit(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(IDE_STACK_QUERY).matches;
}

export function ResizableSplit({
  left,
  right,
  defaultLeftPercent = 40,
  minPercent = 20,
  maxPercent = 80,
  handleLabel,
}: {
  left: ReactNode;
  right: ReactNode;
  defaultLeftPercent?: number;
  minPercent?: number;
  maxPercent?: number;
  handleLabel?: string;
}) {
  const [leftPct, setLeftPct] = useState(defaultLeftPercent);
  const [stacked, setStacked] = useState(readStackedIdeSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const stackedRef = useRef(stacked);
  stackedRef.current = stacked;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(IDE_STACK_QUERY);
    const sync = () => setStacked(mq.matches);
    sync();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      event.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const pct = stackedRef.current
        ? ((event.clientY - rect.top) / rect.height) * 100
        : ((event.clientX - rect.left) / rect.width) * 100;
      const next = Math.max(minPercent, Math.min(maxPercent, pct));
      setLeftPct(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onUp();
    };
  }, [minPercent, maxPercent]);

  return (
    <div ref={containerRef} className={cn('krypton-split flex min-h-0 min-w-0 flex-1 overflow-hidden', stacked && 'flex-col')}>
      <div
        style={stacked ? { height: `${leftPct}%`, width: '100%' } : { width: `${leftPct}%` }}
        className="krypton-split-pane min-h-0 min-w-0 shrink-0 overflow-hidden"
      >
        {left}
      </div>
      <div
        className={cn(
          'krypton-split-handle shrink-0 bg-line transition-colors hover:bg-line-strong',
          stacked ? 'h-1.5 w-full cursor-row-resize' : 'w-1.5 cursor-col-resize',
        )}
        role={handleLabel ? 'separator' : undefined}
        aria-orientation={handleLabel ? (stacked ? 'horizontal' : 'vertical') : undefined}
        aria-label={handleLabel}
        onMouseDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = stackedRef.current ? 'row-resize' : 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div className="krypton-split-pane min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
