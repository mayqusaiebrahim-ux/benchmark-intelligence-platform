/**
 * DEPRECATED / UNUSED as of the CRITICAL CORRECTNESS FIX sprint.
 *
 * This stage ran Journey Mapper's full breadth-first 12-step candidate plan
 * for the Feature Benchmark pipeline. That is exactly what made a "Homepage"
 * benchmark walk Payment / Check-in / Loyalty and analyse the wrong
 * screenshot. featurePipeline.js now uses featureJourneyStage.js, which
 * builds a feature-scoped one-step plan instead. Nothing imports this file
 * any more; it is kept only for reference and can be deleted safely. The
 * underlying journey_mapper module is untouched and still used elsewhere.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * journeyMapperStage — Sprint Reset: wraps the existing, unmodified Journey
 * Mapper module (11_Benchmark_Engine/modules/journey_mapper). Pure
 * computation, no browser — takes the Discovery Report the previous stage
 * produced and returns a JourneyPlan (contracts/journey_plan.schema.json)
 * for Navigation Runner to execute next. No Journey Mapper code is changed
 * here; it runs exactly as designed, producing its normal full breadth-first
 * candidate plan — feature-scoping happens later, in featureVisionStage,
 * by selecting which of Navigation Runner's resulting steps to use. This
 * keeps Journey Mapper's own step-dependency reasoning (depends_on_previous)
 * intact instead of risking it by pre-filtering its input.
 */
import { planJourney } from '../../11_Benchmark_Engine/modules/journey_mapper/index.js';
import { Stage } from '../runtime/Stage.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

export const journeyMapperStage = new Stage(
  'journey_mapper',
  'Journey Mapper',
  async ({ previousOutput }) => {
    return withLogContext({ stage: 'journey_mapper' }, async () => {
      const discoveryReport = previousOutput;
      if (!discoveryReport) {
        const err = new Error('Journey Mapper requires a Discovery Report from the Discovery stage.');
        logError('Journey Mapper missing input', err);
        throw err;
      }
      logInfo('Journey Mapper starting');
      try {
        const plan = planJourney({ discoveryReport });
        logInfo('Journey Mapper finished', { stepCount: plan?.recommended_journey?.length ?? 0 });
        return plan;
      } catch (err) {
        logError('Journey Mapper threw', err);
        throw err; // rethrow unchanged
      }
    });
  },
);
