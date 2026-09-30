/**
 * Navigation Runner starting-page readiness — deterministic, no network, no browser.
 *
 * Same live failure class as Discovery: a site responds HTTP 200 with a real
 * page but keeps the document loading, so page.goto(url, { waitUntil: 'load',
 * timeout: 30000 }) timed out. The starting-page load (ensureBrowser) and the
 * per-step re-baseline (safeGoto) now only require the navigation to COMMIT;
 * the load event is a bounded best-effort wait.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SLUG = '_readinesstest';
function scrubArtifacts() {
  for (const p of [`03_Screenshots/${SLUG}`, `02_Benchmark_Repository/_Navigation_Runs/${SLUG}`]) {
    try { rmSync(join(REPO_ROOT, p), { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const URL_UNDER_TEST = 'https://www.example-air.com/';

// scenario: goto = 'ok' | 'neterror' | 'committimeout'; ready = 'ok' | 'never'; hasBody
const scenario = { goto: 'ok', ready: 'ok', hasBody: true };
const calls = { gotos: [], loadStates: [], closes: 0, launches: 0 };

function fakePage() {
  return {
    on() {},
    url: () => URL_UNDER_TEST,
    async goto(url, opts) {
      calls.gotos.push({ url, opts });
      if (scenario.goto === 'neterror') throw new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${url}`);
      if (scenario.goto === 'committimeout') throw new Error(`page.goto: Timeout ${opts.timeout}ms exceeded.`);
      // Like real Playwright: waiting for a lifecycle event the document never reaches times out.
      if (scenario.ready === 'never' && (opts.waitUntil === 'load' || opts.waitUntil === 'domcontentloaded')) {
        throw new Error(`page.goto: Timeout ${opts.timeout}ms exceeded.`);
      }
      return { status: () => 200 };
    },
    async waitForLoadState(state, opts) {
      calls.loadStates.push({ state, opts });
      if (scenario.ready === 'never') throw new Error(`page.waitForLoadState: Timeout ${opts?.timeout}ms exceeded.`);
    },
    async evaluate(fn) {
      if (String(fn).includes('document.body')) return scenario.hasBody;
      return null;
    },
  };
}

function reset(overrides = {}) {
  Object.assign(scenario, { goto: 'ok', ready: 'ok', hasBody: true }, overrides);
  calls.gotos.length = 0; calls.loadStates.length = 0; calls.closes = 0; calls.launches = 0;
}

mock.module('../../../11_Benchmark_Engine/modules/browserLauncher.js', {
  namedExports: {
    launchBrowser: async () => {
      calls.launches += 1;
      return { browser: { on() {}, async newPage() { return fakePage(); } }, close: async () => { calls.closes += 1; } };
    },
  },
});

const { gotoWithBoundedReadiness, NAV_COMMIT_TIMEOUT_MS, PAGE_READY_TIMEOUT_MS } =
  await import('../../../11_Benchmark_Engine/modules/navigation_runner/pageReadiness.js');
const { safeGoto } = await import('../../../11_Benchmark_Engine/modules/navigation_runner/actions.js');
const { runJourney } = await import('../../../11_Benchmark_Engine/modules/navigation_runner/index.js');

// ─── helper ────────────────────────────────────────────────────────────────
test('readiness: navigation commits (60s bound); load is a separate bounded wait (30s); then the existing networkidle settle', async () => {
  reset();
  const resp = await gotoWithBoundedReadiness(fakePage(), URL_UNDER_TEST);
  assert.equal(resp.status(), 200);
  assert.equal(NAV_COMMIT_TIMEOUT_MS, 60000);
  assert.equal(PAGE_READY_TIMEOUT_MS, 30000);
  assert.deepEqual(calls.gotos[0].opts, { waitUntil: 'commit', timeout: 60000 });
  assert.deepEqual(calls.loadStates.map((s) => [s.state, s.opts.timeout]), [['load', 30000], ['networkidle', 8000]]);
});

test('readiness: normal page → resolves', async () => {
  reset();
  await assert.doesNotReject(gotoWithBoundedReadiness(fakePage(), URL_UNDER_TEST));
});

test('readiness: committed page that remains loading (with a body) → continues', async () => {
  reset({ ready: 'never', hasBody: true });
  const resp = await gotoWithBoundedReadiness(fakePage(), URL_UNDER_TEST);
  assert.equal(resp.status(), 200);
});

test('readiness: response with no usable document body → fails as page unavailable', async () => {
  reset({ ready: 'never', hasBody: false });
  await assert.rejects(gotoWithBoundedReadiness(fakePage(), URL_UNDER_TEST), /no document body was available/);
});

test('readiness: genuine navigation error → fails', async () => {
  reset({ goto: 'neterror' });
  await assert.rejects(gotoWithBoundedReadiness(fakePage(), URL_UNDER_TEST), /ERR_CONNECTION_REFUSED/);
});

test('readiness: no response within the commit bound → fails', async () => {
  reset({ goto: 'committimeout' });
  await assert.rejects(gotoWithBoundedReadiness(fakePage(), URL_UNDER_TEST), /Timeout 60000ms exceeded/);
});

// ─── safeGoto (per-step re-baseline to starting_url) ────────────────────────
test('safeGoto uses the same readiness: remains loading → continues; no body → rejects (runner reports that step as failed)', async () => {
  reset({ ready: 'never', hasBody: true });
  await assert.doesNotReject(safeGoto(fakePage(), URL_UNDER_TEST));
  assert.deepEqual(calls.gotos[0].opts, { waitUntil: 'commit', timeout: 60000 });
  reset({ ready: 'never', hasBody: false });
  await assert.rejects(safeGoto(fakePage(), URL_UNDER_TEST), /no document body was available/);
});

// ─── runJourney starting-page load + cleanup on every path ─────────────────
const PLAN = { starting_url: URL_UNDER_TEST, company_slug: SLUG, primary_goal: 'x', recommended_journey: [] };

async function runWith(overrides, t) {
  reset(overrides);
  const saved = process.env.NAVIGATION_MODE;
  process.env.NAVIGATION_MODE = 'heuristic';
  t.after(() => { if (saved == null) delete process.env.NAVIGATION_MODE; else process.env.NAVIGATION_MODE = saved; scrubArtifacts(); });
  return runJourney({ journeyPlan: PLAN, companyName: 'Example Air', companySlug: SLUG });
}

test('runJourney: normal page → starting page loaded via commit, browser closed', async (t) => {
  const r = await runWith({}, t);
  assert.equal(r.company_slug, SLUG);
  assert.equal(calls.launches, 1);
  assert.deepEqual(calls.gotos[0].opts, { waitUntil: 'commit', timeout: 60000 });
  assert.equal(calls.closes, 1);
});

test('runJourney: committed page that remains loading → run continues, browser closed', async (t) => {
  const r = await runWith({ ready: 'never', hasBody: true }, t);
  assert.equal(r.company_slug, SLUG);
  assert.equal(calls.closes, 1);
});

test('runJourney: no usable document body → run fails, browser still closed', async (t) => {
  await assert.rejects(runWith({ ready: 'never', hasBody: false }, t), /no document body was available/);
  assert.equal(calls.closes, 1);
});

test('runJourney: genuine navigation error → run fails, browser still closed', async (t) => {
  await assert.rejects(runWith({ goto: 'neterror' }, t), /ERR_CONNECTION_REFUSED/);
  assert.equal(calls.closes, 1);
});

test('runJourney: no response within the commit bound → run fails, browser still closed', async (t) => {
  await assert.rejects(runWith({ goto: 'committimeout' }, t), /Timeout 60000ms exceeded/);
  assert.equal(calls.closes, 1);
});
