/**
 * featurePipeline — Sprint Reset: the "feature" benchmark type. Connects six
 * existing capabilities end to end:
 *
 *   Discovery -> Journey Mapper -> Navigation Runner
 *     -> Screenshot Selection + Vision -> Reasoning -> Feature Report Writer
 *
 * Every stage wraps an existing, unmodified module (Discovery, Journey
 * Mapper, Navigation Runner, Vision) or an existing convention (the
 * _Feature_Benchmarks/ library storage contract from requestsStore.js). The
 * only genuinely new logic is the small feature-to-journey-step keyword map
 * in featureVisionStage.js and the concise FEATURE_REPORT_SCHEMA Reasoning
 * call — everything else is existing capability, newly connected.
 *
 * Unlike fullPipeline.js, there is no url-less branch: Discovery and
 * Navigation Runner both require a real URL to crawl, so `url` is a
 * required field here.
 */
import { BenchmarkRuntime } from '../runtime/Runtime.js';
import { Pipeline } from '../runtime/Pipeline.js';
import { featureDiscoveryStage } from '../stages/featureDiscoveryStage.js';
import { journeyMapperStage } from '../stages/journeyMapperStage.js';
import { navigationRunnerStage } from '../stages/navigationRunnerStage.js';
import { featureVisionStage } from '../stages/featureVisionStage.js';
import { featureReasoningStage } from '../stages/featureReasoningStage.js';
import { featureReportWriterStage } from '../stages/featureReportWriterStage.js';

export const requiredFields = ['prompt', 'cwd', 'url', 'feature'];

export async function run({ prompt, cwd, jobId, url, feature, requestId, company }, { onProgress = () => {} } = {}) {
  const stages = [
    featureDiscoveryStage,
    journeyMapperStage,
    navigationRunnerStage,
    featureVisionStage,
    featureReasoningStage,
    featureReportWriterStage,
  ];
  const pipeline = new Pipeline('feature', stages);
  const runtime = new BenchmarkRuntime();
  const { output } = await runtime.run(pipeline, { prompt, cwd, jobId, url, feature, requestId, company }, onProgress);
  return output; // { ...vision/reasoning fields, reasoningData, reportPath }
}
