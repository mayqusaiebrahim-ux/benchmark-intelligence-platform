/**
 * TEMPORARY ACCESS PROBE — remove after test
 *
 * Unit tests for the one-shot access probe. launchBrowser is mocked via the
 * probe's test seam — no browser, no network, no real waiting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { runAccessProbe } = await import('../../../11_Benchmark_Engine/modules/diagnostics/accessProbe.js');

const URL_UNDER_TEST = 'https://www.example-air.com/en/homepage.html';
const PROFILE = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36', viewport: { width: 1440, height: 900 }, locale: 'en-US' };
const FAST = { waitMs: 0, readTimeoutMs: 50 };
const never = () => new Promise(() => {});

function fakeLaunch({ status = 200, server = 'Apache', title = 'Example Air — Book flights', body = 'Book a flight', readyState = 'complete', gotoError = null, noResponse = false, titleHangs = false } = {}) {
  const calls = { launches: [], newPageArgs: [], gotos: [], closes: 0 };
  const page = {
    async goto(url, opts) {
      calls.gotos.push({ url, opts });
      if (gotoError) throw new Error(gotoError);
      return noResponse ? null : { status: () => status, headers: () => ({ server }) };
    },
    async waitForLoadState() { throw new Error('the probe must NOT wait for a load state'); },
    title() { return titleHangs ? never() : Promise.resolve(title); },
    url: () => URL_UNDER_TEST,
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('readyState')) return readyState;
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

test('uses session.pageOptions, ONE goto with waitUntil "commit" + 60s timeout, no networkidle, session closed', async () => {
  const { launch, calls } = fakeLaunch();
  await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.deepEqual(calls.launches, ['AccessProbe']);
  assert.equal(calls.newPageArgs[0], PROFILE);
  assert.equal(calls.gotos.length, 1, 'exactly one page load');
  assert.equal(calls.gotos[0].url, URL_UNDER_TEST);
  assert.deepEqual(calls.gotos[0].opts, { waitUntil: 'commit', timeout: 60000 });
  assert.equal(calls.closes, 1);
});

test('1. no HTTP response (goto throws) → CONNECTION_FAILED with navigationError', async () => {
  const { launch, calls } = fakeLaunch({ gotoError: 'page.goto: Timeout 60000ms exceeded.' });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.equal(r.verdict, 'CONNECTION_FAILED');
  assert.match(r.navigationError, /Timeout 60000ms exceeded/);
  assert.equal(r.httpStatus, null);
  assert.equal(calls.closes, 1);
});

test('2a. response received but document still "loading" → RESPONSE_NOT_LOADED (status kept)', async () => {
  const { launch } = fakeLaunch({ readyState: 'loading', title: '', body: '' });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.equal(r.verdict, 'RESPONSE_NOT_LOADED');
  assert.equal(r.httpStatus, 200);
  assert.equal(r.server, 'Apache');
  assert.equal(r.readyState, 'loading');
});

test('2b. response received but a read hangs → RESPONSE_NOT_LOADED with readError, never hangs the probe', async () => {
  const { launch } = fakeLaunch({ titleHangs: true });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.equal(r.verdict, 'RESPONSE_NOT_LOADED');
  assert.match(r.readError, /read timed out/);
});

test('3. Akamai-style 403 "Access Denied" → BLOCKED with server + block signal', async () => {
  const { launch } = fakeLaunch({ status: 403, server: 'AkamaiGHost', title: 'Access Denied', body: "You don't have permission to access this server. Reference #18.abc" });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.equal(r.verdict, 'BLOCKED');
  assert.equal(r.httpStatus, 403);
  assert.equal(r.server, 'AkamaiGHost');
  assert.match(r.blockSignal, /access denied/i);
});

test('3b. other 4xx/5xx without a block signal → HTTP_ERROR', async () => {
  const { launch } = fakeLaunch({ status: 503, server: 'nginx', title: 'Service Unavailable', body: 'down for maintenance' });
  const r = await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.equal(r.verdict, 'HTTP_ERROR');
});

test('4. HTTP 200, readable page, no block signal → ACCESSIBLE with all diagnostic fields', async () => {
  const { launch } = fakeLaunch();
  const r = await runAccessProbe(URL_UNDER_TEST, { launch, ...FAST });
  assert.equal(r.verdict, 'ACCESSIBLE');
  assert.equal(r.httpStatus, 200);
  assert.equal(r.server, 'Apache');
  assert.equal(r.title, 'Example Air — Book flights');
  assert.equal(r.finalUrl, URL_UNDER_TEST);
  assert.equal(r.blockSignal, null);
  assert.equal(r.userAgent, PROFILE.userAgent);
  assert.equal(r.webdriver, false);
  assert.equal(r.readyState, 'complete');
  assert.equal(r.navigationError, null);
  assert.equal(typeof r.commitMs, 'number');
});

test('the probe module imports nothing but browserLauncher (no OpenAI / Vision / Reasoning / R2 / pipeline)', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '11_Benchmark_Engine', 'modules', 'diagnostics', 'accessProbe.js'), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../browserLauncher.js']);
  assert.ok(!/openai|vision|reasoning|storage|orchestrator|pipeline/i.test(imports.join(' ')));
});
