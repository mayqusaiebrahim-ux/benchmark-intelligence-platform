/**
 * benchmarkTypes.config.js — the single file that maps a benchmark type
 * name to the pipeline that runs it. This is "determine which capabilities
 * are required" made concrete: adding a new benchmark type means adding
 * one entry here, not touching BenchmarkOrchestrator.js.
 */
import * as homepagePipeline from '../pipelines/homepagePipeline.js';
import * as fullPipeline from '../pipelines/fullPipeline.js';
import * as featurePipeline from '../pipelines/featurePipeline.js';

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
  feature: {
    label: 'Feature Benchmark (one concise report)',
    run: featurePipeline.run,
    requiredFields: featurePipeline.requiredFields,
  },

  // Future, NOT implemented this sprint:
  //
  // pattern_extraction: no module producing this exists anywhere in the
  //   codebase yet. Do not add an entry until one does.
};
