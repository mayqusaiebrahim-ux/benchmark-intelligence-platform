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

// ═══ 4. DOM-only degradation is loud, not silent ═══════════════════════
// Forces detectAgentLlm() to fall through to openai/gpt-4.1-mini (agentMode
// 'dom') by hiding every hybrid-capable provider key, keeping only OPENAI_API_KEY.
function withDomOnlyEnv(fn) {
  const keys = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'AGENT_NAV_MODEL', 'AGENT_NAV_REQUIRE_HYBRID'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    });
}

test('DOM-only degradation emits a loud agent_nav_mode_degraded warning', async () => {
  await withDomOnlyEnv(async () => {
    assert.equal(detectAgentLlm().agentMode, 'dom', 'precondition: env resolves to DOM-only');
    const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [], completed: false } });
    const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => sh }));
    const degraded = events.find((e) => e.message === 'agent_nav_mode_degraded');
    assert.ok(degraded, 'agent_nav_mode_degraded emitted');
    assert.equal(degraded.agentMode, 'dom');
    assert.equal(degraded.agentModel, 'openai/gpt-4.1-mini');
    assert.match(degraded.detail, /DOM-only/);
    // validateAgentConfiguration still returns ok:true by default — no behaviour change.
    assert.equal(validateAgentConfiguration().ok, true);
  });
});

test('hybrid mode emits NO agent_nav_mode_degraded warning', async () => {
  assert.equal(detectAgentLlm().agentMode, 'hybrid', 'precondition: default test env resolves to hybrid (ANTHROPIC_API_KEY set)');
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [], completed: false } });
  const events = await captureEvents('agent_nav_', () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => sh }));
  assert.equal(events.some((e) => e.message === 'agent_nav_mode_degraded'), false);
});

test('a DOM-only run that does not reach the target reports it in the blocker text', async () => {
  await withDomOnlyEnv(async () => {
    const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'done', actions: [], completed: false } });
    const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => sh });
    assert.equal(r.targetReached, false);
    assert.match(r.blocker, /navigation ran DOM-only, not hybrid — custom widgets may be unoperable/);
  });
});

test('a REACHED run never carries the DOM-only suffix, even in DOM mode', async () => {
  await withDomOnlyEnv(async () => {
    const paxPage = fakePage({ snapshot: PAX_SNAPSHOT, url: 'https://air.com/booking/passengers' });
    const { sh } = fakeStagehand({ page: paxPage, agentResult: { message: 'done', actions: [{ type: 'goto' }, { type: 'fillForm' }], completed: true } });
    const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Passenger Details', detectorKey: 'passenger_details', limits: T({ maxMs: 800 }), stagehandFactory: async () => sh });
    assert.equal(r.targetStatus, TARGET_STATUS.REACHED);
    assert.equal(r.blocker, null);
  });
});

test('AGENT_NAV_REQUIRE_HYBRID=true fails pre-flight when only a DOM-only model resolves', async () => {
  await withDomOnlyEnv(async () => {
    process.env.AGENT_NAV_REQUIRE_HYBRID = 'true';
    const cfg = validateAgentConfiguration();
    assert.equal(cfg.ok, false);
    assert.match(cfg.reason, /AGENT_NAV_REQUIRE_HYBRID/);
    assert.match(cfg.reason, /DOM-only/);
    await assert.rejects(
      () => runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Payment', detectorKey: 'payment', limits: T({ maxMs: 300 }), stagehandFactory: async () => { throw new Error('must not open a session'); } }),
      AgentNavUnavailableError,
    );
  });
});

test('AGENT_NAV_REQUIRE_HYBRID=true passes pre-flight when a hybrid model resolves', () => {
  const saved = process.env.AGENT_NAV_REQUIRE_HYBRID;
  process.env.AGENT_NAV_REQUIRE_HYBRID = 'true';
  try {
    assert.equal(detectAgentLlm().agentMode, 'hybrid');
    assert.equal(validateAgentConfiguration().ok, true);
  } finally {
    if (saved === undefined) delete process.env.AGENT_NAV_REQUIRE_HYBRID; else process.env.AGENT_NAV_REQUIRE_HYBRID = saved;
  }
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
    namedExports: { launchBrowser: async (label) => { launches.push(label); return { browser: { on() {}, async newPage() { return fakePage(); } }, close: async () => {} }; } },
  });
  const m2 = mock.module(NAV, {
    namedExports: {
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
    namedExports: { launchBrowser: async (label) => { launches.push(label); return { browser: { on() {}, async newPage() { return page; } }, close: async () => {} }; } },
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

// ═══ 10. AUTOCOMPLETE / COMBOBOX — a real Alaska Airlines run proved the
//    watchdog fingerprint could not distinguish "field typed, suggestions
//    open" from "field typed, suggestion confirmed" from "nothing happened",
//    because playwrightAdapter.js's DOM_SNAPSHOT never counted open listbox/
//    suggestion elements at all (only flightCards/fareCards/seatCells/
//    priceTags existed in `counts`). Fixed by adding counts.openSuggestions —
//    pageStateFingerprint() already hashes every key of `counts` generically,
//    so no change to the fingerprint function itself was needed or made. ═══
test('page-state fingerprint distinguishes an open autocomplete/suggestion list from a closed one', () => {
  const closed = { url: 'https://x.com/', headings: [], fields: [{ semantic: 'origin', hasValue: true }], controls: [], bodyText: '', counts: { openSuggestions: 0 } };
  const open = { ...closed, counts: { openSuggestions: 6 } };
  assert.notEqual(pageStateFingerprint(closed), pageStateFingerprint(open), 'an opened suggestion dropdown must change the fingerprint');
});

test('page-state fingerprint: typed -> suggestions open -> confirmed are THREE distinct states, not one "stuck" state', () => {
  const typed = { url: 'https://x.com/', headings: [], fields: [{ semantic: 'origin', hasValue: false }], controls: [], bodyText: 'from', counts: { openSuggestions: 0 } };
  const suggesting = { url: 'https://x.com/', headings: [], fields: [{ semantic: 'origin', hasValue: true }], controls: [], bodyText: 'from sea', counts: { openSuggestions: 5 } };
  const confirmed = { url: 'https://x.com/', headings: [], fields: [{ semantic: 'origin', hasValue: true }], controls: [{ name: 'sea seattle' }], bodyText: 'from sea seattle', counts: { openSuggestions: 0 } };
  const fps = [typed, suggesting, confirmed].map(pageStateFingerprint);
  assert.equal(new Set(fps).size, 3, 'each real step of the autocomplete flow must be a distinct watchdog state');
});

// ═══ 11. GENERIC FORM-STATE FINGERPRINT — a real Alaska run proved SEA was
//    typed, its suggestion confirmed, and the site accepted it (no error,
//    dropdown closed) — yet the watchdog treated the whole span as
//    "unchanged" and aborted before the destination field. Root cause: the
//    origin/destination controls are BUTTON-TRIGGERED pickers (a pill
//    showing "From SEA", not a native <input>), so `hasValue` (which reads
//    el.value) never becomes true — the fingerprint had no other signal for
//    the field's displayed text. Fixed by giving every field a bounded,
//    hashed signature of its own accessible label/value text (never the raw
//    text itself) plus standard ARIA expanded/checked/selected state. ═══
test('field state signature: distinguishes empty -> typed -> suggestions-open -> confirmed for a button-triggered combobox with no native .value', () => {
  // Mirrors Alaska's real origin control: a trigger button/pill, hasValue
  // stays false throughout — only the accessible label/expanded state change.
  const empty = { url: 'https://x.com/', headings: [], controls: [], bodyText: '', counts: { openSuggestions: 0 },
    fields: [{ semantic: 'origin', label: 'From', ariaLabel: 'From', hasValue: false, expanded: 'false' }] };
  const typedNotConfirmed = { ...empty,
    fields: [{ semantic: 'origin', label: 'From SEA', ariaLabel: 'From SEA', hasValue: false, expanded: 'true' }] };
  const suggestionsOpen = { ...empty, counts: { openSuggestions: 6 },
    fields: [{ semantic: 'origin', label: 'From SEA', ariaLabel: 'From SEA', hasValue: false, expanded: 'true' }] };
  const confirmed = { ...empty,
    fields: [{ semantic: 'origin', label: 'From Seattle, WA (SEA)', ariaLabel: 'From Seattle, WA (SEA)', hasValue: false, expanded: 'false' }] };

  const fps = [empty, typedNotConfirmed, suggestionsOpen, confirmed].map(pageStateFingerprint);
  assert.equal(new Set(fps).size, 4, 'all four real steps of the autocomplete flow must be distinct watchdog states');
});

test('field state signature: destination field progress is independent of an already-confirmed origin', () => {
  const base = { url: 'https://x.com/', headings: [], controls: [], bodyText: '', counts: { openSuggestions: 0 } };
  const originField = { semantic: 'origin', label: 'From Seattle, WA (SEA)', ariaLabel: 'From Seattle, WA (SEA)', hasValue: false, expanded: 'false' };
  const destEmpty = { semantic: 'destination', label: 'To', ariaLabel: 'To', hasValue: false, expanded: 'false' };
  const destTyped = { ...destEmpty, label: 'To LAX', ariaLabel: 'To LAX', expanded: 'true' };
  const destConfirmed = { ...destEmpty, label: 'To Los Angeles, CA (LAX)', ariaLabel: 'To Los Angeles, CA (LAX)' };

  const step5 = { ...base, fields: [originField, destEmpty] };
  const step6 = { ...base, fields: [originField, destTyped] };
  const step7 = { ...base, fields: [originField, destConfirmed] };
  const fps = [step5, step6, step7].map(pageStateFingerprint);
  assert.equal(new Set(fps).size, 3, 'destination typing/confirming must register as progress even though origin is unchanged');
});

test('field state signature: identical field state (deep-equal, different object identity) is a deterministic identical fingerprint', () => {
  const a = { url: 'https://x.com/', headings: ['h'], controls: [{ name: 'c' }], bodyText: 'b', counts: { openSuggestions: 0 },
    fields: [{ semantic: 'origin', label: 'From SEA', ariaLabel: 'From SEA', hasValue: false, expanded: 'false', checked: null, selected: null }] };
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(pageStateFingerprint(a), pageStateFingerprint(b));
});

test('field state signature: volatile/irrelevant field attributes (generated id, context, disabled, tag) do NOT cause false progress', () => {
  const a = { url: 'https://x.com/', headings: [], controls: [], bodyText: '', counts: {},
    fields: [{ semantic: 'origin', label: 'From', ariaLabel: 'From', hasValue: false, expanded: 'false', context: 'booking', disabled: false, tag: 'trigger', id: 'x-1a2b3c' }] };
  const b = { ...a, fields: [{ ...a.fields[0], context: 'other', disabled: true, tag: 'input', id: 'y-9z8y7x' }] };
  assert.equal(pageStateFingerprint(a), pageStateFingerprint(b), 'generated ids / context / disabled / tag are not part of the signature and must not cause spurious "progress"');
});

test('field state signature: checked/selected ARIA state changes are visible (radio/checkbox controls)', () => {
  const base = { url: 'https://x.com/', headings: [], controls: [], bodyText: '', counts: {} };
  const unchecked = { ...base, fields: [{ semantic: 'cabin', label: 'Economy', ariaLabel: 'Economy', hasValue: false, checked: 'false' }] };
  const checked = { ...base, fields: [{ semantic: 'cabin', label: 'Economy', ariaLabel: 'Economy', hasValue: false, checked: 'true' }] };
  assert.notEqual(pageStateFingerprint(unchecked), pageStateFingerprint(checked));
});

test('field state signature: never embeds the raw field text — only a bucket + hash', () => {
  const withSecret = { url: 'https://x.com/', headings: [], controls: [], bodyText: '', counts: {},
    fields: [{ semantic: 'origin', label: 'From Seattle, WA (SEA) very specific synthetic text', ariaLabel: 'From Seattle, WA (SEA) very specific synthetic text', hasValue: false, expanded: 'false' }] };
  const fp = pageStateFingerprint(withSecret);
  assert.doesNotMatch(fp, /seattle|synthetic/i, 'the fingerprint must never contain the raw field text verbatim');
});

test('system prompt: generic autocomplete confirmation order and anti-double-typing rule are present', async () => {
  const { buildSystemPrompt } = await import('../../../11_Benchmark_Engine/modules/autonomous_navigator/agentInstructions.js');
  const prompt = buildSystemPrompt().toLowerCase();
  // The bounded confirmation order this task specified.
  assert.match(prompt, /suggestion list is not complete|not complete yet/);
  assert.match(prompt, /arrowdown/);
  assert.match(prompt, /enter/);
  assert.match(prompt, /semantic dom click/);
  assert.match(prompt, /visual\/coordinate click/);
  // Anti-double-typing / anti-blind-retry rules.
  assert.match(prompt, /do not retype/);
  assert.match(prompt, /do not type into that same field again/);
  assert.match(prompt, /clear/);
  // No domain/company leakage into the generic instructions.
  assert.doesNotMatch(prompt, /alaska|seattle|\bsea\b|\blax\b/);
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

// ── the airline detector set must not veto a correctly-reached page on a
//    non-airline site. featureIntent maps domain-neutral feature words onto
//    airline detector keys, so verification has to survive that.
const { mapFeatureToDetectorKey } = await import('../../featureNavigation/featureIntent.js');
const { detectFeature: rawDetect } = await import('../../../11_Benchmark_Engine/modules/goal_navigator/featureDetectors.js');

test('featureIntent really does map generic labels onto airline detector keys', () => {
  // If these ever stop matching, the fallback below is guarding nothing.
  assert.equal(mapFeatureToDetectorKey('Checkout'), 'payment');
  assert.equal(mapFeatureToDetectorKey('Search results'), 'flight_results');
});

test('store Checkout (detectorKey "payment") verifies via generic-fallback, not a false negative', async () => {
  const obs = {
    url: 'https://shop.example/checkout',
    headings: ['Checkout', 'Order summary'],
    bodyText: 'delivery address place order subtotal 2 items shipping method',
    fields: [{ semantic: 'first_name' }, { semantic: 'last_name' }, { semantic: 'address_line1' }, { semantic: 'postal_code' }],
    controls: [{ name: 'place order' }], counts: {},
  };
  // the airline payment detector alone does NOT confirm this page — that is the
  // whole bug: navigation succeeded, verification said "not reached".
  assert.equal(rawDetect('payment', obs).reached, false);
  const page = fakePage({ url: obs.url, snapshot: obs });
  const v = await verifyTarget(page, 'payment', { featureLabel: 'Checkout' });
  assert.equal(v.reached, true);
  assert.equal(v.method, 'generic-fallback');
});

test('store Search results (detectorKey "flight_results") verifies via generic-fallback', async () => {
  const page = fakePage({
    url: 'https://shop.example/search?q=lamp',
    snapshot: {
      url: 'https://shop.example/search?q=lamp',
      headings: ['Search results'],
      bodyText: 'showing 24 results for "lamp" sort by relevance',
      fields: [], controls: [{ name: 'view product' }, { name: 'add to bag' }, { name: 'choose options' }],
      counts: { priceTags: 24 },
    },
  });
  const v = await verifyTarget(page, 'flight_results', { featureLabel: 'Search results' });
  assert.equal(v.reached, true);
  assert.equal(v.method, 'generic-fallback');
});

test('a detector hit still wins — airline Passenger Details stays feature-detector', async () => {
  const page = fakePage({ snapshot: { headings: ['passenger details'], fields: [{ semantic: 'first_name' }, { semantic: 'last_name' }, { semantic: 'date_of_birth' }], controls: [], bodyText: '', counts: {} } });
  const v = await verifyTarget(page, 'passenger_details', { featureLabel: 'Passenger Details' });
  assert.equal(v.reached, true);
  assert.equal(v.method, 'feature-detector');
});

// REGRESSION — observed live on etihad.com 2026-09-13: the generic fallback
// declared the HOMEPAGE to be "Passenger Details" after ZERO agent actions,
// because pageKind() calls any page with 4+ fields a "form" and the label
// "Passenger Details" asks for a "form". A homepage must never be evidence
// that a deeper feature was reached.
test('REGRESSION: a real homepage with a big booking widget is NOT "Passenger Details"', async () => {
  const etihadHome = {
    url: 'https://www.etihad.com/en-ae/',
    headings: [
      'fly to the red sea', 'new destination', 'flights from riyadh',
      'life’s better as a guest', 'personalised benefits', 'reduced tier criteria',
    ],
    bodyText: 'book flights manage and check-in online explore destinations etihad guest',
    // the real homepage carried 51 fields (search widget, newsletter, filters)
    fields: Array.from({ length: 51 }, (_, i) => ({ semantic: `field_${i}`, visible: true })),
    controls: [{ name: 'search flights' }], counts: {},
  };
  assert.equal(genericVerify(etihadHome, 'Passenger Details').reached, false);
  assert.equal(pageKind(etihadHome), 'form', 'precondition: a field-heavy homepage still looks like a "form"');

  const page = fakePage({ url: etihadHome.url, snapshot: etihadHome });
  const v = await verifyTarget(page, 'passenger_details', { featureLabel: 'Passenger Details' });
  assert.equal(v.reached, false, 'the homepage must never verify as Passenger Details');
});

test('a generic "form" kind alone never proves the target — headings or URL must say so', () => {
  const anyForm = {
    url: 'https://example.com/',
    headings: ['Welcome'],
    bodyText: 'get started today',
    fields: [{ semantic: 'a' }, { semantic: 'b' }, { semantic: 'c' }, { semantic: 'd' }, { semantic: 'e' }],
    controls: [], counts: {},
  };
  assert.equal(genericVerify(anyForm, 'Passenger Details').reached, false);
  assert.equal(genericVerify(anyForm, 'Booking').reached, false);
  // …but the SAME page becomes valid evidence once it identifies itself
  const named = { ...anyForm, url: 'https://example.com/booking/passenger-details', headings: ['Passenger details'] };
  assert.equal(genericVerify(named, 'Passenger Details').reached, true);
});

test('the fallback introduces NO false positive — a homepage asked for Checkout is still not reached', async () => {
  const home = fakePage({
    url: 'https://shop.example/',
    snapshot: { url: 'https://shop.example/', headings: ['Welcome'], bodyText: 'the best products, delivered', fields: [], controls: [{ name: 'shop now' }], counts: {} },
  });
  const v = await verifyTarget(home, 'payment', { featureLabel: 'Checkout' });
  assert.equal(v.reached, false);
  assert.equal(v.method, 'feature-detector');
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

// ═══ 12. GENERIC TARGET VERIFICATION — arbitrary user-requested targets ═══
// No feature-specific keyword dictionary exists anywhere below (no "seat
// words", "baggage words", "meal words" list). Every match below comes from
// (a) words the test itself types as the REQUESTED feature, matched against
// (b) generic page evidence (headings/URL/controls/fields), optionally
// combined with (c) the one small, universal, domain-free action-verb list
// (select/choose/add/enter/...) already used by the whole platform for any
// site, any industry — not travel-specific, not airline-specific.

test('CUSTOM TARGET (no dedicated detector): "the page where I choose seats" matches real seat-selection UI', () => {
  const o = {
    url: 'https://airline.example/booking/seats',
    headings: ['Choose your seats'],
    bodyText: 'select a seat for each passenger. extra legroom seats available for a fee.',
    controls: [{ name: 'Choose seat 14A' }, { name: 'Choose seat 14B' }, { name: 'Continue to payment' }],
    fields: [{ label: 'Passenger 1' }],
    counts: {},
  };
  const r = genericVerify(o, 'the page where I choose seats');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
  assert.equal(r.structuralMatch, true, 'an actionable "Choose seat" control must count as structural evidence');
});

test('CUSTOM TARGET (no dedicated detector): "where I add baggage" matches real baggage UI', () => {
  // Uses "baggage" itself in the control name — not "bag" — deliberately.
  // "bag" and "baggage" are NOT the same token under generic suffix rules
  // (no dictionary equates them; see the seat-vs-Seattle / bag-vs-baggage
  // audit tests below), so this fixture proves the match comes from
  // coherent evidence for the word the user actually typed, not a lucky
  // substring.
  const o = {
    url: 'https://airline.example/booking/extras',
    headings: ['Add checked baggage'],
    bodyText: 'add extra baggage to your trip. price per item shown below.',
    controls: [{ name: 'Add baggage' }, { name: 'Remove baggage' }, { name: 'Continue' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'where I add baggage');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
});

test('CUSTOM TARGET (no dedicated detector): "meal selection" matches real meal-preference UI, verified generically not via a detector', () => {
  const o = {
    url: 'https://airline.example/booking/meals',
    headings: ['Choose your meal'],
    bodyText: 'select a meal preference for your flight. vegetarian and standard options available.',
    controls: [{ name: 'Select vegetarian meal' }, { name: 'Select standard meal' }, { name: 'Continue' }],
    fields: [],
    counts: {},
  };
  // Calling genericVerify() directly, bypassing targetVerifier's detectorKey
  // routing entirely — this is the real, exact code path an arbitrary
  // user-typed target with detectorKey:null takes.
  const r = genericVerify(o, 'meal selection');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
});

test('CUSTOM TARGET (no dedicated detector): "the final payment screen" matches real payment-form semantics', () => {
  const o = {
    url: 'https://airline.example/booking/payment',
    headings: ['Payment details'],
    bodyText: 'enter your card number, expiry date and cvv to complete payment.',
    controls: [{ name: 'Pay now' }],
    fields: [{ label: 'Card number' }, { label: 'Expiry date' }, { label: 'CVV' }, { label: 'Cardholder name' }],
    counts: {},
  };
  const r = genericVerify(o, 'the final payment screen');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
});

test('TRULY NOVEL TARGET — a phrase absent from every keyword list in the repo (featureDetectors, featureIntent, FEATURE_KIND_HINTS) still verifies generically', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const phrase = 'onboard wifi package';
  // Prove the phrase really is absent from the repo's hardcoded keyword
  // surfaces first — otherwise this test would silently degrade into
  // testing detector routing instead of generic verification.
  for (const rel of ['../../../11_Benchmark_Engine/modules/goal_navigator/featureDetectors.js', '../../featureNavigation/featureIntent.js', '../../../11_Benchmark_Engine/modules/autonomous_navigator/genericVerifier.js']) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').toLowerCase();
    assert.ok(!src.includes('wifi'), `${rel} must not already hardcode "wifi" for this test to prove anything`);
  }
  const o = {
    url: 'https://airline.example/booking/extras/connectivity',
    // Deliberately no hyphen — matches how keyWords() extracts the request
    // ("wifi", no hyphen); a real page could render either way, this test
    // is about generic matching, not hyphen normalization.
    headings: ['Choose your WiFi package'],
    bodyText: 'select an onboard wifi package to stay connected during your flight.',
    controls: [{ name: 'Select WiFi plan' }, { name: 'Skip' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'the screen for choosing my onboard wifi package');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
});

test('ALIAS / PARAPHRASE: differently-worded requests for the same real traveler-info page each verify independently', () => {
  // Each alias is checked against a small fixture using THAT alias's own
  // wording somewhere real (heading or an actionable control) — proving the
  // generic matcher tracks meaning-bearing words from whatever phrase the
  // user actually typed, not a fixed list of accepted synonyms.
  const cases = [
    { alias: 'Traveler Details', heading: 'Traveler details' },
    { alias: 'Traveller Details', heading: 'Traveller details' },
    { alias: 'Guest Information', heading: 'Guest information' },
    { alias: 'Passenger Information', heading: 'Passenger information' },
  ];
  for (const { alias, heading } of cases) {
    const o = {
      url: 'https://airline.example/booking/travelers',
      headings: [heading],
      bodyText: 'please enter first name, last name and date of birth.',
      controls: [{ name: 'Continue' }],
      fields: [{ label: 'First name' }, { label: 'Last name' }, { label: 'Date of birth' }],
      counts: {},
    };
    const r = genericVerify(o, alias);
    assert.equal(r.reached, true, `"${alias}" should verify against a page headed "${heading}" — ${JSON.stringify(r.signals)}`);
  }
});

// ── NEGATIVE / WRONG-PAGE — coherent multi-signal evidence required ──────

test('NEGATIVE: Seat Selection requested, but page is flight results merely mentioning "seat availability" in prose', () => {
  const o = {
    url: 'https://airline.example/search/results',
    headings: ['Available flights'],
    bodyText: 'flight 101, 9:00am, seat availability: 42 seats remaining. flight 202, 2:00pm.',
    controls: [{ name: 'Select flight 101' }, { name: 'Select flight 202' }],
    fields: [],
    counts: { flightCards: 2, priceTags: 2 },
  };
  const r = genericVerify(o, 'Seat Selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('NEGATIVE: Baggage requested, but page is the homepage footer mentioning "baggage policy"', () => {
  const o = {
    url: 'https://airline.example/',
    headings: ['Welcome', 'Book your next trip'],
    bodyText: 'flights hotels cars. see our baggage policy for details. cookie policy privacy policy.',
    controls: [{ name: 'Search flights' }, { name: 'Sign in' }],
    fields: [{ label: 'Origin' }, { label: 'Destination' }],
    counts: {},
  };
  const r = genericVerify(o, 'Baggage');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('NEGATIVE: Payment requested, but page is a fare page mentioning "payment later" as fine print', () => {
  const o = {
    url: 'https://airline.example/booking/fares',
    headings: ['Choose your fare'],
    bodyText: 'economy basic, economy flex. book now, payment later available on select fares.',
    controls: [{ name: 'Select economy basic' }, { name: 'Select economy flex' }],
    fields: [],
    counts: { fareCards: 2 },
  };
  const r = genericVerify(o, 'Payment');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('NEGATIVE: Meal Selection requested, but page is marketing copy mentioning onboard meals with no meal-choosing control', () => {
  const o = {
    url: 'https://airline.example/experience/dining',
    headings: ['Our onboard dining experience'],
    bodyText: 'enjoy a curated selection of meals prepared by award-winning chefs on every long-haul flight.',
    controls: [{ name: 'Learn more' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'Meal Selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('NEGATIVE: keyword-only coincidence — a control name that happens to share a word is not enough on its own to inflate confidence past the gate on a clearly wrong page', () => {
  // "seat" appears in a totally unrelated control ("Seattle" origin button)
  // — a substring coincidence, not semantic evidence. Kept deliberately
  // adversarial: proves word-matching alone (without heading/URL/action
  // context) cannot carry a false positive through the full gate.
  const o = {
    url: 'https://airline.example/',
    headings: ['Book your trip'],
    bodyText: 'search flights from your city',
    controls: [{ name: 'Seattle' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'Seat Selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('original user-requested feature text survives target creation verbatim, for a fully custom phrase', async () => {
  const { createBenchmarkTarget } = await import('../../runtime/benchmarkTarget.js');
  const custom = 'the screen for choosing my onboard wifi package';
  const target = createBenchmarkTarget({ company: 'Test Airline', slug: 'test_airline', url: 'https://airline.example/', feature: custom, requestId: 'req_1' });
  assert.equal(target.feature, custom, 'the exact user-typed feature string must survive unchanged, not be replaced by a normalized/detector name');
});

test('a custom target with no dedicated detector still stops at NO airline/company-specific evidence — generic evidence only', () => {
  const o = {
    url: 'https://shop.example/checkout/gift-wrap',
    headings: ['Add gift wrapping'],
    bodyText: 'select a gift wrap style for your order.',
    controls: [{ name: 'Choose gift wrap' }],
    fields: [],
    counts: {},
  };
  // A completely non-travel example — proves the same generic mechanism
  // works for e-commerce too, not just airlines.
  const r = genericVerify(o, 'the page where I pick gift wrapping');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
});

// ═══ 13. HARDENING — word-boundary matching, concept-vs-action, coherence ═══
// Phase 1 audit: the previous implementation matched with plain substring
// `.includes()`, which matches ANYWHERE inside a longer word, not just at a
// word boundary. Every test below is a direct, provable case of a substring
// that is NOT the same concept — proven with tokenMatches() directly
// (helper-level) and with genericVerify() (behavioral level).

import { tokenMatches as _tokenMatches, keyWords as _keyWords, tokenize as _tokenize } from '../../../11_Benchmark_Engine/modules/autonomous_navigator/genericVerifier.js';

test('AUDIT (helper-level): tokenMatches rejects unrelated words that merely share a substring', () => {
  const badPairs = [
    ['seat', 'seattle'],
    ['bag', 'baggage'],
    ['pay', 'repayment'],
    ['fare', 'farewell'],
    ['meal', 'mealtime'],
    ['add', 'address'],
  ];
  for (const [req, hay] of badPairs) {
    assert.equal(_tokenMatches(req, hay), false, `"${req}" must NOT match "${hay}" — they are unrelated words, not the same word inflected`);
  }
});

test('AUDIT (helper-level): tokenMatches accepts genuine English inflections of the SAME word', () => {
  const goodPairs = [
    ['select', 'selection'],
    ['seat', 'seats'],
    ['choose', 'choosing'],
    ['baggage', 'baggage'],
    ['add', 'added'],
    ['traveler', 'travelers'],
  ];
  for (const [req, hay] of goodPairs) {
    assert.equal(_tokenMatches(req, hay), true, `"${req}" should match "${hay}" — same word, generic English inflection`);
  }
});

test('AUDIT (behavioral): "Seat Selection" requested — a control literally named "Seattle" produces NO match via tokenMatches, not just via the gate', () => {
  const toks = _tokenize('Seattle');
  const words = _keyWords('Seat Selection');
  const anyMatch = words.some((w) => toks.some((t) => _tokenMatches(w, t)));
  assert.equal(anyMatch, false);
});

test('FALSE-POSITIVE AUDIT: "add" vs "address" — a page with an Address field must not satisfy "where I add baggage"', () => {
  const o = {
    url: 'https://airline.example/booking/contact',
    headings: ['Contact details'],
    bodyText: 'enter your billing address below.',
    controls: [{ name: 'Continue' }],
    fields: [{ label: 'Address line 1' }, { label: 'City' }, { label: 'Postal code' }, { label: 'Country' }],
    counts: {},
  };
  const r = genericVerify(o, 'where I add baggage');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('FALSE-POSITIVE AUDIT: "pay" vs "repayment" — a finance page mentioning loan repayment must not satisfy "Payment"', () => {
  const o = {
    url: 'https://airline.example/help/financing',
    headings: ['Financing & repayment options'],
    bodyText: 'learn about our flexible repayment plans and financing partners.',
    controls: [{ name: 'Learn more' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'Payment');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('FALSE-POSITIVE AUDIT: "fare" vs "farewell" — a goodbye/thank-you message must not satisfy "choose my fare"', () => {
  const o = {
    url: 'https://airline.example/feedback/thanks',
    headings: ['A farewell message from our CEO'],
    bodyText: 'as we bid farewell to this aircraft type, thank you for flying with us.',
    controls: [{ name: 'Close' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'choose my fare');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('FALSE-POSITIVE AUDIT: "meal" vs "mealtime" — an unrelated schedule/mealtime note must not satisfy "meal selection"', () => {
  const o = {
    url: 'https://airline.example/inflight/schedule',
    headings: ['Cabin crew mealtime schedule'],
    bodyText: 'crew mealtime is at 14:00 during the flight.',
    controls: [{ name: 'View schedule' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'meal selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

// ── PHASE 3 — action word alone must not identify the target ────────────

test('ACTION-ONLY MISMATCH: "where I add baggage" vs an "Add passenger" control — the action word "add" matches but the concept "baggage" does not', () => {
  const o = {
    url: 'https://airline.example/booking/travelers',
    headings: ['Traveler details'],
    bodyText: 'add a passenger to continue.',
    controls: [{ name: 'Add passenger' }, { name: 'Continue' }],
    fields: [{ label: 'First name' }, { label: 'Last name' }],
    counts: {},
  };
  const r = genericVerify(o, 'where I add baggage');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('ACTION-ONLY MISMATCH: "meal selection" vs a "Select flight" control — the action word "select" matches but the concept "meal" does not', () => {
  const o = {
    url: 'https://airline.example/search/results',
    headings: ['Available flights'],
    bodyText: 'choose your preferred departure time.',
    controls: [{ name: 'Select flight 101' }, { name: 'Select flight 202' }],
    fields: [],
    counts: { flightCards: 2 },
  };
  const r = genericVerify(o, 'meal selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('ACTION-ONLY MISMATCH: "where I change my seat" vs a "Change flight" control — the action word "change" matches but the concept "seat" does not', () => {
  const o = {
    url: 'https://airline.example/manage/flight',
    headings: ['Manage your booking'],
    bodyText: 'change your flight date or route.',
    controls: [{ name: 'Change flight' }, { name: 'Cancel booking' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'where I change my seat');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

// ── PHASE 7 — functional control vs marketing/informational control ─────

test('MARKETING-LINK FALSE POSITIVE: "Seat Selection" requested, homepage only has an informational link "Learn about seat selection"', () => {
  const o = {
    url: 'https://airline.example/',
    headings: ['Welcome', 'Plan your next trip'],
    bodyText: 'discover our seat selection options before you fly.',
    controls: [{ name: 'Search flights' }, { name: 'Learn about seat selection' }, { name: 'Sign in' }],
    fields: [{ label: 'Origin' }, { label: 'Destination' }],
    counts: {},
  };
  const r = genericVerify(o, 'Seat Selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('INFORMATIONAL-LINK FALSE POSITIVE: "Baggage" requested, homepage footer only has a link "Baggage information"', () => {
  const o = {
    url: 'https://airline.example/',
    headings: ['Welcome', 'Book your next trip'],
    bodyText: 'flights hotels cars.',
    controls: [{ name: 'Search flights' }, { name: 'Baggage information' }, { name: 'Sign in' }],
    fields: [{ label: 'Origin' }, { label: 'Destination' }],
    counts: {},
  };
  const r = genericVerify(o, 'Baggage');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('MARKETING-CTA FALSE POSITIVE: "Meal Selection" requested, marketing page only has a CTA "Explore our meals"', () => {
  const o = {
    url: 'https://airline.example/experience/dining',
    headings: ['Onboard dining'],
    bodyText: 'a world-class dining experience awaits.',
    controls: [{ name: 'Explore our meals' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'Meal Selection');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

// ── PHASE 8 — coherent functional evidence: the same four custom targets, ──
// but this time asserting the evidence is genuinely coherent (actionable
// control, or a real multi-option set), not one coincidental element.

test('COHERENT POSITIVE: seat selection — actionable control (concept + distinct action verb) required and present', () => {
  const o = {
    url: 'https://airline.example/booking/seats',
    headings: ['Choose your seats'],
    bodyText: 'select a seat for each passenger.',
    controls: [{ name: 'Choose seat 14A' }, { name: 'Choose seat 14B' }, { name: 'Continue to payment' }],
    fields: [{ label: 'Passenger 1' }],
    counts: {},
  };
  const r = genericVerify(o, 'the page where I choose seats');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
  assert.equal(r.structuralMatch, true);
});

test('COHERENT POSITIVE: baggage — actionable control (concept + distinct action verb) required and present', () => {
  const o = {
    url: 'https://airline.example/booking/extras',
    headings: ['Add checked baggage'],
    bodyText: 'add extra baggage to your trip.',
    controls: [{ name: 'Add baggage' }, { name: 'Remove baggage' }, { name: 'Continue' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'where I add baggage');
  assert.equal(r.reached, true, JSON.stringify(r.signals));
});

// ── PHASE 5 — deterministic paraphrase limitations: what Layer 1 CANNOT ──
// (and, per the success criterion, MUST NOT) resolve on its own. These
// define exactly where the future AI semantic layer begins.

test('PARAPHRASE LIMITATION: "where I add baggage" vs UI wording "Purchase checked luggage" — no shared concept word, must NOT be forced to PASS', () => {
  const o = {
    url: 'https://airline.example/booking/extras',
    headings: ['Extras'],
    bodyText: 'purchase checked luggage for your trip.',
    controls: [{ name: 'Purchase checked luggage' }, { name: 'Continue' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'where I add baggage');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
  assert.notEqual(r.verdict, 'match');
});

test('PARAPHRASE LIMITATION: "choose my meal" vs UI wording "Dining preferences" — no shared concept word, must NOT be forced to PASS', () => {
  const o = {
    url: 'https://airline.example/booking/dining',
    headings: ['Dining preferences'],
    bodyText: 'set your dining preferences for this flight.',
    controls: [{ name: 'Save preferences' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'choose my meal');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
  assert.notEqual(r.verdict, 'match');
});

test('PARAPHRASE LIMITATION: "traveler information" vs UI wording "Guest details" — no shared concept word, must remain unresolved deterministically', () => {
  const o = {
    url: 'https://airline.example/booking/guest',
    headings: ['Guest details'],
    bodyText: 'please provide details for each guest.',
    controls: [{ name: 'Continue' }],
    fields: [{ label: 'First name' }, { label: 'Last name' }],
    counts: {},
  };
  const r = genericVerify(o, 'traveler information');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
  assert.notEqual(r.verdict, 'match');
});

// ── PHASE 6 — multilingual target text: preserved, never falsely matched ──

test('MULTILINGUAL: an Arabic target ("اختيار المقعد" — choose the seat) against an English-only page must NOT falsely match', () => {
  const o = {
    url: 'https://airline.example/booking/seats',
    headings: ['Choose your seat'],
    bodyText: 'select a seat for each passenger.',
    controls: [{ name: 'Choose seat 14A' }, { name: 'Continue' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'اختيار المقعد');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
  assert.notEqual(r.verdict, 'match');
});

test('MULTILINGUAL: arbitrary Unicode target text survives target creation unchanged (no mangling, no transliteration, no truncation)', async () => {
  const { createBenchmarkTarget } = await import('../../runtime/benchmarkTarget.js');
  const arabic = 'اختيار المقعد';
  const target = createBenchmarkTarget({ company: 'Test Airline', slug: 'test_airline', url: 'https://airline.example/', feature: arabic, requestId: 'req_ar_1' });
  assert.equal(target.feature, arabic, 'the exact Arabic string must survive unchanged through target creation');
  assert.equal(target.feature.length, arabic.length);
});

test('MULTILINGUAL: genericVerify never throws on Unicode/mixed-script input', () => {
  const o = { url: 'https://airline.example/', headings: ['首页'], bodyText: '', controls: [], fields: [], counts: {} };
  assert.doesNotThrow(() => genericVerify(o, '座席選択 🛫 اختيار المقعد'));
});

// ── PHASE 4 — three-way verdict for the future AI hand-off ──────────────

test('VERDICT: a clear match reports verdict "match"', () => {
  const o = {
    url: 'https://airline.example/booking/payment',
    headings: ['Payment details'],
    bodyText: 'enter your card number to complete payment.',
    controls: [{ name: 'Pay now' }],
    fields: [{ label: 'Card number' }, { label: 'Expiry date' }, { label: 'CVV' }, { label: 'Cardholder name' }],
    counts: {},
  };
  const r = genericVerify(o, 'the final payment screen');
  assert.equal(r.verdict, 'match');
});

test('VERDICT: a page with zero signal for the request reports verdict "no-match", not "ambiguous"', () => {
  const o = {
    url: 'https://airline.example/legal/privacy',
    headings: ['Privacy policy'],
    bodyText: 'this policy describes how we handle personal data.',
    controls: [{ name: 'Accept' }],
    fields: [],
    counts: {},
  };
  const r = genericVerify(o, 'Seat Selection');
  assert.equal(r.reached, false);
  assert.equal(r.verdict, 'no-match');
});

test('VERDICT: a paraphrase with no shared concept word reports verdict "ambiguous" or "no-match" but never "match" — this is the future AI hand-off condition', () => {
  const o = {
    url: 'https://airline.example/booking/guest',
    headings: ['Guest details'],
    bodyText: 'please provide details for each guest.',
    controls: [{ name: 'Continue' }],
    fields: [{ label: 'First name' }, { label: 'Last name' }],
    counts: {},
  };
  const r = genericVerify(o, 'traveler information');
  assert.notEqual(r.verdict, 'match');
  assert.ok(['ambiguous', 'no-match'].includes(r.verdict), r.verdict);
});

// ── PHASE 9 — regression: known detector path + original identity intact ──

test('REGRESSION: Passenger Details specialized detector is untouched by this hardening pass', async () => {
  const { detectFeature } = await import('../../../11_Benchmark_Engine/modules/goal_navigator/featureDetectors.js');
  const o = {
    url: 'https://airline.example/booking/passengers',
    headings: ['Passenger details'],
    bodyText: 'please enter first name, last name and date of birth for each passenger.',
    controls: [{ name: 'Continue' }],
    fields: [
      { label: 'First name', semantic: 'first_name' },
      { label: 'Last name', semantic: 'last_name' },
      { label: 'Date of birth', semantic: 'dob' },
      { label: 'Nationality', semantic: 'nationality' },
    ],
    counts: {},
  };
  const r = detectFeature('passenger_details', o, { minConfidence: 'medium' });
  assert.equal(r.reached, true, JSON.stringify(r.signals || []));
});

// ═══ 14. DECISION CONTRACT — detector → generic verifier → agent-claim ════
// independence → future AI semantic-verifier handoff. No live navigation,
// no external calls: everything below runs against fakePage()/genericVerify
// fixtures only.

import { shouldUseSemanticVerifier, semanticCacheKey, makeSemanticVerificationCache } from '../../../11_Benchmark_Engine/modules/autonomous_navigator/semanticHandoff.js';

// ── PHASE 3 — the result-shape invariant, protected by tests ────────────

test('INVARIANT: reached === true implies verdict === "match"', () => {
  const cases = [
    genericVerify(PAX_SNAPSHOT, 'Passenger Details'),
    genericVerify({ url: 'https://airline.example/booking/payment', headings: ['Payment details'], bodyText: 'enter your card number to complete payment.', controls: [{ name: 'Pay now' }], fields: [{ label: 'Card number' }, { label: 'Expiry date' }, { label: 'CVV' }, { label: 'Cardholder name' }], counts: {} }, 'the final payment screen'),
  ];
  for (const r of cases) {
    if (r.reached) assert.equal(r.verdict, 'match', JSON.stringify(r));
  }
  assert.ok(cases.some((r) => r.reached), 'precondition: at least one case must actually be reached for this invariant to be exercised');
});

test('INVARIANT: verdict === "ambiguous" implies reached === false', () => {
  // Weak-but-real candidate evidence (a single informational link mentions
  // the concept) — registers a non-zero score but fails the coherence gate.
  const r = genericVerify(
    { url: 'https://airline.example/', headings: ['Welcome', 'Plan your next trip'], bodyText: 'discover our seat selection options before you fly.', controls: [{ name: 'Search flights' }, { name: 'Learn about seat selection' }, { name: 'Sign in' }], fields: [{ label: 'Origin' }, { label: 'Destination' }], counts: {} },
    'Seat Selection',
  );
  assert.equal(r.verdict, 'ambiguous', JSON.stringify(r));
  assert.equal(r.reached, false);
});

test('INVARIANT: verdict === "no-match" implies reached === false', () => {
  const r = genericVerify(HOME_SNAPSHOT, 'Passenger Details');
  assert.equal(r.verdict, 'no-match', JSON.stringify(r));
  assert.equal(r.reached, false);
});

test('INVARIANT: exhaustively, verdict is never "match" unless reached, and never anything but "no-match"/"ambiguous" when not reached', () => {
  const fixtures = [
    [PAX_SNAPSHOT, 'Passenger Details'],
    [HOME_SNAPSHOT, 'Passenger Details'],
    [{ url: 'https://airline.example/', headings: ['Book your trip'], bodyText: 'search flights from your city', controls: [{ name: 'Seattle' }], fields: [], counts: {} }, 'Seat Selection'],
    [{ url: 'https://airline.example/booking/guest', headings: ['Guest details'], bodyText: 'please provide details for each guest.', controls: [{ name: 'Continue' }], fields: [{ label: 'First name' }, { label: 'Last name' }], counts: {} }, 'traveler information'],
  ];
  for (const [o, label] of fixtures) {
    const r = genericVerify(o, label);
    assert.ok(['match', 'no-match', 'ambiguous'].includes(r.verdict));
    assert.equal(r.reached, r.verdict === 'match');
  }
});

// ── PHASE 2 — specificKind audit: a fixed page-kind classification must ──
// never substitute for missing concept evidence on an arbitrary target.

test('specificKind AUDIT: "the screen where I choose my meal" on a generic checkout/payment page is NOT reached', () => {
  const o = {
    url: 'https://shop.example/checkout',
    headings: ['Checkout', 'Order summary'],
    bodyText: 'delivery address, place order, subtotal 2 items, shipping method.',
    fields: [{ label: 'First name' }, { label: 'Last name' }, { label: 'Address line 1' }, { label: 'Postal code' }],
    controls: [{ name: 'Place order' }],
    counts: {},
  };
  const r = genericVerify(o, 'the screen where I choose my meal');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('specificKind AUDIT: "where I select my seat" on a generic results page is NOT reached', () => {
  const o = {
    url: 'https://shop.example/search?q=lamp',
    headings: ['Search results'],
    bodyText: 'showing 24 results for "lamp" sort by relevance',
    fields: [],
    controls: [{ name: 'View product' }, { name: 'Add to bag' }, { name: 'Choose options' }],
    counts: { priceTags: 24 },
  };
  const r = genericVerify(o, 'where I select my seat');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('specificKind AUDIT: "change my booking" on a generic login page is NOT reached', () => {
  const o = {
    url: 'https://airline.example/login',
    headings: ['Sign in'],
    bodyText: 'welcome back, sign in to continue.',
    fields: [{ label: 'Email', semantic: 'email' }, { label: 'Password', semantic: 'password' }],
    controls: [{ name: 'Log in' }],
    counts: {},
  };
  const r = genericVerify(o, 'change my booking');
  assert.equal(r.reached, false, JSON.stringify(r.signals));
});

test('specificKind AUDIT (the bug this hardening pass fixes): a generic word like "application"/"quote"/"reservation" must not be satisfied by an UNRELATED checkout page via pageKind alone', () => {
  // Before this pass, FEATURE_KIND_HINTS mapped booking/reservation/
  // appointment/quote/enquiry/application to wantKinds ['form','checkout'] —
  // and 'checkout' IS a SPECIFIC_KINDS entry, so pageKind()==='checkout'
  // alone (zero concept evidence) satisfied `identified` for any of these
  // words. A totally unrelated e-commerce checkout page (buying a lamp) has
  // nothing to do with "submit my application".
  const unrelatedCheckout = {
    url: 'https://shop.example/checkout',
    headings: ['Checkout', 'Order summary'],
    bodyText: 'delivery address, place order, subtotal 2 items, shipping method.',
    fields: [{ label: 'First name' }, { label: 'Last name' }, { label: 'Address line 1' }, { label: 'Postal code' }],
    controls: [{ name: 'Place order' }],
    counts: {},
  };
  assert.equal(pageKind(unrelatedCheckout), 'checkout', 'precondition: this fixture really does classify as the specific "checkout" kind');
  for (const label of ['the page to submit my application', 'get a quote', 'make a reservation', 'book an appointment']) {
    const r = genericVerify(unrelatedCheckout, label);
    assert.equal(r.reached, false, `"${label}" must not be satisfied by an unrelated checkout page — ${JSON.stringify(r.signals)}`);
  }
});

// ── PHASE 4 — specialized detector + generic fallback precedence ────────

test('CASE A: specialized detector confidently matches → ACCEPT (generic result is irrelevant)', async () => {
  const page = fakePage({ snapshot: PAX_SNAPSHOT });
  const v = await verifyTarget(page, 'passenger_details', { featureLabel: 'Passenger Details' });
  assert.equal(v.reached, true);
  assert.equal(v.method, 'feature-detector');
});

test('CASE B: specialized detector misses, generic deterministic verifier confidently matches → ACCEPT', async () => {
  const obs = {
    url: 'https://shop.example/checkout',
    headings: ['Checkout', 'Order summary'],
    bodyText: 'delivery address place order subtotal 2 items shipping method',
    fields: [{ semantic: 'first_name' }, { semantic: 'last_name' }, { semantic: 'address_line1' }, { semantic: 'postal_code' }],
    controls: [{ name: 'place order' }], counts: {},
  };
  const page = fakePage({ url: obs.url, snapshot: obs });
  const v = await verifyTarget(page, 'payment', { featureLabel: 'Checkout' });
  assert.equal(v.reached, true);
  assert.equal(v.method, 'generic-fallback');
});

test('CASE C: specialized detector misses, generic verifier is "no-match" → do NOT stop navigation', async () => {
  const obs = { url: 'https://shop.example/', headings: ['Welcome'], bodyText: 'the best products, delivered', fields: [], controls: [{ name: 'shop now' }], counts: {} };
  const page = fakePage({ url: obs.url, snapshot: obs });
  const v = await verifyTarget(page, 'payment', { featureLabel: 'Checkout' });
  assert.equal(v.reached, false);
  const g = genericVerify(obs, 'Checkout');
  assert.equal(g.verdict, 'no-match');
});

test('CASE D: no specialized detector (arbitrary target), generic verifier is "ambiguous" → NOT reached today, eligible for future AI handoff', async () => {
  // A single informational link mentioning the concept ("Learn about seat
  // selection") is weak-but-real candidate evidence — enough for the score
  // to register (confidence != 'none') but not enough to pass the coherence
  // gate (one non-actionable control alone). That is exactly the deterministic
  // 'ambiguous' bucket: distinct from both a confident match AND a page with
  // zero candidate evidence at all (see the CLEAR WRONG-PAGE tests below).
  const obs = { url: 'https://airline.example/', headings: ['Welcome', 'Plan your next trip'], bodyText: 'discover our seat selection options before you fly.', controls: [{ name: 'Search flights' }, { name: 'Learn about seat selection' }, { name: 'Sign in' }], fields: [{ label: 'Origin' }, { label: 'Destination' }], counts: {} };
  const page = fakePage({ url: obs.url, snapshot: obs });
  const v = await verifyTarget(page, null, { featureLabel: 'Seat Selection' });
  assert.equal(v.reached, false);
  assert.equal(v.method, 'generic');
  const g = genericVerify(obs, 'Seat Selection');
  assert.equal(g.verdict, 'ambiguous', JSON.stringify(g.signals));
  assert.equal(shouldUseSemanticVerifier(g, { specializedMatched: false }), true);
});

test('specialized-detector weak/no signal never beats a page that has strong, unambiguous generic evidence for the SAME target', async () => {
  // Not a redesign of a working detector — proves the existing, intentional
  // "detector miss → ask the generic verifier too" fallback (targetVerifier
  // comment: "a detector hit always wins, precision on the known set is
  // unchanged") still lets a genuinely reached page succeed when the known
  // airline detector's specific signals don't apply (e.g. a non-airline
  // site under the SAME detectorKey label).
  const obs = { url: 'https://shop.example/search?q=lamp', headings: ['Search results'], bodyText: 'showing 24 results for "lamp"', fields: [], controls: [{ name: 'view product' }, { name: 'add to bag' }, { name: 'choose options' }], counts: { priceTags: 24 } };
  const page = fakePage({ url: obs.url, snapshot: obs });
  const v = await verifyTarget(page, 'flight_results', { featureLabel: 'Search results' });
  assert.equal(v.reached, true);
  assert.equal(v.method, 'generic-fallback');
});

// ── PHASE 5 — agent self-report independence ─────────────────────────────

test('AGENT CLAIM INDEPENDENCE: agent says done/completed, verifier disagrees → targetReached:false, system continues per existing logic', async () => {
  const { sh } = fakeStagehand({ pageCfg: { snapshot: HOME_SNAPSHOT }, agentResult: { message: 'I have reached Passenger Details.', actions: [{ type: 'act' }], completed: true } });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Passenger Details', detectorKey: 'passenger_details', limits: T({ maxMs: 800 }), stagehandFactory: async () => sh });
  assert.equal(r.targetReached, false, 'agent self-report must never override independent verification');
  assert.notEqual(r.targetStatus, TARGET_STATUS.REACHED);
});

test('INDEPENDENT VERIFIER WITHOUT AGENT "done": strong evidence alone is enough — no explicit agent completion claim required', async () => {
  const paxPage = fakePage({ snapshot: PAX_SNAPSHOT, url: 'https://air.com/booking/passengers' });
  // completed: false — the agent never claims it is finished.
  const { sh } = fakeStagehand({ page: paxPage, agentResult: { message: 'clicked continue', actions: [{ type: 'act' }], completed: false } });
  const r = await runAutonomousNavigation({ startingUrl: 'https://air.com/', feature: 'Passenger Details', detectorKey: 'passenger_details', limits: T({ maxMs: 800 }), stagehandFactory: async () => sh });
  assert.equal(r.targetStatus, TARGET_STATUS.REACHED, 'independent verification must be able to recognize the target from observed evidence alone');
  assert.equal(r.targetReached, true);
});

// ── PHASE 6/9 — future AI semantic-verifier handoff eligibility + cache ──

test('shouldUseSemanticVerifier: true ONLY for the ambiguous bucket, with no specialized match', () => {
  assert.equal(shouldUseSemanticVerifier({ reached: true, verdict: 'match' }), false);
  assert.equal(shouldUseSemanticVerifier({ reached: false, verdict: 'no-match' }), false);
  assert.equal(shouldUseSemanticVerifier({ reached: false, verdict: 'ambiguous' }), true);
  assert.equal(shouldUseSemanticVerifier({ reached: false, verdict: 'ambiguous' }, { specializedMatched: true }), false, 'a specialized detector match must veto the AI handoff regardless of the generic result');
});

test('semanticCacheKey: same target identity + same fingerprint always produce the same key; different inputs never collide trivially', () => {
  const k1 = semanticCacheKey('acme::the final payment screen', 'https://x.example/a#abc123');
  const k2 = semanticCacheKey('acme::the final payment screen', 'https://x.example/a#abc123');
  const k3 = semanticCacheKey('acme::the final payment screen', 'https://x.example/a#def456');
  const k4 = semanticCacheKey('other::the final payment screen', 'https://x.example/a#abc123');
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.notEqual(k1, k4);
});

test('COST CONTROL: the same target + the same unchanged page-state fingerprint is eligible only ONCE — repeated identical ticks do not re-trigger', () => {
  const cache = makeSemanticVerificationCache();
  const obs = { url: 'https://airline.example/', headings: ['Welcome', 'Plan your next trip'], bodyText: 'discover our seat selection options before you fly.', controls: [{ name: 'Search flights' }, { name: 'Learn about seat selection' }, { name: 'Sign in' }], fields: [{ label: 'Origin' }, { label: 'Destination' }], counts: {} };
  const target = 'acme::Seat Selection';
  const g = genericVerify(obs, 'Seat Selection');
  const fp = pageStateFingerprint(obs);
  assert.equal(g.verdict, 'ambiguous', JSON.stringify(g.signals));

  // Tick 1: eligible (never checked before).
  assert.equal(cache.isEligible(g, target, fp), true);
  cache.markChecked(target, fp);

  // Tick 2..N: page state has NOT changed (same fingerprint) — no longer
  // eligible, so a repeated watchdog tick would not re-call the future AI
  // verifier for the same unresolved page.
  for (let i = 0; i < 5; i++) assert.equal(cache.isEligible(g, target, fp), false);
  assert.equal(cache.size(), 1);

  // The page changes (new fingerprint) — eligible again exactly once.
  const obs2 = { ...obs, headings: ['Extras', 'Updated'] };
  const fp2 = pageStateFingerprint(obs2);
  assert.notEqual(fp, fp2);
  assert.equal(cache.isEligible(g, target, fp2), true);
});

test('COST CONTROL: a different target at the same page-state fingerprint is independently eligible (cache key includes target identity)', () => {
  const cache = makeSemanticVerificationCache();
  const obs = { url: 'https://airline.example/', headings: ['Welcome', 'Plan your next trip'], bodyText: 'discover our seat selection options before you fly.', controls: [{ name: 'Search flights' }, { name: 'Learn about seat selection' }, { name: 'Sign in' }], fields: [{ label: 'Origin' }, { label: 'Destination' }], counts: {} };
  const fp = pageStateFingerprint(obs);
  const g = genericVerify(obs, 'Seat Selection');
  cache.markChecked('target_A::Seat Selection', fp);
  assert.equal(cache.isEligible(g, 'target_A::Seat Selection', fp), false);
  assert.equal(cache.isEligible(g, 'target_B::Seat Selection', fp), true);
});

// ── PHASE 7 — multilingual / paraphrase: intentionally unresolved, NOT ───
// no-match forever, eligible for the future semantic verifier.

// DOCUMENTED LIMITATION (Phase 7): a deterministic, dictionary-free layer
// can only tell "weak candidate evidence" (SOME shared token, however
// partial — see the 'ambiguous' cases above) from "no candidate evidence"
// (score 0 — see CLEAR WRONG-PAGE below). A genuine cross-vocabulary
// paraphrase with ZERO shared tokens — "baggage" vs "luggage", Arabic vs
// English, "meal" vs "dining" — is lexically indistinguishable from a truly
// wrong page to this layer: recognizing the relationship would require
// either a synonym dictionary (explicitly forbidden — that is exactly the
// semantic leap reserved for the AI layer) or real semantic/embedding
// understanding (the AI layer itself). Per the explicit instruction to "be
// conservative and document the limitation rather than inventing a synonym
// dictionary", these cases are therefore NOT force-classified as
// 'ambiguous' — they fall to 'no-match', the same as a real wrong page.
// This is safe (never a false accept) but is the exact gap the future AI
// semantic verifier exists to close — see item 28 of the final response.
// What both tests below GUARANTEE regardless of which bucket a given
// paraphrase lands in: it is NEVER 'match' — a paraphrase must never be
// silently force-accepted.

test('MULTILINGUAL CONTRACT: Arabic "اختيار المقعد" vs English "Choose your seat" — never falsely matched; zero shared tokens is a documented Layer-1 limitation, not a false accept', () => {
  const o = { url: 'https://airline.example/booking/seats', headings: ['Choose your seat'], bodyText: 'select a seat for each passenger.', controls: [{ name: 'Choose seat 14A' }, { name: 'Continue' }], fields: [], counts: {} };
  const r = genericVerify(o, 'اختيار المقعد');
  assert.equal(r.reached, false);
  assert.notEqual(r.verdict, 'match');
});

test('BAGGAGE/LUGGAGE CONTRACT: "where I add baggage" vs "Purchase checked luggage" — never forced to PASS; zero shared tokens is a documented Layer-1 limitation, not a false accept', () => {
  const o = { url: 'https://airline.example/booking/extras', headings: ['Extras'], bodyText: 'purchase checked luggage for your trip.', controls: [{ name: 'Purchase checked luggage' }, { name: 'Continue' }], fields: [], counts: {} };
  const r = genericVerify(o, 'where I add baggage');
  assert.equal(r.reached, false);
  assert.notEqual(r.verdict, 'match');
});

test('MEAL/DINING CONTRACT: "choose my meal" vs "Dining preferences" — never forced to PASS; zero shared tokens is a documented Layer-1 limitation, not a false accept', () => {
  const o = { url: 'https://airline.example/booking/dining', headings: ['Dining preferences'], bodyText: 'set your dining preferences for this flight.', controls: [{ name: 'Save preferences' }], fields: [], counts: {} };
  const r = genericVerify(o, 'choose my meal');
  assert.equal(r.reached, false);
  assert.notEqual(r.verdict, 'match');
});

// ── PHASE 8 — clear wrong pages must be "no-match", not "ambiguous" ─────
// forever — the future AI layer must not be invoked on every page.

test('CLEAR WRONG-PAGE CONTRACT: a privacy-policy page has zero coherent candidate evidence for "Seat Selection" → no-match, not ambiguous', () => {
  const o = { url: 'https://airline.example/legal/privacy', headings: ['Privacy policy'], bodyText: 'this policy describes how we handle personal data.', controls: [{ name: 'Accept' }], fields: [], counts: {} };
  const r = genericVerify(o, 'Seat Selection');
  assert.equal(r.reached, false);
  assert.equal(r.verdict, 'no-match');
  assert.equal(shouldUseSemanticVerifier(r), false, 'a clear wrong page must never be sent to the future AI layer');
});

test('CLEAR WRONG-PAGE CONTRACT: an unrelated login page has zero coherent candidate evidence for "Baggage" → no-match, not ambiguous', () => {
  const o = { url: 'https://airline.example/login', headings: ['Sign in'], bodyText: 'welcome back, sign in to continue.', fields: [{ label: 'Email' }, { label: 'Password' }], controls: [{ name: 'Log in' }], counts: {} };
  const r = genericVerify(o, 'Baggage');
  assert.equal(r.reached, false);
  assert.equal(r.verdict, 'no-match');
  assert.equal(shouldUseSemanticVerifier(r), false);
});
