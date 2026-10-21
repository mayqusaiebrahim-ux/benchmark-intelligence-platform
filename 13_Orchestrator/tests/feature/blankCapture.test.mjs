/**
 * A blank capture is not evidence. Live finding (req_1792498429566_ca7a7670,
 * Saudia Homepage on Render's free plan): the screenshot was uniformly white,
 * Vision said "blank viewport", and the run was still reported "Completed
 * successfully — output verified" with "Feature found: Yes".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

const { isBlankCapture } = await import('../../runtime/blankCapture.js');

// Exactly what Vision returned for the live blank Saudia capture.
const LIVE_BLANK = {
  page_type: 'blank viewport', ui_sections: [], navigation_detected: [], cards_detected: [], forms_detected: [],
  buttons_detected: [], banners_detected: [], search_widgets_detected: [], filters_detected: [], ai_features_detected: [],
  observations: ['The captured viewport is uniformly white.', 'No visible text, controls, images, borders, or other page elements appear.'],
  uncertainties: ['It is unclear whether the page is blank, still loading, or failed to render.'], confidence: 'high',
};

test('isBlankCapture: the live blank Saudia findings are blank', () => {
  assert.equal(isBlankCapture(LIVE_BLANK), true);
});

test('isBlankCapture: conservative — a real page, or a sparse page Vision does not call blank, is NOT blank', () => {
  assert.equal(isBlankCapture({ ...LIVE_BLANK, page_type: 'airline homepage', search_widgets_detected: [{ label: 'Book a flight' }] }), false);
  assert.equal(isBlankCapture({ ...LIVE_BLANK, page_type: 'blank viewport', buttons_detected: [{ label: 'Accept' }] }), false, 'any detected element means not blank');
  assert.equal(isBlankCapture({ ...LIVE_BLANK, page_type: 'minimal landing page' }), false, 'no elements alone is not enough');
  assert.equal(isBlankCapture(null), false);
});

test('pipeline: a blank capture fails at Vision with BLANK_PAGE_CAPTURED — no Reasoning spend, no "found" report', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({ shot, visionFindings: LIVE_BLANK });
  t.after(() => { restore(); rmSync(cwd, { recursive: true, force: true }); });

  await assert.rejects(runFeaturePipeline({ cwd, requestId: 'req_blank' }), /BLANK_PAGE_CAPTURED/);
  assert.equal(rec.describe.length, 1, 'Vision ran once on the capture');
  assert.equal(rec.reasoning.length, 0, 'Reasoning was not paid for');
});

test('the user-facing message for a blank capture is plain and actionable', async () => {
  const { actionableFailureMessage } = await import('../../../10_Dashboard/lib/benchmarkService.js');
  assert.match(actionableFailureMessage('Stage "feature_vision" failed: BLANK_PAGE_CAPTURED: the captured Saudia page was blank'), /blank page/);
});
