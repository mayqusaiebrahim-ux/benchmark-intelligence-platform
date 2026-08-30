/**
 * Shared harness for the Feature Benchmark pipeline integration tests.
 * Each *.test.mjs in this folder runs in its own process
 * (--test-isolation=process) so mock.module() applies cleanly to the whole
 * provider graph. No network, no browser, no API keys.
 */
import { mock } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REGISTRY = pathToFileURL(join(HERE, '..', '..', '..', '12_Provider_Layer', 'registry', 'ProviderRegistry.js')).href;
export const REASONING_PROVIDER = pathToFileURL(join(HERE, '..', '..', '..', '10_Dashboard', 'lib', 'providers', 'FeatureReasoningProvider.js')).href;

// a real, valid 1x1 PNG so existsSync() and any real image parse would pass
export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const TARGET = {
  company: 'Qatar Airways',
  slug: 'qatar_airways',
  url: 'https://www.qatarairways.com/',
  feature: 'Homepage',
  scope: ['UX/UI only'],
};

export function makeWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'featbench-'));
  const shot = join(cwd, 'shot.png');
  writeFileSync(shot, PNG_1x1);
  return { cwd, shot };
}

/**
 * Install mock providers. Returns { rec, restore }. `rec` records every call
 * so tests can assert exactly what each stage received.
 */
export function installMocks({
  shot,
  discoverResolvedUrl,
  stepPageUrl,
  analyzedCompany = 'Qatar Airways',
  summary = '# Qatar Airways — Homepage\nThe Qatar Airways homepage shows a flight search widget and a Privilege Club promo.',
  reasoningStatus = 'completed',
} = {}) {
  const rec = { discover: [], runJourney: [], describe: [], reasoning: [] };

  const nav = {
    async discover(input) {
      rec.discover.push(input);
      return {
        schema_version: '0.2.0',
        company_slug: input.companySlug,
        company_name: input.companyName,
        requested_url: input.url,
        resolved_url: discoverResolvedUrl ?? input.url,
        website_type: 'airline',
        confidence: 'high',
        navigation: [],
        obstacles: [],
        // a realistic full-journey candidate list — the thing the old code
        // walked. The feature pipeline must ignore all of these.
        suggested_benchmark_journey: [
          { step_id: 'step_01_entry', applicable_guess: true, confidence: 'high' },
          { step_id: 'step_03_search', applicable_guess: true, confidence: 'high' },
          { step_id: 'step_07_booking', applicable_guess: true, confidence: 'high' },
          { step_id: 'step_09_payment', applicable_guess: true, confidence: 'high' },
          { step_id: 'step_11_checkin', applicable_guess: true, confidence: 'high' },
          { step_id: 'step_12_loyalty', applicable_guess: true, confidence: 'high' },
        ],
      };
    },
    async runJourney(input) {
      rec.runJourney.push(input);
      const steps = (input.journeyPlan.recommended_journey || []).map((s) => ({
        step_id: s.step_id || s.id,
        title: s.title,
        status: 'success',
        page_url: stepPageUrl ?? input.journeyPlan.starting_url,
        screenshot_path: shot,
        html_snapshot_path: null,
      }));
      return {
        run_id: 'nav_test',
        company_slug: input.companySlug,
        steps,
        summary: { total: steps.length, succeeded: steps.length, failed: 0, skipped: 0 },
      };
    },
  };

  const vision = {
    async describe(input) {
      rec.describe.push(input);
      return {
        success: true,
        findings: { page_type: 'airline homepage', navigation_detected: [], search_widgets_detected: [{ label: 'Book a flight' }], confidence: 'high' },
        jsonPath: join(shot, '..', 'vision.json'),
        timing: {},
      };
    },
  };

  const m1 = mock.module(REGISTRY, {
    exports: {
      getNavigationProvider: () => nav,
      getVisionProvider: () => vision,
      getReasoningProvider: () => { throw new Error('getReasoningProvider not used by feature pipeline'); },
      getScreenshotProvider: () => { throw new Error('not used'); },
      getReportProvider: () => { throw new Error('not used'); },
      getEmbeddingsProvider: () => { throw new Error('not used'); },
    },
  });

  const m2 = mock.module(REASONING_PROVIDER, {
    exports: {
      async runFeatureReasoning(args) {
        rec.reasoning.push(args);
        if (reasoningStatus !== 'completed') return { status: 'failed', error: 'mock reasoning failure' };
        return {
          status: 'completed',
          data: { analyzed_company: analyzedCompany, feature_found: true, evidence_source: 'OBSERVED', summary_markdown: summary },
        };
      },
    },
  });

  return { rec, restore: () => { m1.restore(); m2.restore(); } };
}

export async function runFeaturePipeline({ cwd, requestId = 'req_test', overrides = {} } = {}) {
  const mod = await import('../../pipelines/featurePipeline.js');
  const events = [];
  const out = await mod.run(
    {
      prompt: 'Benchmark Qatar Airways — focus: Homepage, scope: UX/UI only',
      cwd,
      jobId: `${requestId}:qatar_airways`,
      url: TARGET.url,
      feature: TARGET.feature,
      requestId,
      company: TARGET.company,
      slug: TARGET.slug,
      scope: TARGET.scope,
      ...overrides,
    },
    { onProgress: (e) => events.push(e) },
  );
  return { out, events };
}
