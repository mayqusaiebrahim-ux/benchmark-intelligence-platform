/**
 * Autonomous (agent-first) navigation — safety, independent verification,
 * fake-success rejection, budget, lifecycle, fallback, telemetry.
 * No real browser, no Stagehand, no network: a fake page + a fake Stagehand
 * factory drive runAutonomousNavigation().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-agent-key';
process.env.BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || 'test-bb-key';
process.env.BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || 'test-bb-proj';

const {
  runAutonomousNavigation, agentModeAvailable, detectAgentLlm, AgentNavUnavailableError, TARGET_STATUS,
} = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/autonomousNavigator.js');
const { SAFETY_INIT_SCRIPT, safetyProbe } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/safetyPolicy.js');
const { scrub } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/navigationTelemetry.js');
const { verifyTarget } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/targetVerifier.js');
const { toAgentVariables, buildTestProfile } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/safeSyntheticProfile.js');

// ── fakes ────────────────────────────────────────────────────────────────
function fakePage(cfg = {}) {
  let currentUrl = cfg.url || 'https://air.com/';
  const snapshots = cfg.snapshots || null; // array, consumed per DOM_SNAPSHOT call
  let snapIdx = 0;
  const p = {
    _initScripts: [],
    _shots: [],
    url: () => currentUrl,
    async title() { return cfg.title || 'Airline'; },
    async goto(u) { currentUrl = u; },
    async addInitScript(s) { p._initScripts.push(String(s)); },
    async screenshot({ path }) { const { writeFileSync } = await import('node:fs'); writeFileSync(path, Buffer.from('89504e470d0a1a0a', 'hex')); p._shots.push(path); },
    async content() { return cfg.html || '<html><body></body></html>'; },
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('__benchSafety')) return cfg.safetyBlocks ? cfg.safetyBlocks.splice(0) : [];
      if (src.includes('__gnMutObs') || src.includes('__gnMut')) return undefined;
      if (src.includes('outerHTML')) return cfg.html || '<html></html>';
      // DOM_SNAPSHOT
      const base = { url: currentUrl, headings: [], bodyText: '', controls: [], buttonNames: [], fields: [], counts: {}, elementCount: 0 };
      if (snapshots) { const s = snapshots[Math.min(snapIdx++, snapshots.length - 1)]; return { ...base, ...s, url: currentUrl }; }
      return { ...base, ...(cfg.snapshot || {}) };
    },
  };
  return p;
}

function fakeStagehand(cfg = {}) {
  const state = { closed: false, acted: 0, execOpts: null, inited: false };
  const page = cfg.page || fakePage(cfg.pageCfg);
  const sh = {
    _state: state,
    context: { activePage: () => page },
    async init() { if (cfg.initThrows) throw cfg.initThrows; state.inited = true; },
    async act() { state.acted++; if (cfg.actThrows) throw cfg.actThrows; },
    agent() {
      return {
        execute: async (opts) => {
          state.execOpts = opts;
          if (typeof cfg.agentResult === 'function') return cfg.agentResult(opts, page);
          if (cfg.agentThrows) throw cfg.agentThrows;
          return cfg.agentResult || { message: 'done', actions: [], completed: false };
        },
      };
    },
    async close() { state.closed = true; },
  };
  return { sh, state, page };
}

const PAX_SNAPSHOT = {
  headings: ['passenger details'], bodyText: 'contact details',
  fields: [{ semantic: 'first_name', context: 'booking', visible: true }, { semantic: 'last_name', context: 'booking', visible: true }, { semantic: 'date_of_birth', context: 'booking', visible: true }],
  controls: [{ name: 'continue', context: 'booking' }],
};
const HOME_SNAPSHOT = {
  headings: ['book a flight'], bodyText: 'welcome',
  fields: [{ semantic: 'origin', context: 'booking', visible: true }, { semantic: 'destination', context: 'booking', visible: true }],
  controls: [{ name: 'search flights', context: 'booking' }],
};

// ── 1. deterministic safety: the injected guard is real code, sourced from
//      the shared denylist ──────────────────────────────────────────────
test('SAFETY_INIT_SCRIPT is deterministic code built from the shared transaction/auth denylist', () => {
  assert.equal(typeof SAFETY_INIT_SCRIPT, 'string');
  assert.ok(SAFETY_INIT_SCRIPT.includes('__benchSafety'));
  assert.ok(SAFETY_INIT_SCRIPT.includes("'click'") && SAFETY_INIT_SCRIPT.includes('addEventListener'));
  assert.ok(SAFETY_INIT_SCRIPT.includes("'submit'"));
  assert.ok(SAFETY_INIT_SCRIPT.includes('preventDefault'));
  assert.ok(SAFETY_INIT_SCRIPT.includes('stopImmediatePropagation'));
  assert.ok(/readOnly\s*=\s*true/.test(SAFETY_INIT_SCRIPT));            // card/password inputs neutralised
  assert.ok(SAFETY_INIT_SCRIPT.includes('HTMLFormElement.prototype.submit')); // programmatic submit blocked
  // it must be a self-contained IIFE (safe to inject)
  assert.ok(SAFETY_INIT_SCRIPT.trim().startsWith('(') || SAFETY_INIT_SCRIPT.includes('(() =>'));
});

test('the guard is injected before navigation, on the agent session page', async () => {
  const { sh, page } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT } });
  await runAutonomousNavigation({
    startingUrl: 'https://air.com/', company: 'Air', feature: 'Passenger Details', detectorKey: 'passenger_details',
    limits: { maxMs: 400, probeIntervalMs: 100000 },
    stagehandFactory: async () => sh,
  });
  assert.ok(page._initScripts.some((s) => s.includes('__benchSafety')), 'safety init script was added');
});

// ── 2. independent target verification ──────────────────────────────────
test('verifyTarget confirms Passenger Details from the live DOM, not the agent', async () => {
  const paxPage = fakePage({ snapshot: PAX_SNAPSHOT });
  const v = await verifyTarget(paxPage, 'passenger_details');
  assert.equal(v.reached, true);
  assert.ok(['medium', 'high'].includes(v.confidence));

  const homePage = fakePage({ snapshot: HOME_SNAPSHOT });
  const v2 = await verifyTarget(homePage, 'passenger_details');
  assert.equal(v2.reached, false);
});

// ── 3. fake agent success is REJECTED ──────────────────────────────────
test('agent claims completion on the homepage → run is NOT marked reached', async () => {
  const { sh } = fakeStagehand({
    pageCfg: { snapshot: HOME_SNAPSHOT }, // still the homepage
    agentResult: { message: 'I have reached the Passenger Details page.', actions: [{ type: 'act' }], completed: true },
  });
  const r = await runAutonomousNavigation({
    startingUrl: 'https://air.com/', company: 'Air', feature: 'Passenger Details', detectorKey: 'passenger_details',
    limits: { maxMs: 800, probeIntervalMs: 100000 },
    stagehandFactory: async () => sh,
  });
  assert.equal(r.targetReached, false);
  assert.equal(r.targetStatus, TARGET_STATUS.BLOCKER);
  assert.match(r.blocker, /detector did not confirm|agent reported completion/i);
});

test('agent completes AND the detector confirms → reached', async () => {
  // page shows the passenger form by the time the agent finishes
  const paxPage = fakePage({ snapshot: PAX_SNAPSHOT, url: 'https://air.com/booking/passengers' });
  const { sh } = fakeStagehand({
    page: paxPage,
    agentResult: { message: 'Reached passenger details.', actions: [{ type: 'goto' }, { type: 'act' }, { type: 'fillForm' }], completed: true },
  });
  const r = await runAutonomousNavigation({
    startingUrl: 'https://air.com/', company: 'Air', feature: 'Passenger Details', detectorKey: 'passenger_details',
    limits: { maxMs: 800, probeIntervalMs: 100000 },
    stagehandFactory: async () => sh,
  });
  assert.equal(r.targetReached, true);
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.equal(r.evidenceOverride && existsSync(r.evidenceOverride.screenshotPath), true);
});

// ── 4. payment stops before transaction ───────────────────────────────
test('safetyProbe: card fields + a Pay control when target is not payment → violation', () => {
  const obs = {
    fields: [{ semantic: 'card_number', context: 'form', visible: true }],
    controls: [{ name: 'Pay now', context: 'form' }],
    bodyText: 'total to pay',
  };
  assert.equal(safetyProbe(obs, 'seat_selection').violation, true);
  // same page, but the TARGET is payment → reaching it is allowed (not a violation by itself)
  assert.equal(safetyProbe(obs, 'payment').violation, false);
  // an OTP challenge is never allowed
  assert.equal(safetyProbe({ fields: [], controls: [], bodyText: 'enter the one-time code we sent to your phone' }, 'payment').violation, true);
});

test('watchdog aborts the agent when a transaction-imminent state appears (target ≠ payment)', async () => {
  const dangerPage = fakePage({
    snapshot: { fields: [{ semantic: 'card_number', context: 'form', visible: true }], controls: [{ name: 'Pay now', context: 'form' }], bodyText: 'total to pay sar 1200' },
  });
  let aborted = false;
  const { sh } = fakeStagehand({
    page: dangerPage,
    agentResult: (opts) => new Promise((resolve) => {
      opts.signal.addEventListener('abort', () => { aborted = true; resolve({ message: 'aborted', actions: [], completed: false, _error: Object.assign(new Error('aborted'), { name: 'AbortError' }) }); });
    }),
  });
  const r = await runAutonomousNavigation({
    startingUrl: 'https://air.com/', company: 'Air', feature: 'Seat Selection', detectorKey: 'seat_selection',
    limits: { maxMs: 5000, probeIntervalMs: 60 },
    stagehandFactory: async () => sh,
  });
  assert.equal(aborted, true, 'agent was signalled to abort');
  assert.equal(r.targetStatus, TARGET_STATUS.SAFETY);
  assert.equal(r.targetReached, false);
  assert.ok(r.safetyBlocks.length >= 1);
});

// ── 5. budget stop preserves screenshot ──────────────────────────────
test('a tight time budget stops the run and still captures terminal evidence', async () => {
  const { sh } = fakeStagehand({
    pageCfg: { snapshot: HOME_SNAPSHOT },
    agentResult: (opts) => new Promise((resolve) => { opts.signal.addEventListener('abort', () => resolve({ message: 'timed out', actions: [], completed: false })); }),
  });
  const r = await runAutonomousNavigation({
    startingUrl: 'https://air.com/', company: 'Air', feature: 'Payment', detectorKey: 'payment',
    limits: { maxMs: 250, evidenceReserveMs: 100, probeIntervalMs: 60 },
    stagehandFactory: async () => sh,
  });
  assert.equal(r.targetReached, false);
  assert.equal(r.targetStatus, TARGET_STATUS.MAX_TIME);
  assert.ok(r.evidenceOverride && existsSync(r.evidenceOverride.screenshotPath), 'terminal screenshot captured before teardown');
});

// ── 6. browser lifecycle ───────────────────────────────────────────────
test('the autonomous navigator ALWAYS closes its own Stagehand session', async () => {
  const { sh, state } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentThrows: new Error('mid-run explosion') });
  await runAutonomousNavigation({
    startingUrl: 'https://air.com/', company: 'Air', feature: 'Payment', detectorKey: 'payment',
    limits: { maxMs: 500, probeIntervalMs: 100000 },
    stagehandFactory: async () => sh,
  });
  assert.equal(state.closed, true, 'stagehand.close() ran even though the agent threw');
});

test('autonomous_navigator source never closes a page/context/browser it does not own', async () => {
  const dir = fileURLToPath(new URL('../../../11_Benchmark_Engine/modules/autonomous_navigator/', import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(dir + f, 'utf8');
    // the ONLY close() call allowed is `sh.close()` on the navigator's own instance
    const badCloses = (src.match(/\b(page|context|browser)\s*\.\s*close\s*\(/g) || []);
    assert.deepEqual(badCloses, [], `${f} must not close a page/context/browser`);
  }
});

// ── 7. fallback ───────────────────────────────────────────────────────
test('agentModeAvailable reflects credentials', () => {
  assert.equal(typeof agentModeAvailable(), 'boolean');
  assert.ok(detectAgentLlm()); // ANTHROPIC_API_KEY is set in this test process
});

test('a factory that throws AgentNavUnavailableError propagates (caller falls back)', async () => {
  await assert.rejects(
    () => runAutonomousNavigation({
      startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment',
      stagehandFactory: async () => { throw new AgentNavUnavailableError('no creds'); },
    }),
    (e) => e instanceof AgentNavUnavailableError,
  );
});

test('a non-Unavailable crash inside the run resolves to an honest BLOCKER (not a throw)', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, initThrows: new Error('CDP connect failed') });
  const r = await runAutonomousNavigation({
    startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment',
    limits: { maxMs: 500, probeIntervalMs: 100000 },
    stagehandFactory: async () => sh,
  });
  assert.equal(r.targetReached, false);
  assert.equal(r.targetStatus, TARGET_STATUS.BLOCKER);
  assert.match(r.blocker, /crashed|CDP connect failed/i);
});

// ── 8. telemetry + redaction ──────────────────────────────────────────
test('telemetry scrub() redacts synthetic values and variable placeholders', () => {
  assert.match(scrub('email is benchmark.test.traveler@example.com now'), /‹redacted›/);
  assert.match(scrub('typed %firstName% into the field'), /‹redacted›/);
  assert.match(scrub('passenger Test Traveler dob 1990-01-15'), /‹redacted›/);
  assert.doesNotMatch(scrub('clicked Search flights'), /‹redacted›/);
});

test('agent variables carry descriptions and only synthetic values', () => {
  const vars = toAgentVariables(buildTestProfile());
  assert.equal(vars.originCode.value, 'JED');
  assert.match(vars.email.value, /@example\.com$/);
  for (const [, v] of Object.entries(vars)) {
    assert.equal(typeof v.value, 'string');
    assert.equal(typeof v.description, 'string');
    assert.ok(v.description.length > 3);
  }
});

test('agent_nav telemetry events are emitted for a run', async () => {
  const events = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...a) => { const s = String(chunk); if (s.includes('agent_nav_')) { try { events.push(JSON.parse(s).message); } catch { /* not json line */ } } return origWrite(chunk, ...a); };
  try {
    const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [{ type: 'act' }], completed: false } });
    await runAutonomousNavigation({
      startingUrl: 'https://air.com/', company: 'Air', feature: 'Payment', detectorKey: 'payment',
      limits: { maxMs: 400, probeIntervalMs: 100000 },
      stagehandFactory: async () => sh,
    });
  } finally {
    process.stdout.write = origWrite;
  }
  assert.ok(events.includes('agent_nav_start'), 'agent_nav_start emitted');
  assert.ok(events.includes('agent_nav_stop'), 'agent_nav_stop emitted');
});
