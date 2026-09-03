/**
 * Navigation Runner — action execution.
 * The only file that clicks or types anything. Mirrors Discovery's actions.js
 * safety model: every candidate target is located generically by accessible
 * name/role (never a hardcoded selector) and re-checked against a
 * transactional denylist immediately before interaction.
 *
 * Never submits real personal data, never authenticates, never completes a
 * payment or checkout — those are structurally impossible here because no
 * interaction hint below targets them, and the denylist blocks them even if
 * a step's keyword set accidentally brushes up against one.
 */

import { logInfo, logError } from '../../../shared/logger.mjs';
import { runGoalNavigation, TARGET_STATUS } from '../goal_navigator/goalNavigator.js';
import { playwrightAdapter } from '../goal_navigator/playwrightAdapter.js';
import { buildTestProfile } from '../goal_navigator/syntheticData.js';
import { runAutonomousNavigation, agentModeAvailable, AgentNavUnavailableError } from '../autonomous_navigator/autonomousNavigator.js';

// NAVIGATION_MODE: 'agent' (default — autonomous browser agent) or 'heuristic'
// (the legacy GoalNavigator). Agent mode falls back to heuristic automatically
// when credentials are absent or the agent run throws before producing a
// classified result. Not exposed in the dashboard.
function navigationMode() {
  const m = (process.env.NAVIGATION_MODE || 'agent').trim().toLowerCase();
  return m === 'heuristic' ? 'heuristic' : 'agent';
}

// ─── Cookie / consent overlay handling ─────────────────────────────────────
// Consent dialogs (OneTrust, Cookiebot, generic GDPR banners) frequently
// intercept pointer events, so a target that Playwright reports as "visible,
// enabled and stable" still can't be clicked. This is generic, best-effort,
// short-timeout, and never throws — a page with no banner passes straight
// through unchanged. `force:true` is deliberately NOT used: the goal is to
// dismiss the blocking UI correctly.

// Visible-container hints — if none is present/visible we do nothing at all.
const CONSENT_CONTAINER_SELECTORS = [
  '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
  '[id*="onetrust" i]', '[class*="onetrust" i]',
  '#CybotCookiebotDialog', '[id*="CybotCookiebot" i]',
  '[id*="cookie-consent" i]', '[class*="cookie-consent" i]',
  '[class*="cookie-banner" i]', '[id*="cookie-banner" i]',
  '[class*="cookie-notice" i]', '[class*="cookie-policy" i]',
  '[class*="gdpr" i]', '[id*="gdpr" i]',
  '[class*="consent" i]', '[id*="consent" i]',
  '[aria-label*="cookie" i]', '[data-testid*="cookie" i]',
  '[role="dialog"][aria-label*="consent" i]', '[role="alertdialog"]',
];

// Well-known accept controls, tried first (fast path).
const KNOWN_ACCEPT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',
  '.onetrust-close-btn-handler',
  '.save-preference-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '#CybotCookiebotDialogBodyButtonAcceptAll',
  'button[data-testid="uc-accept-all-button"]',
  '#didomi-notice-agree-button',
  '.fc-cta-consent',
];

// Accessible-name match for an "accept" action — English + common Arabic.
const ACCEPT_NAME_RE = new RegExp(
  '^\\s*(?:' +
  'accept all|accept all cookies|accept cookies|accept|allow all|allow all cookies|allow cookies|' +
  'agree|i agree|agree and close|agree to all|got it|understood|ok|okay|continue|yes,? i agree|' +
  'أوافق|موافق|قبول|قبول الكل|أقبل|السماح بالكل|أوافق على الكل|قبول جميع الكوكيز' +
  ')\\s*$', 'i'
);
// Never treat these as "accept" even if they brush the regex.
const REJECT_NAME_RE = /(reject|decline|manage|preferences|settings|customi[sz]e|options|more info|learn more|necessary only|essential only|رفض|إدارة|تخصيص)/i;

async function clickIfVisible(locator, timeout = 2500) {
  try {
    if (!(await locator.first().isVisible({ timeout: 400 }).catch(() => false))) return false;
    await locator.first().click({ timeout });   // real click — no force
    return true;
  } catch {
    return false;
  }
}

/**
 * dismissConsentOverlay — best-effort. Returns
 * `{ handled: boolean, method: string|null, detail?: string }`. Never throws.
 */
export async function dismissConsentOverlay(page) {
  // 0 — is there even a consent surface visible? If not, do nothing.
  let hasBanner = false;
  for (const sel of CONSENT_CONTAINER_SELECTORS) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 250 }).catch(() => false)) {
        hasBanner = true;
        break;
      }
    } catch { /* selector engine hiccup — ignore */ }
  }
  if (!hasBanner) return { handled: false, method: null, detail: 'no consent overlay visible' };

  // 1 — known one-click accept controls.
  for (const sel of KNOWN_ACCEPT_SELECTORS) {
    if (await clickIfVisible(page.locator(sel))) {
      await page.waitForTimeout(400);
      return { handled: true, method: 'known-selector', detail: sel };
    }
  }

  // 2 — generic: any visible button/link whose accessible name is an
  //     "accept" action (and is not a reject/manage control).
  try {
    const controls = await page.locator('button, [role="button"], a, input[type="button"], input[type="submit"]').all();
    for (const el of controls) {
      let name;
      try {
        name = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || '').trim();
      } catch { continue; }
      if (!name || name.length > 40) continue;
      if (REJECT_NAME_RE.test(name)) continue;
      if (!ACCEPT_NAME_RE.test(name)) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      try {
        await el.click({ timeout: 2500 });   // real click — no force
        await page.waitForTimeout(400);
        return { handled: true, method: 'accessible-name', detail: name };
      } catch { /* try the next candidate */ }
    }
  } catch { /* fall through */ }

  return { handled: false, method: null, detail: 'consent overlay present but no accept control could be clicked' };
}

const TRANSACTIONAL_DENYLIST = new RegExp(
  [
    'pay(\\s|$)', 'checkout', 'purchase', 'buy now', 'place order',
    'confirm( and)? (pay|book|purchase)', 'complete (booking|purchase|payment)',
    'sign\\s*in', 'log\\s*in', 'register', 'create account',
    'delete', 'cancel subscription', 'passenger details', 'add card', 'save card',
  ].join('|'),
  'i'
);

// A harmless, generic destination string — never real personal data.
const SAFE_SEARCH_QUERY = 'Paris';

// One interaction hint per canonical journey step. `kind: 'click'` looks for
// a matching button/link; `kind: 'search'` types into a matching input and
// submits; `kind: 'observe'` takes no action at all (the page as loaded IS
// the evidence). Steps with no safe, well-defined interaction (login,
// payment completion) simply have no hint and are never attempted.
//
// step_01_entry (added for feature-scoped navigation — see
// 13_Orchestrator/featureNavigation/featureIntent.js): the homepage itself
// is the thing being benchmarked, so `observe` just re-baselines to
// starting_url and lets capture.js screenshot it. This does NOT change
// Complete Journey behaviour: journey_mapper/planner.js's buildJourneyPlan()
// explicitly excludes step_01_entry, so the full journey never reaches here.
const STEP_INTERACTION_HINTS = {
  step_01_entry: { kind: 'observe' },
  step_02_discovery: { kind: 'click', keywords: ['discover', 'explore', 'inspiration', 'destinations', 'things to do', 'guide'] },
  step_03_search: { kind: 'search', keywords: ['search', 'destination', 'where to', 'flights', 'hotels'], submitKeywords: ['search', 'find', 'go'] },
  step_04_ai_interaction: { kind: 'click', keywords: ['ai', 'assistant', 'chat', 'planner', 'ask ai', 'genie', 'copilot', 'concierge', 'start a chat', 'start chatting'] },
  step_05_recommendations: { kind: 'click', keywords: ['recommended', 'for you', 'personalized', 'trending', 'top picks', 'plan my trip'] },
  step_06_maps: { kind: 'click', keywords: ['map', 'nearby', 'explore map'] },
  step_07_booking: { kind: 'click', keywords: ['book', 'booking', 'reserve'] },
  step_08_ancillaries: { kind: 'click', keywords: ['extras', 'add-ons', 'baggage', 'seat selection', 'upgrade'] },
  step_09_payment: { kind: 'click', keywords: ['payment options', 'payment methods', 'view payment'] },
  step_10_trip_management: { kind: 'click', keywords: ['my trips', 'manage booking', 'itinerary', 'my bookings'] },
  step_11_checkin: { kind: 'click', keywords: ['check-in', 'check in'] },
  step_12_loyalty: { kind: 'click', keywords: ['loyalty', 'rewards', 'miles', 'points', 'membership'] },
};

function isSafe(name) {
  return !!name && !TRANSACTIONAL_DENYLIST.test(name);
}

async function waitForSettle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    // Some pages never go fully idle — proceed with whatever rendered.
  }
}

async function findClickCandidate(page, keywords) {
  const candidates = await page.locator('a, button, [role="button"]').all();
  for (const el of candidates) {
    let name;
    try {
      name = (await el.innerText())?.trim() || (await el.getAttribute('aria-label')) || '';
    } catch {
      continue; // element detached/unreadable — skip it
    }
    if (!name || !isSafe(name)) continue;

    const lower = name.toLowerCase();
    if (keywords.some(k => lower.includes(k))) {
      const visible = await el.isVisible().catch(() => false);
      if (visible) return { locator: el, name };
    }
  }
  return null;
}

async function findSearchInput(page, keywords) {
  const inputs = await page.locator('input[type="search"], input[type="text"], input:not([type])').all();
  for (const el of inputs) {
    let name;
    try {
      name = (await el.getAttribute('placeholder')) || (await el.getAttribute('aria-label')) || (await el.getAttribute('name')) || '';
    } catch {
      continue;
    }
    if (!name) continue;

    const lower = name.toLowerCase();
    if (keywords.some(k => lower.includes(k))) {
      const visible = await el.isVisible().catch(() => false);
      if (visible) return { locator: el, name };
    }
  }
  return null;
}

async function performClickAction(page, hint) {
  const candidate = await findClickCandidate(page, hint.keywords);
  if (!candidate) {
    return { success: false, error: 'No matching, safe, visible element found for this step.', action_taken: null };
  }

  await candidate.locator.click({ timeout: 5000 });
  await waitForSettle(page);
  return { success: true, error: null, action_taken: `Clicked "${candidate.name}"` };
}

async function performSearchAction(page, hint) {
  const input = await findSearchInput(page, hint.keywords);
  if (!input) {
    return { success: false, error: 'No matching search input found.', action_taken: null };
  }

  await input.locator.fill(SAFE_SEARCH_QUERY, { timeout: 5000 });

  const submit = await findClickCandidate(page, hint.submitKeywords || ['search']);
  if (submit) {
    await submit.locator.click({ timeout: 5000 });
  } else {
    await input.locator.press('Enter');
  }

  await waitForSettle(page);
  return { success: true, error: null, action_taken: `Typed "${SAFE_SEARCH_QUERY}" into "${input.name}" and submitted` };
}

/**
 * performStepAction — the single entry point runner.js/recovery.js call.
 * Looks up this step's interaction hint and performs it. Steps with no hint
 * (e.g. anything requiring login or payment completion) fail cleanly with a
 * clear reason rather than being attempted.
 */
export async function performStepAction(page, step, ctx = {}) {
  // Clear any blocking cookie/consent overlay BEFORE the planned action. In
  // agent-only runs there is NO runner page (Stagehand owns the session) — the
  // agent dismisses consent itself, so skip this.
  const consent = page
    ? await dismissConsentOverlay(page).catch((err) => ({ handled: false, method: null, detail: `consent handler error: ${err.message}` }))
    : { handled: false, method: null, detail: 'no runner page (agent-only run) — the agent handles consent' };
  logInfo('Navigation Runner: consent overlay handling', { stepId: step.id, ...consent });

  // ── Goal-driven multi-step navigation ──────────────────────────────────
  // For transactional / deep features (Passenger Details, Fare Selection,
  // Seat Selection, Payment, ...) one click is never enough. featureIntent.js
  // flags the step goal_driven.
  //
  // PRIMARY (NAVIGATION_MODE=agent, default): an autonomous browser agent
  // (Stagehand) drives its own session and decides every action; our code
  // enforces safety, budget, synthetic data, and INDEPENDENT target
  // verification. FALLBACK (NAVIGATION_MODE=heuristic, or agent creds absent /
  // agent crash): the legacy heuristic GoalNavigator on this same page.
  if (step.goal_driven && step.detector_key) {
    const feature = step.feature_label || step.title || step.detector_key;

    if (navigationMode() === 'agent') {
      try {
        if (!agentModeAvailable()) throw new AgentNavUnavailableError('agent-mode credentials (Browserbase + LLM key) are not configured');
        const startingUrl = (() => { try { return page && page.url(); } catch { return null; } })() || ctx.startingUrl || null;
        logInfo('Navigation Runner: autonomous agent navigation starting', { stepId: step.id, detectorKey: step.detector_key, startingUrl });
        const r = await runAutonomousNavigation({
          startingUrl,
          company: ctx.company || ctx.companySlug || step.feature_label || 'company',
          feature,
          detectorKey: step.detector_key,
          profile: buildTestProfile(),
        });
        logInfo('Navigation Runner: autonomous agent navigation finished', {
          stepId: step.id, targetStatus: r.targetStatus, reached: r.targetReached,
          confidence: r.confidence, deepestUrl: r.deepestUrl, safetyBlocks: r.safetyBlocks?.length || 0,
        });
        return {
          success: !!r.targetReached,
          terminal: true,
          error: r.targetReached ? null : (r.blocker || `"${feature}" was not reached (${r.targetStatus})`),
          action_taken: `Autonomous agent (${r.targetStatus}): ${(r.interactionsPerformed || []).slice(-1)[0] || 'no actions recorded'}`,
          consent,
          goal: r,
          evidenceOverride: r.evidenceOverride || null,
        };
      } catch (err) {
        if (err instanceof AgentNavUnavailableError) {
          logInfo('Navigation Runner: agent mode unavailable — using heuristic navigator', { stepId: step.id, reason: err.message });
        } else {
          logError('Navigation Runner: agent navigation threw before a classified result — using heuristic navigator', err, { stepId: step.id });
        }
        // fall through to the heuristic navigator below
      }
    }

    logInfo('Navigation Runner: goal-driven navigation starting', { stepId: step.id, detectorKey: step.detector_key, mode: 'heuristic' });
    // The heuristic navigator needs a real page. In an agent-only run none was
    // launched — acquire one now (lazy) so the fallback still works.
    let heuristicPage = page;
    if (!heuristicPage && typeof ctx.ensureBrowser === 'function') {
      try { heuristicPage = await ctx.ensureBrowser('heuristic fallback after agent could not run'); }
      catch (e) { logError('Navigation Runner: could not launch a browser for the heuristic fallback', e, { stepId: step.id }); }
    }
    if (!heuristicPage) {
      return {
        success: false, terminal: true,
        error: `"${feature}" was not reached — agent mode could not run and no browser is available for the heuristic fallback`,
        action_taken: 'Autonomous agent unavailable; heuristic fallback had no browser',
        consent,
        goal: { targetStatus: TARGET_STATUS.BLOCKER, targetReached: false, blocker: 'agent unavailable and no fallback browser', interactionsPerformed: [], classificationsSeen: [] },
      };
    }
    let goal;
    try {
      const goalLogger = { info: (m, x) => logInfo(m, x), warn: (m, x) => logInfo(m, x) };
      goal = await runGoalNavigation({
        adapter: playwrightAdapter(heuristicPage, { logger: goalLogger }),
        detectorKey: step.detector_key,
        feature: step.feature_label || step.title || step.detector_key,
        profile: buildTestProfile(),
        logger: goalLogger,
      });
    } catch (err) {
      goal = { targetStatus: TARGET_STATUS.BLOCKER, targetReached: false, blocker: `goal navigation threw: ${err.message}`, interactionsPerformed: [], classificationsSeen: [] };
    }
    logInfo('Navigation Runner: goal-driven navigation finished', {
      stepId: step.id, targetStatus: goal.targetStatus, reached: goal.targetReached,
      actions: goal.actionsTaken, deepestUrl: goal.deepestUrl,
    });
    const summary = goal.interactionsPerformed?.length
      ? goal.interactionsPerformed.join(' → ')
      : 'no safe action was available';
    // Every goal-nav outcome is a CLASSIFIED terminal result — the navigator
    // ran its own bounded retries. `terminal:true` tells runner.js NOT to fire
    // the generic recovery retry (which would re-run the whole traversal).
    return {
      success: !!goal.targetReached,
      terminal: true,
      error: goal.targetReached ? null : (goal.blocker || `"${step.title}" was not reached (${goal.targetStatus})`),
      action_taken: `Goal navigation (${goal.targetStatus}): ${summary}`,
      consent,
      goal,
    };
  }

  const hint = STEP_INTERACTION_HINTS[step.id];
  if (!hint) {
    return { success: false, error: `No safe interaction strategy is defined for ${step.id}.`, action_taken: null, consent };
  }

  if (hint.kind === 'observe') {
    // No interaction — the page as loaded (already re-baselined to
    // starting_url by runner.js) is the evidence. Wait for it to settle so
    // the screenshot capture.js takes next is of the final rendered state.
    await waitForSettle(page);
    return { success: true, error: null, action_taken: 'Observed the page as loaded (no interaction required)', consent };
  }
  const result = hint.kind === 'search'
    ? await performSearchAction(page, hint)
    : await performClickAction(page, hint);
  return { ...result, consent };
}

/**
 * safeGoto — navigate to a known URL (used to re-baseline independent steps
 * from starting_url) and wait for the page to settle.
 */
export async function safeGoto(page, url) {
  logInfo('Navigation Runner: re-baseline navigation', { url });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await waitForSettle(page);
}
