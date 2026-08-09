/**
 * Shared "样例" rendering used by the problem detail page **and** the
 * markdown editor preview. Mirrors the look-and-feel so what the editor
 * shows is exactly what readers see.
 */
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Check, ClipboardCopy, XCircle } from 'lucide-react';
import type { AntiAiMarkerClientMarker } from '@/lib/anti-ai-marker';
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

export interface SampleAntiAiMarker extends Pick<AntiAiMarkerClientMarker, 'id' | 'injectionText'> {
  offset: number;
}

function injectedSampleContent(content: string, markers: readonly SampleAntiAiMarker[]): string {
  let result = content;
  for (const marker of [...markers].sort((left, right) => right.offset - left.offset || right.id.localeCompare(left.id))) {
    result = `${result.slice(0, marker.offset)}${marker.injectionText}${result.slice(marker.offset)}`;
  }
  return result;
}

function MarkedSampleContent({ content, markers }: { content: string; markers: readonly SampleAntiAiMarker[] }) {
  const ordered = [...markers].sort((left, right) => left.offset - right.offset || left.id.localeCompare(right.id));
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const marker of ordered) {
    nodes.push(content.slice(cursor, marker.offset));
    nodes.push(<span key={marker.id} aria-hidden="true" className="anti-ai-copy-marker" data-anti-ai-marker-id={marker.id} />);
    cursor = marker.offset;
  }
  nodes.push(content.slice(cursor));
  return nodes;
}

export function SampleBlocks({
  samples,
  className,
  suppressHeader,
  antiAiMarkers = {},
}: {
  samples: SampleCase[];
  className?: string;
  suppressHeader?: boolean;
  antiAiMarkers?: Readonly<Record<string, readonly SampleAntiAiMarker[]>>;
}) {
  if (!samples.length) return null;
  return (
    <div className={`space-y-3 my-4 ${className || ''}`}>
      {!suppressHeader && <h3 className="text-sm font-semibold text-foreground">样例</h3>}
      {samples.map((s) => (
        <div key={s.id} className="grid gap-2 sm:grid-cols-2">
          <SampleBlock label={`样例输入 #${s.id}`} content={s.input} antiAiMarkers={antiAiMarkers[`input:${s.id}`]} />
          <SampleBlock label={`样例输出 #${s.id}`} content={s.output} antiAiMarkers={antiAiMarkers[`output:${s.id}`]} />
        </div>
      ))}
    </div>
  );
}

export function SampleBlock({
  label,
  content,
  antiAiMarkers = [],
}: {
  label: string;
  content: string;
  antiAiMarkers?: readonly SampleAntiAiMarker[];
}) {
  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <SampleCopyButton label={label} content={antiAiMarkers.length ? injectedSampleContent(content, antiAiMarkers) : content} />
      </div>
      <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-all min-h-[2em]">
        {antiAiMarkers.length ? <MarkedSampleContent content={content} markers={antiAiMarkers} /> : content}
      </pre>
    </div>
  );
}

export function SampleCopyButton({ label, content }: { label: string; content: string }) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(content);
    setCopyState(ok ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1500);
  };
  const Icon = copyState === 'copied' ? Check : copyState === 'failed' ? XCircle : ClipboardCopy;
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={`复制${label}`}
    >
      <Icon className="size-3" />
      {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
    </button>
  );
}
