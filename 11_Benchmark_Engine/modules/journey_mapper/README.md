# Journey Mapper — planning only, never navigation

**Given a Discovery Report (+ an optional UI Map, + a homepage screenshot path),
produce a JourneyPlan.** This module reasons about where a benchmark run should
go next and why. It never goes there itself.

## Hard boundary

- No Playwright, no browser, no dependency on it.
- No clicking, no navigation, no network access of any kind.
- No AI/LLM calls — same rule-based, deterministic approach as Discovery's
  `interpret.js`. Every field in the output is traceable to specific Discovery
  (or UI Map) evidence.
- The homepage screenshot path is carried through for traceability only —
  this module does not analyze pixels. That stays Vision/Analysis's job.

## Why it exists

Discovery already proposes a `suggested_benchmark_journey` (12 steps, guessed
applicability, confidence, priority rank). Journey Mapper is not a duplicate
of that — it's the next layer of reasoning on top: it filters to only
evidence-backed steps, re-ranks them against the platform's fixed priority
tiers (AI-first → Trip Planning → Search → Booking → everything else),
enriches each with a UI Map element if one exists, and adds the things
Discovery's output doesn't have: dependencies between steps, fallback paths,
explicit blockers, and explicit assumptions about what's missing.

## Priority tiers (fixed, not configurable per run)

1. AI-first experience (`step_04_ai_interaction`)
2. Trip Planning / personalization (`step_05_recommendations`)
3. Search (`step_03_search`)
4. Booking (`step_07_booking`)
5. Everything else (discovery, maps, ancillaries, payment, trip management,
   check-in, loyalty)

`step_01_entry` is never planned as a step — it's already-observed and lives
in `starting_url` instead.

## File layout

- `confidence.js` — pure confidence reasoning. `scoreStepConfidence()` combines
  Discovery's per-step confidence with whether a UI Map element confirms a
  real, clickable, visible target (upgrades one tier) or whether the only
  evidence is page-copy text with nothing confirmed to click (downgrades one
  tier — this is the "hidden AI feature" case). `computeOverallConfidence()`
  rolls all planned steps into one plan-level confidence, floored by whether
  a UI Map was supplied at all and by the source Discovery Report's own
  confidence.
- `planner.js` — the reasoning itself: filters Discovery's suggested journey
  down to evidence-backed steps, assigns priority tiers, builds each
  `JourneyStep` (title/goal/reason/expected_result/possible_failure/
  depends_on_previous), ranks them, and derives `alternative_paths`,
  `blockers`, and `assumptions`.
- `index.js` — `planJourney({ discoveryReport, uiMap?, screenshotPath? })`,
  the public entry point. Synchronous — pure computation, no I/O.

## What it deliberately does not do

- Does not fabricate steps with zero Discovery evidence (`applicable_guess:
  false` entries are excluded, not guessed at).
- Does not invent element locators when no UI Map is supplied — it says so
  explicitly in `assumptions` instead.
- Does not decide whether a step is *safe* to click (that boundary belongs to
  whatever eventually executes the plan, mirroring Discovery's own
  `actions.js` denylist).
- Is not called from the orchestrator yet. Nothing in this sprint wires it in.

## How this connects: Discovery → Vision → Navigation Runner (Sprint 10)

See the end of the Sprint 9 chat response for the full explanation. Short
version: Journey Mapper sits between Discovery and a not-yet-built Navigation
Runner. Discovery produces the Report (and, once built, a UI Map) for the
homepage only; Journey Mapper turns that into an ordered plan; a Sprint 10
Navigation Runner is the first module allowed to actually drive Playwright
through that plan, one step at a time, capturing evidence via the existing
`modules/vision/screenshotRunner.js` pattern at each stop — Journey Mapper
itself never touches a browser.
