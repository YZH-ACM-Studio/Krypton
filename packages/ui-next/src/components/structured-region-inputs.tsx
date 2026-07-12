import { Input } from '@/components/ui/input';

export interface StudentRegion {
  id: string;
  prompt?: string;
}

export function StructuredRegionInputs({
  regions, values, onChange, singleLine = false, readOnly = false,
}: {
  regions: StudentRegion[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  singleLine?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      {regions.map((region, index) => (
        <label key={region.id} className="block space-y-1.5">
          <span className="text-sm font-medium">
            {region.prompt || (singleLine ? '填写挖空代码' : `函数区域 ${index + 1}`)}
          </span>
          <span className="block font-mono text-[11px] text-muted-foreground">{region.id}</span>
          {singleLine ? (
            <Input
              value={values[region.id] || ''}
              onChange={(event) => onChange(
                region.id,
                event.target.value.replace(/[\r\n]/g, ''),
              )}
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
