/**
 * H — STORAGE_PROVIDER=local: current local development behaviour is
 *     completely unchanged. No object store, no uploads, no restore.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetStorage, makeWorkspace, installProviderMocks, runFeaturePipeline } from './_helper.mjs';
import { getStorage, flushStatePersistence, restoreRuntimeStateOnStartup } from '../../lib/storage/index.js';
import { createRequest, setStage } from '../../lib/requestsStore.js';

// no useMemoryStorage() — falls through to the env-configured provider,
// which is 'local' by default in tests.
test('H: default (local) provider — pipeline writes only locally, no remote calls', async (t) => {
  resetStorage();
  const { cwd, shot, manifest } = makeWorkspace();
  const { restore } = installProviderMocks({ shot, manifest });
  t.after(() => { restore(); resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  assert.equal(getStorage().provider, 'local');
  assert.equal(getStorage().isRemote, false);

  const out = await runFeaturePipeline({ cwd, requestId: 'req_local' });
  assert.equal(out.verification_status, 'passed', out.verification_summary);
  assert.equal(out.reportKey, null, 'no R2 key in local mode');
  assert.deepEqual(out.evidenceKeys, {}, 'no evidence keys in local mode');

  // report exists on the local disk exactly as before
  assert.ok(existsSync(out.reportPath));
  assert.ok(readFileSync(out.reportPath, 'utf8').includes('Qatar Airways'));
});

test('H: local mode — writeRequests never attempts a remote persist; startup restore is a no-op', async (t) => {
  resetStorage();
  const { cwd } = makeWorkspace();
  t.after(() => { resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  const r = createRequest(cwd, {
    benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: [],
    competitors: [{ name: 'Qatar Airways' }],
  });
  setStage(cwd, r.id, 'qatar_airways', 'feature_vision');

  const health = await flushStatePersistence();
  assert.equal(health.attempted, false, 'no remote write was ever attempted');

  const summary = await restoreRuntimeStateOnStartup(cwd);
  assert.equal(summary.restored, false);
  assert.equal(summary.provider, 'local');

  // local file is authoritative and intact
  const data = JSON.parse(readFileSync(join(cwd, 'Benchmark_Requests.json'), 'utf8'));
  assert.equal(data.requests[0].id, r.id);
});
