/**
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

export const journeyMapperStage = new Stage(
  'journey_mapper',
  'Journey Mapper',
  async ({ previousOutput }) => {
    const discoveryReport = previousOutput;
    if (!discoveryReport) {
      throw new Error('Journey Mapper requires a Discovery Report from the Discovery stage.');
    }
    return planJourney({ discoveryReport });
  },
);
