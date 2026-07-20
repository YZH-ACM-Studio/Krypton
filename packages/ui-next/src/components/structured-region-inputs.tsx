import type { ClientStructuredCodeSegment } from '@hydrooj/common';
import { useRef } from 'react';
import { Input } from '@/components/ui/input';

export function StructuredRegionInputs({
  surface,
  values,
  onChange,
  singleLine = false,
  readOnly = false,
}: {
  surface: ClientStructuredCodeSegment[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  singleLine?: boolean;
  readOnly?: boolean;
}) {
  const controls = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const regions = surface.filter((segment) => segment.type === 'region');
  const regionIds = regions.map((region) => region.id);
  if (!Array.isArray(surface)) throw new TypeError('structured code surface must be an array');
  if (new Set(regionIds).size !== regionIds.length) throw new Error('structured code surface contains duplicate region ids');

  const moveFocus = (event: React.KeyboardEvent, id: string) => {
    if (event.key !== 'Tab') return;
    const index = regionIds.indexOf(id);
    const targetId = regionIds[index + (event.shiftKey ? -1 : 1)];
    if (!targetId) return;
    const target = controls.current.get(targetId);
    if (!target) throw new Error(`structured code keyboard target ${targetId} is not mounted`);
    event.preventDefault();
    target.focus();
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/10" aria-label="连续代码作答区">
      <div className="overflow-x-auto font-mono text-sm">
        {surface.length ? (
          surface.map((segment, index) => {
            if (segment.type === 'code') {
              return (
                <pre key={`code-${index}`} className="m-0 min-w-max whitespace-pre px-4 py-2 leading-6 text-foreground">
                  <code>{segment.code || ' '}</code>
                </pre>
              );
            }
            const regionIndex = regionIds.indexOf(segment.id);
            const label = segment.title || segment.prompt || `作答区 ${regionIndex + 1}`;
            return (
              <label key={segment.id} className="block border-y border-primary/25 bg-primary/[0.055] px-3 py-2">
                <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2 font-sans text-xs font-medium text-foreground">
                  <span>{label}</span>
                  {segment.description ? <span className="font-normal text-muted-foreground">{segment.description}</span> : null}
                </span>
                {singleLine ? (
                  <Input
                    ref={(element) => {
                      if (element) controls.current.set(segment.id, element);
                      else controls.current.delete(segment.id);
                    }}
                    value={values[segment.id] || ''}
                    onChange={(event) => onChange(segment.id, event.target.value.replace(/[\r\n]/g, ''))}
                    onKeyDown={(event) => moveFocus(event, segment.id)}
                    disabled={readOnly}
                    placeholder={segment.prompt || `填写第 ${regionIndex + 1} 空代码`}
                    className="h-9 min-h-9 min-w-[18rem] font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                ) : (
                  <textarea
                    ref={(element) => {
                      if (element) controls.current.set(segment.id, element);
                      else controls.current.delete(segment.id);
                    }}
                    value={values[segment.id] || ''}
                    onChange={(event) => onChange(segment.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Tab' && (event.metaKey || event.ctrlKey)) moveFocus(event, segment.id);
                    }}
                    disabled={readOnly}
                    rows={5}
                    spellCheck={false}
                    className="min-h-28 w-full min-w-[22rem] resize-y rounded-lg border bg-background p-3 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                  />
                )}
              </label>
            );
          })
        ) : (
          <p className="px-4 py-5 font-sans text-sm text-muted-foreground">当前没有公开代码或作答区。</p>
        )}
      </div>
    </div>
  );
}
