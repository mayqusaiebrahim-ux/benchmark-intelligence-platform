/**
 * homepagePipeline — the "homepage" benchmark type's single step.
 *
 * Deliberately delegates to jobRunner.js's runCompanyBenchmarkJob() as one
 * composed unit, rather than re-decomposing it into separate
 * NavigationProvider/VisionProvider registry calls. That function's gate
 * logic (discoveryLooksBlocked / writeProtectedWebsiteReport, internal
 * and not exported) is hard-won production behavior — two independent
 * blocked-page checks, and a specific fix for an Imperva page that
 * re-verified itself after being classified clean — with no
 * registry-shaped seam today. Re-deriving it here would duplicate frozen
 * Engine logic that can silently drift from the original. See
 * 13_Orchestrator/README.md's "central tension" section for the full
 * reasoning; this is a deliberate, documented exception, not an oversight.
 *
 * runCompanyBenchmarkJob has no fork-specific coupling (only
 * WorkerProcess.js's own send() wrapper does), so calling it directly,
 * in-process, from here is safe.
 */
import { runCompanyBenchmarkJob } from '../../11_Benchmark_Engine/scheduler/jobRunner.js';

export const requiredFields = ['url'];

export async function run({ url, companyName = null, companySlug = null }, { onProgress = () => {} } = {}) {
  const result = await runCompanyBenchmarkJob(
    { url, companyName, companySlug },
    (stage) => onProgress({ stage }),
  );
  return { report: result.report, jsonPath: result.jsonPath, mdPath: result.mdPath, dir: result.dir };
}
