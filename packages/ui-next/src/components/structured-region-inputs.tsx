import { useRef } from 'react';
import { Input } from '@/components/ui/input';

export interface StudentRegion {
  id: string;
  signature?: string;
  description?: string;
  prompt?: string;
}

export type StudentProgramFillSkeletonLine = { code: string } | { regionId: string };

export function StructuredRegionInputs({
  regions,
  values,
  onChange,
  singleLine = false,
  readOnly = false,
  skeleton,
}: {
  regions: StudentRegion[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  singleLine?: boolean;
  readOnly?: boolean;
  skeleton?: StudentProgramFillSkeletonLine[];
}) {
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  if (skeleton) {
    const regionById = new Map(regions.map((region) => [region.id, region]));
    const orderedRegionIds = regions.map((region) => region.id);
    const orderByRegionId = new Map(orderedRegionIds.map((id, index) => [id, index]));
    const skeletonIds = skeleton.flatMap((line) => ('regionId' in line ? [line.regionId] : []));
    if (
      skeletonIds.length !== regions.length ||
      new Set(skeletonIds).size !== skeletonIds.length ||
      skeletonIds.some((id) => !regionById.has(id)) ||
      regions.some((region) => !skeletonIds.includes(region.id))
    ) {
      throw new Error('program_fill: public skeleton does not match region descriptors');
    }
    return (
      <div className="overflow-x-auto rounded-lg border bg-muted/15" aria-label="程序填空代码骨架">
        <div className="min-w-[36rem] py-2 font-mono text-sm">
          {skeleton.map((line, index) => {
            const region = 'regionId' in line ? regionById.get(line.regionId)! : null;
            const regionOrder = region ? orderByRegionId.get(region.id)! : -1;
            return (
              <div key={`${index}-${region?.id || 'code'}`} className="grid min-h-9 grid-cols-[3rem_minmax(0,1fr)] items-center">
                <span aria-hidden="true" className="select-none pr-3 text-right text-xs text-muted-foreground/70">
                  {index + 1}
                </span>
                {region ? (
                  <label className="block py-1 pr-3">
                    <span className="sr-only">
                      程序填空第 {regionOrder + 1} 空{region.prompt ? `：${region.prompt}` : ''}
                    </span>
                    <Input
                      ref={(element) => {
                        if (element) inputRefs.current.set(region.id, element);
                        else inputRefs.current.delete(region.id);
                      }}
                      value={values[region.id] || ''}
                      onChange={(event) => onChange(region.id, event.target.value.replace(/[\r\n]/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key !== 'Tab') return;
                        const targetId = orderedRegionIds[regionOrder + (event.shiftKey ? -1 : 1)];
                        if (!targetId) return;
                        const target = inputRefs.current.get(targetId);
                        if (!target) throw new Error(`program_fill: keyboard target ${targetId} is not mounted`);
                        event.preventDefault();
                        target.focus();
                      }}
                      tabIndex={regionOrder === 0 ? 0 : -1}
                      disabled={readOnly}
                      placeholder={region.prompt || `第 ${regionOrder + 1} 空 · 填写这一行代码`}
                      className="h-8 min-h-8 w-full font-mono"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                ) : (
                  <code className="block whitespace-pre px-1 pr-3">{'code' in line && line.code.length ? line.code : ' '}</code>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {regions.map((region, index) => (
        <label key={region.id} className="block space-y-1.5">
          <span className="text-sm font-medium">{region.signature || region.prompt || (singleLine ? '填写挖空代码' : `函数区域 ${index + 1}`)}</span>
          {region.description ? <span className="block text-xs text-muted-foreground">{region.description}</span> : null}
          {singleLine ? (
            <Input
              value={values[region.id] || ''}
              onChange={(event) => onChange(region.id, event.target.value.replace(/[\r\n]/g, ''))}
              disabled={readOnly}
              className="min-h-11 font-mono"
              autoComplete="off"
            />
          ) : (
            <textarea
              value={values[region.id] || ''}
              onChange={(event) => onChange(region.id, event.target.value)}
              disabled={readOnly}
              rows={8}
              spellCheck={false}
              className={[
                'w-full rounded-md border bg-background p-3 font-mono text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60',
              ].join(' ')}
            />
          )}
        </label>
      ))}
    </div>
  );
}
