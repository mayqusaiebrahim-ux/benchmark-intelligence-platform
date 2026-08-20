#!/usr/bin/env node
/**
 * Manual CLI entry point for the Sprint 4 homepage-only benchmark pipeline.
 * Usage: node run-homepage-benchmark.js <url> [companyName] [companySlug]
 */

import { runHomepageBenchmark } from './orchestrator/index.js';

const [, , url, companyName, companySlug] = process.argv;

if (!url) {
  console.error('Usage: node run-homepage-benchmark.js <url> [companyName] [companySlug]');
  process.exit(1);
}

const result = await runHomepageBenchmark({ url, companyName: companyName || null, companySlug: companySlug || null });

console.log(JSON.stringify({
  report_json: result.jsonPath,
  report_md: result.mdPath,
  screenshot: result.screenshot.path,
}, null, 2));
