# Roadmap — AI Benchmark Intelligence Platform

Source of truth: [`docs/PRD.md`](./PRD.md). Every phase and sprint below implements
a specific, already-written section of the PRD — nothing here introduces scope the
PRD doesn't already describe. Where a line has no PRD reference, it isn't real yet.

---

## Phase 1 — Homepage Intelligence ✅

Discovery → single-screenshot capture → GPT Vision UX Analysis → merged Homepage
Report → Dashboard Homepage Benchmarks page. The proven, working slice everything
else in this roadmap extends.

**PRD reference:** PRD.md §3, row E — *"the merged top-5/top-5 pattern already
proven on the Homepage Benchmark card"* is the PRD's own citation of this phase as
the pattern later sections build on.

---

## Phase 2 — Autonomous Journey

Takes the proven homepage-only pipeline multi-step: plan a journey, execute it,
present it as one continuous experience instead of a single page.

### Sprint 10 — Navigation Runner ✅

Executes a Journey Plan step by step — opens pages, clicks, types, captures a
screenshot + HTML snapshot + metadata per step, handles failure gracefully.

**PRD reference:** PRD.md §3, row B (*"Journey Map... source: navigation_runner
run_manifest.steps[]"*) and §4 (step anatomy fields drawn directly from a
Navigation Runner step: `action_taken`, `status`, screenshot, failure detail).

### Sprint 11 — Journey Experience

Builds the actual UI the PRD specifies for a finished run: the "Analyze Website"
entry point and live run ticker, the verdict strip + journey map spine, and the
per-step narrative cards.

**PRD reference:** PRD.md §1 (Analyze Website / live run ticker), §2 (verdict
strip + journey map spine), §3 rows A–C (Verdict Strip, Journey Map,
Step-by-Step Narrative), §4 (step card anatomy).

### Sprint 12 — Journey Report

Assembles the remaining PRD sections into one persisted, exportable report per
run — AI Capability Summary, UX Strengths & Opportunities, the Confidence &
Evidence Trail, and the closing Executive Read — plus resolves the PRD's own
open questions about how this gets generated.

**PRD reference:** PRD.md §3 rows D, E, G, H (AI Capability Summary, UX
Strengths & Opportunities, Confidence & Evidence Trail, Raw Data), §5 (closing
Executive Read summary and the persistent action row), and *Open Questions
Before Sprint 12* in full.

---

## Phase 3 — Pattern Intelligence

Turns the per-step findings Phase 2 produces into cross-cutting pattern
detection: what's shared, what's unique, what's becoming standard.

**PRD reference:** PRD.md §3 row D (*"Rolls up every AI-related finding across
all steps... deduplicated"*), §6 (Industry Position badges, Table Stakes →
Ahead of Its Time), §7 (Compare mode's shared/unique highlighting — convergence
and differentiation across companies).

---

## Phase 4 — Opportunity Engine

Turns pattern intelligence into the four-tier Saudia opportunity board, and
lets Compare mode's Saudia Gap view feed it directly.

**PRD reference:** PRD.md §6 (the Quick Wins / Medium-term / Long-term /
Moonshot board in full, including Saudia unfair-advantage marking and the
de-emphasized Ideas to Avoid strip), §5 ("If Saudia adopts one idea" callout),
§7 (*"the Saudia Gap toggle... turning the same grid directly into the input
for Question 6's board"*).

---

## Phase 5 — Executive Dashboard

The ten-second-read surface: verdict strips and Executive Read cards made
scannable across every benchmarked company, not just within one run.

**PRD reference:** Design Principle 2 (*"Skim, then read, then dig"*), PRD.md
§3 row A (Verdict Strip), §5 (Executive Read card and its persistent action
row — Compare, Export PDF, Re-analyze, View Raw Manifest).
