import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS, tokensToCss } from './tokens.ts';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, 'tokens.css'), `${tokensToCss(DEFAULT_PARAMS)}\n`);
