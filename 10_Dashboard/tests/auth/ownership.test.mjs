/**
 * Team-beta auth + per-user ownership boundary.
 *
 *  A  unauthenticated protected request -> 401
 *  B  POST /api/requests takes created_by from the server identity, not the body
 *  C  User A sees User A's requests
 *  D  User B does NOT see User A's requests
 *  E  User B cannot cancel User A's request
 *  F  User B cannot change stage / retry User A's benchmark
 *  G  User B cannot fetch User A's evidence
 *  H  User B cannot fetch User A's generated report markdown
 *  I  legacy created_by=null requests never appear in a user's workspace
 *
 * Clerk is mocked at the lib/auth.js seam — no network, no credentials.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApp, listen, req, setRequests, startBenchmarkCalls } from './_serverHarness.mjs';

const PROJECT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const A = 'user_alice';
const B = 'user_bob';

const ALICE_REQ = {
  id: 'req_alice_1', created_at: '2026-08-30T10:00:00.000Z', created_by: A,
  benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
  items: [{ slug: 'qatar_airways', name: 'Qatar Airways', url: 'https://www.qatarairways.com/', stage: 'completed' }],
  cancelled: false,
};
const LEGACY_REQ = {
  id: 'req_legacy_1', created_at: '2026-01-01T00:00:00.000Z', created_by: null,
  benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
  items: [{ slug: 'mindtrip', name: 'Mindtrip', stage: 'completed' }],
  cancelled: false,
};

// on-disk fixtures so H/G exercise the real read path for the OWNER
const reportRel = `02_Benchmark_Repository/_Feature_Benchmarks/homepage/${ALICE_REQ.id}.md`;
const reportAbs = join(PROJECT, ...reportRel.split('/'));
const evDir = join(PROJECT, '03_Screenshots', '_evidence_cache', ALICE_REQ.id);

let base, close;

before(async () => {
  mkdirSync(dirname(reportAbs), { recursive: true });
  writeFileSync(reportAbs, `# Feature Benchmark — Homepage\n\n## Qatar Airways\nOwned report body.\n`);
  mkdirSync(evDir, { recursive: true });
  writeFileSync(join(evDir, '01_step_01_entry.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const app = await getApp();
  ({ base, close } = await listen(app));
});
after(async () => {
  await close();
  rmSync(reportAbs, { force: true });
  rmSync(evDir, { recursive: true, force: true });
});
beforeEach(() => { setRequests([ALICE_REQ, LEGACY_REQ]); startBenchmarkCalls.length = 0; });

test('A: unauthenticated protected requests are rejected with 401', async () => {
  for (const path of ['/api/requests', '/api/current-benchmarks', '/api/feature-benchmarks', '/api/me', `/api/evidence/${ALICE_REQ.id}`]) {
    const r = await req(base, path);
    assert.equal(r.status, 401, path);
  }
  // public config is the only thing reachable while signed out
  assert.equal((await req(base, '/api/config')).status, 200);
});

test('B: POST /api/requests derives created_by from the session, ignoring the body', async () => {
  const r = await req(base, '/api/requests', {
    method: 'POST', user: B,
    body: {
      benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
      competitors: [{ name: 'Emirates', url: 'https://www.emirates.com/' }],
      created_by: A, created_by_name: 'Alice Spoof', created_by_email: 'alice@evil.test',
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.created_by, B, 'owner is the authenticated user, not the payload');
  assert.equal(r.json.created_by_email, `${B}@example.com`);
});

test('C: a user sees their own requests', async () => {
  const r = await req(base, '/api/requests', { user: A });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.requests.map((x) => x.id), ['req_alice_1']);

  const cb = await req(base, '/api/current-benchmarks', { user: A });
  assert.deepEqual(cb.json.items.map((x) => x.request_id), ['req_alice_1']);

  const fb = await req(base, '/api/feature-benchmarks', { user: A });
  assert.deepEqual(fb.json.items.map((x) => x.request_id), ['req_alice_1']);
});

test('D: User B does not see User A requests anywhere', async () => {
  assert.deepEqual((await req(base, '/api/requests', { user: B })).json.requests, []);
  assert.deepEqual((await req(base, '/api/current-benchmarks', { user: B })).json.items, []);
  assert.deepEqual((await req(base, '/api/feature-benchmarks', { user: B })).json.items, []);
});

test('E: User B cannot cancel User A run (404, indistinguishable from missing)', async () => {
  const r = await req(base, `/api/requests/${ALICE_REQ.id}/cancel`, { method: 'POST', user: B });
  assert.equal(r.status, 404);
  const missing = await req(base, '/api/requests/req_does_not_exist/cancel', { method: 'POST', user: B });
  assert.equal(missing.status, 404);
  assert.deepEqual(r.json, missing.json, 'same body — no existence leak');
  // owner still can
  assert.equal((await req(base, `/api/requests/${ALICE_REQ.id}/cancel`, { method: 'POST', user: A })).status, 200);
});

test('F: User B cannot change stage / retry User A benchmark', async () => {
  const r = await req(base, `/api/requests/${ALICE_REQ.id}/items/qatar_airways`, {
    method: 'PATCH', user: B, body: { stage: 'preparing' },
  });
  assert.equal(r.status, 404);
  assert.equal(startBenchmarkCalls.length, 0, 'no benchmark work triggered for a non-owner');
});

test('G: User B cannot fetch User A evidence', async () => {
  assert.equal((await req(base, `/api/evidence/${ALICE_REQ.id}`, { user: B })).status, 404);
  assert.equal((await req(base, `/api/evidence/${ALICE_REQ.id}/01_step_01_entry.png`, { user: B })).status, 404);
  // owner can list + fetch
  const list = await req(base, `/api/evidence/${ALICE_REQ.id}`, { user: A });
  assert.equal(list.status, 200);
  assert.equal(list.json.screenshots.length, 1);
});

test('H: User B cannot fetch User A generated report markdown', async () => {
  const path = `/api/markdown?path=${encodeURIComponent(reportRel)}`;
  const bob = await req(base, path, { user: B });
  assert.equal(bob.status, 404);
  const alice = await req(base, path, { user: A });
  assert.equal(alice.status, 200);
  assert.match(alice.json.content, /Owned report body/);
});

test('I: legacy created_by=null requests never surface in a workspace', async () => {
  for (const u of [A, B]) {
    const ids = (await req(base, '/api/current-benchmarks', { user: u })).json.items.map((x) => x.request_id);
    assert.ok(!ids.includes('req_legacy_1'), `legacy hidden for ${u}`);
    const rids = (await req(base, '/api/requests', { user: u })).json.requests.map((x) => x.id);
    assert.ok(!rids.includes('req_legacy_1'), `legacy hidden for ${u}`);
  }
  // and it cannot be opened by direct id either
  assert.equal((await req(base, '/api/evidence/req_legacy_1', { user: A })).status, 404);
});
