/**
 * autonomous_navigator/targetVerifier — INDEPENDENT verification that the
 * requested experience was actually reached, for ANY feature on ANY site.
 * The agent saying "I reached X" is never trusted.
 *
 *   - known feature (goal_navigator/featureDetectors key) → detectFeature()
 *   - anything else                                       → genericVerify()
 *     (domain-free: feature-label keywords vs. headings/URL/text + page kind)
 *
 * Both operate on one buildObservation() DOM snapshot — works on the
 * Navigation Runner page AND Stagehand's understudy Page.
 */
import { buildObservation } from '../goal_navigator/playwrightAdapter.js';
import { detectFeature, scanAllDetectors, FEATURE_DETECTORS } from '../goal_navigator/featureDetectors.js';
import { genericVerify, pageStateFingerprint, pageKind } from './genericVerifier.js';

const CONF_RANK = { none: 0, low: 1, medium: 2, high: 3 };

/**
 * @param {object} page
 * @param {string|null} detectorKey   a featureDetectors key, or null/unknown
 * @param {object} [opts]  { minConfidence, featureLabel }
 */
export async function verifyTarget(page, detectorKey, { minConfidence = 'medium', featureLabel = '' } = {}) {
  let observation;
  try {
    observation = await buildObservation(page);
  } catch (err) {
    return { reached: false, confidence: 'none', confidenceRank: 0, signals: [], detectedStates: [], url: safeUrl(page), error: err.message, observation: null, method: 'error' };
  }

  const runGeneric = () => {
    const g = genericVerify(observation, featureLabel || detectorKey || '');
    // BOTH gates must hold. g.reached carries genericVerifier's own
    // anti-false-positive check (is this page actually identifiable as the
    // requested experience, or just "a page with inputs"?). Deriving reached
    // from the confidence RANK alone ignored that veto and let a homepage with
    // a booking widget verify as "Passenger Details" with zero navigation.
    //
    // FUTURE AI-VERIFIER INSERTION POINT (not implemented — no API call
    // exists here today): when `!g.reached && g.verdict === 'ambiguous'`,
    // this is the exact place to call an optional
    // `aiAssistedVerify(observation, featureLabel, g)`. genericVerify()'s
    // three-way verdict already separates "definitely not this page"
    // (verdict 'no-match', confidence 'none' — keep navigating, no AI call
    // needed) from "some signal fired but not enough to safely accept"
    // (verdict 'ambiguous' — a paraphrase, a synonym, a different language,
    // evidence that just missed the coherence bar). Only the 'ambiguous'
    // bucket should ever reach the future AI layer; 'match' and 'no-match'
    // are already fully decided deterministically and must stay free. If an
    // AI verifier says reached: true, its result should replace `g` here
    // (with its own `method: 'ai-semantic'`) exactly the way the detector
    // fallback below replaces `det`; if it says reached: false, `det` stays
    // as-is and navigation continues.
    return {
      reached: g.reached && CONF_RANK[g.confidence] >= CONF_RANK[minConfidence],
      confidence: g.confidence,
      signals: g.signals,
      detectorKey: detectorKey || null,
      known: false,
    };
  };

  const known = detectorKey && FEATURE_DETECTORS[detectorKey];
  let det;
  let method;
  if (known) {
    det = detectFeature(detectorKey, observation, { minConfidence });
    method = 'feature-detector';
    // GENERIC FALLBACK — featureIntent maps common, domain-neutral words onto
    // the airline detector set ("Checkout"/"Payment" -> payment, "Search
    // results" -> flight_results). On a store, a SaaS app or a public form
    // those detectors demand signals that cannot exist (flight cards,
    // departure/arrival times), so a page the agent had correctly REACHED
    // verified as not reached. When the known detector does not confirm, ask
    // the domain-free verifier too. It may only turn a negative into a
    // positive — a detector hit always wins — so precision on the known
    // airline set is unchanged.
    if (!det.reached) {
      const g = runGeneric();
      if (g.reached) { det = g; method = 'generic-fallback'; }
    }
  } else {
    det = runGeneric();
    method = 'generic';
  }

  const detectedStates = scanAllDetectors(observation).map((h) => `${h.key}:${h.confidence}`);
  return {
    reached: !!det.reached,
    confidence: det.confidence,
    confidenceRank: CONF_RANK[det.confidence] || 0,
    signals: det.signals || [],
    detectedStates,
    pageKind: pageKind(observation),
    fingerprint: pageStateFingerprint(observation),
    url: observation.url || safeUrl(page),
    observation,
    method,
  };
}

function safeUrl(page) { try { return page.url(); } catch { return null; } }

/** Confidence gate — agent-claimed completion is only accepted if verification agrees at ≥ medium. */
export function acceptCompletion(verify, agentCompleted) {
  return { targetReached: verify.reached, agentCompleted: !!agentCompleted, gatedBy: verify.reached ? verify.method : (agentCompleted ? 'agent-only-rejected' : 'neither') };
}

export { pageStateFingerprint };
