/**
 * C — feature report written → report object persisted
 * D — local report deleted → it can still be restored/read from storage
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useMemoryStorage, resetStorage, makeWorkspace, installProviderMocks, runFeaturePipeline } from './_helper.mjs';
import { keyForReportPath, keyForMarkdownRequestPath, getStorage } from '../../lib/storage/index.js';

test('C/D: report is persisted, and survives deletion of the local copy', async (t) => {
  const storage = useMemoryStorage();
  const { cwd, shot, manifest } = makeWorkspace();
  const { restore } = installProviderMocks({ shot, manifest });
  t.after(() => { restore(); resetStorage(); rmSync(cwd, { recursive: true, force: true }); });

  const out = await runFeaturePipeline({ cwd, requestId: 'req_report' });

  // C — the exact report is in object storage under a requestId-keyed path
  assert.equal(out.verification_status, 'passed', out.verification_summary);
  assert.equal(out.reportKey, 'feature-benchmarks/homepage/req_report.md');
  const stored = await storage.getBytes('feature-benchmarks/homepage/req_report.md');
  assert.ok(stored, 'report object persisted');
  const localMd = readFileSync(out.reportPath, 'utf8');
  assert.equal(stored.toString('utf8'), localMd, 'stored bytes === local bytes (exact report)');
  assert.ok(stored.toString().includes('request=req_report'));

  // D — simulate the ephemeral disk losing the report
  unlinkSync(out.reportPath);
  assert.ok(!existsSync(out.reportPath));

  // the storage layer can restore it (this is what GET /api/markdown does)
  const key = keyForMarkdownRequestPath('02_Benchmark_Repository/_Feature_Benchmarks/homepage/req_report.md');
  assert.equal(key, 'feature-benchmarks/homepage/req_report.md');
  const restored = await getStorage().restoreFile(key, out.reportPath);
  assert.equal(restored, true);
  assert.ok(existsSync(out.reportPath));
  assert.equal(readFileSync(out.reportPath, 'utf8'), localMd);
});
