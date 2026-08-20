/**
 * BenchmarkScheduler — owns the job queue and a pool of isolated worker
 * processes, and is the only piece of this module that knows both of them
 * exist. Discovery, Navigation Runner, Vision Analysis, and Reports are
 * unchanged and unaware this scheduler exists at all; it only calls them
 * indirectly, once per job, inside a worker process (see jobRunner.js).
 *
 * Design in one sentence: a fixed-size pool of long-lived child processes
 * pulls from a shared FIFO queue until it's empty, retrying failed jobs with
 * backoff and replacing any worker that dies unexpectedly, and reports every
 * state transition as an event so progress can be watched per company.
 */

import { fork } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JobQueue } from './JobQueue.js';
import { createRetryPolicy } from './retryPolicy.js';
import { EVENTS, STAGES } from './progressEvents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(__dirname, 'WorkerProcess.js');
const PROJECT_ROOT = join(__dirname, '..', '..');

let jobCounter = 0;
function nextJobId(companySlug) {
  jobCounter += 1;
  return `job_${jobCounter}_${companySlug}`;
}

export class BenchmarkScheduler extends EventEmitter {
  #queue;
  #retryPolicy;
  #concurrency;
  #workers = new Map();   // workerId -> { id, process, status, currentJobId }
  #jobStates = new Map(); // jobId -> job state (see below)
  #runId;
  #manifestPath;
  #settleResolve = null;
  #settlePromise = null;

  /**
   * @param {object} opts
   * @param {Array<{url:string, companyName?:string, companySlug?:string}>} opts.companies
   * @param {number} [opts.concurrency] default 3, per Sprint 13's requirement
   * @param {number} [opts.maxAttempts] total attempts per job including the first, default 3
   * @param {number} [opts.baseDelayMs] retry backoff base, default 2000ms
   */
  constructor({ companies, concurrency = 3, maxAttempts = 3, baseDelayMs = 2000 } = {}) {
    super();
    if (!Array.isArray(companies) || companies.length === 0) {
      throw new TypeError('BenchmarkScheduler requires a non-empty companies array.');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a positive integer.');
    }

    this.#concurrency = concurrency;
    this.#retryPolicy = createRetryPolicy({ maxAttempts, baseDelayMs });
    this.#runId = `run_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    this.#manifestPath = join(PROJECT_ROOT, '02_Benchmark_Repository', '_Parallel_Runs', this.#runId, 'manifest.json');

    this.#queue = new JobQueue();
    for (const company of companies) {
      const id = nextJobId(company.companySlug || company.companyName || company.url);
      const state = {
        id,
        job: company,
        status: 'queued',
        attempts: 0,
        stage: STAGES.QUEUED,
        workerPid: null,
        error: null,
        result: null,
        queuedAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      };
      this.#jobStates.set(id, state);
      this.#queue.enqueue({ jobId: id, job: company });
      this.emit(EVENTS.QUEUED, this.#snapshotOf(id));
    }
  }

  get runId() {
    return this.#runId;
  }

  /** Read-only snapshot of every job's current state — "progress independently for every company." */
  getStatusSnapshot() {
    return [...this.#jobStates.values()].map((s) => this.#snapshotOf(s.id));
  }

  #snapshotOf(jobId) {
    const s = this.#jobStates.get(jobId);
    return { ...s, job: { ...s.job } };
  }

  /**
   * Starts the worker pool and resolves once every job has reached a
   * terminal state (succeeded or failed after exhausting retries).
   * @returns {Promise<Array<object>>} final snapshot of every job
   */
  run() {
    this.#settlePromise = new Promise((resolve) => { this.#settleResolve = resolve; });

    for (let i = 0; i < this.#concurrency; i++) {
      this.#spawnWorker(i);
    }

    return this.#settlePromise;
  }

  #spawnWorker(workerId) {
    const child = fork(WORKER_SCRIPT, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const workerState = { id: workerId, process: child, status: 'spawning', currentJobId: null };
    this.#workers.set(workerId, workerState);
    this.emit(EVENTS.WORKER_SPAWNED, { workerId, pid: child.pid });

    child.on('message', (message) => this.#handleWorkerMessage(workerId, message));

    child.on('exit', (code, signal) => {
      this.emit(EVENTS.WORKER_EXITED, { workerId, pid: child.pid, code, signal });
      const wasGracefulShutdown = workerState.status === 'shutting-down';
      const inFlightJobId = workerState.currentJobId;
      this.#workers.delete(workerId);

      if (!wasGracefulShutdown) {
        // The process died mid-job (crash, OOM, killed) without ever sending
        // a 'result' message. Treat that as a failed attempt for whatever
        // job it held, then replace the worker so the pool stays at full
        // strength — one crashed process must not shrink our concurrency.
        if (inFlightJobId) {
          this.#onJobAttemptFailed(inFlightJobId, new Error(`Worker ${workerId} (pid ${child.pid}) exited unexpectedly (code=${code}, signal=${signal}) before reporting a result.`));
        }
        if (!this.#allJobsSettled()) {
          this.#spawnWorker(workerId);
        }
      }
    });
  }

  #handleWorkerMessage(workerId, message) {
    const worker = this.#workers.get(workerId);
    if (!worker) return;

    if (message.type === 'ready') {
      worker.status = 'idle';
      this.emit(EVENTS.WORKER_READY, { workerId, pid: message.pid });
      this.#assignNextJob(workerId);
      return;
    }

    if (message.type === 'progress') {
      const state = this.#jobStates.get(message.jobId);
      if (!state) return;
      state.stage = message.stage;
      this.emit(EVENTS.PROGRESS, this.#snapshotOf(message.jobId));
      return;
    }

    if (message.type === 'result') {
      worker.currentJobId = null;
      worker.status = 'idle';
      if (message.status === 'succeeded') {
        this.#onJobSucceeded(message.jobId, message.data);
      } else {
        this.#onJobAttemptFailed(message.jobId, new Error(message.error?.message || 'Unknown worker error'));
      }
      this.#assignNextJob(workerId);
    }
  }

  #assignNextJob(workerId) {
    const worker = this.#workers.get(workerId);
    if (!worker || worker.status !== 'idle') return;

    const next = this.#queue.dequeue();
    if (!next) {
      // No work left for this worker right now. If nothing is queued AND
      // nothing is still running anywhere, the whole batch is done.
      if (this.#allJobsSettled()) this.#finishBatch();
      return;
    }

    const state = this.#jobStates.get(next.jobId);
    state.status = 'running';
    state.attempts += 1;
    state.stage = STAGES.QUEUED;
    state.workerPid = worker.process.pid;
    state.startedAt = state.startedAt || new Date().toISOString();

    worker.status = 'busy';
    worker.currentJobId = next.jobId;

    this.emit(EVENTS.STARTED, this.#snapshotOf(next.jobId));
    worker.process.send({ type: 'job', jobId: next.jobId, job: next.job });
  }

  #onJobSucceeded(jobId, data) {
    const state = this.#jobStates.get(jobId);
    if (!state || state.status === 'succeeded') return; // already settled — ignore a late/duplicate message
    state.status = 'succeeded';
    state.stage = STAGES.DONE;
    state.result = data;
    state.finishedAt = new Date().toISOString();
    this.#appendManifest(state);
    this.emit(EVENTS.SUCCEEDED, this.#snapshotOf(jobId));
    if (this.#allJobsSettled()) this.#finishBatch();
  }

  #onJobAttemptFailed(jobId, error) {
    const state = this.#jobStates.get(jobId);
    if (!state || state.status === 'succeeded' || state.status === 'failed') return;

    if (this.#retryPolicy.shouldRetry(state.attempts, error)) {
      const delayMs = this.#retryPolicy.nextDelayMs(state.attempts);
      state.status = 'retrying';
      state.error = error.message;
      this.emit(EVENTS.RETRY, { ...this.#snapshotOf(jobId), nextAttemptInMs: delayMs });
      setTimeout(() => {
        state.status = 'queued';
        this.#queue.requeueFront({ jobId, job: state.job });
        // Wake any worker that's currently idle with nothing to do.
        for (const [wid, w] of this.#workers) {
          if (w.status === 'idle') { this.#assignNextJob(wid); break; }
        }
      }, delayMs);
      return;
    }

    state.status = 'failed';
    state.error = error.message;
    state.finishedAt = new Date().toISOString();
    this.#appendManifest(state);
    this.emit(EVENTS.FAILED, this.#snapshotOf(jobId));
    if (this.#allJobsSettled()) this.#finishBatch();
  }

  #allJobsSettled() {
    for (const s of this.#jobStates.values()) {
      if (s.status !== 'succeeded' && s.status !== 'failed') return false;
    }
    return true;
  }

  #appendManifest(state) {
    // Written after EVERY terminal job, not batched at the end — so the
    // manifest on disk always reflects exactly what's finished so far, even
    // if the process were killed mid-run. This is in addition to (not
    // instead of) each job's own report.json/report.md, which jobRunner.js
    // already writes immediately via the unmodified writeHomepageReport().
    try {
      mkdirSync(dirname(this.#manifestPath), { recursive: true });
      const snapshot = {
        run_id: this.#runId,
        concurrency: this.#concurrency,
        updated_at: new Date().toISOString(),
        jobs: this.getStatusSnapshot(),
      };
      writeFileSync(this.#manifestPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    } catch {
      // Manifest is a convenience artifact, not the source of truth — never
      // let a filesystem hiccup here fail the actual benchmark job.
    }
  }

  #finishBatch() {
    for (const [workerId, worker] of this.#workers) {
      worker.status = 'shutting-down';
      worker.process.send({ type: 'shutdown' });
      // Belt-and-suspenders: force-kill if it doesn't exit promptly.
      setTimeout(() => { try { worker.process.kill(); } catch { /* already gone */ } }, 3000).unref();
    }
    const finalSnapshot = this.getStatusSnapshot();
    this.emit(EVENTS.BATCH_COMPLETE, { runId: this.#runId, jobs: finalSnapshot });
    if (this.#settleResolve) this.#settleResolve(finalSnapshot);
  }
}
