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

import { logInfo } from '../../../shared/logger.mjs';

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
// submits. Steps with no safe, well-defined interaction (login, payment
// completion) simply have no hint and are never attempted.
const STEP_INTERACTION_HINTS = {
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
export async function performStepAction(page, step) {
  const hint = STEP_INTERACTION_HINTS[step.id];
  if (!hint) {
    return { success: false, error: `No safe interaction strategy is defined for ${step.id}.`, action_taken: null };
  }
  if (hint.kind === 'search') {
    return performSearchAction(page, hint);
  }
  return performClickAction(page, hint);
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
