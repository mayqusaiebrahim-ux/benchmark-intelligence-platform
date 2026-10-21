/**
 * waitForRenderedContent — capture waits (bounded) for a script-rendered page
 * to show real content before the screenshot. Live finding: Saudia's homepage
 * was captured blank on Render's 0.15-CPU instance. Real headless Chromium,
 * local page, no network. Skipped where no Chromium is installed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ENGINE = join(HERE, '..', '..', '..', '11_Benchmark_Engine');
const { waitForRenderedContent } = await import(pathToFileURL(join(ENGINE, 'modules', 'navigation_runner', 'capture.js')).href);

async function loadChromium() {
  try {
    const { chromium } = await import(pathToFileURL(join(ENGINE, 'node_modules', 'playwright', 'index.mjs')).href);
    return existsSync(chromium.executablePath()) ? chromium : null;
  } catch { return null; }
}
const chromium = await loadChromium();
const SKIP = !chromium && 'no Chromium for this platform';

test('a page that renders its content late is waited for, not captured blank', { skip: SKIP }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<body><script>setTimeout(()=>{document.body.innerHTML="<h1>Welcome to Example Air - book your next flight today</h1>"},1500)</script></body>');
    assert.equal(await waitForRenderedContent(page, { timeoutMs: 8000 }), true);
    assert.match(await page.innerText('body'), /Welcome to Example Air/);
  } finally { await browser.close(); }
});

test('a page that never renders: bounded — returns false within the timeout, never throws', { skip: SKIP }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<body></body>');
    const t0 = Date.now();
    assert.equal(await waitForRenderedContent(page, { timeoutMs: 1500 }), false);
    assert.ok(Date.now() - t0 < 6000);
  } finally { await browser.close(); }
});

test('a page object without waitForFunction (test fakes) never throws', async () => {
  assert.equal(await waitForRenderedContent({}, { timeoutMs: 100 }), false);
});
