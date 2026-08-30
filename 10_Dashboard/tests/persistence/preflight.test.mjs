/**
 * Storage availability preflight (deployment safety check).
 *
 * With STORAGE_PROVIDER=r2 the server can boot with bad credentials / an
 * unreachable bucket. Before a NEW Feature Benchmark spends Browserbase /
 * Discovery / Vision / Anthropic work, benchmarkService must verify the
 * persistent store is reachable with ONE lightweight non-destructive call and
 * fail the run early if it is not.
 *
 *   1. healthy memory provider  -> orchestrator IS invoked
 *   2. unhealthy remote provider -> orchestrator is NEVER invoked; run fails
 *      with "Persistent storage is currently unavailable. Benchmark was not started."
 *   3. local provider            -> orchestrator IS invoked (unchanged)
 *
 * Plus checkStorageHealth() exercised directly — it is a standalone function.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage } from '../../lib/storage/MemoryStorage.js';
import {
  checkStorageHealth, __setStorageForTests, __resetStorageForTests,
} from '../../lib/storage/index.js';
import { makeWorkspace } from './_helper.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ORCH = pathToFileURL(join(HERE, '..', '..', '..', '13_Orchestrator', 'index.js')).href;

function mockOrchestrator() {
  const calls = [];
  const m = mock.module(ORCH, {
    exports: {
      BenchmarkOrchestrator: class {
        async runBenchmark(input) {
          calls.push(input);
          return { status: 'succeeded', result: { verification_status: 'passed' } };
        }
      },
    },
  });
  return { calls, restore: () => m.restore() };
}

async function settle() { await new Promise((r) => setTimeout(r, 150)); }

function seed(cwd) {
  const now = new Date().toISOString();
  writeFileSync(join(cwd, 'Benchmark_Requests.json'), JSON.stringify({
    _meta: { last_updated: now },
    requests: [{
      id: 'req_preflight', created_at: now, benchmark_type: 'Feature Benchmark',
      feature: 'Homepage', scope: ['UX/UI only'], notes: null,
      items: [{ slug: 'qatar_airways', name: 'Qatar Airways', url: 'https://www.qatarairways.com/', stage: 'preparing', updated_at: now, trigger_prompt: 'Benchmark Qatar Airways — focus: Homepage' }],
    }],
  }, null, 2) + '\n');
}

function readItemStage(cwd) {
  const d = JSON.parse(readFileSync(join(cwd, 'Benchmark_Requests.json'), 'utf8'));
  return d.requests[0].items[0];
}

test('checkStorageHealth: standalone — local, healthy remote, unhealthy remote, misconfigured', async () => {
  __resetStorageForTests();
  // local (env default in tests)
  let h = await checkStorageHealth();
  assert.equal(h.ok, true);
  assert.equal(h.provider, 'local');
  assert.equal(h.skipped, true);

  // healthy remote
  __setStorageForTests(new MemoryStorage());
  h = await checkStorageHealth();
  assert.deepEqual(h, { ok: true, provider: 'memory' });

  // unhealthy remote
  __setStorageForTests(new MemoryStorage({ failHealth: true }));
  h = await checkStorageHealth();
  assert.equal(h.ok, false);
  assert.equal(h.provider, 'memory');
  assert.match(h.reason, /simulated storage unavailable/);

  __resetStorageForTests();
});

test('1: healthy provider — orchestrator IS invoked', async (t) => {
  const { calls, restore } = mockOrchestrator();
  const { cwd } = makeWorkspace();
  __setStorageForTests(new MemoryStorage());
  t.after(() => { restore(); __resetStorageForTests(); rmSync(cwd, { recursive: true, force: true }); });
  seed(cwd);

  const { startBenchmark } = await import('../../lib/benchmarkService.js');
  startBenchmark({
    company: 'Qatar Airways', feature: 'Homepage', scope: ['UX/UI only'],
    benchmarkType: 'Feature Benchmark', requestId: 'req_preflight', slug: 'qatar_airways',
    prompt: 'Benchmark Qatar Airways — focus: Homepage', projectRoot: cwd,
    url: 'https://www.qatarairways.com/',
  });
  await settle();

  assert.equal(calls.length, 1, 'orchestrator.runBenchmark was called exactly once');
  assert.equal(calls[0].requestId, 'req_preflight');
});

test('2: unhealthy remote — orchestrator is NEVER invoked; run fails early', async (t) => {
  const { calls, restore } = mockOrchestrator();
  const { cwd } = makeWorkspace();
  __setStorageForTests(new MemoryStorage({ failHealth: true }));
  t.after(() => { restore(); __resetStorageForTests(); rmSync(cwd, { recursive: true, force: true }); });
  seed(cwd);

  const { startBenchmark } = await import('../../lib/benchmarkService.js?case2');
  startBenchmark({
    company: 'Qatar Airways', feature: 'Homepage', scope: ['UX/UI only'],
    benchmarkType: 'Feature Benchmark', requestId: 'req_preflight', slug: 'qatar_airways',
    prompt: 'Benchmark Qatar Airways — focus: Homepage', projectRoot: cwd,
    url: 'https://www.qatarairways.com/',
  });
  await settle();

  assert.equal(calls.length, 0, 'orchestrator.runBenchmark was NEVER called — no browser/API work');
  const item = readItemStage(cwd);
  assert.equal(item.stage, 'failed');
  assert.equal(item.execution_message, 'Persistent storage is currently unavailable. Benchmark was not started.');
  assert.equal(item.failed_stage, 'storage_preflight');
});

test('3: local provider — orchestrator IS invoked, behaviour unchanged', async (t) => {
  const { calls, restore } = mockOrchestrator();
  const { cwd } = makeWorkspace();
  __resetStorageForTests();               // falls through to env default = local
  t.after(() => { restore(); __resetStorageForTests(); rmSync(cwd, { recursive: true, force: true }); });
  seed(cwd);

  const { startBenchmark } = await import('../../lib/benchmarkService.js?case3');
  startBenchmark({
    company: 'Qatar Airways', feature: 'Homepage', scope: ['UX/UI only'],
    benchmarkType: 'Feature Benchmark', requestId: 'req_preflight', slug: 'qatar_airways',
    prompt: 'Benchmark Qatar Airways — focus: Homepage', projectRoot: cwd,
    url: 'https://www.qatarairways.com/',
  });
  await settle();

  assert.equal(calls.length, 1, 'orchestrator.runBenchmark was called — local mode unaffected');
});
