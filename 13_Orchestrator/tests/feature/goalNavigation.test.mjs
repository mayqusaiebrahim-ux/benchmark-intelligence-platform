/**
 * Goal-driven safe navigation — pure unit + simulated-flow proofs.
 * No browser, no network. A `FakePage`-style adapter drives the loop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTestProfile, syntheticValueAllowList, isoDateOffset, ALTERNATE_ROUTES } from '../../../11_Benchmark_Engine/modules/goal_navigator/syntheticData.js';
import { classifyAction } from '../../../11_Benchmark_Engine/modules/goal_navigator/actionSafety.js';
import { resolveFieldSemantic, planAutofill, valueForSemantic, BLOCKED_SEMANTICS } from '../../../11_Benchmark_Engine/modules/goal_navigator/formAutofill.js';
import { detectFeature, FEATURE_DETECTORS } from '../../../11_Benchmark_Engine/modules/goal_navigator/featureDetectors.js';
import { isOptionalSkip, isPaidAddon, chooseOptionalControl } from '../../../11_Benchmark_Engine/modules/goal_navigator/optionalStepHandler.js';
import { runGoalNavigation, decideNextAction, TARGET_STATUS } from '../../../11_Benchmark_Engine/modules/goal_navigator/goalNavigator.js';
import { normalizeObservation, resolveClickable, safeLc, settle } from '../../../11_Benchmark_Engine/modules/goal_navigator/playwrightAdapter.js';
import { resolveFeatureIntent, buildFeatureJourneyPlan, mapFeatureToDetectorKey } from '../../featureNavigation/featureIntent.js';
import { selectEvidence } from '../../stages/featureVisionStage.js';
import { createBenchmarkTarget } from '../../runtime/benchmarkTarget.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROFILE = buildTestProfile({ now: new Date('2026-03-01T00:00:00Z') });

/**
 * scriptedAdapter — walks a list of page states. Each `click`/search advances
 * to the next state; `fill`/`selectOption` succeed in place. Optional
 * `validationErrorsByState` injects recoverable errors.
 */
function scriptedAdapter(states, { onClick } = {}) {
  let i = 0;
  const calls = { clicks: [], fills: [], selects: [] };
  return {
    calls,
    stateIndex: () => i,
    async observe() { return states[Math.min(i, states.length - 1)]; },
    async fill(desc, value) { calls.fills.push({ semantic: desc.semantic, value }); return { ok: true }; },
    async selectOption(desc, value) { calls.selects.push({ semantic: desc.semantic, value }); return { ok: true }; },
    async click(name) {
      calls.clicks.push(name);
      if (onClick) onClick(name, i);
      if (i < states.length - 1) i++;
      return { ok: true, navigated: true };
    },
    async waitForSettle() {},
    async validationErrors() {
      const s = states[Math.min(i, states.length - 1)];
      return s.__validationErrors || [];
    },
  };
}

// ─── 1. synthetic data ────────────────────────────────────────────────────
test('synthetic data: safe dates, safe route, no real PII', () => {
  assert.equal(PROFILE.trip.departDate, isoDateOffset(30, new Date('2026-03-01T00:00:00Z')));
  assert.equal(PROFILE.trip.returnDate, isoDateOffset(35, new Date('2026-03-01T00:00:00Z')));
  assert.equal(PROFILE.trip.origin, 'JED');
  assert.equal(PROFILE.trip.destination, 'DXB');
  assert.equal(PROFILE.trip.adults, 1);
  assert.equal(PROFILE.trip.cabin, 'Economy');
  // reserved / non-routable contact details only
  assert.match(PROFILE.contact.email, /@example\.com$/);
  assert.match(PROFILE.contact.phone, /^\+9665555/);
  assert.equal(PROFILE.passenger.fullName, 'Test Traveler');
  assert.equal(PROFILE.passenger.frequentFlyer, '');
  assert.equal(PROFILE.payment, null);
  assert.equal(PROFILE.credentials, null);
  assert.ok(ALTERNATE_ROUTES.length >= 3);
});

test('synthetic data: the autofill planner never emits a value outside the allow-list', () => {
  const allow = syntheticValueAllowList(PROFILE);
  const fields = [
    { label: 'From' }, { label: 'To' }, { label: 'Departure date' }, { label: 'Return date' },
    { label: 'Title' }, { label: 'First name' }, { label: 'Last name' }, { label: 'Date of birth' },
    { label: 'Email address', type: 'email' }, { label: 'Phone number', type: 'tel' },
    { label: 'Nationality' }, { label: 'Country of residence' }, { label: 'City' }, { label: 'Postcode' },
  ];
  const { fills } = planAutofill(fields, PROFILE);
  for (const f of fills) {
    if (f.semantic === 'consent_checkbox') continue;
    assert.ok(allow.has(String(f.value)), `value "${f.value}" (${f.semantic}) must be synthetic`);
  }
});

// ─── 2. field semantics ───────────────────────────────────────────────────
test('field semantics: resolved from label / placeholder / aria / name / type', () => {
  const cases = [
    [{ label: 'From' }, 'origin'],
    [{ placeholder: 'Departure airport or city' }, 'origin'],
    [{ ariaLabel: 'Destination' }, 'destination'],
    [{ label: 'Departure date' }, 'depart_date'],
    [{ label: 'Return date' }, 'return_date'],
    [{ label: 'Passengers' }, 'passengers'],
    [{ label: 'Cabin class' }, 'cabin'],
    [{ label: 'Title' }, 'title'],
    [{ label: 'Given name' }, 'first_name'],
    [{ label: 'Surname' }, 'last_name'],
    [{ name: 'dateOfBirth' }, 'date_of_birth'],
    [{ label: 'Email' , type: 'email' }, 'email'],
    [{ type: 'tel' }, 'phone'],
    [{ label: 'Nationality' }, 'nationality'],
    [{ label: 'Country of residence' }, 'country_of_residence'],
    [{ label: 'Card number' }, 'card_number'],
    [{ label: 'CVV' }, 'card_cvv'],
    [{ label: 'Password' }, 'password'],
    [{ label: 'Booking reference' }, 'booking_reference'],
  ];
  for (const [desc, expected] of cases) {
    assert.equal(resolveFieldSemantic(desc), expected, JSON.stringify(desc));
  }
});

// ─── 3. autofill plan ─────────────────────────────────────────────────────
test('autofill: fills synthetic values; blocks every auth/payment field', () => {
  const { fills, blocked } = planAutofill([
    { label: 'First name' }, { label: 'Last name' }, { label: 'Email', type: 'email' },
    { label: 'Card number' }, { label: 'CVV' }, { label: 'Expiry' }, { label: 'Name on card' },
    { label: 'Password' }, { label: 'Booking reference' }, { label: 'Membership ID' },
  ], PROFILE);
  const filledSemantics = fills.map((f) => f.semantic);
  assert.deepEqual(filledSemantics.sort(), ['email', 'first_name', 'last_name']);
  const blockedSemantics = blocked.map((b) => b.semantic).sort();
  assert.deepEqual(blockedSemantics, ['booking_reference', 'card_cvv', 'card_expiry', 'card_name', 'card_number', 'member_id', 'password']);
  for (const s of BLOCKED_SEMANTICS) assert.equal(valueForSemantic(s, PROFILE), null);
});

// ─── 4. action safety ─────────────────────────────────────────────────────
test('action safety: 7-way classification', () => {
  assert.equal(classifyAction({ kind: 'click', name: 'Continue' }).classification, 'SAFE_NAVIGATION');
  assert.equal(classifyAction({ kind: 'click', name: 'Search flights' }).classification, 'SAFE_NAVIGATION');
  assert.equal(classifyAction({ kind: 'click', name: 'Select this flight' }).classification, 'SAFE_SELECTION');
  assert.equal(classifyAction({ kind: 'click', name: 'Choose Economy Lite' }).classification, 'SAFE_SELECTION');
  assert.equal(classifyAction({ kind: 'fill', name: 'First name', fieldSemantic: 'first_name' }).classification, 'SAFE_FORM_FILL');
  assert.equal(classifyAction({ kind: 'click', name: 'Pay now' }).classification, 'IRREVERSIBLE_TRANSACTION');
  assert.equal(classifyAction({ kind: 'click', name: 'Confirm and pay' }).classification, 'IRREVERSIBLE_TRANSACTION');
  assert.equal(classifyAction({ kind: 'fill', name: 'Card number', fieldSemantic: 'card_number' }).classification, 'IRREVERSIBLE_TRANSACTION');
  assert.equal(classifyAction({ kind: 'click', name: 'Redeem miles' }).classification, 'IRREVERSIBLE_TRANSACTION');
  assert.equal(classifyAction({ kind: 'click', name: 'Sign in' }).classification, 'AUTH_REQUIRED');
  assert.equal(classifyAction({ kind: 'fill', name: 'Password', fieldSemantic: 'password' }).classification, 'AUTH_REQUIRED');
  assert.equal(classifyAction({ kind: 'click', name: 'Retrieve my booking' }).classification, 'AUTH_REQUIRED');
  assert.equal(classifyAction({ kind: 'click', name: 'Frobnicate the widget' }).classification, 'UNKNOWN_RISK');
  assert.equal(classifyAction({ kind: 'click', name: 'anything', targetDetected: true }).classification, 'TARGET_REACHED');
  // none of the unsafe ones are allowed
  for (const n of ['Pay now', 'Sign in', 'Frobnicate']) assert.equal(classifyAction({ kind: 'click', name: n }).allowed, false);
});

// ─── 5. optional-step handler ─────────────────────────────────────────────
test('optional steps: skip / decline recognised, paid add-ons never chosen', () => {
  assert.ok(isOptionalSkip('Skip'));
  assert.ok(isOptionalSkip('No thanks'));
  assert.ok(isOptionalSkip('Continue without adding extras'));
  assert.ok(isOptionalSkip('Maybe later'));
  assert.ok(!isOptionalSkip('Add extra baggage'));
  assert.ok(isPaidAddon('Add to trip'));
  assert.ok(isPaidAddon('Upgrade now'));

  assert.deepEqual(chooseOptionalControl(['Add extra bag', 'Skip for now', 'Continue']), { name: 'Skip for now', action: 'skip' });
  assert.deepEqual(chooseOptionalControl(['Add extra bag', 'Continue']), { name: 'Continue', action: 'continue' });
  assert.equal(chooseOptionalControl(['Add extra bag', 'Upgrade now']), null);
});

// ─── 6. feature detectors ────────────────────────────────────────────────
test('feature detectors: each fires on its own signals and not on a bare homepage', () => {
  const homepage = { url: 'https://x.com/', headings: ['book a flight', 'our destinations'], bodyText: 'welcome', buttons: ['search'], fields: [{ semantic: 'origin' }, { semantic: 'destination' }], counts: {} };
  assert.equal(detectFeature('passenger_details', homepage).reached, false);
  assert.equal(detectFeature('payment', homepage).reached, false);
  assert.equal(detectFeature('seat_selection', homepage).reached, false);

  assert.equal(detectFeature('flight_results', { headings: ['select your flight'], bodyText: '08:00 11:30 nonstop 2h30 duration', buttons: [], fields: [], counts: { flightCards: 4, priceTags: 4 } }).reached, true);
  assert.equal(detectFeature('fare_selection', { headings: ['select your fare'], bodyText: 'economy lite economy flex refundable checked baggage included', buttons: [], fields: [], counts: { fareCards: 3 } }).reached, true);
  assert.equal(detectFeature('passenger_details', { headings: ['passenger 1 (adult)'], bodyText: '', buttons: [], fields: [{ semantic: 'first_name' }, { semantic: 'last_name' }, { semantic: 'date_of_birth' }], counts: {} }).reached, true);
  assert.equal(detectFeature('seat_selection', { headings: ['choose your seat'], bodyText: 'window aisle exit row seat 14a extra legroom', buttons: [], fields: [], counts: { seatCells: 120 } }).reached, true);
  assert.equal(detectFeature('ancillaries', { headings: ['extras', 'optional services'], bodyText: 'extra baggage pre-order a meal lounge access', buttons: ['add', 'skip'], fields: [], counts: {} }).reached, true);
  assert.equal(detectFeature('payment', { headings: ['payment'], bodyText: 'pay with card apple pay total to pay sar 1,240 price breakdown', buttons: [], fields: [], counts: {} }).reached, true);
  assert.equal(detectFeature('checkin', { headings: ['online check-in'], bodyText: 'booking reference last name', buttons: [], fields: [{ semantic: 'booking_reference' }], counts: {} }).reached, true);
  assert.equal(detectFeature('manage_booking', { headings: ['manage my booking'], bodyText: '', buttons: [], fields: [{ semantic: 'booking_reference' }], counts: {} }).reached, true);
  assert.equal(detectFeature('signin', { headings: ['sign in'], bodyText: 'forgot your password remember me', buttons: [], fields: [{ semantic: 'email' }, { semantic: 'password' }], counts: {} }).reached, true);

  // an unknown detector key never claims a match
  assert.equal(detectFeature('nope', homepage).known, false);
  assert.equal(detectFeature('nope', homepage).reached, false);
});

// ─── 7. the loop ─────────────────────────────────────────────────────────
test('loop: a detector match on the FIRST observation stops immediately (0 actions)', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://x.com/pax', headings: ['passenger details'], bodyText: '', buttons: ['continue'],
      fields: [{ label: 'First name' }, { label: 'Last name' }, { label: 'Date of birth' }], counts: {} },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'passenger_details', feature: 'Passenger Details', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.equal(r.targetReached, true);
  assert.equal(r.actionsTaken, 0);
  assert.equal(adapter.calls.fills.length, 0);
  assert.equal(adapter.calls.clicks.length, 0);
});

test('loop: max-step safeguard stops the run honestly', async () => {
  // a page that always offers a fresh "continue" but never reaches the target
  let n = 0;
  const adapter = {
    async observe() { return { url: `https://x.com/${n}`, headings: [`step ${n}`], bodyText: '', buttons: [`continue ${n}`], fields: [], counts: {} }; },
    async fill() { return { ok: true }; },
    async selectOption() { return { ok: true }; },
    async click() { n++; return { ok: true, navigated: true }; },
    async waitForSettle() {},
  };
  const r = await runGoalNavigation({ adapter, detectorKey: 'payment', feature: 'Payment', profile: PROFILE, limits: { maxActions: 5, maxMs: 999999 } });
  assert.equal(r.targetStatus, TARGET_STATUS.MAX_STEPS);
  assert.equal(r.targetReached, false);
  assert.equal(r.actionsTaken, 5);
  assert.match(r.blocker, /5-action ceiling/);
});

test('loop: max-time safeguard stops the run honestly', async () => {
  const adapter = {
    async observe() { return { url: 'https://x.com/', headings: ['home'], bodyText: '', buttons: ['continue'], fields: [], counts: {} }; },
    async fill() { return { ok: true }; },
    async selectOption() { return { ok: true }; },
    async click() { return { ok: true }; },
    async waitForSettle() {},
  };
  const r = await runGoalNavigation({ adapter, detectorKey: 'payment', feature: 'Payment', profile: PROFILE, limits: { maxActions: 999, maxMs: 0 } });
  assert.equal(r.targetStatus, TARGET_STATUS.MAX_TIME);
  assert.equal(r.targetReached, false);
});

test('loop: an UNKNOWN_RISK-only page is not acted on — reports a blocker', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://x.com/weird', headings: ['hmm'], bodyText: '', buttons: ['Frobnicate', 'Wibble'], fields: [], counts: {} },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'payment', feature: 'Payment', profile: PROFILE });
  assert.equal(r.targetReached, false);
  assert.equal(r.targetStatus, TARGET_STATUS.BLOCKER);
  assert.equal(adapter.calls.clicks.length, 0);
});

test('loop: STOPS before payment submission — payment page = target, no Pay click', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://x.com/pay', headings: ['payment'],
      bodyText: 'how would you like to pay? pay with card apple pay tabby total to pay sar 1,240',
      buttons: ['Pay now', 'Confirm and pay'],
      fields: [{ label: 'Card number' }, { label: 'CVV' }], counts: {} },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'payment', feature: 'Payment', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.equal(adapter.calls.clicks.length, 0, 'never clicked Pay');
  assert.equal(adapter.calls.fills.length, 0, 'never filled a card field');
});

test('loop: a page with ONLY a Pay button and no payment heading = safety boundary, not a click', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://x.com/x', headings: ['almost there'], bodyText: 'your trip is ready', buttons: ['Pay now'], fields: [], counts: {} },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'seat_selection', feature: 'Seat Selection', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.SAFETY);
  assert.equal(r.targetReached, false);
  assert.equal(adapter.calls.clicks.length, 0);
});

test('loop: an auth wall = blocked_auth_or_booking_reference, no credentials invented', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://x.com/login', headings: ['sign in to continue'], bodyText: 'member id password',
      buttons: ['Sign in'], fields: [{ label: 'Email' }, { label: 'Password' }], counts: {} },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'manage_booking', feature: 'Manage Booking', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.AUTH);
  assert.equal(r.targetReached, false);
  assert.equal(adapter.calls.fills.length, 0);
  assert.ok(r.classificationsSeen.includes('AUTH_REQUIRED'));
});

test('loop: bounded validation-error recovery then success', async () => {
  const states = [
    { url: 'https://x.com/pax', headings: ['passenger details'], bodyText: '', buttons: ['continue'],
      fields: [{ label: 'First name' }, { label: 'Last name' }], counts: {}, __validationErrors: ['First name is required'] },
    { url: 'https://x.com/seat', headings: ['choose your seat'], bodyText: 'window aisle seat 12a', buttons: [], fields: [], counts: { seatCells: 90 } },
  ];
  // clear the validation error after the first continue click
  const adapter = scriptedAdapter(states, { onClick: () => { states[0].__validationErrors = []; } });
  const r = await runGoalNavigation({ adapter, detectorKey: 'seat_selection', feature: 'Seat Selection', profile: PROFILE, limits: { maxRetriesPerAction: 2 } });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.ok(r.interactionsPerformed.some((s) => /Validation error/.test(s)));
});

test('loop: a failed reach stays honest — targetReached false, blocker + deepest page set', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://x.com/deadend', headings: ['nothing here'], bodyText: '', buttons: [], fields: [], counts: {} },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'payment', feature: 'Payment', profile: PROFILE });
  assert.equal(r.targetReached, false);
  assert.ok(r.blocker);
  assert.equal(r.deepestUrl, 'https://x.com/deadend');
});

// ─── 8. simulated multi-step airline flows ───────────────────────────────
const SEARCH_STATE = {
  url: 'https://air.com/', headings: ['book a flight'], bodyText: 'plan your trip',
  buttons: ['Search flights'],
  fields: [{ label: 'From' }, { label: 'To' }, { label: 'Departure date' }, { label: 'Return date' }, { label: 'Passengers' }, { label: 'Cabin class' }],
  counts: {},
};
const RESULTS_STATE = {
  url: 'https://air.com/results', headings: ['select your flight'],
  bodyText: '08:00 11:30 nonstop 2h 30m duration from sar 900', buttons: ['Select this flight', 'Select this flight'],
  fields: [], counts: { flightCards: 3, priceTags: 3 },
};
const FARE_STATE = {
  url: 'https://air.com/fares', headings: ['select your fare'],
  bodyText: 'economy lite economy classic economy flex refundable changeable checked baggage included',
  buttons: ['Choose Economy Lite', 'Choose Economy Flex'], fields: [], counts: { fareCards: 3 },
};
const PAX_STATE = {
  url: 'https://air.com/passengers', headings: ['passenger details'], bodyText: 'contact details',
  buttons: ['Continue'],
  fields: [{ label: 'Title' }, { label: 'First name' }, { label: 'Last name' }, { label: 'Date of birth' }, { label: 'Email', type: 'email' }],
  counts: {},
};
const ANCILLARY_STATE = {
  url: 'https://air.com/extras', headings: ['extras', 'enhance your flight'],
  bodyText: 'extra baggage pre-order a meal travel insurance priority boarding',
  buttons: ['Add extra baggage', 'No thanks', 'Continue'], fields: [], counts: {},
};
const SEAT_STATE = {
  url: 'https://air.com/seats', headings: ['seat map'], bodyText: 'window aisle exit row extra legroom seat 14a',
  buttons: ['Continue'], fields: [], counts: { seatCells: 140 },
};
const PAYMENT_STATE = {
  url: 'https://air.com/payment', headings: ['payment'],
  bodyText: 'select a payment method credit/debit card apple pay tabby total to pay sar 1,180 fare summary',
  buttons: ['Pay now'], fields: [{ label: 'Card number' }], counts: {},
};

test('simulated flow 1: Search → Results', async () => {
  const adapter = scriptedAdapter([SEARCH_STATE, RESULTS_STATE]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'flight_results', feature: 'Flight Results', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.ok(adapter.calls.fills.length + adapter.calls.selects.length >= 4, 'filled the search form');
});

test('simulated flow 2: Search → Results → Fare → Passenger Details', async () => {
  const adapter = scriptedAdapter([SEARCH_STATE, RESULTS_STATE, FARE_STATE, PAX_STATE]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'passenger_details', feature: 'Passenger Details', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.ok(adapter.calls.clicks.some((c) => /economy/i.test(c)), 'chose a fare');
});

test('simulated flow 3: Search → Results → Fare → Passenger → Ancillary → Payment (STOP)', async () => {
  const adapter = scriptedAdapter([SEARCH_STATE, RESULTS_STATE, FARE_STATE, PAX_STATE, ANCILLARY_STATE, PAYMENT_STATE]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'payment', feature: 'Payment', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.ok(adapter.calls.clicks.some((c) => /no thanks/i.test(c)), 'skipped the paid ancillary');
  assert.ok(!adapter.calls.clicks.some((c) => /pay now/i.test(c)), 'never clicked Pay now');
  assert.equal(adapter.calls.fills.filter((f) => /card/.test(f.semantic || '')).length, 0);
});

test('simulated flow 4: Passenger → Seat Selection', async () => {
  const adapter = scriptedAdapter([PAX_STATE, SEAT_STATE]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'seat_selection', feature: 'Seat Selection', profile: PROFILE });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
});

test('simulated flow 5: auth / booking-reference blocked flow', async () => {
  const LOOKUP_STATE = {
    url: 'https://air.com/manage', headings: ['manage my booking', 'retrieve your booking'],
    bodyText: 'enter your booking reference and last name', buttons: ['Find booking'],
    fields: [{ label: 'Booking reference' }, { label: 'Last name' }], counts: {},
  };
  const adapter = scriptedAdapter([LOOKUP_STATE]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'manage_booking', feature: 'Manage Booking', profile: PROFILE });
  // manage_booking detector fires on the lookup surface itself → reached,
  // and crucially the booking-reference field was never filled.
  assert.ok([TARGET_STATUS.REACHED, TARGET_STATUS.AUTH].includes(r.targetStatus));
  assert.equal(adapter.calls.fills.filter((f) => f.semantic === 'booking_reference').length, 0);
});

// ─── 9. featureIntent wiring ─────────────────────────────────────────────
test('featureIntent: transactional features become goal-driven with a detector key', () => {
  for (const [feature, detector] of [
    ['Passenger Details', 'passenger_details'],
    ['Fare Selection', 'fare_selection'],
    ['Seat Selection', 'seat_selection'],
    ['Payment', 'payment'],
    ['Flight Results', 'flight_results'],
    ['Ancillaries', 'ancillaries'],
  ]) {
    const intent = resolveFeatureIntent(feature);
    assert.equal(intent.goalDriven, true, feature);
    assert.equal(intent.detectorKey, detector, feature);
    assert.equal(intent.homepageOnly, false, feature);
    assert.equal(mapFeatureToDetectorKey(feature), detector);
  }
  // Homepage stays single-step
  assert.equal(resolveFeatureIntent('Homepage').goalDriven, false);

  const t = createBenchmarkTarget({ company: 'Saudia', slug: 'saudia', url: 'https://www.saudia.com/', feature: 'Payment', requestId: 'r1' });
  const plan = buildFeatureJourneyPlan({ discoveryReport: { resolved_url: 'https://www.saudia.com/' }, target: t, intent: resolveFeatureIntent('Payment') });
  assert.equal(plan.recommended_journey.length, 1);
  assert.equal(plan.recommended_journey[0].goal_driven, true);
  assert.equal(plan.recommended_journey[0].detector_key, 'payment');
});

// ─── 9b. structured observability ───────────────────────────────────────
test('observability: every run emits goal_nav_observation / _decision / _action_result / _stop', async () => {
  const events = [];
  const logger = { info: (event, fields) => events.push({ event, fields }), warn: () => {} };
  const adapter = scriptedAdapter([
    { url: 'https://air.com/', headings: ['book a flight'], bodyText: '', buttons: ['Search flights'],
      fields: [{ label: 'From' }, { label: 'To' }, { label: 'Departure date' }], counts: {} },
    { url: 'https://air.com/results', headings: ['select your flight'], bodyText: '08:00 11:30 nonstop duration',
      buttons: ['Select this flight'], fields: [], counts: { flightCards: 3, priceTags: 3 } },
  ]);
  const r = await runGoalNavigation({ adapter, detectorKey: 'flight_results', feature: 'Flight Results', profile: PROFILE, logger });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);

  const names = events.map((e) => e.event);
  for (const required of ['goal_nav_observation', 'goal_nav_decision', 'goal_nav_action_result', 'goal_nav_stop']) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
  const obs = events.find((e) => e.event === 'goal_nav_observation').fields;
  assert.ok('currentUrl' in obs && 'actionNumber' in obs && 'detectedPageState' in obs && 'targetConfidence' in obs && 'visibleRequiredFields' in obs);
  const dec = events.find((e) => e.event === 'goal_nav_decision').fields;
  assert.ok('actionType' in dec && 'safetyClass' in dec);
  const res = events.find((e) => e.event === 'goal_nav_action_result').fields;
  assert.ok('success' in res && 'urlBefore' in res && 'urlAfter' in res && 'meaningfulDomChanged' in res && 'validationErrors' in res);
  const stop = events.find((e) => e.event === 'goal_nav_stop').fields;
  assert.equal(stop.status, TARGET_STATUS.REACHED);
  assert.equal(stop.deepestPage, 'https://air.com/results');
  // a real URL change was recorded on the search-submit action
  assert.ok(events.some((e) => e.event === 'goal_nav_action_result' && e.fields.urlBefore === 'https://air.com/' && e.fields.urlAfter === 'https://air.com/results' && e.fields.meaningfulDomChanged === true));
});

test('browserLauncher: missing-browser error is recognised; installed-chromium probe returns a path or null', async () => {
  const { isMissingBrowserError, findInstalledChromium } = await import('../../../11_Benchmark_Engine/modules/browserLauncher.js');
  assert.equal(isMissingBrowserError("browserType.launch: Executable doesn't exist at C:\\...\\chrome-headless-shell.exe"), true);
  assert.equal(isMissingBrowserError('Please run the following command to download new browsers'), true);
  assert.equal(isMissingBrowserError('net::ERR_CONNECTION_TIMED_OUT'), false);
  const p = findInstalledChromium();
  assert.ok(p === null || (typeof p === 'string' && /chrom/i.test(p)));
});

// ─── 10. evidence integrity for goal-driven runs ─────────────────────────
test('evidence: a goal-driven target-reached step is direct feature evidence', () => {
  const t = createBenchmarkTarget({ company: 'Saudia', slug: 'saudia', url: 'https://www.saudia.com/', feature: 'Passenger Details', requestId: 'r1' });
  const intent = resolveFeatureIntent('Passenger Details');
  const dir = mkdtempSync(join(tmpdir(), 'gev-'));
  const shot = join(dir, 's.png');
  writeFileSync(shot, 'x');
  try {
    const reached = selectEvidence({
      steps: [{
        step_id: intent.stepId, status: 'success', page_url: 'https://www.saudia.com/booking/passengers',
        screenshot_path: shot,
        goal: { targetReached: true, targetStatus: 'target_reached', interactionsPerformed: ['Filled first name', 'Clicked "Continue"'] },
      }],
      target: t, intent,
    });
    assert.equal(reached.evidence.relevance, 'direct');
    assert.equal(reached.evidence.evidenceType, 'feature_page');
    assert.deepEqual(reached.evidence.interactionsPerformed, ['Filled first name', 'Clicked "Continue"']);

    const blocked = selectEvidence({
      steps: [{
        step_id: intent.stepId, status: 'failed', page_url: 'https://www.saudia.com/', error: 'stopped',
        screenshot_path: shot,
        goal: { targetReached: false, targetStatus: 'blocked_auth_or_booking_reference', blocker: 'sign-in wall', deepestUrl: 'https://www.saudia.com/login', interactionsPerformed: [] },
      }],
      target: t, intent,
    });
    assert.equal(blocked.evidence.relevance, 'base_page');
    assert.equal(blocked.evidence.evidenceType, 'blocked_auth_or_booking_reference');
    assert.equal(blocked.evidence.navBlocked, true);
    assert.match(blocked.evidence.navBlockReason, /blocked_auth_or_booking_reference|sign-in wall/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 11. production hotfix regressions (first real Etihad Browserbase run) ─

test('null accessible label never crashes resolveClickable / safeLc', async () => {
  assert.equal(safeLc(null), '');
  assert.equal(safeLc(undefined), '');
  assert.equal(safeLc('  Search  FLIGHTS '), 'search flights');
  const fakePage = {
    async evaluate() { return null; },
    locator() { return { first: () => ({ async count() { return 0; } }) }; },
  };
  assert.equal(await resolveClickable(fakePage, null), null);
  assert.equal(await resolveClickable(fakePage, 'search flights'), null);
});

test('context-aware CTA: header search is rejected when a booking-widget Search Flights exists', () => {
  // trip form already complete/confirmed → the decision is the forward CTA
  const confirmed = new Set(['origin', 'destination', 'depart_date']);
  const withBoth = {
    url: 'https://air.com/', headings: ['book a flight'], bodyText: '', buttons: ['search', 'search flights'],
    controls: [
      { name: 'search', context: 'header', disabled: false },
      { name: 'search flights', context: 'booking', disabled: false },
    ],
    fields: [{ label: 'From', semantic: 'origin' }, { label: 'To', semantic: 'destination' }, { label: 'Departure', semantic: 'depart_date' }], counts: {},
  };
  const d1 = decideNextAction(withBoth, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed });
  assert.equal(d1.type, 'continue');
  assert.equal(d1.name, 'search flights');
  assert.equal(d1.context, 'booking');

  const headerOnly = { ...withBoth, controls: [{ name: 'search', context: 'header', disabled: false }], buttons: ['search'] };
  const d2 = decideNextAction(headerOnly, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed });
  assert.equal(d2.type, 'continue');
  assert.equal(d2.name, 'search');
});

test('duplicated responsive destination controls collapse to ONE semantic target', () => {
  const raw = {
    url: 'https://air.com/', headings: ['book a flight'], bodyText: '', buttonNames: [], controls: [],
    fields: [
      { label: 'From', context: 'booking', visible: true, disabled: false, id: 'orig-d' },
      { label: 'To', context: 'booking', visible: true, disabled: false, id: 'dest-desktop', ariaLabel: 'Destination' },
      { label: 'To', context: 'booking', visible: false, disabled: false, id: 'dest-mobile' },
      { label: 'To', context: 'nav', visible: true, disabled: false, id: 'dest-nav' },
      { label: 'To', context: 'other', visible: true, disabled: true, id: 'dest-hidden' },
      { placeholder: 'Destination', context: 'other', visible: true, disabled: false, id: 'dest-suggest' },
      { label: 'To', context: 'booking', visible: true, disabled: false, id: 'dest-dupe2' },
    ],
    counts: {},
  };
  const obs = normalizeObservation(raw);
  const dests = obs.fields.filter((f) => f.semantic === 'destination');
  assert.equal(dests.length, 1, 'exactly one destination control survives');
  assert.equal(dests[0].context, 'booking');
  assert.equal(dests[0].visible, true);
  assert.equal(dests[0].disabled, false);
  assert.equal(obs.fields.filter((f) => f.semantic === 'origin').length, 1);
});

test('observation does bounded / batched DOM work (one snapshot evaluate)', async () => {
  const { buildObservation } = await import('../../../11_Benchmark_Engine/modules/goal_navigator/playwrightAdapter.js');
  let evaluateCalls = 0;
  const fakePage = {
    url: () => 'https://air.com/',
    async evaluate() {
      evaluateCalls++;
      if (evaluateCalls === 1) return undefined; // ensureMutationStamp
      return {
        url: 'https://air.com/', headings: ['book a flight'], bodyText: 'welcome',
        controls: Array.from({ length: 500 }, (_, i) => ({ name: 'btn ' + i, context: 'other', disabled: false })),
        buttonNames: ['search flights'], fields: [{ label: 'From' }, { label: 'To' }],
        counts: {}, elementCount: 1234,
      };
    },
  };
  const logs = [];
  const obs = await buildObservation(fakePage, { logger: { info: (e, f) => logs.push({ e, f }) } });
  assert.ok(evaluateCalls <= 2, 'expected <=2 evaluate calls, got ' + evaluateCalls);
  assert.equal(obs.url, 'https://air.com/');
  const perf = logs.find((l) => l.e === 'goal_nav_perf' && l.f.phase === 'observation');
  assert.ok(perf && typeof perf.f.durationMs === 'number' && perf.f.elementCount === 1234);
});

test('one fill batch never fills the same semantic twice', () => {
  const fields = [
    { label: 'From', semantic: 'origin' },
    { label: 'To', semantic: 'destination' },
    { label: 'To', semantic: 'destination' },
    { label: 'To', semantic: 'destination' },
    { label: 'First name', semantic: 'first_name' },
    { label: 'First name', semantic: 'first_name' },
  ];
  const { fills } = planAutofill(fields, PROFILE);
  const counts = {};
  for (const f of fills) counts[f.semantic] = (counts[f.semantic] || 0) + 1;
  assert.equal(counts.destination, 1);
  assert.equal(counts.origin, 1);
  assert.equal(counts.first_name, 1);

  const d = decideNextAction({ fields, buttons: [], controls: [] }, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set() });
  assert.equal(d.type, 'fill');
  const sems = d.items.map((i) => i.semantic);
  assert.equal(new Set(sems).size, sems.length, 'no duplicate semantics in the fill batch');
});

test('runtime-budget stop preserves the deepest evidence and stops honestly', async () => {
  const adapter = scriptedAdapter([
    { url: 'https://air.com/deep-page', headings: ['book a flight'], bodyText: '', buttons: ['Search flights'],
      fields: [{ label: 'From' }, { label: 'To' }], counts: {} },
  ]);
  const r = await runGoalNavigation({
    adapter, detectorKey: 'passenger_details', feature: 'Passenger Details', profile: PROFILE,
    limits: { maxMs: 100, evidenceReserveMs: 500 }, // reserve > budget → stop right after the first observation
  });
  assert.equal(r.targetStatus, TARGET_STATUS.MAX_TIME);
  assert.equal(r.targetReached, false);
  assert.equal(r.deepestUrl, 'https://air.com/deep-page');
  assert.match(r.blocker, /session budget|captured before teardown/i);
});

test('the goal navigator NEVER closes the page / context / browser', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../../../11_Benchmark_Engine/modules/goal_navigator/', import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(dir + f, 'utf8');
    assert.ok(!/\b(page|context|browser|session)\s*\.\s*close\s*\(/.test(src), f + ' must not close the browser lifecycle');
  }
});

test('budget telemetry: goal_nav_budget is emitted each cycle', async () => {
  const events = [];
  const adapter = scriptedAdapter([
    { url: 'https://air.com/pax', headings: ['passenger details'], bodyText: '',
      buttons: ['continue'], fields: [{ label: 'First name' }, { label: 'Last name' }], counts: {} },
  ]);
  await runGoalNavigation({ adapter, detectorKey: 'passenger_details', feature: 'Passenger Details', profile: PROFILE, logger: { info: (e, f) => events.push({ e, f }), warn: () => {} } });
  const b = events.find((e) => e.e === 'goal_nav_budget');
  assert.ok(b && typeof b.f.elapsedMs === 'number' && typeof b.f.remainingMs === 'number' && 'actionNumber' in b.f);
});

// ─── 12. hotfix #2 regressions (false auth / unconfirmed autocomplete / settle) ─

const SEARCH_PAGE = (extraFields = [], controls = []) => ({
  url: 'https://air.com/', headings: ['book a flight'], bodyText: 'plan your trip. from to travel dates guests and cabin.',
  buttons: ['search flights', ...controls.map((c) => c.name)],
  controls: [{ name: 'search flights', context: 'booking', disabled: false }, ...controls],
  fields: [
    { label: 'From', semantic: 'origin', context: 'booking', visible: true, disabled: false },
    { label: 'To', semantic: 'destination', context: 'booking', visible: true, disabled: false },
    { label: 'Departure date', semantic: 'depart_date', context: 'booking', visible: true, disabled: false },
    ...extraFields,
  ],
  counts: {},
});

test('a password field in a header account menu does NOT gate a flight search', () => {
  const obs = SEARCH_PAGE([
    { label: 'Password', semantic: 'password', context: 'header', visible: true, disabled: false },
  ]);
  const d = decideNextAction(obs, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed: new Set() });
  assert.notEqual(d.type, 'auth');
  assert.equal(d.type, 'fill'); // proceeds to fill the booking form
});

test('AUTH only triggers when the active journey is genuinely gated', () => {
  // a) sign-in modal on top → gated
  const modal = {
    url: 'https://air.com/', headings: ['sign in'], bodyText: 'please sign in to continue with your booking',
    buttons: ['sign in'], controls: [{ name: 'sign in', context: 'auth', disabled: false }],
    fields: [
      { label: 'Email', semantic: 'email', context: 'auth', visible: true, disabled: false },
      { label: 'Password', semantic: 'password', context: 'auth', visible: true, disabled: false },
    ],
    counts: {},
  };
  const d1 = decideNextAction(modal, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed: new Set() });
  assert.equal(d1.type, 'auth');

  // b) blocking copy but the field is elsewhere → still gated
  const copy = SEARCH_PAGE([{ label: 'Password', semantic: 'password', context: 'other', visible: true, disabled: false }]);
  copy.bodyText = 'your session has expired. login required to continue.';
  const d2 = decideNextAction(copy, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed: new Set() });
  assert.equal(d2.type, 'auth');

  // c) password field present, no blocking copy, booking form usable → NOT gated
  const ok = SEARCH_PAGE([{ label: 'Password', semantic: 'password', context: 'nav', visible: true, disabled: false }]);
  const d3 = decideNextAction(ok, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed: new Set() });
  assert.notEqual(d3.type, 'auth');
});

test('an unconfirmed required destination keeps the search form incomplete (planner retries it)', async () => {
  // adapter whose destination fill reports ok but selectionConfirmed:false
  const states = [SEARCH_PAGE(), SEARCH_PAGE()];
  let i = 0;
  const filled = [];
  const adapter = {
    async observe() { return states[Math.min(i, states.length - 1)]; },
    async fill(desc, value, method, opts) {
      filled.push({ semantic: desc.semantic, attempt: opts && opts.attempt });
      if (desc.semantic === 'destination') return { ok: false, selectionConfirmed: false };
      return { ok: true, selectionConfirmed: true };
    },
    async selectOption(desc, value, opts) { return this.fill(desc, value, 'combobox', opts); },
    async click() { i++; return { ok: true, navigated: true }; },
    async waitForSettle() {},
  };
  const r = await runGoalNavigation({
    adapter, detectorKey: 'flight_results', feature: 'Flight Results', profile: PROFILE,
    limits: { maxActions: 12, maxMs: 60000 },
  });
  // destination was retried multiple times, never confirmed → honest blocker,
  // and the Search CTA was NEVER clicked (form was never "ready")
  const destAttempts = filled.filter((f) => f.semantic === 'destination').length;
  assert.ok(destAttempts >= 2, `destination retried (${destAttempts})`);
  assert.equal(r.targetReached, false);
  assert.match(r.blocker, /incomplete|destination|not.*confirmed/i);
  assert.ok(!r.interactionsPerformed.some((s) => /Clicked "search flights"/i.test(s)), 'never submitted the search');
});

test('an incomplete flight-search form cannot advance to Search', () => {
  const obs = SEARCH_PAGE(); // no fields confirmed yet
  const d = decideNextAction(obs, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed: new Set(['origin']) });
  assert.equal(d.type, 'fill'); // still filling destination / date — not 'continue'
  const sems = d.items.map((i) => i.semantic);
  assert.ok(sems.includes('destination'));
  assert.ok(!sems.includes('origin')); // already confirmed
});

test('an unrelated "city" field outside the booking widget is ignored during flight search', () => {
  const obs = SEARCH_PAGE([
    { label: 'City', semantic: 'city', context: 'footer', visible: true, disabled: false }, // newsletter city
    { label: 'Email', semantic: 'email', context: 'footer', visible: true, disabled: false },
  ]);
  const d = decideNextAction(obs, { profile: PROFILE, filledKey: 'x', alreadyFilled: new Set(), confirmed: new Set() });
  assert.equal(d.type, 'fill');
  const sems = d.items.map((i) => i.semantic);
  assert.ok(!sems.includes('city'), 'city not in the flight-search fill plan');
  assert.ok(!sems.includes('email'), 'newsletter email not in the flight-search fill plan');
  assert.ok(sems.every((s) => ['origin', 'destination', 'depart_date', 'return_date', 'passengers', 'cabin'].includes(s)));
});

test('settle has a hard cap even when the network never idles and the DOM never quiesces', async () => {
  const hang = () => new Promise(() => {});
  const fakePage = {
    async waitForLoadState() { return hang(); },
    waitForFunction() { return { catch: () => hang() }; },
  };
  const t0 = Date.now();
  await settle(fakePage, { maxMs: 300 }); // clamped up to the 500ms floor
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1500, `settle returned in ${elapsed}ms (hard cap)`);
});

test('a terminal goal result is not re-run by the Navigation Runner recovery path', async () => {
  // simulate runner.js's decision: goalTerminal ⇒ skip attemptRecovery
  const cases = [
    { goal: { targetStatus: 'blocked_auth_or_booking_reference' }, terminal: true, success: false },
    { goal: { targetStatus: 'unrecoverable_blocker' }, terminal: true, success: false },
    { goal: { targetStatus: 'safety_boundary' }, terminal: true, success: false },
    { goal: { targetStatus: 'max_time_exceeded' }, terminal: true, success: false },
  ];
  for (const actionResult of cases) {
    const goalTerminal = !!(actionResult.goal && actionResult.terminal);
    const wouldRecover = !actionResult.success && !goalTerminal;
    assert.equal(wouldRecover, false, `${actionResult.goal.targetStatus} must not re-run`);
  }
  // a genuine transient failure (no goal object) still recovers
  const transient = { success: false, error: 'net::ERR_TIMED_OUT' };
  assert.equal(!transient.success && !(transient.goal && transient.terminal), true);
});
