/**
 * Feature Reasoning prompt contract — deterministic, the OpenAI reasoning
 * call is mocked and only the built prompt is inspected. No model is called.
 *
 * Production finding (Qatar / Homepage, evidenceType=homepage, relevance=direct,
 * stepStatus=success): the prompt stated "directly: yes" but only ever told
 * the model when to set feature_found=false, while stressing the single-viewport
 * capture — so a verified, directly-evidenced target came back NOT FOUND.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let captured = null;
mock.module(pathToFileURL(join(ROOT, '11_Benchmark_Engine', 'modules', 'analysis', 'openaiFeatureReasoning.js')).href, {
  namedExports: {
    runOpenAIFeatureReasoning: async ({ augmentedPrompt }) => { captured = augmentedPrompt; return { status: 'completed', data: {} }; },
  },
});

process.env.REASONING_PROVIDER = 'openai';
const { runFeatureReasoning } = await import('../../../10_Dashboard/lib/providers/FeatureReasoningProvider.js');
const { FEATURE_REPORT_SCHEMA } = await import('../../../12_Provider_Layer/capabilities/reasoning/featureReportSchema.js');

const TARGET = { company: 'Qatar Airways', slug: 'qatar_airways', url: 'https://www.qatarairways.com/', benchmark_target_url: 'https://www.qatarairways.com/', feature: 'Homepage', requestId: 'r1' };
const VISION = { page_type: 'airline homepage', observations: ['Qatar Airways logo top-left'], uncertainties: ['Content below the fold not visible'], confidence: 'high' };

async function promptFor(feature, previousOutput) {
  captured = null;
  await runFeatureReasoning({ prompt: `Benchmark Qatar Airways — focus: ${feature}`, company: 'Qatar Airways', feature, target: { ...TARGET, feature }, previousOutput });
  assert.ok(captured, 'prompt was built and handed to the (mocked) provider');
  return captured;
}

const VERIFIED_LINE = 'Navigation reached and verified the requested';
const TRUE_RULE = 'Set feature_found to true and evidence_source to OBSERVED unless the screenshot shows a different company,';
const LIMITATION_RULE = 'it is NOT a reason to set feature_found to false.';

test('featureStepFound=true → prompt tells the model the verified surface IS the target and when to set feature_found=true', async () => {
  const p = await promptFor('Homepage', {
    url: 'https://www.qatarairways.com/', visionFindings: VISION, featureStepId: 'step_01_entry', featureStepFound: true,
    navBlocked: false, selectedStep: { step_id: 'step_01_entry', status: 'success' },
    evidence: { evidenceType: 'homepage', relevance: 'direct' }, interactionsPerformed: [],
  });
  const lines = p.split('\n');
  const yesAt = lines.indexOf('Evidence shows the requested feature directly: yes');
  assert.ok(yesAt >= 0);
  assert.equal(lines[yesAt + 1], 'Navigation reached and verified the requested "Homepage" surface, and the screenshot is of that surface.', 'added immediately after the "yes" line');
  assert.equal(lines[yesAt + 2], TRUE_RULE);
  assert.equal(lines[yesAt + 3], 'an error page, or a blocking overlay. The single-viewport capture is a limitation — record it in');
  assert.equal(lines[yesAt + 4], `evidence_limitations; ${LIMITATION_RULE}`);
});

test('featureStepFound=true for a non-homepage feature uses that feature name (generic, not Homepage-specific)', async () => {
  const p = await promptFor('Passenger Details', {
    url: 'https://www.qatarairways.com/book', visionFindings: VISION, featureStepId: 'step_07_booking', featureStepFound: true,
    navBlocked: false, selectedStep: { step_id: 'step_07_booking', status: 'success' },
    evidence: { evidenceType: 'feature_page', relevance: 'direct' }, interactionsPerformed: ['typed origin'],
  });
  assert.ok(p.includes('Navigation reached and verified the requested "Passenger Details" surface'));
});

test('featureStepFound=false → no "set feature_found to true" instruction; the "no" line and NOT FOUND guidance remain', async () => {
  const p = await promptFor('Passenger Details', {
    url: 'https://www.qatarairways.com/', visionFindings: VISION, featureStepId: 'step_07_booking', featureStepFound: false,
    navBlocked: true, navBlockReason: 'stopped at: unrecoverable_blocker', selectedStep: { step_id: 'step_07_booking', status: 'failed' },
    evidence: { evidenceType: 'blocked_state', relevance: 'base_page' }, interactionsPerformed: [],
  });
  assert.ok(p.includes('Evidence shows the requested feature directly: no — the evidence below is the homepage / base page for this same company'));
  assert.ok(!p.includes(VERIFIED_LINE), 'no verified-surface claim when the feature step was not found');
  assert.ok(!p.includes(TRUE_RULE));
  assert.ok(p.includes('You MUST: set feature_found to false, set evidence_source to "NOT FOUND"'), 'navigation-blocked rule unchanged');
});

test('the false outcomes remain available when featureStepFound=true (wrong company / error / overlay / not observed)', async () => {
  const p = await promptFor('Homepage', {
    url: 'https://www.qatarairways.com/', visionFindings: VISION, featureStepId: 'step_01_entry', featureStepFound: true,
    navBlocked: false, selectedStep: { step_id: 'step_01_entry', status: 'success' },
    evidence: { evidenceType: 'homepage', relevance: 'direct' }, interactionsPerformed: [],
  });
  assert.ok(p.includes('unless the screenshot shows a different company,\nan error page, or a blocking overlay'));
  assert.ok(p.includes('If the evidence below appears to be a different company than the one named above, state that clearly in summary_markdown, set feature_found to false'), 'wrong-company rule unchanged');
  assert.ok(p.includes('If the feature was not directly observed, say so honestly, set feature_found to false'), 'not-observed rule unchanged');
});

test('schema: feature_found description states a single viewport of the verified surface suffices and limits go to evidence_limitations', () => {
  const d = FEATURE_REPORT_SCHEMA.properties.feature_found.description;
  assert.match(d, /single captured viewport of the verified requested surface is sufficient/);
  assert.match(d, /capture limitations belong in evidence_limitations/);
  assert.match(d, /different company, an error page, or a blocking overlay/, 'false branch still described');
  assert.equal(FEATURE_REPORT_SCHEMA.properties.feature_found.type, 'boolean');
  assert.ok(FEATURE_REPORT_SCHEMA.required.includes('feature_found'));
});
