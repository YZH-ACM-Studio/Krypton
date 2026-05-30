/**
 * Shared "样例" rendering used by the problem detail page **and** the
 * markdown editor preview. Mirrors the look-and-feel so what the editor
 * shows is exactly what readers see.
 */
import { useState, type MouseEvent } from 'react';
import { Check, ClipboardCopy, XCircle } from 'lucide-react';
import type { SampleCase } from '@/lib/samples';

type CopyState = 'idle' | 'copied' | 'failed';

function fallbackCopyText(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
    active?.focus?.();
  }
  return ok;
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // HTTP / permission-blocked browsers fall back to the legacy path below.
    }
  }
  return fallbackCopyText(text);
}

export function SampleBlocks({
  samples,
  className,
  suppressHeader,
}: { samples: SampleCase[]; className?: string; suppressHeader?: boolean }) {
  if (!samples.length) return null;
  return (
    <div className={`space-y-3 my-4 ${className || ''}`}>
      {!suppressHeader && <h3 className="text-sm font-semibold text-foreground">样例</h3>}
      {samples.map((s) => (
        <div key={s.id} className="grid gap-2 sm:grid-cols-2">
          <SampleBlock label={`样例输入 #${s.id}`} content={s.input} />
          <SampleBlock label={`样例输出 #${s.id}`} content={s.output} />
        </div>
      ))}
    </div>
  );
}

export function SampleBlock({ label, content }: { label: string; content: string }) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!content) return;
    const ok = await copyText(content);
    setCopyState(ok ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1500);
  };
  const Icon = copyState === 'copied' ? Check : copyState === 'failed' ? XCircle : ClipboardCopy;
  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`复制${label}`}
        >
          <Icon className="size-3" />
          {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
        </button>
      </div>
      <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-all min-h-[2em]">{content}</pre>
    </div>
  );
}
