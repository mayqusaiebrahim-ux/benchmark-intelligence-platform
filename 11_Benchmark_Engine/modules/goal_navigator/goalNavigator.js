/**
 * goal_navigator/goalNavigator — the goal-driven safe navigation loop
 * (spec §1, §7). Given the current page (via an injected `adapter`), a target
 * feature detector, and a synthetic TestProfile, it repeatedly:
 *
 *   A. observes the current page
 *   B. checks whether the TARGET feature detector fires  → stop, target reached
 *   C. picks the safest next action (fill → skip extras → select → continue)
 *   D. classifies that action; a non-SAFE_* class stops the loop honestly
 *   E. performs it with synthetic data only
 *   F. recovers from bounded validation errors
 *   G. repeats until target / safety boundary / blocker / step+time budget
 *
 * The loop NEVER: submits payment, authenticates, adds a paid ancillary, or
 * types anything outside syntheticData.js. Reaching the payment PAGE is
 * allowed for feature="Payment"; the loop stops there without paying.
 *
 * The `adapter` is deliberately abstract so this is fully unit-testable with a
 * fake page. The Playwright implementation is playwrightAdapter.js.
 *
 *   adapter.observe()                      → observation (see featureDetectors)
 *   adapter.fill(descriptor, value, method)→ { ok, error? }
 *   adapter.click(nameOrDescriptor)        → { ok, error?, navigated? }
 *   adapter.selectOption(descriptor, value)→ { ok, error? }
 *   adapter.waitForSettle()                → Promise<void>
 *   adapter.validationErrors?()            → string[]   (optional)
 */
import { detectFeature, scanAllDetectors } from './featureDetectors.js';
import { classifyAction } from './actionSafety.js';
import { planAutofill, resolveFieldSemantic } from './formAutofill.js';
import { chooseOptionalControl } from './optionalStepHandler.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxActions: 25,
  // Comfortably below the Browserbase session budget so the Navigation Runner
  // still has a live page to screenshot after we stop.
  maxMs: 3 * 60 * 1000,
  // When less than this remains, stop NOW (honestly) so the deepest page can
  // be captured before the session/page dies.
  evidenceReserveMs: 20 * 1000,
  maxRetriesPerAction: 2,
  maxStallLoops: 3,
});

const TARGET_STATUS = {
  REACHED: 'target_reached',
  SAFETY: 'safety_boundary',
  AUTH: 'blocked_auth_or_booking_reference',
  BLOCKER: 'unrecoverable_blocker',
  MAX_STEPS: 'max_steps_exceeded',
  MAX_TIME: 'max_time_exceeded',
};
export { TARGET_STATUS };

const noopLogger = { info() {}, warn() {} };

function obsSignature(o = {}) {
  return [
    o.url || '',
    (o.headings || []).join('|'),
    (o.fields || []).map((f) => f.semantic || f.label || '').sort().join(','),
    (o.buttons || []).slice().sort().join(','),
  ].join('§');
}

/**
 * decideNextAction — pure. Given an observation, what is the single safest
 * next thing to do? Returns one of:
 *   { type: 'fill',   items: [{descriptor, value, method, semantic}] }
 *   { type: 'skip',   name }
 *   { type: 'select', name }
 *   { type: 'continue', name }
 *   { type: 'auth',   reason }              (a blocked auth field is in the way)
 *   { type: 'transaction', reason }         (only card fields / pay control remain)
 *   { type: 'none',   reason }              (nothing safe to do)
 * `filledSignatures` is a Set of "already filled this exact field set" markers
 * so we don't re-fill the same form forever.
 */
const HEADER_CONTEXTS = new Set(['header', 'nav', 'footer']);

/** Pick the best control for a name-pattern, biased by container context. */
function pickControl(controls, predicate, { prefer = [], avoid = [] } = {}) {
  const cands = (controls || []).filter((c) => c && !c.disabled && predicate(c.name || ''));
  if (!cands.length) return null;
  const score = (c) => {
    let s = 0;
    if (prefer.includes(c.context)) s += 10;
    if (c.context === 'booking') s += 6;
    if (c.context === 'form') s += 2;
    if (avoid.includes(c.context) || HEADER_CONTEXTS.has(c.context)) s -= 10;
    return s;
  };
  cands.sort((a, b) => score(b) - score(a));
  // If the best candidate is a header/nav/footer control AND a non-header one
  // exists, take the non-header one.
  const nonHeader = cands.find((c) => !HEADER_CONTEXTS.has(c.context));
  const best = (HEADER_CONTEXTS.has(cands[0].context) && nonHeader) ? nonHeader : cands[0];
  return { name: best.name, context: best.context };
}

export function decideNextAction(observation, { profile, filledKey, alreadyFilled }) {
  const o = observation || {};
  const fields = (o.fields || []).map((f) => ({ ...f, semantic: f.semantic || resolveFieldSemantic(f) }));
  // controls[] carries container context; fall back to bare names.
  const controls = (o.controls && o.controls.length)
    ? o.controls
    : (o.buttons || []).map((n) => ({ name: n, context: 'other', disabled: false }));
  // On a search page (origin/destination controls present) the forward CTA
  // must come from the booking widget, never the header / global search.
  const detectedSearch = fields.some((f) => f.semantic === 'origin' || f.semantic === 'destination');

  const plan = planAutofill(fields, profile);

  // A blocked auth field that is actually on this page = hard stop.
  const authBlock = plan.blocked.find((b) => /^(password|booking_reference|member_id)$/.test(b.semantic));
  if (authBlock) return { type: 'auth', reason: authBlock.reason, semantic: authBlock.semantic };

  const cardBlock = plan.blocked.find((b) => /^card_/.test(b.semantic));

  // 1 — fields to fill that we haven't filled yet. Defensive de-dup: at most
  //     ONE fill per semantic per cycle (the observation should already give
  //     one control per trip semantic, but never trust that).
  if (plan.fills.length && !alreadyFilled.has(filledKey)) {
    const bySemantic = new Map();
    for (const item of plan.fills) if (!bySemantic.has(item.semantic)) bySemantic.set(item.semantic, item);
    return { type: 'fill', items: [...bySemantic.values()] };
  }

  // 2 — optional-extras interstitial: prefer skip / plain continue.
  const optional = chooseOptionalControl((controls).map((c) => c.name));
  if (optional) return { type: optional.action === 'skip' ? 'skip' : 'continue', name: optional.name };

  // 3 — a selection control (choose flight / fare / seat).
  const sel = pickControl(controls, (n) => classifyAction({ kind: 'click', name: n }).classification === 'SAFE_SELECTION', { prefer: ['booking', 'form'] });
  if (sel) return { type: 'select', name: sel.name, context: sel.context };

  // 4 — a plain forward / search-submit control. On a search page the CTA MUST
  //     come from the booking-widget context, never the header/nav search.
  const cont = pickControl(
    controls,
    (n) => classifyAction({ kind: 'click', name: n }).classification === 'SAFE_NAVIGATION' && n.trim().toLowerCase() !== 'observe',
    detectedSearch ? { prefer: ['booking', 'form'], avoid: ['header', 'nav', 'footer'] } : {},
  );
  if (cont) return { type: 'continue', name: cont.name, context: cont.context };

  // 5 — only card fields / a pay button remain → payment boundary.
  if (cardBlock || controls.some((c) => classifyAction({ kind: 'click', name: c.name }).classification === 'IRREVERSIBLE_TRANSACTION')) {
    return { type: 'transaction', reason: 'only payment controls remain on this page' };
  }

  return { type: 'none', reason: 'no known-safe action is available on this page' };
}

/**
 * runGoalNavigation — the loop. Returns a plain result object; never throws
 * (adapter errors are caught and turn into an 'unrecoverable_blocker').
 */
export async function runGoalNavigation({
  adapter,
  detectorKey,
  feature,
  profile,
  limits = {},
  logger = noopLogger,
} = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const startedAt = Date.now();
  const interactionsPerformed = [];
  const classificationsSeen = new Set();
  const alreadyFilled = new Set();
  let actionsTaken = 0;
  let stallLoops = 0;
  let lastSignature = null;
  let lastDecisionSig = null;
  let deepest = { url: null, headings: [] };
  let retriesThisAction = 0;
  // Set right after an action; the NEXT observation flushes it as a
  // goal_nav_action_result (so urlAfter / meaningfulDomChanged are real).
  let pendingAction = null;

  const log = (event, fields) => { try { logger.info?.(event, fields); } catch { /* logging must never break navigation */ } };

  const flushPendingAction = (obsAfter) => {
    if (!pendingAction) return;
    const sigAfter = obsAfter ? obsSignature(obsAfter) : null;
    log('goal_nav_action_result', {
      targetFeature: feature,
      actionType: pendingAction.actionType,
      controlLabel: pendingAction.controlLabel || null,
      success: pendingAction.success,
      urlBefore: pendingAction.urlBefore || null,
      urlAfter: obsAfter ? (obsAfter.url || null) : null,
      meaningfulDomChanged: sigAfter != null ? sigAfter !== pendingAction.sigBefore : null,
      validationErrors: pendingAction.validationErrors || [],
    });
    pendingAction = null;
  };

  const finish = (targetStatus, extra = {}) => {
    flushPendingAction(null);
    const reached = targetStatus === TARGET_STATUS.REACHED;
    log('goal_nav_stop', {
      targetFeature: feature,
      status: targetStatus,
      blocker: extra.blocker || null,
      deepestPage: deepest.url,
      actionsCompleted: actionsTaken,
    });
    return {
      targetStatus,
      targetReached: reached,
      feature: feature || null,
      detectorKey: detectorKey || null,
      deepestUrl: deepest.url,
      deepestHeadings: deepest.headings,
      actionsTaken,
      elapsedMs: Date.now() - startedAt,
      interactionsPerformed,
      classificationsSeen: [...classificationsSeen],
      blocker: extra.blocker || null,
      detector: extra.detector || null,
    };
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = L.maxMs - elapsedMs;
      log('goal_nav_budget', { elapsedMs, remainingMs, actionNumber: actionsTaken });

      if (actionsTaken >= L.maxActions) return finish(TARGET_STATUS.MAX_STEPS, { blocker: `hit the ${L.maxActions}-action ceiling before reaching "${feature}"` });
      if (remainingMs <= 0) return finish(TARGET_STATUS.MAX_TIME, { blocker: `hit the ${Math.round(L.maxMs / 1000)}s time budget before reaching "${feature}"` });

      let obs;
      try {
        obs = await adapter.observe();
      } catch (err) {
        return finish(TARGET_STATUS.BLOCKER, { blocker: `could not read the page: ${err.message}` });
      }
      // Resolve field semantics ONCE so both the detectors and the planner
      // see them (the adapter may hand back raw label/name/placeholder only).
      if (obs && Array.isArray(obs.fields)) {
        obs.fields = obs.fields.map((f) => (f.semantic ? f : { ...f, semantic: resolveFieldSemantic(f) }));
      }
      if (obs && obs.url) deepest = { url: obs.url, headings: obs.headings || [] };

      flushPendingAction(obs);

      // Budget guard — AFTER one observation so `deepest` is captured, so the
      // Navigation Runner still has a live page + a known deepest URL to
      // screenshot before the Browserbase session/page is torn down.
      if (L.maxMs - (Date.now() - startedAt) <= L.evidenceReserveMs) {
        return finish(TARGET_STATUS.MAX_TIME, { blocker: `stopped with ~${Math.round((L.maxMs - (Date.now() - startedAt)) / 1000)}s of session budget left so the deepest page reached could be captured before teardown; "${feature}" was not reached` });
      }

      // B — target detector.
      const det = detectFeature(detectorKey, obs, { minConfidence: 'medium' });
      const pageStates = scanAllDetectors(obs).map((h) => h.key);
      log('goal_nav_observation', {
        targetFeature: feature,
        currentUrl: obs.url || null,
        actionNumber: actionsTaken,
        detectedPageState: pageStates.length ? pageStates.join(',') : 'unknown',
        targetConfidence: det.confidence,
        visibleRequiredFields: (obs.fields || []).map((f) => f.semantic).filter(Boolean),
      });

      if (det.reached) {
        interactionsPerformed.push(`Detected "${feature}" (${det.confidence}: ${det.signals.join('; ')})`);
        classificationsSeen.add('TARGET_REACHED');
        return finish(TARGET_STATUS.REACHED, { detector: { key: det.detectorKey, confidence: det.confidence, signals: det.signals } });
      }

      const sig = obsSignature(obs);
      const samePage = sig === lastSignature;
      lastSignature = sig;

      // C — decide.
      const filledKey = (obs.fields || []).map((f) => f.semantic || f.label).sort().join(',');
      const decision = decideNextAction(obs, { profile, filledKey, alreadyFilled });

      // stall guard — trip only when we would repeat the SAME action on a page
      // that never changed, and we're not mid validation-recovery.
      const decisionSig = `${decision.type}:${decision.name || (decision.items || []).map((i) => i.semantic).join('+')}`;
      if (samePage && decisionSig === lastDecisionSig && retriesThisAction === 0) {
        stallLoops++;
        if (stallLoops >= L.maxStallLoops) {
          const others = scanAllDetectors(obs).filter((h) => h.key !== detectorKey);
          const overshoot = others.length ? ` (page instead shows: ${others.map((h) => h.key).join(', ')})` : '';
          return finish(TARGET_STATUS.BLOCKER, { blocker: `the page stopped changing after ${actionsTaken} action(s); "${feature}" was not reached${overshoot}` });
        }
      } else {
        stallLoops = 0;
      }
      lastDecisionSig = decisionSig;

      log('goal_nav_decision', {
        targetFeature: feature,
        actionType: decision.type,
        semantic: decision.type === 'fill'
          ? (decision.items || []).map((i) => i.semantic).join(',')
          : (decision.semantic || null),
        controlLabel: decision.name || null,
        safetyClass: decision.type === 'fill'
          ? 'SAFE_FORM_FILL'
          : (decision.type === 'auth' ? 'AUTH_REQUIRED'
            : decision.type === 'transaction' ? 'IRREVERSIBLE_TRANSACTION'
              : classifyAction({ kind: 'click', name: decision.name }).classification),
      });

      if (decision.type === 'auth') {
        classificationsSeen.add('AUTH_REQUIRED');
        return finish(TARGET_STATUS.AUTH, { blocker: `"${feature}" is gated by ${decision.semantic.replace(/_/g, ' ')} — no test credentials/booking reference are configured` });
      }
      if (decision.type === 'transaction') {
        classificationsSeen.add('IRREVERSIBLE_TRANSACTION');
        // Reaching the payment page IS the goal when feature is Payment — but
        // then the detector above would have fired. Getting here means the
        // detector didn't match yet only card controls remain: treat as the
        // safety boundary, capture where we are.
        return finish(TARGET_STATUS.SAFETY, { blocker: `stopped at the payment boundary before any transaction — ${decision.reason}` });
      }
      if (decision.type === 'none') {
        // Maybe a LATER feature is on screen (we overshot) — still honest.
        const others = scanAllDetectors(obs).filter((h) => h.key !== detectorKey);
        const overshoot = others.length ? ` (page instead shows: ${others.map((h) => h.key).join(', ')})` : '';
        return finish(TARGET_STATUS.BLOCKER, { blocker: `no known-safe next action toward "${feature}"${overshoot}` });
      }

      // D — classify + perform.
      let performed = false;

      if (decision.type === 'fill') {
        for (const item of decision.items) {
          const cls = classifyAction({ kind: item.method === 'combobox' || item.method === 'date' ? 'fill' : 'fill', name: item.descriptor.label, fieldSemantic: item.semantic });
          classificationsSeen.add(cls.classification);
          if (!cls.allowed) continue; // blocked semantics were already filtered, belt-and-braces
          try {
            const r = item.method === 'combobox'
              ? await adapter.selectOption(item.descriptor, item.value)
              : await adapter.fill(item.descriptor, item.value, item.method);
            if (r && r.ok) {
              performed = true;
              interactionsPerformed.push(`Filled ${item.semantic.replace(/_/g, ' ')}${r.selectionConfirmed === false ? ' (unconfirmed)' : ''}`);
            }
          } catch { /* individual field failure is non-fatal */ }
        }
        alreadyFilled.add(filledKey);
        actionsTaken++;
      } else {
        const cls = classifyAction({ kind: decision.type === 'select' ? 'click' : 'click', name: decision.name });
        classificationsSeen.add(cls.classification);
        if (!cls.allowed) {
          if (cls.classification === 'IRREVERSIBLE_TRANSACTION') return finish(TARGET_STATUS.SAFETY, { blocker: cls.reason });
          if (cls.classification === 'AUTH_REQUIRED') return finish(TARGET_STATUS.AUTH, { blocker: cls.reason });
          return finish(TARGET_STATUS.BLOCKER, { blocker: `next control "${decision.name}" is ${cls.classification}: ${cls.reason}` });
        }
        // On a search page, force the forward CTA to come from the booking
        // widget — never the header / global-search control.
        const clickOpts = (decision.type === 'continue' || decision.type === 'select')
          ? { preferContext: ['booking', 'form'], avoidContext: ['header', 'nav', 'footer'] }
          : {};
        try {
          const r = await adapter.click(decision.name, clickOpts);
          performed = !!(r && r.ok);
          if (performed) interactionsPerformed.push(`${decision.type === 'skip' ? 'Skipped optional step via' : decision.type === 'select' ? 'Selected' : 'Clicked'} "${decision.name}"${r.pickedContext && r.pickedContext !== 'other' ? ` [${r.pickedContext}]` : ''}`);
          else logger.warn?.('goal_nav_click_failed', { name: decision.name, error: r && r.error });
        } catch (err) {
          logger.warn?.('goal_nav_click_failed', { name: decision.name, error: err.message });
        }
        actionsTaken++;
      }

      try { await adapter.waitForSettle(); } catch { /* ignore */ }

      // F — bounded validation recovery.
      const errs = (typeof adapter.validationErrors === 'function') ? (await adapter.validationErrors().catch(() => [])) : [];

      // Stage a goal_nav_action_result — the next observation flushes it with
      // the real urlAfter / meaningfulDomChanged.
      pendingAction = {
        actionType: decision.type,
        controlLabel: decision.name || null,
        success: performed,
        urlBefore: obs.url || null,
        sigBefore: sig,
        validationErrors: errs || [],
      };

      if (errs && errs.length && retriesThisAction < L.maxRetriesPerAction) {
        retriesThisAction++;
        alreadyFilled.delete(filledKey); // allow a re-fill pass to satisfy the missing fields
        interactionsPerformed.push(`Validation error (${errs.length}) — retry ${retriesThisAction}`);
        continue;
      }
      retriesThisAction = 0;

      if (!performed) {
        stallLoops++;
        if (stallLoops >= L.maxStallLoops) {
          return finish(TARGET_STATUS.BLOCKER, { blocker: `could not perform any safe action toward "${feature}"` });
        }
      }
    }
  } catch (err) {
    return finish(TARGET_STATUS.BLOCKER, { blocker: `goal navigation error: ${err.message}` });
  }
}
