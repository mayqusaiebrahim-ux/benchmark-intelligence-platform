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

    // Evidence-grounding: the report must not present known unsupported
    // categories as observed fact. Not a hallucination solver — a floor.
    // `hasReferrerMetadata` is false: the navigation runner captures a single
    // page state and no referrer/traffic-source signal, so ANY acquisition-
    // channel claim is unsupported by definition.
    const grounding = checkReportGrounding(md, { hasReferrerMetadata: false });
    checks.report_grounded = grounding.length === 0;
    for (const g of grounding) errors.push(g);

    // Limitations must be stated, not hidden.
    checks.report_states_limitations =
      /evidence limitation|capture (conditions|limitation)|single (captured )?viewport|one viewport|single page state|one page state|not visible in the captured|above[- ]the[- ]fold|no interactions?( (were|was))? performed/i.test(md) ||
      !!(rd && typeof rd.evidence_limitations === 'string' && rd.evidence_limitations.trim());
    if (!checks.report_states_limitations) {
      errors.push('report does not state its evidence limitations (single viewport / single state / no interactions)');
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

/**
 * Scan a generated report for claims that the captured evidence cannot
 * support. Deliberately narrow — targets the exact categories the spec calls
 * out (acquisition source, unseen interaction results, site-wide absence)
 * rather than trying to keyword-ban hallucination in general.
 *
 * Returns a list of human-readable violation strings (empty = clean).
 */
export function checkReportGrounding(md, { hasReferrerMetadata = false } = {}) {
  const out = [];
  const text = String(md || '');

  // 1 — acquisition channel / referrer stated without metadata to prove it.
  if (!hasReferrerMetadata) {
    const ACQUISITION = [
      /\b(?:branded\s+)?google\s+ad\b/i,
      /\bpaid[- ]search(?:\s+(?:landing|traffic|visit|arrival))?/i,
      /\b(?:arriv\w+|came|landed|coming|redirected|referred)\s+(?:here\s+)?from\s+(?:a\s+|an\s+|the\s+)?(?:branded\s+)?(?:google\s+)?(?:ad|paid\s+search|search\s+ad|campaign|marketing\s+email|newsletter)\b/i,
      /\b(?:the\s+)?(?:user|visitor|travel(?:l)?er|customer|guest)\s+(?:has\s+)?(?:just\s+)?(?:arriv\w+|clicked\s+through|come|came|landed)\b[^.]*\b(?:ad|campaign|search|referr\w+)\b/i,
      /\breferr(?:er|al)\s+(?:was|is|appears)\b/i,
    ];
    if (ACQUISITION.some((re) => re.test(text))) {
      out.push('report states how the user reached the page (acquisition channel / referrer) — no navigation metadata supports this');
    }
  }

  // 2 — result of an interaction that was never performed.
  const UNSEEN_INTERACTION = [
    /\b(?:after|once|when)\s+(?:you\s+|the\s+user\s+)?(?:click\w*|tap\w*|hover\w*|scroll\w*|submit\w*|open\w*)\b[^.]*\b(?:reveals?|shows?|displays?|expands?|leads?\s+to|takes?\s+you)\b/i,
    /\bhovering\s+(?:over|on)\b[^.]*\b(?:reveals?|shows?|displays?)\b/i,
    /\bthe\s+(?:menu|dropdown|drawer|modal)\s+(?:reveals?|contains?|expands?\s+to\s+show)\b/i,
  ];
  if (UNSEEN_INTERACTION.some((re) => re.test(text))) {
    out.push('report describes the outcome of an interaction (click/hover/scroll/submit) that was not performed');
  }

  // 3 — an absence / lack of a capability asserted as fact, without scoping
  //     it to the captured evidence. "X is not visible in the captured
  //     viewport" is fine; "the site does not offer X" is not.
  const ABSENCE = /\b(?:has|have)\s+no\b|\bdoes(?:\s+not|n['’]t)\s+(?:have|offer|provide|include|feature|support|display|show)\b|\bthere\s+(?:is|are)\s+no\b|\b(?:lacks|is\s+missing)\b|\bno\s+[a-z][a-z-]*\s+(?:is|are)\s+(?:present|available|offered|shown|provided)\b/i;
  const SCOPED = /\b(?:visible|shown|appears?|seen|present)\s+(?:in|within|on)\b|\bcaptured\b|\bin\s+the\s+(?:captured\s+)?(?:viewport|screenshot|evidence|frame|view)\b|\babove[- ]the[- ]fold\b|\bin\s+frame\b|\bin\s+this\s+(?:view|screenshot|capture)\b|\bon\s+screen\b|\bon-screen\b/i;
  // sentence-by-sentence so a scoping clause elsewhere can't mask it
  for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
    if (ABSENCE.test(sentence) && !SCOPED.test(sentence)) {
      out.push(`report makes an unscoped absence claim ("${sentence.trim().slice(0, 90)}…") — absence must be scoped to the captured evidence`);
      break;
    }
  }

  return out;
}
