/**
 * benchmarkTypes.config.js — the single file that maps a benchmark type
 * name to the pipeline that runs it. This is "determine which capabilities
 * are required" made concrete: adding a new benchmark type means adding
 * one entry here, not touching BenchmarkOrchestrator.js.
 */
import * as homepagePipeline from '../pipelines/homepagePipeline.js';
import * as fullPipeline from '../pipelines/fullPipeline.js';

export const benchmarkTypes = {
  homepage: {
    label: 'Homepage Benchmark',
    run: homepagePipeline.run,
    requiredFields: homepagePipeline.requiredFields,
  },
  full: {
    label: 'Full Benchmark (11 deliverables)',
    run: fullPipeline.run,
    requiredFields: fullPipeline.requiredFields,
  },

  // Future, NOT implemented this sprint — named here so they aren't lost,
  // not stubbed with fake modules:
  //
  // journey: a multi-step, non-homepage-only Navigation flow. Would wrap
  //   modules/navigation_runner's runJourney — already exposed via
  //   NavigationProvider.runJourney() (12_Provider_Layer), but unwired
  //   anywhere today.
  //
  // pattern_extraction: no module producing this exists anywhere in the
  //   codebase yet. Do not add an entry until one does.
};
