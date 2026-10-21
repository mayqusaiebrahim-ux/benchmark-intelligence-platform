/**
 * navigationRunnerStage — wraps the existing, unmodified Navigation Runner
 * module via NavigationProvider.runJourney(). No Navigation Runner code is
 * changed. (Feature Benchmark pipeline only — Complete Journey uses
 * navigationStage.js.)
 *
 * Correctness additions (target integrity):
 *  - logs the five benchmark_target_* fields before navigation runs;
 *  - runs the feature-scoped JourneyPlan (one step) built by
 *    featureJourneyStage — never Journey Mapper's full journey;
 *  - FAILS the run if any executed step's page_url leaves the target's
 *    registrable domain;
 *  - downgrades a "successful" step whose captured page is really a
 *    bot-protection / access-restricted interstitial (Akamai "Access
 *    Denied", Emirates /error/accessrestricted.html, Cloudflare, …) to
 *    status:'blocked'. Before this, those pages were recorded as success
 *    and analysed as if they were the real site.
 */
import { getNavigationProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';
import { assertObservedUrl, targetLogFields } from '../runtime/benchmarkTarget.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';
import { existsSync, readFileSync } from 'fs';
import { detectBlockedPage } from '../runtime/pageBlockDetector.js';

/**
 * Re-checks every non-failed step's captured HTML for a bot-protection page
 * and marks it blocked in place. Exported for tests.
 */
export function markBlockedSteps(steps = []) {
  const blocked = [];
  for (const step of steps) {
    // A step that failed only because its screenshot didn't save still loaded
    // a page — check it, so a block page is reported as a block.
    if (!step || step.status === 'skipped' || (step.status === 'failed' && !step.capture_failed)) continue;
    let html = '';
    try {
      if (step.html_snapshot_path && existsSync(step.html_snapshot_path)) html = readFileSync(step.html_snapshot_path, 'utf8');
    } catch { /* unreadable snapshot — judge on URL only */ }
    const verdict = detectBlockedPage({ url: step.page_url || '', title: step.page_title || '', html });
    if (!verdict.blocked) continue;
    step.status = 'blocked';
    step.error = `Blocked by the website's bot protection: ${verdict.reason}`;
    step.goal = {
      ...(step.goal || {}),
      targetStatus: 'blocked_bot_protection',
      targetReached: false,
      blocker: verdict.reason,
    };
    blocked.push({ step_id: step.step_id, id: verdict.id, reason: verdict.reason });
  }
  return blocked;
}

export const navigationRunnerStage = new Stage(
  'navigation_runner',
  'Navigation Runner',
  async ({ target, previousOutput }) => {
    return withLogContext({ stage: 'navigation_runner' }, async () => {
      if (!target) throw new Error('navigationRunnerStage requires a benchmark target.');
      const journeyPlan = previousOutput;
      if (!journeyPlan) {
        const err = new Error('Navigation Runner requires a JourneyPlan from the Feature Navigation Plan stage.');
        logError('Navigation Runner missing input', err);
        throw err;
      }

      logInfo('Navigation Runner starting', {
        ...targetLogFields(target),
        plannedSteps: journeyPlan.recommended_journey?.length ?? 0,
        feature_scoped: !!journeyPlan.feature_scoped,
        starting_url: journeyPlan.starting_url,
      });

      let result;
      try {
        result = await getNavigationProvider().runJourney({
          journeyPlan,
          companyName: target.company,
          companySlug: target.slug,
        });
      } catch (err) {
        logError('Navigation Runner threw', err);
        throw err; // rethrow unchanged
      }

      if (!result.steps || result.steps.length === 0) {
        const err = new Error('Navigation Runner produced no steps — the feature-scoped plan may have been empty.');
        logError('Navigation Runner produced no steps', err);
        throw err;
      }

      // A loaded page is not a reached page: catch bot-protection interstitials.
      const blockedSteps = markBlockedSteps(result.steps);
      if (blockedSteps.length) {
        if (result.summary) {
          result.summary.blocked = blockedSteps.length;
          result.summary.succeeded = result.steps.filter((st) => st.status === 'success').length;
        }
        logError('Navigation Runner: captured page is a bot-protection block, not the real site', null, {
          ...targetLogFields(target),
          blockedSteps,
        });
      }

      // Nothing real was reached — every captured page is a block. Fail now
      // instead of paying for Vision + Reasoning on an "Access Denied" page.
      const anyReal = result.steps.some((st) => st.status === 'success');
      if (blockedSteps.length && !anyReal) {
        throw new Error(
          `BOT_PROTECTION_BLOCKED: ${target.company}'s website blocked the automated browser — ${blockedSteps[0].reason}. ` +
          'Use "Capture manually" to open the site yourself and capture the page.',
        );
      }

      // Target integrity: every page we actually landed on must be the target's.
      for (const step of result.steps) {
        assertObservedUrl(target, step.page_url, `Navigation Runner (step ${step.step_id})`);
      }

      logInfo('Navigation Runner finished', {
        ...targetLogFields(target),
        summary: result.summary,
        runId: result.run_id,
      });
      return result; // { run_id, company_slug, steps[], summary, manifest_path, ... }
    });
  },
);
