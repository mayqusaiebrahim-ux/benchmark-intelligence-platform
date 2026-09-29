/**
 * TEMPORARY ACCESS PROBE — remove after test
 *
 * One-shot, network-only diagnostic: loads ONE url through the exact
 * production local browser path (launchBrowser() + session.pageOptions) and
 * reports whether the site served real content or an access-denied /
 * challenge page. Triggered only at server startup when ACCESS_PROBE_URL is
 * set (see 10_Dashboard/server.js). No HTTP route, no OpenAI / Vision /
 * Reasoning, no R2, no benchmark pipeline, nothing persisted.
 */
import { launchBrowser } from '../browserLauncher.js';

// TEMPORARY ACCESS PROBE — remove after test
const BLOCK_RE = /access denied|you don't have permission to access|reference #\s*[0-9a-f.]+|request unsuccessful|incapsula|attention required|just a moment|verify you are human|captcha|pardon our interruption|blocked/i;

/**
 * TEMPORARY ACCESS PROBE — remove after test
 * @param {string} url
 * @param {{ launch?: typeof launchBrowser }} [deps]  test seam only
 * @returns {Promise<{httpStatus, server, title, finalUrl, blockSignal, verdict, userAgent, webdriver, error?}>}
 */
export async function runAccessProbe(url, { launch = launchBrowser } = {}) {
  const result = {
    httpStatus: null, server: null, title: null, finalUrl: null,
    blockSignal: null, verdict: null, userAgent: null, webdriver: null,
  };
  const session = await launch('AccessProbe');
  try {
    const page = await session.browser.newPage(session.pageOptions);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { /* same as Discovery */ }
      const title = await page.title();
      const text = String(await page.evaluate(() => (document.body ? document.body.innerText : '')) || '').slice(0, 4000);
      const m = `${title}\n${text}`.match(BLOCK_RE);
      const status = resp ? resp.status() : null;
      Object.assign(result, {
        httpStatus: status,
        server: resp ? (resp.headers()['server'] || null) : null,
        title,
        finalUrl: page.url(),
        blockSignal: m ? m[0] : null,
        verdict: m || (status !== null && status >= 400) ? 'BLOCKED' : 'ACCESSIBLE',
        userAgent: await page.evaluate(() => navigator.userAgent),
        webdriver: await page.evaluate(() => navigator.webdriver),
      });
    } catch (err) {
      Object.assign(result, { verdict: 'NAVIGATION_ERROR', error: String(err.message || err).split('\n')[0] });
    }
  } finally {
    await session.close();
  }
  return result;
}
