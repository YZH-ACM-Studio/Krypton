#!/usr/bin/env node
/**
 * Migrate native `<input type="checkbox" ... />` to the new `<Checkbox />`
 * component across packages/ui-next/src.
 *
 * Transformations:
 *   1. `<input type="checkbox" ... className="size-4 ..." ... />`
 *      → `<Checkbox ... />`           (drops the redundant size/border classes)
 *   2. `<input type="checkbox" ... className="size-3.5 ..." ... />`
 *      → `<Checkbox size="sm" ... />`
 *   3. `<input type="checkbox" ... />`  (no className)
 *      → `<Checkbox ... />`
 *
 * Also adds the import line if missing.
 *
 * Strategy: read each file, do a regex pass on single-line `<input type=...>`
 * blocks AND multi-line ones (find the opening, then the closing `/>` after
 * any attributes), then collect & rewrite.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = '/Users/motricseven/Krypton/packages/ui-next/src';

// Find all files with `type="checkbox"` (excluding the Checkbox component itself).
const files = execSync(
  `grep -rln 'type="checkbox"' ${ROOT} | grep -v 'ui/checkbox.tsx' | grep -v 'styles.css'`,
  { encoding: 'utf8' },
).split('\n').filter(Boolean);

console.log(`Migrating ${files.length} files…\n`);

function importPathForFile(file) {
  // All files under src/ import via '@/components/ui/checkbox'
  return '@/components/ui/checkbox';
}

function rewriteFile(file) {
  let src = readFileSync(file, 'utf8');
  const original = src;
  let count = 0;

  // 1. Multi-line + single-line: match `<input` ... `type="checkbox"` ... `/>`
  // Use a non-greedy match between `<input` and `/>` that contains `type="checkbox"`.
  //
  // Regex breakdown:
  //   <input            literal
  //   ([\s\S]*?)        attrs (any chars incl newlines, non-greedy)
  //   \/>               self-close
  // Then we filter to ones that actually contain type="checkbox".

  src = src.replace(/<input([\s\S]*?)\/>/g, (full, attrs) => {
    if (!/type=["']checkbox["']/.test(attrs)) return full;
    // strip type="checkbox"
    let next = attrs.replace(/\s*type=["']checkbox["']/, '');
    // detect & remove size-3.5 → sm size
    let sizeProp = '';
    if (/className=["'][^"']*\bsize-3\.5\b[^"']*["']/.test(next)) {
      sizeProp = ' size="sm"';
    }
    // remove className entirely if it's just the bare styling we no longer need.
    // We strip:  size-3.5 | size-4 | rounded | border | accent-primary | mt-0.5 | shrink-0
    next = next.replace(/\s*className=["']([^"']*)["']/g, (m, classes) => {
      const tokens = classes.split(/\s+/).filter(Boolean);
      const kept = tokens.filter((t) => !/^size-(3\.5|4|3)$/.test(t)
        && t !== 'rounded'
        && t !== 'rounded-sm'
        && t !== 'border'
        && t !== 'accent-primary'
        && t !== 'mt-0.5');
      if (kept.length === 0) return '';
      return ` className="${kept.join(' ')}"`;
    });
    count++;
    return `<Checkbox${sizeProp}${next} />`;
  });

  if (count === 0) return false;

  // 2. Add the import if missing.
  if (!src.includes(`from '@/components/ui/checkbox'`)
      && !src.includes(`from "@/components/ui/checkbox"`)) {
    // Inject after the last existing `@/components/...` import line.
    const lines = src.split('\n');
    let lastUiImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import .* from ['"]@\/components\//.test(lines[i])) lastUiImport = i;
    }
    if (lastUiImport === -1) {
      // No existing @/components imports — drop after the last import line.
      for (let i = 0; i < lines.length; i++) {
        if (/^import .* from /.test(lines[i])) lastUiImport = i;
      }
    }
    if (lastUiImport >= 0) {
      lines.splice(lastUiImport + 1, 0, `import { Checkbox } from '@/components/ui/checkbox';`);
      src = lines.join('\n');
    }
  }

  writeFileSync(file, src);
  console.log(`  ${file.replace(ROOT, 'ui-next/src')}: ${count} replacements`);
  return true;
}

let total = 0;
for (const file of files) {
  try {
    if (rewriteFile(file)) total++;
  } catch (e) {
    console.error(`! ${file}: ${e.message}`);
  }
}
console.log(`\nMigrated ${total} files.`);
