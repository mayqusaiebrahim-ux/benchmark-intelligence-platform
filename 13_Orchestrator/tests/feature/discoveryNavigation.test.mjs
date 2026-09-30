/**
 * Discovery page-load tolerance — deterministic, no network, no browser.
 *
 * Live failures:
 *  - waitUntil 'load' timed out at 30s on a dynamic site (fixed earlier);
 *  - waitUntil 'domcontentloaded' then timed out at 30s on a site that
 *    responded HTTP 200 with a real page but kept document.readyState
 *    "loading" — so the pipeline never reached navigation.
 * Discovery must only require the navigation to COMMIT; DOMContentLoaded is
 * a bounded best-effort wait. A genuine navigation/connection failure, or a
 * response with no document body, must still fail discovery.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const DISCOVERY = '../../../11_Benchmark_Engine/modules/discovery/index.js';

// One configurable fake page, shared by the module mocks below.
const scenario = { goto: null, domReady: 'ok', hasBody: true, networkidle: 'idle' };
const calls = { goto: [], loadStates: [], closes: 0 };

function fakePage() {
  return {
    on() {},
    url: () => 'https://www.example-air.com/',
    async goto(url, opts) {
      calls.goto.push({ url, opts });
      // Like real Playwright: a goto that waits for a lifecycle event the
      // document never reaches times out (the exact live failure).
      if (scenario.domReady === 'never' && (opts?.waitUntil === 'domcontentloaded' || opts?.waitUntil === 'load')) {
        await scenario.goto(url, opts); // the response still arrives…
        throw new Error(`page.goto: Timeout ${opts.timeout}ms exceeded.`); // …but the event never fires
      }
      return scenario.goto(url, opts);
    },
    async waitForLoadState(state, opts) {
      calls.loadStates.push({ state, opts });
      if (state === 'domcontentloaded' && scenario.domReady === 'never') {
        throw new Error(`page.waitForLoadState: Timeout ${opts?.timeout}ms exceeded.`);
      }
      if (state === 'networkidle' && scenario.networkidle === 'never') {
        throw new Error('page.waitForLoadState: Timeout 8000ms exceeded.');
      }
    },
    async evaluate(fn) {
      if (String(fn).includes('document.body')) return scenario.hasBody;
      return null;
    },
    async waitForTimeout() {},
  };
}

const RAW = {
  title: 'Example Air', metaDescription: '', viewportMeta: 'width=device-width', htmlLang: 'en',
  hreflangs: [], navLinks: [], footerLinks: [], ctaButtons: [], forms: [], aiCopyHints: [],
  searchCopyHints: [], loginHints: [], languageSelectorHints: [], hasLanguageSelectEl: false,
  appStoreLinks: [], consentCandidate: null, navToggleCandidate: null, aiWidgetCandidates: [], overlayHints: [],
};

mock.module('../../../11_Benchmark_Engine/modules/browserLauncher.js', {
  namedExports: {
    launchBrowser: async () => ({
      browser: { on() {}, async newPage() { return fakePage(); } },
      close: async () => { calls.closes += 1; },
    }),
  },
});
mock.module('../../../11_Benchmark_Engine/modules/discovery/signals.js', {
  namedExports: { extractRawSignals: async () => ({ ...RAW }) },
});
mock.module('../../../11_Benchmark_Engine/modules/discovery/actions.js', {
  namedExports: { dismissConsentBanner: async () => null, expandNavigationMenu: async () => null },
});

const { runDiscovery, NAV_COMMIT_TIMEOUT_MS, DOM_READY_TIMEOUT_MS } = await import(DISCOVERY);

function reset() {
  calls.goto.length = 0;
  calls.loadStates.length = 0;
  calls.closes = 0;
  scenario.domReady = 'ok';
  scenario.hasBody = true;
  scenario.networkidle = 'idle';
}
const ok200 = async () => ({ status: () => 200 });

test('navigation only has to COMMIT (60s bound); DOMContentLoaded is a separate bounded wait (30s)', async () => {
  reset();
  scenario.goto = ok200;
  await runDiscovery({ url: 'https://www.example-air.com/' });
  assert.equal(calls.goto.length, 1, 'exactly one navigation');
  assert.deepEqual(calls.goto[0].opts, { waitUntil: 'commit', timeout: 60000 });
  assert.equal(NAV_COMMIT_TIMEOUT_MS, 60000);
  assert.equal(DOM_READY_TIMEOUT_MS, 30000);
  const dcl = calls.loadStates.find((s) => s.state === 'domcontentloaded');
  assert.deepEqual(dcl.opts, { timeout: 30000 });
});

test('normal site: DOMContentLoaded arrives → discovery completes', async () => {
  reset();
  scenario.goto = ok200;
  const report = await runDiscovery({ url: 'https://www.example-air.com/', companySlug: 'example_air' });
  assert.equal(report.resolved_url, 'https://www.example-air.com/');
  assert.equal(report.http_status, 200);
  assert.equal(report.company_slug, 'example_air');
  assert.equal(calls.closes, 1, 'browser session closed');
});

test('site responds but never reaches DOMContentLoaded within the bounded wait → discovery CONTINUES with the committed document', async () => {
  reset();
  scenario.goto = ok200;
  scenario.domReady = 'never';     // document stays "loading"
  scenario.networkidle = 'never';  // and never goes idle either
  const report = await runDiscovery({ url: 'https://www.example-air.com/' });
  assert.equal(report.http_status, 200);
  assert.equal(report.resolved_url, 'https://www.example-air.com/');
  assert.equal(calls.closes, 1);
});

test('responds but no document body after the bounded wait → discovery still FAILS (page unavailable)', async () => {
  reset();
  scenario.goto = ok200;
  scenario.domReady = 'never';
  scenario.hasBody = false;
  await assert.rejects(runDiscovery({ url: 'https://www.example-air.com/' }), /no document body was available/);
  assert.equal(calls.closes, 1, 'browser session still closed on failure');
});

test('a real navigation/network error still fails discovery (not reported as success)', async () => {
  reset();
  scenario.goto = async () => { throw new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.example-air.com/'); };
  await assert.rejects(runDiscovery({ url: 'https://www.example-air.com/' }), /ERR_NAME_NOT_RESOLVED/);
  assert.equal(calls.closes, 1, 'browser session still closed on failure');
});

test('no response committed within the 60s bound still fails discovery', async () => {
  reset();
  scenario.goto = async () => { throw new Error('page.goto: Timeout 60000ms exceeded.'); };
  await assert.rejects(runDiscovery({ url: 'https://www.example-air.com/' }), /Timeout 60000ms exceeded/);
  assert.equal(calls.closes, 1);
});
