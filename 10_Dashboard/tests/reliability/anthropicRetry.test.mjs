/**
 * V1 reliability: transient Anthropic failures retry INSIDE the reasoning
 * provider — they never re-run discovery / Browserbase / navigation /
 * screenshot / Vision / R2 persistence.
 *
 *  - overloaded_error / 503 / 429 retry then succeed
 *  - deterministic 400 / 401 do NOT retry
 *  - exhaustion fails cleanly (no fabricated report)
 *  - a pipeline run with a flaky reasoning call still runs nav + Vision once
 *
 * Runs in its own process (--test-isolation=process). `@anthropic-ai/sdk`
 * resolves here because this test lives under 10_Dashboard/.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
process.env.ANTHROPIC_RETRY_BACKOFF_MS = '1,1,1';   // instant retries in tests

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SDK = '@anthropic-ai/sdk';
const PROVIDER = pathToFileURL(join(HERE, '..', '..', 'lib', 'providers', 'FeatureReasoningProvider.js')).href;
const REGISTRY = pathToFileURL(join(HERE, '..', '..', '..', '12_Provider_Layer', 'registry', 'ProviderRegistry.js')).href;
const PIPELINE = pathToFileURL(join(HERE, '..', '..', '..', '13_Orchestrator', 'pipelines', 'featurePipeline.js')).href;

const apiErr = (over) => Object.assign(new Error(over.message || 'boom'), over);
const OVERLOADED = () => apiErr({ status: 529, error: { type: 'overloaded_error' }, message: 'Overloaded' });
const HTTP = (status) => apiErr({ status, message: `HTTP ${status}` });
const AUTH_401 = () => apiErr({ status: 401, error: { type: 'authentication_error' }, message: 'invalid x-api-key' });
const BAD_400 = () => apiErr({ status: 400, error: { type: 'invalid_request_error' }, message: 'schema too large' });

const GOOD_MESSAGE = {
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({
    analyzed_company: 'Qatar Airways', feature_found: true, evidence_source: 'OBSERVED',
    summary_markdown: '# Qatar Airways\nObserved a search widget.\n\n## Evidence limitations\nOne captured viewport, one state.',
    evidence_limitations: 'One captured viewport, one page state, no interactions.',
  }) }],
};

function fakeAnthropic(script) {
  const state = { calls: 0 };
  class FakeAnthropic {
    constructor() {
      this.messages = {
        stream: () => ({
          finalMessage: async () => {
            const step = script[state.calls++];
            if (step === 'ok' || step === undefined) return GOOD_MESSAGE;
            throw step();
          },
        }),
      };
    }
  }
  return { FakeAnthropic, state };
}

async function withProvider(script, fn) {
  const { FakeAnthropic, state } = fakeAnthropic(script);
  const m = mock.module(SDK, { exports: { default: FakeAnthropic, Anthropic: FakeAnthropic } });
  try {
    const mod = await import(`${PROVIDER}?bust=${Math.random()}`);
    return await fn(mod, state);
  } finally {
    m.restore();
  }
}

const REASON_ARGS = {
  prompt: 'x', company: 'Qatar Airways', feature: 'Homepage',
  target: { benchmark_target_url: 'https://www.qatarairways.com/' },
  previousOutput: { url: 'https://www.qatarairways.com/', visionFindings: {}, featureStepFound: true,
    selectedStep: { status: 'success' }, evidence: { evidenceType: 'homepage', relevance: 'direct' } },
};

test('isRetryableAnthropicError classifies transient vs deterministic', async () => {
  const { isRetryableAnthropicError: R } = await import(`${PROVIDER}?bust=cls`);
  for (const e of [OVERLOADED(), HTTP(429), HTTP(500), HTTP(502), HTTP(503), HTTP(504),
    apiErr({ code: 'ECONNRESET' }), apiErr({ name: 'APIConnectionTimeoutError' })]) {
    assert.equal(R(e), true, `${e.status || e.code || e.name} should retry`);
  }
  for (const e of [AUTH_401(), BAD_400(), HTTP(403), HTTP(404), HTTP(422)]) {
    assert.equal(R(e), false, `${e.status} should NOT retry`);
  }
});

test('overloaded_error: retries then succeeds', async () => {
  await withProvider([OVERLOADED, OVERLOADED, 'ok'], async (mod, state) => {
    const r = await mod.runFeatureReasoning(REASON_ARGS);
    assert.equal(r.status, 'completed');
    assert.equal(state.calls, 3, 'attempt 1 + 2 retries');
  });
});

test('503: retries then succeeds', async () => {
  await withProvider([() => HTTP(503), 'ok'], async (mod, state) => {
    assert.equal((await mod.runFeatureReasoning(REASON_ARGS)).status, 'completed');
    assert.equal(state.calls, 2);
  });
});

test('429: retries (bounded to 4 total attempts)', async () => {
  await withProvider([() => HTTP(429), () => HTTP(429), () => HTTP(429), 'ok'], async (mod, state) => {
    assert.equal((await mod.runFeatureReasoning(REASON_ARGS)).status, 'completed');
    assert.equal(state.calls, 4);
  });
});

test('deterministic 400: does NOT retry, fails cleanly', async () => {
  await withProvider([BAD_400, 'ok'], async (mod, state) => {
    const r = await mod.runFeatureReasoning(REASON_ARGS);
    assert.equal(r.status, 'failed');
    assert.equal(state.calls, 1);
    assert.match(r.error, /schema too large/);
  });
});

test('auth error: does NOT retry', async () => {
  await withProvider([AUTH_401, 'ok'], async (mod, state) => {
    assert.equal((await mod.runFeatureReasoning(REASON_ARGS)).status, 'failed');
    assert.equal(state.calls, 1);
  });
});

test('exhaustion: all 4 attempts fail -> honest failure, no fabricated report', async () => {
  await withProvider([OVERLOADED, OVERLOADED, OVERLOADED, OVERLOADED], async (mod, state) => {
    const r = await mod.runFeatureReasoning(REASON_ARGS);
    assert.equal(r.status, 'failed');
    assert.equal(r.data, undefined);
    assert.equal(state.calls, 4);
    assert.match(r.error, /Overloaded/i);
  });
});

test('a flaky reasoning call does NOT re-run navigation or Vision', async (t) => {
  const rec = { discover: 0, runJourney: 0, describe: 0 };
  const shotDir = mkdtempSync(join(tmpdir(), 'rel-'));
  const shot = join(shotDir, 'shot.png');
  writeFileSync(shot, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const cwd = mkdtempSync(join(tmpdir(), 'relcwd-'));
  writeFileSync(join(cwd, 'Master_Benchmark_Matrix.json'), JSON.stringify({ benchmark_plan: [], _meta: {} }));

  const nav = {
    async discover(input) { rec.discover++; return { resolved_url: input.url, suggested_benchmark_journey: [], obstacles: [] }; },
    async runJourney(input) {
      rec.runJourney++;
      return { run_id: 'r', company_slug: input.companySlug, manifest_path: null,
        steps: input.journeyPlan.recommended_journey.map((s) => ({ step_id: s.step_id || s.id, status: 'success', page_url: input.journeyPlan.starting_url, screenshot_path: shot })),
        summary: { total: 1 } };
    },
  };
  const vision = { async describe() { rec.describe++; const p = join(shotDir, 'vision.json'); writeFileSync(p, '{"findings":{}}'); return { success: true, findings: { page_type: 'homepage' }, jsonPath: p, timing: {} }; } };

  const { FakeAnthropic, state } = fakeAnthropic([OVERLOADED, 'ok']);
  const m1 = mock.module(REGISTRY, { exports: {
    getNavigationProvider: () => nav, getVisionProvider: () => vision,
    getReasoningProvider: () => ({}), getScreenshotProvider: () => ({}), getReportProvider: () => ({}), getEmbeddingsProvider: () => ({}),
  } });
  const m2 = mock.module(SDK, { exports: { default: FakeAnthropic, Anthropic: FakeAnthropic } });
  t.after(() => { m1.restore(); m2.restore(); rmSync(cwd, { recursive: true, force: true }); rmSync(shotDir, { recursive: true, force: true }); });

  const pipe = await import(`${PIPELINE}?bust=${Math.random()}`);
  const out = await pipe.run({
    prompt: 'Benchmark Qatar Airways — focus: Homepage', cwd, jobId: 'req_rel:qatar_airways',
    url: 'https://www.qatarairways.com/', feature: 'Homepage', requestId: 'req_rel',
    company: 'Qatar Airways', slug: 'qatar_airways', scope: ['UX/UI only'],
  }, { onProgress: () => {} });

  assert.equal(out.verification_status, 'passed', out.verification_summary);
  assert.equal(state.calls, 2, 'Anthropic retried once');
  assert.equal(rec.discover, 1, 'discovery ran exactly once');
  assert.equal(rec.runJourney, 1, 'navigation ran exactly once');
  assert.equal(rec.describe, 1, 'Vision ran exactly once');
});
