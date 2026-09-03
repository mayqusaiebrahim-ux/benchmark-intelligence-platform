/**
 * autonomous_navigator/targetVerifier — INDEPENDENT verification that the
 * requested experience was actually reached. The agent saying "I reached
 * Passenger Details" is never trusted; this module inspects the live DOM with
 * the same feature detectors the heuristic navigator uses.
 *
 * Reuses:
 *   - buildObservation() (goal_navigator/playwrightAdapter) — one page.evaluate
 *     DOM snapshot; works on any page with a Playwright-style .evaluate()/.url()
 *     (the Navigation Runner page AND Stagehand's understudy Page).
 *   - detectFeature() / scanAllDetectors() (goal_navigator/featureDetectors).
 */
import { buildObservation } from '../goal_navigator/playwrightAdapter.js';
import { detectFeature, scanAllDetectors } from '../goal_navigator/featureDetectors.js';

const CONF_RANK = { none: 0, low: 1, medium: 2, high: 3 };

/**
 * @param {object} page   a Playwright-like page (runner page or Stagehand understudy Page)
 * @param {string} detectorKey
 * @param {object} [opts]  { minConfidence: 'medium' }
 * @returns {Promise<{ reached, confidence, confidenceRank, signals, detectedStates, url, observation }>}
 */
export async function verifyTarget(page, detectorKey, { minConfidence = 'medium' } = {}) {
  let observation;
  try {
    observation = await buildObservation(page);
  } catch (err) {
    return { reached: false, confidence: 'none', confidenceRank: 0, signals: [], detectedStates: [], url: safeUrl(page), error: err.message, observation: null };
  }
  const det = detectFeature(detectorKey, observation, { minConfidence });
  const detectedStates = scanAllDetectors(observation).map((h) => `${h.key}:${h.confidence}`);
  return {
    reached: !!det.reached,
    confidence: det.confidence,
    confidenceRank: CONF_RANK[det.confidence] || 0,
    signals: det.signals || [],
    detectedStates,
    url: observation.url || safeUrl(page),
    observation,
  };
}

function safeUrl(page) {
  try { return page.url(); } catch { return null; }
}

/** Confidence gate: agent-claimed completion is only accepted if the detector agrees at ≥ medium. */
export function acceptCompletion(verify, agentCompleted) {
  // Target is reached if AND ONLY IF our detector confirms it at medium+.
  // agentCompleted alone is never enough.
  return { targetReached: verify.reached, agentCompleted: !!agentCompleted, gatedBy: verify.reached ? 'detector' : (agentCompleted ? 'agent-only-rejected' : 'neither') };
}
