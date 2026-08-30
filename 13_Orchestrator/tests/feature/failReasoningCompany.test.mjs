import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

test('K/L: run FAILS if the model identifies a different company as the analysed product', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({
    shot,
    analyzedCompany: 'Mindtrip',
    summary: "# Mindtrip — Homepage\nMindtrip's homepage leads with an AI chat entry point and suggested prompts.",
  });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(
    () => runFeaturePipeline({ cwd, requestId: 'req_contam' }),
    (err) => /feature_reasoning/i.test(err.message) && /does not correspond to the benchmark target/i.test(err.message),
  );

  // Reasoning ran, but the report was NEVER written
  assert.equal(rec.reasoning.length, 1);
  assert.ok(!existsSync(join(cwd, '02_Benchmark_Repository', '_Feature_Benchmarks', 'homepage', 'req_contam.md')));
});
