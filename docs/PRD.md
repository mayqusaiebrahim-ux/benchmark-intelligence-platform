# The Benchmark Journey — Product Design Document

**Sprint:** 11 — Planning
**Status:** Design only, nothing implemented
**Reference subject:** mindtrip.ai

How a URL becomes a finished, trustworthy read on a travel product's AI experience — the end-to-end UX for Discovery, Journey Mapper, Navigation Runner, Vision Analysis and Reports, as one platform instead of five modules.

---

## Design Principles

Five modules already exist and each does one honest job — observe, plan, execute, judge, write. What's never been designed is what it *feels* like to be the person who typed a URL and is now waiting to understand a product. That experience runs on five commitments:

1. **Evidence before verdict** — every claim on screen traces to a screenshot, an action, or a field the engine actually produced. Nothing is asserted that can't be clicked into and shown.
2. **Skim, then read, then dig** — a verdict strip for the exec skimming in ten seconds. A narrative for the designer reading in ten minutes. Raw manifests for the analyst who wants an hour.
3. **The journey is the interface** — the sequence of steps a real user would take *is* the navigation — not a report with a tab bar bolted on afterward.
4. **Uncertainty is shown, not hidden** — confidence, blockers, and assumptions are rendered with the same weight as findings. A low-confidence claim looks different from a high-confidence one.
5. **Two speeds, one product** — this instant, autonomous read and the deep manual 11-deliverable benchmark are both real. The UI must let a user tell, at a glance, which one they're looking at.

---

## 1 — What does the user see after clicking "Analyze Website"?

Today, starting a benchmark means the five-step Wizard — type, feature, competitors, scope, review — because a human has to plan what a manual research session will cover. That wizard should stay exactly as it is for the deep, manual pipeline. But the autonomous engine needs none of that: Discovery already works from a bare URL. So **"Analyze Website" is a new, second front door** — one field, one button, on the Home page itself, not buried in the Wizard.

Clicking it doesn't open a modal or a spinner. It navigates to a dedicated `#run/{run_id}` page that stays open for the life of the run and becomes the Benchmark Journey page the moment it finishes — the loading state and the finished state are the same route, so nothing jars when it completes.

### The live run view

Not a progress bar — a **ticker**, because the five real stages take genuinely different amounts of time and the user should know which one is running. Discovery and Journey Mapper resolve in seconds; Navigation Runner and per-step Vision Analysis take longer and step through visibly, one row appearing at a time as each `JourneyStep` actually completes, with the literal `action_taken` string surfacing as it happens.

```
mindtrip.ai                                          [ Analyzing… ]

 ✓  Discovery                                                 3.9s
    OTA · AI capability found in page copy · consent banner not dismissed

 ✓  Journey Mapper                                             0.1s
    2 evidence-backed steps planned · confidence: low

 ✓  Step 1 — Engage the AI entry point                         2.5s
    Clicked "Start chatting" → mindtrip.ai/chat

 ●  Step 2 — Evaluate trip planning                          running
    Locating a matching element…

 ○  Vision Analysis                                               —
    Waiting for capture to finish
```

**Live run ticker.** Each row is a real pipeline stage, not a cosmetic percentage. A row's detail line is the literal evidence the stage produced — `detected_ai_capabilities`, `action_taken` — so watching the run *is* reading the first draft of the report.

If Discovery hits something a person needs to know about immediately — a login wall, a bot-detection block, a confidence downgrade — that surfaces inline as its own ticker row with a warning tone, not as a silent failure discovered three screens later. The run never appears to "hang": every row either completes, fails visibly, or is actively running.

---

## 2 — How should a complete benchmark journey be presented?

The current Company Detail page treats Screenshots, UX Analysis, and the 12-step Journey as three separate tabs with no explicit link between a given screenshot and what was said about it. That worked when a human researcher assembled everything by hand and rough correlation was good enough. It doesn't work once the engine *knows* exactly which screenshot, which click, and which AI finding belong to which step — that correlation should be the whole point of the page, not something the reader has to reconstruct.

The organizing metaphor is a **journey map**: a horizontal sequence of stops, the same mental model as a subway line or a checkout progress bar — familiar because it's literally what happened, in order, to a browser. It sits as a persistent spine at the top of the page; everything below is that spine expanded into detail.

```
 [OTA]  [Medium confidence]
 A real AI planner exists, but it's hiding behind unlabeled
 copy and an undismissed cookie banner.
 mindtrip.ai · analyzed 4 minutes ago · 2 of 2 planned steps completed         Assistive
                                                                              AI Maturity

 (✓)Entry ──── (✓1)AI Entry Point ──── (✓2)Trip Planning ──── (–)Search
 Discovery                                                     no evidence

 ↓ Narrative continues below
```

**The spine.** Verdict strip (skim), journey map (orient), narrative (read). A node's color is its actual `status` from the Navigation Runner manifest — green success, red failed, grey skipped — never decorative.

Scrolling past the map moves through the page in the same order the browser actually moved through the site — the reading order and the browsing order are the same order, on purpose.

---

## 3 — What are the major sections of the Benchmark Journey?

Eight sections, each with one job and one clear data source. Nothing here is invented content — every section is a presentation layer over a field the engine already produces.

| # | Section | What it does | Source |
|---|---------|---------------|--------|
| A | **Verdict Strip** | Website type, confidence, one-line AI-written headline, AI maturity level, "analyzed when." Sticky while scrolling — always visible, always answers "should I keep reading." | `website_type` · `confidence` · `discovery.primary_user_goals` |
| B | **Journey Map** | The horizontal step tracker from Q2. Every node is clickable and jumps to its narrative card. | `navigation_runner` run_manifest.steps[] |
| C | **Step-by-Step Narrative** | One card per executed step — screenshot, action, AI read, reasoning, confidence. The bulk of the page. Full anatomy in Question 4. | journey_plan step + navigation run step + per-step vision analysis |
| D | **AI Capability Summary** | Rolls up every AI-related finding across *all* steps — not just the AI-interaction step, since AI can surface inside search results or recommendations too — into one "does this product really have AI" read. | `detected_ai_capabilities` across steps, deduplicated |
| E | **UX Strengths & Opportunities** | The merged top-5/top-5 pattern already proven on the Homepage Benchmark card — but aggregated across the whole journey instead of one page. | `vision_ux_analysis.top_5_ux_strengths` / `_improvement_opportunities` |
| F | **Opportunities for Saudia** | The four-tier board. Detailed in Question 6. | pattern classification + Saudia feasibility axes |
| G | **Confidence & Evidence Trail** | The honesty section: every blocker hit, every assumption made, every skipped or failed step, stated plainly. Never hidden below the fold as a footnote — see Principle 04. | `journey_plan.blockers` / `.assumptions` + failed/skipped steps |
| H | **Raw Data** | Links to the run manifest, every HTML snapshot, every screenshot folder — for the analyst who wants to verify everything above by hand. | `run_manifest.json` + `02_Benchmark_Repository/_Navigation_Runs/` |

---

## 4 — What information belongs to each journey step?

Each step card is where Journey Mapper's *plan*, Navigation Runner's *execution*, and Vision's *read* meet on one surface. Nine fields, each answering a distinct question a reader would actually ask, in the order they'd ask it:

```
[ Priority 1 · AI-first ]  [ Success ]

Engage the AI entry point                    Why included
step_04_ai_interaction                        Discovery matched "assistant", "planner"
                                               in page copy — the reason a human can audit
┌──────────────────────────┐
│                          │                  What we found
│   [ full-page screenshot ]│                 Vision's read of this specific screen,
│                          │                  not the homepage's
└──────────────────────────┘
"Clicked Start chatting"                      Confidence
→ mindtrip.ai/chat                            Downgraded here — copy-only evidence,
                                               no confirmed widget at plan time

                                               If it had failed
                                               possible_failure text shown instead,
                                               plus the raw error

                                               Chain
                                               A depends_on_previous badge if this
                                               step needed the last one to succeed
```

**Step card anatomy.** Screenshot and action are always shown, even on failure — *what the page looked like when it went wrong* is evidence too, not noise to hide.

- **Title & step-id badge** — human label plus the canonical id, so a technical reader can cross-reference the manifest directly.
- **Priority tier** — 1 (AI-first) through 5, inherited from Journey Mapper, shown as a badge not just a number.
- **Status** — success / failed / skipped, color-coded, matching the journey map node above.
- **Screenshot** — the primary visual, full-page, click to enlarge.
- **What we did** — the literal `action_taken` string, e.g. "Clicked 'Start chatting'".
- **What we found** — this step's own Vision UX Analysis read, not a rehash of the homepage's.
- **Why this step** — Journey Mapper's `reason`, tying the step back to specific Discovery evidence.
- **Confidence** — the step-level confidence, with the reasoning visible on hover (UI Map match? copy-only? no locator?).
- **Failure detail** — for failed/skipped steps: `possible_failure` and the actual error, side by side, so a reader can tell "we predicted this could fail" from "something unexpected broke."

---

## 5 — What summary should appear at the end?

The verdict strip at the top is the ten-second read. The end of the page is the ten-minute read's payoff — a closing **Executive Read** card that a busy CPO could screenshot and forward on its own. It doesn't introduce new information; it's the same findings, distilled a second time, because a reader who scrolled the whole page deserves a "here's what that all meant" moment, not an abrupt stop.

> Mindtrip leads with conversation, not search — the entire homepage is built to funnel a visitor into a chat, but the assistant's actual capability was never confirmed by this run because a cookie banner was never cleared.

| Strengths | Gaps |
|---|---|
| + Chat-first hero, unambiguous primary action | – AI surface never confirmed interactively |
| + Personalization language throughout | – Consent banner blocked full evaluation |
| + Clean, low-density layout | – No visible nav — reachability unclear |

> **If Saudia adopts one idea:** Lead the homepage with the AI entry point itself, not a description of it.

**Executive Read.** Same structure as the existing `executive_recommendation` block already in metadata.json — this section is that concept, finally given a home at the natural end of the reading journey instead of buried in an Overview tab.

Below the card: a persistent action row — **Compare**, **Export PDF**, **Re-analyze**, **View Raw Manifest** — so finishing the read is also the moment the reader is offered their next action, not a dead end.

---

## 6 — How should Opportunities for Saudia be presented?

CLAUDE.md already defines the framework — four timelines, two classification axes, a list of what Saudia uniquely owns. The mistake would be presenting that as another wall of prose when it's actually a planning artifact. It belongs on a **board**, because "what do we do and when" is a planning question, and Quick Wins / Medium-term / Long-term / Moonshot are already, literally, four columns.

| Quick Wins (0–3mo) | Medium-term (3–12mo) | Long-term (1–3yr) | Moonshot (3–5yr) |
|---|---|---|---|
| Surface the chat CTA above the fold on saudia.com's trip-planner entry<br>`Table Stakes` `Airline-Native` | Personalized recommendations keyed to Alfursan travel history<br>`Emerging Trend` `Platform-Level` | Trip-planning assistant that spans booking → in-flight → post-flight<br>`Unique Differentiator` `Long-term` | Agentic re-planning when a flight disruption occurs, unprompted<br>`Ahead of Its Time` |

**The board.** Every card carries its Industry Position badge (Table Stakes → Ahead of Its Time) and Saudia Feasibility tags — the two axes CLAUDE.md already requires, made scannable instead of read.

Cards that touch a Saudia unfair advantage — flight context, Alfursan data, the direct customer relationship, the in-flight or airport moment — get a small distinguishing mark, because those are the opportunities worth weighting higher regardless of column. **Ideas to Avoid** live in a single collapsed strip beneath the board, intentionally de-emphasized: still required, never competing visually with what's actually actionable.

---

## 7 — How should Compare mode work?

The existing Comparison page's radar chart and score table are right for scores — Compare mode for the Benchmark Journey is a different question: not "who scored higher" but "who does the same thing, and who does something nobody else does." That's a diff, not a leaderboard.

| | Mindtrip | Trip.com | Saudia |
|---|---|---|---|
| **AI ENTRY** | ✅ Chat-first hero | ✅ TripGenie widget | Not present |
| **SEARCH** | Destination box | 🟣 NLP flight search | Standard form |
| **TRIP MGMT** | Not reached | Itinerary dashboard | Not present |

✅ = shared across all selected companies (convergence) · 🟣 = unique to one company (differentiation)

**Aligned by step category, not by rank.** Rows are always the 12 canonical steps, in fixed order — so a step a company never reached still has a row, honestly labeled "not reached," rather than silently disappearing.

Selection stays simple — 2 to 4 companies, same picker already on the Comparison page. A **"Saudia Gap" toggle** pins Saudia as a fixed reference column and re-sorts every row by size of the gap, turning the same grid directly into the input for Question 6's board: everything unique-to-a-competitor in a Saudia-gap view is a candidate opportunity by definition.

---

## Open Questions Before Sprint 12

- Does the live ticker poll the run manifest, or does it need a real push channel? Polling is simpler and this project has never needed a socket yet.
- Per-step Vision Analysis — call the model as each step completes, or batch it after Navigation Runner finishes? Affects how "live" Section C can actually be.
- How many companies can Compare mode hold before the grid needs to scroll instead of fit? Four was chosen to match the existing picker, not tested against real width.
- Where does "two speeds, one product" (Principle 05) show up as an actual visual distinction, so a reader never mistakes an autonomous run for a full manual 11-deliverable benchmark?
