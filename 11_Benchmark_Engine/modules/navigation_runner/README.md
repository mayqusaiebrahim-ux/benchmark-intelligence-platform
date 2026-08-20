# Navigation Runner — executes a Journey Plan, produces evidence, nothing else

**Given a JourneyPlan (from `modules/journey_mapper`), walk it step by step.**
Open pages, click elements, type into inputs, wait for navigation, capture a
screenshot + HTML snapshot + metadata at every step, and keep going even when
a step fails. This is the first module in the pipeline allowed to drive
Playwright past the homepage.

## Hard boundary

- No UX analysis, no scoring, no report writing, no pattern extraction. This
  module produces raw evidence (screenshots, HTML, per-step metadata, a run
  manifest) — it does not judge any of it.
- No real transactions, ever: no payment completion, no checkout, no
  authentication, no real personal/passenger data. `actions.js`'s
  `TRANSACTIONAL_DENYLIST` blocks any candidate whose accessible name matches
  pay/checkout/purchase/confirm-booking/sign-in/log-in/register/delete/etc.,
  independent of which step is being attempted.
- No typed input is ever real user data — the only text this module ever
  types is a fixed, generic destination string (`"Paris"`), used solely to
  exercise a search box.
- No hardcoded selectors — every click/type target is located generically by
  accessible name/role at runtime, the same principle Discovery's `actions.js`
  established.
- Not wired into the orchestrator yet, and not integrated with the Dashboard.

## File layout

- `actions.js` — the only file that clicks or types. One interaction hint per
  canonical journey step (`STEP_INTERACTION_HINTS`); every candidate is
  matched by keyword against visible, accessible elements and re-checked
  against the denylist immediately before interacting. Steps with no safe,
  well-defined interaction (login, completing payment) simply have no hint
  and are never attempted.
- `capture.js` — the only file that writes to disk. Screenshots go to
  `03_Screenshots/{company}/_navigation_runs/{run_id}/` (same root every other
  screenshot in this project uses); HTML snapshots, per-step metadata, and the
  run manifest go to `02_Benchmark_Repository/_Navigation_Runs/{company}/{run_id}/`,
  mirroring the existing `_Homepage_Benchmarks/` / `_Feature_Benchmarks/`
  convention for pipeline output that isn't yet part of the full 11-deliverable
  structure. Capture always runs, even for a failed step — what the page
  looked like at the moment of failure is itself useful evidence.
- `recovery.js` — bounded, graceful failure handling. Exactly one retry per
  step, after a short wait (the most common real failure is late rendering,
  not true absence). Never loops, never throws — a step that still fails is
  marked `failed` and the run continues.
- `runner.js` — executes one `JourneyStep`: re-baselines to `starting_url`
  first for independent steps, skips a step outright if it `depends_on_previous`
  and the prior step failed, otherwise attempts the action, recovers once on
  failure, captures evidence regardless, and returns a per-step result.
- `index.js` — `runJourney({ journeyPlan, companyName?, companySlug? })`, the
  public entry point. Launches one browser/page for the whole run (so session
  state can carry across dependent steps), loops `journeyPlan.recommended_journey`
  in order, writes the final run manifest, and returns the aggregated result.

## What it deliberately does not do

- Does not decide *whether* a step is worth attempting or in what order —
  that's already decided by Journey Mapper; this module only executes the
  plan it's handed.
- Does not judge success beyond "did the intended interaction happen" —
  whether the resulting page is any *good* is Vision/Analysis's job, next.
- Does not retry indefinitely, does not chase a plan's `alternative_paths`
  automatically yet — a failed step is recorded and the run moves on; a
  future orchestrator-level retry could re-invoke `runJourney` with a
  re-ordered plan if that's ever wanted.

## How it connects

See the end of the Sprint 10 chat response for the full explanation of how
this sits between Journey Mapper and the not-yet-built Vision Analysis
integration.
