# Architect Review — PRD, Roadmap, Architecture

Reviewed together: `docs/PRD.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`.
Read-only review — no source document was modified. Findings are grounded in
the actual behavior of `11_Benchmark_Engine/` as described in
`ARCHITECTURE.md` and verified against the real module code, not just the
prose of the three documents against each other.

---

## Missing Sections

**1. Design Principle 5 is asserted but never designed.**
PRD.md states "two speeds, one product" as a governing principle for every
section that follows ("The UI must let a user tell, at a glance, which one
they're looking at"). Principles 1–4 each have a visible, traceable design
decision somewhere in §1–§7 (evidence-before-verdict → the always-shown
screenshot in §4; uncertainty-shown → the Confidence & Evidence Trail in §3
row G). Principle 5 has none — no badge, color, or label is proposed anywhere
that would actually distinguish an autonomous run from a manual 11-deliverable
benchmark. PRD.md's own closing "Open Questions" section admits this
directly. A principle with no corresponding decision isn't a design yet —
it's a reminder that one is still owed.

**2. No zero-data failure state.**
PRD §1 describes how a *partial* or *low-confidence* result surfaces (inline
ticker rows, warning tone). Nothing describes what the user sees if Discovery
fails outright — site unreachable, DNS failure, timeout before any
`DiscoveryReport` exists at all. That's a materially different state from
"we found something, but it's uncertain," and Principle 4 ("uncertainty is
shown, not hidden") implies it needs its own honest treatment, not silence.

**3. No retention policy for run output.**
Every Navigation Runner run writes a new, uniquely-named folder under
`03_Screenshots/{company}/_navigation_runs/{run_id}/` and
`02_Benchmark_Repository/_Navigation_Runs/{company}/{run_id}/` (per
ARCHITECTURE.md's Flow B). None of the three documents say whether old runs
are ever pruned, archived, or superseded. Left unaddressed, this grows
unbounded with every re-analysis of the same company.

**4. No cost or access control for "Analyze Website."**
PRD §1 puts a one-field "Analyze Website" input prominently on the Home page.
Every run costs at least one billed OpenAI Responses API call (Vision
Analysis), and this project has already hit a real `429` quota error from
that exact API earlier in development. Sprint 12's implied move to per-step
analysis (see *Future Technical Risks*, below) multiplies that per run. None
of the three documents mention who can trigger a run, at what rate, or what
happens when quota is exhausted mid-run.

**5. Phases 3–5 have no sprint breakdown or entry criteria.**
ROADMAP.md gives Phase 2 explicit, numbered sprints (10, 11, 12). Phases 3, 4,
and 5 are each a single undivided block with no stated dependency ordering —
notably, no statement that Phase 3 (Pattern Intelligence) requires a
meaningful number of companies to have completed Phase 2's full journey flow
before cross-company pattern counts mean anything, even though CLAUDE.md
itself already establishes that kind of volume threshold (5+ sightings before
"Table Stakes") for the exact same kind of classification.

---

## Contradictions

**1. "Sprint 11" names two different things.**
PRD.md's own header reads `**Sprint:** 11 — Planning` — i.e. the sprint that
*produced* the PRD, already complete. ROADMAP.md separately lists
`### Sprint 11 — Journey Experience` as a distinct, not-yet-built
*implementation* sprint under Phase 2. Both are legitimately "Sprint 11" in
their own document, but they are not the same sprint, and nothing in either
file flags the collision. A reader moving between the two documents has no
way to tell, from the number alone, whether Sprint 11 is done.

**2. The journey map mockup shows data the current contract can't produce.**
PRD §2's journey map mockup renders four nodes, including
`(–) Search … no evidence`. But per ARCHITECTURE.md, Journey Mapper's
`recommended_journey` **only ever contains evidence-backed steps** — it
explicitly filters out anything without `applicable_guess: true` and "never
fabricates a plan for something it didn't observe." A step with no evidence
doesn't appear in the real `JourneyPlan` output at all today; there is no
field for the Dashboard to render a "no evidence" node from. Either Journey
Mapper needs to start emitting excluded steps for display purposes, or the
Dashboard needs its own independent list of the 12 canonical steps to diff
against the plan — neither is specified anywhere, and ROADMAP's Sprint 11
scope (PRD §1–§4) doesn't call this out as work required to make its own
reference mockup real.

**3. The confidence explanation describes a branch that can't currently fire.**
PRD §4 describes step-level confidence reasoning as answerable by hovering:
"UI Map match? copy-only? no locator?" — presented as three live
possibilities. ARCHITECTURE.md states plainly that no module in the system
produces a UI Map, so every real plan today resolves to the same branch (no
locator). The other two states in that hover copy are currently unreachable.
This isn't necessarily wrong to design for, but as written it reads as three
equally likely outcomes rather than one real outcome and two aspirational
ones — and no sprint in ROADMAP.md is assigned to build a UI Map producer, so
it's not clear when (or whether) the other two branches become real.

---

## Future Technical Risks

**1. Navigation Runner does not inherit Discovery's cleared obstacles — and can't clear them itself.**
This is the most concrete risk in the set. Per ARCHITECTURE.md, Discovery
launches its own Chromium session, does its safe exploration (dismiss a
cookie banner, expand a nav menu), and closes that browser when it finishes.
Navigation Runner then launches a **separate** Chromium session with no
shared cookies or storage state. If Discovery encountered — and could not
safely dismiss — a consent banner (a case this project has already hit
directly, e.g. the real mindtrip.ai run in Sprint 5), Navigation Runner will
start fresh against the *same* undismissed banner. Critically, Navigation
Runner's `actions.js` only defines interaction hints for the 12 canonical
journey steps — it has no consent-banner-dismissal logic of its own, unlike
Discovery. A banner Discovery already flagged as a blocker can silently
degrade or block every subsequent step Navigation Runner attempts, with no
mechanism in the current code to recover.

**2. PRD's own proposed fix for the live ticker doesn't match how Navigation Runner actually writes progress.**
PRD's "Open Questions" asks whether the live ticker should "poll the run
manifest." Per ARCHITECTURE.md, `run_manifest.json` is written **once, after
every step has already completed** — polling it produces nothing until the
run is already over, which defeats the purpose of a live, row-by-row ticker
entirely. What *does* update incrementally, per step, is each step's own
`metadata.json` (written by `capture.js` as part of `executeStep`). If Sprint
11 is implemented against the literal wording of PRD's open question rather
than this distinction, the live ticker will appear frozen until the whole run
finishes.

**3. Per-step Vision Analysis multiplies a call path that has already failed once in production.**
PRD §1, §3 (rows D and E), and §4 all assume Vision Analysis runs once per
*step*, not once per *company* — a live ticker row for it, a per-step "what we
found," and an aggregated AI Capability Summary across all steps all require
this. ARCHITECTURE.md confirms today's reality is the opposite: Vision
Analysis runs exactly once per company, against the homepage screenshot only.
Moving to per-step calls multiplies OpenAI Responses API volume by the number
of planned steps per run. This project has already encountered a real `429`
quota-exceeded error from this exact integration (Sprint 7.2). None of the
three documents mention retry/backoff strategy, cost budgeting, or graceful
per-step degradation (distinct from `homepageReport.js`'s existing
whole-report-level `ai_ux_analysis_error` fallback, which was designed for a
single call, not N of them).

---

## Anything That Would Cause Problems in Later Sprints

**1. No sprint explicitly owns wiring Navigation Runner's screenshots into Vision Analysis.**
Sprint 12 ("Journey Report," per ROADMAP.md) is scoped to *assemble* PRD
sections D, E, G, and H — but sections D and E require per-step AI/UX
findings to already exist as an input. That connection — the actual
integration named directly in ARCHITECTURE.md's Known Gap #2 — isn't listed
as a deliverable of Sprint 11 or Sprint 12. Whoever picks up Sprint 12 could
reasonably assume the wiring already exists (since ROADMAP frames the sprint
as "assembling," not "connecting") and discover mid-sprint that it doesn't.

**2. Sprint 11 is scoped as UI, but its own PRD reference requires a backend that doesn't exist.**
ROADMAP describes Sprint 11 as building "the actual UI the PRD specifies."
But PRD §1's live run ticker has nothing to display unless Discovery, Journey
Mapper, and Navigation Runner are already chained into one live-running
pipeline — and ARCHITECTURE.md's Flow B section states directly that no
orchestrator function does this chaining today; each module must be invoked
separately. If Sprint 11 is read literally as frontend work, its load-bearing
backend dependency (an orchestrator entry point analogous to
`runHomepageBenchmark()`, but for Flow B) is unaccounted for in either
document.

**3. Sprint 12 has no stated boundary against the working Phase 1 path.**
Phase 1 (Homepage Intelligence) is marked complete and is, per
`homepageReport.js`, a working, shipped flow. Sprint 12 ("Journey Report")
will need to produce a comparable merged report for the multi-step journey —
but neither ROADMAP.md nor ARCHITECTURE.md states whether that means adding a
new, separate module (matching this project's consistent pattern elsewhere of
parallel modules and parallel output folders per flow — Homepage Benchmarks
vs. Navigation Runs already don't share a folder) or modifying
`homepageReport.js` in place. Given every other sprint in this project's
history has been explicitly instructed not to modify a working module, the
absence of that instruction here is a gap worth closing before Sprint 12
starts, not after.
