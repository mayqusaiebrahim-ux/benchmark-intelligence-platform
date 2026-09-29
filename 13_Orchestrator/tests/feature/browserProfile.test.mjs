/**
 * Generic browser-fingerprint profile — pure unit tests, no browser, no network.
 * Production finding: Render's default Playwright launch (headless shell)
 * exposed a "HeadlessChrome" user-agent and navigator.webdriver=true and was
 * served an Akamai-style "Access Denied" page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { LOCAL_LAUNCH_ARGS, buildLocalLaunchOptions, buildPageProfile } =
  await import('../../../11_Benchmark_Engine/modules/browserLauncher.js');

test('local launch: full Chromium (new headless) with AutomationControlled disabled, existing safe args kept', () => {
  const opts = buildLocalLaunchOptions();
  assert.equal(opts.channel, 'chromium', 'full installed Chromium, not chromium-headless-shell');
  assert.ok(opts.args.includes('--disable-blink-features=AutomationControlled'));
  for (const a of ['--disable-gpu', '--disable-dev-shm-usage', '--disable-breakpad']) {
    assert.ok(opts.args.includes(a), `existing safe arg ${a} kept`);
  }
  assert.deepEqual(LOCAL_LAUNCH_ARGS, opts.args);
  assert.equal('headless' in opts, false, 'headless stays Playwright\'s default (true)');
});

test('page profile: user-agent is regular Chrome with the ACTUAL version — never HeadlessChrome', () => {
  const p = buildPageProfile('149.0.7827.55', 'linux');
  assert.equal(p.userAgent, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36');
  assert.ok(!/HeadlessChrome/i.test(p.userAgent));
  // a version string carrying a HeadlessChrome prefix is normalized too
  assert.ok(!/HeadlessChrome/i.test(buildPageProfile('HeadlessChrome/149.0.7827.55', 'linux').userAgent));
  assert.match(buildPageProfile('149.0.7827.55', 'win32').userAgent, /\(Windows NT 10\.0; Win64; x64\).*Chrome\/149\.0\.7827\.55 /);
});

test('page profile: viewport 1440x900 and locale en-US', () => {
  const p = buildPageProfile('149.0.7827.55', 'linux');
  assert.deepEqual(p.viewport, { width: 1440, height: 900 });
  assert.equal(p.locale, 'en-US');
});
