#!/usr/bin/env node
/** Verify the Checkbox migration via screenshots. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-checkbox');
mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="uname"]', { timeout: 15000 });
  await page.fill('input[name="uname"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

async function ensureNotInSudo(page) {
  const isSudo = await page.evaluate(() => window.__KRYPTON_BOOTSTRAP__?.page?.templateName === 'user_sudo.html');
  if (!isSudo) return;
  // The sudo page has a Checkbox too — our type="password" Input still works.
  const pwInputs = await page.locator('input[type="password"]');
  if (await pwInputs.count()) {
    await pwInputs.first().fill(PASS);
    await (await page.locator('button[type="submit"]').first()).click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function shot(page, name, url, beforeShot) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(900);
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

    // Records page — 3 checkboxes at top of filters
    await shot(page, '01-records-filters', '/record');

    // Problems list — has hidden checkbox
    await shot(page, '02-problems-filter', '/p');

    // Domain permission page — many checkboxes in dialog
    await shot(page, '03-domain-perm', '/domain/permission', async (p) => {
      const btn = p.locator('button:has-text("编辑")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(400);
    });

    // Contest create — many flag checkboxes
    await shot(page, '04-contest-create', '/contest/create');

    // Announcement editor (open dialog)
    await shot(page, '05-announce-create', '/admin/announce', async (p) => {
      const btn = p.locator('button:has-text("新建公告")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(500);
    });

    // RankBoard award type dialog
    await shot(page, '06-rankboard-award-edit', '/admin/rankboard/awards', async (p) => {
      const btn = p.locator('button:has-text("编辑")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(400);
    });

    // Userbind groups create dialog
    await shot(page, '07-userbind-groups', '/admin/userbind/groups', async (p) => {
      const btn = p.locator('button:has-text("新建用户组")').first();
      if (await btn.count()) await btn.click();
      await p.waitForTimeout(400);
    });

    // Click one checkbox to show :checked styling
    console.log('> 08-checked-state');
    await page.goto(`${BASE}/p`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // find a Checkbox label
    const cb = page.locator('label:has-text("仅显示隐藏")').first();
    if (await cb.count()) {
      await cb.click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: join(OUT, '08-checked-state.png'), fullPage: false });

  } finally {
    await browser.close();
  }
})();
