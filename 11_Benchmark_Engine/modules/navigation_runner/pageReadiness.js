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
    const hasBody = await page.evaluate(() => !!document.body).catch(() => false);
    if (!hasBody) {
      throw new Error(
        `${label}: ${url} responded (HTTP ${response ? response.status() : 'n/a'}) but no document body was available ` +
        `after ${PAGE_READY_TIMEOUT_MS}ms — page unavailable.`,
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
