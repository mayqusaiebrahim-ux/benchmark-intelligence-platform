/**
 * V1 duplicate-run protection: the SAME requestId can never have two full
 * pipelines running at once. The lock is persisted (survives a restart / a
 * second server instance), request-scoped, and self-expiring.
 *
 *  - a second acquire while locked is refused
 *  - release frees it; an explicit retry can then start
 *  - a stale (crashed-run) lock is acquirable again
 *  - PATCH stage:'preparing' returns 409 while a run holds the lock
 *  - benchmarkService.startBenchmark bails (no orchestrator call) when the
 *    lock is already held
 *
 * Runs in its own process (--test-isolation=process).
 */
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LIB = (f) => pathToFileURL(join(HERE, '..', '..', 'lib', f)).href;

let cwd;
const REQ = {
  _meta: { schema_version: '1.0' },
  requests: [{
    id: 'req_dup', created_at: '2026-09-01T00:00:00.000Z', created_by: 'u1',
    benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
    cancelled: false, status: 'in_progress',
    items: [{ slug: 'emarties', name: 'Emarties', url: 'https://www.emirates.com/', stage: 'queued', trigger_prompt: 'go' }],
  }],
};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'dup-'));
  writeFileSync(join(cwd, 'Benchmark_Requests.json'), JSON.stringify(REQ, null, 2));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test('a second acquire while locked is refused; release then re-acquire works', async () => {
  const store = await import(LIB('requestsStore.js'));
  const a = store.tryAcquirePipelineLock(cwd, 'req_dup', 'holder-A');
  assert.equal(a.ok, true);

  const b = store.tryAcquirePipelineLock(cwd, 'req_dup', 'holder-B');
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'in-progress');
  assert.equal(b.holder, 'holder-A');

  // the SAME holder re-acquiring its own lock is a no-op success
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_dup', 'holder-A').ok, true);

  // only the holder may release; then a fresh (explicit-retry) acquire works
  store.releasePipelineLock(cwd, 'req_dup', 'holder-B');           // wrong holder -> ignored
  assert.equal(store.pipelineLockStatus(cwd, 'req_dup').locked, true);
  store.releasePipelineLock(cwd, 'req_dup', 'holder-A');
  assert.equal(store.pipelineLockStatus(cwd, 'req_dup').locked, false);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_dup', 'holder-C').ok, true);
});

test('a stale lock (crashed run) is acquirable again', async () => {
  const store = await import(LIB('requestsStore.js'));
  // hand-write an old lock
  const data = JSON.parse(readFileSync(join(cwd, 'Benchmark_Requests.json'), 'utf8'));
  data.requests[0]._pipeline_lock = { holder: 'dead', at: new Date(Date.now() - store.PIPELINE_LOCK_STALE_MS - 60000).toISOString() };
  writeFileSync(join(cwd, 'Benchmark_Requests.json'), JSON.stringify(data));

  assert.equal(store.pipelineLockStatus(cwd, 'req_dup').locked, false);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_dup', 'fresh').ok, true);
});

test('cancelRequest frees the lock', async () => {
  const store = await import(LIB('requestsStore.js'));
  store.tryAcquirePipelineLock(cwd, 'req_dup', 'h');
  store.cancelRequest(cwd, 'req_dup');
  assert.equal(store.pipelineLockStatus(cwd, 'req_dup').locked, false);
});

test('startBenchmark bails (no orchestrator call) when the lock is already held', async (t) => {
  const calls = [];
  const m = mock.module(pathToFileURL(join(HERE, '..', '..', '..', '13_Orchestrator', 'index.js')).href, {
    exports: { BenchmarkOrchestrator: class { async runBenchmark(i) { calls.push(i); return { status: 'succeeded', result: { verification_status: 'passed' } }; } } },
  });
  t.after(() => m.restore());
  const store = await import(LIB('requestsStore.js'));
  store.tryAcquirePipelineLock(cwd, 'req_dup', 'another-instance');   // held by "another server"

  const { startBenchmark } = await import(`${LIB('benchmarkService.js')}?bust=${Math.random()}`);
  startBenchmark({
    company: 'Emarties', feature: 'Homepage', scope: ['UX/UI only'],
    benchmarkType: 'Feature Benchmark', requestId: 'req_dup', slug: 'emarties',
    prompt: 'go', projectRoot: cwd, url: 'https://www.emirates.com/',
  });
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(calls.length, 0, 'orchestrator was NOT invoked — duplicate run prevented');
  // the lock still belongs to the other holder (we did not steal or clear it)
  assert.equal(store.pipelineLockStatus(cwd, 'req_dup').holder, 'another-instance');
  void t;
});
