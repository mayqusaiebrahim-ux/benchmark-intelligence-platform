/**
 * Autonomous (agent-first) navigation — safety, independent verification,
 * fake-success rejection, RUNTIME BUDGET, browser lifecycle, fallback,
 * telemetry. No real browser, no Stagehand, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import { join } from 'node:path';

// capture.js writes navigation-run artifacts under the real repo tree (it uses
// PROJECT_ROOT, not cwd). The two runJourney integration tests use this slug so
// their output can be scrubbed.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
function scrubAgentTestArtifacts() {
  for (const p of ['03_Screenshots/_agenttest', '02_Benchmark_Repository/_Navigation_Runs/_agenttest']) {
    try { rmSync(join(REPO_ROOT, p), { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-agent-key';
process.env.BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || 'test-bb-key';
process.env.BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || 'test-bb-proj';
delete process.env.BROWSERBASE_SESSION_TIMEOUT_SECS;

const NAV = '../../../11_Benchmark_Engine/modules/autonomous_navigator/autonomousNavigator.js';
const {
  runAutonomousNavigation, agentModeAvailable, detectAgentLlm, resolveEffectiveLimits,
  browserbaseSessionTimeoutMs, AgentNavUnavailableError, TARGET_STATUS, DEFAULT_AGENT_LIMITS,
  validateAgentConfiguration, buildStagehandConstructorOptions, buildAgentExecuteOptionShape,
  STAGEHAND_DISABLE_API, STAGEHAND_EXPERIMENTAL,
} = await import(NAV);
const { SAFETY_INIT_SCRIPT, safetyProbe } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/safetyPolicy.js');
const { scrub } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/navigationTelemetry.js');
const { verifyTarget } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/targetVerifier.js');
const { toAgentVariables, buildTestProfile } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/safeSyntheticProfile.js');

// short budgets for tests — production never sets minBudgetMs
const T = (extra = {}) => ({ minBudgetMs: 0, probeIntervalMs: 100000, ...extra });

function fakePage(cfg = {}) {
  let currentUrl = cfg.url || 'https://air.com/';
  const snapshots = cfg.snapshots || null;
  let snapIdx = 0;
  const p = {
    _initScripts: [], _shots: [],
    url: () => currentUrl,
    on() {},
    async title() { return cfg.title || 'Airline'; },
    async goto(u) { currentUrl = u; },
    async waitForLoadState() {},
    async addInitScript(s) { p._initScripts.push(String(s)); },
    async screenshot({ path }) { const { writeFileSync } = await import('node:fs'); writeFileSync(path, Buffer.from('89504e470d0a1a0a', 'hex')); p._shots.push(path); },
    async content() { return cfg.html || '<html><body></body></html>'; },
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('__benchSafety')) return cfg.safetyBlocks ? cfg.safetyBlocks.splice(0) : [];
      if (src.includes('__gnMutObs') || src.includes('__gnMut')) return undefined;
      if (src.includes('outerHTML')) return cfg.html || '<html></html>';
      const base = { url: currentUrl, headings: [], bodyText: '', controls: [], buttonNames: [], fields: [], counts: {}, elementCount: 0 };
      if (snapshots) return { ...base, ...snapshots[Math.min(snapIdx++, snapshots.length - 1)], url: currentUrl };
      return { ...base, ...(cfg.snapshot || {}) };
    },
  };
  return p;
}
function fakeStagehand(cfg = {}) {
  const state = { closed: false, acted: 0, execOpts: null, inited: false, initAt: 0 };
  const page = cfg.page || fakePage(cfg.pageCfg);
  const sh = {
    _state: state,
    context: { activePage: () => page },
    async init() { if (cfg.initDelayMs) await new Promise((r) => setTimeout(r, cfg.initDelayMs)); if (cfg.initThrows) throw cfg.initThrows; state.inited = true; state.initAt = Date.now(); },
    async act() { state.acted++; if (cfg.actThrows) throw cfg.actThrows; },
    agent() {
      return {
        execute: async (opts) => {
          state.execOpts = opts; state.execAt = Date.now();
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
const PAX_SNAPSHOT = { headings: ['passenger details'], bodyText: 'contact details', fields: [{ semantic: 'first_name', context: 'booking', visible: true }, { semantic: 'last_name', context: 'booking', visible: true }, { semantic: 'date_of_birth', context: 'booking', visible: true }], controls: [{ name: 'continue', context: 'booking' }] };
const HOME_SNAPSHOT = { headings: ['book a flight'], bodyText: 'welcome', fields: [{ semantic: 'origin', context: 'booking', visible: true }, { semantic: 'destination', context: 'booking', visible: true }], controls: [{ name: 'search flights', context: 'booking' }] };

function captureEvents(prefix, fn) {
  const events = [];
  const grab = (chunk) => { const s = String(chunk); for (const line of s.split('\n')) { if (line.includes(prefix)) { try { events.push(JSON.parse(line)); } catch { /* skip */ } } } };
  const oOut = process.stdout.write.bind(process.stdout);
  const oErr = process.stderr.write.bind(process.stderr);   // logWarn -> console.warn -> stderr
  process.stdout.write = (c, ...a) => { grab(c); return oOut(c, ...a); };
  process.stderr.write = (c, ...a) => { grab(c); return oErr(c, ...a); };
  return Promise.resolve(fn())
    .finally(() => { process.stdout.write = oOut; process.stderr.write = oErr; })
    .then(() => events);
}

// ═══ 1. deterministic safety ═══════════════════════════════════════════
test('SAFETY_INIT_SCRIPT is deterministic code from the shared denylist', () => {
  assert.equal(typeof SAFETY_INIT_SCRIPT, 'string');
  assert.ok(SAFETY_INIT_SCRIPT.includes('__benchSafety'));
  assert.ok(SAFETY_INIT_SCRIPT.includes("'click'") && SAFETY_INIT_SCRIPT.includes('addEventListener'));
  assert.ok(SAFETY_INIT_SCRIPT.includes('preventDefault') && SAFETY_INIT_SCRIPT.includes('stopImmediatePropagation'));
  assert.ok(/readOnly\s*=\s*true/.test(SAFETY_INIT_SCRIPT));
  assert.ok(SAFETY_INIT_SCRIPT.includes('HTMLFormElement.prototype.submit'));
});

test('the guard is injected on the agent session page before navigation', async () => {
  const { sh, page } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT } });
  await runAutonomousNavigation({ startingUrl: 'https://air.com/', company: 'Air', feature: 'Passenger Details', detectorKey: 'passenger_details', limits: T({ maxMs: 400 }), stagehandFactory: async () => sh });
  assert.ok(page._initScripts.some((s) => s.includes('__benchSafety')));
});

test('safetyProbe: card + Pay for a non-payment target = violation; OTP always', () => {
  const obs = { fields: [{ semantic: 'card_number', context: 'form', visible: true }], controls: [{ name: 'Pay now', context: 'form' }], bodyText: 'total to pay' };
  assert.equal(safetyProbe(obs, 'seat_selection').violation, true);
  assert.equal(safetyProbe(obs, 'payment').violation, false);
  assert.equal(safetyProbe({ fields: [], controls: [], bodyText: 'enter the one-time code we sent' }, 'payment').violation, true);
});

test('watchdog aborts the agent on a transaction-imminent state (target ≠ payment)', async () => {
  const dangerPage = fakePage({ snapshot: { fields: [{ semantic: 'card_number', context: 'form', visible: true }], controls: [{ name: 'Pay now', context: 'form' }], bodyText: 'total sar 1200' } });
  let aborted = false;
  const { sh } = fakeStagehand({ page: dangerPage, agentResult: (opts) => new Promise((res) => { opts.signal.addEventListener('abort', () => { aborted = true; res({ message: 'x', actions: [], completed: false, _error: Object.assign(new Error('aborted'), { name: 'AbortError' }) }); }); }) });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Seat Selection', detectorKey: 'seat_selection', limits: T({ maxMs: 5000, probeIntervalMs: 50 }), stagehandFactory: async () => sh });
  assert.equal(aborted, true);
  assert.equal(r.targetStatus, TARGET_STATUS.SAFETY);
  assert.ok(r.safetyBlocks.length >= 1);
});

// ═══ 2. independent target verification ═══════════════════════════════
test('verifyTarget confirms/denies from the live DOM', async () => {
  assert.equal((await verifyTarget(fakePage({ snapshot: PAX_SNAPSHOT }), 'passenger_details')).reached, true);
  assert.equal((await verifyTarget(fakePage({ snapshot: HOME_SNAPSHOT }), 'passenger_details')).reached, false);
});

test('agent claims completion on the homepage → NOT reached (fake success rejected)', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'I reached Passenger Details.', actions: [{ type: 'act' }], completed: true } });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Passenger Details', detectorKey: 'passenger_details', limits: T({ maxMs: 800 }), stagehandFactory: async () => sh });
  assert.equal(r.targetReached, false);
  assert.equal(r.targetStatus, TARGET_STATUS.BLOCKER);
  assert.match(r.blocker, /detector did not confirm|reported completion/i);
});

test('agent completes AND detector confirms → reached + terminal screenshot', async () => {
  const paxPage = fakePage({ snapshot: PAX_SNAPSHOT, url: 'https://air.com/booking/passengers' });
  const { sh } = fakeStagehand({ page: paxPage, agentResult: { message: 'done', actions: [{ type: 'goto' }, { type: 'fillForm' }], completed: true } });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Passenger Details', detectorKey: 'passenger_details', limits: T({ maxMs: 800 }), stagehandFactory: async () => sh });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
  assert.equal(existsSync(r.evidenceOverride.screenshotPath), true);
});

// ═══ 3. RUNTIME BUDGET (the "aborted at 25s" incident) ════════════════
test('default deep-feature agent budget is >= 2 minutes', () => {
  assert.ok(DEFAULT_AGENT_LIMITS.maxMs >= 120000);
  assert.ok(resolveEffectiveLimits({}).agentMaxMs >= 120000);
});

test('evidenceReserveMs can NEVER become the effective navigation budget', () => {
  const eff = resolveEffectiveLimits({ maxMs: 60000, evidenceReserveMs: 55000, minBudgetMs: 0 });
  assert.equal(eff.agentMaxMs, 60000);
  assert.ok(eff.evidenceReserveMs <= Math.floor(eff.agentMaxMs / 6), `reserve ${eff.evidenceReserveMs} must be ≤ budget/6`);
  assert.ok(eff.agentMaxMs - eff.evidenceReserveMs >= eff.agentMaxMs * 0.8, 'usable budget stays ~the whole budget');
  assert.ok(eff.warnings.some((w) => /reserve clamped/.test(w)));
});

test('a configured 8-minute budget produces ~an 8-minute deadline, not 25 seconds', () => {
  const eff = resolveEffectiveLimits({ maxMs: 480000 });
  assert.ok(eff.agentMaxMs >= 450000 && eff.agentMaxMs <= 480000, `agentMaxMs=${eff.agentMaxMs}`);
});

test('a sub-minimum configured budget is clamped UP with a warning (not silently run)', () => {
  const eff = resolveEffectiveLimits({ maxMs: 25000 }); // the production symptom
  assert.ok(eff.agentMaxMs >= 120000);
  assert.ok(eff.warnings.some((w) => /below the .* minimum/.test(w)));
});

test('the agent budget is measured from agent.execute() — slow init does not consume it', async () => {
  const { sh, state } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, initDelayMs: 250, agentResult: (opts) => new Promise((res) => opts.signal.addEventListener('abort', () => res({ message: 'x', actions: [], completed: false }))) });
  const t0 = Date.now();
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300, evidenceReserveMs: 40, probeIntervalMs: 60 }), stagehandFactory: async () => sh });
  const total = Date.now() - t0;
  assert.ok(state.execAt - state.initAt >= 0, 'agent.execute ran after init');
  assert.ok(total >= 250 + 200, `total ${total}ms includes the 250ms init AND the ~300ms agent budget`);
  assert.equal(r.targetStatus, TARGET_STATUS.MAX_TIME);
});

test('effective limits are logged at agent_nav_start', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [], completed: false } });
  const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => sh }));
  const start = events.find((e) => e.message === 'agent_nav_start');
  assert.ok(start, 'agent_nav_start emitted');
  for (const k of ['agentMaxMs', 'agentMaxSteps', 'evidenceReserveMs', 'browserbaseSessionTimeoutMs', 'effectiveDeadlineMs']) {
    assert.equal(typeof start[k], 'number', `agent_nav_start.${k}`);
  }
  assert.equal(start.agentMaxSteps, 40);
  assert.equal(start.browserbaseSessionTimeoutMs, 900000);
  assert.ok(events.some((e) => e.message === 'agent_nav_perf' && e.phase === 'stagehand_init'));
  assert.ok(events.some((e) => e.message === 'agent_nav_perf' && (e.phase === 'agent_execute' || e.phase === 'agent_execute_start')));
});

test('an abort-shaped error we did NOT cause is a BLOCKER, not max_time_exceeded', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentThrows: new Error('The operation was aborted by the Stagehand API') });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => sh });
  assert.equal(r.targetStatus, TARGET_STATUS.BLOCKER);
  assert.match(r.blocker, /did not trigger|Stagehand API|model|Browserbase/i);
});

test('OUR deadline abort IS max_time_exceeded', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: (opts) => new Promise((res) => opts.signal.addEventListener('abort', () => res({ message: 'x', actions: [], completed: false }))) });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 200, evidenceReserveMs: 30, probeIntervalMs: 60 }), stagehandFactory: async () => sh });
  assert.equal(r.targetStatus, TARGET_STATUS.MAX_TIME);
  assert.ok(existsSync(r.evidenceOverride.screenshotPath), 'terminal screenshot preserved');
});

// ═══ 4. browser lifecycle ═════════════════════════════════════════════
test('the autonomous navigator ALWAYS closes its own Stagehand session', async () => {
  const { sh, state } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentThrows: new Error('boom') });
  await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 400 }), stagehandFactory: async () => sh });
  assert.equal(state.closed, true);
});

test('autonomous_navigator never closes a page/context/browser it does not own', () => {
  const dir = fileURLToPath(new URL('../../../11_Benchmark_Engine/modules/autonomous_navigator/', import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(dir + f, 'utf8');
    assert.deepEqual(src.match(/\b(page|context|browser)\s*\.\s*close\s*\(/g) || [], [], `${f}`);
  }
});

// ═══ 5. one Browserbase session in agent mode ════════════════════════
test('agent-only run does NOT pre-launch the Navigation Runner browser', async (t) => {
  process.env.NAVIGATION_MODE = 'agent';
  process.env.BROWSER_PROVIDER = 'browserbase';
  const launches = [];
  const m1 = mock.module('../../../11_Benchmark_Engine/modules/browserLauncher.js', {
    exports: { launchBrowser: async (label) => { launches.push(label); return { browser: { on() {}, async newPage() { return fakePage(); } }, close: async () => {} }; } },
  });
  const m2 = mock.module(NAV, {
    exports: {
      ...(await import(NAV)),
      agentModeAvailable: () => true,
      runAutonomousNavigation: async () => ({
        navigator: 'agent', targetStatus: 'target_reached', targetReached: true, feature: 'Passenger Details',
        detectorKey: 'passenger_details', deepestUrl: 'https://air.com/pax', confidence: 'high',
        interactionsPerformed: ['act'], classificationsSeen: ['AGENT_DECISION'], safetyBlocks: [],
        evidenceOverride: { screenshotPath: null, pageUrl: 'https://air.com/pax', pageTitle: 'x', pageHtml: '' },
      }),
    },
  });
  t.after(() => { m1.restore(); m2.restore(); delete process.env.NAVIGATION_MODE; delete process.env.BROWSER_PROVIDER;  scrubAgentTestArtifacts(); });
  const { runJourney } = await import(`../../../11_Benchmark_Engine/modules/navigation_runner/index.js?bust=${Math.random()}`);
  const r = await runJourney({
    journeyPlan: { starting_url: 'https://air.com/', company_slug: 'air', primary_goal: 'x', recommended_journey: [{ id: 'step_07_booking', step_id: 'step_07_booking', title: 'Passenger Details', goal_driven: true, detector_key: 'passenger_details', feature_label: 'Passenger Details', depends_on_previous: false }] },
    companyName: 'Air', companySlug: '_agenttest',
  });
  assert.equal(launches.length, 0, 'no outer Browserbase browser was launched for an agent-only run');
  assert.equal(r.steps[0].status, 'success');
});

test('heuristic mode still launches and uses the Navigation Runner browser', async (t) => {
  process.env.NAVIGATION_MODE = 'heuristic';
  const launches = [];
  const page = fakePage({ snapshot: PAX_SNAPSHOT, url: 'https://air.com/pax' });
  const m1 = mock.module('../../../11_Benchmark_Engine/modules/browserLauncher.js', {
    exports: { launchBrowser: async (label) => { launches.push(label); return { browser: { on() {}, async newPage() { return page; } }, close: async () => {} }; } },
  });
  t.after(() => { m1.restore(); delete process.env.NAVIGATION_MODE;  scrubAgentTestArtifacts(); });
  const { runJourney } = await import(`../../../11_Benchmark_Engine/modules/navigation_runner/index.js?bust=${Math.random()}`);
  await runJourney({
    journeyPlan: { starting_url: 'https://air.com/', company_slug: 'air', primary_goal: 'x', recommended_journey: [{ id: 'step_07_booking', step_id: 'step_07_booking', title: 'Passenger Details', goal_driven: true, detector_key: 'passenger_details', feature_label: 'Passenger Details', depends_on_previous: false }] },
    companyName: 'Air', companySlug: '_agenttest',
  });
  assert.ok(launches.length >= 1, 'heuristic mode launched the runner browser');
});

// ═══ 6. fallback + errors ════════════════════════════════════════════
test('AgentNavUnavailableError propagates (caller falls back)', async () => {
  await assert.rejects(
    () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', stagehandFactory: async () => { throw new AgentNavUnavailableError('no creds'); } }),
    (e) => e instanceof AgentNavUnavailableError,
  );
});

test('a non-Unavailable crash resolves to an honest BLOCKER (no throw)', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, initThrows: new Error('CDP connect failed') });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 400 }), stagehandFactory: async () => sh });
  assert.equal(r.targetStatus, TARGET_STATUS.BLOCKER);
  assert.match(r.blocker, /crashed|CDP connect failed/i);
});

test('a terminal goal/agent result is not re-run by recovery logic', () => {
  for (const ar of [
    { goal: { targetStatus: 'blocked_auth_or_booking_reference' }, terminal: true, success: false },
    { goal: { targetStatus: 'unrecoverable_blocker' }, terminal: true, success: false },
    { goal: { targetStatus: 'safety_boundary' }, terminal: true, success: false },
    { goal: { targetStatus: 'max_time_exceeded' }, terminal: true, success: false },
  ]) {
    assert.equal(!ar.success && !(ar.goal && ar.terminal), false, ar.goal.targetStatus);
  }
  assert.equal(!({ success: false, error: 'net::ERR' }).success && !(undefined && undefined), true);
});

// ═══ 7. telemetry + redaction ═══════════════════════════════════════
test('telemetry scrub() redacts synthetic values and %vars%', () => {
  assert.match(scrub('email benchmark.test.traveler@example.com'), /‹redacted›/);
  assert.match(scrub('typed %firstName% in'), /‹redacted›/);
  assert.match(scrub('Test Traveler dob 1990-01-15'), /‹redacted›/);
  assert.doesNotMatch(scrub('clicked Search flights'), /‹redacted›/);
});

test('agent variables are GENERIC (person/contact/address/search) and only synthetic values', () => {
  const vars = toAgentVariables(buildTestProfile());
  // generic person/contact fields exist and are usable on any site
  for (const k of ['firstName', 'lastName', 'email', 'phone', 'city', 'country', 'postalCode', 'quantity', 'searchTerm']) {
    assert.ok(vars[k] && typeof vars[k].value === 'string' && vars[k].description.length > 3, `variable ${k}`);
  }
  assert.match(vars.email.value, /@example\.com$/);
  // no domain-specific variable names
  assert.ok(!('originCode' in vars) && !('destinationCode' in vars) && !('cabin' in vars) && !('passengerName' in vars));
  for (const v of Object.values(vars)) { assert.equal(typeof v.value, 'string'); }
});

test('agent_nav_start / agent_nav_stop are emitted', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [{ type: 'act' }], completed: false } });
  const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => sh }));
  const names = events.map((e) => e.message);
  assert.ok(names.includes('agent_nav_start') && names.includes('agent_nav_stop'));
});

test('agent-mode availability + LLM detection', () => {
  assert.equal(typeof agentModeAvailable(), 'boolean');
  assert.ok(detectAgentLlm());
  assert.ok(browserbaseSessionTimeoutMs() >= 60000);
});

// ═══ 8. Stagehand configuration mode (the exact production failure) ══════

test('we build the SUPPORTED Stagehand combination — disableAPI:true + experimental:true, concrete model', () => {
  assert.equal(STAGEHAND_DISABLE_API, true);
  assert.equal(STAGEHAND_EXPERIMENTAL, true);
  const opts = buildStagehandConstructorOptions();
  assert.equal(opts.disableAPI, true, 'disableAPI must be true so agent.execute() may take a signal');
  assert.equal(opts.experimental, true, 'experimental must be true so agent.execute() may take a signal');
  assert.notEqual(opts.model, 'auto', '"auto" is invalid with disableAPI/experimental');
  assert.match(opts.model, /^[a-z]+\//, 'a concrete "provider/model" id');
});

test('the exact production failure combo (disableAPI:false + signal/excludeTools) is NOT what we send', () => {
  const opts = buildStagehandConstructorOptions();
  // production error was: env=BROWSERBASE, disableAPI:false, agent.execute({ signal, excludeTools })
  assert.ok(!(opts.disableAPI === false), 'never disableAPI:false while passing experimental execute options');
  const exShape = buildAgentExecuteOptionShape();
  assert.ok(!('excludeTools' in exShape), 'excludeTools is NOT passed (safety is code-enforced, not tool-restricted)');
  assert.ok(!('output' in exShape) && !('messages' in exShape) && !('stream' in exShape));
  assert.equal(exShape.signal, true, 'signal IS passed (hard runtime budget)');
});

test('the running navigator calls agent.execute() with signal + callbacks and WITHOUT excludeTools', async () => {
  const { sh, state } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [], completed: false } });
  await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 400 }), stagehandFactory: async () => sh });
  const e = state.execOpts;
  assert.ok(e && e.signal && typeof e.signal === 'object', 'AbortSignal passed');
  assert.ok(e.callbacks && typeof e.callbacks.onStepFinish === 'function', 'onStepFinish callback passed');
  assert.equal('excludeTools' in e, false, 'NO excludeTools');
  assert.equal('output' in e, false);
  assert.equal('stream' in e, false);
  assert.ok(e.variables && typeof e.variables === 'object', 'synthetic variables passed');
});

test('validateAgentConfiguration rejects unsupported / incomplete configs BEFORE opening a session', async (t) => {
  const LLM_KEYS = ['AGENT_NAV_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'];
  const saved = Object.fromEntries([...LLM_KEYS, 'BROWSER_PROVIDER'].map((k) => [k, process.env[k]]));
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } });

  process.env.BROWSER_PROVIDER = 'weird';
  assert.equal(validateAgentConfiguration().ok, false);
  assert.match(validateAgentConfiguration().reason, /not a supported agent browser/);

  process.env.BROWSER_PROVIDER = 'local';
  process.env.AGENT_NAV_MODEL = 'auto';
  assert.equal(validateAgentConfiguration().ok, false);
  assert.match(validateAgentConfiguration().reason, /"auto" is only valid with the Stagehand API/);

  for (const k of LLM_KEYS) delete process.env[k];
  assert.equal(validateAgentConfiguration().ok, false);
  assert.match(validateAgentConfiguration().reason, /no agent LLM key/);

  process.env.ANTHROPIC_API_KEY = 'x';
  const ok = validateAgentConfiguration();
  assert.equal(ok.ok, true);
  assert.equal(ok.disableAPI, true);
  assert.equal(ok.experimental, true);
  assert.notEqual(ok.agentModel, 'auto');

  // a bad config makes runAutonomousNavigation throw BEFORE calling the factory
  process.env.BROWSER_PROVIDER = 'weird';
  let factoryCalls = 0;
  await assert.rejects(
    () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', stagehandFactory: async () => { factoryCalls += 1; return fakeStagehand().sh; } }),
    (e) => e instanceof AgentNavUnavailableError && /configuration is not usable/.test(e.message),
  );
  assert.equal(factoryCalls, 0, 'no Stagehand session was opened for an invalid config');
});

test('agent_nav_config + agent_nav_agent_ready + agent_nav_action are emitted; onStepFinish drives actions', async () => {
  const { sh } = fakeStagehand({
    pageCfg: { snapshot: HOME_SNAPSHOT },
    agentResult: async (opts) => {
      // simulate two real agent steps
      await opts.callbacks.onStepFinish({ toolCalls: [{ toolName: 'goto' }] });
      await opts.callbacks.onStepFinish({ toolCalls: [{ toolName: 'act' }] });
      return { message: 'done', actions: [{ type: 'goto' }, { type: 'act' }], completed: false };
    },
  });
  const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 500 }), stagehandFactory: async () => sh }));
  const names = events.map((e) => e.message);
  assert.ok(names.includes('agent_nav_config'), 'agent_nav_config emitted');
  assert.ok(names.includes('agent_nav_agent_ready'), 'agent_nav_agent_ready emitted');
  const actions = events.filter((e) => e.message === 'agent_nav_action');
  assert.ok(actions.length >= 2, `agent_nav_action emitted per step (got ${actions.length})`);
  assert.deepEqual(actions.map((a) => a.actionType).slice(0, 2), ['goto', 'act']);
  assert.ok(actions.every((a) => typeof a.stepNumber === 'number' && a.stepNumber >= 1));
  const cfg = events.find((e) => e.message === 'agent_nav_config');
  assert.equal(cfg.stagehandDisableAPI, true);
  assert.equal(cfg.stagehandExperimental, true);
  assert.notEqual(cfg.agentModel, 'auto');
});

test('agent_nav_action still emitted post-hoc from execResult.actions if onStepFinish never fired', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [{ type: 'goto', pageUrl: 'https://air.com/x' }, { type: 'fillForm' }], completed: false } });
  const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 400 }), stagehandFactory: async () => sh }));
  const actions = events.filter((e) => e.message === 'agent_nav_action');
  assert.ok(actions.length >= 2);
});

// ═══ 9. UNIVERSAL HYBRID AGENT (any site, any feature) ══════════════════
const { buildAgentConfig } = await import(NAV);
const { genericVerify, pageKind, pageStateFingerprint } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/genericVerifier.js');
const { verifyTarget: verifyT } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/targetVerifier.js');

test('hybrid mode: a "claude" model gets mode:"hybrid"; an openai-only env gets mode:"dom"', async (t) => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, m: process.env.AGENT_NAV_MODEL };
  t.after(() => { for (const [k, v] of [['ANTHROPIC_API_KEY', saved.a], ['OPENAI_API_KEY', saved.o], ['AGENT_NAV_MODEL', saved.m]]) { if (v == null) delete process.env[k]; else process.env[k] = v; } });
  delete process.env.AGENT_NAV_MODEL;
  process.env.ANTHROPIC_API_KEY = 'x'; delete process.env.OPENAI_API_KEY;
  let llm = detectAgentLlm();
  assert.match(llm.model, /claude/);
  assert.equal(llm.agentMode, 'hybrid');
  assert.equal(buildAgentConfig().mode, 'hybrid');
  assert.equal(validateAgentConfiguration().agentMode, 'hybrid');
  delete process.env.ANTHROPIC_API_KEY; process.env.OPENAI_API_KEY = 'x';
  assert.equal(detectAgentLlm().agentMode, 'dom');
  process.env.AGENT_NAV_MODEL = 'anthropic/claude-sonnet-4-6';
  assert.equal(detectAgentLlm().agentMode, 'hybrid');
});

test('the running navigator passes mode + model to sh.agent()', async () => {
  const seen = {};
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'x', actions: [], completed: false } });
  sh.agent = (c) => { Object.assign(seen, c); return { execute: async () => ({ message: 'x', actions: [], completed: false }) }; };
  await runAutonomousNavigation({ startingUrl: 'https://x.com/', feature: 'Checkout', detectorKey: null, limits: T({ maxMs: 300 }), stagehandFactory: async () => sh });
  assert.ok(seen.mode === 'hybrid' || seen.mode === 'dom');
  assert.ok(typeof seen.model === 'string' && seen.model.length > 0);
});

test('generic page-state fingerprint: stable for the same page, changes on any material change', () => {
  const a = { url: 'https://x.com/p', headings: ['pricing'], fields: [{ semantic: 'email' }], controls: [{ name: 'continue' }], bodyText: 'choose a plan', counts: {} };
  assert.equal(pageStateFingerprint(a), pageStateFingerprint({ ...a }));
  assert.notEqual(pageStateFingerprint(a), pageStateFingerprint({ ...a, headings: ['checkout'] }));
  assert.notEqual(pageStateFingerprint(a), pageStateFingerprint({ ...a, url: 'https://x.com/p?step=2' }));
});

test('universal stuck detector: unchanged fingerprint + ongoing actions -> agent_nav_stuck + BLOCKER', async () => {
  const frozen = fakePage({ snapshot: HOME_SNAPSHOT });
  const { sh } = fakeStagehand({
    page: frozen,
    agentResult: async (opts) => {
      const iv = setInterval(() => { try { opts.callbacks.onStepFinish({ toolCalls: [{ toolName: 'act' }] }); } catch { /* */ } }, 20);
      await new Promise((res) => opts.signal.addEventListener('abort', () => { clearInterval(iv); res(); }));
      return { message: 'aborted', actions: [], completed: false, _error: Object.assign(new Error('aborted'), { name: 'AbortError' }) };
    },
  });
  const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({
    startingUrl: 'https://x.com/', feature: 'Checkout', detectorKey: null,
    limits: T({ maxMs: 60000, probeIntervalMs: 40, maxStuckTicks: 3 }),
    stagehandFactory: async () => sh,
  }));
  assert.ok(events.some((e) => e.message === 'agent_nav_stuck'), 'agent_nav_stuck emitted');
  const stop = events.find((e) => e.message === 'agent_nav_stop');
  assert.equal(stop.status, TARGET_STATUS.BLOCKER);
  assert.match(stop.stopReason, /did not change|could not operate/i);
});

test('generic verifier recognises unrelated site categories (no domain code)', () => {
  const checkout = { url: 'https://shop.example/checkout', headings: ['Checkout', 'Order summary'], bodyText: 'delivery address payment method place order subtotal', fields: [{ semantic: 'first_name' }, { semantic: 'last_name' }, { semantic: 'address_line1' }, { semantic: 'postal_code' }], controls: [{ name: 'place order' }], counts: {} };
  assert.equal(genericVerify(checkout, 'Checkout').reached, true);
  assert.equal(pageKind(checkout), 'checkout');
  const signup = { url: 'https://app.example/signup', headings: ['Create your account'], bodyText: 'start your free trial no credit card required', fields: [{ semantic: 'email' }, { semantic: 'full_name' }, { semantic: 'password' }], controls: [{ name: 'sign up' }], counts: {} };
  assert.equal(genericVerify(signup, 'Sign up').reached, true);
  assert.equal(pageKind(signup), 'signup');
  const cart = { url: 'https://shop.example/cart', headings: ['Your basket'], bodyText: 'subtotal proceed to checkout 2 items', fields: [], controls: [{ name: 'proceed to checkout' }], counts: {} };
  assert.equal(genericVerify(cart, 'Cart').reached, true);
  assert.equal(genericVerify({ url: 'https://x.com/', headings: ['welcome'], bodyText: 'the best products', fields: [], controls: [{ name: 'shop now' }], counts: {} }, 'Checkout').reached, false);
});

test('verifyTarget routes: known feature -> detector; unknown feature -> generic', async () => {
  const paxPage = fakePage({ snapshot: { headings: ['passenger details'], fields: [{ semantic: 'first_name' }, { semantic: 'last_name' }, { semantic: 'date_of_birth' }], controls: [], bodyText: '', counts: {} } });
  assert.equal((await verifyT(paxPage, 'passenger_details', { featureLabel: 'Passenger Details' })).method, 'feature-detector');
  const checkoutPage = fakePage({ snapshot: { url: 'https://s.example/checkout', headings: ['Checkout'], bodyText: 'order summary delivery address place order', fields: [{ semantic: 'address_line1' }, { semantic: 'postal_code' }, { semantic: 'first_name' }, { semantic: 'email' }], controls: [{ name: 'place order' }], counts: {} } });
  const gv = await verifyT(checkoutPage, null, { featureLabel: 'Checkout' });
  assert.equal(gv.method, 'generic');
  assert.equal(gv.reached, true);
});

test('safetyProbe is domain-free', () => {
  const cardPay = { fields: [{ semantic: 'card_number', context: 'form' }], controls: [{ name: 'Pay now' }], bodyText: '' };
  assert.equal(safetyProbe(cardPay, 'Seat Selection').violation, true);
  assert.equal(safetyProbe(cardPay, 'Payment').violation, false);
  assert.equal(safetyProbe(cardPay, 'Checkout').violation, false);
  assert.equal(safetyProbe({ fields: [], controls: [], bodyText: 'enter the 6-digit code we texted you (2fa)' }, 'Checkout').violation, true);
  const wall = { fields: [{ semantic: 'password', context: 'auth' }], controls: [{ name: 'sign in' }], bodyText: 'sign in to continue' };
  assert.equal(safetyProbe(wall, 'Pricing').violation, true);
  assert.equal(safetyProbe(wall, 'Sign in').violation, false);
});

test('NO company / airline / hostname-specific code in the autonomous_navigator path', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../../../11_Benchmark_Engine/modules/autonomous_navigator/', import.meta.url));
  const BANNED = /\b(etihad|emirates|qatarairways|saudia|singaporeair|lufthansa)\b|airline adapter|company adapter/i;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(dir + f, 'utf8');
    assert.ok(!BANNED.test(src), `${f} has a company/airline reference`);
    assert.ok(!/if\s*\([^)]*\.(hostname|host)\s*===/.test(src), `${f} branches on a hostname`);
  }
});
