/**
 * A — request created → state persisted
 * B — stage changes → updated state persisted
 * E — simulated restart with empty local state → requests restore
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, rmSync as rm } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useMemoryStorage, resetStorage } from './_helper.mjs';
import { STATE_KEY, flushStatePersistence, restoreRuntimeStateOnStartup } from '../../lib/storage/index.js';
import { createRequest, setStage, listRequests } from '../../lib/requestsStore.js';

function ws() {
  const cwd = mkdtempSync(join(tmpdir(), 'persist-state-'));
  writeFileSync(join(cwd, 'Master_Benchmark_Matrix.json'), JSON.stringify({ benchmark_plan: [], _meta: {} }));
  return cwd;
}

test('A: creating a request persists Benchmark_Requests.json to object storage', async (t) => {
  const storage = useMemoryStorage();
  const cwd = ws();
  t.after(() => { resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  const r = createRequest(cwd, {
    benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
    competitors: [{ name: 'Qatar Airways' }],
  });
  await flushStatePersistence();

  const persisted = await storage.getBytes(STATE_KEY);
  assert.ok(persisted, 'state object exists in storage');
  const parsed = JSON.parse(persisted.toString());
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0].id, r.id);
  assert.equal(parsed.requests[0].items[0].url, 'https://www.qatarairways.com/');
});

test('B: a stage change persists the updated state', async (t) => {
  const storage = useMemoryStorage();
  const cwd = ws();
  t.after(() => { resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  const r = createRequest(cwd, {
    benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
    competitors: [{ name: 'Qatar Airways' }],
  });
  setStage(cwd, r.id, 'qatar_airways', 'feature_vision');
  await flushStatePersistence();

  const parsed = JSON.parse((await storage.getBytes(STATE_KEY)).toString());
  assert.equal(parsed.requests[0].items[0].stage, 'feature_vision');

  setStage(cwd, r.id, 'qatar_airways', 'completed', { completed_at: new Date().toISOString(), execution_status: 'success' });
  await flushStatePersistence();
  const parsed2 = JSON.parse((await storage.getBytes(STATE_KEY)).toString());
  assert.equal(parsed2.requests[0].items[0].stage, 'completed');
});

test('E: restart with empty local state restores requests from object storage', async (t) => {
  const storage = useMemoryStorage();
  const cwd1 = ws();
  t.after(() => { resetStorage(); rmSync(cwd1, { recursive: true, force: true }); });

  // "session 1" — create + progress a benchmark
  const r = createRequest(cwd1, {
    benchmark_type: 'Feature Benchmark', feature: 'Booking Flow', scope: ['UX/UI only'],
    competitors: [{ name: 'Emirates' }],
  });
  setStage(cwd1, r.id, 'emirates', 'completed', { completed_at: new Date().toISOString(), execution_status: 'success' });
  await flushStatePersistence();

  // "session 2" — a fresh Render dyno: brand-new empty workspace, same storage
  const cwd2 = ws();
  assert.ok(!existsSync(join(cwd2, 'Benchmark_Requests.json')), 'session 2 starts with no local state');

  const summary = await restoreRuntimeStateOnStartup(cwd2);
  assert.equal(summary.state, 'restored_from_r2');

  const restored = listRequests(cwd2);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, r.id);
  assert.equal(restored[0].feature, 'Booking Flow');
  assert.equal(restored[0].items[0].stage, 'completed');
  // Home / Benchmarks / Activity all read listRequests()/listCurrentFeatureBenchmarks()
  // off this file — so their data is back.
  rmSync(cwd2, { recursive: true, force: true });
});

test('E2: a valid R2 copy is NOT overwritten by a stale repository copy', async (t) => {
  const storage = useMemoryStorage();
  const cwd = ws();
  t.after(() => { resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  // R2 already holds real runtime state (2 requests)
  const good = { _meta: { schema_version: '1.0', last_updated: '2026-08-30T00:00:00Z' }, requests: [
    { id: 'req_a', benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: [], items: [{ slug: 'x', name: 'X', stage: 'completed' }] },
    { id: 'req_b', benchmark_type: 'Feature Benchmark', feature: 'Search', scope: [], items: [{ slug: 'y', name: 'Y', stage: 'completed' }] },
  ] };
  await storage.putBytes(STATE_KEY, Buffer.from(JSON.stringify(good)));

  // the repo copy on this dyno is stale (only 1 request)
  writeFileSync(join(cwd, 'Benchmark_Requests.json'), JSON.stringify({ _meta: {}, requests: [{ id: 'req_old', benchmark_type: 'Feature Benchmark', feature: 'Old', scope: [], items: [] }] }));

  await restoreRuntimeStateOnStartup(cwd);
  const after = JSON.parse(readFileSync(join(cwd, 'Benchmark_Requests.json'), 'utf8'));
  assert.deepEqual(after.requests.map((r) => r.id), ['req_a', 'req_b'], 'R2 state won, stale local copy discarded');
});
