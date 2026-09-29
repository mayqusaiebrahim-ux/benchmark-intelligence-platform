/**
 * TEMPORARY ACCESS PROBE — remove after test
 *
 * Unit tests for the one-shot access probe. launchBrowser is mocked via the
 * probe's test seam — no browser, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { runAccessProbe } = await import('../../../11_Benchmark_Engine/modules/diagnostics/accessProbe.js');

const URL_UNDER_TEST = 'https://www.example-air.com/en/homepage.html';
const PROFILE = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36', viewport: { width: 1440, height: 900 }, locale: 'en-US' };

function fakeLaunch({ status = 200, server = 'Apache', title = 'Example Air — Book flights', body = 'Book a flight', gotoError = null } = {}) {
  const calls = { launches: [], newPageArgs: [], gotos: [], closes: 0 };
  const page = {
    async goto(url, opts) { calls.gotos.push({ url, opts }); if (gotoError) throw new Error(gotoError); return { status: () => status, headers: () => ({ server }) }; },
    async waitForLoadState() {},
    async title() { return title; },
    url: () => URL_UNDER_TEST,
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('innerText')) return body;
      if (src.includes('userAgent')) return PROFILE.userAgent;
      if (src.includes('webdriver')) return false;
      return null;
    },
  };
  const launch = async (label) => {
    calls.launches.push(label);
    return {
      browser: { async newPage(opts) { calls.newPageArgs.push(opts); return page; } },
      pageOptions: PROFILE,
      close: async () => { calls.closes += 1; },
    };
  };
  return { launch, calls };
}

test('uses the production session.pageOptions, loads ONLY the given URL once, closes the session', async () => {
  const { launch, calls } = fakeLaunch();
  await runAccessProbe(URL_UNDER_TEST, { launch });
  assert.deepEqual(calls.launches, ['AccessProbe']);
  assert.equal(calls.newPageArgs[0], PROFILE, 'page created with session.pageOptions');
  assert.equal(calls.gotos.length, 1, 'exactly one page load');
  assert.equal(calls.gotos[0].url, URL_UNDER_TEST);
  assert.equal(calls.gotos[0].opts.waitUntil, 'domcontentloaded');
  assert.equal(calls.closes, 1);
});

test('real page → ACCESSIBLE with exactly the reported fields', async () => {
  const { launch } = fakeLaunch();
  const r = await runAccessProbe(URL_UNDER_TEST, { launch });
  assert.deepEqual(r, {
    httpStatus: 200, server: 'Apache', title: 'Example Air — Book flights', finalUrl: URL_UNDER_TEST,
    blockSignal: null, verdict: 'ACCESSIBLE', userAgent: PROFILE.userAgent, webdriver: false,
  });
});

test('Akamai-style 403 "Access Denied" → BLOCKED with the block signal', async () => {
  const { launch } = fakeLaunch({ status: 403, server: 'AkamaiGHost', title: 'Access Denied', body: "You don't have permission to access this server. Reference #18.abc" });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch });
  assert.equal(r.verdict, 'BLOCKED');
  assert.equal(r.httpStatus, 403);
  assert.equal(r.server, 'AkamaiGHost');
  assert.match(r.blockSignal, /access denied/i);
});

test('navigation error → NAVIGATION_ERROR, session still closed', async () => {
  const { launch, calls } = fakeLaunch({ gotoError: 'page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at x' });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch });
  assert.equal(r.verdict, 'NAVIGATION_ERROR');
  assert.match(r.error, /ERR_HTTP2_PROTOCOL_ERROR/);
  assert.equal(calls.closes, 1);
});

test('the probe module imports nothing but browserLauncher (no OpenAI / Vision / Reasoning / R2 / pipeline)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '11_Benchmark_Engine', 'modules', 'diagnostics', 'accessProbe.js'), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../browserLauncher.js']);
  assert.ok(!/openai|vision|reasoning|storage|orchestrator|pipeline/i.test(imports.join(' ')));
});
