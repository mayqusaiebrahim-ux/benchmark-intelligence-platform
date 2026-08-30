/**
 * G — an object-storage write failure during final persistence means the
 *     benchmark cannot be treated as safely Completed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useMemoryStorage, resetStorage, makeWorkspace, installProviderMocks, runFeaturePipeline } from './_helper.mjs';
import { persistStateBytes, flushStatePersistence } from '../../lib/storage/index.js';

test('G1: if the report upload fails, the pipeline FAILS at the report stage (no Completed)', async (t) => {
  useMemoryStorage({ failWrites: true }); // every put throws
  const { cwd, shot, manifest } = makeWorkspace();
  const { restore } = installProviderMocks({ shot, manifest });
  t.after(() => { restore(); resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(
    () => runFeaturePipeline({ cwd, requestId: 'req_fail' }),
    (err) => /could NOT be saved to persistent storage/i.test(err.message),
  );
  // pipeline threw before completion — benchmarkService would mark it failed,
  // never 'completed'. (The evidence upload is the first to fail, so the
  // report file may or may not exist locally; either way it is not persisted.)
});

test('G2: a failed state write is reported by flushStatePersistence (drives the completion downgrade)', async (t) => {
  useMemoryStorage({ failWrites: true });
  t.after(() => resetStorage());

  persistStateBytes(Buffer.from('{"requests":[]}'));
  const health = await flushStatePersistence();
  assert.equal(health.attempted, true);
  assert.equal(health.ok, false);
  assert.match(health.error, /simulated object-storage write failure/i);
  // benchmarkService checks exactly this: attempted && !ok  ->  set
  // 'verification_failed' instead of 'completed'.
});

test('G3: once storage recovers, the next state write succeeds and health clears', async (t) => {
  const storage = useMemoryStorage({ failWrites: true });
  t.after(() => resetStorage());

  persistStateBytes(Buffer.from('{"requests":[]}'));
  assert.equal((await flushStatePersistence()).ok, false);

  storage.failWrites = false; // storage back
  persistStateBytes(Buffer.from('{"requests":[{"id":"req_ok"}]}'));
  const health = await flushStatePersistence();
  assert.equal(health.ok, true);
  assert.equal(health.error, null);
});
