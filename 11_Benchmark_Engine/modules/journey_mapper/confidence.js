/**
 * Journey Mapper — confidence reasoning.
 * Pure functions: given the evidence available for a step (Discovery's own
 * confidence, whether a UI Map element confirms a real clickable target,
 * whether the only evidence is page-copy text), decide a confidence level.
 * Same low/medium/high vocabulary used everywhere else in this Engine.
 */

const RANK = { low: 1, medium: 2, high: 3 };
const LEVELS = ['low', 'medium', 'high'];

function clamp(rank) {
  return Math.max(1, Math.min(3, rank));
}

function downgrade(level) {
  return LEVELS[clamp(RANK[level] - 1) - 1];
}

function upgrade(level) {
  return LEVELS[clamp(RANK[level] + 1) - 1];
}

/**
 * scoreStepConfidence — combines Discovery's own confidence for this step
 * with whether a UI Map element confirms a real, visible, clickable target.
 */
export function scoreStepConfidence({ discoveryConfidence, uiMapMatch, isCopyOnlyEvidence }) {
  let level = discoveryConfidence || 'low';

  if (uiMapMatch && uiMapMatch.clickable && uiMapMatch.visible) {
    // A confirmed, locatable, clickable element is the strongest evidence
    // this module can have — upgrade one tier.
    level = upgrade(level);
  } else if (!uiMapMatch && isCopyOnlyEvidence) {
    // No confirmed element AND the only evidence is copy-text: a "hidden
    // feature" scenario — real confidence is lower than Discovery's label
    // suggests, because there is nothing confirmed to actually click yet.
    level = downgrade(level);
  }

  return level;
}

/**
 * computeOverallConfidence — the plan's single confidence value: never
 * higher than its weakest planned step, discounted further when no UI Map
 * was supplied at all, or floored by the source Discovery Report's own
 * confidence (a plan can't be more certain than what it was built from).
 */
export function computeOverallConfidence({ steps, hasUiMap, discoveryConfidence, hasBlockingObstacle }) {
  if (hasBlockingObstacle || steps.length === 0) return 'low';

  let level = steps.reduce((min, s) => (RANK[s.confidence] < RANK[min] ? s.confidence : min), 'high');

  if (!hasUiMap) level = downgrade(level);
  if (RANK[discoveryConfidence || 'low'] < RANK[level]) level = discoveryConfidence || 'low';

  return level;
}
