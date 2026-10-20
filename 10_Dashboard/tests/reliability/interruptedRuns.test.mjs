/**
 * Interrupted runs: a pipeline lives only in the process that started it.
 * Live finding (Render free plan): the server was killed while Chromium
 * loaded a heavy airline homepage, and four items stayed at
 * "navigation_runner" forever. At startup, mid-run items that are not running
 * in this process must be marked failed with a truthful reason; everything
 * else must be left exactly as it was.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LIB = (f) => pathToFileURL(join(HERE, '..', '..', 'lib', f)).href;
const T0 = '2026-10-20T06:44:00.000Z';
const item = (slug, stage, extra = {}) => ({ slug, name: slug, url: `https://${slug}.example/`, stage, updated_at: T0, ...extra });

let cwd;
const file = () => join(cwd, 'Benchmark_Requests.json');
const read = () => JSON.parse(readFileSync(file(), 'utf8'));
const findItem = (rid, slug) => read().requests.find((r) => r.id === rid).items.find((i) => i.slug === slug);

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'interrupt-'));
  const lockAt = new Date().toISOString(); // fresh — the dead process never released it
  writeFileSync(file(), JSON.stringify({
    _meta: { schema_version: '1.0' },
    requests: [
      {
        id: 'req_five', created_at: T0, created_by: 'u1', benchmark_type: 'Feature Benchmark', feature: 'Homepage',
        scope: ['Web'], cancelled: false, status: 'in_progress',
        _pipeline_locks: { etihad: { holder: 'req_five:etihad', at: lockAt }, saudia: { holder: 'req_five:saudia', at: lockAt } },
        items: [
          item('alaska', 'failed', { execution_status: 'failed', execution_message: 'blocked by bot protection' }),
          item('etihad', 'feature_discovery'),
          item('turkish', 'navigation_runner'),
          item('singapore', 'feature_vision'),
          item('saudia', 'preparing'),
        ],
      },
      {
        id: 'req_done', created_at: T0, created_by: 'u1', benchmark_type: 'Feature Benchmark', feature: 'Homepage',
        scope: ['Web'], cancelled: false, status: 'complete',
        items: [item('qatar', 'completed', { execution_status: 'success' })],
      },
      {
        id: 'req_cancelled', created_at: T0, created_by: 'u1', benchmark_type: 'Feature Benchmark', feature: 'Homepage',
        scope: ['Web'], cancelled: true, status: 'cancelled',
        items: [item('emirates', 'navigation_runner')],
      },
      {
        id: 'req_queued', created_at: T0, created_by: 'u1', benchmark_type: 'Feature Benchmark', feature: 'Homepage',
        scope: ['Web'], cancelled: false, status: 'queued',
        items: [item('klm', 'queued')],
      },
    ],
  }, null, 2));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test('startup: every mid-run item is marked failed with the truthful interruption reason and the stage it died in', async () => {
  const store = await import(LIB('requestsStore.js'));
  const marked = store.markInterruptedRuns(cwd);
  assert.deepEqual(marked.map((m) => m.slug).sort(), ['etihad', 'saudia', 'singapore', 'turkish']);
  for (const [slug, died] of [['etihad', 'feature_discovery'], ['turkish', 'navigation_runner'], ['singapore', 'feature_vision'], ['saudia', 'preparing']]) {
    const i = findItem('req_five', slug);
    assert.equal(i.stage, 'failed', slug);
    assert.equal(i.execution_status, 'failed');
    assert.equal(i.failed_stage, died);
    assert.equal(i.execution_message, store.INTERRUPTED_MESSAGE);
    assert.equal(i.user_facing_message, true);
    assert.ok(i.completed_at);
  }
  assert.equal(read().requests.find((r) => r.id === 'req_five').status, 'failed', 'the batch reaches a terminal state');
});

test('startup: completed, already-failed, cancelled and never-started items are untouched', async () => {
  const store = await import(LIB('requestsStore.js'));
  store.markInterruptedRuns(cwd);
  assert.equal(findItem('req_five', 'alaska').execution_message, 'blocked by bot protection');
  assert.equal(findItem('req_done', 'qatar').stage, 'completed');
  assert.equal(findItem('req_cancelled', 'emirates').stage, 'navigation_runner');
  assert.equal(findItem('req_queued', 'klm').stage, 'queued');
});

test('startup: an interrupted item\'s run lock is cleared so it can be retried immediately', async () => {
  const store = await import(LIB('requestsStore.js'));
  assert.equal(store.pipelineLockStatus(cwd, 'req_five', 'etihad').locked, true, 'precondition: stale-but-fresh lock left by the dead process');
  store.markInterruptedRuns(cwd);
  assert.equal(store.pipelineLockStatus(cwd, 'req_five', 'etihad').locked, false);
  assert.equal(store.tryAcquirePipelineLock(cwd, 'req_five', 'req_five:etihad').ok, true);
});

test('a run that IS active in this process is never marked interrupted', async () => {
  const store = await import(LIB('requestsStore.js'));
  const marked = store.markInterruptedRuns(cwd, { isActive: (rid, slug) => rid === 'req_five' && slug === 'turkish' });
  assert.equal(marked.some((m) => m.slug === 'turkish'), false);
  assert.equal(findItem('req_five', 'turkish').stage, 'navigation_runner');
});

test('idempotent: a second pass changes nothing and does not rewrite the file', async () => {
  const store = await import(LIB('requestsStore.js'));
  store.markInterruptedRuns(cwd);
  const before = readFileSync(file(), 'utf8');
  assert.deepEqual(store.markInterruptedRuns(cwd), []);
  assert.equal(readFileSync(file(), 'utf8'), before);
});
