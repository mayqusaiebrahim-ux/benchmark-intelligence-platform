/**
 * probeDocument — the post-readiness document check used by Discovery and the
 * Navigation Runner. Regression for the live "no document body was available"
 * failure whose real cause was hidden: any evaluate() error was reported as
 * "no body". A redirect / challenge reload destroys the execution context
 * (seen live on Qatar Airways' 301 → /en-sa/homepage.html), so that case is
 * probed once more, and every failure now states its actual reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { probeDocument, describeProbe } = await import('../../../11_Benchmark_Engine/modules/navigation_runner/pageReadiness.js');

function fakePage(results, url = 'https://www.example-air.com/') {
  let i = 0;
  return {
    url: () => url,
    async evaluate() {
      const r = results[Math.min(i++, results.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('body present → hasBody with readyState and url', async () => {
  const p = await probeDocument(fakePage([{ readyState: 'loading', hasBody: true, url: 'https://a.example/x' }]), { retryDelayMs: 0 });
  assert.equal(p.hasBody, true);
  assert.equal(p.readyState, 'loading');
  assert.equal(p.url, 'https://a.example/x');
});

test('page navigated again (context destroyed) → probed once more and succeeds', async () => {
  const p = await probeDocument(fakePage([
    new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'),
    { readyState: 'interactive', hasBody: true, url: 'https://a.example/en/home' },
  ]), { retryDelayMs: 0 });
  assert.equal(p.hasBody, true);
  assert.equal(p.url, 'https://a.example/en/home');
});

test('repeatedly navigating → fails, and the reason is reported instead of a bare "no body"', async () => {
  const destroyed = new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
  const p = await probeDocument(fakePage([destroyed, destroyed]), { retryDelayMs: 0 });
  assert.equal(p.hasBody, false);
  assert.match(describeProbe(p), /probe error: page\.evaluate: Execution context was destroyed/);
  assert.match(describeProbe(p), /url=https:\/\/www\.example-air\.com\//);
});

test('page/connection gone → fails immediately (no retry) with the real error', async () => {
  let calls = 0;
  const page = { url: () => 'about:blank', async evaluate() { calls++; throw new Error('Target page, context or browser has been closed'); } };
  const p = await probeDocument(page, { retryDelayMs: 0 });
  assert.equal(p.hasBody, false);
  assert.equal(calls, 1);
  assert.match(describeProbe(p), /has been closed/);
});

test('genuinely no body → fails with readyState in the detail', async () => {
  const p = await probeDocument(fakePage([{ readyState: 'loading', hasBody: false, url: 'https://a.example/' }]), { retryDelayMs: 0 });
  assert.equal(p.hasBody, false);
  assert.match(describeProbe(p), /readyState=loading/);
});
