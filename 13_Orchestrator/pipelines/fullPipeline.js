/**
 * fullPipeline — the "full" (11-deliverable) benchmark type.
 *
 * Sprint 24: Output Verification now runs after Reasoning, always — in both
 * the url-present and url-less branches below, since it checks Reasoning's
 * OWN output (the actual CLAUDE.md deliverables the spawned `claude` CLI is
 * responsible for writing), which CLAUDE.md's workflow requires regardless
 * of whether Navigation/Screenshot/Vision ran to enrich Reasoning's prompt.
 * See stages/outputVerificationStage.js. This stage resolves normally even
 * when it finds the deliverables incomplete — "incomplete" is a finding it
 * reports (verification_status/verification_errors/verification_summary),
 * not a stage crash — so the pipeline's returned `output` now carries those
 * three fields alongside whatever Reasoning returned (spread forward, not
 * replaced — see outputVerificationStage.js).
 *
 * Sprint 21: Vision Analysis now runs between Screenshot and Reasoning,
 * analyzing the full-page screenshot Screenshot Stage already captured (no
 * re-capture). Joins Navigation/Screenshot in the same url-gated branch,
 * since it strictly depends on a screenshot having been produced — see
 * stages/visionStage.js. Reasoning now reads Navigation+Screenshot+Vision
 * context (forwarded stage-to-stage via previousOutput) instead of relying
 * only on the original prompt — see stages/reasoningStage.js.
 *
 * Sprint 20: Screenshot Capture runs between Navigation and Reasoning,
 * reusing the live page/browser Navigation produced.
 *
 * Sprint 19: Navigation runs before Reasoning — but only when the request
 * actually has a URL. requiredFields deliberately does NOT include 'url',
 * so url-less requests keep working exactly as before: reasoningStage
 * (then, as of Sprint 24, outputVerificationStage) only.
 *
 * Stage order gives the failure path for free: BenchmarkRuntime stops at
 * the first thrown stage, so a real navigation, screenshot, or vision
 * failure means Reasoning — the only stage that costs Claude API money —
 * never runs. A Reasoning failure means Output Verification never runs
 * either — nothing to verify if the agent itself never completed.
 */
import { BenchmarkRuntime } from '../runtime/Runtime.js';
import { Pipeline } from '../runtime/Pipeline.js';
import { navigationStage } from '../stages/navigationStage.js';
import { screenshotStage } from '../stages/screenshotStage.js';
import { visionStage } from '../stages/visionStage.js';
import { reasoningStage } from '../stages/reasoningStage.js';
import { outputVerificationStage } from '../stages/outputVerificationStage.js';

export const requiredFields = ['prompt', 'cwd'];

export async function run({ prompt, cwd, jobId, url }, { onProgress = () => {} } = {}) {
  const stages = url
    ? [navigationStage, screenshotStage, visionStage, reasoningStage, outputVerificationStage]
    : [reasoningStage, outputVerificationStage];
  const pipeline = new Pipeline('full', stages);
  const runtime = new BenchmarkRuntime();
  const { output } = await runtime.run(pipeline, { prompt, cwd, jobId, url }, onProgress);
  return output; // last stage's own output — outputVerificationStage's { ...reasoningStage's output, verification_status, verification_errors, verification_summary }
}
