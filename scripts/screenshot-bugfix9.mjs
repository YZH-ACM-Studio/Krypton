#!/usr/bin/env node
/**
 * Verify the round-9 admin bugfixes by taking screenshots of the affected
 * surfaces. Output goes to docs/screenshots-bugfix9/.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-bugfix9');

mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[name="uname"]', { timeout: 15000 });
  await page.fill('input[name="uname"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  const sigCheck = await page.evaluate(() => (window).__KRYPTON_BOOTSTRAP__?.user?.signedIn);
  if (!sigCheck) throw new Error('Login did not stick');
}

/** If the page is currently showing the sudo "身份验证" gate, fill the password
 * and submit. Tolerates the new UI's password input that has no name. */
async function ensureNotInSudo(page) {
  const isSudo = await page.evaluate(() => {
    const tpl = window.__KRYPTON_BOOTSTRAP__?.page?.templateName;
    return tpl === 'user_sudo.html';
  });
  if (!isSudo) return;
  console.log('  (sudo gate detected — re-authenticating)');
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  await page.fill('input[type="password"]', PASS);
  const btn = await page.locator('button[type="submit"]').first();
  await btn.click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function shot(page, name, url) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(800);
  await ensureNotInSudo(page);
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

    // Bug 1: permission page no longer crashes
    await shot(page, '01-domain-permission', '/domain/permission');

    // Bug 2: join-applications wrapped in AdminPage
    await shot(page, '02-domain-join-applications', '/domain/join_applications');

    // Bug 3+4: admin sidebar item filtering (root user — should see all)
    await shot(page, '03-status-as-root', '/status');
    await shot(page, '04-manage-as-root', '/manage');

    // Bug 5: no back arrow in admin shells
    await shot(page, '05-domain-edit', '/domain/edit');
    await shot(page, '06-manage-setting', '/manage/setting');

    // Bug 6+7: problem import URL fix — page should render, not error
    await shot(page, '07-problem-import-via-admin', '/problem/import/hydro');

    // Bug 6: error placeholder substitution — visit a nonexistent problem.
    // Use a valid-looking alphanumeric pid so the validator passes and we
    // actually hit ProblemNotFoundError (which is the one with {1}).
    await shot(page, '08-error-placeholder-fixed', '/p/P9999');

    // Bug 8: markdown editor height alignment + preview rendering
    // domain edit has a MarkdownEditor with a bulletin
    // already captured in 05 above

    // Bug 9: sidebar shift on /status — captured in 03 above

    // Bug 10: visual config editor
    await shot(page, '09-manage-config-visual', '/manage/config');

    // Bug 11+12: correct urls for userimport/userpriv
    await shot(page, '10-manage-userimport', '/manage/userimport');
    await shot(page, '11-manage-userpriv', '/manage/userpriv');
  } finally {
    await browser.close();
  }
})();
