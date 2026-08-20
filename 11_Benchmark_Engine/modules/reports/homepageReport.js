/**
 * Reports — Homepage Benchmark Report.
 * The single source of truth for a homepage benchmark: merges Discovery's
 * structural findings with GPT Vision's qualitative UX analysis into one
 * report. Still no scoring of its own — Discovery observed, Vision described,
 * this module only combines and writes what those two already produced.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildVisionAnalysisPrompt } from '../analysis/promptBuilder.js';
import { callVisionModel } from '../analysis/visionModelClient.js';
import { parseVisionAnalysisResponse } from '../analysis/responseParser.js';

/**
 * runVisionAnalysis — internal helper. Never throws: a Vision failure (e.g. an
 * API quota error) must not prevent the Discovery-based half of the report
 * from being written, so failures are captured as ai_ux_analysis_error instead.
 */
async function runVisionAnalysis({ screenshot, discovery }) {
  if (!screenshot?.success || !screenshot?.path) {
    return { analysis: null, error: 'No screenshot available to analyze.' };
  }
  try {
    const payload = buildVisionAnalysisPrompt({ screenshotPath: screenshot.path, discoveryReport: discovery });
    const rawResponse = await callVisionModel(payload);
    const analysis = parseVisionAnalysisResponse(rawResponse);
    return { analysis, error: null };
  } catch (err) {
    return { analysis: null, error: err.message };
  }
}

export async function buildHomepageReport({ companyName, url, discovery, screenshot }) {
  const { analysis: aiUxAnalysis, error: aiUxAnalysisError } = await runVisionAnalysis({ screenshot, discovery });

  return {
    website_name: companyName,
    url,
    screenshot_path: screenshot?.path || null,
    website_type: discovery.website_type,
    main_navigation: discovery.navigation,
    main_ctas: discovery.visible_entry_points.filter(e => e.type === 'cta'),
    ai_features_detected: discovery.detected_ai_capabilities,
    search_capability: discovery.search_capability,
    obstacles_detected: discovery.obstacles,
    confidence: discovery.confidence,
    ai_ux_analysis: aiUxAnalysis,
    ai_ux_analysis_error: aiUxAnalysisError,
    benchmark_timestamp: new Date().toISOString(),
  };
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function renderHomepageReportMarkdown(report) {
  const list = (items, render) => (items.length ? items.map(render).join('\n') : '_None detected_');

  const nav = list(report.main_navigation.slice(0, 20), n => `- [${oneLine(n.label) || '(no label)'}](${n.href || '#'})`);
  const ctas = list(report.main_ctas.slice(0, 15), c => `- ${oneLine(c.label) || '(no label)'}`);
  const ai = list(report.ai_features_detected, f => `- **${f.type}** (${f.confidence}): ${f.label}`);
  const obstacles = list(report.obstacles_detected, o => `- **${o.type}**: ${o.description}`);

  const visionSection = report.ai_ux_analysis
    ? `## AI Vision UX Analysis

**First Impression:** ${report.ai_ux_analysis.first_impression}

**Visual Hierarchy:** ${report.ai_ux_analysis.visual_hierarchy}

**Main CTA Effectiveness:** ${report.ai_ux_analysis.main_cta_effectiveness}

**Navigation Clarity:** ${report.ai_ux_analysis.navigation_clarity}

**AI Feature Visibility:** ${report.ai_ux_analysis.ai_feature_visibility}

**Information Density:** ${report.ai_ux_analysis.information_density}

**Trust Signals:** ${report.ai_ux_analysis.trust_signals}

**Accessibility Observations:** ${report.ai_ux_analysis.accessibility_observations}

### Top 5 UX Strengths
${list(report.ai_ux_analysis.top_5_ux_strengths, s => `- ${s}`)}

### Top 5 UX Improvement Opportunities
${list(report.ai_ux_analysis.top_5_ux_improvement_opportunities, s => `- ${s}`)}
`
    : `## AI Vision UX Analysis
_Not available: ${report.ai_ux_analysis_error || 'unknown reason'}_
`;

  return `# Homepage Benchmark — ${report.website_name}

**URL:** ${report.url}
**Website type:** ${report.website_type}
**Confidence:** ${report.confidence}
**Benchmarked at:** ${report.benchmark_timestamp}
**Screenshot:** ${report.screenshot_path || '_capture failed_'}

> Homepage-only benchmark. Combines Discovery's structural observation with
> GPT Vision's qualitative UX read — no scoring, no cross-company comparison.

## Main Navigation
${nav}

## Main CTAs
${ctas}

## AI Features Detected (Discovery)
${ai}

## Search Capability
- Present: ${report.search_capability.present}
- Type: ${report.search_capability.type}

## Obstacles Detected
${obstacles}

${visionSection}`;
}

/**
 * writeHomepageReport — saves report.json + report.md under
 * 02_Benchmark_Repository/_Homepage_Benchmarks/{companySlug}/, mirroring the
 * existing _Feature_Benchmarks/{slug}/ convention already used for
 * lighter-weight-than-full-11-deliverable outputs (see
 * 10_Dashboard/lib/requestsStore.js's feature_benchmark_path).
 */
export function writeHomepageReport({ report, markdown, projectRoot, companySlug }) {
  const dir = join(projectRoot, '02_Benchmark_Repository', '_Homepage_Benchmarks', companySlug);
  mkdirSync(dir, { recursive: true });

  const jsonPath = join(dir, 'report.json');
  const mdPath = join(dir, 'report.md');

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(mdPath, markdown, 'utf8');

  return { dir, jsonPath, mdPath };
}
