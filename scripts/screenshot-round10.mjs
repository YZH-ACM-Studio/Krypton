#!/usr/bin/env node
/** Verify round-10 changes via screenshots. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-round10');
mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="uname"]', { timeout: 15000 });
  await page.fill('input[name="uname"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
}

async function ensureNotInSudo(page) {
  const isSudo = await page.evaluate(() => window.__KRYPTON_BOOTSTRAP__?.page?.templateName === 'user_sudo.html');
  if (!isSudo) return;
  console.log('  (sudo)');
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  await page.fill('input[type="password"]', PASS);
  await (await page.locator('button[type="submit"]').first()).click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function shot(page, name, url, beforeShot) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(800);
  await ensureNotInSudo(page);
  if (beforeShot) await beforeShot(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  try {
    await login(page);
    console.log('Logged in.');

    // R10-1: permission page — table of roles
    await shot(page, '01-perms-table', '/domain/permission');

    // R10-1: open the dialog (click first 编辑 button)
    await shot(page, '02-perms-dialog', '/domain/permission', async (p) => {
      // wait for table + click edit
      await p.waitForSelector('button:has-text("编辑")', { timeout: 4000 }).catch(() => {});
      const btn = p.locator('button:has-text("编辑")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(400);
    });

    // R10-2: split scroll — scroll the *content pane* down and confirm the
    // sidebar (left of it) didn't move.
    console.log('> 03-split-scroll-status (content scrolled, sidebar fixed)');
    await page.goto(`${BASE}/status`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(800);
    await ensureNotInSudo(page);
    await page.evaluate(() => {
      // Find the AdminPage content pane (motion.div with overflow-y-auto, sibling of <aside>).
      const all = Array.from(document.querySelectorAll('main div[class*="flex"][class*="items-stretch"] > div'));
      const content = all.find((el) => getComputedStyle(el).overflowY === 'auto');
      if (content) content.scrollTop = 500;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, '03-split-scroll-status.png'), fullPage: false });

    // R10-3: schools page with new + create dialog open
    await shot(page, '04-schools-listing', '/admin/userbind/schools');
    await shot(page, '05-schools-create-dialog', '/admin/userbind/schools', async (p) => {
      const btn = p.locator('button:has-text("新建学校")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(400);
    });

    // R10-3: groups page with create dialog open
    await shot(page, '06-groups-listing', '/admin/userbind/groups');
    await shot(page, '07-groups-create-dialog', '/admin/userbind/groups', async (p) => {
      const btn = p.locator('button:has-text("新建用户组")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(400);
    });

    // R10-4: /admin/userbind should redirect to /admin/userbind/schools
    await shot(page, '08-userbind-redirected', '/admin/userbind');
  } finally {
    await browser.close();
  }
})();
