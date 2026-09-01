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
import { setStage, tryAcquirePipelineLock, releasePipelineLock } from './requestsStore.js';
import { resolveOfficialUrl } from './companyUrls.js';
import { flushStatePersistence, checkStorageHealth } from './storage/index.js';

const orchestrator = new BenchmarkOrchestrator();

// In-memory only, per Phase 1 scope — lost on server restart, same as
// activeHomepageRun already is for the Homepage Benchmark flow. Keyed by
// `${requestId}:${slug}` so the same competitor within the same request
// can't be launched twice while already running; that is the entire extent
// of the guard rail this phase implements. Persisted state (item.stage) is
// the real source of truth now — this Map is just a fast in-process check
// that doesn't require re-reading the JSON file on every click.
const runStatus = new Map();

// Explicit routing only — no ternary, no silent default. The wizard's
// "Benchmark Type" step is gone (Sprint: routing fix); Scope-only labels
// like 'UX/UI', 'AI Experience', 'Mobile App', 'Website' must never reach
// this map as a benchmark_type. If one does (e.g. a pre-existing item
// created before that fix, or a direct API call), startBenchmark() below
// fails the run clearly rather than defaulting it into the Full Pipeline.
const PIPELINE_TYPE_BY_BENCHMARK_TYPE = {
  'Feature Benchmark': 'feature',
  'Complete Journey': 'full',
};

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
 * @param {string} [args.benchmarkType] - request.benchmark_type. Routed via the
 *                                    explicit PIPELINE_TYPE_BY_BENCHMARK_TYPE map
 *                                    below ('Feature Benchmark' -> 'feature',
 *                                    'Complete Journey' -> 'full') — any other
 *                                    value (including the Scope-only labels like
 *                                    'UX/UI' that the wizard used to expose as a
 *                                    benchmark_type by mistake) fails the run
 *                                    clearly instead of silently defaulting to the
 *                                    Full Pipeline, which launches local Chromium
 *                                    and can OOM Render Free/Starter.
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
export function startBenchmark({ company, feature, scope, benchmarkType, requestId, slug, prompt, projectRoot, url }) {
  const jobId = `${requestId}:${slug}`;
  const type = PIPELINE_TYPE_BY_BENCHMARK_TYPE[benchmarkType];
  const browserProvider = (process.env.BROWSER_PROVIDER || 'local').trim().toLowerCase();

  // ── Feature Benchmark URL pre-flight ─────────────────────────────────────
  // A Feature Benchmark must open the requested company's OWN official site.
  // If the item has no URL, try one last resolution from the curated
  // companyUrls.js table; if that also fails, record a clear failed run and
  // never start browser work with a guessed or borrowed URL.
  let resolvedUrl = (typeof url === 'string' && url.trim()) ? url.trim() : null;
  if (type === 'feature' && !resolvedUrl) {
    resolvedUrl = resolveOfficialUrl(company) || null;
    if (!resolvedUrl) {
      const message = `No official website URL for "${company}". A Feature Benchmark cannot start without one — add a URL to this competitor and re-run.`;
      console.log(`[benchmarkService] ${message} (requestId=${requestId} slug=${slug})`);
      runStatus.set(jobId, 'completed');
      try {
        setStage(projectRoot, requestId, slug, 'failed', {
          completed_at: new Date().toISOString(),
          execution_status: 'failed',
          execution_message: message,
        });
      } catch (err) {
        console.log(`[benchmarkService] Could not set stage to 'failed' for ${jobId}: ${err.message}`);
      }
      return;
    }
  }

  // Required runtime log, every call, before any routing decision short-
  // circuits — this is the one line that would have shown the production
  // bug immediately (benchmarkType=UX/UI resolvedType=UNSUPPORTED next to
  // browserProvider=browserbase, instead of silently resolvedType=full).
  // Non-secret: benchmarkType/resolvedType/browserProvider only, never a key.
  console.log(`[benchmarkService] benchmarkType=${benchmarkType} resolvedType=${type || 'UNSUPPORTED'} browserProvider=${browserProvider}`);

  if (runStatus.get(jobId) === 'running') {
    console.log(`[benchmarkService] ${company} is already running for ${requestId} — ignoring duplicate start.`);
    return;
  }

  if (!type) {
    // No local-fallback path exists here on purpose: an unsupported
    // benchmark_type must never resolve to 'full', since the Full Pipeline
    // launches local Chromium (12_Provider_Layer) and can OOM Render
    // Free/Starter exactly the way 'UX/UI' silently doing so did in
    // production. Recorded as a normal failed run (not a thrown/uncaught
    // error) since server.js's PATCH handler already sent its HTTP response
    // by the time this fires and cannot report a second one.
    const message = `Unsupported benchmark_type "${benchmarkType}" — no explicit pipeline routing defined for it. Refusing to silently fall back to the Full Pipeline.`;
    console.log(`[benchmarkService] ${message} (requestId=${requestId} slug=${slug})`);
    runStatus.set(jobId, 'completed');
    try {
      setStage(projectRoot, requestId, slug, 'failed', {
        completed_at: new Date().toISOString(),
        execution_status: 'failed',
        execution_message: message,
      });
    } catch (err) {
      console.log(`[benchmarkService] Could not set stage to 'failed' for ${jobId}: ${err.message}`);
    }
    return;
  }

  if (!prompt) {
    console.log(`[benchmarkService] No trigger prompt found for ${company} (${jobId}) — cannot start.`);
    return;
  }

  // Persisted duplicate-run guard: the SAME requestId must never have two
  // full pipelines (discovery -> Browserbase -> Vision -> ...) running at
  // once. Survives a process restart and a second server instance (the
  // in-memory runStatus Map does not); self-expires so a crashed run can be
  // retried. Not a queue.
  const lock = tryAcquirePipelineLock(projectRoot, requestId, jobId);
  if (!lock.ok) {
    console.log(`[benchmarkService] duplicate_run_prevented — requestId=${requestId} slug=${slug} reason=${lock.reason} holder=${lock.holder || '-'} since=${lock.since || '-'}`);
    runStatus.set(jobId, 'completed');
    return; // leave item.stage alone — the run that holds the lock owns it
  }
  const releaseLock = () => { try { releasePipelineLock(projectRoot, requestId, jobId); } catch { /* best effort */ } };

  console.log(`[benchmarkService] Running — company=${company} feature=${feature} requestId=${requestId}`);
  runStatus.set(jobId, 'running');

  // Queued -> Running, immediately, before the (possibly long) provider call
  // begins — this is the exact moment the Queue is told a run actually
  // started, via the same setStage() its manual dropdown already uses.
  //
  // Investigated: unlike the onProgress/terminal setStage() calls below,
  // THIS call has no legitimate window to fail on a genuinely in-flight
  // request. The only caller of startBenchmark() is server.js's PATCH
  // handler, which itself calls setStage(..., 'preparing') successfully
  // (or this function is never reached) and then calls startBenchmark()
  // synchronously, with no `await` anywhere in between — Node's
  // single-threaded, run-to-completion execution means no other request
  // can touch Benchmark_Requests.json in that gap. So if this specific
  // call still throws "not found", the request was already gone before
  // this synchronous chain even started (e.g. a stale/reused id, or a
  // Benchmark_Requests.json that doesn't reflect what created it) — a
  // real anomaly, not an ordinary mid-flight cancellation race. Continuing
  // to spend real Anthropic/Vision/browser cost on a request nobody can
  // ever see the result of was the actual "swallowing" — this now aborts
  // instead. The onProgress and terminal setStage() calls further below
  // keep their original swallow-and-continue behavior unchanged: a
  // cancellation genuinely can land during the real async gaps between
  // pipeline stages (seconds to minutes), so a failure there does not
  // indicate the same kind of anomaly and should not abort an
  // already-committed run.
  try {
    setStage(projectRoot, requestId, slug, 'running', { started_at: new Date().toISOString() });
  } catch (err) {
    console.log(`[benchmarkService] Could not set stage to 'running' for ${jobId} — aborting, this request does not exist: ${err.message}`);
    runStatus.set(jobId, 'completed');
    releaseLock();
    return;
  }

  // Sprint 26 — Live Runtime Progress: the Runtime has emitted real,
  // named, per-stage progress events since Sprint 20 — this file just
  // never listened. onProgress here persists each stage-entry via the
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
  //
  // Covers both pipelines' real Stage ids, not just fullPipeline.js's five
  // (navigation/screenshot/vision/reasoning/output_verification) —
  // featurePipeline.js's six (feature_discovery/journey_mapper/
  // navigation_runner/feature_vision/feature_reasoning/
  // feature_report_writer) were previously absent from this set entirely,
  // so every Feature Benchmark progress event was silently ignored here:
  // item.stage never advanced past its initial 'running' value for the
  // whole run, regardless of whether setStage() itself would have
  // succeeded. Full Pipeline's five ids are unchanged, preserving its
  // existing behavior exactly.
  const RUNTIME_STAGE_IDS = new Set([
    'navigation', 'screenshot', 'vision', 'reasoning', 'output_verification',
    'feature_discovery', 'journey_mapper', 'navigation_runner', 'feature_vision', 'feature_reasoning', 'feature_report_writer',
  ]);
  let lastProgressStage = null;

  // ── Storage availability preflight ──────────────────────────────────────
  // With STORAGE_PROVIDER=r2 the server can boot even when the R2 credentials
  // are wrong or the bucket is unreachable. Verify persistence is actually
  // usable with ONE lightweight, non-destructive call BEFORE any Browserbase /
  // Discovery / Vision / Anthropic work is spent — a run whose report can
  // never be saved is not worth starting. STORAGE_PROVIDER=local reports
  // healthy (skipped) and this stays a no-op, so local dev is unchanged.
  Promise.resolve()
    .then(() => checkStorageHealth())
    .then((health) => {
      if (!health.ok) {
        const err = new Error('STORAGE_PREFLIGHT_FAILED');
        err.storagePreflight = health;
        throw err;
      }
      return orchestrator.runBenchmark(
        { type, requestId, prompt, cwd: projectRoot, jobId, url: resolvedUrl || url, feature, company, slug, scope: scope || [] },
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
      );
    })
    .then(async (outcome) => {
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

          // Completion-persistence gate: the report + evidence were already
          // uploaded (or the pipeline would have failed at those stages). The
          // last thing that must be safe is the request state itself — if the
          // R2 write for Benchmark_Requests.json did not land, this run is
          // NOT safely persisted and must not stand as Completed. Only
          // meaningful when STORAGE_PROVIDER=r2 (flush.attempted).
          try {
            const flush = await flushStatePersistence();
            if (flush.attempted && !flush.ok) {
              const msg = `The report and evidence were saved, but the run state could not be written to persistent storage (${flush.error}). Not safe to mark Completed — retry once storage is reachable.`;
              console.log(`[benchmarkService] Completion-persistence gate FAILED — requestId=${requestId} — ${flush.error}`);
              setStage(projectRoot, requestId, slug, 'verification_failed', {
                completed_at: finishedAt,
                execution_status: 'verification_failed',
                execution_message: msg,
              });
            }
          } catch (err) {
            console.log(`[benchmarkService] Completion-persistence gate check errored for ${jobId}: ${err.message}`);
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

      // Storage preflight failure — nothing downstream ran: no Browserbase
      // session, no Discovery, no Vision, no Anthropic call. Fail the run
      // with a clear human-readable reason; the technical detail is
      // server-side only (non-secret — a status line / bucket name at most).
      if (err && err.storagePreflight) {
        const h = err.storagePreflight;
        console.log(`[benchmarkService] Storage preflight FAILED — requestId=${requestId} slug=${slug} provider=${h.provider} — ${h.reason}`);
        try {
          setStage(projectRoot, requestId, slug, 'failed', {
            completed_at: new Date().toISOString(),
            execution_status: 'failed',
            execution_message: 'Persistent storage is currently unavailable. Benchmark was not started.',
            failed_stage: 'storage_preflight',
          });
        } catch (setStageErr) {
          console.log(`[benchmarkService] Could not set stage to 'failed' for ${jobId}: ${setStageErr.message}`);
        }
        return;
      }

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
    })
    // The pipeline is terminal (completed / failed / verification_failed):
    // free the duplicate-run lock so an EXPLICIT retry can start a fresh run.
    .finally(releaseLock);
}

/** Running | completed | undefined (never started) — in-process only, see comment above. */
export function getRunStatus(requestId, slug) {
  return runStatus.get(`${requestId}:${slug}`) || null;
}
