# Architecture — Current System

Describes what is actually built and wired today. Nothing in this document is
aspirational — see [`ROADMAP.md`](./ROADMAP.md) for what's planned and
[`PRD.md`](./PRD.md) for the target UX those future phases build toward.

The system has **two real, working data flows today, and they are not yet
connected to each other.** That seam is the single most important fact about
the current architecture — see [Known Gaps](#known-gaps-in-current-wiring).

---

## Components

### Discovery
`11_Benchmark_Engine/modules/discovery/`

Given only a URL, produces a structured **Discovery Report** — website type,
confidence, navigation, primary user goals, detected AI capabilities, search/
account/language capability, device indicators, consent status, obstacles,
a `suggested_benchmark_journey` (12 canonical steps with evidence and
confidence), and a `safe_next_action` recommendation.

- Uses Playwright directly — one page load, plus at most two narrowly-scoped
  safe actions (dismiss a cookie banner, expand a collapsed nav menu), never
  more, never a transaction.
- Every detector is structural/ARIA/content-based — no hardcoded per-site
  selectors.
- Files: `signals.js` (read-only observation), `actions.js` (the only file
  that clicks anything), `interpret.js` (pure classification), `index.js`
  (`runDiscovery`).
- Contract: `contracts/discovery.schema.json` (v0.2.0).

### Journey Mapper
`11_Benchmark_Engine/modules/journey_mapper/`

Given a Discovery Report (and optionally a UI Map and a screenshot path),
produces a **Journey Plan** — an ordered, evidence-backed sequence of steps to
attempt, each with a priority tier, confidence, expected result, dependency on
prior steps, and a stated possible failure mode. Also derives
`alternative_paths`, `blockers`, and explicit `assumptions`.

- Pure computation. No Playwright, no browser, no network access, no AI calls.
- Filters out any step with no Discovery evidence — never fabricates a plan
  for something it didn't observe.
- Files: `confidence.js` (confidence scoring), `planner.js` (the reasoning),
  `index.js` (`planJourney`).
- Contract: `contracts/journey_plan.schema.json`.
- Accepts an optional `ui_map` array in its contract, but **no module in this
  system currently produces a UI Map** — every real run today calls
  `planJourney` with `uiMap` empty, and the plan's own `assumptions` records
  that explicitly.

### Navigation Runner
`11_Benchmark_Engine/modules/navigation_runner/`

Given a Journey Plan, executes it step by step: opens pages, clicks elements,
types into inputs, waits for navigation, and captures a screenshot + HTML
snapshot + metadata at every step — succeeding or failing.

- Uses Playwright directly — the second (and only other) module in this
  system allowed to drive a browser. One continuous browser/page for the
  whole run, so state (a dismissed banner, an opened chat) can carry across
  dependent steps.
- Every click/type target is located generically by accessible name/role at
  runtime — no hardcoded selectors. A fixed transactional denylist blocks
  payment, checkout, login, and account-deletion language regardless of which
  step is being attempted. The only text ever typed is a fixed, non-personal
  search string.
- Files: `actions.js` (the only file that clicks/types), `capture.js` (the
  only file that writes to disk), `recovery.js` (one bounded retry per
  step), `runner.js` (per-step orchestration), `index.js` (`runJourney`).
- No formal JSON Schema contract exists for its output yet — the shape is
  documented in the module's own `README.md`.
- Output is written to disk but **read by nothing else in this system yet**
  (see Known Gaps).

### Vision Analysis
`11_Benchmark_Engine/modules/analysis/` (screenshot capture itself lives in
`11_Benchmark_Engine/modules/vision/`)

Two distinct pieces work together under this name:

- **`modules/vision/screenshotRunner.js`** — `captureScreenshot()`: opens a
  URL with Playwright, waits for it to settle, takes one full-page screenshot,
  returns `{ success, path, width, height, executionTime }`. No judgment, no
  analysis — capture only.
- **`modules/analysis/`** — given a screenshot path and a Discovery Report,
  produces a structured, qualitative UX read (first impression, visual
  hierarchy, CTA effectiveness, navigation clarity, AI feature visibility,
  information density, trust signals, accessibility observations, top-5
  strengths, top-5 improvement opportunities). No scoring, no cross-company
  comparison.
  - `promptBuilder.js` encodes the screenshot and summarizes Discovery's
    findings into a model payload.
  - `visionModelClient.js` sends that payload to **OpenAI's Responses API**
    (the `openai` npm package, API key from `11_Benchmark_Engine/.env`) and
    returns the model's raw text.
  - `responseParser.js` validates that text against the required field shape.
  - `index.js` (`analyzeHomepageUX`) chains the three.
  - Contract: `contracts/vision_ux_analysis.schema.json`.

**Today, Vision Analysis only ever runs once per company, against the single
homepage screenshot** — it is called from inside Reports (below), not
separately, and nothing currently feeds it any of Navigation Runner's
per-step screenshots.

### Reports
`11_Benchmark_Engine/modules/reports/homepageReport.js`

Builds the single **Homepage Benchmark Report** — the merged output of
Discovery's structural findings and Vision Analysis's qualitative read.

- `buildHomepageReport()` is async: it internally calls Vision Analysis
  (`promptBuilder` → `visionModelClient` → `responseParser`, all from
  `modules/analysis/`) using the screenshot and Discovery Report it's handed,
  and merges the result in. A Vision Analysis failure (e.g. an API quota
  error) is caught and recorded as `ai_ux_analysis_error` rather than losing
  the Discovery half of the report.
- `renderHomepageReportMarkdown()` renders the merged report to Markdown.
- `writeHomepageReport()` writes `report.json` + `report.md` to
  `02_Benchmark_Repository/_Homepage_Benchmarks/{company_slug}/`.
- This module covers the **homepage-only** flow only. There is no equivalent
  "Journey Report" that assembles Navigation Runner's multi-step output —
  that does not exist yet.

### Dashboard
`10_Dashboard/`

An Express server (`server.js`) plus a single-page app (`public/index.html`,
`app.js`, `style.css`) that reads project data live from the filesystem on
every request — nothing is pre-built or cached.

- `GET /api/homepage-benchmarks` scans
  `02_Benchmark_Repository/_Homepage_Benchmarks/*/report.json` and serves
  it, with each report's screenshot path rewritten to the existing
  `/screenshots/*` static route.
- The **Homepage Benchmarks page** (`#homepage-benchmarks`) renders that list
  as cards — company, screenshot, AI summary, top-5 strengths/opportunities,
  confidence, last-analyzed date, and an "Open Full Report" button that
  fetches `report.md` via the existing `GET /api/markdown` endpoint and
  renders it with `marked.parse()` inside the app's generic modal.
- The Dashboard also serves an older, separate data source — hand-curated
  company folders under `02_Benchmark_Repository/{Category}/{Company}/` plus
  `Master_Benchmark_Matrix.json` — from the manual, human-run benchmark
  workflow that predates this Engine. That workflow and this Engine are two
  different pipelines writing into the same `02_Benchmark_Repository/` tree,
  and the Dashboard reads both, but they are not integrated with each other.
- `PATCH /api/requests/:id/items/:slug` (the Queue page's "Launch Benchmark"
  button) calls `orchestrator.startBenchmark()` — a placeholder that only
  logs company/feature/requestId/time. **It does not trigger
  `runHomepageBenchmark()` or any part of this Engine.** Today, the only way
  to actually run the Homepage Intelligence pipeline is the CLI script
  (`node run-homepage-benchmark.js <url>`) or a direct import.

---

## Data Flow

### Flow A — Homepage Intelligence (wired, automated, in production use)

```
URL
 │
 ▼
Discovery ─────────────────────────────► DiscoveryReport
 │ (Playwright)
 ▼
Vision — screenshotRunner.captureScreenshot() ──► { path, width, height }
 │ (Playwright)
 ▼
Reports — buildHomepageReport(discovery, screenshot)
 │   internally calls Vision Analysis:
 │   promptBuilder → visionModelClient (OpenAI) → responseParser
 ▼
report.json + report.md
   → 02_Benchmark_Repository/_Homepage_Benchmarks/{slug}/
 │
 ▼
Dashboard — GET /api/homepage-benchmarks → Homepage Benchmarks page
```

Entry point: `orchestrator.runHomepageBenchmark({ url, companyName,
companySlug })`, in `11_Benchmark_Engine/orchestrator/index.js`. Runnable via
`node run-homepage-benchmark.js <url> [companyName] [companySlug]` from
`11_Benchmark_Engine/`.

### Flow B — Autonomous Journey (built, verified, not yet chained)

```
DiscoveryReport (same Discovery module as Flow A)
 │
 ▼
Journey Mapper — planJourney(discoveryReport) ──► JourneyPlan
 │ (pure — no browser)
 ▼
Navigation Runner — runJourney(journeyPlan) ──► steps[] + run_manifest.json
 │ (Playwright — separate browser session from Discovery's)
 ▼
   03_Screenshots/{company}/_navigation_runs/{run_id}/*.png
   02_Benchmark_Repository/_Navigation_Runs/{company}/{run_id}/
       {NN}_{step_id}/page.html
       {NN}_{step_id}/metadata.json
       run_manifest.json
 │
 ▼
(nothing — no module currently reads this output)
```

There is no orchestrator function that chains Discovery → Journey Mapper →
Navigation Runner automatically. Each module has been verified working
against live Discovery output, but a caller must invoke them one at a time
today.

---

## Known Gaps in Current Wiring

Stated plainly, because an architecture document that hides this would be
actively misleading:

1. **Flow A and Flow B are disconnected.** Flow A never plans or executes a
   multi-step journey. Flow B never produces a report, and its evidence
   (screenshots, HTML snapshots) is written to disk and read by nothing.
2. **Vision Analysis never sees Navigation Runner's screenshots.** It only
   ever runs once, against the homepage, inside Flow A.
3. **No UI Map producer exists.** Journey Mapper's contract accepts one; no
   module builds one; every real plan today is built from Discovery's text
   labels alone.
4. **The Dashboard's "Launch Benchmark" button does not run this Engine.** It
   calls a Sprint 1 placeholder (`startBenchmark`) that only logs. The
   Homepage Benchmarks page displays results of runs that were started
   outside the Dashboard, via the CLI.
5. **Navigation Runner produces no report.** Its `run_manifest.json` is the
   only summary artifact, and it is raw execution data (status, action taken,
   file paths) — not a judged or written deliverable.

Closing these gaps is exactly what `ROADMAP.md`'s Phase 2 (Sprints 11–12)
covers — not described further here, since this document is scoped to what
exists today.
