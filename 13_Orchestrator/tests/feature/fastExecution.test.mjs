/**
 * Faster, fail-fast execution — offline. Browser, Discovery signal
 * extraction/actions and the agent are mocked: no browser, no network, no model.
 *  - light Discovery skips the idle wait, consent click, menu expansion, re-extraction
 *  - the first Navigation Runner step does not reload starting_url
 *  - the homepage observe step adds no second idle wait
 *  - an agent CRASH is terminal (no heuristic re-run); "unavailable" still falls back
 *  - Discovery entry points reach the agent as hints
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SLUG = '_fastexectest';
function scrub() {
  for (const p of [`03_Screenshots/${SLUG}`, `02_Benchmark_Repository/_Navigation_Runs/${SLUG}`]) {
    try { rmSync(join(REPO_ROOT, p), { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
const NAV = '../../../11_Benchmark_Engine/modules/autonomous_navigator/autonomousNavigator.js';

// ─── one fake page that records everything ─────────────────────────────────
const rec = { gotos: [], loadStates: [], extracts: 0, consentClicks: 0, menuExpands: 0, launches: 0 };
function fakePage() {
  return {
    on() {},
    url: () => 'https://www.example-air.com/',
    async goto(url, opts) { rec.gotos.push({ url, opts }); return { status: () => 200 }; },
    async waitForLoadState(state, opts) { rec.loadStates.push({ state, opts }); },
    async waitForTimeout() {},
    async evaluate() { return true; },
    async screenshot() {},
    async content() { return '<html><body>ok</body></html>'; },
    async title() { return 'Example Air'; },
  };
}
mock.module('../../../11_Benchmark_Engine/modules/browserLauncher.js', {
  namedExports: {
    launchBrowser: async () => { rec.launches += 1; return { browser: { on() {}, async newPage() { return fakePage(); } }, close: async () => {} }; },
    withBrowserSlot: async (fn) => fn(),
  },
});
const RAW = {
  title: 'Example Air', metaDescription: '', viewportMeta: '', htmlLang: 'en', hreflangs: [],
  navLinks: [{ label: 'Online Check-in', href: '/check-in' }], footerLinks: [{ label: 'Careers', href: '/careers' }],
  ctaButtons: [], forms: [], aiCopyHints: [], searchCopyHints: [], loginHints: [], languageSelectorHints: [],
  hasLanguageSelectEl: false, appStoreLinks: [],
  consentCandidate: { text: 'We use cookies to improve your experience.', acceptCandidates: [] },  // real shape (signals.js)
  navToggleCandidate: { name: 'Menu', ariaExpanded: false },                                    // real shape (signals.js)
  aiWidgetCandidates: [], overlayHints: [],
};
mock.module('../../../11_Benchmark_Engine/modules/discovery/signals.js', {
  namedExports: { extractRawSignals: async () => { rec.extracts += 1; return { ...RAW }; } },
});
mock.module('../../../11_Benchmark_Engine/modules/discovery/actions.js', {
  namedExports: {
    dismissConsentBanner: async () => { rec.consentClicks += 1; return { action: 'dismiss_consent_banner', evidence: 'clicked "Accept"' }; },
    expandNavigationMenu: async () => { rec.menuExpands += 1; return { action: 'expand_navigation_menu', evidence: 'expanded "Menu"' }; },
  },
});

// agent mocked: behaviour + recorded args
const agent = { mode: 'reach', available: true, calls: [] };
const realNav = await import(NAV);
mock.module(NAV, {
  namedExports: {
    ...realNav,
    agentModeAvailable: () => agent.available,
    runAutonomousNavigation: async (args) => {
      agent.calls.push(args);
      if (agent.mode === 'crash') throw new Error('CDP session closed unexpectedly');
      return { navigator: 'agent', targetStatus: 'target_reached', targetReached: true, interactionsPerformed: ['act'], safetyBlocks: [] };
    },
  },
});

const { runDiscovery } = await import('../../../11_Benchmark_Engine/modules/discovery/index.js');
const { executeStep } = await import('../../../11_Benchmark_Engine/modules/navigation_runner/runner.js');
const { performStepAction } = await import('../../../11_Benchmark_Engine/modules/navigation_runner/actions.js');

function reset() {
  rec.gotos.length = 0; rec.loadStates.length = 0;
  rec.extracts = 0; rec.consentClicks = 0; rec.menuExpands = 0; rec.launches = 0;
  agent.mode = 'reach'; agent.available = true; agent.calls.length = 0;
}

// ─── Discovery ─────────────────────────────────────────────────────────────
test('light Discovery: commit + bounded DOMContentLoaded + one extraction; no idle wait, consent click, menu expansion or re-extraction', async () => {
  reset();
  const report = await runDiscovery({ url: 'https://www.example-air.com/', light: true });
  assert.deepEqual(rec.gotos[0].opts, { waitUntil: 'commit', timeout: 60000 });
  assert.deepEqual(rec.loadStates.map((s) => s.state), ['domcontentloaded']);
  assert.equal(rec.extracts, 1);
  assert.equal(rec.consentClicks, 0);
  assert.equal(rec.menuExpands, 0);
  assert.equal(report.resolved_url, 'https://www.example-air.com/');
  assert.deepEqual(report.footer_links, [{ label: 'Careers', href: '/careers' }], 'footer links now in the report');
  assert.deepEqual(report.actions_taken, []);
});

test('full Discovery (default) is unchanged: idle wait, consent, menu, re-extraction', async () => {
  reset();
  await runDiscovery({ url: 'https://www.example-air.com/' });
  assert.deepEqual(rec.loadStates.map((s) => s.state), ['domcontentloaded', 'networkidle']);
  assert.equal(rec.consentClicks, 1);
  assert.equal(rec.menuExpands, 1);
  assert.equal(rec.extracts, 2);
});

// ─── Navigation Runner ─────────────────────────────────────────────────────
const HOME_STEP = { id: 'step_01_entry', step_id: 'step_01_entry', title: 'Open and inspect the homepage', depends_on_previous: false, goal_driven: false };
const PLAN = { starting_url: 'https://www.example-air.com/', company_slug: SLUG, recommended_journey: [HOME_STEP] };

test('first step: no reload of starting_url (ensureBrowser just loaded it) and no second idle wait for observe', async (t) => {
  reset();
  t.after(scrub);
  const r = await executeStep({ page: fakePage(), ensureBrowser: async () => fakePage(), step: HOME_STEP, index: 0, journeyPlan: PLAN, companySlug: SLUG, runId: 'run0', previousStepFailed: false });
  assert.equal(r.status, 'success');
  assert.equal(rec.gotos.length, 0, 'no re-baseline navigation on the first step');
  assert.equal(rec.loadStates.filter((s) => s.state === 'networkidle').length, 0, 'observe adds no idle wait');
});

test('later independent steps still re-baseline to starting_url (unchanged)', async (t) => {
  reset();
  t.after(scrub);
  await executeStep({ page: fakePage(), ensureBrowser: async () => fakePage(), step: HOME_STEP, index: 1, journeyPlan: PLAN, companySlug: SLUG, runId: 'run1', previousStepFailed: false });
  assert.equal(rec.gotos.length, 1);
  assert.equal(rec.gotos[0].url, 'https://www.example-air.com/');
  assert.deepEqual(rec.gotos[0].opts, { waitUntil: 'commit', timeout: 60000 });
});

// ─── agent fail-fast + hints ───────────────────────────────────────────────
const GOAL_STEP = {
  id: 'step_11_checkin', goal_driven: true, detector_key: 'checkin', feature_label: 'Online check-in',
  entry_points: [{ label: 'Online Check-in', url: 'https://www.example-air.com/check-in', score: 2 }],
};

test('agent CRASH → terminal failed result; the heuristic navigator is NOT started (no browser launched)', async () => {
  reset();
  agent.mode = 'crash';
  let ensureCalls = 0;
  const r = await performStepAction(null, GOAL_STEP, { companySlug: 'x', startingUrl: 'https://www.example-air.com/', ensureBrowser: async () => { ensureCalls += 1; return fakePage(); } });
  assert.equal(r.success, false);
  assert.equal(r.terminal, true);
  assert.match(r.error, /"Online check-in" was not reached — agent navigation crashed: CDP session closed unexpectedly/);
  assert.equal(r.goal.targetStatus, 'unrecoverable_blocker');
  assert.equal(ensureCalls, 0, 'no lazy browser for a heuristic re-run');
  assert.equal(rec.launches, 0);
});

test('agent UNAVAILABLE → heuristic fallback is still used', async () => {
  reset();
  agent.available = false;
  let ensureCalls = 0;
  const r = await performStepAction(null, GOAL_STEP, { companySlug: 'x', startingUrl: 'https://www.example-air.com/', ensureBrowser: async () => { ensureCalls += 1; throw new Error('no browser in test'); } });
  assert.equal(ensureCalls, 1, 'heuristic path tried to acquire a browser');
  assert.equal(agent.calls.length, 0);
  assert.match(r.error, /agent mode could not run and no browser is available for the heuristic fallback/);
});

test('Discovery entry points reach the agent as hints (the agent still starts from the homepage)', async () => {
  reset();
  const r = await performStepAction(null, GOAL_STEP, { companySlug: 'x', startingUrl: 'https://www.example-air.com/' });
  assert.equal(r.success, true);
  assert.equal(agent.calls.length, 1);
  assert.deepEqual(agent.calls[0].entryPoints, GOAL_STEP.entry_points);
  assert.equal(agent.calls[0].startingUrl, 'https://www.example-air.com/');
});
