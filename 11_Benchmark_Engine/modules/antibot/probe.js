/**
 * probe.js — the Smart Anti-Bot Layer's main loop. Runs BEFORE Discovery,
 * using its own independent Playwright session(s) (Discovery's internal
 * chromium.launch() is untouched — see strategies.js's header comment for
 * why this is a pre-flight gate, not a request interceptor).
 *
 * V1 Stabilization: the moment a strategy is confirmed 'clean', this takes
 * the homepage screenshot immediately, in that same page/session, before
 * closing the browser — this IS the verified, unprotected homepage,
 * captured at the viewport (nav+hero+search-widget+promo), not a full-page
 * scroll capture. jobRunner.js then skips the separate, redundant
 * captureScreenshot() navigation entirely.
 *
 * V1.1 Performance: all STRATEGIES now run CONCURRENTLY instead of one
 * after another. Real measured data from the V1 Stabilization validation
 * run (see 02_Benchmark_Repository/_Protection_Reports/*, duration_ms per
 * strategy) showed this was the single largest fixable delay: Emirates paid
 * 15,984ms (baseline) + 21,831ms (stealth_lite) = 37.8s sequential for a
 * result that concurrent execution produces in max(15984, 21831) = 21.8s —
 * because in every real case observed, both strategies always ran anyway
 * (neither shortcut — "permanent" — ever fired for the sites this project
 * has actually hit). Running them concurrently can only help or be neutral:
 * - If one strategy is clean, we still return as soon as we know that,
 *   same as before, just from a faster wall-clock position.
 * - If one is permanent, we still treat it as permanent immediately, same
 *   as before.
 * - Only if the fast-failing strategy would previously have caused an
 *   early skip of the *other* strategy does concurrent execution do
 *   "extra" work — and even then, wall-clock time is bounded by the
 *   slower strategy either way, so it's never slower than sequential was.
 * Progress events still fire per-strategy, as each individually finishes
 * (not batched at the end), via a .then() on each strategy's own promise —
 * so live progress reporting is unaffected by running them concurrently.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { STRATEGIES } from './strategies.js';
import { classifyNetworkError, classifyResponse } from './detectors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const SCREENSHOTS_DIR = join(PROJECT_ROOT, '03_Screenshots');

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptStrategy(url, strategy, { companySlug }) {
  const attemptStartedAt = Date.now();
  const delayMs = strategy.preDelayMs();
  if (delayMs > 0) await sleep(delayMs);

  let browser;
  try {
    browser = await chromium.launch({ args: strategy.launchArgs });
    const context = await browser.newContext(strategy.contextOptions);
    const page = await context.newPage();

    let response;
    try {
      response = await page.goto(url, { waitUntil: strategy.waitUntil, timeout: strategy.navigationTimeoutMs });
    } catch (navErr) {
      const classification = classifyNetworkError(navErr);
      return { strategyId: strategy.id, delayMs, durationMs: Date.now() - attemptStartedAt, ...classification };
    }

    // Adaptive settle: wait for network idle, capped at postSettleMs. A
    // page that's already finished loading resolves in ~500ms (Playwright's
    // minimum idle-confirmation window) instead of always paying the full
    // fixed delay; a page with persistent connections (analytics, polling)
    // still gets the same ceiling as before — this can only be faster or
    // equal to the old blind `waitForTimeout`, never slower.
    if (strategy.postSettleMs > 0) {
      try {
        await page.waitForLoadState('networkidle', { timeout: strategy.postSettleMs });
      } catch {
        // Never went idle within the budget — proceed anyway, same as the
        // old fixed wait would have.
      }
    }

    const status = response ? response.status() : null;
    const headers = response ? response.headers() : {};
    // Three independent reads of the already-loaded page — no ordering
    // dependency between them, so run them concurrently rather than
    // as three sequential CDP round-trips.
    const [title, bodyText, html] = await Promise.all([
      page.title().catch(() => ''),
      page.evaluate(() => document.body?.innerText || '').catch(() => ''),
      // Raw HTML, not just rendered text — some challenge pages (confirmed
      // real case: Imperva's "Pardon Our Interruption") put their
      // identifying text inside a <noscript> tag, which title/innerText
      // never sees.
      page.content().catch(() => ''),
    ]);

    const classification = classifyResponse({ status, headers, title, bodyText, html });

    let screenshot = null;
    if (classification.type === 'clean') {
      // Capture now, in this same verified-clean session — see file header.
      // Viewport only (fullPage: false): requirement is "the complete first
      // viewport including Navigation, Hero, Search Widget, Main promotional
      // content," not a full scrolling capture of the entire page.
      try {
        const fileName = `${slugify(companySlug)}_${timestampForFilename()}.png`;
        const filePath = join(SCREENSHOTS_DIR, fileName);
        const viewport = page.viewportSize() || { width: 1440, height: 900 };
        await page.screenshot({ path: filePath, fullPage: false });
        screenshot = { success: true, path: filePath, width: viewport.width, height: viewport.height };
      } catch (shotErr) {
        screenshot = { success: false, path: null, width: null, height: null, error: shotErr.message };
      }
    }

    return { strategyId: strategy.id, delayMs, durationMs: Date.now() - attemptStartedAt, status, screenshot, ...classification };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * probeUrl — accepts { url, companySlug }, an optional
 * onAttempt(attemptResult) callback fired as each strategy individually
 * finishes (not batched — see file header), returns:
 *   success: { ok: true, strategyUsed: string, screenshot, attempts: [...] }
 *   failure: { ok: false, permanent: boolean, classification: string,
 *              vendor: string|null, attempts: [...] }
 */
export async function probeUrl(url, { onAttempt = () => {}, companySlug = null } = {}) {
  const slugForFile = companySlug || new URL(url).hostname.replace(/^www\./, '');
  // Written once, up front — every strategy shares the same directory, so
  // there's no reason to repeat this fs call once per strategy attempt.
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const attempts = await Promise.all(
    STRATEGIES.map((strategy) =>
      attemptStrategy(url, strategy, { companySlug: slugForFile }).then((result) => {
        onAttempt(result);
        return result;
      }),
    ),
  );

  // Selection logic is unchanged from the sequential version — just
  // evaluated over concurrently-gathered results instead of one at a time.
  // First clean result *in STRATEGIES order* wins, preserving the existing
  // preference for the less-evasive strategy (baseline) when both work.
  const cleanResult = attempts.find((r) => r.type === 'clean');
  if (cleanResult) {
    const strategyIndex = attempts.indexOf(cleanResult);
    return { ok: true, strategyUsed: STRATEGIES[strategyIndex].id, screenshot: cleanResult.screenshot, attempts };
  }

  const permanentResult = attempts.find((r) => r.permanent);
  if (permanentResult) {
    return { ok: false, permanent: true, classification: permanentResult.id, vendor: permanentResult.vendor || null, attempts };
  }

  // No strategy got a clean read, and none was flagged permanent — still a
  // real failure, just not a provably permanent one. The Scheduler's own
  // job-level retry may choose to try the whole job again later, after
  // backoff.
  const last = attempts[attempts.length - 1];
  return { ok: false, permanent: false, classification: last.id, vendor: last.vendor || null, attempts };
}
