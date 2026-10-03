import type { CSSProperties } from 'react';

function fillPercent(label: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    throw new TypeError(`Range "${label}" needs a finite value and max greater than min`);
  }
  return ((value - min) / (max - min)) * 100;
}

export function RangeInput({
  label,
  value,
  min,
  max,
  step = 1,
  onValueChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
}) {
  const pct = fillPercent(label, value, min, max);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-2xs text-fg-subtle">{label}</span>
      <input
        type="range"
        className="kr-slider w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (!Number.isFinite(next)) {
            throw new TypeError(`Range "${label}" produced a non-numeric value`);
          }
          onValueChange(next);
        }}
      />
    </label>
  );
}
