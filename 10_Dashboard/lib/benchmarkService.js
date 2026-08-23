/**
 * benchmarkService — sits between server.js and the Benchmark Orchestrator
 * (13_Orchestrator/). This is the layer that used to be a stub console.log
 * in 11_Benchmark_Engine/orchestrator/index.js's startBenchmark(); it now
 * actually runs the benchmark, but still knows nothing about *how* — that's
 * entirely the Orchestrator's job (and, beneath it, the Provider Registry's).
 *
 * Sprint 17: this file no longer imports a Provider directly. It requests
 * benchmark type 'full' from the Orchestrator, which resolves Reasoning to
 * ClaudeProvider via 12_Provider_Layer/registry/ProviderRegistry.js.
 * Swapping the default Reasoning provider later is a one-line change to
 * 12_Provider_Layer/config/providers.config.js — this file needs no changes
 * at all when that happens.
 *
 * V1.6: the one thing V1.5 was missing — the Queue never learned a run had
 * finished. This now calls the exact same setStage() the Queue's manual
 * dropdown already calls, at the two moments that matter (started, settled),
 * so requestsStore.js's own persisted state — the thing GET /api/requests
 * already returns — is the single source of truth for Running/Completed/
 * Failed. No new API, no polling, no stage inference: the item's `stage`
 * field IS the answer, exactly like every other stage this project has ever
 * had.
 */

import { BenchmarkOrchestrator } from '../../13_Orchestrator/index.js';
import { setStage } from './requestsStore.js';

const orchestrator = new BenchmarkOrchestrator();

// In-memory only, per Phase 1 scope — lost on server restart, same as
// activeHomepageRun already is for the Homepage Benchmark flow. Keyed by
// `${requestId}:${slug}` so the same competitor within the same request
// can't be launched twice while already running; that is the entire extent
// of the guard rail this phase implements. Persisted state (item.stage) is
// the real source of truth now — this Map is just a fast in-process check
// that doesn't require re-reading the JSON file on every click.
const runStatus = new Map();

/**
 * startBenchmark — the function server.js's PATCH .../items/:slug handler
 * calls when a "Run Benchmark" action sets stage to 'preparing'. Fires the
 * Orchestrator and returns immediately; the caller must not await this for
 * the HTTP response, matching the stub's original fire-and-forget contract.
 *
 * @param {object} args
 * @param {string} args.company     - display name; forwarded to the Feature Benchmark
 *                                    pipeline's Discovery/Reasoning/Report stages, and
 *                                    used for logging by the Full Benchmark pipeline
 * @param {string} args.feature     - the item's "focus" text; forwarded to the Feature
 *                                    Benchmark pipeline for feature-to-journey-step
 *                                    mapping and report storage, and used for logging
 *                                    by the Full Benchmark pipeline
 * @param {string} [args.benchmarkType] - request.benchmark_type ('Feature Benchmark'
 *                                    routes to the 'feature' pipeline; anything else
 *                                    keeps the existing 'full' pipeline, unchanged)
 * @param {string} args.requestId
 * @param {string} args.slug
 * @param {string} args.prompt      - the item's existing trigger_prompt, unchanged
 * @param {string} args.projectRoot - becomes the agent's cwd, so it writes into the
 *                                    existing Benchmark Repository structure unmodified
 * @param {string|null} [args.url]  - the item's existing url field. Full Benchmark
 *                                    treats it as optional (null/undefined skips
 *                                    Navigation); Feature Benchmark requires it —
 *                                    validated by featurePipeline.requiredFields via
 *                                    BenchmarkOrchestrator, same mechanism as any other
 *                                    missing required field.
 */
export function startBenchmark({ company, feature, benchmarkType, requestId, slug, prompt, projectRoot, url }) {
  const jobId = `${requestId}:${slug}`;
  const type = benchmarkType === 'Feature Benchmark' ? 'feature' : 'full';

  if (runStatus.get(jobId) === 'running') {
    console.log(`[benchmarkService] ${company} is already running for ${requestId} — ignoring duplicate start.`);
    return;
  }

  if (!prompt) {
    console.log(`[benchmarkService] No trigger prompt found for ${company} (${jobId}) — cannot start.`);
    return;
  }

  console.log(`[benchmarkService] Running — company=${company} feature=${feature} requestId=${requestId}`);
  runStatus.set(jobId, 'running');

  // Queued -> Running, immediately, before the (possibly long) provider call
  // begins — this is the exact moment the Queue is told a run actually
  // started, via the same setStage() its manual dropdown already uses.
  try {
    setStage(projectRoot, requestId, slug, 'running', { started_at: new Date().toISOString() });
  } catch (err) {
    // The request/item may have been cancelled or removed between the click
    // and this call — the provider run below is still allowed to proceed
    // (it was already committed to), but the Queue can't be told about a
    // job it no longer has a row for. Not a reason to abort the benchmark.
    console.log(`[benchmarkService] Could not set stage to 'running' for ${jobId}: ${err.message}`);
  }

  // Sprint 26 — Live Runtime Progress: the Runtime has emitted real,
  // named, per-stage progress events since Sprint 20 (navigation ->
  // screenshot -> vision -> reasoning -> output_verification) — this file
  // just never listened. onProgress here persists each stage-entry via the
  // same setStage() every other stage transition already uses, so the
  // Queue's existing polling/rendering can show it with no new API and no
  // second progress system. Only acts on 'running' transitions (one write
  // per stage entered, not one per running+completed pair) and only on the
  // known Runtime stage ids — 'started'/'done'/'failed' are
  // BenchmarkOrchestrator's own bookkeeping events, not real stages, and
  // are ignored here (the existing .then()/.catch() below already owns the
  // terminal state). lastProgressStage is kept as a fallback for
  // failed_stage below, for the rare case a thrown error has no stageId of
  // its own (see BenchmarkOrchestrator.js's Sprint 24 addition).
  const RUNTIME_STAGE_IDS = new Set(['navigation', 'screenshot', 'vision', 'reasoning', 'output_verification']);
  let lastProgressStage = null;

  orchestrator.runBenchmark(
    { type, requestId, prompt, cwd: projectRoot, jobId, url, feature, company },
    {
      onProgress: (event) => {
        if (!RUNTIME_STAGE_IDS.has(event.stage) || event.status !== 'running') return;
        lastProgressStage = event.stage;
        try {
          setStage(projectRoot, requestId, slug, event.stage, {});
        } catch (err) {
          // Same non-fatal handling as every other setStage() call in this
          // file — the request/item may have been cancelled or removed
          // between events; the benchmark itself keeps running regardless.
          console.log(`[benchmarkService] Could not set live stage '${event.stage}' for ${jobId}: ${err.message}`);
        }
      },
    },
  )
    .then((outcome) => {
      runStatus.set(jobId, 'completed');
      const finishedAt = new Date().toISOString();

      // outcome is BenchmarkOrchestrator's own resolved shape —
      // { status: 'succeeded'|'failed', result?, error? } — not
      // ReasoningProvider's { status: 'completed'|'failed', raw?, error? }
      // directly; outcome.error, when present, is { message, stack,
      // stageId? } (Sprint 24 adds stageId — see BenchmarkOrchestrator.js).
      //
      // Sprint 24 — Output Verification Layer: 'succeeded' at the
      // Orchestrator level only means every stage RAN without throwing —
      // it does NOT mean the benchmark's deliverables are actually
      // complete. outputVerificationStage is the last stage in
      // fullPipeline.js and always resolves (never throws) with its own
      // verdict in outcome.result.verification_status, so that verdict has
      // to be checked explicitly here rather than treating 'succeeded' as
      // the whole answer.
      if (outcome.status === 'succeeded') {
        if (outcome.result?.verification_status === 'failed') {
          const summary = outcome.result.verification_summary || 'Output verification found the deliverables incomplete or invalid.';
          console.log(`[benchmarkService] Verification failed — company=${company} requestId=${requestId} — ${summary}`);
          try {
            setStage(projectRoot, requestId, slug, 'verification_failed', {
              completed_at: finishedAt,
              execution_status: 'verification_failed',
              execution_message: summary,
            });
          } catch (err) {
            console.log(`[benchmarkService] Could not set stage to 'verification_failed' for ${jobId}: ${err.message}`);
          }
        } else {
          console.log(`[benchmarkService] Completed — company=${company} requestId=${requestId}`);
          try {
            setStage(projectRoot, requestId, slug, 'completed', {
              completed_at: finishedAt,
              execution_status: 'success',
              execution_message: 'Completed successfully — output verified.',
            });
          } catch (err) {
            console.log(`[benchmarkService] Could not set stage to 'completed' for ${jobId}: ${err.message}`);
          }
        }
      } else {
        // A stage threw. Sprint 24: attribute it to the right Dashboard
        // stage using which pipeline stage actually failed, instead of one
        // generic 'failed' for every cause.
        // Sprint 26: fall back to the last live progress event when the
        // thrown error itself has no stageId (e.g. a synchronous
        // validation error before BenchmarkRuntime ever ran) — still gives
        // the Queue a "stopped at" value in the common case rather than
        // nothing.
        const stageId = outcome.error?.stageId || lastProgressStage;
        const message = outcome.error?.message || 'claude exited with a non-zero status';
        const dashboardStage = stageId === 'reasoning' ? 'reasoning_failed'
          : stageId === 'output_verification' ? 'verification_failed'
          : (stageId === 'navigation' || stageId === 'screenshot' || stageId === 'vision') ? 'runtime_failed'
          : 'failed'; // unclassified — e.g. a synchronous validation error before any stage ran
        console.log(`[benchmarkService] Completed with an error (stage=${stageId || 'unclassified'}) — company=${company} requestId=${requestId} — ${message}`);
        try {
          setStage(projectRoot, requestId, slug, dashboardStage, {
            completed_at: finishedAt,
            execution_status: 'failed',
            execution_message: message,
            failed_stage: stageId || null,
          });
        } catch (err) {
          console.log(`[benchmarkService] Could not set stage to '${dashboardStage}' for ${jobId}: ${err.message}`);
        }
      }
    })
    .catch((err) => {
      runStatus.set(jobId, 'completed');
      console.log(`[benchmarkService] Completed with an unexpected error — company=${company} requestId=${requestId} — ${err.message}`);
      try {
        setStage(projectRoot, requestId, slug, 'failed', {
          completed_at: new Date().toISOString(),
          execution_status: 'failed',
          execution_message: err.message || 'Unexpected error running the benchmark',
          failed_stage: lastProgressStage,
        });
      } catch (setStageErr) {
        console.log(`[benchmarkService] Could not set stage to 'failed' for ${jobId}: ${setStageErr.message}`);
      }
    });
}

/** Running | completed | undefined (never started) — in-process only, see comment above. */
export function getRunStatus(requestId, slug) {
  return runStatus.get(`${requestId}:${slug}`) || null;
}
