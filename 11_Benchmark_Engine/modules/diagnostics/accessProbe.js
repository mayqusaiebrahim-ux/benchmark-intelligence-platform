/**
 * TEMPORARY ACCESS PROBE — remove after test
 *
 * One-shot, network-only diagnostic: loads ONE url through the exact
 * production local browser path (launchBrowser() + session.pageOptions) and
 * classifies what happened. Triggered only at server startup when
 * ACCESS_PROBE_URL is set (see 10_Dashboard/server.js). No HTTP route, no
 * OpenAI / Vision / Reasoning, no R2, no benchmark pipeline, nothing persisted.
 *
 * Verdicts:
 *   CONNECTION_FAILED       goto('commit') threw — no HTTP response at all
 *                           (DNS / TCP / TLS / HTTP2 reset / timeout)
 *   RESPONSE_NOT_LOADED     a response arrived but the document never became
 *                           readable (still "loading", or title/body unreadable)
 *   BLOCKED                 HTTP 403 or an access-denied / challenge signal
 *   HTTP_ERROR              another 4xx/5xx
 *   ACCESSIBLE              2xx/3xx, readable page, no block signal
 */
import { launchBrowser } from '../browserLauncher.js';

// TEMPORARY ACCESS PROBE — remove after test
const BLOCK_RE = /access denied|you don't have permission to access|reference #\s*[0-9a-f.]+|request unsuccessful|incapsula|attention required|just a moment|verify you are human|captcha|pardon our interruption|blocked/i;
const NAV_TIMEOUT_MS = 60000;
const POST_COMMIT_WAIT_MS = 5000;
const READ_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Best-effort read: never lets a hung page hold the probe.
async function tryRead(fn, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`read timed out after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } catch (err) {
    return { __readError: String(err.message || err).split('\n')[0] };
  } finally {
    clearTimeout(timer);
  }
}
const readFailed = (v) => v && typeof v === 'object' && '__readError' in v;

/**
 * TEMPORARY ACCESS PROBE — remove after test
 * @param {string} url
 * @param {{ launch?: typeof launchBrowser, waitMs?: number, readTimeoutMs?: number }} [deps]  test seams only
 */
export async function runAccessProbe(url, { launch = launchBrowser, waitMs = POST_COMMIT_WAIT_MS, readTimeoutMs = READ_TIMEOUT_MS } = {}) {
  const result = {
    httpStatus: null, server: null, title: null, finalUrl: null,
    blockSignal: null, verdict: null, userAgent: null, webdriver: null,
    navigationError: null, readyState: null, bodyChars: null, readError: null, commitMs: null,
  };
  const session = await launch('AccessProbe');
  try {
    const page = await session.browser.newPage(session.pageOptions);

    // 1 — navigation, resolved as soon as the response is committed.
    const t0 = Date.now();
    let resp;
    try {
      resp = await page.goto(url, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      result.navigationError = String(err.message || err).split('\n')[0];
      result.commitMs = Date.now() - t0;
      result.verdict = 'CONNECTION_FAILED';
      return result;
    }
    result.commitMs = Date.now() - t0;
    result.httpStatus = resp ? resp.status() : null;
    result.server = resp ? (resp.headers()['server'] || null) : null;
    result.finalUrl = page.url();

    // 2 — short FIXED settle (not networkidle), then best-effort reads.
    await sleep(waitMs);
    const readyState = await tryRead(() => page.evaluate(() => document.readyState), readTimeoutMs);
    const title = await tryRead(() => page.title(), readTimeoutMs);
    const text = await tryRead(() => page.evaluate(() => (document.body ? document.body.innerText : '')), readTimeoutMs);
    const ua = await tryRead(() => page.evaluate(() => navigator.userAgent), readTimeoutMs);
    const wd = await tryRead(() => page.evaluate(() => navigator.webdriver), readTimeoutMs);
    result.finalUrl = page.url();
    result.readyState = readFailed(readyState) ? null : readyState;
    result.title = readFailed(title) ? null : title;
    const body = readFailed(text) ? '' : String(text || '').slice(0, 4000);
    result.bodyChars = readFailed(text) ? null : body.length;
    result.userAgent = readFailed(ua) ? null : ua;
    result.webdriver = readFailed(wd) ? null : wd;
    const firstReadError = [readyState, title, text].find(readFailed);
    result.readError = firstReadError ? firstReadError.__readError : null;

    // 3 — classify.
    const m = `${result.title || ''}\n${body}`.match(BLOCK_RE);
    result.blockSignal = m ? m[0] : null;
    const status = result.httpStatus;
    if (status === 403 || result.blockSignal) result.verdict = 'BLOCKED';
    else if (status !== null && status >= 400) result.verdict = 'HTTP_ERROR';
    else if (firstReadError || result.readyState === 'loading' || result.readyState === null) result.verdict = 'RESPONSE_NOT_LOADED';
    else result.verdict = 'ACCESSIBLE';
    return result;
  } finally {
    await session.close();
  }
}
