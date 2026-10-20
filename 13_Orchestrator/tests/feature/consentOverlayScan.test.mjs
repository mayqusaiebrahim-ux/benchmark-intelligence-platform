/**
 * dismissConsentOverlay — regression for the live five-airline run
 * (req_1792408013473_bd55c7c6): on Etihad's large homepage, a consent banner
 * with no known accept selector sent the handler into a per-element loop
 * (innerText/getAttribute on every link, each with a 30s default timeout).
 * On Render's 0.15-CPU instance it ran for many minutes and stalled the
 * whole run behind the single browser slot.
 *
 * Real headless Chromium against a local page (setContent — no network).
 * Skipped where no Chromium is installed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ENGINE = join(HERE, '..', '..', '..', '11_Benchmark_Engine');
const { dismissConsentOverlay } = await import(pathToFileURL(join(ENGINE, 'modules', 'navigation_runner', 'actions.js')).href);

async function loadChromium() {
  try {
    const { chromium } = await import(pathToFileURL(join(ENGINE, 'node_modules', 'playwright', 'index.mjs')).href);
    return existsSync(chromium.executablePath()) ? chromium : null;
  } catch { return null; }
}
const chromium = await loadChromium();
const SKIP = !chromium && 'no Chromium for this platform';

const LINKS = Array.from({ length: 800 }, (_, i) => `<a href="#l${i}">Destination ${i}</a>`).join(' ');
// An "OK" link OUTSIDE the banner must lose to the accept button INSIDE it.
const PAGE = `<!doctype html><html><body>
<nav>${LINKS} <a href="#x" id="outside-ok">OK</a></nav>
<div class="cookie-consent-wrapper" role="region">
  <p>We use cookies.</p>
  <button id="reject" onclick="window.__clicked='reject'">Reject all</button>
  <button id="accept" onclick="window.__clicked='accept'; this.parentElement.remove()">Accept all cookies</button>
</div>
</body></html>`;

test('large page + consent banner without a known selector: accepted in one bounded scan, never the reject button', { skip: SKIP }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const t0 = Date.now();
    const r = await dismissConsentOverlay(page);
    const ms = Date.now() - t0;
    assert.equal(r.handled, true, JSON.stringify(r));
    assert.equal(r.method, 'accessible-name');
    assert.equal(await page.evaluate(() => window.__clicked), 'accept');
    assert.ok(ms < 15000, `took ${ms}ms — must not scale with the number of links on the page`);
  } finally { await browser.close(); }
});

test('no consent banner: returns immediately, clicks nothing', { skip: SKIP }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body><nav>${LINKS}</nav><button onclick="window.__clicked='ok'">OK</button></body>`);
    const r = await dismissConsentOverlay(page);
    assert.equal(r.handled, false);
    assert.equal(await page.evaluate(() => window.__clicked), undefined);
  } finally { await browser.close(); }
});
