#!/usr/bin/env node
/**
 * Screenshot the krypton-tasks surfaces.
 *
 * Usage: BASE=http://127.0.0.1:8888 USER_ACCOUNT=root USER_PASSWORD=krypton node scripts/screenshot-tasks.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-tasks');

mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="uname"]', { timeout: 15000 });
  await page.fill('input[name="uname"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  const sig = await page.evaluate(() => (window).__KRYPTON_BOOTSTRAP__?.user?.signedIn);
  if (!sig) throw new Error('Login did not stick.');
}

async function shot(page, name, url) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
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

    // User-facing
    await shot(page, '01-tasks-center',      '/tasks');
    await shot(page, '02-tasks-my',          '/tasks/my');

    // Find first task ID to deep-link into detail
    try {
      const href = await page.locator('a[href^="/tasks/"]').filter({ hasNotText: /我的任务|任务中心/ }).first().getAttribute('href', { timeout: 3000 });
      if (href && href !== '/tasks' && href !== '/tasks/my') {
        await shot(page, '03-tasks-detail-assigned', href);
      }
    } catch (e) { console.log('skip detail:', e.message); }

    // Admin
    await shot(page, '04-admin-tasks-list',     '/admin/tasks');
    await shot(page, '05-admin-tasks-create',   '/admin/tasks/create');

    try {
      const href = await page.locator('a[href^="/admin/tasks/"][href$="/edit"]').first().getAttribute('href', { timeout: 3000 });
      if (href) {
        await shot(page, '06-admin-tasks-edit', href);
        await shot(page, '07-admin-tasks-assign', href.replace('/edit', '/assign'));
        await shot(page, '08-admin-tasks-stats', href.replace('/edit', '/stats'));
      }
    } catch (e) { console.log('skip edit:', e.message); }

    // Score tabs
    await shot(page, '09-admin-scores-pat',   '/admin/tasks/scores?tab=pat');
    await shot(page, '10-admin-scores-gplt',  '/admin/tasks/scores?tab=gplt');
    await shot(page, '11-admin-scores-csp',   '/admin/tasks/scores?tab=csp');

    // Settings
    await shot(page, '12-admin-settings',     '/admin/tasks/settings');

    console.log('\nDone. Screenshots saved to:', OUT);
  } catch (e) {
    console.error('error:', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
