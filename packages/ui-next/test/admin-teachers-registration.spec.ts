// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

const resolverPath = resolvePath(import.meta.dirname, '../src/pages/resolver.tsx');

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

describe('admin teachers registration', () => {
  it('maps admin_teachers.html to AdminTeachersPage', () => {
    const resolver = readFileSync(resolverPath, 'utf8');
    const pageMap = sliceBetween(resolver, 'const PAGE_MAP', 'export function PageResolver');
    const mapped = /'admin_teachers\.html':\s*([A-Za-z0-9_]+)/.exec(pageMap);
    const importsPage = /import\s*\{[^}]*\bAdminTeachersPage\b[^}]*\}\s*from\s*'@\/pages\/admin-teachers'/.test(resolver);

    expect(pageMap.length, 'PAGE_MAP block').to.be.greaterThan(0);
    expect(mapped?.[1], 'admin_teachers.html must map to AdminTeachersPage').to.equal('AdminTeachersPage');
    expect(importsPage, 'resolver must import AdminTeachersPage from @/pages/admin-teachers').to.equal(true);
  });
});
