/**
 * A benchmark compares several companies, and the wizard starts them all at
 * once. The duplicate-run lock must therefore be PER COMPANY: Saudia,
 * Emirates and Qatar in one request all run; the same company twice does not.
 * (Before: one request-wide lock — only the first company ever ran, the rest
 * sat at "Starting benchmark" forever.)
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LIB = (f) => pathToFileURL(join(HERE, '..', '..', 'lib', f)).href;
const item = (slug, name, url) => ({ slug, name, url, stage: 'preparing', trigger_prompt: `Benchmark ${name}` });

let cwd;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'lock-'));
  writeFileSync(join(cwd, 'Benchmark_Requests.json'), JSON.stringify({
    _meta: { schema_version: '1.0' },
    requests: [{
      id: 'req_multi', created_at: '2026-10-15T00:00:00.000Z', created_by: 'u1',
      benchmark_type: 'Feature Benchmark', feature: 'Passenger Details', scope: ['UX/UI only'], cancelled: false, status: 'in_progress',
      items: [item('saudia', 'Saudia', 'https://www.saudia.com/'), item('emirates', 'Emirates', 'https://www.emirates.com/'), item('qatar_airways', 'Qatar Airways', 'https://www.qatarairways.com/')],
    }],
  }, null, 2));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test('store: different companies in one request each get their own lock; the same company is refused', async () => {
  const store = await import(LIB('requestsStore.js'));
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_multi', 'req_multi:saudia').ok, true);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_multi', 'req_multi:emirates').ok, true);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_multi', 'req_multi:qatar_airways').ok, true);
  assert.equal(store.pipelineLockStatus(cwd, 'req_multi', 'emirates').locked, true);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_multi', 'req_multi:emirates').reentrant, true, 'same holder is re-entrant');
  store.releasePipelineLock(cwd, 'req_multi', 'req_multi:emirates');
  assert.equal(store.pipelineLockStatus(cwd, 'req_multi', 'emirates').locked, false);
  assert.equal(store.pipelineLockStatus(cwd, 'req_multi', 'saudia').locked, true, 'other companies keep their locks');
  assert.equal(store.pipelineLockStatus(cwd, 'req_multi').locked, true, 'request-level view sees any running company');
});

test('store: a request-wide lock (another server instance) still blocks every company', async () => {
  const store = await import(LIB('requestsStore.js'));
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_multi', 'another-instance').ok, true);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_multi', 'req_multi:saudia').ok, false);
});

test('startBenchmark: all three companies of one request reach the orchestrator, with their capture mode', async (t) => {
  const calls = [];
  const m = mock.module(pathToFileURL(join(HERE, '..', '..', '..', '13_Orchestrator', 'index.js')).href, {
    namedExports: { BenchmarkOrchestrator: class { async runBenchmark(i) { calls.push(i); await new Promise((r) => setTimeout(r, 50)); return { status: 'succeeded', result: { verification_status: 'passed' } }; } } },
  });
  t.after(() => m.restore());
  const { startBenchmark } = await import(`${LIB('benchmarkService.js')}?bust=${Math.random()}`);
  for (const [slug, name, url, captureMode] of [['saudia', 'Saudia', 'https://www.saudia.com/', 'auto'], ['emirates', 'Emirates', 'https://www.emirates.com/', 'assisted'], ['qatar_airways', 'Qatar Airways', 'https://www.qatarairways.com/', 'assisted']]) {
    startBenchmark({ company: name, feature: 'Passenger Details', scope: ['UX/UI only'], benchmarkType: 'Feature Benchmark', requestId: 'req_multi', slug, prompt: `Benchmark ${name}`, projectRoot: cwd, url, captureMode });
  }
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(calls.map((c) => c.slug).sort(), ['emirates', 'qatar_airways', 'saudia']);
  assert.equal(calls.find((c) => c.slug === 'emirates').captureMode, 'assisted');
  assert.equal(calls.find((c) => c.slug === 'saudia').captureMode, 'auto');
  const saved = JSON.parse(readFileSync(join(cwd, 'Benchmark_Requests.json'), 'utf8')).requests[0];
  assert.deepEqual(saved.items.map((i) => i.stage), ['completed', 'completed', 'completed']);
  assert.equal(saved._pipeline_locks, undefined, 'every lock released');
});

test('actionableFailureMessage: plain-language text for bot blocks and manual-capture outcomes', async (t) => {
  const m = mock.module(pathToFileURL(join(HERE, '..', '..', '..', '13_Orchestrator', 'index.js')).href, {
    namedExports: { BenchmarkOrchestrator: class {} },
  });
  t.after(() => m.restore());
  const { actionableFailureMessage } = await import(`${LIB('benchmarkService.js')}?bust=${Math.random()}`);
  assert.match(actionableFailureMessage('Stage "navigation_runner" failed: BOT_PROTECTION_BLOCKED: Emirates…'), /Capture manually/);
  assert.match(actionableFailureMessage('ASSISTED_CAPTURE_CLOSED: the capture window was closed'), /window was closed/);
  assert.match(actionableFailureMessage('ASSISTED_CAPTURE_UNAVAILABLE: Capture manually opens a browser window on your own computer'), /own computer/);
  assert.equal(actionableFailureMessage('some other error'), null);
});
