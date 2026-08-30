/**
 * Regression checklist A–L for: Qatar Airways / Homepage / UX-UI only.
 * Run in its own process — see _pipelineHelper.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

test('A–L: Qatar Airways / Homepage benchmark is trustworthy end to end', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({ shot });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  const { out } = await runFeaturePipeline({ cwd, requestId: 'req_int_qatar' });

  // A / B — request identity: Qatar Airways, official qatarairways.com URL
  assert.equal(out.benchmark_target.benchmark_target_company, 'Qatar Airways');
  assert.equal(out.benchmark_target.benchmark_target_url, 'https://www.qatarairways.com/');
  assert.equal(out.benchmark_target.benchmark_target_feature, 'Homepage');

  // C / D — Feature Pipeline target reached Discovery unchanged; browser opened Qatar Airways
  assert.equal(rec.discover.length, 1);
  assert.equal(rec.discover[0].url, 'https://www.qatarairways.com/');
  assert.equal(rec.discover[0].companySlug, 'qatar_airways');
  assert.equal(rec.discover[0].companyName, 'Qatar Airways');

  // E / F — navigation is Homepage-focused: exactly one step, no generic journey
  assert.equal(rec.runJourney.length, 1);
  const plan = rec.runJourney[0].journeyPlan;
  assert.equal(plan.feature_scoped, true);
  assert.equal(plan.recommended_journey.length, 1);
  assert.equal(plan.recommended_journey[0].step_id, 'step_01_entry');
  const planIds = plan.recommended_journey.map((s) => s.step_id);
  for (const generic of ['step_03_search', 'step_07_booking', 'step_09_payment', 'step_11_checkin', 'step_12_loyalty', 'step_08_ancillaries', 'step_10_trip_management']) {
    assert.ok(!planIds.includes(generic), `plan must not walk ${generic}`);
  }
  assert.match(plan.starting_url, /qatarairways\.com/);

  // G — Vision analysed a Qatar Airways Homepage screenshot
  assert.equal(rec.describe.length, 1);
  assert.equal(rec.describe[0].screenshotPath, shot);
  assert.equal(rec.describe[0].companySlug, 'qatar_airways');
  assert.match(rec.describe[0].url, /qatarairways\.com/);
  assert.equal(out.evidence.evidenceType, 'homepage');
  assert.equal(out.evidence.relevance, 'direct');

  // H — Vision / Reasoning input contains no Mindtrip / Turkish target context
  const reasoningInput = JSON.stringify(rec.reasoning[0]).toLowerCase();
  assert.ok(!reasoningInput.includes('mindtrip'), 'no Mindtrip in reasoning input');
  assert.ok(!reasoningInput.includes('turkish'), 'no Turkish in reasoning input');

  // I — Reasoning target is Qatar Airways / Homepage
  assert.equal(rec.reasoning[0].company, 'Qatar Airways');
  assert.equal(rec.reasoning[0].feature, 'Homepage');
  assert.equal(out.targetCompany, 'Qatar Airways');
  assert.equal(out.targetFeature, 'Homepage');

  // J — saved report header/context is Qatar Airways / Homepage, for THIS request
  assert.ok(out.reportPath.endsWith(join('_Feature_Benchmarks', 'homepage', 'req_int_qatar.md')));
  const md = readFileSync(out.reportPath, 'utf8');
  assert.match(md, /^## Qatar Airways$/m);
  assert.ok(md.includes('request=req_int_qatar'));
  assert.ok(md.toLowerCase().includes('company=qatar airways'));
  assert.ok(md.includes('url=https://www.qatarairways.com/'));

  // K — no Mindtrip / Turkish contamination anywhere in the report
  assert.ok(!/mindtrip/i.test(md));
  assert.ok(!/turkish/i.test(md));

  // L — the run passed the completion quality gate
  assert.equal(out.verification_status, 'passed', out.verification_summary);
  assert.deepEqual(
    Object.entries(out.checks).filter(([, v]) => v !== true).map(([k]) => k),
    [],
    'every completion-gate check is true',
  );
});
