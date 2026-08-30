/**
 * featureCompletion — the quality gate a Feature Benchmark must pass before
 * it may be reported as Completed. Run once, at the end of
 * featurePipeline.run(), over the pipeline's final output and the frozen
 * target.
 *
 * "The pipeline returned without throwing" is NOT enough. Every condition
 * below must hold, or the run is marked verification_failed with a
 * human-readable reason (benchmarkService already maps a
 * verification_status === 'failed' output onto that Dashboard state — the
 * same mechanism fullPipeline's outputVerificationStage uses).
 */
import { existsSync, readFileSync } from 'fs';
import { nameRefersToTarget, sameRegistrableDomain } from './benchmarkTarget.js';

/**
 * @param {object} args
 * @param {object} args.output  featurePipeline's threaded output object
 * @param {Readonly<object>} args.target
 * @returns {{ verification_status: 'passed'|'failed', verification_summary: string, verification_errors: string[], checks: object }}
 */
export function verifyFeatureCompletion({ output = {}, target }) {
  const errors = [];
  const checks = {};

  // A/C — target identity is intact (each stage echoed target.company/feature)
  checks.target_company_unchanged = output.targetCompany === target.company;
  if (!checks.target_company_unchanged) {
    errors.push(`target company changed: expected "${target.company}", pipeline carried "${output.targetCompany}"`);
  }
  checks.target_feature_unchanged = output.targetFeature === target.feature;
  if (!checks.target_feature_unchanged) {
    errors.push(`target feature changed: expected "${target.feature}", pipeline carried "${output.targetFeature}"`);
  }

  // B — the URL actually navigated is the target's official domain
  const navUrl = output.evidence?.url || output.url || null;
  checks.url_on_target_domain = !!navUrl && sameRegistrableDomain(target.url, navUrl);
  if (!checks.url_on_target_domain) {
    errors.push(`evidence URL "${navUrl}" is not on the target domain "${target.domain}"`);
  }

  // D/E/F — relevant, feature-scoped evidence exists (not an unrelated journey screenshot)
  const ev = output.evidence;
  checks.evidence_exists = !!(ev && ev.screenshotPath && existsSync(ev.screenshotPath));
  if (!checks.evidence_exists) {
    errors.push('no evidence screenshot file exists on disk');
  }
  checks.evidence_company_matches = !!ev && String(ev.company) === target.slug;
  if (!checks.evidence_company_matches) {
    errors.push(`evidence company "${ev?.company}" != target slug "${target.slug}"`);
  }
  checks.evidence_feature_matches = !!ev && String(ev.feature) === target.feature;
  if (!checks.evidence_feature_matches) {
    errors.push(`evidence feature "${ev?.feature}" != target feature "${target.feature}"`);
  }
  checks.evidence_relevant = !!ev && (ev.relevance === 'direct' || ev.relevance === 'base_page');
  if (!checks.evidence_relevant) {
    errors.push(`evidence relevance "${ev?.relevance}" is not an accepted value (direct | base_page)`);
  }

  // G — Vision actually analysed that evidence
  checks.vision_ran = !!output.visionFindings;
  if (!checks.vision_ran) errors.push('Vision produced no findings');

  // H/I — Reasoning corresponds to the target company + feature
  const rd = output.reasoningData;
  checks.reasoning_ran = !!(rd && typeof rd.feature_found === 'boolean' && rd.summary_markdown);
  if (!checks.reasoning_ran) errors.push('Reasoning produced no valid report data');

  if (rd) {
    const claimed = rd.analyzed_company || '';
    const claimCheck = nameRefersToTarget(target, `${claimed}\n${rd.summary_markdown || ''}`);
    checks.reasoning_company_matches = claimCheck.ok;
    if (!claimCheck.ok) {
      errors.push(`Reasoning output does not correspond to the target company: ${claimCheck.reason}`);
    }
  } else {
    checks.reasoning_company_matches = false;
  }

  // J/K — a report file was written, for THIS request, naming THIS target
  const reportPath = output.reportPath;
  checks.report_written = !!reportPath && existsSync(reportPath);
  if (!checks.report_written) {
    errors.push('report markdown file was not written');
  } else {
    const md = safeRead(reportPath);
    checks.report_has_target_marker = md.includes(`request=${target.requestId}`) &&
      md.toLowerCase().includes(`company=${target.company.toLowerCase()}`);
    if (!checks.report_has_target_marker) {
      errors.push(`report file "${reportPath}" is missing the machine-readable target marker for request ${target.requestId}`);
    }
    checks.report_names_target = nameRefersToTarget(target, md).ok;
    if (!checks.report_names_target) {
      errors.push(`report content does not clearly identify "${target.company}" as the analysed product`);
    }
  }

  const passed = errors.length === 0;
  return {
    verification_status: passed ? 'passed' : 'failed',
    verification_summary: passed
      ? `Feature Benchmark verified: ${target.company} / ${target.feature} — target unchanged, evidence relevant, report belongs to request ${target.requestId}.`
      : `Feature Benchmark cannot be marked complete — ${errors.length} check(s) failed: ${errors.join(' | ')}`,
    verification_errors: errors,
    checks,
  };
}

function safeRead(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
