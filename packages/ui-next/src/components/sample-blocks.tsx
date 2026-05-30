/**
 * Shared "样例" rendering used by the problem detail page **and** the
 * markdown editor preview. Mirrors the look-and-feel so what the editor
 * shows is exactly what readers see.
 */
import { useState } from 'react';
import type { SampleCase } from '@/lib/samples';

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
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-all min-h-[2em]">{content}</pre>
    </div>
  );
}
