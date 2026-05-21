#!/usr/bin/env node
/**
 * Screenshot all surfaces of the three new plugins:
 *   - announcement (list / admin / categories / home block / topbar popover)
 *   - rankboard (public / admin / awards / person detail)
 *   - mindmap (public + edit mode)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-3plugins');
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
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  await page.fill('input[type="password"]', PASS);
  await (await page.locator('button[type="submit"]').first()).click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function shot(page, name, url, beforeShot, fullPage = true) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1000);
  await ensureNotInSudo(page);
  if (beforeShot) await beforeShot(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
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

    // ── Home (with announcement block) ──
    await shot(page, '01-home-with-announce-block', '/');

    // ── Announcement public ──
    await shot(page, '02-announce-list', '/announce');
    await shot(page, '03-announce-admin', '/admin/announce');
    await shot(page, '04-announce-categories', '/admin/announce/categories');

    // ── Topbar megaphone popover ──
    console.log('> 05-topbar-megaphone');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const megaBtn = page.locator('button[title="公告"]').first();
    if (await megaBtn.count()) {
      await megaBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, '05-topbar-megaphone.png'), fullPage: false });
    }

    // ── RankBoard ──
    await shot(page, '06-rankboard-empty', '/rankboard');
    await shot(page, '07-rankboard-admin-empty', '/admin/rankboard');
    await shot(page, '08-rankboard-awards', '/admin/rankboard/awards');

    // Create a person via API, then take screenshots
    console.log('> Adding sample data via admin search → add');
    // Find a student
    const searchRes = await page.evaluate(async () => {
      const r = await fetch('/admin/rankboard/search?q=', { headers: { Accept: 'application/json' } });
      return await r.json();
    });
    if (searchRes?.students?.[0]) {
      const sid = searchRes.students[0]._id;
      console.log('  using student', sid);
      // Add this student to rankboard
      await page.evaluate(async (sid) => {
        const form = new URLSearchParams();
        form.set('operation', 'add');
        form.set('studentDocId', sid);
        await fetch('/admin/rankboard', { method: 'POST', body: form });
      }, sid);
      await shot(page, '09-rankboard-with-person', '/rankboard');
      await shot(page, '10-rankboard-admin-with-person', '/admin/rankboard');
    }

    // ── Mindmap ──
    await shot(page, '11-mindmap-public', '/mindmap', null, false);
    // Toggle edit mode
    console.log('> 12-mindmap-edit-mode');
    await page.goto(`${BASE}/mindmap`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const editBtn = page.locator('button:has-text("编辑模式")').first();
    if (await editBtn.count()) {
      await editBtn.click();
      await page.waitForTimeout(600);
    }
    // Click a node
    const node = page.locator('.react-flow__node').nth(2);
    if (await node.count()) {
      await node.click();
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: join(OUT, '12-mindmap-edit-mode.png'), fullPage: false });

  } finally {
    await browser.close();
  }
})();
