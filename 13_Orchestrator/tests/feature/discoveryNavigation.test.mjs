/**
 * Discovery page-load tolerance — deterministic, no network, no browser.
 *
 * Live failure: feature_discovery's page.goto(url, { waitUntil: 'load' })
 * hit its 30s timeout on a dynamic site whose DOM was ready long before
 * every third-party resource finished, so the run never reached navigation.
 * Discovery must proceed once DOMContentLoaded succeeds, and must still fail
 * on a real navigation error.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const DISCOVERY = '../../../11_Benchmark_Engine/modules/discovery/index.js';

// One configurable fake page, shared by the module mocks below.
const scenario = { goto: null, networkidle: 'idle' };
const calls = { goto: [], closes: 0 };

function fakePage() {
  return {
    on() {},
    url: () => 'https://www.example-air.com/',
    async goto(url, opts) {
      calls.goto.push({ url, opts });
      return scenario.goto(url, opts);
    },
    async waitForLoadState(state) {
      if (state === 'networkidle' && scenario.networkidle === 'never') {
        throw new Error('page.waitForLoadState: Timeout 8000ms exceeded.');
      }
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

const { runDiscovery } = await import(DISCOVERY);

function reset() {
  calls.goto.length = 0;
  calls.closes = 0;
  scenario.networkidle = 'idle';
}

// A page whose DOM is ready but whose "load" event never fires in time (slow
// third-party resources): waiting for 'load' times out, 'domcontentloaded' resolves.
const slowLoadEventSite = async (_url, opts) => {
  if (opts.waitUntil === 'load') throw new Error('page.goto: Timeout 30000ms exceeded.');
  return { status: () => 200 };
};

test('discovery navigates with waitUntil "domcontentloaded" (not "load"), keeping the 30s timeout', async () => {
  reset();
  scenario.goto = slowLoadEventSite;
  await runDiscovery({ url: 'https://www.example-air.com/' });
  assert.equal(calls.goto.length, 1);
  assert.equal(calls.goto[0].opts.waitUntil, 'domcontentloaded');
  assert.equal(calls.goto[0].opts.timeout, 30000, 'the navigation timeout is unchanged');
});

test('a site that never reaches the load event still completes discovery once the DOM is ready', async () => {
  reset();
  scenario.goto = slowLoadEventSite;
  scenario.networkidle = 'never'; // analytics / long-polling never go idle either
  const report = await runDiscovery({ url: 'https://www.example-air.com/', companySlug: 'example_air' });
  assert.equal(report.resolved_url, 'https://www.example-air.com/');
  assert.equal(report.http_status, 200);
  assert.equal(report.company_slug, 'example_air');
  assert.equal(calls.closes, 1, 'browser session closed');
});

test('a real navigation/network error still fails discovery (not reported as success)', async () => {
  reset();
  scenario.goto = async () => { throw new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.example-air.com/'); };
  await assert.rejects(runDiscovery({ url: 'https://www.example-air.com/' }), /ERR_NAME_NOT_RESOLVED/);
  assert.equal(calls.closes, 1, 'browser session still closed on failure');
});

test('a page that cannot even reach DOMContentLoaded within 30s still fails discovery', async () => {
  reset();
  scenario.goto = async () => { throw new Error('page.goto: Timeout 30000ms exceeded.'); };
  await assert.rejects(runDiscovery({ url: 'https://www.example-air.com/' }), /Timeout 30000ms exceeded/);
  assert.equal(calls.closes, 1);
});
