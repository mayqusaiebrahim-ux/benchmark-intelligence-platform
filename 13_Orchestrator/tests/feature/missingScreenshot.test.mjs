/**
 * Vision never analyses a step that has no screenshot. Live finding
 * (req_1792589857523_449d1afe): capture timed out and saved nothing; the
 * step must reach Vision as failed-with-no-shot, and Vision must refuse it
 * without spending a Vision or Reasoning call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

test('pipeline: a step whose screenshot failed is refused at Vision — no Vision or Reasoning call', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({
    shot,
    stepOverrides: { status: 'failed', capture_failed: true, screenshot_path: null, error: 'Screenshot capture failed: page.screenshot: Timeout 30000ms exceeded.' },
  });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(runFeaturePipeline({ cwd, requestId: 'req_noshot' }), /No evidence relevant[\s\S]*step_01_entry:failed \(no shot\)/);
  assert.equal(rec.describe.length, 0, 'Vision was not called');
  assert.equal(rec.reasoning.length, 0, 'Reasoning was not called');
});
