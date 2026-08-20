/**
 * progressEvents — the fixed vocabulary of events BenchmarkScheduler emits.
 * Centralizing the names avoids typo'd event strings scattered across the
 * scheduler, worker, and any consumer (CLI, Dashboard bridge, tests).
 */

export const EVENTS = Object.freeze({
  QUEUED: 'job:queued',           // a job entered the queue
  STARTED: 'job:started',         // a worker picked up a job and began attempt N
  PROGRESS: 'job:progress',       // sub-stage progress within one attempt (discovery/screenshot/analysis/report)
  RETRY: 'job:retry',             // an attempt failed and the job was re-queued
  SUCCEEDED: 'job:succeeded',     // a job finished successfully and its result was saved
  FAILED: 'job:failed',           // a job exhausted all retries
  WORKER_SPAWNED: 'worker:spawned',
  WORKER_READY: 'worker:ready',
  WORKER_EXITED: 'worker:exited', // includes worker crashes — the scheduler treats these as job failures, not scheduler failures
  BATCH_COMPLETE: 'batch:complete', // every job has reached a terminal state (succeeded or failed)
});

/** Pipeline sub-stages a single attempt passes through — used with PROGRESS events. */
export const STAGES = Object.freeze({
  QUEUED: 'queued',
  DISCOVERY: 'discovery',
  SCREENSHOT: 'screenshot',
  ANALYSIS: 'analysis',
  REPORT: 'report',
  DONE: 'done',
});
