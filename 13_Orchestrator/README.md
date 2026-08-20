# Benchmark Orchestrator

> **Sprint 16.** The single entry point for every benchmark execution. Receives a
> request, determines the benchmark type, runs that type's pipeline, reports
> progress, and resolves with a result — without the caller ever instantiating a
> provider or an Engine module directly.

## Why this folder, and not inside `11_Benchmark_Engine/orchestrator/`

`11_Benchmark_Engine/` is declared frozen (see its own README banner). Nesting the
Orchestrator inside its existing `orchestrator/` folder — even as an added file that
modifies nothing — would create a new dependency edge the Engine has never had: the
Engine reaching *forward* into `12_Provider_Layer/`. Today only `10_Dashboard/` and
`12_Provider_Layer/` import from `11_Benchmark_Engine/`; nothing goes the other way.

Instead, `13_Orchestrator/` is a new sibling folder, following the same placement
reasoning Sprint 15 used for `12_Provider_Layer/`:

```
Dashboard (10_Dashboard)
        │
        ▼
13_Orchestrator/          ← the single entry point
        │
        ├──► 12_Provider_Layer/    (Reasoning — and, for the "full" type, nothing else)
        └──► 11_Benchmark_Engine/  (jobRunner.js's runCompanyBenchmarkJob, for "homepage")
```

Everything still imports **downward only**. Nothing in `10_Dashboard/`,
`11_Benchmark_Engine/`, or `12_Provider_Layer/` is modified by this sprint.

## The central tension — "always use the registry" vs. "don't rewrite the Engine"

The ideal is that every pipeline step requests a capability from the Provider
Registry, never instantiates a provider directly. In practice, one thing stands in
the way for the `"homepage"` benchmark type: `11_Benchmark_Engine/scheduler/jobRunner.js`'s
`runCompanyBenchmarkJob()` contains real, hard-won production logic — two independent
blocked-page gates (`discoveryLooksBlocked()`, checked once from the anti-bot probe
and again from Discovery's own separate navigation) and a specific fix for an Imperva
page that re-verified itself moments after being classified clean. Both of the
helper functions that implement this are internal to `jobRunner.js` and not exported.

Re-deriving that logic fresh inside `13_Orchestrator/` — just to make the `"homepage"`
pipeline "purely" registry-driven — would create a second copy of safety-critical
behavior that can silently drift from the original. That's exactly what "reuse
existing modules" and "do not rewrite the Engine" exist to prevent. It would also
require re-deriving `homepageReport.js`'s `buildHomepageReport()` report-merge shape,
since that function already calls Vision internally rather than leaving Vision as a
separable step.

**Resolution:** the two benchmark types are treated differently, on purpose.

- **`"homepage"`** (`pipelines/homepagePipeline.js`) — calls `runCompanyBenchmarkJob()`
  as one composed, reused unit. This is a deliberate, documented exception, not an
  oversight.
- **`"full"`** (`pipelines/fullPipeline.js`) — genuinely registry-driven:
  `getReasoningProvider().run(prompt)`. No exception needed here, because today's
  production path (`10_Dashboard/lib/benchmarkService.js`) already is exactly that
  one atomic call — there is nothing to decompose or duplicate.

A follow-up sprint could additively export `discoveryLooksBlocked`/
`writeProtectedWebsiteReport` from `jobRunner.js` (a small, non-rewriting change to a
frozen file) so `"homepage"` could eventually compose Navigation → Vision → Report as
separate registry steps without duplicating logic. Out of scope for Sprint 16 —
named here so it isn't lost.

## Benchmark types, day one

| Type | Pipeline | What it does |
|---|---|---|
| `homepage` | `pipelines/homepagePipeline.js` | Delegates to `jobRunner.js`'s `runCompanyBenchmarkJob` |
| `full` | `pipelines/fullPipeline.js` | `getReasoningProvider().run(...)` — spawns the `claude` CLI against the full 11-deliverable trigger prompt |

No `pattern_extraction` or `journey` type exists yet — see the commented-out entries
in `config/benchmarkTypes.config.js`. Nothing in the codebase produces a Pattern
Extraction output today, so no type is registered for it; inventing one would violate
"do not add unnecessary abstractions."

## Lifecycle

```
runBenchmark(request, { onProgress })
  → validate request.type is known (throws — programmer error)
  → validate pipeline.requiredFields are present (throws — programmer error)
  → emit STARTED
  → await pipeline.run(request, { onProgress })   // forwards every stage event
  → success: emit SUCCEEDED, resolve { status: 'succeeded', result }
  → failure: emit FAILED,    resolve { status: 'failed', error }   // never rejects
```

`BenchmarkOrchestrator` extends `EventEmitter` (matching `BenchmarkScheduler`'s
existing precedent) and also accepts a per-call `onProgress` callback (matching
`jobRunner.js`'s existing precedent) — both fire from the same call, so a caller can
use whichever fits: one `orchestrator.on(EVENTS.PROGRESS, ...)` listener to watch many
concurrent runs, or a per-call callback to watch just its own.

No retry logic exists yet. "Future-ready for retry policies" means `runBenchmark()`
is a clean single-attempt unit a future retry wrapper could loop around (modeled on
`11_Benchmark_Engine/scheduler/retryPolicy.js`'s pure `shouldRetry()` shape) — not
that retries are built now.

## Notifying the Dashboard

`BenchmarkOrchestrator` never imports `10_Dashboard/lib/requestsStore.js`. Progress
events use the Orchestrator's own small vocabulary (`progressEvents.js`) and forward
whatever stage strings the underlying pipeline produces — including `jobRunner.js`'s
ad hoc ones like `'antibot_probe:passed:...'` — unmodified, with no attempt to
normalize them into Dashboard's own stage vocabulary (`10_Dashboard/lib/requestsStore.js`'s
`STAGES`, which is a different, Dashboard-specific enum).

Translating an Orchestrator progress event into a call to Dashboard's own
`setStage(projectRoot, requestId, slug, stage, meta)` is a future Dashboard-side
adapter's job — not built this sprint. That keeps the dependency graph
one-directional: `Dashboard → Orchestrator → {Provider Layer, Engine}`, never
reversed, which is what makes "Dashboard never knows about providers" true.

## Sprint 22 — Single Entry Point

`10_Dashboard/lib/benchmarkService.js` (type `'full'`) was already the only
caller of `BenchmarkOrchestrator.runBenchmark()`. Sprint 22 added a second:
`11_Benchmark_Engine/scheduler/WorkerProcess.js` now calls
`runBenchmark({ type: 'homepage', ... })` from inside each forked worker
process, replacing its previous direct call to `jobRunner.js`'s
`runCompanyBenchmarkJob()`. `homepagePipeline.js` itself is unchanged — it
already existed, already delegated to that same function, and had simply
never been reached by a live caller until this sprint. See
`11_Benchmark_Engine/scheduler/README.md`'s own Sprint 22 note for the
full reasoning, including the one deliberate, documented exception this
creates (a forked-child-process script inside the "frozen" Engine now
imports from this folder — not a circular module-graph dependency, since
that script is never itself imported by anything, but a real exception to
"the Engine imports nothing from above").

Both of this platform's live execution paths — the Homepage Benchmark Beta
(via `BenchmarkScheduler`) and the Full 11-deliverable benchmark (via
`benchmarkService.js`) — now terminate in `BenchmarkOrchestrator.runBenchmark()`.
`server.js` and `BenchmarkScheduler.js` themselves needed no changes: neither
ever called Engine execution logic directly (`BenchmarkScheduler` only
forked `WorkerProcess.js` and exchanged IPC messages), so both became
Orchestrator wrappers transitively, with no change to their own public APIs.

## How Dashboard will call it (future — not wired this sprint)

```js
import { BenchmarkOrchestrator } from '../13_Orchestrator/index.js';
const orchestrator = new BenchmarkOrchestrator();

const result = await orchestrator.runBenchmark(
  { type: 'homepage', requestId, url, companyName, companySlug },
  { onProgress: (event) => setStage(projectRoot, requestId, slug, mapStage(event.stage), {}) },
);
```

`10_Dashboard/server.js` and `10_Dashboard/lib/benchmarkService.js` are untouched by
this sprint. Flipping their live call sites over to `BenchmarkOrchestrator` is a
follow-up sprint, same discipline Sprint 15 used for the Provider Registry itself.
