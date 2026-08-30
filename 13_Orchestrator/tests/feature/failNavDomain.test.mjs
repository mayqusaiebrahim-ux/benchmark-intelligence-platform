import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

test('L: run FAILS (never Completed) if navigation lands on another company\'s domain', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { restore } = installMocks({ shot, stepPageUrl: 'https://www.turkishairlines.com/en-int/' });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(
    () => runFeaturePipeline({ cwd, requestId: 'req_nav_dom' }),
    (err) => /navigation_runner/i.test(err.message) && /not on the benchmark target's domain/i.test(err.message),
  );

  // and no report was written
  assert.ok(!existsSync(join(cwd, '02_Benchmark_Repository', '_Feature_Benchmarks', 'homepage', 'req_nav_dom.md')));
});
