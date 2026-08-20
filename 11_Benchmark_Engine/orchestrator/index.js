/**
 * Benchmark Engine — Orchestrator entry point.
 * Sprint 1 placeholder: no Playwright, no AI. Sprint 2 replaces the body of
 * startBenchmark with the real capture -> analysis -> report pipeline, reporting
 * progress back through 10_Dashboard/lib/requestsStore.js's STAGES.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runDiscovery } from '../modules/discovery/index.js';
import { captureScreenshot } from '../modules/vision/screenshotRunner.js';
import { buildHomepageReport, renderHomepageReportMarkdown, writeHomepageReport } from '../modules/reports/homepageReport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

export function startBenchmark({ company, feature, requestId }) {
  const time = new Date().toISOString();
  console.log('Benchmark Started');
  console.log(`  Company:    ${company}`);
  console.log(`  Feature:    ${feature}`);
  console.log(`  Request ID: ${requestId}`);
  console.log(`  Time:       ${time}`);
}

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function hostnameFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * runHomepageBenchmark — Sprint 4's first end-to-end pipeline: Discovery ->
 * one Vision screenshot -> Homepage Benchmark Report. Homepage only, no
 * scoring, no AI analysis. Accepts { url, companyName?, companySlug? }.
 */
export async function runHomepageBenchmark({ url, companyName = null, companySlug = null }) {
  const displayName = companyName || hostnameFromUrl(url);
  const slug = companySlug || slugify(displayName);

  console.log(`[orchestrator] Homepage benchmark started — company=${displayName} url=${url}`);

  const discovery = await runDiscovery({ url, companySlug: slug, companyName: displayName });
  const screenshot = await captureScreenshot({ company: displayName, url, requestId: `homepage_${slug}` });

  const report = await buildHomepageReport({ companyName: displayName, url, discovery, screenshot });
  const markdown = renderHomepageReportMarkdown(report);
  const written = writeHomepageReport({ report, markdown, projectRoot: PROJECT_ROOT, companySlug: slug });

  console.log(`[orchestrator] Homepage benchmark complete — report: ${written.mdPath}`);

  return { report, discovery, screenshot, ...written };
}
