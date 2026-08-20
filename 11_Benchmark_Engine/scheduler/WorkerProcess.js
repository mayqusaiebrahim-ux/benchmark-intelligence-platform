/**
 * WorkerProcess — the script that runs INSIDE each forked child process.
 * This is the actual isolation boundary: every worker is a separate OS
 * process (via child_process.fork() in BenchmarkScheduler), so a crash,
 * memory blow-up, or hung Chromium instance in one worker cannot touch the
 * scheduler process or any other worker's process — the OS, not application
 * code, enforces the isolation.
 *
 * Lifecycle: boot -> announce ready -> (idle <-> busy)* -> shutdown.
 * A worker is long-lived: it processes many jobs, one at a time, for as long
 * as the scheduler keeps sending them, rather than being spawned fresh per job.
 *
 * Sprint 22 — Single Entry Point: this used to import runCompanyBenchmarkJob
 * from jobRunner.js directly, making the parallel scheduler a second
 * execution path alongside BenchmarkOrchestrator. It now goes through
 * BenchmarkOrchestrator.runBenchmark({ type: 'homepage', ... }), which
 * resolves to pipelines/homepagePipeline.js — the exact same, unmodified
 * call to runCompanyBenchmarkJob() as before (see that file). No pipeline,
 * stage, provider, or Engine module changed; only which function this file
 * calls to reach it did.
 *
 * This is a deliberate, documented exception to "the Engine imports nothing
 * from the layers above it" (see scheduler/README.md's Sprint 22 note) —
 * matching this codebase's existing precedent for a few similar necessary
 * exceptions (e.g. PlaywrightNavigationProvider.js's navigate()). It is not
 * a circular *module-graph* dependency: this file is never itself imported
 * by anything — it only ever runs as a fork()'d child process's own entry
 * script, with its own independent module resolution.
 */

import { BenchmarkOrchestrator } from '../../13_Orchestrator/index.js';

let currentJobId = null;
const orchestrator = new BenchmarkOrchestrator();

function send(message) {
  if (process.send) process.send(message);
}

async function handleJob({ jobId, job }) {
  currentJobId = jobId;
  try {
    const onProgress = (event) => send({ type: 'progress', jobId, stage: event.stage, pid: process.pid });
    const outcome = await orchestrator.runBenchmark(
      { type: 'homepage', requestId: jobId, ...job },
      { onProgress },
    );

    if (outcome.status === 'succeeded') {
      const result = outcome.result;
      send({
        type: 'result',
        jobId,
        status: 'succeeded',
        pid: process.pid,
        data: { jsonPath: result.jsonPath, mdPath: result.mdPath, dir: result.dir },
      });
    } else {
      // outcome.error is { message, stack } — BenchmarkOrchestrator's own
      // catch shape (see BenchmarkOrchestrator.js). Note: it does not
      // forward jobRunner's custom `error.permanent`/`.protectionClassification`
      // properties — but neither did the pre-migration path: the old direct
      // call's catch block here only ever sent { message, stack } over IPC
      // too, and BenchmarkScheduler's #handleWorkerMessage reconstructs a
      // fresh Error from message.error.message alone either way. Confirmed
      // unchanged behavior, not a new gap introduced by this migration.
      send({
        type: 'result',
        jobId,
        status: 'failed',
        pid: process.pid,
        error: { message: outcome.error?.message || 'Unknown orchestrator error', stack: outcome.error?.stack || null },
      });
    }
  } catch (err) {
    // Safety net for anything that escapes the Orchestrator's own resolved-
    // failure contract entirely (e.g. a synchronous throw for invalid input) —
    // same safety net this file already had around the direct call.
    send({
      type: 'result',
      jobId,
      status: 'failed',
      pid: process.pid,
      error: { message: err?.message || String(err), stack: err?.stack || null },
    });
  } finally {
    currentJobId = null;
  }
}

process.on('message', (message) => {
  if (message?.type === 'job') {
    handleJob(message).catch(() => {
      // handleJob already catches everything internally and reports via
      // send(); this second catch only guards against a bug in the catch
      // path itself, so it deliberately does nothing further.
    });
  } else if (message?.type === 'shutdown') {
    send({ type: 'shuttingDown', pid: process.pid });
    process.exit(0);
  }
});

// ── Safety net ────────────────────────────────────────────────────────────
// If something escapes runCompanyBenchmarkJob's own try/catch entirely (a
// truly unexpected error, not a job-domain failure), report the in-flight
// job as failed rather than letting the process die silently and leaving the
// scheduler waiting forever. The scheduler's own 'exit' handler is the
// second line of defense if even this can't run (e.g. an OOM kill).
process.on('uncaughtException', (err) => {
  if (currentJobId) {
    send({ type: 'result', jobId: currentJobId, status: 'failed', pid: process.pid, error: { message: err?.message || String(err), stack: err?.stack || null } });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (currentJobId) {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    send({ type: 'result', jobId: currentJobId, status: 'failed', pid: process.pid, error: { message: err.message, stack: err.stack } });
  }
  process.exit(1);
});

send({ type: 'ready', pid: process.pid });
