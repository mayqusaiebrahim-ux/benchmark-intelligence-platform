import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

test('L: run FAILS if Discovery resolves to a different company\'s domain', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({ shot, discoverResolvedUrl: 'https://www.turkishairlines.com/' });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(
    () => runFeaturePipeline({ cwd, requestId: 'req_disc_dom' }),
    (err) => /feature_discovery/i.test(err.message) && /not on the benchmark target's domain/i.test(err.message),
  );

  // failed at Discovery — Navigation / Vision / Reasoning never ran
  assert.equal(rec.runJourney.length, 0);
  assert.equal(rec.describe.length, 0);
  assert.equal(rec.reasoning.length, 0);
  assert.ok(!existsSync(join(cwd, '02_Benchmark_Repository', '_Feature_Benchmarks', 'homepage', 'req_disc_dom.md')));
});
