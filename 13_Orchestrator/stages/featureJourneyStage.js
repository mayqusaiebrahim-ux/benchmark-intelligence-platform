/**
 * featureJourneyStage — REPLACES journeyMapperStage in the Feature Benchmark
 * pipeline. (journeyMapperStage.js is now unused — Complete Journey /
 * fullPipeline.js uses navigationStage.js, not journeyMapperStage — and is
 * kept only as reference. The underlying journey_mapper module is untouched.)
 *
 * Journey Mapper's buildJourneyPlan() is designed for the full 12-step
 * benchmark: it drops step_01_entry and keeps every keyword-matched step
 * (Payment, Check-in, Loyalty, ...). For a Feature Benchmark that is wrong —
 * it made "Homepage" navigate Payment/Check-in and Vision analyse the wrong
 * screenshot. A Feature Benchmark navigates for ONE feature only.
 *
 * This stage instead builds a feature-scoped JourneyPlan (exactly one step,
 * always on the target's own domain) via featureNavigation/featureIntent.js.
 * Same output shape Navigation Runner already consumes.
 *
 * Keeps the machine stage id 'journey_mapper' so the Dashboard's existing
 * progress labels are unaffected.
 */
import { Stage } from '../runtime/Stage.js';
import { resolveFeatureIntent, buildFeatureJourneyPlan } from '../featureNavigation/featureIntent.js';
import { assertObservedUrl, targetLogFields } from '../runtime/benchmarkTarget.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

export const featureJourneyStage = new Stage(
  'journey_mapper',
  'Feature Navigation Plan',
  async ({ target, previousOutput }) => {
    return withLogContext({ stage: 'journey_mapper' }, async () => {
      if (!target) throw new Error('featureJourneyStage requires a benchmark target.');
      const discoveryReport = previousOutput;
      if (!discoveryReport) {
        const err = new Error('Feature Navigation Plan requires a Discovery Report from the Discovery stage.');
        logError('Feature Navigation Plan missing input', err);
        throw err;
      }

      logInfo('Feature Navigation Plan starting', targetLogFields(target));

      // Re-assert before we decide where Navigation goes.
      assertObservedUrl(target, discoveryReport.resolved_url, 'Feature Navigation Plan');

      const intent = resolveFeatureIntent(target.feature);
      const plan = buildFeatureJourneyPlan({ discoveryReport, target, intent });

      // The plan's starting_url must be on the target domain — belt and braces.
      assertObservedUrl(target, plan.starting_url, 'Feature Navigation Plan (starting_url)');

      logInfo('Feature Navigation Plan finished', {
        ...targetLogFields(target),
        feature_navigation_step: intent.stepId,
        homepage_only: intent.homepageOnly,
        starting_url: plan.starting_url,
        step_count: plan.recommended_journey.length,
      });

      return plan;
    });
  },
);
