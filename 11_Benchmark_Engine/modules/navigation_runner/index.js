/**
 * Navigation Runner — entry point.
 * Executes a JourneyPlan (from modules/journey_mapper) step by step, using a
 * single continuous Playwright session: opens pages, clicks elements, types
 * into inputs, waits for navigation, captures a screenshot + HTML snapshot +
 * metadata per step, and handles failures gracefully. Does not analyze,
 * score, write reports, or extract patterns — see README.md.
 */

import { chromium } from 'playwright';
import { executeStep } from './runner.js';
import { writeRunManifest } from './capture.js';
import { logInfo, logError } from '../../../shared/logger.mjs';

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function makeRunId() {
  return `nav_${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

/**
 * runJourney — accepts { journeyPlan, companyName?, companySlug? }. Returns
 * { run_id, company_slug, started_at, finished_at, steps[], summary,
 * manifest_path }. journeyPlan is Journey Mapper's output, consumed as-is.
 */
export async function runJourney({ journeyPlan, companyName = null, companySlug = null }) {
  if (!journeyPlan) {
    throw new Error('runJourney requires a journeyPlan (Journey Mapper output).');
  }

  const slug = companySlug || journeyPlan.company_slug || slugify(companyName || journeyPlan.starting_url);
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const steps = [];

  let browser;
  try {
    logInfo('Navigation Runner: launching Chromium', { executablePath: chromium.executablePath(), runId });
    browser = await chromium.launch();
    logInfo('Navigation Runner: browser created', { runId });
    browser.on('disconnected', () => logInfo('Navigation Runner: browser disconnected', { runId }));

    const page = await browser.newPage();
    logInfo('Navigation Runner: page created (default context)', { runId });
    page.on('close', () => logInfo('Navigation Runner: page closed', { runId }));

    logInfo('Navigation Runner: navigating to starting URL', { url: journeyPlan.starting_url, runId });
    await page.goto(journeyPlan.starting_url, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      // Some pages never go fully idle — proceed with whatever rendered.
    }

    let previousStepFailed = false;
    for (let i = 0; i < (journeyPlan.recommended_journey || []).length; i++) {
      const step = journeyPlan.recommended_journey[i];
      const result = await executeStep({
        page,
        step,
        index: i,
        journeyPlan,
        companySlug: slug,
        runId,
        previousStepFailed,
      });
      steps.push(result);
      previousStepFailed = result.status !== 'success';
    }
  } catch (err) {
    logError('Navigation Runner: runJourney threw', err, { runId });
    throw err; // rethrow unchanged — same error, same behavior
  } finally {
    if (browser) {
      logInfo('Navigation Runner: closing browser', { runId });
      await browser.close();
      logInfo('Navigation Runner: browser closed', { runId });
    }
  }

  const finishedAt = new Date().toISOString();
  const manifestPath = writeRunManifest({ companySlug: slug, runId, journeyPlan, steps, startedAt, finishedAt });

  return {
    run_id: runId,
    company_slug: slug,
    started_at: startedAt,
    finished_at: finishedAt,
    steps,
    summary: {
      total: steps.length,
      succeeded: steps.filter(s => s.status === 'success').length,
      failed: steps.filter(s => s.status === 'failed').length,
      skipped: steps.filter(s => s.status === 'skipped').length,
    },
    manifest_path: manifestPath,
  };
}
