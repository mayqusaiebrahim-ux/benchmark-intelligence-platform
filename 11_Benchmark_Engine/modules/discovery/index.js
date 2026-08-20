/**
 * Discovery Agent — entry point.
 * Given only a URL, understand an unknown travel website: observe it, take at
 * most two narrowly-scoped safe actions to see past common obstacles (dismiss
 * a cookie banner, expand a collapsed nav menu), then decide what it found and
 * what should happen next. Never benchmarks, never transacts. See README.md.
 */

import { chromium } from 'playwright';
import { extractRawSignals } from './signals.js';
import { dismissConsentBanner, expandNavigationMenu } from './actions.js';
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

/**
 * runDiscovery — accepts { url, companySlug?, companyName? }, returns a DiscoveryReport
 * matching contracts/discovery.schema.json.
 */
export async function runDiscovery({ url, companySlug = null, companyName = null }) {
  const startedAt = Date.now();
  let browser;

  try {
    browser = await chromium.launch();
    const page = await browser.newPage();

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
  } finally {
    if (browser) await browser.close();
  }
}
