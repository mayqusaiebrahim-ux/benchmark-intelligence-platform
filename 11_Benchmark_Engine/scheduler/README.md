# Parallel Benchmark Engine (Sprint 13)

Runs multiple companies' homepage benchmarks concurrently instead of one at a
time. **Discovery, Navigation Runner, Vision Analysis, and Reports are
untouched** — every file under `modules/` and `orchestrator/index.js` is
exactly as it was before this sprint. This directory only adds a new
orchestration layer on top of them.

## Architecture

```
run-parallel-benchmark.js  (CLI)
        │
        ▼
BenchmarkScheduler  ──owns──▶  JobQueue  (FIFO, one entry per company)
        │
        │  fork()s and manages exactly `concurrency` child processes
        ▼
┌───────────────┬───────────────┬───────────────┐
│  Worker #0     │  Worker #1     │  Worker #2     │   ← separate OS processes
│ WorkerProcess.js│WorkerProcess.js│WorkerProcess.js│
│       │        │       │        │       │        │
│       ▼        │       ▼        │       ▼        │
│  jobRunner.js  │  jobRunner.js  │  jobRunner.js  │
│       │        │       │        │       │        │
│       ▼        │       ▼        │       ▼        │
│ runDiscovery() │ runDiscovery() │ runDiscovery() │  ← unmodified modules/discovery
│ captureScreenshot()  ...        │                │  ← unmodified modules/vision
│ buildHomepageReport()           │                │  ← unmodified modules/reports + modules/analysis
│ writeHomepageReport()  (saves immediately)        │
└───────────────┴───────────────┴───────────────┘
        │
        ▼  progress/result IPC messages
BenchmarkScheduler ──emits──▶  job:queued / job:started / job:progress /
                                job:retry / job:succeeded / job:failed /
                                worker:spawned / worker:ready / worker:exited /
                                batch:complete
```

**Why separate OS processes, not just concurrent `async` tasks in one
process?** The requirement is "each worker must be isolated" and "a failure
in one company must not stop the others." Within a single process, a
sufficiently bad failure (an uncaught exception that slips past a `try/catch`,
a Chromium instance that takes the whole process down, an out-of-memory
crash) can kill everything running in that process, including unrelated jobs.
A pool of `child_process.fork()`ed workers makes that impossible by
construction: the OS enforces the isolation, not application discipline. It
also means a single company's heavy Playwright memory usage can't starve or
crash another company's in-flight browser session.

## Queue Management

`JobQueue.js` is a plain FIFO with one addition: `requeueFront()`, used only
for retries, so a job that just failed gets picked up again before jobs that
haven't started yet — rather than a failed job going to the back of a long
line. The queue itself has no concept of workers or concurrency; it only
holds `{ jobId, job }` pairs and hands them out one at a time. All
concurrency decisions live in `BenchmarkScheduler`, which is what keeps the
queue trivially unit-testable in isolation.

## Worker Lifecycle

```
spawn ──▶ ready ──▶ idle ──▶ busy ──▶ idle ──▶ ... ──▶ shutdown
                       ▲________________|
                (loops: pulls next job from the queue)

Any state ──▶ CRASH ──▶ scheduler detects process 'exit' with no matching
                         'result' message ──▶ in-flight job treated as a
                         failed attempt (goes through retry policy) ──▶
                         scheduler spawns a REPLACEMENT worker to keep the
                         pool at full `concurrency`
```

A worker is **long-lived**: it's forked once and processes many jobs in
sequence for as long as the queue has work, rather than being spawned fresh
per company. This amortizes the process-spawn cost (Node startup + module
resolution) across every job that worker handles, instead of paying it once
per company. When the queue is empty and a worker goes idle with nothing
left to do, the scheduler leaves it idle until the batch finishes, then sends
`{ type: 'shutdown' }`, which the worker acknowledges and exits `0`. If a
worker doesn't exit within 3 seconds of that message, the scheduler
force-kills it — this is a safety timeout, not the expected path.

If a worker process dies unexpectedly mid-job (not via the graceful shutdown
message), the scheduler does two independent things: (1) treats whatever job
that worker was holding as a failed attempt, subject to the same retry policy
as any other failure, and (2) immediately forks a brand-new worker to replace
the dead one, so a crash never permanently reduces the pool below the
configured concurrency.

## Retry Strategy

`retryPolicy.js` is a small, dependency-free decision function, deliberately
kept separate from both the queue and the worker so it can be reasoned about
(and tested) on its own:

- **Default: 3 total attempts per company** (1 initial + 2 retries), configurable via `maxAttempts`.
- **Exponential backoff** between attempts: 2s, then 4s (base `2000ms * 2^(attempt-1)`), configurable via `baseDelayMs`.
- **Not everything is retried.** A URL that's structurally invalid will fail identically on attempt 2 and 3 — retrying it just burns a worker slot. `shouldRetry()` filters out that class of error; everything else (a page that didn't settle in time, a transient network blip, an OpenAI rate limit) is treated as retryable, since those are exactly the failure modes that plausibly succeed on a second attempt.
- Retries are re-queued at the **front** of the queue (`requeueFront`), so a failed company gets priority over companies that haven't started yet, rather than waiting behind the entire remaining batch.

## Progress Events

`progressEvents.js` defines a fixed vocabulary so event names are never
typo'd across files:

| Event | Meaning |
|---|---|
| `job:queued` | A company entered the queue |
| `job:started` | A worker began an attempt (includes the attempt number) |
| `job:progress` | Sub-stage progress within one attempt: `discovery` → `screenshot` → `analysis` → `report` → `done` |
| `job:retry` | An attempt failed and was re-queued, with the backoff delay |
| `job:succeeded` | A company's benchmark finished and its report was written |
| `job:failed` | A company exhausted all retries |
| `worker:spawned` / `worker:ready` / `worker:exited` | Worker process lifecycle |
| `batch:complete` | Every company has reached a terminal state |

Every one of these is emitted **per company**, independently — there's no
"global progress bar" that hides which specific company is stuck on what.
`BenchmarkScheduler.getStatusSnapshot()` also gives an on-demand, point-in-time
view of every company's current state, for anything that wants to poll
rather than subscribe (e.g. a future Dashboard progress panel).

## "Save results immediately after each company finishes"

This falls out of the existing, unmodified `writeHomepageReport()` — it's
called inside `jobRunner.js` as soon as that specific company's pipeline
finishes, synchronously, before the worker even reports success back to the
scheduler. Company A's report lands on disk the moment Company A is done,
completely independent of whether B and C are still running. In addition,
`BenchmarkScheduler` writes a batch-level manifest
(`02_Benchmark_Repository/_Parallel_Runs/{runId}/manifest.json`) after every
single terminal event (not just at the end), so the on-disk state of the
whole batch is never more than one company-completion behind reality — even
if the scheduler process itself were killed mid-run, everything that had
already succeeded is already saved, both as that company's own report and in
the manifest.

## Sprint 22 — Single Entry Point

`WorkerProcess.js` no longer imports `runCompanyBenchmarkJob` from
`jobRunner.js` directly. It now calls
`BenchmarkOrchestrator.runBenchmark({ type: 'homepage', ... })`
(`13_Orchestrator/index.js`), which resolves to
`13_Orchestrator/pipelines/homepagePipeline.js` — a pure pass-through to the
exact same `runCompanyBenchmarkJob()` call this file made before. Nothing in
`jobRunner.js` or anything it calls (Discovery, the Anti-Bot Layer, Vision,
Reports) changed. `BenchmarkScheduler.js` itself required zero changes — it
never called `jobRunner` directly (it only forks `WorkerProcess.js` and
exchanges IPC messages), so once `WorkerProcess.js` routes through the
Orchestrator, the Scheduler transitively becomes a queueing/concurrency/retry
wrapper *around* the Orchestrator instead of a second execution path, exactly
as intended — with no change to its own public API.

**Known, deliberate exception:** this makes `WorkerProcess.js` — part of the
"frozen" Engine — import from `13_Orchestrator/`, the layer every other
sprint's docs describe as importing *from* the Engine, never the reverse.
This is not a circular module-graph dependency (`WorkerProcess.js` is never
itself imported by anything; it only ever runs as a `fork()`'d child
process's own entry script), but it is a real exception to the documented
"Engine imports nothing from above" convention, made because Sprint 22's
scope was explicitly to make the Scheduler a wrapper around the Orchestrator
without relocating any files. A future sprint may choose to physically move
`scheduler/` into `13_Orchestrator/` to close this convention gap for good —
not done here, to keep this migration as small as possible.

**Verified unchanged:** `job:progress` IPC messages carry the identical raw
stage string jobRunner always emitted (traced through
`homepagePipeline.js`'s `onProgress({stage})` bridge and
`BenchmarkOrchestrator`'s own event-forwarding). `job:succeeded` messages
carry the identical `jsonPath`/`mdPath`/`dir` fields. `job:failed` messages
carry the identical `message`/`stack` shape — `jobRunner`'s custom
`error.permanent`/`.protectionClassification` properties were already lost
at this same IPC boundary before this migration (the old code's catch block
also only ever sent `{ message, stack }`), so this is confirmed pre-existing
behavior, not a regression introduced here.

## What Was NOT Changed

- `modules/discovery/*`, `modules/navigation_runner/*`, `modules/analysis/*`,
  `modules/vision/*`, `modules/reports/*` — zero edits.
- `orchestrator/index.js` — zero edits. `runHomepageBenchmark()` still exists,
  unchanged, and is still what `10_Dashboard/server.js`'s existing
  "Start Benchmark" button calls for a single company.
- `jobRunner.js` (new) calls the exact same functions, in the exact same
  order, that `runHomepageBenchmark()` already did — the only addition is a
  progress callback between each step, which a single opaque function call
  can't offer. No pipeline stage's internal logic was touched or duplicated.
