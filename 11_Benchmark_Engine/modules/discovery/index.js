/**
 * Discovery Agent — entry point.
 * Given only a URL, understand an unknown travel website: observe it, take at
 * most two narrowly-scoped safe actions to see past common obstacles (dismiss
 * a cookie banner, expand a collapsed nav menu), then decide what it found and
 * what should happen next. Never benchmarks, never transacts. See README.md.
 */

import { createRequire } from 'module';
import { chromium } from 'playwright';
import { extractRawSignals } from './signals.js';
import { dismissConsentBanner, expandNavigationMenu } from './actions.js';
import { logInfo, logError } from '../../../shared/logger.mjs';
import { launchBrowser } from '../browserLauncher.js';
import {
  classifyWebsite,
  detectAiFeatures,
  detectSearchCapability,
  detectAccountCapability,
  detectLanguageSelector,
  detectDeviceIndicators,
  buildConsentStatus,
  detectObstacles,
  buildSuggestedJourney,
  buildPrimaryUserGoals,
  buildVisibleEntryPoints,
  computeOverallConfidence,
  decideSafeNextAction,
} from './interpret.js';

// Logged exactly once: this module (and therefore this top-level code) is
// evaluated a single time, the first time anything in the process imports
// it — which happens at server startup via the static import chain
// (server.js -> benchmarkService.js -> 13_Orchestrator -> ProviderRegistry
// -> PlaywrightNavigationProvider -> here), before any request is served.
try {
  const require = createRequire(import.meta.url);
  const { version: playwrightVersion } = require('playwright/package.json');
  logInfo('Startup diagnostics', {
    nodeVersion: process.version,
    playwrightVersion,
    chromiumExecutablePath: chromium.executablePath(),
    pid: process.pid,
  });
} catch (err) {
  logError('Startup diagnostics failed', err);
}

// Navigation readiness bounds (see runDiscovery): the response must commit
// within NAV_COMMIT_TIMEOUT_MS; DOMContentLoaded is awaited best-effort for
// at most DOM_READY_TIMEOUT_MS.
export const NAV_COMMIT_TIMEOUT_MS = 60000;
export const DOM_READY_TIMEOUT_MS = 30000;

/**
 * runDiscovery — accepts { url, companySlug?, companyName?, light? }, returns a
 * DiscoveryReport matching contracts/discovery.schema.json.
 *
 * light (Feature Benchmark runs): keeps commit navigation, the bounded
 * DOMContentLoaded readiness and signal extraction (the caller still
 * validates the resolved domain), but skips the extra network-idle wait, the
 * consent click, the menu expansion and the re-extraction — the Feature
 * pipeline never uses what those add.
 */
export async function runDiscovery({ url, companySlug = null, companyName = null, light = false }) {
  const startedAt = Date.now();
  let browser;
  let session;

  try {
    logInfo('Discovery: launching Chromium');
    session = await launchBrowser('Discovery');
    browser = session.browser;
    logInfo('Discovery: browser created');
    browser.on('disconnected', () => logInfo('Discovery: browser disconnected'));

    const page = await browser.newPage(session.pageOptions);
    logInfo('Discovery: page created (default context)');
    page.on('close', () => logInfo('Discovery: page closed'));

    logInfo('Discovery: navigating', { url });
    // Resilient readiness: navigation only has to COMMIT (a response was
    // received and the new document started). A real navigation failure (DNS,
    // refused, TLS, net::ERR_*, no response within NAV_COMMIT_TIMEOUT_MS)
    // still rejects goto() and fails discovery. DOMContentLoaded is then a
    // bounded best-effort wait, not a hard gate: some sites keep the
    // document "loading" long after a usable page has rendered. If it never
    // arrives, discovery continues only when the committed document already
    // has a <body>; otherwise it fails as before.
    const response = await page.goto(url, { waitUntil: 'commit', timeout: NAV_COMMIT_TIMEOUT_MS });
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: DOM_READY_TIMEOUT_MS });
    } catch {
      const hasBody = await page.evaluate(() => !!document.body).catch(() => false);
      if (!hasBody) {
        throw new Error(
          `Discovery: ${url} responded (HTTP ${response ? response.status() : 'n/a'}) but no document body was available ` +
          `after ${DOM_READY_TIMEOUT_MS}ms — page unavailable.`,
        );
      }
      logInfo('Discovery: DOMContentLoaded not reached within the bounded wait — continuing with the committed document', {
        url, status: response ? response.status() : null, waitedMs: DOM_READY_TIMEOUT_MS,
      });
    }
    if (!light) {
      try {
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      } catch {
        // Some pages never go fully idle (analytics/websockets) — observe whatever rendered.
      }
    }

    const meta = { requestedUrl: url, finalUrl: page.url(), status: response ? response.status() : null };

    let raw = await extractRawSignals(page);
    const actionsTaken = [];

    // ── Decide + act: at most one consent dismissal, at most one menu expand ──
    if (!light) {
      const consentAction = await dismissConsentBanner(page, raw.consentCandidate);
      if (consentAction) {
        actionsTaken.push(consentAction);
        await page.waitForTimeout(400);
      }

      const navAction = await expandNavigationMenu(page, raw.navToggleCandidate, raw.navLinks.length);
      if (navAction) {
        actionsTaken.push(navAction);
        await page.waitForTimeout(400);
      }

      if (actionsTaken.length) {
        raw = await extractRawSignals(page); // re-observe — dismissing/expanding changes what's visible
      }
    }

    // ── Everything from here on is pure computation over `raw`/`meta` — no
    // further page/browser access. Close Chromium now instead of waiting for
    // the function to return, so its memory is released before, not after,
    // this stage's own interpretation work (Render Free 512MB optimization;
    // does not change what's computed or returned). The finally block below
    // becomes a no-op safety net (browser is already null) for this path.
    if (browser) {
      logInfo('Discovery: closing browser (page work complete)');
      await session.close();
      logInfo('Discovery: browser closed');
      browser = null;
      session = null;
    }

    // ── Interpret the (possibly refreshed) observation into the report ───────
    const classification = classifyWebsite(raw);
    const aiFeatures = detectAiFeatures(raw);
    const searchCapability = detectSearchCapability(raw);
    const accountCapability = detectAccountCapability(raw);
    const languageSelector = detectLanguageSelector(raw);
    const deviceIndicators = detectDeviceIndicators(raw);
    const consentStatus = buildConsentStatus(raw, actionsTaken);
    const obstacles = detectObstacles(raw, meta, consentStatus);
    const suggestedJourney = buildSuggestedJourney(raw);
    const primaryUserGoals = buildPrimaryUserGoals(suggestedJourney, raw);
    const visibleEntryPoints = buildVisibleEntryPoints(raw, aiFeatures, searchCapability, accountCapability);
    const confidence = computeOverallConfidence(raw, suggestedJourney, obstacles);
    const safeNextAction = decideSafeNextAction({ aiFeatures, suggestedJourney, obstacles, consentStatus });

    return {
      schema_version: '0.2.0',
      company_slug: companySlug,
      company_name: companyName,
      requested_url: meta.requestedUrl,
      resolved_url: meta.finalUrl,
      http_status: meta.status,
      website_type: classification.website_type,
      confidence,
      navigation: raw.navLinks,
      footer_links: raw.footerLinks || [],   // additive: used for Feature-run entry-point hints
      primary_user_goals: primaryUserGoals,
      detected_ai_capabilities: aiFeatures,
      visible_entry_points: visibleEntryPoints,
      search_capability: searchCapability,
      account_capability: accountCapability,
      language_selector: languageSelector,
      device_indicators: deviceIndicators,
      consent_status: consentStatus,
      obstacles,
      suggested_benchmark_journey: suggestedJourney,
      safe_next_action: safeNextAction,
      actions_taken: actionsTaken,
      discovered_at: new Date().toISOString(),
      execution_time_ms: Date.now() - startedAt,
    };
  } catch (err) {
    logError('Discovery: runDiscovery threw', err);
    throw err; // rethrow unchanged — same error, same behavior
  } finally {
    if (browser) {
      logInfo('Discovery: closing browser');
      await session.close();
      logInfo('Discovery: browser closed');
    }
  }
}
