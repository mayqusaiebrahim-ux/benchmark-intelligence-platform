# Benchmark Engine — Architecture

> **Frozen at v1.0.** Discovery, the Navigation Runner, Vision Analysis, Reports,
> the parallel `scheduler/` (Sprint 13), and the `modules/antibot/` layer (Sprint 14)
> are the stable, shipped feature set as of this freeze. No new engine capabilities
> are being added for now — active work has moved to wiring this engine into
> `10_Dashboard/` for the Homepage Benchmark Beta. The section below is the
> original Sprint 1 scaffolding description and is now historical — the modules
> it describes as "nothing here executes yet" are, as of this freeze, real and
> in production use; see `scheduler/README.md` and `modules/antibot/README.md`
> for what actually exists today.

**Status: scaffolding only.** No AI, no Playwright, no wiring to anything else in this
repository. This document describes the intended responsibility of each folder so that
future work has a place to go — nothing here executes yet.

## Why this exists

Today, a benchmark is run entirely by an agent following `00_Project_Management/Benchmark_Workflow.md`
by hand: navigate, capture, score, write. The Dashboard's Wizard and Queue
(`10_Dashboard/`) only *prepare* that work — they generate the trigger prompt and track
its stage; they do not perform it (see `Benchmark_Requests.json` and
`scripts/update_queue.js`).

`11_Benchmark_Engine/` is where a future, codified version of that workflow would live —
the capture → analysis → report pipeline broken into discrete, testable pieces instead
of one long manual run. It is deliberately separate from `10_Dashboard/`: the Dashboard
is the surface the DX team looks at; the Engine (once built) is what would eventually do
the work the Dashboard currently only requests.

Nothing in the rest of the repository imports from or depends on this folder yet.

## Folder responsibilities

```
11_Benchmark_Engine/
├── orchestrator/          conducts a run; owns no domain logic itself
└── modules/
    ├── vision/            capture — turns a live product into screenshots/video
    ├── analysis/           scoring — turns captures into journey/innovation scores
    ├── reports/            writing — turns scores + findings into the 11 deliverables
    ├── prompts/            the versioned prompt templates that drive AI-assisted steps
    └── shared/             types, schema, and path conventions every module agrees on
```

### `orchestrator/`
Sequences a single benchmark run end to end: setup → capture → scoring → analysis →
pattern extraction → opportunities → report, mirroring the phase list in
`Benchmark_Workflow.md`. It calls into `modules/`, tracks which phase a run is in, and
is the only piece that would eventually be allowed to talk to `Benchmark_Requests.json`
/ `scripts/update_queue.js` to reflect real progress on the Dashboard's Queue. It holds
no capture, scoring, or writing logic itself — it delegates to modules and coordinates
their order.

### `modules/vision/`
Everything about *seeing* the product being benchmarked: driving a browser, capturing
screenshots and video per journey step, selecting the hero/highlight shots, handling the
Tier 1/2/3 capture escalation ladder. This is the only place browser automation (e.g.
Playwright) would ever be introduced — and it isn't, yet.

### `modules/analysis/`
Everything about *judging* what was captured: scoring the 12 journey steps and 5
innovation dimensions, computing AI maturity level, answering the 5 mandatory questions,
and diffing a new run against the existing `Master_Benchmark_Matrix.json` to detect
pattern escalation (Emerging → Table Stakes). This is the codified form of the
qualitative judgment an agent currently applies by hand.

### `modules/reports/`
Everything about *writing it up*: generating the 11 deliverables (executive summary,
journey step files, UX analysis, emerging patterns, innovation opportunities, Saudia
brief, Figma annotations) in the same shape `02_Benchmark_Repository/` and
`07_Saudia_Opportunities/` already expect, so anything this module produces would be
readable by the existing Dashboard without the Dashboard changing.

### `modules/prompts/`
The versioned prompt templates for any AI-assisted step — the "Benchmark [Company]"
trigger, the 5-mandatory-questions framing, per-journey-step research prompts. Kept as
data here rather than inlined in `orchestrator/` or `modules/analysis/`, so prompt
wording can change independently of the pipeline logic that calls it.

### `modules/shared/`
Cross-cutting types and constants used by more than one module: the journey-step and
innovation-dimension schema (kept in sync with `Master_Benchmark_Matrix.json`'s
`schema` block), file path conventions for `02_Benchmark_Repository/` and
`03_Screenshots/`, and the benchmark-type/scope vocabulary already defined in
`10_Dashboard/lib/requestsStore.js`. Exists so the Engine and the Dashboard never
define the same concept twice in two different shapes.

## Explicit non-goals for this sprint

- No AI calls of any kind.
- No Playwright or any browser automation.
- No imports from, or edits to, `10_Dashboard/`, `Master_Benchmark_Matrix.json`,
  `Benchmark_Requests.json`, or any existing folder.
- No code — folders and this document only.
