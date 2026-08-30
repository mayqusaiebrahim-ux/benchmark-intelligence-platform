/**
 * F — screenshot missing locally → evidence can still be loaded from storage
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { useMemoryStorage, resetStorage, makeWorkspace, installProviderMocks, runFeaturePipeline } from './_helper.mjs';
import { resolveEvidenceLocalPath, keyForScreenshot, keyForNavArtifact } from '../../lib/storage/index.js';

test('F: evidence screenshot + vision json + nav manifest are persisted and lazily restorable', async (t) => {
  const storage = useMemoryStorage();
  const { cwd, shot, manifest } = makeWorkspace();
  const { restore } = installProviderMocks({ shot, manifest });
  t.after(() => { restore(); resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  const out = await runFeaturePipeline({ cwd, requestId: 'req_evi' });
  assert.equal(out.verification_status, 'passed', out.verification_summary);

  // all three evidence objects are in storage, keyed by requestId
  assert.deepEqual(Object.keys(out.evidenceKeys).sort(), ['manifest', 'screenshot', 'vision']);
  assert.equal(out.evidenceKeys.screenshot, keyForScreenshot('req_evi', 'shot.png'));
  assert.equal(out.evidenceKeys.vision, keyForScreenshot('req_evi', 'vision.json'));
  assert.equal(out.evidenceKeys.manifest, keyForNavArtifact('req_evi', 'run_manifest.json'));
  assert.ok(await storage.getBytes(out.evidenceKeys.screenshot));
  assert.ok(await storage.getBytes(out.evidenceKeys.vision));
  assert.ok(await storage.getBytes(out.evidenceKeys.manifest));

  // simulate the ephemeral disk losing the screenshot
  unlinkSync(shot);
  assert.ok(!existsSync(shot));

  // the evidence endpoint's resolver restores it on demand (never lists the bucket)
  const cacheDir = mkdtempSync(join(tmpdir(), 'evcache-'));
  const found = await resolveEvidenceLocalPath({ requestId: 'req_evi', filename: 'shot.png', cacheDir });
  assert.ok(found, 'screenshot restored from storage');
  assert.equal(found.source, 'r2');
  assert.ok(existsSync(found.path));
  rmSync(cacheDir, { recursive: true, force: true });
});
