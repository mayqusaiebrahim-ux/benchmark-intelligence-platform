/**
 * autonomous_navigator/searchPrerequisite — a bounded, deterministic
 * "fill and submit the trip search" phase that runs BEFORE the autonomous
 * agent when the page is a flight-search form and the requested target is a
 * downstream booking step (Passenger Details, Seat Selection, Ancillaries,
 * Payment).
 *
 * Why: the agent otherwise spends its LLM steps re-deciding what to click on
 * a search widget whose origin/destination/date fields are comboboxes and
 * calendars (production: 6 steps, ~156s, still on the homepage). The fields
 * here are resolved by meaning (formAutofill's planAutofill) and operated by
 * the existing goal_navigator fill/click helpers — no Qatar-specific or
 * airline-specific selectors.
 *
 * Contract:
 *  - never throws: every failure is returned as { ok: false, reason } and the
 *    caller hands the page to the agent unchanged (no failed run from this);
 *  - never submits anything but a search control (NEVER_CLICK blocks
 *    purchase / booking / sign-in wording), and never fills card, auth or
 *    booking-reference fields (planAutofill already blocks them);
 *  - bounded by its own timeout, measured separately from the agent budget;
 *  - all I/O is injected, so the decision logic is unit-testable.
 */

import { planAutofill } from '../goal_navigator/formAutofill.js';
import { scanAllDetectors } from '../goal_navigator/featureDetectors.js';

// Target detector keys that sit BEHIND a flight search.
export const DOWNSTREAM_DETECTOR_KEYS = Object.freeze(new Set(['passenger_details', 'seat_selection', 'ancillaries', 'payment']));

const TRIP_SEMANTICS = ['origin', 'destination', 'depart_date', 'passengers', 'cabin'];
const REQUIRED_SEMANTICS = ['origin', 'destination', 'depart_date'];

const SEARCH_CONTROL = /\b(search( flights?)?|find flights?|show flights?)\b/i;
const NEVER_CLICK = /\b(pay|purchase|buy|book now|checkout|check out|place order|confirm|sign ?in|log ?in|register|sign ?up|continue to pay)\b/i;

function findHit(scan, key) {
  return (scan || []).find((h) => h.key === key) || null;
}

/**
 * Should the prerequisite run for this page + target? Requires:
 *  - a downstream target detector key, and
 *  - flight_search at HIGH confidence on the current page, and
 *  - the target not already visibly present (then the agent can just look).
 */
export function isSearchPrerequisiteRequired({ detectorKey, observation }) {
  if (!DOWNSTREAM_DETECTOR_KEYS.has(detectorKey)) return false;
  const scan = scanAllDetectors(observation || {});
  const search = findHit(scan, 'flight_search');
  if (!search || search.confidence !== 'high') return false;
  const target = findHit(scan, detectorKey);
  if (target && (target.confidence === 'high' || target.confidence === 'medium')) return false;
  return true;
}

/**
 * Pick the ONE control that may be clicked to submit the search — pure, and
 * checked BEFORE any click. Returns the control name or null.
 */
export function pickSearchControl(observation) {
  const names = (observation && observation.controls || [])
    .map((c) => (typeof c === 'string' ? c : c && c.name))
    .filter((n) => typeof n === 'string' && n.trim());
  return names.find((n) => SEARCH_CONTROL.test(n) && !NEVER_CLICK.test(n)) || null;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.observe      fresh observation of the page
 * @param {(descriptor, value, method) => Promise<{ok:boolean, via?:string}>} deps.fill
 * @param {(controlName: string) => Promise<boolean>} deps.clickControl
 * @param {() => Promise<void>} deps.settle
 * @param {object} deps.profile                     synthetic TestProfile
 * @param {{info?: Function}} [deps.logger]
 * @param {number} [deps.timeoutMs]
 */
export async function runSearchPrerequisite({ observe, fill, clickControl, settle, profile, logger, timeoutMs = 45000 }) {
  const log = (event, fields) => { try { logger?.info?.(event, fields); } catch { /* logging must not break navigation */ } };
  const started = Date.now();
  const result = { attempted: true, ok: false, filled: [], skipped: [], submitted: false, urlAfter: null, pageStateAfter: null, reason: null, durationMs: 0 };

  // A timed-out run must not keep acting on the page while the agent takes over.
  let cancelled = false;
  const guard = () => { if (cancelled) throw new Error('cancelled by timeout'); };

  const work = async () => {
    const before = await observe();
    guard();
    const plan = planAutofill(before.fields || [], profile);
    const fills = plan.fills.filter((f) => TRIP_SEMANTICS.includes(f.semantic));

    for (const required of REQUIRED_SEMANTICS) {
      if (!fills.some((f) => f.semantic === required)) {
        result.reason = `required trip field not resolvable on this page: ${required}`;
        log('agent_nav_prerequisite_fallback', { reason: result.reason });
        return;
      }
    }

    for (const f of fills) {
      guard();
      const r = await fill(f.descriptor, f.value, f.method);
      if (r && r.ok) {
        result.filled.push({ semantic: f.semantic, via: r.via || null });
        log('agent_nav_prerequisite_field', { semantic: f.semantic, ok: true, via: r.via || null });
      } else if (REQUIRED_SEMANTICS.includes(f.semantic)) {
        result.reason = `required trip field not deterministically fillable: ${f.semantic}`;
        log('agent_nav_prerequisite_fallback', { reason: result.reason });
        return;
      } else {
        result.skipped.push(f.semantic);
        log('agent_nav_prerequisite_field', { semantic: f.semantic, ok: false });
      }
    }

    const control = pickSearchControl(before);
    if (!control) {
      result.reason = 'no safe search control found on this page';
      log('agent_nav_prerequisite_fallback', { reason: result.reason });
      return;
    }
    guard();
    const clicked = await clickControl(control);
    if (!clicked) {
      result.reason = 'search control could not be operated';
      log('agent_nav_prerequisite_fallback', { reason: result.reason });
      return;
    }
    result.submitted = true;
    log('agent_nav_prerequisite_submitted', { control });

    await settle();
    const after = await observe();
    result.urlAfter = after.url || null;
    const scanAfter = scanAllDetectors(after);
    result.pageStateAfter = scanAfter.filter((h) => h.confidence !== 'low').map((h) => `${h.key}:${h.confidence}`).join(', ') || 'unknown';
    const stillSearch = findHit(scanAfter, 'flight_search');
    const sameUrl = (after.url || null) === (before.url || null);
    if (stillSearch && stillSearch.confidence === 'high' && sameUrl) {
      result.reason = 'search submitted but the page did not progress';
      log('agent_nav_prerequisite_result', { ok: false, urlAfter: result.urlAfter, pageStateAfter: result.pageStateAfter, reason: result.reason });
      return;
    }
    result.ok = true;
    log('agent_nav_prerequisite_result', { ok: true, urlAfter: result.urlAfter, pageStateAfter: result.pageStateAfter });
  };

  try {
    await withTimeout(work(), timeoutMs);
  } catch (err) {
    cancelled = true;
    result.ok = false;
    result.reason = `prerequisite error: ${String(err && err.message || err).slice(0, 160)}`;
    log('agent_nav_prerequisite_fallback', { reason: result.reason });
  }
  result.durationMs = Date.now() - started;
  return result;
}
