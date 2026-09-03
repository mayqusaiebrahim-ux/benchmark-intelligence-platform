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

  const known = detectorKey && FEATURE_DETECTORS[detectorKey];
  let det;
  let method;
  if (known) {
    det = detectFeature(detectorKey, observation, { minConfidence });
    method = 'feature-detector';
  } else {
    const g = genericVerify(observation, featureLabel || detectorKey || '');
    det = { reached: CONF_RANK[g.confidence] >= CONF_RANK[minConfidence], confidence: g.confidence, signals: g.signals, detectorKey: detectorKey || null, known: false };
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
