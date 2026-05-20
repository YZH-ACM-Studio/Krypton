#!/usr/bin/env node
/**
 * Take screenshots of all the V2 redesign surfaces.
 *
 * Usage: node scripts/screenshot-v2.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8888';
const USER = process.env.USER_ACCOUNT || 'root';
const PASS = process.env.USER_PASSWORD || 'krypton';
const OUT = join(process.cwd(), 'docs', 'screenshots-v2');

mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  // SPA mount — wait for the form to actually appear.
  await page.waitForSelector('input[name="uname"]', { timeout: 15000 });
  await page.fill('input[name="uname"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  // Wait for navigation away from /login
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle');
  // Verify
  const sigCheck = await page.evaluate(() => (window).__KRYPTON_BOOTSTRAP__?.user?.signedIn);
  if (!sigCheck) {
    throw new Error('Login did not stick (user not signedIn after submit).');
  }
}

async function shot(page, name, url) {
  console.log(`> ${name}: ${url}`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  // Give SPA a moment to mount.
  await page.waitForTimeout(1000);
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

    // Userbind admin
    await shot(page, '01-userbind-overview', '/admin/userbind');
    await shot(page, '02-userbind-schools', '/admin/userbind/schools');
    await shot(page, '03-userbind-groups', '/admin/userbind/groups');
    await shot(page, '04-userbind-students', '/admin/userbind/students');
    await shot(page, '05-userbind-tokens', '/admin/userbind/tokens');
    await shot(page, '06-userbind-requests', '/admin/userbind/requests');
    await shot(page, '07-userbind-students-import', '/admin/userbind/students/import');

    // Find a school for school-detail screenshot
    try {
      const schoolHref = await page.locator('a[href^="/admin/userbind/schools/"]:not([href$="/schools"])').first().getAttribute('href', { timeout: 3000 });
      if (schoolHref) {
        await shot(page, '08-userbind-school-detail', schoolHref);
      }
    } catch {}
    // user-group detail
    try {
      const gHref = await page.locator('a[href^="/admin/userbind/groups/"]:not([href$="/groups"])').first().getAttribute('href', { timeout: 3000 });
      if (gHref) {
        await shot(page, '09-userbind-group-detail', gHref);
      }
    } catch {}

    // Vigil admin
    await shot(page, '10-vigil-overview', '/admin/vigil');
    await shot(page, '11-vigil-approvals', '/admin/vigil/approvals');
    await shot(page, '12-vigil-sessions', '/admin/vigil/sessions');
    await shot(page, '13-vigil-events', '/admin/vigil/events');

    // Student-facing
    await shot(page, '14-user-bind-form', '/userbind');
    await shot(page, '15-user-bind-applications', '/userbind/applications');
    await shot(page, '16-user-bind-claim', '/userbind/claim');

    // Exam SPA — home
    await shot(page, '17-exam-mode-home', '/exam-mode');

    // Try to find a paper / exam contest to enter
    try {
      const examHref = await page.locator('a[href^="/exam-mode/"]').first().getAttribute('href', { timeout: 3000 });
      if (examHref && examHref !== '/exam-mode') {
        await shot(page, '18-exam-paper-overview', examHref);
        await shot(page, '19-exam-paper-problems', `${examHref}#problems`);
        await shot(page, '20-exam-paper-announcements', `${examHref}#announcements`);
        await shot(page, '21-exam-paper-ranking', `${examHref}#ranking`);
      }
    } catch {}

    // A landing page (invalid token to see error handling)
    await shot(page, '22-bind-landing-invalid', '/bind/this-token-does-not-exist-1234567890');

    // V3 import refactor surfaces
    await shot(page, '23-userbind-import-refactor', '/admin/userbind/students/import');
    // School detail (already covered by 08); take a fresh shot with new importer panel.
    try {
      await page.goto(`${BASE}/admin/userbind/schools`, { waitUntil: 'networkidle' });
      const schoolHref = await page.locator('a[href^="/admin/userbind/schools/"]:not([href$="/schools"])').first().getAttribute('href', { timeout: 3000 });
      if (schoolHref) await shot(page, '24-school-detail-with-importer', schoolHref);
    } catch {}
    try {
      await page.goto(`${BASE}/admin/userbind/groups`, { waitUntil: 'networkidle' });
      const gHref = await page.locator('a[href^="/admin/userbind/groups/"]:not([href$="/groups"])').first().getAttribute('href', { timeout: 3000 });
      if (gHref) await shot(page, '25-group-detail-with-importer', gHref);
    } catch {}

    console.log('\nDone. Screenshots saved to:', OUT);
  } catch (e) {
    console.error('error:', e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
