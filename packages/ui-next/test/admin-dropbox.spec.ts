import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).to.be.at.least(0);
  expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
  return text.slice(start, end);
}

describe('admin dropbox PAGE_MAP contracts', () => {
  const resolver = source('packages/ui-next/src/pages/resolver.tsx');
  const page = source('packages/ui-next/src/pages/admin-dropbox.tsx');
  const handler = source('packages/krypton-admin-dropbox/src/handler.ts');
  const pageMap = sliceBetween(resolver, 'const PAGE_MAP', 'export function PageResolver');

  it('registers admin_dropbox.html in PAGE_MAP without exam-mode or collect templates', () => {
    expect(resolver).to.include("from '@/pages/admin-dropbox'");
    expect(pageMap).to.include("'admin_dropbox.html': AdminDropboxPage");
    expect(page).to.include("templateNames: ['admin_dropbox.html']");
    expect(handler).to.include("this.response.template = 'admin_dropbox.html'");
    expect(pageMap).not.to.match(/'admin_dropbox\.html':\s*\w*Exam/);
    expect(pageMap).not.to.match(/'admin_dropbox\.html':\s*\w*Collect/);
  });
});

describe('admin dropbox expiry and privilege contracts', () => {
  const page = source('packages/ui-next/src/pages/admin-dropbox.tsx');
  const handler = source('packages/krypton-admin-dropbox/src/handler.ts');
  const types = source('packages/krypton-admin-dropbox/src/types.ts');
  const auth = source('packages/krypton-admin-dropbox/src/auth.ts');

  it('defaults expiry to 7 days', () => {
    expect(page).to.include('const DEFAULT_EXPIRE_DAYS = 7');
    expect(page).to.include('const EXPIRE_DAY_OPTIONS = [1, 3, 7, 14, 30]');
    expect(page).to.include('parseExpireDays(rec.defaultExpireDays, DEFAULT_EXPIRE_DAYS)');
    expect(page).to.include('String(DEFAULT_EXPIRE_DAYS)');
    expect(page).to.include('默认 7 天');
    expect(handler).to.include('defaultExpireDays: Math.round(ADMIN_DROPBOX_DEFAULT_TTL_MS / DAY_MS)');
    expect(types).to.include('ADMIN_DROPBOX_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000');
  });

  it('gates the page, nav, and routes with PRIV_EDIT_SYSTEM', () => {
    expect(page).to.include('requiredPriv: PRIV.PRIV_EDIT_SYSTEM');
    expect(page).to.include('requiredPriv={PRIV.PRIV_EDIT_SYSTEM}');
    expect(page).to.include('isSystemAdmin(bs.user.priv)');
    expect(handler).to.include('checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
    expect(handler).to.include("ctx.Route('admin_dropbox', '/admin/dropbox', AdminDropboxHandler, PRIV.PRIV_EDIT_SYSTEM)");
    expect(handler).to.include("ctx.Route('admin_dropbox_file', '/admin/dropbox/:id', AdminDropboxDownloadHandler, PRIV.PRIV_EDIT_SYSTEM)");
    expect(auth).to.include('user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
  });
});

describe('admin dropbox collect isolation contracts', () => {
  const page = source('packages/ui-next/src/pages/admin-dropbox.tsx');
  const handler = source('packages/krypton-admin-dropbox/src/handler.ts');

  it('uses /admin/dropbox and never a collect endpoint', () => {
    expect(page).to.include("const DROPBOX_ENDPOINT = '/admin/dropbox'");
    expect(page).to.include('endpoint={DROPBOX_ENDPOINT}');
    expect(page).not.to.match(/from ['"]@\/pages\/collect['"]/);
    expect(page).not.to.match(/from ['"]@\/pages\/admin-collect['"]/);
    expect(page).not.to.match(/['"`]\/collect/);
    expect(page).not.to.match(/endpoint=\{?['"`][^'"`]*collect/);
    expect(handler).to.include("'/admin/dropbox'");
    expect(handler).to.include("'/admin/dropbox/:id'");
    // eslint-disable-next-line no-template-curly-in-string
    expect(handler).to.include('downloadUrl: `/admin/dropbox/${id}`');
    expect(handler).not.to.match(/['"`]\/collect/);
  });
});
