import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

const SIZE = {
  xs: { box: 'size-5', text: 'text-2xs' },
  sm: { box: 'size-6', text: 'text-2xs' },
  md: { box: 'size-8', text: 'text-xs' },
  lg: { box: 'size-10', text: 'text-md' },
} as const;

type PersonSize = keyof typeof SIZE;

function firstGlyph(value: string): string {
  const glyph = Array.from(value)[0];
  if (glyph === undefined || glyph.length === 0) {
    throw new TypeError('Person name is empty');
  }
  return glyph;
}

function initials(name: string, size: PersonSize): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new TypeError('Person name is empty');
  }
  const words = trimmed.split(/\s+/);
  const second = words[1];
  if (second !== undefined) {
    return `${firstGlyph(words[0] ?? '').toUpperCase()}${firstGlyph(second).toUpperCase()}`;
  }
  if (/^[A-Za-z]/.test(trimmed)) {
    return firstGlyph(trimmed).toUpperCase();
  }
  const chars = Array.from(trimmed);
  const limit = size === 'xs' || size === 'sm' ? 1 : 2;
  return chars.slice(0, limit).join('');
}

export function Person({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: PersonSize;
  className?: string;
}): ReactNode {
  const spec = SIZE[size];
  return (
    <Avatar className={cn(spec.box, className)}>
      <AvatarFallback className={cn(spec.text)}>
        {initials(name, size)}
      </AvatarFallback>
    </Avatar>
  );
}
