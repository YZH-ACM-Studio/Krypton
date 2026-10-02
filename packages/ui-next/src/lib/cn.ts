import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Custom scale names must be registered. Otherwise `text-md` (a size) and
// `text-fg` (a colour) are both read as colours and one of them disappears.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'md'],
      shadow: ['xs', 'pop'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
