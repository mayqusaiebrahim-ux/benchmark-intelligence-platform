/**
 * Cost control (V1) — deterministic, the `openai` SDK is mocked, no network.
 *
 * Production finding: navigation ran gpt-5.6-luna but Feature Reasoning
 * silently defaulted to 'gpt-5', and the OpenAI SDK's default of 2 automatic
 * retries could turn one reasoning call into three billed requests.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The exact ESM entry `import OpenAI from 'openai'` resolves to from 11_Benchmark_Engine.
const OPENAI_ENTRY = pathToFileURL(join(ROOT, '11_Benchmark_Engine', 'node_modules', 'openai', 'index.mjs')).href;

process.env.OPENAI_API_KEY = 'sk-offline-test-invalid';

const sdk = { constructed: [], creates: [], nextError: null };
class FakeOpenAI {
  constructor(opts = {}) {
    sdk.constructed.push(opts);
    this.responses = {
      create: async (req) => {
        sdk.creates.push(req);
        if (sdk.nextError) { const e = sdk.nextError; sdk.nextError = null; throw e; }
        const out = {
          id: 'resp_test_1',
          output_text: JSON.stringify({
            analyzed_company: 'Example Air', feature_found: true, evidence_source: 'OBSERVED',
            summary_markdown: '## Example Air', evidence_limitations: 'Single viewport.',
          }),
        };
        Object.defineProperty(out, '_request_id', { value: 'req_test_1' });
        return out;
      },
    };
  }
}
mock.module(OPENAI_ENTRY, { defaultExport: FakeOpenAI });

const logs = [];
mock.module(pathToFileURL(join(ROOT, 'shared', 'logger.mjs')).href, {
  namedExports: {
    logInfo: (message, fields) => logs.push({ level: 'info', message, fields }),
    logError: (message, err, fields) => logs.push({ level: 'error', message, fields }),
  },
});

const { runOpenAIFeatureReasoning, resolveFeatureReasoningModel, DEFAULT_FEATURE_REASONING_MODEL } =
  await import('../../../11_Benchmark_Engine/modules/analysis/openaiFeatureReasoning.js');
const { resolveVisionModel, callVisionModel, DEFAULT_VISION_MODEL } =
  await import('../../../11_Benchmark_Engine/modules/analysis/visionModelClient.js');

const { FEATURE_REPORT_EVIDENCE_SOURCES } = await import('../../../12_Provider_Layer/capabilities/reasoning/featureReportSchema.js');

function reset(t, envOverrides = {}) {
  sdk.constructed.length = 0; sdk.creates.length = 0; sdk.nextError = null; logs.length = 0;
  const keys = ['OPENAI_FEATURE_REASONING_MODEL', 'OPENAI_REASONING_MODEL', 'OPENAI_VISION_MODEL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, envOverrides);
  t.after(() => { for (const k of keys) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } });
}

test('Feature Reasoning defaults to gpt-5.6-luna when OPENAI_FEATURE_REASONING_MODEL is absent', async (t) => {
  reset(t);
  assert.equal(DEFAULT_FEATURE_REASONING_MODEL, 'gpt-5.6-luna');
  assert.deepEqual(resolveFeatureReasoningModel(), { model: 'gpt-5.6-luna', modelSource: 'default' });
  const r = await runOpenAIFeatureReasoning({ augmentedPrompt: 'PROMPT-SECRET-CONTENT' });
  assert.equal(r.status, 'completed');
  assert.equal(sdk.creates[0].model, 'gpt-5.6-luna');
});

test('Feature Reasoning uses OPENAI_FEATURE_REASONING_MODEL when set', async (t) => {
  reset(t, { OPENAI_FEATURE_REASONING_MODEL: 'gpt-5.6-mini-test' });
  assert.deepEqual(resolveFeatureReasoningModel(), { model: 'gpt-5.6-mini-test', modelSource: 'env' });
  await runOpenAIFeatureReasoning({ augmentedPrompt: 'x' });
  assert.equal(sdk.creates[0].model, 'gpt-5.6-mini-test');
});

test('legacy OPENAI_REASONING_MODEL=gpt-5 is IGNORED — no silent fallback to an expensive model', async (t) => {
  reset(t, { OPENAI_REASONING_MODEL: 'gpt-5' });
  await runOpenAIFeatureReasoning({ augmentedPrompt: 'x' });
  assert.equal(sdk.creates[0].model, 'gpt-5.6-luna');
  assert.ok(logs.some((l) => /legacy OPENAI_REASONING_MODEL/.test(l.message) && l.fields.ignoredValue === 'gpt-5'));
});

test('exactly ONE reasoning request: SDK auto-retries disabled, no retry with another model on failure', async (t) => {
  reset(t);
  const err = Object.assign(new Error('429 insufficient_quota'), { status: 429, requestID: 'req_fail_1' });
  sdk.nextError = err;
  const r = await runOpenAIFeatureReasoning({ augmentedPrompt: 'x' });
  assert.equal(r.status, 'failed');
  assert.equal(sdk.constructed.length, 1);
  assert.equal(sdk.constructed[0].maxRetries, 0, 'the OpenAI SDK default of 2 retries must be disabled');
  assert.equal(sdk.creates.length, 1, 'no second request of any kind');
  const fail = logs.find((l) => l.message === 'OpenAI reasoning request threw');
  assert.equal(fail.fields.requestId, 'req_fail_1');
  assert.equal(fail.fields.model, 'gpt-5.6-luna');
});

test('reasoning logs stage, model, modelSource and request id — never the prompt or the API key', async (t) => {
  reset(t);
  await runOpenAIFeatureReasoning({ augmentedPrompt: 'PROMPT-SECRET-CONTENT' });
  const start = logs.find((l) => l.message === 'OpenAI reasoning request starting');
  const done = logs.find((l) => l.message === 'OpenAI reasoning request finished');
  assert.deepEqual({ stage: start.fields.stage, model: start.fields.model, modelSource: start.fields.modelSource },
    { stage: 'feature_reasoning', model: 'gpt-5.6-luna', modelSource: 'default' });
  assert.equal(done.fields.requestId, 'req_test_1');
  assert.equal(done.fields.responseId, 'resp_test_1');
  const all = JSON.stringify(logs);
  assert.ok(!all.includes('PROMPT-SECRET-CONTENT'), 'prompt content is never logged');
  assert.ok(!all.includes('sk-offline-test-invalid'), 'API key is never logged');
});

// ─── Vision ────────────────────────────────────────────────────────────────
const IMAGE_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=';
const visionPayload = () => ({
  system: 'VISION-SYSTEM-PROMPT',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'VISION-USER-PROMPT' },
      { type: 'image_url', image_url: { url: IMAGE_URL } },
    ],
  }],
});

test('Vision defaults to gpt-5.6-luna when OPENAI_VISION_MODEL is absent (no gpt-5 fallback)', async (t) => {
  reset(t);
  assert.equal(DEFAULT_VISION_MODEL, 'gpt-5.6-luna');
  assert.deepEqual(resolveVisionModel(), { model: 'gpt-5.6-luna', modelSource: 'default' });
  await callVisionModel(visionPayload(), { stage: 'feature_vision' });
  assert.equal(sdk.creates[0].model, 'gpt-5.6-luna');
});

test('OPENAI_VISION_MODEL overrides the Vision default', async (t) => {
  reset(t, { OPENAI_VISION_MODEL: 'gpt-5.6-vision-test' });
  assert.deepEqual(resolveVisionModel(), { model: 'gpt-5.6-vision-test', modelSource: 'env' });
  await callVisionModel(visionPayload(), { stage: 'feature_vision' });
  assert.equal(sdk.creates[0].model, 'gpt-5.6-vision-test');
});

test('Vision makes exactly ONE request: SDK auto-retries disabled, error propagates without a second call', async (t) => {
  reset(t);
  sdk.nextError = Object.assign(new Error('500 server_error'), { status: 500, requestID: 'req_vfail_1' });
  await assert.rejects(callVisionModel(visionPayload(), { stage: 'feature_vision' }), /500 server_error/);
  assert.equal(sdk.constructed.length, 1);
  assert.equal(sdk.constructed[0].maxRetries, 0, 'the OpenAI SDK default of 2 retries must be disabled');
  assert.equal(sdk.creates.length, 1, 'no retry, no other model');
  const fail = logs.find((l) => l.message === 'OpenAI vision request threw');
  assert.deepEqual({ stage: fail.fields.stage, model: fail.fields.model, requestId: fail.fields.requestId },
    { stage: 'feature_vision', model: 'gpt-5.6-luna', requestId: 'req_vfail_1' });
});

test('Vision image input format is unchanged (Responses input_text + input_image, system as instructions)', async (t) => {
  reset(t);
  await callVisionModel(visionPayload(), { stage: 'feature_vision' });
  const req = sdk.creates[0];
  assert.equal(req.instructions, 'VISION-SYSTEM-PROMPT');
  assert.deepEqual(req.input, [{
    role: 'user',
    content: [
      { type: 'input_text', text: 'VISION-USER-PROMPT' },
      { type: 'input_image', image_url: IMAGE_URL },
    ],
  }]);
});

test('Vision logs stage + model + modelSource + request id, and never the prompt, image or API key', async (t) => {
  reset(t);
  await callVisionModel(visionPayload(), { stage: 'feature_vision' });
  const start = logs.find((l) => l.message === 'OpenAI vision request starting');
  const done = logs.find((l) => l.message === 'OpenAI vision request finished');
  assert.deepEqual({ stage: start.fields.stage, model: start.fields.model, modelSource: start.fields.modelSource, maxRetries: start.fields.maxRetries },
    { stage: 'feature_vision', model: 'gpt-5.6-luna', modelSource: 'default', maxRetries: 0 });
  assert.deepEqual({ stage: done.fields.stage, model: done.fields.model, modelSource: done.fields.modelSource, requestId: done.fields.requestId, responseId: done.fields.responseId },
    { stage: 'feature_vision', model: 'gpt-5.6-luna', modelSource: 'default', requestId: 'req_test_1', responseId: 'resp_test_1' });
  const all = JSON.stringify(logs);
  for (const secret of ['VISION-SYSTEM-PROMPT', 'VISION-USER-PROMPT', IMAGE_URL, 'sk-offline-test-invalid']) {
    assert.ok(!all.includes(secret), `"${secret.slice(0, 24)}" must never be logged`);
  }
});

test('sanity: the mocked report shape matches the real schema contract', () => {
  assert.ok(FEATURE_REPORT_EVIDENCE_SOURCES.includes('OBSERVED'));
});
