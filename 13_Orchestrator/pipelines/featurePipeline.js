/**
 * featurePipeline — the "feature" benchmark type. One concise report for one
 * feature of one company, from that company's own official homepage.
 *
 *   Discovery -> Feature Journey (scoped) -> Navigation Runner
 *     -> Feature Vision -> Reasoning -> Feature Report Writer
 *     -> completion quality gate
 *
 * Correctness properties this pipeline now enforces (see the CRITICAL
 * CORRECTNESS FIX sprint):
 *
 *  1. Target identity is frozen once, here, and validated at every stage.
 *     company / slug / url / feature / requestId can never drift; a drift
 *     FAILS the run instead of producing an untrustworthy report.
 *  2. A missing / invalid official URL FAILS before any browser work.
 *  3. Navigation is feature-scoped — exactly one step (the requested
 *     feature's, or the homepage). The generic 12-step journey is never run.
 *     Journey Mapper is not used here.
 *  4. Vision only ever receives evidence whose company + feature + domain
 *     match the target. No unrelated-journey-screenshot fallback.
 *  5. Every model call is built only from the current target + current
 *     evidence. The report is validated to name the target company before
 *     it is written, and again by the completion gate.
 *  6. The run can only be marked Completed if verifyFeatureCompletion()
 *     passes — otherwise verification_status:'failed' -> verification_failed.
 */
import { BenchmarkRuntime } from '../runtime/Runtime.js';
import { Pipeline } from '../runtime/Pipeline.js';
import { featureDiscoveryStage } from '../stages/featureDiscoveryStage.js';
import { featureJourneyStage } from '../stages/featureJourneyStage.js';
import { navigationRunnerStage } from '../stages/navigationRunnerStage.js';
import { featureVisionStage } from '../stages/featureVisionStage.js';
import { featureReasoningStage } from '../stages/featureReasoningStage.js';
import { featureReportWriterStage } from '../stages/featureReportWriterStage.js';
import { createBenchmarkTarget, targetLogFields } from '../runtime/benchmarkTarget.js';
import { verifyFeatureCompletion } from '../runtime/featureCompletion.js';
import { withLogContext, logInfo, logError, logMemory } from '../../shared/logger.mjs';

// `slug` and `company` are now required — they are half of the immutable
// target. `url` is required (Discovery/Navigation need it) and is validated
// as a real http(s) URL before any browser work by createBenchmarkTarget().
export const requiredFields = ['prompt', 'cwd', 'url', 'feature', 'company', 'requestId', 'slug'];

export async function run(
  { prompt, cwd, jobId, url, feature, requestId, company, slug, scope },
  { onProgress = () => {} } = {},
) {
  return withLogContext({ requestId }, async () => {
    // ── Lock the target identity. Throws here (before the Runtime, before
    //    any browser) if the URL is missing/invalid or company/feature blank.
    const target = createBenchmarkTarget({ company, slug, url, feature, scope, requestId });
    logInfo('Feature Benchmark target locked', targetLogFields(target));

    const stages = [
      featureDiscoveryStage,
      featureJourneyStage,
      navigationRunnerStage,
      featureVisionStage,
      featureReasoningStage,
      featureReportWriterStage,
    ];
    const pipeline = new Pipeline('feature', stages);
    const runtime = new BenchmarkRuntime();

    const instrumentedOnProgress = (event) => {
      if (event.status === 'running') {
        logMemory(`Stage started: ${event.stage}`, { stage: event.stage });
      } else if (event.status === 'completed') {
        logMemory(`Stage finished: ${event.stage}`, { stage: event.stage });
      } else if (event.status === 'failed') {
        logError(`Stage failed: ${event.stage}`, { stage: event.stage, error: event.error });
      }
      onProgress(event);
    };

    const startedAt = Date.now();
    logInfo('Feature Benchmark pipeline started', { ...targetLogFields(target), jobId });

    let output;
    try {
      const res = await runtime.run(
        pipeline,
        { prompt, cwd, jobId, url: target.url, feature: target.feature, requestId, company: target.company, slug: target.slug, scope, target },
        instrumentedOnProgress,
      );
      output = res.output || {};
    } catch (err) {
      logError('Feature Benchmark pipeline threw', err);
      throw err; // rethrow unchanged — same error, same shape
    }

    // ── Completion quality gate. "Ran without throwing" is not "Completed".
    const verification = verifyFeatureCompletion({ output, target });
    if (verification.verification_status === 'failed') {
      logError('Feature Benchmark failed the completion gate', { errors: verification.verification_errors });
    } else {
      logInfo('Feature Benchmark passed the completion gate', { durationMs: Date.now() - startedAt });
    }

    return {
      ...output,
      ...verification, // verification_status / verification_summary / verification_errors / checks
      benchmark_target: targetLogFields(target),
    };
  });
}
