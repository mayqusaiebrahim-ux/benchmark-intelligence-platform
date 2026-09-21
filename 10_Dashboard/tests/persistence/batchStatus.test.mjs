/**
 * computeBatchStatus() terminal-failure bug — a request whose only/last item
 * reaches a permanent failure stage (failed / runtime_failed /
 * reasoning_failed / verification_failed) must itself reach status:"failed",
 * not stay status:"in_progress" forever (previously computeBatchStatus() had
 * no terminal-failure branch at all: "any item stage !== queued" ->
 * "in_progress" was the only non-queued/non-complete outcome, so a
 * permanently failed run was indistinguishable from a genuinely running one
 * at the request level — confirmed live against a real Anthropic-credit
 * failure during manual verification).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useMemoryStorage, resetStorage } from './_helper.mjs';
import { flushStatePersistence } from '../../lib/storage/index.js';
import { createRequest, setStage, listRequests, computeBatchStatus } from '../../lib/requestsStore.js';

function ws() {
  const cwd = mkdtempSync(join(tmpdir(), 'persist-batchstatus-'));
  writeFileSync(join(cwd, 'Master_Benchmark_Matrix.json'), JSON.stringify({ benchmark_plan: [], _meta: {} }));
  return cwd;
}

// ── pure unit coverage of computeBatchStatus() ──────────────────────────
test('computeBatchStatus: single item, every stage bucket', () => {
  assert.equal(computeBatchStatus({ items: [{ stage: 'queued' }] }), 'queued');
  assert.equal(computeBatchStatus({ items: [{ stage: 'feature_reasoning' }] }), 'in_progress');
  assert.equal(computeBatchStatus({ items: [{ stage: 'completed' }] }), 'complete');
  for (const failStage of ['failed', 'runtime_failed', 'reasoning_failed', 'verification_failed']) {
    assert.equal(computeBatchStatus({ items: [{ stage: failStage }] }), 'failed', `${failStage} -> failed`);
  }
});

test('computeBatchStatus: cancelled always wins, regardless of item stages', () => {
  assert.equal(computeBatchStatus({ cancelled: true, items: [{ stage: 'failed' }] }), 'cancelled');
  assert.equal(computeBatchStatus({ cancelled: true, items: [{ stage: 'completed' }] }), 'cancelled');
});

test('computeBatchStatus: mixed terminal items (one completed, one failed) -> failed', () => {
  assert.equal(computeBatchStatus({ items: [{ stage: 'completed' }, { stage: 'runtime_failed' }] }), 'failed');
});

test('computeBatchStatus: a failed item alongside a still-queued item is NOT terminal yet -> in_progress', () => {
  assert.equal(computeBatchStatus({ items: [{ stage: 'failed' }, { stage: 'queued' }] }), 'in_progress');
});

test('computeBatchStatus: all items completed -> complete (unchanged)', () => {
  assert.equal(computeBatchStatus({ items: [{ stage: 'completed' }, { stage: 'completed' }] }), 'complete');
});

// ── integration: the real setStage()/listRequests() path a dashboard read hits ──
test('a permanently failed single-competitor request reaches status:"failed" via setStage, not stuck at "in_progress"', async (t) => {
  const storage = useMemoryStorage();
  const cwd = ws();
  t.after(() => { resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  const r = createRequest(cwd, {
    benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
    competitors: [{ name: 'Qatar Airways' }],
  });
  setStage(cwd, r.id, 'qatar_airways', 'feature_reasoning');
  assert.equal(listRequests(cwd)[0].status, 'in_progress', 'genuinely running mid-pipeline');

  setStage(cwd, r.id, 'qatar_airways', 'reasoning_failed', {
    completed_at: new Date().toISOString(),
    execution_status: 'failed',
    execution_message: 'Benchmark runs are paused: the AI provider account is out of credit. Nothing is wrong with the website — add credit and run this again.',
    user_facing_message: true,
    failed_stage: 'feature_reasoning',
  });
  await flushStatePersistence();

  const after = listRequests(cwd)[0];
  assert.equal(after.status, 'failed', 'batch status reaches a terminal failed state, not stuck in_progress');
  assert.equal(after.items[0].stage, 'reasoning_failed');
});
