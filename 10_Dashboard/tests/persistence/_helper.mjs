/**
 * Shared harness for the R2-persistence regression tests. Uses the
 * in-memory storage provider — no Cloudflare credentials, no network.
 * One process per test file (--test-isolation=process).
 */
import { mock } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MemoryStorage } from '../../lib/storage/MemoryStorage.js';
import { __setStorageForTests, __resetStorageForTests } from '../../lib/storage/index.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REGISTRY = pathToFileURL(join(HERE, '..', '..', '..', '12_Provider_Layer', 'registry', 'ProviderRegistry.js')).href;
export const REASONING_PROVIDER = pathToFileURL(join(HERE, '..', '..', 'lib', 'providers', 'FeatureReasoningProvider.js')).href;

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

export function useMemoryStorage(opts) {
  const storage = new MemoryStorage(opts);
  __setStorageForTests(storage);
  return storage;
}
export function resetStorage() { __resetStorageForTests(); }

export function makeWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'persist-'));
  mkdirSync(join(cwd, '02_Benchmark_Repository', '_Navigation_Runs'), { recursive: true });
  writeFileSync(join(cwd, 'Master_Benchmark_Matrix.json'), JSON.stringify({ benchmark_plan: [], _meta: {} }));
  const shot = join(cwd, 'shot.png');
  writeFileSync(shot, PNG_1x1);
  const manifest = join(cwd, 'run_manifest.json');
  writeFileSync(manifest, JSON.stringify({ run_id: 'nav_test', steps: [] }));
  return { cwd, shot, manifest };
}

export function installProviderMocks({ shot, manifest, analyzedCompany = 'Qatar Airways', summary = '# Qatar Airways — Homepage\nQatar Airways homepage with a booking widget.' } = {}) {
  const rec = { describe: [], reasoning: [] };
  const nav = {
    async discover(input) {
      return { resolved_url: input.url, suggested_benchmark_journey: [], obstacles: [] };
    },
    async runJourney(input) {
      const steps = input.journeyPlan.recommended_journey.map((s) => ({
        step_id: s.step_id || s.id, status: 'success',
        page_url: input.journeyPlan.starting_url, screenshot_path: shot,
      }));
      return { run_id: 'nav_test', company_slug: input.companySlug, steps, manifest_path: manifest, summary: { total: steps.length } };
    },
  };
  const vision = {
    async describe(input) {
      rec.describe.push(input);
      const visionJson = join(shot, '..', 'vision.json');
      writeFileSync(visionJson, JSON.stringify({ findings: { page_type: 'homepage' } }));
      return { success: true, findings: { page_type: 'homepage' }, jsonPath: visionJson, timing: {} };
    },
  };
  const m1 = mock.module(REGISTRY, {
    exports: {
      getNavigationProvider: () => nav, getVisionProvider: () => vision,
      getReasoningProvider: () => ({}), getScreenshotProvider: () => ({}),
      getReportProvider: () => ({}), getEmbeddingsProvider: () => ({}),
    },
  });
  const m2 = mock.module(REASONING_PROVIDER, {
    exports: {
      async runFeatureReasoning(args) {
        rec.reasoning.push(args);
        return { status: 'completed', data: { analyzed_company: analyzedCompany, feature_found: true, evidence_source: 'OBSERVED', summary_markdown: summary } };
      },
    },
  });
  return { rec, restore: () => { m1.restore(); m2.restore(); } };
}

export async function runFeaturePipeline({ cwd, requestId = 'req_persist' }) {
  const mod = await import('../../../13_Orchestrator/pipelines/featurePipeline.js');
  return mod.run(
    {
      prompt: 'Benchmark Qatar Airways — focus: Homepage, scope: UX/UI only',
      cwd, jobId: `${requestId}:qatar_airways`,
      url: TARGET.url, feature: TARGET.feature, requestId,
      company: TARGET.company, slug: TARGET.slug, scope: TARGET.scope,
    },
    { onProgress: () => {} },
  );
}
