/**
 * Duplicate-run protection at the HTTP boundary: PATCH stage:'preparing'
 * (start / retry) is rejected with 409 while a pipeline holds this request's
 * run lock, and no second benchmark is handed off. After the lock clears an
 * explicit retry is accepted again.
 *
 * Clerk + requestsStore are mocked at the lib seam (no network, no keys).
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, listen, req, setRequests, setPipelineLocked, startBenchmarkCalls } from './_serverHarness.mjs';

const A = 'user_alice';
const RUN = {
  id: 'req_run', created_at: '2026-09-01T00:00:00.000Z', created_by: A,
  benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
  items: [{ slug: 'emarties', name: 'Emarties', url: 'https://www.emirates.com/', stage: 'feature_reasoning' }],
  cancelled: false,
};

let base, close;
before(async () => { ({ base, close } = await listen(await getApp())); });
after(async () => { await close(); });
beforeEach(() => { setRequests([RUN]); startBenchmarkCalls.length = 0; setPipelineLocked(false); });

test('start is accepted when nothing holds the lock', async () => {
  const r = await req(base, `/api/requests/${RUN.id}/items/emarties`, { method: 'PATCH', user: A, body: { stage: 'preparing' } });
  assert.equal(r.status, 200);
  assert.equal(startBenchmarkCalls.filter((c) => c.requestId === RUN.id).length, 1);
});

test('start/retry is rejected with 409 while a run holds the lock — no duplicate hand-off', async () => {
  setPipelineLocked(true);
  const r = await req(base, `/api/requests/${RUN.id}/items/emarties`, { method: 'PATCH', user: A, body: { stage: 'preparing' } });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /already in progress/i);
  assert.equal(startBenchmarkCalls.filter((c) => c.requestId === RUN.id).length, 0, 'no expensive browser work handed off');

  // a non-"preparing" PATCH (e.g. cancel-driven stage change) is NOT blocked
  const other = await req(base, `/api/requests/${RUN.id}/items/emarties`, { method: 'PATCH', user: A, body: { stage: 'failed' } });
  assert.equal(other.status, 200);
});

test('after the lock clears, an explicit retry is accepted again', async () => {
  setPipelineLocked(true);
  assert.equal((await req(base, `/api/requests/${RUN.id}/items/emarties`, { method: 'PATCH', user: A, body: { stage: 'preparing' } })).status, 409);
  setPipelineLocked(false);
  const retry = await req(base, `/api/requests/${RUN.id}/items/emarties`, { method: 'PATCH', user: A, body: { stage: 'preparing' } });
  assert.equal(retry.status, 200);
  assert.equal(startBenchmarkCalls.filter((c) => c.requestId === RUN.id).length, 1);
});
