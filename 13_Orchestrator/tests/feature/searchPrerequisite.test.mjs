/**
 * Search prerequisite — deterministic trip-search fill + submit before the
 * autonomous agent. Regression for: flight_search:high on the homepage, the
 * agent spent ~156s on calendar interactions and never submitted the search.
 * Pure / injected only — no real browser, no network, no API calls.
 *
 * Observations are lowercased, exactly as the real observation builder hands
 * them to the feature detectors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-agent-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
process.env.BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || 'test-bb-key';
process.env.BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || 'test-bb-proj';

const { isSearchPrerequisiteRequired, runSearchPrerequisite, pickSearchControl, DOWNSTREAM_DETECTOR_KEYS } =
  await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/searchPrerequisite.js');
const { buildAgentInstruction } =
  await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/agentInstructions.js');
const { buildTestProfile } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/safeSyntheticProfile.js');

const FLIGHT_SEARCH_OBS = {
  url: 'https://airline.example/',
  headings: ['book a flight'],
  bodyText: 'where would you like to go? search flights',
  controls: [{ name: 'search flights' }, { name: 'sign in' }],
  fields: [
    { semantic: 'origin', label: 'from', hasValue: false, tag: 'trigger' },
    { semantic: 'destination', label: 'to', hasValue: false, tag: 'trigger' },
    { semantic: 'depart_date', label: 'departure date', hasValue: false },
    { semantic: 'passengers', label: 'passengers', hasValue: false },
    { semantic: 'cabin', label: 'cabin class', hasValue: false },
  ],
  counts: {},
};
const RESULTS_OBS = {
  url: 'https://airline.example/search/results',
  headings: ['select your flight'],
  bodyText: 'departure 09:00 arrival 12:30 non-stop',
  controls: [{ name: 'select flight 101' }],
  fields: [],
  counts: { flightCards: 2, priceTags: 2 },
};
const PROFILE = buildTestProfile();

test('PREREQUISITE: Passenger Details from a flight_search:high page IS required', () => {
  assert.ok(DOWNSTREAM_DETECTOR_KEYS.has('passenger_details'));
  assert.equal(isSearchPrerequisiteRequired({ detectorKey: 'passenger_details', observation: FLIGHT_SEARCH_OBS }), true);
});

test('PREREQUISITE: Seat Selection from a flight_search:high page IS required', () => {
  assert.equal(isSearchPrerequisiteRequired({ detectorKey: 'seat_selection', observation: FLIGHT_SEARCH_OBS }), true);
});

test('PREREQUISITE: a generic non-transactional target is NOT affected — existing navigation continues', () => {
  assert.equal(isSearchPrerequisiteRequired({ detectorKey: null, observation: FLIGHT_SEARCH_OBS }), false);
  assert.equal(isSearchPrerequisiteRequired({ detectorKey: 'flight_results', observation: FLIGHT_SEARCH_OBS }), false, 'a search target itself is not a downstream booking step');
});

test('PREREQUISITE: not required when the page is not a flight-search page', () => {
  assert.equal(isSearchPrerequisiteRequired({ detectorKey: 'passenger_details', observation: RESULTS_OBS }), false);
});

test('SAFE CONTROL PICK: picks the search control, never a purchase/booking/sign-in one', () => {
  assert.equal(pickSearchControl({ controls: [{ name: 'search flights' }] }), 'search flights');
  assert.equal(pickSearchControl({ controls: [{ name: 'pay now' }, { name: 'confirm booking' }, { name: 'sign in' }] }), null);
  assert.equal(pickSearchControl({ controls: [{ name: 'book now' }, { name: 'find flights' }] }), 'find flights');
  assert.equal(pickSearchControl({ controls: [{ name: 'continue to pay' }] }), null);
  assert.equal(pickSearchControl({ controls: [] }), null);
});

function fakeDeps({ fillOk = true, controls = [{ name: 'search flights' }], afterObs = RESULTS_OBS } = {}) {
  const calls = { fill: [], clicked: [] };
  let observeCount = 0;
  return {
    calls,
    deps: {
      observe: async () => (observeCount++ === 0 ? { ...FLIGHT_SEARCH_OBS, controls } : afterObs),
      fill: async (descriptor) => { calls.fill.push(descriptor.semantic); return { ok: fillOk, via: 'fill' }; },
      clickControl: async (name) => { calls.clicked.push(name); return true; },
      settle: async () => {},
      profile: PROFILE,
      logger: { info: () => {} },
    },
  };
}

test('PREREQUISITE PHASE: fills origin/destination/date and submits the search, then reports the progressed page', async () => {
  const { deps, calls } = fakeDeps();
  const r = await runSearchPrerequisite(deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.submitted, true);
  assert.deepEqual(calls.fill.filter((s) => ['origin', 'destination', 'depart_date'].includes(s)).sort(), ['depart_date', 'destination', 'origin']);
  assert.deepEqual(calls.clicked, ['search flights']);
  assert.equal(r.urlAfter, RESULTS_OBS.url);
  assert.match(r.pageStateAfter, /flight_results/);
});

test('PREREQUISITE PHASE fallback: a required trip field cannot be resolved → ok:false, nothing submitted, agent takes over', async () => {
  const obsNoOrigin = { ...FLIGHT_SEARCH_OBS, fields: FLIGHT_SEARCH_OBS.fields.filter((f) => f.semantic !== 'origin') };
  const { deps, calls } = fakeDeps();
  deps.observe = async () => obsNoOrigin;
  const r = await runSearchPrerequisite(deps);
  assert.equal(r.ok, false);
  assert.equal(r.submitted, false);
  assert.match(r.reason, /origin/);
  assert.equal(calls.clicked.length, 0, 'never submits when a required field is missing');
});

test('PREREQUISITE PHASE fallback: deterministic fill of a REQUIRED field fails → ok:false, no submit', async () => {
  const { deps, calls } = fakeDeps({ fillOk: false });
  const r = await runSearchPrerequisite(deps);
  assert.equal(r.ok, false);
  assert.equal(r.submitted, false);
  assert.match(r.reason, /not deterministically fillable/);
  assert.equal(calls.clicked.length, 0);
});

test('PREREQUISITE PHASE: a purchase/sign-in control is never clicked — the click is never even attempted', async () => {
  const { deps, calls } = fakeDeps({ controls: [{ name: 'pay now' }] });
  const r = await runSearchPrerequisite(deps);
  assert.equal(r.ok, false);
  assert.equal(r.submitted, false);
  assert.match(r.reason, /no safe search control/);
  assert.equal(calls.clicked.length, 0, 'the unsafe control is never clicked');
});

test('PREREQUISITE PHASE fallback: search submitted but the page did not progress → ok:false, honest', async () => {
  const { deps, calls } = fakeDeps({ afterObs: FLIGHT_SEARCH_OBS });
  const r = await runSearchPrerequisite(deps);
  assert.equal(r.ok, false);
  assert.equal(r.submitted, true);
  assert.match(r.reason, /did not progress/);
  assert.equal(calls.clicked.length, 1);
});

test('PREREQUISITE PHASE: a thrown error inside the phase never escapes — returned as a fallback result', async () => {
  const { deps } = fakeDeps();
  deps.observe = async () => { throw new Error('page closed'); };
  const r = await runSearchPrerequisite(deps);
  assert.equal(r.ok, false);
  assert.match(r.reason, /prerequisite error/);
});

test('PREREQUISITE PHASE timeout: a timed-out run starts NO further actions after it gives up', async () => {
  let starts = 0;
  const r = await runSearchPrerequisite({
    observe: async () => FLIGHT_SEARCH_OBS,
    // each fill takes 30ms; the phase is given only 20ms in total
    fill: async () => { starts++; await new Promise((res) => setTimeout(res, 30)); return { ok: true }; },
    clickControl: async () => true,
    settle: async () => {},
    profile: PROFILE,
    timeoutMs: 20,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /prerequisite error/);
  const atTimeout = starts;
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(starts, atTimeout, 'no new action may start once the phase has timed out');
});

test('AGENT INSTRUCTION: after a submitted prerequisite the agent is told the search is done, not that the homepage is open', () => {
  const after = buildAgentInstruction({ company: 'X', feature: 'Passenger Details', startingUrl: 'https://x.example/', searchAlreadySubmitted: true });
  assert.match(after, /ALREADY filled and submitted/);
  assert.doesNotMatch(after, /homepage is already open/);
  const before = buildAgentInstruction({ company: 'X', feature: 'Passenger Details', startingUrl: 'https://x.example/' });
  assert.match(before, /homepage is already open/);
});
