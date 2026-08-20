/**
 * Vision module — first Playwright runner.
 * Sprint 2 scope only: open a page, wait for it to settle, take one full-page
 * screenshot, save it, report back. No journey steps, no analysis, no reports —
 * those are Sprint 3+ (see 11_Benchmark_Engine/README.md).
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
export const SCREENSHOTS_DIR = join(PROJECT_ROOT, '03_Screenshots');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * captureScreenshot — accepts { company, url, requestId }, returns
 * { success, path, width, height, executionTime }.
 */
export async function captureScreenshot({ company, url, requestId }) {
  const startedAt = Date.now();
  const fileName = `${slugify(company)}_${timestampForFilename()}.png`;
  const filePath = join(SCREENSHOTS_DIR, fileName);

  console.log(`[vision] capturing screenshot — company=${company} requestId=${requestId} url=${url}`);

  let browser;
  try {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      // Some pages never go fully idle (analytics/websockets) — proceed anyway.
    }

    const { width, height } = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    await page.screenshot({ path: filePath, fullPage: true });

    return {
      success: true,
      path: filePath,
      width,
      height,
      executionTime: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      success: false,
      path: null,
      width: null,
      height: null,
      executionTime: Date.now() - startedAt,
      error: err.message,
    };
  } finally {
    if (browser) await browser.close();
  }
}
