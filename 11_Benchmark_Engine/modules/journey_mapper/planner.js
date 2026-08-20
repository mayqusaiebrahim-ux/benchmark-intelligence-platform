/**
 * Journey Mapper — planning logic.
 * Pure functions: a Discovery Report + an optional UI Map (+ a screenshot
 * path, referenced only) in, an ordered JourneyPlan out. No browser access,
 * no navigation, no clicking — this module only reasons about where a future
 * Navigation Runner should go and why.
 */

import { scoreStepConfidence, computeOverallConfidence } from './confidence.js';

// Priority tiers this module optimizes for. Anything not listed defaults to 5.
const PRIORITY_TIER = {
  step_04_ai_interaction: 1,  // AI-first experience
  step_05_recommendations: 2, // Trip planning / personalization
  step_03_search: 3,          // Search
  step_07_booking: 4,         // Booking
};

const STEP_INTENT = {
  step_02_discovery: { title: 'Explore destination discovery/inspiration content', goal: 'Assess how the product surfaces destination inspiration outside of search.' },
  step_03_search: { title: 'Exercise the search capability', goal: 'Determine whether search returns relevant, usable results and how AI-assisted it is.' },
  step_04_ai_interaction: { title: 'Engage the AI entry point', goal: 'Determine whether an AI/chat surface exists, opens, and can hold a conversation.' },
  step_05_recommendations: { title: 'Evaluate trip planning / personalization', goal: 'Determine whether the product produces a usable, personalized itinerary or recommendation set.' },
  step_06_maps: { title: 'Check map-based exploration', goal: 'Assess whether spatial/map context is used for recommendations.' },
  step_07_booking: { title: 'Walk the booking entry point (non-transactional)', goal: 'Assess booking flow clarity and smart defaults, stopping short of payment.' },
  step_08_ancillaries: { title: 'Check ancillary upsell moments', goal: 'Assess timing and relevance of upsells (seats, bags, upgrades).' },
  step_09_payment: { title: 'Observe payment options (non-transactional)', goal: 'Assess payment methods and BNPL presence without completing a transaction.' },
  step_10_trip_management: { title: 'Check post-booking trip management', goal: 'Assess whether a trip dashboard / itinerary assistant exists.' },
  step_11_checkin: { title: 'Check check-in flow', goal: 'Assess check-in simplicity and biometric/seat-selection support.' },
  step_12_loyalty: { title: 'Check loyalty integration', goal: 'Assess how loyalty is surfaced across the journey.' },
};

const DEPENDENCY_MAP = {
  step_05_recommendations: 'step_04_ai_interaction',
  step_07_booking: 'step_03_search',
  step_08_ancillaries: 'step_07_booking',
  step_09_payment: 'step_07_booking',
};

function tierFor(stepId) {
  return PRIORITY_TIER[stepId] || 5;
}

function isCopyOnlyAiEvidence(discoveryReport) {
  const aiFindings = discoveryReport.detected_ai_capabilities || [];
  return aiFindings.length > 0 && aiFindings.every(f => f.type === 'mentioned_in_copy');
}

function findUiMapMatch(uiMap, stepId) {
  return (uiMap || []).find(el => el.related_journey_step === stepId) || null;
}

function dependsOnPrevious(stepId, includedStepIds) {
  const dep = DEPENDENCY_MAP[stepId];
  return !!dep && includedStepIds.has(dep);
}

function possibleFailureFor(stepId, { uiMapMatch, isCopyOnly }) {
  if (stepId === 'step_04_ai_interaction' && isCopyOnly) {
    return 'Only text evidence of AI exists (no confirmed widget/element) — the entry point may be decorative or require deeper navigation to reveal; the Navigation Runner may find nothing to click.';
  }
  if (!uiMapMatch) {
    return 'No confirmed, locatable element for this step — the Navigation Runner will need to (re-)discover a target at runtime rather than clicking a known one.';
  }
  if (!uiMapMatch.clickable) {
    return 'A related element was identified but is not currently clickable (may be disabled, covered by an obstacle, or require scrolling into view first).';
  }
  return 'The target page/state may differ from what Discovery observed if the site is a dynamic SPA that changes between visits.';
}

function buildJourneyStep(discoveryEntry, discoveryReport, uiMap, includedStepIds) {
  const stepId = discoveryEntry.step_id;
  const intent = STEP_INTENT[stepId] || { title: stepId, goal: 'Assess this journey step.' };
  const uiMapMatch = findUiMapMatch(uiMap, stepId);
  const isCopyOnly = stepId === 'step_04_ai_interaction' && isCopyOnlyAiEvidence(discoveryReport);

  const confidence = scoreStepConfidence({
    discoveryConfidence: discoveryEntry.confidence,
    uiMapMatch,
    isCopyOnlyEvidence: isCopyOnly,
  });

  return {
    id: stepId,
    title: intent.title,
    goal: intent.goal,
    reason: discoveryEntry.matched_signals && discoveryEntry.matched_signals.length
      ? `Discovery found: ${discoveryEntry.matched_signals.join(', ')}`
      : 'Included as a lower-confidence candidate — see possible_failure.',
    priority: tierFor(stepId),
    confidence,
    expected_result: `Evidence of "${intent.title.toLowerCase()}" is captured (screenshot + observed behavior) for Analysis to judge.`,
    depends_on_previous: dependsOnPrevious(stepId, includedStepIds),
    possible_failure: possibleFailureFor(stepId, { uiMapMatch, isCopyOnly }),
  };
}

function rankSteps(steps) {
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  return [...steps].sort((a, b) => a.priority - b.priority || confidenceRank[b.confidence] - confidenceRank[a.confidence]);
}

function buildAlternativePaths(rankedSteps, discoveryReport) {
  const paths = [];
  const top = rankedSteps[0];

  if (top && top.id === 'step_04_ai_interaction' && top.confidence === 'low') {
    paths.push({
      trigger: 'If no interactive AI entry point is found on the first attempt',
      sequence: rankedSteps.filter(s => s.id !== 'step_04_ai_interaction').slice(0, 3).map(s => s.id),
      reason: 'AI evidence was copy-only at Discovery time — fall back to the next-highest-confidence steps rather than stalling the run.',
    });
  }

  if ((discoveryReport.obstacles || []).some(o => o.type === 'consent_banner')) {
    paths.push({
      trigger: 'If the consent banner still blocks interaction on arrival',
      sequence: ['retry_safe_dismissal', ...rankedSteps.map(s => s.id)],
      reason: 'Discovery could not safely dismiss the consent banner — retry once under the same safety rules Discovery already applies before proceeding.',
    });
  }

  return paths;
}

function deriveBlockers(discoveryReport, rankedSteps) {
  const blockers = (discoveryReport.obstacles || []).map(o => ({
    type: o.type,
    description: o.description,
    affects: 'all steps until resolved',
  }));

  const noEvidenceSteps = rankedSteps.filter(s => s.reason.startsWith('Included as'));
  if (noEvidenceSteps.length) {
    blockers.push({
      type: 'insufficient_evidence',
      description: `${noEvidenceSteps.length} planned step(s) have weak or no confirmed Discovery evidence.`,
      affects: noEvidenceSteps.map(s => s.id).join(', '),
    });
  }

  return blockers;
}

function deriveAssumptions(discoveryReport, uiMap, screenshotPath) {
  const assumptions = [
    "The homepage screenshot is used only for traceability by this module — Journey Mapper does not perform pixel-level analysis of it; that remains Vision/Analysis's job.",
  ];

  if (!uiMap || uiMap.length === 0) {
    assumptions.push("No UI Map was supplied — step-to-element mapping is inferred from Discovery's text labels only; no locators are confirmed. The Navigation Runner must (re-)discover real click targets at runtime.");
  }

  if (isCopyOnlyAiEvidence(discoveryReport)) {
    assumptions.push('AI capability evidence is text-only (page-copy keyword matches) — an interactive AI surface was not confirmed at Discovery time.');
  }

  if (!screenshotPath) {
    assumptions.push("No homepage screenshot path was supplied — this plan was built from Discovery's structured findings alone.");
  }

  return assumptions;
}

function derivePrimaryGoal(rankedSteps) {
  if (rankedSteps.length === 0) return 'Insufficient evidence to plan a journey beyond the homepage.';
  return `Reach and evaluate: ${rankedSteps[0].title}.`;
}

function deriveRecommendedFirstAction(rankedSteps, blockers) {
  if (rankedSteps.length === 0) return 'No further navigation recommended — re-run Discovery or escalate to hybrid research.';

  const blocking = blockers.find(b => b.affects === 'all steps until resolved');
  const top = rankedSteps[0];

  if (blocking) {
    return `Resolve first: ${blocking.description} Then proceed to "${top.title}".`;
  }
  return `Proceed to "${top.title}" — ${top.reason}.`;
}

/**
 * buildJourneyPlan — the module's core reasoning function. Pure: no I/O,
 * no navigation, no clicking.
 */
export function buildJourneyPlan({ discoveryReport, uiMap = [], screenshotPath = null }) {
  const evidencedEntries = (discoveryReport.suggested_benchmark_journey || [])
    .filter(e => e.step_id !== 'step_01_entry' && e.applicable_guess);

  const includedStepIds = new Set(evidencedEntries.map(e => e.step_id));
  const steps = evidencedEntries.map(e => buildJourneyStep(e, discoveryReport, uiMap, includedStepIds));
  const rankedSteps = rankSteps(steps);

  const hasBlockingObstacle = (discoveryReport.obstacles || []).some(o => o.type === 'login_wall' || o.type === 'blocked_or_error');
  const blockers = deriveBlockers(discoveryReport, rankedSteps);
  const alternativePaths = buildAlternativePaths(rankedSteps, discoveryReport);
  const assumptions = deriveAssumptions(discoveryReport, uiMap, screenshotPath);

  const confidence = computeOverallConfidence({
    steps: rankedSteps,
    hasUiMap: !!(uiMap && uiMap.length),
    discoveryConfidence: discoveryReport.confidence,
    hasBlockingObstacle,
  });

  return {
    starting_url: discoveryReport.resolved_url,
    primary_goal: derivePrimaryGoal(rankedSteps),
    confidence,
    recommended_first_action: deriveRecommendedFirstAction(rankedSteps, blockers),
    recommended_journey: rankedSteps,
    alternative_paths: alternativePaths,
    estimated_steps: rankedSteps.length,
    blockers,
    assumptions,
  };
}
