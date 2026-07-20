import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import type { Extension } from '@codemirror/state';

export function structuredCodeLanguageExtension(lang: string): Extension {
  const base = lang.toLowerCase().split('.')[0];
  if (['c', 'cc', 'cpp'].includes(base)) return cpp();
  if (['py', 'python'].includes(base)) return python();
  if (base === 'java') return java();
  if (['js', 'javascript', 'ts', 'typescript'].includes(base)) return javascript({ typescript: ['ts', 'typescript'].includes(base) });
  if (base === 'go') return go();
  if (['rs', 'rust'].includes(base)) return rust();
  return [];
}
