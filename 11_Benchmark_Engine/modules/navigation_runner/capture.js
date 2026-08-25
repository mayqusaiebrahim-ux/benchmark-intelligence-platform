/**
 * Navigation Runner — evidence capture.
 * The only file that persists anything to disk. Screenshots go to
 * 03_Screenshots/ (matches every other screenshot in this project); HTML
 * snapshots, per-step metadata, and the run manifest go to
 * 02_Benchmark_Repository/_Navigation_Runs/ (matches the existing
 * _Homepage_Benchmarks/ / _Feature_Benchmarks/ convention for pipeline output
 * that isn't yet part of the full 11-deliverable structure).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError } from '../../../shared/logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

function stepFolderName(index, stepId) {
  return `${String(index + 1).padStart(2, '0')}_${stepId}`;
}

/**
 * captureStepEvidence — takes a screenshot, grabs the current HTML, and
 * writes per-step metadata. Runs regardless of whether the step's action
 * succeeded — a failed step's "what we were looking at" is useful evidence
 * too. Never throws: a capture failure is recorded in the metadata rather
 * than aborting the run.
 */
export async function captureStepEvidence(page, { companySlug, runId, index, step, actionResult }) {
  const folderLabel = stepFolderName(index, step.id);

  const screenshotDir = join(PROJECT_ROOT, '03_Screenshots', companySlug, '_navigation_runs', runId);
  const dataDir = join(PROJECT_ROOT, '02_Benchmark_Repository', '_Navigation_Runs', companySlug, runId, folderLabel);
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const screenshotPath = join(screenshotDir, `${folderLabel}.png`);
  const htmlPath = join(dataDir, 'page.html');
  const metadataPath = join(dataDir, 'metadata.json');

  let screenshotSaved = false;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshotSaved = true;
    logInfo('Navigation Runner: screenshot written', { screenshotPath, stepId: step.id });
  } catch (err) {
    // Intentional swallow, unchanged — capture failure shouldn't crash the
    // run (reflected in metadata below). Logged, not rethrown: rethrowing
    // here would change this step's existing resilience behavior.
    logError('Navigation Runner: screenshot capture failed', err, { screenshotPath, stepId: step.id });
  }

  let html = '';
  try {
    html = await page.content();
  } catch {
    // Leave empty rather than fail the whole step over a snapshot issue.
  }
  writeFileSync(htmlPath, html, 'utf8');

  let pageUrl = null;
  try {
    pageUrl = page.url();
  } catch {
    // Page may already be closed/navigated away in a failure scenario.
  }

  const metadata = {
    step_id: step.id,
    step_title: step.title,
    step_index: index,
    page_url: pageUrl,
    action_taken: actionResult.action_taken,
    status: actionResult.success ? 'success' : 'failed',
    error: actionResult.error || null,
    screenshot_path: screenshotSaved ? screenshotPath : null,
    html_snapshot_path: htmlPath,
    captured_at: new Date().toISOString(),
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');

  return {
    page_url: pageUrl,
    screenshot_path: screenshotSaved ? screenshotPath : null,
    html_snapshot_path: htmlPath,
    metadata_path: metadataPath,
  };
}

/**
 * writeRunManifest — the single summary file for a whole navigation run,
 * written once at the end. Every field here is drawn from data the caller
 * already collected — this function only assembles and persists it.
 */
export function writeRunManifest({ companySlug, runId, journeyPlan, steps, startedAt, finishedAt }) {
  const dir = join(PROJECT_ROOT, '02_Benchmark_Repository', '_Navigation_Runs', companySlug, runId);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'run_manifest.json');

  const manifest = {
    schema_version: '0.1.0',
    run_id: runId,
    company_slug: companySlug,
    starting_url: journeyPlan.starting_url,
    primary_goal: journeyPlan.primary_goal,
    started_at: startedAt,
    finished_at: finishedAt,
    steps,
    summary: {
      total: steps.length,
      succeeded: steps.filter(s => s.status === 'success').length,
      failed: steps.filter(s => s.status === 'failed').length,
      skipped: steps.filter(s => s.status === 'skipped').length,
    },
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifestPath;
}
