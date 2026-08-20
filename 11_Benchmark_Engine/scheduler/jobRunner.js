/**
 * jobRunner — runs ONE company's homepage benchmark inside a worker process.
 *
 * This does not reimplement any pipeline logic. It calls the exact same
 * Discovery, Vision (AI analysis), and Reports functions that
 * orchestrator/index.js's runHomepageBenchmark() already calls, with the
 * same arguments — none of those modules' internal logic is modified.
 * runHomepageBenchmark() itself is untouched and still exported from
 * orchestrator/index.js for any caller that just wants the one-shot
 * contract (e.g. the Dashboard's existing "Start Benchmark" button).
 *
 * The Smart Anti-Bot Layer (../modules/antibot) probes the URL first, and
 * that probe's own attempt IS the homepage capture (see
 * modules/antibot/probe.js) — final, whether it succeeded or not. As of
 * V1.2 Screenshot Reliability there is no fallback re-navigation: if the
 * probe's own screenshot failed, the failed screenshot object is passed
 * through as-is (Vision Analysis already degrades gracefully for it — see
 * below). At most 2 probe attempts + 1 Discovery pass ever touch the
 * homepage; nothing here ever navigates a third time for a screenshot.
 *
 * V1 Stabilization also adds two protected-page gates so a blocked page is
 * never sent to the (slow, paid) Vision Analysis step:
 *   1. Before Discovery — the Anti-Bot probe's own classification.
 *   2. After Discovery — Discovery runs its own separate navigation, so it
 *      can independently land on a protected page even when the probe
 *      didn't; Discovery's own obstacles_detected/confidence output (no
 *      extra navigation, already computed) is checked before Vision runs.
 * Either gate produces a `website_type: 'Protected Website'` report via the
 * existing, unmodified renderHomepageReportMarkdown/writeHomepageReport and
 * resolves normally — this is a successful, complete outcome for that
 * company, not a crash, so it is not retried.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runDiscovery } from '../modules/discovery/index.js';
import { buildHomepageReport, renderHomepageReportMarkdown, writeHomepageReport } from '../modules/reports/homepageReport.js';
import { probeUrl, writeProtectionReport } from '../modules/antibot/index.js';
import { BLOCK_STATUS_CODES, PERMANENT_STATUS_CODES } from '../modules/antibot/signatures.js';
import { STAGES } from './progressEvents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function hostnameFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** Builds and saves a "Status: Protected Website" report via the existing,
 * unmodified Reports functions — same file shape and location as a normal
 * homepage report, so the Dashboard needs no changes to display it. */
function writeProtectedWebsiteReport({ displayName, slug, url, screenshotPath, reasonLabel }) {
  const report = {
    website_name: displayName,
    url,
    screenshot_path: screenshotPath || null,
    website_type: 'Protected Website',
    main_navigation: [],
    main_ctas: [],
    ai_features_detected: [],
    search_capability: { present: false, type: 'unknown', evidence: [] },
    obstacles_detected: [{ type: 'blocked_or_error', description: reasonLabel, evidence: [] }],
    confidence: 'low',
    ai_ux_analysis: null,
    ai_ux_analysis_error: `Status: Protected Website — ${reasonLabel}. Benchmark stopped before analysis.`,
    benchmark_timestamp: new Date().toISOString(),
  };
  const markdown = renderHomepageReportMarkdown(report);
  const written = writeHomepageReport({ report, markdown, projectRoot: PROJECT_ROOT, companySlug: slug });
  return { report, ...written };
}

/** True when Discovery's own (separate) navigation independently landed on
 * a page that looks blocked/denied — checked using only data Discovery
 * already computed, no extra navigation. */
function discoveryLooksBlocked(discovery) {
  const statusMatch = /(\d{3})/.exec(
    (discovery.obstacles_detected || []).find((o) => o.type === 'blocked_or_error')?.description || '',
  );
  const status = statusMatch ? Number(statusMatch[1]) : null;
  return status != null && (BLOCK_STATUS_CODES.has(status) || PERMANENT_STATUS_CODES.has(status));
}

/**
 * runCompanyBenchmarkJob — accepts { url, companyName?, companySlug? } plus an
 * onProgress(stage) callback, returns the same shape runHomepageBenchmark()
 * returns: { report, discovery, screenshot, dir, jsonPath, mdPath }.
 *
 * Throws only on a genuine, unresolved failure (network-level errors that
 * were never classified as a protected page — see file header). The caller
 * (WorkerProcess) is responsible for catching it and reporting it back to
 * the Scheduler; this function does not know or care that it's running
 * inside a worker pool.
 */
export async function runCompanyBenchmarkJob({ url, companyName = null, companySlug = null }, onProgress = () => {}) {
  const displayName = companyName || hostnameFromUrl(url);
  const slug = companySlug || slugify(displayName);

  onProgress('antibot_probe');
  const probeResult = await probeUrl(url, {
    companySlug: slug,
    onAttempt: (attempt) => onProgress(`antibot_probe:${attempt.strategyId}:${attempt.type === 'clean' ? 'clean' : attempt.id}`),
  });

  if (!probeResult.ok) {
    writeProtectionReport({ companyName: displayName, companySlug: slug, url, probeResult });

    const lastAttempt = probeResult.attempts[probeResult.attempts.length - 1];
    if (lastAttempt.type === 'protection') {
      // One of the named categories: Access Denied / Cloudflare / Verify
      // human / Security Check / CAPTCHA (see modules/antibot/signatures.js).
      // This is a definitive, successful diagnosis, not a crash — stop here.
      onProgress('protected_website');
      const reasonLabel = `${probeResult.classification}${probeResult.vendor ? ` (${probeResult.vendor})` : ''}`;
      const written = writeProtectedWebsiteReport({ displayName, slug, url, screenshotPath: null, reasonLabel });
      onProgress(STAGES.DONE);
      return { report: written.report, discovery: null, screenshot: null, ...written };
    }

    // A genuine network-level failure (HTTP2 protocol error, connection
    // reset, timeout, DNS/SSL failure) — not one of the named protected-page
    // categories. Let the Scheduler's retry policy decide (it now honors
    // `.permanent` for the network errors signatures.js already flags as
    // unrecoverable, e.g. DNS/SSL failures).
    const err = new Error(
      `Blocked before Discovery: ${probeResult.classification}${probeResult.vendor ? ` (${probeResult.vendor})` : ''} — ${probeResult.attempts.length} strateg${probeResult.attempts.length === 1 ? 'y' : 'ies'} tried, none clean.`,
    );
    err.permanent = probeResult.permanent;
    err.protectionClassification = probeResult.classification;
    throw err;
  }
  onProgress(`antibot_probe:passed:${probeResult.strategyUsed}`);

  // V1.2 Screenshot Reliability: probeResult.screenshot is final — there is
  // no fallback re-navigation, ever, regardless of whether its capture
  // succeeded. A 'clean' classification is decided from a snapshot taken
  // BEFORE the screenshot call (see probe.js), so the probe's own
  // page.screenshot() can still fail on an already-verified-clean page
  // (observed in practice: an Imperva-protected page can silently re-verify
  // moments after classification, destroying the page context). The old
  // fallback used to re-navigate from scratch in that case — which is
  // exactly the "another navigation that could hit a different anti-bot
  // challenge" risk: a real run against Saudia had the probe classify the
  // page clean, its own screenshot fail, the fallback fire, and land on a
  // *different* Imperva challenge screen than the one the probe verified.
  // buildHomepageReport's Vision Analysis already degrades gracefully for a
  // failed/missing screenshot (ai_ux_analysis_error: 'No screenshot
  // available to analyze.' — see homepageReport.js, unmodified), so passing
  // a failed screenshot straight through is safe: the rare failure case now
  // reports honestly instead of risking a mismatched capture.
  onProgress(STAGES.DISCOVERY);
  onProgress(STAGES.SCREENSHOT);
  const discovery = await runDiscovery({ url, companySlug: slug, companyName: displayName });
  const screenshot = probeResult.screenshot;

  if (discoveryLooksBlocked(discovery)) {
    // Discovery ran its own, separate navigation and independently landed
    // on a blocked/denied page even though the probe's attempt didn't —
    // stop here rather than sending a protection page to Vision Analysis.
    onProgress('protected_website');
    const obstacle = discovery.obstacles_detected.find((o) => o.type === 'blocked_or_error');
    const written = writeProtectedWebsiteReport({
      displayName, slug, url,
      screenshotPath: screenshot?.success ? screenshot.path : null,
      reasonLabel: obstacle.description,
    });
    onProgress(STAGES.DONE);
    return { report: written.report, discovery, screenshot: screenshot || null, ...written };
  }

  onProgress(STAGES.ANALYSIS);
  // buildHomepageReport internally calls the real Vision Analysis model and
  // never throws for an AI failure — it degrades to ai_ux_analysis_error, so
  // a flaky OpenAI response never fails the whole job (see homepageReport.js).
  const report = await buildHomepageReport({ companyName: displayName, url, discovery, screenshot });

  onProgress(STAGES.REPORT);
  const markdown = renderHomepageReportMarkdown(report);
  const written = writeHomepageReport({ report, markdown, projectRoot: PROJECT_ROOT, companySlug: slug });

  onProgress(STAGES.DONE);
  return { report, discovery, screenshot, ...written };
}
