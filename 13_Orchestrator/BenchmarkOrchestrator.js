/**
 * BenchmarkOrchestrator — the single entry point for every benchmark
 * execution. Receives a request, resolves it to a pipeline by type
 * (BenchmarkTypeRegistry), runs that pipeline, and reports progress/result
 * — both as EventEmitter events (for a caller that wants to observe many
 * concurrent runs) and via a per-call onProgress callback (matching
 * jobRunner.js's existing precedent, for a caller that only cares about
 * its own run).
 *
 * Never imports 10_Dashboard/lib/requestsStore.js or anything
 * Dashboard-specific — translating progress into Dashboard's own
 * setStage() calls is a future Dashboard-side adapter's job. This keeps
 * the dependency graph one-directional: Dashboard -> Orchestrator ->
 * {Provider Layer, Engine}, never reversed.
 */
import { EventEmitter } from 'events';
import { getPipeline } from './registry/BenchmarkTypeRegistry.js';
import { EVENTS } from './progressEvents.js';

function validateRequest(request, pipeline) {
  const missing = (pipeline.requiredFields || []).filter((field) => request[field] == null);
  if (missing.length) {
    throw new TypeError(`Benchmark type "${request.type}" is missing required field(s): ${missing.join(', ')}.`);
  }
}

export class BenchmarkOrchestrator extends EventEmitter {
  /**
   * @param {object} request - must include `type`; other fields depend on
   *   the resolved pipeline's requiredFields (see config/benchmarkTypes.config.js).
   * @param {object} [options]
   * @param {(event: {requestId, type, stage, ...}) => void} [options.onProgress]
   * @returns {Promise<{status: 'succeeded'|'failed', requestId, type, result?, error?}>}
   *   Never rejects for a benchmark-domain failure — only throws
   *   synchronously, before any work starts, for invalid input (unknown
   *   type or missing required fields), matching ReasoningProvider's
   *   {status, error?} resolved-shape contract.
   */
  async runBenchmark(request, { onProgress } = {}) {
    const { type, requestId } = request || {};
    if (!type) throw new TypeError('runBenchmark requires request.type.');

    const pipeline = getPipeline(type); // throws on unknown type — programmer error
    validateRequest(request, pipeline); // throws on missing fields — programmer error

    const emit = (stage, extra = {}) => {
      const event = { requestId, type, stage, ...extra };
      this.emit(EVENTS.PROGRESS, event);
      if (onProgress) onProgress(event);
    };

    this.emit(EVENTS.STARTED, { requestId, type });
    emit('started');

    try {
      const result = await pipeline.run(request, { onProgress: (e) => emit(e.stage, e) });
      this.emit(EVENTS.SUCCEEDED, { requestId, type, result });
      emit('done');
      return { status: 'succeeded', requestId, type, result };
    } catch (err) {
      const error = { message: err?.message || String(err), stack: err?.stack || null };
      // Sprint 24: RuntimeStageError (thrown by BenchmarkRuntime.run() — see
      // runtime/Runtime.js) carries which stage actually failed. Forwarding
      // it here is what lets a caller (benchmarkService.js) distinguish
      // "Navigation/Screenshot/Vision failed" from "Reasoning failed" from
      // "Output Verification itself errored" instead of one generic
      // failure. Absent for any error that isn't a RuntimeStageError (e.g.
      // a synchronous validation throw before the pipeline even started) —
      // callers already treat a missing stageId as an unclassified failure.
      if (err?.stageId) error.stageId = err.stageId;
      this.emit(EVENTS.FAILED, { requestId, type, error });
      emit('failed', { error });
      return { status: 'failed', requestId, type, error };
    }
  }
}
