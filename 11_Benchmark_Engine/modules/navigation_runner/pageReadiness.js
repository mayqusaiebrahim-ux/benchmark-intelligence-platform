/**
 * pageReadiness — the Navigation Runner's starting-page load.
 *
 * Same readiness principle as Discovery: navigation only has to COMMIT (a
 * response was received and the new document started). A genuine
 * navigation failure (DNS, refused, TLS, net::ERR_*, or no response within
 * NAV_COMMIT_TIMEOUT_MS) still rejects and fails exactly as before. The
 * `load` event is then a bounded best-effort wait, not a hard gate: some
 * sites keep the document loading long after a usable page has rendered.
 * If it never arrives, navigation continues only when the committed
 * document already has a <body>; otherwise it fails as "page unavailable".
 * Generic — no site-specific logic.
 */
import { logInfo } from '../../../shared/logger.mjs';

export const NAV_COMMIT_TIMEOUT_MS = 60000;
export const PAGE_READY_TIMEOUT_MS = 30000;
const NETWORK_IDLE_TIMEOUT_MS = 8000;
const NAVIGATED_AGAIN = /execution context was destroyed|navigat/i;

/**
 * Inspect the committed document after the bounded readiness wait. Never
 * throws. Previously any evaluate() failure was silently reported as "no
 * document body", hiding the real cause. A page that navigated again (e.g. a
 * redirect or a challenge reload destroyed the execution context) is probed
 * once more after a short pause.
 * @returns {Promise<{ hasBody: boolean, readyState: string|null, url: string|null, error: string|null }>}
 */
export async function probeDocument(page, { retryDelayMs = 1000 } = {}) {
  const once = async () => {
    try {
      const r = await page.evaluate(() => ({ readyState: document.readyState, hasBody: !!document.body, url: location.href }));
      if (typeof r === 'boolean') return { hasBody: r, readyState: null, url: null, error: null }; // older fakes / shapes
      return { hasBody: !!(r && r.hasBody), readyState: (r && r.readyState) || null, url: (r && r.url) || null, error: null };
    } catch (err) {
      return { hasBody: false, readyState: null, url: null, error: String(err && err.message || err).split('\n')[0].slice(0, 200) };
    }
  };
  let probe = await once();
  if (!probe.hasBody && probe.error && NAVIGATED_AGAIN.test(probe.error)) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    probe = await once();
  }
  if (!probe.url) { try { probe.url = page.url(); } catch { /* ignore */ } }
  return probe;
}

/** The detail appended to a "no document body" failure, so logs show WHY. */
export function describeProbe(probe) {
  const parts = [];
  if (probe.readyState) parts.push(`readyState=${probe.readyState}`);
  if (probe.url) parts.push(`url=${probe.url}`);
  if (probe.error) parts.push(`probe error: ${probe.error}`);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{ label?: string }} [opts]  for logging only
 * @returns {Promise<import('playwright').Response|null>}
 */
export async function gotoWithBoundedReadiness(page, url, { label = 'Navigation Runner' } = {}) {
  const response = await page.goto(url, { waitUntil: 'commit', timeout: NAV_COMMIT_TIMEOUT_MS });
  try {
    await page.waitForLoadState('load', { timeout: PAGE_READY_TIMEOUT_MS });
  } catch {
    const probe = await probeDocument(page);
    if (!probe.hasBody) {
      throw new Error(
        `${label}: ${url} responded (HTTP ${response ? response.status() : 'n/a'}) but no document body was available ` +
        `after ${PAGE_READY_TIMEOUT_MS}ms — page unavailable${describeProbe(probe)}.`,
      );
    }
    logInfo(`${label}: page load not reached within the bounded wait — continuing with the committed document`, {
      url, status: response ? response.status() : null, waitedMs: PAGE_READY_TIMEOUT_MS,
    });
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });
  } catch {
    // Some pages never go fully idle (analytics/websockets) — proceed with whatever rendered.
  }
  return response;
}
