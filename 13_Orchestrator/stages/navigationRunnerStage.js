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
 *    registrable domain.
 */
import { getNavigationProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';
import { assertObservedUrl, targetLogFields } from '../runtime/benchmarkTarget.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

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
