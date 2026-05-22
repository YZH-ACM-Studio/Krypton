#!/usr/bin/env node
/** Screenshots for round-12 changes (8 UI items). */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-round12');
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
  const pwInputs = page.locator('input[type="password"]');
  if (await pwInputs.count()) {
    await pwInputs.first().fill(PASS);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  }
}

async function shot(page, name, url, beforeShot, fullPage = true) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(900);
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

    // #1 + #2 MiniTabBar + exam panels
    // Need an actual exam contest. Just go to /exam-mode home.
    await shot(page, '01-exam-mode-home', '/exam-mode');

    // #3 Vigil in main sidebar — visible after login on / (root user)
    await shot(page, '02-home-sidebar-vigil', '/');

    // #4 Vigil overview new design
    await shot(page, '03-vigil-overview', '/admin/vigil');

    // #5 Announce edit as standalone page
    await shot(page, '04-announce-new-standalone', '/admin/announce/new');

    // #8 Sample full-bleed pages
    await shot(page, '05-training-create', '/training/create');
    await shot(page, '06-contest-create', '/contest/create');
    await shot(page, '07-discussion-create', '/d/system/discuss/node/system_announce/create');

    // #7 Problem type picker on create
    await shot(page, '08-problem-create-type-picker', '/problem/create');

  } finally {
    await browser.close();
  }
})();
