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

// Render Free (512MB) memory optimization: reduces Chromium's own process
// footprint without changing any observable page behavior. --disable-gpu
// removes an otherwise-spawned GPU process that headless mode never uses;
// --disable-dev-shm-usage avoids Chromium relying on the small /dev/shm
// tmpfs typical of containers (a common source of memory-pressure crashes
// in exactly this kind of environment); --disable-breakpad turns off
// Chromium's own crash-reporter subsystem, unused here. Deliberately not
// using --single-process — Playwright/Chromium's own guidance treats it as
// unstable, which would trade a memory problem for a reliability one.
const MEMORY_OPTIMIZED_LAUNCH_ARGS = ['--disable-gpu', '--disable-dev-shm-usage', '--disable-breakpad'];

/**
 * runDiscovery — accepts { url, companySlug?, companyName? }, returns a DiscoveryReport
 * matching contracts/discovery.schema.json.
 */
export async function runDiscovery({ url, companySlug = null, companyName = null }) {
  const startedAt = Date.now();
  let browser;

  try {
    logInfo('Discovery: launching Chromium', { executablePath: chromium.executablePath() });
    browser = await chromium.launch({ args: MEMORY_OPTIMIZED_LAUNCH_ARGS });
    logInfo('Discovery: browser created');
    browser.on('disconnected', () => logInfo('Discovery: browser disconnected'));

    const page = await browser.newPage();
    logInfo('Discovery: page created (default context)');
    page.on('close', () => logInfo('Discovery: page closed'));

    logInfo('Discovery: navigating', { url });
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      // Some pages never go fully idle (analytics/websockets) — observe whatever rendered.
    }

    const meta = { requestedUrl: url, finalUrl: page.url(), status: response ? response.status() : null };

    let raw = await extractRawSignals(page);
    const actionsTaken = [];

    // ── Decide + act: at most one consent dismissal, at most one menu expand ──
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

    // ── Everything from here on is pure computation over `raw`/`meta` — no
    // further page/browser access. Close Chromium now instead of waiting for
    // the function to return, so its memory is released before, not after,
    // this stage's own interpretation work (Render Free 512MB optimization;
    // does not change what's computed or returned). The finally block below
    // becomes a no-op safety net (browser is already null) for this path.
    if (browser) {
      logInfo('Discovery: closing browser (page work complete)');
      await browser.close();
      logInfo('Discovery: browser closed');
      browser = null;
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
      await browser.close();
      logInfo('Discovery: browser closed');
    }
  }
}
