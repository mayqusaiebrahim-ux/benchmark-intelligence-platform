/**
 * A run that only reached a bot-protection page must fail fast and must not
 * pay for Vision or Reasoning. Own process (mocks apply to the provider graph).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

test('pipeline: a run that only reached a block page fails fast — no Vision, no Reasoning spend', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({ shot, stepPageUrl: 'https://www.qatarairways.com/error/accessrestricted.html' });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(runFeaturePipeline({ cwd, requestId: 'req_blocked' }), /BOT_PROTECTION_BLOCKED/);
  assert.equal(rec.describe.length, 0, 'Vision was not paid for');
  assert.equal(rec.reasoning.length, 0, 'Reasoning was not paid for');
});
