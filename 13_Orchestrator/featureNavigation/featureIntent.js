/**
 * featureIntent — a Feature Benchmark navigates for ONE feature, not the
 * generic 12-step journey. This module turns a requested feature into a
 * navigation intent and a feature-scoped JourneyPlan that Navigation Runner
 * executes as-is (same { starting_url, recommended_journey[] } shape it
 * already consumes from Journey Mapper).
 *
 * Root cause it fixes: journey_mapper/planner.js's buildJourneyPlan()
 * explicitly drops `step_01_entry` and keeps every keyword-matched step
 * (Payment, Check-in, Loyalty, ...). For "Homepage" that produced a plan
 * with no homepage step at all, so Navigation Runner walked Payment /
 * Check-in / Loyalty and Vision then analysed one of those screenshots.
 *
 * This is deliberately NOT Homepage-only: any feature that maps to a
 * CLAUDE.md journey step gets a one-hop-from-homepage scoped plan for that
 * step, reusing Navigation Runner's existing per-step interaction hints.
 * Homepage / entry just happens to be the homepage-only case.
 */

// Same table as featureVisionStage.mapFeatureToStepId — single source now.
const FEATURE_KEYWORD_MAP = [
  [['entry', 'landing', 'homepage', 'home page', 'hero'], 'step_01_entry'],
  [['discover', 'inspiration', 'explore', 'trending'], 'step_02_discovery'],
  [['search results', 'results page', 'flight results', 'flight list'], 'step_03_search'],
  [['flight search', 'search', 'filter'], 'step_03_search'],
  [['ai travel planner', 'ai planner', 'ai interaction', 'chatbot', 'ai chat', 'chat', 'assistant', 'copilot', 'concierge'], 'step_04_ai_interaction'],
  [['recommendation', 'personalization', 'personalisation', 'for you'], 'step_05_recommendations'],
  [['map'], 'step_06_maps'],
  [['fare selection', 'fare family', 'fare options', 'fare family', 'select fare', 'branded fares'], 'step_07_booking'],
  [['booking flow', 'booking', 'book', 'reserve', 'passenger details', 'passenger information', 'traveller details', 'traveler details', 'contact details'], 'step_07_booking'],
  [['ancillary', 'ancillaries', 'upsell', 'add-on', 'addon', 'baggage', 'extra bags', 'meal', 'seat selection', 'seat map', 'choose seat', 'upgrade'], 'step_08_ancillaries'],
  [['payment', 'checkout', 'pay', 'bnpl', 'wallet', 'billing'], 'step_09_payment'],
  [['trip management', 'manage booking', 'manage my booking', 'my trips', 'itinerary', 'post-booking', 'retrieve booking'], 'step_10_trip_management'],
  [['check-in', 'checkin', 'check in', 'boarding pass'], 'step_11_checkin'],
  [['loyalty', 'rewards', 'points', 'miles', 'frequent flyer', 'privilege club', 'skywards', 'alfursan'], 'step_12_loyalty'],
  [['sign-in', 'sign in', 'signin', 'log in', 'login', 'member login', 'account login'], 'step_auth'],
];

// A feature keyword → goal_navigator/featureDetectors.js detector key. More
// specific than the journey step: "Fare Selection" and "Passenger Details"
// both map to step_07_booking, but need different arrival detectors.
const DETECTOR_KEYWORD_MAP = [
  [['flight results', 'search results', 'results page', 'flight list'], 'flight_results'],
  [['fare selection', 'fare family', 'fare options', 'select fare', 'branded fares'], 'fare_selection'],
  [['passenger details', 'passenger information', 'traveller details', 'traveler details', 'contact details'], 'passenger_details'],
  [['seat selection', 'seat map', 'choose seat', 'select seat'], 'seat_selection'],
  [['ancillary', 'ancillaries', 'baggage', 'extra bags', 'meal', 'extras', 'add-on', 'addon', 'upgrade'], 'ancillaries'],
  [['payment', 'checkout', 'billing', 'bnpl'], 'payment'],
  [['check-in', 'checkin', 'check in', 'boarding pass'], 'checkin'],
  [['manage booking', 'manage my booking', 'trip management', 'my trips', 'retrieve booking'], 'manage_booking'],
  [['sign-in', 'sign in', 'signin', 'log in', 'login', 'member login'], 'signin'],
  [['loyalty', 'privilege club', 'skywards', 'alfursan', 'frequent flyer', 'miles', 'rewards'], 'loyalty'],
  [['flight search', 'search flights', 'book a flight'], 'flight_search'],
];

function mapFeatureToDetectorKey(feature) {
  const text = String(feature || '').toLowerCase();
  for (const [keywords, key] of DETECTOR_KEYWORD_MAP) {
    if (keywords.some((k) => text.includes(k))) return key;
  }
  return null;
}
export { mapFeatureToDetectorKey };

// Features that are, by nature, examined on the landing page itself — no
// second navigation hop. "Burger menu", "notifications", "profile entry"
// etc. all live on / are reachable from the homepage chrome.
const HOMEPAGE_SURFACE_KEYWORDS = [
  'homepage', 'home page', 'landing', 'entry', 'hero', 'nav', 'navigation',
  'burger menu', 'hamburger', 'menu', 'header', 'footer', 'cookie', 'consent',
];

export function mapFeatureToStepId(feature) {
  const text = String(feature || '').toLowerCase();
  for (const [keywords, stepId] of FEATURE_KEYWORD_MAP) {
    if (keywords.some((k) => text.includes(k))) return stepId;
  }
  return null;
}

/**
 * @returns {{ stepId: string|null, homepageOnly: boolean, goalDriven: boolean,
 *   detectorKey: string|null, label: string, description: string,
 *   note: string|null }}
 */
export function resolveFeatureIntent(feature) {
  const f = String(feature || '').trim();
  const lower = f.toLowerCase();
  const stepId = mapFeatureToStepId(f) || (/(sign[- ]?in|log[- ]?in|login)/.test(lower) ? 'step_auth' : null);
  const detectorKey = mapFeatureToDetectorKey(f);

  const homepageSurface = HOMEPAGE_SURFACE_KEYWORDS.some((k) => lower.includes(k));

  if (stepId === 'step_01_entry' || homepageSurface) {
    return {
      stepId: 'step_01_entry',
      homepageOnly: true,
      goalDriven: false,
      detectorKey: null,
      label: `Homepage — ${f}`,
      description: `Open the company homepage, clear any cookie/consent overlay, and capture the homepage as evidence for the "${f}" benchmark. Do not navigate into Payment, Check-in, Loyalty, Ancillaries or any other unrelated journey step.`,
      note: null,
    };
  }

  // ANY non-homepage feature is a navigation TARGET the universal agent drives
  // toward. The route emerges from the live website — `detectorKey` (when the
  // feature is one of the known set) is used only for independent verification,
  // never to define the journey. A `stepId` (when a keyword matched) is kept
  // only for the Dashboard's existing progress labels.
  const genericDescription =
    `From the company homepage, autonomously navigate this website's own public flow — search, choose options, fill multi-step forms with synthetic test data, continue past interstitials, skip optional extras — until the "${f}" experience is on screen, then STOP and capture it. Never sign in, submit payment, or complete anything irreversible.`;

  if (stepId) {
    return {
      stepId,
      homepageOnly: false,
      goalDriven: true,
      detectorKey: detectorKey || null,
      label: `${f} (${stepId}, agent-driven)`,
      description: genericDescription,
      note: null,
    };
  }

  // Unmapped custom feature (any website, any flow) — still a navigation target.
  return {
    stepId: 'step_07_booking', // arbitrary machine label for Dashboard progress; not a route
    homepageOnly: false,
    goalDriven: true,
    detectorKey: null,
    label: `${f} (agent-driven, generic target)`,
    description: genericDescription,
    note: `custom feature "${f}" — no known detector; arrival is verified generically`,
  };
}

const STEP_TITLES = {
  step_01_entry: 'Open and inspect the homepage',
  step_02_discovery: 'Open the discovery / inspiration surface',
  step_03_search: 'Open the search experience',
  step_04_ai_interaction: 'Open the AI / chat entry point',
  step_05_recommendations: 'Open the recommendations surface',
  step_06_maps: 'Open the map view',
  step_07_booking: 'Open the booking entry point',
  step_08_ancillaries: 'Open the ancillaries / extras surface',
  step_09_payment: 'Open the payment options (non-transactional)',
  step_10_trip_management: 'Open trip management',
  step_11_checkin: 'Open the check-in flow',
  step_12_loyalty: 'Open the loyalty surface',
  step_auth: 'Open the sign-in / member login surface',
};

/**
 * buildFeatureJourneyPlan — a JourneyPlan scoped to exactly one step. Same
 * shape Navigation Runner already executes (starting_url + recommended_journey
 * of JourneyStep-like objects). Never contains more than one step, and never
 * an unrelated one.
 *
 * @param {object} args
 * @param {object} args.discoveryReport  Discovery's own report (for resolved_url)
 * @param {object} args.target           frozen benchmark target
 * @param {object} args.intent           resolveFeatureIntent(feature) output
 */
export function buildFeatureJourneyPlan({ discoveryReport, target, intent }) {
  // starting_url is ALWAYS the target's own official URL, never a URL
  // carried in from elsewhere. Discovery's resolved_url is only used when it
  // is on the same domain (a normal http->https / trailing-slash redirect).
  const resolved = discoveryReport?.resolved_url;
  let startingUrl = target.url;
  try {
    if (resolved && new URL(resolved).hostname.replace(/^www\./, '').split('.').slice(-2).join('.')
        === (target.domain || '')) {
      startingUrl = resolved;
    }
  } catch { /* keep target.url */ }

  const step = {
    id: intent.stepId,
    step_id: intent.stepId,
    title: STEP_TITLES[intent.stepId] || `Examine ${target.feature}`,
    goal: intent.description,
    reason: `Feature Benchmark is scoped to "${target.feature}" only.`,
    priority: 1,
    confidence: 'high',
    expected_result: `A screenshot of ${intent.homepageOnly ? 'the homepage' : `the "${target.feature}" surface`} for ${target.company} is captured.`,
    depends_on_previous: false,
    // Goal-driven navigation: Navigation Runner hands this step to
    // goal_navigator/goalNavigator.js instead of a single interaction hint.
    goal_driven: !!intent.goalDriven,
    detector_key: intent.detectorKey || null,
    feature_label: target.feature,
    possible_failure: intent.homepageOnly
      ? 'The homepage may be behind a hard block or never finish loading.'
      : intent.goalDriven
        ? 'The multi-step flow may hit an auth wall, a safety boundary (payment), or the step/time budget before the feature detector confirms arrival — the run then reports the deepest page reached.'
        : 'The one-hop link for this feature may not exist on the homepage — the run then falls back to homepage evidence.',
  };

  return {
    starting_url: startingUrl,
    company_slug: target.slug,
    primary_goal: `Capture evidence for "${target.feature}" on ${target.company}.`,
    confidence: 'high',
    recommended_first_action: intent.description,
    recommended_journey: [step],
    alternative_paths: [],
    estimated_steps: 1,
    blockers: [],
    assumptions: [
      'Feature-scoped plan: exactly one step, built by featureIntent.js — Journey Mapper is not used for Feature Benchmarks.',
      ...(intent.note ? [intent.note] : []),
    ],
    feature_scoped: true,
    feature: target.feature,
    feature_intent: {
      stepId: intent.stepId,
      homepageOnly: intent.homepageOnly,
      goalDriven: !!intent.goalDriven,
      detectorKey: intent.detectorKey || null,
      label: intent.label,
    },
  };
}
